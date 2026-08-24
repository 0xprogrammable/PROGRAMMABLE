import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";
import type { PredictionV2ReadCall } from
  "../lib/prediction-v2/read-model-v2.server";
import {
  assertPredictionV2ProductionActionRpcSession,
  createPredictionV2ActionRpcSession,
  createPredictionV2ActionRpcSnapshotLease,
  createPredictionV2RpcSession,
  createPredictionV2RpcTransport,
  PREDICTION_V2_ACTION_SNAPSHOT_NEGOTIATION_RPC_LOGICAL_CALLS,
  PREDICTION_V2_CANONICAL_HISTORICAL_BLOCK_VERIFICATION_RPC_LOGICAL_CALLS,
  PREDICTION_V2_RPC_ENV,
  PredictionV2RpcSessionError,
  predictionV2ActionRpcRuntimeProjection,
  predictionV2RpcBindingFromEnvironment,
  predictionV2RpcSessionBindingProjection,
  readPredictionV2RawRpc,
  toPredictionV2ActionRpcSnapshotReader,
  toPredictionV2ResolutionRpcReader,
  verifyPredictionV2CanonicalHistoricalBlockV2,
} from "../lib/prediction-v2/rpc-session-v2.server";
import {
  PREDICTION_V2_RPC_LIMITS,
  predictionV2RpcBindingInput,
  type PredictionV2RpcProviderBindingInput,
} from "../lib/prediction-v2/rpc-reader-v2.server";

const ALCHEMY_URL =
  "https://robinhood-mainnet.g.alchemy.com/v2/alchemy-session-secret";
const TARGET = `0x${"11".repeat(20)}` as const;
const BLOCK_HASH = `0x${"44".repeat(32)}` as const;
const PARENT_HASH = `0x${"43".repeat(32)}` as const;
const TEST_NOW_SECONDS = BigInt(Math.floor(Date.now() / 1_000));

type RpcRequest = Readonly<{
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: readonly unknown[];
}>;

function header(
  number: bigint,
  hash = BLOCK_HASH,
  timestamp = TEST_NOW_SECONDS,
) {
  return {
    number: `0x${number.toString(16)}`,
    hash,
    parentHash: PARENT_HASH,
    timestamp: `0x${timestamp.toString(16)}`,
  };
}

function binding(): PredictionV2RpcProviderBindingInput {
  return predictionV2RpcBindingInput({
    providerId: "alchemy-robinhood-paid",
    vendorGroup: "alchemy",
    endpoint: ALCHEMY_URL,
  });
}

function environment() {
  const value = binding();
  return {
    [PREDICTION_V2_RPC_ENV.providerId]: value.providerId,
    [PREDICTION_V2_RPC_ENV.providerCommitment]: value.providerCommitment,
    [PREDICTION_V2_RPC_ENV.vendorGroup]: value.vendorGroup,
    [PREDICTION_V2_RPC_ENV.vendorCommitment]: value.vendorCommitment,
    [PREDICTION_V2_RPC_ENV.url]: value.endpoint,
    [PREDICTION_V2_RPC_ENV.endpointCommitment]: value.endpointCommitment,
  };
}

