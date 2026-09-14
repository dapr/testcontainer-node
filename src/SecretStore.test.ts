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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Component } from "./Component";
import { DaprComponentNames } from "./Constants";
import { DaprContainer } from "./DaprContainer";
import {
  createLocalFileSecretStoreComponent,
  createSecretsJson,
  DEFAULT_NESTED_SEPARATOR,
  DEFAULT_SECRETS,
  DEFAULT_SECRETS_CONTAINER_DIRECTORY,
  DEFAULT_SECRETS_FILE_NAME,
  resolveLocalFileSecretStore,
  validateSecrets,
  writeSecretsFile,
} from "./SecretStore";

const metadataValue = (component: Component, name: string): string | undefined =>
  component.getMetadata().find((entry) => entry.name === name)?.value;

describe("SecretStore local file component", () => {
  describe("createSecretsJson", () => {
    it("serializes the default secrets", () => {
      expect(JSON.parse(createSecretsJson())).toEqual(DEFAULT_SECRETS);
    });

    it("serializes nested secrets", () => {
      const json = createSecretsJson({ flat: "value", nested: { a: "1", b: "2" } });
      expect(JSON.parse(json)).toEqual({ flat: "value", nested: { a: "1", b: "2" } });
    });

    it("ends with a trailing newline", () => {
      expect(createSecretsJson()).toMatch(/\n$/);
    });
  });

  describe("validateSecrets", () => {
    it("accepts flat and nested string maps", () => {
      expect(() => validateSecrets({ a: "1", b: { c: "2" } })).not.toThrow();
    });

    it("rejects non-string leaf values", () => {
      expect(() => validateSecrets({ a: 1 } as never)).toThrow(/must be a string or an object/);
    });

    it("rejects nested non-string values", () => {
      expect(() => validateSecrets({ a: { b: 5 } } as never)).toThrow(/must be a string value/);
    });

    it("rejects arrays", () => {
      expect(() => validateSecrets({ a: ["x"] } as never)).toThrow(/must be a string or an object/);
    });

    it("rejects a non-object secrets map", () => {
      expect(() => validateSecrets("nope" as never)).toThrow(/object of key\/value pairs/);
    });
  });

  describe("createLocalFileSecretStoreComponent", () => {
    it("uses the documented defaults", () => {
      const component = createLocalFileSecretStoreComponent();
      expect(component.name).toBe(DaprComponentNames.SecretStoreComponentName);
      expect(component.name).toBe("localsecretstore");
      expect(component.type).toBe("secretstores.local.file");
      expect(component.version).toBe("v1");
      expect(metadataValue(component, "secretsFile")).toBe(
        `${DEFAULT_SECRETS_CONTAINER_DIRECTORY}/${DEFAULT_SECRETS_FILE_NAME}`
      );
      expect(metadataValue(component, "nestedSeparator")).toBe(DEFAULT_NESTED_SEPARATOR);
      expect(metadataValue(component, "multiValued")).toBeUndefined();
    });

    it("derives a distinct secrets file per named component", () => {
      const component = createLocalFileSecretStoreComponent({ name: "other-store" });
      expect(component.name).toBe("other-store");
      expect(metadataValue(component, "secretsFile")).toBe(`${DEFAULT_SECRETS_CONTAINER_DIRECTORY}/other-store.json`);
    });

    it("honors custom separator, multiValued and container path", () => {
      const component = createLocalFileSecretStoreComponent({
        nestedSeparator: ".",
        multiValued: true,
        containerSecretsFilePath: "/custom/path/my-secrets.json",
      });
      expect(metadataValue(component, "nestedSeparator")).toBe(".");
      expect(metadataValue(component, "multiValued")).toBe("true");
      expect(metadataValue(component, "secretsFile")).toBe("/custom/path/my-secrets.json");
    });

    it("rejects an empty component name", () => {
      expect(() => createLocalFileSecretStoreComponent({ name: "  " })).toThrow(/must not be empty/);
    });

    it("round-trips through YAML", () => {
      const component = createLocalFileSecretStoreComponent();
      const parsed = Component.fromYaml(component.toYaml());
      expect(parsed.name).toBe(component.name);
      expect(parsed.type).toBe("secretstores.local.file");
      expect(parsed.getMetadata()).toEqual(component.getMetadata());
    });
  });

  describe("resolveLocalFileSecretStore", () => {
    it("resolves defaults", () => {
      const resolved = resolveLocalFileSecretStore();
      expect(resolved.name).toBe("localsecretstore");
      expect(JSON.parse(resolved.secretsJson)).toEqual(DEFAULT_SECRETS);
      expect(resolved.containerSecretsFilePath).toBe(
        `${DEFAULT_SECRETS_CONTAINER_DIRECTORY}/${DEFAULT_SECRETS_FILE_NAME}`
      );
      expect(metadataValue(resolved.component, "secretsFile")).toBe(resolved.containerSecretsFilePath);
    });

    it("resolves supplied secrets", () => {
      const resolved = resolveLocalFileSecretStore({ secrets: { token: "abc" } });
      expect(JSON.parse(resolved.secretsJson)).toEqual({ token: "abc" });
    });

    it("reads secrets from a file path", () => {
      const fixture = path.join(__dirname, "__fixtures__", "dapr-resources", "secrets.json");
      const resolved = resolveLocalFileSecretStore({ secretsFilePath: fixture });
      expect(JSON.parse(resolved.secretsJson)).toEqual({
        fixtureSecret: "fixtureValue",
        connection: { username: "fixtureUser", password: "fixturePassword" },
      });
    });

    it("rejects supplying both secrets and secretsFilePath", () => {
      expect(() => resolveLocalFileSecretStore({ secrets: { a: "b" }, secretsFilePath: "x.json" })).toThrow(/not both/);
    });

    it("rejects an invalid secrets file", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dapr-secrets-"));
      const badFile = path.join(dir, "bad.json");
      fs.writeFileSync(badFile, "{ not json", "utf8");
      try {
        expect(() => resolveLocalFileSecretStore({ secretsFilePath: badFile })).toThrow(/Invalid secrets file/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("writeSecretsFile", () => {
    it("writes the secrets JSON, creating directories as needed", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "dapr-secrets-"));
      try {
        const target = path.join(root, "nested", "dir");
        const written = writeSecretsFile(target, { alpha: "beta" });
        expect(written).toBe(path.join(target, DEFAULT_SECRETS_FILE_NAME));
        expect(JSON.parse(fs.readFileSync(written, "utf8"))).toEqual({ alpha: "beta" });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it("honors a custom file name and defaults the content", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "dapr-secrets-"));
      try {
        const written = writeSecretsFile(root, undefined, "custom.json");
        expect(path.basename(written)).toBe("custom.json");
        expect(JSON.parse(fs.readFileSync(written, "utf8"))).toEqual(DEFAULT_SECRETS);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe("DaprContainer.withSecretStore", () => {
    it("registers the component and the secrets file", () => {
      const dapr = new DaprContainer().withSecretStore();
      const stores = dapr.getSecretStores();
      expect(stores).toHaveLength(1);
      expect(stores[0].name).toBe("localsecretstore");
      expect(dapr.getComponents().map((c) => c.type)).toContain("secretstores.local.file");
    });

    it("supports multiple distinct secret stores", () => {
      const dapr = new DaprContainer()
        .withSecretStore({ secrets: { a: "1" } })
        .withSecretStore({ name: "second-store", secrets: { b: "2" } });
      expect(dapr.getSecretStores().map((s) => s.name)).toEqual(["localsecretstore", "second-store"]);
      expect(dapr.getSecretStores().map((s) => s.containerSecretsFilePath)).toEqual([
        `${DEFAULT_SECRETS_CONTAINER_DIRECTORY}/secrets.json`,
        `${DEFAULT_SECRETS_CONTAINER_DIRECTORY}/second-store.json`,
      ]);
    });

    it("rejects duplicate component names", () => {
      const dapr = new DaprContainer().withSecretStore();
      expect(() => dapr.withSecretStore()).toThrow(/already been registered/);
    });

    it("rejects conflicting secrets file paths", () => {
      const dapr = new DaprContainer().withSecretStore({ containerSecretsFilePath: "/shared/secrets.json" });
      expect(() => dapr.withSecretStore({ name: "other", containerSecretsFilePath: "/shared/secrets.json" })).toThrow(
        /already mapped/
      );
    });

    it("returns a defensive copy of the registered stores", () => {
      const dapr = new DaprContainer().withSecretStore();
      dapr.getSecretStores().pop();
      expect(dapr.getSecretStores()).toHaveLength(1);
    });
  });
});
