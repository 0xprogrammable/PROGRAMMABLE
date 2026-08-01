import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  parseAbi,
  parseAbiItem,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

vi.mock("server-only", () => ({}));

import deployment from "../../contracts/deployments/mainnet-classic-v2.json";
import dependencies from "../../contracts/dependencies/ethereum-mainnet.json";
import {
  assertClassicV2ReconcilerLaunchCount,
  buildClassicV2ExactBlockContribution,
  CLASSIC_V2_RECONCILER_LOG_BLOCK_RANGE,
  CLASSIC_V2_RECONCILER_ROUTE_KEYS,
  classicV2ReconcilerBlockRanges,
} from "../../lib/data-pipeline/classic-v2-reconciler-route-builder.server";
import type {
  ExactBlockRpcClient,
  ExactBlockRpcLog,
  ExactBlockRpcReceipt,
  ExactBlockRpcTransaction,
} from "../../lib/data-pipeline/reconciler-exact-block-reader.server";
import type { ReconcilerPreParityContract } from "../../lib/data-pipeline/reconciler-preparity";
import {
  creatorFeeHookReadAbi,
  stateViewReadAbi,
  uerc20ReadAbi,
} from "../../lib/onchain/abis";

const ZERO_ADDRESS = `0x${"00".repeat(20)}` as Address;
const TOKEN = getAddress(`0x${"11".repeat(20)}`);
const CREATOR = getAddress(`0x${"22".repeat(20)}`);
const POSITION_RECIPIENT = getAddress(`0x${"33".repeat(20)}`);
const SWAP_SENDER = getAddress(`0x${"44".repeat(20)}`);
const POOL_ID = `0x${"55".repeat(32)}` as const;
const LAUNCH_HASH = `0x${"66".repeat(32)}` as const;
const CREATOR_SALT = `0x${"77".repeat(32)}` as const;
const EFFECTIVE_GRAFFITI = `0x${"88".repeat(32)}` as const;
const LAUNCH_TRANSACTION = `0x${"99".repeat(32)}` as const;
const LAUNCH_BLOCK_HASH = `0x${"aa".repeat(32)}` as const;
const SWAP_TRANSACTION = `0x${"bb".repeat(32)}` as const;
const TINY_SWAP_TRANSACTION = `0x${"bc".repeat(32)}` as const;
const SECOND_SWAP_TRANSACTION = `0x${"bd".repeat(32)}` as const;
const SWAP_BLOCK_HASH = `0x${"cc".repeat(32)}` as const;
const CHECKPOINT_HASH = `0x${"dd".repeat(32)}` as const;
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
const TOKEN_LIQUIDITY = TOTAL_SUPPLY - 1n;
const INITIAL_BUY_WEI = 1_000_000_000_000_000n;
const SQRT_PRICE_X96 = 79_228_162_514_264_337_593_543_950_336n;

const launcherAbi = parseAbi([
  "function launch((string name,string symbol,uint16 totalSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata) parameters) payable",
  "function predictTokenAddress(string name,string symbol,address creator,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function predictPositionRecipient(address token,address creator) view returns (address)",
  "function poolKey(address token) view returns (address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
  "function launchHashOf(address token) view returns (bytes32)",
  "function poolManager() view returns (address)",
  "function feeHook() view returns (address)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
]);
const hookInfrastructureAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function TICK_SPACING() view returns (int24)",
]);

const launchedEvent = parseAbiItem(
  "event MemeTokenLaunched(address indexed creator,address indexed token,bytes32 indexed poolId,address feeHook,address positionRecipient,uint256 positionTokenId,uint16 totalSwapFeeBps,bytes32 launchHash)",
);
const liquidityEvent = parseAbiItem(
  "event MemeLiquidityConfigured(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);
const initialBuyEvent = parseAbiItem(
  "event MemeCreatorInitialBuy(address indexed creator,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)",
);
const registeredEvent = parseAbiItem(
  "event PoolRegistered(bytes32 indexed poolId,address indexed token,address indexed creator,address registrar,uint16 totalSwapFeeBps)",
);
const disclosureEvent = parseAbiItem(
  "event PoolFeeDisclosure(bytes32 indexed poolId,address indexed token,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips)",
);
const feeAccruedEvent = parseAbiItem(
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
);
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
);