function rpcFetcher(input: Readonly<{
  safeHead?: bigint | (() => bigint);
  latestHead?: bigint;
  exactHash?: `0x${string}`;
  blockHash?: (number: bigint) => `0x${string}`;
  chainId?: number;
  timestamp?: bigint;
  blockTimestamp?: (number: bigint) => bigint;
  callResult?: string;
  callRevert?: string;
  codeResult?: string;
  afterCall?: () => void;
  requests?: RpcRequest[];
}>) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body)) as RpcRequest | RpcRequest[];
    const requests = Array.isArray(parsed) ? parsed : [parsed];
    input.requests?.push(...requests);
    const replies = requests.map((request) => {
      let value: unknown;
      if (request.method === "eth_chainId") {
        value = `0x${(input.chainId ?? 4_663).toString(16)}`;
      } else if (request.method === "eth_blockNumber") {
        value = `0x${(input.latestHead ?? 100n).toString(16)}`;
      } else if (request.method === "eth_getBlockByNumber") {
        const reference = request.params[0];
        const safeHead = typeof input.safeHead === "function"
          ? input.safeHead()
          : input.safeHead ?? 100n;
        const number = reference === "safe" ? safeHead : BigInt(String(reference));
        value = header(
          number,
          input.blockHash?.(number) ?? input.exactHash ?? BLOCK_HASH,
          input.blockTimestamp?.(number) ?? input.timestamp ?? TEST_NOW_SECONDS,
        );
      } else if (request.method === "eth_call" && input.callRevert) {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          error: {
            code: 3,
            message: "execution reverted",
            data: input.callRevert,
          },
        };
      } else if (request.method === "eth_getCode") {
        value = input.codeResult ?? "0x60006000";
      } else if (request.method === "eth_call") {
        value = input.callResult ?? "0x1234";
      } else {
        throw new Error(`unexpected test method ${request.method}`);
      }
      if (request.method === "eth_call") input.afterCall?.();
      return { jsonrpc: "2.0" as const, id: request.id, result: value };
    });
    return new Response(
      JSON.stringify(Array.isArray(parsed) ? replies : replies[0]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

function request(
  blockNumber = 97n,
  blockHash = BLOCK_HASH,
  signal?: AbortSignal,
): PredictionV2ReadCall {
  return {
    to: TARGET,
    data: "0x12345678",
    blockNumber,
    blockHash,
    requireCanonical: true,
    ...(signal ? { signal } : {}),
  };
}

function actionSession(input: Readonly<{
  fetcher?: ReturnType<typeof rpcFetcher>;
  nowMs?: () => number;
  confirmationDepth?: bigint;
}> = {}) {
  return createPredictionV2ActionRpcSession({
    binding: binding(),
    confirmationDepth: input.confirmationDepth ?? 3n,
    dependencies: {
      provider: { fetcher: input.fetcher ?? rpcFetcher({}) },
      nowMs: input.nowMs ?? (() => Number(TEST_NOW_SECONDS * 1_000n)),
    },
  });
}

describe("Prediction V2 single settlement RPC session", () => {
  it("requires all six exact environment values and keeps the URL secret", () => {
    expect(() => predictionV2RpcBindingFromEnvironment({})).toThrow(
      PredictionV2RpcSessionError,
    );
    expect(predictionV2RpcBindingFromEnvironment(environment())).toEqual({
      ...binding(),
      batchMode: "batch",
    });
    expect(() => predictionV2RpcBindingFromEnvironment({
      ...environment(),
      [PREDICTION_V2_RPC_ENV.endpointCommitment]:
        rpcProviderCommitment("endpoint", "https://example.com/"),
    })).toThrow(PredictionV2RpcSessionError);

    const transport = createPredictionV2RpcTransport({
      binding: binding(),
      dependencies: { provider: { fetcher: rpcFetcher({}) } },
    });
    expect(JSON.stringify(transport)).not.toContain("alchemy-session-secret");
  });

  it("projects one exact settlement provider and rejects injected production provenance", () => {
    const transport = createPredictionV2RpcTransport({ binding: binding() });
    const projection = predictionV2RpcSessionBindingProjection(transport);
    expect(projection).toMatchObject({
      role: "settlement",
      providerId: binding().providerId,
      providerCommitment: binding().providerCommitment,
      vendorGroup: "alchemy",
      endpointCommitment: binding().endpointCommitment,
      batchMode: "batch",
    });
    expect(Object.keys(projection)).toEqual([
      "role",
      "providerId",
      "providerCommitment",
      "vendorGroup",
      "vendorCommitment",
      "endpointCommitment",
      "endpointOriginCommitment",
      "batchMode",
    ]);
    expect(JSON.stringify(projection)).not.toContain("alchemy-session-secret");

    const production = createPredictionV2ActionRpcSession({
      binding: binding(),
      confirmationDepth: 3n,
    });
    expect(predictionV2ActionRpcRuntimeProjection(production)).toEqual({
      chainId: 4_663,
      snapshotPolicy: { kind: "action", confirmationDepth: 3 },
      transportPolicy: PREDICTION_V2_RPC_LIMITS,
      provider: projection,
    });
    expect(() => assertPredictionV2ProductionActionRpcSession(production))
      .not.toThrow();
    expect(() => assertPredictionV2ProductionActionRpcSession(
      createPredictionV2ActionRpcSession({
        binding: binding(),
        confirmationDepth: 4n,
      }),
    )).toThrow(PredictionV2RpcSessionError);
    expect(() => assertPredictionV2ProductionActionRpcSession(actionSession()))
      .toThrow(PredictionV2RpcSessionError);
  });

  it("selects one three-confirmation action snapshot in exactly three calls", async () => {
    const requests: RpcRequest[] = [];
    const session = actionSession({
      fetcher: rpcFetcher({ latestHead: 100n, requests }),
    });
    const lease = await createPredictionV2ActionRpcSnapshotLease(session);
    expect(lease.snapshot).toEqual({
      number: 97n,
      hash: BLOCK_HASH,
      parentHash: PARENT_HASH,
      timestamp: TEST_NOW_SECONDS,
    });
    expect(requests.map(({ method }) => method)).toEqual([
      "eth_chainId",
      "eth_blockNumber",
      "eth_getBlockByNumber",
    ]);
    expect(requests).toHaveLength(
      PREDICTION_V2_ACTION_SNAPSHOT_NEGOTIATION_RPC_LOGICAL_CALLS,
    );
    expect(requests[2]?.params).toEqual(["0x61", false]);
    lease.close();
  });

  it("fails closed on wrong chain, stale blocks and invalid confirmation depth", async () => {
    await expect(createPredictionV2ActionRpcSnapshotLease(actionSession({
      fetcher: rpcFetcher({ chainId: 1 }),
    }))).rejects.toMatchObject({ code: "wrong-chain" });
    await expect(createPredictionV2ActionRpcSnapshotLease(actionSession({
      fetcher: rpcFetcher({ timestamp: TEST_NOW_SECONDS - 61n }),
    }))).rejects.toMatchObject({ code: "stale-snapshot" });
    expect(() => actionSession({ confirmationDepth: 0n })).toThrow(
      PredictionV2RpcSessionError,
    );
  });

  it("keeps concurrent safe reads on one in-flight snapshot", async () => {
    const fetcher = rpcFetcher({ safeHead: 100n });
    const session = createPredictionV2RpcSession({
      binding: binding(),
      dependencies: {
        provider: { fetcher },
        nowMs: () => Number(TEST_NOW_SECONDS * 1_000n),
      },
    });
    const [left, right] = await Promise.all([
      session.getSafeBlock(),
      session.getSafeBlock(),
    ]);
    expect(left).toEqual(right);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refreshes sequential snapshots without sharing an aborted caller", async () => {
    let safeHead = 100n;
    const session = createPredictionV2RpcSession({
      binding: binding(),
      dependencies: {
        provider: { fetcher: rpcFetcher({ safeHead: () => safeHead }) },
        nowMs: () => Number(TEST_NOW_SECONDS * 1_000n),
      },
    });
    await expect(session.getSafeBlock()).resolves.toMatchObject({ number: 100n });

    const aborted = new AbortController();
    aborted.abort();
    expect(() => session.getSafeBlock(aborted.signal)).toThrow(
      PredictionV2RpcSessionError,
    );

    safeHead = 101n;
    await expect(session.getSafeBlock()).resolves.toMatchObject({ number: 101n });
  });

  it("leases only a fresh canonical historical snapshot", async () => {
    const session = actionSession();
    const lease = await createPredictionV2ActionRpcSnapshotLease(
      session,
      undefined,
      { number: 96n, hash: BLOCK_HASH },
    );
    expect(lease.snapshot).toMatchObject({ number: 96n, hash: BLOCK_HASH });
    lease.close();

    await expect(createPredictionV2ActionRpcSnapshotLease(
      actionSession({
        fetcher: rpcFetcher({
          blockHash: (number) => number === 96n ? `0x${"55".repeat(32)}` : BLOCK_HASH,
        }),
      }),
      undefined,
      { number: 96n, hash: BLOCK_HASH },
    )).rejects.toMatchObject({ code: "block-mismatch" });

    for (const timestamp of [TEST_NOW_SECONDS - 61n, TEST_NOW_SECONDS + 31n]) {
      await expect(createPredictionV2ActionRpcSnapshotLease(
        actionSession({
          fetcher: rpcFetcher({
            blockTimestamp: (number) => number === 96n
              ? timestamp
              : TEST_NOW_SECONDS,
          }),
        }),
        undefined,
        { number: 96n, hash: BLOCK_HASH },
      )).rejects.toMatchObject({ code: "stale-snapshot" });
    }
  });

  it("pins lease adapters to exact EIP-1898 number/hash and closes them", async () => {
    const requests: RpcRequest[] = [];
    const lease = await createPredictionV2ActionRpcSnapshotLease(actionSession({
      fetcher: rpcFetcher({ requests }),
    }));
    requests.length = 0;
    const actionReader = toPredictionV2ActionRpcSnapshotReader(lease);
    const resolutionReader = toPredictionV2ResolutionRpcReader(lease);
    expect(actionReader.readerId).toBe(resolutionReader.readerId);
    await resolutionReader.getCode({
      address: TARGET,
      blockNumber: lease.snapshot.number,
      blockHash: lease.snapshot.hash,
      requireCanonical: true,
    });
    expect(requests[0]?.params[1]).toEqual({
      blockHash: BLOCK_HASH,
      requireCanonical: true,
    });
    expect(() => resolutionReader.call(request(96n))).toThrow(
      PredictionV2RpcSessionError,
    );
    lease.close();
    expect(() => toPredictionV2ResolutionRpcReader(lease)).toThrow(
      PredictionV2RpcSessionError,
    );
    expect(() => resolutionReader.call(request())).toThrow(
      PredictionV2RpcSessionError,
    );
  });

  it("verifies one historical cursor call against the same canonical provider", async () => {
    const requests: RpcRequest[] = [];
    const lease = await createPredictionV2ActionRpcSnapshotLease(actionSession({
      fetcher: rpcFetcher({ requests }),
    }));
    requests.length = 0;
    await verifyPredictionV2CanonicalHistoricalBlockV2(lease, {
      number: 96n,
      hash: BLOCK_HASH,
    });
    expect(requests).toHaveLength(
      PREDICTION_V2_CANONICAL_HISTORICAL_BLOCK_VERIFICATION_RPC_LOGICAL_CALLS,
    );
    expect(requests[0]?.params).toEqual(["0x60", false]);
    await expect(verifyPredictionV2CanonicalHistoricalBlockV2(lease, {
      number: 96n,
      hash: `0x${"55".repeat(32)}`,
    })).rejects.toMatchObject({ code: "block-mismatch" });
    lease.close();
  });

  it("returns raw success/revert bytes only after same-block revalidation", async () => {
    const requests: RpcRequest[] = [];
    const successLease = await createPredictionV2ActionRpcSnapshotLease(
      actionSession({ fetcher: rpcFetcher({ callResult: "0xCAFE", requests }) }),
    );
    requests.length = 0;
    await expect(readPredictionV2RawRpc({
      lease: successLease,
      request: request(),
    })).resolves.toBe("0xcafe");
    expect(requests.map(({ method }) => method)).toEqual([
      "eth_call",
      "eth_getBlockByNumber",
    ]);
    successLease.close();

    const revertLease = await createPredictionV2ActionRpcSnapshotLease(
      actionSession({ fetcher: rpcFetcher({ callRevert: "0x08C379A0" }) }),
    );
    await expect(readPredictionV2RawRpc({
      lease: revertLease,
      request: request(),
    })).resolves.toEqual({ status: "reverted", data: "0x08c379a0" });
    revertLease.close();
  });

  it("rejects raw results if the provider replaces the leased block", async () => {
    let replaced = false;
    const lease = await createPredictionV2ActionRpcSnapshotLease(actionSession({
      fetcher: rpcFetcher({
        afterCall: () => {
          replaced = true;
        },
        blockHash: () => replaced ? `0x${"55".repeat(32)}` : BLOCK_HASH,
      }),
    }));
    await expect(readPredictionV2RawRpc({
      lease,
      request: request(),
    })).rejects.toMatchObject({ code: "block-mismatch" });
    lease.close();
  });
});
