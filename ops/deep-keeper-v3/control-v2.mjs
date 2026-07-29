import { randomUUID } from "node:crypto";

import {
  DEEP_V3_KEEPER_V2_CONTROL_PATH,
  DEEP_V3_KEEPER_V2_LEGACY_CONTROL_PATH,
  DEEP_V3_KEEPER_V2_MAX_SIGNER_REQUEST_LIFETIME_MS,
} from "./config-v2.mjs";

export const DEEP_V3_KEEPER_V2_STATE_SCHEMA_VERSION = 2;
export const DEEP_V3_KEEPER_V2_LEASE_DURATION_MS = 180_000;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const IDEMPOTENCY_PATTERN = /^deepv3v2-[0-9a-f]{32}$/;
const UINT_PATTERN = /^(0|[1-9][0-9]*)$/;
const ID_PATTERN = /^[a-zA-Z0-9._:-]{1,96}$/;
const MAX_BUDGET_DAYS = 4;
const MAX_TICK_BUDGETS = 4;

export class DeepV3KeeperV2ControlError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeepV3KeeperV2ControlError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DeepV3KeeperV2ControlError(code, message);
}

function validNow(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    fail("INVALID_CLOCK", "Keeper clock must be a non-negative integer");
  }
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nullableInteger(value) {
  return value === null || safeInteger(value);
}

function validUint(value, { positive = false } = {}) {
  if (typeof value !== "string" || !UINT_PATTERN.test(value)) {
    return false;
  }
  try {
    return positive ? BigInt(value) > 0n : BigInt(value) >= 0n;
  } catch {
    return false;
  }
}

function validId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function unique(values) {
  return new Set(values).size === values.length;
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function validateCandidate(candidate) {
  const structurallyValid =
    candidate &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    ADDRESS_PATTERN.test(candidate.vault ?? "") &&
    [1, 2].includes(candidate.action) &&
    validUint(candidate.accruedGrowthWei) &&
    validUint(candidate.growthBudgetWei) &&
    validUint(candidate.rollingCapacityWei) &&
    ((candidate.action === 1 &&
      candidate.economicBudgetKind === "compound-cycle") ||
      (candidate.action === 2 &&
        candidate.economicBudgetKind === "oracle-prerequisite")) &&
    validUint(candidate.singleMaxGasDebitWei, { positive: true })
  ;
  if (!structurallyValid) return false;
  try {
    const accrued = BigInt(candidate.accruedGrowthWei);
    const budget = BigInt(candidate.growthBudgetWei);
    const rollingCapacity = BigInt(candidate.rollingCapacityWei);
    return budget <= accrued && budget <= rollingCapacity;
  } catch {
    return false;
  }
}

function validateRequest(request) {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    !HASH_PATTERN.test(request.requestHash ?? "") ||
    !validUint(request.gas, { positive: true }) ||
    !validUint(request.maxFeePerGas, { positive: true }) ||
    !validUint(request.maxPriorityFeePerGas) ||
    !validUint(request.maxGasDebitWei, { positive: true }) ||
    !validUint(request.growthBudgetWei) ||
    !validUint(request.expectedNonce) ||
    request.signerRequestLifetimeMs !==
      DEEP_V3_KEEPER_V2_MAX_SIGNER_REQUEST_LIFETIME_MS.toString()
  ) {
    return false;
  }
  try {
    return (
      BigInt(request.maxPriorityFeePerGas) <=
        BigInt(request.maxFeePerGas) &&
      BigInt(request.maxGasDebitWei) ===
        BigInt(request.gas) * BigInt(request.maxFeePerGas)
    );
  } catch {
    return false;
  }
}

