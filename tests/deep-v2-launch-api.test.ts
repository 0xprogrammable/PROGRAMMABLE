import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findDeepV2LaunchByTransaction: vi.fn(),
  readExploreModel: vi.fn(),
}));

vi.mock("../lib/onchain", () => ({
  readExploreModel: mocks.readExploreModel,
}));

vi.mock("../lib/onchain/deep-v2-read-model", () => ({
  findDeepV2LaunchByTransaction: mocks.findDeepV2LaunchByTransaction,
}));

import { GET } from "../app/api/explore/launch/route";

const transactionHash = `0x${"12".repeat(32)}`;

describe("Deep V2 launch confirmation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    "",
    "transaction=invalid",
    `transaction=${transactionHash}&transaction=${transactionHash}`,
    `transaction=${transactionHash}&extra=1`,
  ])("rejects a non-canonical query before reading Explore: %s", async (query) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/explore/launch?${query}`),
    );

    expect(response.status).toBe(400);
    expect(mocks.readExploreModel).not.toHaveBeenCalled();
  });

  it("returns only the launch selected by the strict V2 provenance finder", async () => {
    const model = {
      status: "ready",
      tokens: [],
      snapshot: {
        chainId: 1,
        blockNumber: "123",
        blockHash: `0x${"34".repeat(32)}`,
        confirmations: 12,
      },
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    };
    const launch = {
      tokenAddress: "0x1111111111111111111111111111111111111111",
      deepReleaseVersion: "deep-full-range-v2",
    };
    mocks.readExploreModel.mockResolvedValue(model);
    mocks.findDeepV2LaunchByTransaction.mockReturnValue(launch);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/launch?transaction=${transactionHash}`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      launch,
      snapshot: model.snapshot,
    });
    expect(mocks.findDeepV2LaunchByTransaction).toHaveBeenCalledWith(
      model,
      transactionHash,
    );
  });
});
