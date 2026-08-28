import {
  isLaunchStampProvenanceV1,
  isPlatformFeePolicyReadbackV2,
  type LaunchStampProvenanceV1,
  type LauncherToken,
  type TokenLinkKind,
} from "../tokens";
import type { ExploreReadModel, ExploreSnapshot } from "./types";

type IndexerLinks = Partial<Record<TokenLinkKind, string>>;

export type ProgrammableIndexerToken = {
  schemaVersion: "programmable-token-v1";
  chainId: number;
  address: LauncherToken["tokenAddress"];
  name: string;
  symbol: string;
  decimals: number | null;
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
    poolManagerAddress: `0x${string}` | null;
    poolKey: LaunchStampProvenanceV1["poolKey"] | null;
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
    status: "verified" | "unknown";
    model: "uniswap-v4-custom-accounting" | "unknown";
    currency: string | null;
    currencyAddress: `0x${string}` | null;
    buyHookFeeBps: number | null;
    sellHookFeeBps: number | null;
    creatorFeeBps: number | null;
    buyCreatorFeeBps: number | null;
    sellCreatorFeeBps: number | null;
    growthFeeBps: number | null;
    programmableFeeBps: number | null;
    launcherFeeBps: number | null;
    transferTaxBps: number | null;
    lpFeePips: number | null;
    launcherFeeIncludedInHookFee: true | null;
  };
  /**
   * Independent proof of the mandatory Programmable fee path. Overall Custom
   * hook fees remain unknown unless their own onchain disclosure is proven.
   */
  platformFeePolicy: LauncherToken["platformFeePolicy"] | null;
  launch: {
    /**
     * Backwards-compatible display identifier. Integrators should prefer
     * modelId and modelVersion for durable launch-model classification.
     */
    model: string;
    modelId: NonNullable<LauncherToken["launchModel"]>;
    modelVersion: string | null;
    category: "classic" | "custom";
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
    launchStampProvenance: LauncherToken["launchStampProvenance"] | null;
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
          token.launchModel === "custom-graph" ||
          token.launchModelVersion === "classic-v3" ||
          token.launchModelVersion === "classic-v4" ||
          token.launchModelVersion === "programmable-launch-stamp-router-v1"
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
  const isCustomGraph = token.launchModel === "custom-graph";
  const launchStampProvenance = token.launchStampProvenance;
  const isStamped = launchStampProvenance !== undefined;
  if (
    isStamped &&
    (!token.creatorAddress ||
      !token.launchTransactionHash ||
      !token.launchBlockNumber ||
      token.launchTransactionIndex === undefined ||
      token.launchLogIndex === undefined ||
      !isLaunchStampProvenanceV1(launchStampProvenance, {
        chainId,
        tokenAddress: token.tokenAddress,
        hookAddress: token.hookAddress,
        poolId: token.poolId,
        launchWallet: token.creatorAddress,
        transactionHash: token.launchTransactionHash,
        blockNumber: token.launchBlockNumber,
        transactionIndex: token.launchTransactionIndex,
        launchLogIndex: token.launchLogIndex,
      }))
  ) {
    throw new Error(`Token ${token.tokenAddress} has invalid launch stamp provenance`);
  }
  const stampedTokenDecimals =
    Number.isSafeInteger(token.tokenDecimals) &&
    (token.tokenDecimals as number) >= 0 &&
    (token.tokenDecimals as number) <= 255
      ? (token.tokenDecimals as number)
      : null;
  if (
    isStamped &&
    (token.launchModel !==
        (launchStampProvenance.kind === "custom-graph"
          ? "custom-graph"
          : "classic") ||
      token.launchModelVersion !== "programmable-launch-stamp-router-v1" ||
      token.liquidityPath !== "programmable-v4" ||
      token.totalSwapFeeBps !== null)
  ) {
    throw new Error(
      `Token ${token.tokenAddress} has a mismatched launch stamp disclosure`,
    );
  }
  if (
    isCustomGraph && !isStamped
  ) {
    throw new Error(
      `Token ${token.tokenAddress} is missing canonical Custom Graph disclosure`,
    );
  }
  const hasUnknownFees = isStamped;
  if (
    token.platformFeePolicy !== undefined &&
    (
      !isCustomGraph ||
      launchStampProvenance?.kind !== "custom-graph" ||
      !isPlatformFeePolicyReadbackV2(token.platformFeePolicy, {
        tokenAddress: token.tokenAddress,
        hookAddress: token.hookAddress,
        poolId: token.poolId,
      })
    )
  ) {
    throw new Error(
      `Token ${token.tokenAddress} has invalid platform fee policy evidence`,
    );
  }
  if (
    hasUnknownFees &&
    (token.buyHookFeeBps !== undefined ||
      token.sellHookFeeBps !== undefined ||
      token.creatorFeeBps !== undefined ||
      token.buyCreatorFeeBps !== undefined ||
      token.sellCreatorFeeBps !== undefined ||
      token.growthFeeBps !== undefined ||
      token.programmableFeeBps !== undefined ||
      token.launcherFeeBps !== undefined ||
      token.transferTaxBps !== undefined)
  ) {
    throw new Error(
      `Token ${token.tokenAddress} has invented Router fee disclosure`,
    );
  }
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
    (!hasUnknownFees && buyHookFeeBps === undefined) ||
    (!hasUnknownFees && sellHookFeeBps === undefined) ||
    (!hasUnknownFees && launcherFeeBps === undefined) ||
    (!hasUnknownFees && transferTaxBps === undefined) ||
    (!hasUnknownFees && programmableFeeBps === undefined) ||
    (!hasUnknownFees &&
      !isDeepV3 &&
      (buyCreatorFeeBps === null || sellCreatorFeeBps === null)) ||
    (!hasUnknownFees && isDeepV3 && growthFeeBps === null) ||
    (!isStamped && token.totalSwapFeeBps === null)
  ) {
    throw new Error(
      `Token ${token.tokenAddress} is missing onchain fee disclosure`,
    );
  }
  if (
    !hasUnknownFees &&
    (
      (isDeepV3
        ? growthFeeBps! + programmableFeeBps! !== buyHookFeeBps ||
          growthFeeBps! + programmableFeeBps! !== sellHookFeeBps ||
          launcherFeeBps !== programmableFeeBps ||
          ![undefined, 0].includes(token.creatorFeeBps ?? undefined) ||
          ![undefined, 0].includes(token.buyCreatorFeeBps) ||
          ![undefined, 0].includes(token.sellCreatorFeeBps)
        : (buyCreatorFeeBps as number) + launcherFeeBps! !==
            buyHookFeeBps ||
          (sellCreatorFeeBps as number) + launcherFeeBps! !==
            sellHookFeeBps) ||
      transferTaxBps !== 0
    )
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
    decimals: isStamped
      ? stampedTokenDecimals
      : token.tokenDecimals ?? 18,
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
      poolManagerAddress: launchStampProvenance?.poolManagerAddress ?? null,
      poolKey: launchStampProvenance?.poolKey ?? null,
      positionRecipient: isStamped
        ? null
        : token.positionRecipient ?? null,
      positionTokenId: isStamped ? null : token.positionTokenId ?? null,
      tokenLiquidityAmountRaw:
        token.tokenLiquidityAmountRaw ?? null,
      lockedTokenDustRaw: token.lockedTokenDustRaw ?? null,
    },
    fees: {
      status: hasUnknownFees ? "unknown" : "verified",
      model: hasUnknownFees ? "unknown" : "uniswap-v4-custom-accounting",
      currency: hasUnknownFees ? null : quoteAssetSymbol ?? "ETH",
      currencyAddress: hasUnknownFees ? null : quoteAssetAddress,
      buyHookFeeBps: hasUnknownFees ? null : buyHookFeeBps!,
      sellHookFeeBps: hasUnknownFees ? null : sellHookFeeBps!,
      creatorFeeBps:
        !hasUnknownFees &&
        buyCreatorFeeBps !== null &&
        sellCreatorFeeBps !== null &&
        buyCreatorFeeBps === sellCreatorFeeBps
          ? buyCreatorFeeBps
          : null,
      buyCreatorFeeBps: hasUnknownFees ? null : buyCreatorFeeBps,
      sellCreatorFeeBps: hasUnknownFees ? null : sellCreatorFeeBps,
      growthFeeBps: hasUnknownFees ? null : growthFeeBps,
      programmableFeeBps: hasUnknownFees ? null : programmableFeeBps!,
      launcherFeeBps: hasUnknownFees ? null : launcherFeeBps!,
      transferTaxBps: hasUnknownFees ? null : transferTaxBps!,
      lpFeePips: hasUnknownFees ? null : token.lpFeePips ?? 0,
      launcherFeeIncludedInHookFee: hasUnknownFees ? null : true,
    },
    platformFeePolicy: token.platformFeePolicy ?? null,
    launch: {
      ...launch,
      category:
        launchStampProvenance?.kind === "custom-graph"
          ? "custom"
          : "classic",
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
      launchStampProvenance: launchStampProvenance ?? null,
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

export const UNISWAP_TOKEN_LIST_OMISSION_REASON =
  "missing-valid-decimals" as const;

export function buildUniswapTokenListResult(
  model: ExploreReadModel,
  chainId: number,
  generatedAt = new Date(),
) {
  if (model.tokens.length === 0) {
    throw new Error(
      "A token list cannot be published before the first finalized launch",
    );
  }

  const tokens = model.tokens.flatMap((token) => {
    const serialized = serializeIndexerToken(token, chainId);
    if (serialized.decimals === null) return [];
    return [
      {
        chainId,
        address: token.tokenAddress,
        name: token.name,
        symbol: token.symbol,
        decimals: serialized.decimals,
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
                  : token.launchModel === "custom-graph"
                    ? "v4-programmable-custom-graph"
                    : "v4-custom-accounting",
            launchModel: serialized.launch.modelId,
            launchModelVersion: serialized.launch.modelVersion,
            launchCategory: serialized.launch.category,
            launchStampProvenance:
              serialized.launch.launchStampProvenance,
            poolId: token.poolId,
            quoteAssetAddress:
              serialized.canonicalPool.quoteAssetAddress,
            quoteAssetSymbol:
              serialized.canonicalPool.quoteAssetSymbol,
            quoteAssetName: serialized.canonicalPool.quoteAssetName,
            quoteIsCurrency0:
              serialized.canonicalPool.quoteIsCurrency0,
            positionRecipient:
              serialized.canonicalPool.positionRecipient,
            positionTokenId: serialized.canonicalPool.positionTokenId,
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
            feeStatus: serialized.fees.status,
            feeIncluded:
              serialized.fees.launcherFeeIncludedInHookFee,
            platformFeePolicy: serialized.platformFeePolicy,
            liquidityGrowth: serialized.liquidityGrowth,
          },
        },
      },
    ];
  });
  const omittedTokenCount = model.tokens.length - tokens.length;

  return {
    tokenList:
      tokens.length === 0
        ? null
        : {
            name: "Programmable",
            timestamp: generatedAt.toISOString(),
            version: {
              major: 1,
              minor: model.tokens.length,
              patch: 0,
            },
            keywords: ["programmable", "uniswap v4"],
            tokens,
          },
    omissions: {
      count: omittedTokenCount,
      reason:
        omittedTokenCount === 0
          ? null
          : UNISWAP_TOKEN_LIST_OMISSION_REASON,
    },
  };
}

export function buildUniswapTokenList(
  model: ExploreReadModel,
  chainId: number,
  generatedAt = new Date(),
) {
  const result = buildUniswapTokenListResult(model, chainId, generatedAt);
  if (result.tokenList === null) {
    throw new Error(
      "A token list cannot be published without a token with valid decimals",
    );
  }
  return result.tokenList;
}
