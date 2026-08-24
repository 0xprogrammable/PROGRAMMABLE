import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import {
  predictionAssetIdentityCandidatesV2,
  predictionOnchainAssetKeyV2,
} from "../lib/prediction-market-assets-v2";
import { parsePredictionAssetAutoDiscoveryV2 } from
  "../lib/prediction-v2/asset-auto-discovery-v2";
import {
  PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
  PREDICTION_V2_SETTLEMENT_CHAIN_ID,
  buildPredictionV2CreateReview,
} from "../lib/prediction-v2/create-flow-v2";
import {
  buildPredictionMarketPresentationRecordV2,
  parsePredictionMarketPresentationRecordV2,
  predictionMarketBundledFallbackArtworkV2,
  predictionMarketPresentationRevisionHashV2,
} from "../lib/prediction-v2/market-presentation-v2";
import {
  PREDICTION_MARKET_PROJECTION_ATTESTATION_SCHEME_V2,
  PREDICTION_MARKET_PROJECTION_CONTEXT_KIND_V2,
  parsePredictionMarketAttestedProjectionContextV2,
  predictionMarketProjectionAttestationMessageV2,
  publicPredictionMarketViewV2FromAttestedProjection,
  type PredictionMarketCanonicalReleaseV2,
  type UnsignedPredictionMarketAttestedProjectionContextV2,
} from "../lib/prediction-v2/public-market-view-v2";

const ADDRESS = `0x${"ab".repeat(20)}`;
const PAIR = `0x${"ef".repeat(20)}`;
const FACTORY = `0x${"12".repeat(20)}`;
const FACTORY_RUNTIME_CODE_HASH = `0x${"41".repeat(32)}` as const;
const ATTESTOR = privateKeyToAccount(`0x${"42".repeat(32)}`);
const ATTACKER = privateKeyToAccount(`0x${"43".repeat(32)}`);

const CANONICAL_RELEASE = Object.freeze({
  schemaVersion: 2,
  releaseId: "prediction-v2.release-1",
  settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
  factoryAddress: FACTORY,
  factoryRuntimeCodeHash: FACTORY_RUNTIME_CODE_HASH,
  projectionAttestorAddress: ATTESTOR.address.toLowerCase(),
} as const satisfies PredictionMarketCanonicalReleaseV2);

function record() {
  const observedAt = "2026-08-23T18:00:00.000Z";
  const discovery = parsePredictionAssetAutoDiscoveryV2({
    schemaVersion: 2,
    locator: ADDRESS,
    source: "dexscreener",
    observedAt,
    usage: "informational-only",
    status: "unique",
    candidate: {
      selectionKey: `evm:8453:${ADDRESS}`,
      selection: { mode: "custom", sourceNetwork: "base", assetLocator: ADDRESS },
      namespace: "evm",
      chainReference: "8453",
      providerChainId: "base",
      provenance: {
        identity: { source: "onchain-rpc" },
        enrichment: { source: "dexscreener" },
      },
      token: { address: ADDRESS, name: "Example Coin", symbol: "EXAMPLE" },
      currentPriceUsd: 0.01,
      marketCapUsd: 10_000_000,
      fdvUsd: 10_000_000,
      matchingPairCount: 1,
      pair: {
        dexId: "uniswap",
        pairAddress: PAIR,
        matchedSide: "base",
        liquidityUsd: 100_000,
        volume24hUsd: 50_000,
        pairCreatedAt: Date.parse("2026-08-20T18:00:00.000Z"),
      },
      links: {
        websites: [{ label: "Website", url: "https://token.example.com" }],
        socials: [],
      },
    },
  }, ADDRESS);
  if (!discovery) throw new Error("expected discovery");
  const creationSnapshot = {
    settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
    capturedAtUtc: "2026-08-23T12:00:00Z",
    snapshotReference: "eip155:4663:block:9100000",
    evidenceDigest: `0x${"11".repeat(32)}`,
    verificationStatus: "verified",
  } as const;
  const reviewed = buildPredictionV2CreateReview({
    identity: { sourceNetwork: "base", address: ADDRESS },
    name: "Example Coin",
    symbol: "EXAMPLE",
    referenceSupplySnapshot: null,
  }, {
    metric: "price",
    template: "target",
    targetUsd: "0.015",
    observationUtc: "2026-09-01T12:00:00Z",
    creationSnapshot,
    priceDecimals: PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
  });
  if (!reviewed.ok) throw new Error("expected review");
  const identity = predictionAssetIdentityCandidatesV2({
    mode: "custom",
    sourceNetwork: "base",
    assetLocator: ADDRESS,
  })[0];
  if (!identity) throw new Error("expected identity");
  return buildPredictionMarketPresentationRecordV2({
    discovery,
    candidateSelectionKey: `evm:8453:${ADDRESS}`,
    review: reviewed.review,
    economicBinding: {
      settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
      factoryAddress: FACTORY,
      economicKey: `0x${"21".repeat(32)}`,
      vaultAddress: `0x${"13".repeat(20)}`,
      checkpointAddress: `0x${"14".repeat(20)}`,
      poolId: `0x${"27".repeat(32)}`,
      marketId: `0x${"22".repeat(32)}`,
      assetIdentity: identity,
      onchainAssetKey: predictionOnchainAssetKeyV2(identity),
      registryRevision: "7",
      registrySnapshotHash: `0x${"23".repeat(32)}`,
      resolutionPolicyHash: `0x${"28".repeat(32)}`,
      policyValidUntil: "1788350400",
      snapshotAssetCapAtoms: "1000000000",
      observationUnixSeconds: "1788264000",
      thresholdAtoms: "1500000",
      priceDecimals: 8,
      observedBlockNumber: "9100020",
      observedBlockHash: `0x${"24".repeat(32)}`,
    },
    revision: { sequence: "1", previousPresentationRevisionHash: null },
    artwork: predictionMarketBundledFallbackArtworkV2("base", ADDRESS),
  });
}

