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
import { MEILISEARCH_DEFAULT_PORT, MeilisearchContainer } from "./MeilisearchContainer";

describe("MeilisearchContainer", () => {
  it("generates an isolated master key and configures the search component", () => {
    const container = new MeilisearchContainer();
    expect(container.getPort()).toBe(MEILISEARCH_DEFAULT_PORT);
    expect(container.getApiKey().length).toBeGreaterThanOrEqual(16);
    expect(container.getApiKey()).not.toBe(new MeilisearchContainer().getApiKey());
    const component = container.createSearchComponent();
    expect(component).toBeInstanceOf(Component);
    expect(component.name).toBe("search");
    expect(component.type).toBe("search.meilisearch");
    expect(component.version).toBe("v1");
    expect(component.getMetadata()).toEqual([
      { name: "host", value: "http://meilisearch:7700" },
      { name: "apiKey", value: container.getApiKey() },
    ]);
  });

  it("supports a custom image, key, and component metadata", () => {
    const container = new MeilisearchContainer("getmeili/meilisearch:custom").withApiKey("test-master-key-1234");
    expect(
      container.createSearchComponent({ name: "books", host: "http://custom:7700", timeout: "10s" }).getMetadata()
    ).toEqual([
      { name: "host", value: "http://custom:7700" },
      { name: "apiKey", value: "test-master-key-1234" },
      { name: "timeout", value: "10s" },
    ]);
    expect(() => container.withApiKey("short")).toThrow("at least 16");
  });

  it("supports externally managed stores without a key", () => {
    expect(MeilisearchContainer.createSearchComponent().getMetadata()).toEqual([
      { name: "host", value: "http://localhost:7700" },
      { name: "apiKey", value: "" },
    ]);
  });

  it("creates vector components using the same provider credentials and metadata", () => {
    const container = new MeilisearchContainer().withApiKey("test-master-key-1234");
    const component = container.createVectorComponent();
    expect(component).toMatchObject({ name: "vector", type: "vector.meilisearch", version: "v1" });
    expect(component.getMetadata()).toEqual(container.createSearchComponent().getMetadata());
    expect(
      container
        .createVectorComponent({
          name: "embeddings",
          host: "https://custom:7700",
          apiKey: "override-key",
          timeout: "20s",
        })
        .getMetadata()
    ).toEqual([
      { name: "host", value: "https://custom:7700" },
      { name: "apiKey", value: "override-key" },
      { name: "timeout", value: "20s" },
    ]);
    expect(MeilisearchContainer.createVectorComponent().getMetadata()).toEqual([
      { name: "host", value: "http://localhost:7700" },
      { name: "apiKey", value: "" },
    ]);
    expect(() => MeilisearchContainer.createVectorComponent({ name: "../bad" })).toThrow("Vector store name");
    expect(() => MeilisearchContainer.createVectorComponent({ host: "redis://localhost" })).toThrow("HTTP or HTTPS");
  });

  it("starts an authenticated Meilisearch server", async () => {
    await using started = await new MeilisearchContainer().start();
    expect((await fetch(`${started.getHttpEndpoint()}/health`)).status).toBe(200);
    const response = await fetch(`${started.getHttpEndpoint()}/indexes`, {
      headers: { Authorization: `Bearer ${started.getApiKey()}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ results: [] });
    expect((await fetch(`${started.getHttpEndpoint()}/indexes`)).status).toBe(401);
  }, 180_000);
});
