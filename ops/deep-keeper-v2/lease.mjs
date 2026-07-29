import { randomUUID } from "node:crypto";

export const DEEP_V2_KEEPER_LEASE_PATH =
  "ops/deep-keeper-v2/lease-v1.json";
export const DEEP_V2_KEEPER_LEASE_DURATION_MS = 90_000;

export class DeepV2KeeperLeaseError extends Error {
  constructor(message) {
    super(message);
    this.name = "DeepV2KeeperLeaseError";
  }
}

function validNow(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new DeepV2KeeperLeaseError(
      "Lease clock must be a non-negative integer",
    );
  }
}

function validOwner(ownerId) {
  if (
    typeof ownerId !== "string" ||
    ownerId.length === 0 ||
    ownerId.length > 200
  ) {
    throw new DeepV2KeeperLeaseError(
      "Lease owner must be a non-empty identifier",
    );
  }
}

function validFencingToken(token) {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 200
  ) {
    throw new DeepV2KeeperLeaseError(
      "Fencing token must be a non-empty identifier",
    );
  }
}

function serializeLease(record) {
  return JSON.stringify({
    schemaVersion: 2,
    ownerId: record.ownerId,
    generation: record.generation,
    fencingToken: record.fencingToken,
    acquiredAtMs: record.acquiredAtMs,
    expiresAtMs: record.expiresAtMs,
    boundaryState: record.boundaryState ?? null,
  });
}

function parseLease(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new DeepV2KeeperLeaseError("Keeper lease is not valid JSON");
  }
  if (
    parsed?.schemaVersion !== 2 ||
    typeof parsed.ownerId !== "string" ||
    parsed.ownerId.length === 0 ||
    !Number.isSafeInteger(parsed.generation) ||
    parsed.generation < 1 ||
    typeof parsed.fencingToken !== "string" ||
    parsed.fencingToken.length === 0 ||
    !Number.isSafeInteger(parsed.acquiredAtMs) ||
    !Number.isSafeInteger(parsed.expiresAtMs) ||
    parsed.acquiredAtMs < 0 ||
    parsed.expiresAtMs < parsed.acquiredAtMs ||
    !(
      parsed.boundaryState === null ||
      (typeof parsed.boundaryState === "object" &&
        !Array.isArray(parsed.boundaryState))
    )
  ) {
    throw new DeepV2KeeperLeaseError("Keeper lease has an invalid schema");
  }
  return parsed;
}

function nextLease({
  ownerId,
  generation,
  fencingToken,
  nowMs,
  durationMs,
  boundaryState,
}) {
  return {
    ownerId,
    generation,
    fencingToken,
    acquiredAtMs: nowMs,
    expiresAtMs: nowMs + durationMs,
    boundaryState: boundaryState ?? null,
  };
}

/**
 * Acquires a single process lease and assigns a monotonically increasing
 * generation. The opaque token and generation form the fence checked before
 * every durable write and signer call.
 */
export async function acquireDeepV2KeeperLease({
  store,
  nowMs,
  ownerId = randomUUID(),
  durationMs = DEEP_V2_KEEPER_LEASE_DURATION_MS,
  createFencingToken = randomUUID,
}) {
  validNow(nowMs);
  validOwner(ownerId);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new DeepV2KeeperLeaseError(
      "Lease duration must be a positive integer",
    );
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const initialToken = createFencingToken();
    validFencingToken(initialToken);
    const initial = nextLease({
      ownerId,
      generation: 1,
      fencingToken: initialToken,
      nowMs,
      durationMs,
      boundaryState: null,
    });
    const created = await store.putIfAbsent(
      DEEP_V2_KEEPER_LEASE_PATH,
      serializeLease(initial),
    );
    if (created) return { ...initial, etag: created.etag };

    const current = await store.read(DEEP_V2_KEEPER_LEASE_PATH);
    if (!current) continue;
    const record = parseLease(current.value);
    if (record.expiresAtMs > nowMs) return null;
    if (record.generation >= Number.MAX_SAFE_INTEGER) {
      throw new DeepV2KeeperLeaseError(
        "Lease fencing generation is exhausted",
      );
    }

    const takeoverToken = createFencingToken();
    validFencingToken(takeoverToken);
    const takeover = nextLease({
      ownerId,
      generation: record.generation + 1,
      fencingToken: takeoverToken,
      nowMs,
      durationMs,
      boundaryState: record.boundaryState,
    });
    const recovered = await store.putIfMatch(
      DEEP_V2_KEEPER_LEASE_PATH,
      serializeLease(takeover),
      current.etag,
    );
    if (recovered) return { ...takeover, etag: recovered.etag };
  }

  return null;
}

