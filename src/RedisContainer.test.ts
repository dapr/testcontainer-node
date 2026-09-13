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
import { REDIS_DEFAULT_IMAGE, REDIS_DEFAULT_PORT, RedisContainer } from "./RedisContainer";

describe("RedisContainer", () => {
  it("should have correct defaults", () => {
    expect(REDIS_DEFAULT_IMAGE).toBe("redis:alpine");
    const container = new RedisContainer();
    expect(container.getPort()).toBe(REDIS_DEFAULT_PORT);
  });

  it("should allow overriding port", () => {
    const container = new RedisContainer().withPort(6380);
    expect(container.getPort()).toBe(6380);
  });

  it("should create state store component with default options", () => {
    const component = RedisContainer.createStateStoreComponent();
    expect(component).toBeInstanceOf(Component);
    expect(component.name).toBe(DaprComponentNames.StateManagementComponentName);
    expect(component.type).toBe("state.redis");
    expect(component.version).toBe("v1");

    const metadata = component.getMetadata();
    expect(metadata).toEqual([
      { name: "redisHost", value: `localhost:${REDIS_DEFAULT_PORT}` },
      { name: "redisPassword", value: "" },
      { name: "actorStateStore", value: "true" },
    ]);
  });

  it("should create state store component with custom options", () => {
    const container = new RedisContainer().withPort(6379);
    const component = container.createStateStoreComponent({
      name: "custom-store",
      redisPassword: "secret-password",
      keyPrefix: "app-prefix",
      actorStateStore: false,
    });

    expect(component.name).toBe("custom-store");
    const metadata = component.getMetadata();
    expect(metadata).toEqual([
      { name: "redisHost", value: "redis:6379" },
      { name: "redisPassword", value: "secret-password" },
      { name: "keyPrefix", value: "app-prefix" },
    ]);
  });

  it("should create distributed lock component with default options", () => {
    const component = RedisContainer.createDistributedLockComponent();
    expect(component).toBeInstanceOf(Component);
    expect(component.name).toBe(DaprComponentNames.DistributedLockComponentName);
    expect(component.type).toBe("lock.redis");
    expect(component.version).toBe("v1");

    const metadata = component.getMetadata();
    expect(metadata).toEqual([
      { name: "redisHost", value: `localhost:${REDIS_DEFAULT_PORT}` },
      { name: "redisPassword", value: "" },
    ]);
  });

  it("should create distributed lock component from instance", () => {
    const container = new RedisContainer();
    const component = container.createDistributedLockComponent({
      name: "custom-lock",
      redisPassword: "pass",
    });

    expect(component.name).toBe("custom-lock");
    const metadata = component.getMetadata();
    expect(metadata).toEqual([
      { name: "redisHost", value: "redis:6379" },
      { name: "redisPassword", value: "pass" },
    ]);
  });
});
