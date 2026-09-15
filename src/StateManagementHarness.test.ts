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
import { Network } from "testcontainers";
import { DaprComponentNames } from "./Constants";
import { DaprContainer } from "./DaprContainer";
import { RedisContainer } from "./RedisContainer";
import { StateManagementHarness } from "./StateManagementHarness";

describe("StateManagementHarness and State Management Support", () => {
  it("should configure DaprContainer with state management and redis state store", () => {
    const dapr = new DaprContainer().withStateManagement({
      stateStoreName: "custom-state",
      keyPrefix: "app",
      enableActorStateStore: false,
    });

    expect(dapr.isStateManagementEnabled()).toBe(true);
    expect(dapr.getStateManagementOptions()).toEqual({
      stateStoreName: "custom-state",
      keyPrefix: "app",
      enableActorStateStore: false,
    });
    const components = dapr.getComponents();
    expect(components).toEqual([]);
  });

  it("should configure StateManagementHarness with default options", () => {
    const harness = new StateManagementHarness();
    const dapr = harness.getDaprContainer();
    expect(dapr.isStateManagementEnabled()).toBe(true);
    expect(dapr.getAppName()).toBe("statemanagement-app");
    expect(harness.getStateStoreName()).toBe(DaprComponentNames.StateManagementComponentName);
  });

  it("should configure StateManagementHarness with custom options", () => {
    const customRedis = new RedisContainer();
    const harness = new StateManagementHarness({
      appId: "custom-state-app",
      appPort: 9001,
      appChannelAddress: "127.0.0.1",
      daprLogLevel: "debug",
      daprApiLoggingEnabled: true,
      redisContainer: customRedis,
      redisHost: "custom-redis:6379",
      redisPassword: "secret-password",
      actorStateStore: false,
      keyPrefix: "test-prefix",
      stateStoreName: "my-custom-store",
    });

    const dapr = harness.getDaprContainer();
    expect(dapr.isStateManagementEnabled()).toBe(true);
    expect(dapr.getAppName()).toBe("custom-state-app");
    expect(dapr.getAppPort()).toBe(9001);
    expect(dapr.getAppChannelAddress()).toBe("127.0.0.1");
    expect(dapr.getRedisContainer()).toBe(customRedis);
    expect(harness.getStateStoreName()).toBe("my-custom-store");
  });

  it("should throw when accessing started container properties before start()", () => {
    const harness = new StateManagementHarness();
    expect(() => harness.getStartedDaprContainer()).toThrow("StateManagementHarness has not been started.");
    expect(() => harness.getHost()).toThrow("StateManagementHarness has not been started.");
    expect(() => harness.getHttpPort()).toThrow("StateManagementHarness has not been started.");
    expect(() => harness.getGrpcPort()).toThrow("StateManagementHarness has not been started.");
    expect(() => harness.getHttpEndpoint()).toThrow("StateManagementHarness has not been started.");
    expect(() => harness.getGrpcEndpoint()).toThrow("StateManagementHarness has not been started.");
    expect(() => harness.createDaprClient()).toThrow("StateManagementHarness has not been started.");
  });

  it("should perform basic CRUD state operations using StateManagementHarness with HTTP client", async () => {
    await using network = await new Network().start();
    const harness = new StateManagementHarness({
      appId: "state-crud-app",
      daprLogLevel: "info",
      network,
    });

    try {
      await harness.start();

      expect(harness.getHost()).toBeDefined();
      expect(harness.getHttpPort()).toBeGreaterThan(0);
      expect(harness.getGrpcPort()).toBeGreaterThan(0);
      expect(harness.getHttpEndpoint()).toContain(harness.getHost());
      expect(harness.getGrpcEndpoint()).toContain(harness.getGrpcPort().toString());

      const client = harness.createDaprClient();
      await client.start();
      expect(client.getIsInitialized()).toBe(true);

      const storeName = harness.getStateStoreName();

      // Save state (string, number, object)
      await client.state.save(storeName, [
        { key: "user:1", value: { id: 1, name: "Alice", active: true } },
        { key: "counter", value: 42 },
        { key: "message", value: "Hello Dapr State" },
      ]);

      // Get state
      const user = (await client.state.get(storeName, "user:1")) as { id: number; name: string; active: boolean };
      expect(user).toEqual({ id: 1, name: "Alice", active: true });

      const counter = await client.state.get(storeName, "counter");
      expect(counter).toEqual(42);

      const message = await client.state.get(storeName, "message");
      expect(message).toEqual("Hello Dapr State");

      // Delete state
      await client.state.delete(storeName, "message");
      const deletedMessage = await client.state.get(storeName, "message");
      expect(deletedMessage).toBe("");
    } finally {
      await harness.stop();
    }
  }, 120_000);

  it("should perform bulk state operations and transactional updates using StateManagementHarness", async () => {
    await using network = await new Network().start();
    const harness = new StateManagementHarness({
      appId: "state-bulk-tx-app",
      daprLogLevel: "info",
      network,
    });

    try {
      await harness.start();
      const client = harness.createDaprClient();
      await client.start();

      const storeName = harness.getStateStoreName();

      // Bulk save & bulk get
      await client.state.save(storeName, [
        { key: "item:1", value: "Item 1" },
        { key: "item:2", value: "Item 2" },
        { key: "item:3", value: "Item 3" },
      ]);

      const bulkResults = await client.state.getBulk(storeName, ["item:1", "item:2", "item:3"]);
      expect(bulkResults).toHaveLength(3);
      expect(bulkResults.find((r) => r.key === "item:1")?.data).toEqual("Item 1");
      expect(bulkResults.find((r) => r.key === "item:2")?.data).toEqual("Item 2");
      expect(bulkResults.find((r) => r.key === "item:3")?.data).toEqual("Item 3");

      // Transaction operations: upsert and delete atomically
      await client.state.transaction(storeName, [
        { operation: "upsert", request: { key: "tx:account:1", value: { balance: 100 } } },
        { operation: "upsert", request: { key: "tx:account:2", value: { balance: 200 } } },
        { operation: "delete", request: { key: "item:1" } },
      ]);

      const acc1 = await client.state.get(storeName, "tx:account:1");
      const acc2 = await client.state.get(storeName, "tx:account:2");
      const deletedItem = await client.state.get(storeName, "item:1");

      expect(acc1).toEqual({ balance: 100 });
      expect(acc2).toEqual({ balance: 200 });
      expect(deletedItem).toBe("");
    } finally {
      await harness.stop();
    }
  }, 120_000);

  it("should support custom state store name and gRPC protocol", async () => {
    await using network = await new Network().start();
    const harness = new StateManagementHarness({
      appId: "state-custom-grpc-app",
      daprLogLevel: "info",
      stateStoreName: "custom-redis-store",
      keyPrefix: "grpc-test",
      network,
    });

    try {
      await harness.start();
      expect(harness.getStateStoreName()).toBe("custom-redis-store");

      const grpcClient = harness.createDaprClient({
        communicationProtocol: CommunicationProtocolEnum.GRPC,
      });
      await grpcClient.start();
      expect(grpcClient.getIsInitialized()).toBe(true);

      const storeName = harness.getStateStoreName();

      await grpcClient.state.save(storeName, [{ key: "grpc-key", value: { status: "ok" } }]);

      const result = await grpcClient.state.get(storeName, "grpc-key");
      expect(result).toEqual({ status: "ok" });

      await grpcClient.state.delete(storeName, "grpc-key");
      const afterDelete = await grpcClient.state.get(storeName, "grpc-key");
      expect(afterDelete).toBe("");
    } finally {
      await harness.stop();
    }
  }, 120_000);

  it("should work with Symbol.asyncDispose", async () => {
    await using network = await new Network().start();
    await using harness = new StateManagementHarness({
      appId: "state-dispose-app",
      daprLogLevel: "info",
      network,
    });

    await harness.start();
    const client = harness.createDaprClient();
    await client.start();

    await client.state.save(harness.getStateStoreName(), [{ key: "dispose-test", value: "persisted" }]);
    const val = await client.state.get(harness.getStateStoreName(), "dispose-test");
    expect(val).toBe("persisted");
  }, 120_000);

  it("should configure and run state management with DaprContainer directly", async () => {
    await using network = await new Network().start();
    const dapr = new DaprContainer()
      .withNetwork(network)
      .withAppName("dapr-state-direct-app")
      .withDaprLogLevel("info")
      .withStateManagement({
        stateStoreName: "direct-statestore",
      });

    await using startedContainer = await dapr.start();

    const client = new DaprClient({
      daprHost: startedContainer.getHost(),
      daprPort: startedContainer.getHttpPort().toString(),
    });
    await client.start();

    try {
      await client.state.save("direct-statestore", [{ key: "direct-key", value: "direct-value" }]);
      const result = await client.state.get("direct-statestore", "direct-key");
      expect(result).toBe("direct-value");
    } finally {
      await client.stop();
    }
  }, 120_000);
});
