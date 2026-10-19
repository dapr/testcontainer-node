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

import { CommunicationProtocolEnum } from "@dapr/dapr";
import { Network } from "testcontainers";
import { BinaryStoreHarness, DaprComponentNames, DaprContainer, getDaprVersion } from "./index";
import { DaprRuntimeVersionGate } from "./DaprRuntimeVersionGate";
import { MetadataEntry } from "./MetadataEntry";

describe("BinaryStoreHarness", () => {
  afterEach(() => jest.restoreAllMocks());

  it("registers the default in-memory component without external storage", () => {
    const harness = new BinaryStoreHarness();
    const dapr = harness.getDaprContainer();
    expect(harness.getBinaryStoreName()).toBe(DaprComponentNames.BinaryStoreComponentName);
    expect(dapr.getAppName()).toBe("binarystore-app");
    expect(dapr.getRedisContainer()).toBeUndefined();
    expect(dapr.getComponents()).toEqual([
      expect.objectContaining({ name: "binarystore", type: "binarystore.in-memory", version: "v1" }),
    ]);
    expect(dapr.getComponents()[0].getMetadata()).toEqual([]);
  });

  it("forwards custom component and application options", () => {
    const harness = new BinaryStoreHarness({
      appId: "binary-app",
      appPort: 8080,
      appChannelAddress: "host.testcontainers.internal",
      daprLogLevel: "debug",
      daprApiLoggingEnabled: true,
      daprRuntimeImage: "daprio/daprd:1.19.0-rc.4",
      binaryStoreName: "files",
      prefix: "test-",
      maxSize: "1Ki",
      maxTotalSize: "8Mi",
    });
    const dapr = harness.getDaprContainer();
    expect(dapr.getAppName()).toBe("binary-app");
    expect(dapr.getAppPort()).toBe(8080);
    expect(dapr.getAppChannelAddress()).toBe("host.testcontainers.internal");
    expect(harness.getBinaryStoreName()).toBe("files");
    expect(dapr.getComponents()[0].getMetadata()).toEqual([
      new MetadataEntry("prefix", "test-"),
      new MetadataEntry("maxSize", "1Ki"),
      new MetadataEntry("maxTotalSize", "8Mi"),
    ]);
  });

  it("supports direct component registration and rejects duplicate names", () => {
    const dapr = new DaprContainer();
    expect(dapr.withBinaryStore()).toBe(dapr);
    expect(() => dapr.withBinaryStore()).toThrow('A component named "binarystore" has already been registered');
    dapr.withBinaryStore({ binaryStoreName: "second-store" });
    expect(dapr.getComponents()).toHaveLength(2);
  });

  it.each(["", " ", ".", "..", "../files", "files\\data"])("rejects invalid store name %j", (binaryStoreName) => {
    expect(() => new BinaryStoreHarness({ binaryStoreName })).toThrow("Binary store name must be");
  });

  it("guards operations before start and permits stop before start", async () => {
    const harness = new BinaryStoreHarness();
    for (const get of [
      () => harness.getStartedDaprContainer(),
      () => harness.getHost(),
      () => harness.getHttpPort(),
      () => harness.getGrpcPort(),
      () => harness.getHttpEndpoint(),
      () => harness.getGrpcEndpoint(),
      () => harness.createDaprClient(),
    ]) {
      expect(get).toThrow("BinaryStoreHarness has not been started.");
    }
    await expect(harness.setBinaryFile("file", Buffer.from("data"))).rejects.toThrow("has not been started");
    await expect(harness.getBinaryFile("file")).rejects.toThrow("has not been started");
    await expect(harness.deleteBinaryFile("file")).rejects.toThrow("has not been started");
    await harness.stop();
    await harness[Symbol.asyncDispose]();
  });

  it("uses raw bytes, encodes file names, and maps overwrite to PUT or POST", async () => {
    const harness = new BinaryStoreHarness();
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const data = Buffer.from([0, 128, 255]);
    await harness.setBinaryFile("folder/file 100%.bin", data);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:3500/v1.0-alpha1/binarystore/binarystore/folder%2Ffile%20100%25.bin",
      { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(data) }
    );
    await harness.setBinaryFile("file.bin", data, false);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ method: "POST" }));
    fetchMock.mockResolvedValueOnce(new Response(data));
    expect(await harness.getBinaryFile("file.bin")).toEqual(data);
    await harness.deleteBinaryFile("file.bin");
    expect(fetchMock).toHaveBeenLastCalledWith(expect.any(String), { method: "DELETE" });
  });

  it.each(["", " ", ".", "..", "../file", "dir\\file", "/file", "dir/", "dir//file", "file?", "file#"])(
    "rejects invalid file name %j",
    async (fileName) => {
      const harness = new BinaryStoreHarness();
      jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
      const fetchMock = jest.spyOn(globalThis, "fetch");
      await expect(harness.getBinaryFile(fileName)).rejects.toThrow("Binary file name must be");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each([404, 409, 413, 500])("surfaces runtime error %i with its response body", async (status) => {
    const harness = new BinaryStoreHarness();
    jest.spyOn(harness, "getHttpEndpoint").mockReturnValue("http://localhost:3500");
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("runtime error", { status }));
    await expect(harness.getBinaryFile("file")).rejects.toThrow(
      `Binary store GET request failed (${status}): runtime error`
    );
  });
});