type Mutation =
  | "none"
  | "runtime"
  | "calldata"
  | "receipt"
  | "fee"
  | "state"
  | "provenance"
  | "log-order"
  | "tiny-swap"
  | "missing-fee"
  | "extra-fee"
  | "duplicate-fee"
  | "reordered-fees";

function eventLog(input: {
  event: AbiEvent;
  args: Readonly<Record<string, unknown>>;
  address: Address;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;
}): ExactBlockRpcLog {
  const topics = encodeEventTopics({
    abi: [input.event],
    eventName: input.event.name,
    args: input.args,
  } as never);
  const nonIndexed = input.event.inputs.filter((item) => !item.indexed);
  const values = nonIndexed.map((item) => input.args[item.name!]);
  const data = encodeAbiParameters(nonIndexed, values as never);
  return Object.freeze({
    address: input.address,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    transactionHash: input.transactionHash,
    transactionIndex: input.transactionIndex,
    logIndex: input.logIndex,
    topics: Object.freeze(topics as readonly Hex[]),
    data,
  });
}

function encodedResult(
  abi: Abi,
  functionName: string,
  result: unknown,
): Hex {
  return encodeFunctionResult({ abi, functionName, result } as never);
}

function fixture(mutation: Mutation = "none") {
  const launcher = getAddress(deployment.addresses.memeLauncher);
  const hook = getAddress(deployment.addresses.feeHook);
  const poolManager = getAddress(dependencies.contracts.poolManager.address);
  const treasury = getAddress(deployment.addresses.treasury);
  const startBlock = BigInt(deployment.transactions.memeLauncher.blockNumber);
  const launchBlock = startBlock + 1n;
  const swapBlock = startBlock + 2n;
  const checkpointBlock = startBlock + 5n;

  const registrationLog = eventLog({
    event: registeredEvent,
    args: {
      poolId: POOL_ID,
      token: TOKEN,
      creator: CREATOR,
      registrar: launcher,
      totalSwapFeeBps: 100,
    },
    address: hook,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: LAUNCH_TRANSACTION,
    transactionIndex: 2,
    logIndex: 0,
  });
  const disclosureLog = eventLog({
    event: disclosureEvent,
    args: {
      poolId: POOL_ID,
      token: TOKEN,
      buySwapFeeBps: 100,
      sellSwapFeeBps: 100,
      launcherFeeBps: 10,
      transferTaxBps: 0,
      lpFeePips: 0,
    },
    address: hook,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: LAUNCH_TRANSACTION,
    transactionIndex: 2,
    logIndex: 1,
  });
  const liquidityLog = eventLog({
    event: liquidityEvent,
    args: {
      token: TOKEN,
      totalSupply: TOTAL_SUPPLY,
      tokenLiquidityAmount: TOKEN_LIQUIDITY,
      lockedTokenDust: 1n,
      initialTick: 204_200,
      tickLower: -887_200,
      tickUpper: 204_200,
      lpFeePips: 0,
      launchHash: LAUNCH_HASH,
    },
    address: launcher,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: LAUNCH_TRANSACTION,
    transactionIndex: 2,
    logIndex: 2,
  });
  const initialBuyLog = eventLog({
    event: initialBuyEvent,
    args: {
      creator: CREATOR,
      token: TOKEN,
      poolId: POOL_ID,
      nativeAmount: INITIAL_BUY_WEI,
      tokenAmount: 10_000n,
      launchHash: LAUNCH_HASH,
    },
    address: launcher,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: LAUNCH_TRANSACTION,
    transactionIndex: 2,
    logIndex: 3,
  });
  const launchLog = eventLog({
    event: launchedEvent,
    args: {
      creator: CREATOR,
      token: TOKEN,
      poolId: POOL_ID,
      feeHook: hook,
      positionRecipient: POSITION_RECIPIENT,
      positionTokenId: 42n,
      totalSwapFeeBps: 100,
      launchHash: LAUNCH_HASH,
    },
    address: launcher,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: LAUNCH_TRANSACTION,
    transactionIndex: 2,
    logIndex: 4,
  });
  const feeLog = eventLog({
    event: feeAccruedEvent,
    args: {
      poolId: POOL_ID,
      swapSender: SWAP_SENDER,
      grossNativeAmount: 1_000_000n,
      creatorFee: mutation === "fee" ? 8_999n : 9_000n,
      launcherFee: 1_000n,
    },
    address: hook,
    blockNumber: swapBlock,
    blockHash: SWAP_BLOCK_HASH,
    transactionHash: SWAP_TRANSACTION,
    transactionIndex: 3,
    logIndex: 0,
  });
  const swapLog = eventLog({
    event: swapEvent,
    args: {
      id: POOL_ID,
      sender: SWAP_SENDER,
      amount0: -1_000_000n,
      amount1: -1n,
      sqrtPriceX96: SQRT_PRICE_X96,
      liquidity: 1_000_000n,
      tick: 0,
      fee: 0,
    },
    address: poolManager,
    blockNumber: swapBlock,
    blockHash: SWAP_BLOCK_HASH,
    transactionHash: mutation === "provenance"
      ? (`0x${"ee".repeat(32)}` as const)
      : SWAP_TRANSACTION,
    transactionIndex: 3,
    logIndex: mutation === "reordered-fees" ? 3 : 1,
  });
  const tinySwapLog = eventLog({
    event: swapEvent,
    args: {
      id: POOL_ID,
      sender: SWAP_SENDER,
      amount0: -1n,
      amount1: 1n,
      sqrtPriceX96: SQRT_PRICE_X96,
      liquidity: 1_000_000n,
      tick: 0,
      fee: 0,
    },
    address: poolManager,
    blockNumber: swapBlock,
    blockHash: SWAP_BLOCK_HASH,
    transactionHash: TINY_SWAP_TRANSACTION,
    transactionIndex: 2,
    logIndex: 0,
  });
  const secondFeeLog = eventLog({
    event: feeAccruedEvent,
    args: {
      poolId: POOL_ID,
      swapSender: SWAP_SENDER,
      grossNativeAmount: 2_000_000n,
      creatorFee: 18_000n,
      launcherFee: 2_000n,
    },
    address: hook,
    blockNumber: swapBlock,
    blockHash: SWAP_BLOCK_HASH,
    transactionHash: mutation === "reordered-fees"
      ? SWAP_TRANSACTION
      : SECOND_SWAP_TRANSACTION,
    transactionIndex: mutation === "reordered-fees" ? 3 : 4,
    logIndex: mutation === "reordered-fees" ? 2 : 0,
  });
  const secondSwapLog = eventLog({
    event: swapEvent,
    args: {
      id: POOL_ID,
      sender: SWAP_SENDER,
      amount0: -2_000_000n,
      amount1: 2n,
      sqrtPriceX96: SQRT_PRICE_X96,
      liquidity: 1_000_000n,
      tick: 0,
      fee: 0,
    },
    address: poolManager,
    blockNumber: swapBlock,
    blockHash: SWAP_BLOCK_HASH,
    transactionHash: mutation === "reordered-fees"
      ? SWAP_TRANSACTION
      : SECOND_SWAP_TRANSACTION,
    transactionIndex: mutation === "reordered-fees" ? 3 : 4,
    logIndex: 1,
  });
  const duplicateFeeLog = eventLog({
    event: feeAccruedEvent,
    args: {
      poolId: POOL_ID,
      swapSender: SWAP_SENDER,
      grossNativeAmount: 1_000_000n,
      creatorFee: 9_000n,
      launcherFee: 1_000n,
    },
    address: hook,
    blockNumber: swapBlock,
    blockHash: SWAP_BLOCK_HASH,
    transactionHash: SWAP_TRANSACTION,
    transactionIndex: 3,
    logIndex: 2,
  });

  const launchParameters = {
    name: mutation === "calldata" ? "Wrong" : "Fixture Token",
    symbol: "FIX",
    totalSwapFeeBps: 100,
    creatorSalt: CREATOR_SALT,
    metadata: {
      description: "Fixture description",
      website: "https://example.com",
      image: "https://example.com/image.png",
      extraData: "0x",
    },
  } as const;
  const transaction: ExactBlockRpcTransaction = Object.freeze({
    transactionHash: LAUNCH_TRANSACTION,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionIndex: 2,
    from: CREATOR,
    to: launcher,
    input: encodeFunctionData({
      abi: launcherAbi,
      functionName: "launch",
      args: [launchParameters],
    }),
    value: INITIAL_BUY_WEI,
  });
  const receiptSourceLogs = [
    registrationLog,
    disclosureLog,
    liquidityLog,
    initialBuyLog,
    launchLog,
  ];
  if (mutation === "receipt") receiptSourceLogs.splice(2, 1);
  const receipt: ExactBlockRpcReceipt = Object.freeze({
    transactionHash: LAUNCH_TRANSACTION,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionIndex: 2,
    status: 1n,
    logs: Object.freeze(receiptSourceLogs.map((log, receiptLogIndex) =>
      Object.freeze({ ...log, receiptLogIndex })
    )),
  });

  const runtimeHashes = [
    deployment.runtimeCodeHashes.hookFactory,
    deployment.runtimeCodeHashes.feeHook,
    deployment.runtimeCodeHashes.memeLauncher,
    deployment.runtimeCodeHashes.positionForwarderFactory,
    dependencies.contracts.poolManager.runtimeCodeHash,
    dependencies.contracts.stateView.runtimeCodeHash,
  ] as readonly `0x${string}`[];
  let runtimeCursor = 0;
  let callBatch = 0;
  const rpc: ExactBlockRpcClient = Object.freeze({
    endpointCommitment: `0x${"01".repeat(32)}`,
    endpointOriginCommitment: `0x${"02".repeat(32)}`,
    requestCount: () => 0,
    logicalRequestCount: () => 0,
    createPartitionClient: () => rpc,
    assertCheckpoint: async () => 1_700_000_000n,
    call: async () => {
      throw new Error("unexpected single call");
    },
    async callMany({ calls, blockHash }) {
      expect(blockHash).toBe(CHECKPOINT_HASH);
      callBatch += 1;
      if (callBatch === 1) {
        expect(calls).toHaveLength(8);
        return Object.freeze([
          encodedResult(launcherAbi, "poolManager", poolManager),
          encodedResult(launcherAbi, "feeHook", hook),
          encodedResult(launcherAbi, "MIN_INITIAL_BUY_WEI", 600_000_000_000_000n),
          encodedResult(hookInfrastructureAbi, "poolManager", poolManager),
          encodedResult(hookInfrastructureAbi, "launcherFeeRecipient", treasury),
          encodedResult(creatorFeeHookReadAbi, "LAUNCHER_FEE_BPS", 10),
          encodedResult(creatorFeeHookReadAbi, "LP_FEE_PIPS", 0),
          encodedResult(hookInfrastructureAbi, "TICK_SPACING", 200),
        ]);
      }
      expect(callBatch).toBe(2);
      expect(calls).toHaveLength(14);
      return Object.freeze([
        encodedResult(
          uerc20ReadAbi,
          "name",
          mutation === "state" ? "Wrong state" : "Fixture Token",
        ),
        encodedResult(uerc20ReadAbi, "symbol", "FIX"),
        encodedResult(uerc20ReadAbi, "decimals", 18),
        encodedResult(uerc20ReadAbi, "totalSupply", TOTAL_SUPPLY),
        encodedResult(uerc20ReadAbi, "creator", launcher),
        encodedResult(uerc20ReadAbi, "metadata", [
          "Fixture description",
          "https://example.com",
          "https://example.com/image.png",
          "0x",
        ]),
        encodedResult(stateViewReadAbi, "getSlot0", [
          SQRT_PRICE_X96,
          0,
          0,
          0,
        ]),
        encodedResult(stateViewReadAbi, "getLiquidity", 1_000_000n),
        encodedResult(creatorFeeHookReadAbi, "feeDisclosure", [
          100,
          100,
          90,
          10,
          0,
          0,
        ]),
        encodedResult(creatorFeeHookReadAbi, "poolFeeConfig", [
          CREATOR,
          launcher,
          100,
          true,
          9_000n,
        ]),
        encodedResult(launcherAbi, "launchHashOf", LAUNCH_HASH),
        encodedResult(launcherAbi, "predictTokenAddress", [
          TOKEN,
          EFFECTIVE_GRAFFITI,
        ]),
        encodedResult(
          launcherAbi,
          "predictPositionRecipient",
          POSITION_RECIPIENT,
        ),
        encodedResult(launcherAbi, "poolKey", [
          ZERO_ADDRESS,
          TOKEN,
          0,
          200,
          hook,
        ]),
      ]);
    },
    async getCodeHash({ blockHash }) {
      expect(blockHash).toBe(CHECKPOINT_HASH);
      const expected = runtimeHashes[runtimeCursor++]!;
      return mutation === "runtime" && runtimeCursor === 1
        ? (`0x${"03".repeat(32)}` as const)
        : expected;
    },
    async getLogs({ addresses, fromBlock, toBlock, maximumLogs }) {
      expect(toBlock - fromBlock).toBeLessThan(CLASSIC_V2_RECONCILER_LOG_BLOCK_RANGE);
      expect(maximumLogs).toBe(20_000);
      const values = (Array.isArray(addresses) ? addresses : [addresses])
        .map((address) => address.toLowerCase());
      if (values.includes(launcher.toLowerCase())) {
        const logs = [liquidityLog, initialBuyLog, launchLog];
        return Object.freeze(mutation === "log-order"
          ? [logs[1]!, logs[0]!, logs[2]!]
          : logs);
      }
      if (values.includes(hook.toLowerCase())) {
        const logs = [registrationLog, disclosureLog];
        if (mutation !== "missing-fee") logs.push(feeLog);
        if (mutation === "extra-fee" || mutation === "reordered-fees") {
          logs.push(secondFeeLog);
        }
        if (mutation === "duplicate-fee") logs.push(duplicateFeeLog);
        return Object.freeze(logs);
      }
      expect(values).toContain(poolManager.toLowerCase());
      if (mutation === "tiny-swap") {
        return Object.freeze([tinySwapLog, swapLog]);
      }
      if (mutation === "reordered-fees") {
        return Object.freeze([secondSwapLog, swapLog]);
      }
      return Object.freeze([swapLog]);
    },
    getBlockTimestamp: async () => 1_700_000_000n,
    getTransactionReceipt: async () => receipt,
    getTransactionReceipts: async () => Object.freeze([receipt]),
    getTransaction: async () => transaction,
    getTransactions: async () => Object.freeze([transaction]),
  });
  const contract: ReconcilerPreParityContract = Object.freeze({
    chainId: "1",
    releaseId: "classic-v2",
    modelId: "classic",
    sourceGroup: "core",
    projectorVersion: "projector-v1",
    epochId: "10000000-0000-4000-8000-000000000001",
    pointerGeneration: "1",
    checkpointId: "10000000-0000-4000-8000-000000000002",
    checkpointGeneration: "1",
    reorgGeneration: "0",
    checkpointBlockNumber: checkpointBlock.toString(),
    checkpointBlockHash: CHECKPOINT_HASH,
    routeKeys: CLASSIC_V2_RECONCILER_ROUTE_KEYS,
    routeContract: {},
    projectionContract: {},
    currentEntities: [{
      entityKind: "launch",
      entityKey: TOKEN.toLowerCase(),
    }],
  });
  return { rpc, contract, checkpointBlock };
}

