# Dapr TestContainer for NodeJS

Dapr is a CNCF and open-source project that enables developers with consistent application-level APIs to develop
secure, scalable, and resilient cloud-native applications.

The Testcontainers Dapr module for NodeJS enables local development and testing of Dapr-enabled applications by
providing a DaprContainer that sets up a Dapr sidecar instance. This container provides an in-memory implementation of
Dapr APIs by default, facilitating testing without requiring a full Dapr installation or external dependencies.

A usage example can be found in [`src/DaprContainer.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/DaprContainer.test.ts), [`src/StateManagementHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/StateManagementHarness.test.ts), [`src/WorkflowHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/WorkflowHarness.test.ts), and [`src/ActorHarness.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/ActorHarness.test.ts).

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

## Versions

This library follows [Semantic Versioning](https://semver.org/).
