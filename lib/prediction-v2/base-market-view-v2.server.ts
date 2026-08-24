import "server-only";

import {
  bytesToHex,
  getAddress,
  hexToBytes,
  stringToHex,
} from "viem";

import {
  PREDICTION_PRESET_ASSETS_V2,
  PREDICTION_SOLANA_MAINNET_GENESIS_V2,
  predictionOnchainAssetKeyV2,
  type PredictionBytes32V2,
} from "../prediction-market-assets-v2";
import type {
  PredictionV2BaseAssetView,
  PredictionV2BaseMarketView,
} from "./base-market-view-v2";
import { predictionAssetFallbackImageV2 } from "./asset-logo-v2";
import { assertCanonicalPredictionV2Identity } from "./codec";
import {
  assertPredictionV2VerifiedEnabledPublicReleaseV2,
  toPredictionV2PublicMarketCanonicalReleaseV2,
  toPredictionV2ReadBindingFromPublicReleaseV2,
  type PredictionV2EnabledPublicReleaseV2,
} from "./public-release-v2.server";
import {
  assertPredictionV2ReadMarketAtSnapshotProvenance,
  type PredictionV2ReadMarket,
  type PredictionV2SafeBlock,
} from "./read-model-v2.server";

const PRICE_DECIMALS = 8 as const;
const MAX_CHAINLINK_BRACKET_SECONDS = 25n * 60n * 60n;
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const GLOBAL_NAMESPACE = stringToHex("GLOBAL_CRYPTO", { size: 32 });
const EIP155_NAMESPACE = stringToHex("EIP155", { size: 32 });
const SOLANA_NAMESPACE = stringToHex("SOLANA", { size: 32 });
const UINT_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/u;

const EVM_SOURCE_CHAINS = Object.freeze({
  1: Object.freeze({
    id: "ethereum",
    label: "Ethereum",
    explorerOrigin: "https://etherscan.io",
  }),
  56: Object.freeze({
    id: "bnb",
    label: "BNB Chain",
    explorerOrigin: "https://bscscan.com",
  }),
  4663: Object.freeze({
    id: "robinhood",
    label: "Robinhood Chain",
    explorerOrigin: "https://robinhoodchain.blockscout.com",
  }),
  8453: Object.freeze({
    id: "base",
    label: "Base",
    explorerOrigin: "https://basescan.org",
  }),
} as const);

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * The sole constructor for a base market DTO. The exact signed release graph,
 * read-model market object and leased snapshot must all share runtime
 * provenance; structural release roots and serialized market rows are refused.
 */
