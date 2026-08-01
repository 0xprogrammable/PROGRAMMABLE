import "server-only";

import {
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  parseAbiParameters,
  toEventSelector,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

import dependencies from "../../contracts/dependencies/ethereum-mainnet.json";
import {
  classicRewardVaultAbi,
  classicV3HookAbi,
  classicV3LaunchAbi,
} from "../classic-v3";
import type { CanonicalJsonValue } from "./canonical-fingerprint";
import {
  getConfiguredClassicV3Release,
  isClassicV3ReleaseVerified,
} from "../classic-v3-release";
import { stateViewReadAbi, uerc20ReadAbi } from "../onchain/abis";
import {
  assembleReconcilerRoutesFromContributions,
  type ReconcilerRouteContribution,
} from "./classic-v3-reconciler-route-contract";
import { canonicalBytes32, type HexBytes32 } from "./codecs";
import {
  assembleReconcilerCorpusPages,
  createReconcilerCorpusManifest,
} from "./reconciler-corpus-partitions";
import { dataPipelineError, invalidInput, validationError } from "./errors";
import type {
  ExactBlockRouteBuilder,
  ExactBlockRpcClient,
  ExactBlockRpcLog,
  ExactBlockRpcReceipt,
  ExactBlockRpcTransaction,
} from "./reconciler-exact-block-reader.server";
import {
  RECONCILER_ROUTE_KEYS,
  type ReconcilerPreParityContract,
} from "./reconciler-preparity";

const ZERO_ADDRESS = `0x${"00".repeat(20)}` as Address;
// QuickNode's paid Ethereum eth_getLogs range is capped at 10,000 blocks.
// Keeping the request at that exact portable boundary avoids provider-specific
// success on one side of the dual-provider comparison.
export const CLASSIC_V3_RECONCILER_LOG_BLOCK_RANGE = 10_000n;
const MAXIMUM_LOGS_PER_REQUEST = 20_000;
const MAXIMUM_VAULTS_PER_LOG_REQUEST = 64;
const MAXIMUM_POOLS_PER_LOG_REQUEST = 64;
const CALLS_PER_LAUNCH = 21;
const ACTIVE_REWARD_CONFIGURATION_PARAMETERS = parseAbiParameters(
  "uint256 chainId,address vault,bytes32 configurationHash,uint64 epoch,address[] beneficiaries,uint16[] sharesBps",
);

const reconcilerRewardVaultFactoryAbi = parseAbi([
  "function isFactoryVault(address vault) view returns (bool)",
  "function configurationHashOf(address vault) view returns (bytes32)",
]);

const launchedEvent = parseAbiItem(
  "event MemeTokenLaunchedV2(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address rewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 rewardConfigurationHash,bytes32 launchHash)",
);
const liquidityEvent = parseAbiItem(
  "event MemeLiquidityConfiguredV2(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);
const initialBuyEvent = parseAbiItem(
  "event MemeCreatorInitialBuyV2(address indexed deployer,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)",
);
const initialBuyCustodyEvent = parseAbiItem(
  "event MemeCreatorInitialBuyCustodyV2(address indexed deployer,address indexed token,address indexed custody,uint8 mode,uint16 durationDays,uint16 cliffDays,bytes32 configurationHash,bytes32 launchHash)",
);
const poolRegisteredEvent = parseAbiItem(
  "event PoolRegistered(bytes32 indexed poolId,address indexed token,address indexed rewardVault,address registrar,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 rewardConfigurationHash)",
);
const poolFeeDisclosureEvent = parseAbiItem(
  "event PoolFeeDisclosure(bytes32 indexed poolId,address indexed token,address indexed rewardVault,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips)",
);
const feeAccruedEvent = parseAbiItem(
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,bool indexed isBuy,uint16 appliedTotalSwapFeeBps,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
);
const creatorHookClaimEvent = parseAbiItem(
  "event CreatorFeesClaimed(bytes32 indexed poolId,address indexed rewardVault,address indexed caller,uint256 amount)",
);
const launcherHookClaimEvent = parseAbiItem(
  "event LauncherFeesClaimed(address indexed treasury,address indexed recipient,address indexed caller,uint256 amount)",
);
const vaultDeployedEvent = parseAbiItem(
  "event ClassicRewardVaultDeployed(address indexed vault,bytes32 indexed poolId,address indexed feeHook,bytes32 salt,bytes32 configurationHash)",
);
const checkpointEvent = parseAbiItem(
  "event CreatorFeesCheckpointed(bytes32 indexed poolId,uint64 indexed configurationEpoch,uint256 amount,uint256 totalCreatorFeesReceived)",
);
const beneficiaryClaimEvent = parseAbiItem(
  "event BeneficiaryFeesClaimed(address indexed beneficiary,uint256 amount,uint256 beneficiaryTotalClaimed,uint256 vaultTotalReceived)",
);
const payoutChangedEvent = parseAbiItem(
  "event PayoutWalletChanged(bytes32 indexed poolId,uint256 indexed allocationIndex,address indexed previousPayoutWallet,address newPayoutWallet,uint16 shareBps,uint64 configurationEpoch,bytes32 activeConfigurationHash,uint256 effectiveTotalCreatorFeesReceived)",
);
const ctoActivatedEvent = parseAbiItem(
  "event CtoRewardConfigurationActivated(bytes32 indexed poolId,bytes32 indexed approvalReference,uint64 indexed configurationEpoch,bytes32 previousConfigurationHash,bytes32 newConfigurationHash,address[] beneficiaries,uint16[] sharesBps,uint256 effectiveTotalCreatorFeesReceived)",
);
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
);

const LAUNCHER_EVENTS = Object.freeze([
  launchedEvent,
  liquidityEvent,
  initialBuyEvent,
  initialBuyCustodyEvent,
]);
const HOOK_EVENTS = Object.freeze([
  poolRegisteredEvent,
  poolFeeDisclosureEvent,
  feeAccruedEvent,
  creatorHookClaimEvent,
  launcherHookClaimEvent,
]);
const VAULT_EVENTS = Object.freeze([
  checkpointEvent,
  beneficiaryClaimEvent,
  payoutChangedEvent,
  ctoActivatedEvent,
]);

type Json = CanonicalJsonValue;

type DecodedLog = Readonly<{
  eventName: string;
  args: Readonly<Record<string, unknown>>;
  log: ExactBlockRpcLog;
}>;

type CallSpec = Readonly<{
  to: Address;
  data: Hex;
  decode: (data: Hex) => unknown;
}>;

type LaunchRecord = Readonly<{
  deployer: Address;
  token: Address;
  poolId: HexBytes32;
  hook: Address;
  rewardVault: Address;
  positionRecipient: Address;
  positionTokenId: bigint;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  rewardConfigurationHash: HexBytes32;
  launchHash: HexBytes32;
  blockNumber: bigint;
  blockHash: HexBytes32;
  transactionHash: HexBytes32;
  transactionIndex: number;
  blockGlobalLogIndex: number;
  log: ExactBlockRpcLog;
}>;

type Release = Readonly<{
  launcher: Address;
  hook: Address;
  rewardVaultFactory: Address;
  poolManager: Address;
  stateView: Address;
  startBlock: bigint;
  runtime: ReadonlyArray<Readonly<{
    address: Address;
    expectedHash: HexBytes32;
    label: string;
  }>>;
}>;

type LaunchTransactionEvidence = Readonly<{
  receiptLogIndex: number;
  value: bigint;
  name: string;
  symbol: string;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  description: string;
  website: string;
  image: string;
  extraData: Hex;
  rewardBeneficiaries: readonly Address[];
  rewardSharesBps: readonly number[];
  custodyMode: number;
  custodyDurationDays: number;
  custodyCliffDays: number;
}>;

type LaunchCompanionEvidence = Readonly<{
  liquidity: DecodedLog;
  initialBuy: DecodedLog;
  custody: DecodedLog;
  registration: DecodedLog;
  disclosure: DecodedLog;
  vaultDeployment: DecodedLog;
}>;

function fail(operation: string): never {
  throw validationError("uniswap", operation);
}

function lowerAddress(value: Address): string {
  return value.toLowerCase();
}

function exactAddress(value: unknown, operation: string): Address {
  if (typeof value !== "string" || !isAddress(value)) fail(operation);
  return getAddress(value);
}

function exactBytes32(value: unknown, operation: string): HexBytes32 {
  try {
    return canonicalBytes32(value);
  } catch {
    return fail(operation);
  }
}

function exactData(value: unknown, operation: string): Hex {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)
  ) {
    fail(operation);
  }
  return value.toLowerCase() as Hex;
}

function exactText(value: unknown, operation: string): string {
  if (typeof value !== "string") fail(operation);
  return value;
}

function integer(value: unknown, operation: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  return fail(operation);
}

function nonnegative(value: unknown, operation: string): bigint {
  const parsed = integer(value, operation);
  if (parsed < 0n) fail(operation);
  return parsed;
}

function absolute(value: unknown, operation: string): bigint {
  const parsed = integer(value, operation);
  return parsed < 0n ? -parsed : parsed;
}

function safeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  operation: string,
): number {
  const parsed = integer(value, operation);
  if (parsed < BigInt(minimum) || parsed > BigInt(maximum)) fail(operation);
  return Number(parsed);
}

function tuple(
  value: unknown,
  length: number,
  operation: string,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length) fail(operation);
  return value;
}

function record(
  value: unknown,
  operation: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(operation);
  }
  return value as Readonly<Record<string, unknown>>;
}

