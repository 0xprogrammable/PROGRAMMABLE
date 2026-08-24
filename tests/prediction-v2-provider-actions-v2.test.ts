import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertBudget: vi.fn(),
  base: vi.fn(),
  buildPrepared: vi.fn(),
  closeSession: vi.fn(),
  createReaders: vi.fn(),
  createSession: vi.fn(),
  decide: vi.fn(),
  enrich: vi.fn(),
  prepareRedeem: vi.fn(),
  readDirectory: vi.fn(),
  readMarket: vi.fn(),
  verifyHistorical: vi.fn(),
  readers: Object.freeze([{ readerId: "primary" }, { readerId: "secondary" }]),
  sessionLease: Object.freeze({ leaseId: "session-lease" }),
  sessionPrimary: Object.freeze({ readerId: "session-primary" }),
  sessionSecondary: Object.freeze({ readerId: "session-secondary" }),
}));

vi.mock("@/lib/prediction-v2/base-market-view-v2.server", () => ({
  buildPredictionV2BaseMarketView: mocks.base,
}));

vi.mock("@/lib/prediction-v2/enriched-market-view-v2", () => ({
  enrichPredictionV2BaseMarketView: mocks.enrich,
}));

vi.mock("@/lib/prediction-v2/public-release-v2.server", () => ({
  PREDICTION_V2_PUBLIC_RELEASE_HISTORICAL_SESSION_MAX_RPC_LOGICAL_CALLS: 50,
  PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS: 48,
  assertPredictionV2RuntimeDistributedBudgetMatchesRelease: mocks.assertBudget,
  createPredictionV2PublicReleaseResolutionRpcSession: mocks.createSession,
  toPredictionV2PublicMarketCanonicalReleaseV2: () => Object.freeze({
    schemaVersion: 2,
    releaseId: "protocol-v2",
    settlementChainId: "4663",
    factoryAddress: `0x${"11".repeat(20)}`,
    factoryRuntimeCodeHash: `0x${"12".repeat(32)}`,
    projectionAttestorAddress: `0x${"13".repeat(20)}`,
  }),
  toPredictionV2ReadBindingFromPublicReleaseV2: () => Object.freeze({
    factory: `0x${"11".repeat(20)}`,
  }),
}));

vi.mock("@/lib/prediction-v2/prepared-transaction-v2.server", () => ({
  buildPredictionV2PreparedTransactionEnvelopeV2: mocks.buildPrepared,
}));

vi.mock("@/lib/prediction-v2/read-model-v2.server", () => ({
  PREDICTION_V2_DIRECTORY_MAX_PAGE_SIZE: 8,
  PREDICTION_V2_DIRECTORY_MAX_PROVIDER_REQUESTS: 602,
  PREDICTION_V2_TARGETED_MARKET_MAX_PROVIDER_REQUESTS: 94,
  readPredictionV2Directory: mocks.readDirectory,
  readPredictionV2MarketAtSnapshot: mocks.readMarket,
}));

vi.mock("@/lib/prediction-v2/resolution-action-v2.server", () => ({
  PREDICTION_V2_RESOLUTION_PUBLIC_RELEASE_MAX_PROVIDER_REQUESTS: 2_296,
  decidePredictionV2ResolutionActionFromPublicRelease: mocks.decide,
}));

vi.mock("@/lib/prediction-v2/rpc-quorum-v2.server", () => ({
  PREDICTION_V2_CANONICAL_HISTORICAL_BLOCK_VERIFICATION_RPC_LOGICAL_CALLS: 2,
  createPredictionV2ActionRpcQuorum: mocks.createReaders,
  verifyPredictionV2CanonicalHistoricalBlockV2: mocks.verifyHistorical,
}));

vi.mock("@/lib/prediction-v2/transactions", () => ({
  preparePredictionV2Redeem: mocks.prepareRedeem,
}));

import {
  decidePredictionV2ResolutionRouteV2,
  preparePredictionV2RedeemRouteV2,
  readPredictionV2DirectoryRouteV2,
} from "@/app/api/prediction/v2/_shared/provider-actions-v2.server";

