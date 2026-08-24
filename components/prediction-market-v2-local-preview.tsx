"use client";

import { ArrowLeft } from "lucide-react";

import styles from "@/components/prediction-market-create-flow-v2.module.css";
import {
  PredictionMarketCreateFlowV2,
  type PredictionMarketCreateFlowV2Discovery,
} from "@/components/prediction-market-create-flow-v2";
import {
  parsePredictionAssetAutoDiscoveryV2,
  type PredictionAssetAutoDiscoveryClientResultV2,
} from "@/lib/prediction-v2/asset-auto-discovery-v2";
import type { PredictionAssetMarketCapSupplyEvidenceV2 } from "@/lib/prediction-v2/asset-eligibility-v2";
import type {
  PredictionV2CreationReferenceSnapshot,
  PredictionV2ReferenceMetricSnapshot,
  PredictionV2ReferenceSupplySnapshot,
} from "@/lib/prediction-v2/create-flow-v2";

const LOCAL_PREVIEW_BUNDLE_SENTINEL =
  "programmable-prediction-v2-local-preview-v1";
const OBSERVED_AT = "2026-08-23T18:00:00.000Z";
const CAPTURED_AT = "2026-08-23T18:00:00Z";
const RESULT_AT = "2026-08-30T18:00:00Z";
const EVIDENCE_DIGEST = `0x${"12".repeat(32)}`;
const BASE_TOKEN_ADDRESS = `0x${"ab".repeat(20)}`;
const EVM_PAIR_ADDRESS = `0x${"cd".repeat(20)}`;
const SOLANA_FIXTURE_LOCATOR =
  "4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw";
const SOLANA_PAIR_ADDRESS = "JEJUoGfGEPTZ1XTwN39dYdFxYxDiDaSKVNy5qYWJmZt3";

export type PredictionV2LocalPreviewState =
  | "address"
  | "asset"
  | "prediction"
  | "review"
  | "ambiguous"
  | "error";

export type PredictionV2LocalPreviewFixture = "base" | "solana";

type FixtureDefinition = Readonly<{
  locator: string;
  selectionKey: string;
  sourceNetwork: "base" | "solana";
  chainReference: "8453" | "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
  providerChainId: "base" | "solana";
  namespace: "evm" | "solana";
  pairAddress: string;
  dexId: "uniswap" | "raydium";
  name: string;
  symbol: string;
  priceUsd: number;
  marketCapUsd: number;
  fdvUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  pairCreatedAt: number;
  fixedSupplyAtoms: string;
  tokenDecimals: number;
  chainPosition: string;
  snapshotReference: string;
  targetMarketCapUsd: string;
  referenceMarketCapUsd: string;
}>;

const FIXTURES = Object.freeze({
  base: Object.freeze({
    locator: BASE_TOKEN_ADDRESS,
    selectionKey: `evm:8453:${BASE_TOKEN_ADDRESS}`,
    sourceNetwork: "base",
    chainReference: "8453",
    providerChainId: "base",
    namespace: "evm",
    pairAddress: EVM_PAIR_ADDRESS,
    dexId: "uniswap",
    name: "Base Test Token",
    symbol: "BTST",
    priceUsd: 0.008,
    marketCapUsd: 8_000_000,
    fdvUsd: 8_000_000,
    liquidityUsd: 420_000,
    volume24hUsd: 180_000,
    pairCreatedAt: Date.parse("2026-08-20T18:00:00.000Z"),
    fixedSupplyAtoms: "1000000000000000000000000000",
    tokenDecimals: 18,
    chainPosition: "34900000",
    snapshotReference: "eip155:8453:block:34900000",
    targetMarketCapUsd: "10000000",
    referenceMarketCapUsd: "8000000",
  }),
  solana: Object.freeze({
    locator: SOLANA_FIXTURE_LOCATOR,
    selectionKey:
      `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:${SOLANA_FIXTURE_LOCATOR}`,
    sourceNetwork: "solana",
    chainReference: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    providerChainId: "solana",
    namespace: "solana",
    pairAddress: SOLANA_PAIR_ADDRESS,
    dexId: "raydium",
    name: "Solana Test Token",
    symbol: "STST",
    priceUsd: 0.25,
    marketCapUsd: 250_000_000,
    fdvUsd: 250_000_000,
    liquidityUsd: 1_250_000,
    volume24hUsd: 830_000,
    pairCreatedAt: Date.parse("2026-08-18T18:00:00.000Z"),
    fixedSupplyAtoms: "1000000000000000",
    tokenDecimals: 6,
    chainPosition: "290000000",
    snapshotReference: "solana:slot:290000000",
    targetMarketCapUsd: "300000000",
    referenceMarketCapUsd: "250000000",
  }),
} as const satisfies Readonly<Record<PredictionV2LocalPreviewFixture, FixtureDefinition>>);

