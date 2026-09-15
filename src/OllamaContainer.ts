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
import { DaprComponentNames, OLLAMA_DEFAULT_IMAGE, OLLAMA_DEFAULT_MODEL, OLLAMA_DEFAULT_PORT } from "./Constants";

export { OLLAMA_DEFAULT_IMAGE, OLLAMA_DEFAULT_MODEL, OLLAMA_DEFAULT_PORT };

export type OllamaConversationOptions = {
  name?: string;
  model?: string;
  cacheTtl?: string;
  endpoint?: string;
  metadata?: MetadataEntry[];
};

export class OllamaContainer extends GenericContainer {
  constructor(image: string = OLLAMA_DEFAULT_IMAGE) {
    super(image);
    this.withEnvironment({ CUDA_VISIBLE_DEVICES: "-1" })
      .withExposedPorts(OLLAMA_DEFAULT_PORT)
      .withWaitStrategy(Wait.forHttp("/api/tags", OLLAMA_DEFAULT_PORT).forStatusCode(200))
      .withStartupTimeout(180_000);
  }

  public getPort(): number {
    return OLLAMA_DEFAULT_PORT;
  }

  public override async start(): Promise<StartedOllamaContainer> {
    return new StartedOllamaContainer(await super.start());
  }

  public createConversationComponent(options?: OllamaConversationOptions): Component {
    return OllamaContainer.createConversationComponent({
      ...options,
      endpoint: options?.endpoint ?? `http://ollama:${OLLAMA_DEFAULT_PORT}/v1`,
    });
  }

  public static createConversationComponent(options?: OllamaConversationOptions): Component {
    const metadata: MetadataEntry[] = [
      { name: "model", value: options?.model ?? OLLAMA_DEFAULT_MODEL },
      { name: "cacheTTL", value: options?.cacheTtl ?? "10m" },
      { name: "endpoint", value: options?.endpoint ?? `http://localhost:${OLLAMA_DEFAULT_PORT}/v1` },
      ...(options?.metadata ?? []),
    ];

    return new Component(
      options?.name ?? DaprComponentNames.ConversationComponentName,
      "conversation.ollama",
      "v1",
      metadata
    );
  }
}

type OllamaModelsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
};

export class StartedOllamaContainer extends AbstractStartedContainer {
  constructor(startedTestContainer: StartedTestContainer) {
    super(startedTestContainer);
  }

  public getOllamaPort(): number {
    return this.getMappedPort(OLLAMA_DEFAULT_PORT);
  }

  public getOllamaHost(): string {
    return this.getHost();
  }

  public getEndpoint(): string {
    return `http://${this.getOllamaHost()}:${this.getOllamaPort()}`;
  }

  public async ensureModel(model: string = OLLAMA_DEFAULT_MODEL): Promise<void> {
    const normalizedModel = model.trim();
    if (!normalizedModel) {
      throw new Error("Model name must not be empty.");
    }
    if (await this.isModelAvailable(normalizedModel)) {
      return;
    }

    const response = await fetch(`${this.getEndpoint()}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: normalizedModel }),
    });
    if (!response.ok) {
      throw new Error(`Failed to pull model '${normalizedModel}': ${response.status} ${response.statusText}`);
    }

    const body = await response.text();
    for (const line of body.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      const progress = JSON.parse(line) as { error?: string };
      if (progress.error) {
        throw new Error(`Failed to pull model '${normalizedModel}': ${progress.error}`);
      }
    }
  }

  public async isModelAvailable(model: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.getEndpoint()}/api/tags`);
      if (!response.ok) {
        return false;
      }
      const data = (await response.json()) as OllamaModelsResponse;
      const target = this.normalizeModelName(model);
      return (
        data.models?.some((entry) => {
          const names = [entry.name, entry.model].filter((value): value is string => value !== undefined);
          return names.some((name) => this.normalizeModelName(name) === target);
        }) ?? false
      );
    } catch {
      return false;
    }
  }

  private normalizeModelName(model: string): string {
    const normalizedModel = model.trim().toLowerCase();
    return normalizedModel.includes(":") ? normalizedModel : `${normalizedModel}:latest`;
  }
}
