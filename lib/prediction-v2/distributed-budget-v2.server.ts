import "server-only";

import { createHash, randomBytes } from "node:crypto";

export const PREDICTION_V2_DISTRIBUTED_BUDGET_RELEASE_STATE =
  "release-dark" as const;
export const PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION = 2 as const;
export const PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_VERSION =
  "prediction-v2-distributed-budget/v2" as const;
export const PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_COMMITMENT_DOMAIN =
  "prediction-v2-distributed-budget-runtime-policy/v2" as const;

const OPERATION_KEY_DOMAIN = "prediction-v2-budget-operation/v2";
const REQUEST_FINGERPRINT_DOMAIN = "prediction-v2-budget-request/v2";
const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;
const SHA256_KEY_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAXIMUM_CAPACITY_UNITS = 1_000_000_000;
const MAXIMUM_WINDOW_MS = 86_400_000;
const MAXIMUM_RESERVATION_TTL_MS = 60_000;
const MAXIMUM_IDEMPOTENCY_TTL_MS = 172_800_000;
const MAXIMUM_BACKEND_TIMEOUT_MS = 30_000;
const DEFAULT_BACKEND_TIMEOUT_MS = 3_000;
const DEFAULT_FAILURE_RETRY_AFTER_SECONDS = 30;
const BACKEND_TIMEOUT = Symbol("prediction-v2-budget-backend-timeout");
const TRUSTED_DISTRIBUTED_BUDGET_RUNTIMES = new WeakSet<object>();

export type PredictionV2BudgetScopeV2 = "provider" | "action" | "client";

export type PredictionV2BudgetScopeLimitV2 = Readonly<{
  capacityUnits: number;
  windowMs: number;
}>;

/**
 * One closed provider/action lane. The caller never supplies its own cost: the
 * complete worst-case cost and all three limits are pinned at construction.
 */
export type PredictionV2BudgetLaneV2 = Readonly<{
  provider: string;
  action: string;
  unit: string;
  worstCaseUnits: number;
  reservationTtlMs: number;
  idempotencyTtlMs: number;
  limits: Readonly<{
    provider: PredictionV2BudgetScopeLimitV2;
    action: PredictionV2BudgetScopeLimitV2;
    client: PredictionV2BudgetScopeLimitV2;
  }>;
}>;

export type PredictionV2AtomicBudgetScopeV2 = Readonly<{
  scope: PredictionV2BudgetScopeV2;
  key: string;
  capacityUnits: number;
  windowMs: number;
}>;

export type PredictionV2AtomicBudgetRequestV2 = Readonly<{
  schemaVersion: typeof PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION;
  operationKey: string;
  requestFingerprint: string;
  leaseOwnerToken: string;
  provider: string;
  action: string;
  clientScopeKey: string;
  idempotencyKey: string;
  unit: string;
  worstCaseUnits: number;
  reservationTtlMs: number;
  idempotencyTtlMs: number;
  scopes: readonly [
    PredictionV2AtomicBudgetScopeV2,
    PredictionV2AtomicBudgetScopeV2,
    PredictionV2AtomicBudgetScopeV2,
  ];
}>;

export type PredictionV2BudgetBackendInvocationV2 = Readonly<{
  /** Absolute epoch deadline. A shared backend must check it before mutation. */
  deadlineAtMs: number;
  signal: AbortSignal;
}>;

type BoundReserveResultV2 = Readonly<{
  operationKey: string;
  requestFingerprint: string;
}>;

export type PredictionV2AtomicBudgetBackendResultV2 =
  | (BoundReserveResultV2 & Readonly<{
    status: "reserved";
    reservationId: string;
    leaseOwnerToken: string;
    reservedUnits: number;
    unit: string;
    reservedAtMs: number;
    expiresAtMs: number;
    idempotentReplay: false;
  }>)
  | (BoundReserveResultV2 & Readonly<{
    status: "in-progress";
    reservationId: string;
    expiresAtMs: number;
    retryAfterMs: number;
  }>)
  | (BoundReserveResultV2 & Readonly<{
    status: "committed";
    reservationId: string;
    resultFingerprint: string;
    finalizedAtMs: number;
    idempotentReplay: true;
  }>)
  | (BoundReserveResultV2 & Readonly<{
    status: "canceled" | "expired";
    reservationId: string;
    finalizedAtMs: number;
    idempotentReplay: true;
  }>)
  | (BoundReserveResultV2 & Readonly<{
    status: "rate-limited";
    retryAfterMs: number;
    idempotentReplay: boolean;
  }>)
  | (BoundReserveResultV2 & Readonly<{
    status: "idempotency-conflict";
    retryAfterMs: number;
  }>);

export type PredictionV2BudgetLeaseV2 = Readonly<{
  schemaVersion: typeof PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION;
  provider: string;
  action: string;
  operationKey: string;
  requestFingerprint: string;
  reservationId: string;
  ownerToken: string;
  expiresAtMs: number;
}>;

export type PredictionV2AtomicBudgetLeaseRequestV2 = Readonly<{
  schemaVersion: typeof PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION;
  operationKey: string;
  requestFingerprint: string;
  reservationId: string;
  ownerToken: string;
}>;

export type PredictionV2AtomicBudgetCommitRequestV2 =
  PredictionV2AtomicBudgetLeaseRequestV2 & Readonly<{
    resultFingerprint: string;
  }>;

type BoundLeaseTransitionResultV2 = Readonly<{
  operationKey: string;
  requestFingerprint: string;
  reservationId: string;
}>;

export type PredictionV2AtomicBudgetCommitResultV2 =
  | (BoundLeaseTransitionResultV2 & Readonly<{
    status: "committed";
    leaseOwnerToken: string;
    resultFingerprint: string;
    committedAtMs: number;
    idempotentReplay: boolean;
  }>)
  | (BoundLeaseTransitionResultV2 & Readonly<{
    status:
      | "owner-mismatch"
      | "not-found"
      | "lease-expired"
      | "invalid-transition";
  }>);

export type PredictionV2AtomicBudgetStartResultV2 =
  | (BoundLeaseTransitionResultV2 & Readonly<{
    status: "started";
    leaseOwnerToken: string;
    startedAtMs: number;
    idempotentReplay: boolean;
  }>)
  | (BoundLeaseTransitionResultV2 & Readonly<{
    status:
      | "owner-mismatch"
      | "not-found"
      | "lease-expired"
      | "invalid-transition";
  }>);

export type PredictionV2AtomicBudgetCancelResultV2 =
  | (BoundLeaseTransitionResultV2 & Readonly<{
    status: "canceled";
    leaseOwnerToken: string;
    canceledAtMs: number;
    releasedUnits: number;
    idempotentReplay: boolean;
  }>)
  | (BoundLeaseTransitionResultV2 & Readonly<{
    status:
      | "owner-mismatch"
      | "not-found"
      | "lease-expired"
      | "invalid-transition";
  }>);

/**
 * A shared implementation must check and mutate every supplied scope in one
 * durable atomic operation. Its owner-token transitions are compare-and-set
 * operations; three independent increments or a separate lease write are not
 * compliant.
 */
