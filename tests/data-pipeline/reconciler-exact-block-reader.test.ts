import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, keccak256, parseAbi, type Hex } from "viem";

vi.mock("server-only", () => ({}));

import {
  createExactBlockReconcilerRouteDtoReader,
  createExactBlockRpcClient,
} from "../../lib/data-pipeline/reconciler-exact-block-reader.server";
import { projectorRpcDeploymentCommitment } from "../../lib/data-pipeline/projector-provider-commitments";
import {
  CLASSIC_V2_RECONCILER_ROUTE_KEYS,
  RECONCILER_ROUTE_KEYS,
  type ReconcilerPreParityContract,
  type ReconcilerRouteDto,
} from "../../lib/data-pipeline/reconciler-preparity";
import { rpcProviderCommitment } from "../../lib/data-pipeline/rpc-provider-commitments";

const BLOCK_HASH = `0x${"11".repeat(32)}` as const;
const ALTERNATE_HASH = `0x${"22".repeat(32)}` as const;
const ADDRESS = `0x${"33".repeat(20)}` as const;
const ALTERNATE_ADDRESS = `0x${"44".repeat(20)}` as const;
const BLOCK_NUMBER = 25_700_000n;
const ALCHEMY = "https://eth-mainnet.g.alchemy.com/v2/abcdefgh12345678";
const QUICKNODE = "https://example.quiknode.pro/abcdefgh12345678/";

const contract: ReconcilerPreParityContract = {
  chainId: "1",
  releaseId: "classic-v3",
  modelId: "classic",
  sourceGroup: "ethereum-mainnet",
  projectorVersion: "projector-v1",
  epochId: "10000000-0000-4000-8000-000000000001",
  pointerGeneration: "7",
  checkpointId: "10000000-0000-4000-8000-000000000002",
  checkpointGeneration: "8",
  reorgGeneration: "2",
  checkpointBlockNumber: "25700000",
  checkpointBlockHash: BLOCK_HASH,
  routeKeys: RECONCILER_ROUTE_KEYS,
  routeContract: { exact: true },
  projectionContract: { exact: true },
  currentEntities: [],
};

function routes(label: string): readonly ReconcilerRouteDto[] {
  return RECONCILER_ROUTE_KEYS.map((routeKey) => ({
    routeKey,
    comparedCount: 1,
    dto: { label, routeKey },
  }));
}

