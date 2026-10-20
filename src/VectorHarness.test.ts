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
  VectorHarness,
  VectorQuery,
} from "./index";

const waitForCompletion: IndexingOptionsAlpha1 = {
  mode: "INDEXING_MODE_WAIT_FOR_COMPLETION",
  waitTimeout: "10s",
  onWaitTimeout: "INDEXING_WAIT_TIMEOUT_ACTION_FAIL_REQUEST",
};

describe("VectorHarness", () => {
  afterEach(() => jest.restoreAllMocks());

  it("registers a managed vector component by default", () => {
    const harness = new VectorHarness();
    const dapr = harness.getDaprContainer();
    expect(harness.getVectorStoreName()).toBe("vector");
    expect(dapr.getAppName()).toBe("vector-app");
    expect(dapr.getMeilisearchContainer()).toBeInstanceOf(MeilisearchContainer);
    expect(dapr.getComponents()[0]).toMatchObject({ name: "vector", type: "vector.meilisearch", version: "v1" });
    expect(dapr.getComponents()[0].getMetadata()).toEqual([
      { name: "host", value: "http://meilisearch:7700" },
      { name: "apiKey", value: dapr.getMeilisearchContainer()!.getApiKey() },
    ]);
  });

  it("forwards custom application, provider and component settings", () => {
    const meilisearchContainer = new MeilisearchContainer();
    const harness = new VectorHarness({
      appId: "books-app",
      appPort: 8080,
      appChannelAddress: "host.testcontainers.internal",
      daprLogLevel: "debug",
      daprApiLoggingEnabled: true,
      daprRuntimeImage: "daprio/daprd:edge",
      vectorStoreName: "books",
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
    expect(harness.getVectorStoreName()).toBe("books");
    expect(dapr.getComponents()[0].getMetadata()).toContainEqual({ name: "timeout", value: "20s" });
  });

  it("supports external providers and rejects duplicate or ambiguous registrations", () => {
    const dapr = new DaprContainer();
    expect(dapr.withVector({ meilisearchHost: "http://external:7700", apiKey: "external-key" })).toBe(dapr);
    expect(dapr.getMeilisearchContainer()).toBeUndefined();
    expect(dapr.getComponents()[0].getMetadata()).toEqual([
      { name: "host", value: "http://external:7700" },
      { name: "apiKey", value: "external-key" },
    ]);
    expect(() => dapr.withVector()).toThrow("already been configured");
    expect(() =>
      new DaprContainer().withComponent(new Component("vector", "vector.in-memory", "v1", [])).withVector()
    ).toThrow('A component named "vector" has already been registered');
    expect(
      () =>
        new VectorHarness({ meilisearchHost: "http://external:7700", meilisearchContainer: new MeilisearchContainer() })
    ).toThrow("not both");
  });

  it.each(["search", "vector"] as const)("shares one managed provider when %s is configured first", (first) => {
    const dapr = new DaprContainer();
    const provider = new MeilisearchContainer();
    const options = { meilisearchContainer: provider, apiKey: "test-master-key-1234" };
    if (first === "search") {
      dapr.withSearch(options).withVector();
    } else {
      dapr.withVector(options).withSearch();
    }
    expect(dapr.getMeilisearchContainer()).toBe(provider);
    expect(
      dapr
        .getComponents()
        .map((component) => component.type)
        .sort()
    ).toEqual(["search.meilisearch", "vector.meilisearch"]);
    for (const component of dapr.getComponents()) {
      expect(component.getMetadata()).toContainEqual({ name: "apiKey", value: provider.getApiKey() });
    }
  });

  it.each(["search", "vector"] as const)(
    "rejects conflicting shared settings after %s without corrupting configuration",
    (first) => {
      const dapr = new DaprContainer();
      if (first === "search") {
        dapr.withSearch();
      } else {
        dapr.withVector();
      }
      const provider = dapr.getMeilisearchContainer()!;
      const configure = first === "search" ? dapr.withVector.bind(dapr) : dapr.withSearch.bind(dapr);
      expect(() => configure({ meilisearchContainer: new MeilisearchContainer() })).toThrow("same managed");
      expect(() => configure({ apiKey: "a-different-master-key" })).toThrow("same API key");
      expect(dapr.getComponents()).toHaveLength(1);
      configure({ meilisearchContainer: provider, apiKey: provider.getApiKey() });
      expect(dapr.getComponents()).toHaveLength(2);
    }
  );

  it.each([
    ["search", true],
    ["search", false],
    ["vector", true],
    ["vector", false],
  ] as const)("preserves managed provisioning with %s first and external-first=%s", (first, externalFirst) => {
    const dapr = new DaprContainer();
    const external = { meilisearchHost: "http://external:7700", apiKey: "external-key" };
    const a = externalFirst ? external : {};
    const b = externalFirst ? {} : external;
    if (first === "search") {
      dapr.withSearch(a).withVector(b);
    } else {
      dapr.withVector(a).withSearch(b);
    }
    expect(dapr.getMeilisearchContainer()).toBeDefined();
    expect(
      dapr
        .getComponents()
        .filter((component) =>
          component.getMetadata().some((entry) => entry.name === "host" && entry.value === "http://external:7700")
        )
    ).toHaveLength(1);
  });

  it.each(["", " ", ".", "..", "../store", "store\\name"])("rejects unsafe store name %j", (vectorStoreName) => {
    expect(() => new VectorHarness({ vectorStoreName })).toThrow("Vector store name must be");
  });

  it.each(["", "not-a-url", "redis://localhost:7700"])("rejects invalid provider host %j", (meilisearchHost) => {
    expect(() => new VectorHarness({ meilisearchHost })).toThrow();
  });

  it("guards access before start and safely disposes an unstarted harness", async () => {
    const harness = new VectorHarness();
    for (const get of [
      () => harness.getStartedDaprContainer(),
      () => harness.getHost(),
      () => harness.getHttpPort(),
      () => harness.getGrpcPort(),
      () => harness.getHttpEndpoint(),
      () => harness.getGrpcEndpoint(),
      () => harness.createDaprClient(),
    ]) {
      expect(get).toThrow("VectorHarness has not been started");
    }
    await expect(harness.createCollection("books", 3)).rejects.toThrow("has not been started");
    await expect(harness.listCollections()).rejects.toThrow("has not been started");
    await harness.stop();
    await harness[Symbol.asyncDispose]();
  });

  it("maps collection operations, encodes metadata and preserves uint64 counts", async () => {
    const harness = new VectorHarness({ vectorStoreName: "my store" });
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const metadata = { "special&key": "a b&c" };
    const base = "http://localhost:3500/v1.0-alpha1/vector/my%20store/collections";
    await harness.createCollection("books 100%", 3, { metric: "DISTANCE_METRIC_COSINE", metadata });
    expect(fetchMock).toHaveBeenLastCalledWith(`${base}/books%20100%25`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metric: "DISTANCE_METRIC_COSINE", metadata, dimensions: 3 }),
    });
    fetchMock.mockResolvedValueOnce(
      Response.json({
        collection: "books",
        recordCount: "9007199254740993",
        dimensions: 3,
        metric: "DISTANCE_METRIC_COSINE",
        properties: {},
      })
    );
    expect((await harness.getCollection("books", metadata)).recordCount).toBe("9007199254740993");
    expect(fetchMock).toHaveBeenLastCalledWith(`${base}/books?metadata.special%26key=a+b%26c`, { method: "GET" });
    fetchMock.mockResolvedValueOnce(Response.json({ collections: ["books"] }));
    expect(await harness.listCollections({ tenant: "a/b" })).toEqual({ collections: ["books"] });
    expect(fetchMock).toHaveBeenLastCalledWith(`${base}?metadata.tenant=a%2Fb`, { method: "GET" });
    await harness.deleteCollection("books", metadata);
    expect(fetchMock).toHaveBeenLastCalledWith(`${base}/books?metadata.special%26key=a+b%26c`, { method: "DELETE" });
  });

  it("encodes opaque payloads and preserves acknowledgements, item errors and write options", async () => {
    const harness = new VectorHarness();
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    const result = { ack: "INDEX_ACK_QUEUED", failedItems: [{ id: "bad", error: { code: 3, message: "dimensions" } }] };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(result));
    const records = [
      { id: "one", values: [1, 0, 0], payload: Buffer.from([0, 128, 255]), metadata: { year: 2026, tags: ["a"] } },
      { id: "two", values: [0, 1, 0] },
      { id: "three", values: [0, 0, 1], payload: Buffer.alloc(0) },
    ];
    expect(await harness.upsertVectors("books", records)).toEqual(result);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:3500/v1.0-alpha1/vector/vector/collections/books/vectors",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          records: [{ ...records[0], payload: "AID/" }, records[1], { ...records[2], payload: "" }],
        }),
      })
    );
    const options = { metadata: { tenant: "test" }, options: waitForCompletion };
    fetchMock.mockResolvedValueOnce(Response.json({ ack: "INDEX_ACK_COMPLETED", failedItems: [] }));
    expect(await harness.upsertVectors("books", [], options)).toEqual({ ack: "INDEX_ACK_COMPLETED", failedItems: [] });
    expect(fetchMock.mock.calls[1][1]!.body).toBe(JSON.stringify({ ...options, records: [] }));
    fetchMock.mockResolvedValueOnce(Response.json({ ack: "INDEX_ACK_COMPLETED" }));
    expect(await harness.deleteVectors("books", ["one"], options)).toEqual({ ack: "INDEX_ACK_COMPLETED" });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:3500/v1.0-alpha1/vector/vector/collections/books/vectors/delete",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ ...options, ids: ["one"] }) })
    );
  });

  it("decodes retrieved records, including absent and empty payloads, in response order", async () => {
    const harness = new VectorHarness();
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    const records = [
      { id: "two", values: [], metadata: { nested: { year: 2026 } } },
      { id: "one", values: [1, 0], payload: "AID/" },
      { id: "empty", values: [], payload: "" },
    ];
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ records }));
    expect(await harness.getVectors("books", ["two", "missing", "one", "empty"], { includeValues: true })).toEqual({
      records: [
        records[0],
        { ...records[1], payload: Buffer.from([0, 128, 255]) },
        { ...records[2], payload: Buffer.alloc(0) },
      ],
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:3500/v1.0-alpha1/vector/vector/collections/books/vectors/get",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ includeValues: true, ids: ["two", "missing", "one", "empty"] }),
      })
    );
  });

  it("maps vector and by-ID queries and decodes mixed batch results without hiding errors", async () => {
    const harness = new VectorHarness();
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    const record = { id: "one", values: [1, 0], payload: "AID/", metadata: { active: true } };
    const response = { matches: [{ record, score: 0.95 }], metric: "DISTANCE_METRIC_COSINE" };
    const decoded = {
      ...response,
      matches: [{ record: { ...record, payload: Buffer.from([0, 128, 255]) }, score: 0.95 }],
    };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(response));
    const query: VectorQuery = {
      vector: { values: [1, 0] },
      topK: 2,
      filter: { active: { $eq: true } },
      includeValues: true,
      includePayload: true,
      metric: "DISTANCE_METRIC_COSINE",
      scoreThreshold: 0.8,
    };
    const metadata = { tenant: "test" };
    expect(await harness.queryVectors("books", query, metadata)).toEqual(decoded);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:3500/v1.0-alpha1/vector/vector/collections/books/query",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ query, metadata }) })
    );
    const error = { code: 5, message: "not found", details: [{ "@type": "example", reason: "missing" }] };
    const empty = { matches: [], metric: "DISTANCE_METRIC_COSINE" };
    fetchMock.mockResolvedValueOnce(Response.json({ results: [{ response }, { error }, { response: empty }] }));
    const queries: VectorQuery[] = [query, { byId: "missing" }, { byId: "one", scoreThreshold: 1 }];
    expect(await harness.batchQueryVectors("books", queries, metadata)).toEqual({
      results: [{ response: decoded }, { error }, { response: empty }],
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:3500/v1.0-alpha1/vector/vector/collections/books/batch-query",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ queries, metadata }) })
    );
    fetchMock.mockResolvedValueOnce(Response.json(empty));
    expect(await harness.queryVectors("books", { byId: "one" })).toEqual(empty);
    expect(fetchMock.mock.calls[2][1]!.body).toBe(JSON.stringify({ query: { byId: "one" } }));
  });

  it.each(["", " ", ".", "..", "../books", "books\\data"])("rejects unsafe collection %j", async (collection) => {
    const harness = new VectorHarness();
    const fetchMock = jest.spyOn(globalThis, "fetch");
    await expect(harness.getCollection(collection)).rejects.toThrow("Vector collection must be");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([400, 404, 409, 500])("surfaces HTTP status %i and its error body", async (status) => {
    const harness = new VectorHarness();
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("runtime error", { status }));
    await expect(harness.queryVectors("books", { byId: "one" })).rejects.toThrow(
      `Vector POST request failed (${status}): runtime error`
    );
  });

  it("propagates transport and malformed JSON errors", async () => {
    const harness = new VectorHarness();
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    const fetchMock = jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("connection failed"));
    await expect(harness.listCollections()).rejects.toThrow("connection failed");
    fetchMock.mockResolvedValueOnce(new Response("{"));
    await expect(harness.listCollections()).rejects.toThrow();
  });
});

