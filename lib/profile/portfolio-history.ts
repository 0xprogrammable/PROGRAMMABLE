import {
  getAddress,
  isAddress,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";

import type { LauncherToken } from "../tokens";
import type { ExploreReadModel, ExploreSnapshot } from "../onchain/types";

export const PORTFOLIO_HISTORY_SCHEMA =
  "programmable-portfolio-history-v1" as const;
export const PORTFOLIO_HISTORY_INTERVAL_MS = 5 * 60 * 1_000;

type PortfolioHistoryLaunchModel =
  | "classic"
  | "adaptive"
  | "deep"
  | "stock-paired"
  | "custom-graph";

export type PortfolioHistoryTokenPoint = {
  tokenAddress: Address;
  creatorAddress: Address;
  launchModel: PortfolioHistoryLaunchModel;
  marketCapUsdWad: string | null;
  marketCapNativeWei: string | null;
  marketCapQuoteWad: string | null;
  quoteAssetSymbol: string | null;
  grossVolumeNativeWei: string | null;
  creatorRewardsGeneratedWei: string | null;
  creatorRewardsClaimableWei: string | null;
};

export type PortfolioHistoryPayload = {
  bucketStartedAt: string;
  capturedAt: string;
  snapshot: ExploreSnapshot;
  tokens: PortfolioHistoryTokenPoint[];
};

export type PortfolioHistoryEnvelope = {
  schemaVersion: typeof PORTFOLIO_HISTORY_SCHEMA;
  contentHash: Hex;
  payload: PortfolioHistoryPayload;
};

const DECIMAL_INTEGER = /^(0|[1-9]\d*)$/;

function integerOrNull(value: string | undefined, label: string) {
  if (value === undefined) return null;
  if (!DECIMAL_INTEGER.test(value)) {
    throw new Error(`${label} is not an unsigned integer`);
  }
  return value;
}

function historyLaunchModel(
  token: LauncherToken,
): PortfolioHistoryLaunchModel {
  return token.launchModel ?? "classic";
}

function tokenPoint(
  token: LauncherToken,
): PortfolioHistoryTokenPoint | null {
  if (!token.creatorAddress) return null;
  if (!isAddress(token.tokenAddress) || !isAddress(token.creatorAddress)) {
    throw new Error("Portfolio history contains an invalid token address");
  }

  return {
    tokenAddress: getAddress(token.tokenAddress),
    creatorAddress: getAddress(token.creatorAddress),
    launchModel: historyLaunchModel(token),
    marketCapUsdWad: integerOrNull(
      token.fdvUsdWad,
      "Token USD market cap",
    ),
    marketCapNativeWei: integerOrNull(
      token.marketCapEthWei,
      "Token native market cap",
    ),
    marketCapQuoteWad: integerOrNull(
      token.marketCapQuoteWad,
      "Token quote market cap",
    ),
    quoteAssetSymbol: token.quoteAssetSymbol?.trim() || null,
    grossVolumeNativeWei: integerOrNull(
      token.grossVolumeWei,
      "Token native volume",
    ),
    creatorRewardsGeneratedWei: integerOrNull(
      token.creatorFeesGeneratedWei,
      "Generated creator rewards",
    ),
    creatorRewardsClaimableWei: integerOrNull(
      token.creatorFeesAccruedWei,
      "Claimable creator rewards",
    ),
  };
}

export function portfolioHistoryBucketStart(
  capturedAt: Date,
): string {
  const timestamp = capturedAt.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error("Portfolio history capture time is invalid");
  }
  return new Date(
    Math.floor(timestamp / PORTFOLIO_HISTORY_INTERVAL_MS) *
      PORTFOLIO_HISTORY_INTERVAL_MS,
  ).toISOString();
}

export function portfolioHistoryPath(
  chainId: number,
  bucketStartedAt: string,
) {
  if (!Number.isSafeInteger(chainId) || chainId < 1) {
    throw new Error("Portfolio history chain ID is invalid");
  }
  const bucket = new Date(bucketStartedAt);
  if (
    !Number.isFinite(bucket.getTime()) ||
    portfolioHistoryBucketStart(bucket) !== bucketStartedAt
  ) {
    throw new Error("Portfolio history bucket is invalid");
  }

  const day = bucketStartedAt.slice(0, 10).replaceAll("-", "/");
  const filename = bucketStartedAt
    .slice(11, 19)
    .replaceAll(":", "-");
  return `history/portfolio/v1/${chainId}/${day}/${filename}.json`;
}

export function buildPortfolioHistoryEnvelope(
  model: ExploreReadModel,
  capturedAt = new Date(),
): PortfolioHistoryEnvelope {
  if (model.status !== "ready") {
    throw new Error(
      "Portfolio history requires a confirmed ready Explore model",
    );
  }

  const seenTokens = new Set<string>();
  const tokens = model.tokens
    .map(tokenPoint)
    .filter(
      (token): token is PortfolioHistoryTokenPoint => token !== null,
    )
    .sort((first, second) =>
      first.tokenAddress
        .toLowerCase()
        .localeCompare(second.tokenAddress.toLowerCase()),
    );

  for (const token of tokens) {
    const normalized = token.tokenAddress.toLowerCase();
    if (seenTokens.has(normalized)) {
      throw new Error(
        "Portfolio history contains a duplicate token address",
      );
    }
    seenTokens.add(normalized);
  }

  const payload: PortfolioHistoryPayload = {
    bucketStartedAt: portfolioHistoryBucketStart(capturedAt),
    capturedAt: capturedAt.toISOString(),
    snapshot: model.snapshot,
    tokens,
  };

  return {
    schemaVersion: PORTFOLIO_HISTORY_SCHEMA,
    contentHash: keccak256(toBytes(JSON.stringify(payload))),
    payload,
  };
}

export function validatePortfolioHistoryEnvelope(
  envelope: PortfolioHistoryEnvelope,
) {
  if (
    envelope.schemaVersion !== PORTFOLIO_HISTORY_SCHEMA ||
    !envelope.payload
  ) {
    return false;
  }
  try {
    if (
      portfolioHistoryBucketStart(
        new Date(envelope.payload.bucketStartedAt),
      ) !== envelope.payload.bucketStartedAt
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return (
    keccak256(toBytes(JSON.stringify(envelope.payload))).toLowerCase() ===
    envelope.contentHash.toLowerCase()
  );
}
