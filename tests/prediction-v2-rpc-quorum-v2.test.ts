import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";
import type { PredictionV2ReadCall } from
  "../lib/prediction-v2/read-model-v2.server";
import type { PredictionV2ResolutionRpcQuorum } from
  "../lib/prediction-v2/resolution-proof-v2.server";
import {
  assertPredictionV2ProductionActionRpcQuorum,
  createPredictionV2ActionRpcQuorum,
  createPredictionV2ActionRpcSnapshotLease,
  createPredictionV2RpcQuorum,
  createPredictionV2RpcTransportPair,
  PREDICTION_V2_CANONICAL_HISTORICAL_BLOCK_VERIFICATION_RPC_LOGICAL_CALLS,
  PREDICTION_V2_RPC_ENV,
  PredictionV2RpcQuorumError,
  predictionV2RpcBindingsFromEnvironment,
  predictionV2ActionRpcRuntimeProjection,
  predictionV2RpcQuorumBindingProjection,
  readPredictionV2RawRpcQuorum,
  toPredictionV2ResolutionRpcQuorum,
  verifyPredictionV2CanonicalHistoricalBlockV2,
} from "../lib/prediction-v2/rpc-quorum-v2.server";
import {
  PREDICTION_V2_RPC_LIMITS,
  predictionV2RpcBindingInput,
  predictionV2RpcCommitment,
  type PredictionV2RpcProviderBindingInput,
} from "../lib/prediction-v2/rpc-reader-v2.server";

const ALCHEMY_URL =
  "https://robinhood-mainnet.g.alchemy.com/v2/alchemy-quorum-secret";
const QUICKNODE_URL =
  "https://quiet-robinhood.quiknode.pro/quicknode-quorum-secret/";
const TARGET = `0x${"11".repeat(20)}` as const;
const SIMULATION_SENDER = `0x${"22".repeat(20)}` as const;
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

function bindings(): readonly [
  PredictionV2RpcProviderBindingInput,
  PredictionV2RpcProviderBindingInput,
] {
  return [
    predictionV2RpcBindingInput({
      providerId: "alchemy-robinhood-paid",
      vendorGroup: "alchemy",
      endpoint: ALCHEMY_URL,
    }),
    predictionV2RpcBindingInput({
      providerId: "quicknode-robinhood-paid",
      vendorGroup: "quicknode",
      endpoint: QUICKNODE_URL,
    }),
  ];
}

function environment() {
  const [primary, secondary] = bindings();
  return {
    [PREDICTION_V2_RPC_ENV.primaryProviderId]: primary.providerId,
    [PREDICTION_V2_RPC_ENV.primaryProviderCommitment]:
      primary.providerCommitment,
    [PREDICTION_V2_RPC_ENV.primaryVendorGroup]: primary.vendorGroup,
    [PREDICTION_V2_RPC_ENV.primaryVendorCommitment]:
      primary.vendorCommitment,
    [PREDICTION_V2_RPC_ENV.primaryUrl]: primary.endpoint,
    [PREDICTION_V2_RPC_ENV.primaryEndpointCommitment]:
      primary.endpointCommitment,
    [PREDICTION_V2_RPC_ENV.secondaryProviderId]: secondary.providerId,
    [PREDICTION_V2_RPC_ENV.secondaryProviderCommitment]:
      secondary.providerCommitment,
    [PREDICTION_V2_RPC_ENV.secondaryVendorGroup]: secondary.vendorGroup,
    [PREDICTION_V2_RPC_ENV.secondaryVendorCommitment]:
      secondary.vendorCommitment,
    [PREDICTION_V2_RPC_ENV.secondaryUrl]: secondary.endpoint,
    [PREDICTION_V2_RPC_ENV.secondaryEndpointCommitment]:
      secondary.endpointCommitment,
  };
}

