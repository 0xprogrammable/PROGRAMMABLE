import "server-only";

import { createHash } from "node:crypto";

import {
  assertPredictionV2DistributedBudgetRuntimeV2,
  createPredictionV2DistributedBudgetV2,
  type PredictionV2BudgetLeaseV2,
  type PredictionV2DistributedBudgetV2,
} from "@/lib/prediction-v2/distributed-budget-v2.server";
import type { PredictionV2EnabledPublicReleaseV2 } from
  "@/lib/prediction-v2/public-release-v2.server";
import type {
  PredictionV2RouteBudgetActionV2,
  PredictionV2RouteBudgetLeaseV2,
  PredictionV2RouteRuntimeV2,
} from "./http-v2";
import {
  PREDICTION_V2_DIRECTORY_ROUTE_MAX_RPC_LOGICAL_CALLS,
  PREDICTION_V2_REDEEM_PREPARE_ROUTE_MAX_RPC_LOGICAL_CALLS,
  PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS,
} from "./route-bounds-v2.server";

type LeasePhase =
  | "reserved"
  | "start-attempted"
  | "started"
  | "provider-work"
  | "commit-attempted"
  | "committed"
  | "cancel-attempted"
  | "canceled";

type LeaseRecord = {
  readonly budgetLease: PredictionV2BudgetLeaseV2;
  phase: LeasePhase;
};

const RUNTIME_BY_RELEASE = new WeakMap<
  PredictionV2EnabledPublicReleaseV2,
  PredictionV2RouteRuntimeV2
>();

const ROUTE_BOUNDS = Object.freeze({
  directory: PREDICTION_V2_DIRECTORY_ROUTE_MAX_RPC_LOGICAL_CALLS,
  "redeem-prepare": PREDICTION_V2_REDEEM_PREPARE_ROUTE_MAX_RPC_LOGICAL_CALLS,
  "resolution-decision":
    PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS,
}) satisfies Readonly<Record<PredictionV2RouteBudgetActionV2, number>>;

function assertSignedRouteBudgetPolicy(
  release: PredictionV2EnabledPublicReleaseV2,
) {
  const lanes = release.distributedBudgetPolicy.lanes;
  const actions = Object.keys(ROUTE_BOUNDS) as PredictionV2RouteBudgetActionV2[];
  if (lanes.length !== actions.length) {
    throw new Error("Invalid Prediction V2 route budget policy");
  }
  for (const action of actions) {
    const matches = lanes.filter((lane) => lane.action === action);
    if (
      matches.length !== 1 ||
      matches[0]!.laneId !== `robinhood-settlement-rpc:${action}` ||
      matches[0]!.provider !== "robinhood-settlement-rpc" ||
      matches[0]!.unit !== "rpc-logical-call" ||
      matches[0]!.exactUnitsPerAction !== ROUTE_BOUNDS[action]
    ) throw new Error("Invalid Prediction V2 route budget policy");
  }
}

