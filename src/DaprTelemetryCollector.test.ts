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

import { DaprTelemetryCollector, ZipkinSpan } from "./DaprTelemetryCollector";

const span: ZipkinSpan = {
  traceId: "0123456789abcdef0123456789abcdef",
  id: "0123456789abcdef",
  parentId: "abcdef0123456789",
  name: "workflow",
  kind: "SERVER",
  timestamp: 1790000000000000,
  duration: 1234,
  localEndpoint: { serviceName: "workflow-app", ipv4: "127.0.0.1", port: 3500 },
  remoteEndpoint: { ipv6: "::1" },
  tags: { "dapr.workflow.instance_id": "instance-1" },
};

async function post(collector: DaprTelemetryCollector, body: string): Promise<Response> {
  return fetch(collector.getZipkinEndpointAddress(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("DaprTelemetryCollector", () => {
  it("captures multiple batches and returns independent snapshots", async () => {
    await using collector = await new DaprTelemetryCollector().start();
    expect(collector.getZipkinEndpointAddressForDapr()).toBe(
      `http://host.testcontainers.internal:${collector.getPort()}/api/v2/spans`
    );
    expect((await post(collector, JSON.stringify([span]))).status).toBe(202);
    expect((await post(collector, JSON.stringify([{ ...span, name: "activity" }]))).status).toBe(202);
    expect(collector.getZipkinSpans()).toEqual([span, { ...span, name: "activity" }]);

    const snapshot = collector.getZipkinSpans();
    snapshot[0].tags = { changed: "true" };
    snapshot[0].localEndpoint!.serviceName = "changed";
    snapshot.pop();
    expect(collector.getZipkinSpans()).toEqual([span, { ...span, name: "activity" }]);
    await expect(collector.waitForZipkinSpan((item) => item.name === "activity", 0)).resolves.toMatchObject({
      name: "activity",
    });
  });

  it("waits for a future matching span, ignoring unrelated spans", async () => {
    await using collector = await new DaprTelemetryCollector().start();
    const waiting = collector.waitForZipkinSpan((item) => item.name === "activity", 2000);
    await post(collector, JSON.stringify([span]));
    await post(collector, JSON.stringify([{ ...span, name: "activity" }]));
    await expect(waiting).resolves.toMatchObject({ name: "activity", traceId: span.traceId });
  });

  it("includes captured span details in timeout errors", async () => {
    await using collector = await new DaprTelemetryCollector().start();
    await post(collector, JSON.stringify([span]));
    await expect(collector.waitForZipkinSpan(() => false, 20)).rejects.toThrow(
      `Captured Zipkin spans: 1; spans: ${span.traceId}/workflow/SERVER`
    );
  });

  it("supports cancellation before and during a wait", async () => {
    await using collector = await new DaprTelemetryCollector().start();
    const controller = new AbortController();
    const waiting = collector.waitForZipkinSpan(() => false, 60_000, controller.signal);
    const rejected = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    await expect(collector.waitForZipkinSpan(() => true, 60_000, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("propagates predicate failures", async () => {
    await using collector = await new DaprTelemetryCollector().start();
    await post(collector, JSON.stringify([span]));
    await expect(
      collector.waitForZipkinSpan(() => {
        throw new Error("predicate failed");
      }, 1000)
    ).rejects.toThrow("predicate failed");
  });

  it.each([
    "{",
    "null",
    "{}",
    "[null]",
    JSON.stringify([span, { id: "bad" }]),
    JSON.stringify([{ ...span, traceId: "bad" }]),
    JSON.stringify([{ ...span, tags: { number: 1 } }]),
    JSON.stringify([{ ...span, localEndpoint: { port: -1 } }]),
    JSON.stringify([{ ...span, duration: "123" }]),
  ])("rejects invalid payloads atomically: %s", async (body) => {
    await using collector = await new DaprTelemetryCollector().start();
    const response = await post(collector, body);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toBe("");
    expect(collector.getZipkinSpans()).toEqual([]);
    expect((await post(collector, JSON.stringify([span]))).status).toBe(202);
  });

  it("accepts empty batches and rejects unknown routes and methods", async () => {
    await using collector = await new DaprTelemetryCollector().start();
    expect((await post(collector, "[]")).status).toBe(202);
    const response = await fetch(collector.getZipkinEndpointAddress());
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect((await fetch(`http://127.0.0.1:${collector.getPort()}/other`)).status).toBe(404);
  });

  it("bounds request size", async () => {
    await using collector = await new DaprTelemetryCollector().start();
    expect((await post(collector, " ".repeat(4 * 1024 * 1024 + 1))).status).toBe(413);
    expect(collector.getZipkinSpans()).toEqual([]);
  });

  it("starts and stops idempotently, releases its port, and preserves captured spans", async () => {
    const collector = new DaprTelemetryCollector();
    expect(() => collector.getPort()).toThrow("has not been started");
    await collector.stop();
    await Promise.all([collector.start(), collector.start()]);
    const port = collector.getPort();
    expect(await collector.start()).toBe(collector);
    expect(collector.getPort()).toBe(port);
    await post(collector, JSON.stringify([span]));
    await Promise.all([collector.stop(), collector.stop()]);
    expect(() => collector.getPort()).toThrow("has not been started");
    expect(collector.getZipkinSpans()).toEqual([span]);
    await using replacement = await new DaprTelemetryCollector(port).start();
    expect(replacement.getPort()).toBe(port);
  });

  it("surfaces bind failures and permits retrying", async () => {
    const first = await new DaprTelemetryCollector().start();
    await using second = new DaprTelemetryCollector(first.getPort());
    try {
      await expect(second.start()).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await first.stop();
    }
    await second.start();
    expect((await post(second, "[]")).status).toBe(202);
  });

  it("terminates pending waits when stopped", async () => {
    const collector = await new DaprTelemetryCollector().start();
    const waiting = expect(collector.waitForZipkinSpan(() => false, 60_000)).rejects.toThrow("not running");
    await collector.stop();
    await waiting;
  });

  it.each([-1, 65536, 1.5, NaN, Infinity])("rejects invalid port %s", (port) => {
    expect(() => new DaprTelemetryCollector(port)).toThrow("port must be an integer");
  });

  it.each([-1, NaN, Infinity])("rejects invalid timeout %s", async (timeout) => {
    await expect(new DaprTelemetryCollector().waitForZipkinSpan(() => false, timeout)).rejects.toThrow(
      "timeout must be a finite"
    );
  });
});
