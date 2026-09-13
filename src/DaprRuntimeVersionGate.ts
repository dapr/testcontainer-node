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

import { DAPR_RUNTIME_VERSION_ENV_VAR } from "./Constants";

/**
 * Represents a parsed semantic Dapr version.
 */
export interface DaprVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Represents the result of a Dapr runtime version gate check.
 */
export interface VersionGateResult {
  isSatisfied: boolean;
  reason?: string;
}

/**
 * Compares two Dapr versions.
 *
 * @param a First Dapr version
 * @param b Second Dapr version
 * @returns Negative number if a < b, positive if a > b, 0 if equal
 */
export function compareDaprVersions(a: DaprVersion, b: DaprVersion): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
}

/**
 * Gate that determines whether the current Dapr runtime satisfies a minimum version requirement.
 * Mirrors DaprRuntimeVersionGate in Dapr.Testcontainers.Xunit.
 */
export class DaprRuntimeVersionGate {
  /**
   * Checks whether the current Dapr runtime version satisfies the specified minimum version.
   *
   * @param minimumVersion The minimum required Dapr version (e.g. "1.18.0").
   * @param currentRaw Optional current runtime version. Defaults to process.env.DAPR_RUNTIME_VERSION.
   * @returns VersionGateResult with isSatisfied boolean and optional reason string.
   */
  public static isMinimumSatisfied(
    minimumVersion: string,
    currentRaw: string | undefined = process.env[DAPR_RUNTIME_VERSION_ENV_VAR]
  ): VersionGateResult {
    const minVersion = DaprRuntimeVersionGate.tryParseVersion(minimumVersion);
    if (!minVersion) {
      throw new Error(`Invalid minimum Dapr runtime version '${minimumVersion}'.`);
    }

    if (!currentRaw || currentRaw.trim().length === 0 || currentRaw.trim().toLowerCase() === "latest") {
      return { isSatisfied: true };
    }

    const currentVersion = DaprRuntimeVersionGate.tryParseVersion(currentRaw);
    if (!currentVersion) {
      return { isSatisfied: true };
    }

    if (compareDaprVersions(currentVersion, minVersion) >= 0) {
      return { isSatisfied: true };
    }

    return {
      isSatisfied: false,
      reason: `Requires Dapr runtime >= ${minimumVersion} (current: ${currentRaw.trim()}).`,
    };
  }

  /**
   * Attempts to parse a version string into a DaprVersion object.
   * Handles optional leading 'v', prerelease suffixes (e.g. -rc.1), and build metadata.
   *
   * @param value The version string to parse.
   * @returns DaprVersion object or null if parsing fails.
   */
  public static tryParseVersion(value?: string | null): DaprVersion | null {
    if (!value || typeof value !== "string") {
      return null;
    }

    let trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    if (trimmed.startsWith("v") || trimmed.startsWith("V")) {
      trimmed = trimmed.substring(1);
    }

    const withoutMetadata = trimmed.split("+")[0];
    const withoutPrerelease = withoutMetadata.split("-")[0];
    const parts = withoutPrerelease.split(".").filter((p) => p.length > 0);

    if (parts.length !== 2 && parts.length !== 3) {
      return null;
    }

    if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
      return null;
    }

    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);

    let patch = 0;
    if (parts.length === 3) {
      if (!/^\d+$/.test(parts[2])) {
        return null;
      }
      patch = parseInt(parts[2], 10);
    }

    return { major, minor, patch };
  }
}

/**
 * Checks whether the current Dapr runtime satisfies a minimum version requirement.
 *
 * @param minimumVersion The minimum required Dapr version (e.g. "1.18.0").
 * @param currentRaw Optional current runtime version string.
 * @returns True if satisfied, false otherwise.
 */
export function isMinimumDaprVersionSatisfied(minimumVersion: string, currentRaw?: string): boolean {
  return DaprRuntimeVersionGate.isMinimumSatisfied(minimumVersion, currentRaw).isSatisfied;
}

function getGlobalIt(): any {
  if (typeof it !== "undefined") {
    return it;
  }
  if (typeof test !== "undefined") {
    return test;
  }
  return undefined;
}

function getGlobalDescribe(): any {
  if (typeof describe !== "undefined") {
    return describe;
  }
  return undefined;
}