export type PredictionV2AtomicBudgetBackendV2 = Readonly<{
  scope: "shared-atomic" | "single-runtime-test";
  /** Secret-free digest of the exact shared backend/configuration identity. */
  backendIdCommitment: string;
  reserveAtomic(
    request: PredictionV2AtomicBudgetRequestV2,
    invocation: PredictionV2BudgetBackendInvocationV2,
  ): Promise<PredictionV2AtomicBudgetBackendResultV2>;
  markStartedAtomic(
    request: PredictionV2AtomicBudgetLeaseRequestV2,
    invocation: PredictionV2BudgetBackendInvocationV2,
  ): Promise<PredictionV2AtomicBudgetStartResultV2>;
  commitAtomic(
    request: PredictionV2AtomicBudgetCommitRequestV2,
    invocation: PredictionV2BudgetBackendInvocationV2,
  ): Promise<PredictionV2AtomicBudgetCommitResultV2>;
  cancelAtomic(
    request: PredictionV2AtomicBudgetLeaseRequestV2,
    invocation: PredictionV2BudgetBackendInvocationV2,
  ): Promise<PredictionV2AtomicBudgetCancelResultV2>;
}>;

export type PredictionV2BudgetBlockedReasonV2 =
  | "unconfigured-backend"
  | "unconfigured-lane"
  | "invalid-request"
  | "invalid-lease"
  | "backend-failure"
  | "backend-timeout"
  | "backend-invalid-response"
  | "idempotency-conflict"
  | "lease-owner-mismatch"
  | "lease-not-found"
  | "lease-expired"
  | "lease-already-started"
  | "lease-transition-conflict";

export type PredictionV2BudgetReservationResultV2 =
  | Readonly<{
    status: "reserved";
    provider: string;
    action: string;
    unit: string;
    reservedUnits: number;
    expiresAtMs: number;
    idempotentReplay: false;
    lease: PredictionV2BudgetLeaseV2;
  }>
  | Readonly<{
    status: "in-progress";
    provider: string;
    action: string;
    retryAfterSeconds: number;
  }>
  | Readonly<{
    status: "replay";
    provider: string;
    action: string;
    outcome: "committed" | "canceled" | "expired";
    resultFingerprint?: string;
    finalizedAtMs: number;
  }>
  | Readonly<{
    status: "rate-limited";
    provider: string;
    action: string;
    retryAfterSeconds: number;
    idempotentReplay: boolean;
  }>
  | Readonly<{
    status: "blocked";
    reason: PredictionV2BudgetBlockedReasonV2;
    retryAfterSeconds: number;
  }>;

export type PredictionV2BudgetLeaseTransitionResultV2 =
  | Readonly<{
    /** Only this non-replay result authorizes exactly one provider invocation. */
    status: "started";
    startedAtMs: number;
    providerWorkAuthorized: true;
    idempotentReplay: false;
  }>
  | Readonly<{
    status: "committed";
    resultFingerprint: string;
    committedAtMs: number;
    idempotentReplay: boolean;
  }>
  | Readonly<{
    status: "canceled";
    canceledAtMs: number;
    releasedUnits: number;
    idempotentReplay: boolean;
  }>
  | Readonly<{
    status: "blocked";
    reason: PredictionV2BudgetBlockedReasonV2;
    retryAfterSeconds: number;
  }>;

export type PredictionV2BudgetReservationInputV2 = Readonly<{
  provider: string;
  action: string;
  /** Opaque, salted client identity digest. Raw IPs, wallets and account IDs fail. */
  clientScopeKey: string;
  /** Opaque request digest. Reusing it cannot authorize the same work twice. */
  idempotencyKey: string;
}>;

export type PredictionV2BudgetCommitInputV2 = Readonly<{
  lease: PredictionV2BudgetLeaseV2;
  /** Opaque digest of a result stored outside the budget backend. */
  resultFingerprint: string;
}>;

export type PredictionV2BudgetCancelInputV2 = Readonly<{
  lease: PredictionV2BudgetLeaseV2;
}>;

export type PredictionV2BudgetStartInputV2 = PredictionV2BudgetCancelInputV2;

export type PredictionV2DistributedBudgetRuntimeProjectionLaneV2 = Readonly<{
  laneId: string;
  provider: string;
  action: string;
  unit: string;
  exactUnitsPerAction: number;
  leaseTtlMs: number;
  idempotencyTtlMs: number;
  capacities: Readonly<{
    provider: PredictionV2BudgetScopeLimitV2;
    action: PredictionV2BudgetScopeLimitV2;
    client: PredictionV2BudgetScopeLimitV2;
  }>;
}>;

/** Closed, deterministic and secret-free policy shape for release matching. */
export type PredictionV2DistributedBudgetRuntimeProjectionV2 = Readonly<{
  schemaVersion: typeof PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION;
  backend: Readonly<{
    scope: "unconfigured" | PredictionV2AtomicBudgetBackendV2["scope"];
    backendIdCommitment: string | null;
  }>;
  policy: Readonly<{
    version: typeof PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_VERSION;
    backendTimeoutMs: number;
  }>;
  lanes: readonly PredictionV2DistributedBudgetRuntimeProjectionLaneV2[];
}>;

export type PredictionV2DistributedBudgetV2 = Readonly<{
  readiness: Readonly<{
    releaseState: typeof PREDICTION_V2_DISTRIBUTED_BUDGET_RELEASE_STATE;
    backendScope: "unconfigured" | PredictionV2AtomicBudgetBackendV2["scope"];
    productionReady: false;
  }>;
  runtimePolicyProjection(): PredictionV2DistributedBudgetRuntimeProjectionV2;
  runtimePolicyCommitment(): string;
  reserveWorstCase(
    input: PredictionV2BudgetReservationInputV2,
  ): Promise<PredictionV2BudgetReservationResultV2>;
  markLeaseStarted(
    input: PredictionV2BudgetStartInputV2,
  ): Promise<PredictionV2BudgetLeaseTransitionResultV2>;
  commitLease(
    input: PredictionV2BudgetCommitInputV2,
  ): Promise<PredictionV2BudgetLeaseTransitionResultV2>;
  cancelLease(
    input: PredictionV2BudgetCancelInputV2,
  ): Promise<PredictionV2BudgetLeaseTransitionResultV2>;
}>;

export type PredictionV2DistributedBudgetOptionsV2 = Readonly<{
  lanes: readonly PredictionV2BudgetLaneV2[];
  backend?: PredictionV2AtomicBudgetBackendV2;
  backendTimeoutMs?: number;
  backendFailureRetryAfterSeconds?: number;
}>;

/**
 * Proves that a runtime was created by this module, not by a structurally
 * compatible object that can forge policy methods while bypassing leases.
 */
export function assertPredictionV2DistributedBudgetRuntimeV2(
  value: unknown,
): asserts value is PredictionV2DistributedBudgetV2 {
  if (
    !value ||
    typeof value !== "object" ||
    !TRUSTED_DISTRIBUTED_BUDGET_RUNTIMES.has(value)
  ) {
    throw new TypeError("Untrusted Prediction V2 distributed budget runtime");
  }
}

/**
 * Release-dark orchestration only. No route imports this module yet and this
 * object intentionally has no state capable of reporting production readiness.
 */
