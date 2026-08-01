import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

vi.mock("server-only", () => ({}));

import {
  buildClassicV3ExactBlockRoutes,
  assertClassicV3ReconcilerLaunchCount,
  classicV3ReconcilerBlockRanges,
  CLASSIC_V3_RECONCILER_LOG_BLOCK_RANGE,
  MAXIMUM_CLASSIC_V3_RECONCILER_LAUNCHES,
} from "../../lib/data-pipeline/classic-v3-reconciler-route-builder.server";
import {
  CLASSIC_V3_RECONCILER_ROUTE_CONTRACT,
} from "../../lib/data-pipeline/classic-v3-reconciler-route-contract";
import {
  classicRewardVaultAbi,
  classicV3HookAbi,
  classicV3LaunchAbi,
} from "../../lib/classic-v3";
import { getConfiguredClassicV3Release } from "../../lib/classic-v3-release";
import dependencies from "../../contracts/dependencies/ethereum-mainnet.json";
import type {
  ExactBlockRpcClient,
  ExactBlockRpcLog,
  ExactBlockRpcReceipt,
  ExactBlockRpcTransaction,
} from "../../lib/data-pipeline/reconciler-exact-block-reader.server";
import {
  RECONCILER_ROUTE_KEYS,
  type ReconcilerPreParityContract,
} from "../../lib/data-pipeline/reconciler-preparity";
import { stateViewReadAbi, uerc20ReadAbi } from "../../lib/onchain/abis";

const ZERO_ADDRESS = `0x${"00".repeat(20)}` as Address;
const TOKEN = getAddress(`0x${"11".repeat(20)}`);
const DEPLOYER = getAddress(`0x${"22".repeat(20)}`);
const VAULT = getAddress(`0x${"33".repeat(20)}`);
const BENEFICIARY = getAddress(`0x${"44".repeat(20)}`);
const REPLACEMENT = getAddress(`0x${"45".repeat(20)}`);
const CTO_BENEFICIARY = getAddress(`0x${"46".repeat(20)}`);
const POSITION_RECIPIENT = getAddress(`0x${"55".repeat(20)}`);
const SWAP_SENDER = getAddress(`0x${"66".repeat(20)}`);
const POOL_ID = `0x${"77".repeat(32)}` as const;
const CONFIGURATION_HASH = `0x${"88".repeat(32)}` as const;
const LAUNCH_HASH = `0x${"99".repeat(32)}` as const;
const CREATOR_SALT = `0x${"aa".repeat(32)}` as const;
const LAUNCH_TRANSACTION = `0x${"bb".repeat(32)}` as const;
const LAUNCH_BLOCK_HASH = `0x${"cc".repeat(32)}` as const;
const SWAP_TRANSACTION = `0x${"dd".repeat(32)}` as const;
const TINY_SWAP_TRANSACTION = `0x${"de".repeat(32)}` as const;
const SECOND_SWAP_TRANSACTION = `0x${"df".repeat(32)}` as const;
const HISTORY_TRANSACTION = `0x${"e0".repeat(32)}` as const;
const SWAP_BLOCK_HASH = `0x${"ee".repeat(32)}` as const;
const CHECKPOINT_HASH = `0x${"ff".repeat(32)}` as const;
const APPROVAL_REFERENCE = `0x${"ab".repeat(32)}` as const;
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
const TOKEN_LIQUIDITY = TOTAL_SUPPLY - 1n;
const SQRT_PRICE_X96 = 79_228_162_514_264_337_593_543_950_336n;

