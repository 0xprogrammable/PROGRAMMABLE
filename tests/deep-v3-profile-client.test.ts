import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";

import {
  deepV3CreatorTokenToProfileToken,
  fetchDeepV3CreatorProfile,
  parseDeepV3CreatorProfile,
} from "../lib/profile/deep-v3-profile";

const ACCOUNT = getAddress(
  "0x1111111111111111111111111111111111111111",
);
const TOKEN = getAddress(
  "0x2222222222222222222222222222222222222222",
);
const HOOK = getAddress(
  "0x3333333333333333333333333333333333333333",
);
const VAULT = getAddress(
  "0x4444444444444444444444444444444444444444",
);

function responseToken() {
  return {
    deepReleaseVersion: "deep-full-range-v3",
    launchModel: "deep",
    tokenAddress: TOKEN,
    tokenName: "Deep Token",
    tokenSymbol: "DEEP",
    imageUrl: "https://programmable.family/deep.png",
    creator: ACCOUNT,
    launcher: "0x5555555555555555555555555555555555555555",
    hookAddress: HOOK,
    vaultAddress: VAULT,
    poolId: `0x${"11".repeat(32)}`,
    positionRecipient: "0x6666666666666666666666666666666666666666",
    positionTokenId: "7",
    launchHash: `0x${"22".repeat(32)}`,
    launchTransactionHash: `0x${"33".repeat(32)}`,
    launchBlockNumber: "120",
    launchedAt: "2026-07-29T12:00:00.000Z",
    totalSupplyRaw: (1_000_000_000n * 10n ** 18n).toString(),
    tokenDecimals: 18,
    totalHookFeeBps: 100,
    growthFeeBps: 90,
    programmableFeeBps: 10,
    transferTaxBps: 0,
    lpFeePips: 0,
    sqrtPriceX96: (1n << 96n).toString(),
    currentTick: 0,
    protocolFeePips: 0,
    activeLiquidity: "1000",
    nativePriceWad: (10n ** 18n).toString(),
    marketCapNativeWad: (1_000n * 10n ** 18n).toString(),
    pendingGrowthNativeWei: "10",
    accruedGrowthFeesWei: "20",
    totalGrowthEthReceivedWei: "100",
    totalNativeSwappedWei: "40",
    totalTokenAcquiredRaw: "80",
    totalNativeAddedWei: "50",
    totalTokenAddedRaw: "70",
    lockedLiquidity: "30",
    trustedNativeDepthWei: "1000",
    rollingExposureWei: "40",
    compoundCount: "1",
    lastCompoundTimestamp: "1800000000",
    automationAction: 0,
    nextEligibleTimestamp: "1800000300",
    rollingCapacityWei: "250",
    blockedReason: "0x00000000",
    links: [],
  };
}

function response() {
  return {
    status: "ready",
    account: ACCOUNT,
    chainId: 1,
    snapshot: {
      blockNumber: "200",
      blockHash: `0x${"44".repeat(32)}`,
    },
    tokens: [responseToken()],
  };
}

describe("Deep V3 creator profile client", () => {
  it("maps creator tokens and liquidity growth without creating rewards", () => {
    const profile = parseDeepV3CreatorProfile(response(), ACCOUNT);

    expect(profile.status).toBe("ready");
    if (profile.status !== "ready") throw new Error("profile not ready");
    expect(profile.tokens).toHaveLength(1);
    expect(profile.tokens[0]).toMatchObject({
      tokenAddress: TOKEN,
      tokenName: "Deep Token",
      marketCapNativeWad: (1_000n * 10n ** 18n).toString(),
      pendingGrowthNativeWei: "10",
      totalNativeAddedWei: "50",
      compoundCount: "1",
    });
    expect("claimableWei" in profile.tokens[0]).toBe(false);
    expect("beneficiary" in profile.tokens[0]).toBe(false);
    expect(deepV3CreatorTokenToProfileToken(profile.tokens[0])).toEqual({
      address: TOKEN,
      name: "Deep Token",
      symbol: "DEEP",
      launchedAt: "2026-07-29T12:00:00.000Z",
      href: `/token/${TOKEN}`,
      imageUrl: "https://programmable.family/deep.png",
      marketCapEthWei: (1_000n * 10n ** 18n).toString(),
      launchModel: "deep",
    });
  });

  it("rejects reward fields, accounting drift and another creator", () => {
    expect(() =>
      parseDeepV3CreatorProfile(
        {
          ...response(),
          tokens: [{ ...responseToken(), claimableWei: "1" }],
        },
        ACCOUNT,
      ),
    ).toThrow(/reward field/);
    expect(() =>
      parseDeepV3CreatorProfile(
        {
          ...response(),
          tokens: [
            {
              ...responseToken(),
              totalGrowthEthReceivedWei: "101",
            },
          ],
        },
        ACCOUNT,
      ),
    ).toThrow(/liquidity accounting/);
    expect(() =>
      parseDeepV3CreatorProfile(
        {
          ...response(),
          tokens: [
            {
              ...responseToken(),
              creator: "0x7777777777777777777777777777777777777777",
            },
          ],
        },
        ACCOUNT,
      ),
    ).toThrow(/another creator/);
  });

  it("loads the explicit V3 profile route without browser caching", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => response(),
    }));

    await expect(
      fetchDeepV3CreatorProfile(ACCOUNT, undefined, fetcher),
    ).resolves.toMatchObject({
      status: "ready",
      account: ACCOUNT,
    });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/profile/deep?account=${ACCOUNT}&deepReleaseVersion=deep-full-range-v3`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
  });
});