export function createPredictionV2DistributedBudgetV2(
  options: PredictionV2DistributedBudgetOptionsV2,
): PredictionV2DistributedBudgetV2 {
  const lanes = validateAndIndexLanes(options.lanes);
  const failureRetryAfterSeconds = positiveInteger(
    options.backendFailureRetryAfterSeconds ??
      DEFAULT_FAILURE_RETRY_AFTER_SECONDS,
    "backendFailureRetryAfterSeconds",
    1,
    3_600,
  );
  const backendTimeoutMs = positiveInteger(
    options.backendTimeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS,
    "backendTimeoutMs",
    1,
    MAXIMUM_BACKEND_TIMEOUT_MS,
  );
  const backend = options.backend;
  if (backend) validateBackendIdentity(backend);
  // Capture the validated methods once. Mutating a caller-owned backend object
  // later cannot silently swap behavior under an already committed projection.
  const reserveAtomic = backend?.reserveAtomic.bind(backend);
  const markStartedAtomic = backend?.markStartedAtomic.bind(backend);
  const commitAtomic = backend?.commitAtomic.bind(backend);
  const cancelAtomic = backend?.cancelAtomic.bind(backend);
  const runtimeProjection = buildRuntimeProjection(
    lanes,
    backend,
    backendTimeoutMs,
  );
  const runtimeCommitment = sha256Key(
    `${PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_COMMITMENT_DOMAIN}\n${JSON.stringify(runtimeProjection)}`,
  );

  const runtime: PredictionV2DistributedBudgetV2 = Object.freeze({
    readiness: Object.freeze({
      releaseState: PREDICTION_V2_DISTRIBUTED_BUDGET_RELEASE_STATE,
      backendScope: backend?.scope ?? "unconfigured",
      productionReady: false as const,
    }),
    runtimePolicyProjection() {
      return runtimeProjection;
    },
    runtimePolicyCommitment() {
      return runtimeCommitment;
    },
    async reserveWorstCase(input) {
      if (!isReservationInput(input)) {
        return blockedReservation("invalid-request", failureRetryAfterSeconds);
      }
      const lane = lanes.get(laneKey(input.provider, input.action));
      if (!lane) {
        return blockedReservation(
          "unconfigured-lane",
          failureRetryAfterSeconds,
        );
      }
      if (!reserveAtomic) {
        return blockedReservation(
          "unconfigured-backend",
          failureRetryAfterSeconds,
        );
      }

      const request = buildAtomicRequest(lane, input);
      const invocation = await invokeBackendWithTimeout(
        backendTimeoutMs,
        (context) => reserveAtomic(request, context),
      );
      if (invocation.status === "timeout") {
        return blockedReservation(
          "backend-timeout",
          failureRetryAfterSeconds,
        );
      }
      if (invocation.status === "failure") {
        return blockedReservation(
          "backend-failure",
          failureRetryAfterSeconds,
        );
      }
      return bindBackendReservationResult(
        invocation.value,
        request,
        failureRetryAfterSeconds,
      );
    },
    async markLeaseStarted(input) {
      if (!markStartedAtomic) {
        return blockedTransition(
          "unconfigured-backend",
          failureRetryAfterSeconds,
        );
      }
      if (!isCancelInput(input)) {
        return blockedTransition("invalid-lease", failureRetryAfterSeconds);
      }
      const request = buildLeaseRequest(input.lease);
      const invocation = await invokeBackendWithTimeout(
        backendTimeoutMs,
        (context) => markStartedAtomic(request, context),
      );
      if (invocation.status === "timeout") {
        return blockedTransition("backend-timeout", failureRetryAfterSeconds);
      }
      if (invocation.status === "failure") {
        return blockedTransition("backend-failure", failureRetryAfterSeconds);
      }
      return bindBackendStartResult(
        invocation.value,
        request,
        failureRetryAfterSeconds,
      );
    },
    async commitLease(input) {
      if (!commitAtomic) {
        return blockedTransition(
          "unconfigured-backend",
          failureRetryAfterSeconds,
        );
      }
      if (!isCommitInput(input)) {
        return blockedTransition("invalid-lease", failureRetryAfterSeconds);
      }
      const request = buildCommitRequest(input);
      const invocation = await invokeBackendWithTimeout(
        backendTimeoutMs,
        (context) => commitAtomic(request, context),
      );
      if (invocation.status === "timeout") {
        return blockedTransition("backend-timeout", failureRetryAfterSeconds);
      }
      if (invocation.status === "failure") {
        return blockedTransition("backend-failure", failureRetryAfterSeconds);
      }
      return bindBackendCommitResult(
        invocation.value,
        request,
        failureRetryAfterSeconds,
      );
    },
    async cancelLease(input) {
      if (!cancelAtomic) {
        return blockedTransition(
          "unconfigured-backend",
          failureRetryAfterSeconds,
        );
      }
      if (!isCancelInput(input)) {
        return blockedTransition("invalid-lease", failureRetryAfterSeconds);
      }
      const request = buildLeaseRequest(input.lease);
      const invocation = await invokeBackendWithTimeout(
        backendTimeoutMs,
        (context) => cancelAtomic(request, context),
      );
      if (invocation.status === "timeout") {
        return blockedTransition("backend-timeout", failureRetryAfterSeconds);
      }
      if (invocation.status === "failure") {
        return blockedTransition("backend-failure", failureRetryAfterSeconds);
      }
      return bindBackendCancelResult(
        invocation.value,
        request,
        failureRetryAfterSeconds,
      );
    },
  });
  TRUSTED_DISTRIBUTED_BUDGET_RUNTIMES.add(runtime);
  return runtime;
}

type InMemoryBucket = {
  windowStartMs: number;
  usedUnits: number;
};

type InMemoryCharge = Readonly<{
  key: string;
  windowStartMs: number;
  units: number;
}>;

type InMemoryRateLimitedRecord = {
  kind: "rate-limited";
  requestFingerprint: string;
  retentionExpiresAtMs: number;
  retryAfterMs: number;
};

type InMemoryLeaseRecord = {
  kind: "lease";
  requestFingerprint: string;
  retentionExpiresAtMs: number;
  reservationId: string;
  ownerToken: string;
  reservedUnits: number;
  unit: string;
  reservedAtMs: number;
  leaseExpiresAtMs: number;
  state: "reserved" | "started" | "committed" | "canceled" | "expired";
  startedAtMs?: number;
  finalizedAtMs?: number;
  resultFingerprint?: string;
  charges: readonly [InMemoryCharge, InMemoryCharge, InMemoryCharge];
};

type InMemoryOperationRecord =
  | InMemoryRateLimitedRecord
  | InMemoryLeaseRecord;

export type PredictionV2InMemoryBudgetBackendOptionsV2 = Readonly<{
  allowNonProduction: true;
  environment: "test" | "development";
  nowMs?: () => number;
}>;

/**
 * Deterministic test/development adapter. It is single-runtime by construction,
 * rejects production creation, and can never satisfy shared activation proof.
 */
