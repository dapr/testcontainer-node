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
import { DaprContainer, StartedDaprContainer, VectorOptions } from "./DaprContainer";
import {
  BatchQueryResultAlpha1,
  BatchQueryVectorsResponseAlpha1,
  CreateCollectionOptions,
  DeleteVectorsResponseAlpha1,
  GetCollectionResponseAlpha1,
  GetVectorsResponseAlpha1,
  ListCollectionsResponseAlpha1,
  QueryVectorsResponseAlpha1,
  UpsertVectorsResponseAlpha1,
  VectorMetadata,
  VectorQuery,
  VectorRecord,
  VectorWriteOptions,
} from "./VectorTypes";

export type VectorHarnessOptions = VectorOptions & {
  appId?: string;
  appPort?: number;
  appChannelAddress?: string;
  daprLogLevel?: string;
  daprApiLoggingEnabled?: boolean;
  daprRuntimeImage?: string;
  network?: StartedNetwork;
};

type WireRecord = Omit<VectorRecord, "payload"> & { payload?: string };
type WireQueryResponse = Omit<QueryVectorsResponseAlpha1, "matches"> & {
  matches: { record: WireRecord; score: number }[];
};
type WireBatchResult =
  | { response: WireQueryResponse; error?: never }
  | { response?: never; error: NonNullable<BatchQueryResultAlpha1["error"]> };

/** Exercises Dapr's alpha Vector API using pre-embedded dense vectors and Meilisearch. */
export class VectorHarness {
  private network?: StartedNetwork;
  private ownsNetwork = false;
  private readonly daprContainer: DaprContainer;
  private startedDaprContainer?: StartedDaprContainer;
  private daprClients: DaprClient[] = [];

  constructor(private readonly options: VectorHarnessOptions = {}) {
    this.daprContainer = new DaprContainer(options.daprRuntimeImage)
      .withAppName(options.appId ?? "vector-app")
      .withDaprLogLevel(options.daprLogLevel ?? "info")
      .withDaprApiLoggingEnabled(options.daprApiLoggingEnabled ?? false)
      .withVector(options);
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

  public getVectorStoreName(): string {
    return this.options.vectorStoreName ?? DaprComponentNames.VectorComponentName;
  }

  public getStartedDaprContainer(): StartedDaprContainer {
    if (!this.startedDaprContainer) {
      throw new Error("VectorHarness has not been started. Call start() first.");
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

  public async createCollection(
    collection: string,
    dimensions: number,
    options: CreateCollectionOptions = {}
  ): Promise<void> {
    await this.request("POST", this.collectionPath(collection), { ...options, dimensions });
  }

  public async getCollection(collection: string, metadata?: VectorMetadata): Promise<GetCollectionResponseAlpha1> {
    const response = await this.request("GET", this.collectionPath(collection), undefined, metadata);
    return response.json();
  }

  public async listCollections(metadata?: VectorMetadata): Promise<ListCollectionsResponseAlpha1> {
    const response = await this.request("GET", "/collections", undefined, metadata);
    return response.json();
  }

  public async deleteCollection(collection: string, metadata?: VectorMetadata): Promise<void> {
    await this.request("DELETE", this.collectionPath(collection), undefined, metadata);
  }

  public async upsertVectors(
    collection: string,
    records: VectorRecord[],
    options: VectorWriteOptions = {}
  ): Promise<UpsertVectorsResponseAlpha1> {
    const response = await this.request("POST", `${this.collectionPath(collection)}/vectors`, {
      ...options,
      records: records.map((record) => ({ ...record, payload: record.payload?.toString("base64") })),
    });
    return response.json();
  }

  public async getVectors(
    collection: string,
    ids: string[],
    options: { includeValues?: boolean; metadata?: VectorMetadata } = {}
  ): Promise<GetVectorsResponseAlpha1> {
    const response = await this.request("POST", `${this.collectionPath(collection)}/vectors/get`, { ...options, ids });
    const result: { records: WireRecord[] } = await response.json();
    return { ...result, records: result.records.map(VectorHarness.decodeRecord) };
  }

  public async deleteVectors(
    collection: string,
    ids: string[],
    options: VectorWriteOptions = {}
  ): Promise<DeleteVectorsResponseAlpha1> {
    const response = await this.request("POST", `${this.collectionPath(collection)}/vectors/delete`, {
      ...options,
      ids,
    });
    return response.json();
  }

  public async queryVectors(
    collection: string,
    query: VectorQuery,
    metadata?: VectorMetadata
  ): Promise<QueryVectorsResponseAlpha1> {
    const response = await this.request("POST", `${this.collectionPath(collection)}/query`, { query, metadata });
    return VectorHarness.decodeQueryResponse(await response.json());
  }

  public async batchQueryVectors(
    collection: string,
    queries: VectorQuery[],
    metadata?: VectorMetadata
  ): Promise<BatchQueryVectorsResponseAlpha1> {
    const response = await this.request("POST", `${this.collectionPath(collection)}/batch-query`, {
      queries,
      metadata,
    });
    const result: { results: WireBatchResult[] } = await response.json();
    return {
      ...result,
      results: result.results.map((item) =>
        item.response !== undefined ? { ...item, response: VectorHarness.decodeQueryResponse(item.response) } : item
      ),
    };
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }

  private static decodeRecord(record: WireRecord): VectorRecord {
    const { payload, ...rest } = record;
    return { ...rest, ...(payload === undefined ? {} : { payload: Buffer.from(payload, "base64") }) };
  }

  private static decodeQueryResponse(result: WireQueryResponse): QueryVectorsResponseAlpha1 {
    return {
      ...result,
      matches: result.matches.map((match) => ({ ...match, record: VectorHarness.decodeRecord(match.record) })),
    };
  }

  private collectionPath(collection: string): string {
    if (!collection.trim() || /[/\\]/.test(collection) || collection === "." || collection === "..") {
      throw new Error("Vector collection must be non-empty and must not contain path separators or dot segments.");
    }
    return `/collections/${encodeURIComponent(collection)}`;
  }

  private async request(method: string, path: string, body?: object, metadata?: VectorMetadata): Promise<Response> {
    const url = new URL(
      `${this.getHttpEndpoint()}/v1.0-alpha1/vector/${encodeURIComponent(this.getVectorStoreName())}${path}`
    );
    for (const [key, value] of Object.entries(metadata ?? {})) {
      url.searchParams.set(`metadata.${key}`, value);
    }
    const response = await fetch(url.toString(), {
      method,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`Vector ${method} request failed (${response.status}): ${await response.text()}`);
    }
    return response;
  }
}
