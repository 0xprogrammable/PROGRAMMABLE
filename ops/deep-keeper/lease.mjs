import { randomUUID } from "node:crypto";

export const DEEP_KEEPER_LEASE_PATH = "ops/deep-keeper/lease-v1.json";
// The Vercel route is capped at 60 seconds. Leave a margin so a timed-out
// invocation cannot overlap with a successor, while a crashed one recovers.
export const DEEP_KEEPER_LEASE_DURATION_MS = 90_000;

export class DeepKeeperLeaseError extends Error {
  constructor(message) {
    super(message);
    this.name = "DeepKeeperLeaseError";
  }
}

function validNow(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new DeepKeeperLeaseError("Lease clock must be a non-negative integer");
  }
}

function validOwner(ownerId) {
  if (typeof ownerId !== "string" || ownerId.length === 0 || ownerId.length > 200) {
    throw new DeepKeeperLeaseError("Lease owner must be a non-empty identifier");
  }
}

function serializeLease({ ownerId, acquiredAtMs, expiresAtMs }) {
  return JSON.stringify({
    schemaVersion: 1,
    ownerId,
    acquiredAtMs,
    expiresAtMs,
  });
}

function parseLease(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new DeepKeeperLeaseError("Keeper lease is not valid JSON");
  }
  if (
    parsed?.schemaVersion !== 1 ||
    typeof parsed.ownerId !== "string" ||
    parsed.ownerId.length === 0 ||
    !Number.isSafeInteger(parsed.acquiredAtMs) ||
    !Number.isSafeInteger(parsed.expiresAtMs) ||
    parsed.acquiredAtMs < 0 ||
    parsed.expiresAtMs < parsed.acquiredAtMs
  ) {
    throw new DeepKeeperLeaseError("Keeper lease has an invalid schema");
  }
  return parsed;
}

function nextLease(ownerId, nowMs, durationMs) {
  return {
    ownerId,
    acquiredAtMs: nowMs,
    expiresAtMs: nowMs + durationMs,
  };
}

/**
 * Acquires the one shared keeper lease. The storage adapter must provide
 * atomic create-only and ETag-conditional writes; a null result means its
 * condition was not met.
 */
export async function acquireDeepKeeperLease({
  store,
  nowMs,
  ownerId = randomUUID(),
  durationMs = DEEP_KEEPER_LEASE_DURATION_MS,
}) {
  validNow(nowMs);
  validOwner(ownerId);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new DeepKeeperLeaseError("Lease duration must be a positive integer");
  }

  const next = nextLease(ownerId, nowMs, durationMs);
  const value = serializeLease(next);

  // A lost create/takeover race is normal. Retry only to observe the winner;
  // never proceed without an ETag-proven ownership record.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const created = await store.putIfAbsent(DEEP_KEEPER_LEASE_PATH, value);
    if (created) return { ...next, etag: created.etag };

    const current = await store.read(DEEP_KEEPER_LEASE_PATH);
    if (!current) continue;
    const record = parseLease(current.value);
    if (record.expiresAtMs > nowMs) return null;

    const recovered = await store.putIfMatch(
      DEEP_KEEPER_LEASE_PATH,
      value,
      current.etag,
    );
    if (recovered) return { ...next, etag: recovered.etag };
  }

  return null;
}

/**
 * Releases by conditionally expiring the same record. Leaving the object in
 * place avoids an unsafe delete race with a successor that recovered a stale
 * lease; the next owner atomically replaces only an expired ETag.
 */
export async function releaseDeepKeeperLease({ store, lease, nowMs }) {
  validNow(nowMs);
  if (
    !lease ||
    typeof lease.ownerId !== "string" ||
    typeof lease.etag !== "string" ||
    !Number.isSafeInteger(lease.acquiredAtMs)
  ) {
    throw new DeepKeeperLeaseError("Lease release requires acquired ownership");
  }
  const released = {
    ownerId: lease.ownerId,
    acquiredAtMs: lease.acquiredAtMs,
    expiresAtMs: nowMs,
  };
  const updated = await store.putIfMatch(
    DEEP_KEEPER_LEASE_PATH,
    serializeLease(released),
    lease.etag,
  );
  return updated !== null;
}
