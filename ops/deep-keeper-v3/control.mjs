import { randomUUID } from "node:crypto";

export const DEEP_V3_KEEPER_CONTROL_PATH =
  "ops/deep-keeper-v3/control-v1.json";
export const DEEP_V3_KEEPER_LEASE_DURATION_MS = 90_000;
export const DEEP_V3_KEEPER_STATE_SCHEMA_VERSION = 1;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export class DeepV3KeeperControlError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeepV3KeeperControlError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DeepV3KeeperControlError(code, message);
}

function validNow(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    fail("INVALID_CLOCK", "Keeper clock must be a non-negative integer");
  }
}

function validText(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200
  ) {
    fail("INVALID_CONTROL", `${label} is invalid`);
  }
}

function optionalInteger(value) {
  return (
    value === null ||
    (Number.isSafeInteger(value) && value >= 0)
  );
}

function validatePending(pending) {
  if (pending === null) return;
  const envelopeValues = [
    pending.gas,
    pending.maxFeePerGas,
    pending.maxPriorityFeePerGas,
  ];
  const envelopeUnset = envelopeValues.every((value) => value === null);
  let envelopeValid = false;
  if (
    envelopeValues.every(
      (value) =>
        typeof value === "string" && /^[0-9]+$/.test(value),
    )
  ) {
    try {
      const gas = BigInt(pending.gas);
      const maxFee = BigInt(pending.maxFeePerGas);
      const priority = BigInt(pending.maxPriorityFeePerGas);
      envelopeValid =
        gas > 0n &&
        maxFee > 0n &&
        priority >= 0n &&
        priority <= maxFee;
    } catch {
      envelopeValid = false;
    }
  }
  if (
    !pending ||
    typeof pending !== "object" ||
    Array.isArray(pending) ||
    !ADDRESS_PATTERN.test(pending.vault ?? "") ||
    ![1, 2].includes(pending.action) ||
    !Number.isSafeInteger(pending.slot) ||
    pending.slot < 0 ||
    !Number.isSafeInteger(pending.cursor) ||
    pending.cursor < 0 ||
    typeof pending.idempotencyKey !== "string" ||
    !/^deep-[0-9a-f]{32}$/.test(pending.idempotencyKey) ||
    !(pending.transactionHash === null || HASH_PATTERN.test(pending.transactionHash)) ||
    !Number.isSafeInteger(pending.createdAtMs) ||
    pending.createdAtMs < 0 ||
    !(
      pending.lastReplayAtMs === null ||
      (Number.isSafeInteger(pending.lastReplayAtMs) &&
        pending.lastReplayAtMs >= pending.createdAtMs)
    ) ||
    !Number.isSafeInteger(pending.replayCount) ||
    pending.replayCount < 0 ||
    !(envelopeUnset || envelopeValid) ||
    (pending.transactionHash !== null && !envelopeValid)
  ) {
    fail("INVALID_STATE", "Pending transaction state is invalid");
  }
}

function validateOperatorAction(operatorActionRequired, pending) {
  if (operatorActionRequired === null) return;
  const validReasons = [
    "transaction-absent-after-privy-idempotency-window",
    "unresolved-transaction-after-privy-idempotency-window",
    "submission-intent-after-privy-idempotency-window",
    "privy-idempotency-hash-mismatch",
  ];
  if (
    !operatorActionRequired ||
    typeof operatorActionRequired !== "object" ||
    Array.isArray(operatorActionRequired) ||
    !validReasons.includes(operatorActionRequired.reason) ||
    !(
      operatorActionRequired.transactionHash === null ||
      HASH_PATTERN.test(operatorActionRequired.transactionHash ?? "")
    ) ||
    !ADDRESS_PATTERN.test(operatorActionRequired.vault ?? "") ||
    ![1, 2].includes(operatorActionRequired.action) ||
    !Number.isSafeInteger(operatorActionRequired.enteredAtMs) ||
    operatorActionRequired.enteredAtMs < 0 ||
    pending === null ||
    operatorActionRequired.transactionHash?.toLowerCase() !==
      pending.transactionHash?.toLowerCase() ||
    operatorActionRequired.vault.toLowerCase() !==
      pending.vault.toLowerCase() ||
    operatorActionRequired.action !== pending.action
  ) {
    fail("INVALID_STATE", "Operator recovery state is invalid");
  }
}

