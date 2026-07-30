import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";

import {
  actionCanCheckStatus,
  actionLabel,
  actionPending,
  buildProfilePortfolio,
  clearConfirmedProfileActionStates,
  groupPendingProfileTransactionStates,
  groupProfileRewards,
  parsePendingProfileTransactions,
  profileClaimableWei,
  profileHasRewardSurface,
  profileRewardsForAccount,
  profileTransactionPollAttempts,
  preserveInterruptedTransactionStates,
  removePendingProfileTransactionRecord,
  sortProfileTokensByMarketCap,
  upsertPendingProfileTransactionRecords,
  waitForTransaction,
  type PendingProfileTransactionRecord,
} from "../components/profile-view";
import type { ClassicV3Reward } from "../lib/profile/classic-v3-rewards";
import type { DeepV3CreatorToken } from "../lib/profile/deep-v3-profile";
import type {
  ProfileClaim,
  ProfileToken,
} from "../lib/profile/onchain-profile";

const firstAddress = getAddress(
  "0x1111111111111111111111111111111111111111",
);
const secondAddress = getAddress(
  "0x2222222222222222222222222222222222222222",
);
const thirdAddress = getAddress(
  "0x3333333333333333333333333333333333333333",
);

const tokens: ProfileToken[] = [
  {
    address: firstAddress,
    name: "First",
    symbol: "FIRST",
    launchedAt: "Jul 27, 2026",
    href: `/token/${firstAddress}`,
  },
  {
    address: secondAddress,
    name: "Second",
    symbol: "SECOND",
    launchedAt: "Jul 27, 2026",
    href: `/token/${secondAddress}`,
  },
];

const claim = {
  id: `0x${"11".repeat(32)}`,
  poolId: `0x${"22".repeat(32)}`,
  tokenAddress: secondAddress,
  hookAddress: getAddress(
    "0x3333333333333333333333333333333333333333",
  ),
  tokenName: "Second",
  tokenSymbol: "SECOND",
  claimableWei: "1000000000000000",
  claimableEth: "0.001",
  href: `/token/${secondAddress}`,
} satisfies ProfileClaim;

const classicAllocation = {
  allocationIndex: 0,
  beneficiary: firstAddress,
  payoutAddress: firstAddress,
  shareBps: 10_000,
};

const classicReward = {
  tokenAddress: secondAddress,
  tokenName: "Second",
  tokenSymbol: "SECOND",
  poolId: `0x${"44".repeat(32)}`,
  vaultAddress: getAddress(
    "0x4444444444444444444444444444444444444444",
  ),
  beneficiary: firstAddress,
  payoutAddress: firstAddress,
  shareBps: 10_000,
  claimableWei: "2000000000000000",
  claimableEth: "0.002",
  claimedWei: "0",
  claimedEth: "0",
  buySwapFeeBps: 100,
  sellSwapFeeBps: 200,
  platformFeeBps: 10,
  ownedAllocations: [classicAllocation],
  beneficiaries: [classicAllocation],
  launchTransactionHash: `0x${"55".repeat(32)}`,
} satisfies ClassicV3Reward;
const secondClassicReward = {
  ...classicReward,
  poolId: `0x${"66".repeat(32)}`,
  vaultAddress: thirdAddress,
  claimableWei: "4000000000000000",
  claimableEth: "0.004",
  launchTransactionHash: `0x${"77".repeat(32)}`,
} satisfies ClassicV3Reward;
const deepV3Token = {
  deepReleaseVersion: "deep-full-range-v3",
  launchModel: "deep",
  tokenAddress: thirdAddress,
  tokenName: "Deep Three",
  tokenSymbol: "D3",
  imageUrl: "https://programmable.family/deep-three.png",
  creator: firstAddress,
  hookAddress: getAddress(
    "0x4444444444444444444444444444444444444444",
  ),
  vaultAddress: getAddress(
    "0x5555555555555555555555555555555555555555",
  ),
  poolId: `0x${"88".repeat(32)}`,
  launchTransactionHash: `0x${"99".repeat(32)}`,
  launchedAt: "2026-07-29T12:00:00.000Z",
  marketCapNativeWad: "500",
  pendingGrowthNativeWei: "10",
  accruedGrowthFeesWei: "20",
  totalGrowthEthReceivedWei: "100",
  totalNativeSwappedWei: "40",
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
} satisfies DeepV3CreatorToken;