export function createPredictionV2InMemoryBudgetBackendV2(
  options: PredictionV2InMemoryBudgetBackendOptionsV2,
): PredictionV2AtomicBudgetBackendV2 {
  const runtimeEnvironment = (options as Readonly<{ environment?: unknown }>)
    .environment;
  if (
    options.allowNonProduction !== true ||
    (runtimeEnvironment !== "test" && runtimeEnvironment !== "development") ||
    process.env.NODE_ENV === "production"
  ) {
    throw new Error(
      "Prediction V2 in-memory budget is forbidden in production",
    );
  }
  const nowMs = options.nowMs ?? Date.now;
  const buckets = new Map<string, InMemoryBucket>();
  const operations = new Map<string, InMemoryOperationRecord>();

  return Object.freeze({
    scope: "single-runtime-test" as const,
    backendIdCommitment: sha256Key(
      "prediction-v2-budget-backend/single-runtime-test/v2",
    ),
    async reserveAtomic(request, invocation) {
      assertInvocationActive(invocation);
      validateAtomicRequest(request);
      const currentTimeMs = checkedNow(nowMs);
      purgeExpiredOperations(operations, currentTimeMs);
      const existing = operations.get(request.operationKey);
      if (existing) {
        return existingReserveResult(existing, request, currentTimeMs);
      }

      const scopeStates = request.scopes.map((scope) => {
        const windowStartMs = Math.floor(currentTimeMs / scope.windowMs) *
          scope.windowMs;
        const current = buckets.get(scope.key);
        const usedUnits = current?.windowStartMs === windowStartMs
          ? current.usedUnits
          : 0;
        return {
          scope,
          windowStartMs,
          usedUnits,
          windowEndMs: windowStartMs + scope.windowMs,
        };
      });
      const exhausted = scopeStates.filter(({ scope, usedUnits }) =>
        usedUnits + request.worstCaseUnits > scope.capacityUnits
      );
      if (exhausted.length > 0) {
        const retryAfterMs = Math.max(
          1,
          ...exhausted.map(({ windowEndMs }) => windowEndMs - currentTimeMs),
        );
        assertInvocationActive(invocation);
        operations.set(request.operationKey, {
          kind: "rate-limited",
          requestFingerprint: request.requestFingerprint,
          retentionExpiresAtMs: safeTimestampAdd(currentTimeMs, retryAfterMs),
          retryAfterMs,
        });
        return Object.freeze({
          status: "rate-limited" as const,
          operationKey: request.operationKey,
          requestFingerprint: request.requestFingerprint,
          retryAfterMs,
          idempotentReplay: false,
        });
      }

      // Every check, bucket charge and lease write happens without an await.
      // A durable implementation must provide the same all-or-none CAS.
      assertInvocationActive(invocation);
      for (const { scope, windowStartMs, usedUnits } of scopeStates) {
        buckets.set(scope.key, {
          windowStartMs,
          usedUnits: usedUnits + request.worstCaseUnits,
        });
      }
      const expiresAtMs = Math.min(
        safeTimestampAdd(currentTimeMs, request.reservationTtlMs),
        ...scopeStates.map(({ windowEndMs }) => windowEndMs),
      );
      const reservationId = sha256Key([
        "prediction-v2-budget-reservation/v2",
        request.operationKey,
        request.leaseOwnerToken,
        currentTimeMs,
      ].join("\n"));
      const charges = Object.freeze(scopeStates.map(({ scope, windowStartMs }) =>
        Object.freeze({
          key: scope.key,
          windowStartMs,
          units: request.worstCaseUnits,
        })
      )) as InMemoryLeaseRecord["charges"];
      operations.set(request.operationKey, {
        kind: "lease",
        requestFingerprint: request.requestFingerprint,
        retentionExpiresAtMs: safeTimestampAdd(
          currentTimeMs,
          request.idempotencyTtlMs,
        ),
        reservationId,
        ownerToken: request.leaseOwnerToken,
        reservedUnits: request.worstCaseUnits,
        unit: request.unit,
        reservedAtMs: currentTimeMs,
        leaseExpiresAtMs: expiresAtMs,
        state: "reserved",
        charges,
      });
      return Object.freeze({
        status: "reserved" as const,
        operationKey: request.operationKey,
        requestFingerprint: request.requestFingerprint,
        reservationId,
        leaseOwnerToken: request.leaseOwnerToken,
        reservedUnits: request.worstCaseUnits,
        unit: request.unit,
        reservedAtMs: currentTimeMs,
        expiresAtMs,
        idempotentReplay: false as const,
      });
    },
    async markStartedAtomic(request, invocation) {
      assertInvocationActive(invocation);
      validateLeaseRequest(request);
      const currentTimeMs = checkedNow(nowMs);
      purgeExpiredOperations(operations, currentTimeMs);
      const record = operations.get(request.operationKey);
      const binding = transitionBinding(request);
      if (!record || record.kind !== "lease") {
        return Object.freeze({ ...binding, status: "not-found" as const });
      }
      if (
        record.requestFingerprint !== request.requestFingerprint ||
        record.reservationId !== request.reservationId
      ) {
        return Object.freeze({
          ...binding,
          status: "invalid-transition" as const,
        });
      }
      if (record.ownerToken !== request.ownerToken) {
        return Object.freeze({
          ...binding,
          status: "owner-mismatch" as const,
        });
      }
      if (record.state === "started") {
        return Object.freeze({
          ...binding,
          status: "started" as const,
          leaseOwnerToken: request.ownerToken,
          startedAtMs: record.startedAtMs!,
          idempotentReplay: true,
        });
      }
      if (record.state === "expired") {
        return Object.freeze({
          ...binding,
          status: "lease-expired" as const,
        });
      }
      if (record.state !== "reserved") {
        return Object.freeze({
          ...binding,
          status: "invalid-transition" as const,
        });
      }
      if (record.leaseExpiresAtMs <= currentTimeMs) {
        expireLease(record, currentTimeMs);
        return Object.freeze({
          ...binding,
          status: "lease-expired" as const,
        });
      }
      assertInvocationActive(invocation);
      record.state = "started";
      record.startedAtMs = currentTimeMs;
      return Object.freeze({
        ...binding,
        status: "started" as const,
        leaseOwnerToken: request.ownerToken,
        startedAtMs: currentTimeMs,
        idempotentReplay: false,
      });
    },
    async commitAtomic(request, invocation) {
      assertInvocationActive(invocation);
      validateCommitRequest(request);
      const currentTimeMs = checkedNow(nowMs);
      purgeExpiredOperations(operations, currentTimeMs);
      const record = operations.get(request.operationKey);
      const binding = transitionBinding(request);
      if (!record || record.kind !== "lease") {
        return Object.freeze({ ...binding, status: "not-found" as const });
      }
      if (
        record.requestFingerprint !== request.requestFingerprint ||
        record.reservationId !== request.reservationId
      ) {
        return Object.freeze({
          ...binding,
          status: "invalid-transition" as const,
        });
      }
      if (record.ownerToken !== request.ownerToken) {
        return Object.freeze({
          ...binding,
          status: "owner-mismatch" as const,
        });
      }
      if (record.state === "committed") {
        if (record.resultFingerprint !== request.resultFingerprint) {
          return Object.freeze({
            ...binding,
            status: "invalid-transition" as const,
          });
        }
        return Object.freeze({
          ...binding,
          status: "committed" as const,
          leaseOwnerToken: request.ownerToken,
          resultFingerprint: request.resultFingerprint,
          committedAtMs: record.finalizedAtMs!,
          idempotentReplay: true,
        });
      }
      if (record.state === "expired") {
        return Object.freeze({
          ...binding,
          status: "lease-expired" as const,
        });
      }
      if (record.state === "reserved") {
        if (record.leaseExpiresAtMs <= currentTimeMs) {
          expireLease(record, currentTimeMs);
          return Object.freeze({
            ...binding,
            status: "lease-expired" as const,
          });
        }
        return Object.freeze({
          ...binding,
          status: "invalid-transition" as const,
        });
      }
      if (record.state !== "started") {
        return Object.freeze({
          ...binding,
          status: "invalid-transition" as const,
        });
      }
      assertInvocationActive(invocation);
      record.state = "committed";
      record.finalizedAtMs = currentTimeMs;
      record.resultFingerprint = request.resultFingerprint;
      return Object.freeze({
        ...binding,
        status: "committed" as const,
        leaseOwnerToken: request.ownerToken,
        resultFingerprint: request.resultFingerprint,
        committedAtMs: currentTimeMs,
        idempotentReplay: false,
      });
    },
    async cancelAtomic(request, invocation) {
      assertInvocationActive(invocation);
      validateLeaseRequest(request);
      const currentTimeMs = checkedNow(nowMs);
      purgeExpiredOperations(operations, currentTimeMs);
      const record = operations.get(request.operationKey);
      const binding = transitionBinding(request);
      if (!record || record.kind !== "lease") {
        return Object.freeze({ ...binding, status: "not-found" as const });
      }
      if (
        record.requestFingerprint !== request.requestFingerprint ||
        record.reservationId !== request.reservationId
      ) {
        return Object.freeze({
          ...binding,
          status: "invalid-transition" as const,
        });
      }
      if (record.ownerToken !== request.ownerToken) {
        return Object.freeze({
          ...binding,
          status: "owner-mismatch" as const,
        });
      }
      if (record.state === "canceled") {
        return Object.freeze({
          ...binding,
          status: "canceled" as const,
          leaseOwnerToken: request.ownerToken,
          canceledAtMs: record.finalizedAtMs!,
          releasedUnits: 0,
          idempotentReplay: true,
        });
      }
      if (record.state === "expired") {
        return Object.freeze({
          ...binding,
          status: "lease-expired" as const,
        });
      }
      if (record.state !== "reserved") {
        return Object.freeze({
          ...binding,
          status: "invalid-transition" as const,
        });
      }
      if (record.leaseExpiresAtMs <= currentTimeMs) {
        expireLease(record, currentTimeMs);
        return Object.freeze({
          ...binding,
          status: "lease-expired" as const,
        });
      }

      // The owner may cancel only before provider work starts. All three live
      // charges are verified before any decrement, then released exactly once.
      for (const charge of record.charges) {
        const bucket = buckets.get(charge.key);
        if (
          !bucket ||
          bucket.windowStartMs !== charge.windowStartMs ||
          bucket.usedUnits < charge.units
        ) {
          throw new Error("Prediction V2 budget charge invariant violated");
        }
      }
      assertInvocationActive(invocation);
      for (const charge of record.charges) {
        const bucket = buckets.get(charge.key)!;
        const usedUnits = bucket.usedUnits - charge.units;
        if (usedUnits === 0) buckets.delete(charge.key);
        else bucket.usedUnits = usedUnits;
      }
      record.state = "canceled";
      record.finalizedAtMs = currentTimeMs;
      return Object.freeze({
        ...binding,
        status: "canceled" as const,
        leaseOwnerToken: request.ownerToken,
        canceledAtMs: currentTimeMs,
        releasedUnits: record.reservedUnits,
        idempotentReplay: false,
      });
    },
  });
}

