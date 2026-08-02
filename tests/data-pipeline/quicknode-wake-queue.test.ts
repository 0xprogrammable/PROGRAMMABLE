import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  PostgresExecutor,
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";
import {
  createQuickNodeWakeQueue,
  processDurableWakeJob,
} from "../../lib/data-pipeline/quicknode-wake-queue.server";
import type { QuickNodeStreamWake } from "../../lib/data-pipeline/quicknode-stream-wake.server";

const NONCE_DIGEST = `0x${"11".repeat(32)}` as const;
const TOKEN_DIGEST = `0x${"22".repeat(32)}` as const;
const HINT = Object.freeze({
  chainId: 1 as const,
  blockNumber: "291",
  streamId: "stream-mainnet",
  reorgedBlockNumbers: Object.freeze(["290"]),
});
const PAYLOAD = JSON.stringify({
  data: [{ number: "0x123", hash: "0xabc" }],
});
const WAKE: QuickNodeStreamWake = Object.freeze({
  kind: "work",
  nonceDigest: NONCE_DIGEST,
  timestamp: "1785662400",
  hint: HINT,
  payload: PAYLOAD,
  payloadBytes: Buffer.byteLength(PAYLOAD, "utf8"),
});

class WakeExecutor implements PostgresExecutor {
  readonly queries: Array<{
    text: string;
    values: readonly PostgresParameter[];
  }> = [];
  readonly close = vi.fn(async () => undefined);
  sessionUser = "programmable_projector_runtime_login";
  enqueueAccepted = true;
  enqueueNew = true;
  claimGeneration = 1;
  claimed = true;

  async transaction<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly PostgresParameter[] = [],
      ) => {
        this.queries.push({ text, values });
        if (text === "select session_user::text as session_user") {
          return [{ session_user: this.sessionUser }] as unknown as Row[];
        }
        if (text.includes("current_setting('role', true)")) {
          return [{
            session_user: this.sessionUser,
            current_role: "programmable_projector_runtime",
            configured_role: "programmable_projector_runtime",
          }] as unknown as Row[];
        }
        if (text.includes("enqueue_quicknode_wake_v1")) {
          return [{
            accepted: this.enqueueAccepted,
            wake_id: this.enqueueAccepted ? "7" : null,
            enqueued: this.enqueueNew,
            block_number_hint: "291",
            job_state: this.enqueueAccepted
              ? this.enqueueNew ? "pending" : "processing"
              : "capacity",
          }] as unknown as Row[];
        }
        if (text.includes("claim_quicknode_wake_v1")) {
          if (!this.claimed) return [] as unknown as Row[];
          return [{
            wake_id: "7",
            block_number_hint: "291",
            block_hint: JSON.stringify(HINT),
            payload: PAYLOAD,
            lease_generation: String(this.claimGeneration),
            lease_expires_at: "2026-08-02T12:03:30.000Z",
            attempt_count: this.claimGeneration,
          }] as unknown as Row[];
        }
        if (text.includes("complete_quicknode_wake_v1")) {
          return [{ completed: true }] as unknown as Row[];
        }
        if (text.includes("retry_quicknode_wake_v1")) {
          return [{ retried: true }] as unknown as Row[];
        }
        return [] as unknown as Row[];
      },
    });
  }
}

function queue(executor: WakeExecutor) {
  return createQuickNodeWakeQueue({
    executor,
    uuid: () => "00000000-0000-4000-8000-000000000001",
    tokenDigest: () => TOKEN_DIGEST,
  });
}

