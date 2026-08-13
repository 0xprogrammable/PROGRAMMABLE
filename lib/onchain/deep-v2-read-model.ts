import {
  createPublicClient,
  formatUnits,
  getAddress,
  isAddress,
  keccak256,
  type AbiEvent,
  type Address,
  type GetLogsReturnType,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import appDeployments from "../../contracts/config/app-deployments.v1.json";
import {
  DEEP_V2_AUTOMATION_POLICY,
  DEEP_V2_FIXED_POLICY,
  deepV2AutomationReadAbi,
  deepV2ConfiguredEvent,
  deepV2GrowthVaultFactoryReadAbi,
  deepV2GrowthVaultReadAbi,
  deepV2HookReadAbi,
  deepV2InitialBuyEvent,
  deepV2LaunchAbi,
  deepV2TokenLaunchedEvent,
  deepV2VaultDeployedEvent,
  deepV2VaultRegisteredEvent,
} from "../deep-v2";
import { deepNativeSwapFeesAccruedEvent } from "../deep-v1";
import {
  getVerifiedDeepV2Release,
  type DeepLaunchModelRelease,
  type LaunchModelReleaseManifest,
} from "../launch-model-gating";
import type {
  DeepV2IndexedLaunchProvenance,
  LauncherToken,
} from "../tokens";
import { stateViewReadAbi, uerc20ReadAbi } from "./abis";
import {
  marketCapNativeWadFromSqrtPriceX96,
  nativePriceWadFromSqrtPriceX96,
} from "./math";
import { buildTokenLinks, sanitizeImageUrl } from "./metadata";
import { persistentRpcHttp } from "./persistent-rpc-cache.server";
import type {
  ExploreReadModel,
  ExploreSnapshot,
  OnchainDeployment,
} from "./types";

const CONFIRMATIONS = 12n;
const LOG_RANGE = 10_000n;
const COMPLETION_TOLERANCE_NATIVE_WEI = 1_000_000_000_000n;
const MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION_WEI =
  DEEP_V2_FIXED_POLICY.growthTargetNativeWei -
  COMPLETION_TOLERANCE_NATIVE_WEI;

type VerifiedDeepV2Release = DeepLaunchModelRelease & {
  releaseVersion: "deep-full-range-v2";
  launcher: Address;
  hookFactory: Address;
  feeHook: Address;
  feeSplitVaultFactory: Address;
  rangeSourceFactory: Address;
  growthVaultFactory: Address;
  growthVaultImplementation: Address;
  automation: Address;
  positionPlanner: Address;
  positionForwarderFactory: Address;
  deploymentBlock: number;
  runtimeCodeHashes: {
    launcher: Hex;
    hookFactory: Hex;
    feeHook: Hex;
    feeSplitVaultFactory: Hex;
    rangeSourceFactory: Hex;
    growthVaultFactory: Hex;
    growthVaultImplementation: Hex;
    automation: Hex;
    positionPlanner: Hex;
    positionForwarderFactory: Hex;
  };
};

export type DeepV2EventSources = {
  launcher: Address;
  feeHook: Address;
  growthVaultFactory: Address;
  automation: Address;
};

type CommonEventRecord = {
  address: Address;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};

type DeepV2LaunchEventRecord = CommonEventRecord & {
  args: {
    deployer: Address;
    token: Address;
    poolId: Hex;
    feeHook: Address;
    growthVault: Address;
    oracleGuard: Address;
    upstreamRewardVault: Address;
    positionRecipient: Address;
    positionTokenId: bigint;
    buySwapFeeBps: number;
    sellSwapFeeBps: number;
    vaultConfigurationHash: Hex;
    launchHash: Hex;
  };
};

type DeepV2ConfigurationEventRecord = CommonEventRecord & {
  args: {
    token: Address;
    totalSupply: bigint;
    tokenReserve: bigint;
    tokenLiquidityAmount: bigint;
    lockedTokenDust: bigint;
    nativeTarget: bigint;
    tickLower: number;
    tickUpper: number;
    twapWindow: number;
    maxSpotTwapDeviationTicks: number;
    launchHash: Hex;
  };
};

type DeepV2InitialBuyEventRecord = CommonEventRecord & {
  args: {
    deployer: Address;
    token: Address;
    poolId: Hex;
    nativeAmount: bigint;
    tokenAmount: bigint;
    launchHash: Hex;
  };
};

type DeepV2VaultDeploymentEventRecord = CommonEventRecord & {
  args: {
    vault: Address;
    feeHook: Address;
    poolId: Hex;
    upstreamVault: Address;
    salt: Hex;
    configurationHash: Hex;
  };
};

type DeepV2RegistrationEventRecord = CommonEventRecord & {
  args: {
    vault: Address;
    poolId: Hex;
    registryIndex: bigint;
  };
};

export type DeepV2LaunchEventRecords = {
  launches: DeepV2LaunchEventRecord[];
  configurations: DeepV2ConfigurationEventRecord[];
  initialBuys: DeepV2InitialBuyEventRecord[];
  vaultDeployments: DeepV2VaultDeploymentEventRecord[];
  registrations: DeepV2RegistrationEventRecord[];
};

export type DeepV2LaunchBundle = {
  provenance: DeepV2IndexedLaunchProvenance;
  launch: DeepV2LaunchEventRecord["args"] & {
    blockNumber: bigint;
    blockHash: Hex;
    transactionHash: Hex;
    transactionIndex: number;
    logIndex: number;
  };
  configuration: DeepV2ConfigurationEventRecord["args"];
  initialBuy: DeepV2InitialBuyEventRecord["args"];
};

type DeepV2Volume = {
  grossNativeAmount: bigint;
  creatorFees: bigint;
  launcherFees: bigint;
  swapCount: number;
};

type DeepV2IndexedEvents = {
  bundles: DeepV2LaunchBundle[];
  volumes: Map<string, DeepV2Volume>;
};

const ZERO_VOLUME: DeepV2Volume = {
  grossNativeAmount: 0n,
  creatorFees: 0n,
  launcherFees: 0n,
  swapCount: 0,
};

function sameValue(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function sameEvent(
  left: Pick<CommonEventRecord, "transactionHash" | "blockHash">,
  right: Pick<CommonEventRecord, "transactionHash" | "blockHash">,
) {
  return (
    sameValue(left.transactionHash, right.transactionHash) &&
    sameValue(left.blockHash, right.blockHash)
  );
}

function assertEventSource(
  records: readonly CommonEventRecord[],
  expected: Address,
) {
  if (records.some((record) => !sameValue(record.address, expected))) {
    throw new Error(
      "Deep V2 event source does not belong to the verified Deep V2 release",
    );
  }
}

export function pairDeepV2LaunchEventRecords(
  sources: DeepV2EventSources,
  records: DeepV2LaunchEventRecords,
): DeepV2LaunchBundle[] {
  assertEventSource(records.launches, sources.launcher);
  assertEventSource(records.configurations, sources.launcher);
  assertEventSource(records.initialBuys, sources.launcher);
  assertEventSource(records.vaultDeployments, sources.growthVaultFactory);
  assertEventSource(records.registrations, sources.automation);

  const usedConfigurations = new Set<DeepV2ConfigurationEventRecord>();
  const usedInitialBuys = new Set<DeepV2InitialBuyEventRecord>();
  const usedVaults = new Set<DeepV2VaultDeploymentEventRecord>();
  const usedRegistrations = new Set<DeepV2RegistrationEventRecord>();

  const bundles = records.launches.map((launchRecord) => {
    const launch = launchRecord.args;
    const configuration = records.configurations.find(
      (candidate) =>
        sameEvent(candidate, launchRecord) &&
        sameValue(candidate.args.token, launch.token) &&
        sameValue(candidate.args.launchHash, launch.launchHash),
    );
    const initialBuy = records.initialBuys.find(
      (candidate) =>
        sameEvent(candidate, launchRecord) &&
        sameValue(candidate.args.deployer, launch.deployer) &&
        sameValue(candidate.args.token, launch.token) &&
        sameValue(candidate.args.poolId, launch.poolId) &&
        sameValue(candidate.args.launchHash, launch.launchHash),
    );
    const vaultDeployment = records.vaultDeployments.find(
      (candidate) =>
        sameEvent(candidate, launchRecord) &&
        sameValue(candidate.args.vault, launch.growthVault) &&
        sameValue(candidate.args.feeHook, launch.feeHook) &&
        sameValue(candidate.args.poolId, launch.poolId) &&
        sameValue(candidate.args.upstreamVault, launch.upstreamRewardVault) &&
        sameValue(
          candidate.args.configurationHash,
          launch.vaultConfigurationHash,
        ),
    );
    const registration = records.registrations.find(
      (candidate) =>
        sameEvent(candidate, launchRecord) &&
        sameValue(candidate.args.vault, launch.growthVault) &&
        sameValue(candidate.args.poolId, launch.poolId),
    );

    if (!configuration || !initialBuy || !vaultDeployment || !registration) {
      throw new Error("Events do not form one atomic Deep V2 launch");
    }
    usedConfigurations.add(configuration);
    usedInitialBuys.add(initialBuy);
    usedVaults.add(vaultDeployment);
    usedRegistrations.add(registration);

    return {
      provenance: {
        deepReleaseVersion: "deep-full-range-v2" as const,
        launcher: sources.launcher,
        creator: launch.deployer,
        tokenAddress: launch.token,
        vaultAddress: launch.growthVault,
        hookAddress: launch.feeHook,
        poolId: launch.poolId,
        launchHash: launch.launchHash,
        vaultConfigurationHash: launch.vaultConfigurationHash,
        blockNumber: launchRecord.blockNumber.toString(),
        blockHash: launchRecord.blockHash,
        transactionHash: launchRecord.transactionHash,
        logIndex: launchRecord.logIndex,
      },
      launch: {
        ...launch,
        blockNumber: launchRecord.blockNumber,
        blockHash: launchRecord.blockHash,
        transactionHash: launchRecord.transactionHash,
        transactionIndex: launchRecord.transactionIndex,
        logIndex: launchRecord.logIndex,
      },
      configuration: configuration.args,
      initialBuy: initialBuy.args,
    };
  });

  if (
    usedConfigurations.size !== records.configurations.length ||
    usedInitialBuys.size !== records.initialBuys.length ||
    usedVaults.size !== records.vaultDeployments.length ||
    usedRegistrations.size !== records.registrations.length
  ) {
    throw new Error("Deep V2 launch events contain unmatched records");
  }
  return bundles;
}

export function findDeepV2LaunchByTransaction(
  model: ExploreReadModel,
  transactionHash: string,
) {
  if (!/^0x[a-f0-9]{64}$/i.test(transactionHash)) {
    return null;
  }
  return (
    model.tokens.find((token) => {
      const provenance = token.deepV2Provenance;
      return (
        token.launchModel === "deep" &&
        token.deepReleaseVersion === "deep-full-range-v2" &&
        provenance?.deepReleaseVersion === "deep-full-range-v2" &&
        sameValue(provenance.transactionHash, transactionHash) &&
        sameValue(provenance.tokenAddress, token.tokenAddress) &&
        sameValue(provenance.hookAddress, token.hookAddress) &&
        sameValue(provenance.poolId, token.poolId) &&
        token.creatorAddress !== undefined &&
        sameValue(provenance.creator, token.creatorAddress) &&
        token.growthVaultAddress !== undefined &&
        sameValue(provenance.vaultAddress, token.growthVaultAddress)
      );
    }) ?? null
  );
}

export function resolveVerifiedDeepV2IndexerRelease(
  manifest: LaunchModelReleaseManifest,
  chainId: number,
): VerifiedDeepV2Release | null {
  return getVerifiedDeepV2Release(
    manifest,
    chainId,
  ) as VerifiedDeepV2Release | null;
}

function verifiedReleaseFor(config: OnchainDeployment) {
  const manifest = appDeployments[
    config.environment
  ] as unknown as LaunchModelReleaseManifest;
  return resolveVerifiedDeepV2IndexerRelease(manifest, config.chainId);
}

export function isDeepV2ExploreReleaseReady(config: OnchainDeployment) {
  return verifiedReleaseFor(config) !== null;
}

function createClient(config: OnchainDeployment, rpcUrl: string) {
  return createPublicClient({
    chain: config.chainId === 1 ? mainnet : sepolia,
    batch: { multicall: true },
    transport: persistentRpcHttp(rpcUrl, {
      chainId: config.chainId,
      http: { retryCount: 2, timeout: 12_000 },
    }),
  });
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

async function getLogsInRanges<const Event extends AbiEvent>(
  client: PublicClient,
  input: {
    address: Address;
    event: Event;
    fromBlock: bigint;
    toBlock: bigint;
  },
): Promise<
  GetLogsReturnType<
    Event,
    Event extends AbiEvent ? [Event] : undefined,
    true,
    bigint,
    bigint
  >
> {
  const logs: GetLogsReturnType<
    Event,
    Event extends AbiEvent ? [Event] : undefined,
    true,
    bigint,
    bigint
  > = [];
  for (
    let rangeStart = input.fromBlock;
    rangeStart <= input.toBlock;
    rangeStart += LOG_RANGE
  ) {
    logs.push(
      ...(await client.getLogs({
        address: input.address,
        event: input.event,
        fromBlock: rangeStart,
        toBlock: minimum(input.toBlock, rangeStart + LOG_RANGE - 1n),
        strict: true,
      })),
    );
  }
  return logs;
}

function commonEventRecord(log: {
  address: Address;
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  transactionIndex: number | null;
  logIndex: number | null;
}) {
  if (
    log.blockNumber === null ||
    !log.blockHash ||
    !log.transactionHash ||
    log.transactionIndex === null ||
    log.logIndex === null
  ) {
    throw new Error("Deep V2 event is missing confirmed block provenance");
  }
  return {
    address: getAddress(log.address),
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
  };
}

async function indexDeepV2Events(
  client: PublicClient,
  release: VerifiedDeepV2Release,
  toBlock: bigint,
): Promise<DeepV2IndexedEvents> {
  const fromBlock = BigInt(release.deploymentBlock);
  if (fromBlock > toBlock) return { bundles: [], volumes: new Map() };
  const [
    launchLogs,
    configurationLogs,
    initialBuyLogs,
    vaultDeploymentLogs,
    registrationLogs,
    feeLogs,
  ] = await Promise.all([
    getLogsInRanges(client, {
      address: release.launcher,
      event: deepV2TokenLaunchedEvent,
      fromBlock,
      toBlock,
    }),
    getLogsInRanges(client, {
      address: release.launcher,
      event: deepV2ConfiguredEvent,
      fromBlock,
      toBlock,
    }),
    getLogsInRanges(client, {
      address: release.launcher,
      event: deepV2InitialBuyEvent,
      fromBlock,
      toBlock,
    }),
    getLogsInRanges(client, {
      address: release.growthVaultFactory,
      event: deepV2VaultDeployedEvent,
      fromBlock,
      toBlock,
    }),
    getLogsInRanges(client, {
      address: release.automation,
      event: deepV2VaultRegisteredEvent,
      fromBlock,
      toBlock,
    }),
    getLogsInRanges(client, {
      address: release.feeHook,
      event: deepNativeSwapFeesAccruedEvent,
      fromBlock,
      toBlock,
    }),
  ]);

  const records: DeepV2LaunchEventRecords = {
    launches: launchLogs
      .filter((log) => !log.removed)
      .map((log) => ({
        ...commonEventRecord(log),
        args: {
          deployer: getAddress(log.args.deployer),
          token: getAddress(log.args.token),
          poolId: log.args.poolId,
          feeHook: getAddress(log.args.feeHook),
          growthVault: getAddress(log.args.growthVault),
          oracleGuard: getAddress(log.args.oracleGuard),
          upstreamRewardVault: getAddress(log.args.upstreamRewardVault),
          positionRecipient: getAddress(log.args.positionRecipient),
          positionTokenId: log.args.positionTokenId,
          buySwapFeeBps: log.args.buySwapFeeBps,
          sellSwapFeeBps: log.args.sellSwapFeeBps,
          vaultConfigurationHash: log.args.vaultConfigurationHash,
          launchHash: log.args.launchHash,
        },
      })),
    configurations: configurationLogs
      .filter((log) => !log.removed)
      .map((log) => ({
        ...commonEventRecord(log),
        args: {
          token: getAddress(log.args.token),
          totalSupply: log.args.totalSupply,
          tokenReserve: log.args.tokenReserve,
          tokenLiquidityAmount: log.args.tokenLiquidityAmount,
          lockedTokenDust: log.args.lockedTokenDust,
          nativeTarget: log.args.nativeTarget,
          tickLower: log.args.tickLower,
          tickUpper: log.args.tickUpper,
          twapWindow: log.args.twapWindow,
          maxSpotTwapDeviationTicks:
            log.args.maxSpotTwapDeviationTicks,
          launchHash: log.args.launchHash,
        },
      })),
    initialBuys: initialBuyLogs
      .filter((log) => !log.removed)
      .map((log) => ({
        ...commonEventRecord(log),
        args: {
          deployer: getAddress(log.args.deployer),
          token: getAddress(log.args.token),
          poolId: log.args.poolId,
          nativeAmount: log.args.nativeAmount,
          tokenAmount: log.args.tokenAmount,
          launchHash: log.args.launchHash,
        },
      })),
    vaultDeployments: vaultDeploymentLogs
      .filter((log) => !log.removed)
      .map((log) => ({
        ...commonEventRecord(log),
        args: {
          vault: getAddress(log.args.vault),
          feeHook: getAddress(log.args.feeHook),
          poolId: log.args.poolId,
          upstreamVault: getAddress(log.args.upstreamVault),
          salt: log.args.salt,
          configurationHash: log.args.configurationHash,
        },
      })),
    registrations: registrationLogs
      .filter((log) => !log.removed)
      .map((log) => ({
        ...commonEventRecord(log),
        args: {
          vault: getAddress(log.args.vault),
          poolId: log.args.poolId,
          registryIndex: log.args.registryIndex,
        },
      })),
  };
  const bundles = pairDeepV2LaunchEventRecords(release, records);

  const volumes = new Map<string, DeepV2Volume>();
  for (const log of feeLogs) {
    if (log.removed) continue;
    const key = log.args.poolId.toLowerCase();
    const current = volumes.get(key) ?? ZERO_VOLUME;
    volumes.set(key, {
      grossNativeAmount:
        current.grossNativeAmount + log.args.grossNativeAmount,
      creatorFees: current.creatorFees + log.args.creatorFee,
      launcherFees: current.launcherFees + log.args.launcherFee,
      swapCount: current.swapCount + 1,
    });
  }
  return { bundles, volumes };
}

function eventFingerprint(events: DeepV2IndexedEvents) {
  return JSON.stringify(
    {
      bundles: events.bundles,
      volumes: [...events.volumes.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    },
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
  );
}

async function assertRuntimeCode(
  client: PublicClient,
  address: Address,
  expectedHash: Hex,
  blockNumber: bigint,
  label: string,
) {
  const code = await client.getCode({ address, blockNumber });
  if (!code || code === "0x" || keccak256(code) !== expectedHash) {
    throw new Error(`${label} runtime code does not match Deep V2`);
  }
}

function releaseRuntimeEntries(release: VerifiedDeepV2Release) {
  const fields = [
    "launcher",
    "hookFactory",
    "feeHook",
    "feeSplitVaultFactory",
    "rangeSourceFactory",
    "growthVaultFactory",
    "growthVaultImplementation",
    "automation",
    "positionPlanner",
    "positionForwarderFactory",
  ] as const;
  return fields.map((field) => ({
    field,
    address: getAddress(release[field]),
    hash: release.runtimeCodeHashes[field],
  }));
}

async function hydrateDeepV2Token(
  client: PublicClient,
  config: OnchainDeployment,
  release: VerifiedDeepV2Release,
  bundle: DeepV2LaunchBundle,
  volume: DeepV2Volume,
  blockTimestamp: bigint,
  snapshotBlock: bigint,
): Promise<LauncherToken> {
  const { launch, configuration, provenance } = bundle;
  const [
    name,
    symbol,
    decimals,
    totalSupply,
    tokenCreator,
    metadata,
    slot0,
    activeLiquidity,
    feeDisclosure,
    poolConfig,
    launcherHash,
    launcherVault,
    factoryVault,
    factoryConfigurationHash,
    factoryImplementation,
    registeredVault,
    automationLauncher,
    automationFactory,
    vaultFactory,
    vaultHook,
    vaultPoolManager,
    vaultPositionManager,
    vaultPoolId,
    vaultToken,
    vaultPositionTokenId,
    vaultPositionRecipient,
    vaultOracleGuard,
    upstreamVault,
    vaultCreator,
    vaultConfigurationHash,
    initialized,
    growthTarget,
    completionTolerance,
    minimumNativeLiquidityForCompletion,
    tokenReserve,
    nativeAllocated,
    nativeAdded,
    tokenAdded,
    pendingGrowth,
    deferredRewardFees,
    growthTargetReached,
    oracleReady,
    workState,
    automationAction,
    launcherPoolManager,
    launcherPositionManager,
    launcherTokenFactory,
    launcherHook,
    launcherVaultFactory,
    launcherAutomation,
  ] = await Promise.all([
    client.readContract({
      address: launch.token,
      abi: uerc20ReadAbi,
      functionName: "name",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.token,
      abi: uerc20ReadAbi,
      functionName: "symbol",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.token,
      abi: uerc20ReadAbi,
      functionName: "decimals",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.token,
      abi: uerc20ReadAbi,
      functionName: "totalSupply",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.token,
      abi: uerc20ReadAbi,
      functionName: "creator",
      blockNumber: snapshotBlock,
    }),
    client
      .readContract({
        address: launch.token,
        abi: uerc20ReadAbi,
        functionName: "metadata",
        blockNumber: snapshotBlock,
      })
      .catch(() => null),
    client.readContract({
      address: config.stateView,
      abi: stateViewReadAbi,
      functionName: "getSlot0",
      args: [launch.poolId],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: config.stateView,
      abi: stateViewReadAbi,
      functionName: "getLiquidity",
      args: [launch.poolId],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.feeHook,
      abi: deepV2HookReadAbi,
      functionName: "feeDisclosure",
      args: [launch.poolId],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.feeHook,
      abi: deepV2HookReadAbi,
      functionName: "poolFeeConfig",
      args: [launch.poolId],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.launcher,
      abi: deepV2LaunchAbi,
      functionName: "launchHashOf",
      args: [launch.token],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.launcher,
      abi: deepV2LaunchAbi,
      functionName: "growthVaultOf",
      args: [launch.token],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.growthVaultFactory,
      abi: deepV2GrowthVaultFactoryReadAbi,
      functionName: "isFactoryVault",
      args: [launch.growthVault],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.growthVaultFactory,
      abi: deepV2GrowthVaultFactoryReadAbi,
      functionName: "configurationHashOf",
      args: [launch.growthVault],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.growthVaultFactory,
      abi: deepV2GrowthVaultFactoryReadAbi,
      functionName: "implementation",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.automation,
      abi: deepV2AutomationReadAbi,
      functionName: "isRegisteredVault",
      args: [launch.growthVault],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.automation,
      abi: deepV2AutomationReadAbi,
      functionName: "launcher",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.automation,
      abi: deepV2AutomationReadAbi,
      functionName: "vaultFactory",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "FACTORY",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "feeHook",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "poolManager",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "positionManager",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "poolId",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "token",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "initialPositionTokenId",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "initialPositionRecipient",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "oracleGuard",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "upstreamVault",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "creator",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "configurationHash",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "initialized",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "growthTargetNative",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "completionToleranceNative",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "minimumNativeLiquidityForCompletion",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "tokenReserveTarget",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "totalNativeAllocatedToGrowth",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "totalNativeAddedToLiquidity",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "totalTokenAddedToLiquidity",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "pendingGrowthNative",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "deferredRewardFees",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "growthTargetReached",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "oracleReady",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: launch.growthVault,
      abi: deepV2GrowthVaultReadAbi,
      functionName: "workState",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.automation,
      abi: deepV2AutomationReadAbi,
      functionName: "checkVault",
      args: [launch.growthVault],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.launcher,
      abi: deepV2LaunchAbi,
      functionName: "poolManager",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.launcher,
      abi: deepV2LaunchAbi,
      functionName: "positionManager",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.launcher,
      abi: deepV2LaunchAbi,
      functionName: "tokenFactory",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.launcher,
      abi: deepV2LaunchAbi,
      functionName: "feeHook",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.launcher,
      abi: deepV2LaunchAbi,
      functionName: "growthVaultFactory",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.launcher,
      abi: deepV2LaunchAbi,
      functionName: "automation",
      blockNumber: snapshotBlock,
    }),
  ]);
  const [sqrtPriceX96, currentTick, protocolFeePips, lpFeePips] = slot0;
  const buyCreatorFeeBps = feeDisclosure[2];
  const sellCreatorFeeBps = feeDisclosure[3];
  if (
    !sameValue(launch.feeHook, release.feeHook) ||
    !sameValue(tokenCreator, release.launcher) ||
    decimals !== 18 ||
    totalSupply !== DEEP_V2_FIXED_POLICY.tokenSupplyWei ||
    configuration.totalSupply !== totalSupply ||
    configuration.tokenReserve !==
      DEEP_V2_FIXED_POLICY.tokenReserveTargetWei ||
    configuration.nativeTarget !==
      DEEP_V2_FIXED_POLICY.growthTargetNativeWei ||
    configuration.tickLower !==
      DEEP_V2_AUTOMATION_POLICY.fullRangeTickLower ||
    configuration.tickUpper !==
      DEEP_V2_AUTOMATION_POLICY.fullRangeTickUpper ||
    configuration.twapWindow !== DEEP_V2_FIXED_POLICY.twapWindowSeconds ||
    configuration.maxSpotTwapDeviationTicks !==
      DEEP_V2_FIXED_POLICY.maximumSpotTwapDeviationTicks ||
    launch.buySwapFeeBps !== DEEP_V2_FIXED_POLICY.totalSwapFeeBps ||
    launch.sellSwapFeeBps !== DEEP_V2_FIXED_POLICY.totalSwapFeeBps ||
    launcherHash !== launch.launchHash ||
    !sameValue(launcherVault, launch.growthVault) ||
    !factoryVault ||
    factoryConfigurationHash !== launch.vaultConfigurationHash ||
    !sameValue(factoryImplementation, release.growthVaultImplementation) ||
    !registeredVault ||
    !sameValue(automationLauncher, release.launcher) ||
    !sameValue(automationFactory, release.growthVaultFactory) ||
    !sameValue(vaultFactory, release.growthVaultFactory) ||
    !sameValue(vaultHook, release.feeHook) ||
    !sameValue(vaultPoolManager, launcherPoolManager) ||
    !sameValue(vaultPositionManager, launcherPositionManager) ||
    vaultPoolId !== launch.poolId ||
    !sameValue(vaultToken, launch.token) ||
    vaultPositionTokenId !== launch.positionTokenId ||
    !sameValue(vaultPositionRecipient, launch.positionRecipient) ||
    !sameValue(vaultOracleGuard, launch.oracleGuard) ||
    !sameValue(upstreamVault, launch.upstreamRewardVault) ||
    !sameValue(vaultCreator, launch.deployer) ||
    vaultConfigurationHash !== launch.vaultConfigurationHash ||
    !initialized ||
    growthTarget !== DEEP_V2_FIXED_POLICY.growthTargetNativeWei ||
    completionTolerance !== COMPLETION_TOLERANCE_NATIVE_WEI ||
    minimumNativeLiquidityForCompletion !==
      MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION_WEI ||
    tokenReserve !== DEEP_V2_FIXED_POLICY.tokenReserveTargetWei ||
    nativeAllocated > growthTarget ||
    nativeAdded > growthTarget ||
    workState[2] !== pendingGrowth ||
    workState[0] > 2 ||
    automationAction > 3 ||
    feeDisclosure[0] !== DEEP_V2_FIXED_POLICY.totalSwapFeeBps ||
    feeDisclosure[1] !== DEEP_V2_FIXED_POLICY.totalSwapFeeBps ||
    buyCreatorFeeBps !== DEEP_V2_FIXED_POLICY.creatorFeeBps ||
    sellCreatorFeeBps !== DEEP_V2_FIXED_POLICY.creatorFeeBps ||
    feeDisclosure[4] !== DEEP_V2_FIXED_POLICY.programmableFeeBps ||
    feeDisclosure[5] !== 0 ||
    feeDisclosure[6] !== 0 ||
    !sameValue(feeDisclosure[7], launch.upstreamRewardVault) ||
    !sameValue(poolConfig[0], launch.upstreamRewardVault) ||
    !sameValue(poolConfig[1], release.launcher) ||
    poolConfig[2] !== DEEP_V2_FIXED_POLICY.totalSwapFeeBps ||
    poolConfig[3] !== DEEP_V2_FIXED_POLICY.totalSwapFeeBps ||
    !poolConfig[4] ||
    lpFeePips !== DEEP_V2_FIXED_POLICY.lpFeePips ||
    !sameValue(launcherHook, release.feeHook) ||
    !sameValue(launcherVaultFactory, release.growthVaultFactory) ||
    !sameValue(launcherAutomation, release.automation) ||
    !isAddress(launcherPoolManager) ||
    !isAddress(launcherPositionManager) ||
    !isAddress(launcherTokenFactory)
  ) {
    throw new Error(`Deep V2 launch provenance mismatch for ${launch.token}`);
  }

  const tokenPriceEthWei = nativePriceWadFromSqrtPriceX96(
    sqrtPriceX96,
    decimals,
  );
  const marketCapEthWei = marketCapNativeWadFromSqrtPriceX96(
    totalSupply,
    sqrtPriceX96,
  );
  const description = metadata?.[0]?.trim() || undefined;
  const website = metadata?.[1] ?? "";
  const image = metadata?.[2] ?? "";
  const extraData = metadata?.[3] ?? "0x";

  return {
    id: `${config.chainId}:${launch.token.toLowerCase()}`,
    name,
    symbol,
    description,
    imageUrl: sanitizeImageUrl(image) ?? undefined,
    links: buildTokenLinks(website, extraData),
    tokenAddress: launch.token,
    hookAddress: release.feeHook,
    poolId: launch.poolId,
    creatorAddress: launch.deployer,
    positionRecipient: launch.positionRecipient,
    positionTokenId: launch.positionTokenId.toString(),
    launchHash: launch.launchHash,
    launchBlockNumber: launch.blockNumber.toString(),
    launchTransactionHash: launch.transactionHash,
    launchTransactionIndex: launch.transactionIndex,
    launchLogIndex: launch.logIndex,
    launchedAt: new Date(Number(blockTimestamp) * 1_000).toISOString(),
    totalSupply: formatUnits(totalSupply, decimals),
    totalSupplyRaw: totalSupply.toString(),
    tokenDecimals: decimals,
    tokenLiquidityAmountRaw:
      configuration.tokenLiquidityAmount.toString(),
    lockedTokenDustRaw: configuration.lockedTokenDust.toString(),
    tokenPriceEth: formatUnits(tokenPriceEthWei, 18),
    tokenPriceEthWei: tokenPriceEthWei.toString(),
    marketCapEth: formatUnits(marketCapEthWei, 18),
    marketCapEthWei: marketCapEthWei.toString(),
    grossVolumeEth: formatUnits(volume.grossNativeAmount, 18),
    grossVolumeWei: volume.grossNativeAmount.toString(),
    creatorFeesGeneratedEth: formatUnits(volume.creatorFees, 18),
    creatorFeesGeneratedWei: volume.creatorFees.toString(),
    launcherFeesGeneratedEth: formatUnits(volume.launcherFees, 18),
    launcherFeesGeneratedWei: volume.launcherFees.toString(),
    creatorFeesAccruedEth: formatUnits(poolConfig[5], 18),
    creatorFeesAccruedWei: poolConfig[5].toString(),
    swapCount: volume.swapCount,
    currentTick,
    initialTick: DEEP_V2_FIXED_POLICY.initialTick,
    tickLower: configuration.tickLower,
    tickUpper: configuration.tickUpper,
    activeLiquidity: activeLiquidity.toString(),
    protocolFeePips,
    lpFeePips,
    buyHookFeeBps: feeDisclosure[0],
    sellHookFeeBps: feeDisclosure[1],
    creatorFeeBps: buyCreatorFeeBps,
    buyCreatorFeeBps,
    sellCreatorFeeBps,
    launcherFeeBps: feeDisclosure[4],
    transferTaxBps: feeDisclosure[5],
    totalSwapFeeBps: DEEP_V2_FIXED_POLICY.totalSwapFeeBps,
    launchModel: "deep",
    deepReleaseVersion: "deep-full-range-v2",
    growthVaultAddress: launch.growthVault,
    oracleGuardAddress: launch.oracleGuard,
    upstreamRewardVaultAddress: launch.upstreamRewardVault,
    growthTargetNativeWei: growthTarget.toString(),
    completionToleranceNativeWei: completionTolerance.toString(),
    minimumNativeLiquidityForCompletionWei:
      minimumNativeLiquidityForCompletion.toString(),
    tokenReserveRaw: tokenReserve.toString(),
    totalNativeAllocatedToGrowthWei: nativeAllocated.toString(),
    totalNativeAddedToLiquidityWei: nativeAdded.toString(),
    totalTokenAddedToLiquidityRaw: tokenAdded.toString(),
    pendingGrowthNativeWei: pendingGrowth.toString(),
    deferredRewardFeesWei: deferredRewardFees.toString(),
    growthTargetReached,
    oracleReady,
    automationAction: automationAction as 0 | 1 | 2 | 3,
    nextCompoundTimestamp: workState[3].toString(),
    trustedNativeDepthWei: workState[4].toString(),
    depthCapNativeWei: workState[5].toString(),
    automationGuaranteed: false,
    deepV2Provenance: provenance,
    liquidityPath: "meme",
    metadataExtraData: extraData,
  };
}

function emptyDeepV2Model(snapshot: ExploreSnapshot): ExploreReadModel {
  return {
    status: "ready",
    tokens: [],
    snapshot,
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

export async function readDeepV2ExploreModel(
  config: OnchainDeployment,
  snapshotBlockInput?: string,
): Promise<ExploreReadModel | null> {
  const release = verifiedReleaseFor(config);
  if (!release || config.status !== "ready") return null;

  const rpcUrls = [
    config.rpcUrl,
    ...(config.rpcUrlSecondary ? [config.rpcUrlSecondary] : []),
  ];
  const clients = rpcUrls.map((rpcUrl) => createClient(config, rpcUrl));
  const chainStates = await Promise.all(
    clients.map(async (client) => ({
      chainId: await client.getChainId(),
      head: await client.getBlockNumber(),
    })),
  );
  if (chainStates.some((state) => state.chainId !== config.chainId)) {
    throw new Error("Deep V2 RPC chain does not match the release manifest");
  }
  const lowestHead = chainStates.reduce(
    (lowest, state) => minimum(lowest, state.head),
    chainStates[0].head,
  );
  const snapshotBlockNumber = snapshotBlockInput
    ? BigInt(snapshotBlockInput)
    : lowestHead > CONFIRMATIONS
      ? lowestHead - CONFIRMATIONS
      : 0n;
  if (snapshotBlockNumber > lowestHead) {
    throw new Error("Deep V2 snapshot is ahead of the available RPC head");
  }

  const blocks = await Promise.all(
    clients.map((client) =>
      client.getBlock({ blockNumber: snapshotBlockNumber }),
    ),
  );
  const snapshotBlock = blocks[0];
  if (
    !snapshotBlock.hash ||
    blocks.some(
      (block) =>
        !block.hash ||
        !sameValue(block.hash, snapshotBlock.hash as Hex),
    )
  ) {
    throw new Error("Independent RPCs disagree on the Deep V2 snapshot");
  }
  const snapshot: ExploreSnapshot = {
    chainId: config.chainId,
    blockNumber: snapshotBlockNumber.toString(),
    blockHash: snapshotBlock.hash,
    confirmations: Number(CONFIRMATIONS),
  };
  if (snapshotBlockNumber < BigInt(release.deploymentBlock)) {
    return emptyDeepV2Model(snapshot);
  }

  await Promise.all(
    clients.flatMap((client) => [
      ...releaseRuntimeEntries(release).map((entry) =>
        assertRuntimeCode(
          client,
          entry.address,
          entry.hash,
          snapshotBlockNumber,
          `Deep V2 ${entry.field}`,
        ),
      ),
      assertRuntimeCode(
        client,
        config.stateView,
        config.stateViewRuntimeCodeHash,
        snapshotBlockNumber,
        "Uniswap StateView",
      ),
    ]),
  );

  const [eventSets, launcherFees] = await Promise.all([
    Promise.all(
      clients.map((client) =>
        indexDeepV2Events(client, release, snapshotBlockNumber),
      ),
    ),
    Promise.all(
      clients.map((client) =>
        client.readContract({
          address: release.feeHook,
          abi: deepV2HookReadAbi,
          functionName: "launcherFeesAccrued",
          blockNumber: snapshotBlockNumber,
        }),
      ),
    ),
  ]);
  const fingerprint = eventFingerprint(eventSets[0]);
  if (
    eventSets.some((events) => eventFingerprint(events) !== fingerprint) ||
    launcherFees.some((value) => value !== launcherFees[0])
  ) {
    throw new Error(
      "Independent RPCs disagree on Deep V2 events or fee accounting",
    );
  }
  const events = eventSets[0];

  const blockNumbers = [
    ...new Set(
      events.bundles.map(({ launch }) => launch.blockNumber.toString()),
    ),
  ].map(BigInt);
  const blockTimestamps = new Map<string, bigint>();
  await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      const blocksAtLaunch = await Promise.all(
        clients.map((client) => client.getBlock({ blockNumber })),
      );
      const launchBlock = blocksAtLaunch[0];
      const expectedHash = events.bundles.find(
        ({ launch }) => launch.blockNumber === blockNumber,
      )?.launch.blockHash;
      if (
        !launchBlock.hash ||
        !expectedHash ||
        !sameValue(launchBlock.hash, expectedHash) ||
        blocksAtLaunch.some(
          (candidate) =>
            !candidate.hash ||
            !sameValue(candidate.hash, launchBlock.hash as Hex),
        )
      ) {
        throw new Error("Deep V2 launch block is not canonical");
      }
      blockTimestamps.set(blockNumber.toString(), launchBlock.timestamp);
    }),
  );

  const tokenSets = await Promise.all(
    clients.map((client) =>
      Promise.all(
        events.bundles.map((bundle) =>
          hydrateDeepV2Token(
            client,
            config,
            release,
            bundle,
            events.volumes.get(bundle.launch.poolId.toLowerCase()) ??
              ZERO_VOLUME,
            blockTimestamps.get(bundle.launch.blockNumber.toString()) ?? 0n,
            snapshotBlockNumber,
          ),
        ),
      ),
    ),
  );
  const tokenFingerprint = JSON.stringify(tokenSets[0]);
  if (
    tokenSets.some(
      (candidate) => JSON.stringify(candidate) !== tokenFingerprint,
    )
  ) {
    throw new Error("Independent RPCs disagree on Deep V2 token state");
  }

  return {
    status: "ready",
    tokens: tokenSets[0],
    snapshot,
    creatorClaims: [],
    launcherFeesAccruedWei: launcherFees[0].toString(),
    launcherFeesAccruedEth: formatUnits(launcherFees[0], 18),
  };
}