function validateAndIndexLanes(lanes: readonly PredictionV2BudgetLaneV2[]) {
  if (!Array.isArray(lanes) || lanes.length === 0 || lanes.length > 128) {
    throw new RangeError("lanes must contain from 1 to 128 entries");
  }
  const indexed = new Map<string, PredictionV2BudgetLaneV2>();
  const providerLimits = new Map<string, string>();
  for (const candidate of lanes) {
    const lane = validateLane(candidate);
    const key = laneKey(lane.provider, lane.action);
    if (indexed.has(key)) {
      throw new Error(`Duplicate Prediction V2 budget lane: ${key}`);
    }
    const providerLimitFingerprint = [
      lane.unit,
      lane.limits.provider.capacityUnits,
      lane.limits.provider.windowMs,
    ].join(":");
    const existingProviderLimit = providerLimits.get(lane.provider);
    if (
      existingProviderLimit !== undefined &&
      existingProviderLimit !== providerLimitFingerprint
    ) {
      throw new Error(
        `Prediction V2 provider budget must be identical across ${lane.provider} lanes`,
      );
    }
    providerLimits.set(lane.provider, providerLimitFingerprint);
    indexed.set(key, lane);
  }
  return indexed;
}

function validateLane(candidate: PredictionV2BudgetLaneV2) {
  if (!candidate || typeof candidate !== "object") {
    throw new TypeError("Prediction V2 budget lane must be an object");
  }
  const provider = budgetIdentifier(candidate.provider, "provider");
  const action = budgetIdentifier(candidate.action, "action");
  const unit = budgetIdentifier(candidate.unit, "unit");
  const worstCaseUnits = positiveInteger(
    candidate.worstCaseUnits,
    "worstCaseUnits",
    1,
    MAXIMUM_CAPACITY_UNITS,
  );
  const limits = Object.freeze({
    provider: validateScopeLimit(candidate.limits?.provider, "provider"),
    action: validateScopeLimit(candidate.limits?.action, "action"),
    client: validateScopeLimit(candidate.limits?.client, "client"),
  });
  for (const [scope, limit] of Object.entries(limits)) {
    if (limit.capacityUnits < worstCaseUnits) {
      throw new RangeError(
        `${scope} capacityUnits must cover worstCaseUnits`,
      );
    }
  }
  const reservationTtlMs = positiveInteger(
    candidate.reservationTtlMs,
    "reservationTtlMs",
    1,
    MAXIMUM_RESERVATION_TTL_MS,
  );
  const minimumWindowMs = Math.min(
    limits.provider.windowMs,
    limits.action.windowMs,
    limits.client.windowMs,
  );
  if (reservationTtlMs > minimumWindowMs) {
    throw new RangeError(
      "reservationTtlMs cannot exceed the shortest budget window",
    );
  }
  const idempotencyTtlMs = positiveInteger(
    candidate.idempotencyTtlMs,
    "idempotencyTtlMs",
    Math.max(
      limits.provider.windowMs,
      limits.action.windowMs,
      limits.client.windowMs,
    ),
    MAXIMUM_IDEMPOTENCY_TTL_MS,
  );
  return Object.freeze({
    provider,
    action,
    unit,
    worstCaseUnits,
    reservationTtlMs,
    idempotencyTtlMs,
    limits,
  });
}

function validateScopeLimit(
  candidate: PredictionV2BudgetScopeLimitV2 | undefined,
  label: string,
) {
  if (!candidate || typeof candidate !== "object") {
    throw new TypeError(`${label} limit must be an object`);
  }
  return Object.freeze({
    capacityUnits: positiveInteger(
      candidate.capacityUnits,
      `${label}.capacityUnits`,
      1,
      MAXIMUM_CAPACITY_UNITS,
    ),
    windowMs: positiveInteger(
      candidate.windowMs,
      `${label}.windowMs`,
      1_000,
      MAXIMUM_WINDOW_MS,
    ),
  });
}

function validateBackendIdentity(backend: PredictionV2AtomicBudgetBackendV2) {
  if (
    (backend.scope !== "shared-atomic" &&
      backend.scope !== "single-runtime-test") ||
    !SHA256_KEY_PATTERN.test(backend.backendIdCommitment) ||
    typeof backend.reserveAtomic !== "function" ||
    typeof backend.markStartedAtomic !== "function" ||
    typeof backend.commitAtomic !== "function" ||
    typeof backend.cancelAtomic !== "function"
  ) {
    throw new TypeError("Invalid Prediction V2 atomic budget backend");
  }
}

function buildRuntimeProjection(
  lanes: ReadonlyMap<string, PredictionV2BudgetLaneV2>,
  backend: PredictionV2AtomicBudgetBackendV2 | undefined,
  backendTimeoutMs: number,
): PredictionV2DistributedBudgetRuntimeProjectionV2 {
  const projectedLanes = [...lanes.values()]
    .sort((left, right) =>
      laneKey(left.provider, left.action).localeCompare(
        laneKey(right.provider, right.action),
        "en",
      )
    )
    .map((lane) => Object.freeze({
      laneId: laneKey(lane.provider, lane.action),
      provider: lane.provider,
      action: lane.action,
      unit: lane.unit,
      exactUnitsPerAction: lane.worstCaseUnits,
      leaseTtlMs: lane.reservationTtlMs,
      idempotencyTtlMs: lane.idempotencyTtlMs,
      capacities: Object.freeze({
        provider: Object.freeze({ ...lane.limits.provider }),
        action: Object.freeze({ ...lane.limits.action }),
        client: Object.freeze({ ...lane.limits.client }),
      }),
    }));
  return Object.freeze({
    schemaVersion: PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION,
    backend: Object.freeze({
      scope: backend?.scope ?? "unconfigured",
      backendIdCommitment: backend?.backendIdCommitment ?? null,
    }),
    policy: Object.freeze({
      version: PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_VERSION,
      backendTimeoutMs,
    }),
    lanes: Object.freeze(projectedLanes),
  });
}