function validatePending(pending, laneIds, partitionIds) {
  if (
    !pending ||
    typeof pending !== "object" ||
    Array.isArray(pending) ||
    !validId(pending.id) ||
    !laneIds.has(pending.laneId) ||
    !partitionIds.has(pending.partitionId) ||
    !safeInteger(pending.slot) ||
    !safeInteger(pending.scanBlockNumber) ||
    !HASH_PATTERN.test(pending.scanBlockHash ?? "") ||
    !safeInteger(pending.scanStartCursor) ||
    !safeInteger(pending.scanEndCursor) ||
    !Array.isArray(pending.candidates) ||
    pending.candidates.length < 1 ||
    pending.candidates.length > 4 ||
    !pending.candidates.every(validateCandidate) ||
    !unique(
      pending.candidates.map(({ vault }) => vault.toLowerCase()),
    ) ||
    !IDEMPOTENCY_PATTERN.test(pending.idempotencyKey ?? "") ||
    !validId(pending.referenceId) ||
    !validateRequest(pending.request) ||
    !(
      pending.transactionHash === null ||
      HASH_PATTERN.test(pending.transactionHash ?? "")
    ) ||
    !(
      pending.transactionId === null ||
      validId(pending.transactionId)
    ) ||
    !(
      pending.nonce === null ||
      validUint(pending.nonce)
    ) ||
    !safeInteger(pending.createdAtMs) ||
    !(
      pending.lastReplayAtMs === null ||
      (safeInteger(pending.lastReplayAtMs) &&
        pending.lastReplayAtMs >= pending.createdAtMs)
    ) ||
    !safeInteger(pending.replayCount) ||
    !safeInteger(pending.budgetDayStartMs) ||
    !["intent", "submitted", "operator"].includes(pending.status)
  ) {
    return false;
  }
  if (
    pending.status === "intent" &&
    (pending.transactionHash !== null ||
      pending.transactionId !== null ||
      pending.nonce !== null)
  ) {
    return false;
  }
  if (
    pending.status === "submitted" &&
    (pending.transactionHash === null ||
      pending.nonce === null)
  ) {
    return false;
  }
  const growth = pending.candidates.reduce(
    (total, candidate) =>
      total + BigInt(candidate.growthBudgetWei),
    0n,
  );
  return growth === BigInt(pending.request.growthBudgetWei);
}

function validateBudgetDay(day) {
  return (
    day &&
    typeof day === "object" &&
    !Array.isArray(day) &&
    safeInteger(day.dayStartMs) &&
    day.dayStartMs % 86_400_000 === 0 &&
    validUint(day.committedMaxDebitWei) &&
    validUint(day.confirmedActualDebitWei) &&
    safeInteger(day.submissionCount)
  );
}

function validateTickBudget(tick) {
  return (
    tick &&
    typeof tick === "object" &&
    !Array.isArray(tick) &&
    safeInteger(tick.slot) &&
    validUint(tick.committedGas) &&
    validUint(tick.committedMaxDebitWei) &&
    safeInteger(tick.submissionCount)
  );
}

function stateBindingMatches(state, config) {
  return (
    state.releaseVersion === config.releaseVersion &&
    state.releaseManifest === config.releaseManifest &&
    state.chainId === config.chainId &&
    sameAddress(state.automationAddress, config.automationAddress) &&
    sameAddress(state.executorAddress, config.executorAddress) &&
    state.sourceCommitment === config.sourceCommitment &&
    state.opsSourceCommitment === config.opsSourceCommitment
  );
}

export function createDeepV3KeeperV2State(config, migration) {
  const lanes = config.signerLanes.map((lane) => ({
    id: lane.id,
    partitionId: lane.partitionId,
    signerAddress: lane.signerAddress,
    pendingBatchIds: [],
    lastObservedConfirmedNonce: null,
    lastObservedPendingNonce: null,
    lastObservedBalanceWei: null,
    balanceAlert: false,
    blockedReason: null,
    lastSubmissionSlot: null,
  }));
  const partitions = config.signerLanes.map((lane) => ({
    id: lane.partitionId,
    laneId: lane.id,
    cursor: migration.importedCursor,
    partitionIndex: lane.partitionIndex,
    partitionCount: lane.partitionCount,
    lastScanBlockNumber: null,
    lastScanBlockHash: null,
    lastScannedAtMs: null,
  }));
  return {
    schemaVersion: DEEP_V3_KEEPER_V2_STATE_SCHEMA_VERSION,
    releaseVersion: config.releaseVersion,
    releaseManifest: config.releaseManifest,
    chainId: config.chainId,
    automationAddress: config.automationAddress,
    executorAddress: config.executorAddress,
    sourceCommitment: config.sourceCommitment,
    opsSourceCommitment: config.opsSourceCommitment,
    migration: {
      sourcePath: DEEP_V3_KEEPER_V2_LEGACY_CONTROL_PATH,
      importedCursor: migration.importedCursor,
      importedGeneration: migration.importedGeneration,
      importedAtMs: migration.importedAtMs,
    },
    partitions,
    lanes,
    pendingBatches: [],
    operatorIncidents: [],
    tickBudgets: [],
    gasBudgetDays: [],
    history: [],
    lastCycleSlot: null,
    lastCycleAtMs: null,
    lastCanonicalBlockNumber: null,
    lastCanonicalBlockHash: null,
    fencingGeneration: null,
  };
}

