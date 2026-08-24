import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_COMMITMENT_DOMAIN,
  PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_VERSION,
  PREDICTION_V2_DISTRIBUTED_BUDGET_RELEASE_STATE,
  assertPredictionV2DistributedBudgetRuntimeV2,
  createPredictionV2DistributedBudgetV2,
  createPredictionV2InMemoryBudgetBackendV2,
  type PredictionV2AtomicBudgetBackendV2,
  type PredictionV2AtomicBudgetRequestV2,
  type PredictionV2BudgetLaneV2,
  type PredictionV2BudgetLeaseV2,
} from "../lib/prediction-v2/distributed-budget-v2.server";

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const SHARED_BACKEND_ID = digest("shared-budget-backend:test");

function lane(
  overrides: Partial<PredictionV2BudgetLaneV2> = {},
): PredictionV2BudgetLaneV2 {
  return {
    provider: "dexscreener",
    action: "custom-asset-discovery",
    unit: "http-calls",
    worstCaseUnits: 4,
    reservationTtlMs: 5_000,
    idempotencyTtlMs: 60_000,
    limits: {
      provider: { capacityUnits: 8, windowMs: 60_000 },
      action: { capacityUnits: 8, windowMs: 60_000 },
      client: { capacityUnits: 4, windowMs: 60_000 },
    },
    ...overrides,
  };
}

function reservationInput(label: string) {
  return {
    provider: "dexscreener",
    action: "custom-asset-discovery",
    clientScopeKey: digest(`client:${label}`),
    idempotencyKey: digest(`request:${label}`),
  };
}

function missingTransitionBackendResult(
  request: {
    operationKey: string;
    requestFingerprint: string;
    reservationId: string;
  },
) {
  return {
    status: "not-found" as const,
    operationKey: request.operationKey,
    requestFingerprint: request.requestFingerprint,
    reservationId: request.reservationId,
  };
}

function backendWithReserve(
  reserveAtomic: PredictionV2AtomicBudgetBackendV2["reserveAtomic"],
): PredictionV2AtomicBudgetBackendV2 {
  return {
    scope: "shared-atomic",
    backendIdCommitment: SHARED_BACKEND_ID,
    reserveAtomic,
    async markStartedAtomic(request) {
      return missingTransitionBackendResult(request);
    },
    async commitAtomic(request) {
      return missingTransitionBackendResult(request);
    },
    async cancelAtomic(request) {
      return missingTransitionBackendResult(request);
    },
  };
}

function grant(request: PredictionV2AtomicBudgetRequestV2) {
  const reservedAtMs = Date.now();
  return {
    status: "reserved" as const,
    operationKey: request.operationKey,
    requestFingerprint: request.requestFingerprint,
    reservationId: digest(`reservation:${request.operationKey}`),
    leaseOwnerToken: request.leaseOwnerToken,
    reservedUnits: request.worstCaseUnits,
    unit: request.unit,
    reservedAtMs,
    expiresAtMs: reservedAtMs + request.reservationTtlMs,
    idempotentReplay: false as const,
  };
}