function rawCandidate(fixture: FixtureDefinition) {
  return {
    selectionKey: fixture.selectionKey,
    selection: {
      mode: "custom",
      sourceNetwork: fixture.sourceNetwork,
      assetLocator: fixture.locator,
    },
    namespace: fixture.namespace,
    chainReference: fixture.chainReference,
    providerChainId: fixture.providerChainId,
    provenance: {
      identity: { source: "onchain-rpc" },
      enrichment: { source: "dexscreener" },
    },
    token: {
      address: fixture.locator,
      name: fixture.name,
      symbol: fixture.symbol,
    },
    currentPriceUsd: fixture.priceUsd,
    marketCapUsd: fixture.marketCapUsd,
    fdvUsd: fixture.fdvUsd,
    matchingPairCount: 2,
    pair: {
      dexId: fixture.dexId,
      pairAddress: fixture.pairAddress,
      matchedSide: "base",
      liquidityUsd: fixture.liquidityUsd,
      volume24hUsd: fixture.volume24hUsd,
      pairCreatedAt: fixture.pairCreatedAt,
    },
    links: {
      imageUrl: null,
      websites: [{ label: "Website", url: "https://programmable.market" }],
      socials: [{ type: "twitter", url: "https://x.com/0xprogrammable" }],
    },
  };
}

function rawUniqueResult(fixture: FixtureDefinition) {
  return {
    schemaVersion: 2,
    locator: fixture.locator,
    source: "dexscreener",
    observedAt: OBSERVED_AT,
    usage: "informational-only",
    status: "unique",
    candidate: rawCandidate(fixture),
  };
}

const RAW_RESULTS = Object.freeze({
  base: Object.freeze(rawUniqueResult(FIXTURES.base)),
  solana: Object.freeze(rawUniqueResult(FIXTURES.solana)),
});

const RAW_AMBIGUOUS_RESULT = Object.freeze({
  schemaVersion: 2,
  locator: BASE_TOKEN_ADDRESS,
  source: "dexscreener",
  observedAt: OBSERVED_AT,
  usage: "informational-only",
  status: "ambiguous",
  candidates: [
    {
      ...rawCandidate(FIXTURES.base),
      selectionKey: `evm:1:${BASE_TOKEN_ADDRESS}`,
      selection: {
        mode: "custom",
        sourceNetwork: "ethereum",
        assetLocator: BASE_TOKEN_ADDRESS,
      },
      chainReference: "1",
      providerChainId: "ethereum",
    },
    rawCandidate(FIXTURES.base),
  ],
});

const RAW_INVALID_RESULT = Object.freeze({
  schemaVersion: 2,
  locator: null,
  source: null,
  observedAt: OBSERVED_AT,
  usage: "informational-only",
  status: "invalid",
  reason: "invalid-locator",
});

function parsedFixture(value: unknown, expectedLocator: string) {
  const result = parsePredictionAssetAutoDiscoveryV2(value, expectedLocator);
  if (!result) throw new Error("Invalid Prediction V2 local preview fixture");
  return result;
}

const PARSED_RESULTS = Object.freeze({
  base: parsedFixture(RAW_RESULTS.base, BASE_TOKEN_ADDRESS),
  solana: parsedFixture(RAW_RESULTS.solana, SOLANA_FIXTURE_LOCATOR),
  ambiguous: parsedFixture(RAW_AMBIGUOUS_RESULT, BASE_TOKEN_ADDRESS),
  error: parsedFixture(RAW_INVALID_RESULT, "not-a-token-address"),
});

export function createPredictionV2LocalPreviewDiscovery(
  fixtureName: PredictionV2LocalPreviewFixture,
): PredictionMarketCreateFlowV2Discovery {
  const fixture = FIXTURES[fixtureName];
  return async (locator, signal) => {
    if (signal.aborted) {
      const error = new Error("Local preview lookup aborted");
      error.name = "AbortError";
      throw error;
    }
    return locator.trim() === fixture.locator
      ? RAW_RESULTS[fixtureName]
      : RAW_INVALID_RESULT;
  };
}