export function validateDeepV3KeeperV2State(state, config) {
  if (
    state?.schemaVersion !==
      DEEP_V3_KEEPER_V2_STATE_SCHEMA_VERSION ||
    !stateBindingMatches(state, config) ||
    !state.migration ||
    state.migration.sourcePath !==
      DEEP_V3_KEEPER_V2_LEGACY_CONTROL_PATH ||
    !safeInteger(state.migration.importedCursor) ||
    !safeInteger(state.migration.importedGeneration) ||
    !safeInteger(state.migration.importedAtMs) ||
    !Array.isArray(state.partitions) ||
    !Array.isArray(state.lanes) ||
    state.partitions.length !== config.signerLanes.length ||
    state.lanes.length !== config.signerLanes.length ||
    !Array.isArray(state.pendingBatches) ||
    state.pendingBatches.length > config.maxActivePendingBatches ||
    !Array.isArray(state.operatorIncidents) ||
    state.operatorIncidents.length > config.maxOperatorIncidents ||
    !Array.isArray(state.gasBudgetDays) ||
    state.gasBudgetDays.length > MAX_BUDGET_DAYS ||
    !state.gasBudgetDays.every(validateBudgetDay) ||
    !Array.isArray(state.tickBudgets) ||
    state.tickBudgets.length > MAX_TICK_BUDGETS ||
    !state.tickBudgets.every(validateTickBudget) ||
    !Array.isArray(state.history) ||
    state.history.length > config.maxHistoryEntries ||
    !nullableInteger(state.lastCycleSlot) ||
    !nullableInteger(state.lastCycleAtMs) ||
    !nullableInteger(state.lastCanonicalBlockNumber) ||
    !(
      state.lastCanonicalBlockHash === null ||
      HASH_PATTERN.test(state.lastCanonicalBlockHash ?? "")
    ) ||
    !(
      state.fencingGeneration === null ||
      (safeInteger(state.fencingGeneration) &&
        state.fencingGeneration > 0)
    )
  ) {
    fail("INVALID_STATE", "Deep V3 keeper v2 state is invalid");
  }

  const laneIds = new Set(state.lanes.map(({ id }) => id));
  const partitionIds = new Set(
    state.partitions.map(({ id }) => id),
  );
  if (
    !unique([...laneIds]) ||
    !unique([...partitionIds]) ||
    !unique(state.pendingBatches.map(({ id }) => id))
  ) {
    fail("INVALID_STATE", "Keeper state identifiers are not unique");
  }
  for (const configured of config.signerLanes) {
    const lane = state.lanes.find(({ id }) => id === configured.id);
    const partition = state.partitions.find(
      ({ id }) => id === configured.partitionId,
    );
    if (
      !lane ||
      !partition ||
      lane.partitionId !== configured.partitionId ||
      !sameAddress(lane.signerAddress, configured.signerAddress) ||
      partition.laneId !== configured.id ||
      partition.partitionIndex !== configured.partitionIndex ||
      partition.partitionCount !== configured.partitionCount ||
      !safeInteger(partition.cursor) ||
      !nullableInteger(partition.lastScanBlockNumber) ||
      !(
        partition.lastScanBlockHash === null ||
        HASH_PATTERN.test(partition.lastScanBlockHash ?? "")
      ) ||
      !nullableInteger(partition.lastScannedAtMs) ||
      !Array.isArray(lane.pendingBatchIds) ||
      !unique(lane.pendingBatchIds) ||
      !lane.pendingBatchIds.every(validId) ||
      !(
        lane.lastObservedConfirmedNonce === null ||
        validUint(lane.lastObservedConfirmedNonce)
      ) ||
      !(
        lane.lastObservedPendingNonce === null ||
        validUint(lane.lastObservedPendingNonce)
      ) ||
      !(
        lane.lastObservedBalanceWei === null ||
        validUint(lane.lastObservedBalanceWei)
      ) ||
      typeof lane.balanceAlert !== "boolean" ||
      !(
        lane.blockedReason === null ||
        validId(lane.blockedReason)
      ) ||
      !nullableInteger(lane.lastSubmissionSlot)
    ) {
      fail("INVALID_STATE", "Keeper lane or partition is invalid");
    }
  }

  for (const pending of state.pendingBatches) {
    if (!validatePending(pending, laneIds, partitionIds)) {
      fail("INVALID_STATE", "Pending batch state is invalid");
    }
  }
  const allActiveVaults = state.pendingBatches.flatMap((pending) =>
    pending.candidates.map(({ vault }) => vault.toLowerCase()),
  );
  if (!unique(allActiveVaults)) {
    fail(
      "INVALID_STATE",
      "A duplicate active vault exists across pending batches",
    );
  }
  for (const lane of state.lanes) {
    const expected = state.pendingBatches
      .filter(({ laneId }) => laneId === lane.id)
      .map(({ id }) => id);
    if (
      expected.length > 1 ||
      expected.length !== lane.pendingBatchIds.length ||
      expected.some((id) => !lane.pendingBatchIds.includes(id))
    ) {
      fail(
        "INVALID_STATE",
        "A signer lane may have exactly one active batch",
      );
    }
  }
  for (const incident of state.operatorIncidents) {
    if (
      !incident ||
      typeof incident !== "object" ||
      Array.isArray(incident) ||
      !validId(incident.id) ||
      !validId(incident.batchId) ||
      !laneIds.has(incident.laneId) ||
      !validId(incident.reason) ||
      !safeInteger(incident.enteredAtMs) ||
      !state.pendingBatches.some(
        ({ id, status }) =>
          id === incident.batchId && status === "operator",
      )
    ) {
      fail("INVALID_STATE", "Operator incident is invalid");
    }
  }
  if (!unique(state.operatorIncidents.map(({ id }) => id))) {
    fail("INVALID_STATE", "Operator incident IDs are not unique");
  }
  if (
    !unique(state.gasBudgetDays.map(({ dayStartMs }) => dayStartMs))
  ) {
    fail("INVALID_STATE", "Gas budget days are duplicated");
  }
  if (!unique(state.tickBudgets.map(({ slot }) => slot))) {
    fail("INVALID_STATE", "Tick budgets are duplicated");
  }
  return state;
}

