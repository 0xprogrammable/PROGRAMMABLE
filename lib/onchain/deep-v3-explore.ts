import {
  createPublicClient,
  formatUnits,
  getAddress,
  parseAbi,
  parseAbiItem,
  type AbiEvent,
  type Address,
  type GetLogsReturnType,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

import releaseManifest from "../../contracts/deployments/mainnet-deep-full-range-v3.json";
import type {
  DeepV3ProfileClient,
  DeepV3ProfileToken,
} from "../profile/deep-v3-profile.server";
import type { LauncherToken } from "../tokens";
import {
  assertDeepV3ReleaseRuntime,
  deepV3ConfiguredEvent,
  deepV3InitialBuyEvent,
  deepV3PoolFeeDisclosureEvent,
  deepV3PoolRegisteredEvent,
  deepV3TokenLaunchedEvent,
  deepV3VaultDeployedEvent,
  deepV3VaultRegisteredEvent,
  DEEP_V3_FIXED_POLICY,
  pairDeepV3LaunchEventRecords,
  resolveVerifiedDeepV3ReadRelease,
  type DeepV3LaunchBundle,
  type DeepV3LaunchEventRecords,
  type VerifiedDeepV3ReadRelease,
} from "./deep-v3-read-model";
import { mergeDeepExploreModel } from "./deep-read-model";
import { persistentRpcHttp } from "./persistent-rpc-cache.server";
import type {
  ExploreReadModel,
  ExploreSnapshot,
  OnchainDeployment,
} from "./types";

const CONFIRMATIONS = 12n;
const LOG_RANGE = 10_000n;

export const deepV3NativeSwapFeesAccruedEvent = parseAbiItem(
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,bool indexed isBuy,uint256 grossNativeAmount,uint256 growthFee,uint256 programmableFee)",
);

const deepV3ExploreHookReadAbi = parseAbi([
  "function launcherFeesAccrued() view returns (uint256)",
]);

type DeepV3FeeVolume = {
  grossNativeAmount: bigint;
  growthFees: bigint;
  programmableFees: bigint;
  swapCount: number;
};

type IndexedDeepV3Events = {
  bundles: DeepV3LaunchBundle[];
  volumes: Map<string, DeepV3FeeVolume>;
};

const ZERO_VOLUME: DeepV3FeeVolume = {
  grossNativeAmount: 0n,
  growthFees: 0n,
  programmableFees: 0n,
  swapCount: 0,
};

