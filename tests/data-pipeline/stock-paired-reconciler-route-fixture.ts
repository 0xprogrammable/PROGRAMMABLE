import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  parseAbiParameters,
  type Abi,
  type AbiEvent,
  type AbiParameter,
  type Address,
  type Hex,
} from "viem";

import { stateViewReadAbi, uerc20ReadAbi } from "../../lib/onchain/abis";
import {
  getStockPairedExpectedInitialTickForRelease,
  getStockPairedQuoteAssetsForRelease,
  stockFeeSplitVaultAbi,
  stockPairedEthLaunchCoordinatorAbi,
  stockPairedHookAbi,
  stockQuoteRegistryAbi,
  STOCK_PAIRED_CREATOR_FEE_BPS,
  STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
  STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
} from "../../lib/stock-paired";
import {
  resolveVerifiedStockPairedRelease,
  resolveVerifiedStockPairedV2Release,
  resolveVerifiedStockPairedV3Release,
  type VerifiedStockPairedRelease,
} from "../../lib/stock-paired-release";
import type {
  ExactBlockRpcCall,
  ExactBlockRpcClient,
  ExactBlockRpcLog,
  ExactBlockRpcReceipt,
  ExactBlockRpcTransaction,
} from "../../lib/data-pipeline/reconciler-exact-block-reader.server";
import type { HexBytes32 } from "../../lib/data-pipeline/codecs";
import type { ReconcilerPreParityContract } from "../../lib/data-pipeline/reconciler-preparity";
import {
  STOCK_PAIRED_RECONCILER_ROUTE_KEYS,
} from "../../lib/data-pipeline/stock-paired-reconciler-route-builder.server";
import type { StockPairedReconcilerRelease } from "../../lib/data-pipeline/stock-paired-reconciler-contribution";

const TOKEN_SUPPLY = 1_000_000_000n * 10n ** 18n;
const TOKEN = getAddress("0xf111111111111111111111111111111111111111");
const CREATOR = getAddress("0xc111111111111111111111111111111111111111");
const REWARD_VAULT = getAddress("0xd111111111111111111111111111111111111111");
const POSITION_RECIPIENT = getAddress(
  "0xe111111111111111111111111111111111111111",
);
const TRANSACTION_HASH = `0x${"71".repeat(32)}` as HexBytes32;
const BLOCK_HASH = `0x${"72".repeat(32)}` as HexBytes32;
const LAUNCH_HASH = `0x${"73".repeat(32)}` as HexBytes32;
const CREATOR_SALT = `0x${"74".repeat(32)}` as HexBytes32;
const EFFECTIVE_GRAFFITI = `0x${"75".repeat(32)}` as HexBytes32;
const QUOTE_CONFIGURATION_HASH = `0x${"76".repeat(32)}` as HexBytes32;
const FORWARDER_CONFIGURATION_HASH =
  `0x${"77".repeat(32)}` as HexBytes32;
const ENDPOINT_COMMITMENT = `0x${"78".repeat(32)}` as HexBytes32;
const ENDPOINT_ORIGIN_COMMITMENT =
  `0x${"79".repeat(32)}` as HexBytes32;
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as HexBytes32;
const TOTAL_SUPPLY = TOKEN_SUPPLY;
const LOCKED_DUST = 1n;
const TOKEN_LIQUIDITY = TOTAL_SUPPLY - LOCKED_DUST;
const INITIAL_BUY_ETH = 5_000_000_000_000_000n;
const INITIAL_BUY_QUOTE = 1_000_000n;
const INITIAL_BUY_TOKEN = 1_000n * 10n ** 18n;
const SQRT_PRICE_X96 = 79_228_162_514_264_337_593_543_950_336n;
const ACTIVE_LIQUIDITY = 123_456_789n;
const FEE_GROSS_QUOTE = 1_000_000n;

