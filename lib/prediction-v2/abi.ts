import type { Abi, Address } from "viem";

import type {
  PredictionAssetIdentityV2,
  PredictionBytes32V2,
} from "../prediction-market-assets-v2";

const assetIdentityComponents = [
  { name: "sourceNamespace", type: "bytes32" },
  { name: "sourceChain", type: "bytes32" },
  { name: "assetIdentifier", type: "bytes32" },
  { name: "assetStandard", type: "bytes32" },
] as const;

const poolKeyComponents = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

const swapQuoteComponents = [
  { name: "actualInput", type: "uint256" },
  { name: "amountOut", type: "uint256" },
  { name: "sqrtPriceX96After", type: "uint160" },
  { name: "tickAfter", type: "int24" },
  { name: "poolManagerProtocolFee", type: "uint24" },
  { name: "lpFee", type: "uint24" },
] as const;

const buyQuoteComponents = [
  { name: "requestedCollateralAtoms", type: "uint256" },
  { name: "maximumPaymentAtoms", type: "uint256" },
  { name: "executedCollateralAtoms", type: "uint256" },
  { name: "collateralRefundAtoms", type: "uint256" },
  { name: "protocolFeeAtoms", type: "uint256" },
  { name: "feeReserveRefundAtoms", type: "uint256" },
  { name: "actualPaymentAtoms", type: "uint256" },
  { name: "outcomeAtoms", type: "uint256" },
  { name: "swap", type: "tuple", components: swapQuoteComponents },
] as const;

const sellQuoteComponents = [
  { name: "outcomeInAtoms", type: "uint256" },
  { name: "requestedSwapAtoms", type: "uint256" },
  { name: "grossCollateralAtoms", type: "uint256" },
  { name: "protocolFeeAtoms", type: "uint256" },
  { name: "netCollateralAtoms", type: "uint256" },
  { name: "soldRefundAtoms", type: "uint256" },
  { name: "complementRefundAtoms", type: "uint256" },
  { name: "swap", type: "tuple", components: swapQuoteComponents },
] as const;

const oraclePolicyComponents = [
  { name: "checkpointKind", type: "bytes32" },
  { name: "checkpointAdapter", type: "address" },
  { name: "checkpointAdapterCodehash", type: "bytes32" },
  { name: "feedId", type: "bytes32" },
  { name: "feedAddress", type: "address" },
  { name: "feedProxyCodehash", type: "bytes32" },
  { name: "feedPhaseId", type: "uint16" },
  { name: "feedAggregator", type: "address" },
  { name: "feedAggregatorCodehash", type: "bytes32" },
  { name: "feedDescriptionHash", type: "bytes32" },
  { name: "feedDecimals", type: "uint8" },
  { name: "quoteCurrency", type: "bytes32" },
  { name: "assetEvidenceHash", type: "bytes32" },
  { name: "maxOpenInterestAtoms", type: "uint256" },
  { name: "validUntil", type: "uint64" },
  { name: "policyVersion", type: "uint32" },
  { name: "active", type: "bool" },
] as const;

const registrySnapshotComponents = [
  { name: "assetKey", type: "bytes32" },
  { name: "revision", type: "uint64" },
  { name: "identity", type: "tuple", components: assetIdentityComponents },
  { name: "displaySymbol", type: "string" },
  { name: "policy", type: "tuple", components: oraclePolicyComponents },
] as const;

