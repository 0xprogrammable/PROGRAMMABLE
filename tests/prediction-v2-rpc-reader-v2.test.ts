import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PredictionV2ReadCall } from
  "../lib/prediction-v2/read-model-v2.server";
import {
  bindPredictionV2RpcProvider,
  createPredictionV2RpcReader,
  PREDICTION_V2_RPC_LIMITS,
  PredictionV2RpcReaderError,
  predictionV2RpcBindingInput,
  predictionV2RpcCommitment,
  type PredictionV2RpcVendorGroup,
} from "../lib/prediction-v2/rpc-reader-v2.server";

const ALCHEMY_URL =
  "https://robinhood-mainnet.g.alchemy.com/v2/alchemy-private-key";
const QUICKNODE_URL =
  "https://quiet-robinhood.quiknode.pro/quicknode-private-key/";
const ADDRESS = `0x${"11".repeat(20)}` as const;
const SENDER_A = `0x${"33".repeat(20)}` as const;
const SENDER_B = `0x${"44".repeat(20)}` as const;
const BLOCK_HASH = `0x${"22".repeat(32)}` as const;
const PARENT_HASH = `0x${"21".repeat(32)}` as const;
const STORAGE_SLOT = `0x${"55".repeat(32)}` as const;

type RpcRequest = Readonly<{
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: readonly unknown[];
}>;

type RpcReply = Readonly<{
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: Readonly<{ code: number; message: string; data?: unknown }>;
}>;

function block(number: bigint, hash = BLOCK_HASH) {
  return {
    number: `0x${number.toString(16)}`,
    hash,
    parentHash: PARENT_HASH,
    timestamp: "0x6553f100",
  };
}

function binding(
  endpoint = ALCHEMY_URL,
  vendorGroup: PredictionV2RpcVendorGroup = "alchemy",
  batchMode: "batch" | "solo" = "batch",
) {
  return predictionV2RpcBindingInput({
    providerId: `${vendorGroup}-robinhood-paid`,
    vendorGroup,
    endpoint,
    batchMode,
  });
}

function rpcFetcher(
  handler: (request: RpcRequest) => Omit<RpcReply, "jsonrpc" | "id">,
) {
  return vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body)) as RpcRequest | RpcRequest[];
    const requests = Array.isArray(parsed) ? parsed : [parsed];
    const replies = requests.map((request) => ({
      jsonrpc: "2.0" as const,
      id: request.id,
      ...handler(request),
    }));
    return new Response(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  });
}

function readCall(
  overrides: Partial<PredictionV2ReadCall> = {},
): PredictionV2ReadCall {
  return {
    to: ADDRESS,
    data: "0x12345678",
    blockNumber: 100n,
    blockHash: BLOCK_HASH,
    requireCanonical: true,
    ...overrides,
  };
}

describe("Prediction V2 RPC provider binding", () => {
  it("binds provider, vendor and endpoint commitments without enumerating the secret URL", () => {
    const resolved = bindPredictionV2RpcProvider(binding());

    expect(resolved).toMatchObject({
      chainId: 4_663,
      providerId: "alchemy-robinhood-paid",
      providerCommitment: predictionV2RpcCommitment(
        "provider",
        "alchemy-robinhood-paid",
      ),
      vendorGroup: "alchemy",
      vendorCommitment: predictionV2RpcCommitment("vendor", "alchemy"),
      batchMode: "batch",
    });
    expect(resolved.endpoint).toBe(ALCHEMY_URL);
    expect(Object.keys(resolved)).not.toContain("endpoint");
    expect(JSON.stringify(resolved)).not.toContain("alchemy-private-key");
  });

  it("rejects the official public RPC, vendor aliases and commitment drift", () => {
    expect(() => bindPredictionV2RpcProvider(binding(
      "https://rpc.mainnet.chain.robinhood.com",
      "alchemy",
    ))).toThrow(PredictionV2RpcReaderError);
    expect(() => bindPredictionV2RpcProvider(binding(
      QUICKNODE_URL,
      "alchemy",
    ))).toThrow(PredictionV2RpcReaderError);
    expect(() => bindPredictionV2RpcProvider({
      ...binding(),
      endpointCommitment: `0x${"00".repeat(32)}`,
    })).toThrow(PredictionV2RpcReaderError);
  });

  it("redacts endpoint credentials from thrown and serialized errors", () => {
    const secret = "do-not-print-this-secret";
    let thrown: unknown;
    try {
      bindPredictionV2RpcProvider(binding(
        `https://user:${secret}@robinhood-mainnet.g.alchemy.com/v2/key-value`,
      ));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PredictionV2RpcReaderError);
    expect(String(thrown)).not.toContain(secret);
    expect(JSON.stringify(thrown)).not.toContain(secret);
  });
});