function sha256Key(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function distributedBudgetFromRelease(
  release: PredictionV2EnabledPublicReleaseV2,
): PredictionV2DistributedBudgetV2 {
  const budget = createPredictionV2DistributedBudgetV2({
    // No in-memory or process-local production fallback is permitted. The
    // checked-in runtime mirrors the signed lanes but intentionally omits a
    // backend until a reviewed shared-atomic adapter exists.
    backendTimeoutMs: release.distributedBudgetPolicy.policy.backendTimeoutMs,
    lanes: release.distributedBudgetPolicy.lanes.map((lane) => Object.freeze({
      provider: lane.provider,
      action: lane.action,
      unit: lane.unit,
      worstCaseUnits: lane.exactUnitsPerAction,
      reservationTtlMs: lane.leaseTtlMs,
      idempotencyTtlMs: lane.idempotencyTtlMs,
      limits: Object.freeze({
        provider: Object.freeze({ ...lane.capacities.provider }),
        action: Object.freeze({ ...lane.capacities.action }),
        client: Object.freeze({ ...lane.capacities.client }),
      }),
    })),
  });
  assertPredictionV2DistributedBudgetRuntimeV2(budget);
  return budget;
}

function releaseDarkProviderWork(): never {
  throw new Error(
    "Prediction V2 provider work remains release-dark until every adapter " +
      "and its shared budget backend are frozen",
  );
}

function createRuntime(
  release: PredictionV2EnabledPublicReleaseV2,
): PredictionV2RouteRuntimeV2 {
  assertSignedRouteBudgetPolicy(release);
  const budget = distributedBudgetFromRelease(release);
  const leases = new WeakMap<PredictionV2RouteBudgetLeaseV2, LeaseRecord>();
  const claimProviderWork = (routeLease: PredictionV2RouteBudgetLeaseV2) => {
    const record = leases.get(routeLease);
    if (!record || record.phase !== "started") {
      throw new Error("Prediction V2 provider work is not authorized");
    }
    record.phase = "provider-work";
  };

  return Object.freeze({
    readiness: Object.freeze({
      // A shared-atomic backend alone is insufficient. This remains literal
      // false until a privacy-preserving salted client-scope derivation and
      // its edge assertion are factory-proven as part of this runtime.
      productionReady: false,
    }),
    nowMs: Date.now,
    async reserve(input) {
      // Do not collapse every caller into one global client bucket and do not
      // persist/sign raw IP or wallet material. Until an opaque, salted scope
      // plus an edge assertion are proven, no budget reservation is attempted.
      void input;
      return Object.freeze({
        status: "blocked" as const,
        retryAfterSeconds: 30,
      });
    },
    async start(routeLease) {
      const record = leases.get(routeLease);
      if (!record || record.phase !== "reserved") return "not-started";
      // Set before awaiting. A timeout or lost acknowledgement may have
      // consumed the backend lease and must never become cancelable again.
      record.phase = "start-attempted";
      const started = await budget.markLeaseStarted({
        lease: record.budgetLease,
      });
      if (
        started.status !== "started" ||
        started.providerWorkAuthorized !== true ||
        started.idempotentReplay !== false
      ) return "not-started";
      record.phase = "started";
      return "started";
    },
    async commit({ lease: routeLease, result }) {
      const record = leases.get(routeLease);
      if (!record || record.phase !== "provider-work") {
        throw new Error("Prediction V2 budget lease is not committable");
      }
      record.phase = "commit-attempted";
      const committed = await budget.commitLease({
        lease: record.budgetLease,
        resultFingerprint: sha256Key(JSON.stringify(result)),
      });
      if (committed.status !== "committed") {
        throw new Error("Prediction V2 budget commit failed closed");
      }
      record.phase = "committed";
    },
    async cancel(routeLease) {
      const record = leases.get(routeLease);
      if (!record || record.phase !== "reserved") return;
      record.phase = "cancel-attempted";
      const canceled = await budget.cancelLease({ lease: record.budgetLease });
      if (canceled.status !== "canceled") {
        throw new Error("Prediction V2 budget cancellation failed closed");
      }
      record.phase = "canceled";
    },
    async readDirectory(input) {
      if (input.release !== release) return releaseDarkProviderWork();
      claimProviderWork(input.lease);
      const adapter = await import("./provider-actions-v2.server");
      return adapter.readPredictionV2DirectoryRouteV2({
        release,
        budget,
        intent: input.intent,
        signal: input.signal,
      });
    },
    async prepareRedeem(input) {
      if (input.release !== release) return releaseDarkProviderWork();
      claimProviderWork(input.lease);
      const adapter = await import("./provider-actions-v2.server");
      return adapter.preparePredictionV2RedeemRouteV2({
        release,
        budget,
        intent: input.intent,
        signal: input.signal,
      });
    },
    async decideResolution(input) {
      if (input.release !== release) return releaseDarkProviderWork();
      claimProviderWork(input.lease);
      const adapter = await import("./provider-actions-v2.server");
      return adapter.decidePredictionV2ResolutionRouteV2({
        release,
        budget,
        intent: input.intent,
        signal: input.signal,
      });
    },
  });
}

export function getPredictionV2RouteRuntimeV2(
  release: PredictionV2EnabledPublicReleaseV2,
): PredictionV2RouteRuntimeV2 {
  const existing = RUNTIME_BY_RELEASE.get(release);
  if (existing) return existing;
  const runtime = createRuntime(release);
  RUNTIME_BY_RELEASE.set(release, runtime);
  return runtime;
}
