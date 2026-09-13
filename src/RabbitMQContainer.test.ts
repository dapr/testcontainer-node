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

import { Component } from "./Component";
import { DaprComponentNames } from "./Constants";
import {
  RABBITMQ_DEFAULT_IMAGE,
  RABBITMQ_DEFAULT_PASSWORD,
  RABBITMQ_DEFAULT_PORT,
  RABBITMQ_DEFAULT_USER,
  RabbitMQContainer,
  RabbitMqContainer,
} from "./RabbitMQContainer";

describe("RabbitMQContainer", () => {
  it("should have correct defaults", () => {
    expect(RABBITMQ_DEFAULT_IMAGE).toBe("rabbitmq:alpine");
    expect(RABBITMQ_DEFAULT_PORT).toBe(5672);
    expect(RABBITMQ_DEFAULT_USER).toBe("guest");
    expect(RABBITMQ_DEFAULT_PASSWORD).toBe("guest");

    const container = new RabbitMQContainer();
    expect(container.getPort()).toBe(RABBITMQ_DEFAULT_PORT);
    expect(container.getUsername()).toBe(RABBITMQ_DEFAULT_USER);
    expect(container.getPassword()).toBe(RABBITMQ_DEFAULT_PASSWORD);
  });

  it("should allow overriding port, username, and password", () => {
    const container = new RabbitMQContainer().withPort(5673).withUsername("myuser").withPassword("mypassword");
    expect(container.getPort()).toBe(5673);
    expect(container.getUsername()).toBe("myuser");
    expect(container.getPassword()).toBe("mypassword");
  });

  it("should support RabbitMqContainer alias", () => {
    const container = new RabbitMqContainer();
    expect(container).toBeInstanceOf(RabbitMQContainer);
  });

  it("should create pubsub component with default options", () => {
    const component = RabbitMQContainer.createPubSubComponent();
    expect(component).toBeInstanceOf(Component);
    expect(component.name).toBe(DaprComponentNames.PubSubComponentName);
    expect(component.type).toBe("pubsub.rabbitmq");
    expect(component.version).toBe("v1");

    const metadata = component.getMetadata();
    expect(metadata).toEqual([
      { name: "protocol", value: "amqp" },
      { name: "hostname", value: `localhost:${RABBITMQ_DEFAULT_PORT}` },
      { name: "username", value: "guest" },
      { name: "password", value: "guest" },
      { name: "requeueInFailure", value: "true" },
    ]);
  });

  it("should create pubsub component with custom options", () => {
    const container = new RabbitMQContainer().withPort(5672).withUsername("admin").withPassword("secret");
    const component = container.createPubSubComponent({
      name: "custom-pubsub",
      protocol: "amqps",
      requeueInFailure: false,
      durable: true,
      deletedWhenUnused: false,
      autoAck: false,
      deliveryMode: 2,
      metadata: [{ name: "clientName", value: "test-client" }],
    });

    expect(component.name).toBe("custom-pubsub");
    const metadata = component.getMetadata();
    expect(metadata).toEqual([
      { name: "protocol", value: "amqps" },
      { name: "hostname", value: "rabbitmq:5672" },
      { name: "username", value: "admin" },
      { name: "password", value: "secret" },
      { name: "requeueInFailure", value: "false" },
      { name: "durable", value: "true" },
      { name: "deletedWhenUnused", value: "false" },
      { name: "autoAck", value: "false" },
      { name: "deliveryMode", value: "2" },
      { name: "clientName", value: "test-client" },
    ]);
  });

  it("should start and stop a RabbitMQ container standalone", async () => {
    const container = new RabbitMQContainer();
    await using started = await container.start();

    expect(started.getRabbitMQPort()).toBeGreaterThan(0);
    expect(started.getRabbitMQHost()).toBeDefined();
    expect(started.getUsername()).toBe("guest");
    expect(started.getPassword()).toBe("guest");
    expect(started.getConnectionString()).toBe(
      `amqp://guest:guest@${started.getRabbitMQHost()}:${started.getRabbitMQPort()}`
    );
  }, 120_000);
});