function array(value: unknown, operation: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(operation);
  return value;
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function classicV3ReconcilerBlockRanges(
  fromBlock: bigint,
  toBlock: bigint,
): readonly Readonly<{ fromBlock: bigint; toBlock: bigint }>[] {
  if (fromBlock < 0n || toBlock < fromBlock) {
    throw invalidInput("rpc", "classic-v3-log-range");
  }
  const ranges: Array<Readonly<{ fromBlock: bigint; toBlock: bigint }>> = [];
  for (
    let start = fromBlock;
    start <= toBlock;
    start += CLASSIC_V3_RECONCILER_LOG_BLOCK_RANGE
  ) {
    const end = start + CLASSIC_V3_RECONCILER_LOG_BLOCK_RANGE - 1n;
    ranges.push(Object.freeze({
      fromBlock: start,
      toBlock: end > toBlock ? toBlock : end,
    }));
  }
  return Object.freeze(ranges);
}

export function assertClassicV3ReconcilerLaunchCount(count: number): number {
  if (
    !Number.isSafeInteger(count) ||
    count < 1
  ) {
    fail("classic-v3-launch-cardinality");
  }
  return count;
}

function callSpec(
  to: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): CallSpec {
  const request = { abi, functionName, args } as never;
  return Object.freeze({
    to,
    data: encodeFunctionData(request),
    decode: (result: Hex) =>
      decodeFunctionResult({
        abi,
        functionName,
        data: result,
      } as never) as unknown,
  });
}

function decodeKnownEvent(
  eventBySelector: ReadonlyMap<string, AbiEvent>,
  log: ExactBlockRpcLog,
): DecodedLog {
  const selector = log.topics[0]?.toLowerCase();
  const event = selector ? eventBySelector.get(selector) : undefined;
  if (!event) fail("classic-v3-log-selector");
  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({
      abi: [event],
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
      strict: true,
    });
  } catch {
    return fail("classic-v3-log-decode");
  }
  if (
    typeof decoded.args !== "object" ||
    decoded.args === null ||
    Array.isArray(decoded.args)
  ) {
    fail("classic-v3-log-args");
  }
  return Object.freeze({
    eventName: decoded.eventName,
    args: decoded.args as Readonly<Record<string, unknown>>,
    log,
  });
}

function eventMap(events: readonly AbiEvent[]) {
  return new Map(
    events.map((event) => [toEventSelector(event).toLowerCase(), event]),
  );
}

async function readUncappedLogs(input: {
  rpc: ExactBlockRpcClient;
  addresses: Address | readonly Address[];
  topics: readonly (Hex | readonly Hex[] | null)[];
  fromBlock: bigint;
  toBlock: bigint;
  signal: AbortSignal;
}): Promise<readonly ExactBlockRpcLog[]> {
  const logs = await input.rpc.getLogs({
    addresses: input.addresses,
    topics: input.topics,
    fromBlock: input.fromBlock,
    toBlock: input.toBlock,
    maximumLogs: MAXIMUM_LOGS_PER_REQUEST,
    signal: input.signal,
  });
  if (logs.length < MAXIMUM_LOGS_PER_REQUEST) return logs;
  if (input.fromBlock === input.toBlock) {
    throw dataPipelineError({
      dependency: "rpc",
      code: "response_oversize",
      retryable: false,
      countsTowardCircuit: true,
      metadata: { operation: "classic-v3-single-block-log-boundary" },
    });
  }
  const midpoint = input.fromBlock + (input.toBlock - input.fromBlock) / 2n;
  const [left, right] = await Promise.all([
    readUncappedLogs({ ...input, toBlock: midpoint }),
    readUncappedLogs({ ...input, fromBlock: midpoint + 1n }),
  ]);
  return Object.freeze([...left, ...right]);
}

async function readLogsInRanges(input: {
  rpc: ExactBlockRpcClient;
  addresses: Address | readonly Address[];
  events: readonly AbiEvent[];
  fromBlock: bigint;
  toBlock: bigint;
  signal: AbortSignal;
}): Promise<readonly DecodedLog[]> {
  if (input.toBlock < input.fromBlock) return Object.freeze([]);
  const selectorMap = eventMap(input.events);
  const selectors = [...selectorMap.keys()] as Hex[];
  const allowedAddresses = new Set(
    (Array.isArray(input.addresses) ? input.addresses : [input.addresses])
      .map((address) => lowerAddress(address)),
  );
  const output: DecodedLog[] = [];
  for (const { fromBlock, toBlock } of classicV3ReconcilerBlockRanges(
    input.fromBlock,
    input.toBlock,
  )) {
    const logs = await readUncappedLogs({
      rpc: input.rpc,
      addresses: input.addresses,
      topics: [selectors],
      fromBlock,
      toBlock,
      signal: input.signal,
    });
    if (logs.some((log) =>
      !allowedAddresses.has(lowerAddress(log.address)) ||
      !selectorMap.has((log.topics[0] ?? "").toLowerCase()) ||
      log.blockNumber < fromBlock ||
      log.blockNumber > toBlock
    )) {
      fail("classic-v3-log-filter-binding");
    }
    output.push(...logs.map((log) => decodeKnownEvent(selectorMap, log)));
  }
  for (let index = 1; index < output.length; index += 1) {
    const previous = output[index - 1]!.log;
    const current = output[index]!.log;
    if (
      current.blockNumber < previous.blockNumber ||
      (current.blockNumber === previous.blockNumber &&
        (current.transactionIndex < previous.transactionIndex ||
          (current.transactionIndex === previous.transactionIndex &&
            current.logIndex <= previous.logIndex)))
    ) {
      fail("classic-v3-log-corpus-order");
    }
  }
  return Object.freeze(output);
}

async function readAddressBatches(input: {
  rpc: ExactBlockRpcClient;
  addresses: readonly Address[];
  events: readonly AbiEvent[];
  fromBlock: bigint;
  toBlock: bigint;
  signal: AbortSignal;
}): Promise<readonly DecodedLog[]> {
  const output: DecodedLog[] = [];
  for (
    let index = 0;
    index < input.addresses.length;
    index += MAXIMUM_VAULTS_PER_LOG_REQUEST
  ) {
    output.push(...await readLogsInRanges({
      ...input,
      addresses: input.addresses.slice(
        index,
        index + MAXIMUM_VAULTS_PER_LOG_REQUEST,
      ),
    }));
  }
  output.sort((left, right) =>
    left.log.blockNumber === right.log.blockNumber
      ? left.log.transactionIndex === right.log.transactionIndex
        ? left.log.logIndex - right.log.logIndex
        : left.log.transactionIndex - right.log.transactionIndex
      : left.log.blockNumber < right.log.blockNumber ? -1 : 1
  );
  return Object.freeze(output);
}

async function readPoolSwapBatches(input: {
  rpc: ExactBlockRpcClient;
  poolManager: Address;
  poolIds: readonly HexBytes32[];
  fromBlock: bigint;
  toBlock: bigint;
  signal: AbortSignal;
}): Promise<readonly DecodedLog[]> {
  const selectorMap = eventMap([swapEvent]);
  const output: DecodedLog[] = [];
  for (
    let poolIndex = 0;
    poolIndex < input.poolIds.length;
    poolIndex += MAXIMUM_POOLS_PER_LOG_REQUEST
  ) {
    const poolIds = input.poolIds.slice(
      poolIndex,
      poolIndex + MAXIMUM_POOLS_PER_LOG_REQUEST,
    );
    for (const { fromBlock, toBlock } of classicV3ReconcilerBlockRanges(
      input.fromBlock,
      input.toBlock,
    )) {
      const logs = await readUncappedLogs({
        rpc: input.rpc,
        addresses: input.poolManager,
        topics: [toEventSelector(swapEvent), poolIds],
        fromBlock,
        toBlock,
        signal: input.signal,
      });
      output.push(...logs.map((log) => decodeKnownEvent(selectorMap, log)));
    }
  }
  output.sort((left, right) =>
    left.log.blockNumber === right.log.blockNumber
      ? left.log.transactionIndex === right.log.transactionIndex
        ? left.log.logIndex - right.log.logIndex
        : left.log.transactionIndex - right.log.transactionIndex
      : left.log.blockNumber < right.log.blockNumber ? -1 : 1
  );
  return Object.freeze(output);
}