function unsignedProjection(
  source: NonNullable<ReturnType<typeof record>>,
): UnsignedPredictionMarketAttestedProjectionContextV2 {
  return {
    schemaVersion: 2,
    contextKind: PREDICTION_MARKET_PROJECTION_CONTEXT_KIND_V2,
    releaseId: CANONICAL_RELEASE.releaseId,
    settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
    factoryAddress: FACTORY,
    factoryRuntimeCodeHash: FACTORY_RUNTIME_CODE_HASH,
    presentationRevisionHash: source.presentationRevisionHash,
    readMarket: {
      marketKey: source.marketKey,
      economicKey: source.onchain.economicKey,
      vaultAddress: source.onchain.vaultAddress,
      checkpointAddress: source.onchain.checkpointAddress,
      poolId: source.onchain.poolId,
      marketId: source.onchain.marketId,
      onchainAssetKey: source.onchain.onchainAssetKey,
      registryRevision: source.onchain.registryRevision,
      registrySnapshotHash: source.onchain.registrySnapshotHash,
      resolutionPolicyHash: source.onchain.resolutionPolicyHash,
      policyValidUntil: source.onchain.policyValidUntil,
      snapshotAssetCapAtoms: source.onchain.snapshotAssetCapAtoms,
      observationUnixSeconds: source.onchain.observationUnixSeconds,
      thresholdAtoms: source.onchain.thresholdAtoms,
      priceDecimals: source.onchain.priceDecimals,
    },
    confirmedBlock: {
      number: source.onchain.observedBlockNumber,
      hash: source.onchain.observedBlockHash,
    },
  };
}

async function signProjection(
  unsigned: UnsignedPredictionMarketAttestedProjectionContextV2,
  signer = ATTESTOR,
) {
  const message = predictionMarketProjectionAttestationMessageV2(unsigned);
  if (!message) throw new Error("expected canonical attestation message");
  return {
    ...unsigned,
    attestation: {
      scheme: PREDICTION_MARKET_PROJECTION_ATTESTATION_SCHEME_V2,
      signerAddress: signer.address.toLowerCase(),
      signature: await signer.signMessage({ message }),
    },
  } as const;
}

