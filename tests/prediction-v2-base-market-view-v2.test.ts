import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const provenance = vi.hoisted(() => {
  const releaseA = {};
  const releaseB = {};
  const market = {};
  const invalidIdentityMarket = {};
  const snapshot = {};
  const bindingA = { factory: `0x${"12".repeat(20)}` };
  const bindingB = { factory: `0x${"13".repeat(20)}` };
  return {
    releaseA,
    releaseB,
    market,
    invalidIdentityMarket,
    snapshot,
    bindingA,
    bindingB,
    assertRelease: vi.fn((value: unknown) => {
      if (value !== releaseA && value !== releaseB) {
        throw new Error("release lacks verified provenance");
      }
    }),
    toBinding: vi.fn((value: unknown) => {
      if (value === releaseA) return bindingA;
      if (value === releaseB) return bindingB;
      throw new Error("release lacks verified provenance");
    }),
    canonical: vi.fn((value: unknown) => {
      if (value === releaseA) {
        return {
          releaseId: "prediction-v2.release-1",
          factoryAddress: bindingA.factory,
          factoryRuntimeCodeHash: `0x${"41".repeat(32)}`,
        };
      }
      if (value === releaseB) {
        return {
          releaseId: "prediction-v2.release-2",
          factoryAddress: bindingB.factory,
          factoryRuntimeCodeHash: `0x${"42".repeat(32)}`,
        };
      }
      throw new Error("release lacks verified provenance");
    }),
    assertMarket: vi.fn((
      marketValue: unknown,
      snapshotValue: unknown,
      bindingValue: unknown,
    ) => {
      if (
        (marketValue !== market && marketValue !== invalidIdentityMarket) ||
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
  toPredictionV2ReadBindingFromPublicReleaseV2: provenance.toBinding,
  toPredictionV2PublicMarketCanonicalReleaseV2: provenance.canonical,
}));
vi.mock("../lib/prediction-v2/read-model-v2.server", () => ({
  assertPredictionV2ReadMarketAtSnapshotProvenance: provenance.assertMarket,
}));

import { getAddress } from "viem";

import {
  predictionAssetIdentityCandidatesV2,
  predictionOnchainAssetKeyV2,
} from "../lib/prediction-market-assets-v2";
import { buildPredictionV2BaseMarketView } from
  "../lib/prediction-v2/base-market-view-v2.server";
import type { PredictionV2EnabledPublicReleaseV2 } from
  "../lib/prediction-v2/public-release-v2.server";
import type {
  PredictionV2ReadMarket,
  PredictionV2SafeBlock,
} from "../lib/prediction-v2/read-model-v2.server";

const FACTORY = getAddress(`0x${"12".repeat(20)}`);
const ADDRESS = getAddress(`0x${"ab".repeat(20)}`);
const identity = predictionAssetIdentityCandidatesV2({
  mode: "custom",
  sourceNetwork: "base",
  assetLocator: ADDRESS,
})[0];
if (!identity) throw new Error("expected identity");

beforeAll(() => {
  Object.assign(provenance.snapshot, {
    number: 9_100_020n,
    hash: `0x${"24".repeat(32)}`,
    parentHash: `0x${"25".repeat(32)}`,
    timestamp: 1_788_000_000n,
  });
  const baseMarket = {
    economicKey: `0x${"21".repeat(32)}`,
    marketId: `0x${"22".repeat(32)}`,
    assetKey: predictionOnchainAssetKeyV2(identity),
    registryRevision: 7n,
    registrySnapshotHash: `0x${"23".repeat(32)}`,
    resolutionPolicyHash: `0x${"28".repeat(32)}`,
    policyValidUntil: 1_788_350_400n,
    snapshotAssetCap: 1_000_000_000n,
    vault: getAddress(`0x${"13".repeat(20)}`),
    checkpoint: getAddress(`0x${"14".repeat(20)}`),
    yesToken: getAddress(`0x${"15".repeat(20)}`),
    noToken: getAddress(`0x${"16".repeat(20)}`),
    poolId: `0x${"27".repeat(32)}`,
    poolKey: {
      currency0: getAddress(`0x${"15".repeat(20)}`),
      currency1: getAddress(`0x${"16".repeat(20)}`),
      fee: 200,
      tickSpacing: 10,
      hooks: getAddress(`0x${"17".repeat(20)}`),
    },
    asset: { identity, displaySymbol: "EXAMPLE" },
    predicate: {
      comparator: "greater-than-or-equal",
      threshold: 1_500_000n,
      observationTime: 1_788_264_000n,
      priceDecimals: 8,
    },
    lifecycle: {
      protocolState: "OPEN",
      checkpointStatus: "AWAITING",
      tradingPhase: "OPEN",
      tradable: true,
      tradabilityReason: "tradable",
      checkpointTradingHealthy: true,
      resolvedPrice: 0n,
    },
    deadlines: {
      cutoff: 1_788_263_940n,
      resolutionDeadline: 1_788_357_600n,
      hardResolutionDeadline: 1_788_868_800n,
      fallbackRequestedAt: 0n,
      fallbackChallengeDeadline: 0n,
    },
    poolState: {
      sqrtPriceX96: 79_228_162_514_264_337_593_543_950_336n,
      tick: 0,
      poolManagerProtocolFee: 0,
      lpFee: 200,
      yesProbabilityBps: 5_000,
    },
    accountedLiability: 2_000_000n,
  };
  Object.assign(provenance.market, baseMarket);
  Object.assign(provenance.invalidIdentityMarket, {
    ...baseMarket,
    assetKey: `0x${"ff".repeat(32)}`,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

function input(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    release: provenance.releaseA as PredictionV2EnabledPublicReleaseV2,
    snapshot: provenance.snapshot as PredictionV2SafeBlock,
    market: provenance.market as PredictionV2ReadMarket,
    ...overrides,
  };
}

describe("Prediction V2 release-bound base market view", () => {
  it("keeps a provenance-bound onchain market visible without an attestor", () => {
    const view = buildPredictionV2BaseMarketView(input());

    expect(view).toMatchObject({
      source: "onchain-rpc",
      marketKey:
        `eip155:4663:${FACTORY.toLowerCase()}:0x${"21".repeat(32)}`,
      marketId: `0x${"22".repeat(32)}`,
      asset: {
        kind: "token",
        sourceNetwork: "base",
        address: ADDRESS.toLowerCase(),
        name: null,
        symbol: "EXAMPLE",
      },
      condition: {
        strikeAtoms: "1500000",
        oracleSnapshotRule: {
          winningPrice: "latest-completed-round-at-or-before-observation",
          maximumBeforeAgeSeconds: "90000",
        },
      },
      onchain: {
        releaseId: "prediction-v2.release-1",
        registryRevision: "7",
        confirmedBlockNumber: "9100020",
      },
    });
    expect(view.links).toEqual([]);
    expect(view.artwork.url).toMatch(/^\/brand\/programmable-token-fallback-/u);
    expect(provenance.assertMarket).toHaveBeenCalledWith(
      provenance.market,
      provenance.snapshot,
      provenance.bindingA,
    );
  });

  it("rejects unsigned releases, market clones and foreign snapshots", () => {
    expect(() => buildPredictionV2BaseMarketView(input({
      release: { ...provenance.releaseA },
    }) as never)).toThrow("release lacks verified provenance");
    expect(() => buildPredictionV2BaseMarketView(input({
      market: { ...provenance.market },
    }) as never)).toThrow("market provenance mismatch");
    expect(() => buildPredictionV2BaseMarketView(input({
      snapshot: { ...provenance.snapshot },
    }) as never)).toThrow("market provenance mismatch");
  });

  it("rejects a Release A market under Release B read binding", () => {
    expect(() => buildPredictionV2BaseMarketView(input({
      release: provenance.releaseB,
    }) as never)).toThrow("market provenance mismatch");
    expect(provenance.assertMarket).toHaveBeenCalledWith(
      provenance.market,
      provenance.snapshot,
      provenance.bindingB,
    );
  });

  it("rejects a provenance-bound market with mismatched asset identity", () => {
    expect(() => buildPredictionV2BaseMarketView(input({
      market: provenance.invalidIdentityMarket,
    }) as never)).toThrow(/identity is not canonical/u);
  });
});