export function inspectDeepV3LegacyControl(value, nowMs) {
  validNow(nowMs);
  if (value === null) {
    return { importedCursor: 0, importedGeneration: 0 };
  }
  let legacy;
  try {
    legacy = JSON.parse(value);
  } catch {
    fail("LEGACY_STATE_INVALID", "Legacy keeper state is not JSON");
  }
  if (
    legacy?.schemaVersion !== 1 ||
    !safeInteger(legacy.generation) ||
    legacy.generation < 1 ||
    !safeInteger(legacy.expiresAtMs) ||
    !legacy.state ||
    legacy.state.schemaVersion !== 1 ||
    !safeInteger(legacy.state.cursor)
  ) {
    fail("LEGACY_STATE_INVALID", "Legacy keeper state is invalid");
  }
  if (legacy.expiresAtMs > nowMs) {
    fail("LEGACY_WRITER_ACTIVE", "Legacy keeper lease is active");
  }
  if (legacy.state.pending !== null) {
    fail(
      "LEGACY_PENDING",
      "Legacy keeper has a pending transaction",
    );
  }
  if (legacy.state.operatorActionRequired !== null) {
    fail(
      "LEGACY_OPERATOR_ACTION",
      "Legacy keeper requires operator action",
    );
  }
  return {
    importedCursor: legacy.state.cursor,
    importedGeneration: legacy.generation,
  };
}

export function inspectStableDeepV3LegacyControl(
  before,
  after,
  nowMs,
) {
  const unchanged =
    (before === null && after === null) ||
    (before !== null &&
      after !== null &&
      before.etag === after.etag &&
      before.value === after.value);
  if (!unchanged) {
    fail(
      "LEGACY_STATE_CHANGED",
      "Legacy keeper state changed during the ops v2 cutover",
    );
  }
  return inspectDeepV3LegacyControl(after?.value ?? null, nowMs);
}

function serializeControl(record) {
  return JSON.stringify({
    schemaVersion: 2,
    ownerId: record.ownerId,
    generation: record.generation,
    fencingToken: record.fencingToken,
    acquiredAtMs: record.acquiredAtMs,
    expiresAtMs: record.expiresAtMs,
    state: record.state,
  });
}

