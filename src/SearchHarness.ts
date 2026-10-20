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
import { DaprContainer, SearchOptions, StartedDaprContainer } from "./DaprContainer";
import {
  DeleteDocumentsResponseAlpha1,
  GetDocumentsResponseAlpha1,
  GetIndexResponseAlpha1,
  IndexDocumentsResponseAlpha1,
  ListIndexesResponseAlpha1,
  SearchDocument,
  SearchMetadata,
  SearchQuery,
  SearchResponseAlpha1,
  SearchWriteOptions,
} from "./SearchTypes";

export type SearchHarnessOptions = SearchOptions & {
  appId?: string;
  appPort?: number;
  appChannelAddress?: string;
  daprLogLevel?: string;
  daprApiLoggingEnabled?: boolean;
  daprRuntimeImage?: string;
  network?: StartedNetwork;
};

type WireDocument = Omit<SearchDocument, "content"> & { content: string };

/** Exercises Dapr's alpha Search API against Meilisearch, without requiring SDK search bindings. */
export class SearchHarness {
  private network?: StartedNetwork;
  private ownsNetwork = false;
  private readonly daprContainer: DaprContainer;
  private startedDaprContainer?: StartedDaprContainer;
  private daprClients: DaprClient[] = [];

  constructor(private readonly options: SearchHarnessOptions = {}) {
    this.daprContainer = new DaprContainer(options.daprRuntimeImage)
      .withAppName(options.appId ?? "search-app")
      .withDaprLogLevel(options.daprLogLevel ?? "info")
      .withDaprApiLoggingEnabled(options.daprApiLoggingEnabled ?? false)
      .withSearch(options);
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

  public getSearchStoreName(): string {
    return this.options.searchStoreName ?? DaprComponentNames.SearchComponentName;
  }

  public getStartedDaprContainer(): StartedDaprContainer {
    if (!this.startedDaprContainer) {
      throw new Error("SearchHarness has not been started. Call start() first.");
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

  public async createIndex(index: string, metadata?: SearchMetadata): Promise<void> {
    await this.request("POST", this.indexPath(index), { metadata });
  }

  public async getIndex(index: string, metadata?: SearchMetadata): Promise<GetIndexResponseAlpha1> {
    const response = await this.request("GET", this.indexPath(index), undefined, metadata);
    return response.json();
  }

  public async listIndexes(metadata?: SearchMetadata): Promise<ListIndexesResponseAlpha1> {
    const response = await this.request("GET", "/indexes", undefined, metadata);
    return response.json();
  }

  public async deleteIndex(index: string, metadata?: SearchMetadata): Promise<void> {
    await this.request("DELETE", this.indexPath(index), undefined, metadata);
  }

  public async indexDocuments(
    index: string,
    documents: SearchDocument[],
    options: SearchWriteOptions = {}
  ): Promise<IndexDocumentsResponseAlpha1> {
    const response = await this.request("POST", `${this.indexPath(index)}/documents`, {
      ...options,
      documents: documents.map((document) => ({ ...document, content: document.content.toString("base64") })),
    });
    return response.json();
  }

  public async getDocuments(
    index: string,
    ids: string[],
    options: { includeContent?: boolean; metadata?: SearchMetadata } = {}
  ): Promise<GetDocumentsResponseAlpha1> {
    const response = await this.request("POST", `${this.indexPath(index)}/documents/get`, { ...options, ids });
    const result: { documents: WireDocument[] } = await response.json();
    return { ...result, documents: result.documents.map(SearchHarness.decodeDocument) };
  }

  public async deleteDocuments(
    index: string,
    ids: string[],
    options: SearchWriteOptions = {}
  ): Promise<DeleteDocumentsResponseAlpha1> {
    const response = await this.request("POST", `${this.indexPath(index)}/documents/delete`, { ...options, ids });
    return response.json();
  }

  public async search(index: string, query?: SearchQuery, metadata?: SearchMetadata): Promise<SearchResponseAlpha1> {
    const response = await this.request("POST", `${this.indexPath(index)}/query`, { query, metadata });
    const result: Omit<SearchResponseAlpha1, "hits"> & {
      hits: (Omit<SearchResponseAlpha1["hits"][number], "document"> & { document: WireDocument })[];
    } = await response.json();
    return {
      ...result,
      hits: result.hits.map((hit) => ({ ...hit, document: SearchHarness.decodeDocument(hit.document) })),
    };
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }

  private static decodeDocument(document: WireDocument): SearchDocument {
    return { ...document, content: Buffer.from(document.content, "base64") };
  }

  private indexPath(index: string): string {
    if (!index.trim() || /[/\\]/.test(index) || index === "." || index === "..") {
      throw new Error("Search index must be non-empty and must not contain path separators or dot segments.");
    }
    return `/indexes/${encodeURIComponent(index)}`;
  }

  private async request(method: string, path: string, body?: object, metadata?: SearchMetadata): Promise<Response> {
    const url = new URL(
      `${this.getHttpEndpoint()}/v1.0-alpha1/search/${encodeURIComponent(this.getSearchStoreName())}${path}`
    );
    for (const [key, value] of Object.entries(metadata ?? {})) {
      url.searchParams.set(`metadata.${key}`, value);
    }
    const response = await fetch(url.toString(), {
      method,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`Search ${method} request failed (${response.status}): ${await response.text()}`);
    }
    return response;
  }
}
