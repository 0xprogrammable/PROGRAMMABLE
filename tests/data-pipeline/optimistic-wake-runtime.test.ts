import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRealBlockSlaFirstStageHooks,
  recordSlaReceipts,
  runRealBlockSlaAwareFirstStage,
} from "../../lib/data-pipeline/optimistic-wake-runtime.server";
import type { OptimisticPersistenceBundle } from "../../lib/data-pipeline/optimistic-live-runtime.server";
import type {
  PostgresExecutor,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";
import type { RealBlockSlaCaptureTarget } from "../../lib/data-pipeline/read-model-real-block-sla-capture.server";
import {
  drainQuickNodeWakeQueue,
  processDurableWakeJob,
  type QuickNodeWakeClaim,
} from "../../lib/data-pipeline/quicknode-wake-queue.server";

const TARGET: RealBlockSlaCaptureTarget = Object.freeze({
  deliveryReceiptId: "19",
  databaseReceivedAt: "2026-08-02T10:00:00.000Z",
  optimisticMarketStateId: "00000000-0000-4000-8000-000000000019",
  tokenAddress: `0x${"11".repeat(20)}`,
  deployment: Object.freeze({
    repositoryCommit: "a".repeat(40),
    deploymentId: "dpl_0123456789abcdefghij",
    deploymentOrigin: "https://programmable-stage.vercel.app",
    projectId: "prj_programmable",
  }),
});

function receiptBundle(): OptimisticPersistenceBundle {
  const head = Object.freeze({
    blockNumber: "100",
    blockHash: `0x${"22".repeat(32)}` as const,
    observedAt: "2026-08-02T10:00:00.000Z",
  });
  return {
    optimisticBlockId: "00000000-0000-4000-8000-000000000018",
    logsCommitment: `0x${"33".repeat(32)}`,
    providerHeadObservations: [head, head],
    providerCallCounts: [4, 4],
    metadataProviderCallCounts: [0, 0],
    marketStates: [{
      optimisticMarketStateId: TARGET.optimisticMarketStateId,
      providerHeadObservations: [head, head],
      marketProviderCallCounts: [7, 7],
      totalProviderCallCounts: [11, 11],
    }],
  } as unknown as OptimisticPersistenceBundle;
}

const RPC_ENV = Object.freeze({
  PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL:
    "https://eth-mainnet.g.alchemy.com/v2/alchemy-test-key",
  PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL:
    "https://programmable.ethereum.quiknode.pro/quicknode-test-token/",
});

describe("optimistic wake SLA capture plan", () => {
  it("adds no SLA sentinel work, receipts or self-fetch when the DB has no consumed arm", async () => {
    const record = vi.fn(async () => undefined);
    const capture = vi.fn(async () => undefined);
    const stageState = vi.fn(async () => ({ state: "needs-ingest" as const }));
    const hooks = createRealBlockSlaFirstStageHooks({
      deliveryReceiptId: null,
      stageState,
      record,
      capture,
    });

    expect(hooks.enabled).toBe(false);
    await hooks.record({ block: "normal" });
    expect(await hooks.finishCaptureIfReady()).toBe(false);
    expect(stageState).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("runs the SLA-only receipts and capture for the consumed 503 arm", async () => {
    const record = vi.fn(async () => undefined);
    const capture = vi.fn(async () => undefined);
    const stageState = vi.fn(async () => ({
      state: "needs-capture" as const,
      target: TARGET,
    }));
    const hooks = createRealBlockSlaFirstStageHooks({
      deliveryReceiptId: "19",
      stageState,
      record,
      capture,
    });
    const bundle = { block: "probe" };

    expect(hooks.enabled).toBe(true);
    await hooks.record(bundle);
    expect(await hooks.finishCaptureIfReady()).toBe(true);
    expect(record).toHaveBeenCalledWith(bundle);
    expect(stageState).toHaveBeenCalledWith("19");
    expect(capture).toHaveBeenCalledWith(TARGET);
  });

  it("resumes only public capture after a completed receipt group", async () => {
    const ingest = vi.fn(async () => ({ bundle: { block: "probe" } }));
    const record = vi.fn(async () => undefined);
    const capture = vi.fn()
      .mockRejectedValueOnce(new Error("public capture failed"))
      .mockResolvedValueOnce(undefined);
    const states = [
      { state: "needs-ingest" as const },
      { state: "needs-capture" as const, target: TARGET },
      { state: "needs-capture" as const, target: TARGET },
    ];
    const stageState = vi.fn(async () => states.shift()!);
    const sla = createRealBlockSlaFirstStageHooks({
      deliveryReceiptId: "19",
      stageState,
      record,
      capture,
    });

    await expect(runRealBlockSlaAwareFirstStage({ sla, ingest }))
      .rejects.toThrow("public capture failed");
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);

    await expect(runRealBlockSlaAwareFirstStage({ sla, ingest }))
      .resolves.toBe("capture-resumed");
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("drains the retry after a duplicate worker loses the processing race", async () => {
    let now = new Date("2026-08-02T10:00:00.000Z").valueOf();
    let availableAt = now;
    const deadlineAt = now + 1_000;
    let queueState: "pending" | "processing" | "delayed" | "completed" =
      "pending";
    let attemptCount = 0;
    const claim = (): QuickNodeWakeClaim => Object.freeze({
      wakeId: "7",
      deliveryReceiptId: "19",
      blockNumberHint: "100",
      hint: Object.freeze({
        chainId: 1 as const,
        blockNumber: "100",
        streamId: "stream-1",
        reorgedBlockNumbers: Object.freeze([]),
      }),
      payload: JSON.stringify({ block: { number: "0x64" } }),
      leaseGeneration: String(attemptCount),
      leaseExpiresAt: new Date(now + 5_000).toISOString(),
      attemptCount,
      workerId: "quicknode-wake-00000000-0000-4000-8000-000000000007",
      leaseTokenDigest: `0x${"77".repeat(32)}`,
    });
    const queue = {
      claim: vi.fn(async () => {
        if (
          (queueState !== "pending" && queueState !== "delayed") ||
          now < availableAt
        ) return null;
        queueState = "processing";
        attemptCount += 1;
        return claim();
      }),
      complete: vi.fn(async () => {
        queueState = "completed";
        return true;
      }),
      retry: vi.fn(async () => {
        queueState = "delayed";
        availableAt = now + 100;
        return true;
      }),
      retrySchedule: vi.fn(async () => ({
        availableAt: new Date(availableAt).toISOString(),
        deadlineAt: new Date(deadlineAt).toISOString(),
      })),
    };
    const clock = {
      now: () => now,
      sleep: vi.fn(async (delayMs: number) => {
        now += delayMs;
      }),
    };
    const states = [
      { state: "needs-ingest" as const },
      { state: "needs-capture" as const, target: TARGET },
      { state: "needs-capture" as const, target: TARGET },
    ];
    const ingest = vi.fn(async () => ({ bundle: { block: "probe" } }));
    const record = vi.fn(async () => undefined);
    let duplicateStatus: Awaited<ReturnType<typeof drainQuickNodeWakeQueue>> | null =
      null;
    const capture = vi.fn(async (_target: RealBlockSlaCaptureTarget) => {
      void _target;
      if (capture.mock.calls.length === 1) {
        duplicateStatus = await runDuplicateWorker();
        throw new Error("first public capture failed");
      }
    });
    const sla = createRealBlockSlaFirstStageHooks({
      deliveryReceiptId: "19",
      stageState: vi.fn(async () => states.shift()!),
      record,
      capture,
    });
    const canonicalCatchUp = vi.fn(async () => undefined);
    const work = (job: QuickNodeWakeClaim) => processDurableWakeJob(job, {
      firstStage: () => runRealBlockSlaAwareFirstStage({ sla, ingest })
        .then(() => undefined),
      canonicalCatchUp,
    });
    const runDuplicateWorker = () =>
      drainQuickNodeWakeQueue(queue, work, clock);

    await expect(drainQuickNodeWakeQueue(queue, work, clock))
      .resolves.toBe("completed");
    expect(duplicateStatus).toBe("idle");
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[0]?.[0]).toBe(TARGET);
    expect(capture.mock.calls[1]?.[0]).toBe(TARGET);
    expect(queue.retry).toHaveBeenCalledTimes(1);
    expect(queue.retrySchedule).toHaveBeenCalledWith("7");
    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(canonicalCatchUp).toHaveBeenCalledTimes(1);
    expect(queue.complete).toHaveBeenCalledTimes(1);
    expect(now).toBeLessThan(deadlineAt);
  });

  it("does not sleep or reclaim when the retry padding reaches the DB deadline", async () => {
    const deadlineAt = new Date("2026-08-02T10:00:01.000Z").valueOf();
    const now = deadlineAt - 20;
    const claim = {
      wakeId: "7",
      deliveryReceiptId: "19",
    } as QuickNodeWakeClaim;
    const queue = {
      claim: vi.fn()
        .mockResolvedValueOnce(claim)
        .mockResolvedValueOnce(null),
      complete: vi.fn(async () => true),
      retry: vi.fn(async () => true),
      retrySchedule: vi.fn(async () => ({
        availableAt: new Date(deadlineAt - 10).toISOString(),
        deadlineAt: new Date(deadlineAt).toISOString(),
      })),
    };
    const clock = {
      now: () => now,
      sleep: vi.fn(async () => undefined),
    };

    await expect(drainQuickNodeWakeQueue(
      queue,
      async () => {
        throw new Error("capture failed near deadline");
      },
      clock,
    )).resolves.toBe("retry-scheduled");
    expect(queue.claim).toHaveBeenCalledTimes(1);
    expect(clock.sleep).not.toHaveBeenCalled();
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it("treats a DB-complete capture as done without any fetch or write", async () => {
    const ingest = vi.fn(async () => ({ bundle: { block: "probe" } }));
    const record = vi.fn(async () => undefined);
    const capture = vi.fn(async () => undefined);
    const sla = createRealBlockSlaFirstStageHooks({
      deliveryReceiptId: "19",
      stageState: vi.fn(async () => ({ state: "complete" as const })),
      record,
      capture,
    });

    await expect(runRealBlockSlaAwareFirstStage({ sla, ingest }))
      .resolves.toBe("capture-resumed");
    expect(ingest).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("persists one atomic bundle and market receipt group", async () => {
    let transactionCount = 0;
    let commitCount = 0;
    const query = vi.fn(async (text: string, _values?: readonly unknown[]) => {
      void _values;
      if (text === "select session_user::text as session_user") {
        return [{ session_user: "programmable_projector_login" }];
      }
      if (text.includes("current_role::text as current_role")) {
        return [{
          session_user: "programmable_projector_login",
          current_role: "programmable_projector",
        }];
      }
      if (text.includes("record_optimistic_sla_receipt_group_v1")) {
        return [{ bundle_receipt_id: "23" }];
      }
      return [];
    });
    const executor: PostgresExecutor = {
      async transaction<T>(work: (transaction: PostgresTransaction) => Promise<T>) {
        transactionCount += 1;
        const result = await work({ query: query as PostgresTransaction["query"] });
        commitCount += 1;
        return result;
      },
      close: vi.fn(async () => undefined),
    };
    await recordSlaReceipts({
      executor,
      wakeId: "7",
      bundle: receiptBundle(),
      env: RPC_ENV,
    });

    expect(transactionCount).toBe(1);
    expect(commitCount).toBe(1);
    const groupCalls = query.mock.calls.filter(([text]) =>
      text.includes("record_optimistic_sla_receipt_group_v1"));
    expect(groupCalls).toHaveLength(1);
    expect(groupCalls[0]?.[1]).toHaveLength(16);
    expect(JSON.parse(String(groupCalls[0]?.[1]?.[15]))).toEqual([
      expect.objectContaining({
        optimisticMarketStateId: TARGET.optimisticMarketStateId,
        marketProviderCallCountA: 7,
        totalProviderCallCountB: 11,
      }),
    ]);
  });

  it("does not commit a partial receipt group when a market item is rejected", async () => {
    let commitCount = 0;
    let transactionCount = 0;
    const query = vi.fn(async (text: string) => {
      if (text === "select session_user::text as session_user") {
        return [{ session_user: "programmable_projector_login" }];
      }
      if (text.includes("current_role::text as current_role")) {
        return [{
          session_user: "programmable_projector_login",
          current_role: "programmable_projector",
        }];
      }
      if (text.includes("record_optimistic_sla_receipt_group_v1")) {
        throw Object.assign(new Error("market receipt rejected"), { code: "22023" });
      }
      return [];
    });
    const executor: PostgresExecutor = {
      async transaction<T>(work: (transaction: PostgresTransaction) => Promise<T>) {
        transactionCount += 1;
        const result = await work({ query: query as PostgresTransaction["query"] });
        commitCount += 1;
        return result;
      },
      close: vi.fn(async () => undefined),
    };

    await expect(recordSlaReceipts({
      executor,
      wakeId: "7",
      bundle: receiptBundle(),
      env: RPC_ENV,
    })).rejects.toBeDefined();
    expect(transactionCount).toBe(1);
    expect(commitCount).toBe(0);
  });
});