export function createDeepV3KeeperState(config) {
  return {
    schemaVersion: DEEP_V3_KEEPER_STATE_SCHEMA_VERSION,
    releaseManifest: config.releaseManifest,
    chainId: config.chainId,
    automationAddress: config.automationAddress,
    executorAddress: config.executorAddress,
    sourceCommitment: config.sourceCommitment,
    cursor: 0,
    lastCompletedSlot: null,
    lastCompletedAtMs: null,
    lastCompletedBlockNumber: null,
    lastCompletedBlockHash: null,
    pending: null,
    operatorActionRequired: null,
    fencingGeneration: null,
  };
}

export function validateDeepV3KeeperState(state, config) {
  if (
    state?.schemaVersion !== DEEP_V3_KEEPER_STATE_SCHEMA_VERSION ||
    state.releaseManifest !== config.releaseManifest ||
    state.chainId !== config.chainId ||
    state.automationAddress?.toLowerCase() !==
      config.automationAddress.toLowerCase() ||
    state.executorAddress?.toLowerCase() !==
      config.executorAddress.toLowerCase() ||
    state.sourceCommitment !== config.sourceCommitment ||
    !Number.isSafeInteger(state.cursor) ||
    state.cursor < 0 ||
    !optionalInteger(state.lastCompletedSlot) ||
    !optionalInteger(state.lastCompletedAtMs) ||
    !optionalInteger(state.lastCompletedBlockNumber) ||
    !(
      state.lastCompletedBlockHash === null ||
      HASH_PATTERN.test(state.lastCompletedBlockHash)
    ) ||
    !(
      state.fencingGeneration === null ||
      (Number.isSafeInteger(state.fencingGeneration) &&
        state.fencingGeneration > 0)
    ) ||
    ((state.lastCompletedSlot === null) !==
      (state.lastCompletedAtMs === null)) ||
    ((state.lastCompletedBlockNumber === null) !==
      (state.lastCompletedBlockHash === null))
  ) {
    fail("INVALID_STATE", "Deep V3 keeper state is invalid");
  }
  validatePending(state.pending);
  validateOperatorAction(state.operatorActionRequired, state.pending);
  return state;
}

function serialize(record) {
  return JSON.stringify({
    schemaVersion: 1,
    ownerId: record.ownerId,
    generation: record.generation,
    fencingToken: record.fencingToken,
    acquiredAtMs: record.acquiredAtMs,
    expiresAtMs: record.expiresAtMs,
    state: record.state,
  });
}

function parse(value) {
  let record;
  try {
    record = JSON.parse(value);
  } catch {
    fail("INVALID_CONTROL", "Keeper control blob is not valid JSON");
  }
  if (
    record?.schemaVersion !== 1 ||
    typeof record.ownerId !== "string" ||
    record.ownerId.length === 0 ||
    !Number.isSafeInteger(record.generation) ||
    record.generation < 1 ||
    typeof record.fencingToken !== "string" ||
    record.fencingToken.length === 0 ||
    !Number.isSafeInteger(record.acquiredAtMs) ||
    !Number.isSafeInteger(record.expiresAtMs) ||
    record.acquiredAtMs < 0 ||
    record.expiresAtMs < record.acquiredAtMs ||
    !(
      record.state === null ||
      (typeof record.state === "object" &&
        !Array.isArray(record.state))
    )
  ) {
    fail("INVALID_CONTROL", "Keeper control blob has an invalid schema");
  }
  return record;
}

function nextRecord({
  ownerId,
  generation,
  fencingToken,
  nowMs,
  durationMs,
  state,
}) {
  return {
    ownerId,
    generation,
    fencingToken,
    acquiredAtMs: nowMs,
    expiresAtMs: nowMs + durationMs,
    state,
  };
}

