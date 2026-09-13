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

import { DaprWorkflowClient, WorkflowRuntime } from "@dapr/dapr";
import { Network, StartedNetwork } from "testcontainers";
import { DaprComponentNames } from "./Constants";
import { DaprContainer, StartedDaprContainer, WorkflowOptions } from "./DaprContainer";
import { RedisContainer } from "./RedisContainer";

export type WorkflowHarnessOptions = {
  appId?: string;
  appPort?: number;
  appChannelAddress?: string;
  daprLogLevel?: string;
  daprApiLoggingEnabled?: boolean;
  daprRuntimeImage?: string;
  stateStoreName?: string;
  redisContainer?: RedisContainer;
  redisHost?: string;
  network?: StartedNetwork;
};

/**
 * Provides an implementation harness for Dapr's Workflow building block,
 * mirroring the WorkflowHarness in the .NET SDK.
 */
export class WorkflowHarness {
  private network?: StartedNetwork;
  private ownsNetwork = false;
  private readonly daprContainer: DaprContainer;
  private startedDaprContainer?: StartedDaprContainer;
  private workflowClient?: DaprWorkflowClient;
  private workflowRuntime?: WorkflowRuntime;

  constructor(private readonly options: WorkflowHarnessOptions = {}) {
    const workflowOpts: WorkflowOptions = {
      stateStoreName: options.stateStoreName ?? DaprComponentNames.StateManagementComponentName,
      redisContainer: options.redisContainer,
      redisHost: options.redisHost,
      enableActorStateStore: true,
    };

    this.daprContainer = new DaprContainer(options.daprRuntimeImage)
      .withAppName(options.appId ?? "workflow-app")
      .withDaprLogLevel(options.daprLogLevel ?? "info")
      .withDaprApiLoggingEnabled(options.daprApiLoggingEnabled ?? false)
      .withWorkflow(workflowOpts);

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
    if (this.workflowRuntime) {
      try {
        await this.workflowRuntime.stop();
      } catch {
        // Ignore errors during runtime shutdown
      }
      this.workflowRuntime = undefined;
    }
    if (this.workflowClient) {
      try {
        await this.workflowClient.stop();
      } catch {
        // Ignore errors during client shutdown
      }
      this.workflowClient = undefined;
    }
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
      throw new Error("WorkflowHarness has not been started. Call start() first.");
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

  public createWorkflowClient(): DaprWorkflowClient {
    const started = this.getStartedDaprContainer();
    this.workflowClient = new DaprWorkflowClient({
      daprHost: started.getHost(),
      daprPort: started.getGrpcPort().toString(),
    });
    return this.workflowClient;
  }

  public createWorkflowRuntime(): WorkflowRuntime {
    const started = this.getStartedDaprContainer();
    this.workflowRuntime = new WorkflowRuntime({
      daprHost: started.getHost(),
      daprPort: started.getGrpcPort().toString(),
    });
    return this.workflowRuntime;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
