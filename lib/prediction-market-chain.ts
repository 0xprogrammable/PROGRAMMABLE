import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import {
  ROBINHOOD_MAINNET_RPC_URL,
  ROBINHOOD_MULTICALL3_ADDRESS,
  ROBINHOOD_MULTICALL3_RUNTIME_CODE_HASH,
  robinhoodChain,
} from "./chains";
import {
  PREDICTION_BOOTSTRAP_USDG_ATOMS,
  PREDICTION_MAXIMUM_DURATION_SECONDS,
  PREDICTION_MINIMUM_DURATION_SECONDS,
  PREDICTION_TRADING_CUTOFF_SECONDS,
  ROBINHOOD_BTC_USD_FEED_ADDRESS,
  ROBINHOOD_USDG_ADDRESS,
  encodePredictionMarketCreation,
  getExpectedUsdgPermitDomainSeparator,
  type PredictionPermitSignature,
  type ValidatedPredictionMarket,
} from "./prediction-market";
import type { PreparedTransaction } from "./prepared-transaction";

const zeroAddress = "0x0000000000000000000000000000000000000000";
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/;
const PREDICTION_RPC_CONFIRMATIONS = 3n;
const PREDICTION_MAX_RPC_HEAD_DIVERGENCE = 300n;
const PREDICTION_GAS_BUFFER_PERCENT = 120n;
const PREDICTION_MAX_GAS_LIMIT = 10_000_000n;
const PREDICTION_MULTICALL_BATCH_SIZE = 64;
const PREDICTION_SECONDARY_RPC_HOST = "robinhood-mainnet.g.alchemy.com";
const UINT256_MAX = (1n << 256n) - 1n;

export const ROBINHOOD_V4_POOL_MANAGER_ADDRESS =
  "0x8366a39CC670B4001A1121B8F6A443A643e40951" as const;
export const ROBINHOOD_V4_QUOTER_ADDRESS =
  "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94" as const;
export const ROBINHOOD_V4_STATE_VIEW_ADDRESS =
  "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b" as const;
export const ROBINHOOD_V4_POOL_MANAGER_RUNTIME_CODE_HASH =
  "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626" as const;
export const ROBINHOOD_V4_QUOTER_RUNTIME_CODE_HASH =
  "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6" as const;
export const ROBINHOOD_V4_STATE_VIEW_RUNTIME_CODE_HASH =
  "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6" as const;

export type PredictionMarketReleaseConfig = Readonly<{
  deploymentBlock: bigint;
  factoryAddress: Address;
  hookRuntimeCodeHash: Hex;
  predictionQuoterAddress: Address;
  predictionQuoterRuntimeCodeHash: Hex;
  routerRuntimeCodeHash: Hex;
  runtimeCodeHash: Hex;
  secondaryRpcUrl: string;
}>;

export type PredictionMarketReleaseConfigInput = Readonly<{
  deploymentBlock?: string;
  factoryAddress?: string;
  hookRuntimeCodeHash?: string;
  predictionQuoterAddress?: string;
  predictionQuoterRuntimeCodeHash?: string;
  routerRuntimeCodeHash?: string;
  runtimeCodeHash?: string;
  secondaryRpcUrl?: string;
}>;

export type PredictionLaunchSnapshot = Readonly<{
  blockNumber: bigint;
  blockTimestamp: bigint;
  bootstrapCollateral: bigint;
  collateral: Address;
  controller: Address;
  cutoffBeforeObservation: bigint;
  domainSeparator: Hex;
  feed: Address;
  globalCap: bigint;
  hook: Address;
  hookRuntimeCodeHash: Hex | null;
  manager: Address;
  marketCheckpoint: Address;
  marketPoolId: Hex;
  marketVault: Address;
  minimumDuration: bigint;
  maximumDuration: bigint;
  nonce: bigint;
  ownerCollateralBalance: bigint;
  runtimeCodeHash: Hex | null;
  predictionQuoterFactory: Address;
  predictionQuoterPoolManager: Address;
  predictionQuoterRuntimeCodeHash: Hex | null;
  officialMulticallRuntimeCodeHash: Hex | null;
  officialPoolManagerRuntimeCodeHash: Hex | null;
  officialQuoterRuntimeCodeHash: Hex | null;
  officialStateViewRuntimeCodeHash: Hex | null;
  router: Address;
  routerRuntimeCodeHash: Hex | null;
  semanticKey: Hex;
  tokenDecimals: number;
  tokenName: string;
  totalExposure: bigint;
}>;

export type PredictionLaunchPreflight = Readonly<{
  blockNumber: bigint;
  blockTimestamp: bigint;
  capacityRemainingAtoms: bigint;
  nonce: bigint;
  ownerCollateralBalance: bigint;
  semanticKey: Hex;
}>;

