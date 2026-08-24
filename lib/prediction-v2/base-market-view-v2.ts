import type { PredictionBytes32V2 } from "../prediction-market-assets-v2";
import type { PredictionV2ReadMarket } from "./read-model-v2.server";

export type PredictionV2BaseAssetView =
  | Readonly<{
    kind: "preset";
    presetId: "btc" | "eth" | "sol" | "bnb";
    sourceNetwork: "global";
    chainLabel: "Global crypto asset";
    address: null;
    explorerUrl: null;
    name: string;
    symbol: string;
  }>
  | Readonly<{
    kind: "token";
    presetId: null;
    sourceNetwork: "ethereum" | "base" | "bnb" | "robinhood" | "solana";
    chainLabel: string;
    address: string;
    explorerUrl: string;
    name: null;
    symbol: string;
  }>;

/**
 * Release-bound public market core. Construction is server-only and requires
 * runtime provenance from both the signed release and its settlement-RPC read.
 */
export type PredictionV2BaseMarketView = Readonly<{
  schemaVersion: 2;
  source: "onchain-rpc";
  marketKey: `eip155:4663:${string}:${PredictionBytes32V2}`;
  marketId: PredictionBytes32V2;
  economicKey: PredictionBytes32V2;
  asset: PredictionV2BaseAssetView;
  condition: Readonly<{
    kind: "usd-price-at-utc";
    metric: "usd-price";
    comparator: "greater-than-or-equal";
    quoteCurrency: "USD";
    strikeAtoms: string;
    priceDecimals: 8;
    observationUnixSeconds: string;
    observationUtc: string;
    oracleSnapshotRule: Readonly<{
      source: "chainlink-data-feed";
      winningPrice: "latest-completed-round-at-or-before-observation";
      requiredAfterRound: "first-completed-round-after-observation";
      maximumBeforeAgeSeconds: string;
      maximumAfterDelaySeconds: string;
    }>;
  }>;
  lifecycle: PredictionV2ReadMarket["lifecycle"];
  poolState: PredictionV2ReadMarket["poolState"];
  artwork: Readonly<{
    kind: "bundled-fallback";
    url: string;
  }>;
  links: readonly [];
  onchain: Readonly<{
    releaseId: string;
    settlementChainId: 4_663;
    factoryAddress: string;
    factoryRuntimeCodeHash: PredictionBytes32V2;
    assetKey: PredictionBytes32V2;
    registryRevision: string;
    registrySnapshotHash: PredictionBytes32V2;
    resolutionPolicyHash: PredictionBytes32V2;
    vaultAddress: string;
    checkpointAddress: string;
    poolId: PredictionBytes32V2;
    confirmedBlockNumber: string;
    confirmedBlockHash: PredictionBytes32V2;
  }>;
}>;
