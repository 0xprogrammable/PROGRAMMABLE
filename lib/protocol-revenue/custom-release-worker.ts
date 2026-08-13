export const CUSTOM_REVENUE_CHAIN_ID = "1" as const;
export const CUSTOM_REVENUE_REGISTRY_MINIMUM_GENERATION = "2" as const;
export const CUSTOM_REVENUE_LAUNCH_CLASS_ID =
  "0xd8cb4a312f05465847245397da3e1ecb594cb26231fe39912db541c29c62c3aa" as const;
export const CUSTOM_REVENUE_NATIVE_ASSET =
  "0x0000000000000000000000000000000000000000" as const;
export const CUSTOM_REVENUE_REWARD_WALLET =
  "0x4957f49620aff3adbbe8195a4f633e49cc93376c" as const;
export const CUSTOM_REVENUE_CLAIM_SELECTOR = "0xb9d2fad0" as const;
export const CUSTOM_REVENUE_SOURCE_INTERFACE_ID = "0x808cb67a" as const;
export const CUSTOM_REVENUE_CLAIM_EVENT_TOPIC =
  "0x477c82c33085e0da9febf1f975aae54f3dec43d0466a7bddf38484cd90a32957" as const;
export const CUSTOM_REVENUE_PROGRAMMABLE_FEE_BPS = 10 as const;
export const CUSTOM_REVENUE_MINIMUM_FINALITY_BLOCKS = 64n;
export const CUSTOM_REVENUE_MAXIMUM_CLAIM_BATCH = 8;

type Hex = `0x${string}`;
type Address = `0x${string}`;
type UintString = string;

export type FinalizedCustomRevenueSourceV1 = Readonly<{
  chainId: typeof CUSTOM_REVENUE_CHAIN_ID;
  customRegistryGeneration: UintString;
  finalizedRegistrarIndex: number;
  launchId: Hex;
  sourceId: Hex;
  launchClassId: typeof CUSTOM_REVENUE_LAUNCH_CLASS_ID;
  source: Address;
  sourceRuntimeCodeHash: Hex;
  asset: typeof CUSTOM_REVENUE_NATIVE_ASSET;
  claimSelector: typeof CUSTOM_REVENUE_CLAIM_SELECTOR;
  standardInterfaceId: typeof CUSTOM_REVENUE_SOURCE_INTERFACE_ID;
  recipient: typeof CUSTOM_REVENUE_REWARD_WALLET;
  programmableFeeBps: typeof CUSTOM_REVENUE_PROGRAMMABLE_FEE_BPS;
  approvedFactory: Address;
  approvedFactoryRuntimeCodeHash: Hex;
  create2Deployer: Address;
  create2DeployerRuntimeCodeHash: Hex;
  templateCommitment: Hex;
  sourceActivatedAtBlock: UintString;
  sourceActivatedAtBlockHash: Hex;
  sourceActivationTransactionHash: Hex;
  sourceActivationTransactionIndex: number;
  sourceActivationLogIndex: number;
  sourceActivatedTotalClaimedBaselineWei: "0";
  launchStampBlockNumber: UintString;
  finalizedAtBlock: UintString;
  finalityEvidenceHash: Hex;
  currentlyExecutable: boolean;
  quarantined: boolean;
  runtimeCodeHashMatchedAtFinalizedHead: boolean;
  customRegistryStillFinalizedAtHead: boolean;
  launchStampStillMatchedAtHead: boolean;
  totalClaimedAtFinalizedHeadWei: UintString;
  accruedAtFinalizedHeadWei: UintString;
}>;

