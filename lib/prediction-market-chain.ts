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
  ROBINHOOD_MAINNET_FALLBACK_RPC_URL,
  ROBINHOOD_MAINNET_RPC_URL,
  robinhoodChain,
} from "./chains";
import {
  PREDICTION_BOOTSTRAP_USDG_ATOMS,
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
const PREDICTION_GAS_BUFFER_PERCENT = 120n;
const PREDICTION_MAX_GAS_LIMIT = 10_000_000n;

export type PredictionMarketReleaseConfig = Readonly<{
  factoryAddress: Address;
  runtimeCodeHash: Hex;
}>;

export type PredictionMarketReleaseConfigInput = Readonly<{
  factoryAddress?: string;
  runtimeCodeHash?: string;
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
  marketCheckpoint: Address;
  marketPoolId: Hex;
  marketVault: Address;
  minimumDuration: bigint;
  nonce: bigint;
  ownerCollateralBalance: bigint;
  runtimeCodeHash: Hex | null;
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
  accepted: boolean;
  address: Address;
  status: number | null;
}>;

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
  const factoryAddress = input.factoryAddress?.trim() ?? "";
  const runtimeCodeHash = input.runtimeCodeHash?.trim() ?? "";
  if (!factoryAddress && !runtimeCodeHash) return null;
  if (!isAddress(factoryAddress)) {
    throw new Error("The configured prediction factory address is invalid");
  }
  if (!bytes32Pattern.test(runtimeCodeHash)) {
    throw new Error("The configured prediction factory code hash is invalid");
  }

  return {
    factoryAddress: getAddress(factoryAddress),
    runtimeCodeHash: runtimeCodeHash.toLowerCase() as Hex,
  };
}

export function getPredictionMarketReleaseConfig() {
  return parsePredictionMarketReleaseConfig({
    factoryAddress:
      process.env.NEXT_PUBLIC_PROGRAMMABLE_PREDICTION_FACTORY_ADDRESS,
    runtimeCodeHash:
      process.env.NEXT_PUBLIC_PROGRAMMABLE_PREDICTION_FACTORY_RUNTIME_CODE_HASH,
  });
}

export function createPredictionMarketPublicClients() {
  return [
    createPublicClient({
      chain: robinhoodChain,
      transport: http(ROBINHOOD_MAINNET_RPC_URL, {
        retryCount: 1,
        timeout: 10_000,
      }),
    }),
    createPublicClient({
      chain: robinhoodChain,
      transport: http(ROBINHOOD_MAINNET_FALLBACK_RPC_URL, {
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
    minimumDuration,
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
      functionName: "MINIMUM_MARKET_DURATION",
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
    marketRecord,
    nonce,
    ownerCollateralBalance,
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
    client.readContract({
      address: ROBINHOOD_USDG_ADDRESS,
      abi: collateralReadAbi,
      blockNumber,
      functionName: "balanceOf",
      args: [owner],
    }),
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
    marketCheckpoint,
    marketPoolId,
    marketVault,
    minimumDuration,
    nonce,
    ownerCollateralBalance,
    runtimeCodeHash: code && code !== "0x" ? keccak256(code) : null,
    semanticKey,
    tokenDecimals,
    tokenName,
    totalExposure,
  };
}

function normalizeSnapshot(snapshot: PredictionLaunchSnapshot) {
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
  if (
    snapshot.collateral.toLowerCase() !== ROBINHOOD_USDG_ADDRESS.toLowerCase() ||
    snapshot.feed.toLowerCase() !== ROBINHOOD_BTC_USD_FEED_ADDRESS.toLowerCase()
  ) {
    throw new Error("The prediction factory has unexpected collateral or price feed wiring");
  }
  if (
    snapshot.bootstrapCollateral !== PREDICTION_BOOTSTRAP_USDG_ATOMS ||
    snapshot.minimumDuration !== BigInt(PREDICTION_MINIMUM_DURATION_SECONDS) ||
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
  if (snapshot.ownerCollateralBalance < snapshot.bootstrapCollateral) {
    throw new Error("This wallet needs at least 2 USDG to create the market");
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
  const heads = await Promise.all(clients.map((client) => client.getBlockNumber()));
  const lowestHead = heads[0] < heads[1] ? heads[0] : heads[1];
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
  client,
  config,
  creator,
  expectedSemanticKey,
  transactionHash,
}: {
  client: PredictionMarketPublicClient;
  config: PredictionMarketReleaseConfig;
  creator: Address;
  expectedSemanticKey: Hex;
  transactionHash: Hex;
}): Promise<ConfirmedPredictionMarket> {
  const receipt = await client.waitForTransactionReceipt({
    confirmations: 2,
    hash: transactionHash,
    timeout: 120_000,
  });
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

  const [vault, checkpoint, poolId] = await client.readContract({
    address: config.factoryAddress,
    abi: factoryReadAbi,
    blockNumber: receipt.blockNumber,
    functionName: "markets",
    args: [expectedSemanticKey],
  });
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

export async function requestPredictionMarketSourceMatches(
  market: ConfirmedPredictionMarket,
): Promise<readonly PredictionSourceMatchRequest[]> {
  const addresses = [
    market.vault,
    market.checkpoint,
    market.yesToken,
    market.noToken,
  ] as const;

  return Promise.all(
    addresses.map(async (address) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(
          `https://sourcify.dev/server/v2/verify/similarity/${robinhoodChain.id}/${address}`,
          {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              creationTransactionHash: market.transactionHash,
            }),
            signal: controller.signal,
          },
        );
        return {
          accepted: response.ok || response.status === 202,
          address,
          status: response.status,
        };
      } catch {
        return {
          accepted: false,
          address,
          status: null,
        };
      } finally {
        window.clearTimeout(timeout);
      }
    }),
  );
}
