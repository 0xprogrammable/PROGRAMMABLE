import {
  DEEP_V2_KEEPER_LEASE_PATH,
  writeDeepV2KeeperLeaseState,
} from "./lease.mjs";

export const DEEP_V2_KEEPER_STATE_PATH = DEEP_V2_KEEPER_LEASE_PATH;

export class DeepV2KeeperStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeepV2KeeperStateError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DeepV2KeeperStateError(code, message);
}

/**
 * Creates one CAS writer bound to a specific lease generation. A stale process
 * cannot write after takeover even if it retained a previous state ETag.
 */
export function createDeepV2StateWriter({
  store,
  lease,
  assertLease,
  now = Date.now,
}) {
  if (
    !lease ||
    !Number.isSafeInteger(lease.generation) ||
    lease.generation < 1 ||
    typeof lease.fencingToken !== "string" ||
    typeof assertLease !== "function"
  ) {
    fail(
      "INVALID_FENCE",
      "Deep V2 state writer requires an acquired fenced lease",
    );
  }
  if (typeof now !== "function") {
    fail("INVALID_CLOCK", "Deep V2 state writer clock is invalid");
  }

  return Object.freeze({
    get etag() {
      return lease.etag;
    },
    async write(state) {
      if (state?.fencingGeneration !== lease.generation) {
        fail(
          "FENCING_GENERATION_MISMATCH",
          "Deep V2 state does not match the active lease generation",
        );
      }
      if ((await assertLease(lease)) !== true) {
        fail(
          "LEASE_FENCE_LOST",
          "Deep V2 state write lost lease ownership",
        );
      }

      const result = await writeDeepV2KeeperLeaseState({
        store,
        lease,
        boundaryState: state,
        nowMs: now(),
      });
      if (!result) return false;
      return true;
    },
  });
}
