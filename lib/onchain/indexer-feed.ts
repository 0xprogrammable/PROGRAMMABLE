import type { LauncherToken, TokenLinkKind } from "../tokens";
import type { ExploreReadModel, ExploreSnapshot } from "./types";

type IndexerLinks = Partial<Record<TokenLinkKind, string>>;

export type ProgrammableIndexerToken = {
  schemaVersion: "programmable-token-v1";
  chainId: number;
  address: LauncherToken["tokenAddress"];
  name: string;
  symbol: string;
  decimals: number;
  description: string | null;
  imageUrl: string | null;
  links: IndexerLinks;
  canonicalPool: {
    protocol: "uniswap-v4";
    poolId: LauncherToken["poolId"];
    hookAddress: LauncherToken["hookAddress"];
    positionRecipient: LauncherToken["positionRecipient"] | null;
    positionTokenId: LauncherToken["positionTokenId"] | null;
    tokenLiquidityAmountRaw:
      | LauncherToken["tokenLiquidityAmountRaw"]
      | null;
    lockedTokenDustRaw:
      | LauncherToken["lockedTokenDustRaw"]
      | null;
  };
  fees: {
    model: "uniswap-v4-custom-accounting";
    currency: "ETH";
    buyHookFeeBps: number;
    sellHookFeeBps: number;
    creatorFeeBps: number | null;
    buyCreatorFeeBps: number;
    sellCreatorFeeBps: number;
    launcherFeeBps: number;
    transferTaxBps: number;
    lpFeePips: number;
    launcherFeeIncludedInHookFee: true;
  };
  launch: {
    creatorAddress: LauncherToken["creatorAddress"] | null;
    transactionHash: LauncherToken["launchTransactionHash"] | null;
    blockNumber: LauncherToken["launchBlockNumber"] | null;
    launchedAt: string;
  };
  liquidityGrowth: {
    growthVaultAddress: `0x${string}`;
    oracleGuardAddress: `0x${string}`;
    upstreamRewardVaultAddress: `0x${string}`;
    growthTargetNativeWei: string;
    completionToleranceNativeWei: string;
    minimumNativeLiquidityForCompletionWei: string;
    tokenReserveRaw: string;
    totalNativeAllocatedToGrowthWei: string;
    totalNativeAddedToLiquidityWei: string;
    pendingGrowthNativeWei: string;
    deferredRewardFeesWei: string;
    growthTargetReached: boolean;
    oracleReady: boolean;
    automationAction: 0 | 1 | 2 | 3;
    nextCompoundTimestamp: string;
    trustedNativeDepthWei: string;
    depthCapNativeWei: string;
    unusedReserveIsActiveLiquidity: false;
    automationGuaranteed: false;
  } | null;
};

export type ProgrammableIndexerFeed = {
  schemaVersion: "programmable-indexer-v1";
  status: ExploreReadModel["status"];
  chainId: number;
  snapshot: ExploreSnapshot | null;
  tokens: ProgrammableIndexerToken[];
};

function indexerLinks(token: LauncherToken): IndexerLinks {
  return Object.fromEntries(
    (token.links ?? []).map((link) => [link.kind, link.url]),
  );
}