const launchedEvent = parseAbiItem(
  "event StockPairedTokenLaunched(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,address rewardVault,address positionRecipient,uint256 positionTokenId,bytes32 launchHash)",
);
const liquidityEvent = parseAbiItem(
  "event StockPairedLiquidityConfigured(address indexed token,address indexed quoteAsset,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);
const initialBuyEvent = parseAbiItem(
  "event StockPairedCreatorInitialBuy(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,uint256 quoteAmount,uint256 tokenAmount,bytes32 launchHash)",
);
const ethLaunchEvent = parseAbiItem(
  "event StockPairedEthTokenLaunched(address indexed creator,address indexed token,address indexed quoteAsset,uint256 initialBuyEthAmount,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount,bytes32 launchHash)",
);
const poolRegisteredEvent = parseAbiItem(
  "event PoolRegistered(bytes32 indexed poolId,address indexed token,address indexed quoteAsset,address rewardVault,address registrar,bool quoteIsCurrency0,bytes32 rewardConfigurationHash,bytes32 quoteConfigurationHash)",
);
const feeDisclosureEvent = parseAbiItem(
  "event PoolFeeDisclosure(bytes32 indexed poolId,address indexed token,address indexed quoteAsset,address rewardVault,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 creatorFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips)",
);
const feeAccruedEvent = parseAbiItem(
  "event QuoteSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,address indexed quoteAsset,bool isBuy,uint256 grossQuoteAmount,uint256 creatorFee,uint256 launcherFee)",
);
const vaultDeployedEvent = parseAbiItem(
  "event QuoteAssetFeeSplitVaultDeployed(address indexed vault,address indexed feeHook,bytes32 indexed poolId,address quoteAsset)",
);
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
);

const launcherStateAbi = parseAbi([
  "function launchHashOf(address token) view returns (bytes32)",
  "function rewardVaultOf(address token) view returns (address)",
  "function quoteAssetOf(address token) view returns (address)",
]);
const rewardVaultFactoryStateAbi = parseAbi([
  "function isFactoryVault(address vault) view returns (bool)",
  "function configurationHashOf(address vault) view returns (bytes32)",
]);
const positionForwarderFactoryStateAbi = parseAbi([
  "function isFactoryForwarder(address forwarder) view returns (bool)",
  "function configurationHashOf(address forwarder) view returns (bytes32)",
]);
const poolKeyParameters = parseAbiParameters(
  "address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks",
);
const rewardConfigurationParameters = parseAbiParameters(
  "uint256 chainId,address vault,address feeHook,address poolManager,address quoteAsset,bytes32 poolId,address[] beneficiaries,uint16[] sharesBps",
);

export type StockPairedReconcilerFixtureMutation =
  | "runtime"
  | "quote-configuration"
  | "receipt-provenance"
  | "transaction-provenance"
  | "companion-launch-hash"
  | "forwarder-provenance";

export type StockPairedReconcilerFixture = Readonly<{
  release: VerifiedStockPairedRelease;
  contract: ReconcilerPreParityContract;
  blockNumber: bigint;
  blockHash: HexBytes32;
  rpc: ExactBlockRpcClient;
  expected: Readonly<{
    token: Address;
    creator: Address;
    quoteAsset: Address;
    poolId: HexBytes32;
    grossQuoteRaw: string;
  }>;
  observations: Readonly<{
    codeBlockHashes: HexBytes32[];
    callBlockHashes: HexBytes32[];
    timestampExpectedHashes: Array<HexBytes32 | undefined>;
  }>;
}>;

function configuredRelease(
  releaseVersion: StockPairedReconcilerRelease,
): VerifiedStockPairedRelease {
  const release = releaseVersion === "stock-paired-v1"
    ? resolveVerifiedStockPairedRelease()
    : releaseVersion === "stock-paired-v2"
      ? resolveVerifiedStockPairedV2Release()
      : resolveVerifiedStockPairedV3Release();
  if (!release) throw new Error(`${releaseVersion} fixture is unavailable`);
  return release;
}

function encodedEvent(
  event: AbiEvent,
  args: Readonly<Record<string, unknown>>,
): Readonly<{ topics: readonly Hex[]; data: Hex }> {
  const topics = encodeEventTopics({
    abi: [event],
    eventName: event.name,
    args,
  }) as readonly Hex[];
  const nonIndexed = event.inputs.filter(
    (input) => !("indexed" in input) || input.indexed !== true,
  ) as readonly AbiParameter[];
  return Object.freeze({
    topics: Object.freeze(topics),
    data: encodeAbiParameters(
      nonIndexed,
      nonIndexed.map((input) => args[input.name!]),
    ),
  });
}

function log(input: Readonly<{
  address: Address;
  event: AbiEvent;
  args: Readonly<Record<string, unknown>>;
  blockNumber: bigint;
  logIndex: number;
}>): ExactBlockRpcLog {
  const encoded = encodedEvent(input.event, input.args);
  return Object.freeze({
    address: input.address,
    blockNumber: input.blockNumber,
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 2,
    logIndex: input.logIndex,
    topics: encoded.topics,
    data: encoded.data,
  });
}