const FACTORY = `0x${"11".repeat(20)}` as `0x${string}`;
const ECONOMIC_KEY = `0x${"22".repeat(32)}` as `0x${string}`;
const MARKET_ID = `0x${"33".repeat(32)}` as `0x${string}`;
const ACTION_ID = `0x${"44".repeat(32)}` as `0x${string}`;
const ACCOUNT = `0x${"55".repeat(20)}` as `0x${string}`;
const BLOCK = Object.freeze({
  number: 100n,
  hash: `0x${"66".repeat(32)}`,
  parentHash: `0x${"77".repeat(32)}`,
  timestamp: 1_800_000_000n,
});
const MINIMUM_CONFIRMED_BLOCK = Object.freeze({
  number: 90n,
  hash: `0x${"65".repeat(32)}` as `0x${string}`,
});
const VAULT = `0x${"cc".repeat(20)}` as `0x${string}`;
const MARKET = Object.freeze({
  economicKey: ECONOMIC_KEY,
  marketId: MARKET_ID,
  vault: VAULT,
});
const REDEEM_TRANSACTION = Object.freeze({
  chainId: 4_663,
  to: VAULT,
  value: 0n,
  data: "0x049104e5abcd",
});
const PREPARED_REDEEM = Object.freeze({
  schemaVersion: "programmable.prediction-v2.prepared-transaction.v2",
  releaseId: "protocol-v2",
  releaseBindingHash: `0x${"88".repeat(32)}`,
  chainId: 4_663,
  action: "redeem",
  actionId: ACTION_ID,
  calldataHash: `0x${"89".repeat(32)}`,
  kind: "redeem",
  confirmedBlockNumber: BLOCK.number.toString(),
  confirmedBlockHash: BLOCK.hash,
  marketId: MARKET_ID,
  marketVault: VAULT,
  account: ACCOUNT,
  issuedAtUnixSeconds: "1800000000",
  expiresAtUnixSeconds: "1800000120",
  transaction: Object.freeze({
    to: VAULT,
    data: REDEEM_TRANSACTION.data,
    value: "0",
    gasLimit: "500000",
  }),
});
const RELEASE = Object.freeze({
  release: Object.freeze({ releaseId: "protocol-v2" }),
  attestation: Object.freeze({ payloadSha256: `0x${"88".repeat(32)}` }),
  rpcCommitment: Object.freeze({
    snapshotPolicy: Object.freeze({ confirmationDepth: 3 }),
  }),
}) as never;
const BUDGET = Object.freeze({}) as never;
const BASE_VIEW = Object.freeze({
  schemaVersion: 2,
  source: "dual-rpc-onchain",
  marketKey: `eip155:4663:${FACTORY}:${ECONOMIC_KEY}`,
  marketId: MARKET_ID,
  economicKey: ECONOMIC_KEY,
  asset: Object.freeze({
    kind: "preset",
    presetId: "btc",
    sourceNetwork: "global",
    chainLabel: "Global crypto asset",
    address: null,
    explorerUrl: null,
    name: "Bitcoin",
    symbol: "BTC",
  }),
  condition: Object.freeze({
    kind: "usd-price-at-utc",
    metric: "usd-price",
    comparator: "greater-than-or-equal",
    quoteCurrency: "USD",
    strikeAtoms: "10000000000000",
    priceDecimals: 8,
    observationUnixSeconds: "1800000000",
    observationUtc: "2027-01-15T08:00:00.000Z",
    oracleSnapshotRule: Object.freeze({
      source: "chainlink-data-feed",
      winningPrice: "latest-completed-round-at-or-before-observation",
      requiredAfterRound: "first-completed-round-after-observation",
      maximumBeforeAgeSeconds: "90000",
      maximumAfterDelaySeconds: "90000",
    }),
  }),
  lifecycle: Object.freeze({
    protocolState: "OPEN",
    checkpointStatus: "AWAITING",
    tradingPhase: "OPEN",
    tradable: true,
    tradabilityReason: "tradable",
    checkpointTradingHealthy: true,
    resolvedPrice: 0n,
  }),
  poolState: Object.freeze({
    sqrtPriceX96: 2n ** 96n,
    tick: 0,
    poolManagerProtocolFee: 0,
    lpFee: 100,
    yesProbabilityBps: 5_000,
  }),
  artwork: Object.freeze({ kind: "bundled-fallback", url: "/btc.svg" }),
  links: Object.freeze([]),
  onchain: Object.freeze({
    releaseId: "protocol-v2",
    settlementChainId: 4_663,
    factoryAddress: FACTORY,
    factoryRuntimeCodeHash: `0x${"12".repeat(32)}`,
    assetKey: `0x${"99".repeat(32)}`,
    registryRevision: "1",
    registrySnapshotHash: `0x${"aa".repeat(32)}`,
    resolutionPolicyHash: `0x${"bb".repeat(32)}`,
    vaultAddress: `0x${"cc".repeat(20)}`,
    checkpointAddress: `0x${"dd".repeat(20)}`,
    poolId: `0x${"ee".repeat(32)}`,
    confirmedBlockNumber: "100",
    confirmedBlockHash: BLOCK.hash,
  }),
}) as never;

