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

import { Network, StartedNetwork, Wait } from "testcontainers";
import { DaprContainer, StartedDaprContainer } from "./DaprContainer";

export type JobsHarnessOptions = {
  appId?: string;
  appPort?: number;
  appChannelAddress?: string;
  daprLogLevel?: string;
  daprApiLoggingEnabled?: boolean;
  daprRuntimeImage?: string;
  network?: StartedNetwork;
};

/**
 * Options for scheduling a Dapr job via the Jobs API (`/v1.0-alpha1/jobs/{name}`).
 * At least one of `schedule` or `dueTime` must be provided.
 */
export type ScheduleJobOptions = {
  /** JSON-serializable payload delivered to the job handler. */
  data?: unknown;
  /** Cron expression (e.g. "0 0 * * * *") or period string (e.g. "@every 1h30m"). */
  schedule?: string;
  /** RFC3339 timestamp, ISO8601, or Go duration string for the first/only execution. */
  dueTime?: string;
  /** Number of times the job should repeat. */
  repeats?: number;
  /** Time-to-live / expiration for the job, expressed as an RFC3339 timestamp or duration string. */
  ttl?: string;
  /** Whether to allow overwriting an existing job with the same name. */
  overwrite?: boolean;
  /** Failure policy configuration for handling job execution failures. */
  failurePolicy?: Record<string, unknown>;
};

/**
 * Represents the details of a scheduled Dapr job, as returned by the Jobs API.
 */
export type JobDetails = {
  name: string;
  data?: unknown;
  schedule?: string;
  dueTime?: string;
  repeats?: number;
  ttl?: string;
  failurePolicy?: Record<string, unknown>;
};

/**
 * Error thrown when a Jobs API HTTP request fails with a non-successful status code.
 */
export class JobsApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "JobsApiError";
  }
}

/**
 * Provides an implementation harness for Dapr's Jobs building block,
 * mirroring the JobsHarness in the .NET SDK. The Jobs API is currently
 * alpha and only exposed over HTTP, so this harness issues requests
 * directly against the `/v1.0-alpha1/jobs` endpoints of the started
 * Dapr sidecar.
 */
export class JobsHarness {
  private network?: StartedNetwork;
  private ownsNetwork = false;
  private readonly daprContainer: DaprContainer;
  private startedDaprContainer?: StartedDaprContainer;

  constructor(private readonly options: JobsHarnessOptions = {}) {
    this.daprContainer = new DaprContainer(options.daprRuntimeImage)
      .withAppName(options.appId ?? "jobs-app")
      .withDaprLogLevel(options.daprLogLevel ?? "info")
      .withDaprApiLoggingEnabled(options.daprApiLoggingEnabled ?? false)
      .withWaitStrategy(
        Wait.forAll([DaprContainer.outboundHealthWaitStrategy(), Wait.forLogMessage(/Scheduler clients initialized/i)])
      );

    if (options.appPort) {
      this.daprContainer.withAppPort(options.appPort);
    }
    if (options.appChannelAddress) {
      this.daprContainer.withAppChannelAddress(options.appChannelAddress);
    }
  }

  public getDaprContainer(): DaprContainer {
    return this.daprContainer;
  }

  public async start(): Promise<this> {
    if (this.options.network) {
      this.network = this.options.network;
      this.ownsNetwork = false;
    } else {
      this.network = await new Network().start();
      this.ownsNetwork = true;
    }

    this.daprContainer.withNetwork(this.network);
    this.startedDaprContainer = await this.daprContainer.start();
    return this;
  }

  public async stop(): Promise<void> {
    if (this.startedDaprContainer) {
      await this.startedDaprContainer.stop();
      this.startedDaprContainer = undefined;
    }
    if (this.ownsNetwork && this.network) {
      await this.network.stop();
      this.network = undefined;
    }
  }

  public getStartedDaprContainer(): StartedDaprContainer {
    if (!this.startedDaprContainer) {
      throw new Error("JobsHarness has not been started. Call start() first.");
    }
    return this.startedDaprContainer;
  }

  public getHost(): string {
    return this.getStartedDaprContainer().getHost();
  }

  public getHttpPort(): number {
    return this.getStartedDaprContainer().getHttpPort();
  }

  public getGrpcPort(): number {
    return this.getStartedDaprContainer().getGrpcPort();
  }

  public getHttpEndpoint(): string {
    return this.getStartedDaprContainer().getHttpEndpoint();
  }

  public getGrpcEndpoint(): string {
    return this.getStartedDaprContainer().getGrpcEndpoint();
  }

  /**
   * Schedules (creates) a job by name via the Jobs API.
   * At least one of `options.schedule` or `options.dueTime` must be provided.
   *
   * @param name Name of the job.
   * @param options Job scheduling options.
   */
  public async scheduleJob(name: string, options: ScheduleJobOptions): Promise<void> {
    if (!options.schedule && !options.dueTime) {
      throw new Error("Either 'schedule' or 'dueTime' must be provided to schedule a job.");
    }

    const body: Record<string, unknown> = {};
    if (options.data !== undefined) {
      body.data = options.data;
    }
    if (options.schedule !== undefined) {
      body.schedule = options.schedule;
    }
    if (options.dueTime !== undefined) {
      body.dueTime = options.dueTime;
    }
    if (options.repeats !== undefined) {
      body.repeats = options.repeats;
    }
    if (options.ttl !== undefined) {
      body.ttl = options.ttl;
    }
    if (options.overwrite !== undefined) {
      body.overwrite = options.overwrite;
    }
    if (options.failurePolicy !== undefined) {
      body.failurePolicy = options.failurePolicy;
    }

    await this.request("POST", `/v1.0-alpha1/jobs/${encodeURIComponent(name)}`, body);
  }

  /**
   * Retrieves a scheduled job by name via the Jobs API.
   *
   * @param name Name of the job.
   * @returns The job details.
   */
  public async getJob(name: string): Promise<JobDetails> {
    const response = await this.request("GET", `/v1.0-alpha1/jobs/${encodeURIComponent(name)}`);
    return (await response.json()) as JobDetails;
  }

  /**
   * Deletes a scheduled job by name via the Jobs API.
   *
   * @param name Name of the job.
   */
  public async deleteJob(name: string): Promise<void> {
    await this.request("DELETE", `/v1.0-alpha1/jobs/${encodeURIComponent(name)}`);
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.getHttpEndpoint()}${path}`;
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }

    const maxRetries = 3;
    let response: Response | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        response = await fetch(url, init);
        if (response.ok || (response.status < 500 && response.status !== 408)) {
          return response;
        }
      } catch (err) {
        if (attempt === maxRetries - 1) {
          throw err;
        }
      }
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }

    if (!response || !response.ok) {
      const text = response ? await response.text().catch(() => "") : "";
      const status = response ? response.status : 500;
      throw new JobsApiError(`Jobs API request ${method} ${path} failed with status ${status}: ${text}`, status);
    }
    return response;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