function resolvedRelease(contract: ReconcilerPreParityContract): Release {
  if (
    contract.chainId !== "1" ||
    contract.releaseId !== "classic-v3" ||
    contract.modelId !== "classic" ||
    contract.routeKeys.length !== RECONCILER_ROUTE_KEYS.length ||
    contract.routeKeys.some(
      (routeKey, index) => routeKey !== RECONCILER_ROUTE_KEYS[index],
    )
  ) {
    throw invalidInput("config", "classic-v3-reconciler-release");
  }
  const configured = getConfiguredClassicV3Release("production");
  if (
    configured.chainId !== 1 ||
    !isClassicV3ReleaseVerified(
      configured.appManifest,
      configured.releaseManifest,
      1,
    )
  ) {
    fail("classic-v3-reconciler-manifest");
  }
  const app = configured.appManifest;
  const launcher = exactAddress(app.memeLaunchV2, "classic-v3-launcher");
  const hook = exactAddress(app.ethCreatorFeeHookV3, "classic-v3-hook");
  const rewardVaultFactory = exactAddress(
    app.classicRewardVaultFactoryV1,
    "classic-v3-reward-vault-factory",
  );
  const poolManager = exactAddress(
    dependencies.contracts.poolManager.address,
    "classic-v3-pool-manager",
  );
  const stateView = exactAddress(
    dependencies.contracts.stateView.address,
    "classic-v3-state-view",
  );
  const start = app.deploymentBlocks?.memeLaunchV2;
  if (!Number.isSafeInteger(start) || (start ?? -1) < 0) {
    fail("classic-v3-start-block");
  }
  return Object.freeze({
    launcher,
    hook,
    rewardVaultFactory,
    poolManager,
    stateView,
    startBlock: BigInt(start!),
    runtime: Object.freeze([
      Object.freeze({
        address: exactAddress(
          app.classicCtoAuthorityV1,
          "classic-v3-cto-authority",
        ),
        expectedHash: exactBytes32(
          app.runtimeCodeHashes?.classicCtoAuthorityV1,
          "classic-v3-cto-authority-runtime-hash",
        ),
        label: "cto-authority",
      }),
      Object.freeze({
        address: launcher,
        expectedHash: exactBytes32(
          app.runtimeCodeHashes?.memeLaunchV2,
          "classic-v3-launcher-runtime-hash",
        ),
        label: "launcher",
      }),
      Object.freeze({
        address: hook,
        expectedHash: exactBytes32(
          app.runtimeCodeHashes?.ethCreatorFeeHookV3,
          "classic-v3-hook-runtime-hash",
        ),
        label: "hook",
      }),
      Object.freeze({
        address: rewardVaultFactory,
        expectedHash: exactBytes32(
          app.runtimeCodeHashes?.classicRewardVaultFactoryV1,
          "classic-v3-reward-factory-runtime-hash",
        ),
        label: "reward-vault-factory",
      }),
      Object.freeze({
        address: exactAddress(
          app.classicInitialBuyVestingWalletFactoryV1,
          "classic-v3-initial-buy-vesting-factory",
        ),
        expectedHash: exactBytes32(
          app.runtimeCodeHashes?.classicInitialBuyVestingWalletFactoryV1,
          "classic-v3-initial-buy-vesting-factory-runtime-hash",
        ),
        label: "initial-buy-vesting-factory",
      }),
      Object.freeze({
        address: exactAddress(
          app.classicLaunchPolicyV1,
          "classic-v3-launch-policy",
        ),
        expectedHash: exactBytes32(
          app.runtimeCodeHashes?.classicLaunchPolicyV1,
          "classic-v3-launch-policy-runtime-hash",
        ),
        label: "launch-policy",
      }),
      Object.freeze({
        address: exactAddress(
          app.ethCreatorFeeHookFactoryV3,
          "classic-v3-hook-factory",
        ),
        expectedHash: exactBytes32(
          app.runtimeCodeHashes?.ethCreatorFeeHookFactoryV3,
          "classic-v3-hook-factory-runtime-hash",
        ),
        label: "hook-factory",
      }),
      Object.freeze({
        address: exactAddress(
          app.lockedPositionFeeForwarderFactory,
          "classic-v3-position-forwarder-factory",
        ),
        expectedHash: exactBytes32(
          app.runtimeCodeHashes?.lockedPositionFeeForwarderFactory,
          "classic-v3-position-forwarder-factory-runtime-hash",
        ),
        label: "position-forwarder-factory",
      }),
      Object.freeze({
        address: poolManager,
        expectedHash: exactBytes32(
          dependencies.contracts.poolManager.runtimeCodeHash,
          "classic-v3-pool-manager-runtime-hash",
        ),
        label: "pool-manager",
      }),
      Object.freeze({
        address: stateView,
        expectedHash: exactBytes32(
          dependencies.contracts.stateView.runtimeCodeHash,
          "classic-v3-state-view-runtime-hash",
        ),
        label: "state-view",
      }),
    ]),
  });
}

async function assertRuntime(
  rpc: ExactBlockRpcClient,
  release: Release,
  blockHash: HexBytes32,
  signal: AbortSignal,
) {
  for (const runtime of release.runtime) {
    const codeHash = await rpc.getCodeHash({
      address: runtime.address,
      blockHash,
      signal,
    });
    if (codeHash !== runtime.expectedHash) {
      fail(`classic-v3-runtime-${runtime.label}`);
    }
  }
}

function oneByKey(
  values: readonly DecodedLog[],
  key: (value: DecodedLog) => string,
  operation: string,
): ReadonlyMap<string, DecodedLog> {
  const output = new Map<string, DecodedLog>();
  for (const value of values) {
    const identity = key(value).toLowerCase();
    if (output.has(identity)) fail(operation);
    output.set(identity, value);
  }
  return output;
}

function launchRecords(
  logs: readonly DecodedLog[],
  release: Release,
): readonly LaunchRecord[] {
  const launched = logs.filter((value) => value.eventName === "MemeTokenLaunchedV2");
  assertClassicV3ReconcilerLaunchCount(launched.length);
  const tokens = new Set<string>();
  const pools = new Set<string>();
  const output = launched.map(({ args, log }) => {
    const token = exactAddress(args.token, "classic-v3-launch-token");
    const poolId = exactBytes32(args.poolId, "classic-v3-launch-pool");
    if (
      tokens.has(lowerAddress(token)) ||
      pools.has(poolId) ||
      !sameHex(
        exactAddress(args.feeHook, "classic-v3-launch-hook"),
        release.hook,
      )
    ) {
      fail("classic-v3-launch-identity");
    }
    tokens.add(lowerAddress(token));
    pools.add(poolId);
    return Object.freeze({
      deployer: exactAddress(args.deployer, "classic-v3-launch-deployer"),
      token,
      poolId,
      hook: release.hook,
      rewardVault: exactAddress(args.rewardVault, "classic-v3-launch-vault"),
      positionRecipient: exactAddress(
        args.positionRecipient,
        "classic-v3-position-recipient",
      ),
      positionTokenId: nonnegative(
        args.positionTokenId,
        "classic-v3-position-token-id",
      ),
      buySwapFeeBps: safeInteger(
        args.buySwapFeeBps,
        100,
        1_000,
        "classic-v3-buy-fee",
      ),
      sellSwapFeeBps: safeInteger(
        args.sellSwapFeeBps,
        100,
        1_000,
        "classic-v3-sell-fee",
      ),
      rewardConfigurationHash: exactBytes32(
        args.rewardConfigurationHash,
        "classic-v3-reward-configuration-hash",
      ),
      launchHash: exactBytes32(args.launchHash, "classic-v3-launch-hash"),
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      transactionIndex: log.transactionIndex,
      blockGlobalLogIndex: log.logIndex,
      log,
    });
  });
  output.sort((left, right) =>
    left.blockNumber === right.blockNumber
      ? left.transactionIndex === right.transactionIndex
        ? left.blockGlobalLogIndex - right.blockGlobalLogIndex
        : left.transactionIndex - right.transactionIndex
      : left.blockNumber < right.blockNumber ? -1 : 1
  );
  return Object.freeze(output);
}

function eventIdentityMatches(
  event: DecodedLog,
  launch: LaunchRecord,
): boolean {
  return event.log.blockHash === launch.blockHash &&
    event.log.transactionHash === launch.transactionHash;
}

function validatedCompanions(input: {
  launches: readonly LaunchRecord[];
  launcherLogs: readonly DecodedLog[];
  hookLogs: readonly DecodedLog[];
  factoryLogs: readonly DecodedLog[];
  release: Release;
}) {
  const liquidity = oneByKey(
    input.launcherLogs.filter((value) => value.eventName === "MemeLiquidityConfiguredV2"),
    (value) => lowerAddress(exactAddress(value.args.token, "classic-v3-liquidity-token")),
    "classic-v3-liquidity-cardinality",
  );
  const initialBuy = oneByKey(
    input.launcherLogs.filter((value) => value.eventName === "MemeCreatorInitialBuyV2"),
    (value) => lowerAddress(exactAddress(value.args.token, "classic-v3-initial-buy-token")),
    "classic-v3-initial-buy-cardinality",
  );
  const custody = oneByKey(
    input.launcherLogs.filter((value) => value.eventName === "MemeCreatorInitialBuyCustodyV2"),
    (value) => lowerAddress(exactAddress(value.args.token, "classic-v3-custody-token")),
    "classic-v3-custody-cardinality",
  );
  const registered = oneByKey(
    input.hookLogs.filter((value) => value.eventName === "PoolRegistered"),
    (value) => exactBytes32(value.args.poolId, "classic-v3-registration-pool"),
    "classic-v3-registration-cardinality",
  );
  const disclosure = oneByKey(
    input.hookLogs.filter((value) => value.eventName === "PoolFeeDisclosure"),
    (value) => exactBytes32(value.args.poolId, "classic-v3-disclosure-pool"),
    "classic-v3-disclosure-cardinality",
  );
  const vaultDeployment = oneByKey(
    input.factoryLogs.filter((value) => value.eventName === "ClassicRewardVaultDeployed"),
    (value) => lowerAddress(exactAddress(value.args.vault, "classic-v3-deployed-vault")),
    "classic-v3-vault-deployment-cardinality",
  );

  const companions = new Map<string, LaunchCompanionEvidence>();
  for (const launch of input.launches) {
    const tokenKey = lowerAddress(launch.token);
    const liquidityEvent = liquidity.get(tokenKey);
    const initialBuyEvent = initialBuy.get(tokenKey);
    const custodyEvent = custody.get(tokenKey);
    const registrationEvent = registered.get(launch.poolId);
    const disclosureEvent = disclosure.get(launch.poolId);
    const vaultEvent = vaultDeployment.get(lowerAddress(launch.rewardVault));
    if (
      !liquidityEvent ||
      !initialBuyEvent ||
      !custodyEvent ||
      !registrationEvent ||
      !disclosureEvent ||
      !vaultEvent ||
      !eventIdentityMatches(liquidityEvent, launch) ||
      !eventIdentityMatches(initialBuyEvent, launch) ||
      !eventIdentityMatches(custodyEvent, launch) ||
      !eventIdentityMatches(registrationEvent, launch) ||
      !eventIdentityMatches(disclosureEvent, launch) ||
      vaultEvent.log.blockNumber > launch.blockNumber ||
      (
        vaultEvent.log.blockNumber === launch.blockNumber &&
        (
          vaultEvent.log.transactionIndex > launch.transactionIndex ||
          (
            vaultEvent.log.transactionIndex === launch.transactionIndex &&
            vaultEvent.log.logIndex > launch.blockGlobalLogIndex
          )
        )
      )
    ) {
      fail("classic-v3-launch-companion-provenance");
    }
    const values = [
      liquidityEvent.args.launchHash,
      initialBuyEvent.args.launchHash,
      custodyEvent.args.launchHash,
    ];
    if (values.some((value) => !sameHex(exactBytes32(value, "classic-v3-companion-hash"), launch.launchHash))) {
      fail("classic-v3-launch-companion-hash");
    }
    if (
      !sameHex(exactBytes32(initialBuyEvent.args.poolId, "classic-v3-initial-buy-pool"), launch.poolId) ||
      !sameHex(exactAddress(initialBuyEvent.args.deployer, "classic-v3-initial-buy-deployer"), launch.deployer) ||
      !sameHex(exactAddress(custodyEvent.args.deployer, "classic-v3-custody-deployer"), launch.deployer) ||
      !sameHex(exactAddress(registrationEvent.args.token, "classic-v3-registration-token"), launch.token) ||
      !sameHex(exactAddress(registrationEvent.args.rewardVault, "classic-v3-registration-vault"), launch.rewardVault) ||
      !sameHex(exactAddress(registrationEvent.args.registrar, "classic-v3-registration-registrar"), input.release.launcher) ||
      !sameHex(exactBytes32(registrationEvent.args.rewardConfigurationHash, "classic-v3-registration-hash"), launch.rewardConfigurationHash) ||
      !sameHex(exactAddress(disclosureEvent.args.token, "classic-v3-disclosure-token"), launch.token) ||
      !sameHex(exactAddress(disclosureEvent.args.rewardVault, "classic-v3-disclosure-vault"), launch.rewardVault) ||
      !sameHex(exactBytes32(vaultEvent.args.poolId, "classic-v3-deployed-vault-pool"), launch.poolId) ||
      !sameHex(exactAddress(vaultEvent.args.feeHook, "classic-v3-deployed-vault-hook"), input.release.hook) ||
      !sameHex(exactBytes32(vaultEvent.args.configurationHash, "classic-v3-deployed-vault-hash"), launch.rewardConfigurationHash)
    ) {
      fail("classic-v3-launch-companion-mismatch");
    }
    companions.set(tokenKey, Object.freeze({
      liquidity: liquidityEvent,
      initialBuy: initialBuyEvent,
      custody: custodyEvent,
      registration: registrationEvent,
      disclosure: disclosureEvent,
      vaultDeployment: vaultEvent,
    }));
  }
  return companions;
}

