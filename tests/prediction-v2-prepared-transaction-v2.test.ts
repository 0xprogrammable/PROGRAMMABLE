import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const provenance = vi.hoisted(() => {
  const releaseA = {};
  const releaseB = {};
  const market = {};
  const snapshot = {};
  const bindingA = {
    factory: "0x0000000000000000000000000000000000000001",
    assetRegistry: "0x0000000000000000000000000000000000000002",
    poolManager: "0x0000000000000000000000000000000000000003",
    hook: "0x0000000000000000000000000000000000000004",
    collateral: "0x0000000000000000000000000000000000000005",
    router: "0x0000000000000000000000000000000000000006",
    deploymentBlock: 10n,
  };
  const bindingB = {
    ...bindingA,
    factory: "0x0000000000000000000000000000000000000011",
  };
  return {
    releaseA,
    releaseB,
    market,
    snapshot,
    bindingA,
    bindingB,
    assertRelease: vi.fn((value: unknown) => {
      if (value !== releaseA && value !== releaseB) {
        throw new Error("release lacks verified provenance");
      }
    }),
    releaseBinding: vi.fn((value: unknown) => {
      if (value === releaseA) return bindingA;
      if (value === releaseB) return bindingB;
      throw new Error("release lacks verified provenance");
    }),
    assertMarket: vi.fn((
      marketValue: unknown,
      snapshotValue: unknown,
      bindingValue: unknown,
    ) => {
      if (
        marketValue !== market ||
        snapshotValue !== snapshot ||
        bindingValue !== bindingA
      ) {
        throw new Error("market provenance mismatch");
      }
    }),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("../lib/prediction-v2/public-release-v2.server", () => ({
  assertPredictionV2VerifiedEnabledPublicReleaseV2: provenance.assertRelease,
  toPredictionV2ReadBindingFromPublicReleaseV2: provenance.releaseBinding,
}));
vi.mock("../lib/prediction-v2/read-model-v2.server", () => ({
  assertPredictionV2ReadMarketAtSnapshotProvenance: provenance.assertMarket,
}));

import {
  encodeFunctionData,
  getAddress,
  toHex,
  type Address,
  type Hex,
} from "viem";

import {
  PREDICTION_V2_VAULT_ABI,
  type PredictionV2PoolKey,
} from "../lib/prediction-v2/abi";
import {
  predictionV2MarketId,
  predictionV2PoolId,
} from "../lib/prediction-v2/accounting";
import {
  PREDICTION_V2_PREPARED_ACTIONS_V2,
  PREDICTION_V2_PREPARED_TRANSACTION_SCHEMA_V2,
  getPredictionV2PreparedTransactionReviewV2,
} from "../lib/prediction-v2/prepared-transaction-v2";
import {
  buildPredictionV2PreparedTransactionEnvelopeV2,
  type PredictionV2PreparedServerBindingV2,
} from "../lib/prediction-v2/prepared-transaction-v2.server";
import type {
  PredictionV2EnabledPublicReleaseV2,
} from "../lib/prediction-v2/public-release-v2.server";
import type {
  PredictionV2ReadMarket,
  PredictionV2SafeBlock,
} from "../lib/prediction-v2/read-model-v2.server";
import {
  preparePredictionV2Redeem,
} from "../lib/prediction-v2/transactions";

const address = (suffix: number) =>
  getAddress(`0x${suffix.toString(16).padStart(40, "0")}`) as Address;
const bytes32 = (value: number) => toHex(value, { size: 32 }) as Hex;

const VAULT = address(7);
const YES = address(8);
const NO = address(9);
const ACCOUNT = address(10);
const ECONOMIC_KEY = bytes32(101);
const SNAPSHOT_HASH = bytes32(102);
const MARKET_ID = predictionV2MarketId(ECONOMIC_KEY, SNAPSHOT_HASH);
const POOL_KEY = Object.freeze({
  currency0: YES,
  currency1: NO,
  fee: 200,
  tickSpacing: 10,
  hooks: getAddress(provenance.bindingA.hook),
}) satisfies PredictionV2PoolKey;
const POOL_ID = predictionV2PoolId(POOL_KEY);

beforeAll(() => {
  Object.assign(provenance.releaseA, {
    release: { releaseId: "protocol-v2" },
    attestation: { payloadSha256: `sha256:${"a".repeat(64)}` },
  });
  Object.assign(provenance.releaseB, {
    release: { releaseId: "protocol-v2-b" },
    attestation: { payloadSha256: `sha256:${"b".repeat(64)}` },
  });
  Object.assign(provenance.snapshot, {
    number: 100n,
    hash: bytes32(201),
    parentHash: bytes32(200),
    timestamp: 3_000n,
  });
  Object.assign(provenance.market, {
    economicKey: ECONOMIC_KEY,
    marketId: MARKET_ID,
    assetKey: bytes32(103),
    registryRevision: 1n,
    registrySnapshotHash: SNAPSHOT_HASH,
    resolutionPolicyHash: bytes32(104),
    policyValidUntil: 9_999n,
    snapshotAssetCap: 20_000_000n,
    vault: VAULT,
    checkpoint: address(11),
    yesToken: YES,
    noToken: NO,
    poolId: POOL_ID,
    poolKey: POOL_KEY,
    asset: { identity: {}, displaySymbol: "BTC" },
    predicate: {
      comparator: "greater-than-or-equal",
      threshold: 100_000_000n,
      observationTime: 2_000n,
      priceDecimals: 8,
    },
    lifecycle: {
      protocolState: "FINAL_YES",
      checkpointStatus: "FINAL",
      tradingPhase: "FINAL",
      tradable: false,
      tradabilityReason: "market-final",
      checkpointTradingHealthy: true,
      resolvedPrice: 110_000_000n,
    },
    deadlines: {
      cutoff: 1_940n,
      resolutionDeadline: 2_100n,
      hardResolutionDeadline: 2_200n,
      fallbackRequestedAt: 0n,
      fallbackChallengeDeadline: 0n,
    },
    poolState: {
      sqrtPriceX96: 1n << 96n,
      tick: 0,
      poolManagerProtocolFee: 0,
      lpFee: 200,
      yesProbabilityBps: 5_000,
    },
    accountedLiability: 2_000_000n,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
});

function input(
  overrides: Partial<PredictionV2PreparedServerBindingV2> = {},
): PredictionV2PreparedServerBindingV2 {
  const snapshot = provenance.snapshot as PredictionV2SafeBlock;
  return {
    release: provenance.releaseA as PredictionV2EnabledPublicReleaseV2,
    market: provenance.market as PredictionV2ReadMarket,
    snapshot,
    intent: Object.freeze({
      action: "redeem",
      actionId: bytes32(301),
      account: ACCOUNT,
      snapshot,
      transaction: preparePredictionV2Redeem({
        vault: VAULT,
        yesAtoms: 1_000_000n,
        noAtoms: 0n,
        recipient: ACCOUNT,
      }),
    }),
    ...overrides,
  };
}

describe("Prediction V2 prepared transaction transport", () => {
  it("omits create until a real dual-RPC create preflight capability exists", () => {
    expect(Object.hasOwn(PREDICTION_V2_PREPARED_ACTIONS_V2, "create")).toBe(false);
    expect(Object.keys(PREDICTION_V2_PREPARED_ACTIONS_V2)).toHaveLength(8);
  });

  it("uses release-frozen selectors and exact action-specific gas limits", () => {
    expect(PREDICTION_V2_PREPARED_ACTIONS_V2.buy).toEqual({
      kind: "buy",
      selector: "0x4ca902e5",
      gasLimit: 750_000n,
    });
    expect(PREDICTION_V2_PREPARED_ACTIONS_V2.redeem.gasLimit).toBe(500_000n);
    expect(PREDICTION_V2_PREPARED_ACTIONS_V2["finalize-with-proof"].gasLimit)
      .toBe(1_000_000n);
  });

  it("builds a closed response only through all three provenance assertions", () => {
    const envelope = buildPredictionV2PreparedTransactionEnvelopeV2(input());
    expect(envelope).toMatchObject({
      schemaVersion: PREDICTION_V2_PREPARED_TRANSACTION_SCHEMA_V2,
      releaseId: "protocol-v2",
      releaseBindingHash: `0x${"a".repeat(64)}`,
      chainId: 4_663,
      action: "redeem",
      actionId: bytes32(301),
      marketId: MARKET_ID,
      marketVault: VAULT,
      account: ACCOUNT,
      confirmedBlockNumber: "100",
      confirmedBlockHash: bytes32(201),
      transaction: {
        to: VAULT,
        value: "0",
        gasLimit: "500000",
      },
    });
    expect(BigInt(envelope.expiresAtUnixSeconds) - BigInt(envelope.issuedAtUnixSeconds))
      .toBe(120n);
    expect(provenance.assertRelease).toHaveBeenCalledWith(provenance.releaseA);
    expect(provenance.releaseBinding).toHaveBeenCalledWith(provenance.releaseA);
    expect(provenance.assertMarket).toHaveBeenCalledWith(
      provenance.market,
      provenance.snapshot,
      provenance.bindingA,
    );
  });

  it("rejects unsigned releases, cloned markets and foreign snapshots", () => {
    expect(() => buildPredictionV2PreparedTransactionEnvelopeV2(input({
      release: { ...provenance.releaseA } as PredictionV2EnabledPublicReleaseV2,
    }))).toThrow("release lacks verified provenance");
    expect(() => buildPredictionV2PreparedTransactionEnvelopeV2(input({
      market: { ...provenance.market } as PredictionV2ReadMarket,
    }))).toThrow("market provenance mismatch");
    expect(() => buildPredictionV2PreparedTransactionEnvelopeV2(input({
      snapshot: { ...provenance.snapshot } as PredictionV2SafeBlock,
    }))).toThrow("market provenance mismatch");
  });

  it("rejects Release A market rows under Release B read bindings", () => {
    expect(() => buildPredictionV2PreparedTransactionEnvelopeV2(input({
      release: provenance.releaseB as PredictionV2EnabledPublicReleaseV2,
    }))).toThrow("market provenance mismatch");
    expect(provenance.assertMarket).toHaveBeenCalledWith(
      provenance.market,
      provenance.snapshot,
      provenance.bindingB,
    );
  });

  it("requires the action producer to retain the exact leased snapshot object", () => {
    const base = input();
    expect(() => buildPredictionV2PreparedTransactionEnvelopeV2({
      ...base,
      intent: {
        ...base.intent,
        snapshot: { ...base.snapshot },
      },
    })).toThrow("intent snapshot capability");
  });

  it("rejects recipient, target and selector drift", () => {
    const base = input();
    expect(() => buildPredictionV2PreparedTransactionEnvelopeV2({
      ...base,
      intent: {
        ...base.intent,
        transaction: preparePredictionV2Redeem({
          vault: VAULT,
          yesAtoms: 1n,
          noAtoms: 0n,
          recipient: address(99),
        }),
      },
    })).toThrow("redeem binding");
    expect(() => buildPredictionV2PreparedTransactionEnvelopeV2({
      ...base,
      intent: {
        ...base.intent,
        transaction: {
          ...base.intent.transaction,
          to: address(99),
        },
      },
    })).toThrow("target binding");
    expect(() => buildPredictionV2PreparedTransactionEnvelopeV2({
      ...base,
      intent: {
        ...base.intent,
        transaction: {
          ...base.intent.transaction,
          data: encodeFunctionData({
            abi: PREDICTION_V2_VAULT_ABI,
            functionName: "finalizeResolved",
          }),
        },
      },
    })).toThrow("selector binding");
  });

  it("keeps action review copy closed and specific", () => {
    expect(getPredictionV2PreparedTransactionReviewV2("buy").buttonText)
      .toBe("Buy shares");
    expect(getPredictionV2PreparedTransactionReviewV2("redeem").buttonText)
      .toBe("Redeem payout");
    expect(getPredictionV2PreparedTransactionReviewV2("finalize-resolved").buttonText)
      .toBe("Finalize market");
  });
});