export async function acquireDeepV3KeeperControl({
  store,
  nowMs,
  ownerId = randomUUID(),
  durationMs = DEEP_V3_KEEPER_LEASE_DURATION_MS,
  createFencingToken = randomUUID,
}) {
  validNow(nowMs);
  validText(ownerId, "owner");
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    fail("INVALID_CONTROL", "Lease duration is invalid");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const initial = nextRecord({
      ownerId,
      generation: 1,
      fencingToken: createFencingToken(),
      nowMs,
      durationMs,
      state: null,
    });
    validText(initial.fencingToken, "fencing token");
    const created = await store.putIfAbsent(
      DEEP_V3_KEEPER_CONTROL_PATH,
      serialize(initial),
    );
    if (created) return { ...initial, etag: created.etag };

    const current = await store.read(DEEP_V3_KEEPER_CONTROL_PATH);
    if (!current) continue;
    const previous = parse(current.value);
    if (previous.expiresAtMs > nowMs) return null;
    if (previous.generation >= Number.MAX_SAFE_INTEGER) {
      fail("FENCE_EXHAUSTED", "Keeper fencing generation is exhausted");
    }
    const takeover = nextRecord({
      ownerId,
      generation: previous.generation + 1,
      fencingToken: createFencingToken(),
      nowMs,
      durationMs,
      state: previous.state,
    });
    validText(takeover.fencingToken, "fencing token");
    const updated = await store.putIfMatch(
      DEEP_V3_KEEPER_CONTROL_PATH,
      serialize(takeover),
      current.etag,
    );
    if (updated) return { ...takeover, etag: updated.etag };
  }
  return null;
}

export async function assertDeepV3KeeperControl({
  store,
  control,
  nowMs,
}) {
  validNow(nowMs);
  if (
    !control ||
    typeof control.etag !== "string" ||
    typeof control.ownerId !== "string" ||
    !Number.isSafeInteger(control.generation) ||
    typeof control.fencingToken !== "string"
  ) {
    fail("INVALID_CONTROL", "Control assertion requires ownership");
  }
  const current = await store.read(DEEP_V3_KEEPER_CONTROL_PATH);
  if (!current || current.etag !== control.etag) return false;
  const record = parse(current.value);
  return (
    record.ownerId === control.ownerId &&
    record.generation === control.generation &&
    record.fencingToken === control.fencingToken &&
    record.acquiredAtMs === control.acquiredAtMs &&
    record.expiresAtMs === control.expiresAtMs &&
    record.expiresAtMs > nowMs
  );
}

export async function writeDeepV3KeeperState({
  store,
  control,
  state,
  config,
  nowMs,
}) {
  validNow(nowMs);
  validateDeepV3KeeperState(state, config);
  if (
    [
      state.lastCompletedAtMs,
      state.pending?.createdAtMs,
      state.pending?.lastReplayAtMs,
      state.operatorActionRequired?.enteredAtMs,
    ].some((value) => value !== null && value !== undefined && value > nowMs)
  ) {
    fail("INVALID_CLOCK", "Keeper state contains a future timestamp");
  }
  if (
    state.fencingGeneration !== control.generation ||
    control.expiresAtMs <= nowMs
  ) {
    fail("LEASE_FENCE_LOST", "State does not own the active fence");
  }
  const next = {
    ownerId: control.ownerId,
    generation: control.generation,
    fencingToken: control.fencingToken,
    acquiredAtMs: control.acquiredAtMs,
    expiresAtMs: control.expiresAtMs,
    state,
  };
  const updated = await store.putIfMatch(
    DEEP_V3_KEEPER_CONTROL_PATH,
    serialize(next),
    control.etag,
  );
  if (!updated) return false;
  control.etag = updated.etag;
  control.state = state;
  return true;
}

export async function releaseDeepV3KeeperControl({
  store,
  control,
  nowMs,
}) {
  validNow(nowMs);
  const released = {
    ownerId: control.ownerId,
    generation: control.generation,
    fencingToken: control.fencingToken,
    acquiredAtMs: control.acquiredAtMs,
    expiresAtMs: nowMs,
    state: control.state,
  };
  const updated = await store.putIfMatch(
    DEEP_V3_KEEPER_CONTROL_PATH,
    serialize(released),
    control.etag,
  );
  return updated !== null;
}
