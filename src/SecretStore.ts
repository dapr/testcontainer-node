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
import path from "node:path";
import { Component, MetadataEntry } from "./Component";
import { DaprComponentNames } from "./Constants";

/**
 * The directory inside the Dapr container where secret files are placed.
 * Kept separate from the resources path so the runtime does not attempt to
 * load the secrets file as a Dapr resource.
 */
export const DEFAULT_SECRETS_CONTAINER_DIRECTORY = "/dapr-secrets";

/** The default file name used for the local file secret store. */
export const DEFAULT_SECRETS_FILE_NAME = "secrets.json";

/** The default separator used to flatten nested secrets. */
export const DEFAULT_NESTED_SEPARATOR = ":";

/**
 * The default set of secrets seeded into the local file secret store, mirroring
 * the .NET SDK's `SecretStoreHarness`.
 */
export const DEFAULT_SECRETS: SecretsMap = {
  secret1: "value1",
  secret2: "value2",
};

/**
 * A map of secrets. Values may either be a flat string or a nested map of
 * key/value pairs (used for multi-valued secrets).
 */
export type SecretsMap = Record<string, string | Record<string, string>>;

export type LocalFileSecretStoreOptions = {
  /** Component name. Defaults to `localsecretstore`. */
  name?: string;
  /** The secrets to seed into the secret store. Mutually exclusive with `secretsFilePath`. */
  secrets?: SecretsMap;
  /** Path on the host to an existing JSON secrets file. Mutually exclusive with `secrets`. */
  secretsFilePath?: string;
  /** Absolute path inside the container where the secrets file is written. */
  containerSecretsFilePath?: string;
  /** Separator used when flattening nested secrets. Defaults to `:`. */
  nestedSeparator?: string;
  /** When true, nested secrets are returned as multi-valued secrets rather than flattened. */
  multiValued?: boolean;
};

/**
 * A fully resolved local file secret store, containing both the Dapr component
 * definition and the JSON content that backs it.
 */
export type ResolvedLocalFileSecretStore = {
  name: string;
  component: Component;
  secretsJson: string;
  containerSecretsFilePath: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates that a secrets map only contains strings or one level of nested strings.
 *
 * @param secrets The secrets map to validate.
 * @throws If the map contains unsupported values.
 */
export function validateSecrets(secrets: SecretsMap): void {
  if (!isPlainObject(secrets)) {
    throw new Error("Secrets must be provided as an object of key/value pairs");
  }
  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value === "string") {
      continue;
    }
    if (!isPlainObject(value)) {
      throw new Error(`Secret "${key}" must be a string or an object of string values`);
    }
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      if (typeof nestedValue !== "string") {
        throw new Error(`Secret "${key}.${nestedKey}" must be a string value`);
      }
    }
  }
}

/**
 * Serializes a secrets map into the JSON document consumed by the
 * `secretstores.local.file` component.
 *
 * @param secrets The secrets to serialize. Defaults to {@link DEFAULT_SECRETS}.
 * @returns A JSON string.
 */
export function createSecretsJson(secrets: SecretsMap = DEFAULT_SECRETS): string {
  validateSecrets(secrets);
  return `${JSON.stringify(secrets, undefined, 2)}\n`;
}

/**
 * Builds a Dapr `secretstores.local.file` component.
 *
 * @param options Configuration options for the secret store component.
 * @returns A new Component instance.
 */
export function createLocalFileSecretStoreComponent(options: LocalFileSecretStoreOptions = {}): Component {
  const name = options.name ?? DaprComponentNames.SecretStoreComponentName;
  if (!name.trim()) {
    throw new Error("Secret store component name must not be empty");
  }

  const metadata: MetadataEntry[] = [
    { name: "secretsFile", value: resolveContainerSecretsFilePath(options) },
    { name: "nestedSeparator", value: options.nestedSeparator ?? DEFAULT_NESTED_SEPARATOR },
  ];

  if (options.multiValued) {
    metadata.push({ name: "multiValued", value: "true" });
  }

  return new Component(name, "secretstores.local.file", "v1", metadata);
}

function resolveContainerSecretsFilePath(options: LocalFileSecretStoreOptions): string {
  if (options.containerSecretsFilePath) {
    return options.containerSecretsFilePath;
  }
  const name = options.name ?? DaprComponentNames.SecretStoreComponentName;
  const fileName = name === DaprComponentNames.SecretStoreComponentName ? DEFAULT_SECRETS_FILE_NAME : `${name}.json`;
  return `${DEFAULT_SECRETS_CONTAINER_DIRECTORY}/${fileName}`;
}

/**
 * Resolves the component definition and the backing JSON content for a local
 * file secret store.
 *
 * @param options Configuration options for the secret store.
 * @returns The resolved secret store.
 */
export function resolveLocalFileSecretStore(options: LocalFileSecretStoreOptions = {}): ResolvedLocalFileSecretStore {
  if (options.secrets && options.secretsFilePath) {
    throw new Error("Provide either `secrets` or `secretsFilePath`, not both");
  }

  let secretsJson: string;
  if (options.secretsFilePath) {
    const raw = fs.readFileSync(options.secretsFilePath, "utf8");
    try {
      validateSecrets(JSON.parse(raw));
    } catch (error) {
      throw new Error(`Invalid secrets file at ${options.secretsFilePath}: ${(error as Error).message}`);
    }
    secretsJson = raw;
  } else {
    secretsJson = createSecretsJson(options.secrets);
  }

  const component = createLocalFileSecretStoreComponent(options);

  return {
    name: component.name,
    component,
    secretsJson,
    containerSecretsFilePath: resolveContainerSecretsFilePath(options),
  };
}

/**
 * Writes a secrets JSON file to disk, creating the containing directory when needed.
 * Useful when tests want to mount an existing secrets file into the container.
 *
 * @param folderPath The directory to write the file into.
 * @param secrets The secrets to write. Defaults to {@link DEFAULT_SECRETS}.
 * @param fileName The file name. Defaults to `secrets.json`.
 * @returns The full path of the written file.
 */
export function writeSecretsFile(
  folderPath: string,
  secrets: SecretsMap = DEFAULT_SECRETS,
  fileName: string = DEFAULT_SECRETS_FILE_NAME
): string {
  fs.mkdirSync(folderPath, { recursive: true });
  const fullPath = path.join(folderPath, fileName);
  fs.writeFileSync(fullPath, createSecretsJson(secrets), "utf8");
  return fullPath;
}