export type PreparedPredictionMarketLaunch = Readonly<{
  estimatedGas: bigint;
  gasLimit: bigint;
  gasPriceWei: bigint;
  maximumGasCostWei: bigint;
  transaction: PreparedTransaction;
}>;

export type ConfirmedPredictionMarket = Readonly<{
  blockNumber: bigint;
  checkpoint: Address;
  noToken: Address;
  poolId: Hex;
  semanticKey: Hex;
  transactionHash: Hex;
  vault: Address;
  yesToken: Address;
}>;

export type PredictionSourceMatchRequest = Readonly<{
  address: Address;
  lookupStatus: number | null;
  match: string | null;
  requestAccepted: boolean | null;
  requestStatus: number | null;
  verified: boolean;
}>;

type PredictionSourceMatchOptions = Readonly<{
  fetcher?: typeof fetch;
  maxWaitMs?: number;
  now?: () => number;
  pollIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

const SOURCIFY_SERVER_URL = "https://sourcify.dev/server";

const factoryReadAbi = [
  {
    type: "function",
    name: "BOOTSTRAP_COLLATERAL",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "CUTOFF_BEFORE_OBSERVATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "MINIMUM_MARKET_DURATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "MAXIMUM_MARKET_DURATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "btcUsdPriceFeed",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "collateral",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "exposureController",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "hook",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "manager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "router",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ name: "semanticKey", type: "bytes32" }],
    outputs: [
      { name: "vault", type: "address" },
      { name: "checkpoint", type: "address" },
      { name: "poolId", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "semanticEventKey",
    stateMutability: "view",
    inputs: [
      { name: "observationTime", type: "uint32" },
      { name: "threshold", type: "int192" },
    ],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const predictionQuoterReadAbi = [
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "poolManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

const collateralReadAbi = [
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const exposureReadAbi = [
  {
    type: "function",
    name: "globalCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalGuardedExposure",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const marketCreatedEventAbi = [
  {
    type: "event",
    name: "MarketCreated",
    anonymous: false,
    inputs: [
      { name: "semanticKey", type: "bytes32", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "vault", type: "address", indexed: true },
      { name: "checkpoint", type: "address", indexed: false },
      { name: "poolId", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MarketComponents",
    anonymous: false,
    inputs: [
      { name: "semanticKey", type: "bytes32", indexed: true },
      { name: "vault", type: "address", indexed: true },
      { name: "checkpoint", type: "address", indexed: true },
      { name: "yesToken", type: "address", indexed: false },
      { name: "noToken", type: "address", indexed: false },
      { name: "observationTime", type: "uint32", indexed: false },
      { name: "cutoff", type: "uint64", indexed: false },
      { name: "threshold", type: "int192", indexed: false },
      { name: "poolId", type: "bytes32", indexed: false },
    ],
  },
] as const;

export function parsePredictionMarketReleaseConfig(
  input: PredictionMarketReleaseConfigInput,
): PredictionMarketReleaseConfig | null {
  const deploymentBlock = input.deploymentBlock?.trim() ?? "";
  const factoryAddress = input.factoryAddress?.trim() ?? "";
  const hookRuntimeCodeHash = input.hookRuntimeCodeHash?.trim() ?? "";
  const predictionQuoterAddress = input.predictionQuoterAddress?.trim() ?? "";
  const predictionQuoterRuntimeCodeHash =
    input.predictionQuoterRuntimeCodeHash?.trim() ?? "";
  const routerRuntimeCodeHash = input.routerRuntimeCodeHash?.trim() ?? "";
  const runtimeCodeHash = input.runtimeCodeHash?.trim() ?? "";
  const secondaryRpcUrl = input.secondaryRpcUrl?.trim() ?? "";
  if (
    !deploymentBlock &&
    !factoryAddress &&
    !hookRuntimeCodeHash &&
    !predictionQuoterAddress &&
    !predictionQuoterRuntimeCodeHash &&
    !routerRuntimeCodeHash &&
    !runtimeCodeHash &&
    !secondaryRpcUrl
  ) {
    return null;
  }
  if (!/^[1-9][0-9]*$/u.test(deploymentBlock)) {
    throw new Error("The configured prediction deployment block is invalid");
  }
  if (!isAddress(factoryAddress)) {
    throw new Error("The configured prediction factory address is invalid");
  }
  if (!isAddress(predictionQuoterAddress)) {
    throw new Error("The configured prediction quoter address is invalid");
  }
  const hashes = [
    ["factory", runtimeCodeHash],
    ["router", routerRuntimeCodeHash],
    ["hook", hookRuntimeCodeHash],
    ["prediction quoter", predictionQuoterRuntimeCodeHash],
  ] as const;
  for (const [label, value] of hashes) {
    if (!bytes32Pattern.test(value)) {
      throw new Error(`The configured ${label} code hash is invalid`);
    }
  }

  let parsedSecondaryRpcUrl: URL;
  try {
    parsedSecondaryRpcUrl = new URL(secondaryRpcUrl);
  } catch {
    throw new Error("The configured prediction secondary RPC URL is invalid");
  }
  if (
    parsedSecondaryRpcUrl.protocol !== "https:" ||
    parsedSecondaryRpcUrl.hostname !== PREDICTION_SECONDARY_RPC_HOST ||
    parsedSecondaryRpcUrl.port ||
    parsedSecondaryRpcUrl.username ||
    parsedSecondaryRpcUrl.password ||
    parsedSecondaryRpcUrl.search ||
    parsedSecondaryRpcUrl.hash ||
    !/^\/v2\/[A-Za-z0-9_-]{16,}$/u.test(parsedSecondaryRpcUrl.pathname)
  ) {
    throw new Error("The configured prediction secondary RPC URL is invalid");
  }

  return {
    deploymentBlock: BigInt(deploymentBlock),
    factoryAddress: getAddress(factoryAddress),
    hookRuntimeCodeHash: hookRuntimeCodeHash.toLowerCase() as Hex,
    predictionQuoterAddress: getAddress(predictionQuoterAddress),
    predictionQuoterRuntimeCodeHash:
      predictionQuoterRuntimeCodeHash.toLowerCase() as Hex,
    routerRuntimeCodeHash: routerRuntimeCodeHash.toLowerCase() as Hex,
    runtimeCodeHash: runtimeCodeHash.toLowerCase() as Hex,
    secondaryRpcUrl: parsedSecondaryRpcUrl.toString(),
  };
}

export function getPredictionMarketReleaseConfig() {
  return parsePredictionMarketReleaseConfig({
    deploymentBlock:
      process.env.NEXT_PUBLIC_PROGRAMMABLE_PREDICTION_DEPLOYMENT_BLOCK,
    factoryAddress:
      process.env.NEXT_PUBLIC_PROGRAMMABLE_PREDICTION_FACTORY_ADDRESS,
    hookRuntimeCodeHash:
      process.env.NEXT_PUBLIC_PROGRAMMABLE_PREDICTION_HOOK_RUNTIME_CODE_HASH,
    predictionQuoterAddress:
      process.env.NEXT_PUBLIC_PROGRAMMABLE_PREDICTION_QUOTER_ADDRESS,
    predictionQuoterRuntimeCodeHash:
      process.env.NEXT_PUBLIC_PROGRAMMABLE_PREDICTION_QUOTER_RUNTIME_CODE_HASH,
    routerRuntimeCodeHash:
      process.env.NEXT_PUBLIC_PROGRAMMABLE_PREDICTION_ROUTER_RUNTIME_CODE_HASH,
    runtimeCodeHash:
      process.env.NEXT_PUBLIC_PROGRAMMABLE_PREDICTION_FACTORY_RUNTIME_CODE_HASH,
    secondaryRpcUrl:
      process.env.NEXT_PUBLIC_PROGRAMMABLE_PREDICTION_SECONDARY_RPC_URL,
  });
}

export function createPredictionMarketPublicClients(
  config = getPredictionMarketReleaseConfig(),
) {
  if (!config) {
    throw new Error("The prediction market release is not configured");
  }
  return [
    createPublicClient({
      batch: {
        multicall: {
          batchSize: PREDICTION_MULTICALL_BATCH_SIZE,
          wait: 0,
        },
      },
      chain: robinhoodChain,
      transport: http(ROBINHOOD_MAINNET_RPC_URL, {
        retryCount: 1,
        timeout: 10_000,
      }),
    }),
    createPublicClient({
      batch: {
        multicall: {
          batchSize: PREDICTION_MULTICALL_BATCH_SIZE,
          wait: 0,
        },
      },
      chain: robinhoodChain,
      transport: http(config.secondaryRpcUrl, {
        retryCount: 1,
        timeout: 10_000,
      }),
    }),
  ] as const;
}

export type PredictionMarketPublicClient = ReturnType<
  typeof createPredictionMarketPublicClients
>[number];

async function readPredictionLaunchSnapshot({
  blockNumber,
  client,
  config,
  market,
  owner,
}: {
  blockNumber: bigint;
  client: PredictionMarketPublicClient;
  config: PredictionMarketReleaseConfig;
  market: ValidatedPredictionMarket;
  owner: Address;
}): Promise<PredictionLaunchSnapshot> {
  const factory = config.factoryAddress;
  const [
    block,
    bootstrapCollateral,
    code,
    collateral,
    controller,
    cutoffBeforeObservation,
    feed,
    hook,
    manager,
    maximumDuration,
    minimumDuration,
    router,
    semanticKey,
  ] = await Promise.all([
    client.getBlock({ blockNumber }),
    client.readContract({
      address: factory,
      abi: factoryReadAbi,
      blockNumber,
      functionName: "BOOTSTRAP_COLLATERAL",
    }),
    client.getBytecode({ address: factory, blockNumber }),
    client.readContract({
      address: factory,
      abi: factoryReadAbi,
      blockNumber,
      functionName: "collateral",
    }),
    client.readContract({
      address: factory,
      abi: factoryReadAbi,
      blockNumber,
      functionName: "exposureController",
    }),
    client.readContract({
      address: factory,
      abi: factoryReadAbi,
      blockNumber,
      functionName: "CUTOFF_BEFORE_OBSERVATION",
    }),
    client.readContract({
      address: factory,
      abi: factoryReadAbi,
      blockNumber,
      functionName: "btcUsdPriceFeed",
    }),
    client.readContract({
      address: factory,
      abi: factoryReadAbi,
      blockNumber,
      functionName: "hook",
    }),
    client.readContract({
      address: factory,
      abi: factoryReadAbi,
      blockNumber,
      functionName: "manager",
    }),
    client.readContract({
      address: factory,
      abi: factoryReadAbi,
      blockNumber,
      functionName: "MAXIMUM_MARKET_DURATION",
    }),
    client.readContract({
      address: factory,
      abi: factoryReadAbi,
      blockNumber,
      functionName: "MINIMUM_MARKET_DURATION",
    }),
    client.readContract({
      address: factory,
      abi: factoryReadAbi,
      blockNumber,
      functionName: "router",
    }),
    client.readContract({
      address: factory,
      abi: factoryReadAbi,
      blockNumber,
      functionName: "semanticEventKey",
      args: [market.observationTime, market.thresholdAtoms],
    }),
  ]);

  const [
    domainSeparator,
    globalCap,
    hookCode,
    marketRecord,
    nonce,
    officialMulticallCode,
    officialPoolManagerCode,
    officialQuoterCode,
    officialStateViewCode,
    ownerCollateralBalance,
    predictionQuoterCode,
    predictionQuoterFactory,
    predictionQuoterPoolManager,
    routerCode,
    tokenDecimals,
    tokenName,
    totalExposure,
  ] = await Promise.all([
    client.readContract({
      address: ROBINHOOD_USDG_ADDRESS,
      abi: collateralReadAbi,
      blockNumber,
      functionName: "DOMAIN_SEPARATOR",
    }),
    client.readContract({
      address: controller,
      abi: exposureReadAbi,
      blockNumber,
      functionName: "globalCap",
    }),
    client.getBytecode({ address: hook, blockNumber }),
    client.readContract({
      address: factory,
      abi: factoryReadAbi,
      blockNumber,
      functionName: "markets",
      args: [semanticKey],
    }),
    client.readContract({
      address: ROBINHOOD_USDG_ADDRESS,
      abi: collateralReadAbi,
      blockNumber,
      functionName: "nonces",
      args: [owner],
    }),
    client.getBytecode({
      address: ROBINHOOD_MULTICALL3_ADDRESS,
      blockNumber,
    }),
    client.getBytecode({
      address: ROBINHOOD_V4_POOL_MANAGER_ADDRESS,
      blockNumber,
    }),
    client.getBytecode({
      address: ROBINHOOD_V4_QUOTER_ADDRESS,
      blockNumber,
    }),
    client.getBytecode({
      address: ROBINHOOD_V4_STATE_VIEW_ADDRESS,
      blockNumber,
    }),
    client.readContract({
      address: ROBINHOOD_USDG_ADDRESS,
      abi: collateralReadAbi,
      blockNumber,
      functionName: "balanceOf",
      args: [owner],
    }),
    client.getBytecode({
      address: config.predictionQuoterAddress,
      blockNumber,
    }),
    client.readContract({
      address: config.predictionQuoterAddress,
      abi: predictionQuoterReadAbi,
      blockNumber,
      functionName: "factory",
    }),
    client.readContract({
      address: config.predictionQuoterAddress,
      abi: predictionQuoterReadAbi,
      blockNumber,
      functionName: "poolManager",
    }),
    client.getBytecode({ address: router, blockNumber }),
    client.readContract({
      address: ROBINHOOD_USDG_ADDRESS,
      abi: collateralReadAbi,
      blockNumber,
      functionName: "decimals",
    }),
    client.readContract({
      address: ROBINHOOD_USDG_ADDRESS,
      abi: collateralReadAbi,
      blockNumber,
      functionName: "name",
    }),
    client.readContract({
      address: controller,
      abi: exposureReadAbi,
      blockNumber,
      functionName: "totalGuardedExposure",
    }),
  ]);

  const [marketVault, marketCheckpoint, marketPoolId] = marketRecord;
  return {
    blockNumber,
    blockTimestamp: block.timestamp,
    bootstrapCollateral,
    collateral,
    controller,
    cutoffBeforeObservation,
    domainSeparator,
    feed,
    globalCap,
    hook,
    hookRuntimeCodeHash:
      hookCode && hookCode !== "0x" ? keccak256(hookCode) : null,
    manager,
    marketCheckpoint,
    marketPoolId,
    marketVault,
    maximumDuration,
    minimumDuration,
    nonce,
    ownerCollateralBalance,
    runtimeCodeHash: code && code !== "0x" ? keccak256(code) : null,
    predictionQuoterFactory,
    predictionQuoterPoolManager,
    predictionQuoterRuntimeCodeHash:
      predictionQuoterCode && predictionQuoterCode !== "0x"
        ? keccak256(predictionQuoterCode)
        : null,
    officialMulticallRuntimeCodeHash:
      officialMulticallCode && officialMulticallCode !== "0x"
        ? keccak256(officialMulticallCode)
        : null,
    officialPoolManagerRuntimeCodeHash:
      officialPoolManagerCode && officialPoolManagerCode !== "0x"
        ? keccak256(officialPoolManagerCode)
        : null,
    officialQuoterRuntimeCodeHash:
      officialQuoterCode && officialQuoterCode !== "0x"
        ? keccak256(officialQuoterCode)
        : null,
    officialStateViewRuntimeCodeHash:
      officialStateViewCode && officialStateViewCode !== "0x"
        ? keccak256(officialStateViewCode)
        : null,
    router,
    routerRuntimeCodeHash:
      routerCode && routerCode !== "0x" ? keccak256(routerCode) : null,
    semanticKey,
    tokenDecimals,
    tokenName,
    totalExposure,
  };
}

function normalizeSnapshot(snapshot: unknown) {
  return JSON.stringify(snapshot, (_, value: unknown) => {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string" && value.startsWith("0x")) {
      return value.toLowerCase();
    }
    return value;
  });
}

export function assertPredictionLaunchSnapshotsMatch(
  primary: PredictionLaunchSnapshot,
  secondary: PredictionLaunchSnapshot,
) {
  if (normalizeSnapshot(primary) !== normalizeSnapshot(secondary)) {
    throw new Error(
      "The two public Robinhood RPCs returned different market state. Try again after they agree.",
    );
  }
}

export function assertPredictionLaunchSnapshot({
  config,
  market,
  snapshot,
}: {
  config: PredictionMarketReleaseConfig;
  market: ValidatedPredictionMarket;
  snapshot: PredictionLaunchSnapshot;
}): PredictionLaunchPreflight {
  if (snapshot.runtimeCodeHash?.toLowerCase() !== config.runtimeCodeHash) {
    throw new Error("The prediction factory does not match the reviewed release");
  }
  if (snapshot.blockNumber < config.deploymentBlock) {
    throw new Error("The confirmed read predates the reviewed prediction release");
  }
  if (
    snapshot.routerRuntimeCodeHash?.toLowerCase() !==
      config.routerRuntimeCodeHash ||
    snapshot.hookRuntimeCodeHash?.toLowerCase() !== config.hookRuntimeCodeHash ||
    snapshot.predictionQuoterRuntimeCodeHash?.toLowerCase() !==
      config.predictionQuoterRuntimeCodeHash
  ) {
    throw new Error("A prediction execution dependency does not match the reviewed release");
  }
  if (
    snapshot.manager.toLowerCase() !==
      ROBINHOOD_V4_POOL_MANAGER_ADDRESS.toLowerCase() ||
    snapshot.predictionQuoterPoolManager.toLowerCase() !==
      ROBINHOOD_V4_POOL_MANAGER_ADDRESS.toLowerCase() ||
    snapshot.predictionQuoterFactory.toLowerCase() !==
      config.factoryAddress.toLowerCase() ||
    snapshot.officialMulticallRuntimeCodeHash?.toLowerCase() !==
      ROBINHOOD_MULTICALL3_RUNTIME_CODE_HASH ||
    snapshot.officialPoolManagerRuntimeCodeHash?.toLowerCase() !==
      ROBINHOOD_V4_POOL_MANAGER_RUNTIME_CODE_HASH ||
    snapshot.officialQuoterRuntimeCodeHash?.toLowerCase() !==
      ROBINHOOD_V4_QUOTER_RUNTIME_CODE_HASH ||
    snapshot.officialStateViewRuntimeCodeHash?.toLowerCase() !==
      ROBINHOOD_V4_STATE_VIEW_RUNTIME_CODE_HASH
  ) {
    throw new Error("The official Robinhood Uniswap v4 quote stack could not be verified");
  }
  if (
    snapshot.collateral.toLowerCase() !== ROBINHOOD_USDG_ADDRESS.toLowerCase() ||
    snapshot.feed.toLowerCase() !== ROBINHOOD_BTC_USD_FEED_ADDRESS.toLowerCase()
  ) {
    throw new Error("The prediction factory has unexpected collateral or price feed wiring");
  }
  if (
    snapshot.bootstrapCollateral !== PREDICTION_BOOTSTRAP_USDG_ATOMS ||
    snapshot.minimumDuration !== BigInt(PREDICTION_MINIMUM_DURATION_SECONDS) ||
    snapshot.maximumDuration !== BigInt(PREDICTION_MAXIMUM_DURATION_SECONDS) ||
    snapshot.cutoffBeforeObservation !== BigInt(PREDICTION_TRADING_CUTOFF_SECONDS)
  ) {
    throw new Error("The prediction factory rules do not match this interface");
  }
  if (
    snapshot.tokenDecimals !== 6 ||
    snapshot.tokenName !== "Global Dollar" ||
    snapshot.domainSeparator.toLowerCase() !==
      getExpectedUsdgPermitDomainSeparator().toLowerCase()
  ) {
    throw new Error("USDG permit configuration could not be verified");
  }
  if (snapshot.marketVault.toLowerCase() !== zeroAddress) {
    throw new Error(`This exact market already exists at ${snapshot.marketVault}`);
  }
  if (
    snapshot.marketCheckpoint.toLowerCase() !== zeroAddress ||
    snapshot.marketPoolId !== `0x${"00".repeat(32)}`
  ) {
    throw new Error("The canonical market registry is internally inconsistent");
  }
  if (
    BigInt(market.observationTime) <=
    snapshot.blockTimestamp + snapshot.minimumDuration
  ) {
    throw new Error("The result time is no longer more than 24 hours away");
  }
  if (
    BigInt(market.observationTime) >
    snapshot.blockTimestamp + snapshot.maximumDuration
  ) {
    throw new Error("The result time is more than 30 days from the confirmed chain time");
  }
  if (snapshot.ownerCollateralBalance < snapshot.bootstrapCollateral) {
    throw new Error("This wallet needs at least 2 USDG to create the market");
  }
  if (snapshot.globalCap !== UINT256_MAX) {
    throw new Error("The prediction release has a finite public capacity and is not production-eligible");
  }
  if (snapshot.totalExposure + snapshot.bootstrapCollateral > snapshot.globalCap) {
    throw new Error("The current prediction-market safety capacity is full");
  }

  return {
    blockNumber: snapshot.blockNumber,
    blockTimestamp: snapshot.blockTimestamp,
    capacityRemainingAtoms: snapshot.globalCap - snapshot.totalExposure,
    nonce: snapshot.nonce,
    ownerCollateralBalance: snapshot.ownerCollateralBalance,
    semanticKey: snapshot.semanticKey,
  };
}

export async function preflightPredictionMarketLaunch({
  clients = createPredictionMarketPublicClients(),
  config,
  market,
  owner,
}: {
  clients?: ReturnType<typeof createPredictionMarketPublicClients>;
  config: PredictionMarketReleaseConfig;
  market: ValidatedPredictionMarket;
  owner: Address;
}) {
  if (!isAddress(owner)) throw new Error("Connect a valid EVM wallet");
  const [chainIds, heads] = await Promise.all([
    Promise.all(clients.map((client) => client.getChainId())),
    Promise.all(clients.map((client) => client.getBlockNumber())),
  ]);
  if (chainIds.some((chainId) => chainId !== robinhoodChain.id)) {
    throw new Error("A configured RPC is not serving Robinhood Chain");
  }
  const lowestHead = heads[0] < heads[1] ? heads[0] : heads[1];
  const highestHead = heads[0] > heads[1] ? heads[0] : heads[1];
  if (highestHead - lowestHead > PREDICTION_MAX_RPC_HEAD_DIVERGENCE) {
    throw new Error("The two Robinhood RPCs are too far apart for a current market check");
  }
  if (lowestHead <= PREDICTION_RPC_CONFIRMATIONS) {
    throw new Error("Robinhood Chain has not reached a usable confirmed block");
  }
  const blockNumber = lowestHead - PREDICTION_RPC_CONFIRMATIONS;
  const [primary, secondary] = await Promise.all(
    clients.map((client) =>
      readPredictionLaunchSnapshot({
        blockNumber,
        client,
        config,
        market,
        owner: getAddress(owner),
      }),
    ),
  );
  assertPredictionLaunchSnapshotsMatch(primary, secondary);
  return assertPredictionLaunchSnapshot({ config, market, snapshot: primary });
}

export async function preparePredictionMarketLaunch({
  client,
  config,
  expectedNonce,
  expectedSemanticKey,
  market,
  owner,
  permit,
}: {
  client: PredictionMarketPublicClient;
  config: PredictionMarketReleaseConfig;
  expectedNonce: bigint;
  expectedSemanticKey: Hex;
  market: ValidatedPredictionMarket;
  owner: Address;
  permit: PredictionPermitSignature;
}): Promise<PreparedPredictionMarketLaunch> {
  const [currentNonce, currentMarket] = await Promise.all([
    client.readContract({
      address: ROBINHOOD_USDG_ADDRESS,
      abi: collateralReadAbi,
      functionName: "nonces",
      args: [owner],
    }),
    client.readContract({
      address: config.factoryAddress,
      abi: factoryReadAbi,
      functionName: "markets",
      args: [expectedSemanticKey],
    }),
  ]);
  if (currentNonce !== expectedNonce) {
    throw new Error("The USDG permit nonce changed before submission. Start again.");
  }
  if (currentMarket[0].toLowerCase() !== zeroAddress) {
    throw new Error(`This exact market already exists at ${currentMarket[0]}`);
  }

  const request = encodePredictionMarketCreation({
    factoryAddress: config.factoryAddress,
    market,
    permit,
  });
  const [estimatedGas, gasPriceWei, nativeBalanceWei] = await Promise.all([
    client.estimateGas({
      account: owner,
      data: request.data,
      to: request.to,
      value: request.value,
    }),
    client.getGasPrice(),
    client.getBalance({ address: owner }),
  ]);
  const gasLimit =
    (estimatedGas * PREDICTION_GAS_BUFFER_PERCENT + 99n) / 100n;
  if (gasLimit > PREDICTION_MAX_GAS_LIMIT) {
    throw new Error("The market creation gas estimate exceeds the safety limit");
  }
  const maximumGasCostWei = gasLimit * gasPriceWei;
  if (nativeBalanceWei < maximumGasCostWei) {
    throw new Error("This wallet does not have enough ETH for the maximum estimated gas");
  }

  return {
    estimatedGas,
    gasLimit,
    gasPriceWei,
    maximumGasCostWei,
    transaction: {
      chainId: robinhoodChain.id,
      data: request.data,
      gasLimit: gasLimit.toString(),
      kind: "prediction-market-launch",
      to: request.to,
      value: "0",
    },
  };
}

export async function waitForPredictionMarketCreation({
  clients = createPredictionMarketPublicClients(),
  config,
  creator,
  expectedSemanticKey,
  transactionHash,
}: {
  clients?: ReturnType<typeof createPredictionMarketPublicClients>;
  config: PredictionMarketReleaseConfig;
  creator: Address;
  expectedSemanticKey: Hex;
  transactionHash: Hex;
}): Promise<ConfirmedPredictionMarket> {
  const receipts = await Promise.all(
    clients.map((client) =>
      client.waitForTransactionReceipt({
        // Launch reads use the lower RPC head minus three blocks. Waiting for
        // four confirmations keeps the first verified read at or after launch.
        confirmations: 4,
        hash: transactionHash,
        timeout: 120_000,
      }),
    ),
  );
  const receiptEvidence = receipts.map((receipt) => ({
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber,
    logs: receipt.logs.map((log) => ({
      address: log.address,
      data: log.data,
      topics: log.topics,
    })),
    status: receipt.status,
    transactionHash: receipt.transactionHash,
  }));
  if (normalizeSnapshot(receiptEvidence[0]) !== normalizeSnapshot(receiptEvidence[1])) {
    throw new Error("The two public Robinhood RPCs returned different creation receipts");
  }
  const receipt = receipts[0];
  if (receipt.status !== "success") {
    throw new Error("The market creation transaction reverted");
  }

  let created: Extract<
    ReturnType<typeof decodeEventLog<typeof marketCreatedEventAbi>>,
    { eventName: "MarketCreated" }
  > | null = null;
  let components: Extract<
    ReturnType<typeof decodeEventLog<typeof marketCreatedEventAbi>>,
    { eventName: "MarketComponents" }
  > | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== config.factoryAddress.toLowerCase()) {
      continue;
    }
    try {
      const decoded = decodeEventLog({
        abi: marketCreatedEventAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "MarketCreated") created = decoded;
      if (decoded.eventName === "MarketComponents") components = decoded;
    } catch {
      continue;
    }
  }
  if (!created || !components) {
    throw new Error("The confirmed transaction did not emit a complete canonical market record");
  }

  const createdArgs = created.args;
  const componentArgs = components.args;
  if (
    createdArgs.semanticKey.toLowerCase() !== expectedSemanticKey.toLowerCase() ||
    componentArgs.semanticKey.toLowerCase() !== expectedSemanticKey.toLowerCase() ||
    createdArgs.creator.toLowerCase() !== creator.toLowerCase() ||
    createdArgs.vault.toLowerCase() !== componentArgs.vault.toLowerCase() ||
    createdArgs.checkpoint.toLowerCase() !== componentArgs.checkpoint.toLowerCase() ||
    createdArgs.poolId.toLowerCase() !== componentArgs.poolId.toLowerCase() ||
    componentArgs.yesToken.toLowerCase() === zeroAddress ||
    componentArgs.noToken.toLowerCase() === zeroAddress
  ) {
    throw new Error("The confirmed market components do not match the signed launch");
  }

  const marketRecords = await Promise.all(
    clients.map((client) =>
      client.readContract({
        address: config.factoryAddress,
        abi: factoryReadAbi,
        blockNumber: receipt.blockNumber,
        functionName: "markets",
        args: [expectedSemanticKey],
      }),
    ),
  );
  if (normalizeSnapshot(marketRecords[0]) !== normalizeSnapshot(marketRecords[1])) {
    throw new Error("The two public Robinhood RPCs returned different market records");
  }
  const [vault, checkpoint, poolId] = marketRecords[0];
  if (
    vault.toLowerCase() !== componentArgs.vault.toLowerCase() ||
    checkpoint.toLowerCase() !== componentArgs.checkpoint.toLowerCase() ||
    poolId.toLowerCase() !== componentArgs.poolId.toLowerCase()
  ) {
    throw new Error("The canonical factory registry does not match the confirmed market events");
  }

  return {
    blockNumber: receipt.blockNumber,
    checkpoint: getAddress(componentArgs.checkpoint),
    noToken: getAddress(componentArgs.noToken),
    poolId: componentArgs.poolId,
    semanticKey: componentArgs.semanticKey,
    transactionHash,
    vault: getAddress(componentArgs.vault),
    yesToken: getAddress(componentArgs.yesToken),
  };
}

async function readPredictionSourceMatch(address: Address, fetcher: typeof fetch) {
  try {
    const response = await fetcher(
      `${SOURCIFY_SERVER_URL}/v2/contract/${robinhoodChain.id}/${address}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      },
    );
    const text = await response.text();
    let body: { match?: unknown } = {};
    try {
      body = text ? (JSON.parse(text) as { match?: unknown }) : {};
    } catch {
      body = {};
    }
    const match = typeof body.match === "string" ? body.match : null;
    return {
      address,
      lookupStatus: response.status,
      match,
      verified:
        response.ok && (match === "match" || match === "exact_match"),
    };
  } catch {
    return { address, lookupStatus: null, match: null, verified: false };
  }
}

async function submitPredictionSourceMatch(
  address: Address,
  transactionHash: Hex,
  fetcher: typeof fetch,
) {
  try {
    const response = await fetcher(
      `${SOURCIFY_SERVER_URL}/v2/verify/similarity/${robinhoodChain.id}/${address}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ creationTransactionHash: transactionHash }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    const text = await response.text();
    let customCode: string | null = null;
    try {
      const body = text ? (JSON.parse(text) as { customCode?: unknown }) : {};
      customCode = typeof body.customCode === "string" ? body.customCode : null;
    } catch {
      customCode = null;
    }
    const alreadyVerified =
      response.status === 409 && customCode === "already_verified";
    const duplicate =
      response.status === 429 && customCode === "duplicate_verification_request";
    return {
      accepted: response.status === 202 || alreadyVerified || duplicate,
      alreadyVerified,
      status: response.status,
    };
  } catch {
    return { accepted: false, alreadyVerified: false, status: null };
  }
}

export async function requestPredictionMarketSourceMatches(
  market: ConfirmedPredictionMarket,
  {
    fetcher = fetch,
    maxWaitMs = 12_000,
    now = Date.now,
    pollIntervalMs = 2_000,
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }: PredictionSourceMatchOptions = {},
): Promise<readonly PredictionSourceMatchRequest[]> {
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > 30_000) {
    throw new Error("Source verification wait must be between 0 and 30000ms");
  }
  if (
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 100 ||
    pollIntervalMs > 10_000
  ) {
    throw new Error("Source verification polling must be between 100 and 10000ms");
  }
  const addresses = [
    market.vault,
    market.checkpoint,
    market.yesToken,
    market.noToken,
  ] as const;

  let lookups = await Promise.all(
    addresses.map((address) => readPredictionSourceMatch(address, fetcher)),
  );
  const requests = new Map<
    Address,
    Awaited<ReturnType<typeof submitPredictionSourceMatch>>
  >();
  await Promise.all(
    lookups.map(async (lookup) => {
      if (lookup.verified) return;
      requests.set(
        lookup.address,
        await submitPredictionSourceMatch(
          lookup.address,
          market.transactionHash,
          fetcher,
        ),
      );
    }),
  );

  const startedAt = now();
  while (!lookups.every((lookup) => lookup.verified)) {
    const elapsedMs = Math.max(0, now() - startedAt);
    if (elapsedMs >= maxWaitMs) break;
    await sleep(Math.min(pollIntervalMs, maxWaitMs - elapsedMs));
    lookups = await Promise.all(
      addresses.map((address) => readPredictionSourceMatch(address, fetcher)),
    );
  }

  return lookups.map((lookup) => {
    const request = requests.get(lookup.address);
    return {
      address: lookup.address,
      lookupStatus: lookup.lookupStatus,
      match: lookup.match,
      requestAccepted: request?.accepted ?? null,
      requestStatus: request?.status ?? null,
      verified: lookup.verified,
    };
  });
}
