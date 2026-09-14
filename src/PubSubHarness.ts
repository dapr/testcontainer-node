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

import { CommunicationProtocolEnum, DaprClient, DaprClientOptions, DaprServer } from "@dapr/dapr";
import { Network, StartedNetwork } from "testcontainers";
import { DaprComponentNames } from "./Constants";
import { DaprContainer, PubSubOptions, StartedDaprContainer } from "./DaprContainer";
import { RabbitMQContainer } from "./RabbitMQContainer";
import { Subscription } from "./Subscription";

export type DaprServerOptions = ConstructorParameters<typeof DaprServer>[0];

export type PubSubHarnessOptions = {
  appId?: string;
  appPort?: number;
  appChannelAddress?: string;
  daprLogLevel?: string;
  daprApiLoggingEnabled?: boolean;
  daprRuntimeImage?: string;
  pubsubName?: string;
  rabbitMQContainer?: RabbitMQContainer;
  rabbitMQHost?: string;
  username?: string;
  password?: string;
  protocol?: string;
  requeueInFailure?: boolean;
  subscriptions?: Subscription[];
  network?: StartedNetwork;
};

/**
 * Provides an implementation harness for Dapr's pub/sub building block,
 * mirroring the PubSubHarness in the .NET SDK.
 */
export class PubSubHarness {
  private network?: StartedNetwork;
  private ownsNetwork = false;
  private readonly daprContainer: DaprContainer;
  private startedDaprContainer?: StartedDaprContainer;
  private daprClients: DaprClient[] = [];
  private daprServers: DaprServer[] = [];

  constructor(private readonly options: PubSubHarnessOptions = {}) {
    const pubsubOpts: PubSubOptions = {
      pubsubName: options.pubsubName ?? DaprComponentNames.PubSubComponentName,
      rabbitMQContainer: options.rabbitMQContainer,
      rabbitMQHost: options.rabbitMQHost,
      username: options.username,
      password: options.password,
      protocol: options.protocol,
      requeueInFailure: options.requeueInFailure,
    };

    this.daprContainer = new DaprContainer(options.daprRuntimeImage)
      .withAppName(options.appId ?? "pubsub-app")
      .withDaprLogLevel(options.daprLogLevel ?? "info")
      .withDaprApiLoggingEnabled(options.daprApiLoggingEnabled ?? false)
      .withPubSub(pubsubOpts);

    if (options.appPort) {
      this.daprContainer.withAppPort(options.appPort);
    }
    if (options.appChannelAddress) {
      this.daprContainer.withAppChannelAddress(options.appChannelAddress);
    }
    if (options.subscriptions) {
      for (const sub of options.subscriptions) {
        this.daprContainer.withSubscription(sub);
      }
    }
  }

  public getDaprContainer(): DaprContainer {
    return this.daprContainer;
  }

  public getPubSubName(): string {
    return this.options.pubsubName ?? DaprComponentNames.PubSubComponentName;
  }

  public getPubsubName(): string {
    return this.getPubSubName();
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
      throw new Error("PubSubHarness has not been started. Call start() first.");
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

  public createDaprServer(serverOptions?: DaprServerOptions): DaprServer {
    const started = this.getStartedDaprContainer();
    const protocol = serverOptions?.communicationProtocol ?? CommunicationProtocolEnum.HTTP;
    const defaultPort =
      protocol === CommunicationProtocolEnum.GRPC ? started.getGrpcPort().toString() : started.getHttpPort().toString();

    const server = new DaprServer({
      serverHost: serverOptions?.serverHost ?? "127.0.0.1",
      serverPort: serverOptions?.serverPort ?? (this.options.appPort ? this.options.appPort.toString() : "3001"),
      communicationProtocol: protocol,
      ...serverOptions,
      clientOptions: {
        daprHost: started.getHost(),
        daprPort: defaultPort,
        communicationProtocol: protocol,
        ...serverOptions?.clientOptions,
      },
    });
    this.daprServers.push(server);
    return server;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
