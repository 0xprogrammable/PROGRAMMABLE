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
    tokenAddress: LauncherToken["tokenAddress"];
    quoteAssetAddress: LauncherToken["quoteAssetAddress"] | null;
    quoteAssetSymbol: LauncherToken["quoteAssetSymbol"] | null;
    quoteAssetName: LauncherToken["quoteAssetName"] | null;
    quoteIsCurrency0: LauncherToken["quoteIsCurrency0"] | null;
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
    currency: string;
    currencyAddress: `0x${string}` | null;
    buyHookFeeBps: number;
    sellHookFeeBps: number;
    creatorFeeBps: number | null;
    buyCreatorFeeBps: number | null;
    sellCreatorFeeBps: number | null;
    growthFeeBps: number | null;
    programmableFeeBps: number;
    launcherFeeBps: number;
    transferTaxBps: number;
    lpFeePips: number;
    launcherFeeIncludedInHookFee: true;
  };
  launch: {
    /**
     * Backwards-compatible display identifier. Integrators should prefer
     * modelId and modelVersion for durable launch-model classification.
     */
    model: string;
    modelId: NonNullable<LauncherToken["launchModel"]>;
    modelVersion: string | null;
    deepReleaseVersion:
      | "deep-full-range-v1"
      | "deep-full-range-v2"
      | "deep-full-range-v3"
      | null;
    deepV2Provenance: LauncherToken["deepV2Provenance"] | null;
    deepV3Provenance: LauncherToken["deepV3Provenance"] | null;
    creatorAddress: LauncherToken["creatorAddress"] | null;
    transactionHash: LauncherToken["launchTransactionHash"] | null;
    blockNumber: LauncherToken["launchBlockNumber"] | null;
    launchedAt: string;
  };
  liquidityGrowth:
    | {
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
      }
    | {
        growthVaultAddress: `0x${string}`;
        totalNativeAddedToLiquidityWei: string;
        totalTokenAddedToLiquidityRaw: string;
        totalGrowthEthReceivedWei: string;
        totalNativeSwappedWei: string;
        totalTokenAcquiredRaw: string;
        pendingGrowthNativeWei: string;
        lockedLiquidity: string;
        trustedNativeDepthWei: string;
        rollingExposureWei: string;
        compoundCount: string;
        lastCompoundTimestamp: string;
        automationAction: 0 | 1;
        nextCompoundTimestamp: string;
        samePoolPermanentLiquidity: true;
        automationGuaranteed: false;
      }
    | null;
};

export type ProgrammableIndexerFeed = {
  schemaVersion: "programmable-indexer-v1";
  status: ExploreReadModel["status"];
  chainId: number;
  snapshot: ExploreSnapshot | null;
  launchDiscoverySnapshot?: ExploreSnapshot;
  tokens: ProgrammableIndexerToken[];
};

function indexerLinks(token: LauncherToken): IndexerLinks {
  return Object.fromEntries(
    (token.links ?? []).map((link) => [link.kind, link.url]),
  );
}

function launchIdentity(token: LauncherToken) {
  const modelId = token.launchModel ?? "classic";
  const modelVersion =
    token.launchModel === "deep"
      ? token.deepReleaseVersion ?? null
      : token.launchModel === "stock-paired" ||
          token.launchModelVersion === "classic-v3"
        ? token.launchModelVersion ?? null
        : null;

  if (token.launchModel === "stock-paired" && modelVersion === null) {
    throw new Error(
      `Token ${token.tokenAddress} is missing an exact Stock-Paired release`,
    );
  }

  const model =
    token.launchModel === "deep"
      ? token.deepReleaseVersion === "deep-full-range-v3"
        ? "deep-v3"
        : token.deepReleaseVersion === "deep-full-range-v2"
          ? "deep-v2"
          : "deep-v1"
      : modelId;

  return {
    model,
    modelId,
    modelVersion,
  };
}

