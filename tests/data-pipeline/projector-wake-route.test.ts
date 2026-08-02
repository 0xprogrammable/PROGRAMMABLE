import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  source: vi.fn(),
  market: vi.fn(),
  firstStage: vi.fn(),
  parseBlockHint: vi.fn(),
  safeMarketError: vi.fn(() => ({
    dependency: "market-projector",
    code: "internal_error",
    retryable: false,
  })),
  enqueue: vi.fn(),
  acknowledge: vi.fn(),
  consumeProviderRetryOnce: vi.fn(),
  processNext: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return { ...actual, after: mocks.after };
});

vi.mock("../../lib/data-pipeline/projector-runtime-config.server", () => ({
  runConfiguredProjectorCycle: mocks.source,
}));

vi.mock("../../lib/data-pipeline/market-projector-runtime.server", () => ({
  runConfiguredMarketProjectorFastLaneCycle: mocks.market,
  safeMarketProjectorError: mocks.safeMarketError,
}));

vi.mock(
  "../../lib/data-pipeline/quicknode-wake-queue.server",
  async () => {
    const actual = await vi.importActual<
      typeof import("../../lib/data-pipeline/quicknode-wake-queue.server")
    >("../../lib/data-pipeline/quicknode-wake-queue.server");
    return {
      ...actual,
      enqueueConfiguredQuickNodeWake: mocks.enqueue,
      acknowledgeConfiguredQuickNodeWake: mocks.acknowledge,
      consumeConfiguredRealBlockSlaProviderRetryOnce:
        mocks.consumeProviderRetryOnce,
      processNextConfiguredQuickNodeWake: mocks.processNext,
    };
  },
);

import {
  createProjectorWakePost,
  POST,
} from "../../app/api/ops/projector-wake/route";

const SECRET = "quicknode-stream-secret-at-least-32-bytes";
const HINT = Object.freeze({
  chainId: 1 as const,
  blockNumber: "291",
  streamId: "stream-mainnet",
  reorgedBlockNumbers: Object.freeze(["290"]),
});
const PAYLOAD = Object.freeze({ block: { number: "0x123" } });
const CLAIM = Object.freeze({
  wakeId: "1",
  deliveryReceiptId: "19",
  blockNumberHint: "291",
  hint: HINT,
  payload: JSON.stringify(PAYLOAD),
  leaseGeneration: "1",
  leaseExpiresAt: "2026-08-02T12:03:30.000Z",
  attemptCount: 1,
  workerId: "quicknode-wake-00000000-0000-4000-8000-000000000001",
  leaseTokenDigest: `0x${"22".repeat(32)}` as const,
});

function configuredPost() {
  return createProjectorWakePost({
    parseBlockHint: mocks.parseBlockHint,
    firstStage: mocks.firstStage,
    loadDeployment: () => ({
      repositoryCommit: "a".repeat(40),
      deploymentId: "dpl_0123456789abcdefghij",
      deploymentOrigin: "https://programmable-stage.vercel.app",
      projectId: "prj_programmable",
    }),
    enqueue: mocks.enqueue,
    acknowledge: mocks.acknowledge,
    consumeProviderRetryOnce: mocks.consumeProviderRetryOnce,
  });
}

function request(
  input: Readonly<{
    signature?: string;
    payload?: (timestamp: string) => unknown;
    origin?: string;
  }> = {},
) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const payload = JSON.stringify(input.payload?.(timestamp) ?? PAYLOAD);
  const nonce = "0123456789abcdef0123456789abcdef";
  const signature =
    input.signature ??
    createHmac("sha256", SECRET)
      .update(nonce)
      .update(timestamp)
      .update(payload)
      .digest("hex");
  const origin = input.origin ?? "https://programmable.family";
  return new NextRequest(
    `${origin}/api/ops/projector-wake`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: new URL(origin).host,
        "x-qn-nonce": nonce,
        "x-qn-timestamp": timestamp,
        "x-qn-signature": signature,
      },
      body: payload,
    },
  );
}

