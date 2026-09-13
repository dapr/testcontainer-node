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

import {
  DAPR_RUNTIME_VERSION_ENV_VAR,
  DaprComponentNames,
  DEFAULT_DAPR_VERSION,
  getDaprPlacementImage,
  getDaprRuntimeImage,
  getDaprSchedulerImage,
  getDaprVersion,
} from "./Constants";

describe("Constants", () => {
  const originalEnv = process.env[DAPR_RUNTIME_VERSION_ENV_VAR];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = originalEnv;
    } else {
      delete process.env[DAPR_RUNTIME_VERSION_ENV_VAR];
    }
  });

  it("should have default Dapr version 1.18.4", () => {
    delete process.env[DAPR_RUNTIME_VERSION_ENV_VAR];
    expect(DEFAULT_DAPR_VERSION).toBe("1.18.4");
    expect(getDaprVersion()).toBe("1.18.4");
    expect(getDaprRuntimeImage()).toBe("daprio/daprd:1.18.4");
    expect(getDaprPlacementImage()).toBe("daprio/placement:1.18.4");
    expect(getDaprSchedulerImage()).toBe("daprio/scheduler:1.18.4");
  });

  it("should override Dapr version using environment variable", () => {
    process.env[DAPR_RUNTIME_VERSION_ENV_VAR] = "1.16.4";
    expect(getDaprVersion()).toBe("1.16.4");
    expect(getDaprRuntimeImage()).toBe("daprio/daprd:1.16.4");
    expect(getDaprPlacementImage()).toBe("daprio/placement:1.16.4");
    expect(getDaprSchedulerImage()).toBe("daprio/scheduler:1.16.4");
  });

  it("should allow custom version parameter override", () => {
    expect(getDaprRuntimeImage("1.15.0")).toBe("daprio/daprd:1.15.0");
    expect(getDaprPlacementImage("1.15.0")).toBe("daprio/placement:1.15.0");
    expect(getDaprSchedulerImage("1.15.0")).toBe("daprio/scheduler:1.15.0");
  });

  it("should define standard component names", () => {
    expect(DaprComponentNames.StateManagementComponentName).toBe("statestore");
    expect(DaprComponentNames.PubSubComponentName).toBe("pubsub");
    expect(DaprComponentNames.ConversationComponentName).toBe("conversation");
    expect(DaprComponentNames.CryptographyComponentName).toBe("cryptography");
    expect(DaprComponentNames.DistributedLockComponentName).toBe("distributed-lock");
  });
});