function parseControl(value) {
  let record;
  try {
    record = JSON.parse(value);
  } catch {
    fail("INVALID_CONTROL", "Keeper control is not JSON");
  }
  if (
    record?.schemaVersion !== 2 ||
    !validId(record.ownerId) ||
    !safeInteger(record.generation) ||
    record.generation < 1 ||
    !validId(record.fencingToken) ||
    !safeInteger(record.acquiredAtMs) ||
    !safeInteger(record.expiresAtMs) ||
    record.expiresAtMs < record.acquiredAtMs ||
    !(
      record.state === null ||
      (typeof record.state === "object" &&
        !Array.isArray(record.state))
    )
  ) {
    fail("INVALID_CONTROL", "Keeper control schema is invalid");
  }
  return record;
}

export async function acquireDeepV3KeeperV2Control({
  store,
  nowMs,
  ownerId = randomUUID(),
  durationMs = DEEP_V3_KEEPER_V2_LEASE_DURATION_MS,
  createFencingToken = randomUUID,
}) {
  validNow(nowMs);
  if (
    !validId(ownerId) ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0
  ) {
    fail("INVALID_CONTROL", "Keeper lease parameters are invalid");
  }
  const current = await store.read(DEEP_V3_KEEPER_V2_CONTROL_PATH);
  if (current === null) {
    const record = {
      ownerId,
      generation: 1,
      fencingToken: createFencingToken(),
      acquiredAtMs: nowMs,
      expiresAtMs: nowMs + durationMs,
      state: null,
    };
    const created = await store.putIfAbsent(
      DEEP_V3_KEEPER_V2_CONTROL_PATH,
      serializeControl(record),
    );
    return created ? { ...record, etag: created.etag } : null;
  }
  const parsed = parseControl(current.value);
  if (parsed.expiresAtMs > nowMs) return null;
  const record = {
    ownerId,
    generation: parsed.generation + 1,
    fencingToken: createFencingToken(),
    acquiredAtMs: nowMs,
    expiresAtMs: nowMs + durationMs,
    state: parsed.state,
  };
  const replaced = await store.putIfMatch(
    DEEP_V3_KEEPER_V2_CONTROL_PATH,
    serializeControl(record),
    current.etag,
  );
  return replaced ? { ...record, etag: replaced.etag } : null;
}

export async function assertDeepV3KeeperV2Control({
  store,
  control,
  nowMs,
}) {
  validNow(nowMs);
  const current = await store.read(DEEP_V3_KEEPER_V2_CONTROL_PATH);
  if (!current) return false;
  const parsed = parseControl(current.value);
  return (
    current.etag === control.etag &&
    parsed.ownerId === control.ownerId &&
    parsed.generation === control.generation &&
    parsed.fencingToken === control.fencingToken &&
    parsed.expiresAtMs > nowMs
  );
}

export async function writeDeepV3KeeperV2State({
  store,
  control,
  state,
  config,
  nowMs,
}) {
  validNow(nowMs);
  validateDeepV3KeeperV2State(state, config);
  const timestamps = [
    state.migration.importedAtMs,
    state.lastCycleAtMs,
    ...state.partitions.map(({ lastScannedAtMs }) => lastScannedAtMs),
    ...state.pendingBatches.flatMap(
      ({ createdAtMs, lastReplayAtMs }) => [
        createdAtMs,
        lastReplayAtMs,
      ],
    ),
    ...state.operatorIncidents.map(({ enteredAtMs }) => enteredAtMs),
  ].filter((value) => value !== null);
  if (timestamps.some((value) => value > nowMs)) {
    fail("CLOCK_REGRESSION", "Keeper state contains a future timestamp");
  }
  const next = {
    ownerId: control.ownerId,
    generation: control.generation,
    fencingToken: control.fencingToken,
    acquiredAtMs: control.acquiredAtMs,
    expiresAtMs: control.expiresAtMs,
    state,
  };
  const replaced = await store.putIfMatch(
    DEEP_V3_KEEPER_V2_CONTROL_PATH,
    serializeControl(next),
    control.etag,
  );
  if (!replaced) return false;
  control.etag = replaced.etag;
  control.state = state;
  return true;
}

export async function releaseDeepV3KeeperV2Control({
  store,
  control,
  nowMs,
}) {
  validNow(nowMs);
  const next = {
    ownerId: control.ownerId,
    generation: control.generation,
    fencingToken: control.fencingToken,
    acquiredAtMs: control.acquiredAtMs,
    expiresAtMs: nowMs,
    state: control.state,
  };
  const replaced = await store.putIfMatch(
    DEEP_V3_KEEPER_V2_CONTROL_PATH,
    serializeControl(next),
    control.etag,
  );
  return replaced !== null;
}
