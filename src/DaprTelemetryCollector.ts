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

import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { log } from "testcontainers";

export type ZipkinEndpoint = {
  serviceName?: string;
  ipv4?: string;
  ipv6?: string;
  port?: number;
};

/** A Zipkin v2 span exported by daprd. Timestamps and durations are in microseconds. */
export type ZipkinSpan = {
  traceId: string;
  id: string;
  parentId?: string;
  name?: string;
  kind?: string;
  timestamp?: number;
  duration?: number;
  localEndpoint?: ZipkinEndpoint;
  remoteEndpoint?: ZipkinEndpoint;
  tags?: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEndpoint(value: unknown): value is ZipkinEndpoint {
  return (
    isRecord(value) &&
    ["serviceName", "ipv4", "ipv6"].every((key) => value[key] === undefined || typeof value[key] === "string") &&
    (value.port === undefined ||
      (typeof value.port === "number" && Number.isInteger(value.port) && value.port >= 0 && value.port <= 65535))
  );
}

function isZipkinSpan(value: unknown): value is ZipkinSpan {
  return (
    isRecord(value) &&
    typeof value.traceId === "string" &&
    /^(?:[0-9a-f]{16}|[0-9a-f]{32})$/i.test(value.traceId) &&
    typeof value.id === "string" &&
    /^[0-9a-f]{16}$/i.test(value.id) &&
    (value.parentId === undefined || (typeof value.parentId === "string" && /^[0-9a-f]{16}$/i.test(value.parentId))) &&
    ["name", "kind"].every((key) => value[key] === undefined || typeof value[key] === "string") &&
    ["timestamp", "duration"].every(
      (key) =>
        value[key] === undefined ||
        (typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] >= 0)
    ) &&
    (value.localEndpoint === undefined || isEndpoint(value.localEndpoint)) &&
    (value.remoteEndpoint === undefined || isEndpoint(value.remoteEndpoint)) &&
    (value.tags === undefined ||
      (isRecord(value.tags) && Object.values(value.tags).every((tag) => typeof tag === "string")))
  );
}

/**
 * In-process Zipkin v2 receiver for Dapr runtime tracing. No external collector is required.
 * Host ports are exposed to Docker automatically when used with DaprContainer.withTelemetryCapture().
 */
export class DaprTelemetryCollector {
  private readonly spans: ZipkinSpan[] = [];
  private server?: Server;
  private starting?: Promise<this>;
  private stopping?: Promise<void>;

  /** Use port 0 (the default) to bind an available port atomically. */
  constructor(private readonly port = 0) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error("Telemetry collector port must be an integer between 0 and 65535.");
    }
  }

  public getPort(): number {
    const address = this.server?.address();
    if (!address || typeof address === "string") {
      throw new Error("DaprTelemetryCollector has not been started. Call start() first.");
    }
    return address.port;
  }

  public getZipkinEndpointAddress(): string {
    return `http://127.0.0.1:${this.getPort()}/api/v2/spans`;
  }

  public getZipkinEndpointAddressForDapr(): string {
    return `http://host.testcontainers.internal:${this.getPort()}/api/v2/spans`;
  }

  /** Returns a snapshot that can be filtered or modified without changing captured spans. */
  public getZipkinSpans(): ZipkinSpan[] {
    return structuredClone(this.spans);
  }

  public async start(): Promise<this> {
    await this.stopping;
    if (this.starting) {
      return this.starting;
    }
    if (this.server?.listening) {
      return this;
    }
    const server = createServer((request, response) => {
      void this.receive(request, response).catch((error: unknown) => {
        log.error(`Telemetry collector request failed: ${String(error)}`);
        if (!response.destroyed) {
          response.writeHead(500).end("Telemetry collector request failed.");
        }
      });
    });
    this.server = server;
    this.starting = new Promise<this>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, "0.0.0.0", () => {
        server.removeListener("error", reject);
        resolve(this);
      });
    });
    try {
      return await this.starting;
    } catch (error) {
      this.server = undefined;
      throw error;
    } finally {
      this.starting = undefined;
    }
  }

  public async stop(): Promise<void> {
    await this.starting;
    if (this.stopping) {
      return this.stopping;
    }
    const server = this.server;
    if (!server) {
      return;
    }
    this.server = undefined;
    this.stopping = new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    try {
      await this.stopping;
    } finally {
      this.stopping = undefined;
    }
  }

  /** Waits for an existing or future matching span; timeoutMs is in milliseconds. */
  public async waitForZipkinSpan(
    predicate: (span: ZipkinSpan) => boolean,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<ZipkinSpan> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error("Telemetry timeout must be a finite, non-negative number of milliseconds.");
    }
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      signal?.throwIfAborted();
      const span = this.getZipkinSpans().find(predicate);
      if (span) {
        return span;
      }
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        const diagnostics = this.spans
          .slice(0, 10)
          .map((item) => `${item.traceId}/${item.name ?? ""}/${item.kind ?? ""}`)
          .join(", ");
        throw new Error(
          `Telemetry condition was not satisfied within ${timeoutMs}ms. ` +
            `Captured Zipkin spans: ${this.spans.length}; spans: ${diagnostics}`
        );
      }
      if (!this.server?.listening) {
        throw new Error("Telemetry collector is not running.");
      }
      await delay(Math.min(100, remaining), undefined, { signal });
    }
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }

  private async receive(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.url !== "/api/v2/spans") {
      response.writeHead(404).end("Not found.");
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end("Use POST to export spans.");
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 4 * 1024 * 1024) {
        response.writeHead(413).end("Telemetry payload exceeds 4 MiB.");
        return;
      }
      chunks.push(buffer);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      response.writeHead(400).end("Invalid Zipkin JSON.");
      return;
    }
    if (!Array.isArray(payload) || !payload.every(isZipkinSpan)) {
      response.writeHead(400).end("Expected an array of Zipkin v2 spans.");
      return;
    }
    for (const span of payload) {
      this.spans.push(span);
    }
    response.writeHead(202).end();
  }
}