export type CustomRevenueLifetimeCursorV1 = Readonly<{
  schemaVersion: "programmable.custom-revenue.lifetime-cursor.v1";
  chainId: typeof CUSTOM_REVENUE_CHAIN_ID;
  sourceId: Hex;
  source: Address;
  activationBlockNumber: UintString;
  activationBlockHash: Hex;
  activationTransactionHash: Hex;
  activationTransactionIndex: number;
  activationLogIndex: number;
  activationTotalClaimedBaselineWei: "0";
  nextBlockNumber: UintString;
  lastFinalizedBlockNumber: UintString | null;
  lastFinalizedBlockHash: Hex | null;
  observedLifetimeClaimedWei: UintString;
}>;

export type CanonicalCustomClaimEventV1 = Readonly<{
  topic0: typeof CUSTOM_REVENUE_CLAIM_EVENT_TOPIC;
  sourceId: Hex;
  source: Address;
  asset: typeof CUSTOM_REVENUE_NATIVE_ASSET;
  recipient: typeof CUSTOM_REVENUE_REWARD_WALLET;
  caller: Address;
  amountWei: UintString;
  blockNumber: UintString;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
}>;

export type CanonicalCustomClaimReceiptV1 = Readonly<{
  transactionHash: Hex;
  blockNumber: UintString;
  blockHash: Hex;
  status: "success";
  canonicalClaimEventAmountWei: UintString;
  rewardWalletBalanceDeltaWei: UintString;
}>;

export type CustomRevenueWorkerInputV1 = Readonly<{
  schemaVersion: "programmable.custom-revenue.worker-input.v1";
  chainId: typeof CUSTOM_REVENUE_CHAIN_ID;
  finalizedHead: Readonly<{ blockNumber: UintString; blockHash: Hex }>;
  canonicalBlockHashes: Readonly<Record<UintString, Hex>>;
  sources: readonly FinalizedCustomRevenueSourceV1[];
  cursors: readonly CustomRevenueLifetimeCursorV1[];
  claimEvents: readonly CanonicalCustomClaimEventV1[];
  claimReceipts: readonly CanonicalCustomClaimReceiptV1[];
}>;

export type CustomRevenueWorkerPlanV1 = Readonly<{
  schemaVersion: "programmable.custom-revenue.worker-plan.v1";
  chainId: typeof CUSTOM_REVENUE_CHAIN_ID;
  eligibilitySource: "finalized-custom-registry-v2-and-launch-stamp-only";
  registryV1InferenceUsed: false;
  executorLocalCountersUsedForEligibility: false;
  lifetimeObservationIncludesQuarantined: true;
  finalizedHead: Readonly<{ blockNumber: UintString; blockHash: Hex }>;
  observationSourceIds: readonly Hex[];
  claimBatches: readonly (readonly Hex[])[];
  nextCursors: readonly CustomRevenueLifetimeCursorV1[];
}>;

export class CustomRevenueWorkerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomRevenueWorkerInvariantError";
  }
}

function fail(message: string): never {
  throw new CustomRevenueWorkerInvariantError(message);
}

function uint(value: string, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) fail(`${label} is not a canonical uint`);
  return BigInt(value);
}

function exactHex(value: string, bytes: number, label: string): string {
  if (!new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`, "u").test(value)) {
    fail(`${label} is not canonical lowercase hex`);
  }
  return value;
}

function nonzeroHex(value: string, bytes: number, label: string): string {
  exactHex(value, bytes, label);
  if (value === `0x${"0".repeat(bytes * 2)}`) fail(`${label} is zero`);
  return value;
}

function safeIndex(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} is not a nonnegative safe integer`);
  return value;
}

