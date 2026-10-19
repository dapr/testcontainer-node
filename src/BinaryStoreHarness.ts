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
import { BinaryStoreOptions, DaprContainer, StartedDaprContainer } from "./DaprContainer";

export type BinaryStoreHarnessOptions = BinaryStoreOptions & {
  appId?: string;
  appPort?: number;
  appChannelAddress?: string;
  daprLogLevel?: string;
  daprApiLoggingEnabled?: boolean;
  daprRuntimeImage?: string;
  network?: StartedNetwork;
};

/**
 * Tests Dapr's Binary Store building block using process-local, non-persistent storage.
 */
export class BinaryStoreHarness {
  private network?: StartedNetwork;
  private ownsNetwork = false;
  private readonly daprContainer: DaprContainer;
  private readonly binaryStoreName: string;
  private startedDaprContainer?: StartedDaprContainer;
  private daprClients: DaprClient[] = [];

  constructor(private readonly options: BinaryStoreHarnessOptions = {}) {
    this.binaryStoreName = options.binaryStoreName ?? DaprComponentNames.BinaryStoreComponentName;
    this.daprContainer = new DaprContainer(options.daprRuntimeImage)
      .withAppName(options.appId ?? "binarystore-app")
      .withDaprLogLevel(options.daprLogLevel ?? "info")
      .withDaprApiLoggingEnabled(options.daprApiLoggingEnabled ?? false)
      .withBinaryStore(options);

    if (options.appPort !== undefined) {
      this.daprContainer.withAppPort(options.appPort);
    }
    if (options.appChannelAddress) {
      this.daprContainer.withAppChannelAddress(options.appChannelAddress);
    }
  }

  public getDaprContainer(): DaprContainer {
    return this.daprContainer;
  }

  public getBinaryStoreName(): string {
    return this.binaryStoreName;
  }

  public getStartedDaprContainer(): StartedDaprContainer {
    if (!this.startedDaprContainer) {
      throw new Error("BinaryStoreHarness has not been started. Call start() first.");
    }
    return this.startedDaprContainer;
  }

  public async start(): Promise<this> {
    if (this.startedDaprContainer) {
      return this;
    }
    this.network = this.options.network ?? (await new Network().start());
    this.ownsNetwork = this.options.network === undefined;
    this.daprContainer.withNetwork(this.network);
    try {
      this.startedDaprContainer = await this.daprContainer.start();
    } catch (error) {
      await this.stop();
      throw error;
    }
    return this;
  }

  public async stop(): Promise<void> {
    try {
      try {
        await Promise.all(this.daprClients.map((client) => client.stop()));
      } finally {
        this.daprClients = [];
        if (this.startedDaprContainer) {
          await this.startedDaprContainer.stop();
          this.startedDaprContainer = undefined;
        }
      }
    } finally {
      if (this.ownsNetwork && this.network) {
        await this.network.stop();
        this.network = undefined;
      }
    }
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
    const client = new DaprClient({
      daprHost: started.getHost(),
      daprPort: (protocol === CommunicationProtocolEnum.GRPC
        ? started.getGrpcPort()
        : started.getHttpPort()
      ).toString(),
      communicationProtocol: protocol,
      ...clientOptions,
    });
    this.daprClients.push(client);
    return client;
  }

  /** Uses PUT to replace existing files, or POST to fail if a file already exists. */
  public async setBinaryFile(fileName: string, data: Uint8Array, overwrite = true): Promise<void> {
    await this.request(fileName, {
      method: overwrite ? "PUT" : "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(data),
    });
  }

  public async getBinaryFile(fileName: string): Promise<Buffer> {
    const response = await this.request(fileName, { method: "GET" });
    return Buffer.from(await response.arrayBuffer());
  }

  public async deleteBinaryFile(fileName: string): Promise<void> {
    await this.request(fileName, { method: "DELETE" });
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }

  private async request(fileName: string, init: RequestInit): Promise<Response> {
    const endpoint = this.getHttpEndpoint();
    if (
      !fileName.trim() ||
      /[\\*?[\]#]/.test(fileName) ||
      fileName.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new Error("Binary file name must be non-empty and must not contain invalid characters or path segments.");
    }
    // The Node SDK does not yet expose the Binary Store API.
    const response = await fetch(
      `${endpoint}/v1.0-alpha1/binarystore/${encodeURIComponent(this.binaryStoreName)}/${encodeURIComponent(fileName)}`,
      init
    );
    if (!response.ok) {
      throw new Error(`Binary store ${init.method} request failed (${response.status}): ${await response.text()}`);
    }
    return response;
  }
}