function rpcFetcher(input: Readonly<{
  safeHead?: bigint;
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
      }
      else if (request.method === "eth_blockNumber") {
        value = `0x${(input.latestHead ?? 100n).toString(16)}`;
      } else if (request.method === "eth_getBlockByNumber") {
        const reference = request.params[0];
        const number = reference === "safe"
          ? input.safeHead ?? 100n
          : BigInt(String(reference));
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
        throw new Error("unexpected test method");
      }
      if (request.method === "eth_call") input.afterCall?.();
      return { jsonrpc: "2.0" as const, id: request.id, result: value };
    });
    return new Response(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function request(signal?: AbortSignal): PredictionV2ReadCall {
  return {
    to: TARGET,
    data: "0x12345678",
    blockNumber: 97n,
    blockHash: BLOCK_HASH,
    requireCanonical: true,
    ...(signal ? { signal } : {}),
  };
}

describe("Prediction V2 release-bound RPC quorum", () => {
  it("requires every provider/vendor/endpoint commitment and has no secret defaults", () => {
    expect(() => predictionV2RpcBindingsFromEnvironment({})).toThrow(
      PredictionV2RpcQuorumError,
    );
    expect(predictionV2RpcBindingsFromEnvironment(environment())).toEqual(
      bindings().map((value) => ({ ...value, batchMode: "batch" })),
    );
    expect(() => predictionV2RpcBindingsFromEnvironment({
      ...environment(),
      [PREDICTION_V2_RPC_ENV.primaryEndpointCommitment]:
        rpcProviderCommitment("endpoint", QUICKNODE_URL),
    })).toThrow(PredictionV2RpcQuorumError);
    expect(() => createPredictionV2RpcTransportPair({
      environment: {
        ...environment(),
        [PREDICTION_V2_RPC_ENV.primaryEndpointCommitment]:
          rpcProviderCommitment("endpoint", QUICKNODE_URL),
      },
    })).toThrow(PredictionV2RpcQuorumError);
  });

  it("rejects same-vendor aliases even when their provider labels and keys differ", () => {
    const sameVendor = predictionV2RpcBindingInput({
      providerId: "alchemy-robinhood-second",
      vendorGroup: "alchemy",
      endpoint:
        "https://robinhood-mainnet.g.alchemy.com/v2/second-alchemy-secret",
    });
    expect(() => createPredictionV2RpcTransportPair({
      bindings: [bindings()[0], sameVendor],
    })).toThrow(PredictionV2RpcQuorumError);
  });

  it("never accepts the official public Robinhood endpoint as a settlement reader", () => {
    const publicEndpoint = {
      chainId: 4_663 as const,
      providerId: "alchemy-public-alias",
      providerCommitment: predictionV2RpcCommitment(
        "provider",
        "alchemy-public-alias",
      ),
      vendorGroup: "alchemy" as const,
      vendorCommitment: predictionV2RpcCommitment("vendor", "alchemy"),
      endpoint: "https://rpc.mainnet.chain.robinhood.com/",
      endpointCommitment: rpcProviderCommitment(
        "endpoint",
        "https://rpc.mainnet.chain.robinhood.com/",
      ),
    };
    expect(() => createPredictionV2RpcTransportPair({
      bindings: [publicEndpoint, bindings()[1]],
    })).toThrow(PredictionV2RpcQuorumError);
  });

  it("keeps both endpoint secrets out of errors and reader serialization", () => {
    const pair = createPredictionV2RpcTransportPair({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({}) },
        secondary: { fetcher: rpcFetcher({}) },
      },
    });
    expect(JSON.stringify(pair)).not.toContain("alchemy-quorum-secret");
    expect(JSON.stringify(pair)).not.toContain("quicknode-quorum-secret");

    let error: unknown;
    try {
      createPredictionV2RpcTransportPair({
        bindings: [{
          ...bindings()[0],
          endpoint: `https://user:bad-secret@robinhood-mainnet.g.alchemy.com/v2/key-value`,
        }, bindings()[1]],
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PredictionV2RpcQuorumError);
    expect(String(error)).not.toContain("bad-secret");
    expect(JSON.stringify(error)).not.toContain("bad-secret");
  });

  it("projects the exact primary/secondary release binding without endpoint material", () => {
    const projection = predictionV2RpcQuorumBindingProjection(
      createPredictionV2RpcTransportPair({ bindings: bindings() }),
    );
    expect(projection.map(({ role }) => role)).toEqual([
      "primary",
      "secondary",
    ]);
    expect(Object.keys(projection[0])).toEqual([
      "role",
      "providerId",
      "providerCommitment",
      "vendorGroup",
      "vendorCommitment",
      "endpointOriginCommitment",
      "batchMode",
    ]);
    expect(JSON.stringify(projection)).not.toContain("URL");
    expect(JSON.stringify(projection)).not.toContain("endpointCommitment");
    expect(JSON.stringify(projection)).not.toContain("quorum-secret");

    const driftedPrimary = predictionV2RpcBindingInput({
      providerId: "alchemy-robinhood-rotated-role",
      vendorGroup: "alchemy",
      endpoint: ALCHEMY_URL,
    });
    const drifted = predictionV2RpcQuorumBindingProjection(
      createPredictionV2RpcTransportPair({
        bindings: [driftedPrimary, bindings()[1]],
      }),
    );
    expect(drifted[0].providerId).not.toBe(projection[0].providerId);
    expect(drifted[0].providerCommitment).not.toBe(
      projection[0].providerCommitment,
    );
    expect(drifted[1]).toEqual(projection[1]);

    const soloProjection = predictionV2RpcQuorumBindingProjection(
      createPredictionV2RpcTransportPair({
        bindings: [{ ...bindings()[0], batchMode: "solo" }, bindings()[1]],
      }),
    );
    expect(projection[0].batchMode).toBe("batch");
    expect(soloProjection[0].batchMode).toBe("solo");
    expect(soloProjection[0]).not.toEqual(projection[0]);

    const actionReaders = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      confirmationDepth: 4n,
    });
    expect(predictionV2ActionRpcRuntimeProjection(actionReaders)).toEqual({
      chainId: 4_663,
      snapshotPolicy: { kind: "action", confirmationDepth: 4 },
      transportPolicy: PREDICTION_V2_RPC_LIMITS,
      providers: projection,
    });
    expect(() => assertPredictionV2ProductionActionRpcQuorum(actionReaders))
      .not.toThrow();

    const injected = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({}) },
        secondary: { fetcher: rpcFetcher({}) },
        nowMs: () => Date.now(),
      },
    });
    expect(() => assertPredictionV2ProductionActionRpcQuorum(injected))
      .toThrow(PredictionV2RpcQuorumError);

    let primaryDependencyReads = 0;
    const changingDependencies = Object.defineProperty({}, "primary", {
      enumerable: true,
      get() {
        primaryDependencyReads += 1;
        return primaryDependencyReads === 1
          ? { fetcher: rpcFetcher({}) }
          : undefined;
      },
    });
    const getterInjected = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: changingDependencies,
    });
    expect(primaryDependencyReads).toBe(1);
    expect(() => assertPredictionV2ProductionActionRpcQuorum(getterInjected))
      .toThrow(PredictionV2RpcQuorumError);
  });
});

