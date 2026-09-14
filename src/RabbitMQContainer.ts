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

import { AbstractStartedContainer, GenericContainer, StartedTestContainer, Wait } from "testcontainers";
import { Component, MetadataEntry } from "./Component";
import { DaprComponentNames } from "./Constants";

export const RABBITMQ_DEFAULT_IMAGE = "rabbitmq:alpine";
export const RABBITMQ_DEFAULT_PORT = 5672;
export const RABBITMQ_DEFAULT_USER = "admin";
export const RABBITMQ_DEFAULT_PASSWORD = "admin";

export type RabbitMQPubSubOptions = {
  name?: string;
  hostname?: string;
  username?: string;
  password?: string;
  protocol?: string;
  requeueInFailure?: boolean;
  durable?: boolean;
  deletedWhenUnused?: boolean;
  autoAck?: boolean;
  deliveryMode?: number;
  metadata?: MetadataEntry[];
};

export class RabbitMQContainer extends GenericContainer {
  private rabbitMQPort = RABBITMQ_DEFAULT_PORT;
  private username = RABBITMQ_DEFAULT_USER;
  private password = RABBITMQ_DEFAULT_PASSWORD;

  constructor(image: string = RABBITMQ_DEFAULT_IMAGE) {
    super(image);
    this.withEnvironment({
      RABBITMQ_DEFAULT_USER: this.username,
      RABBITMQ_DEFAULT_PASS: this.password,
    })
      .withExposedPorts(this.rabbitMQPort)
      .withWaitStrategy(Wait.forLogMessage(/Server startup complete/i))
      .withStartupTimeout(120_000);
  }

  public withPort(port: number): this {
    this.rabbitMQPort = port;
    this.withExposedPorts(port);
    return this;
  }

  public getPort(): number {
    return this.rabbitMQPort;
  }

  public withUsername(username: string): this {
    this.username = username;
    this.withEnvironment({
      RABBITMQ_DEFAULT_USER: username,
      RABBITMQ_DEFAULT_PASS: this.password,
    });
    return this;
  }

  public getUsername(): string {
    return this.username;
  }

  public withPassword(password: string): this {
    this.password = password;
    this.withEnvironment({
      RABBITMQ_DEFAULT_USER: this.username,
      RABBITMQ_DEFAULT_PASS: password,
    });
    return this;
  }

  public getPassword(): string {
    return this.password;
  }

  public override async start(): Promise<StartedRabbitMQContainer> {
    return new StartedRabbitMQContainer(await super.start(), this.rabbitMQPort, this.username, this.password);
  }

  /**
   * Creates a PubSub Dapr component configured for this RabbitMQ instance.
   *
   * @param options Configuration options for the pubsub component.
   * @returns A new Component instance.
   */
  public createPubSubComponent(options?: RabbitMQPubSubOptions): Component {
    return RabbitMQContainer.createPubSubComponent({
      ...options,
      hostname: options?.hostname ?? `rabbitmq:${this.rabbitMQPort}`,
      username: options?.username ?? this.username,
      password: options?.password ?? this.password,
    });
  }

  /**
   * Static helper to build a RabbitMQ PubSub component.
   *
   * @param options Configuration options for the pubsub component.
   * @returns A new Component instance.
   */
  public static createPubSubComponent(options?: RabbitMQPubSubOptions): Component {
    const name = options?.name ?? DaprComponentNames.PubSubComponentName;
    const protocol = options?.protocol ?? "amqp";
    const hostname = options?.hostname ?? `localhost:${RABBITMQ_DEFAULT_PORT}`;
    const username = options?.username ?? RABBITMQ_DEFAULT_USER;
    const password = options?.password ?? RABBITMQ_DEFAULT_PASSWORD;
    const requeueInFailure = options?.requeueInFailure ?? true;

    const metadata: MetadataEntry[] = [
      { name: "protocol", value: protocol },
      { name: "hostname", value: hostname },
      { name: "username", value: username },
      { name: "password", value: password },
      { name: "requeueInFailure", value: requeueInFailure.toString() },
    ];

    if (options?.durable !== undefined) {
      metadata.push({ name: "durable", value: options.durable.toString() });
    }
    if (options?.deletedWhenUnused !== undefined) {
      metadata.push({ name: "deletedWhenUnused", value: options.deletedWhenUnused.toString() });
    }
    if (options?.autoAck !== undefined) {
      metadata.push({ name: "autoAck", value: options.autoAck.toString() });
    }
    if (options?.deliveryMode !== undefined) {
      metadata.push({ name: "deliveryMode", value: options.deliveryMode.toString() });
    }
    if (options?.metadata) {
      metadata.push(...options.metadata);
    }

    return new Component(name, "pubsub.rabbitmq", "v1", metadata);
  }
}

export class StartedRabbitMQContainer extends AbstractStartedContainer {
  constructor(
    startedTestContainer: StartedTestContainer,
    private readonly internalPort: number = RABBITMQ_DEFAULT_PORT,
    private readonly username: string = RABBITMQ_DEFAULT_USER,
    private readonly password: string = RABBITMQ_DEFAULT_PASSWORD
  ) {
    super(startedTestContainer);
  }

  public getRabbitMQPort(): number {
    return this.getMappedPort(this.internalPort);
  }

  public getRabbitMQHost(): string {
    return this.getHost();
  }

  public getUsername(): string {
    return this.username;
  }

  public getPassword(): string {
    return this.password;
  }

  public getConnectionString(): string {
    const encodedUsername = encodeURIComponent(this.username);
    const encodedPassword = encodeURIComponent(this.password);
    return `amqp://${encodedUsername}:${encodedPassword}@${this.getRabbitMQHost()}:${this.getRabbitMQPort()}`;
  }
}

export { RabbitMQContainer as RabbitMqContainer, StartedRabbitMQContainer as StartedRabbitMqContainer };
