import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  predictionAssetIdentityCandidatesV2,
  predictionOnchainAssetKeyV2,
} from "../lib/prediction-market-assets-v2";
import {
  parsePredictionAssetAutoDiscoveryV2,
  type PredictionAssetAutoDiscoveryClientResultV2,
} from "../lib/prediction-v2/asset-auto-discovery-v2";
import {
  PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
  PREDICTION_V2_SETTLEMENT_CHAIN_ID,
  buildPredictionV2CreateReview,
  type PredictionV2CreateReview,
} from "../lib/prediction-v2/create-flow-v2";
import {
  buildPredictionMarketPresentationRecordV2,
  parsePredictionMarketPresentationRecordV2,
  predictionMarketBundledFallbackArtworkV2,
  predictionMarketPresentationRevisionHashV2,
  type BuildPredictionMarketPresentationRecordV2Input,
  type PredictionMarketEconomicBindingV2,
  type PredictionMarketOwnedArtworkV2,
} from "../lib/prediction-v2/market-presentation-v2";

const OBSERVED_AT = "2026-08-23T18:00:00.000Z";
const CREATION_UTC = "2026-08-23T12:00:00Z";
const OBSERVATION_UTC = "2026-09-01T12:00:00Z";
const OBSERVATION_UNIX_SECONDS = "1788264000";
const EVM_ADDRESS = `0x${"ab".repeat(20)}`;
const OTHER_EVM_ADDRESS = `0x${"ef".repeat(20)}`;
const FACTORY = `0x${"12".repeat(20)}`;
const VAULT = `0x${"13".repeat(20)}`;
const CHECKPOINT = `0x${"14".repeat(20)}`;
const ECONOMIC_KEY = `0x${"21".repeat(32)}` as const;
const MARKET_ID = `0x${"22".repeat(32)}` as const;
const SNAPSHOT_HASH = `0x${"23".repeat(32)}` as const;
const BLOCK_HASH = `0x${"24".repeat(32)}` as const;
const POOL_ID = `0x${"27".repeat(32)}` as const;
const RESOLUTION_POLICY_HASH = `0x${"28".repeat(32)}` as const;
const DEXSCREENER_IMAGE_ID = "25".repeat(32);
const OWNED_ARTWORK_DIGEST = "26".repeat(32);

function discovery(input: Readonly<{
  observedAt?: string;
  source?: "dexscreener" | null;
  candidateOverrides?: Record<string, unknown>;
}> = {}): PredictionAssetAutoDiscoveryClientResultV2 {
  const raw = {
    schemaVersion: 2,
    locator: EVM_ADDRESS,
    source: input.source === undefined ? "dexscreener" : input.source,
    observedAt: input.observedAt ?? OBSERVED_AT,
    usage: "informational-only",
    status: "unique",
    candidate: {
      selectionKey: `evm:8453:${EVM_ADDRESS}`,
      selection: {
        mode: "custom",
        sourceNetwork: "base",
        assetLocator: EVM_ADDRESS,
      },
      namespace: "evm",
      chainReference: "8453",
      providerChainId: "base",
      provenance: {
        identity: { source: "onchain-rpc" },
        enrichment: { source: "dexscreener" },
      },
      token: {
        address: EVM_ADDRESS,
        name: "Example Coin",
        symbol: "EXAMPLE",
      },
      currentPriceUsd: 0.0042,
      marketCapUsd: 4_200_000,
      fdvUsd: 5_000_000,
      matchingPairCount: 2,
      pair: {
        dexId: "uniswap",
        pairAddress: OTHER_EVM_ADDRESS,
        matchedSide: "base",
        liquidityUsd: 120_000,
        volume24hUsd: 75_000,
        pairCreatedAt: Date.parse("2026-08-21T18:00:00.000Z"),
      },
      links: {
        imageUrl:
          `https://cdn.dexscreener.com/cms/images/${DEXSCREENER_IMAGE_ID}`,
        websites: [{ label: "Website", url: "https://token.example.com" }],
        socials: [
          { type: "twitter", url: "https://twitter.com/example?s=20" },
          { type: "telegram", url: "https://telegram.me/example?ref=provider" },
        ],
      },
      ...input.candidateOverrides,
    },
  };
  const parsed = parsePredictionAssetAutoDiscoveryV2(raw, EVM_ADDRESS);
  if (!parsed) throw new Error("expected parsed discovery envelope");
  return parsed;
}