function assertSource(source: FinalizedCustomRevenueSourceV1, finalizedHead: bigint): void {
  if (source.chainId !== CUSTOM_REVENUE_CHAIN_ID) fail("source chainId drifted");
  if (uint(source.customRegistryGeneration, "Custom Registry generation") < 2n) {
    fail("Custom Registry V1 cannot supply executable revenue eligibility");
  }
  if (source.launchClassId !== CUSTOM_REVENUE_LAUNCH_CLASS_ID) fail("launch class is not Custom V2");
  nonzeroHex(source.launchId, 32, "launchId");
  nonzeroHex(source.sourceId, 32, "sourceId");
  nonzeroHex(source.source, 20, "source");
  nonzeroHex(source.sourceRuntimeCodeHash, 32, "source runtime hash");
  if (source.asset !== CUSTOM_REVENUE_NATIVE_ASSET) fail("source asset is not native ETH");
  if (source.claimSelector !== CUSTOM_REVENUE_CLAIM_SELECTOR) fail("claim selector drifted");
  if (source.standardInterfaceId !== CUSTOM_REVENUE_SOURCE_INTERFACE_ID) fail("source interface drifted");
  if (source.recipient !== CUSTOM_REVENUE_REWARD_WALLET) fail("reward wallet drifted");
  if (source.programmableFeeBps !== CUSTOM_REVENUE_PROGRAMMABLE_FEE_BPS) fail("fee bps drifted");
  nonzeroHex(source.approvedFactory, 20, "approved factory");
  nonzeroHex(source.approvedFactoryRuntimeCodeHash, 32, "approved factory runtime hash");
  nonzeroHex(source.create2Deployer, 20, "CREATE2 deployer");
  nonzeroHex(source.create2DeployerRuntimeCodeHash, 32, "CREATE2 deployer runtime hash");
  nonzeroHex(source.templateCommitment, 32, "template commitment");
  nonzeroHex(source.sourceActivatedAtBlockHash, 32, "activation block hash");
  nonzeroHex(source.sourceActivationTransactionHash, 32, "activation transaction hash");
  safeIndex(source.sourceActivationTransactionIndex, "activation transaction index");
  safeIndex(source.sourceActivationLogIndex, "activation log index");
  if (source.sourceActivatedTotalClaimedBaselineWei !== "0") fail("activation claim baseline is not zero");
  nonzeroHex(source.finalityEvidenceHash, 32, "finality evidence hash");

  const activation = uint(source.sourceActivatedAtBlock, "activation block");
  const stamp = uint(source.launchStampBlockNumber, "Launch Stamp block");
  const finalized = uint(source.finalizedAtBlock, "Custom finalization block");
  if (stamp < activation) fail("Launch Stamp predates source activation");
  if (finalized < stamp + CUSTOM_REVENUE_MINIMUM_FINALITY_BLOCKS) fail("Custom finality is below 64 blocks");
  if (finalized > finalizedHead) fail("Custom finalization is ahead of the finalized worker head");
  uint(source.totalClaimedAtFinalizedHeadWei, "source lifetime counter");
  uint(source.accruedAtFinalizedHeadWei, "source accrued amount");
  if (source.currentlyExecutable && source.quarantined) fail("quarantined source cannot be executable");
}

function initialCursor(source: FinalizedCustomRevenueSourceV1): CustomRevenueLifetimeCursorV1 {
  return Object.freeze({
    schemaVersion: "programmable.custom-revenue.lifetime-cursor.v1",
    chainId: CUSTOM_REVENUE_CHAIN_ID,
    sourceId: source.sourceId,
    source: source.source,
    activationBlockNumber: source.sourceActivatedAtBlock,
    activationBlockHash: source.sourceActivatedAtBlockHash,
    activationTransactionHash: source.sourceActivationTransactionHash,
    activationTransactionIndex: source.sourceActivationTransactionIndex,
    activationLogIndex: source.sourceActivationLogIndex,
    activationTotalClaimedBaselineWei: "0",
    nextBlockNumber: source.sourceActivatedAtBlock,
    lastFinalizedBlockNumber: null,
    lastFinalizedBlockHash: null,
    observedLifetimeClaimedWei: "0",
  });
}

