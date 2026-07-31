import {
  indexer,
  type BeneficiaryClaim,
  type ChainEvent,
  type CreatorFeeClaim,
  type EvmEvent,
  type EvmOnEventContext,
  type FeeAccrual,
  type InitialBuyCustody,
  type Launch,
  type LauncherFeeClaim,
  type PayoutChange,
  type PoolFeeConfig,
  type RewardCheckpoint,
  type RewardConfigurationChange,
  type VestingWallet,
} from "envio";
import type { AbiEvent } from "viem";

import { launchEntityId, poolEntityId } from "./lib/ids.js";
import {
  canonicalPayloadJson,
  encodeEventPayload,
} from "./lib/payload-hash.js";
import {
  eventProvenance,
  lower,
  lowerAddress,
  type EventProvenance,
} from "./lib/provenance.js";
import {
  resolveRelease,
  SOURCE_REGISTRY,
  sourceStartBlock,
  staticReleaseForContract,
  type ReleaseIdentity,
} from "./lib/release-map.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type RecordedOccurrence = {
  isNew: boolean;
  provenance: EventProvenance;
  release: ReleaseIdentity;
  payloadHash: string;
};

const CHAIN_ID = 1;
const INDEXER_STATE_ID = "ethereum-mainnet";
const SCHEMA_VERSION = "1";
const DEPLOYMENT_IDENTITY = "development-unverified";

const DYNAMIC_VAULT_CONTRACTS = new Set([
  "ClassicV3RewardVault",
  "StockV1RewardVault",
  "StockV2V3RewardVault",
]);

const LAUNCH_IDENTITY_FIELDS = new Set<keyof Launch>([
  "token",
  "creator",
  "quoteAsset",
  "poolId",
  "hook",
  "rewardVault",
  "positionRecipient",
  "positionTokenId",
  "rewardConfigurationHash",
  "quoteConfigurationHash",
]);

const CLASSIC_V2_HOOK = sourceAddress("ClassicV2Hook");
const CLASSIC_V3_HOOK = sourceAddress("ClassicV3Hook");
const STOCK_V1_HOOK = sourceAddress("StockV1Hook");
const STOCK_V2_V3_HOOK = sourceAddress("StockV2V3Hook");

async function handleEvent(args: {
  event: EvmEvent;
  context: EvmOnEventContext;
}): Promise<void> {
  const occurrence = await recordOccurrence(args.event, args.context);
  if (!occurrence.isNew) {
    return;
  }

  const { event, context } = args;
  switch (event.contractName) {
    case "ClassicV2Launcher":
    case "ClassicV3Launcher":
    case "StockV1Launcher":
    case "StockV2Launcher":
    case "StockV3Launcher":
      await handleLauncherEvent(event, context, occurrence);
      return;
    case "StockV1EthCoordinator":
    case "StockV2EthCoordinator":
    case "StockV3EthCoordinator":
      await handleCoordinatorEvent(event, context, occurrence);
      return;
    case "ClassicV2Hook":
    case "ClassicV3Hook":
    case "StockV1Hook":
    case "StockV2V3Hook":
      await handleHookEvent(event, context, occurrence);
      return;
    case "ClassicV3RewardVaultFactory":
    case "StockV1RewardVaultFactory":
    case "StockV2V3RewardVaultFactory":
      await handleVaultFactoryEvent(event, context, occurrence);
      return;
    case "ClassicV3VestingWalletFactory":
      handleVestingFactoryEvent(event, context, occurrence);
      return;
    case "ClassicV3RewardVault":
    case "StockV1RewardVault":
    case "StockV2V3RewardVault":
      await handleRewardVaultEvent(event, context, occurrence);
      return;
  }
}

async function recordOccurrence(
  event: EvmEvent,
  context: EvmOnEventContext,
): Promise<RecordedOccurrence> {
  const provenance = eventProvenance(event);
  const encoded = encodeEventPayload(
    findEventAbi(event),
    event.params as unknown as Readonly<Record<string, unknown>>,
  );
  const topics = encoded.topics.map(lower);
  const data = lower(encoded.data);
  const decodedPayload = canonicalPayloadJson(event.params);
  const payloadHash = lower(encoded.payloadHash);
  const existing = await context.ChainEvent.get(provenance.id);
  if (existing !== undefined) {
    const sameTopics =
      existing.topics.length === topics.length &&
      existing.topics.every((topic, index) => topic === topics[index]);
    const isConflict =
      existing.chainId !== provenance.chainId ||
      existing.blockNumber !== provenance.blockNumber ||
      existing.blockHash !== provenance.blockHash ||
      existing.blockTimestamp !== provenance.blockTimestamp ||
      existing.transactionHash !== provenance.transactionHash ||
      existing.transactionIndex !== provenance.transactionIndex ||
      existing.blockGlobalLogIndex !== provenance.blockGlobalLogIndex ||
      existing.sourceAddress !== provenance.sourceAddress ||
      existing.contractName !== event.contractName ||
      existing.eventName !== event.eventName ||
      !sameTopics ||
      existing.data !== data ||
      existing.decodedPayload !== decodedPayload ||
      existing.payloadHash !== payloadHash;
    if (isConflict) {
      throw new Error(
        `Conflicting duplicate candidate occurrence ${provenance.id}`,
      );
    }
    return {
      isNew: false,
      provenance,
      release: {
        model: existing.model,
        releaseVersion: existing.releaseVersion,
      },
      payloadHash: existing.payloadHash,
    };
  }

  const poolId = eventPoolId(event);
  const poolRelation =
    poolId === undefined
      ? undefined
      : await context.PoolRelease.get(poolEntityId(CHAIN_ID, poolId));
  const vaultRelation = DYNAMIC_VAULT_CONTRACTS.has(event.contractName)
    ? await context.RewardVault.get(provenance.sourceAddress)
    : undefined;
  const release = resolveRelease({
    contractName: event.contractName,
    poolRelation:
      poolRelation === undefined
        ? undefined
        : {
            model: poolRelation.model,
            releaseVersion: poolRelation.releaseVersion,
          },
    vaultRelation:
      vaultRelation === undefined
        ? undefined
        : {
            model: vaultRelation.model,
            releaseVersion: vaultRelation.releaseVersion,
          },
  });
  const chainEvent: ChainEvent = {
    ...provenance,
    contractName: event.contractName,
    eventName: event.eventName,
    model: release.model,
    releaseVersion: release.releaseVersion,
    topics,
    data,
    decodedPayload,
    payloadHash,
  };
  context.ChainEvent.set(chainEvent);
  await updateIndexerState(context, provenance);

  return {
    isNew: true,
    provenance,
    release,
    payloadHash: chainEvent.payloadHash,
  };
}

async function updateIndexerState(
  context: EvmOnEventContext,
  provenance: EventProvenance,
): Promise<void> {
  const current = await context.IndexerState.get(INDEXER_STATE_ID);
  const currentOccurrence =
    current === undefined
      ? undefined
      : await context.ChainEvent.get(current.progressOccurrenceId);
  if (
    current !== undefined &&
    (currentOccurrence !== undefined
      ? comparePlacement(currentOccurrence, provenance) >= 0
      : current.progressBlock > provenance.blockNumber)
  ) {
    return;
  }
  context.IndexerState.set({
    id: INDEXER_STATE_ID,
    schemaVersion: SCHEMA_VERSION,
    deployment: DEPLOYMENT_IDENTITY,
    chainId: provenance.chainId,
    progressBlock: provenance.blockNumber,
    progressBlockHash: provenance.blockHash,
    progressTimestamp: provenance.blockTimestamp,
    progressTransactionHash: provenance.transactionHash,
    progressOccurrenceId: provenance.id,
  });
}