describe("Classic V2 exact-block contribution builder", () => {
  it("builds deterministic token and chart contributions at one exact checkpoint", async () => {
    const { rpc, contract, checkpointBlock } = fixture();
    const contribution = await buildClassicV2ExactBlockContribution({
      rpc,
      contract,
      blockNumber: checkpointBlock,
      blockHash: CHECKPOINT_HASH,
      signal: new AbortController().signal,
    });

    expect(Object.keys(contribution).sort()).toEqual(["charts", "tokens"]);
    expect(contribution.tokens).toHaveLength(1);
    expect(contribution.charts).toHaveLength(1);
    expect(contribution.tokens[0]).toMatchObject({
      releaseVersion: "classic-v2",
      modelId: "classic",
      tokenAddress: TOKEN.toLowerCase(),
      creatorAddress: CREATOR.toLowerCase(),
      rewardVaultAddress: null,
      quoteAssetAddress: ZERO_ADDRESS,
      launchLogIndex: 4,
    });
    expect(contribution.charts[0]).toMatchObject({
      releaseVersion: "classic-v2",
      modelId: "classic",
      tokenAddress: TOKEN.toLowerCase(),
      quoteAssetAddress: ZERO_ADDRESS,
      state: {
        transactionHash: SWAP_TRANSACTION,
        blockHash: SWAP_BLOCK_HASH,
        sqrtPriceX96: SQRT_PRICE_X96.toString(),
      },
      volume: {
        quoteAssetAddress: ZERO_ADDRESS,
        grossQuoteRaw: "1000000",
        creatorFeeQuoteRaw: "9000",
        launcherFeeQuoteRaw: "1000",
      },
    });
  });

  it("accepts a 1-wei swap whose rounded fee is zero and emits no fee event", async () => {
    const { rpc, contract, checkpointBlock } = fixture("tiny-swap");
    const contribution = await buildClassicV2ExactBlockContribution({
      rpc,
      contract,
      blockNumber: checkpointBlock,
      blockHash: CHECKPOINT_HASH,
      signal: new AbortController().signal,
    });

    expect(contribution.charts[0]).toMatchObject({
      state: { transactionHash: SWAP_TRANSACTION },
      volume: {
        grossQuoteRaw: "1000000",
        creatorFeeQuoteRaw: "9000",
        launcherFeeQuoteRaw: "1000",
      },
    });
  });

  it.each([
    ["runtime hash", "runtime"],
    ["launch calldata", "calldata"],
    ["receipt companion", "receipt"],
    ["fee conservation", "fee"],
    ["current state", "state"],
    ["swap provenance", "provenance"],
    ["log ordering", "log-order"],
    ["missing nonzero rounded fee event", "missing-fee"],
    ["extra fee event", "extra-fee"],
    ["duplicate fee event", "duplicate-fee"],
    ["reordered fee events", "reordered-fees"],
  ] as const)("fails closed on a bad %s", async (_label, mutation) => {
    const { rpc, contract, checkpointBlock } = fixture(mutation);
    await expect(buildClassicV2ExactBlockContribution({
      rpc,
      contract,
      blockNumber: checkpointBlock,
      blockHash: CHECKPOINT_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("uses non-overlapping provider-portable 10,000-block ranges", () => {
    expect(CLASSIC_V2_RECONCILER_LOG_BLOCK_RANGE).toBe(10_000n);
    expect(classicV2ReconcilerBlockRanges(100n, 10_099n)).toEqual([
      { fromBlock: 100n, toBlock: 10_099n },
    ]);
    expect(classicV2ReconcilerBlockRanges(100n, 10_100n)).toEqual([
      { fromBlock: 100n, toBlock: 10_099n },
      { fromBlock: 10_100n, toBlock: 10_100n },
    ]);
  });

  it("accepts growth beyond the former 256-launch boundary", () => {
    expect([1, 128, 256, 257, 10_000].map(
      assertClassicV2ReconcilerLaunchCount,
    )).toEqual([1, 128, 256, 257, 10_000]);
    expect(() => assertClassicV2ReconcilerLaunchCount(0)).toThrow();
  });
});