function buildAtomicRequest(
  lane: PredictionV2BudgetLaneV2,
  input: PredictionV2BudgetReservationInputV2,
): PredictionV2AtomicBudgetRequestV2 {
  const operationKey = budgetOperationKey(
    lane.provider,
    lane.action,
    input.idempotencyKey,
  );
  const scopes = Object.freeze([
    scopeRequest("provider", lane, `provider:${lane.provider}`),
    scopeRequest(
      "action",
      lane,
      `action:${lane.provider}:${lane.action}`,
    ),
    scopeRequest(
      "client",
      lane,
      `client:${lane.provider}:${lane.action}:${input.clientScopeKey}`,
    ),
  ]) as PredictionV2AtomicBudgetRequestV2["scopes"];
  const requestFingerprint = atomicRequestFingerprint({
    operationKey,
    provider: lane.provider,
    action: lane.action,
    clientScopeKey: input.clientScopeKey,
    idempotencyKey: input.idempotencyKey,
    unit: lane.unit,
    worstCaseUnits: lane.worstCaseUnits,
    reservationTtlMs: lane.reservationTtlMs,
    idempotencyTtlMs: lane.idempotencyTtlMs,
    scopes,
  });
  return Object.freeze({
    schemaVersion: PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION,
    operationKey,
    requestFingerprint,
    leaseOwnerToken: sha256Key(randomBytes(32).toString("hex")),
    provider: lane.provider,
    action: lane.action,
    clientScopeKey: input.clientScopeKey,
    idempotencyKey: input.idempotencyKey,
    unit: lane.unit,
    worstCaseUnits: lane.worstCaseUnits,
    reservationTtlMs: lane.reservationTtlMs,
    idempotencyTtlMs: lane.idempotencyTtlMs,
    scopes,
  });
}

function scopeRequest(
  scope: PredictionV2BudgetScopeV2,
  lane: PredictionV2BudgetLaneV2,
  key: string,
): PredictionV2AtomicBudgetScopeV2 {
  return Object.freeze({
    scope,
    key,
    capacityUnits: lane.limits[scope].capacityUnits,
    windowMs: lane.limits[scope].windowMs,
  });
}

function buildLeaseRequest(
  lease: PredictionV2BudgetLeaseV2,
): PredictionV2AtomicBudgetLeaseRequestV2 {
  return Object.freeze({
    schemaVersion: PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION,
    operationKey: lease.operationKey,
    requestFingerprint: lease.requestFingerprint,
    reservationId: lease.reservationId,
    ownerToken: lease.ownerToken,
  });
}

function buildCommitRequest(
  input: PredictionV2BudgetCommitInputV2,
): PredictionV2AtomicBudgetCommitRequestV2 {
  return Object.freeze({
    ...buildLeaseRequest(input.lease),
    resultFingerprint: input.resultFingerprint,
  });
}

function bindBackendReservationResult(
  result: PredictionV2AtomicBudgetBackendResultV2,
  request: PredictionV2AtomicBudgetRequestV2,
  failureRetryAfterSeconds: number,
): PredictionV2BudgetReservationResultV2 {
  if (!isBackendReservationResultBound(result, request)) {
    return blockedReservation(
      "backend-invalid-response",
      failureRetryAfterSeconds,
    );
  }
  if (result.status === "reserved") {
    const lease = Object.freeze({
      schemaVersion: PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION,
      provider: request.provider,
      action: request.action,
      operationKey: request.operationKey,
      requestFingerprint: request.requestFingerprint,
      reservationId: result.reservationId,
      ownerToken: result.leaseOwnerToken,
      expiresAtMs: result.expiresAtMs,
    });
    return Object.freeze({
      status: "reserved" as const,
      provider: request.provider,
      action: request.action,
      unit: request.unit,
      reservedUnits: request.worstCaseUnits,
      expiresAtMs: result.expiresAtMs,
      idempotentReplay: false as const,
      lease,
    });
  }
  if (result.status === "in-progress") {
    return Object.freeze({
      status: "in-progress" as const,
      provider: request.provider,
      action: request.action,
      retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1_000)),
    });
  }
  if (
    result.status === "committed" ||
    result.status === "canceled" ||
    result.status === "expired"
  ) {
    return Object.freeze({
      status: "replay" as const,
      provider: request.provider,
      action: request.action,
      outcome: result.status,
      ...(result.status === "committed"
        ? { resultFingerprint: result.resultFingerprint }
        : {}),
      finalizedAtMs: result.finalizedAtMs,
    });
  }
  if (result.status === "rate-limited") {
    return Object.freeze({
      status: "rate-limited" as const,
      provider: request.provider,
      action: request.action,
      retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1_000)),
      idempotentReplay: result.idempotentReplay,
    });
  }
  if (result.status === "idempotency-conflict" && "retryAfterMs" in result) {
    return blockedReservation(
      "idempotency-conflict",
      Math.max(1, Math.ceil(result.retryAfterMs / 1_000)),
    );
  }
  return blockedReservation(
    "backend-invalid-response",
    failureRetryAfterSeconds,
  );
}

function bindBackendStartResult(
  result: PredictionV2AtomicBudgetStartResultV2,
  request: PredictionV2AtomicBudgetLeaseRequestV2,
  failureRetryAfterSeconds: number,
): PredictionV2BudgetLeaseTransitionResultV2 {
  if (!isBackendTransitionResultBound(result, request)) {
    return blockedTransition(
      "backend-invalid-response",
      failureRetryAfterSeconds,
    );
  }
  if (result.status === "started") {
    if (
      result.leaseOwnerToken !== request.ownerToken ||
      !isTimestamp(result.startedAtMs) ||
      typeof result.idempotentReplay !== "boolean"
    ) {
      return blockedTransition(
        "backend-invalid-response",
        failureRetryAfterSeconds,
      );
    }
    if (result.idempotentReplay) {
      // A replay proves consumption but never authorizes a second provider call.
      return blockedTransition(
        "lease-already-started",
        failureRetryAfterSeconds,
      );
    }
    return Object.freeze({
      status: "started" as const,
      startedAtMs: result.startedAtMs,
      providerWorkAuthorized: true as const,
      idempotentReplay: false as const,
    });
  }
  return blockedTransition(
    transitionFailureReason(result.status),
    failureRetryAfterSeconds,
  );
}

function bindBackendCommitResult(
  result: PredictionV2AtomicBudgetCommitResultV2,
  request: PredictionV2AtomicBudgetCommitRequestV2,
  failureRetryAfterSeconds: number,
): PredictionV2BudgetLeaseTransitionResultV2 {
  if (!isBackendTransitionResultBound(result, request)) {
    return blockedTransition(
      "backend-invalid-response",
      failureRetryAfterSeconds,
    );
  }
  if (result.status === "committed") {
    if (
      result.leaseOwnerToken !== request.ownerToken ||
      result.resultFingerprint !== request.resultFingerprint ||
      !SHA256_KEY_PATTERN.test(result.resultFingerprint) ||
      !isTimestamp(result.committedAtMs) ||
      typeof result.idempotentReplay !== "boolean"
    ) {
      return blockedTransition(
        "backend-invalid-response",
        failureRetryAfterSeconds,
      );
    }
    return Object.freeze({
      status: "committed" as const,
      resultFingerprint: result.resultFingerprint,
      committedAtMs: result.committedAtMs,
      idempotentReplay: result.idempotentReplay,
    });
  }
  return blockedTransition(
    transitionFailureReason(result.status),
    failureRetryAfterSeconds,
  );
}