describe("Public Prediction V2 market view", () => {
  it("projects a card-safe DTO only from a release-pinned attested read", async () => {
    const source = record();
    if (!source) throw new Error("expected record");
    const context = await signProjection(unsignedProjection(source));
    const view = await publicPredictionMarketViewV2FromAttestedProjection(
      source,
      context,
      CANONICAL_RELEASE,
    );

    expect(view).toMatchObject({
      schemaVersion: 2,
      marketKey: source.marketKey,
      marketId: `0x${"22".repeat(32)}`,
      asset: {
        sourceNetwork: "base",
        name: "Example Coin",
        symbol: "EXAMPLE",
      },
      condition: {
        metric: "usd-price",
        strikeUsd: "0.015",
      },
      presentation: {
        revision: "1",
        revisionHash: source.presentationRevisionHash,
        observedAt: "2026-08-23T18:00:00.000Z",
      },
      attestedProjection: {
        releaseId: CANONICAL_RELEASE.releaseId,
        settlementChainId: "4663",
        factoryAddress: FACTORY,
        factoryRuntimeCodeHash: FACTORY_RUNTIME_CODE_HASH,
        confirmedBlockNumber: "9100020",
        confirmedBlockHash: `0x${"24".repeat(32)}`,
        attestorAddress: ATTESTOR.address.toLowerCase(),
      },
    });
    expect(JSON.stringify(view)).not.toContain("providerChainId");
    expect(JSON.stringify(view)).not.toContain("imageAssetId");
    expect(JSON.stringify(view)).not.toContain("sourceLogoUrl");
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view?.attestedProjection)).toBe(true);
  });

  it("treats a stored record parser as integrity-only", async () => {
    const source = record();
    if (!source) throw new Error("expected record");
    expect(parsePredictionMarketPresentationRecordV2(source)).toEqual(source);
    expect(await publicPredictionMarketViewV2FromAttestedProjection(
      source,
      null,
      CANONICAL_RELEASE,
    )).toBeNull();
    expect(await publicPredictionMarketViewV2FromAttestedProjection(
      source,
      await signProjection(unsignedProjection(source)),
      { ...CANONICAL_RELEASE, status: "enabled" },
    )).toBeNull();
  });

  it("rejects a forged-but-rehashed presentation revision", async () => {
    const source = record();
    if (!source) throw new Error("expected record");
    const context = await signProjection(unsignedProjection(source));
    const { presentationRevisionHash: _oldHash, ...unsigned } = source;
    expect(_oldHash).toBe(source.presentationRevisionHash);
    const forgedUnsigned = {
      ...unsigned,
      asset: { ...source.asset, name: "Forged Coin" },
    };
    const forged = {
      ...forgedUnsigned,
      presentationRevisionHash:
        predictionMarketPresentationRevisionHashV2(forgedUnsigned),
    };
    expect(parsePredictionMarketPresentationRecordV2(forged)).not.toBeNull();
    expect(await publicPredictionMarketViewV2FromAttestedProjection(
      forged,
      context,
      CANONICAL_RELEASE,
    )).toBeNull();

    const forgedContext = await signProjection({
      ...unsignedProjection(source),
      presentationRevisionHash: forged.presentationRevisionHash,
    }, ATTACKER);
    expect(await publicPredictionMarketViewV2FromAttestedProjection(
      forged,
      forgedContext,
      CANONICAL_RELEASE,
    )).toBeNull();
  });

  it("cross-checks the exact Factory read and confirmed block", async () => {
    const source = record();
    if (!source) throw new Error("expected record");
    const wrongBlock = await signProjection({
      ...unsignedProjection(source),
      confirmedBlock: {
        number: "9100021",
        hash: `0x${"25".repeat(32)}`,
      },
    });
    expect(await parsePredictionMarketAttestedProjectionContextV2(
      wrongBlock,
      CANONICAL_RELEASE,
    )).not.toBeNull();
    expect(await publicPredictionMarketViewV2FromAttestedProjection(
      source,
      wrongBlock,
      CANONICAL_RELEASE,
    )).toBeNull();

    const wrongMarket = await signProjection({
      ...unsignedProjection(source),
      readMarket: {
        ...unsignedProjection(source).readMarket,
        marketId: `0x${"26".repeat(32)}`,
      },
    });
    expect(await publicPredictionMarketViewV2FromAttestedProjection(
      source,
      wrongMarket,
      CANONICAL_RELEASE,
    )).toBeNull();

    const wrongFactoryRecord = await signProjection({
      ...unsignedProjection(source),
      readMarket: {
        ...unsignedProjection(source).readMarket,
        vaultAddress: `0x${"15".repeat(20)}`,
        resolutionPolicyHash: `0x${"29".repeat(32)}`,
      },
    });
    expect(await publicPredictionMarketViewV2FromAttestedProjection(
      source,
      wrongFactoryRecord,
      CANONICAL_RELEASE,
    )).toBeNull();
  });

  it("rejects a valid signature outside the pinned release or factory", async () => {
    const source = record();
    if (!source) throw new Error("expected record");
    const context = await signProjection(unsignedProjection(source));
    expect(await publicPredictionMarketViewV2FromAttestedProjection(
      source,
      context,
      {
        ...CANONICAL_RELEASE,
        releaseId: "prediction-v2.release-2",
      },
    )).toBeNull();
    expect(await publicPredictionMarketViewV2FromAttestedProjection(
      source,
      context,
      {
        ...CANONICAL_RELEASE,
        factoryAddress: `0x${"13".repeat(20)}`,
      },
    )).toBeNull();
  });
});
