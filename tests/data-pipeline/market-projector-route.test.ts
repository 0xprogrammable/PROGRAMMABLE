import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  safeError: vi.fn(() => ({
    dependency: "rpc",
    code: "dependency_unavailable",
    retryable: true,
  })),
}));

vi.mock("../../lib/data-pipeline/market-projector-runtime.server", () => ({
  runConfiguredMarketProjectorCycle: mocks.run,
  safeMarketProjectorError: mocks.safeError,
}));

import { GET } from "../../app/api/ops/market-projector/route";

describe("market projector ops route", () => {
  const cronSecret = "market-projector-secret-at-least-32-bytes";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", cronSecret);
    mocks.run.mockResolvedValue({
      status: "committed",
      releaseId: "classic-v3",
      poolId: `0x${"11".repeat(32)}`,
      blockNumber: "200",
      lagBlocks: "4",
      closeCount: 8,
      candleCount: 1,
      caughtUp: false,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires the timing-safe cron bearer boundary", async () => {
    const response = await GET(
      new NextRequest("https://programmable.family/api/ops/market-projector"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("returns only the finite safe cycle result", async () => {
    const response = await GET(
      new NextRequest("https://programmable.family/api/ops/market-projector", {
        headers: { authorization: `Bearer ${cronSecret}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "committed",
      releaseId: "classic-v3",
      poolId: `0x${"11".repeat(32)}`,
      blockNumber: "200",
      lagBlocks: "4",
      closeCount: 8,
      candleCount: 1,
      caughtUp: false,
    });
  });

  it("returns the bounded disabled result without treating it as a failure", async () => {
    mocks.run.mockResolvedValue({
      status: "disabled",
      lagBlocks: "0",
      closeCount: 0,
      candleCount: 0,
      caughtUp: false,
    });
    const response = await GET(
      new NextRequest("https://programmable.family/api/ops/market-projector", {
        headers: { authorization: `Bearer ${cronSecret}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "disabled",
      lagBlocks: "0",
      closeCount: 0,
      candleCount: 0,
      caughtUp: false,
    });
  });

  it("returns a bounded busy result for an overlapping scheduled run", async () => {
    mocks.run.mockResolvedValue({
      status: "busy",
      lagBlocks: "0",
      closeCount: 0,
      candleCount: 0,
      caughtUp: false,
    });
    const response = await GET(
      new NextRequest("https://programmable.family/api/ops/market-projector", {
        headers: { authorization: `Bearer ${cronSecret}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "busy",
      lagBlocks: "0",
      closeCount: 0,
      candleCount: 0,
      caughtUp: false,
    });
  });

  it("rejects cron secrets outside the bounded credential length", async () => {
    vi.stubEnv("CRON_SECRET", "too-short");
    const response = await GET(
      new NextRequest("https://programmable.family/api/ops/market-projector", {
        headers: { authorization: "Bearer too-short" },
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("does not disclose provider or database failures", async () => {
    mocks.run.mockRejectedValue(new Error("postgres://user:secret@host/db"));
    const response = await GET(
      new NextRequest("https://programmable.family/api/ops/market-projector", {
        headers: { authorization: `Bearer ${cronSecret}` },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Market projection failed",
    });
    expect(mocks.safeError).toHaveBeenCalledTimes(1);
  });
});
