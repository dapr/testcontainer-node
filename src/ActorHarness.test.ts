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

import { AbstractActor, ActorId, ActorProxyBuilder, DaprClient } from "@dapr/dapr";
import ActorRuntime from "@dapr/dapr/actors/runtime/ActorRuntime";
import { Network, TestContainers } from "testcontainers";
import { ActorHarness } from "./ActorHarness";
import { Configuration } from "./Configuration";
import { DaprComponentNames } from "./Constants";
import { DaprContainer } from "./DaprContainer";
import { RedisContainer } from "./RedisContainer";

interface IDemoCounterActor {
  sayHello(name: string): Promise<string>;
  increment(amount?: number): Promise<number>;
  getCount(): Promise<number>;
  setScore(score: number): Promise<void>;
  getScore(): Promise<number | null>;
  clearScore(): Promise<void>;
}

class DemoCounterActor extends AbstractActor implements IDemoCounterActor {
  async sayHello(name: string): Promise<string> {
    return `Hello, ${name}!`;
  }

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

  async setScore(score: number): Promise<void> {
    const stateManager = this.getStateManager<number>();
    await stateManager.setState("score", score);
    await stateManager.saveState();
  }

  async getScore(): Promise<number | null> {
    const stateManager = this.getStateManager<number>();
    const [hasValue, score] = await stateManager.tryGetState("score");
    return hasValue ? score : null;
  }

  async clearScore(): Promise<void> {
    const stateManager = this.getStateManager<number>();
    await stateManager.removeState("score");
    await stateManager.saveState();
  }
}