function bindBackendCancelResult(
  result: PredictionV2AtomicBudgetCancelResultV2,
  request: PredictionV2AtomicBudgetLeaseRequestV2,
  failureRetryAfterSeconds: number,
): PredictionV2BudgetLeaseTransitionResultV2 {
  if (!isBackendTransitionResultBound(result, request)) {
    return blockedTransition(
      "backend-invalid-response",
      failureRetryAfterSeconds,
    );
  }
  if (result.status === "canceled") {
    if (
      result.leaseOwnerToken !== request.ownerToken ||
      !isTimestamp(result.canceledAtMs) ||
      !Number.isSafeInteger(result.releasedUnits) ||
      result.releasedUnits < 0 ||
      typeof result.idempotentReplay !== "boolean" ||
      (result.idempotentReplay && result.releasedUnits !== 0)
    ) {
      return blockedTransition(
        "backend-invalid-response",
        failureRetryAfterSeconds,
      );
    }
    return Object.freeze({
      status: "canceled" as const,
      canceledAtMs: result.canceledAtMs,
      releasedUnits: result.releasedUnits,
      idempotentReplay: result.idempotentReplay,
    });
  }
  return blockedTransition(
    transitionFailureReason(result.status),
    failureRetryAfterSeconds,
  );
}

function isBackendReservationResultBound(
  result: PredictionV2AtomicBudgetBackendResultV2,
  request: PredictionV2AtomicBudgetRequestV2,
) {
  if (
    !result ||
    typeof result !== "object" ||
    result.operationKey !== request.operationKey ||
    result.requestFingerprint !== request.requestFingerprint
  ) {
    return false;
  }
  if (result.status === "reserved") {
    return (
      result.leaseOwnerToken === request.leaseOwnerToken &&
      result.reservedUnits === request.worstCaseUnits &&
      result.unit === request.unit &&
      SHA256_KEY_PATTERN.test(result.reservationId) &&
      isTimestamp(result.reservedAtMs) &&
      isTimestamp(result.expiresAtMs) &&
      result.expiresAtMs > result.reservedAtMs &&
      result.expiresAtMs - result.reservedAtMs <= request.reservationTtlMs &&
      result.idempotentReplay === false
    );
  }
  if (result.status === "in-progress") {
    return (
      SHA256_KEY_PATTERN.test(result.reservationId) &&
      isTimestamp(result.expiresAtMs) &&
      positiveDelay(result.retryAfterMs)
    );
  }
  if (result.status === "committed") {
    return (
      SHA256_KEY_PATTERN.test(result.reservationId) &&
      SHA256_KEY_PATTERN.test(result.resultFingerprint) &&
      isTimestamp(result.finalizedAtMs) &&
      result.idempotentReplay === true
    );
  }
  if (result.status === "canceled" || result.status === "expired") {
    return (
      SHA256_KEY_PATTERN.test(result.reservationId) &&
      isTimestamp(result.finalizedAtMs) &&
      result.idempotentReplay === true
    );
  }
  if (!("retryAfterMs" in result) || !positiveDelay(result.retryAfterMs)) {
    return false;
  }
  return result.status === "idempotency-conflict" ||
    (result.status === "rate-limited" &&
      typeof result.idempotentReplay === "boolean");
}

function isBackendTransitionResultBound(
  result:
    | PredictionV2AtomicBudgetStartResultV2
    | PredictionV2AtomicBudgetCommitResultV2
    | PredictionV2AtomicBudgetCancelResultV2,
  request: PredictionV2AtomicBudgetLeaseRequestV2,
) {
  return Boolean(
    result &&
    typeof result === "object" &&
    result.operationKey === request.operationKey &&
    result.requestFingerprint === request.requestFingerprint &&
    result.reservationId === request.reservationId,
  );
}

function existingReserveResult(
  record: InMemoryOperationRecord,
  request: PredictionV2AtomicBudgetRequestV2,
  currentTimeMs: number,
): PredictionV2AtomicBudgetBackendResultV2 {
  const binding = {
    operationKey: request.operationKey,
    requestFingerprint: request.requestFingerprint,
  };
  if (record.requestFingerprint !== request.requestFingerprint) {
    return Object.freeze({
      ...binding,
      status: "idempotency-conflict" as const,
      retryAfterMs: Math.max(1, record.retentionExpiresAtMs - currentTimeMs),
    });
  }
  if (record.kind === "rate-limited") {
    return Object.freeze({
      ...binding,
      status: "rate-limited" as const,
      retryAfterMs: Math.max(1, record.retentionExpiresAtMs - currentTimeMs),
      idempotentReplay: true,
    });
  }
  if (
    record.state === "reserved" &&
    record.leaseExpiresAtMs <= currentTimeMs
  ) {
    expireLease(record, currentTimeMs);
  }
  if (record.state === "reserved") {
    return Object.freeze({
      ...binding,
      status: "in-progress" as const,
      reservationId: record.reservationId,
      expiresAtMs: record.leaseExpiresAtMs,
      retryAfterMs: Math.max(1, record.leaseExpiresAtMs - currentTimeMs),
    });
  }
  if (record.state === "started") {
    return Object.freeze({
      ...binding,
      status: "in-progress" as const,
      reservationId: record.reservationId,
      expiresAtMs: record.retentionExpiresAtMs,
      retryAfterMs: Math.max(
        1,
        record.retentionExpiresAtMs - currentTimeMs,
      ),
    });
  }
  if (record.state === "committed") {
    return Object.freeze({
      ...binding,
      status: "committed" as const,
      reservationId: record.reservationId,
      resultFingerprint: record.resultFingerprint!,
      finalizedAtMs: record.finalizedAtMs!,
      idempotentReplay: true,
    });
  }
  return Object.freeze({
    ...binding,
    status: record.state,
    reservationId: record.reservationId,
    finalizedAtMs: record.finalizedAtMs!,
    idempotentReplay: true,
  });
}

function expireLease(record: InMemoryLeaseRecord, currentTimeMs: number) {
  record.state = "expired";
  record.finalizedAtMs = currentTimeMs;
  // Keep unstarted expiry conservative until the fixed bucket window rolls.
}

function purgeExpiredOperations(
  records: Map<string, InMemoryOperationRecord>,
  currentTimeMs: number,
) {
  for (const [key, record] of records) {
    if (record.retentionExpiresAtMs <= currentTimeMs) records.delete(key);
  }
}

function budgetOperationKey(
  provider: string,
  action: string,
  idempotencyKey: string,
) {
  return sha256Key([
    OPERATION_KEY_DOMAIN,
    provider,
    action,
    idempotencyKey,
  ].join("\n"));
}

function atomicRequestFingerprint(
  request: Omit<
    PredictionV2AtomicBudgetRequestV2,
    "schemaVersion" | "requestFingerprint" | "leaseOwnerToken"
  >,
) {
  return sha256Key([
    REQUEST_FINGERPRINT_DOMAIN,
    request.operationKey,
    request.provider,
    request.action,
    request.clientScopeKey,
    request.idempotencyKey,
    request.unit,
    request.worstCaseUnits,
    request.reservationTtlMs,
    request.idempotencyTtlMs,
    ...request.scopes.flatMap((scope) => [
      scope.scope,
      scope.key,
      scope.capacityUnits,
      scope.windowMs,
    ]),
  ].join("\n"));
}

