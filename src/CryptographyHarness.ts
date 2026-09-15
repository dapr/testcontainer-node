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

import fs from "node:fs";
import path from "node:path";
import { CommunicationProtocolEnum, DaprClient } from "@dapr/dapr";
import { Network, StartedNetwork } from "testcontainers";
import { DaprComponentNames } from "./Constants";
import { DaprContainer, StartedDaprContainer } from "./DaprContainer";
import { DEFAULT_CRYPTOGRAPHY_KEYS_PATH, LocalStorageCryptographyContainer } from "./LocalStorageCryptographyContainer";

export type CryptographyHarnessOptions = {
  keyPath: string;
  appId?: string;
  appChannelAddress?: string;
  componentName?: string;
  containerKeyPath?: string;
  daprLogLevel?: string;
  daprApiLoggingEnabled?: boolean;
  daprRuntimeImage?: string;
  network?: StartedNetwork;
};

/**
 * Provides an implementation harness for Dapr's cryptography building block
 * using the local-storage cryptography component.
 */
export class CryptographyHarness {
  private network?: StartedNetwork;
  private ownsNetwork = false;
  private readonly hostKeyPath: string;
  private readonly containerKeyPath: string;
  private readonly componentName: string;
  private readonly daprContainer: DaprContainer;
  private startedDaprContainer?: StartedDaprContainer;
  private daprClient?: DaprClient;

  constructor(private readonly options: CryptographyHarnessOptions) {
    this.hostKeyPath = path.resolve(options.keyPath);
    this.containerKeyPath = options.containerKeyPath ?? DEFAULT_CRYPTOGRAPHY_KEYS_PATH;
    this.componentName = options.componentName ?? DaprComponentNames.CryptographyComponentName;

    const keyPathStat = fs.statSync(this.hostKeyPath, { throwIfNoEntry: false });
    if (!keyPathStat?.isDirectory()) {
      throw new Error(`Cryptography key path must be an existing directory: ${this.hostKeyPath}`);
    }
    if (!path.posix.isAbsolute(this.containerKeyPath)) {
      throw new Error(`Cryptography container key path must be absolute: ${this.containerKeyPath}`);
    }

    const component = LocalStorageCryptographyContainer.createComponent({
      name: this.componentName,
      keyPath: this.containerKeyPath,
    });

    this.daprContainer = new DaprContainer(options.daprRuntimeImage)
      .withAppName(options.appId ?? "cryptography-app")
      .withDaprLogLevel(options.daprLogLevel ?? "info")
      .withDaprApiLoggingEnabled(options.daprApiLoggingEnabled ?? false)
      .withComponent(component)
      .withCopyDirectoriesToContainer([{ source: this.hostKeyPath, target: this.containerKeyPath }]);

    if (options.appChannelAddress) {
      this.daprContainer.withAppChannelAddress(options.appChannelAddress);
    }
  }

  public getDaprContainer(): DaprContainer {
    return this.daprContainer;
  }

  public getKeyPath(): string {
    return this.hostKeyPath;
  }

  public getContainerKeyPath(): string {
    return this.containerKeyPath;
  }

  public getComponentName(): string {
    return this.componentName;
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
    if (this.daprClient) {
      await this.daprClient.stop();
      this.daprClient = undefined;
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
      throw new Error("CryptographyHarness has not been started. Call start() first.");
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

  public createDaprClient(): DaprClient {
    const started = this.getStartedDaprContainer();
    if (this.daprClient) {
      return this.daprClient;
    }

    this.daprClient = new DaprClient({
      daprHost: started.getHost(),
      daprPort: started.getGrpcPort().toString(),
      communicationProtocol: CommunicationProtocolEnum.GRPC,
    });
    return this.daprClient;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