const launchedEvent = parseAbiItem(
  "event MemeTokenLaunchedV2(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address rewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 rewardConfigurationHash,bytes32 launchHash)",
);
const liquidityEvent = parseAbiItem(
  "event MemeLiquidityConfiguredV2(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);
const initialBuyEvent = parseAbiItem(
  "event MemeCreatorInitialBuyV2(address indexed deployer,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)",
);
const custodyEvent = parseAbiItem(
  "event MemeCreatorInitialBuyCustodyV2(address indexed deployer,address indexed token,address indexed custody,uint8 mode,uint16 durationDays,uint16 cliffDays,bytes32 configurationHash,bytes32 launchHash)",
);
const registeredEvent = parseAbiItem(
  "event PoolRegistered(bytes32 indexed poolId,address indexed token,address indexed rewardVault,address registrar,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 rewardConfigurationHash)",
);
const disclosureEvent = parseAbiItem(
  "event PoolFeeDisclosure(bytes32 indexed poolId,address indexed token,address indexed rewardVault,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips)",
);
const feeAccruedEvent = parseAbiItem(
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,bool indexed isBuy,uint16 appliedTotalSwapFeeBps,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
);
const vaultDeployedEvent = parseAbiItem(
  "event ClassicRewardVaultDeployed(address indexed vault,bytes32 indexed poolId,address indexed feeHook,bytes32 salt,bytes32 configurationHash)",
);
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
);
const checkpointEvent = parseAbiItem(
  "event CreatorFeesCheckpointed(bytes32 indexed poolId,uint64 indexed configurationEpoch,uint256 amount,uint256 totalCreatorFeesReceived)",
);
const payoutChangedEvent = parseAbiItem(
  "event PayoutWalletChanged(bytes32 indexed poolId,uint256 indexed allocationIndex,address indexed previousPayoutWallet,address newPayoutWallet,uint16 shareBps,uint64 configurationEpoch,bytes32 activeConfigurationHash,uint256 effectiveTotalCreatorFeesReceived)",
);
const ctoActivatedEvent = parseAbiItem(
  "event CtoRewardConfigurationActivated(bytes32 indexed poolId,bytes32 indexed approvalReference,uint64 indexed configurationEpoch,bytes32 previousConfigurationHash,bytes32 newConfigurationHash,address[] beneficiaries,uint16[] sharesBps,uint256 effectiveTotalCreatorFeesReceived)",
);

const vaultFactoryAbi = parseAbi([
  "function isFactoryVault(address vault) view returns (bool)",
  "function configurationHashOf(address vault) view returns (bytes32)",
]);