export function buildPredictionV2BaseMarketView(input: Readonly<{
  release: PredictionV2EnabledPublicReleaseV2;
  snapshot: PredictionV2SafeBlock;
  market: PredictionV2ReadMarket;
}>): PredictionV2BaseMarketView {
  assertPredictionV2VerifiedEnabledPublicReleaseV2(input.release);
  const binding = toPredictionV2ReadBindingFromPublicReleaseV2(input.release);
  assertPredictionV2ReadMarketAtSnapshotProvenance(
    input.market,
    input.snapshot,
    binding,
  );
  const canonicalRelease = toPredictionV2PublicMarketCanonicalReleaseV2(
    input.release,
  );
  if (!RELEASE_ID_PATTERN.test(canonicalRelease.releaseId)) {
    throw new TypeError("Prediction V2 release root is invalid");
  }
  const factoryAddress = canonicalAddress(canonicalRelease.factoryAddress);
  const factoryRuntimeCodeHash = bytes32(
    canonicalRelease.factoryRuntimeCodeHash,
    "factoryRuntimeCodeHash",
  );
  const snapshot = normalizeSnapshot(input.snapshot);
  const market = input.market;
  const identity = assertCanonicalPredictionV2Identity(market.asset.identity);
  if (predictionOnchainAssetKeyV2(identity) !== market.assetKey) {
    throw new TypeError("Prediction V2 market asset identity is not canonical");
  }
  const asset = baseAsset(identity, market.asset.displaySymbol);
  const marketId = bytes32(market.marketId, "marketId");
  const economicKey = bytes32(market.economicKey, "economicKey");
  const observationTime = unsigned(
    market.predicate.observationTime,
    "observationTime",
  );
  const threshold = unsigned(market.predicate.threshold, "threshold");
  if (
    market.predicate.comparator !== "greater-than-or-equal" ||
    market.predicate.priceDecimals !== PRICE_DECIMALS
  ) {
    throw new TypeError("Prediction V2 market predicate is unsupported");
  }

  const marketKey =
    `eip155:4663:${factoryAddress}:${economicKey}` as const;
  return Object.freeze({
    schemaVersion: 2 as const,
    source: "dual-rpc-onchain" as const,
    marketKey,
    marketId,
    economicKey,
    asset,
    condition: Object.freeze({
      kind: "usd-price-at-utc" as const,
      metric: "usd-price" as const,
      comparator: "greater-than-or-equal" as const,
      quoteCurrency: "USD" as const,
      strikeAtoms: threshold.toString(),
      priceDecimals: PRICE_DECIMALS,
      observationUnixSeconds: observationTime.toString(),
      observationUtc: unixSecondsToUtc(observationTime),
      oracleSnapshotRule: Object.freeze({
        source: "chainlink-data-feed" as const,
        winningPrice: "latest-completed-round-at-or-before-observation" as const,
        requiredAfterRound: "first-completed-round-after-observation" as const,
        maximumBeforeAgeSeconds: MAX_CHAINLINK_BRACKET_SECONDS.toString(),
        maximumAfterDelaySeconds: MAX_CHAINLINK_BRACKET_SECONDS.toString(),
      }),
    }),
    lifecycle: market.lifecycle,
    poolState: market.poolState,
    artwork: Object.freeze({
      kind: "bundled-fallback" as const,
      url: predictionAssetFallbackImageV2(
        asset.sourceNetwork,
        asset.address ?? asset.presetId,
      ),
    }),
    links: Object.freeze([]) as readonly [],
    onchain: Object.freeze({
      releaseId: canonicalRelease.releaseId,
      settlementChainId: 4_663 as const,
      factoryAddress,
      factoryRuntimeCodeHash,
      assetKey: bytes32(market.assetKey, "assetKey"),
      registryRevision: unsigned(
        market.registryRevision,
        "registryRevision",
      ).toString(),
      registrySnapshotHash: bytes32(
        market.registrySnapshotHash,
        "registrySnapshotHash",
      ),
      resolutionPolicyHash: bytes32(
        market.resolutionPolicyHash,
        "resolutionPolicyHash",
      ),
      vaultAddress: canonicalAddress(market.vault),
      checkpointAddress: canonicalAddress(market.checkpoint),
      poolId: bytes32(market.poolId, "poolId"),
      confirmedBlockNumber: snapshot.number.toString(),
      confirmedBlockHash: snapshot.hash,
    }),
  });
}

function normalizeSnapshot(value: PredictionV2SafeBlock): PredictionV2SafeBlock {
  const number = unsigned(value.number, "confirmed block number");
  const timestamp = unsigned(value.timestamp, "confirmed block timestamp");
  const hash = bytes32(value.hash, "confirmed block hash");
  const parentHash = bytes32(value.parentHash, "confirmed parent hash");
  if (hash === ZERO_BYTES32 || parentHash === ZERO_BYTES32) {
    throw new TypeError("Prediction V2 confirmed block is invalid");
  }
  return Object.freeze({ number, timestamp, hash, parentHash });
}