describe("Prediction V2 strict JSON-RPC reader", () => {
  it("reads chain and block headers and pins eth_call with EIP-1898", async () => {
    const requests: RpcRequest[] = [];
    const fetcher = rpcFetcher((request) => {
      requests.push(request);
      if (request.method === "eth_chainId") return { result: "0x1237" };
      if (request.method === "eth_blockNumber") return { result: "0x66" };
      if (request.method === "eth_getBlockByNumber") {
        const reference = request.params[0];
        return { result: block(reference === "safe" ? 99n : 100n) };
      }
      if (request.method === "eth_getCode") return { result: "0x600A600B" };
      if (request.method === "eth_getStorageAt") {
        return { result: `0x${"00".repeat(12)}${"66".repeat(20)}` };
      }
      if (request.method === "eth_call") return { result: "0xDEADBEEF" };
      throw new Error("unexpected test method");
    });
    const reader = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      { fetcher },
    );

    await expect(reader.getChainId()).resolves.toBe(4_663);
    await expect(reader.getLatestBlockNumber()).resolves.toBe(102n);
    await expect(reader.getSafeBlock()).resolves.toMatchObject({ number: 99n });
    await expect(reader.getBlock(100n)).resolves.toMatchObject({
      number: 100n,
      hash: BLOCK_HASH,
      parentHash: PARENT_HASH,
    });
    await expect(reader.getCode({
      address: ADDRESS,
      blockNumber: 100n,
      blockHash: BLOCK_HASH,
      requireCanonical: true,
    })).resolves.toBe("0x600a600b");
    await expect(reader.getStorageAt({
      address: ADDRESS,
      slot: STORAGE_SLOT,
      blockNumber: 100n,
      blockHash: BLOCK_HASH,
      requireCanonical: true,
    })).resolves.toBe(`0x${"00".repeat(12)}${"66".repeat(20)}`);
    await expect(reader.call(readCall())).resolves.toBe("0xdeadbeef");

    const call = requests.find(({ method }) => method === "eth_call");
    expect(call?.params).toEqual([
      { to: ADDRESS, data: "0x12345678" },
      { blockHash: BLOCK_HASH, requireCanonical: true },
    ]);
    expect(requests.find(({ method }) => method === "eth_getBlockByNumber")?.params)
      .toEqual(["safe", false]);
    expect(requests.filter(({ method }) => method === "eth_getBlockByNumber")[1]?.params)
      .toEqual(["0x64", false]);
    expect(requests.find(({ method }) => method === "eth_getCode")?.params)
      .toEqual([
        ADDRESS,
        { blockHash: BLOCK_HASH, requireCanonical: true },
      ]);
    expect(requests.find(({ method }) => method === "eth_getStorageAt")?.params)
      .toEqual([
        ADDRESS,
        STORAGE_SLOT,
        { blockHash: BLOCK_HASH, requireCanonical: true },
      ]);
    await expect(reader.getStorageAt({
      address: ADDRESS,
      slot: "0x01",
      blockNumber: 100n,
      blockHash: BLOCK_HASH,
      requireCanonical: true,
    })).rejects.toThrow(PredictionV2RpcReaderError);
  });

  it("binds simulation sender/value exactly and never invents defaults", async () => {
    const requests: RpcRequest[] = [];
    const fetcher = rpcFetcher((request) => {
      requests.push(request);
      return { result: "0x01" };
    });
    const reader = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      { fetcher },
    );

    await expect(reader.call(readCall({ data: "0x01" }))).resolves.toBe(
      "0x01",
    );
    await expect(reader.call({
      ...readCall({ data: "0x02" }),
      from: SENDER_A,
      value: 0n,
    })).resolves.toBe("0x01");
    await expect(reader.call({
      ...readCall({ data: "0x03" }),
      from: SENDER_B,
      value: 1n,
    })).resolves.toBe("0x01");

    expect(requests.map(({ params }) => params[0])).toEqual([
      { to: ADDRESS, data: "0x01" },
      { to: ADDRESS, data: "0x02", from: SENDER_A, value: "0x0" },
      { to: ADDRESS, data: "0x03", from: SENDER_B, value: "0x1" },
    ]);
    expect(() => reader.call({
      ...readCall(),
      from: "0x1234" as typeof ADDRESS,
    })).toThrow(PredictionV2RpcReaderError);
    expect(() => reader.call({
      ...readCall(),
      value: -1n,
    })).toThrow(PredictionV2RpcReaderError);
    expect(() => reader.call({
      ...readCall(),
      value: 1n << 256n,
    })).toThrow(PredictionV2RpcReaderError);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("coalesces concurrent calls into one bounded JSON-RPC batch and restores ID order", async () => {
    const payloads: unknown[] = [];
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const requests = JSON.parse(String(init?.body)) as RpcRequest[];
      payloads.push(requests);
      const replies = [...requests].reverse().map((request, index) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: `0x${(index + 1).toString(16).padStart(2, "0")}`,
      }));
      return new Response(JSON.stringify(replies), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const reader = createPredictionV2RpcReader(binding(), { fetcher });

    const values = await Promise.all([
      reader.call(readCall({ data: "0x01" })),
      reader.call(readCall({ data: "0x02" })),
      reader.call(readCall({ data: "0x03" })),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(payloads[0]).toHaveLength(3);
    expect(values).toEqual(["0x03", "0x02", "0x01"]);
  });

  it("supports explicit solo batches without silently sending only the first call", async () => {
    const fetcher = rpcFetcher((request) => ({
      result: request.params[0] === undefined ? "0x" :
        (request.params[0] as { data: string }).data,
    }));
    const reader = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      { fetcher },
    );

    await expect(reader.callBatch([
      readCall({ data: "0x01" }),
      readCall({ data: "0x02" }),
    ])).resolves.toEqual(["0x01", "0x02"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps a solo batch lease until every sibling request has settled", async () => {
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let fastResponse: Response | undefined;
    const fetcher = vi.fn(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body)) as RpcRequest;
      const data = (request.params[0] as { data: string }).data;
      if (data === "0x02") await slow;
      if (data === "0x01") {
        fastResponse = new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
        return fastResponse;
      }
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: data,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const reader = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      { fetcher },
    );
    const pending = reader.callBatch([
      readCall({ data: "0x01" }),
      readCall({ data: "0x02" }),
    ]);
    let state: "pending" | "fulfilled" | "rejected" = "pending";
    void pending.then(
      () => {
        state = "fulfilled";
      },
      () => {
        state = "rejected";
      },
    );

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(fastResponse?.bodyUsed).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state).toBe("pending");
    releaseSlow();
    await expect(pending).rejects.toMatchObject({ code: "malformed-response" });
    expect(state).toBe("rejected");
  });

  it("combines the global and every per-item abort signal for solo batches", async () => {
    const seenSignals: AbortSignal[] = [];
    const fetcher = vi.fn(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => new Promise<Response>((_resolve, reject) => {
      const requestSignal = init?.signal;
      if (!requestSignal) throw new Error("missing request signal");
      seenSignals.push(requestSignal);
      requestSignal.addEventListener(
        "abort",
        () => reject(requestSignal.reason),
        { once: true },
      );
    }));
    const reader = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      { fetcher },
    );
    const global = new AbortController();
    const item = new AbortController();
    const pending = reader.callBatch([
      readCall(),
      readCall({ signal: item.signal }),
    ], global.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    item.abort(new Error(`cancel ${ALCHEMY_URL}`));
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(seenSignals).toHaveLength(2);
    expect(seenSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("separates deterministic EVM reverts from provider and transport errors", async () => {
    const reverted = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      {
        fetcher: rpcFetcher(() => ({
          error: {
            code: 3,
            message: "execution reverted",
            data: "0x08C379A0",
          },
        })),
      },
    );
    await expect(reverted.call(readCall())).resolves.toEqual({
      status: "reverted",
      data: "0x08c379a0",
    });

    const providerFailure = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      {
        fetcher: rpcFetcher(() => ({
          error: {
            code: -32_000,
            message: `upstream failure at ${ALCHEMY_URL}`,
          },
        })),
      },
    );
    let error: unknown;
    try {
      await providerFailure.call(readCall());
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "rpc-error" });
    expect(String(error)).not.toContain("alchemy-private-key");
    expect(JSON.stringify(error)).not.toContain("alchemy-private-key");
  });

  it("rejects duplicate or incomplete batch envelopes", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const requests = JSON.parse(String(init?.body)) as RpcRequest[];
      return new Response(JSON.stringify([
        { jsonrpc: "2.0", id: requests[0]!.id, result: "0x01" },
        { jsonrpc: "2.0", id: requests[0]!.id, result: "0x02" },
      ]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const reader = createPredictionV2RpcReader(binding(), { fetcher });
    await expect(Promise.all([
      reader.call(readCall({ data: "0x01" })),
      reader.call(readCall({ data: "0x02" })),
    ])).rejects.toMatchObject({ code: "malformed-response" });
  });

  it("enforces batch, response, retry and abort budgets", async () => {
    const reader = createPredictionV2RpcReader(binding(), {
      fetcher: rpcFetcher(() => ({ result: "0x" })),
    });
    await expect(reader.callBatch(Array.from(
      { length: PREDICTION_V2_RPC_LIMITS.maximumBatchCalls + 1 },
      () => readCall(),
    ))).rejects.toMatchObject({ code: "budget-exceeded" });

    const oversized = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      {
        fetcher: vi.fn(async () => new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": String(
              PREDICTION_V2_RPC_LIMITS.maximumResponseBytes + 1,
            ),
          },
        })),
      },
    );
    await expect(oversized.getChainId()).rejects.toMatchObject({
      code: "budget-exceeded",
    });

    const retryFetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (retryFetcher.mock.calls.length === 1) {
        return new Response("unavailable", { status: 503 });
      }
      const request = JSON.parse(String(init?.body)) as RpcRequest;
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: "0x1237",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const retrying = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      { fetcher: retryFetcher },
    );
    await expect(retrying.getChainId()).resolves.toBe(4_663);
    expect(retryFetcher).toHaveBeenCalledTimes(2);

    const controller = new AbortController();
    const abortFetcher = vi.fn(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
        once: true,
      });
    }));
    const aborting = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      { fetcher: abortFetcher },
    );
    const pending = aborting.call(readCall({ signal: controller.signal }));
    await vi.waitFor(() => expect(abortFetcher).toHaveBeenCalledTimes(1));
    controller.abort(new Error(`stop ${ALCHEMY_URL}`));
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("redacts a pre-aborted reason and refuses every per-item batch before transport", async () => {
    const fetcher = rpcFetcher(() => ({ result: "0x" }));
    const reader = createPredictionV2RpcReader(binding(), { fetcher });
    const controller = new AbortController();
    controller.abort(new Error(`secret reason ${ALCHEMY_URL}`));

    let error: unknown;
    try {
      reader.call(readCall({ signal: controller.signal }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "aborted" });
    expect(String(error)).not.toContain("alchemy-private-key");
    expect(JSON.stringify(error)).not.toContain("alchemy-private-key");
    await expect(reader.callBatch([
      readCall(),
      readCall({ signal: controller.signal }),
    ])).rejects.toMatchObject({ code: "aborted" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("aborts an in-flight explicit batch when any item is cancelled", async () => {
    const fetcher = vi.fn(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
        once: true,
      });
    }));
    const reader = createPredictionV2RpcReader(binding(), { fetcher });
    const first = new AbortController();
    const second = new AbortController();
    const pending = reader.callBatch([
      readCall({ signal: first.signal }),
      readCall({ signal: second.signal }),
    ]);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    second.abort(new Error(`cancel ${ALCHEMY_URL}`));
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("includes limiter wait time in one absolute timeout budget", async () => {
    const fetcher = vi.fn(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
        once: true,
      });
    }));
    const reader = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      { fetcher, timeoutMs: 100 },
    );
    const startedAt = Date.now();
    const results = await Promise.allSettled([
      reader.getChainId(),
      reader.getChainId(),
      reader.getChainId(),
    ]);
    expect(results).toHaveLength(3);
    expect(results.every((result) =>
      result.status === "rejected" &&
      (result.reason as { code?: string }).code === "timeout"
    )).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("includes the internal coalescing queue in every logical call deadline", async () => {
    let activePhysicalRequests = 0;
    let peakPhysicalRequests = 0;
    const fetcher = vi.fn(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      activePhysicalRequests += 1;
      peakPhysicalRequests = Math.max(
        peakPhysicalRequests,
        activePhysicalRequests,
      );
      try {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        });
      } finally {
        activePhysicalRequests -= 1;
      }
    });
    const reader = createPredictionV2RpcReader(binding(), {
      fetcher,
      timeoutMs: 100,
    });
    const startedAt = Date.now();
    const results = await Promise.allSettled(Array.from(
      { length: PREDICTION_V2_RPC_LIMITS.maximumLogicalCallsInFlight },
      (_value, index) => reader.call(readCall({
        data: `0x${index.toString(16).padStart(2, "0")}` as `0x${string}`,
      })),
    ));

    expect(results.every((result) =>
      result.status === "rejected" &&
      (result.reason as { code?: string }).code === "timeout"
    )).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(peakPhysicalRequests).toBeLessThanOrEqual(
      PREDICTION_V2_RPC_LIMITS.maximumPhysicalRequestsInFlight,
    );
  });

  it("cancels a stalled response body at the same absolute deadline", async () => {
    const bodyCanceled = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      cancel: bodyCanceled,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const reader = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      { fetcher, timeoutMs: 100 },
    );
    const startedAt = Date.now();

    await expect(reader.getChainId()).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(bodyCanceled).toHaveBeenCalledOnce();
  });

  it("rejects a direct response fulfilled after the absolute deadline", async () => {
    const fetcher = vi.fn(async () => {
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        125,
      );
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: "0x1237",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const reader = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      { fetcher, timeoutMs: 100 },
    );

    await expect(reader.getChainId()).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects an explicit batch fulfilled after the absolute deadline", async () => {
    const fetcher = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        125,
      );
      const requests = JSON.parse(String(init?.body)) as readonly RpcRequest[];
      return new Response(JSON.stringify(requests.map(({ id }) => ({
        jsonrpc: "2.0",
        id,
        result: "0x01",
      }))), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const reader = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "batch"),
      { fetcher, timeoutMs: 100 },
    );

    await expect(reader.callBatch([
      readCall(),
      readCall({ data: "0x87654321" }),
    ])).rejects.toMatchObject({ code: "timeout" });
  });

  it("cancels failed HTTP bodies before retry and supports sequential reader reuse", async () => {
    const cancel = vi.fn();
    const retryFetcher = vi.fn(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (retryFetcher.mock.calls.length === 1) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("unavailable"));
          },
          cancel,
        }), { status: 503 });
      }
      const request = JSON.parse(String(init?.body)) as RpcRequest;
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: "0x1237",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const retryReader = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      { fetcher: retryFetcher },
    );
    await expect(retryReader.getChainId()).resolves.toBe(4_663);
    expect(cancel).toHaveBeenCalledTimes(1);

    const reusable = createPredictionV2RpcReader(
      binding(ALCHEMY_URL, "alchemy", "solo"),
      { fetcher: rpcFetcher(() => ({ result: "0x1237" })) },
    );
    for (
      let index = 0;
      index < PREDICTION_V2_RPC_LIMITS.maximumLogicalCallsInFlight + 1;
      index += 1
    ) {
      await expect(reusable.getChainId()).resolves.toBe(4_663);
    }
  });
});
