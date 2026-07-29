import {
  createInitialState,
  runKeeperCycle,
  validateState,
} from "../deep-keeper/core.mjs";
import { DEEP_V2_KEEPER_INTERVAL_MS } from "./config.mjs";

export const DEEP_V2_BOUNDARY_STATE_SCHEMA_VERSION = 1;

export class DeepV2KeeperBoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeepV2KeeperBoundaryError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DeepV2KeeperBoundaryError(code, message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validLease(lease) {
  return (
    lease &&
    typeof lease.ownerId === "string" &&
    Number.isSafeInteger(lease.generation) &&
    lease.generation > 0 &&
    typeof lease.fencingToken === "string" &&
    lease.fencingToken.length > 0 &&
    typeof lease.etag === "string"
  );
}

export function createDeepV2BoundaryState(config) {
  return {
    schemaVersion: DEEP_V2_BOUNDARY_STATE_SCHEMA_VERSION,
    releaseManifest: config.releaseManifest,
    chainId: config.chainId,
    automationAddress: config.automationAddress,
    coordinatorAddress: config.coordinatorAddress,
    lastCompletedSlot: null,
    lastCompletedAtMs: null,
    fencingGeneration: null,
    keeperState: createInitialState(config),
  };
}

export function validateDeepV2BoundaryState(state, config) {
  if (
    state?.schemaVersion !== DEEP_V2_BOUNDARY_STATE_SCHEMA_VERSION ||
    state.releaseManifest !== config.releaseManifest ||
    state.chainId !== config.chainId ||
    state.automationAddress?.toLowerCase() !==
      config.automationAddress.toLowerCase() ||
    state.coordinatorAddress?.toLowerCase() !==
      config.coordinatorAddress.toLowerCase() ||
    !(
      state.lastCompletedSlot === null ||
      (Number.isSafeInteger(state.lastCompletedSlot) &&
        state.lastCompletedSlot >= 0)
    ) ||
    !(
      state.lastCompletedAtMs === null ||
      (Number.isSafeInteger(state.lastCompletedAtMs) &&
        state.lastCompletedAtMs >= 0)
    ) ||
    !(
      state.fencingGeneration === null ||
      (Number.isSafeInteger(state.fencingGeneration) &&
        state.fencingGeneration > 0)
    )
  ) {
    fail("INVALID_BOUNDARY_STATE", "Deep V2 boundary state is invalid");
  }
  validateState(state.keeperState, config);
  return state;
}

export function deepV2KeeperSlot(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    fail("INVALID_CLOCK", "Keeper clock must be a non-negative integer");
  }
  return Math.floor(nowMs / DEEP_V2_KEEPER_INTERVAL_MS);
}

async function requireFence(assertLease, lease) {
  if ((await assertLease(lease)) !== true) {
    fail(
      "LEASE_FENCE_LOST",
      "Deep V2 keeper lease ownership was lost",
    );
  }
}

/**
 * Wraps the battle-tested V1 operational core without changing its historical
 * behavior. V2 receives its own deterministic five-minute slot, state
 * envelope and storage fence.
 */
export async function runDeepV2KeeperBoundary({
  config,
  boundaryState,
  lease,
  assertLease,
  persistBoundaryState,
  readers,
  wallet,
  metrics,
  nowMs,
  runCycle = runKeeperCycle,
}) {
  if (config.intervalMs !== DEEP_V2_KEEPER_INTERVAL_MS) {
    fail(
      "INVALID_INTERVAL",
      `Deep V2 keeper interval must be ${DEEP_V2_KEEPER_INTERVAL_MS}`,
    );
  }
  if (!validLease(lease)) {
    fail("INVALID_LEASE", "Deep V2 keeper requires a fenced lease");
  }
  if (
    typeof assertLease !== "function" ||
    typeof persistBoundaryState !== "function"
  ) {
    fail(
      "PERSISTENCE_UNAVAILABLE",
      "Deep V2 keeper requires fenced durable persistence",
    );
  }

  await requireFence(assertLease, lease);
  validateDeepV2BoundaryState(boundaryState, config);
  const slot = deepV2KeeperSlot(nowMs);
  if (
    boundaryState.lastCompletedSlot !== null &&
    boundaryState.lastCompletedSlot > slot
  ) {
    fail(
      "CLOCK_REGRESSION",
      "Keeper clock is behind the last completed slot",
    );
  }
  if (boundaryState.lastCompletedSlot === slot) {
    return {
      boundaryState,
      outcome: "not-due",
      confirmedBlock: null,
      registryCount: null,
      ready: [],
    };
  }

  let workingBoundaryState = boundaryState;
  const fencedPersist = async (keeperState) => {
    await requireFence(assertLease, lease);
    workingBoundaryState = {
      ...workingBoundaryState,
      fencingGeneration: lease.generation,
      keeperState,
    };
    const persisted = await persistBoundaryState(
      clone(workingBoundaryState),
      lease,
    );
    if (persisted === false) {
      fail(
        "LEASE_FENCE_LOST",
        "Deep V2 keeper state write lost its storage fence",
      );
    }
  };

  const fencedWallet =
    wallet === null || wallet === undefined
      ? wallet
      : Object.freeze({
          supportsStableIdempotency:
            wallet.supportsStableIdempotency === true,
          async writeContract(input) {
            await requireFence(assertLease, lease);
            return wallet.writeContract(input);
          },
        });

  const result = await runCycle({
    config,
    state: workingBoundaryState.keeperState,
    readers,
    wallet: fencedWallet,
    metrics,
    persistPendingState: fencedPersist,
    nowMs,
  });

  await requireFence(assertLease, lease);
  const completed = {
    ...workingBoundaryState,
    lastCompletedSlot: slot,
    lastCompletedAtMs: nowMs,
    fencingGeneration: lease.generation,
    keeperState: result.state,
  };
  const persisted = await persistBoundaryState(clone(completed), lease);
  if (persisted === false) {
    fail(
      "LEASE_FENCE_LOST",
      "Deep V2 keeper final state write lost its storage fence",
    );
  }

  return {
    ...result,
    boundaryState: completed,
  };
}
