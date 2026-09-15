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

import { CommunicationProtocolEnum, DaprClient } from "@dapr/dapr";
import path from "node:path";
import { Network } from "testcontainers";
import { DaprContainer } from "./DaprContainer";
import { DEFAULT_SECRETS } from "./SecretStore";
import { SecretStoreHarness } from "./SecretStoreHarness";

const FIXTURE_SECRETS_FILE = path.join(__dirname, "__fixtures__", "dapr-resources", "secrets.json");

describe("SecretStoreHarness", () => {
  describe("configuration", () => {
    it("configures a default secret store", () => {
      const harness = new SecretStoreHarness();
      expect(harness.getSecretStoreName()).toBe("localsecretstore");
      const dapr = harness.getDaprContainer();
      expect(dapr.getAppName()).toBe("secretstore-app");
      expect(dapr.getSecretStores()).toHaveLength(1);
      expect(JSON.parse(dapr.getSecretStores()[0].secretsJson)).toEqual(DEFAULT_SECRETS);
    });

    it("configures custom options", () => {
      const harness = new SecretStoreHarness({
        appId: "custom-secrets-app",
        appPort: 9100,
        appChannelAddress: "host.testcontainers.internal",
        daprLogLevel: "debug",
        secretStoreName: "my-secrets",
        secrets: { token: "abc123" },
        nestedSeparator: ".",
        multiValued: true,
      });

      const dapr = harness.getDaprContainer();
      expect(harness.getSecretStoreName()).toBe("my-secrets");
      expect(dapr.getAppName()).toBe("custom-secrets-app");
      expect(dapr.getAppPort()).toBe(9100);
      expect(dapr.getAppChannelAddress()).toBe("host.testcontainers.internal");

      const [store] = dapr.getSecretStores();
      expect(JSON.parse(store.secretsJson)).toEqual({ token: "abc123" });
      const metadata = store.component.getMetadata();
      expect(metadata).toContainEqual({ name: "nestedSeparator", value: "." });
      expect(metadata).toContainEqual({ name: "multiValued", value: "true" });
    });

    it("loads secrets from a file path", () => {
      const harness = new SecretStoreHarness({ secretsFilePath: FIXTURE_SECRETS_FILE });
      const [store] = harness.getDaprContainer().getSecretStores();
      expect(JSON.parse(store.secretsJson).fixtureSecret).toBe("fixtureValue");
    });

    it("throws when accessed before start", () => {
      const harness = new SecretStoreHarness();
      expect(() => harness.getStartedDaprContainer()).toThrow(/has not been started/);
      expect(() => harness.getHttpEndpoint()).toThrow(/has not been started/);
    });

    it("is safe to stop before start", async () => {
      await expect(new SecretStoreHarness().stop()).resolves.toBeUndefined();
    });
  });

  describe("end-to-end", () => {
    it("retrieves secrets over HTTP via the harness", async () => {
      await using network = await new Network().start();
      const harness = new SecretStoreHarness({
        appId: "secrets-e2e-app",
        network,
        secrets: {
          secret1: "value1",
          secret2: "value2",
          connection: { username: "admin", password: "s3cr3t" },
        },
      });

      try {
        await harness.start();

        expect(harness.getHttpEndpoint()).toMatch(/^http:\/\//);
        expect(harness.getHttpPort()).toBeGreaterThan(0);
        expect(harness.getGrpcPort()).toBeGreaterThan(0);

        await expect(harness.getSecret("secret1")).resolves.toEqual({ secret1: "value1" });
        await expect(harness.getSecretValue("secret2")).resolves.toBe("value2");

        // Nested secrets are flattened using the default ":" separator.
        await expect(harness.getSecretValue("connection:username")).resolves.toBe("admin");

        const bulk = await harness.getBulkSecrets();
        expect(bulk["secret1"]).toEqual({ secret1: "value1" });
        expect(bulk["connection:password"]).toEqual({ "connection:password": "s3cr3t" });
      } finally {
        await harness.stop();
      }
    }, 300_000);

    it("retrieves secrets over gRPC", async () => {
      await using network = await new Network().start();
      const harness = new SecretStoreHarness({
        appId: "secrets-grpc-app",
        network,
        secrets: { grpcSecret: "grpcValue" },
      });

      try {
        await harness.start();
        const client = harness.createDaprClient(CommunicationProtocolEnum.GRPC);
        const secret = (await client.secret.get(harness.getSecretStoreName(), "grpcSecret")) as Record<string, string>;
        expect(secret["grpcSecret"]).toBe("grpcValue");
      } finally {
        await harness.stop();
      }
    }, 300_000);

    it("supports a custom nested separator", async () => {
      await using network = await new Network().start();
      const harness = new SecretStoreHarness({
        appId: "secrets-separator-app",
        network,
        nestedSeparator: ".",
        secrets: { db: { host: "localhost" } },
      });

      try {
        await harness.start();
        await expect(harness.getSecretValue("db.host")).resolves.toBe("localhost");
      } finally {
        await harness.stop();
      }
    }, 300_000);

    it("supports secrets loaded from a host file", async () => {
      await using network = await new Network().start();
      const harness = new SecretStoreHarness({
        appId: "secrets-file-app",
        network,
        secretsFilePath: FIXTURE_SECRETS_FILE,
      });

      try {
        await harness.start();
        await expect(harness.getSecretValue("fixtureSecret")).resolves.toBe("fixtureValue");
        await expect(harness.getSecretValue("connection:password")).resolves.toBe("fixturePassword");
      } finally {
        await harness.stop();
      }
    }, 300_000);

    it("supports multiple secret stores configured directly on DaprContainer", async () => {
      await using network = await new Network().start();
      const dapr = new DaprContainer()
        .withNetwork(network)
        .withAppName("secrets-multi-app")
        .withSecretStore({ secrets: { alpha: "one" } })
        .withSecretStore({ name: "second-store", secrets: { beta: "two" } });

      await using started = await dapr.start();

      const client = new DaprClient({
        daprHost: started.getHost(),
        daprPort: started.getHttpPort().toString(),
      });

      try {
        const alpha = (await client.secret.get("localsecretstore", "alpha")) as Record<string, string>;
        expect(alpha["alpha"]).toBe("one");

        const beta = (await client.secret.get("second-store", "beta")) as Record<string, string>;
        expect(beta["beta"]).toBe("two");

        await expect(client.secret.get("localsecretstore", "beta")).rejects.toBeDefined();
      } finally {
        await client.stop();
      }
    }, 300_000);
  });
});