function validatedLaunchTransactions(input: {
  launches: readonly LaunchRecord[];
  transactions: readonly ExactBlockRpcTransaction[];
  receipts: readonly ExactBlockRpcReceipt[];
  companions: ReadonlyMap<string, LaunchCompanionEvidence>;
  release: Release;
}): ReadonlyMap<string, LaunchTransactionEvidence> {
  if (
    input.transactions.length !== input.launches.length ||
    input.receipts.length !== input.launches.length
  ) {
    fail("classic-v3-launch-transaction-cardinality");
  }
  const output = new Map<string, LaunchTransactionEvidence>();
  for (let index = 0; index < input.launches.length; index += 1) {
    const launch = input.launches[index]!;
    const transaction = input.transactions[index]!;
    const receipt = input.receipts[index]!;
    if (
      !sameHex(transaction.transactionHash, launch.transactionHash) ||
      transaction.blockNumber !== launch.blockNumber ||
      !sameHex(transaction.blockHash, launch.blockHash) ||
      transaction.transactionIndex !== launch.transactionIndex ||
      !sameHex(transaction.from, launch.deployer) ||
      !sameHex(transaction.to, input.release.launcher) ||
      !sameHex(receipt.transactionHash, launch.transactionHash) ||
      receipt.blockNumber !== launch.blockNumber ||
      !sameHex(receipt.blockHash, launch.blockHash) ||
      receipt.transactionIndex !== launch.transactionIndex
    ) {
      fail("classic-v3-launch-transaction-binding");
    }
    const launchReceiptLogs = receipt.logs.filter((log) =>
      sameHex(log.address, input.release.launcher) &&
      log.logIndex === launch.blockGlobalLogIndex &&
      sameHex(log.transactionHash, launch.transactionHash) &&
      sameHex(log.data, launch.log.data) &&
      log.topics.length === launch.log.topics.length &&
      log.topics.every((topic, topicIndex) =>
        sameHex(topic, launch.log.topics[topicIndex]!)
      ) &&
      sameHex(log.topics[0] ?? "0x", toEventSelector(launchedEvent))
    );
    if (launchReceiptLogs.length !== 1) {
      fail("classic-v3-launch-receipt-log");
    }
    const companion = input.companions.get(lowerAddress(launch.token));
    if (!companion) fail("classic-v3-launch-receipt-companion");
    const sameTransactionCompanions = [
      companion.liquidity,
      companion.initialBuy,
      companion.custody,
      companion.registration,
      companion.disclosure,
    ];
    for (const expected of sameTransactionCompanions) {
      const matchingLogs = receipt.logs.filter((log) =>
        sameHex(log.address, expected.log.address) &&
        log.logIndex === expected.log.logIndex &&
        sameHex(log.transactionHash, expected.log.transactionHash) &&
        sameHex(log.data, expected.log.data) &&
        log.topics.length === expected.log.topics.length &&
        log.topics.every((topic, topicIndex) =>
          sameHex(topic, expected.log.topics[topicIndex]!)
        )
      );
      if (matchingLogs.length !== 1) {
        fail("classic-v3-launch-receipt-companion");
      }
    }

    let decoded: ReturnType<typeof decodeFunctionData>;
    try {
      decoded = decodeFunctionData({
        abi: classicV3LaunchAbi,
        data: transaction.input,
      });
    } catch {
      return fail("classic-v3-launch-calldata-decode");
    }
    if (decoded.functionName !== "launch" || decoded.args.length !== 1) {
      fail("classic-v3-launch-calldata-selector");
    }
    const parameters = record(decoded.args[0], "classic-v3-launch-parameters");
    exactBytes32(parameters.creatorSalt, "classic-v3-creator-salt");
    const metadata = record(parameters.metadata, "classic-v3-launch-metadata");
    const custody = record(
      parameters.initialBuyCustody,
      "classic-v3-launch-custody",
    );
    const beneficiaries = array(
      parameters.rewardBeneficiaries,
      "classic-v3-launch-beneficiaries",
    ).map((value) => exactAddress(value, "classic-v3-launch-beneficiary"));
    const shares = array(
      parameters.rewardSharesBps,
      "classic-v3-launch-reward-shares",
    ).map((value) => safeInteger(
      value,
      1,
      10_000,
      "classic-v3-launch-reward-share",
    ));
    if (
      beneficiaries.length < 1 ||
      beneficiaries.length > 5 ||
      beneficiaries.length !== shares.length ||
      new Set(beneficiaries.map(lowerAddress)).size !== beneficiaries.length ||
      shares.reduce((total, value) => total + value, 0) !== 10_000
    ) {
      fail("classic-v3-launch-reward-configuration");
    }
    const buySwapFeeBps = safeInteger(
      parameters.buySwapFeeBps,
      100,
      1_000,
      "classic-v3-launch-calldata-buy-fee",
    );
    const sellSwapFeeBps = safeInteger(
      parameters.sellSwapFeeBps,
      100,
      1_000,
      "classic-v3-launch-calldata-sell-fee",
    );
    if (
      buySwapFeeBps !== launch.buySwapFeeBps ||
      sellSwapFeeBps !== launch.sellSwapFeeBps ||
      buySwapFeeBps % 100 !== 0 ||
      sellSwapFeeBps % 100 !== 0 ||
      transaction.value <= 0n
    ) {
      fail("classic-v3-launch-calldata-economics");
    }
    output.set(lowerAddress(launch.token), Object.freeze({
      receiptLogIndex: launchReceiptLogs[0]!.receiptLogIndex,
      value: transaction.value,
      name: exactText(parameters.name, "classic-v3-launch-name"),
      symbol: exactText(parameters.symbol, "classic-v3-launch-symbol"),
      buySwapFeeBps,
      sellSwapFeeBps,
      description: exactText(metadata.description, "classic-v3-launch-description"),
      website: exactText(metadata.website, "classic-v3-launch-website"),
      image: exactText(metadata.image, "classic-v3-launch-image"),
      extraData: exactData(metadata.extraData, "classic-v3-launch-extra-data"),
      rewardBeneficiaries: Object.freeze(beneficiaries),
      rewardSharesBps: Object.freeze(shares),
      custodyMode: safeInteger(custody.mode, 0, 3, "classic-v3-launch-custody-mode"),
      custodyDurationDays: safeInteger(
        custody.durationDays,
        0,
        65_535,
        "classic-v3-launch-custody-duration",
      ),
      custodyCliffDays: safeInteger(
        custody.cliffDays,
        0,
        65_535,
        "classic-v3-launch-custody-cliff",
      ),
    }));
  }
  return output;
}

async function readCalls(
  rpc: ExactBlockRpcClient,
  specs: readonly CallSpec[],
  blockHash: HexBytes32,
  signal: AbortSignal,
): Promise<readonly unknown[]> {
  const results = await rpc.callMany({
    calls: specs.map(({ to, data }) => Object.freeze({ to, data })),
    blockHash,
    signal,
  });
  if (results.length !== specs.length) fail("classic-v3-call-cardinality");
  return Object.freeze(results.map((result, index) => specs[index]!.decode(result)));
}

function groupLogsByAddress(logs: readonly DecodedLog[]) {
  const output = new Map<string, DecodedLog[]>();
  for (const log of logs) {
    const key = lowerAddress(log.log.address);
    const values = output.get(key) ?? [];
    values.push(log);
    output.set(key, values);
  }
  return output;
}

