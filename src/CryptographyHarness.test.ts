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
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { CryptographyHarness } from "./CryptographyHarness";

const KEY_NAME = "testkey";

function createKeyDirectory(): string {
  const keyPath = fs.mkdtempSync(path.join(os.tmpdir(), "dapr-crypto-keys-"));
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  fs.writeFileSync(path.join(keyPath, KEY_NAME), `${privateKey}${publicKey}`, "utf8");
  return keyPath;
}

describe("CryptographyHarness configuration", () => {
  let keyPath: string;

  beforeEach(() => {
    keyPath = createKeyDirectory();
  });

  afterEach(() => {
    fs.rmSync(keyPath, { recursive: true, force: true });
  });

  it("should configure the local-storage cryptography component", () => {
    const harness = new CryptographyHarness({ keyPath });
    const dapr = harness.getDaprContainer();

    expect(dapr.getAppName()).toBe("cryptography-app");
    expect(harness.getKeyPath()).toBe(path.resolve(keyPath));
    expect(harness.getContainerKeyPath()).toBe("/dapr-crypto-keys");
    expect(harness.getComponentName()).toBe("cryptography");
    expect(dapr.getComponents()).toHaveLength(1);
    expect(dapr.getComponents()[0]).toEqual(
      expect.objectContaining({
        name: "cryptography",
        type: "crypto.dapr.localstorage",
        version: "v1",
      })
    );
    expect(dapr.getComponents()[0].getMetadata()).toEqual([{ name: "path", value: "/dapr-crypto-keys" }]);
  });

  it("should configure custom harness values", () => {
    const harness = new CryptographyHarness({
      keyPath,
      appId: "custom-app",
      componentName: "custom-crypto",
      containerKeyPath: "/custom-keys",
      daprLogLevel: "debug",
      daprApiLoggingEnabled: true,
    });

    expect(harness.getDaprContainer().getAppName()).toBe("custom-app");
    expect(harness.getComponentName()).toBe("custom-crypto");
    expect(harness.getContainerKeyPath()).toBe("/custom-keys");
    expect(harness.getDaprContainer().getComponents()[0].getMetadata()).toEqual([
      { name: "path", value: "/custom-keys" },
    ]);
  });

  it("should reject a missing key directory", () => {
    const missingPath = path.join(keyPath, "missing");
    expect(() => new CryptographyHarness({ keyPath: missingPath })).toThrow(
      `Cryptography key path must be an existing directory: ${missingPath}`
    );
  });

  it("should reject a key path that points to a file", () => {
    const keyFile = path.join(keyPath, KEY_NAME);
    expect(() => new CryptographyHarness({ keyPath: keyFile })).toThrow(
      `Cryptography key path must be an existing directory: ${keyFile}`
    );
  });

  it("should reject a relative container key path", () => {
    expect(() => new CryptographyHarness({ keyPath, containerKeyPath: "keys" })).toThrow(
      "Cryptography container key path must be absolute: keys"
    );
  });

  it("should require start before exposing sidecar details", () => {
    const harness = new CryptographyHarness({ keyPath });

    expect(() => harness.getStartedDaprContainer()).toThrow(
      "CryptographyHarness has not been started. Call start() first."
    );
    expect(() => harness.createDaprClient()).toThrow("CryptographyHarness has not been started. Call start() first.");
  });
});

describe("CryptographyHarness integration", () => {
  let keyPath: string;
  let harness: CryptographyHarness;

  beforeAll(async () => {
    keyPath = createKeyDirectory();
    harness = new CryptographyHarness({
      keyPath,
      appId: "cryptography-test-app",
    });
    await harness.start();
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
    if (keyPath) {
      fs.rmSync(keyPath, { recursive: true, force: true });
    }
  }, 120_000);

  it("should encrypt and decrypt text", async () => {
    const client = harness.createDaprClient();
    expect(harness.createDaprClient()).toBe(client);

    const plaintext = "Hello from the Dapr cryptography harness";
    const encrypted = await client.crypto.encrypt(plaintext, {
      componentName: harness.getComponentName(),
      keyName: KEY_NAME,
      keyWrapAlgorithm: "RSA-OAEP-256",
    });
    const decrypted = await client.crypto.decrypt(encrypted, {
      componentName: harness.getComponentName(),
    });

    expect(encrypted.equals(Buffer.from(plaintext))).toBe(false);
    expect(decrypted.toString("utf8")).toBe(plaintext);
  });

  it("should encrypt and decrypt a large binary payload", async () => {
    const client = harness.createDaprClient();
    const plaintext = randomBytes(1024 * 1024);
    const encrypted = await client.crypto.encrypt(plaintext, {
      componentName: harness.getComponentName(),
      keyName: KEY_NAME,
      keyWrapAlgorithm: "RSA-OAEP-256",
      dataEncryptionCipher: "aes-gcm",
    });
    const decrypted = await client.crypto.decrypt(encrypted, {
      componentName: harness.getComponentName(),
    });

    expect(decrypted).toEqual(plaintext);
  });

  it("should decrypt documents that omit the embedded key name", async () => {
    const client = harness.createDaprClient();
    const plaintext = randomBytes(4096);
    const encrypted = await client.crypto.encrypt(plaintext, {
      componentName: harness.getComponentName(),
      keyName: KEY_NAME,
      keyWrapAlgorithm: "RSA-OAEP-256",
      omitDecryptionKeyName: true,
    });
    const decrypted = await client.crypto.decrypt(encrypted, {
      componentName: harness.getComponentName(),
      keyName: KEY_NAME,
    });

    expect(decrypted).toEqual(plaintext);
  });
});