function rpcResponse(id: number, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rpcBatchResponse(
  items: readonly Readonly<Record<string, unknown>>[],
  headers?: HeadersInit,
) {
  return new Response(JSON.stringify(items), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

const totalSupplyCall = encodeFunctionData({
  abi: parseAbi(["function totalSupply() view returns (uint256)"]),
  functionName: "totalSupply",
});

function block(hash = BLOCK_HASH) {
  return {
    number: "0x18826a0",
    hash,
    timestamp: "0x64",
  };
}

function blockAt(blockNumber: bigint, hash: Hex, timestamp: bigint) {
  return {
    number: `0x${blockNumber.toString(16)}`,
    hash,
    timestamp: `0x${timestamp.toString(16)}`,
  };
}

describe("exact-block reconciler RPC", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uses an EIP-1898 canonical block hash for every eth_call", async () => {
    const requests: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      return rpcResponse(Number(body.id), "0x");
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });
    await rpc.call({
      to: ADDRESS,
      data: totalSupplyCall,
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "eth_call",
      params: [
        { to: ADDRESS, data: totalSupplyCall },
        { blockHash: BLOCK_HASH, requireCanonical: true },
      ],
    });
    expect(JSON.stringify(requests[0])).not.toContain("latest");
  });

  it("reads runtime code by canonical EIP-1898 block hash and returns its hash", async () => {
    const runtime = "0x6001600055" as const;
    const requests: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      return rpcResponse(Number(body.id), runtime);
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.getCodeHash({
      address: ADDRESS,
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).resolves.toBe(keccak256(runtime));

    expect(requests).toEqual([expect.objectContaining({
      method: "eth_getCode",
      params: [
        ADDRESS,
        { blockHash: BLOCK_HASH, requireCanonical: true },
      ],
    })]);
    expect(JSON.stringify(requests)).not.toContain("latest");
  });

  it("fails closed when exact-block runtime code is empty", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return rpcResponse(Number(body.id), "0x");
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.getCodeHash({
      address: ADDRESS,
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
      safeMetadata: { operation: "reconciler-rpc-code-empty" },
    });
  });

  it("chunks eth_call batches and reconstructs results in request order", async () => {
    const batches: Array<readonly {
      id: number;
      method: string;
      params: readonly unknown[];
    }[]> = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Array<{
        id: number;
        method: string;
        params: readonly unknown[];
      }>;
      batches.push(body);
      return rpcBatchResponse(body.map((request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: `0x${request.id.toString(16).padStart(2, "0")}`,
      })).reverse());
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      maximumBatchSize: 2,
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.callMany({
      calls: [
        { to: ADDRESS, data: totalSupplyCall },
        { to: ALTERNATE_ADDRESS, data: totalSupplyCall },
        { to: ADDRESS, data: "0x" },
      ],
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).resolves.toEqual(["0x01", "0x02", "0x03"]);

    expect(batches.map((batch) => batch.length)).toEqual([2, 1]);
    expect(batches.flat().every((request) =>
      request.method === "eth_call" &&
      JSON.stringify(request.params).includes(
        `\"blockHash\":\"${BLOCK_HASH}\",\"requireCanonical\":true`,
      ) &&
      !JSON.stringify(request.params).includes("latest")
    )).toBe(true);
    expect(rpc.requestCount()).toBe(2);
    expect(rpc.logicalRequestCount()).toBe(3);
  });

  it("reads 257 exact-hash-bound block timestamps in nine physical requests", async () => {
    const firstBlock = 30_000_000n;
    const bindings = Array.from({ length: 257 }, (_, index) => {
      const blockNumber = firstBlock + BigInt(index);
      const expectedHash = `0x${(index + 1).toString(16).padStart(64, "0")}` as const;
      return Object.freeze({ blockNumber, expectedHash });
    });
    const batches: Array<readonly {
      id: number;
      method: string;
      params: readonly unknown[];
    }[]> = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Array<{
        id: number;
        method: string;
        params: readonly unknown[];
      }>;
      batches.push(body);
      return rpcBatchResponse(body.map((request) => {
        const blockNumber = BigInt(request.params[0] as string);
        const index = Number(blockNumber - firstBlock);
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: blockAt(
            blockNumber,
            bindings[index]!.expectedHash,
            1_700_000_000n + BigInt(index),
          ),
        };
      }).reverse());
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      maximumBatchSize: 32,
      maximumRequests: 9,
      maximumLogicalRequests: 257,
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.getBlockTimestamps({
      blocks: bindings,
      signal: new AbortController().signal,
    })).resolves.toEqual(Array.from(
      { length: 257 },
      (_, index) => 1_700_000_000n + BigInt(index),
    ));

    expect(batches.map((batch) => batch.length)).toEqual([
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      1,
    ]);
    expect(batches.flat().every((request) =>
      request.method === "eth_getBlockByNumber" &&
      request.params[1] === false
    )).toBe(true);
    expect(rpc.requestCount()).toBe(9);
    expect(rpc.logicalRequestCount()).toBe(257);
  });

  it("fails closed when a batched timestamp block hash does not match its binding", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Array<{ id: number }>;
      return rpcBatchResponse(body.map((request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: blockAt(BLOCK_NUMBER, ALTERNATE_HASH, 100n),
      })));
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.getBlockTimestamps({
      blocks: [{ blockNumber: BLOCK_NUMBER, expectedHash: BLOCK_HASH }],
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
      safeMetadata: { operation: "reconciler-rpc-block-hash-mismatch" },
    });
  });

  it("issues corpus clients in exact page order under one shared root budget", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return rpcResponse(Number(body.id), "0x");
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      maximumLogicalRequests: 1,
      fetch: fetchMock as typeof fetch,
    });
    const manifestCommitment = `0x${"51".repeat(32)}` as const;
    const first = rpc.createPartitionClient({
      manifestCommitment,
      pageCommitment: `0x${"52".repeat(32)}`,
      pageIndex: 0,
      pageCount: 2,
      pageSize: 128,
      totalCount: 256,
      startIndex: 0,
      endIndexExclusive: 128,
    });
    await first.call({
      to: ADDRESS,
      data: totalSupplyCall,
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    });
    const nested = first.createPartitionClient({
      manifestCommitment,
      pageCommitment: `0x${"55".repeat(32)}`,
      pageIndex: 0,
      pageCount: 1,
      pageSize: 1,
      totalCount: 1,
      startIndex: 0,
      endIndexExclusive: 1,
    });
    expect(() => nested.createPartitionClient({
      manifestCommitment,
      pageCommitment: `0x${"5a".repeat(32)}`,
      pageIndex: 0,
      pageCount: 1,
      pageSize: 1,
      totalCount: 1,
      startIndex: 0,
      endIndexExclusive: 1,
    })).toThrow();
    expect(() => rpc.createPartitionClient({
      manifestCommitment: `0x${"56".repeat(32)}`,
      pageCommitment: `0x${"57".repeat(32)}`,
      pageIndex: 1,
      pageCount: 2,
      pageSize: 128,
      totalCount: 256,
      startIndex: 128,
      endIndexExclusive: 256,
    })).toThrow();
    expect(() => rpc.createPartitionClient({
      manifestCommitment,
      pageCommitment: `0x${"58".repeat(32)}`,
      pageIndex: 1,
      pageCount: 3,
      pageSize: 128,
      totalCount: 256,
      startIndex: 128,
      endIndexExclusive: 256,
    })).toThrow();
    expect(() => rpc.createPartitionClient({
      manifestCommitment,
      pageCommitment: `0x${"59".repeat(32)}`,
      pageIndex: 1,
      pageCount: 2,
      pageSize: 128,
      totalCount: 256,
      startIndex: 129,
      endIndexExclusive: 256,
    })).toThrow();
    const second = rpc.createPartitionClient({
      manifestCommitment,
      pageCommitment: `0x${"53".repeat(32)}`,
      pageIndex: 1,
      pageCount: 2,
      pageSize: 128,
      totalCount: 256,
      startIndex: 128,
      endIndexExclusive: 256,
    });
    await expect(second.call({
      to: ADDRESS,
      data: totalSupplyCall,
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: "response_oversize",
      retryable: false,
      safeMetadata: { operation: "reconciler-rpc-logical-budget" },
    });

    expect(rpc.requestCount()).toBe(2);
    expect(rpc.logicalRequestCount()).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(() => rpc.createPartitionClient({
      manifestCommitment,
      pageCommitment: `0x${"54".repeat(32)}`,
      pageIndex: 1,
      pageCount: 2,
      pageSize: 128,
      totalCount: 256,
      startIndex: 128,
      endIndexExclusive: 256,
    })).toThrow();
  });

  it("rejects a partition sequence that does not start at page zero and index zero", () => {
    const fetchMock = vi.fn();
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });
    const manifestCommitment = `0x${"61".repeat(32)}` as const;
    expect(() => rpc.createPartitionClient({
      manifestCommitment,
      pageCommitment: `0x${"62".repeat(32)}`,
      pageIndex: 1,
      pageCount: 2,
      pageSize: 128,
      totalCount: 256,
      startIndex: 128,
      endIndexExclusive: 256,
    })).toThrow();
    expect(() => rpc.createPartitionClient({
      manifestCommitment,
      pageCommitment: `0x${"63".repeat(32)}`,
      pageIndex: 0,
      pageCount: 2,
      pageSize: 128,
      totalCount: 256,
      startIndex: 1,
      endIndexExclusive: 128,
    })).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "missing IDs",
      operation: "reconciler-rpc-batch-id-missing",
      response: (ids: readonly number[]) => [
        { jsonrpc: "2.0", id: ids[0], result: "0x01" },
      ],
    },
    {
      label: "duplicate IDs",
      operation: "reconciler-rpc-batch-id-duplicate",
      response: (ids: readonly number[]) => [
        { jsonrpc: "2.0", id: ids[0], result: "0x01" },
        { jsonrpc: "2.0", id: ids[0], result: "0x02" },
      ],
    },
    {
      label: "unknown IDs",
      operation: "reconciler-rpc-batch-id-unknown",
      response: (ids: readonly number[]) => [
        { jsonrpc: "2.0", id: ids[0], result: "0x01" },
        { jsonrpc: "2.0", id: 999_999, result: "0x02" },
      ],
    },
    {
      label: "string IDs",
      operation: "reconciler-rpc-batch-item",
      response: (ids: readonly number[]) => [
        { jsonrpc: "2.0", id: String(ids[0]), result: "0x01" },
        { jsonrpc: "2.0", id: ids[1], result: "0x02" },
      ],
    },
    {
      label: "per-item errors",
      operation: "reconciler-rpc-batch-item-error",
      response: (ids: readonly number[]) => [
        { jsonrpc: "2.0", id: ids[0], result: "0x01" },
        { jsonrpc: "2.0", id: ids[1], error: { code: -32_000 } },
      ],
    },
    {
      label: "both result and error",
      operation: "reconciler-rpc-batch-item-shape",
      response: (ids: readonly number[]) => [
        { jsonrpc: "2.0", id: ids[0], result: "0x01" },
        {
          jsonrpc: "2.0",
          id: ids[1],
          result: "0x02",
          error: { code: -32_000 },
        },
      ],
    },
  ])("fails closed on $label", async ({ operation, response }) => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Array<{ id: number }>;
      return rpcBatchResponse(response(body.map((request) => request.id)));
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.callMany({
      calls: [
        { to: ADDRESS, data: totalSupplyCall },
        { to: ALTERNATE_ADDRESS, data: totalSupplyCall },
      ],
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
      safeMetadata: { operation },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("checks the same checkpoint before and after a complete live build", async () => {
    const methods: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
      };
      methods.push(body.method);
      return rpcResponse(body.id, block());
    });
    const reader = createExactBlockReconcilerRouteDtoReader({
      env: {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
      },
      indexedStore: {
        readExactIndexedRouteCorpus: vi.fn(async () => routes("indexed")),
      },
      buildLiveRoutes: vi.fn(async () => routes("live")),
      fetch: fetchMock as typeof fetch,
    });
    const source = {
      identity: "alchemy-mainnet-test",
      vendorGroup: "alchemy",
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
    };

    await expect(reader.readLiveRoutes({
      source,
      contract,
      blockNumber: 25_700_000n,
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).resolves.toEqual(routes("live"));
    expect(methods).toEqual([
      "eth_getBlockByNumber",
      "eth_getBlockByNumber",
    ]);
  });

  it("selects only the routes applicable to the requested release", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number };
      return rpcResponse(body.id, block());
    });
    const reader = createExactBlockReconcilerRouteDtoReader({
      env: {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
      },
      indexedStore: {
        readExactIndexedRouteCorpus: vi.fn(async () => routes("indexed")),
      },
      buildLiveRoutes: vi.fn(async () => routes("live")),
      fetch: fetchMock as typeof fetch,
    });
    const classicV2Contract: ReconcilerPreParityContract = {
      ...contract,
      releaseId: "classic-v2",
      routeKeys: CLASSIC_V2_RECONCILER_ROUTE_KEYS,
    };

    const result = await reader.readLiveRoutes({
      source: {
        identity: "alchemy-mainnet-test",
        vendorGroup: "alchemy",
        endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
        endpointOriginCommitment: rpcProviderCommitment(
          "origin",
          new URL(ALCHEMY).origin,
        ),
      },
      contract: classicV2Contract,
      blockNumber: BLOCK_NUMBER,
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    });

    expect(result.map(({ routeKey }) => routeKey)).toEqual(
      CLASSIC_V2_RECONCILER_ROUTE_KEYS,
    );
  });

  it("fails closed if the checkpoint changes after the route read", async () => {
    let blockRead = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
      };
      blockRead += 1;
      return rpcResponse(body.id, block(blockRead === 1 ? BLOCK_HASH : ALTERNATE_HASH));
    });
    const reader = createExactBlockReconcilerRouteDtoReader({
      env: {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
      },
      indexedStore: {
        readExactIndexedRouteCorpus: vi.fn(async () => routes("indexed")),
      },
      buildLiveRoutes: vi.fn(async () => routes("live")),
      fetch: fetchMock as typeof fetch,
    });

    await expect(reader.readLiveRoutes({
      source: {
        identity: "alchemy-mainnet-test",
        vendorGroup: "alchemy",
        endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
        endpointOriginCommitment: rpcProviderCommitment(
          "origin",
          new URL(ALCHEMY).origin,
        ),
      },
      contract,
      blockNumber: 25_700_000n,
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
      safeMetadata: { operation: "reconciler-rpc-checkpoint-mismatch" },
    });
  });

  it("counts physical requests and never retries past the provider budget", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number };
      return rpcResponse(body.id, block());
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      maximumRequests: 1,
      fetch: fetchMock as typeof fetch,
    });
    const signal = new AbortController().signal;
    await rpc.assertCheckpoint({
      blockNumber: 25_700_000n,
      blockHash: BLOCK_HASH,
      signal,
    });
    await expect(rpc.assertCheckpoint({
      blockNumber: 25_700_000n,
      blockHash: BLOCK_HASH,
      signal,
    })).rejects.toMatchObject({
      code: "response_oversize",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rpc.requestCount()).toBe(2);
  });

  it("rejects an over-budget batch before sending a partial prefix", async () => {
    const fetchMock = vi.fn();
    const physicallyBounded = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      maximumRequests: 1,
      maximumLogicalRequests: 10,
      maximumBatchSize: 2,
      fetch: fetchMock as typeof fetch,
    });
    const calls = [
      { to: ADDRESS, data: totalSupplyCall },
      { to: ALTERNATE_ADDRESS, data: totalSupplyCall },
      { to: ADDRESS, data: "0x" as Hex },
    ];

    await expect(physicallyBounded.callMany({
      calls,
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: "response_oversize",
      retryable: false,
      safeMetadata: { operation: "reconciler-rpc-request-budget" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(physicallyBounded.requestCount()).toBe(2);
    expect(physicallyBounded.logicalRequestCount()).toBe(3);

    const logicallyBounded = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      maximumRequests: 10,
      maximumLogicalRequests: 2,
      maximumBatchSize: 100,
      fetch: fetchMock as typeof fetch,
    });
    await expect(logicallyBounded.callMany({
      calls,
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: "response_oversize",
      retryable: false,
      safeMetadata: { operation: "reconciler-rpc-logical-budget" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logicallyBounded.requestCount()).toBe(1);
    expect(logicallyBounded.logicalRequestCount()).toBe(3);
  });

  it("enforces the response-byte limit for a batch without retrying", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", {
      status: 200,
      headers: { "content-length": String(8 * 1024 * 1024 + 1) },
    }));
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.callMany({
      calls: [{ to: ADDRESS, data: totalSupplyCall }],
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: "response_oversize",
      safeMetadata: { operation: "reconciler-rpc-response" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels an oversized streamed response before decoding it", async () => {
    let cancelled = false;
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled = true;
      },
    }), { status: 200 }));
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.callMany({
      calls: [{ to: ADDRESS, data: totalSupplyCall }],
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "response_oversize" });
    expect(cancelled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out a batch once and never retries it", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
        })
      );
      const rpc = createExactBlockRpcClient({
        endpoint: ALCHEMY,
        endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
        endpointOriginCommitment: rpcProviderCommitment(
          "origin",
          new URL(ALCHEMY).origin,
        ),
        timeoutMs: 100,
        fetch: fetchMock as typeof fetch,
      });
      const pending = expect(rpc.callMany({
        calls: [{ to: ADDRESS, data: totalSupplyCall }],
        blockHash: BLOCK_HASH,
        signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: "timeout", retryable: true });

      await vi.advanceTimersByTimeAsync(100);
      await pending;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry provider rate limits", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", {
      status: 429,
    }));
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.callMany({
      calls: [{ to: ADDRESS, data: totalSupplyCall }],
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: "dependency_unavailable",
      retryable: true,
      safeMetadata: { status: 429 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects truncated log corpora instead of accepting a prefix", async () => {
    const rawLog = {
      address: ADDRESS,
      blockNumber: "0x1",
      blockHash: BLOCK_HASH,
      transactionHash: ALTERNATE_HASH,
      transactionIndex: "0x0",
      logIndex: "0x0",
      topics: [`0x${"44".repeat(32)}` as Hex],
      data: "0x",
    };
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number };
      return rpcResponse(body.id, [rawLog, { ...rawLog, logIndex: "0x1" }]);
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.getLogs({
      addresses: ADDRESS,
      fromBlock: 1n,
      toBlock: 1n,
      maximumLogs: 1,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: "response_oversize",
      retryable: false,
    });
  });

  it("returns a block-bound successful receipt with explicit log ordinals", async () => {
    const transactionIndex = "0x2";
    const receipt = {
      transactionHash: ALTERNATE_HASH,
      blockNumber: "0x18826a0",
      blockHash: BLOCK_HASH,
      transactionIndex,
      status: "0x1",
      logs: [4, 7].map((logIndex) => ({
        address: ADDRESS,
        blockNumber: "0x18826a0",
        blockHash: BLOCK_HASH,
        transactionHash: ALTERNATE_HASH,
        transactionIndex,
        logIndex: `0x${logIndex.toString(16)}`,
        removed: false,
        topics: [`0x${"55".repeat(32)}`],
        data: "0x1234",
      })),
    };
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number };
      return rpcResponse(body.id, receipt);
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.getTransactionReceipt({
      transactionHash: ALTERNATE_HASH,
      expectedBlockNumber: BLOCK_NUMBER,
      expectedBlockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      transactionHash: ALTERNATE_HASH,
      blockNumber: BLOCK_NUMBER,
      blockHash: BLOCK_HASH,
      transactionIndex: 2,
      status: 1n,
      logs: [
        { receiptLogIndex: 0, logIndex: 4 },
        { receiptLogIndex: 1, logIndex: 7 },
      ],
    });
  });

  it("batches receipts in input order with exact bindings and log ordinals", async () => {
    const thirdHash = `0x${"66".repeat(32)}` as const;
    const transactionHashes = [BLOCK_HASH, ALTERNATE_HASH, thirdHash] as const;
    const transactionIndexes = new Map(transactionHashes.map(
      (transactionHash, index) => [transactionHash, index + 1] as const,
    ));
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Array<{
        id: number;
        method: string;
        params: [typeof BLOCK_HASH];
      }>;
      return rpcBatchResponse(body.map((request) => {
        const transactionHash = request.params[0];
        const transactionIndex = transactionIndexes.get(transactionHash)!;
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            transactionHash,
            blockNumber: "0x18826a0",
            blockHash: BLOCK_HASH,
            transactionIndex: `0x${transactionIndex.toString(16)}`,
            status: "0x1",
            logs: [0, 1].map((receiptLogIndex) => ({
              address: receiptLogIndex === 0 ? ADDRESS : ALTERNATE_ADDRESS,
              blockNumber: "0x18826a0",
              blockHash: BLOCK_HASH,
              transactionHash,
              transactionIndex: `0x${transactionIndex.toString(16)}`,
              logIndex: `0x${(
                transactionIndex * 10 + receiptLogIndex
              ).toString(16)}`,
              topics: [`0x${"55".repeat(32)}`],
              data: "0x",
            })),
          },
        };
      }).reverse());
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      maximumBatchSize: 2,
      fetch: fetchMock as typeof fetch,
    });

    const result = await rpc.getTransactionReceipts({
      receipts: transactionHashes.map((transactionHash) => ({
        transactionHash,
        expectedBlockNumber: BLOCK_NUMBER,
        expectedBlockHash: BLOCK_HASH,
      })),
      signal: new AbortController().signal,
    });

    expect(result.map((receipt) => receipt.transactionHash)).toEqual(
      transactionHashes,
    );
    expect(result.map((receipt) =>
      receipt.logs.map((log) => log.receiptLogIndex)
    )).toEqual([[0, 1], [0, 1], [0, 1]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) =>
      (JSON.parse(String(init?.body)) as Array<{ method: string }>).every(
        (request) => request.method === "eth_getTransactionReceipt",
      )
    )).toBe(true);
    expect(rpc.requestCount()).toBe(2);
    expect(rpc.logicalRequestCount()).toBe(3);
  });

  it("fails the complete receipt batch if one item is not block-bound", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Array<{
        id: number;
        params: [typeof BLOCK_HASH];
      }>;
      return rpcBatchResponse(body.map((request, index) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          transactionHash: request.params[0],
          blockNumber: index === 0 ? "0x18826a0" : "0x188269f",
          blockHash: BLOCK_HASH,
          transactionIndex: `0x${index.toString(16)}`,
          status: "0x1",
          logs: [],
        },
      })));
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.getTransactionReceipts({
      receipts: [BLOCK_HASH, ALTERNATE_HASH].map((transactionHash) => ({
        transactionHash,
        expectedBlockNumber: BLOCK_NUMBER,
        expectedBlockHash: BLOCK_HASH,
      })),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
      safeMetadata: { operation: "reconciler-rpc-receipt-binding" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "a reverted status",
      mutate: (receipt: Record<string, unknown>) => ({ ...receipt, status: "0x0" }),
      operation: "reconciler-rpc-receipt-binding",
    },
    {
      label: "a different block hash",
      mutate: (receipt: Record<string, unknown>) => ({
        ...receipt,
        blockHash: ALTERNATE_HASH,
      }),
      operation: "reconciler-rpc-receipt-binding",
    },
    {
      label: "a log from another transaction",
      mutate: (receipt: Record<string, unknown>) => ({
        ...receipt,
        logs: [{
          ...((receipt.logs as Array<Record<string, unknown>>)[0]!),
          transactionHash: BLOCK_HASH,
        }],
      }),
      operation: "reconciler-rpc-receipt-log-binding",
    },
    {
      label: "non-increasing log indexes",
      mutate: (receipt: Record<string, unknown>) => ({
        ...receipt,
        logs: [
          (receipt.logs as Array<Record<string, unknown>>)[0],
          {
            ...((receipt.logs as Array<Record<string, unknown>>)[0]!),
            address: ALTERNATE_ADDRESS,
          },
        ],
      }),
      operation: "reconciler-rpc-receipt-log-order",
    },
  ])("rejects receipt responses with $label", async ({ mutate, operation }) => {
    const baseReceipt: Record<string, unknown> = {
      transactionHash: ALTERNATE_HASH,
      blockNumber: "0x18826a0",
      blockHash: BLOCK_HASH,
      transactionIndex: "0x2",
      status: "0x1",
      logs: [{
        address: ADDRESS,
        blockNumber: "0x18826a0",
        blockHash: BLOCK_HASH,
        transactionHash: ALTERNATE_HASH,
        transactionIndex: "0x2",
        logIndex: "0x4",
        topics: [`0x${"55".repeat(32)}`],
        data: "0x",
      }],
    };
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number };
      return rpcResponse(body.id, mutate(baseReceipt));
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.getTransactionReceipt({
      transactionHash: ALTERNATE_HASH,
      expectedBlockNumber: BLOCK_NUMBER,
      expectedBlockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
      safeMetadata: { operation },
    });
  });

  it("returns only a transaction bound to the expected hash, block and recipient", async () => {
    const transaction = {
      hash: ALTERNATE_HASH,
      blockNumber: "0x18826a0",
      blockHash: BLOCK_HASH,
      transactionIndex: "0x2",
      from: ALTERNATE_ADDRESS,
      to: ADDRESS,
      input: "0x1234",
      value: "0x5",
    };
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number };
      return rpcResponse(body.id, transaction);
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      fetch: fetchMock as typeof fetch,
    });

    await expect(rpc.getTransaction({
      transactionHash: ALTERNATE_HASH,
      expectedBlockNumber: BLOCK_NUMBER,
      expectedBlockHash: BLOCK_HASH,
      expectedTo: ADDRESS,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      transactionHash: ALTERNATE_HASH,
      blockNumber: BLOCK_NUMBER,
      blockHash: BLOCK_HASH,
      transactionIndex: 2,
      from: ALTERNATE_ADDRESS,
      to: ADDRESS,
      input: "0x1234",
      value: 5n,
    });

    await expect(rpc.getTransaction({
      transactionHash: ALTERNATE_HASH,
      expectedBlockNumber: BLOCK_NUMBER,
      expectedBlockHash: BLOCK_HASH,
      expectedTo: ALTERNATE_ADDRESS,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
      safeMetadata: { operation: "reconciler-rpc-transaction-binding" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("batches transactions while preserving each transaction's exact binding", async () => {
    const thirdHash = `0x${"66".repeat(32)}` as const;
    const byHash = new Map([
      [BLOCK_HASH, { from: ALTERNATE_ADDRESS, input: "0x01", value: "0x1" }],
      [ALTERNATE_HASH, { from: ADDRESS, input: "0x02", value: "0x2" }],
      [thirdHash, { from: ALTERNATE_ADDRESS, input: "0x03", value: "0x3" }],
    ]);
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Array<{
        id: number;
        params: [typeof BLOCK_HASH];
      }>;
      return rpcBatchResponse(body.map((request, index) => {
        const transactionHash = request.params[0];
        const values = byHash.get(transactionHash)!;
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            hash: transactionHash,
            blockNumber: "0x18826a0",
            blockHash: BLOCK_HASH,
            transactionIndex: `0x${index.toString(16)}`,
            to: ADDRESS,
            ...values,
          },
        };
      }).reverse());
    });
    const rpc = createExactBlockRpcClient({
      endpoint: ALCHEMY,
      endpointCommitment: projectorRpcDeploymentCommitment(ALCHEMY),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        new URL(ALCHEMY).origin,
      ),
      maximumBatchSize: 2,
      fetch: fetchMock as typeof fetch,
    });

    const result = await rpc.getTransactions({
      transactions: [BLOCK_HASH, ALTERNATE_HASH, thirdHash].map(
        (transactionHash) => ({
          transactionHash,
          expectedBlockNumber: BLOCK_NUMBER,
          expectedBlockHash: BLOCK_HASH,
          expectedTo: ADDRESS,
        }),
      ),
      signal: new AbortController().signal,
    });

    expect(result.map((transaction) => transaction.transactionHash)).toEqual([
      BLOCK_HASH,
      ALTERNATE_HASH,
      thirdHash,
    ]);
    expect(result.map((transaction) => transaction.input)).toEqual([
      "0x01",
      "0x02",
      "0x03",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rpc.requestCount()).toBe(2);
    expect(rpc.logicalRequestCount()).toBe(3);
  });

  it("rejects an unbound provider identity before making a request", async () => {
    const fetchMock = vi.fn();
    const reader = createExactBlockReconcilerRouteDtoReader({
      env: {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
      },
      indexedStore: {
        readExactIndexedRouteCorpus: vi.fn(async () => routes("indexed")),
      },
      buildLiveRoutes: vi.fn(async () => routes("live")),
      fetch: fetchMock as typeof fetch,
    });

    await expect(reader.readLiveRoutes({
      source: {
        identity: "alchemy-mainnet-test",
        vendorGroup: "alchemy",
        endpointCommitment: ALTERNATE_HASH,
        endpointOriginCommitment: rpcProviderCommitment(
          "origin",
          new URL(ALCHEMY).origin,
        ),
      },
      contract,
      blockNumber: 25_700_000n,
      blockHash: BLOCK_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      dependency: "rpc",
      code: "invalid_input",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