function grossFeeTotals(
  hookLogs: readonly DecodedLog[],
  swapLogs: readonly DecodedLog[],
  poolId: HexBytes32,
  buySwapFeeBps: number,
  sellSwapFeeBps: number,
) {
  const fees = hookLogs.filter((event) =>
    event.eventName === "NativeSwapFeesAccrued" &&
    sameHex(exactBytes32(event.args.poolId, "classic-v3-accrual-pool"), poolId)
  );
  const swaps = swapLogs.filter((event) =>
    event.eventName === "Swap" &&
    sameHex(exactBytes32(event.args.id, "classic-v3-swap-pool"), poolId)
  );
  if (swaps.length < 1 || fees.length > swaps.length) {
    fail("classic-v3-swap-fee-event-coverage");
  }
  let gross = 0n;
  let creator = 0n;
  let launcher = 0n;
  const feeAmounts = fees.map((event) => {
    const grossAmount = nonnegative(event.args.grossNativeAmount, "classic-v3-gross-fee");
    const creatorAmount = nonnegative(event.args.creatorFee, "classic-v3-creator-fee");
    const launcherAmount = nonnegative(event.args.launcherFee, "classic-v3-launcher-fee");
    if (typeof event.args.isBuy !== "boolean") {
      fail("classic-v3-fee-direction");
    }
    const appliedFeeBps = safeInteger(
      event.args.appliedTotalSwapFeeBps,
      100,
      1_000,
      "classic-v3-applied-swap-fee",
    );
    const configuredFeeBps = event.args.isBuy
      ? buySwapFeeBps
      : sellSwapFeeBps;
    const expectedFloorTotalFee =
      grossAmount * BigInt(configuredFeeBps) / 10_000n;
    const expectedCeilingTotalFee =
      (grossAmount * BigInt(configuredFeeBps) + 9_999n) / 10_000n;
    const actualTotalFee = creatorAmount + launcherAmount;
    const expectedLauncherFee = grossAmount * 10n / 10_000n;
    if (
      appliedFeeBps !== configuredFeeBps ||
      actualTotalFee === 0n ||
      (
        actualTotalFee !== expectedFloorTotalFee &&
        actualTotalFee !== expectedCeilingTotalFee
      ) ||
      launcherAmount !== (
        expectedLauncherFee > actualTotalFee
          ? actualTotalFee
          : expectedLauncherFee
      ) ||
      creatorAmount !== actualTotalFee - launcherAmount
    ) {
      fail("classic-v3-fee-conservation");
    }
    gross += grossAmount;
    creator += creatorAmount;
    launcher += launcherAmount;
    return Object.freeze({
      grossAmount,
      actualTotalFee,
      isBuy: event.args.isBuy,
      sender: exactAddress(event.args.swapSender, "classic-v3-fee-sender"),
    });
  });

  const swapNativeAmounts = swaps.map((event) => {
    if (safeInteger(event.args.fee, 0, 1_000_000, "classic-v3-swap-lp-fee") !== 0) {
      fail("classic-v3-fee-conservation");
    }
    const amount = absolute(event.args.amount0, "classic-v3-swap-native");
    if (amount === 0n) fail("classic-v3-swap-native");
    return Object.freeze({
      amount,
      isBuy: integer(event.args.amount0, "classic-v3-swap-direction") > 0n,
      sender: exactAddress(event.args.sender, "classic-v3-swap-sender"),
    });
  });

  const candidates = fees.map((fee, feeIndex) => {
    const related = swaps.flatMap((swap, swapIndex) => {
      if (
        fee.log.blockNumber !== swap.log.blockNumber ||
        fee.log.transactionIndex !== swap.log.transactionIndex ||
        !sameHex(fee.log.blockHash, swap.log.blockHash) ||
        !sameHex(fee.log.transactionHash, swap.log.transactionHash) ||
        feeAmounts[feeIndex]!.isBuy !== swapNativeAmounts[swapIndex]!.isBuy ||
        !sameHex(feeAmounts[feeIndex]!.sender, swapNativeAmounts[swapIndex]!.sender)
      ) {
        return [];
      }
      return [swapIndex];
    });
    const previous = related.filter((swapIndex) =>
      swaps[swapIndex]!.log.logIndex < fee.log.logIndex
    ).at(-1);
    const next = related.find((swapIndex) =>
      swaps[swapIndex]!.log.logIndex > fee.log.logIndex
    );
    return Object.freeze([previous, next]
      .filter((swapIndex): swapIndex is number => swapIndex !== undefined)
      .filter((swapIndex, index, values) =>
        values.indexOf(swapIndex) === index &&
        (
          feeAmounts[feeIndex]!.grossAmount === swapNativeAmounts[swapIndex]!.amount ||
          feeAmounts[feeIndex]!.grossAmount ===
            swapNativeAmounts[swapIndex]!.amount + feeAmounts[feeIndex]!.actualTotalFee
        )
      ));
  });

  let assignmentCount = 0;
  let matchedSwapIndexes: readonly number[] = Object.freeze([]);
  function assign(feeIndex: number, previousSwapIndex: number, path: number[]) {
    if (assignmentCount > 1) return;
    if (feeIndex === candidates.length) {
      assignmentCount += 1;
      matchedSwapIndexes = Object.freeze([...path]);
      return;
    }
    for (const swapIndex of candidates[feeIndex]!) {
      if (swapIndex <= previousSwapIndex) continue;
      path.push(swapIndex);
      assign(feeIndex + 1, swapIndex, path);
      path.pop();
    }
  }
  assign(0, -1, []);
  if (assignmentCount !== 1) {
    fail("classic-v3-swap-fee-provenance");
  }
  const matched = new Set(matchedSwapIndexes);
  for (let index = 0; index < swaps.length; index += 1) {
    if (matched.has(index)) continue;
    const configuredFeeBps = integer(swaps[index]!.args.amount0, "classic-v3-swap-direction") > 0n
      ? buySwapFeeBps
      : sellSwapFeeBps;
    if (swapNativeAmounts[index]!.amount * BigInt(configuredFeeBps) / 10_000n !== 0n) {
      fail("classic-v3-swap-fee-event-coverage");
    }
  }
  return Object.freeze({ gross, creator, launcher, count: fees.length });
}

function vaultEventInputs(logs: readonly DecodedLog[], poolId: HexBytes32) {
  return Object.freeze(logs.map((event) => {
    const common = {
      blockNumber: event.log.blockNumber.toString(),
      blockHash: event.log.blockHash,
      transactionHash: event.log.transactionHash,
      transactionIndex: event.log.transactionIndex,
      logIndex: event.log.logIndex,
    };
    if (event.eventName === "CreatorFeesCheckpointed") {
      if (!sameHex(exactBytes32(event.args.poolId, "classic-v3-checkpoint-pool"), poolId)) {
        fail("classic-v3-checkpoint-pool-mismatch");
      }
      return {
        ...common,
        kind: "checkpoint",
        configurationEpoch: nonnegative(event.args.configurationEpoch, "classic-v3-checkpoint-epoch").toString(),
        amountWei: nonnegative(event.args.amount, "classic-v3-checkpoint-amount").toString(),
        totalCreatorFeesReceivedWei: nonnegative(event.args.totalCreatorFeesReceived, "classic-v3-checkpoint-total").toString(),
      } satisfies Json;
    }
    if (event.eventName === "BeneficiaryFeesClaimed") {
      return {
        ...common,
        kind: "claim",
        beneficiary: lowerAddress(exactAddress(event.args.beneficiary, "classic-v3-claim-beneficiary")),
        amountWei: nonnegative(event.args.amount, "classic-v3-claim-amount").toString(),
        beneficiaryTotalClaimedWei: nonnegative(event.args.beneficiaryTotalClaimed, "classic-v3-claim-total").toString(),
        vaultTotalReceivedWei: nonnegative(event.args.vaultTotalReceived, "classic-v3-claim-vault-total").toString(),
      } satisfies Json;
    }
    if (event.eventName === "PayoutWalletChanged") {
      if (!sameHex(exactBytes32(event.args.poolId, "classic-v3-payout-pool"), poolId)) {
        fail("classic-v3-payout-pool-mismatch");
      }
      return {
        ...common,
        kind: "payout-change",
        allocationIndex: nonnegative(event.args.allocationIndex, "classic-v3-payout-index").toString(),
        previousPayoutWallet: lowerAddress(exactAddress(event.args.previousPayoutWallet, "classic-v3-previous-payout")),
        newPayoutWallet: lowerAddress(exactAddress(event.args.newPayoutWallet, "classic-v3-new-payout")),
        shareBps: safeInteger(event.args.shareBps, 1, 10_000, "classic-v3-payout-share"),
        configurationEpoch: nonnegative(event.args.configurationEpoch, "classic-v3-payout-epoch").toString(),
        activeConfigurationHash: exactBytes32(event.args.activeConfigurationHash, "classic-v3-active-configuration-hash"),
        effectiveTotalCreatorFeesReceivedWei: nonnegative(event.args.effectiveTotalCreatorFeesReceived, "classic-v3-payout-total").toString(),
      } satisfies Json;
    }
    if (!sameHex(exactBytes32(event.args.poolId, "classic-v3-cto-pool"), poolId)) {
      fail("classic-v3-cto-pool-mismatch");
    }
    const beneficiaries = event.args.beneficiaries;
    const shares = event.args.sharesBps;
    if (!Array.isArray(beneficiaries) || !Array.isArray(shares) || beneficiaries.length !== shares.length) {
      fail("classic-v3-cto-allocation");
    }
    return {
      ...common,
      kind: "cto-activation",
      approvalReference: exactBytes32(event.args.approvalReference, "classic-v3-cto-reference"),
      configurationEpoch: nonnegative(event.args.configurationEpoch, "classic-v3-cto-epoch").toString(),
      previousConfigurationHash: exactBytes32(event.args.previousConfigurationHash, "classic-v3-cto-previous-hash"),
      newConfigurationHash: exactBytes32(event.args.newConfigurationHash, "classic-v3-cto-new-hash"),
      allocations: beneficiaries.map((beneficiary, index) => ({
        beneficiary: lowerAddress(exactAddress(beneficiary, "classic-v3-cto-beneficiary")),
        shareBps: safeInteger(shares[index], 1, 10_000, "classic-v3-cto-share"),
      })),
      effectiveTotalCreatorFeesReceivedWei: nonnegative(event.args.effectiveTotalCreatorFeesReceived, "classic-v3-cto-total").toString(),
    } satisfies Json;
  }));
}