type CandidatePlacement = {
  readonly id: string;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly transactionIndex: number;
  readonly blockGlobalLogIndex: number;
};

function comparePlacement(
  left: CandidatePlacement,
  right: CandidatePlacement,
): number {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber > right.blockNumber ? 1 : -1;
  }
  if (left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex > right.transactionIndex ? 1 : -1;
  }
  if (left.blockGlobalLogIndex !== right.blockGlobalLogIndex) {
    return left.blockGlobalLogIndex > right.blockGlobalLogIndex ? 1 : -1;
  }
  const blockOrder = left.blockHash.localeCompare(right.blockHash);
  if (blockOrder !== 0) {
    return blockOrder;
  }
  const transactionOrder = left.transactionHash.localeCompare(
    right.transactionHash,
  );
  return transactionOrder === 0
    ? left.id.localeCompare(right.id)
    : transactionOrder;
}

async function handleLauncherEvent(
  event: Extract<
    EvmEvent,
    {
      contractName:
        | "ClassicV2Launcher"
        | "ClassicV3Launcher"
        | "StockV1Launcher"
        | "StockV2Launcher"
        | "StockV3Launcher";
    }
  >,
  context: EvmOnEventContext,
  occurrence: RecordedOccurrence,
): Promise<void> {
  const release =
    staticReleaseForContract(event.contractName) ?? occurrence.release;

  if (event.contractName === "ClassicV2Launcher") {
    if (event.eventName === "MemeTokenLaunched") {
      const params = event.params;
      const launch = await upsertLaunch(context, release, params.launchHash, {
        token: lowerAddress(params.token),
        creator: lowerAddress(params.creator),
        poolId: lower(params.poolId),
        hook: lowerAddress(params.feeHook),
        positionRecipient: lowerAddress(params.positionRecipient),
        positionTokenId: params.positionTokenId,
        totalSwapFeeBps: exactInt(params.totalSwapFeeBps, "totalSwapFeeBps"),
        launchOccurrenceId: occurrence.provenance.id,
        hasLaunchEvent: true,
      }, "launch", occurrence);
      await reconcileLaunch(context, launch);
      return;
    }
    if (event.eventName === "MemeLiquidityConfigured") {
      const params = event.params;
      await upsertLaunch(context, release, params.launchHash, {
        token: lowerAddress(params.token),
        totalSupply: params.totalSupply,
        tokenLiquidityAmount: params.tokenLiquidityAmount,
        lockedTokenDust: params.lockedTokenDust,
        initialTick: exactInt(params.initialTick, "initialTick"),
        tickLower: exactInt(params.tickLower, "tickLower"),
        tickUpper: exactInt(params.tickUpper, "tickUpper"),
        lpFeePips: exactInt(params.lpFeePips, "lpFeePips"),
        liquidityOccurrenceId: occurrence.provenance.id,
        hasLiquidityEvent: true,
      }, "liquidity", occurrence);
      return;
    }
    const params = event.params;
    await upsertLaunch(context, release, params.launchHash, {
      token: lowerAddress(params.token),
      creator: lowerAddress(params.creator),
      poolId: lower(params.poolId),
      initialBuyQuoteAmount: params.nativeAmount,
      initialBuyTokenAmount: params.tokenAmount,
      initialBuyOccurrenceId: occurrence.provenance.id,
      hasInitialBuyEvent: true,
    }, "initial-buy", occurrence);
    return;
  }

  if (event.contractName === "ClassicV3Launcher") {
    if (event.eventName === "MemeTokenLaunchedV2") {
      const params = event.params;
      const launch = await upsertLaunch(context, release, params.launchHash, {
        token: lowerAddress(params.token),
        creator: lowerAddress(params.deployer),
        poolId: lower(params.poolId),
        hook: lowerAddress(params.feeHook),
        rewardVault: lowerAddress(params.rewardVault),
        positionRecipient: lowerAddress(params.positionRecipient),
        positionTokenId: params.positionTokenId,
        buySwapFeeBps: exactInt(params.buySwapFeeBps, "buySwapFeeBps"),
        sellSwapFeeBps: exactInt(params.sellSwapFeeBps, "sellSwapFeeBps"),
        rewardConfigurationHash: lower(params.rewardConfigurationHash),
        launchOccurrenceId: occurrence.provenance.id,
        hasLaunchEvent: true,
      }, "launch", occurrence);
      await reconcileLaunch(context, launch);
      return;
    }
    if (event.eventName === "MemeLiquidityConfiguredV2") {
      const params = event.params;
      await upsertLaunch(context, release, params.launchHash, {
        token: lowerAddress(params.token),
        totalSupply: params.totalSupply,
        tokenLiquidityAmount: params.tokenLiquidityAmount,
        lockedTokenDust: params.lockedTokenDust,
        initialTick: exactInt(params.initialTick, "initialTick"),
        tickLower: exactInt(params.tickLower, "tickLower"),
        tickUpper: exactInt(params.tickUpper, "tickUpper"),
        lpFeePips: exactInt(params.lpFeePips, "lpFeePips"),
        liquidityOccurrenceId: occurrence.provenance.id,
        hasLiquidityEvent: true,
      }, "liquidity", occurrence);
      return;
    }
    if (event.eventName === "MemeCreatorInitialBuyV2") {
      const params = event.params;
      await upsertLaunch(context, release, params.launchHash, {
        token: lowerAddress(params.token),
        creator: lowerAddress(params.deployer),
        poolId: lower(params.poolId),
        initialBuyQuoteAmount: params.nativeAmount,
        initialBuyTokenAmount: params.tokenAmount,
        initialBuyOccurrenceId: occurrence.provenance.id,
        hasInitialBuyEvent: true,
      }, "initial-buy", occurrence);
      return;
    }
    const params = event.params;
    const custody: InitialBuyCustody = {
      ...immutableFields(occurrence),
      launchHash: lower(params.launchHash),
      deployer: lowerAddress(params.deployer),
      token: lowerAddress(params.token),
      custody: lowerAddress(params.custody),
      mode: exactInt(params.mode, "custody mode"),
      durationDays: exactInt(params.durationDays, "durationDays"),
      cliffDays: exactInt(params.cliffDays, "cliffDays"),
      configurationHash: lower(params.configurationHash),
    };
    context.InitialBuyCustody.set(custody);
    await upsertLaunch(context, release, params.launchHash, {
      token: custody.token,
      creator: custody.deployer,
      custodyOccurrenceId: occurrence.provenance.id,
      hasCustodyEvent: true,
    }, "custody", occurrence);
    return;
  }

  const hook = hookForRelease(release.releaseVersion);
  if (event.eventName === "StockPairedTokenLaunched") {
    const params = event.params;
    const launch = await upsertLaunch(context, release, params.launchHash, {
      token: lowerAddress(params.token),
      creator: lowerAddress(params.deployer),
      quoteAsset: lowerAddress(params.quoteAsset),
      poolId: lower(params.poolId),
      hook,
      rewardVault: lowerAddress(params.rewardVault),
      positionRecipient: lowerAddress(params.positionRecipient),
      positionTokenId: params.positionTokenId,
      launchOccurrenceId: occurrence.provenance.id,
      hasLaunchEvent: true,
    }, "launch", occurrence);
    await reconcileLaunch(context, launch);
    return;
  }
  if (event.eventName === "StockPairedLiquidityConfigured") {
    const params = event.params;
    await upsertLaunch(context, release, params.launchHash, {
      token: lowerAddress(params.token),
      quoteAsset: lowerAddress(params.quoteAsset),
      totalSupply: params.totalSupply,
      tokenLiquidityAmount: params.tokenLiquidityAmount,
      lockedTokenDust: params.lockedTokenDust,
      initialTick: exactInt(params.initialTick, "initialTick"),
      tickLower: exactInt(params.tickLower, "tickLower"),
      tickUpper: exactInt(params.tickUpper, "tickUpper"),
      lpFeePips: exactInt(params.lpFeePips, "lpFeePips"),
      liquidityOccurrenceId: occurrence.provenance.id,
      hasLiquidityEvent: true,
    }, "liquidity", occurrence);
    return;
  }
  const params = event.params;
  await upsertLaunch(context, release, params.launchHash, {
    token: lowerAddress(params.token),
    creator: lowerAddress(params.deployer),
    quoteAsset: lowerAddress(params.quoteAsset),
    poolId: lower(params.poolId),
    initialBuyQuoteAmount: params.quoteAmount,
    initialBuyTokenAmount: params.tokenAmount,
    initialBuyOccurrenceId: occurrence.provenance.id,
    hasInitialBuyEvent: true,
  }, "initial-buy", occurrence);
}

