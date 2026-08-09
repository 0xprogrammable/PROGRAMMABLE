import {
  isLaunchStampProvenanceV1,
  type CanonicalTokenExploreEntry,
  type LauncherToken,
} from "./tokens";

export function canonicalTokenExploreEntryV1(
  token: LauncherToken,
): CanonicalTokenExploreEntry {
  const stamp = token.launchStampProvenance;
  if (
    stamp !== undefined &&
    (!token.creatorAddress ||
      !token.launchTransactionHash ||
      !token.launchBlockNumber ||
      token.launchTransactionIndex === undefined ||
      token.launchLogIndex === undefined)
  ) {
    throw new Error(`Token ${token.tokenAddress} has incomplete launch coordinates`);
  }
  if (
    stamp !== undefined &&
    !isLaunchStampProvenanceV1(stamp, {
      tokenAddress: token.tokenAddress,
      hookAddress: token.hookAddress,
      poolId: token.poolId,
      launchWallet: token.creatorAddress,
      transactionHash: token.launchTransactionHash,
      blockNumber: token.launchBlockNumber,
      transactionIndex: token.launchTransactionIndex,
      launchLogIndex: token.launchLogIndex,
    })
  ) {
    throw new Error(`Token ${token.tokenAddress} has invalid launch stamp provenance`);
  }

  if (token.launchModel === "custom-graph") {
    if (
      !stamp ||
      stamp.kind !== "custom-graph" ||
      token.launchModelVersion !== "programmable-launch-stamp-router-v1" ||
      token.totalSwapFeeBps !== null ||
      token.liquidityPath !== "programmable-v4"
    ) {
      throw new Error(
        `Token ${token.tokenAddress} is missing canonical Custom Graph provenance`,
      );
    }
  }

  if (stamp) {
    const unknownStampedFees = token.totalSwapFeeBps === null;
    if (
      token.launchModel !==
        (stamp.kind === "custom-graph" ? "custom-graph" : "classic") ||
      token.launchModelVersion !== "programmable-launch-stamp-router-v1" ||
      token.liquidityPath !== "programmable-v4" ||
      !unknownStampedFees ||
      (unknownStampedFees &&
        (token.buyHookFeeBps !== undefined ||
          token.sellHookFeeBps !== undefined ||
          token.creatorFeeBps !== undefined ||
          token.buyCreatorFeeBps !== undefined ||
          token.sellCreatorFeeBps !== undefined ||
          token.growthFeeBps !== undefined ||
          token.programmableFeeBps !== undefined ||
          token.launcherFeeBps !== undefined ||
          token.transferTaxBps !== undefined))
    ) {
      throw new Error(`Token ${token.tokenAddress} has a mismatched launch stamp kind`);
    }
    return {
      ...token,
      exploreKind: "token",
      launchCategoryProvenance: {
        schemaVersion: "programmable.explore-launch-category-provenance.v1",
        category: stamp.kind === "custom-graph" ? "custom" : "classic",
        source: "canonical-launch-stamp-router",
        launchId: stamp.launchId,
        stampHash: stamp.stampHash,
        routerAddress: stamp.routerAddress,
        transactionHash: stamp.transactionHash,
        blockHash: stamp.blockHash,
        blockNumber: stamp.blockNumber,
        transactionIndex: stamp.transactionIndex,
        logIndex: stamp.launchLogIndex,
      },
    };
  }

  if (
    token.launchModel === "custom-graph" ||
    token.totalSwapFeeBps === null ||
    token.liquidityPath !== "meme"
  ) {
    throw new Error(`Token ${token.tokenAddress} has no canonical launch stamp`);
  }

  return {
    ...token,
    exploreKind: "token",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: token.id,
      modelId: token.launchModel ?? null,
      modelVersion: token.launchModelVersion ?? token.deepReleaseVersion ?? null,
    },
  };
}