function result(
  abi: Abi,
  functionName: string,
  value: unknown,
): Hex {
  return encodeFunctionResult({
    abi,
    functionName,
    result: value,
  } as never);
}

function poolIdentity(
  token: Address,
  quoteAsset: Address,
  hook: Address,
) {
  const quoteIsCurrency0 = BigInt(quoteAsset) < BigInt(token);
  const currency0 = quoteIsCurrency0 ? quoteAsset : token;
  const currency1 = quoteIsCurrency0 ? token : quoteAsset;
  return Object.freeze({
    quoteIsCurrency0,
    poolId: keccak256(encodeAbiParameters(poolKeyParameters, [
      currency0,
      currency1,
      0,
      200,
      hook,
    ])) as HexBytes32,
  });
}

function topicsMatch(
  logTopics: readonly Hex[],
  requested: readonly (Hex | readonly Hex[] | null)[] | undefined,
): boolean {
  if (!requested) return true;
  return requested.every((filter, index) => {
    if (filter === null) return true;
    const actual = (logTopics[index] ?? "").toLowerCase();
    return Array.isArray(filter)
      ? filter.some((candidate) => candidate.toLowerCase() === actual)
      : (filter as Hex).toLowerCase() === actual;
  });
}

export function stockPairedReconcilerRouteFixture(
  releaseVersion: StockPairedReconcilerRelease,
  options: Readonly<{
    mutation?: StockPairedReconcilerFixtureMutation;
    feeGrossQuote?: bigint;
  }> = {},
): StockPairedReconcilerFixture {
  const release = configuredRelease(releaseVersion);
  const blockNumber = BigInt(release.startBlock);
  const quoteAsset = getStockPairedQuoteAssetsForRelease(release)[0]!.address;
  const pool = poolIdentity(TOKEN, quoteAsset, release.addresses.feeHook);
  const initialTick = getStockPairedExpectedInitialTickForRelease(
    release,
    quoteAsset,
    pool.quoteIsCurrency0,
  );
  if (initialTick === null) throw new Error("Fixture tick is unavailable");
  const tickLower = pool.quoteIsCurrency0 ? -887_200 : initialTick;
  const tickUpper = pool.quoteIsCurrency0 ? initialTick : 887_200;
  const rewardConfigurationHash = keccak256(encodeAbiParameters(
    rewardConfigurationParameters,
    [
      1n,
      REWARD_VAULT,
      release.addresses.feeHook,
      release.officialDependencies.poolManager.address,
      quoteAsset,
      pool.poolId,
      [CREATOR],
      [10_000],
    ],
  )) as HexBytes32;
  const grossQuote = options.feeGrossQuote ?? FEE_GROSS_QUOTE;
  const totalFee = grossQuote * BigInt(STOCK_PAIRED_TOTAL_SWAP_FEE_BPS) /
    10_000n;
  const launcherFee = grossQuote *
    BigInt(STOCK_PAIRED_PROGRAMMABLE_FEE_BPS) / 10_000n;
  const creatorFee = totalFee - launcherFee;
  const companionLaunchHash = options.mutation === "companion-launch-hash"
    ? ZERO_BYTES32
    : LAUNCH_HASH;

  const logs = [
    log({
      address: release.addresses.feeSplitVaultFactory,
      event: vaultDeployedEvent,
      args: {
        vault: REWARD_VAULT,
        feeHook: release.addresses.feeHook,
        poolId: pool.poolId,
        quoteAsset,
      },
      blockNumber,
      logIndex: 0,
    }),
    log({
      address: release.addresses.feeHook,
      event: poolRegisteredEvent,
      args: {
        poolId: pool.poolId,
        token: TOKEN,
        quoteAsset,
        rewardVault: REWARD_VAULT,
        registrar: release.addresses.launcher,
        quoteIsCurrency0: pool.quoteIsCurrency0,
        rewardConfigurationHash,
        quoteConfigurationHash: QUOTE_CONFIGURATION_HASH,
      },
      blockNumber,
      logIndex: 1,
    }),
    log({
      address: release.addresses.feeHook,
      event: feeDisclosureEvent,
      args: {
        poolId: pool.poolId,
        token: TOKEN,
        quoteAsset,
        rewardVault: REWARD_VAULT,
        buySwapFeeBps: STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
        sellSwapFeeBps: STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
        creatorFeeBps: STOCK_PAIRED_CREATOR_FEE_BPS,
        launcherFeeBps: STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
        transferTaxBps: 0,
        lpFeePips: 0,
      },
      blockNumber,
      logIndex: 2,
    }),
    log({
      address: release.addresses.launcher,
      event: liquidityEvent,
      args: {
        token: TOKEN,
        quoteAsset,
        totalSupply: TOTAL_SUPPLY,
        tokenLiquidityAmount: TOKEN_LIQUIDITY,
        lockedTokenDust: LOCKED_DUST,
        initialTick,
        tickLower,
        tickUpper,
        lpFeePips: 0,
        launchHash: companionLaunchHash,
      },
      blockNumber,
      logIndex: 3,
    }),
    log({
      address: release.addresses.launcher,
      event: initialBuyEvent,
      args: {
        deployer: release.addresses.ethLaunchCoordinator,
        token: TOKEN,
        quoteAsset,
        poolId: pool.poolId,
        quoteAmount: INITIAL_BUY_QUOTE,
        tokenAmount: INITIAL_BUY_TOKEN,
        launchHash: LAUNCH_HASH,
      },
      blockNumber,
      logIndex: 4,
    }),
    log({
      address: release.addresses.launcher,
      event: launchedEvent,
      args: {
        deployer: release.addresses.ethLaunchCoordinator,
        token: TOKEN,
        quoteAsset,
        poolId: pool.poolId,
        rewardVault: REWARD_VAULT,
        positionRecipient: POSITION_RECIPIENT,
        positionTokenId: 42n,
        launchHash: LAUNCH_HASH,
      },
      blockNumber,
      logIndex: 5,
    }),
    log({
      address: release.addresses.ethLaunchCoordinator,
      event: ethLaunchEvent,
      args: {
        creator: CREATOR,
        token: TOKEN,
        quoteAsset,
        initialBuyEthAmount: INITIAL_BUY_ETH,
        initialBuyQuoteAmount: INITIAL_BUY_QUOTE,
        initialBuyTokenAmount: INITIAL_BUY_TOKEN,
        launchHash: LAUNCH_HASH,
      },
      blockNumber,
      logIndex: 6,
    }),
    log({
      address: release.addresses.feeHook,
      event: feeAccruedEvent,
      args: {
        poolId: pool.poolId,
        swapSender: CREATOR,
        quoteAsset,
        isBuy: true,
        grossQuoteAmount: grossQuote,
        creatorFee,
        launcherFee,
      },
      blockNumber,
      logIndex: 7,
    }),
    log({
      address: release.officialDependencies.poolManager.address,
      event: swapEvent,
      args: {
        id: pool.poolId,
        sender: release.addresses.launcher,
        amount0: pool.quoteIsCurrency0 ? -1_000_000n : 1_000n,
        amount1: pool.quoteIsCurrency0 ? 1_000n : -1_000_000n,
        sqrtPriceX96: SQRT_PRICE_X96,
        liquidity: ACTIVE_LIQUIDITY,
        tick: initialTick,
        fee: 0,
      },
      blockNumber,
      logIndex: 8,
    }),
  ] as const;

  const transactionInput = encodeFunctionData({
    abi: stockPairedEthLaunchCoordinatorAbi,
    functionName: "launch",
    args: [{
      minimumQuoteAmountOut: INITIAL_BUY_QUOTE - 1n,
      minimumInitialTokenOut: INITIAL_BUY_TOKEN - 1n,
      deadline: 2_000_000_000n,
      launch: {
        name: "Stock Fixture",
        symbol: "STOCK",
        quoteAsset,
        initialBuyQuoteAmount: 0n,
        creatorSalt: CREATOR_SALT,
        metadata: {
          description: "Exact block Stock-Paired fixture",
          website: "https://programmable.family",
          image: "https://programmable.family/fixture.png",
          extraData: "0x1234",
        },
        rewardBeneficiaries: [CREATOR],
        rewardSharesBps: [10_000],
      },
    }],
  });
  const transaction: ExactBlockRpcTransaction = Object.freeze({
    transactionHash: TRANSACTION_HASH,
    blockNumber,
    blockHash: BLOCK_HASH,
    transactionIndex: 2,
    from: options.mutation === "transaction-provenance"
      ? getAddress("0xa111111111111111111111111111111111111111")
      : CREATOR,
    to: release.addresses.ethLaunchCoordinator,
    input: transactionInput,
    value: INITIAL_BUY_ETH,
  });
  const receiptLogs = logs.map((entry, receiptLogIndex) => Object.freeze({
    ...entry,
    receiptLogIndex,
  })).filter((_entry, index) =>
    options.mutation !== "receipt-provenance" || index !== 1
  );
  const receipt: ExactBlockRpcReceipt = Object.freeze({
    transactionHash: TRANSACTION_HASH,
    blockNumber,
    blockHash: BLOCK_HASH,
    transactionIndex: 2,
    status: 1n,
    logs: Object.freeze(receiptLogs),
  });

  const quoteConfigurationResult = options.mutation === "quote-configuration"
    ? ZERO_BYTES32
    : QUOTE_CONFIGURATION_HASH;
  const forwarderConfigurationResult =
    options.mutation === "forwarder-provenance"
      ? ZERO_BYTES32
      : FORWARDER_CONFIGURATION_HASH;
  const callResults = Object.freeze([
    result(uerc20ReadAbi, "name", "Stock Fixture"),
    result(uerc20ReadAbi, "symbol", "STOCK"),
    result(uerc20ReadAbi, "decimals", 18),
    result(uerc20ReadAbi, "totalSupply", TOTAL_SUPPLY),
    result(uerc20ReadAbi, "creator", release.addresses.launcher),
    result(uerc20ReadAbi, "metadata", [
      "Exact block Stock-Paired fixture",
      "https://programmable.family",
      "https://programmable.family/fixture.png",
      "0x1234",
    ]),
    result(stateViewReadAbi, "getSlot0", [
      SQRT_PRICE_X96,
      initialTick,
      0,
      0,
    ]),
    result(stateViewReadAbi, "getLiquidity", ACTIVE_LIQUIDITY),
    result(stockPairedHookAbi, "feeDisclosure", [
      quoteAsset,
      TOKEN,
      STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
      STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
      STOCK_PAIRED_CREATOR_FEE_BPS,
      STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
      0,
      0,
      REWARD_VAULT,
    ]),
    result(stockPairedHookAbi, "poolFeeConfig", [
      quoteAsset,
      TOKEN,
      REWARD_VAULT,
      release.addresses.launcher,
      pool.quoteIsCurrency0,
      true,
      creatorFee,
    ]),
    result(stockPairedEthLaunchCoordinatorAbi, "predictTokenAddress", [
      TOKEN,
      EFFECTIVE_GRAFFITI,
    ]),
    result(launcherStateAbi, "launchHashOf", LAUNCH_HASH),
    result(launcherStateAbi, "rewardVaultOf", REWARD_VAULT),
    result(launcherStateAbi, "quoteAssetOf", quoteAsset),
    result(rewardVaultFactoryStateAbi, "isFactoryVault", true),
    result(
      rewardVaultFactoryStateAbi,
      "configurationHashOf",
      rewardConfigurationHash,
    ),
    result(stockFeeSplitVaultAbi, "feeHook", release.addresses.feeHook),
    result(stockFeeSplitVaultAbi, "poolId", pool.poolId),
    result(stockFeeSplitVaultAbi, "quoteAsset", quoteAsset),
    result(stockFeeSplitVaultAbi, "configurationHash", rewardConfigurationHash),
    result(stockFeeSplitVaultAbi, "beneficiaryCount", 1n),
    result(stockFeeSplitVaultAbi, "totalCreatorFeesReceived", 0n),
    result(stockFeeSplitVaultAbi, "totalCreatorFeesClaimed", 0n),
    result(stockQuoteRegistryAbi, "isSupported", true),
    result(
      stockQuoteRegistryAbi,
      "assertAssetReady",
      quoteConfigurationResult,
    ),
    result(positionForwarderFactoryStateAbi, "isFactoryForwarder", true),
    result(
      positionForwarderFactoryStateAbi,
      "configurationHashOf",
      forwarderConfigurationResult,
    ),
  ]);

  const runtimeHashes = new Map<string, HexBytes32>();
  for (const [label, expectedHash] of Object.entries(
    release.runtimeCodeHashes,
  )) {
    runtimeHashes.set(
      release.addresses[label as keyof typeof release.addresses].toLowerCase(),
      expectedHash as HexBytes32,
    );
  }
  for (const dependency of Object.values(release.officialDependencies)) {
    runtimeHashes.set(
      dependency.address.toLowerCase(),
      dependency.runtimeCodeHash as HexBytes32,
    );
  }
  runtimeHashes.set(
    release.issuerRuntime.beacon.toLowerCase(),
    release.issuerRuntime.beaconRuntimeCodeHash as HexBytes32,
  );
  runtimeHashes.set(
    release.issuerRuntime.implementation.toLowerCase(),
    release.issuerRuntime.implementationRuntimeCodeHash as HexBytes32,
  );
  if (
    release.issuerRuntime.gmTokenManager &&
    release.issuerRuntime.gmTokenManagerRuntimeCodeHash
  ) {
    runtimeHashes.set(
      release.issuerRuntime.gmTokenManager.toLowerCase(),
      release.issuerRuntime.gmTokenManagerRuntimeCodeHash as HexBytes32,
    );
  }
  runtimeHashes.set(
    quoteAsset.toLowerCase(),
    release.issuerRuntime.tokenRuntimeCodeHash as HexBytes32,
  );
  if (options.mutation === "runtime") {
    runtimeHashes.set(
      release.addresses.launcher.toLowerCase(),
      ZERO_BYTES32,
    );
  }

  const codeBlockHashes: HexBytes32[] = [];
  const callBlockHashes: HexBytes32[] = [];
  const timestampExpectedHashes: Array<HexBytes32 | undefined> = [];
  const rpc: ExactBlockRpcClient = Object.freeze({
    endpointCommitment: ENDPOINT_COMMITMENT,
    endpointOriginCommitment: ENDPOINT_ORIGIN_COMMITMENT,
    requestCount: () => 0,
    logicalRequestCount: () => 0,
    assertCheckpoint: async ({ blockHash }) => {
      if (blockHash !== BLOCK_HASH) throw new Error("checkpoint hash mismatch");
      return 1_700_000_000n;
    },
    call: async () => {
      throw new Error("Unexpected single call");
    },
    callMany: async (input: {
      calls: readonly ExactBlockRpcCall[];
      blockHash: HexBytes32;
    }) => {
      callBlockHashes.push(input.blockHash);
      if (input.calls.length !== callResults.length) {
        throw new Error("Unexpected call cardinality");
      }
      return callResults;
    },
    getCodeHash: async ({ address, blockHash }) => {
      codeBlockHashes.push(blockHash);
      const runtimeHash = runtimeHashes.get(address.toLowerCase());
      if (!runtimeHash) throw new Error(`Missing runtime ${address}`);
      return runtimeHash;
    },
    getLogs: async (input) => {
      const requestedAddresses = new Set(
        (Array.isArray(input.addresses) ? input.addresses : [input.addresses])
          .map((address) => address.toLowerCase()),
      );
      return Object.freeze(logs.filter((entry) =>
        requestedAddresses.has(entry.address.toLowerCase()) &&
        entry.blockNumber >= input.fromBlock &&
        entry.blockNumber <= input.toBlock &&
        topicsMatch(entry.topics, input.topics)
      ));
    },
    getBlockTimestamp: async ({ blockNumber: candidate, expectedHash }) => {
      timestampExpectedHashes.push(expectedHash);
      if (candidate !== blockNumber) throw new Error("block number mismatch");
      return 1_700_000_000n;
    },
    getTransactionReceipt: async () => receipt,
    getTransactionReceipts: async ({ receipts: bindings }) => {
      if (bindings.length !== 1) throw new Error("receipt binding mismatch");
      return Object.freeze([receipt]);
    },
    getTransaction: async () => transaction,
    getTransactions: async ({ transactions: bindings }) => {
      if (bindings.length !== 1) throw new Error("transaction binding mismatch");
      return Object.freeze([transaction]);
    },
  });
  const contract: ReconcilerPreParityContract = Object.freeze({
    chainId: "1",
    releaseId: releaseVersion,
    modelId: "stock-paired",
    sourceGroup: "ethereum-mainnet",
    projectorVersion: "projector-v1",
    epochId: "10000000-0000-4000-8000-000000000001",
    pointerGeneration: "7",
    checkpointId: "10000000-0000-4000-8000-000000000002",
    checkpointGeneration: "8",
    reorgGeneration: "2",
    checkpointBlockNumber: blockNumber.toString(),
    checkpointBlockHash: BLOCK_HASH,
    routeKeys: STOCK_PAIRED_RECONCILER_ROUTE_KEYS,
    routeContract: { exact: true },
    projectionContract: { exact: true },
    currentEntities: [],
  });

  return Object.freeze({
    release,
    contract,
    blockNumber,
    blockHash: BLOCK_HASH,
    rpc,
    expected: Object.freeze({
      token: TOKEN,
      creator: CREATOR,
      quoteAsset,
      poolId: pool.poolId,
      grossQuoteRaw: grossQuote.toString(),
    }),
    observations: Object.freeze({
      codeBlockHashes,
      callBlockHashes,
      timestampExpectedHashes,
    }),
  });
}