function baseAsset(
  identityValue: ReturnType<typeof assertCanonicalPredictionV2Identity>,
  displaySymbol: string,
): PredictionV2BaseAssetView {
  if (!/^[A-Z0-9._-]{1,16}$/u.test(displaySymbol)) {
    throw new TypeError("Prediction V2 display symbol is invalid");
  }
  if (identityValue.sourceNamespace === GLOBAL_NAMESPACE) {
    const preset = PREDICTION_PRESET_ASSETS_V2.find((candidate) =>
      candidate.identity.sourceChain === identityValue.sourceChain &&
      candidate.identity.assetIdentifier === identityValue.assetIdentifier &&
      candidate.identity.assetStandard === identityValue.assetStandard
    );
    if (!preset || preset.symbol !== displaySymbol) {
      throw new TypeError("Prediction V2 preset identity is invalid");
    }
    return Object.freeze({
      kind: "preset" as const,
      presetId: preset.id,
      sourceNetwork: "global" as const,
      chainLabel: "Global crypto asset" as const,
      address: null,
      explorerUrl: null,
      name: preset.name,
      symbol: preset.symbol,
    });
  }
  if (identityValue.sourceNamespace === EIP155_NAMESPACE) {
    const chainId = Number(BigInt(identityValue.sourceChain));
    const chain = EVM_SOURCE_CHAINS[chainId as keyof typeof EVM_SOURCE_CHAINS];
    if (!chain) throw new TypeError("Prediction V2 source chain is invalid");
    const address = canonicalAddress(
      `0x${identityValue.assetIdentifier.slice(-40)}`,
    );
    return Object.freeze({
      kind: "token" as const,
      presetId: null,
      sourceNetwork: chain.id,
      chainLabel: chain.label,
      address,
      explorerUrl: `${chain.explorerOrigin}/token/${address}`,
      name: null,
      symbol: displaySymbol,
    });
  }
  if (
    identityValue.sourceNamespace === SOLANA_NAMESPACE &&
    identityValue.sourceChain === PREDICTION_SOLANA_MAINNET_GENESIS_V2
  ) {
    const address = base58Encode(hexToBytes(identityValue.assetIdentifier));
    return Object.freeze({
      kind: "token" as const,
      presetId: null,
      sourceNetwork: "solana" as const,
      chainLabel: "Solana",
      address,
      explorerUrl: `https://solscan.io/token/${address}`,
      name: null,
      symbol: displaySymbol,
    });
  }
  throw new TypeError("Prediction V2 asset identity is unsupported");
}

function base58Encode(bytes: Uint8Array): string {
  let value = BigInt(bytesToHex(bytes));
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = `${BASE58_ALPHABET[remainder]}${encoded}`;
    value /= 58n;
  }
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) {
    leadingZeroes += 1;
  }
  return `${"1".repeat(leadingZeroes)}${encoded || (leadingZeroes ? "" : "1")}`;
}

function unixSecondsToUtc(value: bigint): string {
  if (value > 8_640_000_000_000n) {
    throw new TypeError("Prediction V2 observation time is outside Date range");
  }
  const date = new Date(Number(value * 1_000n));
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("Prediction V2 observation time is invalid");
  }
  return date.toISOString();
}

function unsigned(value: unknown, label: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "string" && UINT_PATTERN.test(value)) return BigInt(value);
  throw new TypeError(`Prediction V2 ${label} is invalid`);
}

function bytes32(value: unknown, label: string): PredictionBytes32V2 {
  if (typeof value !== "string") {
    throw new TypeError(`Prediction V2 ${label} is invalid`);
  }
  const canonical = value.toLowerCase();
  if (!BYTES32_PATTERN.test(canonical) || canonical === ZERO_BYTES32) {
    throw new TypeError(`Prediction V2 ${label} is invalid`);
  }
  return canonical as PredictionBytes32V2;
}

function canonicalAddress(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Prediction V2 address is invalid");
  }
  const address = getAddress(value).toLowerCase();
  if (address === `0x${"00".repeat(20)}`) {
    throw new TypeError("Prediction V2 address is invalid");
  }
  return address;
}
