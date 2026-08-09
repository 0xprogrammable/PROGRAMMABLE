import {
  isLaunchStampProvenanceV1,
  type CustomProjectExploreEntry,
  type LauncherToken,
} from "../tokens";

function matchingRouterToken(
  project: CustomProjectExploreEntry,
  tokens: readonly LauncherToken[],
) {
  if (!project.tokenAddress) return null;
  return tokens.find(
    (token) => {
      const stamp = token.launchStampProvenance;
      return (
        stamp?.kind === "custom-graph" &&
        isLaunchStampProvenanceV1(stamp, {
          chainId: Number(project.chainId),
          tokenAddress: token.tokenAddress,
          hookAddress: token.hookAddress,
          poolId: token.poolId,
          launchWallet: token.creatorAddress,
          transactionHash: token.launchTransactionHash,
          blockNumber: token.launchBlockNumber,
          transactionIndex: token.launchTransactionIndex,
          launchLogIndex: token.launchLogIndex,
        }) &&
        token.tokenAddress.toLowerCase() ===
          project.tokenAddress?.toLowerCase()
      );
    },
  ) ?? null;
}

function projectContainsPool(
  project: CustomProjectExploreEntry,
  poolId: string,
) {
  const marketPools = [...new Set(
    project.markets.flatMap((market) =>
      market.poolId ? [market.poolId.toLowerCase()] : [],
    ),
  )];
  return marketPools.length === 1 && marketPools[0] === poolId.toLowerCase();
}

/**
 * A canonical Router stamp wins over the older project directory only when
 * both sources identify the exact same token and pool. Any partial collision
 * remains fail-closed instead of silently changing launch provenance.
 */
export function suppressRouterBoundCustomProjectDuplicates(
  tokens: readonly LauncherToken[],
  projects: readonly CustomProjectExploreEntry[],
) {
  return projects.filter((project) => {
    const token = matchingRouterToken(project, tokens);
    if (!token) return true;
    if (!projectContainsPool(project, token.poolId)) {
      throw new Error(
        "Canonical Router and custom directory disagree on token pool binding",
      );
    }
    return false;
  });
}