describe("Prediction V2 provider action DTO adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createReaders.mockReturnValue(mocks.readers);
    mocks.createSession.mockImplementation((
      _release: unknown,
      _readers: unknown,
      _budget: unknown,
      _signal: unknown,
      historicalSnapshot?: unknown,
    ) => Object.freeze({
      lease: mocks.sessionLease,
      quorum: Object.freeze({
        primary: mocks.sessionPrimary,
        secondary: mocks.sessionSecondary,
      }),
      snapshot: BLOCK,
      rpcLogicalCalls: historicalSnapshot ? 50 : 48,
      close: mocks.closeSession,
    }));
    mocks.base.mockReturnValue(BASE_VIEW);
    mocks.readMarket.mockResolvedValue(Object.freeze({
      market: MARKET,
      snapshot: BLOCK,
    }));
    mocks.prepareRedeem.mockReturnValue(REDEEM_TRANSACTION);
    mocks.buildPrepared.mockReturnValue(PREPARED_REDEEM);
    mocks.enrich.mockImplementation((base) => Object.freeze({
      ...(base as object),
      enrichment: null,
    }));
  });

  it("returns base markets without attestor data and round-trips its cursor", async () => {
    mocks.readDirectory.mockResolvedValueOnce(Object.freeze({
      schemaVersion: 2,
      chainId: 4_663,
      snapshot: BLOCK,
      marketCount: 1n,
      markets: Object.freeze([Object.freeze({})]),
      quarantined: Object.freeze([]),
      nextCursor: Object.freeze({
        schemaVersion: 2,
        blockNumber: BLOCK.number,
        blockHash: BLOCK.hash,
        marketCount: 1n,
        nextExclusiveIndex: 1n,
      }),
    }));

    const first = await readPredictionV2DirectoryRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({ limit: 1, cursor: null }),
      signal: new AbortController().signal,
    });

    expect(first.markets).toEqual([expect.objectContaining({
      marketId: MARKET_ID,
      enrichment: null,
      lifecycle: expect.objectContaining({ resolvedPrice: "0" }),
      poolState: expect.objectContaining({
        sqrtPriceX96: (2n ** 96n).toString(),
      }),
    })]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(first)).not.toContain("bigint");
    expect(JSON.stringify(first)).not.toMatch(
      /actionId|calldata|signature|signed|transaction|broadcast/u,
    );
    expect(mocks.createSession).toHaveBeenCalledWith(
      RELEASE,
      mocks.readers,
      BUDGET,
      expect.any(AbortSignal),
      undefined,
    );
    expect(mocks.readDirectory).toHaveBeenCalledWith(expect.objectContaining({
      readers: [mocks.sessionPrimary, mocks.sessionSecondary],
    }));
    expect(mocks.closeSession).toHaveBeenCalledTimes(1);
    expect(mocks.readMarket).not.toHaveBeenCalled();
    expect(mocks.prepareRedeem).not.toHaveBeenCalled();
    expect(mocks.buildPrepared).not.toHaveBeenCalled();

    mocks.readDirectory.mockResolvedValueOnce(Object.freeze({
      schemaVersion: 2,
      chainId: 4_663,
      snapshot: BLOCK,
      marketCount: 1n,
      markets: Object.freeze([]),
      quarantined: Object.freeze([]),
      nextCursor: null,
    }));
    await readPredictionV2DirectoryRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({ limit: 1, cursor: first.nextCursor as string }),
      signal: new AbortController().signal,
    });

    expect(mocks.readDirectory.mock.calls[1]?.[0].cursor).toEqual({
      schemaVersion: 2,
      blockNumber: 100n,
      blockHash: BLOCK.hash,
      marketCount: 1n,
      nextExclusiveIndex: 1n,
    });
    expect(mocks.createSession).toHaveBeenNthCalledWith(
      2,
      RELEASE,
      mocks.readers,
      BUDGET,
      expect.any(AbortSignal),
      { number: 100n, hash: BLOCK.hash },
    );
    expect(mocks.assertBudget).toHaveBeenCalledTimes(2);
    expect(mocks.createSession).toHaveBeenCalledTimes(2);
    expect(mocks.closeSession).toHaveBeenCalledTimes(2);
    expect(mocks.createReaders).toHaveBeenNthCalledWith(1, {
      confirmationDepth: 3n,
    });
    expect(mocks.createReaders).toHaveBeenNthCalledWith(2, {
      confirmationDepth: 3n,
    });
  });

  it("rejects a noncanonical cursor before any directory RPC read", async () => {
    await expect(readPredictionV2DirectoryRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({ limit: 1, cursor: "abcdefghijklmnop" }),
      signal: new AbortController().signal,
    })).rejects.toThrow("Invalid Prediction V2 cursor");

    expect(mocks.readDirectory).not.toHaveBeenCalled();
    expect(mocks.createReaders).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("closes the directory session when its leased directory read fails", async () => {
    mocks.readDirectory.mockRejectedValueOnce(new Error("provider disagreement"));

    await expect(readPredictionV2DirectoryRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({ limit: 1, cursor: null }),
      signal: new AbortController().signal,
    })).rejects.toThrow("provider disagreement");

    expect(mocks.readDirectory).toHaveBeenCalledWith(expect.objectContaining({
      readers: [mocks.sessionPrimary, mocks.sessionSecondary],
    }));
    expect(mocks.closeSession).toHaveBeenCalledTimes(1);
  });

  it("fails closed before a directory read when the session cost drifts", async () => {
    mocks.createSession.mockResolvedValueOnce(Object.freeze({
      lease: mocks.sessionLease,
      quorum: Object.freeze({
        primary: mocks.sessionPrimary,
        secondary: mocks.sessionSecondary,
      }),
      snapshot: BLOCK,
      rpcLogicalCalls: 47,
      close: mocks.closeSession,
    }));

    await expect(readPredictionV2DirectoryRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({ limit: 1, cursor: null }),
      signal: new AbortController().signal,
    })).rejects.toThrow("Invalid Prediction V2 public release session cost");

    expect(mocks.readDirectory).not.toHaveBeenCalled();
    expect(mocks.closeSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["directory", () => readPredictionV2DirectoryRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({ limit: 1, cursor: null }),
      signal: new AbortController().signal,
    })],
    ["redeem", () => preparePredictionV2RedeemRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({
        schemaVersion: "programmable.prediction-v2.redeem-prepare-request.v2",
        action: "redeem",
        actionId: ACTION_ID,
        marketKey: `eip155:4663:${FACTORY}:${ECONOMIC_KEY}`,
        economicKey: ECONOMIC_KEY,
        marketId: MARKET_ID,
        account: ACCOUNT,
        minimumConfirmedBlockNumber:
          MINIMUM_CONFIRMED_BLOCK.number.toString(),
        minimumConfirmedBlockHash: MINIMUM_CONFIRMED_BLOCK.hash,
        yesAtoms: "1",
        noAtoms: "0",
      }),
      signal: new AbortController().signal,
    })],
    ["resolution", () => decidePredictionV2ResolutionRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({
        schemaVersion:
          "programmable.prediction-v2.resolution-decision-request.v2",
        action: "decide-resolution",
        actionId: ACTION_ID,
        marketKey: `eip155:4663:${FACTORY}:${ECONOMIC_KEY}`,
        economicKey: ECONOMIC_KEY,
        marketId: MARKET_ID,
        account: ACCOUNT,
      }),
      signal: new AbortController().signal,
    })],
  ] as const)("rejects a mismatched %s budget before RPC configuration", async (
    _label,
    execute,
  ) => {
    mocks.assertBudget.mockImplementationOnce(() => {
      throw new Error("budget mismatch");
    });

    await expect(execute()).rejects.toThrow("budget mismatch");

    expect(mocks.createReaders).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.readDirectory).not.toHaveBeenCalled();
    expect(mocks.readMarket).not.toHaveBeenCalled();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("prepares redeem from one fresh provenanced market snapshot", async () => {
    const signal = new AbortController().signal;
    const result = await preparePredictionV2RedeemRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({
        schemaVersion: "programmable.prediction-v2.redeem-prepare-request.v2",
        action: "redeem",
        actionId: ACTION_ID,
        marketKey: `eip155:4663:${FACTORY}:${ECONOMIC_KEY}`,
        economicKey: ECONOMIC_KEY,
        marketId: MARKET_ID,
        account: ACCOUNT,
        minimumConfirmedBlockNumber:
          MINIMUM_CONFIRMED_BLOCK.number.toString(),
        minimumConfirmedBlockHash: MINIMUM_CONFIRMED_BLOCK.hash,
        yesAtoms: "7",
        noAtoms: "2",
      }),
      signal,
    });

    expect(mocks.createReaders).toHaveBeenCalledWith({ confirmationDepth: 3n });
    expect(mocks.createSession).toHaveBeenCalledWith(
      RELEASE,
      mocks.readers,
      BUDGET,
      signal,
    );
    expect(mocks.verifyHistorical).toHaveBeenCalledWith(
      mocks.sessionLease,
      MINIMUM_CONFIRMED_BLOCK,
      signal,
    );
    expect(mocks.readMarket).toHaveBeenCalledWith({
      readers: [mocks.sessionPrimary, mocks.sessionSecondary],
      binding: { factory: FACTORY },
      economicKey: ECONOMIC_KEY,
      snapshot: BLOCK,
      signal,
    });
    expect(mocks.prepareRedeem).toHaveBeenCalledWith({
      vault: VAULT,
      yesAtoms: 7n,
      noAtoms: 2n,
      recipient: ACCOUNT,
    });
    const preparedBinding = mocks.buildPrepared.mock.calls[0]?.[0];
    expect(preparedBinding).toEqual(expect.objectContaining({
      release: RELEASE,
      market: MARKET,
      snapshot: BLOCK,
      intent: expect.objectContaining({
        action: "redeem",
        actionId: ACTION_ID,
        account: ACCOUNT,
        transaction: REDEEM_TRANSACTION,
      }),
    }));
    expect(preparedBinding.intent.snapshot).toBe(preparedBinding.snapshot);
    expect(result).toEqual(PREPARED_REDEEM);
    expect(JSON.stringify(result)).not.toMatch(
      /signature|signed|broadcast|transactionHash/u,
    );
    expect(mocks.closeSession).toHaveBeenCalledTimes(1);
    expect(mocks.verifyHistorical.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.readMarket.mock.invocationCallOrder[0]!,
    );
  });

  it("stops before the market read when the displayed anchor is no longer canonical", async () => {
    mocks.verifyHistorical.mockRejectedValueOnce(
      new Error("historical block mismatch"),
    );

    await expect(preparePredictionV2RedeemRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({
        schemaVersion: "programmable.prediction-v2.redeem-prepare-request.v2",
        action: "redeem",
        actionId: ACTION_ID,
        marketKey: `eip155:4663:${FACTORY}:${ECONOMIC_KEY}`,
        economicKey: ECONOMIC_KEY,
        marketId: MARKET_ID,
        account: ACCOUNT,
        minimumConfirmedBlockNumber:
          MINIMUM_CONFIRMED_BLOCK.number.toString(),
        minimumConfirmedBlockHash: MINIMUM_CONFIRMED_BLOCK.hash,
        yesAtoms: "1",
        noAtoms: "0",
      }),
      signal: new AbortController().signal,
    })).rejects.toThrow("historical block mismatch");

    expect(mocks.readMarket).not.toHaveBeenCalled();
    expect(mocks.buildPrepared).not.toHaveBeenCalled();
    expect(mocks.closeSession).toHaveBeenCalledTimes(1);
  });

  it("closes the redeem session when the canonical market read fails", async () => {
    mocks.readMarket.mockRejectedValueOnce(new Error("provider disagreement"));

    await expect(preparePredictionV2RedeemRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({
        schemaVersion: "programmable.prediction-v2.redeem-prepare-request.v2",
        action: "redeem",
        actionId: ACTION_ID,
        marketKey: `eip155:4663:${FACTORY}:${ECONOMIC_KEY}`,
        economicKey: ECONOMIC_KEY,
        marketId: MARKET_ID,
        account: ACCOUNT,
        minimumConfirmedBlockNumber:
          MINIMUM_CONFIRMED_BLOCK.number.toString(),
        minimumConfirmedBlockHash: MINIMUM_CONFIRMED_BLOCK.hash,
        yesAtoms: "1",
        noAtoms: "0",
      }),
      signal: new AbortController().signal,
    })).rejects.toThrow("provider disagreement");

    expect(mocks.buildPrepared).not.toHaveBeenCalled();
    expect(mocks.closeSession).toHaveBeenCalledTimes(1);
  });

  it("rejects a cross-market redeem row and still closes its session", async () => {
    mocks.readMarket.mockResolvedValueOnce(Object.freeze({
      market: Object.freeze({ ...MARKET, marketId: `0x${"90".repeat(32)}` }),
      snapshot: BLOCK,
    }));

    await expect(preparePredictionV2RedeemRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({
        schemaVersion: "programmable.prediction-v2.redeem-prepare-request.v2",
        action: "redeem",
        actionId: ACTION_ID,
        marketKey: `eip155:4663:${FACTORY}:${ECONOMIC_KEY}`,
        economicKey: ECONOMIC_KEY,
        marketId: MARKET_ID,
        account: ACCOUNT,
        minimumConfirmedBlockNumber:
          MINIMUM_CONFIRMED_BLOCK.number.toString(),
        minimumConfirmedBlockHash: MINIMUM_CONFIRMED_BLOCK.hash,
        yesAtoms: "1",
        noAtoms: "0",
      }),
      signal: new AbortController().signal,
    })).rejects.toThrow("market identity mismatch");

    expect(mocks.prepareRedeem).not.toHaveBeenCalled();
    expect(mocks.buildPrepared).not.toHaveBeenCalled();
    expect(mocks.closeSession).toHaveBeenCalledTimes(1);
  });

  it("rejects a drifted public-session cost before the targeted read", async () => {
    mocks.createSession.mockResolvedValueOnce(Object.freeze({
      lease: mocks.sessionLease,
      quorum: Object.freeze({
        primary: mocks.sessionPrimary,
        secondary: mocks.sessionSecondary,
      }),
      snapshot: BLOCK,
      rpcLogicalCalls: 47,
      close: mocks.closeSession,
    }));

    await expect(preparePredictionV2RedeemRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({
        schemaVersion: "programmable.prediction-v2.redeem-prepare-request.v2",
        action: "redeem",
        actionId: ACTION_ID,
        marketKey: `eip155:4663:${FACTORY}:${ECONOMIC_KEY}`,
        economicKey: ECONOMIC_KEY,
        marketId: MARKET_ID,
        account: ACCOUNT,
        minimumConfirmedBlockNumber:
          MINIMUM_CONFIRMED_BLOCK.number.toString(),
        minimumConfirmedBlockHash: MINIMUM_CONFIRMED_BLOCK.hash,
        yesAtoms: "1",
        noAtoms: "0",
      }),
      signal: new AbortController().signal,
    })).rejects.toThrow("public release session cost");

    expect(mocks.readMarket).not.toHaveBeenCalled();
    expect(mocks.closeSession).toHaveBeenCalledTimes(1);
  });

  it("returns only the closed unsigned resolution action DTO", async () => {
    mocks.decide.mockResolvedValue(Object.freeze({
      schemaVersion: 2,
      decision: "action",
      chainId: 4_663,
      action: "finalize-with-proof",
      account: ACCOUNT,
      snapshot: BLOCK,
      binding: Object.freeze({ secret: "must-not-cross-route" }),
      transaction: Object.freeze({
        to: `0x${"cc".repeat(20)}`,
        data: "0x12345678abcd",
        selector: "0x12345678",
        value: 0n,
      }),
      expected: Object.freeze({
        checkpointStatus: "FINAL",
        vaultState: "OPEN",
        fallbackChallengeDeadline: 0n,
      }),
      proofCommitment: `0x${"ff".repeat(32)}`,
      providerRequests: 100,
    }));

    const result = await decidePredictionV2ResolutionRouteV2({
      release: RELEASE,
      budget: BUDGET,
      intent: Object.freeze({
        schemaVersion:
          "programmable.prediction-v2.resolution-decision-request.v2",
        action: "decide-resolution",
        actionId: ACTION_ID,
        marketKey: `eip155:4663:${FACTORY}:${ECONOMIC_KEY}`,
        economicKey: ECONOMIC_KEY,
        marketId: MARKET_ID,
        account: ACCOUNT,
      }),
      signal: new AbortController().signal,
    });

    expect(result).toEqual(expect.objectContaining({
      decision: "action",
      actionId: ACTION_ID,
      marketId: MARKET_ID,
      transaction: expect.objectContaining({ value: "0" }),
    }));
    expect(result).not.toHaveProperty("binding");
    expect(JSON.stringify(result)).not.toMatch(
      /signature|signed|broadcast|transactionHash/u,
    );
  });
});
