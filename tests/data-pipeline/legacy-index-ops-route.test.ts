import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOperationalOnchainDeployment: vi.fn(),
  readLiveExploreModel: vi.fn(),
  writeDurableExploreModel: vi.fn(),
  writePortfolioHistorySnapshot: vi.fn(),
}));

vi.mock("../../lib/onchain", () => ({
  getWebsiteReadOnchainDeployment: mocks.getOperationalOnchainDeployment,
  readLiveExploreModel: mocks.readLiveExploreModel,
  writeDurableExploreModel: mocks.writeDurableExploreModel,
}));

vi.mock("../../lib/profile/portfolio-history-storage.server", () => ({
  writePortfolioHistorySnapshot: mocks.writePortfolioHistorySnapshot,
}));

import { NextRequest } from "next/server";

import { GET as getClosedAlias } from "../../app/api/ops/index/route";
import { GET as getCanonicalIndex } from "../../app/api/ops/index-v2/route";

const SECRET = "legacy-index-test-secret-32-characters";

function request(secret = SECRET) {
  return new NextRequest("https://programmable.family/api/ops/index-v2", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("legacy index operations routes", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getOperationalOnchainDeployment.mockReturnValue({ status: "ready" });
    mocks.readLiveExploreModel.mockResolvedValue({ status: "ready" });
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
    expect(mocks.writeDurableExploreModel).toHaveBeenCalledTimes(1);
    expect(mocks.writePortfolioHistorySnapshot).toHaveBeenCalledTimes(1);
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
