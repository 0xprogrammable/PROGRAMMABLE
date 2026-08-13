import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOperationalOnchainDeployment: vi.fn(),
  historicalReadOnchainDeployment: vi.fn(),
  prewarmClassicEventCache: vi.fn(),
  readLiveExploreModel: vi.fn(),
  writeDurableExploreModel: vi.fn(),
  writePortfolioHistorySnapshot: vi.fn(),
}));

vi.mock("../../lib/onchain", () => ({
  getWebsiteReadOnchainDeployment: mocks.getOperationalOnchainDeployment,
  prewarmClassicEventCache: mocks.prewarmClassicEventCache,
  readLiveExploreModel: mocks.readLiveExploreModel,
  writeDurableExploreModel: mocks.writeDurableExploreModel,
}));

vi.mock("../../lib/onchain/historical-read-rpc.server", () => ({
  historicalReadOnchainDeployment: mocks.historicalReadOnchainDeployment,
}));

vi.mock("../../lib/profile/portfolio-history-storage.server", () => ({
  writePortfolioHistorySnapshot: mocks.writePortfolioHistorySnapshot,
}));

import { NextRequest } from "next/server";

import { GET as getClosedAlias } from "../../app/api/ops/index/route";
import { GET as getCanonicalIndex } from "../../app/api/ops/index-v2/route";

const SECRET = "legacy-index-test-secret-32-characters";
const deployment = Object.freeze({
  status: "ready" as const,
  rpcProviderIds: Object.freeze({
    primary: "drpc" as const,
    secondary: "quicknode" as const,
  }),
});
const durableRefreshDeployment = Object.freeze({
  ...deployment,
  rpcUrl: "https://quicknode.example.invalid/",
  rpcUrlSecondary: "https://rpc.mevblocker.io/",
  rpcProviderIds: undefined,
});