function review(metric: "price" | "market-cap" = "price") {
  const creationSnapshot = {
    settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
    capturedAtUtc: CREATION_UTC,
    snapshotReference: "eip155:4663:block:9100000",
    evidenceDigest: `0x${"11".repeat(32)}`,
    verificationStatus: "verified",
  } as const;
  const supplySnapshot = metric === "market-cap"
    ? {
      sourceNetwork: "base" as const,
      address: EVM_ADDRESS,
      fixedSupplyAtoms: "1000000000000000000000000000",
      tokenDecimals: 18,
      capturedAtUtc: CREATION_UTC,
      snapshotReference: "eip155:8453:block:34900000",
      evidenceDigest: `0x${"31".repeat(32)}`,
      verificationStatus: "verified" as const,
      supplyDefinition: "fixed-supply-fully-circulating" as const,
    }
    : null;
  const result = buildPredictionV2CreateReview({
    identity: { sourceNetwork: "base", address: EVM_ADDRESS },
    name: "Example Coin",
    symbol: "EXAMPLE",
    referenceSupplySnapshot: supplySnapshot,
  }, {
    metric,
    template: "target",
    targetUsd: metric === "price" ? "0.015" : "10000000",
    observationUtc: OBSERVATION_UTC,
    creationSnapshot,
    priceDecimals: PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
  });
  if (!result.ok) throw new Error("expected valid create review");
  return result.review;
}

function percentageMarketCapReview() {
  const creationSnapshot = {
    settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
    capturedAtUtc: CREATION_UTC,
    snapshotReference: "eip155:4663:block:9100000",
    evidenceDigest: `0x${"11".repeat(32)}`,
    verificationStatus: "verified",
  } as const;
  const supplySnapshot = {
    sourceNetwork: "base" as const,
    address: EVM_ADDRESS,
    fixedSupplyAtoms: "1000000000000000000000000000",
    tokenDecimals: 18,
    capturedAtUtc: CREATION_UTC,
    snapshotReference: "eip155:8453:block:34900000",
    evidenceDigest: `0x${"31".repeat(32)}`,
    verificationStatus: "verified" as const,
    supplyDefinition: "fixed-supply-fully-circulating" as const,
  };
  const result = buildPredictionV2CreateReview({
    identity: { sourceNetwork: "base", address: EVM_ADDRESS },
    name: "Example Coin",
    symbol: "EXAMPLE",
    referenceSupplySnapshot: supplySnapshot,
  }, {
    metric: "market-cap",
    template: "percent-change",
    percentChange: "25",
    referenceMetricSnapshot: {
      metric: "market-cap",
      valueUsd: "10000000",
      sourceNetwork: "base",
      address: EVM_ADDRESS,
      capturedAtUtc: CREATION_UTC,
      snapshotReference: "eip155:8453:block:34900000",
      evidenceDigest: `0x${"32".repeat(32)}`,
      verificationStatus: "verified",
    },
    observationUtc: OBSERVATION_UTC,
    creationSnapshot,
    priceDecimals: PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
  });
  if (!result.ok) throw new Error("expected valid percentage review");
  return result.review;
}

function economicBinding(
  createReview: PredictionV2CreateReview,
  overrides: Partial<PredictionMarketEconomicBindingV2> = {},
): PredictionMarketEconomicBindingV2 {
  const identity = predictionAssetIdentityCandidatesV2({
    mode: "custom",
    sourceNetwork: "base",
    assetLocator: EVM_ADDRESS,
  })[0];
  if (!identity) throw new Error("expected Base identity");
  return {
    settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
    factoryAddress: FACTORY,
    economicKey: ECONOMIC_KEY,
    vaultAddress: VAULT,
    checkpointAddress: CHECKPOINT,
    poolId: POOL_ID,
    marketId: MARKET_ID,
    assetIdentity: identity,
    onchainAssetKey: predictionOnchainAssetKeyV2(identity),
    registryRevision: "7",
    registrySnapshotHash: SNAPSHOT_HASH,
    resolutionPolicyHash: RESOLUTION_POLICY_HASH,
    policyValidUntil: "1788350400",
    snapshotAssetCapAtoms: "1000000000",
    observationUnixSeconds: OBSERVATION_UNIX_SECONDS,
    thresholdAtoms: createReview.protocolPredicate.strikeAtoms,
    priceDecimals: 8,
    observedBlockNumber: "9100020",
    observedBlockHash: BLOCK_HASH,
    ...overrides,
  };
}