async function handleCoordinatorEvent(
  event: Extract<
    EvmEvent,
    {
      contractName:
        | "StockV1EthCoordinator"
        | "StockV2EthCoordinator"
        | "StockV3EthCoordinator";
    }
  >,
  context: EvmOnEventContext,
  occurrence: RecordedOccurrence,
): Promise<void> {
  const params = event.params;
  const release =
    staticReleaseForContract(event.contractName) ?? occurrence.release;
  await upsertLaunch(context, release, params.launchHash, {
    creator: lowerAddress(params.creator),
    token: lowerAddress(params.token),
    quoteAsset: lowerAddress(params.quoteAsset),
    initialBuyEthAmount: params.initialBuyEthAmount,
    initialBuyQuoteAmount: params.initialBuyQuoteAmount,
    initialBuyTokenAmount: params.initialBuyTokenAmount,
    coordinatorOccurrenceId: occurrence.provenance.id,
    hasCoordinatorEvent: true,
  }, "coordinator", occurrence);
}

async function upsertLaunch(
  context: EvmOnEventContext,
  release: ReleaseIdentity,
  launchHashValue: string,
  patch: Partial<Launch>,
  kind: "launch" | "liquidity" | "initial-buy" | "custody" | "coordinator",
  occurrence: RecordedOccurrence,
): Promise<Launch> {
  const launchHash = lower(launchHashValue);
  const id = launchEntityId(CHAIN_ID, release.releaseVersion, launchHash);
  const existing =
    (await context.Launch.get(id)) ??
    defaultLaunch(id, release, launchHash, occurrence.provenance.blockNumber);
  const next: Mutable<Launch> = { ...existing };
  let provenanceValid = existing.provenanceValid;

  for (const key of Object.keys(patch) as (keyof Launch)[]) {
    const incoming = patch[key];
    if (incoming === undefined) {
      continue;
    }
    const current = next[key];
    if (
      LAUNCH_IDENTITY_FIELDS.has(key) &&
      current !== undefined &&
      !sameValue(current, incoming)
    ) {
      provenanceValid = false;
    }
    if (current === undefined || kind === "launch" || isEventFlag(key)) {
      (next as Record<keyof Launch, unknown>)[key] = incoming;
    }
  }

  next.provenanceValid = provenanceValid;
  next.updatedBlock =
    occurrence.provenance.blockNumber > next.updatedBlock
      ? occurrence.provenance.blockNumber
      : next.updatedBlock;
  next.isComplete = launchIsComplete(next);
  context.Launch.set(next);
  return next;
}

function defaultLaunch(
  id: string,
  release: ReleaseIdentity,
  launchHash: string,
  blockNumber: bigint,
): Launch {
  return {
    id,
    chainId: CHAIN_ID,
    model: release.model,
    releaseVersion: release.releaseVersion,
    launchHash,
    token: undefined,
    creator: undefined,
    quoteAsset: undefined,
    poolId: undefined,
    hook: undefined,
    rewardVault: undefined,
    positionRecipient: undefined,
    positionTokenId: undefined,
    totalSwapFeeBps: undefined,
    buySwapFeeBps: undefined,
    sellSwapFeeBps: undefined,
    rewardConfigurationHash: undefined,
    quoteConfigurationHash: undefined,
    totalSupply: undefined,
    tokenLiquidityAmount: undefined,
    lockedTokenDust: undefined,
    initialTick: undefined,
    tickLower: undefined,
    tickUpper: undefined,
    lpFeePips: undefined,
    initialBuyQuoteAmount: undefined,
    initialBuyTokenAmount: undefined,
    initialBuyEthAmount: undefined,
    launchOccurrenceId: undefined,
    liquidityOccurrenceId: undefined,
    initialBuyOccurrenceId: undefined,
    custodyOccurrenceId: undefined,
    coordinatorOccurrenceId: undefined,
    hasLaunchEvent: false,
    hasLiquidityEvent: false,
    hasInitialBuyEvent: false,
    hasCustodyEvent: false,
    hasCoordinatorEvent: false,
    provenanceValid: true,
    isComplete: false,
    updatedBlock: blockNumber,
  };
}

function launchIsComplete(launch: Launch): boolean {
  const base =
    launch.provenanceValid &&
    launch.hasLaunchEvent &&
    launch.hasLiquidityEvent &&
    launch.hasInitialBuyEvent;
  return launch.releaseVersion === "classic-v3"
    ? base && launch.hasCustodyEvent
    : base;
}