type Mutation =
  | "none"
  | "runtime"
  | "calldata"
  | "receipt"
  | "fee"
  | "direction"
  | "reward"
  | "log-order"
  | "tiny-swap"
  | "missing-fee"
  | "extra-fee"
  | "duplicate-fee"
  | "reordered-fees"
  | "payout-history"
  | "cto-history";

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
    blockHash: input.blockHash as `0x${string}`,
    transactionHash: input.transactionHash as `0x${string}`,
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
  const configured = getConfiguredClassicV3Release("production");
  const app = configured.appManifest;
  const launcher = getAddress(app.memeLaunchV2!);
  const hook = getAddress(app.ethCreatorFeeHookV3!);
  const vaultFactory = getAddress(app.classicRewardVaultFactoryV1!);
  const startBlock = BigInt(app.deploymentBlocks!.memeLaunchV2!);
  const launchBlock = startBlock + 1n;
  const swapBlock = startBlock + 2n;
  const checkpointBlock = startBlock + 5n;
  const currentBeneficiary = mutation === "payout-history"
    ? REPLACEMENT
    : mutation === "cto-history"
      ? CTO_BENEFICIARY
      : BENEFICIARY;
  const configurationEpoch = mutation === "payout-history" || mutation === "cto-history"
    ? 2n
    : 1n;
  const initialActiveConfigurationHash = keccak256(encodeAbiParameters(
    parseAbi([
      "function f(uint256 chainId,address vault,bytes32 configurationHash,uint64 epoch,address[] beneficiaries,uint16[] sharesBps)",
    ])[0]!.inputs,
    [1n, VAULT, CONFIGURATION_HASH, 1n, [BENEFICIARY], [10_000]],
  ));
  const activeConfigurationHash = keccak256(encodeAbiParameters(
    parseAbi([
      "function f(uint256 chainId,address vault,bytes32 configurationHash,uint64 epoch,address[] beneficiaries,uint16[] sharesBps)",
    ])[0]!.inputs,
    [
      1n,
      VAULT,
      CONFIGURATION_HASH,
      configurationEpoch,
      [currentBeneficiary],
      [10_000],
    ],
  ));

  const factoryLog = eventLog({
    event: vaultDeployedEvent,
    args: {
      vault: VAULT,
      poolId: POOL_ID,
      feeHook: hook,
      salt: CREATOR_SALT,
      configurationHash: CONFIGURATION_HASH,
    },
    address: vaultFactory,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: LAUNCH_TRANSACTION,
    transactionIndex: 2,
    logIndex: 0,
  });
  const registrationLog = eventLog({
    event: registeredEvent,
    args: {
      poolId: POOL_ID,
      token: TOKEN,
      rewardVault: VAULT,
      registrar: launcher,
      buySwapFeeBps: 100,
      sellSwapFeeBps: 100,
      rewardConfigurationHash: CONFIGURATION_HASH,
    },
    address: hook,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: LAUNCH_TRANSACTION,
    transactionIndex: 2,
    logIndex: 1,
  });
  const disclosureLog = eventLog({
    event: disclosureEvent,
    args: {
      poolId: POOL_ID,
      token: TOKEN,
      rewardVault: VAULT,
      buySwapFeeBps: 100,
      sellSwapFeeBps: 100,
      buyCreatorFeeBps: 90,
      sellCreatorFeeBps: 90,
      launcherFeeBps: 10,
      transferTaxBps: 0,
      lpFeePips: 0,
    },
    address: hook,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: LAUNCH_TRANSACTION,
    transactionIndex: 2,
    logIndex: 2,
  });
  const liquidityLog = eventLog({
    event: liquidityEvent,
    args: {
      token: TOKEN,
      totalSupply: TOTAL_SUPPLY,
      tokenLiquidityAmount: TOKEN_LIQUIDITY,
      lockedTokenDust: 1n,
      initialTick: 0,
      tickLower: -887_220,
      tickUpper: 0,
      lpFeePips: 0,
      launchHash: LAUNCH_HASH,
    },
    address: launcher,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: LAUNCH_TRANSACTION,
    transactionIndex: 2,
    logIndex: 3,
  });
  const initialBuyLog = eventLog({
    event: initialBuyEvent,
    args: {
      deployer: DEPLOYER,
      token: TOKEN,
      poolId: POOL_ID,
      nativeAmount: 1_000n,
      tokenAmount: 10_000n,
      launchHash: LAUNCH_HASH,
    },
    address: launcher,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: LAUNCH_TRANSACTION,
    transactionIndex: 2,
    logIndex: 4,
  });
  const custodyLog = eventLog({
    event: custodyEvent,
    args: {
      deployer: DEPLOYER,
      token: TOKEN,
      custody: ZERO_ADDRESS,
      mode: 0,
      durationDays: 0,
      cliffDays: 0,
      configurationHash: CONFIGURATION_HASH,
      launchHash: LAUNCH_HASH,
    },
    address: launcher,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: LAUNCH_TRANSACTION,
    transactionIndex: 2,
    logIndex: 5,
  });
  const launchLog = eventLog({
    event: launchedEvent,
    args: {
      deployer: DEPLOYER,
      token: TOKEN,
      poolId: POOL_ID,
      feeHook: hook,
      rewardVault: VAULT,
      positionRecipient: POSITION_RECIPIENT,
      positionTokenId: 42n,
      buySwapFeeBps: 100,
      sellSwapFeeBps: 100,
      rewardConfigurationHash: CONFIGURATION_HASH,
      launchHash: LAUNCH_HASH,
    },
    address: launcher,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: LAUNCH_TRANSACTION,
    transactionIndex: 2,
    logIndex: 6,
  });
  const feeLog = eventLog({
    event: feeAccruedEvent,
    args: {
      poolId: POOL_ID,
      swapSender: SWAP_SENDER,
      isBuy: mutation !== "direction",
      appliedTotalSwapFeeBps: 100,
      grossNativeAmount: 10_000n,
      creatorFee: mutation === "fee" ? 89n : 90n,
      launcherFee: 10n,
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
      amount0: 10_000n,
      amount1: -1n,
      sqrtPriceX96: SQRT_PRICE_X96,
      liquidity: 1_000_000n,
      tick: 0,
      fee: 0,
    },
    address: getAddress(dependencies.contracts.poolManager.address),
    blockNumber: swapBlock,
    blockHash: SWAP_BLOCK_HASH,
    transactionHash: SWAP_TRANSACTION,
    transactionIndex: 3,
    logIndex: mutation === "reordered-fees" ? 3 : 1,
  });
  const tinySwapLog = eventLog({
    event: swapEvent,
    args: {
      id: POOL_ID,
      sender: SWAP_SENDER,
      amount0: 1n,
      amount1: -1n,
      sqrtPriceX96: SQRT_PRICE_X96,
      liquidity: 1_000_000n,
      tick: 0,
      fee: 0,
    },
    address: getAddress(dependencies.contracts.poolManager.address),
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
      isBuy: true,
      appliedTotalSwapFeeBps: 100,
      grossNativeAmount: 20_000n,
      creatorFee: 180n,
      launcherFee: 20n,
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
      amount0: 20_000n,
      amount1: -2n,
      sqrtPriceX96: SQRT_PRICE_X96,
      liquidity: 1_000_000n,
      tick: 0,
      fee: 0,
    },
    address: getAddress(dependencies.contracts.poolManager.address),
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
      isBuy: true,
      appliedTotalSwapFeeBps: 100,
      grossNativeAmount: 10_000n,
      creatorFee: 90n,
      launcherFee: 10n,
    },
    address: hook,
    blockNumber: swapBlock,
    blockHash: SWAP_BLOCK_HASH,
    transactionHash: SWAP_TRANSACTION,
    transactionIndex: 3,
    logIndex: 2,
  });
  const checkpointLog = eventLog({
    event: checkpointEvent,
    args: {
      poolId: POOL_ID,
      configurationEpoch: 1n,
      amount: 90n,
      totalCreatorFeesReceived: 90n,
    },
    address: VAULT,
    blockNumber: swapBlock,
    blockHash: SWAP_BLOCK_HASH,
    transactionHash: HISTORY_TRANSACTION,
    transactionIndex: 4,
    logIndex: 0,
  });
  const payoutChangedLog = eventLog({
    event: payoutChangedEvent,
    args: {
      poolId: POOL_ID,
      allocationIndex: 0n,
      previousPayoutWallet: BENEFICIARY,
      newPayoutWallet: REPLACEMENT,
      shareBps: 10_000,
      configurationEpoch: 2n,
      activeConfigurationHash,
      effectiveTotalCreatorFeesReceived: 90n,
    },
    address: VAULT,
    blockNumber: swapBlock,
    blockHash: SWAP_BLOCK_HASH,
    transactionHash: HISTORY_TRANSACTION,
    transactionIndex: 4,
    logIndex: 1,
  });
  const ctoActivatedLog = eventLog({
    event: ctoActivatedEvent,
    args: {
      poolId: POOL_ID,
      approvalReference: APPROVAL_REFERENCE,
      configurationEpoch: 2n,
      previousConfigurationHash: initialActiveConfigurationHash,
      newConfigurationHash: activeConfigurationHash,
      beneficiaries: [CTO_BENEFICIARY],
      sharesBps: [10_000],
      effectiveTotalCreatorFeesReceived: 90n,
    },
    address: VAULT,
    blockNumber: swapBlock,
    blockHash: SWAP_BLOCK_HASH,
    transactionHash: HISTORY_TRANSACTION,
    transactionIndex: 4,
    logIndex: 1,
  });

  const launchParameters = {
    name: mutation === "calldata" ? "Wrong" : "Fixture Token",
    symbol: "FIX",
    buySwapFeeBps: 100,
    sellSwapFeeBps: 100,
    creatorSalt: CREATOR_SALT,
    metadata: {
      description: "Fixture description",
      website: "https://example.com",
      image: "https://example.com/image.png",
      extraData: "0x",
    },
    rewardBeneficiaries: [BENEFICIARY],
    rewardSharesBps: [10_000],
    initialBuyCustody: { mode: 0, durationDays: 0, cliffDays: 0 },
  } as const;
  const transaction: ExactBlockRpcTransaction = Object.freeze({
    transactionHash: LAUNCH_TRANSACTION,
    blockNumber: launchBlock,
    blockHash: LAUNCH_BLOCK_HASH,
    transactionIndex: 2,
    from: DEPLOYER,
    to: launcher,
    input: encodeFunctionData({
      abi: classicV3LaunchAbi,
      functionName: "launch",
      args: [launchParameters],
    }),
    value: 1_000n,
  });
  const receiptSourceLogs = [
    factoryLog,
    registrationLog,
    disclosureLog,
    liquidityLog,
    initialBuyLog,
    custodyLog,
    launchLog,
  ];
  if (mutation === "receipt") receiptSourceLogs.splice(3, 1);
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
    app.runtimeCodeHashes!.classicCtoAuthorityV1!,
    app.runtimeCodeHashes!.memeLaunchV2!,
    app.runtimeCodeHashes!.ethCreatorFeeHookV3!,
    app.runtimeCodeHashes!.classicRewardVaultFactoryV1!,
    app.runtimeCodeHashes!.classicInitialBuyVestingWalletFactoryV1!,
    app.runtimeCodeHashes!.classicLaunchPolicyV1!,
    app.runtimeCodeHashes!.ethCreatorFeeHookFactoryV3!,
    app.runtimeCodeHashes!.lockedPositionFeeForwarderFactory!,
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
        expect(calls).toHaveLength(21);
        return Object.freeze([
          encodedResult(uerc20ReadAbi, "name", "Fixture Token"),
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
          encodedResult(classicV3HookAbi, "feeDisclosure", [
            100,
            100,
            90,
            90,
            10,
            0,
            0,
            VAULT,
          ]),
          encodedResult(classicV3HookAbi, "poolFeeConfig", [
            VAULT,
            launcher,
            100,
            100,
            true,
            0n,
          ]),
          encodedResult(classicV3LaunchAbi, "predictRewardVault", VAULT),
          encodedResult(vaultFactoryAbi, "isFactoryVault", true),
          encodedResult(vaultFactoryAbi, "configurationHashOf", CONFIGURATION_HASH),
          encodedResult(classicRewardVaultAbi, "feeHook", hook),
          encodedResult(classicRewardVaultAbi, "poolId", POOL_ID),
          encodedResult(classicRewardVaultAbi, "configurationHash", CONFIGURATION_HASH),
          encodedResult(
            classicRewardVaultAbi,
            "activeConfigurationHash",
            mutation === "reward" ? LAUNCH_HASH : activeConfigurationHash,
          ),
          encodedResult(
            classicRewardVaultAbi,
            "configurationEpoch",
            configurationEpoch,
          ),
          encodedResult(classicRewardVaultAbi, "beneficiaryCount", 1n),
          encodedResult(classicRewardVaultAbi, "totalCreatorFeesReceived", 90n),
          encodedResult(classicRewardVaultAbi, "totalCreatorFeesClaimed", 0n),
        ]);
      }
      if (callBatch === 2) {
        expect(calls).toHaveLength(2);
        return Object.freeze([
          encodedResult(
            classicRewardVaultAbi,
            "beneficiaryAt",
            currentBeneficiary,
          ),
          encodedResult(classicRewardVaultAbi, "shareBpsAt", 10_000),
        ]);
      }
      expect(callBatch).toBe(3);
      const hasHistory = mutation === "payout-history" || mutation === "cto-history";
      expect(calls).toHaveLength(hasHistory ? 4 : 2);
      if (hasHistory) {
        return Object.freeze([
          encodedResult(classicRewardVaultAbi, "claimable", 90n),
          encodedResult(classicRewardVaultAbi, "claimedBy", 0n),
          encodedResult(classicRewardVaultAbi, "claimable", 0n),
          encodedResult(classicRewardVaultAbi, "claimedBy", 0n),
        ]);
      }
      return Object.freeze([
        encodedResult(classicRewardVaultAbi, "claimable", 90n),
        encodedResult(classicRewardVaultAbi, "claimedBy", 0n),
      ]);
    },
    async getCodeHash({ blockHash }) {
      expect(blockHash).toBe(CHECKPOINT_HASH);
      const expected = runtimeHashes[runtimeCursor++]!;
      return mutation === "runtime" && runtimeCursor === 1
        ? (`0x${"03".repeat(32)}` as const)
        : expected;
    },
    async getLogs({ addresses }) {
      const values = (Array.isArray(addresses) ? addresses : [addresses])
        .map((address) => address.toLowerCase());
      if (values.includes(launcher.toLowerCase())) {
        const logs = [liquidityLog, initialBuyLog, custodyLog, launchLog];
        return Object.freeze(mutation === "log-order"
          ? [logs[1]!, logs[0]!, ...logs.slice(2)]
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
      if (values.includes(vaultFactory.toLowerCase())) {
        return Object.freeze([factoryLog]);
      }
      if (values.includes(VAULT.toLowerCase())) {
        if (mutation === "payout-history") {
          return Object.freeze([checkpointLog, payoutChangedLog]);
        }
        if (mutation === "cto-history") {
          return Object.freeze([checkpointLog, ctoActivatedLog]);
        }
        return Object.freeze([]);
      }
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
    releaseId: "classic-v3",
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
    routeKeys: RECONCILER_ROUTE_KEYS,
    routeContract: {},
    projectionContract: {},
    currentEntities: [],
  });
  return { rpc, contract, checkpointBlock };
}