// An explicitly selected image must support both the Vector API and vector.meilisearch.
const vectorRuntimeImage = process.env.DAPR_VECTOR_RUNTIME_IMAGE?.trim();
const itVector = vectorRuntimeImage ? it : it.skip;

describe("Vector integration (requires DAPR_VECTOR_RUNTIME_IMAGE)", () => {
  afterEach(() => jest.restoreAllMocks());

  itVector(
    "exercises vector operations and shares one provider with Search",
    async () => {
      const harness = new VectorHarness({ daprRuntimeImage: vectorRuntimeImage, vectorStoreName: "bookstore" });
      harness.getDaprContainer().withSearch();
      const startNetwork = Network.prototype.start;
      let stopNetwork: jest.SpyInstance | undefined;
      jest.spyOn(Network.prototype, "start").mockImplementation(async function (this: Network) {
        const network = await startNetwork.call(this);
        stopNetwork = jest.spyOn(network, "stop");
        return network;
      });
      let stopProvider: jest.SpyInstance | undefined;
      try {
        await harness.start();
        expect(await harness.start()).toBe(harness);
        const started = harness.getStartedDaprContainer();
        expect(started.getContainers()).toHaveLength(3);
        stopProvider = jest.spyOn(started.getMeilisearchContainer()!, "stop");
        expect(harness.getHost()).toBeDefined();
        expect(harness.getHttpPort()).toBeGreaterThan(0);
        expect(harness.getGrpcPort()).toBeGreaterThan(0);
        expect(harness.getGrpcEndpoint()).toContain(harness.getGrpcPort().toString());
        const httpClient = harness.createDaprClient();
        const grpcClient = harness.createDaprClient({ communicationProtocol: CommunicationProtocolEnum.GRPC });
        await httpClient.start();
        await grpcClient.start();
        await harness.createCollection("books", 3);
        expect((await harness.listCollections()).collections).toContain("books");
        expect(await harness.getCollection("books")).toMatchObject({
          collection: "books",
          recordCount: "0",
          dimensions: 3,
          metric: "DISTANCE_METRIC_COSINE",
        });
        await expect(harness.createCollection("books", 3)).rejects.toThrow("(409)");
        await expect(
          harness.createCollection("unsupported", 3, { metric: "DISTANCE_METRIC_EUCLIDEAN" })
        ).rejects.toThrow("(400)");
        const payload = Buffer.from([0, 128, 255]);
        const records = [
          { id: "one", values: [1, 0, 0], payload, metadata: { category: "guide", year: 2026 } },
          { id: "two", values: [0, 1, 0], metadata: { category: "reference", year: 2020 } },
        ];
        const indexed = await harness.upsertVectors("books", [...records, { id: "invalid", values: [1, 0] }], {
          options: waitForCompletion,
        });
        expect(indexed.ack).toBe("INDEX_ACK_COMPLETED");
        expect(indexed.failedItems).toEqual([
          expect.objectContaining({ id: "invalid", error: expect.objectContaining({ code: 3 }) }),
        ]);
        expect((await harness.getCollection("books")).recordCount).toBe("2");
        const got = await harness.getVectors("books", ["two", "missing", "one"], { includeValues: true });
        expect(got.records.map((record) => record.id)).toEqual(["two", "one"]);
        expect(got.records[1]).toMatchObject(records[0]);
        expect((await harness.getVectors("books", ["one"])).records[0].values).toEqual([]);
        const result = await harness.queryVectors("books", {
          vector: { values: [1, 0, 0] },
          topK: 2,
          includeValues: true,
          includePayload: true,
          scoreThreshold: 0.9,
        });
        expect(result.metric).toBe("DISTANCE_METRIC_COSINE");
        expect(result.matches.map((match) => match.record.id)).toEqual(["one"]);
        expect(result.matches[0].score).toBeCloseTo(1, 2);
        expect(result.matches[0].record).toMatchObject(records[0]);
        const filtered = await harness.queryVectors("books", {
          vector: { values: [1, 0, 0] },
          topK: 2,
          filter: { year: { $lt: 2022 } },
        });
        expect(filtered.matches.map((match) => match.record.id)).toEqual(["two"]);
        expect(filtered.matches[0].record.values).toEqual([]);
        expect(filtered.matches[0].record.payload).toBeUndefined();
        expect((await harness.queryVectors("books", { byId: "one", topK: 1 })).matches[0].record.id).toBe("two");
        const batch = await harness.batchQueryVectors("books", [
          { byId: "two", topK: 1, includePayload: true },
          { byId: "missing" },
          { vector: { values: [0, 1, 0] }, topK: 1 },
        ]);
        expect(batch.results).toHaveLength(3);
        expect(batch.results[0].response?.matches[0].record.payload).toEqual(payload);
        expect(batch.results[1].error).toMatchObject({ code: 5 });
        expect(batch.results[2].response?.matches[0].record.id).toBe("two");
        expect(
          await harness.upsertVectors("books", [{ ...records[0], values: [0, 0, 1] }], { options: waitForCompletion })
        ).toEqual({ ack: "INDEX_ACK_COMPLETED", failedItems: [] });
        expect((await harness.getVectors("books", ["one"], { includeValues: true })).records[0].values).toEqual([
          0, 0, 1,
        ]);
        expect(await harness.deleteVectors("books", ["one", "missing"], { options: waitForCompletion })).toEqual({
          ack: "INDEX_ACK_COMPLETED",
        });
        expect((await harness.getVectors("books", ["one"])).records).toEqual([]);
        const queued = await harness.upsertVectors("books", [{ id: "queued", values: [1, 0, 0] }]);
        expect(queued).toEqual({ ack: "INDEX_ACK_QUEUED", failedItems: [] });
        const deadline = Date.now() + 10_000;
        while (!(await harness.getVectors("books", ["queued"])).records.length) {
          if (Date.now() >= deadline) {
            throw new Error("Queued vector was not visible within 10 seconds.");
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const searchBase = `${harness.getHttpEndpoint()}/v1.0-alpha1/search/search/indexes`;
        expect(
          (
            await fetch(`${searchBase}/documents`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            })
          ).ok
        ).toBe(true);
        expect(await (await fetch(searchBase)).json()).toMatchObject({
          indexes: expect.arrayContaining(["documents"]),
        });
        await harness.deleteCollection("books");
        expect((await harness.listCollections()).collections).not.toContain("books");
        await expect(harness.getCollection("books")).rejects.toThrow("(404)");
      } finally {
        await harness[Symbol.asyncDispose]();
      }
      expect(stopProvider).toHaveBeenCalledTimes(1);
      expect(stopNetwork).toHaveBeenCalledTimes(1);
      expect(() => harness.getStartedDaprContainer()).toThrow("has not been started");
      await harness.stop();
    },
    240_000
  );

  itVector(
    "leaves caller-owned networks and external providers running",
    async () => {
      await using network = await new Network().start();
      const stopNetwork = jest.spyOn(network, "stop");
      await using provider = await new MeilisearchContainer()
        .withNetwork(network)
        .withNetworkAliases("external-vector")
        .start();
      const harness = new VectorHarness({
        daprRuntimeImage: vectorRuntimeImage,
        network,
        meilisearchHost: "http://external-vector:7700",
        apiKey: provider.getApiKey(),
      });
      try {
        await harness.start();
        expect(harness.getStartedDaprContainer().getMeilisearchContainer()).toBeUndefined();
        await harness.createCollection("external", 3);
      } finally {
        await harness.stop();
      }
      expect(stopNetwork).not.toHaveBeenCalled();
      expect((await fetch(`${provider.getHttpEndpoint()}/health`)).status).toBe(200);
      await using started = await new DaprContainer(vectorRuntimeImage)
        .withNetwork(network)
        .withVector({
          meilisearchHost: "http://external-vector:7700",
          apiKey: provider.getApiKey(),
        })
        .start();
      const response = await fetch(`${started.getHttpEndpoint()}/v1.0-alpha1/vector/vector/collections`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ collections: ["external"] });
    },
    240_000
  );

  itVector(
    "cleans up after failed sidecar startup and permits retry",
    async () => {
      const harness = new VectorHarness({ daprRuntimeImage: vectorRuntimeImage });
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
        await harness.createCollection("retry", 3);
        expect((await harness.listCollections()).collections).toContain("retry");
      } finally {
        await harness.stop();
      }
    },
    240_000
  );
});
