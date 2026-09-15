/*
Copyright 2026 The Dapr Authors
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import bodyParser from "body-parser";
import express from "express";
import { Network, TestContainers, Wait } from "testcontainers";
import { DaprContainer } from "./DaprContainer";
import { JobsApiError, JobsHarness } from "./JobsHarness";

describe("JobsHarness", () => {
  it("should configure DaprContainer with default options", () => {
    const harness = new JobsHarness();
    const dapr = harness.getDaprContainer();
    expect(dapr.getAppName()).toBe("jobs-app");
    expect(dapr.isWorkflowEnabled()).toBe(false);
  });

  it("should configure DaprContainer with custom options", () => {
    const harness = new JobsHarness({
      appId: "custom-jobs-app",
      appPort: 9100,
      daprLogLevel: "debug",
      daprApiLoggingEnabled: true,
      appChannelAddress: "host.testcontainers.internal",
    });
    const dapr = harness.getDaprContainer();
    expect(dapr.getAppName()).toBe("custom-jobs-app");
    expect(dapr.getAppPort()).toBe(9100);
    expect(dapr.getAppChannelAddress()).toBe("host.testcontainers.internal");
  });

  it("should throw when accessing the started container before start()", () => {
    const harness = new JobsHarness();
    expect(() => harness.getStartedDaprContainer()).toThrow("JobsHarness has not been started. Call start() first.");
  });

  it("should throw when scheduling a job without schedule or dueTime", async () => {
    const harness = new JobsHarness();
    await expect(harness.scheduleJob("job1", {})).rejects.toThrow(
      "Either 'schedule' or 'dueTime' must be provided to schedule a job."
    );
  });

  it("should reuse a supplied network instead of owning one", async () => {
    await using network = await new Network().start();
    const harness = new JobsHarness({ network });
    await harness.start();
    try {
      expect(harness.getHost()).toBeDefined();
      expect(harness.getHttpPort()).toBeDefined();
      expect(harness.getGrpcPort()).toBeDefined();
      expect(harness.getHttpEndpoint()).toBeDefined();
      expect(harness.getGrpcEndpoint()).toBeDefined();
    } finally {
      await harness.stop();
    }
  }, 120_000);

  it("should schedule, get, and delete a job end-to-end", async () => {
    await using network = await new Network().start();
    const harness = new JobsHarness({
      appId: "jobs-crud-app",
      daprLogLevel: "info",
      network,
    });

    try {
      await harness.start();

      await harness.scheduleJob("test-job", {
        schedule: "@every 1h",
        data: { hello: "world" },
        repeats: 3,
      });

      const job = await harness.getJob("test-job");
      expect(job).toBeDefined();
      expect(job.name).toBe("test-job");

      await harness.deleteJob("test-job");

      await expect(harness.getJob("test-job")).rejects.toThrow(JobsApiError);
    } finally {
      await harness.stop();
    }
  }, 300_000);

  it("should error with JobsApiError when getting a nonexistent job", async () => {
    await using network = await new Network().start();
    const harness = new JobsHarness({
      appId: "jobs-missing-app",
      network,
    });

    try {
      await harness.start();
      await expect(harness.getJob("does-not-exist")).rejects.toThrow(JobsApiError);
      await expect(harness.getJob("does-not-exist")).rejects.toMatchObject({
        statusCode: expect.any(Number),
      });
    } finally {
      await harness.stop();
    }
  }, 120_000);

  it("should overwrite an existing job when overwrite is true", async () => {
    await using network = await new Network().start();
    const harness = new JobsHarness({
      appId: "jobs-overwrite-app",
      network,
    });

    try {
      await harness.start();
      await harness.scheduleJob("overwrite-job", { schedule: "@every 1h" });
      await harness.scheduleJob("overwrite-job", { schedule: "@every 2h", overwrite: true });

      const job = await harness.getJob("overwrite-job");
      expect(job.schedule).toBe("@every 2h");

      await harness.deleteJob("overwrite-job");
    } finally {
      await harness.stop();
    }
  }, 120_000);

  it("should trigger the app's job handler when a due-time job fires", async () => {
    const app = express();
    app.use(bodyParser.json({ type: ["application/json", "application/*+json"] }));

    let receiver: (data?: unknown) => void;
    const triggered = new Promise((res) => {
      receiver = res;
    });

    app.post("/job/triggered-job", (req, res) => {
      console.log("Job triggered with body:", req.body);
      receiver(req.body ?? {});
      res.sendStatus(200);
    });

    const appPort = 8090;
    await using _server = app.listen(appPort);
    await TestContainers.exposeHostPorts(appPort);

    await using network = await new Network().start();
    const dapr = new DaprContainer()
      .withNetwork(network)
      .withAppName("jobs-trigger-app")
      .withAppPort(appPort)
      .withDaprLogLevel("info")
      .withAppChannelAddress("host.testcontainers.internal")
      .withWaitStrategy(
        Wait.forAll([DaprContainer.outboundHealthWaitStrategy(), Wait.forLogMessage(/Scheduler clients initialized/i)])
      );
    await using startedContainer = await dapr.start();

    const url = `${startedContainer.getHttpEndpoint()}/v1.0-alpha1/jobs/triggered-job`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueTime: "0s", data: { message: "fire" } }),
    });
    expect(response.ok).toBe(true);

    const data = await triggered;
    expect(data).toBeDefined();
  }, 300_000);
});
