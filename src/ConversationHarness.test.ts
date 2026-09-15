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

import { Network } from "testcontainers";
import { ConversationHarness } from "./ConversationHarness";
import { DaprComponentNames, OLLAMA_DEFAULT_MODEL } from "./Constants";
import { DaprContainer, StartedDaprContainer } from "./DaprContainer";
import { OllamaContainer } from "./OllamaContainer";

describe("ConversationHarness", () => {
  it("configures the default model and component", () => {
    const harness = new ConversationHarness();
    expect(harness.getModelName()).toBe(OLLAMA_DEFAULT_MODEL);
    expect(harness.getConversationComponentName()).toBe(DaprComponentNames.ConversationComponentName);
    expect(harness.getDaprContainer().getAppName()).toBe("conversation-app");
    expect(harness.getDaprContainer().isConversationEnabled()).toBe(true);
  });

  it("supports custom and external Ollama configuration", () => {
    const ollama = new OllamaContainer();
    const harness = new ConversationHarness({
      appId: "assistant",
      appPort: 8080,
      appChannelAddress: "host.testcontainers.internal",
      conversationComponentName: "llm",
      modelName: "custom:latest",
      cacheTtl: "1m",
      ollamaContainer: ollama,
    });
    expect(harness.getDaprContainer().getAppName()).toBe("assistant");
    expect(harness.getDaprContainer().getAppPort()).toBe(8080);
    expect(harness.getDaprContainer().getAppChannelAddress()).toBe("host.testcontainers.internal");
    expect(harness.getOllamaContainer()).toBe(ollama);
    expect(harness.getConversationComponentName()).toBe("llm");
    expect(harness.useModel(OLLAMA_DEFAULT_MODEL)).toBe(harness);
    expect(() => harness.useModel(" ")).toThrow("Model name must not be empty.");
  });

  it("exposes DaprContainer conversation configuration", () => {
    const ollama = new OllamaContainer();
    const dapr = new DaprContainer()
      .withOllamaService("models")
      .withReusableOllama(true)
      .withOllamaContainer(ollama, "ollama")
      .withConversation({ model: OLLAMA_DEFAULT_MODEL });
    expect(dapr.getOllamaService()).toBe("ollama");
    expect(dapr.getOllamaContainer()).toBe(ollama);
    expect(dapr.isConversationEnabled()).toBe(true);
  });

  it("requires a started harness for endpoints", () => {
    expect(() => new ConversationHarness().getStartedDaprContainer()).toThrow(
      "ConversationHarness has not been started."
    );
  });

  it("sends Alpha2 messages and options", async () => {
    const harness = new ConversationHarness();
    (harness as unknown as { startedDaprContainer: StartedDaprContainer }).startedDaprContainer = {
      getHttpEndpoint: () => "http://127.0.0.1:3500",
    } as StartedDaprContainer;
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        contextId: "next-context",
        outputs: [
          {
            choices: [
              {
                finishReason: "stop",
                message: { ofAssistant: { content: [{ text: "po" }, { text: "ng" }] } },
              },
            ],
          },
        ],
      }),
    } as Response);
    globalThis.fetch = fetchMock;

    try {
      await expect(
        harness.converse(
          [{ role: "system", content: "Be concise." }, { role: "assistant", content: "Ready." }, { content: "ping" }],
          {
            componentName: "llm",
            contextId: "context",
            temperature: 0,
            scrubPii: true,
            metadata: { tenant: "test" },
            parameters: { max_tokens: 5 },
          }
        )
      ).resolves.toEqual({ content: "pong", contextId: "next-context" });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3500/v1.0-alpha2/conversation/llm/converse",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            inputs: [
              {
                messages: [
                  { ofSystem: { content: [{ text: "Be concise." }] } },
                  { ofAssistant: { content: [{ text: "Ready." }] } },
                  { ofUser: { content: [{ text: "ping" }] } },
                ],
              },
            ],
            contextId: "context",
            temperature: 0,
            scrubPii: true,
            metadata: { tenant: "test" },
            parameters: { max_tokens: 5 },
          }),
        })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces invalid input and response errors", async () => {
    const harness = new ConversationHarness();
    (harness as unknown as { startedDaprContainer: StartedDaprContainer }).startedDaprContainer = {
      getHttpEndpoint: () => "http://127.0.0.1:3500",
    } as StartedDaprContainer;
    await expect(harness.converse([])).rejects.toThrow("At least one conversation message is required.");

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "component failed",
      } as Response);
      await expect(harness.converse("ping")).rejects.toThrow("Conversation request failed (500): component failed");

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ outputs: [] }),
      } as Response);
      await expect(harness.converse("ping")).rejects.toThrow("Conversation response did not contain message content.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("runs a conversation through Dapr and smollm2:135m", async () => {
    await using network = await new Network().start();
    await using harness = await new ConversationHarness({ network }).start();

    expect(harness.getStartedOllamaContainer()).toBeDefined();
    expect(harness.getOllamaEndpoint()).toMatch(/^http:\/\//);
    const response = await harness.converse("Reply with exactly: pong", { temperature: 0 });
    expect(response.content.trim().length).toBeGreaterThan(0);
  }, 360_000);
});