function request(secret = SECRET) {
  return new NextRequest("https://programmable.family/api/ops/index-v2", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("legacy index operations routes", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getOperationalOnchainDeployment.mockReturnValue(deployment);
    mocks.historicalReadOnchainDeployment.mockReturnValue(
      durableRefreshDeployment,
    );
    mocks.readLiveExploreModel.mockResolvedValue({ status: "ready" });
    mocks.prewarmClassicEventCache.mockImplementation(
      async (
        _deployment,
        provider: "primary" | "secondary",
        step: number,
        stepCount: number,
      ) => ({
        provider,
        step,
        stepCount,
        coverageStartBlock: "25624131",
        blockNumber: "25600000",
        confirmedBlockNumber: "25740000",
        blockHash: `0x${"11".repeat(32)}`,
      }),
    );
    mocks.writeDurableExploreModel.mockResolvedValue({
      blockNumber: "25600000",
      tokenCount: 265,
      updated: true,
      deepReleaseVersion: null,
      deepLifecycleEvidenceHash: null,
    });
    mocks.writePortfolioHistorySnapshot.mockResolvedValue({
      status: "stored",
      path: "history.json",
      tokenCount: 265,
      blockNumber: "25600000",
    });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects missing, weak and overlong UTF-8 secrets before any write", async () => {
    const missing = await getCanonicalIndex(
      new NextRequest("https://programmable.family/api/ops/index-v2"),
    );
    expect(missing.status).toBe(401);
    expect(missing.headers.get("cache-control")).toBe("no-store");

    process.env.CRON_SECRET = "too-short";
    expect((await getCanonicalIndex(request("too-short"))).status).toBe(401);

    process.env.CRON_SECRET = "🌸".repeat(300);
    expect((await getCanonicalIndex(request(SECRET))).status).toBe(401);

    expect(mocks.readLiveExploreModel).not.toHaveBeenCalled();
    expect(mocks.writeDurableExploreModel).not.toHaveBeenCalled();
  });

  it("runs the durable refresh only through the canonical route", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await getCanonicalIndex(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      blockNumber: "25600000",
      tokenCount: 265,
    });
    expect(mocks.readLiveExploreModel).toHaveBeenCalledTimes(1);
    expect(mocks.historicalReadOnchainDeployment).toHaveBeenCalledWith(
      deployment,
    );
    expect(mocks.readLiveExploreModel).toHaveBeenCalledWith(
      durableRefreshDeployment,
    );
    expect(mocks.writeDurableExploreModel).toHaveBeenCalledTimes(1);
    expect(mocks.writeDurableExploreModel).toHaveBeenCalledWith(
      deployment,
      { status: "ready" },
    );
    expect(mocks.writePortfolioHistorySnapshot).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["classic-primary-01", "primary", 1],
    ["classic-primary-32", "primary", 32],
    ["classic-secondary-01", "secondary", 1],
    ["classic-secondary-32", "secondary", 32],
  ] as const)(
    "prewarms the exact %s event cache without publishing a model",
    async (phase, provider, step) => {
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      const response = await getCanonicalIndex(
        new NextRequest(
          `https://programmable.family/api/ops/index-v2?phase=${phase}`,
          { headers: { authorization: `Bearer ${SECRET}` } },
        ),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        phase,
        provider,
        step,
        stepCount: 32,
        blockNumber: "25600000",
      });
      expect(mocks.prewarmClassicEventCache).toHaveBeenCalledWith(
        durableRefreshDeployment,
        provider,
        step,
        32,
        expect.any(AbortSignal),
      );
      expect(mocks.readLiveExploreModel).not.toHaveBeenCalled();
      expect(mocks.writeDurableExploreModel).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed prewarm phases before reading providers", async () => {
    const response = await getCanonicalIndex(
      new NextRequest(
        "https://programmable.family/api/ops/index-v2?phase=classic-primary-01&phase=classic-secondary-01",
        { headers: { authorization: `Bearer ${SECRET}` } },
      ),
    );
    expect(response.status).toBe(400);
    expect(mocks.getOperationalOnchainDeployment).not.toHaveBeenCalled();
    expect(mocks.prewarmClassicEventCache).not.toHaveBeenCalled();
  });

  it.each([
    "refresh",
    "classic-primary",
    "classic-primary-00",
    "classic-primary-33",
    "classic-secondary-1",
  ])(
    "rejects the unapproved %s query before reading deployment state",
    async (phase) => {
      const response = await getCanonicalIndex(
        new NextRequest(
          `https://programmable.family/api/ops/index-v2?phase=${phase}`,
          { headers: { authorization: `Bearer ${SECRET}` } },
        ),
      );

      expect(response.status).toBe(400);
      expect(mocks.getOperationalOnchainDeployment).not.toHaveBeenCalled();
      expect(mocks.prewarmClassicEventCache).not.toHaveBeenCalled();
      expect(mocks.readLiveExploreModel).not.toHaveBeenCalled();
    },
  );

  it("aborts a timed-out prewarm and awaits its cleanup before responding", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let releaseCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    mocks.prewarmClassicEventCache.mockImplementation(
      async (_deployment, _provider, _step, _stepCount, signal) => {
        observedSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            void cleanup.then(() => reject(signal.reason));
          });
        });
      },
    );

    let settled = false;
    const responsePromise = getCanonicalIndex(
      new NextRequest(
        "https://programmable.family/api/ops/index-v2?phase=classic-primary-03",
        { headers: { authorization: `Bearer ${SECRET}` } },
      ),
    ).then((response) => {
      settled = true;
      return response;
    });
    await vi.advanceTimersByTimeAsync(250_000);

    expect(observedSignal?.aborted).toBe(true);
    expect(settled).toBe(false);

    releaseCleanup?.();
    const response = await responsePromise;
    expect(response.status).toBe(503);
    expect(mocks.readLiveExploreModel).not.toHaveBeenCalled();
    expect(mocks.writeDurableExploreModel).not.toHaveBeenCalled();
    expect(mocks.writePortfolioHistorySnapshot).not.toHaveBeenCalled();
  });

  it("fails fast after one full read failure without starting a write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readLiveExploreModel.mockRejectedValue(
      Object.assign(new Error("sensitive provider response"), { code: 429 }),
    );

    const response = await getCanonicalIndex(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Index refresh failed",
    });
    expect(mocks.readLiveExploreModel).toHaveBeenCalledTimes(1);
    expect(mocks.writeDurableExploreModel).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "sensitive provider response",
    );
  });

  it("returns a controlled 503 before the Vercel hard timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readLiveExploreModel.mockReturnValue(new Promise(() => undefined));

    const responsePromise = getCanonicalIndex(request());
    await vi.advanceTimersByTimeAsync(270_000);
    const response = await responsePromise;

    expect(response.status).toBe(503);
    expect(mocks.readLiveExploreModel).toHaveBeenCalledTimes(1);
    expect(mocks.writeDurableExploreModel).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "Programmable index refresh failed",
      expect.objectContaining({
        errorName: "IndexRefreshDeadlineError",
        durationMs: 270_000,
      }),
    );
  });

  it("keeps the old writer alias permanently closed", async () => {
    const response = await getClosedAlias();

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Legacy index route closed",
      code: "legacy_index_route_closed",
    });
    expect(mocks.readLiveExploreModel).not.toHaveBeenCalled();
    expect(mocks.writeDurableExploreModel).not.toHaveBeenCalled();
  });
});