async function reconcileLaunch(
  context: EvmOnEventContext,
  launchInput: Launch,
): Promise<void> {
  let launch: Mutable<Launch> = { ...launchInput };
  const expectedHook = hookForRelease(launch.releaseVersion);
  if (
    launch.token === undefined ||
    launch.poolId === undefined ||
    launch.hook === undefined ||
    expectedHook === undefined
  ) {
    launch.provenanceValid = false;
    launch.isComplete = false;
    context.Launch.set(launch);
    return;
  }
  if (!sameValue(launch.hook, expectedHook)) {
    launch.provenanceValid = false;
  }

  const relationId = poolEntityId(CHAIN_ID, launch.poolId);
  context.PoolRelease.set({
    id: relationId,
    chainId: CHAIN_ID,
    launchId: launch.id,
    model: launch.model,
    releaseVersion: launch.releaseVersion,
    token: launch.token,
    quoteAsset: launch.quoteAsset,
    hook: launch.hook,
    rewardVault: launch.rewardVault,
    blockNumber: launch.updatedBlock,
  });

  const config = await context.PoolFeeConfig.get(relationId);
  if (config !== undefined) {
    if (
      launch.rewardConfigurationHash === undefined &&
      config.rewardConfigurationHash !== undefined
    ) {
      launch.rewardConfigurationHash = config.rewardConfigurationHash;
    }
    if (
      launch.quoteConfigurationHash === undefined &&
      config.quoteConfigurationHash !== undefined
    ) {
      launch.quoteConfigurationHash = config.quoteConfigurationHash;
    }
    const configValid =
      config.provenanceValid &&
      optionalMatches(config.token, launch.token) &&
      optionalMatches(config.quoteAsset, launch.quoteAsset) &&
      optionalMatches(config.rewardVault, launch.rewardVault) &&
      compatibleOptionalValue(
        config.rewardConfigurationHash,
        launch.rewardConfigurationHash,
      ) &&
      compatibleOptionalValue(
        config.quoteConfigurationHash,
        launch.quoteConfigurationHash,
      );
    context.PoolFeeConfig.set({
      ...config,
      model: launch.model,
      releaseVersion: launch.releaseVersion,
      provenanceValid: configValid,
    });
    if (!configValid) {
      launch.provenanceValid = false;
    }
    await relabelOccurrence(
      context,
      config.registrationOccurrenceId,
      launch,
    );
    await relabelOccurrence(
      context,
      config.disclosureOccurrenceId,
      launch,
    );
  }

  if (launch.rewardVault !== undefined) {
    const vault = await context.RewardVault.get(launch.rewardVault);
    if (vault !== undefined) {
      const vaultValid =
        sameValue(vault.poolId, launch.poolId) &&
        sameValue(vault.hook, launch.hook) &&
        optionalMatches(vault.quoteAsset, launch.quoteAsset) &&
        compatibleOptionalValue(
          vault.configurationHash,
          launch.rewardConfigurationHash,
        );
      context.RewardVault.set({
        ...vault,
        model: launch.model,
        releaseVersion: launch.releaseVersion,
      });
      if (!vaultValid) {
        launch.provenanceValid = false;
      }
      await relabelOccurrence(context, vault.factoryOccurrenceId, launch);
    }
  }

  const totals = await context.PoolFeeTotals.get(relationId);
  if (totals !== undefined) {
    context.PoolFeeTotals.set({
      ...totals,
      model: launch.model,
      releaseVersion: launch.releaseVersion,
    });
  }
  await relabelPoolScopedEntities(context, launch);
  launch.isComplete = launchIsComplete(launch);
  context.Launch.set(launch);
}

async function relabelOccurrence(
  context: EvmOnEventContext,
  occurrenceId: string | undefined,
  launch: Launch,
): Promise<void> {
  if (occurrenceId === undefined) {
    return;
  }
  const chainEvent = await context.ChainEvent.get(occurrenceId);
  if (chainEvent !== undefined) {
    context.ChainEvent.set({
      ...chainEvent,
      model: launch.model,
      releaseVersion: launch.releaseVersion,
    });
  }
}

async function relabelPoolScopedEntities(
  context: EvmOnEventContext,
  launch: Launch,
): Promise<void> {
  if (launch.poolId === undefined) {
    return;
  }
  const poolFilter = { poolId: { _eq: launch.poolId } };
  const [
    feeAccruals,
    creatorFeeClaims,
    rewardCheckpoints,
    payoutChanges,
    rewardConfigurationChanges,
  ] = await Promise.all([
    context.FeeAccrual.getWhere(poolFilter),
    context.CreatorFeeClaim.getWhere(poolFilter),
    context.RewardCheckpoint.getWhere(poolFilter),
    context.PayoutChange.getWhere(poolFilter),
    context.RewardConfigurationChange.getWhere(poolFilter),
  ]);

  for (const entity of feeAccruals) {
    context.FeeAccrual.set({
      ...entity,
      model: launch.model,
      releaseVersion: launch.releaseVersion,
    });
    await relabelOccurrence(context, entity.id, launch);
  }
  for (const entity of creatorFeeClaims) {
    context.CreatorFeeClaim.set({
      ...entity,
      model: launch.model,
      releaseVersion: launch.releaseVersion,
    });
    await relabelOccurrence(context, entity.id, launch);
  }
  for (const entity of rewardCheckpoints) {
    context.RewardCheckpoint.set({
      ...entity,
      model: launch.model,
      releaseVersion: launch.releaseVersion,
    });
    await relabelOccurrence(context, entity.id, launch);
  }
  for (const entity of payoutChanges) {
    context.PayoutChange.set({
      ...entity,
      model: launch.model,
      releaseVersion: launch.releaseVersion,
    });
    await relabelOccurrence(context, entity.id, launch);
  }
  for (const entity of rewardConfigurationChanges) {
    context.RewardConfigurationChange.set({
      ...entity,
      model: launch.model,
      releaseVersion: launch.releaseVersion,
    });
    await relabelOccurrence(context, entity.id, launch);
  }

  if (launch.rewardVault === undefined) {
    return;
  }
  const beneficiaryClaims = await context.BeneficiaryClaim.getWhere({
    vault: { _eq: launch.rewardVault },
  });
  for (const entity of beneficiaryClaims) {
    context.BeneficiaryClaim.set({
      ...entity,
      model: launch.model,
      releaseVersion: launch.releaseVersion,
    });
    await relabelOccurrence(context, entity.id, launch);
  }
}

async function handleHookEvent(
  event: Extract<
    EvmEvent,
    {
      contractName:
        | "ClassicV2Hook"
        | "ClassicV3Hook"
        | "StockV1Hook"
        | "StockV2V3Hook";
    }
  >,
  context: EvmOnEventContext,
  occurrence: RecordedOccurrence,
): Promise<void> {
  switch (event.eventName) {
    case "PoolRegistered":
    case "PoolFeeDisclosure":
      await handlePoolConfigurationEvent(event, context, occurrence);
      return;
    case "NativeSwapFeesAccrued":
    case "QuoteSwapFeesAccrued":
      await handleFeeAccrualEvent(event, context, occurrence);
      return;
    case "CreatorFeesClaimed":
      handleCreatorFeeClaim(event, context, occurrence);
      return;
    case "LauncherFeesClaimed":
      handleLauncherFeeClaim(event, context, occurrence);
      return;
  }
}

