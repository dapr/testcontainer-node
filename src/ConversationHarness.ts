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

import { DaprClient } from "@dapr/dapr";
import { Network, StartedNetwork } from "testcontainers";
import { DaprComponentNames } from "./Constants";
import { ConversationOptions, DaprContainer, StartedDaprContainer } from "./DaprContainer";
import { OLLAMA_DEFAULT_MODEL, OllamaContainer, StartedOllamaContainer } from "./OllamaContainer";

export type ConversationHarnessOptions = {
  appId?: string;
  appPort?: number;
  appChannelAddress?: string;
  daprLogLevel?: string;
  daprApiLoggingEnabled?: boolean;
  daprRuntimeImage?: string;
  conversationComponentName?: string;
  modelName?: string;
  cacheTtl?: string;
  ollamaContainer?: OllamaContainer;
  ollamaEndpoint?: string;
  ollamaHost?: string;
  ollamaPort?: number;
  network?: StartedNetwork;
};

export type ConversationRole = "developer" | "system" | "user" | "assistant";

export type ConversationInputMessage = {
  role?: ConversationRole;
  content: string;
};

export type ConversationConverseOptions = {
  componentName?: string;
  contextId?: string;
  temperature?: number;
  scrubPii?: boolean;
  metadata?: Record<string, string>;
  parameters?: Record<string, unknown>;
};

export type ConversationResult = {
  outputs?: Array<{
    choices?: Array<{
      finishReason?: string;
      message?: {
        content?: string;
      };
    }>;
  }>;
  contextId?: string;
};

export class ConversationHarness {
  private network?: StartedNetwork;
  private ownsNetwork = false;
  private modelName: string;
  private readonly conversationComponentName: string;
  private readonly cacheTtl: string;
  private readonly daprContainer: DaprContainer;
  private startedDaprContainer?: StartedDaprContainer;
  private daprClient?: DaprClient;

  constructor(private readonly options: ConversationHarnessOptions = {}) {
    this.modelName = options.modelName ?? OLLAMA_DEFAULT_MODEL;
    this.conversationComponentName = options.conversationComponentName ?? DaprComponentNames.ConversationComponentName;
    this.cacheTtl = options.cacheTtl ?? "10m";
    this.daprContainer = new DaprContainer(options.daprRuntimeImage)
      .withAppName(options.appId ?? "conversation-app")
      .withDaprLogLevel(options.daprLogLevel ?? "info")
      .withDaprApiLoggingEnabled(options.daprApiLoggingEnabled ?? false)
      .withConversation(this.getConversationOptions());

    if (options.appPort !== undefined) {
      this.daprContainer.withAppPort(options.appPort);
    }
    if (options.appChannelAddress) {
      this.daprContainer.withAppChannelAddress(options.appChannelAddress);
    }
  }

  public useModel(modelName: string): this {
    if (!modelName.trim()) {
      throw new Error("Model name must not be empty.");
    }
    this.modelName = modelName;
    this.daprContainer.withConversation(this.getConversationOptions());
    return this;
  }

  public getModelName(): string {
    return this.modelName;
  }

  public getConversationComponentName(): string {
    return this.conversationComponentName;
  }

  public getDaprContainer(): DaprContainer {
    return this.daprContainer;
  }

  public getOllamaContainer(): OllamaContainer | undefined {
    return this.daprContainer.getOllamaContainer();
  }

  public getStartedOllamaContainer(): StartedOllamaContainer | undefined {
    return this.startedDaprContainer?.getOllamaContainer();
  }

  public getStartedDaprContainer(): StartedDaprContainer {
    if (!this.startedDaprContainer) {
      throw new Error("ConversationHarness has not been started. Call start() first.");
    }
    return this.startedDaprContainer;
  }

  public async start(): Promise<this> {
    this.network = this.options.network ?? (await new Network().start());
    this.ownsNetwork = this.options.network === undefined;
    this.daprContainer.withNetwork(this.network);
    this.startedDaprContainer = await this.daprContainer.start();
    return this;
  }

  public async stop(): Promise<void> {
    if (this.daprClient) {
      await this.daprClient.stop();
      this.daprClient = undefined;
    }
    if (this.startedDaprContainer) {
      await this.startedDaprContainer.stop();
      this.startedDaprContainer = undefined;
    }
    if (this.ownsNetwork && this.network) {
      await this.network.stop();
      this.network = undefined;
    }
  }

  public getHost(): string {
    return this.getStartedDaprContainer().getHost();
  }

  public getHttpPort(): number {
    return this.getStartedDaprContainer().getHttpPort();
  }

  public getGrpcPort(): number {
    return this.getStartedDaprContainer().getGrpcPort();
  }

  public getHttpEndpoint(): string {
    return this.getStartedDaprContainer().getHttpEndpoint();
  }

  public getGrpcEndpoint(): string {
    return this.getStartedDaprContainer().getGrpcEndpoint();
  }

  public getOllamaEndpoint(): string | undefined {
    return this.getStartedOllamaContainer()?.getEndpoint();
  }

  public createDaprClient(): DaprClient {
    const started = this.getStartedDaprContainer();
    this.daprClient = new DaprClient({
      daprHost: started.getHost(),
      daprPort: started.getHttpPort().toString(),
    });
    return this.daprClient;
  }

  public async converse(
    input: string | ConversationInputMessage[],
    options: ConversationConverseOptions = {}
  ): Promise<string> {
    const messages = typeof input === "string" ? [{ content: input, role: "user" as const }] : input;
    if (messages.length === 0) {
      throw new Error("At least one conversation message is required.");
    }

    const body: Record<string, unknown> = {
      inputs: [
        {
          messages: messages.map((message) => ({
            [this.getRoleField(message.role ?? "user")]: {
              content: [{ text: message.content }],
            },
          })),
        },
      ],
    };
    if (options.contextId !== undefined) body.contextId = options.contextId;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.scrubPii !== undefined) body.scrubPii = options.scrubPii;
    if (options.metadata !== undefined) body.metadata = options.metadata;
    if (options.parameters !== undefined) body.parameters = options.parameters;

    const response = await fetch(
      `${this.getHttpEndpoint()}/v1.0-alpha2/conversation/${
        options.componentName ?? this.conversationComponentName
      }/converse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      throw new Error(`Conversation request failed (${response.status}): ${await response.text()}`);
    }

    const result = (await response.json()) as ConversationResult;
    const content = result.outputs?.[0]?.choices?.[0]?.message?.content;
    if (content === undefined) {
      throw new Error("Conversation response did not contain message content.");
    }
    return content;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }

  private getConversationOptions(): ConversationOptions {
    return {
      conversationComponentName: this.conversationComponentName,
      model: this.modelName,
      cacheTtl: this.cacheTtl,
      ollamaContainer: this.options.ollamaContainer,
      ollamaEndpoint: this.options.ollamaEndpoint,
      ollamaHost: this.options.ollamaHost,
      ollamaPort: this.options.ollamaPort,
    };
  }

  private getRoleField(role: ConversationRole): string {
    return `of${role[0].toUpperCase()}${role.slice(1)}`;
  }
}