describe("Prediction V2 common-height snapshots", () => {
  it("uses the lower safe height instead of requiring identical provider heads", async () => {
    const primaryRequests: RpcRequest[] = [];
    const secondaryRequests: RpcRequest[] = [];
    const readers = createPredictionV2RpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: {
          fetcher: rpcFetcher({ safeHead: 100n, requests: primaryRequests }),
        },
        secondary: {
          fetcher: rpcFetcher({ safeHead: 103n, requests: secondaryRequests }),
        },
      },
    });

    const [primary, secondary] = await Promise.all([
      readers[0].getSafeBlock(),
      readers[1].getSafeBlock(),
    ]);
    expect(primary).toEqual(secondary);
    expect(primary.number).toBe(100n);
    expect(primaryRequests.filter(({ method }) => method === "eth_getBlockByNumber")
      .map(({ params }) => params[0])).toEqual(["safe", "0x64"]);
    expect(secondaryRequests.filter(({ method }) => method === "eth_getBlockByNumber")
      .map(({ params }) => params[0])).toEqual(["safe", "0x64"]);
  });

  it("pins action reads to min(latest)-confirmationDepth", async () => {
    const primaryRequests: RpcRequest[] = [];
    const secondaryRequests: RpcRequest[] = [];
    const readers = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      confirmationDepth: 3n,
      dependencies: {
        primary: {
          fetcher: rpcFetcher({ latestHead: 105n, requests: primaryRequests }),
        },
        secondary: {
          fetcher: rpcFetcher({ latestHead: 100n, requests: secondaryRequests }),
        },
      },
    });

    const lease = await createPredictionV2ActionRpcSnapshotLease(readers);
    expect(lease.snapshot.number).toBe(97n);
    expect(lease.snapshotPolicy).toEqual({
      kind: "action",
      confirmationDepth: 3,
    });
    expect(primaryRequests.find(({ method }) => method === "eth_getBlockByNumber")?.params)
      .toEqual(["0x61", false]);
    expect(secondaryRequests.find(({ method }) => method === "eth_getBlockByNumber")?.params)
      .toEqual(["0x61", false]);

    const resolutionQuorum: PredictionV2ResolutionRpcQuorum =
      toPredictionV2ResolutionRpcQuorum(lease);
    await expect(Promise.all([
      resolutionQuorum.primary.getCode({
        address: TARGET,
        blockNumber: 97n,
        blockHash: BLOCK_HASH,
        requireCanonical: true,
      }),
      resolutionQuorum.secondary.getCode({
        address: TARGET,
        blockNumber: 97n,
        blockHash: BLOCK_HASH,
        requireCanonical: true,
      }),
    ])).resolves.toEqual(["0x60006000", "0x60006000"]);
    expect(primaryRequests.find(({ method }) => method === "eth_getCode")?.params)
      .toEqual([
        TARGET,
        { blockHash: BLOCK_HASH, requireCanonical: true },
      ]);
    expect(secondaryRequests.find(({ method }) => method === "eth_getCode")?.params)
      .toEqual([
        TARGET,
        { blockHash: BLOCK_HASH, requireCanonical: true },
      ]);
    await expect(Promise.all([
      resolutionQuorum.primary.call({
        ...request(),
        from: SIMULATION_SENDER,
        value: 0n,
      }),
      resolutionQuorum.secondary.call({
        ...request(),
        from: SIMULATION_SENDER,
        value: 0n,
      }),
    ])).resolves.toEqual(["0x1234", "0x1234"]);
    expect(primaryRequests.find(({ method }) => method === "eth_call")?.params)
      .toEqual([
        {
          to: TARGET,
          data: "0x12345678",
          from: SIMULATION_SENDER,
          value: "0x0",
        },
        { blockHash: BLOCK_HASH, requireCanonical: true },
      ]);
    expect(secondaryRequests.find(({ method }) => method === "eth_call")?.params)
      .toEqual([
        {
          to: TARGET,
          data: "0x12345678",
          from: SIMULATION_SENDER,
          value: "0x0",
        },
        { blockHash: BLOCK_HASH, requireCanonical: true },
      ]);
    lease.close();
  });

  it("refreshes a successful action snapshot instead of caching it forever", async () => {
    const primaryFixture: { latestHead: bigint } = { latestHead: 100n };
    const secondaryFixture: { latestHead: bigint } = { latestHead: 100n };
    const readers = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher(primaryFixture) },
        secondary: { fetcher: rpcFetcher(secondaryFixture) },
      },
    });
    await expect(Promise.all([
      readers[0].getSafeBlock(),
      readers[1].getSafeBlock(),
    ])).resolves.toEqual([
      expect.objectContaining({ number: 97n }),
      expect.objectContaining({ number: 97n }),
    ]);

    primaryFixture.latestHead = 101n;
    secondaryFixture.latestHead = 101n;
    await expect(Promise.all([
      readers[0].getSafeBlock(),
      readers[1].getSafeBlock(),
    ])).resolves.toEqual([
      expect.objectContaining({ number: 98n }),
      expect.objectContaining({ number: 98n }),
    ]);
  });

  it("isolates concurrent snapshot attempts by caller abort signal", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated = (base: ReturnType<typeof rpcFetcher>) => vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      await new Promise<void>((resolve, reject) => {
        const requestSignal = init?.signal;
        const onAbort = () => reject(requestSignal?.reason);
        requestSignal?.addEventListener("abort", onAbort, { once: true });
        void gate.then(() => {
          requestSignal?.removeEventListener("abort", onAbort);
          resolve();
        });
      });
      return base(input, init);
    });
    const primaryFetcher = gated(rpcFetcher({ latestHead: 100n }));
    const secondaryFetcher = gated(rpcFetcher({ latestHead: 100n }));
    const readers = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: primaryFetcher },
        secondary: { fetcher: secondaryFetcher },
      },
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = Promise.all([
      readers[0].getSafeBlock(firstController.signal),
      readers[1].getSafeBlock(firstController.signal),
    ]);
    await vi.waitFor(() => {
      expect(primaryFetcher).toHaveBeenCalledTimes(1);
      expect(secondaryFetcher).toHaveBeenCalledTimes(1);
    });
    const second = Promise.all([
      readers[0].getSafeBlock(secondController.signal),
      readers[1].getSafeBlock(secondController.signal),
    ]);
    await vi.waitFor(() => {
      expect(primaryFetcher).toHaveBeenCalledTimes(2);
      expect(secondaryFetcher).toHaveBeenCalledTimes(2);
    });
    secondController.abort(new Error(`cancel ${ALCHEMY_URL}`));
    await expect(second).rejects.toMatchObject({ code: "aborted" });
    release();
    await expect(first).resolves.toEqual([
      expect.objectContaining({ number: 97n }),
      expect.objectContaining({ number: 97n }),
    ]);
  });

  it("fails closed on excessive head drift or a common-height hash mismatch", async () => {
    const drifted = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({ latestHead: 500n }) },
        secondary: { fetcher: rpcFetcher({ latestHead: 100n }) },
      },
    });
    await expect(Promise.all([
      drifted[0].getSafeBlock(),
      drifted[1].getSafeBlock(),
    ])).rejects.toMatchObject({ code: "head-divergence" });

    const mismatched = createPredictionV2RpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({ exactHash: BLOCK_HASH }) },
        secondary: {
          fetcher: rpcFetcher({ exactHash: `0x${"55".repeat(32)}` }),
        },
      },
    });
    await expect(Promise.all([
      mismatched[0].getSafeBlock(),
      mismatched[1].getSafeBlock(),
    ])).rejects.toMatchObject({ code: "block-mismatch" });
  });

  it("rejects a wrong runtime chain and identically stale action providers", async () => {
    const wrongChain = createPredictionV2RpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({ chainId: 1 }) },
        secondary: { fetcher: rpcFetcher({}) },
      },
    });
    await expect(Promise.all([
      wrongChain[0].getSafeBlock(),
      wrongChain[1].getSafeBlock(),
    ])).rejects.toMatchObject({ code: "wrong-chain" });

    const stale = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: {
          fetcher: rpcFetcher({ timestamp: TEST_NOW_SECONDS - 61n }),
        },
        secondary: {
          fetcher: rpcFetcher({ timestamp: TEST_NOW_SECONDS - 61n }),
        },
        nowMs: () => Number(TEST_NOW_SECONDS) * 1_000,
      },
    });
    await expect(Promise.all([
      stale[0].getSafeBlock(),
      stale[1].getSafeBlock(),
    ])).rejects.toMatchObject({ code: "stale-snapshot" });
  });

  it("accepts the exact head-drift boundary and retries after a transient snapshot conflict", async () => {
    const boundary = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({ latestHead: 130n }) },
        secondary: { fetcher: rpcFetcher({ latestHead: 100n }) },
      },
    });
    await expect(Promise.all([
      boundary[0].getSafeBlock(),
      boundary[1].getSafeBlock(),
    ])).resolves.toEqual([
      expect.objectContaining({ number: 97n }),
      expect.objectContaining({ number: 97n }),
    ]);

    const primaryFixture: {
      exactHash: `0x${string}`;
    } = { exactHash: `0x${"66".repeat(32)}` };
    const retryable = createPredictionV2RpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher(primaryFixture) },
        secondary: { fetcher: rpcFetcher({}) },
      },
    });
    await expect(Promise.all([
      retryable[0].getSafeBlock(),
      retryable[1].getSafeBlock(),
    ])).rejects.toMatchObject({ code: "block-mismatch" });
    primaryFixture.exactHash = BLOCK_HASH;
    await expect(Promise.all([
      retryable[0].getSafeBlock(),
      retryable[1].getSafeBlock(),
    ])).resolves.toEqual([
      expect.objectContaining({ hash: BLOCK_HASH }),
      expect.objectContaining({ hash: BLOCK_HASH }),
    ]);
  });
});