async function handlePoolConfigurationEvent(
  event: Extract<
    EvmEvent,
    {
      contractName:
        | "ClassicV2Hook"
        | "ClassicV3Hook"
        | "StockV1Hook"
        | "StockV2V3Hook";
      eventName: "PoolRegistered" | "PoolFeeDisclosure";
    }
  >,
  context: EvmOnEventContext,
  occurrence: RecordedOccurrence,
): Promise<void> {
  const params = event.params;
  const poolId = lower(params.poolId);
  const id = poolEntityId(CHAIN_ID, poolId);
  const existing =
    (await context.PoolFeeConfig.get(id)) ??
    defaultPoolFeeConfig(id, poolId, occurrence);
  const next: Mutable<PoolFeeConfig> = { ...existing };
  let valid = existing.provenanceValid;

  const mergeIdentity = (
    key: "token" | "creator" | "quoteAsset" | "rewardVault",
    value: string | undefined,
  ): void => {
    if (value === undefined) {
      return;
    }
    const current = next[key];
    if (current !== undefined && !sameValue(current, value)) {
      valid = false;
      return;
    }
    next[key] = value;
  };

  mergeIdentity("token", lowerAddress(params.token));

  if (event.contractName === "ClassicV2Hook") {
    if (event.eventName === "PoolRegistered") {
      const typedParams = event.params;
      mergeIdentity("creator", lowerAddress(typedParams.creator));
      next.registrar = lowerAddress(typedParams.registrar);
      next.totalSwapFeeBps = exactInt(
        typedParams.totalSwapFeeBps,
        "totalSwapFeeBps",
      );
      next.registrationOccurrenceId = occurrence.provenance.id;
    } else {
      const typedParams = event.params;
      next.buySwapFeeBps = exactInt(typedParams.buySwapFeeBps, "buySwapFeeBps");
      next.sellSwapFeeBps = exactInt(typedParams.sellSwapFeeBps, "sellSwapFeeBps");
      next.launcherFeeBps = exactInt(typedParams.launcherFeeBps, "launcherFeeBps");
      next.transferTaxBps = exactInt(typedParams.transferTaxBps, "transferTaxBps");
      next.lpFeePips = exactInt(typedParams.lpFeePips, "lpFeePips");
      next.disclosureOccurrenceId = occurrence.provenance.id;
    }
  } else if (event.contractName === "ClassicV3Hook") {
    mergeIdentity("rewardVault", lowerAddress(event.params.rewardVault));
    if (event.eventName === "PoolRegistered") {
      const typedParams = event.params;
      next.registrar = lowerAddress(typedParams.registrar);
      next.buySwapFeeBps = exactInt(typedParams.buySwapFeeBps, "buySwapFeeBps");
      next.sellSwapFeeBps = exactInt(typedParams.sellSwapFeeBps, "sellSwapFeeBps");
      next.rewardConfigurationHash = lower(typedParams.rewardConfigurationHash);
      next.registrationOccurrenceId = occurrence.provenance.id;
    } else {
      const typedParams = event.params;
      next.buySwapFeeBps = exactInt(typedParams.buySwapFeeBps, "buySwapFeeBps");
      next.sellSwapFeeBps = exactInt(typedParams.sellSwapFeeBps, "sellSwapFeeBps");
      next.buyCreatorFeeBps = exactInt(
        typedParams.buyCreatorFeeBps,
        "buyCreatorFeeBps",
      );
      next.sellCreatorFeeBps = exactInt(
        typedParams.sellCreatorFeeBps,
        "sellCreatorFeeBps",
      );
      next.launcherFeeBps = exactInt(typedParams.launcherFeeBps, "launcherFeeBps");
      next.transferTaxBps = exactInt(typedParams.transferTaxBps, "transferTaxBps");
      next.lpFeePips = exactInt(typedParams.lpFeePips, "lpFeePips");
      next.disclosureOccurrenceId = occurrence.provenance.id;
    }
  } else {
    mergeIdentity("quoteAsset", lowerAddress(event.params.quoteAsset));
    mergeIdentity("rewardVault", lowerAddress(event.params.rewardVault));
    if (event.eventName === "PoolRegistered") {
      const typedParams = event.params;
      next.registrar = lowerAddress(typedParams.registrar);
      next.quoteIsCurrency0 = typedParams.quoteIsCurrency0;
      next.rewardConfigurationHash = lower(typedParams.rewardConfigurationHash);
      next.quoteConfigurationHash = lower(typedParams.quoteConfigurationHash);
      next.registrationOccurrenceId = occurrence.provenance.id;
    } else {
      const typedParams = event.params;
      next.buySwapFeeBps = exactInt(typedParams.buySwapFeeBps, "buySwapFeeBps");
      next.sellSwapFeeBps = exactInt(typedParams.sellSwapFeeBps, "sellSwapFeeBps");
      next.creatorFeeBps = exactInt(typedParams.creatorFeeBps, "creatorFeeBps");
      next.launcherFeeBps = exactInt(typedParams.launcherFeeBps, "launcherFeeBps");
      next.transferTaxBps = exactInt(typedParams.transferTaxBps, "transferTaxBps");
      next.lpFeePips = exactInt(typedParams.lpFeePips, "lpFeePips");
      next.disclosureOccurrenceId = occurrence.provenance.id;
    }
  }

  const relation = await context.PoolRelease.get(id);
  if (relation !== undefined) {
    next.model = relation.model;
    next.releaseVersion = relation.releaseVersion;
    valid =
      valid &&
      sameValue(next.token, relation.token) &&
      optionalMatches(next.quoteAsset, relation.quoteAsset) &&
      optionalMatches(next.rewardVault, relation.rewardVault);
  } else if (
    next.releaseVersion === "unresolved" &&
    occurrence.release.releaseVersion !== "unresolved"
  ) {
    next.model = occurrence.release.model;
    next.releaseVersion = occurrence.release.releaseVersion;
  }
  next.provenanceValid = valid;
  next.blockNumber =
    occurrence.provenance.blockNumber > next.blockNumber
      ? occurrence.provenance.blockNumber
      : next.blockNumber;
  context.PoolFeeConfig.set(next);
  if (relation !== undefined) {
    const launch = await context.Launch.get(relation.launchId);
    if (launch !== undefined) {
      await reconcileLaunch(context, launch);
    }
  }
}

function defaultPoolFeeConfig(
  id: string,
  poolId: string,
  occurrence: RecordedOccurrence,
): PoolFeeConfig {
  return {
    id,
    chainId: CHAIN_ID,
    poolId,
    token: undefined,
    creator: undefined,
    quoteAsset: undefined,
    rewardVault: undefined,
    registrar: undefined,
    model: occurrence.release.model,
    releaseVersion: occurrence.release.releaseVersion,
    totalSwapFeeBps: undefined,
    buySwapFeeBps: undefined,
    sellSwapFeeBps: undefined,
    buyCreatorFeeBps: undefined,
    sellCreatorFeeBps: undefined,
    creatorFeeBps: undefined,
    launcherFeeBps: undefined,
    transferTaxBps: undefined,
    lpFeePips: undefined,
    quoteIsCurrency0: undefined,
    rewardConfigurationHash: undefined,
    quoteConfigurationHash: undefined,
    registrationOccurrenceId: undefined,
    disclosureOccurrenceId: undefined,
    provenanceValid: true,
    blockNumber: occurrence.provenance.blockNumber,
  };
}

