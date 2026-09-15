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

import {
  ActorId,
  ActorProxyBuilder,
  CommunicationProtocolEnum,
  DaprClient,
  DaprClientOptions,
  DaprServer,
} from "@dapr/dapr";
import ActorRuntime from "@dapr/dapr/actors/runtime/ActorRuntime";
import { DaprServerOptions } from "@dapr/dapr/types/DaprServerOptions";
import { Network, StartedNetwork } from "testcontainers";
import { Configuration } from "./Configuration";
import { DaprComponentNames } from "./Constants";
import { ActorOptions, DaprContainer, StartedDaprContainer } from "./DaprContainer";
import { RedisContainer } from "./RedisContainer";

export type ActorClass<T> = new (...args: any[]) => T;

export type ActorHarnessOptions = {
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
  actorStateTTL?: boolean;
  keyPrefix?: string;
  network?: StartedNetwork;
  configuration?: Configuration;
};

/**
 * Provides an implementation harness for Dapr's Actor building block,
 * mirroring the ActorHarness in the .NET SDK.
 */
export class ActorHarness {
  private network?: StartedNetwork;
  private ownsNetwork = false;
  private readonly daprContainer: DaprContainer;
  private startedDaprContainer?: StartedDaprContainer;
  private daprClients: DaprClient[] = [];
  private daprServers: DaprServer[] = [];

  constructor(private readonly options: ActorHarnessOptions = {}) {
    const actorOpts: ActorOptions = {
      stateStoreName: options.stateStoreName ?? DaprComponentNames.StateManagementComponentName,
      redisContainer: options.redisContainer,
      redisHost: options.redisHost,
      redisPassword: options.redisPassword,
      enableActorStateStore: options.actorStateStore ?? true,
      actorStateTTL: options.actorStateTTL ?? true,
      keyPrefix: options.keyPrefix,
    };

    this.daprContainer = new DaprContainer(options.daprRuntimeImage)
      .withAppName(options.appId ?? "actor-app")
      .withDaprLogLevel(options.daprLogLevel ?? "info")
      .withDaprApiLoggingEnabled(options.daprApiLoggingEnabled ?? false)
      .withActors(actorOpts);

    if (options.configuration) {
      this.daprContainer.withConfiguration(options.configuration);
    }
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

    // Wire up sidecar client to any servers and the ActorRuntime instance
    const sidecarClient = this.createDaprClient();
    await sidecarClient.start();
    for (const server of this.daprServers) {
      (server as any).client = sidecarClient;
      if ((server as any).actor) {
        (server as any).actor.client = sidecarClient;
      }
      if ((server as any).daprServer) {
        (server as any).daprServer.client = (sidecarClient as any).daprClient;
      }
    }
    const actorRuntime = (ActorRuntime as any).instance;
    if (actorRuntime) {
      actorRuntime.daprClient = sidecarClient;
      if (actorRuntime.actorManagers) {
        for (const manager of actorRuntime.actorManagers.values()) {
          manager.daprClient = sidecarClient;
        }
      }
    }

    return this;
  }

  public async stop(): Promise<void> {
    if (this.startedDaprContainer) {
      try {
        await this.startedDaprContainer.stop();
      } catch {
        // Ignore errors during container shutdown
      }
      this.startedDaprContainer = undefined;
    }

    for (const server of this.daprServers) {
      try {
        await server.stop();
      } catch {
        // Ignore errors during server shutdown
      }
    }
    this.daprServers = [];

    for (const client of this.daprClients) {
      try {
        await client.stop();
      } catch {
        // Ignore errors during client shutdown
      }
    }
    this.daprClients = [];

    try {
      ActorRuntime.resetForTesting();
    } catch {
      // Ignore if not present
    }

    if (this.ownsNetwork && this.network) {
      try {
        await this.network.stop();
      } catch {
        // Ignore errors during network shutdown
      }
      this.network = undefined;
    }
  }

  public getStartedDaprContainer(): StartedDaprContainer {
    if (!this.startedDaprContainer) {
      throw new Error("ActorHarness has not been started. Call start() first.");
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

  public createDaprServer(serverOptions?: Partial<DaprServerOptions>): DaprServer {
    const requestedServerPort =
      serverOptions?.serverPort ?? (this.options.appPort ? this.options.appPort.toString() : "3001");
    const parsedServerPort = Number.parseInt(requestedServerPort, 10);
    if (Number.isNaN(parsedServerPort)) {
      throw new Error(`Invalid DaprServer port: ${requestedServerPort}`);
    }

    if (this.options.appPort !== undefined && this.options.appPort !== parsedServerPort) {
      throw new Error(
        `ActorHarness appPort (${this.options.appPort}) must match DaprServer serverPort (${parsedServerPort}).`
      );
    }

    if (this.options.appPort === undefined) {
      this.options.appPort = parsedServerPort;
      this.daprContainer.withAppPort(parsedServerPort);
    }

    const serverHost = serverOptions?.serverHost ?? "127.0.0.1";
    const protocol = serverOptions?.communicationProtocol ?? CommunicationProtocolEnum.HTTP;
    const defaultDaprPort = this.startedDaprContainer
      ? protocol === CommunicationProtocolEnum.GRPC
        ? this.startedDaprContainer.getGrpcPort().toString()
        : this.startedDaprContainer.getHttpPort().toString()
      : undefined;

    const server = new DaprServer({
      serverHost,
      serverPort: requestedServerPort,
      communicationProtocol: protocol,
      ...serverOptions,
      clientOptions: {
        ...(this.startedDaprContainer
          ? {
              daprHost: this.startedDaprContainer.getHost(),
              daprPort: defaultDaprPort,
            }
          : {}),
        communicationProtocol: protocol,
        ...serverOptions?.clientOptions,
      },
    });
    this.daprServers.push(server);
    return server;
  }

  public createActorProxyBuilder<T>(
    actorTypeClass: ActorClass<T>,
    clientOptions?: Partial<DaprClientOptions>
  ): ActorProxyBuilder<T> {
    const client = this.createDaprClient(clientOptions);
    return new ActorProxyBuilder<T>(actorTypeClass, client);
  }

  public createActorProxy<T>(
    actorTypeClass: ActorClass<T>,
    actorId: ActorId | string,
    clientOptions?: Partial<DaprClientOptions>
  ): T {
    const builder = this.createActorProxyBuilder(actorTypeClass, clientOptions);
    const id = typeof actorId === "string" ? new ActorId(actorId) : actorId;
    return builder.build(id);
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
