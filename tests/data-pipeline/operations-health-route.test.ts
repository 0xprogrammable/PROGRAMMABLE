import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bitqueryMarketDataConfigured: vi.fn(),
  getProductionGmgnAccountGateStatusV1: vi.fn(),
  gmgnEffectiveRequestsPerSecondV1: vi.fn(),
  gmgnMarketDataConfiguredV1: vi.fn(),
}));

vi.mock("../../lib/market-data/bitquery.server", () => ({
  bitqueryMarketDataConfigured: mocks.bitqueryMarketDataConfigured,
}));

vi.mock("../../lib/market-data/gmgn-account-gate.server", () => ({
  getProductionGmgnAccountGateStatusV1:
    mocks.getProductionGmgnAccountGateStatusV1,
}));

vi.mock("../../lib/market-data/gmgn.server", () => ({
  gmgnMarketDataConfiguredV1: mocks.gmgnMarketDataConfiguredV1,
}));

vi.mock("../../lib/market-data/gmgn-runtime-config.server", () => ({
  gmgnEffectiveRequestsPerSecondV1: mocks.gmgnEffectiveRequestsPerSecondV1,
}));

import { GET } from "../../app/api/ops/health/route";

describe("operations health route", () => {
  beforeEach(() => {
    mocks.bitqueryMarketDataConfigured.mockReset();
    mocks.getProductionGmgnAccountGateStatusV1.mockReset();
    mocks.gmgnEffectiveRequestsPerSecondV1.mockReset();
    mocks.gmgnMarketDataConfiguredV1.mockReset();
    mocks.gmgnEffectiveRequestsPerSecondV1.mockReturnValue(20);
    mocks.getProductionGmgnAccountGateStatusV1.mockResolvedValue({
      mode: "multiflight-v1",
    });
  });

  it("reports the complete GMGN-led market provider stack as ready", async () => {
    mocks.gmgnMarketDataConfiguredV1.mockReturnValue(true);
    mocks.bitqueryMarketDataConfigured.mockReturnValue(true);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=30",
    );
    expect(body).toEqual({
      status: "ready",
      provider: {
        name: "gmgn",
        configured: true,
      },
      providers: [
        {
          name: "gmgn",
          role: "primary-token-market",
          configured: true,
          requestsPerSecond: 20,
          accountGateMode: "multiflight-v1",
        },
        {
          name: "bitquery",
          role: "exact-pool-chart-fallback",
          configured: true,
        },
        {
          name: "dexscreener",
          role: "batch-fail-soft-fallback",
          configured: true,
        },
      ],
      checkedAt: expect.any(String),
    });
    expect(body).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toContain("GMGN_API_KEY");
    expect(JSON.stringify(body)).not.toContain("http");
  });

  it("reports degraded when the primary GMGN market provider is missing", async () => {
    mocks.gmgnMarketDataConfiguredV1.mockReturnValue(false);
    mocks.bitqueryMarketDataConfigured.mockReturnValue(true);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      status: "degraded",
      provider: {
        name: "gmgn",
        configured: false,
      },
      providers: [
        {
          name: "gmgn",
          role: "primary-token-market",
          configured: false,
          requestsPerSecond: 20,
          accountGateMode: "multiflight-v1",
        },
        {
          name: "bitquery",
          role: "exact-pool-chart-fallback",
          configured: true,
        },
        {
          name: "dexscreener",
          role: "batch-fail-soft-fallback",
          configured: true,
        },
      ],
      checkedAt: expect.any(String),
    });
  });

  it("reports degraded when the exact-pool chart fallback is missing", async () => {
    mocks.gmgnMarketDataConfiguredV1.mockReturnValue(true);
    mocks.bitqueryMarketDataConfigured.mockReturnValue(false);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.status).toBe("degraded");
    expect(body.provider).toEqual({ name: "gmgn", configured: true });
    expect(body.providers).toEqual([
      {
        name: "gmgn",
        role: "primary-token-market",
        configured: true,
        requestsPerSecond: 20,
        accountGateMode: "multiflight-v1",
      },
      {
        name: "bitquery",
        role: "exact-pool-chart-fallback",
        configured: false,
      },
      {
        name: "dexscreener",
        role: "batch-fail-soft-fallback",
        configured: true,
      },
    ]);
  });

  it.each(["legacy-singleflight-v1", "unavailable"] as const)(
    "reports Pro throughput as degraded with %s account gate",
    async (mode) => {
      mocks.gmgnMarketDataConfiguredV1.mockReturnValue(true);
      mocks.bitqueryMarketDataConfigured.mockReturnValue(true);
      mocks.getProductionGmgnAccountGateStatusV1.mockResolvedValue({ mode });

      const response = await GET();
      const body = await response.json();

      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body.status).toBe("degraded");
      expect(body.providers[0]).toMatchObject({
        requestsPerSecond: 20,
        accountGateMode: mode,
      });
    },
  );

  it("keeps conservative throughput ready on the attested legacy gate", async () => {
    mocks.gmgnMarketDataConfiguredV1.mockReturnValue(true);
    mocks.bitqueryMarketDataConfigured.mockReturnValue(true);
    mocks.gmgnEffectiveRequestsPerSecondV1.mockReturnValue(1);
    mocks.getProductionGmgnAccountGateStatusV1.mockResolvedValue({
      mode: "legacy-singleflight-v1",
    });

    const response = await GET();
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=30",
    );
    expect(body.status).toBe("ready");
    expect(body.providers[0]).toMatchObject({
      requestsPerSecond: 1,
      accountGateMode: "legacy-singleflight-v1",
    });
  });
});
