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

export const REDIS_DEFAULT_IMAGE = "redis:alpine";
export const REDIS_DEFAULT_PORT = 6379;

export type RedisStateStoreOptions = {
  name?: string;
  redisHost?: string;
  redisPassword?: string;
  actorStateStore?: boolean;
  keyPrefix?: string;
};

export type RedisLockOptions = {
  name?: string;
  redisHost?: string;
  redisPassword?: string;
};

export class RedisContainer extends GenericContainer {
  private redisPort = REDIS_DEFAULT_PORT;

  constructor(image: string = REDIS_DEFAULT_IMAGE) {
    super(image);
    this.withExposedPorts(this.redisPort)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/i))
      .withStartupTimeout(120_000);
  }

  public withPort(port: number): this {
    this.redisPort = port;
    this.withExposedPorts(port);
    return this;
  }

  public withPassword(password: string): this {
    this.withCommand(["redis-server", "--requirepass", password]);
    return this;
  }

  public getPort(): number {
    return this.redisPort;
  }

  public override async start(): Promise<StartedRedisContainer> {
    return new StartedRedisContainer(await super.start(), this.redisPort);
  }

  /**
   * Creates a state store Dapr component configured for this Redis instance.
   *
   * @param options Configuration options for the state store component.
   * @returns A new Component instance.
   */
  public createStateStoreComponent(options?: RedisStateStoreOptions): Component {
    return RedisContainer.createStateStoreComponent({
      ...options,
      redisHost: options?.redisHost ?? `redis:${this.redisPort}`,
    });
  }

  /**
   * Creates a distributed lock Dapr component configured for this Redis instance.
   *
   * @param options Configuration options for the lock component.
   * @returns A new Component instance.
   */
  public createDistributedLockComponent(options?: RedisLockOptions): Component {
    return RedisContainer.createDistributedLockComponent({
      ...options,
      redisHost: options?.redisHost ?? `redis:${this.redisPort}`,
    });
  }

  /**
   * Static helper to build a Redis state store component.
   *
   * @param options Configuration options for the state store component.
   * @returns A new Component instance.
   */
  public static createStateStoreComponent(options?: RedisStateStoreOptions): Component {
    const name = options?.name ?? DaprComponentNames.StateManagementComponentName;
    const redisHost = options?.redisHost ?? `localhost:${REDIS_DEFAULT_PORT}`;
    const redisPassword = options?.redisPassword ?? "";
    const actorStateStore = options?.actorStateStore ?? true;

    const metadata: MetadataEntry[] = [
      { name: "redisHost", value: redisHost },
      { name: "redisPassword", value: redisPassword },
    ];

    if (actorStateStore) {
      metadata.push({ name: "actorStateStore", value: "true" });
    }

    if (options?.keyPrefix) {
      metadata.push({ name: "keyPrefix", value: options.keyPrefix });
    }

    return new Component(name, "state.redis", "v1", metadata);
  }

  /**
   * Static helper to build a Redis distributed lock component.
   *
   * @param options Configuration options for the lock component.
   * @returns A new Component instance.
   */
  public static createDistributedLockComponent(options?: RedisLockOptions): Component {
    const name = options?.name ?? DaprComponentNames.DistributedLockComponentName;
    const redisHost = options?.redisHost ?? `localhost:${REDIS_DEFAULT_PORT}`;
    const redisPassword = options?.redisPassword ?? "";

    const metadata: MetadataEntry[] = [
      { name: "redisHost", value: redisHost },
      { name: "redisPassword", value: redisPassword },
    ];

    return new Component(name, "lock.redis", "v1", metadata);
  }
}

export class StartedRedisContainer extends AbstractStartedContainer {
  constructor(
    startedTestContainer: StartedTestContainer,
    private readonly internalPort: number = REDIS_DEFAULT_PORT
  ) {
    super(startedTestContainer);
  }

  public getRedisPort(): number {
    return this.getMappedPort(this.internalPort);
  }

  public getRedisHost(): string {
    return this.getHost();
  }

  public getConnectionString(): string {
    return `redis://${this.getRedisHost()}:${this.getRedisPort()}`;
  }
}
