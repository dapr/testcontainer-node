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

import YAML from "yaml";
import { Network, TestContainers } from "testcontainers";
import {
  AppHttpPipeline,
  Configuration,
  OtelTracingConfigurationSettings,
  TracingConfigurationSettings,
  ZipkinTracingConfigurationSettings,
} from "./Configuration";
import { DaprContainer } from "./DaprContainer";
import { DaprPlacementContainer } from "./DaprPlacementContainer";
import { DaprSchedulerContainer } from "./DaprSchedulerContainer";
import { WorkflowHarness } from "./WorkflowHarness";

class PreparedDaprContainer extends DaprContainer {
  public prepare(): Promise<void> {
    return this.beforeContainerCreated();
  }
}

describe("Telemetry capture configuration", () => {
  it("is opt-in and enabling it repeatedly preserves the collector", () => {
    const harness = new WorkflowHarness();
    expect(harness.getTelemetryCollector()).toBeUndefined();
    expect(harness.enableTelemetryCapture()).toBe(harness);
    const collector = harness.getTelemetryCollector();
    expect(collector).toBeDefined();
    expect(harness.enableTelemetryCapture().getTelemetryCollector()).toBe(collector);
    expect(harness.getDaprContainer().getTelemetryCollector()).toBe(collector);
    expect(new WorkflowHarness({ telemetryCapture: true }).getTelemetryCollector()).toBeDefined();
  });

  it.each([false, true])("preserves custom configuration with capture enabled first: %s", async (captureFirst) => {
    const dapr = new PreparedDaprContainer()
      .withPlacementContainer(new DaprPlacementContainer())
      .withSchedulerContainer(new DaprSchedulerContainer());
    const original = new Configuration(
      "custom",
      new TracingConfigurationSettings(
        "0.25",
        true,
        new OtelTracingConfigurationSettings("otel:4317", false, "grpc"),
        new ZipkinTracingConfigurationSettings("http://original/api/v2/spans")
      ),
      new AppHttpPipeline([{ name: "middleware", type: "middleware.http.uppercase" }]),
      [{ name: "ActorStateTTL", enabled: true }]
    );
    if (captureFirst) {
      dapr.withTelemetryCapture();
    }
    dapr.withConfiguration(original).withTelemetryCapture();
    await using collector = await dapr.getTelemetryCollector()!.start();
    const copy = jest.spyOn(dapr, "withCopyContentToContainer");
    const command = jest.spyOn(dapr, "withCommand");
    await dapr.prepare();
    const configurationCopy = copy.mock.calls
      .flatMap(([contents]) => contents)
      .find((entry) => entry.target === "/dapr-resources/custom.yaml");
    expect(configurationCopy).toBeDefined();
    const config = YAML.parse(configurationCopy!.content.toString());
    expect(config.spec).toEqual({
      tracing: {
        samplingRate: "1",
        stdout: true,
        otel: original.tracing?.otel,
        zipkin: { endpointAddress: collector.getZipkinEndpointAddressForDapr() },
      },
      appHttpPipeline: original.appHttpPipeline,
      features: original.features,
    });
    expect(command).toHaveBeenCalledWith(expect.arrayContaining(["--config", "/dapr-resources/custom.yaml"]));
    expect(dapr.getConfiguration()).toBe(original);
    expect(original.tracing?.samplingRate).toBe("0.25");
    expect(original.tracing?.zipkin?.endpointAddress).toBe("http://original/api/v2/spans");
  });

  it("preserves implicit actor features", async () => {
    const dapr = new PreparedDaprContainer()
      .withPlacementContainer(new DaprPlacementContainer())
      .withSchedulerContainer(new DaprSchedulerContainer())
      .withActors()
      .withTelemetryCapture();
    await using _collector = await dapr.getTelemetryCollector()!.start();
    const copy = jest.spyOn(dapr, "withCopyContentToContainer");
    await dapr.prepare();
    const config = copy.mock.calls
      .flatMap(([contents]) => contents)
      .find((entry) => entry.target === "/dapr-resources/actorConfig.yaml");
    expect(YAML.parse(config!.content.toString()).spec.features).toEqual([{ name: "ActorStateTTL", enabled: true }]);
  });

  it("captures runtime spans with propagated trace IDs and stops the receiver with the sidecar", async () => {
    await using network = await new Network().start();
    const dapr = new DaprContainer().withNetwork(network).withTelemetryCapture();
    const started = await dapr.start();
    const collector = started.getTelemetryCollector()!;
    try {
      expect(collector).toBe(dapr.getTelemetryCollector());
      const response = await fetch(`${started.getHttpEndpoint()}/v1.0/state/kvstore/key`, {
        headers: { traceparent: "00-0123456789abcdef0123456789abcdef-abcdef0123456789-01" },
      });
      expect(response.ok).toBe(true);
      const span = await collector.waitForZipkinSpan(
        (item) => item.traceId === "0123456789abcdef0123456789abcdef",
        30_000
      );
      expect(span.parentId).toBe("abcdef0123456789");
      expect(span.localEndpoint?.serviceName).toBe("dapr-app");
      expect(span.id).toMatch(/^[0-9a-f]{16}$/);
      expect(span.duration).toBeGreaterThanOrEqual(0);
    } finally {
      await started.stop();
    }
    expect(() => collector.getPort()).toThrow("has not been started");
    expect(collector.getZipkinSpans().length).toBeGreaterThan(0);
  }, 120_000);

  it("cleans up capture on startup failure", async () => {
    await using network = await new Network().start();
    const dapr = new DaprContainer().withNetwork(network).withTelemetryCapture();
    const expose = jest.spyOn(TestContainers, "exposeHostPorts").mockRejectedValue(new Error("port forwarding failed"));
    try {
      await expect(dapr.start()).rejects.toThrow("port forwarding failed");
      expect(expose).toHaveBeenCalled();
      expect(() => dapr.getTelemetryCollector()!.getPort()).toThrow("has not been started");
    } finally {
      expose.mockRestore();
    }
  }, 120_000);
});