describe("profile reward grouping", () => {
  it("keeps deployed-token order and attaches each reward to its token", () => {
    const grouped = groupProfileRewards(tokens, [claim]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toEqual({ token: tokens[0], claim: undefined });
    expect(grouped[1]).toEqual({ token: tokens[1], claim });
  });

  it("orders creator tokens by highest market cap without mutating the source", () => {
    const ranked = tokens.map((token, index) => ({
      ...token,
      fdvUsdWad: index === 0 ? "100" : "300",
    }));

    expect(
      sortProfileTokensByMarketCap(ranked).map((token) => token.symbol),
    ).toEqual(["SECOND", "FIRST"]);
    expect(ranked.map((token) => token.symbol)).toEqual(["FIRST", "SECOND"]);
  });

  it("uses the address as a stable tie-breaker for identical profiles", () => {
    const tied = [
      {
        ...tokens[1],
        name: "Same",
        fdvUsdWad: "100",
      },
      {
        ...tokens[0],
        name: "Same",
        fdvUsdWad: "100",
      },
    ];

    expect(
      sortProfileTokensByMarketCap(tied).map((token) => token.address),
    ).toEqual([firstAddress, secondAddress]);
  });

  it("sorts with one validated market-cap unit and leaves incomparable tokens last", () => {
    const usdLow = {
      ...tokens[0],
      name: "USD Low",
      symbol: "USD_LOW",
      fdvUsdWad: "10",
      marketCapEthWei: "999999",
    };
    const usdHigh = {
      ...tokens[1],
      name: "USD High",
      symbol: "USD_HIGH",
      fdvUsdWad: "20",
      marketCapEthWei: "1",
    };
    const ethOnly = {
      ...tokens[0],
      address: thirdAddress,
      href: `/token/${thirdAddress}`,
      name: "ETH Only",
      symbol: "ETH_ONLY",
      fdvUsdWad: undefined,
      marketCapEthWei: "1000000",
    };
    const malformedUsd = {
      ...tokens[1],
      name: "Malformed USD",
      symbol: "MALFORMED_USD",
      fdvUsdWad: "not-a-wad",
      marketCapEthWei: "2000000",
    };

    expect(
      sortProfileTokensByMarketCap([
        ethOnly,
        usdLow,
        malformedUsd,
        usdHigh,
      ]).map((token) => token.symbol),
    ).toEqual(["USD_HIGH", "USD_LOW", "ETH_ONLY", "MALFORMED_USD"]);

    expect(
      buildProfilePortfolio(
        [ethOnly, usdLow, usdHigh],
        [],
        [],
      ).map((entry) => entry.token.symbol),
    ).toEqual(["USD_HIGH", "USD_LOW", "ETH_ONLY"]);
  });

  it("uses ETH market caps when no token has a validated USD valuation", () => {
    const ethLow = {
      ...tokens[0],
      symbol: "ETH_LOW",
      fdvUsdWad: "not-a-wad",
      marketCapEthWei: "10",
    };
    const ethHigh = {
      ...tokens[1],
      symbol: "ETH_HIGH",
      fdvUsdWad: undefined,
      marketCapEthWei: "20",
    };

    expect(
      sortProfileTokensByMarketCap([ethLow, ethHigh]).map(
        (token) => token.symbol,
      ),
    ).toEqual(["ETH_HIGH", "ETH_LOW"]);
  });

  it("renders one portfolio entry when current and split rewards share a token", () => {
    const portfolio = buildProfilePortfolio(
      tokens,
      [claim],
      [classicReward],
    );

    expect(portfolio).toHaveLength(2);
    const second = portfolio.find(
      (entry) => entry.token.address === secondAddress,
    );
    expect(second).toMatchObject({
      token: tokens[1],
      claim,
      classicRewards: [classicReward],
      launchedByWallet: true,
    });
    expect(profileClaimableWei(portfolio)).toBe(
      3_000_000_000_000_000n,
    );
  });

  it("keeps reward-only tokens visible when the launch feed is unavailable", () => {
    const portfolio = buildProfilePortfolio([], [], [classicReward]);

    expect(portfolio).toHaveLength(1);
    expect(portfolio[0]).toMatchObject({
      token: {
        address: secondAddress,
        name: "Second",
        symbol: "SECOND",
      },
      launchedByWallet: false,
      classicRewards: [classicReward],
    });
  });

  it("groups every beneficiary vault for the same token without losing rewards", () => {
    const portfolio = buildProfilePortfolio(
      tokens,
      [claim],
      [classicReward, secondClassicReward, secondClassicReward],
    );
    const second = portfolio.find(
      (entry) => entry.token.address === secondAddress,
    );

    expect(second?.classicRewards).toEqual([
      classicReward,
      secondClassicReward,
    ]);
    expect(profileClaimableWei(portfolio)).toBe(
      7_000_000_000_000_000n,
    );
  });

  it("scopes claimable split rewards and actions to the connected beneficiary", () => {
    const otherBeneficiaryReward = {
      ...secondClassicReward,
      beneficiary: secondAddress,
      payoutAddress: secondAddress,
      ownedAllocations: [
        {
          ...classicAllocation,
          beneficiary: secondAddress,
          payoutAddress: secondAddress,
        },
      ],
      beneficiaries: [
        {
          ...classicAllocation,
          beneficiary: secondAddress,
          payoutAddress: secondAddress,
        },
      ],
    } satisfies ClassicV3Reward;
    const portfolio = buildProfilePortfolio(
      [],
      [],
      [classicReward, otherBeneficiaryReward],
    );

    expect(profileClaimableWei(portfolio, firstAddress)).toBe(
      2_000_000_000_000_000n,
    );
    expect(profileClaimableWei(portfolio, secondAddress)).toBe(
      4_000_000_000_000_000n,
    );
    expect(
      profileRewardsForAccount(
        [classicReward, otherBeneficiaryReward],
        firstAddress,
      ),
    ).toEqual([classicReward]);
  });

  it("shows Deep V3 creator tokens without inventing rewards or claims", () => {
    const portfolio = buildProfilePortfolio(
      [],
      [],
      [],
      [],
      [deepV3Token],
    );

    expect(portfolio).toHaveLength(1);
    expect(portfolio[0]).toMatchObject({
      token: {
        address: thirdAddress,
        name: "Deep Three",
        symbol: "D3",
        launchModel: "deep",
      },
      deepV3Token,
      launchedByWallet: true,
      classicRewards: [],
      deepRewards: [],
    });
    expect(portfolio[0].claim).toBeUndefined();
    expect(profileClaimableWei(portfolio, firstAddress)).toBe(0n);
    expect(profileHasRewardSurface(portfolio)).toBe(false);
  });
});

describe("profile transaction status", () => {
  const transactionHash = `0x${"ab".repeat(32)}` as const;
  const secondTransactionHash = `0x${"cd".repeat(32)}` as const;

  it("keeps an unresolved receipt check distinct from a retryable error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const wait = vi.fn(async () => undefined);

    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: 2,
        fetcher,
        wait,
      }),
    ).resolves.toBe("pending");

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(transactionHash);
    expect(
      actionCanCheckStatus({
        account: firstAddress,
        status: "pending",
        message: "Still pending on Ethereum",
        transactionHash,
      }),
    ).toBe(true);
    expect(
      actionLabel({
        account: firstAddress,
        status: "pending",
        message: "Still pending on Ethereum",
        transactionHash,
      }),
    ).toBe("Check status");
    expect(
      actionPending({
        account: firstAddress,
        status: "pending",
        message: "Still pending on Ethereum",
        transactionHash,
      }),
    ).toBe(false);
  });

  it("uses one receipt request for a manual status check", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const wait = vi.fn(async () => undefined);

    expect(profileTransactionPollAttempts(true)).toBe(1);
    expect(profileTransactionPollAttempts(false)).toBe(40);
    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: profileTransactionPollAttempts(true),
        fetcher,
        wait,
      }),
    ).resolves.toBe("pending");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("aborts receipt polling before another account can inherit it", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    controller.abort();

    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: 2,
        fetcher,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("interrupts the polling delay and retains the submitted hash", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: 2,
        fetcher,
        signal: controller.signal,
        wait: async () => {
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);

    const interrupted = preserveInterruptedTransactionStates({
      claim: {
        account: firstAddress,
        status: "confirming" as const,
        message: "Confirming on Ethereum",
        transactionHash,
      },
    });
    expect(interrupted.claim).toMatchObject({
      status: "pending",
      transactionHash,
    });
    expect(actionCanCheckStatus(interrupted.claim)).toBe(true);
  });

  it("polls the same hash until it becomes confirmed", async () => {
    const statuses = ["pending", "confirmed"] as const;
    let requestIndex = 0;
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          status: statuses[requestIndex++],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: 2,
        fetcher,
        wait: async () => undefined,
      }),
    ).resolves.toBe("confirmed");

    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [request] of fetcher.mock.calls) {
      expect(String(request)).toContain(transactionHash);
    }
  });

  it("reports a reverted receipt as a retryable terminal result", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: "reverted" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: 1,
        fetcher,
        wait: async () => undefined,
      }),
    ).resolves.toBe("reverted");

    expect(
      actionLabel({
        account: firstAddress,
        status: "error",
        message: "The reward transaction reverted onchain",
        transactionHash,
      }),
    ).toBe("Try again");
  });

  it("clears only the confirmed action whose exact hash was refreshed", () => {
    const firstKey = `${secondAddress.toLowerCase()}:claim`;
    const secondKey = `${thirdAddress.toLowerCase()}:claim`;
    const states = {
      [firstKey]: {
        account: firstAddress,
        status: "confirmed" as const,
        message: "Claim confirmed",
        transactionHash,
      },
      [secondKey]: {
        account: firstAddress,
        status: "pending" as const,
        message: "Still pending on Ethereum",
        transactionHash: secondTransactionHash,
      },
    };

    const cleared = clearConfirmedProfileActionStates(
      states,
      new Map([[firstKey, transactionHash]]),
    );
    expect(cleared[firstKey]).toBeUndefined();
    expect(cleared[secondKey]).toEqual(states[secondKey]);

    const hashMismatch = clearConfirmedProfileActionStates(
      states,
      new Map([[firstKey, secondTransactionHash]]),
    );
    expect(hashMismatch).toBe(states);
  });

  it("restores only validated pending transactions for the connected account", () => {
    const stateKey = `${secondAddress.toLowerCase()}:claim`;
    const record = {
      version: 1,
      account: firstAddress.toLowerCase(),
      chainId: 1,
      source: "classic-v3",
      stateKey,
      action: "claim",
      transactionHash,
      submittedAt: 1_800_000_000_000,
    } satisfies PendingProfileTransactionRecord;
    const serialized = JSON.stringify({
      version: 1,
      transactions: [
        record,
        { ...record, account: secondAddress.toLowerCase() },
        { ...record, transactionHash: "0x1234" },
        { ...record, stateKey: `${secondAddress.toLowerCase()}:update-payout` },
        { ...record, chainId: 10 },
      ],
    });

    expect(parsePendingProfileTransactions(serialized, firstAddress)).toEqual([
      record,
    ]);
    expect(parsePendingProfileTransactions(serialized, secondAddress)).toEqual([
      { ...record, account: secondAddress.toLowerCase() },
    ]);
    expect(parsePendingProfileTransactions("{", firstAddress)).toEqual([]);

    const restored = groupPendingProfileTransactionStates([record]);
    expect(restored["classic-v3"][stateKey]).toMatchObject({
      account: firstAddress.toLowerCase(),
      status: "pending",
      transactionHash,
    });
    expect(restored.classic).toEqual({});
    expect(restored.deep).toEqual({});
    expect(restored["stock-paired"]).toEqual({});
  });

  it("upserts and removes one persisted source action without touching siblings", () => {
    const firstKey = `${secondAddress.toLowerCase()}:claim`;
    const secondKey = `${thirdAddress.toLowerCase()}:claim`;
    const firstRecord = {
      version: 1,
      account: firstAddress.toLowerCase(),
      chainId: 1,
      source: "deep",
      stateKey: firstKey,
      action: "claim",
      transactionHash,
      submittedAt: 1_800_000_000_000,
    } satisfies PendingProfileTransactionRecord;
    const siblingRecord = {
      ...firstRecord,
      stateKey: secondKey,
      transactionHash: secondTransactionHash,
    } satisfies PendingProfileTransactionRecord;
    const replacement = {
      ...firstRecord,
      transactionHash: secondTransactionHash,
      submittedAt: firstRecord.submittedAt + 1_000,
    } satisfies PendingProfileTransactionRecord;

    const upserted = upsertPendingProfileTransactionRecords(
      [firstRecord, siblingRecord],
      replacement,
    );
    expect(upserted).toEqual([siblingRecord, replacement]);

    expect(
      removePendingProfileTransactionRecord(upserted, {
        source: replacement.source,
        stateKey: replacement.stateKey,
        transactionHash: replacement.transactionHash,
      }),
    ).toEqual([siblingRecord]);
    expect(
      removePendingProfileTransactionRecord(upserted, {
        source: replacement.source,
        stateKey: replacement.stateKey,
        transactionHash,
      }),
    ).toEqual(upserted);
  });
});