/** Exact ABI closure for GenericPredictionMarketFactoryV2. No V1 overloads. */
export const PREDICTION_V2_FACTORY_ABI = [
  {
    type: "function",
    name: "assetRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ name: "economicKey", type: "bytes32" }],
    outputs: [
      { name: "vault", type: "address" },
      { name: "checkpoint", type: "address" },
      { name: "poolId", type: "bytes32" },
      { name: "marketId", type: "bytes32" },
      { name: "assetKey", type: "bytes32" },
      { name: "registrySnapshotHash", type: "bytes32" },
      { name: "resolutionPolicyHash", type: "bytes32" },
      { name: "registryRevision", type: "uint64" },
      { name: "policyValidUntil", type: "uint64" },
      { name: "snapshotAssetCap", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "activeMarketId",
    stateMutability: "view",
    inputs: [
      { name: "identity", type: "tuple", components: assetIdentityComponents },
      { name: "observationTime", type: "uint32" },
      { name: "threshold", type: "int192" },
    ],
    outputs: [
      { name: "economicKey", type: "bytes32" },
      { name: "marketId", type: "bytes32" },
      { name: "snapshotHash", type: "bytes32" },
      { name: "registryRevision", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "economicEventKey",
    stateMutability: "view",
    inputs: [
      { name: "assetKey", type: "bytes32" },
      { name: "observationTime", type: "uint32" },
      { name: "threshold", type: "int192" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "marketCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "marketKeyAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getPoolKey",
    stateMutability: "view",
    inputs: [{ name: "economicKey", type: "bytes32" }],
    outputs: [{ name: "", type: "tuple", components: poolKeyComponents }],
  },
  {
    type: "function",
    name: "createMarketWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "identity", type: "tuple", components: assetIdentityComponents },
      { name: "observationTime", type: "uint32" },
      { name: "threshold", type: "int192" },
      { name: "permitDeadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [
      { name: "vaultAddress", type: "address" },
      { name: "created", type: "bool" },
    ],
  },
] as const satisfies Abi;

/** Exact 17-field OraclePolicy and Snapshot bindings for AssetRegistryV2. */
export const PREDICTION_V2_ASSET_REGISTRY_ABI = [
  {
    type: "function",
    name: "assetKeyOf",
    stateMutability: "pure",
    inputs: [
      { name: "identity", type: "tuple", components: assetIdentityComponents },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "requireActiveAsset",
    stateMutability: "view",
    inputs: [
      { name: "identity", type: "tuple", components: assetIdentityComponents },
    ],
    outputs: [
      { name: "snapshot", type: "tuple", components: registrySnapshotComponents },
    ],
  },
  {
    type: "function",
    name: "latestSnapshot",
    stateMutability: "view",
    inputs: [{ name: "assetKey", type: "bytes32" }],
    outputs: [
      { name: "snapshot", type: "tuple", components: registrySnapshotComponents },
    ],
  },
  {
    type: "function",
    name: "hashSnapshot",
    stateMutability: "pure",
    inputs: [
      { name: "snapshot", type: "tuple", components: registrySnapshotComponents },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "isCurrentActiveRevision",
    stateMutability: "view",
    inputs: [
      { name: "assetKey", type: "bytes32" },
      { name: "revision", type: "uint64" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

/** PredictionQuoterV2 returns one 9-field buy tuple and one 8-field sell tuple. */
export const PREDICTION_V2_QUOTER_ABI = [
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "key", type: "tuple", components: poolKeyComponents },
      { name: "buyYes", type: "bool" },
      { name: "requestedCollateralAtoms", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "quote", type: "tuple", components: buyQuoteComponents }],
  },
  {
    type: "function",
    name: "quoteSellOptimal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "key", type: "tuple", components: poolKeyComponents },
      { name: "sellYes", type: "bool" },
      { name: "outcomeAtoms", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "quote", type: "tuple", components: sellQuoteComponents }],
  },
] as const satisfies Abi;

export const PREDICTION_V2_EXECUTION_ROUTER_ABI = [
  {
    type: "function",
    name: "buyOutcomeWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "key", type: "tuple", components: poolKeyComponents },
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "buyYes", type: "bool" },
          { name: "collateralAtoms", type: "uint256" },
          { name: "minOutcomeAtoms", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "permitDeadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [{ name: "totalOutcomeAtoms", type: "uint256" }],
  },
  {
    type: "function",
    name: "sellOutcomeWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "key", type: "tuple", components: poolKeyComponents },
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "sellYes", type: "bool" },
          { name: "outcomeAtoms", type: "uint256" },
          { name: "swapAtoms", type: "uint256" },
          { name: "minCollateralAtoms", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "permitDeadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [{ name: "netCollateralAtoms", type: "uint256" }],
  },
] as const satisfies Abi;

/** A successful eth_call returns empty data; insufficient or unstable capacity reverts. */
export const PREDICTION_V2_EXPOSURE_CONTROLLER_ABI = [
  {
    type: "function",
    name: "requireIncreaseCapacity",
    stateMutability: "view",
    inputs: [
      { name: "vault", type: "address" },
      { name: "delta", type: "uint256" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

export const PREDICTION_V2_VAULT_ABI = [
  {
    type: "function",
    name: "exposureController",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "finalize",
    stateMutability: "payable",
    inputs: [{ name: "proof", type: "bytes" }],
    outputs: [{ name: "finalState", type: "uint8" }],
  },
] as const satisfies Abi;

export type PredictionV2PoolKey = Readonly<{
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}>;

export type PredictionV2MarketRecord = Readonly<{
  vault: Address;
  checkpoint: Address;
  poolId: PredictionBytes32V2;
  marketId: PredictionBytes32V2;
  assetKey: PredictionBytes32V2;
  registrySnapshotHash: PredictionBytes32V2;
  resolutionPolicyHash: PredictionBytes32V2;
  registryRevision: bigint;
  policyValidUntil: bigint;
  snapshotAssetCap: bigint;
}>;

export type PredictionV2OraclePolicy = Readonly<{
  checkpointKind: PredictionBytes32V2;
  checkpointAdapter: Address;
  checkpointAdapterCodehash: PredictionBytes32V2;
  feedId: PredictionBytes32V2;
  feedAddress: Address;
  feedProxyCodehash: PredictionBytes32V2;
  feedPhaseId: number;
  feedAggregator: Address;
  feedAggregatorCodehash: PredictionBytes32V2;
  feedDescriptionHash: PredictionBytes32V2;
  feedDecimals: number;
  quoteCurrency: PredictionBytes32V2;
  assetEvidenceHash: PredictionBytes32V2;
  maxOpenInterestAtoms: bigint;
  validUntil: bigint;
  policyVersion: number;
  active: boolean;
}>;

export type PredictionV2RegistrySnapshot = Readonly<{
  assetKey: PredictionBytes32V2;
  revision: bigint;
  identity: PredictionAssetIdentityV2;
  displaySymbol: string;
  policy: PredictionV2OraclePolicy;
}>;
