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

export const DEFAULT_DAPR_VERSION = "1.18.4";
export const DAPR_RUNTIME_VERSION_ENV_VAR = "DAPR_RUNTIME_VERSION";

/**
 * Resolves the Dapr runtime version to use.
 * If the DAPR_RUNTIME_VERSION environment variable is set and non-empty, its value is used.
 * Otherwise, falls back to the provided fallback or DEFAULT_DAPR_VERSION (1.18.4).
 *
 * @param fallback Optional fallback version if the environment variable is not set.
 * @returns The resolved Dapr version string.
 */
export function getDaprVersion(fallback: string = DEFAULT_DAPR_VERSION): string {
  const envVersion = process.env[DAPR_RUNTIME_VERSION_ENV_VAR];
  if (envVersion && envVersion.trim().length > 0) {
    return envVersion.trim();
  }
  return fallback;
}

/**
 * Returns the Docker image tag for the Dapr runtime (daprd).
 *
 * @param version Optional Dapr version string. Defaults to getDaprVersion().
 * @returns The full Docker image tag (e.g., "daprio/daprd:1.18.4").
 */
export function getDaprRuntimeImage(version: string = getDaprVersion()): string {
  return `daprio/daprd:${version}`;
}

/**
 * Returns the Docker image tag for the Dapr placement service.
 *
 * @param version Optional Dapr version string. Defaults to getDaprVersion().
 * @returns The full Docker image tag (e.g., "daprio/placement:1.18.4").
 */
export function getDaprPlacementImage(version: string = getDaprVersion()): string {
  return `daprio/placement:${version}`;
}

/**
 * Returns the Docker image tag for the Dapr scheduler service.
 *
 * @param version Optional Dapr version string. Defaults to getDaprVersion().
 * @returns The full Docker image tag (e.g., "daprio/scheduler:1.18.4").
 */
export function getDaprSchedulerImage(version: string = getDaprVersion()): string {
  return `daprio/scheduler:${version}`;
}

/**
 * Names commonly used for Dapr components, mirroring the .NET SDK Constants.
 */
export const DaprComponentNames = {
  StateManagementComponentName: "statestore",
  PubSubComponentName: "pubsub",
  ConversationComponentName: "conversation",
  CryptographyComponentName: "cryptography",
  DistributedLockComponentName: "distributed-lock",
} as const;