const itBinaryStore = DaprRuntimeVersionGate.isMinimumSatisfied("1.19.0", getDaprVersion()).isSatisfied ? it : it.skip;

describe("Binary Store integration (requires Dapr 1.19+)", () => {
  itBinaryStore(
    "round-trips binary data, enforces limits, and disposes an owned network",
    async () => {
      const harness = new BinaryStoreHarness({ binaryStoreName: "files", maxSize: "1Ki", maxTotalSize: "4Ki" });
      try {
        await harness.start();
        expect(await harness.start()).toBe(harness);
        expect(harness.getHost()).toBeDefined();
        expect(harness.getHttpPort()).toBeGreaterThan(0);
        expect(harness.getGrpcPort()).toBeGreaterThan(0);
        expect(harness.getGrpcEndpoint()).toContain(harness.getGrpcPort().toString());
        const metadata = await fetch(`${harness.getHttpEndpoint()}/v1.0/metadata`);
        expect((await metadata.json()).components).toEqual(
          expect.arrayContaining([expect.objectContaining({ name: "files", type: "binarystore.in-memory" })])
        );
        const httpClient = harness.createDaprClient();
        const grpcClient = harness.createDaprClient({ communicationProtocol: CommunicationProtocolEnum.GRPC });
        await httpClient.start();
        await grpcClient.start();

        const data = Buffer.from([0, 1, 127, 128, 254, 255]);
        await harness.setBinaryFile("file.bin", data, false);
        expect(await harness.getBinaryFile("file.bin")).toEqual(data);
        await expect(harness.setBinaryFile("file.bin", Buffer.from("conflict"), false)).rejects.toThrow("(409)");
        expect(await harness.getBinaryFile("file.bin")).toEqual(data);
        await harness.setBinaryFile("file.bin", Buffer.from("replacement"));
        expect(await harness.getBinaryFile("file.bin")).toEqual(Buffer.from("replacement"));
        await harness.setBinaryFile("empty.bin", Buffer.alloc(0));
        expect(await harness.getBinaryFile("empty.bin")).toEqual(Buffer.alloc(0));
        await harness.setBinaryFile("folder/file 100%.bin", data);
        expect(await harness.getBinaryFile("folder/file 100%.bin")).toEqual(data);
        await harness.deleteBinaryFile("folder/file 100%.bin");
        await harness.setBinaryFile("limit.bin", Buffer.alloc(1024, 255));
        expect(await harness.getBinaryFile("limit.bin")).toEqual(Buffer.alloc(1024, 255));
        await expect(harness.setBinaryFile("too-large.bin", Buffer.alloc(1025))).rejects.toThrow("(413)");
        await harness.deleteBinaryFile("file.bin");
        await expect(harness.getBinaryFile("file.bin")).rejects.toThrow("(404)");
        for (let i = 0; i < 3; i++) {
          await harness.setBinaryFile(`capacity-${i}.bin`, Buffer.alloc(1024));
        }
        await expect(harness.setBinaryFile("store-full.bin", Buffer.alloc(1))).rejects.toThrow("ERR_BINARY_STORE_FULL");
        await harness.deleteBinaryFile("capacity-0.bin");
        await harness.setBinaryFile("store-full.bin", Buffer.alloc(1));
        expect(await harness.getBinaryFile("store-full.bin")).toEqual(Buffer.alloc(1));
      } finally {
        await harness[Symbol.asyncDispose]();
      }
      expect(() => harness.getStartedDaprContainer()).toThrow("has not been started");
      await harness.stop();
    },
    120_000
  );

  itBinaryStore(
    "supports a caller-owned network and direct DaprContainer registration",
    async () => {
      await using network = await new Network().start();
      const stopNetwork = jest.spyOn(network, "stop");
      const harness = new BinaryStoreHarness({ network });
      try {
        await harness.start();
        await harness.setBinaryFile("file", Buffer.from("test"));
      } finally {
        await harness.stop();
      }
      expect(stopNetwork).not.toHaveBeenCalled();

      const dapr = new DaprContainer().withNetwork(network).withBinaryStore();
      await using started = await dapr.start();
      const endpoint = `${started.getHttpEndpoint()}/v1.0-alpha1/binarystore/binarystore/direct.bin`;
      const put = await fetch(endpoint, { method: "PUT", body: new Uint8Array([0, 255]) });
      expect(put.status).toBe(204);
      const get = await fetch(endpoint);
      expect(get.status).toBe(200);
      expect(Buffer.from(await get.arrayBuffer())).toEqual(Buffer.from([0, 255]));
    },
    120_000
  );
});
