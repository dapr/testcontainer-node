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

import { randomBytes } from "node:crypto";
import { AbstractStartedContainer, GenericContainer, StartedTestContainer, Wait } from "testcontainers";
import { Component, MetadataEntry } from "./Component";
import { DaprComponentNames } from "./Constants";

export const MEILISEARCH_DEFAULT_IMAGE = "getmeili/meilisearch:v1.37.0";
export const MEILISEARCH_DEFAULT_PORT = 7700;

export type MeilisearchStoreOptions = {
  name?: string;
  host?: string;
  apiKey?: string;
  timeout?: string;
};

export class MeilisearchContainer extends GenericContainer {
  private apiKey = randomBytes(24).toString("hex");

  constructor(image: string = MEILISEARCH_DEFAULT_IMAGE) {
    super(image);
    this.withEnvironment({
      MEILI_ENV: "production",
      MEILI_MASTER_KEY: this.apiKey,
      MEILI_NO_ANALYTICS: "true",
    })
      .withExposedPorts(MEILISEARCH_DEFAULT_PORT)
      .withWaitStrategy(Wait.forHttp("/health", MEILISEARCH_DEFAULT_PORT).forStatusCode(200))
      .withStartupTimeout(120_000);
  }

  public withApiKey(apiKey: string): this {
    if (apiKey.length < 16) {
      throw new Error("Meilisearch master key must contain at least 16 characters.");
    }
    this.apiKey = apiKey;
    return this.withEnvironment({ MEILI_MASTER_KEY: apiKey });
  }

  public getApiKey(): string {
    return this.apiKey;
  }

  public getPort(): number {
    return MEILISEARCH_DEFAULT_PORT;
  }

  public createSearchComponent(options: MeilisearchStoreOptions = {}): Component {
    return MeilisearchContainer.createSearchComponent({
      ...options,
      host: options.host ?? `http://meilisearch:${this.getPort()}`,
      apiKey: options.apiKey ?? this.apiKey,
    });
  }

  public static createSearchComponent(options: MeilisearchStoreOptions = {}): Component {
    return MeilisearchContainer.createComponent("search", options);
  }

  public createVectorComponent(options: MeilisearchStoreOptions = {}): Component {
    return MeilisearchContainer.createVectorComponent({
      ...options,
      host: options.host ?? `http://meilisearch:${this.getPort()}`,
      apiKey: options.apiKey ?? this.apiKey,
    });
  }

  public static createVectorComponent(options: MeilisearchStoreOptions = {}): Component {
    return MeilisearchContainer.createComponent("vector", options);
  }

  private static createComponent(kind: "search" | "vector", options: MeilisearchStoreOptions): Component {
    const name =
      options.name ??
      (kind === "search" ? DaprComponentNames.SearchComponentName : DaprComponentNames.VectorComponentName);
    if (!name.trim() || /[/\\]/.test(name) || name === "." || name === "..") {
      throw new Error(
        `${kind === "search" ? "Search" : "Vector"} store name must be non-empty and must not contain path separators or dot segments.`
      );
    }
    const host = options.host ?? `http://localhost:${MEILISEARCH_DEFAULT_PORT}`;
    const url = new URL(host);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Meilisearch host must be an HTTP or HTTPS URL.");
    }
    const metadata: MetadataEntry[] = [
      { name: "host", value: host },
      { name: "apiKey", value: options.apiKey ?? "" },
    ];
    if (options.timeout !== undefined) {
      metadata.push({ name: "timeout", value: options.timeout });
    }
    return new Component(name, `${kind}.meilisearch`, "v1", metadata);
  }

  public override async start(): Promise<StartedMeilisearchContainer> {
    return new StartedMeilisearchContainer(await super.start(), this.apiKey);
  }
}

export class StartedMeilisearchContainer extends AbstractStartedContainer {
  constructor(
    startedTestContainer: StartedTestContainer,
    private readonly apiKey: string
  ) {
    super(startedTestContainer);
  }

  public getHttpEndpoint(): string {
    return `http://${this.getHost()}:${this.getMappedPort(MEILISEARCH_DEFAULT_PORT)}`;
  }

  public getApiKey(): string {
    return this.apiKey;
  }
}
