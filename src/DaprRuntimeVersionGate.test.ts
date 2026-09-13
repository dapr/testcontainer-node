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
import {
  compareDaprVersions,
  DaprRuntimeVersionGate,
  describeIfMinimumDaprVersion,
  describeMinimumDaprVersion,
  isMinimumDaprVersionSatisfied,
  itIfMinimumDaprVersion,
  itMinimumDaprVersion,
  MinimumDaprRuntimeFact,
  minimumDaprRuntimeFact,
  testIfMinimumDaprVersion,
  testMinimumDaprVersion,
} from "./DaprRuntimeVersionGate";

describe("DaprRuntimeVersionGate", () => {
  const originalEnv = process.env[DAPR_RUNTIME_VERSION_ENV_VAR];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = originalEnv;
    } else {
      delete process.env[DAPR_RUNTIME_VERSION_ENV_VAR];
    }
  });

  describe("tryParseVersion", () => {
    it("should parse standard 3-part version", () => {
      expect(DaprRuntimeVersionGate.tryParseVersion("1.18.4")).toEqual({
        major: 1,
        minor: 18,
        patch: 4,
      });
    });

    it("should parse 2-part version defaulting patch to 0", () => {
      expect(DaprRuntimeVersionGate.tryParseVersion("1.18")).toEqual({
        major: 1,
        minor: 18,
        patch: 0,
      });
    });

    it("should parse version with leading 'v' or 'V'", () => {
      expect(DaprRuntimeVersionGate.tryParseVersion("v1.18.4")).toEqual({
        major: 1,
        minor: 18,
        patch: 4,
      });
      expect(DaprRuntimeVersionGate.tryParseVersion("V1.18")).toEqual({
        major: 1,
        minor: 18,
        patch: 0,
      });
    });

    it("should ignore prerelease identifiers", () => {
      expect(DaprRuntimeVersionGate.tryParseVersion("1.18.0-rc.1")).toEqual({
        major: 1,
        minor: 18,
        patch: 0,
      });
      expect(DaprRuntimeVersionGate.tryParseVersion("v1.19.0-alpha.2")).toEqual({
        major: 1,
        minor: 19,
        patch: 0,
      });
    });

    it("should ignore build metadata", () => {
      expect(DaprRuntimeVersionGate.tryParseVersion("1.18.4+build.2026")).toEqual({
        major: 1,
        minor: 18,
        patch: 4,
      });
      expect(DaprRuntimeVersionGate.tryParseVersion("1.18.4-rc.1+build.2026")).toEqual({
        major: 1,
        minor: 18,
        patch: 4,
      });
    });

    it("should handle surrounding whitespace", () => {
      expect(DaprRuntimeVersionGate.tryParseVersion("   1.18.4   ")).toEqual({
        major: 1,
        minor: 18,
        patch: 4,
      });
    });

    it("should return null for invalid version formats", () => {
      expect(DaprRuntimeVersionGate.tryParseVersion(null)).toBeNull();
      expect(DaprRuntimeVersionGate.tryParseVersion(undefined)).toBeNull();
      expect(DaprRuntimeVersionGate.tryParseVersion("")).toBeNull();
      expect(DaprRuntimeVersionGate.tryParseVersion("   ")).toBeNull();
      expect(DaprRuntimeVersionGate.tryParseVersion("latest")).toBeNull();
      expect(DaprRuntimeVersionGate.tryParseVersion("abc")).toBeNull();
      expect(DaprRuntimeVersionGate.tryParseVersion("1")).toBeNull();
      expect(DaprRuntimeVersionGate.tryParseVersion("1.18.0.1")).toBeNull();
      expect(DaprRuntimeVersionGate.tryParseVersion("1.x")).toBeNull();
      expect(DaprRuntimeVersionGate.tryParseVersion("1.18.x")).toBeNull();
      expect(DaprRuntimeVersionGate.tryParseVersion("x.18.0")).toBeNull();
    });
  });

  describe("compareDaprVersions", () => {
    it("should correctly compare major, minor, and patch versions", () => {
      expect(compareDaprVersions({ major: 1, minor: 18, patch: 0 }, { major: 1, minor: 18, patch: 0 })).toBe(0);
      expect(compareDaprVersions({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 18, patch: 0 })).toBeGreaterThan(
        0
      );
      expect(compareDaprVersions({ major: 1, minor: 17, patch: 0 }, { major: 1, minor: 18, patch: 0 })).toBeLessThan(0);
      expect(compareDaprVersions({ major: 1, minor: 18, patch: 1 }, { major: 1, minor: 18, patch: 0 })).toBeGreaterThan(
        0
      );
      expect(compareDaprVersions({ major: 1, minor: 18, patch: 0 }, { major: 1, minor: 18, patch: 1 })).toBeLessThan(0);
    });
  });

  describe("isMinimumSatisfied", () => {
    it("should throw error if minimumVersion is invalid", () => {
      expect(() => DaprRuntimeVersionGate.isMinimumSatisfied("invalid")).toThrow(
        "Invalid minimum Dapr runtime version 'invalid'."
      );
      expect(() => DaprRuntimeVersionGate.isMinimumSatisfied("")).toThrow("Invalid minimum Dapr runtime version ''.");
    });

    it("should return satisfied when current version is unset or whitespace", () => {
      delete process.env[DAPR_RUNTIME_VERSION_ENV_VAR];
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0")).toEqual({
        isSatisfied: true,
      });

      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "   ";
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0")).toEqual({
        isSatisfied: true,
      });
    });

    it("should return satisfied when current version is 'latest'", () => {
      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "latest";
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0")).toEqual({
        isSatisfied: true,
      });

      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "LATEST";
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0")).toEqual({
        isSatisfied: true,
      });
    });

    it("should return satisfied when current version cannot be parsed", () => {
      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "custom-build-tag";
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0")).toEqual({
        isSatisfied: true,
      });
    });

    it("should return satisfied when current version >= minimumVersion", () => {
      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.18.4";
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0")).toEqual({
        isSatisfied: true,
      });

      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.18.0";
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0")).toEqual({
        isSatisfied: true,
      });

      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.18.0-rc.1";
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0")).toEqual({
        isSatisfied: true,
      });

      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "v2.0.0";
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0")).toEqual({
        isSatisfied: true,
      });
    });

    it("should return unsatisfied with reason when current version < minimumVersion", () => {
      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.17.4";
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0")).toEqual({
        isSatisfied: false,
        reason: "Requires Dapr runtime >= 1.18.0 (current: 1.17.4).",
      });

      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "v1.17.0-rc.1";
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0")).toEqual({
        isSatisfied: false,
        reason: "Requires Dapr runtime >= 1.18.0 (current: v1.17.0-rc.1).",
      });
    });

    it("should allow passing current version as argument", () => {
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0", "1.19.0")).toEqual({
        isSatisfied: true,
      });
      expect(DaprRuntimeVersionGate.isMinimumSatisfied("1.18.0", "1.16.0")).toEqual({
        isSatisfied: false,
        reason: "Requires Dapr runtime >= 1.18.0 (current: 1.16.0).",
      });
    });
  });

  describe("isMinimumDaprVersionSatisfied", () => {
    it("should return boolean matching gate result", () => {
      expect(isMinimumDaprVersionSatisfied("1.18.0", "1.18.4")).toBe(true);
      expect(isMinimumDaprVersionSatisfied("1.18.0", "1.17.0")).toBe(false);
    });
  });

  describe("Jest test helpers", () => {
    it("should return global it when satisfied", () => {
      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.18.4";
      const runner = minimumDaprRuntimeFact("1.18.0");
      expect(runner).toBe(it);
    });

    it("should return global it.skip when unsatisfied", () => {
      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.16.0";
      const runner = minimumDaprRuntimeFact("1.18.0");
      expect(runner).toBe(it.skip);
    });

    it("should return global describe when satisfied", () => {
      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.18.4";
      const runner = describeMinimumDaprVersion("1.18.0");
      expect(runner).toBe(describe);
    });

    it("should return global describe.skip when unsatisfied", () => {
      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.16.0";
      const runner = describeMinimumDaprVersion("1.18.0");
      expect(runner).toBe(describe.skip);
    });

    it("should invoke mock it runner when called directly with satisfied version", () => {
      const mockIt: any = jest.fn();
      mockIt.skip = jest.fn();
      const origIt = (globalThis as any).it;
      (globalThis as any).it = mockIt;

      try {
        process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.18.4";
        const testFn = jest.fn();
        minimumDaprRuntimeFact("1.18.0", "should run test", testFn, 5000);

        expect(mockIt).toHaveBeenCalledTimes(1);
        expect(mockIt.skip).not.toHaveBeenCalled();
        expect(mockIt.mock.calls[0][0]).toBe("should run test");
        expect(mockIt.mock.calls[0][2]).toBe(5000);

        // Execute wrapped function
        const wrappedFn = mockIt.mock.calls[0][1];
        wrappedFn();
        expect(testFn).toHaveBeenCalledTimes(1);
      } finally {
        (globalThis as any).it = origIt;
      }
    });

    it("should invoke mock it.skip runner when called directly with unsatisfied version", () => {
      const mockIt: any = jest.fn();
      mockIt.skip = jest.fn();
      const origIt = (globalThis as any).it;
      (globalThis as any).it = mockIt;

      try {
        process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.16.0";
        const testFn = jest.fn();
        minimumDaprRuntimeFact("1.18.0", "should skip test", testFn);

        expect(mockIt.skip).toHaveBeenCalledTimes(1);
        expect(mockIt).not.toHaveBeenCalled();
        expect(mockIt.skip.mock.calls[0][0]).toBe("should skip test");
      } finally {
        (globalThis as any).it = origIt;
      }
    });

    it("should safely guard test callback if runtime version is unsatisfied during execution", () => {
      const mockIt: any = jest.fn();
      mockIt.skip = jest.fn();
      const origIt = (globalThis as any).it;
      (globalThis as any).it = mockIt;

      try {
        process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.18.4";
        const testFn = jest.fn();
        minimumDaprRuntimeFact("1.18.0", "runtime test", testFn);

        const wrappedFn = mockIt.mock.calls[0][1];

        // Changed to unsatisfied before test function executes
        process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.16.0";
        wrappedFn();
        expect(testFn).not.toHaveBeenCalled();
      } finally {
        (globalThis as any).it = origIt;
      }
    });

    it("should handle callback-style (done) test functions", () => {
      const mockIt: any = jest.fn();
      mockIt.skip = jest.fn();
      const origIt = (globalThis as any).it;
      (globalThis as any).it = mockIt;

      try {
        process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.18.4";
        const testFn = jest.fn((done: any) => done());
        minimumDaprRuntimeFact("1.18.0", "callback test", testFn);

        const wrappedFn = mockIt.mock.calls[0][1];
        const doneMock = jest.fn();
        wrappedFn(doneMock);
        expect(testFn).toHaveBeenCalledWith(doneMock);

        // Unsatisfied case for done callback
        process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.16.0";
        const doneMock2 = jest.fn();
        wrappedFn(doneMock2);
        expect(doneMock2).toHaveBeenCalled();
      } finally {
        (globalThis as any).it = origIt;
      }
    });

    it("should invoke mock describe runner when called directly", () => {
      const mockDescribe: any = jest.fn();
      mockDescribe.skip = jest.fn();
      const origDescribe = (globalThis as any).describe;
      (globalThis as any).describe = mockDescribe;

      try {
        process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.18.4";
        const suiteFn = jest.fn();
        describeMinimumDaprVersion("1.18.0", "Suite 1", suiteFn);
        expect(mockDescribe).toHaveBeenCalledWith("Suite 1", suiteFn);

        process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.16.0";
        describeMinimumDaprVersion("1.18.0", "Suite 2", suiteFn);
        expect(mockDescribe.skip).toHaveBeenCalledWith("Suite 2", suiteFn);
      } finally {
        (globalThis as any).describe = origDescribe;
      }
    });

    it("should handle calls without test callback fn", () => {
      const mockIt: any = jest.fn();
      mockIt.skip = jest.fn();
      const origIt = (globalThis as any).it;
      (globalThis as any).it = mockIt;

      try {
        process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.18.4";
        minimumDaprRuntimeFact("1.18.0", "name only");
        expect(mockIt).toHaveBeenCalledWith("name only", undefined, undefined);
      } finally {
        (globalThis as any).it = origIt;
      }
    });

    it("should fall back to test when it is undefined", () => {
      const origIt = (globalThis as any).it;
      delete (globalThis as any).it;
      try {
        process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.18.4";
        const runner = minimumDaprRuntimeFact("1.18.0");
        expect(runner).toBe(test);
      } finally {
        (globalThis as any).it = origIt;
      }
    });

    it("should throw error if it is not available in environment", () => {
      const origIt = (globalThis as any).it;
      const origTest = (globalThis as any).test;
      delete (globalThis as any).it;
      delete (globalThis as any).test;

      try {
        expect(() => minimumDaprRuntimeFact("1.18.0")).toThrow(
          "Jest 'it' or 'test' is not available in the current environment."
        );
      } finally {
        (globalThis as any).it = origIt;
        (globalThis as any).test = origTest;
      }
    });

    it("should throw error if describe is not available in environment", () => {
      const origDescribe = (globalThis as any).describe;
      delete (globalThis as any).describe;

      try {
        expect(() => describeMinimumDaprVersion("1.18.0")).toThrow(
          "Jest 'describe' is not available in the current environment."
        );
      } finally {
        (globalThis as any).describe = origDescribe;
      }
    });

    it("should support all test aliases", () => {
      expect(MinimumDaprRuntimeFact).toBe(minimumDaprRuntimeFact);
      expect(itMinimumDaprVersion).toBe(minimumDaprRuntimeFact);
      expect(itIfMinimumDaprVersion).toBe(minimumDaprRuntimeFact);
      expect(testMinimumDaprVersion).toBe(minimumDaprRuntimeFact);
      expect(testIfMinimumDaprVersion).toBe(minimumDaprRuntimeFact);
    });

    it("should support describe aliases", () => {
      expect(describeIfMinimumDaprVersion).toBe(describeMinimumDaprVersion);
    });
  });

  // Real-world integration check within Jest execution:
  // When running with default or latest, this test executes.
  itMinimumDaprVersion("1.0.0", "should execute because min version 1.0.0 is satisfied", () => {
    expect(true).toBe(true);
  });
});
