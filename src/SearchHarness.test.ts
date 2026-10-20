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

import { CommunicationProtocolEnum } from "@dapr/dapr";
import { GenericContainer, Network } from "testcontainers";
import {
  Component,
  DaprContainer,
  IndexingOptionsAlpha1,
  MeilisearchContainer,
  SearchHarness,
  SearchQuery,
} from "./index";

const waitForCompletion: IndexingOptionsAlpha1 = {
  mode: "INDEXING_MODE_WAIT_FOR_COMPLETION",
  waitTimeout: "10s",
  onWaitTimeout: "INDEXING_WAIT_TIMEOUT_ACTION_FAIL_REQUEST",
};

describe("SearchHarness", () => {
  afterEach(() => jest.restoreAllMocks());

  it("registers a managed Meilisearch component by default", () => {
    const harness = new SearchHarness();
    const dapr = harness.getDaprContainer();
    expect(harness.getSearchStoreName()).toBe("search");
    expect(dapr.getAppName()).toBe("search-app");
    expect(dapr.getMeilisearchContainer()).toBeInstanceOf(MeilisearchContainer);
    expect(dapr.getComponents()[0]).toMatchObject({ name: "search", type: "search.meilisearch", version: "v1" });
    expect(dapr.getComponents()[0].getMetadata()).toEqual([
      { name: "host", value: "http://meilisearch:7700" },
      { name: "apiKey", value: dapr.getMeilisearchContainer()!.getApiKey() },
    ]);
  });

  it("forwards custom application, container and component settings", () => {
    const meilisearchContainer = new MeilisearchContainer();
    const harness = new SearchHarness({
      appId: "books-app",
      appPort: 8080,
      appChannelAddress: "host.testcontainers.internal",
      daprLogLevel: "debug",
      daprApiLoggingEnabled: true,
      daprRuntimeImage: "daprio/daprd:edge",
      searchStoreName: "books",
      meilisearchContainer,
      apiKey: "test-master-key-1234",
      timeout: "20s",
    });
    const dapr = harness.getDaprContainer();
    expect(dapr.getAppName()).toBe("books-app");
    expect(dapr.getAppPort()).toBe(8080);
    expect(dapr.getAppChannelAddress()).toBe("host.testcontainers.internal");
    expect(dapr.getMeilisearchContainer()).toBe(meilisearchContainer);
    expect(meilisearchContainer.getApiKey()).toBe("test-master-key-1234");
    expect(harness.getSearchStoreName()).toBe("books");
    expect(dapr.getComponents()[0].getMetadata()).toContainEqual({ name: "timeout", value: "20s" });
  });

  it("supports direct registration and an external provider without creating a container", () => {
    const dapr = new DaprContainer();
    expect(dapr.withSearch({ meilisearchHost: "http://external:7700", apiKey: "external-key" })).toBe(dapr);
    expect(dapr.getMeilisearchContainer()).toBeUndefined();
    expect(dapr.getComponents()[0].getMetadata()).toEqual([
      { name: "host", value: "http://external:7700" },
      { name: "apiKey", value: "external-key" },
    ]);
    expect(() => dapr.withSearch()).toThrow("already been configured");
    expect(() =>
      new DaprContainer().withComponent(new Component("search", "search.in-memory", "v1", [])).withSearch()
    ).toThrow('A component named "search" has already been registered');
    expect(
      () =>
        new SearchHarness({ meilisearchHost: "http://external:7700", meilisearchContainer: new MeilisearchContainer() })
    ).toThrow("not both");
  });

  it.each(["", " ", ".", "..", "../store", "store\\name"])("rejects unsafe store name %j", (searchStoreName) => {
    expect(() => new SearchHarness({ searchStoreName })).toThrow("Search store name must be");
  });

  it.each(["", "not-a-url", "redis://localhost:7700"])("rejects invalid Meilisearch host %j", (meilisearchHost) => {
    expect(() => new SearchHarness({ meilisearchHost })).toThrow();
  });

  it("guards access before start and safely stops an unstarted harness", async () => {
    const harness = new SearchHarness();
    for (const get of [
      () => harness.getStartedDaprContainer(),
      () => harness.getHost(),
      () => harness.getHttpPort(),
      () => harness.getGrpcPort(),
      () => harness.getHttpEndpoint(),
      () => harness.getGrpcEndpoint(),
      () => harness.createDaprClient(),
    ]) {
      expect(get).toThrow("SearchHarness has not been started");
    }
    await expect(harness.createIndex("books")).rejects.toThrow("has not been started");
    await expect(harness.listIndexes()).rejects.toThrow("has not been started");
    await expect(harness.search("books")).rejects.toThrow("has not been started");
    await harness.stop();
    await harness[Symbol.asyncDispose]();
  });

  it("maps index operations to the alpha routes and correctly encodes metadata", async () => {
    const harness = new SearchHarness({ searchStoreName: "my store" });
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const metadata = { filterableAttributes: "category,price", "special&key": "a b&c" };
    const base = "http://localhost:3500/v1.0-alpha1/search/my%20store/indexes";
    await harness.createIndex("books 100%", metadata);
    expect(fetchMock).toHaveBeenLastCalledWith(`${base}/books%20100%25`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata }),
    });
    fetchMock.mockResolvedValueOnce(
      Response.json({ index: "books", documentCount: "9007199254740993", properties: {} })
    );
    expect((await harness.getIndex("books", metadata)).documentCount).toBe("9007199254740993");
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${base}/books?metadata.filterableAttributes=category%2Cprice&metadata.special%26key=a+b%26c`,
      { method: "GET" }
    );
    fetchMock.mockResolvedValueOnce(Response.json({ indexes: ["books"] }));
    expect(await harness.listIndexes({ tenant: "a/b" })).toEqual({ indexes: ["books"] });
    expect(fetchMock).toHaveBeenLastCalledWith(`${base}?metadata.tenant=a%2Fb`, { method: "GET" });
    await harness.deleteIndex("books", { tenant: "a/b" });
    expect(fetchMock).toHaveBeenLastCalledWith(`${base}/books?metadata.tenant=a%2Fb`, { method: "DELETE" });
  });

  it("encodes document bytes and preserves acknowledgements and per-item errors", async () => {
    const harness = new SearchHarness();
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    const failedItems = [{ id: "invalid", error: { code: 3, message: "content must be an object", details: [] } }];
    const result = { ack: "INDEX_ACK_QUEUED", failedItems };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(result));
    const document = { id: "one", content: Buffer.from('{"title":"caf\\u00e9"}'), metadata: { source: "test" } };
    expect(await harness.indexDocuments("books", [document])).toEqual(result);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:3500/v1.0-alpha1/search/search/indexes/books/documents",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ documents: [{ ...document, content: document.content.toString("base64") }] }),
      })
    );
    fetchMock.mockResolvedValueOnce(Response.json({ ack: "INDEX_ACK_COMPLETED", failedItems: [] }));
    await harness.indexDocuments("books", [document], { metadata: { tenant: "test" }, options: waitForCompletion });
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toMatchObject({
      metadata: { tenant: "test" },
      options: waitForCompletion,
    });
    fetchMock.mockResolvedValueOnce(Response.json({ ack: "INDEX_ACK_COMPLETED" }));
    expect(await harness.deleteDocuments("books", ["one"], { options: waitForCompletion })).toEqual({
      ack: "INDEX_ACK_COMPLETED",
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:3500/v1.0-alpha1/search/search/indexes/books/documents/delete",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ options: waitForCompletion, ids: ["one"] }) })
    );
  });

  it("decodes document content without losing metadata, hit scores or pagination fields", async () => {
    const harness = new SearchHarness();
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    const content = Buffer.from('{"title":"alpha"}');
    const document = { id: "one", content: content.toString("base64"), metadata: { source: "test" } };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ documents: [document] }));
    expect(await harness.getDocuments("books", ["missing", "one"], { includeContent: true })).toEqual({
      documents: [{ ...document, content }],
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:3500/v1.0-alpha1/search/search/indexes/books/documents/get",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ includeContent: true, ids: ["missing", "one"] }),
      })
    );
    const result = {
      hits: [{ document, score: 0.95, highlights: { title: "<em>alpha</em>" } }],
      totalHits: "9007199254740993",
      totalHitsRelation: "TOTAL_HITS_RELATION_ESTIMATE",
      continuationToken: "opaque-token",
    };
    fetchMock.mockResolvedValueOnce(Response.json(result));
    const query: SearchQuery = {
      text: "alpha",
      filter: { $and: [{ category: { $in: ["guide"] } }, { price: { $gte: 10 } }] },
      topK: 1,
      continuationToken: "previous-token",
      includeContent: true,
      searchFields: ["title"],
      returnFields: ["title"],
      highlightFields: ["title"],
      sort: [{ field: "price", order: "SORT_ORDER_DESC" }],
    };
    expect(await harness.search("books", query, { tenant: "test" })).toEqual({
      ...result,
      hits: [{ ...result.hits[0], document: { ...document, content } }],
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:3500/v1.0-alpha1/search/search/indexes/books/query",
      expect.objectContaining({ body: JSON.stringify({ query, metadata: { tenant: "test" } }) })
    );
  });

  it("preserves native queries, omitted queries, empty content and absent optional totals", async () => {
    const harness = new SearchHarness();
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    const result = {
      hits: [{ document: { id: "one", content: "", metadata: {} }, score: 0, highlights: {} }],
      totalHitsRelation: "TOTAL_HITS_RELATION_UNSPECIFIED",
    };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(result));
    const response = await harness.search("books");
    expect(response.hits[0].document.content).toEqual(Buffer.alloc(0));
    expect(response).not.toHaveProperty("totalHits");
    expect(response).not.toHaveProperty("continuationToken");
    expect(fetchMock.mock.calls[0][1]!.body).toBe("{}");
    await harness.search("books", { native: { q: "alpha", matchingStrategy: "all" } });
    expect(fetchMock.mock.calls[1][1]!.body).toBe(
      JSON.stringify({ query: { native: { q: "alpha", matchingStrategy: "all" } } })
    );
  });

  it.each(["", " ", ".", "..", "../books", "books\\data"])(
    "rejects unsafe index %j before sending requests",
    async (index) => {
      const harness = new SearchHarness();
      const fetchMock = jest.spyOn(globalThis, "fetch");
      await expect(harness.getIndex(index)).rejects.toThrow("Search index must be");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each([400, 404, 409, 500])("surfaces runtime status %i and its error body", async (status) => {
    const harness = new SearchHarness();
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("runtime error", { status }));
    await expect(harness.search("books")).rejects.toThrow(`Search POST request failed (${status}): runtime error`);
  });

  it("propagates transport errors and malformed JSON", async () => {
    const harness = new SearchHarness();
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    const fetchMock = jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("connection failed"));
    await expect(harness.listIndexes()).rejects.toThrow("connection failed");
    fetchMock.mockResolvedValueOnce(new Response("{"));
    await expect(harness.listIndexes()).rejects.toThrow();
  });
});

// Opt in with an image known to contain Search; no unreleased RC number is assumed.
const searchRuntimeImage = process.env.DAPR_SEARCH_RUNTIME_IMAGE?.trim();
const itSearch = searchRuntimeImage ? it : it.skip;

describe("Search integration (requires DAPR_SEARCH_RUNTIME_IMAGE)", () => {
  afterEach(() => jest.restoreAllMocks());

  itSearch(
    "cleans up its provider and network when sidecar startup fails, then permits retry",
    async () => {
      const harness = new SearchHarness({ daprRuntimeImage: searchRuntimeImage });
      const startContainer = GenericContainer.prototype.start;
      const startProvider = MeilisearchContainer.prototype.start;
      const startNetwork = Network.prototype.start;
      let stopProvider: jest.SpyInstance | undefined;
      let stopNetwork: jest.SpyInstance | undefined;
      jest.spyOn(Network.prototype, "start").mockImplementation(async function (this: Network) {
        const network = await startNetwork.call(this);
        stopNetwork = jest.spyOn(network, "stop");
        return network;
      });
      jest.spyOn(MeilisearchContainer.prototype, "start").mockImplementation(async function (
        this: MeilisearchContainer
      ) {
        const provider = await startProvider.call(this);
        stopProvider = jest.spyOn(provider, "stop");
        return provider;
      });
      const startMock = jest.spyOn(GenericContainer.prototype, "start").mockImplementation(async function (
        this: GenericContainer
      ) {
        if (this === harness.getDaprContainer()) {
          throw new Error("sidecar startup failed");
        }
        return startContainer.call(this);
      });
      try {
        await expect(harness.start()).rejects.toThrow("sidecar startup failed");
        expect(stopProvider).toHaveBeenCalledTimes(1);
        expect(stopNetwork).toHaveBeenCalledTimes(1);
        expect(() => harness.getStartedDaprContainer()).toThrow("has not been started");
        startMock.mockRestore();
        await harness.start();
        await harness.createIndex("retry");
        expect((await harness.listIndexes()).indexes).toContain("retry");
      } finally {
        await harness.stop();
      }
    },
    240_000
  );

  itSearch(
    "exercises the search contract against a managed Meilisearch container",
    async () => {
      const harness = new SearchHarness({ daprRuntimeImage: searchRuntimeImage, searchStoreName: "bookstore" });
      let stopNetwork: jest.SpyInstance | undefined;
      const startNetwork = Network.prototype.start;
      jest.spyOn(Network.prototype, "start").mockImplementation(async function (this: Network) {
        const network = await startNetwork.call(this);
        stopNetwork = jest.spyOn(network, "stop");
        return network;
      });
      try {
        await harness.start();
        expect(await harness.start()).toBe(harness);
        const started = harness.getStartedDaprContainer();
        expect(started.getMeilisearchContainer()).toBeDefined();
        expect(started.getContainers()).toHaveLength(3);
        expect(harness.getHost()).toBeDefined();
        expect(harness.getHttpPort()).toBeGreaterThan(0);
        expect(harness.getGrpcPort()).toBeGreaterThan(0);
        expect(harness.getGrpcEndpoint()).toContain(harness.getGrpcPort().toString());
        await harness.createDaprClient().start();
        await harness.createDaprClient({ communicationProtocol: CommunicationProtocolEnum.GRPC }).start();
        await harness.createIndex("books", {
          searchableAttributes: "title",
          filterableAttributes: "category,price",
          sortableAttributes: "price",
        });
        expect((await harness.listIndexes()).indexes).toContain("books");
        expect(await harness.getIndex("books")).toMatchObject({ index: "books", documentCount: "0" });
        await expect(harness.createIndex("books")).rejects.toThrow("(409)");
        const documents = [
          {
            id: "one",
            content: Buffer.from('{"title":"alpha guide","category":"guide","price":10}'),
            metadata: { source: "opaque-marker" },
          },
          { id: "two", content: Buffer.from('{"title":"beta guide","category":"guide","price":20}') },
          { id: "three", content: Buffer.from('{"title":"alpha reference","category":"reference","price":30}') },
        ];
        const indexed = await harness.indexDocuments(
          "books",
          [...documents, { id: "invalid", content: Buffer.from('["not","an","object"]') }],
          { options: waitForCompletion }
        );
        expect(indexed.ack).toBe("INDEX_ACK_COMPLETED");
        expect(indexed.failedItems).toEqual([
          expect.objectContaining({ id: "invalid", error: expect.objectContaining({ code: 3 }) }),
        ]);
        expect((await harness.getIndex("books")).documentCount).toBe("3");
        const got = await harness.getDocuments("books", ["three", "missing", "one", "invalid"], {
          includeContent: true,
        });
        expect(got.documents.map((document) => document.id)).toEqual(["three", "one"]);
        expect(JSON.parse(got.documents[1].content.toString())).toEqual(JSON.parse(documents[0].content.toString()));
        expect(got.documents[1].metadata).toEqual({ source: "opaque-marker" });
        expect((await harness.getDocuments("books", ["one"])).documents[0].content).toEqual(Buffer.alloc(0));
        expect((await harness.search("books", { text: "opaque-marker" })).hits).toEqual([]);
        const filtered = await harness.search("books", {
          text: "alpha",
          filter: { category: { $eq: "guide" } },
          includeContent: true,
          returnFields: ["title"],
          searchFields: ["title"],
          highlightFields: ["title"],
        });
        expect(filtered.hits.map((hit) => hit.document.id)).toEqual(["one"]);
        expect(JSON.parse(filtered.hits[0].document.content.toString())).toEqual({ title: "alpha guide" });
        expect(filtered.hits[0].highlights.title).toContain("<em>alpha</em>");
        const query: SearchQuery = { topK: 2, sort: [{ field: "price", order: "SORT_ORDER_DESC" }] };
        const page1 = await harness.search("books", query);
        expect(page1.hits.map((hit) => hit.document.id)).toEqual(["three", "two"]);
        expect(page1.totalHits).toBe("3");
        expect(page1.totalHitsRelation).not.toBe("TOTAL_HITS_RELATION_UNSPECIFIED");
        expect(page1.continuationToken).toBeTruthy();
        const page2 = await harness.search("books", { ...query, continuationToken: page1.continuationToken });
        expect(page2.hits.map((hit) => hit.document.id)).toEqual(["one"]);
        expect(page2.continuationToken).toBeUndefined();
        expect((await harness.search("books", { native: { q: "beta" } })).hits.map((hit) => hit.document.id)).toEqual([
          "two",
        ]);
        const updated = await harness.indexDocuments(
          "books",
          [{ id: "one", content: Buffer.from('{"title":"updated","category":"guide","price":15}') }],
          { options: waitForCompletion }
        );
        expect(updated).toEqual({ ack: "INDEX_ACK_COMPLETED", failedItems: [] });
        expect((await harness.search("books", { text: "updated" })).hits.map((hit) => hit.document.id)).toEqual([
          "one",
        ]);
        expect(await harness.deleteDocuments("books", ["one", "missing"], { options: waitForCompletion })).toEqual({
          ack: "INDEX_ACK_COMPLETED",
        });
        expect((await harness.getDocuments("books", ["one"])).documents).toEqual([]);
        const queued = await harness.indexDocuments("books", [
          { id: "queued", content: Buffer.from('{"title":"queued"}') },
        ]);
        expect(queued.ack).toBe("INDEX_ACK_QUEUED");
        expect(queued.failedItems).toEqual([]);
        const deadline = Date.now() + 10_000;
        while ((await harness.getDocuments("books", ["queued"])).documents.length === 0) {
          if (Date.now() >= deadline) {
            throw new Error("Queued document was not visible within 10 seconds.");
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await harness.deleteIndex("books");
        expect((await harness.listIndexes()).indexes).not.toContain("books");
        await expect(harness.getIndex("books")).rejects.toThrow("(404)");
      } finally {
        await harness[Symbol.asyncDispose]();
      }
      expect(stopNetwork).toHaveBeenCalledTimes(1);
      expect(() => harness.getStartedDaprContainer()).toThrow("has not been started");
      await harness.stop();
    },
    240_000
  );

  itSearch(
    "leaves a caller-owned network and external Meilisearch running",
    async () => {
      await using network = await new Network().start();
      const stopNetwork = jest.spyOn(network, "stop");
      await using meilisearch = await new MeilisearchContainer()
        .withNetwork(network)
        .withNetworkAliases("external-search")
        .start();
      const harness = new SearchHarness({
        daprRuntimeImage: searchRuntimeImage,
        network,
        meilisearchHost: "http://external-search:7700",
        apiKey: meilisearch.getApiKey(),
      });
      try {
        await harness.start();
        expect(harness.getStartedDaprContainer().getMeilisearchContainer()).toBeUndefined();
        await harness.createIndex("external");
      } finally {
        await harness.stop();
      }
      expect(stopNetwork).not.toHaveBeenCalled();
      expect((await fetch(`${meilisearch.getHttpEndpoint()}/health`)).status).toBe(200);
      const dapr = new DaprContainer(searchRuntimeImage).withNetwork(network).withSearch({
        meilisearchHost: "http://external-search:7700",
        apiKey: meilisearch.getApiKey(),
      });
      await using started = await dapr.start();
      const response = await fetch(`${started.getHttpEndpoint()}/v1.0-alpha1/search/search/indexes`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ indexes: ["external"] });
    },
    240_000
  );
});