function sameValue(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

function createClient(rpcUrl: string) {
  return createPublicClient({
    chain: mainnet,
    batch: { multicall: true },
    transport: persistentRpcHttp(rpcUrl, {
      chainId: 1,
      http: { retryCount: 2, timeout: 12_000 },
    }),
  });
}

function resolveRelease(
  config: OnchainDeployment,
): VerifiedDeepV3ReadRelease | null {
  if (config.status !== "ready" || config.chainId !== 1) return null;
  return resolveVerifiedDeepV3ReadRelease(releaseManifest, config.chainId);
}

export function isDeepV3ExploreReleaseReady(config: OnchainDeployment) {
  return resolveRelease(config) !== null;
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
    throw new Error("Deep V3 event is missing confirmed provenance");
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

async function indexDeepV3Events(
  client: PublicClient,
  release: VerifiedDeepV3ReadRelease,
  toBlock: bigint,
): Promise<IndexedDeepV3Events> {
  const fromBlock = BigInt(release.startBlock);
  if (fromBlock > toBlock) {
    return { bundles: [], volumes: new Map() };
  }

  const [
    launchLogs,
    configurationLogs,
    initialBuyLogs,
    vaultDeploymentLogs,
    poolRegistrationLogs,
    feeDisclosureLogs,
    vaultRegistrationLogs,
    feeLogs,
  ] = await Promise.all([
    getLogsInRanges(client, {
      address: release.addresses.launcher,
      event: deepV3TokenLaunchedEvent,
      fromBlock,
      toBlock,
    }),
    getLogsInRanges(client, {
      address: release.addresses.launcher,
      event: deepV3ConfiguredEvent,
      fromBlock,
      toBlock,
    }),
    getLogsInRanges(client, {
      address: release.addresses.launcher,
      event: deepV3InitialBuyEvent,
      fromBlock,
      toBlock,
    }),
    getLogsInRanges(client, {
      address: release.addresses.growthVaultFactory,
      event: deepV3VaultDeployedEvent,
      fromBlock,
      toBlock,
    }),
    getLogsInRanges(client, {
      address: release.addresses.feeHook,
      event: deepV3PoolRegisteredEvent,
      fromBlock,
      toBlock,
    }),
    getLogsInRanges(client, {
      address: release.addresses.feeHook,
      event: deepV3PoolFeeDisclosureEvent,
      fromBlock,
      toBlock,
    }),
    getLogsInRanges(client, {
      address: release.addresses.automation,
      event: deepV3VaultRegisteredEvent,
      fromBlock,
      toBlock,
    }),
    getLogsInRanges(client, {
      address: release.addresses.feeHook,
      event: deepV3NativeSwapFeesAccruedEvent,
      fromBlock,
      toBlock,
    }),
  ]);

  const records: DeepV3LaunchEventRecords = {
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
          positionRecipient: getAddress(log.args.positionRecipient),
          positionTokenId: log.args.positionTokenId,
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
          initialLockedTokenDust: log.args.initialLockedTokenDust,
          totalHookFeeBps: log.args.totalHookFeeBps,
          growthFeeBps: log.args.growthFeeBps,
          programmableFeeBps: log.args.programmableFeeBps,
          initialTick: log.args.initialTick,
          fullRangeTickLower: log.args.fullRangeTickLower,
          fullRangeTickUpper: log.args.fullRangeTickUpper,
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
          sqrtPriceLimitX96: log.args.sqrtPriceLimitX96,
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
          creatorSalt: log.args.creatorSalt,
          configurationHash: log.args.configurationHash,
        },
      })),
    poolRegistrations: poolRegistrationLogs
      .filter((log) => !log.removed)
      .map((log) => ({
        ...commonEventRecord(log),
        args: {
          poolId: log.args.poolId,
          token: getAddress(log.args.token),
          growthVault: getAddress(log.args.growthVault),
          registrar: getAddress(log.args.registrar),
          totalHookFeeBps: log.args.totalHookFeeBps,
          growthFeeBps: log.args.growthFeeBps,
          programmableFeeBps: log.args.programmableFeeBps,
        },
      })),
    feeDisclosures: feeDisclosureLogs
      .filter((log) => !log.removed)
      .map((log) => ({
        ...commonEventRecord(log),
        args: {
          poolId: log.args.poolId,
          token: getAddress(log.args.token),
          growthVault: getAddress(log.args.growthVault),
          totalHookFeeBps: log.args.totalHookFeeBps,
          growthFeeBps: log.args.growthFeeBps,
          programmableFeeBps: log.args.programmableFeeBps,
          transferTaxBps: log.args.transferTaxBps,
          lpFeePips: log.args.lpFeePips,
        },
      })),
    vaultRegistrations: vaultRegistrationLogs
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

  const volumes = new Map<string, DeepV3FeeVolume>();
  for (const log of feeLogs) {
    if (log.removed) continue;
    const key = log.args.poolId.toLowerCase();
    const current = volumes.get(key) ?? ZERO_VOLUME;
    volumes.set(key, {
      grossNativeAmount:
        current.grossNativeAmount + log.args.grossNativeAmount,
      growthFees: current.growthFees + log.args.growthFee,
      programmableFees:
        current.programmableFees + log.args.programmableFee,
      swapCount: current.swapCount + 1,
    });
  }

  return {
    bundles: pairDeepV3LaunchEventRecords(release.addresses, records),
    volumes,
  };
}