function entitlementAccounts(input: Readonly<{
  initialBeneficiaries: readonly Address[];
  currentBeneficiaries: readonly Address[];
  logs: readonly DecodedLog[];
  poolId: HexBytes32;
}>): readonly Address[] {
  const accounts = new Map<string, Address>();
  const add = (value: unknown, operation: string) => {
    const account = exactAddress(value, operation);
    accounts.set(lowerAddress(account), account);
  };
  input.initialBeneficiaries.forEach((account) =>
    add(account, "classic-v3-initial-entitlement-account")
  );
  input.currentBeneficiaries.forEach((account) =>
    add(account, "classic-v3-current-entitlement-account")
  );
  for (const event of input.logs) {
    if (event.eventName === "BeneficiaryFeesClaimed") {
      add(event.args.beneficiary, "classic-v3-claimed-entitlement-account");
      continue;
    }
    if (event.eventName === "CreatorFeesCheckpointed") {
      if (!sameHex(
        exactBytes32(event.args.poolId, "classic-v3-entitlement-checkpoint-pool"),
        input.poolId,
      )) {
        fail("classic-v3-entitlement-checkpoint-pool");
      }
      continue;
    }
    if (event.eventName === "PayoutWalletChanged") {
      if (!sameHex(
        exactBytes32(event.args.poolId, "classic-v3-entitlement-payout-pool"),
        input.poolId,
      )) {
        fail("classic-v3-entitlement-payout-pool");
      }
      add(
        event.args.previousPayoutWallet,
        "classic-v3-previous-entitlement-account",
      );
      add(event.args.newPayoutWallet, "classic-v3-new-entitlement-account");
      continue;
    }
    if (event.eventName !== "CtoRewardConfigurationActivated" || !sameHex(
      exactBytes32(event.args.poolId, "classic-v3-entitlement-cto-pool"),
      input.poolId,
    )) {
      fail("classic-v3-entitlement-event");
    }
    if (!Array.isArray(event.args.beneficiaries)) {
      fail("classic-v3-entitlement-cto-beneficiaries");
    }
    event.args.beneficiaries.forEach((account) =>
      add(account, "classic-v3-cto-entitlement-account")
    );
  }
  if (accounts.size < 1) fail("classic-v3-entitlement-account-count");
  return Object.freeze(
    [...accounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, account]) => account),
  );
}

function swapPoints(logs: readonly DecodedLog[], poolId: HexBytes32) {
  const matches = logs.filter((event) =>
    event.eventName === "Swap" &&
    sameHex(exactBytes32(event.args.id, "classic-v3-swap-pool"), poolId)
  );
  const byBlock = new Map<string, DecodedLog>();
  for (const event of matches) {
    byBlock.set(event.log.blockNumber.toString(), event);
  }
  return Object.freeze({
    swapCount: matches.length,
    last: matches.at(-1) ?? null,
    points: Object.freeze([...byBlock.values()].map((event) => ({
      blockNumber: event.log.blockNumber.toString(),
      blockHash: event.log.blockHash,
      transactionHash: event.log.transactionHash,
      transactionIndex: event.log.transactionIndex,
      logIndex: event.log.logIndex,
      sqrtPriceX96: nonnegative(event.args.sqrtPriceX96, "classic-v3-swap-price").toString(),
      liquidity: nonnegative(event.args.liquidity, "classic-v3-swap-liquidity").toString(),
      tick: safeInteger(event.args.tick, -887_272, 887_272, "classic-v3-swap-tick"),
      feePips: safeInteger(event.args.fee, 0, 1_000_000, "classic-v3-swap-fee"),
    }))),
  });
}

function isoTimestamp(timestamp: bigint) {
  if (timestamp > 8_640_000_000_000n) fail("classic-v3-block-timestamp");
  return new Date(Number(timestamp) * 1_000).toISOString();
}

