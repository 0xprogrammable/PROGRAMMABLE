import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bitqueryMarketDataConfigured: vi.fn(),
}));

vi.mock("../../lib/market-data/bitquery.server", () => ({
  bitqueryMarketDataConfigured: mocks.bitqueryMarketDataConfigured,
}));

import { GET } from "../../app/api/ops/health/route";

describe("operations health route", () => {
  beforeEach(() => {
    mocks.bitqueryMarketDataConfigured.mockReset();
  });

  it("reports the single Bitquery website provider as ready when configured", async () => {
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
        name: "bitquery",
        configured: true,
      },
      checkedAt: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain("token");
    expect(JSON.stringify(body)).not.toContain("http");
  });

  it("reports degraded without a usable Bitquery configuration", async () => {
    mocks.bitqueryMarketDataConfigured.mockReturnValue(false);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      status: "degraded",
      provider: {
        name: "bitquery",
        configured: false,
      },
      checkedAt: expect.any(String),
    });
  });
});