describe("ActorHarness and Actor Support", () => {
  afterEach(() => {
    try {
      ActorRuntime.resetForTesting();
    } catch {
      // Ignore
    }
  });

  it("should configure DaprContainer with actors and redis state store", () => {
    const dapr = new DaprContainer().withActors({
      stateStoreName: "custom-actor-state",
      keyPrefix: "app-actor",
      enableActorStateStore: true,
      actorStateTTL: true,
    });

    expect(dapr.isActorsEnabled()).toBe(true);
    expect(dapr.getActorOptions()).toEqual({
      stateStoreName: "custom-actor-state",
      keyPrefix: "app-actor",
      enableActorStateStore: true,
      actorStateTTL: true,
    });
    const components = dapr.getComponents();
    expect(components).toEqual([]);
  });

  it("should configure ActorHarness with default options", () => {
    const harness = new ActorHarness();
    const dapr = harness.getDaprContainer();
    expect(dapr.isActorsEnabled()).toBe(true);
    expect(dapr.getAppName()).toBe("actor-app");
    expect(harness.getStateStoreName()).toBe(DaprComponentNames.StateManagementComponentName);
  });

  it("should configure ActorHarness with custom options", () => {
    const customRedis = new RedisContainer();
    const customConfig = new Configuration("customActorConfig", undefined, undefined, [
      { name: "ActorStateTTL", enabled: true },
    ]);
    const harness = new ActorHarness({
      appId: "custom-actor-app",
      appPort: 9005,
      appChannelAddress: "127.0.0.1",
      daprLogLevel: "debug",
      daprApiLoggingEnabled: true,
      redisContainer: customRedis,
      redisHost: "custom-redis:6379",
      redisPassword: "secret-actor-password",
      actorStateStore: true,
      actorStateTTL: true,
      keyPrefix: "actor-prefix",
      stateStoreName: "my-actor-store",
      configuration: customConfig,
    });

    const dapr = harness.getDaprContainer();
    expect(dapr.isActorsEnabled()).toBe(true);
    expect(dapr.getAppName()).toBe("custom-actor-app");
    expect(dapr.getAppPort()).toBe(9005);
    expect(dapr.getAppChannelAddress()).toBe("127.0.0.1");
    expect(dapr.getRedisContainer()).toBe(customRedis);
    expect(dapr.getConfiguration()).toBe(customConfig);
    expect(harness.getStateStoreName()).toBe("my-actor-store");
  });

  it("should throw when accessing started container properties before start()", () => {
    const harness = new ActorHarness();
    expect(() => harness.getStartedDaprContainer()).toThrow("ActorHarness has not been started.");
    expect(() => harness.getHost()).toThrow("ActorHarness has not been started.");
    expect(() => harness.getHttpPort()).toThrow("ActorHarness has not been started.");
    expect(() => harness.getGrpcPort()).toThrow("ActorHarness has not been started.");
    expect(() => harness.getHttpEndpoint()).toThrow("ActorHarness has not been started.");
    expect(() => harness.getGrpcEndpoint()).toThrow("ActorHarness has not been started.");
    expect(() => harness.createDaprClient()).toThrow("ActorHarness has not been started.");
    expect(() => harness.createActorProxyBuilder(DemoCounterActor)).toThrow("ActorHarness has not been started.");
    expect(() => harness.createActorProxy(DemoCounterActor, "test-id")).toThrow("ActorHarness has not been started.");
  });

  it("should run actor method invocation and state persistence end-to-end using ActorHarness", async () => {
    const appPort = 8091;
    await TestContainers.exposeHostPorts(appPort);

    const network = await new Network().start();
    const harness = new ActorHarness({
      appId: "actor-test-app",
      appPort,
      appChannelAddress: "host.testcontainers.internal",
      daprLogLevel: "info",
      network,
    });

    const server = harness.createDaprServer({
      serverPort: appPort.toString(),
      serverHost: "0.0.0.0",
    });
    await server.actor.registerActor(DemoCounterActor);
    await server.actor.init();
    await server.daprServer.start("0.0.0.0", appPort.toString());

    try {
      await harness.start();

      expect(harness.getHost()).toBeDefined();
      expect(harness.getHttpPort()).toBeGreaterThan(0);
      expect(harness.getGrpcPort()).toBeGreaterThan(0);
      expect(harness.getHttpEndpoint()).toContain(harness.getHost());
      expect(harness.getGrpcEndpoint()).toContain(harness.getGrpcPort().toString());

      const registeredActors = await server.actor.getRegisteredActors();
      expect(registeredActors).toContain("DemoCounterActor");

      const proxy1 = harness.createActorProxy<IDemoCounterActor>(DemoCounterActor, "counter-1");
      const hello = await proxy1.sayHello("Dapr Actors");
      expect(hello).toBe("Hello, Dapr Actors!");

      // Test actor state increment
      const count1 = await proxy1.increment(5);
      expect(count1).toBe(5);
      const count2 = await proxy1.increment(3);
      expect(count2).toBe(8);
      expect(await proxy1.getCount()).toBe(8);

      // Verify actor state isolation with a second actor instance
      const proxy2 = harness.createActorProxy<IDemoCounterActor>(DemoCounterActor, new ActorId("counter-2"));
      expect(await proxy2.getCount()).toBe(0);
      await proxy2.increment(10);
      expect(await proxy2.getCount()).toBe(10);
      // Counter-1 remains untouched
      expect(await proxy1.getCount()).toBe(8);

      // Test state CRUD within actor
      await proxy1.setScore(100);
      expect(await proxy1.getScore()).toBe(100);
      await proxy1.clearScore();
      expect(await proxy1.getScore()).toBeNull();
    } finally {
      await harness.stop();
      await network.stop();
    }
  }, 120_000);

  it("should support ActorProxyBuilder and custom state store name", async () => {
    const appPort = 8092;
    await TestContainers.exposeHostPorts(appPort);

    const network = await new Network().start();
    const harness = new ActorHarness({
      appId: "actor-custom-store-app",
      appPort,
      appChannelAddress: "host.testcontainers.internal",
      stateStoreName: "custom-actor-store",
      keyPrefix: "actor-test",
      daprLogLevel: "info",
      network,
    });

    const server = harness.createDaprServer({
      serverPort: appPort.toString(),
      serverHost: "0.0.0.0",
    });
    await server.actor.registerActor(DemoCounterActor);
    await server.actor.init();
    await server.daprServer.start("0.0.0.0", appPort.toString());

    try {
      await harness.start();
      expect(harness.getStateStoreName()).toBe("custom-actor-store");

      const builder = harness.createActorProxyBuilder<IDemoCounterActor>(DemoCounterActor);
      expect(builder).toBeInstanceOf(ActorProxyBuilder);

      const proxy = builder.build(new ActorId("custom-actor-1"));
      const greeting = await proxy.sayHello("Custom Store");
      expect(greeting).toBe("Hello, Custom Store!");

      const initialCount = await proxy.increment(42);
      expect(initialCount).toBe(42);
      expect(await proxy.getCount()).toBe(42);
    } finally {
      await harness.stop();
      await network.stop();
    }
  }, 120_000);

  it("should work with Symbol.asyncDispose", async () => {
    const appPort = 8093;
    await TestContainers.exposeHostPorts(appPort);

    const network = await new Network().start();
    try {
      await using harness = new ActorHarness({
        appId: "actor-dispose-app",
        appPort,
        appChannelAddress: "host.testcontainers.internal",
        daprLogLevel: "info",
        network,
      });

      const server = harness.createDaprServer({
        serverPort: appPort.toString(),
        serverHost: "0.0.0.0",
      });
      await server.actor.registerActor(DemoCounterActor);
      await server.actor.init();
      await server.daprServer.start("0.0.0.0", appPort.toString());

      await harness.start();

      const proxy = harness.createActorProxy<IDemoCounterActor>(DemoCounterActor, "dispose-actor");
      expect(await proxy.sayHello("Dispose")).toBe("Hello, Dispose!");
    } finally {
      await network.stop();
    }
  }, 120_000);

  it("should configure and run actors with DaprContainer directly", async () => {
    const appPort = 8099;
    await TestContainers.exposeHostPorts(appPort);

    const network = await new Network().start();
    const dapr = new DaprContainer()
      .withNetwork(network)
      .withAppName("dapr-actor-direct-app")
      .withAppPort(appPort)
      .withAppChannelAddress("host.testcontainers.internal")
      .withDaprLogLevel("info")
      .withActors({
        stateStoreName: "direct-actor-statestore",
      });

    const server = new (await import("@dapr/dapr")).DaprServer({
      serverHost: "0.0.0.0",
      serverPort: appPort.toString(),
    });
    await server.actor.registerActor(DemoCounterActor);
    await server.actor.init();
    await server.daprServer.start("0.0.0.0", appPort.toString());

    try {
      const startedContainer = await dapr.start();

      const client = new DaprClient({
        daprHost: startedContainer.getHost(),
        daprPort: startedContainer.getHttpPort().toString(),
      });
      await client.start();

      (server as any).client = client;
      if ((server as any).actor) {
        (server as any).actor.client = client;
      }
      if ((server as any).daprServer) {
        (server as any).daprServer.client = (client as any).daprClient;
      }

      const actorRuntime = (ActorRuntime as any).instance;
      if (actorRuntime) {
        actorRuntime.daprClient = client;
        if (actorRuntime.actorManagers) {
          for (const manager of actorRuntime.actorManagers.values()) {
            manager.daprClient = client;
          }
        }
      }

      try {
        const builder = new ActorProxyBuilder<IDemoCounterActor>(DemoCounterActor, client);
        const proxy = builder.build(new ActorId("direct-actor-1"));
        expect(await proxy.sayHello("Direct")).toBe("Hello, Direct!");
        expect(await proxy.increment(7)).toBe(7);
        expect(await proxy.getCount()).toBe(7);
      } finally {
        await client.stop();
        await startedContainer.stop();
      }
    } finally {
      await server.stop();
      await network.stop();
    }
  }, 120_000);
});