async function handleFeeAccrualEvent(
  event: Extract<
    EvmEvent,
    {
      contractName:
        | "ClassicV2Hook"
        | "ClassicV3Hook"
        | "StockV1Hook"
        | "StockV2V3Hook";
      eventName: "NativeSwapFeesAccrued" | "QuoteSwapFeesAccrued";
    }
  >,
  context: EvmOnEventContext,
  occurrence: RecordedOccurrence,
): Promise<void> {
  const params = event.params;
  const poolId = lower(params.poolId);
  let quoteAsset: string | undefined;
  let isBuy: boolean | undefined;
  let appliedTotalSwapFeeBps: number | undefined;
  let grossAmount: bigint;

  if (event.eventName === "QuoteSwapFeesAccrued") {
    const typedParams = event.params;
    quoteAsset = lowerAddress(typedParams.quoteAsset);
    isBuy = typedParams.isBuy;
    grossAmount = typedParams.grossQuoteAmount;
  } else {
    const typedParams = event.params;
    grossAmount = typedParams.grossNativeAmount;
    if ("isBuy" in typedParams) {
      isBuy = typedParams.isBuy;
      appliedTotalSwapFeeBps = exactInt(
        typedParams.appliedTotalSwapFeeBps,
        "appliedTotalSwapFeeBps",
      );
    }
  }

  const feeAccrual: FeeAccrual = {
    ...immutableFields(occurrence),
    poolId,
    swapSender: lowerAddress(params.swapSender),
    quoteAsset,
    isBuy,
    appliedTotalSwapFeeBps,
    grossAmount,
    creatorFee: params.creatorFee,
    launcherFee: params.launcherFee,
  };
  context.FeeAccrual.set(feeAccrual);

  const totalsId = poolEntityId(CHAIN_ID, poolId);
  const current = await context.PoolFeeTotals.get(totalsId);
  context.PoolFeeTotals.set({
    id: totalsId,
    chainId: CHAIN_ID,
    poolId,
    model: current?.model ?? occurrence.release.model,
    releaseVersion:
      current?.releaseVersion ?? occurrence.release.releaseVersion,
    grossAmount: (current?.grossAmount ?? 0n) + grossAmount,
    creatorFees: (current?.creatorFees ?? 0n) + params.creatorFee,
    launcherFees: (current?.launcherFees ?? 0n) + params.launcherFee,
    swapCount: (current?.swapCount ?? 0n) + 1n,
    lastOccurrenceId: occurrence.provenance.id,
    blockNumber: occurrence.provenance.blockNumber,
  });
}

function handleCreatorFeeClaim(
  event: Extract<
    EvmEvent,
    {
      contractName:
        | "ClassicV2Hook"
        | "ClassicV3Hook"
        | "StockV1Hook"
        | "StockV2V3Hook";
      eventName: "CreatorFeesClaimed";
    }
  >,
  context: EvmOnEventContext,
  occurrence: RecordedOccurrence,
): void {
  const params = event.params;
  let creator: string | undefined;
  let recipient: string | undefined;
  let rewardVault: string | undefined;
  let quoteAsset: string | undefined;
  if (event.contractName === "ClassicV2Hook") {
    creator = lowerAddress(event.params.creator);
    recipient = lowerAddress(event.params.recipient);
  } else {
    rewardVault = lowerAddress(event.params.rewardVault);
    if (
      event.contractName === "StockV1Hook" ||
      event.contractName === "StockV2V3Hook"
    ) {
      quoteAsset = lowerAddress(event.params.quoteAsset);
    }
  }
  const claim: CreatorFeeClaim = {
    ...immutableFields(occurrence),
    poolId: lower(params.poolId),
    creator,
    rewardVault,
    recipient,
    quoteAsset,
    caller: lowerAddress(params.caller),
    amount: params.amount,
  };
  context.CreatorFeeClaim.set(claim);
}

function handleLauncherFeeClaim(
  event: Extract<
    EvmEvent,
    {
      contractName:
        | "ClassicV2Hook"
        | "ClassicV3Hook"
        | "StockV1Hook"
        | "StockV2V3Hook";
      eventName: "LauncherFeesClaimed";
    }
  >,
  context: EvmOnEventContext,
  occurrence: RecordedOccurrence,
): void {
  const quoteAsset =
    event.contractName === "StockV1Hook" ||
    event.contractName === "StockV2V3Hook"
      ? lowerAddress(event.params.quoteAsset)
      : undefined;
  const params = event.params;
  const claim: LauncherFeeClaim = {
    ...immutableFields(occurrence),
    treasury: lowerAddress(params.treasury),
    recipient: lowerAddress(params.recipient),
    quoteAsset,
    caller: lowerAddress(params.caller),
    amount: params.amount,
  };
  context.LauncherFeeClaim.set(claim);
}

async function handleVaultFactoryEvent(
  event: Extract<
    EvmEvent,
    {
      contractName:
        | "ClassicV3RewardVaultFactory"
        | "StockV1RewardVaultFactory"
        | "StockV2V3RewardVaultFactory";
    }
  >,
  context: EvmOnEventContext,
  occurrence: RecordedOccurrence,
): Promise<void> {
  const params = event.params;
  const vault = lowerAddress(params.vault);
  const poolId = lower(params.poolId);
  const relation = await context.PoolRelease.get(
    poolEntityId(CHAIN_ID, poolId),
  );
  const release =
    relation === undefined
      ? occurrence.release
      : {
          model: relation.model,
          releaseVersion: relation.releaseVersion,
        };
  const existing = await context.RewardVault.get(vault);
  if (existing !== undefined) {
    return;
  }
  const quoteAsset =
    event.contractName === "ClassicV3RewardVaultFactory"
      ? undefined
      : lowerAddress(event.params.quoteAsset);
  const salt =
    event.contractName === "ClassicV3RewardVaultFactory"
      ? lower(event.params.salt)
      : undefined;
  const configurationHash =
    event.contractName === "ClassicV3RewardVaultFactory"
      ? lower(event.params.configurationHash)
      : undefined;

  context.RewardVault.set({
    id: vault,
    chainId: CHAIN_ID,
    vault,
    poolId,
    hook: lowerAddress(params.feeHook),
    quoteAsset,
    salt,
    configurationHash,
    model: release.model,
    releaseVersion: release.releaseVersion,
    factoryOccurrenceId: occurrence.provenance.id,
    downstreamLogicalId: undefined,
    receiptLogOrdinal: undefined,
    payloadHash: occurrence.payloadHash,
    sourceAddress: occurrence.provenance.sourceAddress,
    blockNumber: occurrence.provenance.blockNumber,
    blockHash: occurrence.provenance.blockHash,
    transactionHash: occurrence.provenance.transactionHash,
    blockGlobalLogIndex: occurrence.provenance.blockGlobalLogIndex,
  });
  if (relation !== undefined) {
    const launch = await context.Launch.get(relation.launchId);
    if (launch !== undefined) {
      await reconcileLaunch(context, launch);
    }
  }
}

function handleVestingFactoryEvent(
  event: Extract<
    EvmEvent,
    {
      contractName: "ClassicV3VestingWalletFactory";
      eventName: "ClassicInitialBuyVestingWalletDeployed";
    }
  >,
  context: EvmOnEventContext,
  occurrence: RecordedOccurrence,
): void {
  const params = event.params;
  const wallet: VestingWallet = {
    ...immutableFields(occurrence),
    wallet: lowerAddress(params.wallet),
    token: lowerAddress(params.token),
    beneficiary: lowerAddress(params.beneficiary),
    salt: lower(params.salt),
    configurationHash: lower(params.configurationHash),
  };
  context.VestingWallet.set(wallet);
}