describe("projector stream wake route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PROGRAMMABLE_QUICKNODE_STREAM_SECRET", SECRET);
    mocks.source.mockResolvedValue({ status: "caught-up" });
    mocks.market.mockResolvedValue({ status: "caught-up" });
    mocks.firstStage.mockResolvedValue(undefined);
    mocks.parseBlockHint.mockReturnValue(HINT);
    mocks.enqueue.mockResolvedValue({
      wakeId: "1",
      deliveryReceiptId: "19",
      blockNumberHint: "291",
      enqueued: true,
      state: "pending",
    });
    mocks.acknowledge.mockResolvedValue({
      deliveryReceiptId: "19",
      wakeId: "1",
      status: 202,
      cacheControl: "no-store",
      acknowledgedAt: "2026-08-02T12:00:00.010Z",
    });
    mocks.consumeProviderRetryOnce.mockResolvedValue(false);
    mocks.processNext.mockImplementation(
      async (work: (claim: typeof CLAIM) => Promise<void>) => {
        try {
          await work(CLAIM);
          return "completed";
        } catch {
          return "retry-scheduled";
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("acknowledges only after durable enqueue, then schedules the optimistic stage, source and head fast lane", async () => {
    let backgroundTask: (() => Promise<void>) | undefined;
    mocks.after.mockImplementation((task: () => Promise<void>) => {
      backgroundTask = task;
    });

    const response = await configuredPost()(request());

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.acknowledge).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.acknowledge.mock.invocationCallOrder[0]!,
    );
    expect(mocks.acknowledge.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.after.mock.invocationCallOrder[0]!,
    );
    expect(mocks.enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.after.mock.invocationCallOrder[0]!,
    );
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.market).not.toHaveBeenCalled();

    await backgroundTask?.();
    expect(mocks.firstStage).toHaveBeenCalledWith(CLAIM);
    expect(mocks.source).toHaveBeenCalledTimes(1);
    expect(mocks.market).toHaveBeenCalledTimes(1);
    expect(mocks.firstStage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.source.mock.invocationCallOrder[0]!,
    );
    expect(mocks.source.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.market.mock.invocationCallOrder[0]!,
    );
  });

  it("returns one authentic 503 after the staged delivery is durable and still schedules its worker", async () => {
    let backgroundTask: (() => Promise<void>) | undefined;
    mocks.after.mockImplementation((task: () => Promise<void>) => {
      backgroundTask = task;
    });
    mocks.consumeProviderRetryOnce.mockResolvedValue(true);
    vi.stubEnv("PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE", "true");
    vi.stubEnv("VERCEL_URL", "programmable-candidate-abc.vercel.app");

    const response = await configuredPost()(request({
      origin: "https://programmable-candidate-abc.vercel.app",
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.acknowledge).toHaveBeenCalledTimes(1);
    expect(mocks.consumeProviderRetryOnce).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryReceiptId: "19", wakeId: "1" }),
    );
    expect(mocks.acknowledge.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.consumeProviderRetryOnce.mock.invocationCallOrder[0]!,
    );
    expect(mocks.consumeProviderRetryOnce.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.after.mock.invocationCallOrder[0]!,
    );
    await backgroundTask?.();
    expect(mocks.firstStage).toHaveBeenCalledWith(CLAIM);
  });

  it("returns 202 for the authentic duplicate after the single-use probe was consumed", async () => {
    vi.stubEnv("PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE", "true");
    vi.stubEnv("VERCEL_URL", "programmable-candidate-abc.vercel.app");
    mocks.enqueue.mockResolvedValue({
      wakeId: "1",
      deliveryReceiptId: "20",
      blockNumberHint: "291",
      enqueued: false,
      state: "pending",
    });

    const response = await configuredPost()(request({
      origin: "https://programmable-candidate-abc.vercel.app",
    }));

    expect(response.status).toBe(202);
    expect(mocks.acknowledge).toHaveBeenCalledTimes(1);
    expect(mocks.consumeProviderRetryOnce).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryReceiptId: "20", wakeId: "1" }),
    );
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("keeps the provider retry probe off by default", async () => {
    vi.stubEnv("VERCEL_URL", "programmable-candidate-abc.vercel.app");

    const response = await configuredPost()(request({
      origin: "https://programmable-candidate-abc.vercel.app",
    }));

    expect(response.status).toBe(202);
    expect(mocks.consumeProviderRetryOnce).not.toHaveBeenCalled();
  });

  it("never forces the retry through an aliased production origin", async () => {
    vi.stubEnv("PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE", "true");
    vi.stubEnv("VERCEL_URL", "programmable-candidate-abc.vercel.app");
    mocks.consumeProviderRetryOnce.mockResolvedValue(true);

    const response = await configuredPost()(request());

    expect(response.status).toBe(202);
    expect(mocks.consumeProviderRetryOnce).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("keeps the acknowledged delivery truthful when the optional retry probe cannot be consumed", async () => {
    vi.stubEnv("PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE", "true");
    vi.stubEnv("VERCEL_URL", "programmable-candidate-abc.vercel.app");
    mocks.consumeProviderRetryOnce.mockRejectedValue(
      new Error("probe unavailable"),
    );

    const response = await configuredPost()(request({
      origin: "https://programmable-candidate-abc.vercel.app",
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(mocks.acknowledge).toHaveBeenCalledTimes(1);
    expect(mocks.consumeProviderRetryOnce).toHaveBeenCalledTimes(1);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("does not schedule work for an invalid signature", async () => {
    const response = await configuredPost()(
      request({ signature: "00".repeat(32) }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.parseBlockHint).not.toHaveBeenCalled();
  });

  it("fails closed when the webhook secret is not configured", async () => {
    vi.stubEnv("PROGRAMMABLE_QUICKNODE_STREAM_SECRET", "");
    const response = await configuredPost()(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Wake trigger unavailable" });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("returns 503 and schedules no worker when durable enqueue fails", async () => {
    mocks.enqueue.mockRejectedValue(new Error("database unavailable"));

    const response = await configuredPost()(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Wake trigger unavailable" });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.market).not.toHaveBeenCalled();
  });

  it("still runs the market fast lane when the source cycle fails", async () => {
    let backgroundTask: (() => Promise<void>) | undefined;
    mocks.after.mockImplementation((task: () => Promise<void>) => {
      backgroundTask = task;
    });
    mocks.source.mockRejectedValue(new Error("source unavailable"));

    const response = await configuredPost()(request());
    expect(response.status).toBe(202);
    await backgroundTask?.();

    expect(mocks.market).toHaveBeenCalledTimes(1);
  });

  it("accepts the exact auth-only canary without parsing, enqueueing or working", async () => {
    const response = await POST(request({
      payload: (timestamp) => ({
        programmableWakeCanary: {
          schemaVersion: 1,
          probeId: "0123456789abcdef0123456789abcdef",
          sentAt: new Date(Number(timestamp) * 1_000).toISOString(),
        },
      }),
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(mocks.parseBlockHint).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.firstStage).not.toHaveBeenCalled();
  });

  it("retries without canonical catch-up when the optimistic first stage fails", async () => {
    let backgroundTask: (() => Promise<void>) | undefined;
    mocks.after.mockImplementation((task: () => Promise<void>) => {
      backgroundTask = task;
    });
    mocks.firstStage.mockRejectedValue(new Error("optimistic unavailable"));

    const response = await configuredPost()(request());
    expect(response.status).toBe(202);
    await backgroundTask?.();

    expect(mocks.processNext).toHaveReturned();
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.market).not.toHaveBeenCalled();
  });
});