function assertCursor(
  cursor: CustomRevenueLifetimeCursorV1,
  source: FinalizedCustomRevenueSourceV1,
  canonicalBlockHashes: Readonly<Record<string, Hex>>,
  finalizedHead: bigint,
): void {
  if (
    cursor.schemaVersion !== "programmable.custom-revenue.lifetime-cursor.v1" ||
    cursor.chainId !== CUSTOM_REVENUE_CHAIN_ID ||
    cursor.sourceId !== source.sourceId ||
    cursor.source !== source.source ||
    cursor.activationBlockNumber !== source.sourceActivatedAtBlock ||
    cursor.activationBlockHash !== source.sourceActivatedAtBlockHash ||
    cursor.activationTransactionHash !== source.sourceActivationTransactionHash ||
    cursor.activationTransactionIndex !== source.sourceActivationTransactionIndex ||
    cursor.activationLogIndex !== source.sourceActivationLogIndex ||
    cursor.activationTotalClaimedBaselineWei !== "0"
  ) fail(`lifetime cursor identity drifted for ${source.sourceId}`);
  const nextBlock = uint(cursor.nextBlockNumber, "cursor next block");
  if (nextBlock < uint(source.sourceActivatedAtBlock, "activation block")) fail("cursor precedes activation");
  if (nextBlock > finalizedHead + 1n) fail("cursor is ahead of the finalized worker head");
  uint(cursor.observedLifetimeClaimedWei, "cursor observed lifetime amount");
  if ((cursor.lastFinalizedBlockNumber === null) !== (cursor.lastFinalizedBlockHash === null)) {
    fail("cursor finalized anchor is partial");
  }
  if (cursor.lastFinalizedBlockNumber !== null && cursor.lastFinalizedBlockHash !== null) {
    nonzeroHex(cursor.lastFinalizedBlockHash, 32, "cursor finalized block hash");
    if (canonicalBlockHashes[cursor.lastFinalizedBlockNumber] !== cursor.lastFinalizedBlockHash) {
      fail(`cursor finalized block is no longer canonical for ${source.sourceId}`);
    }
    if (nextBlock !== uint(cursor.lastFinalizedBlockNumber, "cursor last block") + 1n) {
      fail("cursor next block is not contiguous");
    }
  }
}

function comesAfterActivation(
  event: CanonicalCustomClaimEventV1,
  source: FinalizedCustomRevenueSourceV1,
): boolean {
  const eventBlock = uint(event.blockNumber, "claim event block");
  const activationBlock = uint(source.sourceActivatedAtBlock, "activation block");
  if (eventBlock !== activationBlock) return eventBlock > activationBlock;
  return event.transactionIndex > source.sourceActivationTransactionIndex ||
    (event.transactionIndex === source.sourceActivationTransactionIndex &&
      event.logIndex > source.sourceActivationLogIndex);
}

function chunk<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