describe("QuickNode durable wake queue runtime", () => {
  it("persists the signed marker before returning an enqueue result", async () => {
    const executor = new WakeExecutor();

    await expect(queue(executor).enqueue(WAKE)).resolves.toEqual({
      wakeId: "7",
      blockNumberHint: "291",
      enqueued: true,
      state: "pending",
    });
    expect(
      executor.queries.filter(({ text }) =>
        text === "set local role programmable_projector_runtime"
      ),
    ).toHaveLength(1);
    const enqueue = executor.queries.find(({ text }) =>
      text.includes("enqueue_quicknode_wake_v1")
    );
    expect(enqueue?.values.slice(0, 2)).toEqual([
      expect.any(Uint8Array),
      "291",
    ]);
    expect(enqueue?.values[2]).toBe(JSON.stringify(HINT));
    expect(enqueue?.values[4]).toBe(PAYLOAD);
    expect(enqueue?.values[5]).toEqual(expect.any(Uint8Array));
  });

  it("accepts a coalesced duplicate without creating another job", async () => {
    const executor = new WakeExecutor();
    executor.enqueueNew = false;

    await expect(queue(executor).enqueue(WAKE)).resolves.toMatchObject({
      wakeId: "7",
      enqueued: false,
      state: "processing",
    });
  });

  it("fails closed at hard capacity so the provider can retry", async () => {
    const executor = new WakeExecutor();
    executor.enqueueAccepted = false;

    await expect(queue(executor).enqueue(WAKE)).rejects.toMatchObject({
      dependency: "postgres",
      code: "dependency_unavailable",
      retryable: true,
    });
  });

  it("claims with a fence, completes atomically, and can explicitly retry", async () => {
    const executor = new WakeExecutor();
    const wakeQueue = queue(executor);

    const claim = await wakeQueue.claim();
    expect(claim).toMatchObject({
      wakeId: "7",
      leaseGeneration: "1",
      attemptCount: 1,
      workerId: "quicknode-wake-00000000-0000-4000-8000-000000000001",
      leaseTokenDigest: TOKEN_DIGEST,
      hint: HINT,
      payload: PAYLOAD,
    });
    await expect(wakeQueue.retry(claim!, 2_000)).resolves.toBe(true);
    await expect(wakeQueue.complete(claim!)).resolves.toBe(true);
  });

  it("can accept a higher-generation claim after a crashed worker lease", async () => {
    const executor = new WakeExecutor();
    const wakeQueue = queue(executor);
    const abandoned = await wakeQueue.claim();
    executor.claimGeneration = 2;
    const resumed = await wakeQueue.claim();

    expect(abandoned?.leaseGeneration).toBe("1");
    expect(resumed).toMatchObject({
      wakeId: "7",
      leaseGeneration: "2",
      attemptCount: 2,
    });
  });

  it("rejects the wrong database login before any queue function call", async () => {
    const executor = new WakeExecutor();
    executor.sessionUser = "programmable_projector_login";

    await expect(queue(executor).enqueue(WAKE)).rejects.toMatchObject({
      dependency: "postgres",
      code: "validation_failed",
    });
    expect(
      executor.queries.some(({ text }) =>
        text.includes("enqueue_quicknode_wake_v1")
      ),
    ).toBe(false);
  });

  it("runs the optimistic bridge before canonical catch-up", async () => {
    const claim = await queue(new WakeExecutor()).claim();
    expect(claim).not.toBeNull();
    const firstStage = vi.fn(async () => undefined);
    const canonicalCatchUp = vi.fn(async () => undefined);

    await processDurableWakeJob(claim!, { firstStage, canonicalCatchUp });

    expect(firstStage).toHaveBeenCalledWith(claim);
    expect(canonicalCatchUp).toHaveBeenCalledWith(claim);
    expect(firstStage.mock.invocationCallOrder[0]).toBeLessThan(
      canonicalCatchUp.mock.invocationCallOrder[0]!,
    );
  });

  it("does not run canonical catch-up when the optimistic bridge fails", async () => {
    const claim = await queue(new WakeExecutor()).claim();
    expect(claim).not.toBeNull();
    const firstStage = vi.fn(async () => {
      throw new Error("optimistic bridge unavailable");
    });
    const canonicalCatchUp = vi.fn(async () => undefined);

    await expect(
      processDurableWakeJob(claim!, { firstStage, canonicalCatchUp }),
    ).rejects.toThrow("optimistic bridge unavailable");
    expect(canonicalCatchUp).not.toHaveBeenCalled();
  });
});