export function serializeIndexerToken(
  token: LauncherToken,
  chainId: number,
): ProgrammableIndexerToken {
  const {
    buyHookFeeBps,
    sellHookFeeBps,
    creatorFeeBps,
    launcherFeeBps,
    transferTaxBps,
  } = token;
  const buyCreatorFeeBps = token.buyCreatorFeeBps ?? creatorFeeBps;
  const sellCreatorFeeBps = token.sellCreatorFeeBps ?? creatorFeeBps;
  if (
    buyHookFeeBps === undefined ||
    sellHookFeeBps === undefined ||
    creatorFeeBps === undefined ||
    launcherFeeBps === undefined ||
    transferTaxBps === undefined ||
    buyCreatorFeeBps === undefined ||
    sellCreatorFeeBps === undefined
  ) {
    throw new Error(
      `Token ${token.tokenAddress} is missing onchain fee disclosure`,
    );
  }
  if (
    buyCreatorFeeBps + launcherFeeBps !== buyHookFeeBps ||
    sellCreatorFeeBps + launcherFeeBps !== sellHookFeeBps ||
    transferTaxBps !== 0
  ) {
    throw new Error(`Token ${token.tokenAddress} has an invalid fee disclosure`);
  }

  return {
    schemaVersion: "programmable-token-v1",
    chainId,
    address: token.tokenAddress,
    name: token.name,
    symbol: token.symbol,
    decimals: token.tokenDecimals ?? 18,
    description: token.description ?? null,
    imageUrl: token.imageUrl ?? null,
    links: indexerLinks(token),
    canonicalPool: {
      protocol: "uniswap-v4",
      poolId: token.poolId,
      hookAddress: token.hookAddress,
      positionRecipient: token.positionRecipient ?? null,
      positionTokenId: token.positionTokenId ?? null,
      tokenLiquidityAmountRaw:
        token.tokenLiquidityAmountRaw ?? null,
      lockedTokenDustRaw: token.lockedTokenDustRaw ?? null,
    },
    fees: {
      model: "uniswap-v4-custom-accounting",
      currency: "ETH",
      buyHookFeeBps,
      sellHookFeeBps,
      creatorFeeBps:
        buyCreatorFeeBps === sellCreatorFeeBps
          ? buyCreatorFeeBps
          : null,
      buyCreatorFeeBps,
      sellCreatorFeeBps,
      launcherFeeBps,
      transferTaxBps,
      lpFeePips: token.lpFeePips ?? 0,
      launcherFeeIncludedInHookFee: true,
    },
    launch: {
      creatorAddress: token.creatorAddress ?? null,
      transactionHash: token.launchTransactionHash ?? null,
      blockNumber: token.launchBlockNumber ?? null,
      launchedAt: token.launchedAt,
    },
    liquidityGrowth:
      token.launchModel === "deep" &&
      token.growthVaultAddress &&
      token.oracleGuardAddress &&
      token.upstreamRewardVaultAddress &&
      token.growthTargetNativeWei &&
      token.completionToleranceNativeWei &&
      token.minimumNativeLiquidityForCompletionWei &&
      token.tokenReserveRaw &&
      token.totalNativeAllocatedToGrowthWei &&
      token.totalNativeAddedToLiquidityWei &&
      token.pendingGrowthNativeWei &&
      token.deferredRewardFeesWei &&
      token.growthTargetReached !== undefined &&
      token.oracleReady !== undefined &&
      token.automationAction !== undefined &&
      token.nextCompoundTimestamp !== undefined &&
      token.trustedNativeDepthWei !== undefined &&
      token.depthCapNativeWei !== undefined &&
      token.automationGuaranteed === false
        ? {
            growthVaultAddress: token.growthVaultAddress,
            oracleGuardAddress: token.oracleGuardAddress,
            upstreamRewardVaultAddress: token.upstreamRewardVaultAddress,
            growthTargetNativeWei: token.growthTargetNativeWei,
            completionToleranceNativeWei:
              token.completionToleranceNativeWei,
            minimumNativeLiquidityForCompletionWei:
              token.minimumNativeLiquidityForCompletionWei,
            tokenReserveRaw: token.tokenReserveRaw,
            totalNativeAllocatedToGrowthWei:
              token.totalNativeAllocatedToGrowthWei,
            totalNativeAddedToLiquidityWei:
              token.totalNativeAddedToLiquidityWei,
            pendingGrowthNativeWei: token.pendingGrowthNativeWei,
            deferredRewardFeesWei: token.deferredRewardFeesWei,
            growthTargetReached: token.growthTargetReached,
            oracleReady: token.oracleReady,
            automationAction: token.automationAction,
            nextCompoundTimestamp: token.nextCompoundTimestamp,
            trustedNativeDepthWei: token.trustedNativeDepthWei,
            depthCapNativeWei: token.depthCapNativeWei,
            unusedReserveIsActiveLiquidity: false,
            automationGuaranteed: false,
          }
        : null,
  };
}

export function buildIndexerFeed(
  model: ExploreReadModel,
  chainId: number,
): ProgrammableIndexerFeed {
  return {
    schemaVersion: "programmable-indexer-v1",
    status: model.status,
    chainId,
    snapshot: model.snapshot,
    tokens: model.tokens.map((token) =>
      serializeIndexerToken(token, chainId),
    ),
  };
}

export function buildUniswapTokenList(
  model: ExploreReadModel,
  chainId: number,
  generatedAt = new Date(),
) {
  if (model.tokens.length === 0) {
    throw new Error(
      "A token list cannot be published before the first verified launch",
    );
  }

  return {
    name: "Programmable",
    timestamp: generatedAt.toISOString(),
    version: {
      major: 1,
      minor: model.tokens.length,
      patch: 0,
    },
    keywords: ["programmable", "uniswap v4"],
    tokens: model.tokens.map((token) => {
      const serialized = serializeIndexerToken(token, chainId);
      return {
        chainId,
        address: token.tokenAddress,
        name: token.name,
        symbol: token.symbol,
        decimals: token.tokenDecimals ?? 18,
        ...(token.imageUrl ? { logoURI: token.imageUrl } : {}),
        extensions: {
          programmable: {
            description: token.description ?? null,
            imageUrl: token.imageUrl ?? null,
            links: serialized.links,
            hook: token.hookAddress,
            model:
              token.launchModel === "deep"
                ? "v4-deep-liquidity"
                : "v4-custom-accounting",
            poolId: token.poolId,
            positionRecipient: token.positionRecipient ?? null,
            positionTokenId: token.positionTokenId ?? null,
            tokenLiquidityAmountRaw:
              token.tokenLiquidityAmountRaw ?? null,
            lockedTokenDustRaw: token.lockedTokenDustRaw ?? null,
            buyFeeBps: serialized.fees.buyHookFeeBps,
            sellFeeBps: serialized.fees.sellHookFeeBps,
            creatorFeeBps: serialized.fees.creatorFeeBps,
            buyCreatorFeeBps: serialized.fees.buyCreatorFeeBps,
            sellCreatorFeeBps: serialized.fees.sellCreatorFeeBps,
            launcherFeeBps: serialized.fees.launcherFeeBps,
            transferTaxBps: serialized.fees.transferTaxBps,
            feeIncluded: true,
            liquidityGrowth: serialized.liquidityGrowth,
          },
        },
      };
    }),
  };
}