async function buildContribution(input: {
  rpc: ExactBlockRpcClient;
  contract: ReconcilerPreParityContract;
  blockNumber: bigint;
  blockHash: HexBytes32;
  signal: AbortSignal;
}): Promise<ReconcilerRouteContribution> {
  const release = resolvedRelease(input.contract);
  if (input.blockNumber < release.startBlock) {
    fail("classic-v3-checkpoint-before-release");
  }
  await assertRuntime(input.rpc, release, input.blockHash, input.signal);

  const [launcherLogs, hookLogs, factoryLogs] = await Promise.all([
    readLogsInRanges({
      rpc: input.rpc,
      addresses: release.launcher,
      events: LAUNCHER_EVENTS,
      fromBlock: release.startBlock,
      toBlock: input.blockNumber,
      signal: input.signal,
    }),
    readLogsInRanges({
      rpc: input.rpc,
      addresses: release.hook,
      events: HOOK_EVENTS,
      fromBlock: release.startBlock,
      toBlock: input.blockNumber,
      signal: input.signal,
    }),
    readLogsInRanges({
      rpc: input.rpc,
      addresses: release.rewardVaultFactory,
      events: [vaultDeployedEvent],
      fromBlock: release.startBlock,
      toBlock: input.blockNumber,
      signal: input.signal,
    }),
  ]);
  const launches = launchRecords(launcherLogs, release);
  const companions = validatedCompanions({
    launches,
    launcherLogs,
    hookLogs,
    factoryLogs,
    release,
  });
  const transactionBindings = launches.map((launch) => Object.freeze({
    transactionHash: launch.transactionHash,
    expectedBlockNumber: launch.blockNumber,
    expectedBlockHash: launch.blockHash,
    expectedTo: release.launcher,
  }));
  const receiptBindings = launches.map((launch) => Object.freeze({
    transactionHash: launch.transactionHash,
    expectedBlockNumber: launch.blockNumber,
    expectedBlockHash: launch.blockHash,
  }));
  const [transactions, receipts] = await Promise.all([
    input.rpc.getTransactions({
      transactions: transactionBindings,
      signal: input.signal,
    }),
    input.rpc.getTransactionReceipts({
      receipts: receiptBindings,
      signal: input.signal,
    }),
  ]);
  const launchTransactions = validatedLaunchTransactions({
    launches,
    transactions,
    receipts,
    companions,
    release,
  });
  const vaults = launches.map(({ rewardVault }) => rewardVault);
  const [vaultLogs, poolSwapLogs] = await Promise.all([
    readAddressBatches({
      rpc: input.rpc,
      addresses: vaults,
      events: VAULT_EVENTS,
      fromBlock: release.startBlock,
      toBlock: input.blockNumber,
      signal: input.signal,
    }),
    readPoolSwapBatches({
      rpc: input.rpc,
      poolManager: release.poolManager,
      poolIds: launches.map(({ poolId }) => poolId),
      fromBlock: release.startBlock,
      toBlock: input.blockNumber,
      signal: input.signal,
    }),
  ]);
  const vaultLogsByAddress = groupLogsByAddress(vaultLogs);

  const initialSpecs = launches.flatMap((launch) => [
    callSpec(launch.token, uerc20ReadAbi, "name"),
    callSpec(launch.token, uerc20ReadAbi, "symbol"),
    callSpec(launch.token, uerc20ReadAbi, "decimals"),
    callSpec(launch.token, uerc20ReadAbi, "totalSupply"),
    callSpec(launch.token, uerc20ReadAbi, "creator"),
    callSpec(launch.token, uerc20ReadAbi, "metadata"),
    callSpec(release.stateView, stateViewReadAbi, "getSlot0", [launch.poolId]),
    callSpec(release.stateView, stateViewReadAbi, "getLiquidity", [launch.poolId]),
    callSpec(release.hook, classicV3HookAbi, "feeDisclosure", [launch.poolId]),
    callSpec(release.hook, classicV3HookAbi, "poolFeeConfig", [launch.poolId]),
    callSpec(release.launcher, classicV3LaunchAbi, "predictRewardVault", [
      launch.token,
      launch.deployer,
      launchTransactions.get(lowerAddress(launch.token))?.rewardBeneficiaries ?? [],
      launchTransactions.get(lowerAddress(launch.token))?.rewardSharesBps ?? [],
    ]),
    callSpec(release.rewardVaultFactory, reconcilerRewardVaultFactoryAbi, "isFactoryVault", [launch.rewardVault]),
    callSpec(release.rewardVaultFactory, reconcilerRewardVaultFactoryAbi, "configurationHashOf", [launch.rewardVault]),
    callSpec(launch.rewardVault, classicRewardVaultAbi, "feeHook"),
    callSpec(launch.rewardVault, classicRewardVaultAbi, "poolId"),
    callSpec(launch.rewardVault, classicRewardVaultAbi, "configurationHash"),
    callSpec(launch.rewardVault, classicRewardVaultAbi, "activeConfigurationHash"),
    callSpec(launch.rewardVault, classicRewardVaultAbi, "configurationEpoch"),
    callSpec(launch.rewardVault, classicRewardVaultAbi, "beneficiaryCount"),
    callSpec(launch.rewardVault, classicRewardVaultAbi, "totalCreatorFeesReceived"),
    callSpec(launch.rewardVault, classicRewardVaultAbi, "totalCreatorFeesClaimed"),
  ]);
  const initialValues = await readCalls(
    input.rpc,
    initialSpecs,
    input.blockHash,
    input.signal,
  );

  const beneficiarySpecs: CallSpec[] = [];
  const beneficiaryCounts: number[] = [];
  for (let index = 0; index < launches.length; index += 1) {
    const count = safeInteger(
      initialValues[index * CALLS_PER_LAUNCH + 18],
      1,
      5,
      "classic-v3-beneficiary-count",
    );
    beneficiaryCounts.push(count);
    const vault = launches[index]!.rewardVault;
    for (let allocationIndex = 0; allocationIndex < count; allocationIndex += 1) {
      beneficiarySpecs.push(
        callSpec(vault, classicRewardVaultAbi, "beneficiaryAt", [BigInt(allocationIndex)]),
        callSpec(vault, classicRewardVaultAbi, "shareBpsAt", [BigInt(allocationIndex)]),
      );
    }
  }
  const beneficiaryBaseValues = await readCalls(
    input.rpc,
    beneficiarySpecs,
    input.blockHash,
    input.signal,
  );
  const activeBeneficiaries: Address[][] = [];
  let beneficiaryCursor = 0;
  for (const count of beneficiaryCounts) {
    const values: Address[] = [];
    for (let index = 0; index < count; index += 1) {
      values.push(exactAddress(
        beneficiaryBaseValues[beneficiaryCursor],
        "classic-v3-beneficiary",
      ));
      beneficiaryCursor += 2;
    }
    activeBeneficiaries.push(values);
  }
  const entitlementAccountsByLaunch = launches.map((launch, launchIndex) => {
    const transaction = launchTransactions.get(lowerAddress(launch.token));
    if (!transaction) fail("classic-v3-entitlement-launch-transaction");
    const logs = vaultLogsByAddress.get(lowerAddress(launch.rewardVault)) ?? [];
    // Validate the complete history before using it as an entitlement source.
    vaultEventInputs(logs, launch.poolId);
    return entitlementAccounts({
      initialBeneficiaries: transaction.rewardBeneficiaries,
      currentBeneficiaries: activeBeneficiaries[launchIndex]!,
      logs,
      poolId: launch.poolId,
    });
  });
  const balanceSpecs = launches.flatMap((launch, launchIndex) =>
    entitlementAccountsByLaunch[launchIndex]!.flatMap((beneficiary) => [
      callSpec(launch.rewardVault, classicRewardVaultAbi, "claimable", [beneficiary]),
      callSpec(launch.rewardVault, classicRewardVaultAbi, "claimedBy", [beneficiary]),
    ])
  );
  const balanceValues = await readCalls(
    input.rpc,
    balanceSpecs,
    input.blockHash,
    input.signal,
  );

  const timestamps = new Map<string, bigint>();
  for (const launch of launches) {
    const key = launch.blockNumber.toString();
    if (!timestamps.has(key)) {
      timestamps.set(key, await input.rpc.getBlockTimestamp({
        blockNumber: launch.blockNumber,
        expectedHash: launch.blockHash,
        signal: input.signal,
      }));
    }
  }

  const tokens: Json[] = [];
  const charts: Json[] = [];
  const rewards: Json[] = [];
  let beneficiaryValueCursor = 0;
  let balanceValueCursor = 0;
  for (let index = 0; index < launches.length; index += 1) {
    const launch = launches[index]!;
    const companion = companions.get(lowerAddress(launch.token));
    const launchTransaction = launchTransactions.get(lowerAddress(launch.token));
    if (!companion || !launchTransaction) {
      fail("classic-v3-companion-missing");
    }
    const offset = index * CALLS_PER_LAUNCH;
    const name = exactText(initialValues[offset], "classic-v3-token-name");
    const symbol = exactText(initialValues[offset + 1], "classic-v3-token-symbol");
    const decimals = safeInteger(initialValues[offset + 2], 0, 255, "classic-v3-token-decimals");
    const totalSupply = nonnegative(initialValues[offset + 3], "classic-v3-total-supply");
    const recordedCreator = exactAddress(initialValues[offset + 4], "classic-v3-token-creator");
    const metadata = tuple(initialValues[offset + 5], 4, "classic-v3-token-metadata");
    const slot0 = tuple(initialValues[offset + 6], 4, "classic-v3-slot0");
    nonnegative(initialValues[offset + 7], "classic-v3-active-liquidity");
    const disclosure = tuple(initialValues[offset + 8], 8, "classic-v3-fee-disclosure");
    const poolConfig = tuple(initialValues[offset + 9], 6, "classic-v3-pool-config");
    const predictedRewardVault = exactAddress(initialValues[offset + 10], "classic-v3-predicted-vault");
    const factoryVault = initialValues[offset + 11];
    const factoryConfigurationHash = exactBytes32(initialValues[offset + 12], "classic-v3-factory-configuration-hash");
    const vaultHook = exactAddress(initialValues[offset + 13], "classic-v3-vault-hook");
    const vaultPoolId = exactBytes32(initialValues[offset + 14], "classic-v3-vault-pool");
    const configurationHash = exactBytes32(initialValues[offset + 15], "classic-v3-vault-configuration-hash");
    const activeConfigurationHash = exactBytes32(initialValues[offset + 16], "classic-v3-active-configuration-hash");
    const configurationEpoch = nonnegative(initialValues[offset + 17], "classic-v3-configuration-epoch");
    const totalReceived = nonnegative(initialValues[offset + 19], "classic-v3-total-received");
    const totalClaimed = nonnegative(initialValues[offset + 20], "classic-v3-total-claimed");
    if (
      factoryVault !== true ||
      !sameHex(predictedRewardVault, launch.rewardVault) ||
      !sameHex(factoryConfigurationHash, launch.rewardConfigurationHash) ||
      !sameHex(recordedCreator, release.launcher) ||
      !sameHex(vaultHook, release.hook) ||
      !sameHex(vaultPoolId, launch.poolId) ||
      !sameHex(configurationHash, launch.rewardConfigurationHash) ||
      configurationEpoch < 1n
    ) {
      fail("classic-v3-current-provenance");
    }
    const [sqrtPriceValue, tickValue, protocolFeeValue, lpFeeValue] = slot0;
    nonnegative(sqrtPriceValue, "classic-v3-current-price");
    safeInteger(tickValue, -887_272, 887_272, "classic-v3-current-tick");
    safeInteger(protocolFeeValue, 0, 1_000_000, "classic-v3-protocol-fee");
    const currentLpFeePips = safeInteger(lpFeeValue, 0, 1_000_000, "classic-v3-current-lp-fee");
    const [
      buySwapFee,
      sellSwapFee,
      buyCreatorFee,
      sellCreatorFee,
      launcherFee,
      transferTax,
      disclosedLpFee,
      disclosedVault,
    ] = disclosure;
    const [configuredVault, registrar, configuredBuy, configuredSell, registered, pendingCreatorFees] = poolConfig;
    const buySwapFeeBps = safeInteger(buySwapFee, 100, 1_000, "classic-v3-disclosed-buy-fee");
    const sellSwapFeeBps = safeInteger(sellSwapFee, 100, 1_000, "classic-v3-disclosed-sell-fee");
    const buyCreatorFeeBps = safeInteger(buyCreatorFee, 0, 1_000, "classic-v3-disclosed-buy-creator-fee");
    const sellCreatorFeeBps = safeInteger(sellCreatorFee, 0, 1_000, "classic-v3-disclosed-sell-creator-fee");
    const launcherFeeBps = safeInteger(launcherFee, 0, 1_000, "classic-v3-disclosed-launcher-fee");
    const transferTaxBps = safeInteger(transferTax, 0, 10_000, "classic-v3-transfer-tax");
    const lpFeePips = safeInteger(disclosedLpFee, 0, 1_000_000, "classic-v3-disclosed-lp-fee");
    if (
      buySwapFeeBps !== launch.buySwapFeeBps ||
      sellSwapFeeBps !== launch.sellSwapFeeBps ||
      buyCreatorFeeBps + launcherFeeBps !== buySwapFeeBps ||
      sellCreatorFeeBps + launcherFeeBps !== sellSwapFeeBps ||
      launcherFeeBps !== 10 ||
      transferTaxBps !== 0 ||
      lpFeePips !== 0 ||
      currentLpFeePips !== 0 ||
      !sameHex(exactAddress(disclosedVault, "classic-v3-disclosed-vault"), launch.rewardVault) ||
      !sameHex(exactAddress(configuredVault, "classic-v3-configured-vault"), launch.rewardVault) ||
      !sameHex(exactAddress(registrar, "classic-v3-registrar"), release.launcher) ||
      registered !== true ||
      safeInteger(configuredBuy, 100, 1_000, "classic-v3-configured-buy-fee") !== buySwapFeeBps ||
      safeInteger(configuredSell, 100, 1_000, "classic-v3-configured-sell-fee") !== sellSwapFeeBps
    ) {
      fail("classic-v3-current-state-mismatch");
    }
    const registrationArgs = companion.registration.args;
    const eventDisclosureArgs = companion.disclosure.args;
    if (
      safeInteger(registrationArgs.buySwapFeeBps, 100, 1_000, "classic-v3-registration-buy-fee") !== buySwapFeeBps ||
      safeInteger(registrationArgs.sellSwapFeeBps, 100, 1_000, "classic-v3-registration-sell-fee") !== sellSwapFeeBps ||
      safeInteger(eventDisclosureArgs.buySwapFeeBps, 100, 1_000, "classic-v3-event-buy-fee") !== buySwapFeeBps ||
      safeInteger(eventDisclosureArgs.sellSwapFeeBps, 100, 1_000, "classic-v3-event-sell-fee") !== sellSwapFeeBps ||
      safeInteger(eventDisclosureArgs.buyCreatorFeeBps, 0, 1_000, "classic-v3-event-buy-creator-fee") !== buyCreatorFeeBps ||
      safeInteger(eventDisclosureArgs.sellCreatorFeeBps, 0, 1_000, "classic-v3-event-sell-creator-fee") !== sellCreatorFeeBps ||
      safeInteger(eventDisclosureArgs.launcherFeeBps, 0, 1_000, "classic-v3-event-launcher-fee") !== launcherFeeBps ||
      safeInteger(eventDisclosureArgs.transferTaxBps, 0, 10_000, "classic-v3-event-transfer-tax") !== transferTaxBps ||
      safeInteger(eventDisclosureArgs.lpFeePips, 0, 1_000_000, "classic-v3-event-lp-fee") !== lpFeePips
    ) {
      fail("classic-v3-registration-disclosure-mismatch");
    }
    const [descriptionValue, websiteValue, imageValue, extraDataValue] = metadata;
    const description = exactText(descriptionValue, "classic-v3-description");
    const website = exactText(websiteValue, "classic-v3-website");
    const image = exactText(imageValue, "classic-v3-image");
    const extraData = exactData(extraDataValue, "classic-v3-extra-data");
    const feeTotals = grossFeeTotals(
      hookLogs,
      poolSwapLogs,
      launch.poolId,
      buySwapFeeBps,
      sellSwapFeeBps,
    );
    const chart = swapPoints(poolSwapLogs, launch.poolId);
    if (chart.swapCount < 1 || chart.swapCount < feeTotals.count) {
      fail("classic-v3-swap-fee-event-coverage");
    }
    const liquidityArgs = companion.liquidity.args;
    const initialBuyArgs = companion.initialBuy.args;
    const custodyArgs = companion.custody.args;
    const initialBuyNative = nonnegative(
      initialBuyArgs.nativeAmount,
      "classic-v3-initial-buy-native",
    );
    const custodyAddress = exactAddress(
      custodyArgs.custody,
      "classic-v3-custody-address",
    );
    const custodyMode = safeInteger(
      custodyArgs.mode,
      0,
      3,
      "classic-v3-custody-mode",
    );
    const custodyDurationDays = safeInteger(
      custodyArgs.durationDays,
      0,
      65_535,
      "classic-v3-custody-duration",
    );
    const custodyCliffDays = safeInteger(
      custodyArgs.cliffDays,
      0,
      65_535,
      "classic-v3-custody-cliff",
    );
    if (
      launchTransaction.value !== initialBuyNative ||
      launchTransaction.name !== name ||
      launchTransaction.symbol !== symbol ||
      launchTransaction.description !== description ||
      launchTransaction.website !== website ||
      launchTransaction.image !== image ||
      !sameHex(launchTransaction.extraData, extraData) ||
      launchTransaction.custodyMode !== custodyMode ||
      launchTransaction.custodyDurationDays !== custodyDurationDays ||
      launchTransaction.custodyCliffDays !== custodyCliffDays ||
      (custodyMode === 0 && !sameHex(custodyAddress, ZERO_ADDRESS)) ||
      (custodyMode !== 0 && sameHex(custodyAddress, ZERO_ADDRESS))
    ) {
      fail("classic-v3-launch-input-state-mismatch");
    }
    const liquidityTotalSupply = nonnegative(liquidityArgs.totalSupply, "classic-v3-liquidity-supply");
    const tokenLiquidity = nonnegative(liquidityArgs.tokenLiquidityAmount, "classic-v3-token-liquidity");
    const lockedDust = nonnegative(liquidityArgs.lockedTokenDust, "classic-v3-locked-dust");
    if (liquidityTotalSupply !== totalSupply || tokenLiquidity + lockedDust > totalSupply) {
      fail("classic-v3-liquidity-conservation");
    }
    const initialTick = safeInteger(liquidityArgs.initialTick, -887_272, 887_272, "classic-v3-initial-tick");
    const tickLower = safeInteger(liquidityArgs.tickLower, -887_272, 887_272, "classic-v3-tick-lower");
    const tickUpper = safeInteger(liquidityArgs.tickUpper, -887_272, 887_272, "classic-v3-tick-upper");
    const eventLpFee = safeInteger(liquidityArgs.lpFeePips, 0, 1_000_000, "classic-v3-event-lp-fee");
    if (eventLpFee !== lpFeePips || tickLower >= initialTick || initialTick > tickUpper) {
      fail("classic-v3-liquidity-shape");
    }
    const timestamp = timestamps.get(launch.blockNumber.toString());
    if (timestamp === undefined) fail("classic-v3-launch-timestamp-missing");

    const count = beneficiaryCounts[index]!;
    const allocations: Json[] = [];
    const currentBeneficiaries: Address[] = [];
    const currentShares: number[] = [];
    let shareTotal = 0;
    for (let allocationIndex = 0; allocationIndex < count; allocationIndex += 1) {
      const beneficiary = exactAddress(
        beneficiaryBaseValues[beneficiaryValueCursor],
        "classic-v3-beneficiary",
      );
      const shareBps = safeInteger(
        beneficiaryBaseValues[beneficiaryValueCursor + 1],
        1,
        10_000,
        "classic-v3-beneficiary-share",
      );
      beneficiaryValueCursor += 2;
      shareTotal += shareBps;
      currentBeneficiaries.push(beneficiary);
      currentShares.push(shareBps);
      allocations.push({
        allocationIndex,
        payoutAddress: lowerAddress(beneficiary),
        shareBps,
      });
    }
    const entitlements: Json[] = [];
    let claimableTotal = 0n;
    let claimedEntitlementTotal = 0n;
    for (const account of entitlementAccountsByLaunch[index]!) {
      const claimable = nonnegative(
        balanceValues[balanceValueCursor],
        "classic-v3-claimable",
      );
      const claimed = nonnegative(
        balanceValues[balanceValueCursor + 1],
        "classic-v3-claimed",
      );
      balanceValueCursor += 2;
      claimableTotal += claimable;
      claimedEntitlementTotal += claimed;
      entitlements.push({
        account: lowerAddress(account),
        claimableWei: claimable.toString(),
        claimedWei: claimed.toString(),
      });
    }
    const pendingCreatorFeeTotal = nonnegative(
      pendingCreatorFees,
      "classic-v3-pending-creator-fees",
    );
    if (
      shareTotal !== 10_000 ||
      totalClaimed !== claimedEntitlementTotal ||
      totalReceived !== totalClaimed + claimableTotal ||
      feeTotals.creator !== totalReceived + pendingCreatorFeeTotal
    ) {
      fail("classic-v3-reward-conservation");
    }
    const expectedActiveConfigurationHash = keccak256(encodeAbiParameters(
      ACTIVE_REWARD_CONFIGURATION_PARAMETERS,
      [
        1n,
        launch.rewardVault,
        configurationHash,
        configurationEpoch,
        currentBeneficiaries,
        currentShares,
      ],
    ));
    if (!sameHex(activeConfigurationHash, expectedActiveConfigurationHash)) {
      fail("classic-v3-active-configuration-hash");
    }
    if (
      configurationEpoch === 1n &&
      (
        launchTransaction.rewardBeneficiaries.length !== currentBeneficiaries.length ||
        launchTransaction.rewardBeneficiaries.some((beneficiary, allocationIndex) =>
          !sameHex(beneficiary, currentBeneficiaries[allocationIndex]!)
        ) ||
        launchTransaction.rewardSharesBps.some((share, allocationIndex) =>
          share !== currentShares[allocationIndex]
        )
      )
    ) {
      fail("classic-v3-initial-reward-state-mismatch");
    }
    const rewardEvents = vaultEventInputs(
      vaultLogsByAddress.get(lowerAddress(launch.rewardVault)) ?? [],
      launch.poolId,
    );
    const tokenJson: Json = {
      releaseVersion: "classic-v3",
      modelId: "classic",
      tokenAddress: lowerAddress(launch.token),
      creatorAddress: lowerAddress(launch.deployer),
      launchTransactionHash: launch.transactionHash,
      launchBlockNumber: launch.blockNumber.toString(),
      launchTransactionIndex: launch.transactionIndex,
      launchLogIndex: launchTransaction.receiptLogIndex,
      launchedAt: isoTimestamp(timestamp),
      poolId: launch.poolId,
      hookAddress: lowerAddress(launch.hook),
      rewardVaultAddress: lowerAddress(launch.rewardVault),
      positionRecipient: lowerAddress(launch.positionRecipient),
      positionTokenId: launch.positionTokenId.toString(),
      launchHash: launch.launchHash,
      name,
      symbol,
      decimals,
      totalSupplyRaw: totalSupply.toString(),
      quoteAssetAddress: lowerAddress(ZERO_ADDRESS),
      fees: {
        buySwapFeeBps,
        sellSwapFeeBps,
        buyCreatorFeeBps,
        sellCreatorFeeBps,
        launcherFeeBps,
        transferTaxBps,
        lpFeePips,
      },
      liquidity: {
        tokenLiquidityAmountRaw: tokenLiquidity.toString(),
        lockedTokenDustRaw: lockedDust.toString(),
        initialTick,
        tickLower,
        tickUpper,
      },
    };
    nonnegative(initialBuyArgs.tokenAmount, "classic-v3-initial-buy-token");
    exactBytes32(custodyArgs.configurationHash, "classic-v3-custody-hash");
    tokens.push(tokenJson);
    const lastSwap = chart.last;
    if (!lastSwap) fail("classic-v3-latest-swap-missing");
    charts.push({
      releaseVersion: "classic-v3",
      modelId: "classic",
      tokenAddress: lowerAddress(launch.token),
      poolId: launch.poolId,
      quoteAssetAddress: lowerAddress(ZERO_ADDRESS),
      state: {
        blockNumber: lastSwap.log.blockNumber.toString(),
        blockHash: lastSwap.log.blockHash,
        transactionHash: lastSwap.log.transactionHash,
        transactionIndex: lastSwap.log.transactionIndex,
        logIndex: lastSwap.log.logIndex,
        sqrtPriceX96: nonnegative(
          lastSwap.args.sqrtPriceX96,
          "classic-v3-latest-swap-price",
        ).toString(),
        liquidity: nonnegative(
          lastSwap.args.liquidity,
          "classic-v3-latest-swap-liquidity",
        ).toString(),
        tick: safeInteger(
          lastSwap.args.tick,
          -887_272,
          887_272,
          "classic-v3-latest-swap-tick",
        ),
        lpFeePips,
      },
      volume: {
        quoteAssetAddress: lowerAddress(ZERO_ADDRESS),
        grossQuoteRaw: feeTotals.gross.toString(),
        creatorFeeQuoteRaw: feeTotals.creator.toString(),
        launcherFeeQuoteRaw: feeTotals.launcher.toString(),
      },
    });
    rewards.push({
      releaseVersion: "classic-v3",
      modelId: "classic",
      vaultAddress: lowerAddress(launch.rewardVault),
      poolId: launch.poolId,
      tokenAddress: lowerAddress(launch.token),
      tokenName: name,
      tokenSymbol: symbol,
      launchTransactionHash: launch.transactionHash,
      buySwapFeeBps,
      sellSwapFeeBps,
      launcherFeeBps,
      configurationHash,
      activeConfigurationHash,
      configurationEpoch: configurationEpoch.toString(),
      totalCreatorFeesReceivedWei: totalReceived.toString(),
      totalCreatorFeesClaimedWei: totalClaimed.toString(),
      pendingCreatorFeesWei: pendingCreatorFeeTotal.toString(),
      allocations,
      entitlements,
      events: [...rewardEvents],
    });
  }

  return Object.freeze({
    tokens: Object.freeze(tokens),
    charts: Object.freeze(charts),
    rewards: Object.freeze(rewards),
  });
}

/**
 * Release-specific live source for the only currently proven route family.
 * Other releases deliberately remain unconfigured until their exact DTO
 * corpus and lifecycle evidence are complete.
 */
export const buildClassicV3ExactBlockContribution = buildContribution;

export const buildClassicV3ExactBlockRoutes: ExactBlockRouteBuilder =
  async (input) => assembleReconcilerRoutesFromContributions([
    await buildContribution(input),
  ]);