function expectReservedLease(
  result: Awaited<ReturnType<
    ReturnType<typeof createPredictionV2DistributedBudgetV2>["reserveWorstCase"]
  >>,
): PredictionV2BudgetLeaseV2 {
  expect(result.status).toBe("reserved");
  if (result.status !== "reserved") {
    throw new Error(`Expected reserved, received ${result.status}`);
  }
  return result.lease;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Prediction V2 distributed provider budget", () => {
  it("stays release-dark and fails closed without a configured backend", async () => {
    const budget = createPredictionV2DistributedBudgetV2({ lanes: [lane()] });

    expect(budget.readiness).toEqual({
      releaseState: PREDICTION_V2_DISTRIBUTED_BUDGET_RELEASE_STATE,
      backendScope: "unconfigured",
      productionReady: false,
    });
    expect(budget.runtimePolicyProjection().backend).toEqual({
      scope: "unconfigured",
      backendIdCommitment: null,
    });
    await expect(budget.reserveWorstCase(reservationInput("a"))).resolves.toEqual({
      status: "blocked",
      reason: "unconfigured-backend",
      retryAfterSeconds: 30,
    });
    expect(() => assertPredictionV2DistributedBudgetRuntimeV2(budget))
      .not.toThrow();
    expect(() => assertPredictionV2DistributedBudgetRuntimeV2({
      ...budget,
    })).toThrow("Untrusted Prediction V2 distributed budget runtime");
  });

  it("exports a deterministic, sorted and secret-free runtime policy projection", () => {
    const rpcLane = lane({
      provider: "alchemy-robinhood-rpc",
      action: "market-snapshot",
      unit: "compute-units",
      worstCaseUnits: 11,
      reservationTtlMs: 4_000,
      limits: {
        provider: { capacityUnits: 1_000, windowMs: 60_000 },
        action: { capacityUnits: 500, windowMs: 60_000 },
        client: { capacityUnits: 55, windowMs: 60_000 },
      },
    });
    const backend = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
    });
    const first = createPredictionV2DistributedBudgetV2({
      lanes: [lane(), rpcLane],
      backend,
      backendTimeoutMs: 2_500,
    });
    const reordered = createPredictionV2DistributedBudgetV2({
      lanes: [rpcLane, lane()],
      backend,
      backendTimeoutMs: 2_500,
    });

    const projection = first.runtimePolicyProjection();
    expect(projection).toEqual({
      schemaVersion: 2,
      backend: {
        scope: "single-runtime-test",
        backendIdCommitment: backend.backendIdCommitment,
      },
      policy: {
        version: PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_VERSION,
        backendTimeoutMs: 2_500,
      },
      lanes: [
        {
          laneId: "alchemy-robinhood-rpc:market-snapshot",
          provider: "alchemy-robinhood-rpc",
          action: "market-snapshot",
          unit: "compute-units",
          exactUnitsPerAction: 11,
          leaseTtlMs: 4_000,
          idempotencyTtlMs: 60_000,
          capacities: rpcLane.limits,
        },
        {
          laneId: "dexscreener:custom-asset-discovery",
          provider: "dexscreener",
          action: "custom-asset-discovery",
          unit: "http-calls",
          exactUnitsPerAction: 4,
          leaseTtlMs: 5_000,
          idempotencyTtlMs: 60_000,
          capacities: lane().limits,
        },
      ],
    });
    expect(first.runtimePolicyCommitment()).toBe(
      reordered.runtimePolicyCommitment(),
    );
    expect(first.runtimePolicyCommitment()).toBe(digest(
      `${PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_COMMITMENT_DOMAIN}\n${JSON.stringify(projection)}`,
    ));
    expect(JSON.stringify(projection)).not.toContain("client:");
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.lanes)).toBe(true);
  });

  it("fails closed for an unconfigured lane without calling the backend", async () => {
    const reserveAtomic = vi.fn();
    const backend = backendWithReserve(reserveAtomic);
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
      backendFailureRetryAfterSeconds: 17,
    });

    await expect(budget.reserveWorstCase({
      ...reservationInput("a"),
      action: "unknown-action",
    })).resolves.toEqual({
      status: "blocked",
      reason: "unconfigured-lane",
      retryAfterSeconds: 17,
    });
    expect(reserveAtomic).not.toHaveBeenCalled();
  });

  it("pins worst-case units, all scopes, an owner token and an absolute deadline", async () => {
    let captured: PredictionV2AtomicBudgetRequestV2 | undefined;
    let capturedDeadline = 0;
    let capturedSignal: AbortSignal | undefined;
    const backend = backendWithReserve(async (request, invocation) => {
      captured = request;
      capturedDeadline = invocation.deadlineAtMs;
      capturedSignal = invocation.signal;
      return grant(request);
    });
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
      backendTimeoutMs: 1_000,
    });
    const callerInput = {
      ...reservationInput("a"),
      // Untrusted callers cannot lower the configured cost with an extra key.
      worstCaseUnits: 1,
    };
    const startedAt = Date.now();
    const result = await budget.reserveWorstCase(callerInput);

    const lease = expectReservedLease(result);
    expect(result).toMatchObject({
      status: "reserved",
      unit: "http-calls",
      reservedUnits: 4,
      idempotentReplay: false,
    });
    expect(captured).toMatchObject({
      provider: "dexscreener",
      action: "custom-asset-discovery",
      unit: "http-calls",
      worstCaseUnits: 4,
      reservationTtlMs: 5_000,
      idempotencyTtlMs: 60_000,
      scopes: [
        {
          scope: "provider",
          key: "provider:dexscreener",
          capacityUnits: 8,
          windowMs: 60_000,
        },
        {
          scope: "action",
          key: "action:dexscreener:custom-asset-discovery",
          capacityUnits: 8,
          windowMs: 60_000,
        },
        {
          scope: "client",
          key: `client:dexscreener:custom-asset-discovery:${callerInput.clientScopeKey}`,
          capacityUnits: 4,
          windowMs: 60_000,
        },
      ],
    });
    expect(captured?.operationKey).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(captured?.requestFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(captured?.leaseOwnerToken).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(lease.ownerToken).toBe(captured?.leaseOwnerToken);
    expect(capturedDeadline).toBeGreaterThanOrEqual(startedAt + 900);
    expect(capturedDeadline).toBeLessThanOrEqual(startedAt + 1_100);
    expect(capturedSignal?.aborted).toBe(false);
  });

  it("authorizes exactly one owner for concurrent identical keys", async () => {
    let now = 10_000;
    const backend = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
      nowMs: () => now,
    });
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
    });

    const results = await Promise.all([
      budget.reserveWorstCase(reservationInput("same")),
      budget.reserveWorstCase(reservationInput("same")),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual([
      "in-progress",
      "reserved",
    ]);
    const ownerResults = results.filter((result) => result.status === "reserved");
    expect(ownerResults).toHaveLength(1);
    if (ownerResults[0]?.status !== "reserved") throw new Error("missing owner");
    expect(ownerResults[0].lease.ownerToken).toMatch(/^sha256:[0-9a-f]{64}$/u);

    now = 15_001;
    await expect(budget.reserveWorstCase(reservationInput("same"))).resolves
      .toMatchObject({ status: "replay", outcome: "expired" });
  });

  it("authorizes provider work only on the first atomic start transition", async () => {
    const backend = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
      nowMs: () => 10_000,
    });
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
    });
    const lease = expectReservedLease(
      await budget.reserveWorstCase(reservationInput("start-once")),
    );

    const starts = await Promise.all([
      budget.markLeaseStarted({ lease }),
      budget.markLeaseStarted({ lease }),
    ]);
    expect(starts.filter((result) => result.status === "started")).toEqual([{
      status: "started",
      startedAtMs: 10_000,
      providerWorkAuthorized: true,
      idempotentReplay: false,
    }]);
    expect(starts.filter((result) => result.status === "blocked"))
      .toEqual([{
        status: "blocked",
        reason: "lease-already-started",
        retryAfterSeconds: 30,
      }]);
    await expect(budget.cancelLease({ lease })).resolves.toMatchObject({
      status: "blocked",
      reason: "lease-transition-conflict",
    });
  });

  it("never refunds or authorizes work after an ambiguous late start", async () => {
    const tightLane = lane({
      limits: {
        provider: { capacityUnits: 4, windowMs: 60_000 },
        action: { capacityUnits: 4, windowMs: 60_000 },
        client: { capacityUnits: 4, windowMs: 60_000 },
      },
    });
    const inner = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
      nowMs: () => 10_000,
    });
    let releaseLateStart!: () => void;
    const lateGate = new Promise<void>((resolve) => {
      releaseLateStart = resolve;
    });
    let firstStart = true;
    const backend: PredictionV2AtomicBudgetBackendV2 = {
      ...inner,
      async markStartedAtomic(request, invocation) {
        const result = await inner.markStartedAtomic(request, invocation);
        if (firstStart) {
          firstStart = false;
          await lateGate;
        }
        return result;
      },
    };
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [tightLane],
      backend,
      backendTimeoutMs: 10,
    });
    const lease = expectReservedLease(
      await budget.reserveWorstCase(reservationInput("late-start")),
    );

    await expect(budget.markLeaseStarted({ lease })).resolves.toEqual({
      status: "blocked",
      reason: "backend-timeout",
      retryAfterSeconds: 30,
    });
    releaseLateStart();
    await Promise.resolve();
    await expect(budget.markLeaseStarted({ lease })).resolves.toEqual({
      status: "blocked",
      reason: "lease-already-started",
      retryAfterSeconds: 30,
    });
    await expect(budget.cancelLease({ lease })).resolves.toMatchObject({
      status: "blocked",
      reason: "lease-transition-conflict",
    });
    await expect(budget.reserveWorstCase(reservationInput("after-late-start")))
      .resolves.toMatchObject({ status: "rate-limited" });
  });

  it("requires start before commit and permits completion after lease TTL", async () => {
    let now = 10_000;
    const backend = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
      nowMs: () => now,
    });
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
    });
    const lease = expectReservedLease(
      await budget.reserveWorstCase(reservationInput("long-provider")),
    );
    const resultFingerprint = digest("long-provider-result");

    await expect(budget.commitLease({ lease, resultFingerprint })).resolves
      .toMatchObject({
        status: "blocked",
        reason: "lease-transition-conflict",
      });
    await expect(budget.markLeaseStarted({ lease })).resolves.toMatchObject({
      status: "started",
      providerWorkAuthorized: true,
    });
    now = 20_000;
    await expect(budget.commitLease({ lease, resultFingerprint })).resolves
      .toMatchObject({ status: "committed", committedAtMs: 20_000 });
  });

  it("keeps capacity consumed across an ambiguous late commit", async () => {
    const inner = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
      nowMs: () => 10_000,
    });
    let releaseLateCommit!: () => void;
    const lateGate = new Promise<void>((resolve) => {
      releaseLateCommit = resolve;
    });
    let firstCommit = true;
    const backend: PredictionV2AtomicBudgetBackendV2 = {
      ...inner,
      async commitAtomic(request, invocation) {
        const result = await inner.commitAtomic(request, invocation);
        if (firstCommit) {
          firstCommit = false;
          await lateGate;
        }
        return result;
      },
    };
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
      backendTimeoutMs: 10,
    });
    const lease = expectReservedLease(
      await budget.reserveWorstCase(reservationInput("late-commit")),
    );
    await budget.markLeaseStarted({ lease });
    const resultFingerprint = digest("late-commit-result");

    await expect(budget.commitLease({ lease, resultFingerprint })).resolves
      .toMatchObject({ status: "blocked", reason: "backend-timeout" });
    releaseLateCommit();
    await Promise.resolve();
    await expect(budget.cancelLease({ lease })).resolves.toMatchObject({
      status: "blocked",
      reason: "lease-transition-conflict",
    });
    await expect(budget.commitLease({ lease, resultFingerprint })).resolves
      .toMatchObject({ status: "committed", idempotentReplay: true });
  });

  it("scopes idempotency to provider/action and rejects a changed client binding", async () => {
    const backend = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
      nowMs: () => 10_000,
    });
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
    });
    const original = reservationInput("operation");
    await expect(budget.reserveWorstCase(original)).resolves
      .toMatchObject({ status: "reserved" });

    await expect(budget.reserveWorstCase({
      ...original,
      clientScopeKey: digest("different-client"),
    })).resolves.toEqual({
      status: "blocked",
      reason: "idempotency-conflict",
      retryAfterSeconds: 60,
    });
  });

  it("reserves provider, action and client limits all-or-none", async () => {
    let now = 10_000;
    const backend = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
      nowMs: () => now,
    });
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
    });

    await expect(budget.reserveWorstCase(reservationInput("a"))).resolves
      .toMatchObject({ status: "reserved" });
    await expect(budget.reserveWorstCase(reservationInput("a"))).resolves
      .toMatchObject({ status: "in-progress" });
    await expect(budget.reserveWorstCase({
      ...reservationInput("a"),
      idempotencyKey: digest("request:a-2"),
    })).resolves.toMatchObject({
      status: "rate-limited",
      retryAfterSeconds: 50,
    });

    // The rejected client-A request must not have charged provider/action.
    await expect(budget.reserveWorstCase(reservationInput("b"))).resolves
      .toMatchObject({ status: "reserved" });
    await expect(budget.reserveWorstCase(reservationInput("c"))).resolves
      .toMatchObject({ status: "rate-limited", retryAfterSeconds: 50 });

    now = 60_000;
    await expect(budget.reserveWorstCase({
      ...reservationInput("c"),
      idempotencyKey: digest("request:c-after-window"),
    })).resolves.toMatchObject({ status: "reserved" });
  });

  it("aborts an absolute backend timeout and fails closed", async () => {
    let observedSignal: AbortSignal | undefined;
    let observedDeadline = 0;
    const backend = backendWithReserve(async (_request, invocation) => {
      observedSignal = invocation.signal;
      observedDeadline = invocation.deadlineAtMs;
      return await new Promise<never>(() => undefined);
    });
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
      backendTimeoutMs: 10,
      backendFailureRetryAfterSeconds: 7,
    });

    await expect(budget.reserveWorstCase(reservationInput("timeout"))).resolves
      .toEqual({
        status: "blocked",
        reason: "backend-timeout",
        retryAfterSeconds: 7,
      });
    expect(observedDeadline).toBeGreaterThan(0);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("ignores late completion and a retry cannot obtain a second owner lease", async () => {
    const inner = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
      nowMs: () => 10_000,
    });
    let releaseLateResult!: () => void;
    const lateGate = new Promise<void>((resolve) => {
      releaseLateResult = resolve;
    });
    let first = true;
    const backend: PredictionV2AtomicBudgetBackendV2 = {
      ...inner,
      async reserveAtomic(request, invocation) {
        const result = await inner.reserveAtomic(request, invocation);
        if (first) {
          first = false;
          await lateGate;
        }
        return result;
      },
    };
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
      backendTimeoutMs: 10,
    });

    const firstResult = await budget.reserveWorstCase(reservationInput("late"));
    expect(firstResult).toMatchObject({
      status: "blocked",
      reason: "backend-timeout",
    });
    releaseLateResult();
    await Promise.resolve();

    await expect(budget.reserveWorstCase(reservationInput("late"))).resolves
      .toMatchObject({ status: "in-progress" });
    expect(firstResult).toMatchObject({
      status: "blocked",
      reason: "backend-timeout",
    });
  });

  it("rejects an owner mismatch without exposing or consuming the true owner", async () => {
    const backend = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
      nowMs: () => 10_000,
    });
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
    });
    const lease = expectReservedLease(
      await budget.reserveWorstCase(reservationInput("owner")),
    );
    const wrongLease = { ...lease, ownerToken: digest("wrong-owner") };

    await expect(budget.markLeaseStarted({ lease: wrongLease })).resolves
      .toEqual({
        status: "blocked",
        reason: "lease-owner-mismatch",
        retryAfterSeconds: 30,
      });
    await expect(budget.commitLease({
      lease: wrongLease,
      resultFingerprint: digest("provider-result"),
    })).resolves.toEqual({
      status: "blocked",
      reason: "lease-owner-mismatch",
      retryAfterSeconds: 30,
    });
    await expect(budget.cancelLease({ lease: wrongLease })).resolves.toEqual({
      status: "blocked",
      reason: "lease-owner-mismatch",
      retryAfterSeconds: 30,
    });
    await expect(budget.markLeaseStarted({ lease })).resolves.toEqual({
      status: "started",
      startedAtMs: 10_000,
      providerWorkAuthorized: true,
      idempotentReplay: false,
    });
    await expect(budget.commitLease({
      lease,
      resultFingerprint: digest("provider-result"),
    })).resolves.toMatchObject({ status: "committed" });
  });

  it("replays a committed result without reauthorizing provider work", async () => {
    const backend = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
      nowMs: () => 10_000,
    });
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
    });
    const input = reservationInput("commit");
    const lease = expectReservedLease(await budget.reserveWorstCase(input));
    const resultFingerprint = digest("stored-provider-result");

    await expect(budget.markLeaseStarted({ lease })).resolves.toMatchObject({
      status: "started",
      providerWorkAuthorized: true,
    });
    await expect(budget.commitLease({ lease, resultFingerprint })).resolves
      .toEqual({
        status: "committed",
        resultFingerprint,
        committedAtMs: 10_000,
        idempotentReplay: false,
      });
    await expect(budget.commitLease({ lease, resultFingerprint })).resolves
      .toMatchObject({ status: "committed", idempotentReplay: true });
    await expect(budget.commitLease({
      lease,
      resultFingerprint: digest("different-result"),
    })).resolves.toMatchObject({
      status: "blocked",
      reason: "lease-transition-conflict",
    });
    await expect(budget.reserveWorstCase(input)).resolves.toEqual({
      status: "replay",
      provider: input.provider,
      action: input.action,
      outcome: "committed",
      resultFingerprint,
      finalizedAtMs: 10_000,
    });
  });

  it("cancels exactly once and never double-releases capacity", async () => {
    const tightLane = lane({
      limits: {
        provider: { capacityUnits: 4, windowMs: 60_000 },
        action: { capacityUnits: 4, windowMs: 60_000 },
        client: { capacityUnits: 4, windowMs: 60_000 },
      },
    });
    const backend = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
      nowMs: () => 10_000,
    });
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [tightLane],
      backend,
    });
    const lease = expectReservedLease(
      await budget.reserveWorstCase(reservationInput("cancel")),
    );

    await expect(budget.cancelLease({ lease })).resolves.toEqual({
      status: "canceled",
      canceledAtMs: 10_000,
      releasedUnits: 4,
      idempotentReplay: false,
    });
    await expect(budget.cancelLease({ lease })).resolves.toEqual({
      status: "canceled",
      canceledAtMs: 10_000,
      releasedUnits: 0,
      idempotentReplay: true,
    });
    await expect(budget.reserveWorstCase(reservationInput("replacement")))
      .resolves.toMatchObject({ status: "reserved" });
    await expect(budget.reserveWorstCase(reservationInput("over-capacity")))
      .resolves.toMatchObject({ status: "rate-limited" });
  });

  it("does not release an expired lease", async () => {
    let now = 10_000;
    const tightLane = lane({
      limits: {
        provider: { capacityUnits: 4, windowMs: 60_000 },
        action: { capacityUnits: 4, windowMs: 60_000 },
        client: { capacityUnits: 4, windowMs: 60_000 },
      },
    });
    const backend = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
      nowMs: () => now,
    });
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [tightLane],
      backend,
    });
    const lease = expectReservedLease(
      await budget.reserveWorstCase(reservationInput("expired")),
    );
    now = 15_001;

    await expect(budget.cancelLease({ lease })).resolves.toMatchObject({
      status: "blocked",
      reason: "lease-expired",
    });
    await expect(budget.reserveWorstCase(reservationInput("new-work")))
      .resolves.toMatchObject({ status: "rate-limited" });
  });

  it("rounds backend capacity delays up to a Retry-After value", async () => {
    const backend = backendWithReserve(async (request) => ({
      status: "rate-limited",
      operationKey: request.operationKey,
      requestFingerprint: request.requestFingerprint,
      retryAfterMs: 1_001,
      idempotentReplay: false,
    }));
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
    });

    await expect(budget.reserveWorstCase(reservationInput("a"))).resolves.toEqual({
      status: "rate-limited",
      provider: "dexscreener",
      action: "custom-asset-discovery",
      retryAfterSeconds: 2,
      idempotentReplay: false,
    });
  });

  it("fails closed on backend exceptions and misbound owner grants", async () => {
    const throwingBudget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend: backendWithReserve(async () => {
        throw new Error("backend unavailable");
      }),
    });
    await expect(throwingBudget.reserveWorstCase(reservationInput("throw")))
      .resolves.toEqual({
        status: "blocked",
        reason: "backend-failure",
        retryAfterSeconds: 30,
      });

    const wrongOwnerBudget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend: backendWithReserve(async (request) => ({
        ...grant(request),
        leaseOwnerToken: digest("different-owner"),
      })),
    });
    await expect(wrongOwnerBudget.reserveWorstCase(reservationInput("wrong")))
      .resolves.toEqual({
        status: "blocked",
        reason: "backend-invalid-response",
        retryAfterSeconds: 30,
      });

    const misboundStartBackend: PredictionV2AtomicBudgetBackendV2 = {
      ...backendWithReserve(async (request) => grant(request)),
      async markStartedAtomic(request) {
        return {
          status: "started",
          operationKey: request.operationKey,
          requestFingerprint: request.requestFingerprint,
          reservationId: request.reservationId,
          leaseOwnerToken: digest("wrong-start-owner"),
          startedAtMs: Date.now(),
          idempotentReplay: false,
        };
      },
    };
    const misboundStartBudget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend: misboundStartBackend,
    });
    const lease = expectReservedLease(
      await misboundStartBudget.reserveWorstCase(reservationInput("start")),
    );
    await expect(misboundStartBudget.markLeaseStarted({ lease })).resolves
      .toEqual({
        status: "blocked",
        reason: "backend-invalid-response",
        retryAfterSeconds: 30,
      });
  });

  it("rejects raw client identity and idempotency values", async () => {
    const reserveAtomic = vi.fn();
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend: backendWithReserve(reserveAtomic),
    });

    await expect(budget.reserveWorstCase({
      provider: "dexscreener",
      action: "custom-asset-discovery",
      clientScopeKey: "203.0.113.10",
      idempotencyKey: "request-1",
    })).resolves.toEqual({
      status: "blocked",
      reason: "invalid-request",
      retryAfterSeconds: 30,
    });
    expect(reserveAtomic).not.toHaveBeenCalled();
  });

  it("keeps the in-memory adapter explicitly non-production", () => {
    const backend = createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "development",
    });
    const budget = createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend,
    });
    expect(backend.scope).toBe("single-runtime-test");
    expect(budget.readiness).toEqual({
      releaseState: "release-dark",
      backendScope: "single-runtime-test",
      productionReady: false,
    });

    vi.stubEnv("NODE_ENV", "production");
    expect(() => createPredictionV2InMemoryBudgetBackendV2({
      allowNonProduction: true,
      environment: "test",
    })).toThrow("forbidden in production");
  });

  it("rejects ambiguous or unsafe policy and backend configuration", () => {
    expect(() => createPredictionV2DistributedBudgetV2({
      lanes: [lane(), lane()],
    })).toThrow("Duplicate Prediction V2 budget lane");

    expect(() => createPredictionV2DistributedBudgetV2({
      lanes: [
        lane(),
        lane({ action: "market-profile", unit: "different-unit" }),
      ],
    })).toThrow("provider budget must be identical");

    expect(() => createPredictionV2DistributedBudgetV2({
      lanes: [lane({ reservationTtlMs: 60_001 })],
    })).toThrow("reservationTtlMs");
    expect(() => createPredictionV2DistributedBudgetV2({
      lanes: [lane({ idempotencyTtlMs: 59_999 })],
    })).toThrow("idempotencyTtlMs");
    expect(() => createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backendTimeoutMs: 30_001,
    })).toThrow("backendTimeoutMs");
    expect(() => createPredictionV2DistributedBudgetV2({
      lanes: [lane()],
      backend: {
        ...backendWithReserve(async (request) => grant(request)),
        backendIdCommitment: "shared-backend",
      },
    })).toThrow("Invalid Prediction V2 atomic budget backend");
  });
});