async function handleRewardVaultEvent(
  event: Extract<
    EvmEvent,
    {
      contractName:
        | "ClassicV3RewardVault"
        | "StockV1RewardVault"
        | "StockV2V3RewardVault";
    }
  >,
  context: EvmOnEventContext,
  occurrence: RecordedOccurrence,
): Promise<void> {
  const vault = occurrence.provenance.sourceAddress;
  const vaultEntity = await context.RewardVault.get(vault);

  if (event.contractName === "ClassicV3RewardVault") {
    if (event.eventName === "CreatorFeesCheckpointed") {
      const params = event.params;
      const checkpoint: RewardCheckpoint = {
        ...immutableFields(occurrence),
        vault,
        poolId: lower(params.poolId),
        configurationEpoch: params.configurationEpoch,
        amount: params.amount,
        totalCreatorFeesReceived: params.totalCreatorFeesReceived,
      };
      context.RewardCheckpoint.set(checkpoint);
      return;
    }
    if (event.eventName === "BeneficiaryFeesClaimed") {
      const params = event.params;
      const claim: BeneficiaryClaim = {
        ...immutableFields(occurrence),
        vault,
        beneficiary: lowerAddress(params.beneficiary),
        payoutAddress: undefined,
        quoteAsset: vaultEntity?.quoteAsset,
        amount: params.amount,
        beneficiaryTotalClaimed: params.beneficiaryTotalClaimed,
        vaultTotalReceived: params.vaultTotalReceived,
      };
      context.BeneficiaryClaim.set(claim);
      return;
    }
    if (event.eventName === "PayoutWalletChanged") {
      const params = event.params;
      const change: PayoutChange = {
        ...immutableFields(occurrence),
        vault,
        poolId: lower(params.poolId),
        beneficiary: undefined,
        allocationIndex: params.allocationIndex,
        previousPayoutAddress: lowerAddress(params.previousPayoutWallet),
        newPayoutAddress: lowerAddress(params.newPayoutWallet),
        shareBps: exactInt(params.shareBps, "shareBps"),
        configurationEpoch: params.configurationEpoch,
        activeConfigurationHash: lower(params.activeConfigurationHash),
        effectiveTotalCreatorFeesReceived:
          params.effectiveTotalCreatorFeesReceived,
      };
      context.PayoutChange.set(change);
      return;
    }
    const params = event.params;
    const change: RewardConfigurationChange = {
      ...immutableFields(occurrence),
      vault,
      poolId: lower(params.poolId),
      approvalReference: lower(params.approvalReference),
      configurationEpoch: params.configurationEpoch,
      previousConfigurationHash: lower(params.previousConfigurationHash),
      newConfigurationHash: lower(params.newConfigurationHash),
      beneficiaries: params.beneficiaries.map((value) =>
        lowerAddress(value)
      ),
      sharesBps: params.sharesBps.map((value) =>
        exactInt(value, "beneficiary shareBps")
      ),
      effectiveTotalCreatorFeesReceived:
        params.effectiveTotalCreatorFeesReceived,
    };
    context.RewardConfigurationChange.set(change);
    return;
  }

  if (event.eventName === "PayoutAddressUpdated") {
    const params = event.params;
    const change: PayoutChange = {
      ...immutableFields(occurrence),
      vault,
      poolId: vaultEntity?.poolId,
      beneficiary: lowerAddress(params.beneficiary),
      allocationIndex: undefined,
      previousPayoutAddress: lowerAddress(params.previousPayoutAddress),
      newPayoutAddress: lowerAddress(params.newPayoutAddress),
      shareBps: undefined,
      configurationEpoch: undefined,
      activeConfigurationHash: undefined,
      effectiveTotalCreatorFeesReceived: undefined,
    };
    context.PayoutChange.set(change);
    return;
  }
  const params = event.params;
  const claim: BeneficiaryClaim = {
    ...immutableFields(occurrence),
    vault,
    beneficiary: lowerAddress(params.beneficiary),
    payoutAddress: lowerAddress(params.payoutAddress),
    quoteAsset: lowerAddress(params.quoteAsset),
    amount: params.amount,
    beneficiaryTotalClaimed: params.beneficiaryTotalClaimed,
    vaultTotalReceived: params.vaultTotalReceived,
  };
  context.BeneficiaryClaim.set(claim);
}

function immutableFields(occurrence: RecordedOccurrence): {
  id: string;
  downstreamLogicalId: undefined;
  receiptLogOrdinal: undefined;
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  blockTimestamp: bigint;
  transactionHash: string;
  transactionIndex: number;
  blockGlobalLogIndex: number;
  sourceAddress: string;
  model: string;
  releaseVersion: string;
  payloadHash: string;
} {
  return {
    ...occurrence.provenance,
    model: occurrence.release.model,
    releaseVersion: occurrence.release.releaseVersion,
    payloadHash: occurrence.payloadHash,
  };
}

function findEventAbi(event: EvmEvent): AbiEvent {
  const contract = indexer.chains[CHAIN_ID][event.contractName];
  const eventAbi = contract.abi.find(
    (item): item is AbiEvent =>
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      item.type === "event" &&
      "name" in item &&
      item.name === event.eventName,
  );
  if (eventAbi === undefined) {
    throw new Error(
      `Missing configured ABI for ${event.contractName}.${event.eventName}`,
    );
  }
  return eventAbi;
}

function eventPoolId(event: EvmEvent): string | undefined {
  const params = event.params as unknown as Record<string, unknown>;
  return typeof params.poolId === "string" ? lower(params.poolId) : undefined;
}

function eventBlockFilter(contractName: string): {
  readonly block: { readonly number: { readonly _gte: number } };
} {
  const startBlock = sourceStartBlock(contractName);
  if (startBlock === undefined) {
    throw new Error(`Missing source start block for ${contractName}`);
  }
  return { block: { number: { _gte: startBlock } } };
}

function sourceAddress(contractName: string): string {
  const source = SOURCE_REGISTRY.find(
    (entry) => entry.contractName === contractName,
  );
  if (source === undefined) {
    throw new Error(`Missing configured source for ${contractName}`);
  }
  return lowerAddress(source.address);
}

function hookForRelease(releaseVersion: string): string | undefined {
  switch (releaseVersion) {
    case "classic-v2":
      return CLASSIC_V2_HOOK;
    case "classic-v3":
      return CLASSIC_V3_HOOK;
    case "stock-paired-v1":
      return STOCK_V1_HOOK;
    case "stock-paired-v2":
    case "stock-paired-v3":
      return STOCK_V2_V3_HOOK;
    default:
      return undefined;
  }
}

