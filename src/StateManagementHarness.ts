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

import { CommunicationProtocolEnum, DaprClient, DaprClientOptions } from "@dapr/dapr";
import { Network, StartedNetwork } from "testcontainers";
import { DaprComponentNames } from "./Constants";
import { DaprContainer, StartedDaprContainer, StateManagementOptions } from "./DaprContainer";
import { RedisContainer } from "./RedisContainer";

export type StateManagementHarnessOptions = {
  appId?: string;
  appPort?: number;
  appChannelAddress?: string;
  daprLogLevel?: string;
  daprApiLoggingEnabled?: boolean;
  daprRuntimeImage?: string;
  stateStoreName?: string;
  redisContainer?: RedisContainer;
  redisHost?: string;
  redisPassword?: string;
  actorStateStore?: boolean;
  keyPrefix?: string;
  network?: StartedNetwork;
};

/**
 * Provides an implementation harness for Dapr's state management building block,
 * mirroring the StateManagementHarness in the .NET SDK.
 */
export class StateManagementHarness {
  private network?: StartedNetwork;
  private ownsNetwork = false;
  private readonly daprContainer: DaprContainer;
  private startedDaprContainer?: StartedDaprContainer;
  private daprClients: DaprClient[] = [];

  constructor(private readonly options: StateManagementHarnessOptions = {}) {
    const stateManagementOpts: StateManagementOptions = {
      stateStoreName: options.stateStoreName ?? DaprComponentNames.StateManagementComponentName,
      redisContainer: options.redisContainer,
      redisHost: options.redisHost,
      redisPassword: options.redisPassword,
      enableActorStateStore: options.actorStateStore ?? true,
      keyPrefix: options.keyPrefix,
    };

    this.daprContainer = new DaprContainer(options.daprRuntimeImage)
      .withAppName(options.appId ?? "statemanagement-app")
      .withDaprLogLevel(options.daprLogLevel ?? "info")
      .withDaprApiLoggingEnabled(options.daprApiLoggingEnabled ?? false)
      .withStateManagement(stateManagementOpts);

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

  public getStateStoreName(): string {
    return this.options.stateStoreName ?? DaprComponentNames.StateManagementComponentName;
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
    for (const client of this.daprClients) {
      try {
        await client.stop();
      } catch {
        // Ignore errors during client shutdown
      }
    }
    this.daprClients = [];

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
      throw new Error("StateManagementHarness has not been started. Call start() first.");
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

  public createDaprClient(clientOptions?: Partial<DaprClientOptions>): DaprClient {
    const started = this.getStartedDaprContainer();
    const protocol = clientOptions?.communicationProtocol ?? CommunicationProtocolEnum.HTTP;
    const defaultPort =
      protocol === CommunicationProtocolEnum.GRPC ? started.getGrpcPort().toString() : started.getHttpPort().toString();

    const client = new DaprClient({
      daprHost: started.getHost(),
      daprPort: defaultPort,
      communicationProtocol: protocol,
      ...clientOptions,
    });
    this.daprClients.push(client);
    return client;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
