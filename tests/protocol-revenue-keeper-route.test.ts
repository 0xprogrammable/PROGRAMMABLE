import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  safeError: vi.fn(() => ({
    code: "rpc_quorum_failed",
    retryable: true,
  })),
}));

vi.mock("../lib/protocol-revenue/keeper.server", () => ({
  runConfiguredProtocolRevenueKeeper: mocks.run,
  safeProtocolRevenueKeeperError: mocks.safeError,
}));

import { GET } from "../app/api/ops/protocol-revenue/route";

const SECRET = "protocol-revenue-cron-secret-at-least-32-bytes";

function request(secret = SECRET) {
  return new NextRequest(
    "https://programmable.family/api/ops/protocol-revenue",
    { headers: { authorization: `Bearer ${secret}` } },
  );
}

describe("protocol revenue Vercel route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects missing and weak cron credentials before any keeper call", async () => {
    const missing = await GET(
      new NextRequest(
        "https://programmable.family/api/ops/protocol-revenue",
      ),
    );
    expect(missing.status).toBe(401);

    vi.stubEnv("CRON_SECRET", "too-short");
    const weak = await GET(request("too-short"));
    expect(weak.status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("returns a bounded successful private submission result", async () => {
    const result = {
      status: "submitted",
      transactionHash: `0x${"22".repeat(32)}`,
      finalizedBlockNumber: "25680000",
      availableRevenue: "100000000000000000",
      maximumGasCost: "1000000000000000",
      keeperFunding: "500000000000000",
    } as const;
    mocks.run.mockResolvedValue(result);

    const response = await GET(request());

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(result);
  });

  it("treats safe skip states as successful cron checks", async () => {
    const result = {
      status: "not_due",
      finalizedBlockNumber: "25680000",
      availableRevenue: "1000",
      nextRunAt: "1785840000",
    } as const;
    mocks.run.mockResolvedValue(result);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
  });

  it("never discloses provider or private-key failures", async () => {
    mocks.run.mockRejectedValue(
      new Error("https://provider.example/private-key-value"),
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Protocol revenue cycle failed",
    });
    expect(mocks.safeError).toHaveBeenCalledTimes(1);
  });
});
