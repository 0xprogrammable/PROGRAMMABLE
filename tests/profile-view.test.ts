import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

import {
  buildProfilePortfolio,
  groupProfileRewards,
  profileClaimableWei,
  sortProfileTokensByMarketCap,
} from "../components/profile-view";
import type { ClassicV3Reward } from "../lib/profile/classic-v3-rewards";
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
  beneficiaries: [
    {
      beneficiary: firstAddress,
      payoutAddress: firstAddress,
      shareBps: 10_000,
    },
  ],
  launchTransactionHash: `0x${"55".repeat(32)}`,
} satisfies ClassicV3Reward;

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
      classicReward,
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
      classicReward,
    });
  });
});
