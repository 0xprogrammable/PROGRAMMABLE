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
    creatorFeeBps: number;
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
  if (
    buyHookFeeBps === undefined ||
    sellHookFeeBps === undefined ||
    creatorFeeBps === undefined ||
    launcherFeeBps === undefined ||
    transferTaxBps === undefined
  ) {
    throw new Error(
      `Token ${token.tokenAddress} is missing onchain fee disclosure`,
    );
  }
  if (
    buyHookFeeBps !== token.totalSwapFeeBps ||
    sellHookFeeBps !== token.totalSwapFeeBps ||
    creatorFeeBps + launcherFeeBps !== token.totalSwapFeeBps ||
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
      creatorFeeBps,
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
            hook: token.hookAddress,
            model: "v4-custom-accounting",
            positionRecipient: token.positionRecipient ?? null,
            positionTokenId: token.positionTokenId ?? null,
            buyFeeBps: serialized.fees.buyHookFeeBps,
            sellFeeBps: serialized.fees.sellHookFeeBps,
            creatorFeeBps: serialized.fees.creatorFeeBps,
            launcherFeeBps: serialized.fees.launcherFeeBps,
            transferTaxBps: serialized.fees.transferTaxBps,
            feeIncluded: true,
          },
        },
      };
    }),
  };
}
