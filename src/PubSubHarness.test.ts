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

import bodyParser from "body-parser";
import express from "express";
import { Network, TestContainers } from "testcontainers";
import { CommunicationProtocolEnum, DaprClient, LogLevel } from "@dapr/dapr";
import { DaprComponentNames } from "./Constants";
import { DaprContainer } from "./DaprContainer";
import { PubSubHarness } from "./PubSubHarness";
import { RabbitMQContainer } from "./RabbitMQContainer";
import { Subscription } from "./Subscription";

describe("PubSubHarness and PubSub Support", () => {
  it("should configure DaprContainer with pubsub and rabbitmq", () => {
    const dapr = new DaprContainer().withPubSub({
      pubsubName: "custom-pubsub",
      username: "user",
      password: "password",
      requeueInFailure: false,
    });

    expect(dapr.isPubSubEnabled()).toBe(true);
    expect(dapr.getPubSubOptions()?.pubsubName).toBe("custom-pubsub");
    expect(dapr.getPubSubOptions()?.username).toBe("user");
    expect(dapr.getPubSubOptions()?.password).toBe("password");
    expect(dapr.getPubSubOptions()?.requeueInFailure).toBe(false);
  });

  it("should configure PubSubHarness with default options", () => {
    const harness = new PubSubHarness();
    const dapr = harness.getDaprContainer();
    expect(dapr.isPubSubEnabled()).toBe(true);
    expect(dapr.getAppName()).toBe("pubsub-app");
    expect(harness.getPubSubName()).toBe(DaprComponentNames.PubSubComponentName);
    expect(harness.getPubsubName()).toBe(DaprComponentNames.PubSubComponentName);
  });

  it("should throw when accessing started container before starting", () => {
    const harness = new PubSubHarness();
    expect(() => harness.getStartedDaprContainer()).toThrow("PubSubHarness has not been started. Call start() first.");
  });

  it("should configure PubSubHarness with custom options", () => {
    const customRabbitMQ = new RabbitMQContainer();
    const sub = new Subscription("order-sub", "orders-pubsub", "orders", undefined, "/orders");
    const harness = new PubSubHarness({
      appId: "custom-pubsub-app",
      appPort: 9005,
      appChannelAddress: "host.testcontainers.internal",
      daprLogLevel: "debug",
      daprApiLoggingEnabled: true,
      pubsubName: "orders-pubsub",
      rabbitMQContainer: customRabbitMQ,
      subscriptions: [sub],
    });

    const dapr = harness.getDaprContainer();
    expect(dapr.isPubSubEnabled()).toBe(true);
    expect(dapr.getAppName()).toBe("custom-pubsub-app");
    expect(dapr.getAppPort()).toBe(9005);
    expect(dapr.getAppChannelAddress()).toBe("host.testcontainers.internal");
    expect(dapr.getRabbitMQContainer()).toBe(customRabbitMQ);
    expect(harness.getPubSubName()).toBe("orders-pubsub");
    expect(dapr.getSubscriptions()).toContain(sub);
  });

  it("should publish and receive messages using PubSubHarness with RabbitMQ", async () => {
    const app = express();
    app.use(bodyParser.json({ type: "application/*+json" }));

    let receiver: (data?: unknown) => void;
    const receivedPromise = new Promise((resolve) => {
      receiver = resolve;
    });

    app.post("/events", (req, res) => {
      const data = req.body.data;
      res.sendStatus(200);
      receiver(data);
    });

    const appPort = 8090;
    await using _server = app.listen(appPort);
    await TestContainers.exposeHostPorts(appPort);

    await using network = await new Network().start();
    const harness = new PubSubHarness({
      appId: "pubsub-harness-test-app",
      appPort,
      appChannelAddress: "host.testcontainers.internal",
      daprLogLevel: "info",
      network,
    });

    try {
      await harness.start();

      expect(harness.getHost()).toBeDefined();
      expect(harness.getHttpPort()).toBeGreaterThan(0);
      expect(harness.getGrpcPort()).toBeGreaterThan(0);
      expect(harness.getHttpEndpoint()).toBe(`http://${harness.getHost()}:${harness.getHttpPort()}`);
      expect(harness.getGrpcEndpoint()).toBe(`:${harness.getGrpcPort()}`);

      const client = harness.createDaprClient({
        logger: { level: LogLevel.Debug },
      });

      const grpcClient = harness.createDaprClient({
        communicationProtocol: CommunicationProtocolEnum.GRPC,
      });
      expect(grpcClient).toBeDefined();

      const server = harness.createDaprServer();
      expect(server).toBeDefined();

      let received = false;
      receivedPromise.then(() => {
        received = true;
      });

      const message = { id: 123, text: "Hello RabbitMQ PubSub!" };

      const publishInterval = setInterval(async () => {
        if (!received) {
          try {
            await client.pubsub.publish(harness.getPubSubName(), "topic", message);
          } catch {
            // ignore transient publish errors while consumer registers
          }
        }
      }, 1000);

      await client.pubsub.publish(harness.getPubSubName(), "topic", message);

      const receivedData = await receivedPromise;
      clearInterval(publishInterval);

      expect(receivedData).toEqual(message);
    } finally {
      await harness.stop();
    }
  }, 300_000);

  it("should publish and receive messages using DaprContainer.withPubSub directly", async () => {
    const app = express();
    app.use(bodyParser.json({ type: "application/*+json" }));

    let receiver: (data?: unknown) => void;
    const receivedPromise = new Promise((resolve) => {
      receiver = resolve;
    });

    app.post("/events", (req, res) => {
      const data = req.body.data;
      res.sendStatus(200);
      receiver(data);
    });

    const appPort = 8091;
    await using _server = app.listen(appPort);
    await TestContainers.exposeHostPorts(appPort);

    await using network = await new Network().start();
    const dapr = new DaprContainer()
      .withNetwork(network)
      .withAppName("dapr-pubsub-direct-app")
      .withAppPort(appPort)
      .withAppChannelAddress("host.testcontainers.internal")
      .withDaprLogLevel("info")
      .withPubSub({
        pubsubName: DaprComponentNames.PubSubComponentName,
      });

    await using startedContainer = await dapr.start();

    const client = new DaprClient({
      daprHost: startedContainer.getHost(),
      daprPort: startedContainer.getHttpPort().toString(),
      communicationProtocol: CommunicationProtocolEnum.HTTP,
      logger: { level: LogLevel.Debug },
    });

    let received = false;
    receivedPromise.then(() => {
      received = true;
    });

    const message = { orderId: "ord-999", amount: 49.99 };

    const publishInterval = setInterval(async () => {
      if (!received) {
        try {
          await client.pubsub.publish(DaprComponentNames.PubSubComponentName, "topic", message);
        } catch {
          // ignore transient publish errors
        }
      }
    }, 1000);

    await client.pubsub.publish(DaprComponentNames.PubSubComponentName, "topic", message);

    const receivedData = await receivedPromise;
    clearInterval(publishInterval);

    expect(receivedData).toEqual(message);

    await client.stop();
  }, 300_000);

  it("should support async disposal", async () => {
    const harness = new PubSubHarness();
    await harness[Symbol.asyncDispose]();
  });
});
