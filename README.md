[![NPM Version](https://img.shields.io/npm/v/%40dapr%2Ftestcontainer-node?style=flat&logo=npm&label=Latest%20version)](https://www.npmjs.com/package/@dapr/testcontainer-node) [![NPM Downloads](https://img.shields.io/npm/dy/%40dapr%2Ftestcontainer-node?style=flat&logo=npm&label=Downloads)](https://www.npmjs.com/package/@dapr/testcontainer-node) [![GitHub License](https://img.shields.io/github/license/dapr/testcontainer-node?style=flat&label=License&logo=github)](https://github.com/dapr/testcontainer-node/blob/main/LICENSE) [![Discord](https://img.shields.io/discord/778680217417809931?label=Discord&style=flat&logo=discord)](http://bit.ly/dapr-discord) [![YouTube Channel Views](https://img.shields.io/youtube/channel/views/UCtpSQ9BLB_3EXdWAUQYwnRA?style=flat&label=YouTube%20views&logo=youtube)](https://youtube.com/@daprdev) [![X (formerly Twitter) Follow](https://img.shields.io/twitter/follow/daprdev?logo=x&style=flat)](https://twitter.com/daprdev)

# Dapr TestContainer for NodeJS

Dapr is a CNCF and open-source project that enables developers with consistent application-level APIs to develop
secure, scalable, and resilient cloud-native applications.

The Testcontainers Dapr module for NodeJS enables local development and testing of Dapr-enabled applications by
providing a DaprContainer that sets up a Dapr sidecar instance. This container provides an in-memory implementation of
Dapr APIs by default, facilitating testing without requiring a full Dapr installation or external dependencies.

Usage examples can be found in [`src/DaprContainer.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/DaprContainer.test.ts), [`src/ActorHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/ActorHarness.test.ts), [`src/ConversationHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/ConversationHarness.test.ts), [`src/CryptographyHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/CryptographyHarness.test.ts), [`src/PubSubHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/PubSubHarness.test.ts), [`src/SecretStoreHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/SecretStoreHarness.test.ts), [`src/StateManagementHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/StateManagementHarness.test.ts), and [`src/WorkflowHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/WorkflowHarness.test.ts).

## Using the library

To use this library, add the dependency to your project:

```shell
npm install --save-dev @dapr/testcontainer-node
```

## Configuring Dapr Runtime Version

By default, the container uses Dapr version `1.18.4`. You can override the Dapr runtime version globally for e2e testing using the `DAPR_RUNTIME_VERSION` environment variable:

```shell
export DAPR_RUNTIME_VERSION="1.18.4"
```

You can also specify a custom image when instantiating containers:

```typescript
import { DaprContainer, getDaprRuntimeImage } from "@dapr/testcontainer-node";

const dapr = new DaprContainer(getDaprRuntimeImage("1.18.4"));
```

## Dapr PubSub Testing

You can use `PubSubHarness` or `.withPubSub()` on `DaprContainer` to test Dapr PubSub with an automated RabbitMQ message broker:

```typescript
import { PubSubHarness } from "@dapr/testcontainer-node";

const harness = new PubSubHarness({
  appPort: 8080,
});
await harness.start();

const client = harness.createDaprClient();
await client.pubsub.publish(harness.getPubSubName(), "my-topic", { message: "Hello World" });
await harness.stop();
```

## Dapr State Management Testing

You can use `StateManagementHarness` or `.withStateManagement()` on `DaprContainer` to test Dapr State Management backed by the Redis container:

```typescript
import { StateManagementHarness } from "@dapr/testcontainer-node";

const harness = new StateManagementHarness();
await harness.start();

const client = harness.createDaprClient();
await client.start();
const storeName = harness.getStateStoreName();

// Save and retrieve state
await client.state.save(storeName, [{ key: "my-key", value: { name: "Alice" } }]);
const state = await client.state.get(storeName, "my-key");
await harness.stop();
```

## Dapr Binary Store Testing

`BinaryStoreHarness` or `.withBinaryStore()` on `DaprContainer` configures a `binarystore.in-memory` component.
The Binary Store API requires Dapr 1.19 or a supporting prerelease (such as `1.19.0-rc.4`); the library's default
`1.18.4` runtime does not support it. Set `DAPR_RUNTIME_VERSION` to a supporting version or pass `daprRuntimeImage`:

```typescript
import { BinaryStoreHarness } from "@dapr/testcontainer-node";

await using harness = await new BinaryStoreHarness({
  daprRuntimeImage: "daprio/daprd:1.19.0-rc.4",
  binaryStoreName: "files",
}).start();

await harness.setBinaryFile("example.bin", Buffer.from([0, 128, 255]));
const data = await harness.getBinaryFile("example.bin"); // Buffer
await harness.deleteBinaryFile("example.bin");
```

The helpers use the `v1.0-alpha1` HTTP API because the Node SDK does not yet expose Binary Store operations.
`setBinaryFile` overwrites existing files by default; pass `false` as its third argument to reject duplicates.
Missing files and failed requests throw errors containing the HTTP status and response body.
Optional `prefix`, `maxSize`, and `maxTotalSize` settings are passed to the in-memory component.
The store needs no external storage service; data is local to the sidecar and is lost when it stops.
See `src/BinaryStoreHarness.test.ts` for configuration and integration examples.

## Dapr Vector Testing

`VectorHarness` or `.withVector()` on `DaprContainer` provisions a `vector.meilisearch` component using
the same authenticated `MeilisearchContainer` as Search. The alpha Vector API was merged for Dapr 1.19;
the default `1.18.4` runtime does not support it. Set `DAPR_RUNTIME_VERSION` or `daprRuntimeImage` to an
image containing both the Vector API and the Meilisearch component. Not every 1.19 prerelease contains them.

```typescript
import { VectorHarness } from "@dapr/testcontainer-node";

// Set DAPR_RUNTIME_VERSION to a supporting RC/development tag before running.
await using harness = await new VectorHarness().start();
await harness.createCollection("books", 3, { metric: "DISTANCE_METRIC_COSINE" });

const result = await harness.upsertVectors(
  "books",
  [
    {
      id: "guide",
      values: [1, 0, 0],
      payload: Buffer.from("Dapr guide"),
      metadata: { category: "guide", year: 2026 },
    },
  ],
  {
    options: {
      mode: "INDEXING_MODE_WAIT_FOR_COMPLETION",
      waitTimeout: "10s",
      onWaitTimeout: "INDEXING_WAIT_TIMEOUT_ACTION_FAIL_REQUEST",
    },
  }
);
if (result.failedItems.length) {
  throw new Error(JSON.stringify(result.failedItems));
}

const nearest = await harness.queryVectors("books", {
  vector: { values: [1, 0, 0] },
  filter: { category: { $eq: "guide" } },
  topK: 5,
  includePayload: true,
  scoreThreshold: 0.9,
});
console.log(nearest.matches.map((match) => [match.record.id, match.score]));
```

The helpers implement all nine operations from the
[Vector proto](https://github.com/dapr/dapr/blob/master/dapr/proto/runtime/v1/vector.proto) over
`v1.0-alpha1` HTTP, without requiring Vector bindings in the Node SDK: collection creation/retrieval/listing/deletion,
vector upsert/retrieval/deletion, nearest-neighbor queries, and batch queries. Embedding generation is out
of scope: supply precomputed dense vectors matching the collection's dimensions.

Use either `vector: { values: [...] }` or `byId: "guide"` in a query. Meilisearch's by-ID similarity
query excludes the source record from its results. `getVectors` returns found records in
request order, omitting missing IDs; pass `includeValues: true` to retrieve embeddings. Queries omit
values and payloads by default; opt in with `includeValues` and `includePayload`. Payloads are opaque
`Buffer` bytes, base64-encoded on the wire, while record metadata is structured JSON addressed directly
by portable filters. Request/component metadata is a separate string-valued map. `recordCount` remains
a protobuf JSON string to preserve uint64 precision.

Meilisearch supports cosine similarity only (also selected by the unspecified metric), with higher scores
indicating closer matches; other metrics are rejected by the provider. `scoreThreshold` is inclusive.
`batchQueryVectors` preserves request order and returns a `response` or canonical RPC `error` per query;
check each result rather than assuming that an HTTP success means every query succeeded.

Upserts and deletes default to return-on-acceptance (`INDEX_ACK_QUEUED`), not immediate visibility.
Use the explicit wait options above for deterministic assertions and check upsert `failedItems`.
HTTP failures throw with the status and response body. Wait timeouts must be positive and shorter
than applicable request/resiliency deadlines.

Customize provisioning with `vectorStoreName`, `meilisearchContainer`, `apiKey`, or `timeout` (a Go
duration). Alternatively, set `meilisearchHost` to an external URL reachable **from the sidecar** and
provide its `apiKey`; do not combine this with `meilisearchContainer`. Managed providers use
`getmeili/meilisearch:v1.37.0` with a random master key and analytics disabled. The harness stops managed
containers and its own network; caller-supplied networks and external providers remain running.
`getStartedDaprContainer().getMeilisearchContainer()` exposes the managed provider endpoint and key.

`.withSearch().withVector()` (in either order) shares one managed Meilisearch container and API key.
Conflicting explicit containers or keys are rejected. External and managed providers may also be
combined. Search indexes and Vector collections share Meilisearch's index namespace, so use distinct
names when using both building blocks on one provider.

The Docker integration suite is opt-in with an image known to support Vector:

```powershell
$env:DAPR_VECTOR_RUNTIME_IMAGE = "daprio/daprd:edge" # Or a supporting RC/release image
npm test -- --runInBand --runTestsByPath src\VectorHarness.test.ts src\MeilisearchContainer.test.ts
```

`edge` is a moving development tag. `DAPR_VECTOR_RUNTIME_IMAGE` selects the sidecar for these tests only;
without it, Vector integration tests are skipped but unit tests still run. An explicitly selected
unsupported image fails rather than silently skipping.

## Dapr Search Testing

`SearchHarness` or `.withSearch()` on `DaprContainer` provisions a `search.meilisearch` component and an
authenticated Meilisearch container. Search is an upcoming alpha building block: the default `1.18.4`
runtime does not support it. Select an RC or development image that includes **both** the Search API and
the Meilisearch component using `daprRuntimeImage` or `DAPR_RUNTIME_VERSION`. No unreleased RC tag is assumed.

```typescript
import { SearchHarness } from "@dapr/testcontainer-node";

// Set DAPR_RUNTIME_VERSION to a supporting RC/development tag before running.
await using harness = await new SearchHarness().start();
await harness.createIndex("books", {
  searchableAttributes: "title",
  filterableAttributes: "category",
  sortableAttributes: "price",
});

const result = await harness.indexDocuments(
  "books",
  [{ id: "one", content: Buffer.from(JSON.stringify({ title: "Dapr guide", category: "guide", price: 10 })) }],
  {
    options: {
      mode: "INDEXING_MODE_WAIT_FOR_COMPLETION",
      waitTimeout: "10s",
      onWaitTimeout: "INDEXING_WAIT_TIMEOUT_ACTION_FAIL_REQUEST",
    },
  }
);
if (result.failedItems.length) {
  throw new Error(JSON.stringify(result.failedItems));
}

const page = await harness.search("books", {
  text: "Dapr",
  filter: { category: { $eq: "guide" } },
  includeContent: true,
  topK: 10,
});
console.log(page.hits.map((hit) => JSON.parse(hit.document.content.toString("utf8"))));
```

The helpers follow the [Search proto](https://github.com/dapr/dapr/blob/master/dapr/proto/runtime/v1/search.proto)
through the `v1.0-alpha1` HTTP API; the Node SDK does not yet expose these operations.
They cover index creation/listing/retrieval/deletion, document indexing/retrieval/deletion, and search
(portable filters, native queries, sorting, projection, highlighting, and continuation tokens).
Document content is a `Buffer` containing UTF-8 JSON object bytes, automatically base64-encoded on the wire.
Content is omitted by default for reads; pass `includeContent: true` to retrieve it. Found documents are
returned in request order, with missing IDs omitted. Document metadata is opaque and not searchable.
Counts (`documentCount`, `totalHits`) remain protobuf JSON strings to preserve uint64 precision.

Writes, including document deletion, default to return-on-acceptance. `INDEX_ACK_QUEUED` does not mean
the data is visible yet. Use explicit wait-for-completion options for deterministic assertions, and check
`failedItems` even when the request succeeds. Wait timeouts must be positive and shorter than any
applicable request/resiliency deadline. HTTP failures throw with the status and response body.

Use `searchStoreName`, `meilisearchContainer: new MeilisearchContainer(customImage)`, `apiKey`, or the
component's `timeout` (a Go duration) to customize provisioning. The default image is
`getmeili/meilisearch:v1.37.0`, with a randomly generated master key and analytics disabled.
Alternatively, supply `meilisearchHost` (a URL reachable **from the sidecar**) and `apiKey` to use an
external provider without starting one. Do not combine `meilisearchHost` and `meilisearchContainer`.
The harness stops its managed containers and any network it creates, but leaves caller-supplied networks
and external providers running. `getStartedDaprContainer().getMeilisearchContainer()` exposes the managed
provider's host endpoint and API key for backend-specific assertions.

The Search integration suite is explicitly opt-in until a supporting RC is available. In PowerShell:

```powershell
$env:DAPR_SEARCH_RUNTIME_IMAGE = "daprio/daprd:edge" # Or a supporting RC image when available
npm test -- --runInBand --runTestsByPath src\SearchHarness.test.ts src\MeilisearchContainer.test.ts
```

`edge` is a moving development tag, not a pinned release. `DAPR_SEARCH_RUNTIME_IMAGE` selects the sidecar
image for these tests only. Without it, Search integration
tests are skipped; unit tests and the standalone Meilisearch container test still run. An explicitly
selected unsupported image fails rather than silently skipping the integration checks.

## Dapr Workflow Testing

You can use `WorkflowHarness` or `.withWorkflow()` on `DaprContainer` to test Dapr Workflows with an automated Redis actor state store, placement service, and scheduler service:

```typescript
import { WorkflowHarness } from "@dapr/testcontainer-node";
import { WorkflowRuntime, DaprWorkflowClient } from "@dapr/dapr";

const harness = new WorkflowHarness();
await harness.start();

const runtime = harness.createWorkflowRuntime();
runtime.registerWorkflow(myWorkflow);
runtime.registerActivity(myActivity);
await runtime.start();

const client = harness.createWorkflowClient();
const instanceId = await client.scheduleNewWorkflow(myWorkflow, "input");
const state = await client.waitForWorkflowCompletion(instanceId);

await harness.stop();
```

### Capturing workflow traces

Enable runtime telemetry capture before starting the harness:

```typescript
const harness = new WorkflowHarness().enableTelemetryCapture();
try {
  await harness.start();
  const runtime = harness.createWorkflowRuntime();
  runtime.registerWorkflow(myWorkflow);
  runtime.registerActivity(myActivity);
  await runtime.start();

  const client = harness.createWorkflowClient();
  const instanceId = await client.scheduleNewWorkflow(myWorkflow, "input");
  await client.waitForWorkflowCompletion(instanceId);

  const telemetry = harness.getTelemetryCollector()!;
  const workflowSpan = await telemetry.waitForZipkinSpan((span) => span.name === "orchestration||myworkflow", 30_000);
  const activitySpan = await telemetry.waitForZipkinSpan(
    (span) => span.name === "activity||myactivity" && span.traceId === workflowSpan.traceId,
    30_000
  );
  console.log(workflowSpan.traceId, activitySpan.parentId);
  console.log(telemetry.getZipkinSpans());
} finally {
  await harness.stop();
}
```

Alternatively, pass `{ telemetryCapture: true }` to `WorkflowHarness`, or use
`new DaprContainer().withNetwork(network).withTelemetryCapture()` for any Dapr building block.
Both the builder and started container expose `getTelemetryCollector()` (undefined when capture is disabled).

Like the .NET testcontainer, `DaprTelemetryCollector` receives Dapr's OpenTelemetry-generated runtime spans
through the **Zipkin v2 JSON exporter**, not OTLP. Capture is opt-in and sets sampling to `"1"`, replacing any
configured Zipkin endpoint while preserving other configuration, including OTLP export and actor features.
The receiver binds an available host port, makes it reachable through Testcontainers host-port forwarding,
and stops with the sidecar, including when startup fails. No external tracing backend is needed.

`getZipkinSpans()` returns independent snapshots with trace/span/parent IDs, names, kinds, endpoint metadata,
tags, and microsecond timestamps/durations. Export is asynchronous, so use `waitForZipkinSpan(predicate, timeoutMs, signal?)`
rather than inspecting immediately after a workflow finishes. Waits support `AbortSignal` cancellation and report
captured span details on timeout. Zipkin exports span names in lowercase; workflow and activity names above
correspond to functions named `myWorkflow` and `myActivity`. Filter by trace ID or instance tags when running multiple workflows.
Snapshots remain available after shutdown; collection is in-memory and intended for bounded test runs.

The collector can also be started independently with `await new DaprTelemetryCollector().start()` and disposed
with `stop()` or `await using`. Its local endpoint is available via `getZipkinEndpointAddress()`.
This captures **runtime-exported spans only**; it does not install a Node OpenTelemetry provider or emulate
the .NET SDK's in-process `ActivitySource` listener.

## Dapr Actor Testing

You can use `ActorHarness` or `.withActors()` on `DaprContainer` to test Dapr Actors backed by the Redis actor state store, placement service, and scheduler service:

```typescript
import { ActorHarness } from "@dapr/testcontainer-node";
import { AbstractActor, ActorId } from "@dapr/dapr";
import { TestContainers } from "testcontainers";

interface ICounterActor {
  increment(amount: number): Promise<number>;
  getCount(): Promise<number>;
}

class CounterActor extends AbstractActor implements ICounterActor {
  async increment(amount = 1): Promise<number> {
    const stateManager = this.getStateManager<number>();
    const [hasValue, current] = await stateManager.tryGetState("counter");
    const count = hasValue && current !== null && current !== undefined ? current : 0;
    const next = count + amount;
    await stateManager.setState("counter", next);
    await stateManager.saveState();
    return next;
  }

  async getCount(): Promise<number> {
    const stateManager = this.getStateManager<number>();
    const [hasValue, count] = await stateManager.tryGetState("counter");
    return hasValue && count !== null && count !== undefined ? count : 0;
  }
}

const appPort = 8090;
await TestContainers.exposeHostPorts(appPort);

const harness = new ActorHarness({
  appPort,
  appChannelAddress: "host.testcontainers.internal",
});

// Register actor on server
const server = harness.createDaprServer({
  serverPort: appPort.toString(),
  serverHost: "0.0.0.0",
});
await server.actor.registerActor(CounterActor);
await server.actor.init();
await server.daprServer.start("0.0.0.0", appPort.toString());

// Start harness (starts placement, scheduler, redis, and daprd sidecar)
await harness.start();

// Create actor proxy and invoke methods
const proxy = harness.createActorProxy<ICounterActor>(CounterActor, "counter-1");
const count = await proxy.increment(5); // 5

await harness.stop();
```

## Dapr Conversation Testing

`ConversationHarness` starts Dapr and a CPU-only Ollama container, pulls the small `smollm2:135m` model by default, and configures a `conversation.ollama` component:

```typescript
import { ConversationHarness } from "@dapr/testcontainer-node";

await using harness = await new ConversationHarness().start();
const response = await harness.converse("Reply with the word pong.");
console.log(response.content, response.contextId);
```

Use `modelName`, `ollamaContainer`, or `ollamaEndpoint` in the harness options to override the defaults.

## Dapr Cryptography Testing

`CryptographyHarness` configures the `crypto.dapr.localstorage` component and copies a local directory containing PEM, JWK, or raw symmetric keys into the Dapr sidecar:

```typescript
import { CryptographyHarness } from "@dapr/testcontainer-node";

const harness = new CryptographyHarness({
  keyPath: "./keys",
});
await harness.start();

const client = harness.createDaprClient();
const encrypted = await client.crypto.encrypt("secret data", {
  componentName: harness.getComponentName(),
  keyName: "rsa-key.pem",
  keyWrapAlgorithm: "RSA-OAEP-256",
});
const decrypted = await client.crypto.decrypt(encrypted, {
  componentName: harness.getComponentName(),
});

await harness.stop();
```

## Dapr Secrets Testing

You can use `SecretStoreHarness` or `.withSecretStore()` on `DaprContainer` to test the Dapr Secrets building block using a
local file secret store (`secretstores.local.file`). The harness writes both the component YAML and its backing JSON
secrets file into the container:

```typescript
import { SecretStoreHarness } from "@dapr/testcontainer-node";

const harness = new SecretStoreHarness({
  secrets: {
    secret1: "value1",
    connection: { username: "admin", password: "s3cr3t" },
  },
});
await harness.start();

await harness.getSecretValue("secret1"); // "value1"
await harness.getSecretValue("connection:username"); // "admin" (nested keys are flattened)
await harness.getBulkSecrets();

await harness.stop();
```

## Dapr Distributed Lock Testing

You can use `DistributedLockHarness` or `.withDistributedLock()` on `DaprContainer` to test Dapr Distributed Locks with an automated Redis lock store:

```typescript
import { DistributedLockHarness } from "@dapr/testcontainer-node";
import { LockStatus } from "@dapr/dapr";

const harness = new DistributedLockHarness();
await harness.start();

const client = harness.createDaprClient();
await client.start();

const lockResponse = await client.lock.lock(
  DistributedLockHarness.DistributedLockComponentName,
  "resource-id",
  "owner-id",
  10
);
console.log(lockResponse.success);

const unlockResponse = await client.lock.unlock(
  DistributedLockHarness.DistributedLockComponentName,
  "resource-id",
  "owner-id"
);
console.log(unlockResponse.status === LockStatus.Success);

await harness.stop();
```

Secrets can also be loaded from an existing JSON file on the host, and the nested separator is configurable:

```typescript
const harness = new SecretStoreHarness({
  secretStoreName: "my-secrets",
  secretsFilePath: "./test/secrets.json",
  nestedSeparator: ".",
});
```

To register one or more secret stores directly on a `DaprContainer`:

```typescript
import { DaprContainer } from "@dapr/testcontainer-node";

const dapr = new DaprContainer()
  .withNetwork(network)
  .withSecretStore({ secrets: { alpha: "one" } })
  .withSecretStore({ name: "second-store", secrets: { beta: "two" } });
```

## Versions

This library follows [Semantic Versioning](https://semver.org/).
