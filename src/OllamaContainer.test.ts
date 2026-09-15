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

import { StartedTestContainer } from "testcontainers";
import { DaprComponentNames } from "./Constants";
import {
  OLLAMA_DEFAULT_IMAGE,
  OLLAMA_DEFAULT_MODEL,
  OLLAMA_DEFAULT_PORT,
  OllamaContainer,
  StartedOllamaContainer,
} from "./OllamaContainer";

describe("OllamaContainer", () => {
  it("uses CPU-only Ollama defaults", () => {
    expect(OLLAMA_DEFAULT_IMAGE).toBe("ollama/ollama");
    expect(OLLAMA_DEFAULT_MODEL).toBe("smollm2:135m");
    expect(new OllamaContainer().getPort()).toBe(OLLAMA_DEFAULT_PORT);
  });

  it("creates the default conversation component", () => {
    const component = OllamaContainer.createConversationComponent();
    expect(component.name).toBe(DaprComponentNames.ConversationComponentName);
    expect(component.type).toBe("conversation.ollama");
    expect(component.version).toBe("v1");
    expect(component.getMetadata()).toEqual([
      { name: "model", value: OLLAMA_DEFAULT_MODEL },
      { name: "cacheTTL", value: "10m" },
      { name: "endpoint", value: `http://localhost:${OLLAMA_DEFAULT_PORT}/v1` },
    ]);
  });

  it("creates a customized conversation component", () => {
    const component = new OllamaContainer().createConversationComponent({
      name: "assistant",
      model: "custom:latest",
      cacheTtl: "30m",
      endpoint: "http://models:11434/v1",
      metadata: [{ name: "custom", value: "value" }],
    });
    expect(component.name).toBe("assistant");
    expect(component.getMetadata()).toEqual([
      { name: "model", value: "custom:latest" },
      { name: "cacheTTL", value: "30m" },
      { name: "endpoint", value: "http://models:11434/v1" },
      { name: "custom", value: "value" },
    ]);
  });

  describe("StartedOllamaContainer", () => {
    const started = new StartedOllamaContainer({
      getHost: jest.fn().mockReturnValue("127.0.0.1"),
      getMappedPort: jest.fn().mockReturnValue(54321),
      stop: jest.fn(),
    } as unknown as StartedTestContainer);
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("exposes its mapped endpoint", () => {
      expect(started.getOllamaHost()).toBe("127.0.0.1");
      expect(started.getOllamaPort()).toBe(54321);
      expect(started.getEndpoint()).toBe("http://127.0.0.1:54321");
    });

    it("detects an installed model", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: OLLAMA_DEFAULT_MODEL }] }),
      } as Response);
      await expect(started.isModelAvailable(OLLAMA_DEFAULT_MODEL)).resolves.toBe(true);
    });

    it("matches an untagged model to the latest tag", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: "llama3:latest" }] }),
      } as Response);
      await expect(started.isModelAvailable("llama3")).resolves.toBe(true);
    });

    it("returns false when model discovery fails", async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new Error("unavailable"));
      await expect(started.isModelAvailable(OLLAMA_DEFAULT_MODEL)).resolves.toBe(false);
    });

    it("skips pulling an installed model", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ model: OLLAMA_DEFAULT_MODEL }] }),
      } as Response);
      globalThis.fetch = fetchMock;
      await started.ensureModel();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("pulls a missing model and validates the stream", async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '{"status":"pulling manifest"}\n{"status":"success"}\n',
        } as Response);
      globalThis.fetch = fetchMock;

      await started.ensureModel();

      expect(fetchMock).toHaveBeenLastCalledWith("http://127.0.0.1:54321/api/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: OLLAMA_DEFAULT_MODEL }),
      });
    });

    it("surfaces HTTP and streamed pull errors", async () => {
      globalThis.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) } as Response)
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" } as Response);
      await expect(started.ensureModel()).rejects.toThrow("500 Server Error");

      globalThis.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) } as Response)
        .mockResolvedValueOnce({ ok: true, text: async () => '{"error":"model not found"}\n' } as Response);
      await expect(started.ensureModel()).rejects.toThrow("model not found");
    });

    it("rejects an empty model name", async () => {
      await expect(started.ensureModel(" ")).rejects.toThrow("Model name must not be empty.");
    });
  });
});
