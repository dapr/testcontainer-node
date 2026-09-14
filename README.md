# Dapr TestContainer for NodeJS

Dapr is a CNCF and open-source project that enables developers with consistent application-level APIs to develop
secure, scalable, and resilient cloud-native applications.

The Testcontainers Dapr module for NodeJS enables local development and testing of Dapr-enabled applications by
providing a DaprContainer that sets up a Dapr sidecar instance. This container provides an in-memory implementation of
Dapr APIs by default, facilitating testing without requiring a full Dapr installation or external dependencies.

Usage examples can be found in [`src/DaprContainer.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/DaprContainer.test.ts), [`src/PubSubHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/PubSubHarness.test.ts), [`src/SecretStoreHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/SecretStoreHarness.test.ts), [`src/StateManagementHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/StateManagementHarness.test.ts), and [`src/WorkflowHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/WorkflowHarness.test.ts).

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
