import "server-only";

import { parseDeepV3KeeperV2Config } from "../../../../../ops/deep-keeper-v3/config-v2.mjs";
import { validateDeepV3KeeperV2State } from "../../../../../ops/deep-keeper-v3/control-v2.mjs";
import { handleDeepV3KeeperV2HealthRequest } from "./handler";
import { createDeepV3KeeperV2ControlStore } from "../storage";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
export const runtime = "nodejs";

async function readSnapshot() {
  const nowMs = Date.now();
  const config = parseDeepV3KeeperV2Config(process.env);
  const store = createDeepV3KeeperV2ControlStore();
  const stored = await store.read(config.controlPath);
  if (!stored) return null;
  const control: unknown = JSON.parse(stored.value);
  if (
    !control ||
    typeof control !== "object" ||
    Array.isArray(control) ||
    !("schemaVersion" in control) ||
    control.schemaVersion !== 2 ||
    !("state" in control) ||
    !control.state
  ) {
    return null;
  }
  const state = validateDeepV3KeeperV2State(
    control.state,
    config,
  );
  const slot = Math.floor(nowMs / config.intervalMs);
  const dayStartMs =
    Math.floor(nowMs / 86_400_000) * 86_400_000;
  const tick = state.tickBudgets.find(
    (entry) => entry.slot === slot,
  );
  const day = state.gasBudgetDays.find(
    (entry) => entry.dayStartMs === dayStartMs,
  );
  const lastScannedAtMs = state.partitions.reduce<number | null>(
    (latest, partition) =>
      partition.lastScannedAtMs !== null &&
      (latest === null || partition.lastScannedAtMs > latest)
        ? partition.lastScannedAtMs
        : latest,
    null,
  );
  return {
    releaseVersion: state.releaseVersion,
    stateSchemaVersion: state.schemaVersion,
    lastCanonicalBlockNumber: state.lastCanonicalBlockNumber,
    lastCycleSlot: state.lastCycleSlot,
    scanLagMs:
      lastScannedAtMs === null
        ? null
        : Math.max(0, nowMs - lastScannedAtMs),
    activePendingBatches: state.pendingBatches.length,
    operatorIncidents: state.operatorIncidents.length,
    signerBalanceAlert: state.lanes.some(
      ({ balanceAlert }) => balanceAlert,
    ),
    currentTick: {
      slot,
      committedGas: tick?.committedGas ?? "0",
      committedMaxDebitWei:
        tick?.committedMaxDebitWei ?? "0",
      submissionCount: tick?.submissionCount ?? 0,
    },
    currentDay: {
      dayStartMs,
      committedMaxDebitWei:
        day?.committedMaxDebitWei ?? "0",
      confirmedActualDebitWei:
        day?.confirmedActualDebitWei ?? "0",
      submissionCount: day?.submissionCount ?? 0,
    },
  };
}

export async function GET(request: Request) {
  return handleDeepV3KeeperV2HealthRequest(request, {
    cronSecret: process.env.CRON_SECRET,
    readSnapshot,
    logFailure(errorName, errorCode) {
      console.error("Deep V3 keeper v2 health read failed", {
        errorName,
        errorCode,
      });
    },
  });
}