function serializeLiquidityGrowth(
  token: LauncherToken,
  isDeepV3: boolean,
): ProgrammableIndexerToken["liquidityGrowth"] {
  if (isDeepV3) {
    const required = [
      token.growthVaultAddress,
      token.totalNativeAddedToLiquidityWei,
      token.totalTokenAddedToLiquidityRaw,
      token.totalGrowthEthReceivedWei,
      token.totalNativeSwappedWei,
      token.totalTokenAcquiredRaw,
      token.pendingGrowthNativeWei,
      token.lockedLiquidity,
      token.trustedNativeDepthWei,
      token.rollingExposureWei,
      token.compoundCount,
      token.lastCompoundTimestamp,
      token.nextCompoundTimestamp,
    ];
    if (
      required.some((value) => value === undefined) ||
      token.automationAction === undefined ||
      token.automationAction > 1 ||
      token.automationGuaranteed !== false
    ) {
      throw new Error(
        `Token ${token.tokenAddress} is missing Deep V3 growth accounting`,
      );
    }
    return {
      growthVaultAddress: token.growthVaultAddress!,
      totalNativeAddedToLiquidityWei:
        token.totalNativeAddedToLiquidityWei!,
      totalTokenAddedToLiquidityRaw:
        token.totalTokenAddedToLiquidityRaw!,
      totalGrowthEthReceivedWei: token.totalGrowthEthReceivedWei!,
      totalNativeSwappedWei: token.totalNativeSwappedWei!,
      totalTokenAcquiredRaw: token.totalTokenAcquiredRaw!,
      pendingGrowthNativeWei: token.pendingGrowthNativeWei!,
      lockedLiquidity: token.lockedLiquidity!,
      trustedNativeDepthWei: token.trustedNativeDepthWei!,
      rollingExposureWei: token.rollingExposureWei!,
      compoundCount: token.compoundCount!,
      lastCompoundTimestamp: token.lastCompoundTimestamp!,
      automationAction: token.automationAction as 0 | 1,
      nextCompoundTimestamp: token.nextCompoundTimestamp!,
      samePoolPermanentLiquidity: true,
      automationGuaranteed: false,
    };
  }

  return token.launchModel === "deep" &&
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
    : null;
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
  const isDeepV1 = token.deepReleaseVersion === "deep-full-range-v1";
  const isDeepV2 = token.deepReleaseVersion === "deep-full-range-v2";
  const isDeepV3 = token.deepReleaseVersion === "deep-full-range-v3";
  if (
    (token.launchModel === "deep" &&
      !isDeepV1 &&
      !isDeepV2 &&
      !isDeepV3) ||
    (token.launchModel !== "deep" &&
      (token.deepReleaseVersion !== undefined ||
        token.deepV2Provenance !== undefined ||
        token.deepV3Provenance !== undefined))
  ) {
    throw new Error(
      `Token ${token.tokenAddress} is missing an exact Deep release`,
    );
  }
  const buyCreatorFeeBps = isDeepV3
    ? null
    : token.buyCreatorFeeBps ?? creatorFeeBps ?? null;
  const sellCreatorFeeBps = isDeepV3
    ? null
    : token.sellCreatorFeeBps ?? creatorFeeBps ?? null;
  const growthFeeBps = isDeepV3 ? token.growthFeeBps ?? null : null;
  const programmableFeeBps =
    token.programmableFeeBps ?? launcherFeeBps;
  const launch = launchIdentity(token);
  const isStockPaired = token.launchModel === "stock-paired";
  const quoteAssetAddress = token.quoteAssetAddress ?? null;
  const quoteAssetSymbol = token.quoteAssetSymbol ?? null;
  const quoteAssetName = token.quoteAssetName ?? null;
  const quoteIsCurrency0 = token.quoteIsCurrency0 ?? null;
  if (
    isStockPaired &&
    (!quoteAssetAddress ||
      !quoteAssetSymbol ||
      !quoteAssetName ||
      quoteIsCurrency0 === null ||
      quoteIsCurrency0 !==
        (BigInt(quoteAssetAddress) < BigInt(token.tokenAddress)))
  ) {
    throw new Error(
      `Token ${token.tokenAddress} is missing Stock-Paired pool identity`,
    );
  }
  if (
    buyHookFeeBps === undefined ||
    sellHookFeeBps === undefined ||
    launcherFeeBps === undefined ||
    transferTaxBps === undefined ||
    programmableFeeBps === undefined ||
    (!isDeepV3 &&
      (buyCreatorFeeBps === null ||
        sellCreatorFeeBps === null)) ||
    (isDeepV3 && growthFeeBps === null)
  ) {
    throw new Error(
      `Token ${token.tokenAddress} is missing onchain fee disclosure`,
    );
  }
  if (
    (isDeepV3
      ? growthFeeBps! + programmableFeeBps !== buyHookFeeBps ||
        growthFeeBps! + programmableFeeBps !== sellHookFeeBps ||
        launcherFeeBps !== programmableFeeBps ||
        ![undefined, 0].includes(token.creatorFeeBps) ||
        ![undefined, 0].includes(token.buyCreatorFeeBps) ||
        ![undefined, 0].includes(token.sellCreatorFeeBps)
      : (buyCreatorFeeBps as number) + launcherFeeBps !==
          buyHookFeeBps ||
        (sellCreatorFeeBps as number) + launcherFeeBps !==
          sellHookFeeBps) ||
    transferTaxBps !== 0
  ) {
    throw new Error(`Token ${token.tokenAddress} has an invalid fee disclosure`);
  }
  const deepV2Provenance = token.deepV2Provenance;
  const deepV3Provenance = token.deepV3Provenance;
  if (
    (isDeepV2 &&
      (!deepV2Provenance ||
        token.launchModel !== "deep" ||
        deepV2Provenance.deepReleaseVersion !== "deep-full-range-v2" ||
        deepV2Provenance.tokenAddress.toLowerCase() !==
          token.tokenAddress.toLowerCase() ||
        deepV2Provenance.hookAddress.toLowerCase() !==
          token.hookAddress.toLowerCase() ||
        deepV2Provenance.poolId.toLowerCase() !== token.poolId.toLowerCase() ||
        deepV2Provenance.transactionHash.toLowerCase() !==
          token.launchTransactionHash?.toLowerCase() ||
        deepV2Provenance.creator.toLowerCase() !==
          token.creatorAddress?.toLowerCase() ||
        deepV2Provenance.vaultAddress.toLowerCase() !==
          token.growthVaultAddress?.toLowerCase())) ||
    (!isDeepV2 && deepV2Provenance !== undefined)
  ) {
    throw new Error(
      `Token ${token.tokenAddress} has invalid Deep V2 provenance`,
    );
  }
  if (
    (isDeepV3 &&
      (!deepV3Provenance ||
        token.launchModel !== "deep" ||
        deepV3Provenance.deepReleaseVersion !==
          "deep-full-range-v3" ||
        deepV3Provenance.launchModel !== "deep" ||
        deepV3Provenance.tokenAddress.toLowerCase() !==
          token.tokenAddress.toLowerCase() ||
        deepV3Provenance.hookAddress.toLowerCase() !==
          token.hookAddress.toLowerCase() ||
        deepV3Provenance.poolId.toLowerCase() !==
          token.poolId.toLowerCase() ||
        deepV3Provenance.transactionHash.toLowerCase() !==
          token.launchTransactionHash?.toLowerCase() ||
        deepV3Provenance.transactionIndex !==
          token.launchTransactionIndex ||
        deepV3Provenance.logIndex !== token.launchLogIndex ||
        deepV3Provenance.creator.toLowerCase() !==
          token.creatorAddress?.toLowerCase() ||
        deepV3Provenance.vaultAddress.toLowerCase() !==
          token.growthVaultAddress?.toLowerCase() ||
        deepV3Provenance.positionRecipient.toLowerCase() !==
          token.positionRecipient?.toLowerCase() ||
        deepV3Provenance.positionTokenId !== token.positionTokenId)) ||
    (!isDeepV3 && deepV3Provenance !== undefined) ||
    (isDeepV3 && deepV2Provenance !== undefined)
  ) {
    throw new Error(
      `Token ${token.tokenAddress} has invalid Deep V3 provenance`,
    );
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
      tokenAddress: token.tokenAddress,
      quoteAssetAddress,
      quoteAssetSymbol,
      quoteAssetName,
      quoteIsCurrency0,
      positionRecipient: token.positionRecipient ?? null,
      positionTokenId: token.positionTokenId ?? null,
      tokenLiquidityAmountRaw:
        token.tokenLiquidityAmountRaw ?? null,
      lockedTokenDustRaw: token.lockedTokenDustRaw ?? null,
    },
    fees: {
      model: "uniswap-v4-custom-accounting",
      currency: quoteAssetSymbol ?? "ETH",
      currencyAddress: quoteAssetAddress,
      buyHookFeeBps,
      sellHookFeeBps,
      creatorFeeBps:
        buyCreatorFeeBps !== null &&
        sellCreatorFeeBps !== null &&
        buyCreatorFeeBps === sellCreatorFeeBps
          ? buyCreatorFeeBps
          : null,
      buyCreatorFeeBps,
      sellCreatorFeeBps,
      growthFeeBps,
      programmableFeeBps,
      launcherFeeBps,
      transferTaxBps,
      lpFeePips: token.lpFeePips ?? 0,
      launcherFeeIncludedInHookFee: true,
    },
    launch: {
      ...launch,
      deepReleaseVersion:
        token.launchModel === "deep"
          ? token.deepReleaseVersion!
          : null,
      deepV2Provenance: deepV2Provenance ?? null,
      deepV3Provenance: deepV3Provenance ?? null,
      creatorAddress: token.creatorAddress ?? null,
      transactionHash: token.launchTransactionHash ?? null,
      blockNumber: token.launchBlockNumber ?? null,
      launchedAt: token.launchedAt,
    },
    liquidityGrowth: serializeLiquidityGrowth(token, isDeepV3),
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
    launchDiscoverySnapshot:
      model.status === "ready" ? model.launchDiscoverySnapshot : undefined,
    tokens: model.tokens.map((token) =>
      serializeIndexerToken(token, chainId),
    ),
  };
}

export function findIndexerToken(
  model: ExploreReadModel,
  chainId: number,
  address: string,
) {
  const normalizedAddress = address.toLowerCase();
  const token = model.tokens.find(
    (candidate) =>
      candidate.tokenAddress.toLowerCase() === normalizedAddress,
  );

  return token ? serializeIndexerToken(token, chainId) : null;
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
                : token.launchModel === "stock-paired"
                  ? "v4-stock-paired"
                  : "v4-custom-accounting",
            launchModel: serialized.launch.modelId,
            launchModelVersion: serialized.launch.modelVersion,
            poolId: token.poolId,
            quoteAssetAddress:
              serialized.canonicalPool.quoteAssetAddress,
            quoteAssetSymbol:
              serialized.canonicalPool.quoteAssetSymbol,
            quoteAssetName: serialized.canonicalPool.quoteAssetName,
            quoteIsCurrency0:
              serialized.canonicalPool.quoteIsCurrency0,
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