function eventFingerprint(events: IndexedDeepV3Events) {
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

type ProfileLog =
  Awaited<ReturnType<DeepV3ProfileClient["getLogs"]>>[number];

function pinnedProfileClient(
  client: PublicClient,
  snapshotBlockNumber: bigint,
): DeepV3ProfileClient {
  return {
    getChainId: () => client.getChainId(),
    getBlockNumber: async () => snapshotBlockNumber + CONFIRMATIONS,
    getBlock: async ({ blockNumber }) => {
      const block = await client.getBlock({ blockNumber });
      return { hash: block.hash, timestamp: block.timestamp };
    },
    getCode: ({ address, blockNumber }) =>
      client.getCode({ address, blockNumber }),
    getLogs: async (args) =>
      (await client.getLogs(args as never)) as unknown as readonly ProfileLog[],
    readContract: (args) =>
      client.readContract(args as never) as Promise<unknown>,
  };
}

export function deepV3ProfileToLauncherToken(input: {
  chainId: number;
  profile: DeepV3ProfileToken;
  bundle: DeepV3LaunchBundle;
  volume: DeepV3FeeVolume;
}): LauncherToken {
  const { profile, bundle, volume } = input;
  if (
    profile.deepReleaseVersion !== "deep-full-range-v3" ||
    profile.launchModel !== "deep" ||
    profile.creator.toLowerCase() !==
      bundle.provenance.creator.toLowerCase() ||
    profile.launcher.toLowerCase() !==
      bundle.provenance.launcher.toLowerCase() ||
    profile.tokenAddress.toLowerCase() !==
      bundle.provenance.tokenAddress.toLowerCase() ||
    profile.hookAddress.toLowerCase() !==
      bundle.provenance.hookAddress.toLowerCase() ||
    profile.vaultAddress.toLowerCase() !==
      bundle.provenance.vaultAddress.toLowerCase() ||
    profile.poolId.toLowerCase() !==
      bundle.provenance.poolId.toLowerCase() ||
    profile.positionRecipient.toLowerCase() !==
      bundle.provenance.positionRecipient.toLowerCase() ||
    profile.positionTokenId !== bundle.provenance.positionTokenId ||
    profile.launchHash.toLowerCase() !==
      bundle.provenance.launchHash.toLowerCase() ||
    profile.launchBlockNumber !== bundle.provenance.blockNumber ||
    profile.launchTransactionHash.toLowerCase() !==
      bundle.provenance.transactionHash.toLowerCase() ||
    volume.growthFees !==
      BigInt(profile.totalGrowthEthReceivedWei) +
        BigInt(profile.accruedGrowthFeesWei)
  ) {
    throw new Error("Deep V3 Explore state does not match launch provenance");
  }

  return {
    id: `${input.chainId}:${profile.tokenAddress.toLowerCase()}`,
    name: profile.tokenName,
    symbol: profile.tokenSymbol,
    ...(profile.description ? { description: profile.description } : {}),
    ...(profile.imageUrl ? { imageUrl: profile.imageUrl } : {}),
    links: [...profile.links],
    tokenAddress: profile.tokenAddress,
    hookAddress: profile.hookAddress,
    poolId: profile.poolId,
    creatorAddress: profile.creator,
    positionRecipient: profile.positionRecipient,
    positionTokenId: profile.positionTokenId,
    launchHash: profile.launchHash,
    launchBlockNumber: profile.launchBlockNumber,
    launchTransactionHash: profile.launchTransactionHash,
    launchTransactionIndex: bundle.provenance.transactionIndex,
    launchLogIndex: bundle.provenance.logIndex,
    launchedAt: profile.launchedAt,
    totalSupply: formatUnits(BigInt(profile.totalSupplyRaw), 18),
    totalSupplyRaw: profile.totalSupplyRaw,
    tokenDecimals: profile.tokenDecimals,
    lockedTokenDustRaw:
      bundle.configuration.initialLockedTokenDust.toString(),
    tokenPriceEth: formatUnits(BigInt(profile.nativePriceWad), 18),
    tokenPriceEthWei: profile.nativePriceWad,
    marketCapEth: formatUnits(
      BigInt(profile.marketCapNativeWad),
      18,
    ),
    marketCapEthWei: profile.marketCapNativeWad,
    grossVolumeEth: formatUnits(volume.grossNativeAmount, 18),
    grossVolumeWei: volume.grossNativeAmount.toString(),
    creatorFeesGeneratedEth: "0",
    creatorFeesGeneratedWei: "0",
    creatorFeesAccruedEth: "0",
    creatorFeesAccruedWei: "0",
    growthFeesGeneratedEth: formatUnits(volume.growthFees, 18),
    growthFeesGeneratedWei: volume.growthFees.toString(),
    growthFeesAccruedEth: formatUnits(
      BigInt(profile.accruedGrowthFeesWei),
      18,
    ),
    growthFeesAccruedWei: profile.accruedGrowthFeesWei,
    launcherFeesGeneratedEth: formatUnits(
      volume.programmableFees,
      18,
    ),
    launcherFeesGeneratedWei: volume.programmableFees.toString(),
    swapCount: volume.swapCount,
    currentTick: profile.currentTick,
    initialTick: DEEP_V3_FIXED_POLICY.initialTick,
    tickLower: DEEP_V3_FIXED_POLICY.fullRangeTickLower,
    tickUpper: DEEP_V3_FIXED_POLICY.fullRangeTickUpper,
    activeLiquidity: profile.activeLiquidity,
    protocolFeePips: profile.protocolFeePips,
    lpFeePips: profile.lpFeePips,
    buyHookFeeBps: profile.totalHookFeeBps,
    sellHookFeeBps: profile.totalHookFeeBps,
    growthFeeBps: profile.growthFeeBps,
    programmableFeeBps: profile.programmableFeeBps,
    launcherFeeBps: profile.programmableFeeBps,
    transferTaxBps: profile.transferTaxBps,
    totalSwapFeeBps: profile.totalHookFeeBps,
    launchModel: "deep",
    deepReleaseVersion: "deep-full-range-v3",
    growthVaultAddress: profile.vaultAddress,
    totalNativeAddedToLiquidityWei: profile.totalNativeAddedWei,
    totalTokenAddedToLiquidityRaw: profile.totalTokenAddedRaw,
    totalGrowthEthReceivedWei: profile.totalGrowthEthReceivedWei,
    totalNativeSwappedWei: profile.totalNativeSwappedWei,
    totalTokenAcquiredRaw: profile.totalTokenAcquiredRaw,
    pendingGrowthNativeWei: profile.pendingGrowthNativeWei,
    automationAction: profile.automationAction,
    nextCompoundTimestamp: profile.nextEligibleTimestamp,
    trustedNativeDepthWei: profile.trustedNativeDepthWei,
    lockedLiquidity: profile.lockedLiquidity,
    rollingExposureWei: profile.rollingExposureWei,
    compoundCount: profile.compoundCount,
    lastCompoundTimestamp: profile.lastCompoundTimestamp,
    automationGuaranteed: false,
    deepV3Provenance: bundle.provenance,
    liquidityPath: "meme",
  };
}

function emptyDeepV3Model(snapshot: ExploreSnapshot): ExploreReadModel {
  return {
    status: "ready",
    tokens: [],
    snapshot,
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

export async function readDeepV3ExploreModel(
  config: OnchainDeployment,
  snapshotBlockInput?: string,
): Promise<ExploreReadModel | null> {
  const release = resolveRelease(config);
  if (!release || config.status !== "ready") return null;
  if (!config.rpcUrlSecondary) {
    throw new Error("Deep V3 Explore requires two independent RPC providers");
  }

  const clients = [
    createClient(config.rpcUrl),
    createClient(config.rpcUrlSecondary),
  ];
  const chainIds = await Promise.all(
    clients.map((client) => client.getChainId()),
  );
  if (chainIds.some((chainId) => chainId !== release.chainId)) {
    throw new Error("Deep V3 RPC chain does not match the verified release");
  }
  const snapshotBlockNumber = snapshotBlockInput
    ? BigInt(snapshotBlockInput)
    : (() => {
        throw new Error("Deep V3 Explore requires a confirmed registry snapshot");
      })();

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
    throw new Error("Independent RPCs disagree on the Deep V3 snapshot");
  }
  const snapshot: ExploreSnapshot = {
    chainId: release.chainId,
    blockNumber: snapshotBlockNumber.toString(),
    blockHash: snapshotBlock.hash,
    confirmations: Number(CONFIRMATIONS),
  };
  if (snapshotBlockNumber < BigInt(release.startBlock)) {
    return emptyDeepV3Model(snapshot);
  }

  await Promise.all(
    clients.map((client) =>
      assertDeepV3ReleaseRuntime(client, release, snapshotBlockNumber),
    ),
  );
  const [eventSets, launcherFeeValues] = await Promise.all([
    Promise.all(
      clients.map((client) =>
        indexDeepV3Events(client, release, snapshotBlockNumber),
      ),
    ),
    Promise.all(
      clients.map((client) =>
        client.readContract({
          address: release.addresses.feeHook,
          abi: deepV3ExploreHookReadAbi,
          functionName: "launcherFeesAccrued",
          blockNumber: snapshotBlockNumber,
        }),
      ),
    ),
  ]);
  const fingerprint = eventFingerprint(eventSets[0]);
  if (
    eventSets.some((events) => eventFingerprint(events) !== fingerprint) ||
    launcherFeeValues.some((fees) => fees !== launcherFeeValues[0])
  ) {
    throw new Error(
      "Independent RPCs disagree on Deep V3 events or fee accounting",
    );
  }

  const profileClients = clients.map((client) =>
    pinnedProfileClient(client, snapshotBlockNumber),
  );
  const { readDeepV3ProfileToken } = await import(
    "../profile/deep-v3-profile.server"
  );
  const tokens = await Promise.all(
    eventSets[0].bundles.map(async (bundle) => {
      const result = await readDeepV3ProfileToken({
        manifest: releaseManifest,
        chainId: release.chainId,
        account: bundle.provenance.creator,
        candidate: bundle.provenance,
        clients: profileClients,
      });
      if (
        result.snapshot.blockNumber !== snapshot.blockNumber ||
        !sameValue(result.snapshot.blockHash, snapshot.blockHash)
      ) {
        throw new Error("Deep V3 token state does not share the registry snapshot");
      }
      return deepV3ProfileToLauncherToken({
        chainId: release.chainId,
        profile: result.token,
        bundle,
        volume:
          eventSets[0].volumes.get(
            bundle.provenance.poolId.toLowerCase(),
          ) ?? ZERO_VOLUME,
      });
    }),
  );

  return {
    status: "ready",
    tokens,
    snapshot,
    creatorClaims: [],
    launcherFeesAccruedWei: launcherFeeValues[0].toString(),
    launcherFeesAccruedEth: formatUnits(launcherFeeValues[0], 18),
  };
}

export const mergeDeepV3ExploreModel = mergeDeepExploreModel;