function wrapTestFn(
  minimumVersion: string,
  fn?: jest.ProvidesCallback
): jest.ProvidesCallback | undefined {
  if (!fn) {
    return undefined;
  }
  if ((fn as any).length > 0) {
    return function (done: jest.DoneCallback) {
      if (!isMinimumDaprVersionSatisfied(minimumVersion)) {
        return (done as any)();
      }
      return (fn as any)(done);
    };
  }
  return function () {
    if (!isMinimumDaprVersionSatisfied(minimumVersion)) {
      return;
    }
    return (fn as any)();
  };
}

/**
 * Jest test helper that marks a unit or integration test as skippable if the Dapr runtime
 * version (from DAPR_RUNTIME_VERSION) is older than the required minimum version.
 *
 * Can be used as a direct test definition:
 * ```ts
 * minimumDaprRuntimeFact("1.18.0", "should test new feature", async () => { ... });
 * ```
 * Or as a test runner function:
 * ```ts
 * minimumDaprRuntimeFact("1.18.0")("should test new feature", async () => { ... });
 * ```
 */
export function minimumDaprRuntimeFact(
  minimumVersion: string,
  name: string,
  fn?: jest.ProvidesCallback,
  timeout?: number
): void;
export function minimumDaprRuntimeFact(minimumVersion: string): jest.It;
export function minimumDaprRuntimeFact(
  minimumVersion: string,
  name?: string,
  fn?: jest.ProvidesCallback,
  timeout?: number
): any {
  const gate = DaprRuntimeVersionGate.isMinimumSatisfied(minimumVersion);
  const globalIt = getGlobalIt();

  if (!globalIt) {
    throw new Error("Jest 'it' or 'test' is not available in the current environment.");
  }

  const runner = gate.isSatisfied ? globalIt : globalIt.skip;

  if (name !== undefined) {
    return runner(name, wrapTestFn(minimumVersion, fn), timeout);
  }
  return runner;
}

/**
 * PascalCase alias for minimumDaprRuntimeFact, mirroring MinimumDaprRuntimeFactAttribute in Dapr.Testcontainers.Xunit.
 */
export const MinimumDaprRuntimeFact = minimumDaprRuntimeFact;

/**
 * Jest test helper alias for it / test with minimum Dapr version requirement.
 */
export const itMinimumDaprVersion = minimumDaprRuntimeFact;

/**
 * Jest test helper alias for it / test with minimum Dapr version requirement.
 */
export const itIfMinimumDaprVersion = minimumDaprRuntimeFact;

/**
 * Jest test helper alias for it / test with minimum Dapr version requirement.
 */
export const testMinimumDaprVersion = minimumDaprRuntimeFact;

/**
 * Jest test helper alias for it / test with minimum Dapr version requirement.
 */
export const testIfMinimumDaprVersion = minimumDaprRuntimeFact;

/**
 * Jest describe suite helper that marks an entire describe suite as skippable if the Dapr runtime
 * version (from DAPR_RUNTIME_VERSION) is older than the required minimum version.
 *
 * Can be used as a direct suite definition:
 * ```ts
 * describeMinimumDaprVersion("1.18.0", "New Feature Suite", () => { ... });
 * ```
 * Or as a describe runner function:
 * ```ts
 * describeMinimumDaprVersion("1.18.0")("New Feature Suite", () => { ... });
 * ```
 */
export function describeMinimumDaprVersion(
  minimumVersion: string,
  name: number | string | ((...args: any[]) => any) | jest.FunctionLike,
  fn: jest.EmptyFunction
): void;
export function describeMinimumDaprVersion(minimumVersion: string): jest.Describe;
export function describeMinimumDaprVersion(
  minimumVersion: string,
  name?: number | string | ((...args: any[]) => any) | jest.FunctionLike,
  fn?: jest.EmptyFunction
): any {
  const gate = DaprRuntimeVersionGate.isMinimumSatisfied(minimumVersion);
  const globalDescribe = getGlobalDescribe();

  if (!globalDescribe) {
    throw new Error("Jest 'describe' is not available in the current environment.");
  }

  const runner = gate.isSatisfied ? globalDescribe : globalDescribe.skip;

  if (name !== undefined && fn !== undefined) {
    return runner(name as any, fn);
  }
  return runner;
}

/**
 * Alias for describeMinimumDaprVersion.
 */
export const describeIfMinimumDaprVersion = describeMinimumDaprVersion;
