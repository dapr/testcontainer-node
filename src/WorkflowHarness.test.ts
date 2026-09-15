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

import { TWorkflow, WorkflowActivityContext, WorkflowContext, WorkflowRuntimeStatus } from "@dapr/dapr";
import { Network } from "testcontainers";
import { DaprComponentNames } from "./Constants";
import { DaprContainer } from "./DaprContainer";
import { RedisContainer } from "./RedisContainer";
import { WorkflowHarness } from "./WorkflowHarness";

const helloActivity = async (_ctx: WorkflowActivityContext, name: string): Promise<string> => {
  return `Hello, ${name}!`;
};

const helloWorkflow: TWorkflow = async function* (
  ctx: WorkflowContext,
  input: string
): AsyncGenerator<unknown, string, string> {
  const result = (yield ctx.callActivity(helloActivity, input)) as string;
  return result;
};

const waitForWorkflowWorker = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10_000));

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number, description: string): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${description} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

describe("WorkflowHarness and Workflow Support", () => {
  it("should configure DaprContainer with workflow and redis state store", () => {
    const dapr = new DaprContainer().withWorkflow({
      stateStoreName: "custom-state",
    });

    expect(dapr.isWorkflowEnabled()).toBe(true);
    const components = dapr.getComponents();
    // Initially components are populated during beforeContainerCreated or withComponent
    expect(components).toEqual([]);
  });

  it("should configure WorkflowHarness with default options", () => {
    const harness = new WorkflowHarness();
    const dapr = harness.getDaprContainer();
    expect(dapr.isWorkflowEnabled()).toBe(true);
    expect(dapr.getAppName()).toBe("workflow-app");
  });

  it("should configure WorkflowHarness with custom options", () => {
    const customRedis = new RedisContainer();
    const harness = new WorkflowHarness({
      appId: "custom-app",
      appPort: 9000,
      daprLogLevel: "debug",
      redisContainer: customRedis,
      stateStoreName: "workflow-state",
    });

    const dapr = harness.getDaprContainer();
    expect(dapr.isWorkflowEnabled()).toBe(true);
    expect(dapr.getAppName()).toBe("custom-app");
    expect(dapr.getAppPort()).toBe(9000);
    expect(dapr.getRedisContainer()).toBe(customRedis);
  });

  it("should run a workflow end-to-end using WorkflowHarness", async () => {
    await using network = await new Network().start();
    const harness = new WorkflowHarness({
      appId: "workflow-test-app",
      daprLogLevel: "info",
      network,
    });

    try {
      await harness.start();

      const runtime = harness.createWorkflowRuntime();
      runtime.registerWorkflow(helloWorkflow);
      runtime.registerActivity(helloActivity);
      await runtime.start();
      // WorkflowRuntime starts its gRPC worker in the background.
      await waitForWorkflowWorker();

      const client = harness.createWorkflowClient();
      const instanceId = await withTimeout(
        client.scheduleNewWorkflow(helloWorkflow, "World"),
        60_000,
        "Scheduling workflow"
      );
      const state = await client.waitForWorkflowCompletion(instanceId, undefined, 60);

      expect(state).toBeDefined();
      expect(state?.runtimeStatus).toBe(WorkflowRuntimeStatus.COMPLETED);
      expect(state?.serializedOutput).toBe(JSON.stringify("Hello, World!"));
    } finally {
      await harness.stop();
    }
  }, 180_000);

  it("should run a workflow end-to-end using DaprContainer directly", async () => {
    await using network = await new Network().start();
    const dapr = new DaprContainer()
      .withNetwork(network)
      .withAppName("dapr-workflow-direct-app")
      .withDaprLogLevel("info")
      .withWorkflow({
        stateStoreName: DaprComponentNames.StateManagementComponentName,
      });

    await using startedContainer = await dapr.start();

    const runtime = new (await import("@dapr/dapr")).WorkflowRuntime({
      daprHost: startedContainer.getHost(),
      daprPort: startedContainer.getGrpcPort().toString(),
    });
    runtime.registerWorkflow(helloWorkflow);
    runtime.registerActivity(helloActivity);
    await runtime.start();
    // WorkflowRuntime starts its gRPC worker in the background.
    await waitForWorkflowWorker();

    const client = new (await import("@dapr/dapr")).DaprWorkflowClient({
      daprHost: startedContainer.getHost(),
      daprPort: startedContainer.getGrpcPort().toString(),
    });

    try {
      const instanceId = await withTimeout(
        client.scheduleNewWorkflow(helloWorkflow, "Dapr Node"),
        60_000,
        "Scheduling workflow"
      );
      const state = await client.waitForWorkflowCompletion(instanceId, undefined, 60);

      expect(state).toBeDefined();
      expect(state?.runtimeStatus).toBe(WorkflowRuntimeStatus.COMPLETED);
      expect(state?.serializedOutput).toBe(JSON.stringify("Hello, Dapr Node!"));
    } finally {
      await client.stop();
      await runtime.stop();
    }
  }, 180_000);
});