function exactInt(value: bigint, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${field} exceeds the exact GraphQL Int range`);
  }
  return result;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (typeof left === "string" && typeof right === "string") {
    return lower(left) === lower(right);
  }
  return left === right;
}

function optionalMatches(
  actual: string | undefined,
  expected: string | undefined,
): boolean {
  return actual === undefined || expected === undefined
    ? actual === expected || actual === undefined
    : sameValue(actual, expected);
}

function compatibleOptionalValue(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return left === undefined || right === undefined || sameValue(left, right);
}

function isEventFlag(key: keyof Launch): boolean {
  return (
    key === "hasLaunchEvent" ||
    key === "hasLiquidityEvent" ||
    key === "hasInitialBuyEvent" ||
    key === "hasCustodyEvent" ||
    key === "hasCoordinatorEvent"
  );
}

indexer.onEvent(
  {
    contract: "ClassicV2Launcher",
    event: "MemeTokenLaunched",
    where: eventBlockFilter("ClassicV2Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV2Launcher",
    event: "MemeLiquidityConfigured",
    where: eventBlockFilter("ClassicV2Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV2Launcher",
    event: "MemeCreatorInitialBuy",
    where: eventBlockFilter("ClassicV2Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV2Hook",
    event: "PoolRegistered",
    where: eventBlockFilter("ClassicV2Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV2Hook",
    event: "PoolFeeDisclosure",
    where: eventBlockFilter("ClassicV2Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV2Hook",
    event: "NativeSwapFeesAccrued",
    where: eventBlockFilter("ClassicV2Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV2Hook",
    event: "CreatorFeesClaimed",
    where: eventBlockFilter("ClassicV2Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV2Hook",
    event: "LauncherFeesClaimed",
    where: eventBlockFilter("ClassicV2Hook"),
  },
  handleEvent,
);

indexer.onEvent(
  {
    contract: "ClassicV3Launcher",
    event: "MemeTokenLaunchedV2",
    where: eventBlockFilter("ClassicV3Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV3Launcher",
    event: "MemeLiquidityConfiguredV2",
    where: eventBlockFilter("ClassicV3Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV3Launcher",
    event: "MemeCreatorInitialBuyV2",
    where: eventBlockFilter("ClassicV3Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV3Launcher",
    event: "MemeCreatorInitialBuyCustodyV2",
    where: eventBlockFilter("ClassicV3Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV3Hook",
    event: "PoolRegistered",
    where: eventBlockFilter("ClassicV3Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV3Hook",
    event: "PoolFeeDisclosure",
    where: eventBlockFilter("ClassicV3Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV3Hook",
    event: "NativeSwapFeesAccrued",
    where: eventBlockFilter("ClassicV3Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV3Hook",
    event: "CreatorFeesClaimed",
    where: eventBlockFilter("ClassicV3Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV3Hook",
    event: "LauncherFeesClaimed",
    where: eventBlockFilter("ClassicV3Hook"),
  },
  handleEvent,
);
indexer.contractRegister(
  {
    contract: "ClassicV3RewardVaultFactory",
    event: "ClassicRewardVaultDeployed",
    where: eventBlockFilter("ClassicV3RewardVaultFactory"),
  },
  async ({ event, context }) => {
    context.chain.ClassicV3RewardVault.add(event.params.vault);
  },
);
indexer.onEvent(
  {
    contract: "ClassicV3RewardVaultFactory",
    event: "ClassicRewardVaultDeployed",
    where: eventBlockFilter("ClassicV3RewardVaultFactory"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV3VestingWalletFactory",
    event: "ClassicInitialBuyVestingWalletDeployed",
    where: eventBlockFilter("ClassicV3VestingWalletFactory"),
  },
  handleEvent,
);
indexer.onEvent(
  { contract: "ClassicV3RewardVault", event: "CreatorFeesCheckpointed" },
  handleEvent,
);
indexer.onEvent(
  { contract: "ClassicV3RewardVault", event: "BeneficiaryFeesClaimed" },
  handleEvent,
);
indexer.onEvent(
  { contract: "ClassicV3RewardVault", event: "PayoutWalletChanged" },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "ClassicV3RewardVault",
    event: "CtoRewardConfigurationActivated",
  },
  handleEvent,
);

indexer.onEvent(
  {
    contract: "StockV1Launcher",
    event: "StockPairedTokenLaunched",
    where: eventBlockFilter("StockV1Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV1Launcher",
    event: "StockPairedLiquidityConfigured",
    where: eventBlockFilter("StockV1Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV1Launcher",
    event: "StockPairedCreatorInitialBuy",
    where: eventBlockFilter("StockV1Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV1EthCoordinator",
    event: "StockPairedEthTokenLaunched",
    where: eventBlockFilter("StockV1EthCoordinator"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV1Hook",
    event: "PoolRegistered",
    where: eventBlockFilter("StockV1Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV1Hook",
    event: "PoolFeeDisclosure",
    where: eventBlockFilter("StockV1Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV1Hook",
    event: "QuoteSwapFeesAccrued",
    where: eventBlockFilter("StockV1Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV1Hook",
    event: "CreatorFeesClaimed",
    where: eventBlockFilter("StockV1Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV1Hook",
    event: "LauncherFeesClaimed",
    where: eventBlockFilter("StockV1Hook"),
  },
  handleEvent,
);
indexer.contractRegister(
  {
    contract: "StockV1RewardVaultFactory",
    event: "QuoteAssetFeeSplitVaultDeployed",
    where: eventBlockFilter("StockV1RewardVaultFactory"),
  },
  async ({ event, context }) => {
    context.chain.StockV1RewardVault.add(event.params.vault);
  },
);
indexer.onEvent(
  {
    contract: "StockV1RewardVaultFactory",
    event: "QuoteAssetFeeSplitVaultDeployed",
    where: eventBlockFilter("StockV1RewardVaultFactory"),
  },
  handleEvent,
);
indexer.onEvent(
  { contract: "StockV1RewardVault", event: "PayoutAddressUpdated" },
  handleEvent,
);
indexer.onEvent(
  { contract: "StockV1RewardVault", event: "BeneficiaryFeesClaimed" },
  handleEvent,
);

indexer.onEvent(
  {
    contract: "StockV2Launcher",
    event: "StockPairedTokenLaunched",
    where: eventBlockFilter("StockV2Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV2Launcher",
    event: "StockPairedLiquidityConfigured",
    where: eventBlockFilter("StockV2Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV2Launcher",
    event: "StockPairedCreatorInitialBuy",
    where: eventBlockFilter("StockV2Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV2EthCoordinator",
    event: "StockPairedEthTokenLaunched",
    where: eventBlockFilter("StockV2EthCoordinator"),
  },
  handleEvent,
);

indexer.onEvent(
  {
    contract: "StockV3Launcher",
    event: "StockPairedTokenLaunched",
    where: eventBlockFilter("StockV3Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV3Launcher",
    event: "StockPairedLiquidityConfigured",
    where: eventBlockFilter("StockV3Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV3Launcher",
    event: "StockPairedCreatorInitialBuy",
    where: eventBlockFilter("StockV3Launcher"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV3EthCoordinator",
    event: "StockPairedEthTokenLaunched",
    where: eventBlockFilter("StockV3EthCoordinator"),
  },
  handleEvent,
);

indexer.onEvent(
  {
    contract: "StockV2V3Hook",
    event: "PoolRegistered",
    where: eventBlockFilter("StockV2V3Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV2V3Hook",
    event: "PoolFeeDisclosure",
    where: eventBlockFilter("StockV2V3Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV2V3Hook",
    event: "QuoteSwapFeesAccrued",
    where: eventBlockFilter("StockV2V3Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV2V3Hook",
    event: "CreatorFeesClaimed",
    where: eventBlockFilter("StockV2V3Hook"),
  },
  handleEvent,
);
indexer.onEvent(
  {
    contract: "StockV2V3Hook",
    event: "LauncherFeesClaimed",
    where: eventBlockFilter("StockV2V3Hook"),
  },
  handleEvent,
);
indexer.contractRegister(
  {
    contract: "StockV2V3RewardVaultFactory",
    event: "QuoteAssetFeeSplitVaultDeployed",
    where: eventBlockFilter("StockV2V3RewardVaultFactory"),
  },
  async ({ event, context }) => {
    context.chain.StockV2V3RewardVault.add(event.params.vault);
  },
);
indexer.onEvent(
  {
    contract: "StockV2V3RewardVaultFactory",
    event: "QuoteAssetFeeSplitVaultDeployed",
    where: eventBlockFilter("StockV2V3RewardVaultFactory"),
  },
  handleEvent,
);
indexer.onEvent(
  { contract: "StockV2V3RewardVault", event: "PayoutAddressUpdated" },
  handleEvent,
);
indexer.onEvent(
  { contract: "StockV2V3RewardVault", event: "BeneficiaryFeesClaimed" },
  handleEvent,
);