export function buildCustomRevenueWorkerPlan(input: CustomRevenueWorkerInputV1): CustomRevenueWorkerPlanV1 {
  if (input.schemaVersion !== "programmable.custom-revenue.worker-input.v1") fail("worker input schema drifted");
  if (input.chainId !== CUSTOM_REVENUE_CHAIN_ID) fail("worker is restricted to Ethereum mainnet");
  const finalizedHead = uint(input.finalizedHead.blockNumber, "finalized head");
  nonzeroHex(input.finalizedHead.blockHash, 32, "finalized head hash");
  if (input.canonicalBlockHashes[input.finalizedHead.blockNumber] !== input.finalizedHead.blockHash) {
    fail("finalized head hash is not canonical");
  }

  const sourceById = new Map<string, FinalizedCustomRevenueSourceV1>();
  const sourceByAddress = new Map<string, FinalizedCustomRevenueSourceV1>();
  const launchIds = new Set<string>();
  for (const [index, source] of input.sources.entries()) {
    assertSource(source, finalizedHead);
    if (safeIndex(source.finalizedRegistrarIndex, "finalized registrar index") !== index) {
      fail("finalized sources are not the complete ordered registrar enumeration");
    }
    if (input.canonicalBlockHashes[source.sourceActivatedAtBlock] !== source.sourceActivatedAtBlockHash) {
      fail(`source activation block is not canonical for ${source.sourceId}`);
    }
    if (sourceById.has(source.sourceId) || sourceByAddress.has(source.source) || launchIds.has(source.launchId)) {
      fail("duplicate finalized source or launch");
    }
    sourceById.set(source.sourceId, source);
    sourceByAddress.set(source.source, source);
    launchIds.add(source.launchId);
  }

  const cursorBySource = new Map<string, CustomRevenueLifetimeCursorV1>();
  for (const cursor of input.cursors) {
    if (cursorBySource.has(cursor.sourceId)) fail("duplicate lifetime cursor");
    const source = sourceById.get(cursor.sourceId);
    if (!source) fail("cursor references a non-finalized source");
    assertCursor(cursor, source, input.canonicalBlockHashes, finalizedHead);
    cursorBySource.set(cursor.sourceId, cursor);
  }

  const receiptByTransaction = new Map<string, CanonicalCustomClaimReceiptV1>();
  for (const receipt of input.claimReceipts) {
    nonzeroHex(receipt.transactionHash, 32, "claim receipt transaction hash");
    nonzeroHex(receipt.blockHash, 32, "claim receipt block hash");
    if (receiptByTransaction.has(receipt.transactionHash)) fail("duplicate claim receipt");
    if (receipt.status !== "success") fail("canonical claim receipt did not succeed");
    if (input.canonicalBlockHashes[receipt.blockNumber] !== receipt.blockHash) {
      fail("claim receipt block is not canonical");
    }
    uint(receipt.canonicalClaimEventAmountWei, "receipt claim amount");
    uint(receipt.rewardWalletBalanceDeltaWei, "receipt reward-wallet delta");
    receiptByTransaction.set(receipt.transactionHash, receipt);
  }

  const eventKeys = new Set<string>();
  const eventAmountBySource = new Map<string, bigint>();
  const eventAmountByTransaction = new Map<string, bigint>();
  const eventBlockByTransaction = new Map<string, Readonly<{ blockNumber: string; blockHash: Hex }>>();
  for (const event of input.claimEvents) {
    if (event.topic0 !== CUSTOM_REVENUE_CLAIM_EVENT_TOPIC) fail("claim event topic drifted");
    const source = sourceById.get(event.sourceId);
    if (!source || source.source !== event.source || sourceByAddress.get(event.source) !== source) {
      fail("claim event source is not a finalized Custom V2 source");
    }
    if (event.asset !== CUSTOM_REVENUE_NATIVE_ASSET || event.recipient !== CUSTOM_REVENUE_REWARD_WALLET) {
      fail("claim event policy binding drifted");
    }
    nonzeroHex(event.caller, 20, "claim event caller");
    nonzeroHex(event.transactionHash, 32, "claim event transaction hash");
    nonzeroHex(event.blockHash, 32, "claim event block hash");
    safeIndex(event.transactionIndex, "claim event transaction index");
    safeIndex(event.logIndex, "claim event log index");
    if (input.canonicalBlockHashes[event.blockNumber] !== event.blockHash) fail("claim event block is not canonical");
    const eventBlock = uint(event.blockNumber, "claim event block");
    const cursor = cursorBySource.get(source.sourceId) ?? initialCursor(source);
    if (eventBlock < uint(cursor.nextBlockNumber, "cursor next block") || eventBlock > finalizedHead) {
      fail("claim event falls outside the exact cursor scan range");
    }
    if (!comesAfterActivation(event, source)) fail("claim event does not follow the activation event");
    const key = `${event.transactionHash}:${event.logIndex}`;
    if (eventKeys.has(key)) fail("duplicate canonical claim event");
    eventKeys.add(key);
    const amount = uint(event.amountWei, "claim event amount");
    if (amount === 0n) fail("canonical claim event amount is zero");
    eventAmountBySource.set(source.sourceId, (eventAmountBySource.get(source.sourceId) ?? 0n) + amount);
    eventAmountByTransaction.set(
      event.transactionHash,
      (eventAmountByTransaction.get(event.transactionHash) ?? 0n) + amount,
    );
    const priorEventBlock = eventBlockByTransaction.get(event.transactionHash);
    if (
      priorEventBlock &&
      (priorEventBlock.blockNumber !== event.blockNumber || priorEventBlock.blockHash !== event.blockHash)
    ) fail("claim events from one transaction disagree on their canonical block");
    eventBlockByTransaction.set(event.transactionHash, {
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
    });
  }

  for (const [transactionHash, amount] of eventAmountByTransaction) {
    const receipt = receiptByTransaction.get(transactionHash);
    if (!receipt) fail("canonical claim event has no receipt reconciliation");
    const eventBlock = eventBlockByTransaction.get(transactionHash);
    if (!eventBlock || receipt.blockNumber !== eventBlock.blockNumber || receipt.blockHash !== eventBlock.blockHash) {
      fail("claim receipt block does not match its canonical claim events");
    }
    if (
      uint(receipt.canonicalClaimEventAmountWei, "receipt claim amount") !== amount ||
      uint(receipt.rewardWalletBalanceDeltaWei, "receipt reward-wallet delta") !== amount
    ) fail("claim receipt does not reconcile canonical events and reward-wallet delta");
  }
  for (const transactionHash of receiptByTransaction.keys()) {
    if (!eventAmountByTransaction.has(transactionHash)) fail("claim receipt has no canonical event");
  }

  const nextCursors: CustomRevenueLifetimeCursorV1[] = [];
  const observationSourceIds: Hex[] = [];
  const claimSourceIds: Hex[] = [];
  for (const source of input.sources) {
    const cursor = cursorBySource.get(source.sourceId) ?? initialCursor(source);
    const previous = uint(cursor.observedLifetimeClaimedWei, "cursor observed lifetime amount");
    const newlyObserved = eventAmountBySource.get(source.sourceId) ?? 0n;
    const current = uint(source.totalClaimedAtFinalizedHeadWei, "source lifetime counter");
    if (previous + newlyObserved !== current) {
      fail(`source lifetime counter is not fully reconciled by canonical events for ${source.sourceId}`);
    }
    observationSourceIds.push(source.sourceId);
    nextCursors.push(Object.freeze({
      ...cursor,
      nextBlockNumber: (finalizedHead + 1n).toString(),
      lastFinalizedBlockNumber: finalizedHead.toString(),
      lastFinalizedBlockHash: input.finalizedHead.blockHash,
      observedLifetimeClaimedWei: current.toString(),
    }));

    if (
      source.currentlyExecutable && !source.quarantined && source.runtimeCodeHashMatchedAtFinalizedHead &&
      source.customRegistryStillFinalizedAtHead && source.launchStampStillMatchedAtHead &&
      uint(source.accruedAtFinalizedHeadWei, "source accrued amount") > 0n
    ) claimSourceIds.push(source.sourceId);
  }

  return Object.freeze({
    schemaVersion: "programmable.custom-revenue.worker-plan.v1",
    chainId: CUSTOM_REVENUE_CHAIN_ID,
    eligibilitySource: "finalized-custom-registry-v2-and-launch-stamp-only",
    registryV1InferenceUsed: false,
    executorLocalCountersUsedForEligibility: false,
    lifetimeObservationIncludesQuarantined: true,
    finalizedHead: input.finalizedHead,
    observationSourceIds: Object.freeze(observationSourceIds),
    claimBatches: Object.freeze(chunk(claimSourceIds, CUSTOM_REVENUE_MAXIMUM_CLAIM_BATCH)),
    nextCursors: Object.freeze(nextCursors),
  });
}