describe("Classic V3 exact route builder", () => {
  it("builds all six deterministic routes from exact checkpoint evidence", async () => {
    const { rpc, contract, checkpointBlock } = fixture();
    const routes = await buildClassicV3ExactBlockRoutes({
      rpc,
      contract,
      blockNumber: checkpointBlock,
      blockHash: CHECKPOINT_HASH,
      signal: new AbortController().signal,
    });

    expect(routes.map((route) => route.routeKey)).toEqual(RECONCILER_ROUTE_KEYS);
    expect(routes.every((route) => route.comparedCount === 1)).toBe(true);
    expect(routes.every((route) =>
      (route.dto as { contractVersion: string }).contractVersion ===
        CLASSIC_V3_RECONCILER_ROUTE_CONTRACT
    )).toBe(true);
    const token = (routes[0]!.dto as {
      tokens: Array<Record<string, unknown>>;
    }).tokens[0]!;
    expect(token).toMatchObject({
      releaseVersion: "classic-v3",
      modelId: "classic",
      tokenAddress: TOKEN.toLowerCase(),
      rewardVaultAddress: VAULT.toLowerCase(),
      quoteAssetAddress: ZERO_ADDRESS,
      launchLogIndex: 6,
    });
  });

  it("accepts a 1-wei swap whose rounded fee is zero and emits no fee event", async () => {
    const { rpc, contract, checkpointBlock } = fixture("tiny-swap");
    const routes = await buildClassicV3ExactBlockRoutes({
      rpc,
      contract,
      blockNumber: checkpointBlock,
      blockHash: CHECKPOINT_HASH,
      signal: new AbortController().signal,
    });

    expect(routes.map((route) => route.routeKey)).toEqual(RECONCILER_ROUTE_KEYS);
    expect(routes.every((route) => route.comparedCount === 1)).toBe(true);
  });

  it.each([
    ["payout-history", REPLACEMENT, "payout-change"],
    ["cto-history", CTO_BENEFICIARY, "cto-activation"],
  ] as const)(
    "preserves old-wallet entitlements after %s",
    async (mutation, currentBeneficiary, historyKind) => {
      const { rpc, contract, checkpointBlock } = fixture(mutation);
      const routes = await buildClassicV3ExactBlockRoutes({
        rpc,
        contract,
        blockNumber: checkpointBlock,
        blockHash: CHECKPOINT_HASH,
        signal: new AbortController().signal,
      });
      const profile = routes.find(({ routeKey }) =>
        routeKey === "classic-v3-profile"
      )!.dto as {
        rewards: Array<{
          allocations: Array<Record<string, unknown>>;
          entitlements: Array<Record<string, unknown>>;
          events: Array<Record<string, unknown>>;
        }>;
      };

      expect(profile.rewards[0]!.allocations).toEqual([{
        allocationIndex: 0,
        payoutAddress: currentBeneficiary.toLowerCase(),
        shareBps: 10_000,
      }]);
      expect(profile.rewards[0]!.entitlements).toEqual([
        {
          account: BENEFICIARY.toLowerCase(),
          claimableWei: "90",
          claimedWei: "0",
        },
        {
          account: currentBeneficiary.toLowerCase(),
          claimableWei: "0",
          claimedWei: "0",
        },
      ]);
      expect(profile.rewards[0]!.events.map(({ kind }) => kind)).toEqual([
        "checkpoint",
        historyKind,
      ]);
    },
  );

  it.each([
    ["runtime hash", "runtime"],
    ["launch calldata", "calldata"],
    ["receipt companion", "receipt"],
    ["fee conservation", "fee"],
    ["fee direction", "direction"],
    ["reward configuration", "reward"],
    ["log ordering", "log-order"],
    ["missing nonzero rounded fee event", "missing-fee"],
    ["extra fee event", "extra-fee"],
    ["duplicate fee event", "duplicate-fee"],
    ["reordered fee events", "reordered-fees"],
  ] as const)("fails closed on a bad %s", async (_label, mutation) => {
    const { rpc, contract, checkpointBlock } = fixture(mutation);
    await expect(buildClassicV3ExactBlockRoutes({
      rpc,
      contract,
      blockNumber: checkpointBlock,
      blockHash: CHECKPOINT_HASH,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("uses non-overlapping provider-portable 10,000-block ranges", () => {
    expect(CLASSIC_V3_RECONCILER_LOG_BLOCK_RANGE).toBe(10_000n);
    expect(classicV3ReconcilerBlockRanges(100n, 10_099n)).toEqual([
      { fromBlock: 100n, toBlock: 10_099n },
    ]);
    expect(classicV3ReconcilerBlockRanges(100n, 10_100n)).toEqual([
      { fromBlock: 100n, toBlock: 10_099n },
      { fromBlock: 10_100n, toBlock: 10_100n },
    ]);
  });

  it("covers the current 186-launch corpus without silent truncation", () => {
    expect(MAXIMUM_CLASSIC_V3_RECONCILER_LAUNCHES).toBeGreaterThanOrEqual(186);
    expect(MAXIMUM_CLASSIC_V3_RECONCILER_LAUNCHES).toBe(256);
    expect(MAXIMUM_CLASSIC_V3_RECONCILER_LAUNCHES * 41).toBeLessThan(16_384);
    expect([128, 129, 186, 256].map(assertClassicV3ReconcilerLaunchCount))
      .toEqual([128, 129, 186, 256]);
    expect(() => assertClassicV3ReconcilerLaunchCount(257)).toThrow();
  });
});