function recordInput(input: Readonly<{
  discovery?: PredictionAssetAutoDiscoveryClientResultV2;
  review?: PredictionV2CreateReview;
  economicOverrides?: Partial<PredictionMarketEconomicBindingV2>;
  artwork?: PredictionMarketOwnedArtworkV2;
  sequence?: string;
  previousHash?: `sha256:${string}` | null;
}> = {}): BuildPredictionMarketPresentationRecordV2Input {
  const createReview = input.review ?? review();
  return {
    discovery: input.discovery ?? discovery(),
    candidateSelectionKey: `evm:8453:${EVM_ADDRESS}`,
    review: createReview,
    economicBinding: economicBinding(createReview, input.economicOverrides),
    revision: {
      sequence: input.sequence ?? "1",
      previousPresentationRevisionHash: input.previousHash ?? null,
    },
    artwork: input.artwork ?? predictionMarketBundledFallbackArtworkV2(
      "base",
      EVM_ADDRESS,
    ),
  };
}

describe("Prediction V2 append-only presentation record", () => {
  it("binds a stable market key only to canonical onchain economic identity", () => {
    const record = buildPredictionMarketPresentationRecordV2(recordInput());

    expect(record).toMatchObject({
      schemaVersion: 2,
      recordKind: "prediction-market-presentation",
      storageModel: "append-only-revision",
      revision: {
        sequence: "1",
        previousPresentationRevisionHash: null,
      },
      marketKey: `eip155:4663:${FACTORY}:${ECONOMIC_KEY}`,
      onchain: {
        economicKey: ECONOMIC_KEY,
        vaultAddress: VAULT,
        checkpointAddress: CHECKPOINT,
        poolId: POOL_ID,
        marketId: MARKET_ID,
        resolutionPolicyHash: RESOLUTION_POLICY_HASH,
        policyValidUntil: "1788350400",
        snapshotAssetCapAtoms: "1000000000",
        observationUnixSeconds: OBSERVATION_UNIX_SECONDS,
        thresholdAtoms: "1500000",
      },
      asset: {
        selectionKey: `evm:8453:${EVM_ADDRESS}`,
        sourceNetwork: "base",
        address: EVM_ADDRESS,
        name: "Example Coin",
        symbol: "EXAMPLE",
      },
      condition: {
        kind: "usd-price-at-utc",
        metric: "usd-price",
        comparator: "greater-than-or-equal",
        strikeUsd: "0.015",
        strikeAtoms: "1500000",
        observationUtc: OBSERVATION_UTC,
      },
      provider: {
        id: "dexscreener",
        observedAt: OBSERVED_AT,
        imageAssetId: DEXSCREENER_IMAGE_ID,
      },
      display: {
        usage: "display-only",
        artwork: { kind: "bundled-fallback" },
      },
      presentationRevisionHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    expect(record?.creationIntent).toBeNull();
    expect(parsePredictionMarketPresentationRecordV2(record)).toEqual(record);
    expect(JSON.stringify(record)).not.toContain("sourceLogoUrl");
    expect(JSON.stringify(record)).not.toContain("currentPriceUsd");
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("changes the revision hash, but not marketKey, when display provenance changes", () => {
    const first = buildPredictionMarketPresentationRecordV2(recordInput());
    const second = buildPredictionMarketPresentationRecordV2(recordInput({
      discovery: discovery({ observedAt: "2026-08-23T18:05:00.000Z" }),
    }));

    expect(first?.marketKey).toBe(second?.marketKey);
    expect(first?.presentationRevisionHash).not.toBe(
      second?.presentationRevisionHash,
    );
  });

  it("ignores provider economics in both marketKey and presentation revision", () => {
    const first = buildPredictionMarketPresentationRecordV2(recordInput());
    const changed = buildPredictionMarketPresentationRecordV2(recordInput({
      discovery: discovery({
        candidateOverrides: {
          currentPriceUsd: 999_999,
          marketCapUsd: null,
          fdvUsd: 1,
        },
      }),
    }));

    expect(changed).toEqual(first);
  });

  it("takes observedAt only from the candidate's parsed discovery envelope", () => {
    const input = recordInput();
    expect(input).not.toHaveProperty("observedAt");
    expect(buildPredictionMarketPresentationRecordV2({
      ...input,
      candidateSelectionKey: `evm:1:${EVM_ADDRESS}`,
    })).toBeNull();
    expect(buildPredictionMarketPresentationRecordV2({
      ...input,
      discovery: {
        ...input.discovery,
        observedAt: "2026-08-23T18:00:00Z",
      },
    })).toBeNull();
  });

  it("fails closed when economic identity, asset or predicate diverges", () => {
    const validReview = review();
    const wrongIdentity = predictionAssetIdentityCandidatesV2({
      mode: "custom",
      sourceNetwork: "ethereum",
      assetLocator: EVM_ADDRESS,
    })[0];
    if (!wrongIdentity) throw new Error("expected Ethereum identity");

    expect(buildPredictionMarketPresentationRecordV2(recordInput({
      review: validReview,
      economicOverrides: {
        assetIdentity: wrongIdentity,
        onchainAssetKey: predictionOnchainAssetKeyV2(wrongIdentity),
      },
    }))).toBeNull();
    expect(buildPredictionMarketPresentationRecordV2(recordInput({
      economicOverrides: { thresholdAtoms: "1500001" },
    }))).toBeNull();
    expect(buildPredictionMarketPresentationRecordV2(recordInput({
      economicOverrides: { observationUnixSeconds: "1788264001" },
    }))).toBeNull();
    expect(buildPredictionMarketPresentationRecordV2(recordInput({
      economicOverrides: { vaultAddress: `0x${"0".repeat(40)}` },
    }))).toBeNull();
    expect(buildPredictionMarketPresentationRecordV2(recordInput({
      economicOverrides: {
        resolutionPolicyHash: `0x${"0".repeat(64)}`,
      },
    }))).toBeNull();
    expect(buildPredictionMarketPresentationRecordV2(recordInput({
      economicOverrides: { policyValidUntil: "1788263999" },
    }))).toBeNull();
  });

  it("keeps market cap only as an explicit secondary creation intent", () => {
    const marketCapReview = review("market-cap");
    const record = buildPredictionMarketPresentationRecordV2(recordInput({
      review: marketCapReview,
    }));

    expect(record?.condition).toMatchObject({
      metric: "usd-price",
      strikeUsd: "0.01",
      strikeAtoms: "1000000",
    });
    expect(record?.creationIntent).toEqual({
      kind: "market-cap-equivalent",
      settlementRole: "secondary-non-settlement",
      comparator: "greater-than-or-equal",
      targetUsd: "10000000",
      template: "target",
      percentChange: null,
      equivalentPriceStrikeUsd: "0.01",
      evidence: {
        creationSnapshot: marketCapReview.creationSnapshot,
        referenceSupplySnapshot: marketCapReview.referenceSupplySnapshot,
        referenceMetricSnapshot: null,
      },
    });
  });

  it("recomputes a percent market-cap intent from immutable baseline and supply evidence", () => {
    const marketCapReview = percentageMarketCapReview();
    const record = buildPredictionMarketPresentationRecordV2(recordInput({
      review: marketCapReview,
    }));

    expect(record?.condition).toMatchObject({
      metric: "usd-price",
      strikeUsd: "0.0125",
      strikeAtoms: "1250000",
    });
    expect(record?.creationIntent).toMatchObject({
      targetUsd: "12500000",
      template: "percent-change",
      percentChange: "25",
      equivalentPriceStrikeUsd: "0.0125",
      evidence: {
        referenceMetricSnapshot: {
          metric: "market-cap",
          valueUsd: "10000000",
          snapshotReference: "eip155:8453:block:34900000",
          evidenceDigest: `0x${"32".repeat(32)}`,
        },
        referenceSupplySnapshot: {
          snapshotReference: "eip155:8453:block:34900000",
          evidenceDigest: `0x${"31".repeat(32)}`,
        },
      },
    });
    expect(parsePredictionMarketPresentationRecordV2(record)).toEqual(record);
  });

  it("accepts only owned content-addressed artwork or exact bundled bytes", () => {
    const ownedArtwork = {
      kind: "owned-provider-snapshot",
      url: `/media/prediction/sha256-${OWNED_ARTWORK_DIGEST}.webp`,
      digest: `sha256:${OWNED_ARTWORK_DIGEST}`,
      contentType: "image/webp",
      sourceAssetId: DEXSCREENER_IMAGE_ID,
    } as const satisfies PredictionMarketOwnedArtworkV2;
    expect(buildPredictionMarketPresentationRecordV2(recordInput({
      artwork: ownedArtwork,
    }))?.display.artwork).toEqual(ownedArtwork);

    for (const artwork of [
      { ...ownedArtwork, url: `/api/prediction/asset-logo/${DEXSCREENER_IMAGE_ID}` },
      { ...ownedArtwork, digest: `sha256:${"27".repeat(32)}` },
      { ...ownedArtwork, sourceAssetId: "28".repeat(32) },
    ] as PredictionMarketOwnedArtworkV2[]) {
      expect(buildPredictionMarketPresentationRecordV2(recordInput({
        artwork,
      }))).toBeNull();
    }
  });

  it("binds every bundled fallback digest to the checked-in artwork bytes", async () => {
    const artworks = new Map<string, PredictionMarketOwnedArtworkV2>();
    for (let index = 1; index <= 256 && artworks.size < 6; index += 1) {
      const address = `0x${index.toString(16).padStart(40, "0")}`;
      const artwork = predictionMarketBundledFallbackArtworkV2("base", address);
      artworks.set(artwork.url, artwork);
    }
    expect(artworks.size).toBe(6);
    for (const artwork of artworks.values()) {
      const bytes = await readFile(path.join(
        process.cwd(),
        "public",
        artwork.url.slice(1),
      ));
      expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`)
        .toBe(artwork.digest);
    }
  });

  it("enforces append-only revision linkage shape without pretending to persist it", () => {
    const priorHash = `sha256:${"29".repeat(32)}` as const;
    expect(buildPredictionMarketPresentationRecordV2(recordInput({
      sequence: "2",
      previousHash: priorHash,
    }))?.revision).toEqual({
      sequence: "2",
      previousPresentationRevisionHash: priorHash,
    });
    expect(buildPredictionMarketPresentationRecordV2(recordInput({
      sequence: "2",
    }))).toBeNull();
    expect(buildPredictionMarketPresentationRecordV2(recordInput({
      previousHash: priorHash,
    }))).toBeNull();
  });

  it("rejects a mutated persisted record whose revision hash no longer matches", () => {
    const record = buildPredictionMarketPresentationRecordV2(recordInput());
    if (!record) throw new Error("expected presentation record");
    expect(parsePredictionMarketPresentationRecordV2({
      ...record,
      asset: { ...record.asset, name: "Forged Coin" },
    })).toBeNull();
    expect(parsePredictionMarketPresentationRecordV2({
      ...record,
      marketKey: record.marketKey.replace(ECONOMIC_KEY, MARKET_ID),
    })).toBeNull();
  });

  it("fails closed on identity-only discovery without inventing display identity", () => {
    const record = buildPredictionMarketPresentationRecordV2(recordInput({
      discovery: discovery({
        source: null,
        candidateOverrides: {
          provenance: {
            identity: { source: "onchain-rpc" },
            enrichment: null,
          },
          token: {
            address: EVM_ADDRESS,
            name: null,
            symbol: null,
          },
          currentPriceUsd: null,
          marketCapUsd: null,
          fdvUsd: null,
          matchingPairCount: 0,
          pair: null,
          links: {
            imageUrl: null,
            websites: [],
            socials: [],
          },
        },
      }),
    }));
    expect(record).toBeNull();
  });

  it("rejects rehashed market-cap intent mutations that evidence cannot reproduce", () => {
    const source = buildPredictionMarketPresentationRecordV2(recordInput({
      review: review("market-cap"),
    }));
    if (!source?.creationIntent) throw new Error("expected market-cap intent");
    const { presentationRevisionHash: _priorHash, ...unsigned } = source;
    expect(_priorHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const changedTarget = {
      ...unsigned,
      creationIntent: {
        ...source.creationIntent,
        targetUsd: "20000000",
      },
    };
    expect(parsePredictionMarketPresentationRecordV2({
      ...changedTarget,
      presentationRevisionHash:
        predictionMarketPresentationRevisionHashV2(changedTarget),
    })).toBeNull();

    const changedSupply = {
      ...unsigned,
      creationIntent: {
        ...source.creationIntent,
        evidence: {
          ...source.creationIntent.evidence,
          referenceSupplySnapshot: {
            ...source.creationIntent.evidence.referenceSupplySnapshot,
            fixedSupplyAtoms: "2000000000000000000000000000",
          },
        },
      },
    };
    expect(parsePredictionMarketPresentationRecordV2({
      ...changedSupply,
      presentationRevisionHash:
        predictionMarketPresentationRevisionHashV2(changedSupply),
    })).toBeNull();

    const percentSource = buildPredictionMarketPresentationRecordV2(recordInput({
      review: percentageMarketCapReview(),
    }));
    if (!percentSource?.creationIntent) {
      throw new Error("expected percentage market-cap intent");
    }
    const { presentationRevisionHash: _percentHash, ...percentUnsigned } =
      percentSource;
    expect(_percentHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const changedPercent = {
      ...percentUnsigned,
      creationIntent: {
        ...percentSource.creationIntent,
        percentChange: "50",
      },
    };
    expect(parsePredictionMarketPresentationRecordV2({
      ...changedPercent,
      presentationRevisionHash:
        predictionMarketPresentationRevisionHashV2(changedPercent),
    })).toBeNull();
  });
});
