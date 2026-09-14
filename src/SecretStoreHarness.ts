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

import { CommunicationProtocolEnum, DaprClient } from "@dapr/dapr";
import { Network, StartedNetwork } from "testcontainers";
import { DaprContainer, StartedDaprContainer } from "./DaprContainer";
import { LocalFileSecretStoreOptions, SecretsMap } from "./SecretStore";

export type SecretStoreHarnessOptions = {
  appId?: string;
  appPort?: number;
  appChannelAddress?: string;
  daprLogLevel?: string;
  daprApiLoggingEnabled?: boolean;
  daprRuntimeImage?: string;
  /** Secret store component name. Defaults to `localsecretstore`. */
  secretStoreName?: string;
  /** The secrets to seed. Mutually exclusive with `secretsFilePath`. */
  secrets?: SecretsMap;
  /** Path on the host to an existing JSON secrets file. Mutually exclusive with `secrets`. */
  secretsFilePath?: string;
  /** Separator used when flattening nested secrets. Defaults to `:`. */
  nestedSeparator?: string;
  /** When true, nested secrets are returned as multi-valued secrets rather than flattened. */
  multiValued?: boolean;
  network?: StartedNetwork;
};

/**
 * Provides an implementation harness for Dapr's Secrets building block backed by
 * the local file secret store, mirroring the SecretStoreHarness in the .NET SDK.
 */
export class SecretStoreHarness {
  private network?: StartedNetwork;
  private ownsNetwork = false;
  private readonly daprContainer: DaprContainer;
  private readonly secretStoreName: string;
  private startedDaprContainer?: StartedDaprContainer;
  private daprClient?: DaprClient;

  constructor(private readonly options: SecretStoreHarnessOptions = {}) {
    const secretStoreOptions: LocalFileSecretStoreOptions = {
      name: options.secretStoreName,
      secrets: options.secrets,
      secretsFilePath: options.secretsFilePath,
      nestedSeparator: options.nestedSeparator,
      multiValued: options.multiValued,
    };

    this.daprContainer = new DaprContainer(options.daprRuntimeImage)
      .withAppName(options.appId ?? "secretstore-app")
      .withDaprLogLevel(options.daprLogLevel ?? "info")
      .withDaprApiLoggingEnabled(options.daprApiLoggingEnabled ?? false)
      .withSecretStore(secretStoreOptions);

    this.secretStoreName = this.daprContainer.getSecretStores()[0].name;

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

  public getSecretStoreName(): string {
    return this.secretStoreName;
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
      try {
        await this.daprClient.stop();
      } catch {
        // Ignore errors during client shutdown
      }
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
      throw new Error("SecretStoreHarness has not been started. Call start() first.");
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
   * Creates (and caches) a DaprClient bound to the running sidecar.
   *
   * @param protocol The communication protocol to use. Defaults to HTTP.
   */
  public createDaprClient(protocol: CommunicationProtocolEnum = CommunicationProtocolEnum.HTTP): DaprClient {
    const started = this.getStartedDaprContainer();
    this.daprClient = new DaprClient({
      daprHost: started.getHost(),
      daprPort: (protocol === CommunicationProtocolEnum.GRPC
        ? started.getGrpcPort()
        : started.getHttpPort()
      ).toString(),
      communicationProtocol: protocol,
    });
    return this.daprClient;
  }

  private getOrCreateClient(): DaprClient {
    return this.daprClient ?? this.createDaprClient();
  }

  /**
   * Retrieves a single secret from the local file secret store.
   *
   * @param key The secret key.
   * @returns The secret as a key/value object.
   */
  public async getSecret(key: string): Promise<Record<string, string>> {
    const result = await this.getOrCreateClient().secret.get(this.secretStoreName, key);
    return result as Record<string, string>;
  }

  /**
   * Retrieves the value of a single secret from the local file secret store.
   *
   * @param key The secret key.
   * @returns The secret value, or undefined if not present.
   */
  public async getSecretValue(key: string): Promise<string | undefined> {
    const secret = await this.getSecret(key);
    return secret?.[key];
  }

  /**
   * Retrieves all secrets from the local file secret store.
   */
  public async getBulkSecrets(): Promise<Record<string, Record<string, string>>> {
    const result = await this.getOrCreateClient().secret.getBulk(this.secretStoreName);
    return result as Record<string, Record<string, string>>;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
