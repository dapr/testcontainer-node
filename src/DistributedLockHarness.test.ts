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
import { Network } from "testcontainers";
import { DaprComponentNames } from "./Constants";
import { DaprContainer } from "./DaprContainer";
import { DistributedLockHarness, LockStatus } from "./DistributedLockHarness";
import { RedisContainer } from "./RedisContainer";

describe("DistributedLockHarness and Distributed Lock Support", () => {
  describe("Configuration & Unit tests", () => {
    it("should expose DistributedLockComponentName constant", () => {
      expect(DistributedLockHarness.DistributedLockComponentName).toBe(DaprComponentNames.DistributedLockComponentName);
      expect(DistributedLockHarness.DistributedLockComponentName).toBe("distributed-lock");
    });

    it("should configure DaprContainer with distributed lock support", () => {
      const dapr = new DaprContainer().withDistributedLock({
        lockStoreName: "custom-lock-store",
      });

      expect(dapr.isDistributedLockEnabled()).toBe(true);
      expect(dapr.getComponents()).toEqual([]);
    });

    it("should configure DistributedLockHarness with default options", () => {
      const harness = new DistributedLockHarness();
      const dapr = harness.getDaprContainer();

      expect(dapr.isDistributedLockEnabled()).toBe(true);
      expect(dapr.getAppName()).toBe("distributed-lock-app");
    });

    it("should configure DistributedLockHarness with custom options", () => {
      const customRedis = new RedisContainer();
      const harness = new DistributedLockHarness({
        appId: "custom-lock-app",
        appPort: 9001,
        appChannelAddress: "custom-address",
        daprLogLevel: "debug",
        daprApiLoggingEnabled: true,
        redisContainer: customRedis,
        lockStoreName: "custom-lock",
        redisPassword: "secret-redis-password",
      });

      const dapr = harness.getDaprContainer();
      expect(dapr.isDistributedLockEnabled()).toBe(true);
      expect(dapr.getAppName()).toBe("custom-lock-app");
      expect(dapr.getAppPort()).toBe(9001);
      expect(dapr.getAppChannelAddress()).toBe("custom-address");
      expect(dapr.getRedisContainer()).toBe(customRedis);
    });

    it("should throw error when accessing started container before start()", () => {
      const harness = new DistributedLockHarness();
      expect(() => harness.getStartedDaprContainer()).toThrow(
        "DistributedLockHarness has not been started. Call start() first."
      );
      expect(() => harness.getHost()).toThrow();
      expect(() => harness.getHttpPort()).toThrow();
      expect(() => harness.getGrpcPort()).toThrow();
      expect(() => harness.getHttpEndpoint()).toThrow();
      expect(() => harness.getGrpcEndpoint()).toThrow();
      expect(() => harness.createDaprClient()).toThrow();
    });
  });

  describe("Integration tests", () => {
    it("should acquire and release a distributed lock using DistributedLockHarness", async () => {
      await using network = await new Network().start();
      const harness = new DistributedLockHarness({
        appId: "lock-test-app",
        daprLogLevel: "info",
        network,
      });

      try {
        await harness.start();

        const client = harness.createDaprClient();
        await client.start();

        const resourceId = `res-${Date.now()}`;
        const owner = `owner-${Date.now()}`;
        const lockStoreName = DistributedLockHarness.DistributedLockComponentName;

        const lockResponse = await client.lock.lock(lockStoreName, resourceId, owner, 10);
        expect(lockResponse).toBeDefined();
        expect(lockResponse.success).toBe(true);

        const unlockResponse = await client.lock.unlock(lockStoreName, resourceId, owner);
        expect(unlockResponse).toBeDefined();
        expect(unlockResponse.status).toBe(LockStatus.Success);
      } finally {
        await harness.stop();
      }
    }, 300_000);

    it("should enforce exclusivity and return expected unlock statuses", async () => {
      await using network = await new Network().start();
      const harness = new DistributedLockHarness({
        appId: "lock-exclusivity-app",
        daprLogLevel: "info",
        network,
      });

      try {
        await harness.start();

        const client1 = harness.createDaprClient();
        const client2 = harness.createDaprClient();
        await client1.start();
        await client2.start();

        const resourceId = `res-exclusivity-${Date.now()}`;
        const owner1 = `owner-1-${Date.now()}`;
        const owner2 = `owner-2-${Date.now()}`;
        const lockStoreName = DistributedLockHarness.DistributedLockComponentName;

        // Owner 1 acquires lock
        const lock1 = await client1.lock.lock(lockStoreName, resourceId, owner1, 20);
        expect(lock1.success).toBe(true);

        // While owner1 holds the lock, owner2 should not be able to acquire it
        const lock2 = await client2.lock.lock(lockStoreName, resourceId, owner2, 20);
        expect(lock2.success).toBe(false);

        // Wrong owner tries to unlock -> LockBelongsToOthers
        const wrongUnlock = await client2.lock.unlock(lockStoreName, resourceId, owner2);
        expect(wrongUnlock.status).toBe(LockStatus.LockBelongsToOthers);

        // Correct owner unlocks -> Success
        const correctUnlock = await client1.lock.unlock(lockStoreName, resourceId, owner1);
        expect(correctUnlock.status).toBe(LockStatus.Success);

        // Unlocking again after release -> LockDoesNotExist
        const secondUnlock = await client1.lock.unlock(lockStoreName, resourceId, owner1);
        expect(secondUnlock.status).toBe(LockStatus.LockDoesNotExist);
      } finally {
        await harness.stop();
      }
    }, 300_000);

    it("should allow lock acquisition after expiry TTL", async () => {
      await using network = await new Network().start();
      const harness = new DistributedLockHarness({
        appId: "lock-expiry-app",
        daprLogLevel: "info",
        network,
      });

      try {
        await harness.start();

        const client = harness.createDaprClient();
        await client.start();

        const resourceId = `res-expiry-${Date.now()}`;
        const owner1 = `owner-1-${Date.now()}`;
        const owner2 = `owner-2-${Date.now()}`;
        const lockStoreName = DistributedLockHarness.DistributedLockComponentName;

        // Acquire short-lived lock (2 seconds) and do NOT unlock
        const firstLock = await client.lock.lock(lockStoreName, resourceId, owner1, 2);
        expect(firstLock.success).toBe(true);

        // Poll until owner2 can acquire the lock after TTL expiration
        const startTime = Date.now();
        let acquiredByOwner2 = false;
        while (Date.now() - startTime < 30_000) {
          const secondLock = await client.lock.lock(lockStoreName, resourceId, owner2, 10);
          if (secondLock.success) {
            acquiredByOwner2 = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        expect(acquiredByOwner2).toBe(true);

        const unlock = await client.lock.unlock(lockStoreName, resourceId, owner2);
        expect(unlock.status).toBe(LockStatus.Success);
      } finally {
        await harness.stop();
      }
    }, 300_000);

    it("should support custom lock store name", async () => {
      await using network = await new Network().start();
      const customStoreName = "my-custom-lock";
      const harness = new DistributedLockHarness({
        appId: "custom-store-app",
        lockStoreName: customStoreName,
        network,
      });

      try {
        await harness.start();

        const client = harness.createClient();
        await client.start();

        const resourceId = `res-custom-${Date.now()}`;
        const owner = `owner-${Date.now()}`;

        const lock = await client.lock.lock(customStoreName, resourceId, owner, 10);
        expect(lock.success).toBe(true);

        const unlock = await client.lock.unlock(customStoreName, resourceId, owner);
        expect(unlock.status).toBe(LockStatus.Success);
      } finally {
        await harness.stop();
      }
    }, 300_000);

    it("should work using DaprContainer directly with withDistributedLock()", async () => {
      await using network = await new Network().start();
      const dapr = new DaprContainer()
        .withNetwork(network)
        .withAppName("direct-lock-app")
        .withDaprLogLevel("info")
        .withDistributedLock({
          lockStoreName: DaprComponentNames.DistributedLockComponentName,
        });

      await using started = await dapr.start();

      const client = new DaprClient({
        daprHost: started.getHost(),
        daprPort: started.getHttpPort().toString(),
      });
      await client.start();

      try {
        const resourceId = `res-direct-${Date.now()}`;
        const owner = `owner-${Date.now()}`;
        const lockStoreName = DaprComponentNames.DistributedLockComponentName;

        const lock = await client.lock.lock(lockStoreName, resourceId, owner, 10);
        expect(lock.success).toBe(true);

        const unlock = await client.lock.unlock(lockStoreName, resourceId, owner);
        expect(unlock.status).toBe(LockStatus.Success);
      } finally {
        await client.stop();
      }
    }, 300_000);

    it("should work over gRPC communication protocol", async () => {
      await using network = await new Network().start();
      const harness = new DistributedLockHarness({
        appId: "grpc-lock-app",
        daprLogLevel: "info",
        network,
      });

      try {
        await harness.start();

        const client = harness.createDaprClient({
          communicationProtocol: CommunicationProtocolEnum.GRPC,
        });
        await client.start();

        const resourceId = `res-grpc-${Date.now()}`;
        const owner = `owner-${Date.now()}`;
        const lockStoreName = DistributedLockHarness.DistributedLockComponentName;

        const lock = await client.lock.lock(lockStoreName, resourceId, owner, 10);
        expect(lock.success).toBe(true);

        const unlock = await client.lock.unlock(lockStoreName, resourceId, owner);
        expect(unlock.status).toBe(LockStatus.Success);
      } finally {
        await harness.stop();
      }
    }, 300_000);
  });
});