function validateAtomicRequest(request: PredictionV2AtomicBudgetRequestV2) {
  if (
    request.schemaVersion !==
      PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION ||
    !IDENTIFIER_PATTERN.test(request.provider) ||
    !IDENTIFIER_PATTERN.test(request.action) ||
    !IDENTIFIER_PATTERN.test(request.unit) ||
    !SHA256_KEY_PATTERN.test(request.operationKey) ||
    !SHA256_KEY_PATTERN.test(request.requestFingerprint) ||
    !SHA256_KEY_PATTERN.test(request.leaseOwnerToken) ||
    !SHA256_KEY_PATTERN.test(request.clientScopeKey) ||
    !SHA256_KEY_PATTERN.test(request.idempotencyKey) ||
    request.operationKey !== budgetOperationKey(
      request.provider,
      request.action,
      request.idempotencyKey,
    ) ||
    request.scopes.length !== 3 ||
    request.scopes[0]?.scope !== "provider" ||
    request.scopes[1]?.scope !== "action" ||
    request.scopes[2]?.scope !== "client" ||
    request.scopes[0].key !== `provider:${request.provider}` ||
    request.scopes[1].key !== `action:${request.provider}:${request.action}` ||
    request.scopes[2].key !==
      `client:${request.provider}:${request.action}:${request.clientScopeKey}` ||
    request.requestFingerprint !== atomicRequestFingerprint(request)
  ) {
    throw new TypeError("Invalid Prediction V2 atomic budget request");
  }
}

function validateLeaseRequest(request: PredictionV2AtomicBudgetLeaseRequestV2) {
  if (
    request.schemaVersion !==
      PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION ||
    !SHA256_KEY_PATTERN.test(request.operationKey) ||
    !SHA256_KEY_PATTERN.test(request.requestFingerprint) ||
    !SHA256_KEY_PATTERN.test(request.reservationId) ||
    !SHA256_KEY_PATTERN.test(request.ownerToken)
  ) {
    throw new TypeError("Invalid Prediction V2 budget lease request");
  }
}

function validateCommitRequest(request: PredictionV2AtomicBudgetCommitRequestV2) {
  validateLeaseRequest(request);
  if (!SHA256_KEY_PATTERN.test(request.resultFingerprint)) {
    throw new TypeError("Invalid Prediction V2 budget result fingerprint");
  }
}

function isReservationInput(
  input: PredictionV2BudgetReservationInputV2,
): input is PredictionV2BudgetReservationInputV2 {
  return Boolean(
    input &&
    typeof input === "object" &&
    IDENTIFIER_PATTERN.test(input.provider) &&
    IDENTIFIER_PATTERN.test(input.action) &&
    SHA256_KEY_PATTERN.test(input.clientScopeKey) &&
    SHA256_KEY_PATTERN.test(input.idempotencyKey),
  );
}

function isCommitInput(
  input: PredictionV2BudgetCommitInputV2,
): input is PredictionV2BudgetCommitInputV2 {
  return Boolean(
    input &&
    typeof input === "object" &&
    isLease(input.lease) &&
    SHA256_KEY_PATTERN.test(input.resultFingerprint),
  );
}

function isCancelInput(
  input: PredictionV2BudgetCancelInputV2,
): input is PredictionV2BudgetCancelInputV2 {
  return Boolean(input && typeof input === "object" && isLease(input.lease));
}

function isLease(lease: PredictionV2BudgetLeaseV2) {
  return Boolean(
    lease &&
    typeof lease === "object" &&
    lease.schemaVersion === PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION &&
    IDENTIFIER_PATTERN.test(lease.provider) &&
    IDENTIFIER_PATTERN.test(lease.action) &&
    SHA256_KEY_PATTERN.test(lease.operationKey) &&
    SHA256_KEY_PATTERN.test(lease.requestFingerprint) &&
    SHA256_KEY_PATTERN.test(lease.reservationId) &&
    SHA256_KEY_PATTERN.test(lease.ownerToken) &&
    isTimestamp(lease.expiresAtMs),
  );
}

async function invokeBackendWithTimeout<T>(
  timeoutMs: number,
  invoke: (invocation: PredictionV2BudgetBackendInvocationV2) => Promise<T>,
): Promise<
  | Readonly<{ status: "success"; value: T }>
  | Readonly<{ status: "timeout" }>
  | Readonly<{ status: "failure" }>
> {
  const controller = new AbortController();
  const deadlineAtMs = safeTimestampAdd(Date.now(), timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(BACKEND_TIMEOUT);
    }, Math.max(0, deadlineAtMs - Date.now()));
    timer.unref?.();
  });
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => invoke(Object.freeze({
        deadlineAtMs,
        signal: controller.signal,
      }))),
      timeout,
    ]);
    return Object.freeze({ status: "success" as const, value });
  } catch (error) {
    if (error === BACKEND_TIMEOUT) {
      return Object.freeze({ status: "timeout" as const });
    }
    return Object.freeze({ status: "failure" as const });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function assertInvocationActive(
  invocation: PredictionV2BudgetBackendInvocationV2,
) {
  if (
    !invocation ||
    typeof invocation !== "object" ||
    !isTimestamp(invocation.deadlineAtMs) ||
    !(invocation.signal instanceof AbortSignal) ||
    invocation.signal.aborted ||
    Date.now() >= invocation.deadlineAtMs
  ) {
    throw new Error("Prediction V2 budget backend invocation expired");
  }
}

function transitionBinding(request: PredictionV2AtomicBudgetLeaseRequestV2) {
  return {
    operationKey: request.operationKey,
    requestFingerprint: request.requestFingerprint,
    reservationId: request.reservationId,
  };
}

function transitionFailureReason(
  status:
    | "owner-mismatch"
    | "not-found"
    | "lease-expired"
    | "invalid-transition",
): PredictionV2BudgetBlockedReasonV2 {
  if (status === "owner-mismatch") return "lease-owner-mismatch";
  if (status === "not-found") return "lease-not-found";
  if (status === "lease-expired") return "lease-expired";
  return "lease-transition-conflict";
}

function blockedReservation(
  reason: PredictionV2BudgetBlockedReasonV2,
  retryAfterSeconds: number,
): PredictionV2BudgetReservationResultV2 {
  return Object.freeze({
    status: "blocked" as const,
    reason,
    retryAfterSeconds,
  });
}

function blockedTransition(
  reason: PredictionV2BudgetBlockedReasonV2,
  retryAfterSeconds: number,
): PredictionV2BudgetLeaseTransitionResultV2 {
  return Object.freeze({
    status: "blocked" as const,
    reason,
    retryAfterSeconds,
  });
}

function budgetIdentifier(value: string, label: string) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase budget identifier`);
  }
  return value;
}

function laneKey(provider: string, action: string) {
  return `${provider}:${action}`;
}

function sha256Key(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function checkedNow(nowMs: () => number) {
  const value = nowMs();
  if (!isTimestamp(value)) {
    throw new TypeError("nowMs must return a non-negative safe integer");
  }
  return value;
}

function isTimestamp(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveDelay(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function safeTimestampAdd(timestamp: number, duration: number) {
  const result = timestamp + duration;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError("Prediction V2 budget timestamp overflow");
  }
  return result;
}

function positiveInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${label} must be a safe integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}