describe("Prediction V2 raw-result quorum", () => {
  it("leases the canonical cursor snapshot after the confirmed head advances", async () => {
    const primaryRequests: RpcRequest[] = [];
    const secondaryRequests: RpcRequest[] = [];
    const primaryState = {
      latestHead: 100n,
      requests: primaryRequests,
    };
    const secondaryState = {
      latestHead: 100n,
      requests: secondaryRequests,
    };
    const readers = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher(primaryState) },
        secondary: { fetcher: rpcFetcher(secondaryState) },
      },
    });
    const firstPage = await createPredictionV2ActionRpcSnapshotLease(readers);
    expect(firstPage.snapshot).toMatchObject({ number: 97n, hash: BLOCK_HASH });
    firstPage.close();

    primaryState.latestHead = 110n;
    secondaryState.latestHead = 110n;
    primaryRequests.length = 0;
    secondaryRequests.length = 0;
    const nextPage = await createPredictionV2ActionRpcSnapshotLease(
      readers,
      undefined,
      { number: 97n, hash: BLOCK_HASH },
    );
    try {
      expect(nextPage.snapshot).toMatchObject({
        number: 97n,
        hash: BLOCK_HASH,
      });
      expect(await Promise.all([
        toPredictionV2ResolutionRpcQuorum(nextPage).primary.getSafeBlock(),
        toPredictionV2ResolutionRpcQuorum(nextPage).secondary.getSafeBlock(),
      ])).toEqual([
        expect.objectContaining({ number: 97n, hash: BLOCK_HASH }),
        expect.objectContaining({ number: 97n, hash: BLOCK_HASH }),
      ]);
      expect(primaryRequests).toHaveLength(4);
      expect(secondaryRequests).toHaveLength(4);
      expect(primaryRequests.map(({ method }) => method)).toEqual([
        "eth_chainId",
        "eth_blockNumber",
        "eth_getBlockByNumber",
        "eth_getBlockByNumber",
      ]);
      expect(primaryRequests.at(-1)?.params).toEqual(["0x61", false]);
    } finally {
      nextPage.close();
    }
  });

  it("rejects reorged, foreign, stale, and future cursor snapshots", async () => {
    const cursorNumber = 97n;
    const currentNumber = 107n;
    const reorgedHash = `0x${"55".repeat(32)}` as const;
    const makeReaders = (input: Readonly<{
      primaryHash?: (number: bigint) => `0x${string}`;
      secondaryHash?: (number: bigint) => `0x${string}`;
      timestamp?: (number: bigint) => bigint;
    }> = {}) => createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: {
          fetcher: rpcFetcher({
            latestHead: 110n,
            ...(input.primaryHash ? { blockHash: input.primaryHash } : {}),
            ...(input.timestamp ? { blockTimestamp: input.timestamp } : {}),
          }),
        },
        secondary: {
          fetcher: rpcFetcher({
            latestHead: 110n,
            ...(input.secondaryHash ? { blockHash: input.secondaryHash } : {}),
            ...(input.timestamp ? { blockTimestamp: input.timestamp } : {}),
          }),
        },
      },
    });

    await expect(createPredictionV2ActionRpcSnapshotLease(
      makeReaders({
        primaryHash: () => BLOCK_HASH,
        secondaryHash: (number) =>
          number === cursorNumber ? reorgedHash : BLOCK_HASH,
      }),
      undefined,
      { number: cursorNumber, hash: BLOCK_HASH },
    )).rejects.toMatchObject({ code: "block-mismatch" });

    await expect(createPredictionV2ActionRpcSnapshotLease(
      makeReaders(),
      undefined,
      { number: cursorNumber, hash: reorgedHash },
    )).rejects.toMatchObject({ code: "block-mismatch" });

    await expect(createPredictionV2ActionRpcSnapshotLease(
      makeReaders({
        timestamp: (number) => number === currentNumber
          ? TEST_NOW_SECONDS
          : TEST_NOW_SECONDS - 61n,
      }),
      undefined,
      { number: cursorNumber, hash: BLOCK_HASH },
    )).rejects.toMatchObject({ code: "stale-snapshot" });

    await expect(createPredictionV2ActionRpcSnapshotLease(
      makeReaders(),
      undefined,
      { number: currentNumber + 1n, hash: BLOCK_HASH },
    )).rejects.toMatchObject({ code: "block-mismatch" });
  });

  it("revalidates a historical canonical anchor with exactly two logical calls", async () => {
    const primaryRequests: RpcRequest[] = [];
    const secondaryRequests: RpcRequest[] = [];
    const readers = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({ requests: primaryRequests }) },
        secondary: { fetcher: rpcFetcher({ requests: secondaryRequests }) },
      },
    });
    const lease = await createPredictionV2ActionRpcSnapshotLease(readers);
    primaryRequests.length = 0;
    secondaryRequests.length = 0;

    expect(
      PREDICTION_V2_CANONICAL_HISTORICAL_BLOCK_VERIFICATION_RPC_LOGICAL_CALLS,
    ).toBe(2);
    await expect(verifyPredictionV2CanonicalHistoricalBlockV2(
      lease,
      { number: 96n, hash: BLOCK_HASH },
    )).resolves.toBeUndefined();
    expect(primaryRequests).toEqual([
      expect.objectContaining({
        method: "eth_getBlockByNumber",
        params: ["0x60", false],
      }),
    ]);
    expect(secondaryRequests).toEqual([
      expect.objectContaining({
        method: "eth_getBlockByNumber",
        params: ["0x60", false],
      }),
    ]);
    lease.close();
  });

  it("fails closed on invalid, disagreed, aborted, or unowned historical anchors", async () => {
    const primaryFixture: { exactHash: `0x${string}` } = {
      exactHash: BLOCK_HASH,
    };
    const secondaryFixture: { exactHash: `0x${string}` } = {
      exactHash: BLOCK_HASH,
    };
    const readers = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher(primaryFixture) },
        secondary: { fetcher: rpcFetcher(secondaryFixture) },
      },
    });
    const lease = await createPredictionV2ActionRpcSnapshotLease(readers);

    await expect(verifyPredictionV2CanonicalHistoricalBlockV2(
      lease,
      { number: 0n, hash: BLOCK_HASH },
    )).rejects.toMatchObject({ code: "block-mismatch" });
    await expect(verifyPredictionV2CanonicalHistoricalBlockV2(
      lease,
      { number: lease.snapshot.number + 1n, hash: BLOCK_HASH },
    )).rejects.toMatchObject({ code: "block-mismatch" });
    secondaryFixture.exactHash = `0x${"55".repeat(32)}`;
    await expect(verifyPredictionV2CanonicalHistoricalBlockV2(
      lease,
      { number: 96n, hash: BLOCK_HASH },
    )).rejects.toMatchObject({ code: "block-mismatch" });
    secondaryFixture.exactHash = BLOCK_HASH;
    await expect(verifyPredictionV2CanonicalHistoricalBlockV2(
      lease,
      { number: 96n, hash: `0x${"66".repeat(32)}` },
    )).rejects.toMatchObject({ code: "block-mismatch" });

    const aborted = new AbortController();
    aborted.abort();
    await expect(verifyPredictionV2CanonicalHistoricalBlockV2(
      lease,
      { number: 96n, hash: BLOCK_HASH },
      aborted.signal,
    )).rejects.toMatchObject({ code: "aborted" });
    await expect(verifyPredictionV2CanonicalHistoricalBlockV2(
      { ...lease } as unknown as typeof lease,
      { number: 96n, hash: BLOCK_HASH },
    )).rejects.toMatchObject({ code: "snapshot-lease-closed" });
    lease.close();
    await expect(verifyPredictionV2CanonicalHistoricalBlockV2(
      lease,
      { number: 96n, hash: BLOCK_HASH },
    )).rejects.toMatchObject({ code: "snapshot-lease-closed" });
  });

  it("requires a factory-proven action-policy reader tuple", async () => {
    const safeReaders = createPredictionV2RpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({}) },
        secondary: { fetcher: rpcFetcher({}) },
      },
    });
    await expect(createPredictionV2ActionRpcSnapshotLease(
      safeReaders as unknown as
        ReturnType<typeof createPredictionV2ActionRpcQuorum>,
    )).rejects.toMatchObject({ code: "snapshot-policy-mismatch" });
    expect(() => toPredictionV2ResolutionRpcQuorum(
      safeReaders as unknown as
        Parameters<typeof toPredictionV2ResolutionRpcQuorum>[0],
    )).toThrow(PredictionV2RpcQuorumError);
    expect(() => predictionV2ActionRpcRuntimeProjection(
      safeReaders as unknown as
        ReturnType<typeof createPredictionV2ActionRpcQuorum>,
    )).toThrow(PredictionV2RpcQuorumError);

    const actionReaders = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({}) },
        secondary: { fetcher: rpcFetcher({}) },
      },
    });
    await expect(createPredictionV2ActionRpcSnapshotLease(
      [...actionReaders] as unknown as
        ReturnType<typeof createPredictionV2ActionRpcQuorum>,
    )).rejects.toMatchObject({ code: "snapshot-policy-mismatch" });
    expect(() => toPredictionV2ResolutionRpcQuorum(
      [...actionReaders] as unknown as
        Parameters<typeof toPredictionV2ResolutionRpcQuorum>[0],
    )).toThrow(PredictionV2RpcQuorumError);
    expect(() => predictionV2ActionRpcRuntimeProjection(
      [...actionReaders] as unknown as
        ReturnType<typeof createPredictionV2ActionRpcQuorum>,
    )).toThrow(PredictionV2RpcQuorumError);
    const lease = await createPredictionV2ActionRpcSnapshotLease(actionReaders);
    const resolution = toPredictionV2ResolutionRpcQuorum(lease);
    expect(resolution.primary.readerId).toBe(actionReaders[0].readerId);
    expect(resolution.secondary.readerId).toBe(actionReaders[1].readerId);
    expect(resolution.primary).not.toBe(actionReaders[0]);
    lease.close();
    expect(() => toPredictionV2ResolutionRpcQuorum(lease)).toThrow(
      PredictionV2RpcQuorumError,
    );
  });

  it("preserves the wrong-chain cause before any raw settlement call", async () => {
    const primaryRequests: RpcRequest[] = [];
    const secondaryRequests: RpcRequest[] = [];
    const readers = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: {
          fetcher: rpcFetcher({ chainId: 1, requests: primaryRequests }),
        },
        secondary: {
          fetcher: rpcFetcher({ requests: secondaryRequests }),
        },
      },
    });
    await expect(createPredictionV2ActionRpcSnapshotLease(readers))
      .rejects.toMatchObject({ code: "wrong-chain" });
    expect(primaryRequests.some(({ method }) => method === "eth_call")).toBe(
      false,
    );
    expect(secondaryRequests.some(({ method }) => method === "eth_call")).toBe(
      false,
    );
  });

  it("accepts only exact successful bytes from both vendors", async () => {
    const readers = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({ callResult: "0xCAFE" }) },
        secondary: { fetcher: rpcFetcher({ callResult: "0xcafe" }) },
      },
    });
    const lease = await createPredictionV2ActionRpcSnapshotLease(readers);
    await expect(readPredictionV2RawRpcQuorum({
      lease,
      request: request(),
    })).resolves.toBe("0xcafe");
    await expect(readPredictionV2RawRpcQuorum({
      lease,
      request: request(),
    })).resolves.toBe("0xcafe");
    await expect(readPredictionV2RawRpcQuorum({
      lease,
      request: { ...request(), blockNumber: 96n },
    })).rejects.toMatchObject({ code: "block-mismatch" });
    await expect(readPredictionV2RawRpcQuorum({
      lease,
      request: { ...request(), blockHash: `0x${"77".repeat(32)}` },
    })).rejects.toMatchObject({ code: "block-mismatch" });
    await expect(readPredictionV2RawRpcQuorum({
      lease,
      request: {
        ...request(),
        blockHash: 7 as unknown as `0x${string}`,
      },
    })).rejects.toMatchObject({ code: "block-mismatch" });

    const mismatch = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({ callResult: "0x01" }) },
        secondary: { fetcher: rpcFetcher({ callResult: "0x02" }) },
      },
    });
    const mismatchLease = await createPredictionV2ActionRpcSnapshotLease(
      mismatch,
    );
    await expect(readPredictionV2RawRpcQuorum({
      lease: mismatchLease,
      request: request(),
    })).rejects.toMatchObject({ code: "raw-result-mismatch" });
    lease.close();
    mismatchLease.close();
  });

  it("holds one immutable Action snapshot across head changes and closes explicitly", async () => {
    const primaryFixture: { latestHead: bigint; requests: RpcRequest[] } = {
      latestHead: 100n,
      requests: [],
    };
    const secondaryFixture: { latestHead: bigint; requests: RpcRequest[] } = {
      latestHead: 100n,
      requests: [],
    };
    const readers = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher(primaryFixture) },
        secondary: { fetcher: rpcFetcher(secondaryFixture) },
      },
    });
    const lease = await createPredictionV2ActionRpcSnapshotLease(readers);
    const resolution = toPredictionV2ResolutionRpcQuorum(lease);
    expect(lease.snapshot).toEqual(expect.objectContaining({
      number: 97n,
      hash: BLOCK_HASH,
    }));

    primaryFixture.latestHead = 101n;
    secondaryFixture.latestHead = 101n;
    await expect(Promise.all([
      resolution.primary.getCode({
        address: TARGET,
        blockNumber: lease.snapshot.number,
        blockHash: lease.snapshot.hash,
        requireCanonical: true,
      }),
      resolution.secondary.getCode({
        address: TARGET,
        blockNumber: lease.snapshot.number,
        blockHash: lease.snapshot.hash,
        requireCanonical: true,
      }),
    ])).resolves.toEqual(["0x60006000", "0x60006000"]);
    await expect(readPredictionV2RawRpcQuorum({
      lease,
      request: request(),
    })).resolves.toBe("0x1234");
    await expect(readPredictionV2RawRpcQuorum({
      lease,
      request: request(),
    })).resolves.toBe("0x1234");
    expect(primaryFixture.requests.filter(
      ({ method }) => method === "eth_blockNumber",
    )).toHaveLength(1);
    expect(secondaryFixture.requests.filter(
      ({ method }) => method === "eth_blockNumber",
    )).toHaveLength(1);

    lease.close();
    await expect(readPredictionV2RawRpcQuorum({
      lease,
      request: request(),
    })).rejects.toMatchObject({ code: "snapshot-lease-closed" });
    expect(() => toPredictionV2ResolutionRpcQuorum(lease)).toThrow(
      PredictionV2RpcQuorumError,
    );
  });

  it("keeps a matching deterministic revert distinct and rejects status disagreement", async () => {
    const readers = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({ callRevert: "0x08c379a0" }) },
        secondary: { fetcher: rpcFetcher({ callRevert: "0x08C379A0" }) },
      },
    });
    const lease = await createPredictionV2ActionRpcSnapshotLease(readers);
    await expect(readPredictionV2RawRpcQuorum({
      lease,
      request: request(),
    })).resolves.toEqual({ status: "reverted", data: "0x08c379a0" });

    const disagreement = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher({ callRevert: "0x08c379a0" }) },
        secondary: { fetcher: rpcFetcher({ callResult: "0x08c379a0" }) },
      },
    });
    const disagreementLease = await createPredictionV2ActionRpcSnapshotLease(
      disagreement,
    );
    await expect(readPredictionV2RawRpcQuorum({
      lease: disagreementLease,
      request: request(),
    })).rejects.toMatchObject({ code: "raw-result-mismatch" });
    lease.close();
    disagreementLease.close();
  });

  it("revalidates the canonical snapshot after both raw calls", async () => {
    const fixture: {
      exactHash: `0x${string}`;
      afterCall: () => void;
    } = {
      exactHash: BLOCK_HASH,
      afterCall() {
        fixture.exactHash = `0x${"88".repeat(32)}`;
      },
    };
    const readers = createPredictionV2ActionRpcQuorum({
      bindings: bindings(),
      dependencies: {
        primary: { fetcher: rpcFetcher(fixture) },
        secondary: { fetcher: rpcFetcher(fixture) },
      },
    });
    const lease = await createPredictionV2ActionRpcSnapshotLease(readers);
    await expect(readPredictionV2RawRpcQuorum({
      lease,
      request: request(),
    })).rejects.toMatchObject({ code: "block-mismatch" });
    lease.close();
  });
});
