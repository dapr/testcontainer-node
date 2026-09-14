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
import { LockStatus, UnlockResponse } from "@dapr/dapr/types/lock/UnlockResponse";
import { LockResponse } from "@dapr/dapr/types/lock/LockResponse";
import { Network, StartedNetwork } from "testcontainers";
import { DaprComponentNames } from "./Constants";
import { DaprContainer, DistributedLockOptions, StartedDaprContainer } from "./DaprContainer";
import { RedisContainer } from "./RedisContainer";

export { LockStatus, LockResponse, UnlockResponse };

export type DistributedLockHarnessOptions = {
  appId?: string;
  appPort?: number;
  appChannelAddress?: string;
  daprLogLevel?: string;
  daprApiLoggingEnabled?: boolean;
  daprRuntimeImage?: string;
  lockStoreName?: string;
  redisContainer?: RedisContainer;
  redisHost?: string;
  redisPassword?: string;
  network?: StartedNetwork;
};

/**
 * Provides an implementation harness for Dapr's distributed lock building block,
 * mirroring the DistributedLockHarness in the .NET SDK.
 */
export class DistributedLockHarness {
  public static readonly DistributedLockComponentName: string = DaprComponentNames.DistributedLockComponentName;

  private network?: StartedNetwork;
  private ownsNetwork = false;
  private readonly daprContainer: DaprContainer;
  private startedDaprContainer?: StartedDaprContainer;
  private daprClients: DaprClient[] = [];

  constructor(private readonly options: DistributedLockHarnessOptions = {}) {
    const lockOpts: DistributedLockOptions = {
      lockStoreName: options.lockStoreName ?? DaprComponentNames.DistributedLockComponentName,
      redisContainer: options.redisContainer,
      redisHost: options.redisHost,
      redisPassword: options.redisPassword,
    };

    this.daprContainer = new DaprContainer(options.daprRuntimeImage)
      .withAppName(options.appId ?? "distributed-lock-app")
      .withDaprLogLevel(options.daprLogLevel ?? "info")
      .withDaprApiLoggingEnabled(options.daprApiLoggingEnabled ?? false)
      .withDistributedLock(lockOpts);

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
    try {
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
    } catch (error) {
      if (this.ownsNetwork && this.network) {
        await this.network.stop();
        this.network = undefined;
        this.ownsNetwork = false;
      }
      throw error;
    }
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
      this.ownsNetwork = false;
    }
  }

  public getStartedDaprContainer(): StartedDaprContainer {
    if (!this.startedDaprContainer) {
      throw new Error("DistributedLockHarness has not been started. Call start() first.");
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
    const daprPort =
      clientOptions?.daprPort ??
      (clientOptions?.communicationProtocol === CommunicationProtocolEnum.GRPC
        ? started.getGrpcPort().toString()
        : started.getHttpPort().toString());
    const client = new DaprClient({
      daprHost: started.getHost(),
      ...clientOptions,
      daprPort,
    });
    this.daprClients.push(client);
    return client;
  }

  public createClient(clientOptions?: Partial<DaprClientOptions>): DaprClient {
    return this.createDaprClient(clientOptions);
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