function creationSnapshot(): PredictionV2CreationReferenceSnapshot {
  return {
    settlementChainId: "4663",
    capturedAtUtc: CAPTURED_AT,
    snapshotReference: "eip155:4663:block:8000000",
    evidenceDigest: EVIDENCE_DIGEST,
    verificationStatus: "verified",
  };
}

function referenceMetricSnapshot(
  fixture: FixtureDefinition,
): PredictionV2ReferenceMetricSnapshot {
  return {
    metric: "market-cap",
    valueUsd: fixture.referenceMarketCapUsd,
    sourceNetwork: fixture.sourceNetwork,
    address: fixture.locator,
    capturedAtUtc: CAPTURED_AT,
    snapshotReference: fixture.snapshotReference,
    evidenceDigest: EVIDENCE_DIGEST,
    verificationStatus: "verified",
  };
}

function referenceSupplySnapshot(
  fixture: FixtureDefinition,
): PredictionV2ReferenceSupplySnapshot {
  return {
    sourceNetwork: fixture.sourceNetwork,
    address: fixture.locator,
    fixedSupplyAtoms: fixture.fixedSupplyAtoms,
    tokenDecimals: fixture.tokenDecimals,
    capturedAtUtc: CAPTURED_AT,
    snapshotReference: fixture.snapshotReference,
    evidenceDigest: EVIDENCE_DIGEST,
    verificationStatus: "verified",
    supplyDefinition: "fixed-supply-fully-circulating",
  };
}

function marketCapSupplyEvidence(
  fixture: FixtureDefinition,
): PredictionAssetMarketCapSupplyEvidenceV2 {
  return {
    schemaVersion: 2,
    kind: "fixed-supply-fully-circulating",
    chainReference: fixture.chainReference,
    tokenAddress: fixture.locator,
    supplyBaseUnits: fixture.fixedSupplyAtoms,
    decimals: fixture.tokenDecimals,
    immutable: true,
    verification: {
      status: "verified",
      method: "verified-fixed-supply-fully-circulating",
      chainStateReference: fixture.chainPosition,
      evidenceDigest: EVIDENCE_DIGEST,
    },
  };
}

function initialDiscoveryResult(
  state: PredictionV2LocalPreviewState,
  fixtureName: PredictionV2LocalPreviewFixture,
): PredictionAssetAutoDiscoveryClientResultV2 | null {
  if (state === "address") return null;
  if (state === "ambiguous") return PARSED_RESULTS.ambiguous;
  if (state === "error") return PARSED_RESULTS.error;
  return PARSED_RESULTS[fixtureName];
}

export function PredictionMarketV2LocalPreview({
  fixture: fixtureName,
  initialState,
  onBack,
}: Readonly<{
  fixture: PredictionV2LocalPreviewFixture;
  initialState: PredictionV2LocalPreviewState;
  onBack: () => void;
}>) {
  const fixture = FIXTURES[fixtureName];
  const visibleView = initialState === "asset" ||
      initialState === "prediction" || initialState === "review"
    ? initialState
    : "address";

  return (
    <div
      className="launch-page page-width"
      data-local-preview={LOCAL_PREVIEW_BUNDLE_SENTINEL}
      data-prediction-v2-fixture={fixtureName}
      data-prediction-v2-state={initialState}
    >
      <header className="launch-page-heading">
        <button
          className={`launch-model-back ${styles.previewBack}`}
          onClick={onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={15} />
          Back
        </button>
      </header>

      <PredictionMarketCreateFlowV2
        discoverToken={createPredictionV2LocalPreviewDiscovery(fixtureName)}
        initialCreationSnapshot={creationSnapshot()}
        initialDiscoveryResult={initialDiscoveryResult(initialState, fixtureName)}
        initialLocator={
          initialState === "error" ? "not-an-address" :
            initialState === "ambiguous" ? BASE_TOKEN_ADDRESS : fixture.locator
        }
        initialMarketCapSupplyEvidence={marketCapSupplyEvidence(fixture)}
        initialPrediction={{
          metric: "market-cap",
          template: "target",
          targetUsd: fixture.targetMarketCapUsd,
          observationUtc: RESULT_AT,
          priceDecimals: 8,
        }}
        initialReferenceMetricSnapshot={referenceMetricSnapshot(fixture)}
        initialReferenceSupplySelectionKey={fixture.selectionKey}
        initialReferenceSupplySnapshot={referenceSupplySnapshot(fixture)}
        initialView={visibleView}
      />
    </div>
  );
}
