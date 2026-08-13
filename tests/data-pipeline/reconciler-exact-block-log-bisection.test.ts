import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createExactBlockRpcClient } from "../../lib/data-pipeline/reconciler-exact-block-reader.server";
import { projectorRpcDeploymentCommitment } from "../../lib/data-pipeline/projector-provider-commitments";
import { rpcProviderCommitment } from "../../lib/data-pipeline/rpc-provider-commitments";

const ENDPOINT = "https://lb.drpc.live/ethereum/abcdefgh12345678";
const ADDRESS = `0x${"11".repeat(20)}` as const;
const BLOCK_HASH = `0x${"22".repeat(32)}` as const;
const TOPIC = `0x${"33".repeat(32)}` as const;

type RpcRequest = Readonly<{
  id: number;
  method: string;
  params: readonly [Readonly<{
    fromBlock: `0x${string}`;
    toBlock: `0x${string}`;
  }>];
}>;

function range(request: RpcRequest): readonly [bigint, bigint] {
  return [
    BigInt(request.params[0].fromBlock),
    BigInt(request.params[0].toBlock),
  ];
}

function rpcResult(id: number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rpcRangeError(id: number): Response {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32_005,
      message: "query returned more than 10000 results; try a smaller block range",
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rawLog(blockNumber: bigint, logIndex = 0) {
  const suffix = blockNumber.toString(16).padStart(64, "0");
  return {
    address: ADDRESS,
    blockNumber: `0x${blockNumber.toString(16)}`,
    blockHash: BLOCK_HASH,
    transactionHash: `0x${suffix}`,
    transactionIndex: "0x0",
    logIndex: `0x${logIndex.toString(16)}`,
    removed: false,
    topics: [TOPIC],
    data: "0x",
  };
}

function client(fetchMock: typeof fetch) {
  return createExactBlockRpcClient({
    endpoint: ENDPOINT,
    endpointCommitment: projectorRpcDeploymentCommitment(ENDPOINT),
    endpointOriginCommitment: rpcProviderCommitment(
      "origin",
      new URL(ENDPOINT).origin,
    ),
    fetch: fetchMock,
  });
}

async function getLogs(
  rpc: ReturnType<typeof createExactBlockRpcClient>,
  fromBlock: bigint,
  toBlock: bigint,
) {
  return rpc.getLogs({
    addresses: ADDRESS,
    topics: [TOPIC],
    fromBlock,
    toBlock,
    maximumLogs: 100,
    signal: new AbortController().signal,
  });
}

describe("exact-block eth_getLogs range bisection", () => {
  it("bisects an explicit HTTP response-size rejection and preserves order", async () => {
    const requested: Array<readonly [bigint, bigint]> = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RpcRequest;
      const [fromBlock, toBlock] = range(request);
      requested.push([fromBlock, toBlock]);
      if (toBlock - fromBlock + 1n > 2n) {
        return new Response("payload too large", { status: 413 });
      }
      return rpcResult(request.id, [rawLog(fromBlock)]);
    });
    const rpc = client(fetchMock as typeof fetch);

    await expect(getLogs(rpc, 1n, 4n)).resolves.toMatchObject([
      { blockNumber: 1n, logIndex: 0 },
      { blockNumber: 3n, logIndex: 0 },
    ]);
    expect(requested).toEqual([
      [1n, 4n],
      [1n, 2n],
      [3n, 4n],
    ]);
    expect(rpc.requestCount()).toBe(3);
    expect(rpc.logicalRequestCount()).toBe(3);
  });

  it("performs deterministic nested bisections for provider range errors", async () => {
    const requested: Array<readonly [bigint, bigint]> = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RpcRequest;
      const [fromBlock, toBlock] = range(request);
      requested.push([fromBlock, toBlock]);
      if (toBlock - fromBlock + 1n > 2n) {
        return rpcRangeError(request.id);
      }
      return rpcResult(request.id, [rawLog(fromBlock)]);
    });
    const rpc = client(fetchMock as typeof fetch);

    const logs = await getLogs(rpc, 1n, 8n);
    expect(logs.map((log) => log.blockNumber)).toEqual([1n, 3n, 5n, 7n]);
    expect(requested).toEqual([
      [1n, 8n],
      [1n, 4n],
      [1n, 2n],
      [3n, 4n],
      [5n, 8n],
      [5n, 6n],
      [7n, 8n],
    ]);
  });

  it("returns the complete merged corpus for builder-level count bisection", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RpcRequest;
      const [fromBlock, toBlock] = range(request);
      if (fromBlock === 1n && toBlock === 4n) {
        return rpcRangeError(request.id);
      }
      return rpcResult(request.id, [rawLog(fromBlock)]);
    });
    const rpc = client(fetchMock as typeof fetch);

    await expect(rpc.getLogs({
      addresses: ADDRESS,
      fromBlock: 1n,
      toBlock: 4n,
      maximumLogs: 1,
      signal: new AbortController().signal,
    })).resolves.toHaveLength(2);
  });

  it("rejects a provider response that overlaps an adjacent split", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RpcRequest;
      const [fromBlock, toBlock] = range(request);
      if (fromBlock === 1n && toBlock === 4n) {
        return rpcRangeError(request.id);
      }
      return rpcResult(request.id, [rawLog(2n)]);
    });
    const rpc = client(fetchMock as typeof fetch);

    await expect(getLogs(rpc, 1n, 4n)).rejects.toMatchObject({
      code: "validation_failed",
      safeMetadata: { operation: "reconciler-rpc-log-block-range" },
    });
  });

  it("rejects duplicate canonical log ordinals inside a split response", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RpcRequest;
      const [fromBlock, toBlock] = range(request);
      if (fromBlock === 1n && toBlock === 4n) {
        return rpcRangeError(request.id);
      }
      const log = rawLog(fromBlock);
      return rpcResult(request.id, [log, log]);
    });
    const rpc = client(fetchMock as typeof fetch);

    await expect(getLogs(rpc, 1n, 4n)).rejects.toMatchObject({
      code: "validation_failed",
      safeMetadata: { operation: "reconciler-rpc-log-order" },
    });
  });

  it("fails closed when a single block still exceeds the provider limit", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RpcRequest;
      return rpcRangeError(request.id);
    });
    const rpc = client(fetchMock as typeof fetch);

    await expect(getLogs(rpc, 7n, 7n)).rejects.toMatchObject({
      code: "response_oversize",
      retryable: false,
      safeMetadata: {
        operation: "reconciler-rpc-log-single-block-oversize",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns every log from a busy 10,000-block range without truncation", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RpcRequest;
      const [fromBlock, toBlock] = range(request);
      if (toBlock - fromBlock + 1n > 100n) {
        return rpcRangeError(request.id);
      }
      const logs = Array.from(
        { length: Number(toBlock - fromBlock + 1n) },
        (_, offset) => rawLog(fromBlock + BigInt(offset)),
      );
      return rpcResult(request.id, logs);
    });
    const rpc = client(fetchMock as typeof fetch);

    const logs = await getLogs(rpc, 1n, 10_000n);
    expect(logs).toHaveLength(10_000);
    expect(logs[0]?.blockNumber).toBe(1n);
    expect(logs.at(-1)?.blockNumber).toBe(10_000n);
    expect(new Set(logs.map((log) => log.transactionHash))).toHaveLength(
      10_000,
    );
    expect(rpc.requestCount()).toBe(255);
    expect(rpc.logicalRequestCount()).toBe(255);
  });
});
