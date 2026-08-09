import { formatUnits, type Address } from "viem";

import type { CreatorProfile, ExploreReadModel } from "./types";

function sumStringValues(values: string[]) {
  return values.reduce((total, value) => total + BigInt(value), 0n);
}

export function buildCreatorProfile(
  model: ExploreReadModel,
  account: Address,
  directRewardPoolIds: ReadonlySet<string> = new Set(),
): CreatorProfile {
  const normalizedAccount = account.toLowerCase();
  const tokens = model.tokens.filter(
    (token) =>
      token.creatorAddress?.toLowerCase() === normalizedAccount,
  );
  const rewardTokens = tokens.flatMap((token) => {
    const totalSwapFeeBps = token.totalSwapFeeBps;
    if (
      !directRewardPoolIds.has(token.poolId.toLowerCase()) ||
      token.launchModel !== "classic" ||
      typeof totalSwapFeeBps !== "number" ||
      !Number.isSafeInteger(totalSwapFeeBps) ||
      totalSwapFeeBps < 0
    ) {
      return [];
    }
    return [{ token, totalSwapFeeBps }];
  });
  const tokenPools = new Set(
    rewardTokens.map(({ token }) => token.poolId.toLowerCase()),
  );
  const claims = model.creatorClaims
    .filter(
      (claim) =>
        claim.creatorAddress.toLowerCase() === normalizedAccount &&
        tokenPools.has(claim.poolId.toLowerCase()),
    )
    .sort((first, second) => {
      const firstBlock = BigInt(first.blockNumber);
      const secondBlock = BigInt(second.blockNumber);
      if (firstBlock !== secondBlock) {
        return firstBlock > secondBlock ? -1 : 1;
      }
      if (first.transactionIndex !== second.transactionIndex) {
        return second.transactionIndex - first.transactionIndex;
      }
      return second.logIndex - first.logIndex;
    });
  const pools = rewardTokens.map(({ token, totalSwapFeeBps }) => ({
    tokenAddress: token.tokenAddress,
    name: token.name,
    symbol: token.symbol,
    poolId: token.poolId,
    totalSwapFeeBps,
    launchModel: "classic" as const,
    claimableCreatorFeesWei: token.creatorFeesAccruedWei ?? "0",
    claimableCreatorFeesEth: token.creatorFeesAccruedEth ?? "0",
    generatedCreatorFeesWei: token.creatorFeesGeneratedWei ?? "0",
    generatedCreatorFeesEth: token.creatorFeesGeneratedEth ?? "0",
  }));
  const claimable = sumStringValues(
    pools.map((pool) => pool.claimableCreatorFeesWei),
  );
  const generated = sumStringValues(
    pools.map((pool) => pool.generatedCreatorFeesWei),
  );
  const claimed = sumStringValues(claims.map((claim) => claim.amountWei));

  return {
    status: model.status,
    account,
    tokens,
    pools,
    claims,
    totals: {
      claimableWei: claimable.toString(),
      claimableEth: formatUnits(claimable, 18),
      generatedWei: generated.toString(),
      generatedEth: formatUnits(generated, 18),
      claimedWei: claimed.toString(),
      claimedEth: formatUnits(claimed, 18),
    },
    snapshot: model.snapshot,
  };
}