/**
 * Atomically advances the same control record that owns the lease. Keeping
 * state and ownership under one ETag removes the cross-object assertion/write
 * race that a separate state blob would introduce.
 */
export async function writeDeepV2KeeperLeaseState({
  store,
  lease,
  boundaryState,
  nowMs,
}) {
  validNow(nowMs);
  if (
    !lease ||
    typeof lease.ownerId !== "string" ||
    typeof lease.etag !== "string" ||
    !Number.isSafeInteger(lease.generation) ||
    typeof lease.fencingToken !== "string" ||
    !Number.isSafeInteger(lease.acquiredAtMs) ||
    !Number.isSafeInteger(lease.expiresAtMs)
  ) {
    throw new DeepV2KeeperLeaseError(
      "State write requires acquired ownership",
    );
  }
  if (
    !boundaryState ||
    typeof boundaryState !== "object" ||
    Array.isArray(boundaryState) ||
    boundaryState.fencingGeneration !== lease.generation
  ) {
    throw new DeepV2KeeperLeaseError(
      "State does not match the active fencing generation",
    );
  }
  if (lease.expiresAtMs <= nowMs) return null;

  const updatedRecord = {
    ownerId: lease.ownerId,
    generation: lease.generation,
    fencingToken: lease.fencingToken,
    acquiredAtMs: lease.acquiredAtMs,
    expiresAtMs: lease.expiresAtMs,
    boundaryState,
  };
  const updated = await store.putIfMatch(
    DEEP_V2_KEEPER_LEASE_PATH,
    serializeLease(updatedRecord),
    lease.etag,
  );
  if (!updated) return null;
  lease.etag = updated.etag;
  lease.boundaryState = boundaryState;
  return { etag: updated.etag };
}

/**
 * Verifies that the storage record still contains the exact ETag, generation,
 * token and owner acquired by this invocation and has not expired.
 */
export async function assertDeepV2KeeperLease({ store, lease, nowMs }) {
  validNow(nowMs);
  if (
    !lease ||
    typeof lease.ownerId !== "string" ||
    typeof lease.etag !== "string" ||
    !Number.isSafeInteger(lease.generation) ||
    typeof lease.fencingToken !== "string"
  ) {
    throw new DeepV2KeeperLeaseError(
      "Lease assertion requires acquired ownership",
    );
  }
  const current = await store.read(DEEP_V2_KEEPER_LEASE_PATH);
  if (!current || current.etag !== lease.etag) return false;
  const record = parseLease(current.value);
  return (
    record.ownerId === lease.ownerId &&
    record.generation === lease.generation &&
    record.fencingToken === lease.fencingToken &&
    record.acquiredAtMs === lease.acquiredAtMs &&
    record.expiresAtMs === lease.expiresAtMs &&
    record.expiresAtMs > nowMs
  );
}

export async function releaseDeepV2KeeperLease({ store, lease, nowMs }) {
  validNow(nowMs);
  if (
    !lease ||
    typeof lease.ownerId !== "string" ||
    typeof lease.etag !== "string" ||
    !Number.isSafeInteger(lease.generation) ||
    typeof lease.fencingToken !== "string" ||
    !Number.isSafeInteger(lease.acquiredAtMs)
  ) {
    throw new DeepV2KeeperLeaseError(
      "Lease release requires acquired ownership",
    );
  }
  const released = {
    ownerId: lease.ownerId,
    generation: lease.generation,
    fencingToken: lease.fencingToken,
    acquiredAtMs: lease.acquiredAtMs,
    expiresAtMs: nowMs,
    boundaryState: lease.boundaryState ?? null,
  };
  const updated = await store.putIfMatch(
    DEEP_V2_KEEPER_LEASE_PATH,
    serializeLease(released),
    lease.etag,
  );
  return updated !== null;
}
