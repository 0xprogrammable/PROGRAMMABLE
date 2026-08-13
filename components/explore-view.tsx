"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  X as CloseIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  formatMarketCapMetric,
  type MarketCapMetric,
} from "@/components/animated-market-cap";
import { XBrandIcon } from "@/components/brand-icons";
import { EXPLORE_PREVIEW_TOKENS } from "@/components/explore-preview-data";
import { useInterfacePreview } from "@/components/interface-preview";
import { SiteFooter } from "@/components/site-footer";
import {
  LIVE_DATA_REFRESH_INTERVAL_MS,
  shouldRefreshLiveData,
  useLiveDataRefresh,
} from "@/components/use-live-data-refresh";
import { WebsiteLinkIcon } from "@/components/website-link-icon";
import { parseDiscoverableMarketTradeCapabilityV1 } from "@/lib/custom-launch/trade-capability-v1";
import {
  exploreValuation,
  isExploreDataQuality,
  isExploreValuation,
  type ExploreDataQuality,
  type ExploreValuation,
  type ValuedExploreEntry,
} from "@/lib/explore-financial-data";
import {
  isTokenMarketDataV1,
  marketDataStatusLabel,
} from "@/lib/market-data/market-data-v1";
import { parseExploreSort } from "@/lib/onchain/query";
import {
  canOptimizeTokenImage,
  getTokenCardImageSource,
} from "@/lib/token-image";
import {
  isLaunchStampProvenanceV1,
  type ExploreEntry,
  type ExploreLaunchCategoryProvenance,
  type LauncherToken,
  type TokenLink,
} from "@/lib/tokens";
import styles from "./explore-experience.module.css";

type TokenCard = {
  id: string;
  name: string;
  description?: string;
  imageUrl: string;
  links: readonly TokenLink[];
  valuation?: MarketCapMetric;
  valuationMetric?: "Market cap" | "FDV";
  marketStatus?:
    | "No market"
    | "Waiting for first trade"
    | "Last verified"
    | "Limited market data"
    | "Unavailable";
  usesFallbackImage: boolean;
  tokenAddress?: `0x${string}`;
  launchCategory: "Classic" | "Custom";
};

export function exploreMarketStatusLabel(
  entry: ExploreEntry | ValuedExploreEntry,
):
  | "No market"
  | "Waiting for first trade"
  | "Last verified"
  | "Limited market data"
  | "Unavailable"
  | undefined {
  const marketData = (entry as Partial<ValuedExploreEntry>).marketData;
  if (marketData && isTokenMarketDataV1(marketData)) {
    return marketDataStatusLabel(marketData);
  }
  if (entry.exploreKind === "custom-project" && entry.markets.length === 0) {
    return "No market";
  }
  const explicit = (entry as Partial<ValuedExploreEntry>).valuation;
  const valuation = isExploreValuation(explicit)
    ? explicit
    : exploreValuation(entry);
  if (valuation.status === "unavailable") return "Unavailable";
  if (valuation.freshness === "stale") return "Last verified";
  if (valuation.freshness === "unknown") return "Unavailable";
  return undefined;
}

type TokenSort = "newest" | "oldest" | "market-cap" | "market-cap-asc";
export type ExploreSocialFilter = "all" | "yes" | "no";
export type ExploreModelFilter = "all" | "classic" | "custom-hook";

type ExploreValuationSnapshotV1 = Readonly<{
  schemaVersion: "programmable.explore-valuation-snapshot.v1";
  chainId: 1;
  blockNumber: string;
  blockHash: `0x${string}`;
  liquidityBlockNumber: string | "none";
  liquidityBlockHash: `0x${string}` | "none";
  rankingCommitment: `sha256:${string}`;
  sort: "market-cap" | "market-cap-asc";
  query: string;
  socials: "yes" | "no" | null;
  pageSize: number;
}>;

type ExplorePayload = {
  status: "ready" | "not-deployed";
  tokens: ValuedExploreEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  dataQuality?: ExploreDataQuality;
  valuationSnapshot?: ExploreValuationSnapshotV1;
};

type ExploreState =
  | { phase: "loading" }
  | {
      phase: "error";
      message: string;
      requestKey: string;
      contentKey: string;
    }
  | {
      phase: "ready";
      payload: ExplorePayload;
      requestKey: string;
      contentKey: string;
      refreshError?: string;
    };

export type ExploreInitialResponse = Readonly<{
  ok: boolean;
  body: unknown;
}>;

export function preserveExplorePayloadOnRefreshFailure(
  current: ExploreState,
  input: {
    contentKey: string;
    requestKey: string;
    message: string;
  },
): ExploreState {
  return current.phase === "ready" && current.contentKey === input.contentKey
    ? {
        ...current,
        requestKey: input.requestKey,
        refreshError: input.message,
      }
    : {
        phase: "error",
        contentKey: input.contentKey,
        requestKey: input.requestKey,
        message: input.message,
      };
}

type PaginationItem = number | "start-gap" | "end-gap";

export const EXPLORE_TOKENS_PER_PAGE = 9;
export const EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE = 100;
const QUERY_DEBOUNCE_MS = 200;
const EXPLORE_REQUEST_TIMEOUT_MS = 12_000;
const EXPLORE_MARKET_CAP_TRANSIENT_RETRY_LIMIT = 1;
export const EXPLORE_REFRESH_INTERVAL_MS = LIVE_DATA_REFRESH_INTERVAL_MS;
const fallbackTokenImages = [
  "/brand/programmable-token-fallback-01-dawn.webp",
  "/brand/programmable-token-fallback-02-moon.webp",
  "/brand/programmable-token-fallback-03-sun.webp",
  "/brand/programmable-token-fallback-04-mint.webp",
  "/brand/programmable-token-fallback-05-lavender.webp",
  "/brand/programmable-token-fallback-06-dusk.webp",
] as const;
const sortOptions: { id: TokenSort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "market-cap", label: "Highest FDV" },
  { id: "market-cap-asc", label: "Lowest FDV" },
];
const socialFilterOptions: {
  id: Exclude<ExploreSocialFilter, "all">;
  label: string;
}[] = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];
const modelFilterOptions: {
  id: Exclude<ExploreModelFilter, "all">;
  label: string;
}[] = [
  { id: "classic", label: "Classic" },
  { id: "custom-hook", label: "Custom" },
];
const tokenLinkOrder: Record<TokenLink["kind"], number> = {
  website: 0,
  x: 1,
  telegram: 2,
};

function launchBlockNumber(token: LauncherToken) {
  return token.launchBlockNumber && /^\d+$/.test(token.launchBlockNumber)
    ? BigInt(token.launchBlockNumber)
    : 0n;
}

function comparePreviewLaunchOrder(left: LauncherToken, right: LauncherToken) {
  const leftBlock = launchBlockNumber(left);
  const rightBlock = launchBlockNumber(right);
  if (leftBlock !== rightBlock) return leftBlock < rightBlock ? -1 : 1;

  const leftTransaction = left.launchTransactionIndex ?? 0;
  const rightTransaction = right.launchTransactionIndex ?? 0;
  if (leftTransaction !== rightTransaction) {
    return leftTransaction - rightTransaction;
  }

  const leftLog = left.launchLogIndex ?? 0;
  const rightLog = right.launchLogIndex ?? 0;
  if (leftLog !== rightLog) return leftLog - rightLog;

  if (leftBlock === 0n) {
    const leftTime = Date.parse(left.launchedAt);
    const rightTime = Date.parse(right.launchedAt);
    if (
      Number.isFinite(leftTime) &&
      Number.isFinite(rightTime) &&
      leftTime !== rightTime
    ) {
      return leftTime - rightTime;
    }
  }

  return left.tokenAddress.localeCompare(right.tokenAddress);
}

export function shouldRefreshExplore(input: {
  visibilityState: DocumentVisibilityState;
  lastRefreshAt: number;
  now: number;
}) {
  return shouldRefreshLiveData({
    ...input,
    intervalMs: EXPLORE_REFRESH_INTERVAL_MS,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function safeImageUrl(value: unknown) {
  if (typeof value !== "string") return undefined;

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.hostname
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function parseTokenLink(value: unknown): TokenLink | null {
  if (!isRecord(value)) return null;
  if (
    value.kind !== "website" &&
    value.kind !== "x" &&
    value.kind !== "telegram"
  ) {
    return null;
  }
  if (typeof value.url !== "string") return null;

  try {
    const url = new URL(value.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return { kind: value.kind, url: value.url };
}

function parseLauncherToken(value: unknown): LauncherToken | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.symbol !== "string" ||
    !isTokenAddress(value.tokenAddress) ||
    !isTokenAddress(value.hookAddress) ||
    !isBytes32(value.poolId) ||
    typeof value.launchedAt !== "string" ||
    (value.totalSwapFeeBps !== null &&
      (typeof value.totalSwapFeeBps !== "number" ||
        !Number.isSafeInteger(value.totalSwapFeeBps) ||
        value.totalSwapFeeBps < 0)) ||
    (value.liquidityPath !== "meme" &&
      value.liquidityPath !== "programmable-v4")
  ) {
    return null;
  }

  const stamp = value.launchStampProvenance;
  if (
    stamp !== undefined &&
    (!isTokenAddress(value.creatorAddress) ||
      !isBytes32(value.launchTransactionHash) ||
      typeof value.launchBlockNumber !== "string" ||
      !/^[1-9][0-9]*$/u.test(value.launchBlockNumber) ||
      !Number.isSafeInteger(value.launchTransactionIndex) ||
      Number(value.launchTransactionIndex) < 0 ||
      !Number.isSafeInteger(value.launchLogIndex) ||
      Number(value.launchLogIndex) < 0 ||
      !isLaunchStampProvenanceV1(stamp, {
        tokenAddress: value.tokenAddress,
        hookAddress: value.hookAddress,
        poolId: value.poolId,
        launchWallet: value.creatorAddress,
        transactionHash: value.launchTransactionHash,
        blockNumber: value.launchBlockNumber,
        transactionIndex: Number(value.launchTransactionIndex),
        launchLogIndex: Number(value.launchLogIndex),
      }))
  ) {
    return null;
  }
  const stamped = stamp !== undefined;
  const unknownStampedFees = stamped && value.totalSwapFeeBps === null;
  if (
    stamped
      ? value.launchModel !==
          (stamp.kind === "custom-graph" ? "custom-graph" : "classic") ||
        value.launchModelVersion !== "programmable-launch-stamp-router-v1" ||
        value.liquidityPath !== "programmable-v4" ||
        !unknownStampedFees ||
        (unknownStampedFees &&
          (value.buyHookFeeBps !== undefined ||
            value.sellHookFeeBps !== undefined ||
            value.creatorFeeBps !== undefined ||
            value.buyCreatorFeeBps !== undefined ||
            value.sellCreatorFeeBps !== undefined ||
            value.growthFeeBps !== undefined ||
            value.programmableFeeBps !== undefined ||
            value.launcherFeeBps !== undefined ||
            value.transferTaxBps !== undefined))
      : value.launchModel === "custom-graph" ||
        value.totalSwapFeeBps === null ||
        value.liquidityPath !== "meme"
  ) {
    return null;
  }

  const links = Array.isArray(value.links)
    ? value.links
        .map(parseTokenLink)
        .filter((link): link is TokenLink => link !== null)
    : [];

  return {
    ...(value as unknown as LauncherToken),
    links,
    description:
      typeof value.description === "string" ? value.description : undefined,
    imageUrl: safeImageUrl(value.imageUrl),
  };
}

function parseLaunchCategoryProvenance(
  value: unknown,
  category: "classic" | "custom",
): ExploreLaunchCategoryProvenance | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !==
      "programmable.explore-launch-category-provenance.v1" ||
    value.category !== category
  )
    return null;
  if (value.source === "canonical-launch-stamp-router") {
    return isBytes32(value.launchId) &&
      isBytes32(value.stampHash) &&
      isTokenAddress(value.routerAddress) &&
      isBytes32(value.transactionHash) &&
      isBytes32(value.blockHash) &&
      typeof value.blockNumber === "string" &&
      /^[1-9][0-9]*$/u.test(value.blockNumber) &&
      Number.isSafeInteger(value.transactionIndex) &&
      Number(value.transactionIndex) >= 0 &&
      Number.isSafeInteger(value.logIndex) &&
      Number(value.logIndex) >= 0
      ? (value as unknown as ExploreLaunchCategoryProvenance)
      : null;
  }
  if (category === "classic") {
    return value.source === "canonical-launch-read-model" &&
      typeof value.recordId === "string" &&
      (typeof value.modelId === "string" || value.modelId === null) &&
      (typeof value.modelVersion === "string" || value.modelVersion === null)
      ? (value as unknown as ExploreLaunchCategoryProvenance)
      : null;
  }
  const baseValid =
    isSha256(value.projectId) &&
    isSha256(value.launchId) &&
    isSha256(value.sourceRecordBindingHash) &&
    isSha256(value.finalizedLaunchBindingHash);
  if (!baseValid) return null;
  if (value.source === "interface-preview") {
    return value as unknown as ExploreLaunchCategoryProvenance;
  }
  return value.source === "registry.custom-launched" &&
    isTokenAddress(value.registryAddress) &&
    typeof value.registryStartBlock === "string" &&
    /^[1-9][0-9]*$/u.test(value.registryStartBlock) &&
    isBytes32(value.transactionHash) &&
    isBytes32(value.blockHash) &&
    typeof value.blockNumber === "string" &&
    /^[1-9][0-9]*$/u.test(value.blockNumber) &&
    Number.isSafeInteger(value.transactionIndex) &&
    Number(value.transactionIndex) >= 0 &&
    Number.isSafeInteger(value.logIndex) &&
    Number(value.logIndex) >= 0 &&
    isBytes32(value.configurationHash)
    ? (value as unknown as ExploreLaunchCategoryProvenance)
    : null;
}

function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function parseCustomExploreAsset(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.assetId !== "string" ||
    !isRecord(value.identity) ||
    typeof value.identity.namespace !== "string" ||
    typeof value.identity.value !== "string" ||
    (value.decimals !== undefined &&
      (!Number.isSafeInteger(value.decimals) ||
        Number(value.decimals) < 0 ||
        Number(value.decimals) > 255))
  )
    return null;
  return {
    assetId: value.assetId,
    identity: {
      namespace: value.identity.namespace,
      value: value.identity.value,
    },
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.symbol === "string" ? { symbol: value.symbol } : {}),
    ...(value.decimals === undefined
      ? {}
      : { decimals: Number(value.decimals) }),
  };
}

function parseCustomExploreMarkets(value: unknown, chainId: string) {
  if (!Array.isArray(value) || value.length > 256) return null;
  type CustomMarket = Extract<
    ExploreEntry,
    { exploreKind: "custom-project" }
  >["markets"][number];
  const markets: CustomMarket[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      typeof candidate.marketId !== "string" ||
      typeof candidate.kind !== "string" ||
      !["active", "paused", "closed", "verification_pending"].includes(
        String(candidate.status),
      ) ||
      (candidate.poolId !== undefined && !isBytes32(candidate.poolId))
    )
      return null;
    const baseAsset = parseCustomExploreAsset(candidate.baseAsset);
    const quoteAsset = parseCustomExploreAsset(candidate.quoteAsset);
    if (baseAsset === null || quoteAsset === null) return null;
    const capability =
      candidate.tradeCapability === undefined
        ? undefined
        : parseDiscoverableMarketTradeCapabilityV1({
            value: candidate.tradeCapability,
            chainId,
            marketId: candidate.marketId,
            baseAssetId: baseAsset.assetId,
            quoteAssetId: quoteAsset.assetId,
            ...(candidate.poolId === undefined
              ? {}
              : { poolId: candidate.poolId }),
          });
    if (candidate.tradeCapability !== undefined && capability === null)
      return null;
    markets.push({
      marketId: candidate.marketId,
      kind: candidate.kind,
      status: candidate.status as CustomMarket["status"],
      ...(candidate.poolId === undefined ? {} : { poolId: candidate.poolId }),
      baseAsset,
      quoteAsset,
      ...(capability === undefined
        ? {}
        : { tradeCapability: capability as CustomMarket["tradeCapability"] }),
    });
  }
  return markets;
}

function parseCustomExploreEntry(value: unknown): ExploreEntry | null {
  const categoryProvenance = isRecord(value)
    ? parseLaunchCategoryProvenance(value.launchCategoryProvenance, "custom")
    : null;
  if (
    !isRecord(value) ||
    value.exploreKind !== "custom-project" ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.launchedAt !== "string" ||
    typeof value.finalizedAt !== "string" ||
    typeof value.chainId !== "string" ||
    typeof value.modelId !== "string" ||
    !isSha256(value.customProjectId) ||
    !isSha256(value.customLaunchId) ||
    !isRecord(value.launchingWallet) ||
    typeof value.launchingWallet.namespace !== "string" ||
    typeof value.launchingWallet.value !== "string" ||
    !/^eip155:[1-9][0-9]*$/u.test(value.launchingWallet.namespace) ||
    !/^0x[0-9a-f]{40}$/u.test(value.launchingWallet.value) ||
    !isSha256(value.postLaunchAuthorityInventoryHash) ||
    !isRecord(value.postLaunchAuthorityInventory) ||
    value.postLaunchAuthorityInventory.schemaVersion !==
      "programmable.post-launch-authority-inventory.v1" ||
    value.postLaunchAuthorityInventory.postLaunchAuthorityInventoryHash !==
      value.postLaunchAuthorityInventoryHash ||
    value.postLaunchAuthorityInventory.githubAuthority !==
      "provenance-only-never-post-launch-authority" ||
    !Array.isArray(value.postLaunchAuthorityInventory.postLaunchAuthorities) ||
    !Array.isArray(value.markets) ||
    !Array.isArray(value.links) ||
    categoryProvenance === null ||
    categoryProvenance.source === "canonical-launch-stamp-router"
  )
    return null;
  const links = value.links.map(parseTokenLink);
  if (links.some((link) => link === null)) return null;
  if (value.tokenAddress !== undefined && !isTokenAddress(value.tokenAddress)) {
    return null;
  }
  if (
    value.tokenDecimals !== undefined &&
    (!Number.isSafeInteger(value.tokenDecimals) ||
      Number(value.tokenDecimals) < 0 ||
      Number(value.tokenDecimals) > 255)
  )
    return null;
  const markets = parseCustomExploreMarkets(value.markets, value.chainId);
  if (markets === null) return null;
  return {
    exploreKind: "custom-project",
    id: value.id,
    name: value.name,
    ...(typeof value.symbol === "string" ? { symbol: value.symbol } : {}),
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
    ...(safeImageUrl(value.imageUrl)
      ? { imageUrl: value.imageUrl as string }
      : {}),
    links: links as TokenLink[],
    launchedAt: value.launchedAt,
    finalizedAt: value.finalizedAt,
    chainId: value.chainId,
    modelId: value.modelId,
    customProjectId: value.customProjectId,
    customLaunchId: value.customLaunchId,
    launchingWallet: value.launchingWallet as Extract<
      ExploreEntry,
      { exploreKind: "custom-project" }
    >["launchingWallet"],
    postLaunchAuthorityInventory: value.postLaunchAuthorityInventory as Extract<
      ExploreEntry,
      { exploreKind: "custom-project" }
    >["postLaunchAuthorityInventory"],
    postLaunchAuthorityInventoryHash: value.postLaunchAuthorityInventoryHash,
    markets,
    ...(value.tokenAddress === undefined
      ? {}
      : { tokenAddress: value.tokenAddress }),
    ...(value.tokenDecimals === undefined
      ? {}
      : { tokenDecimals: value.tokenDecimals as number }),
    launchCategoryProvenance: value.launchCategoryProvenance as Extract<
      ExploreEntry,
      { exploreKind: "custom-project" }
    >["launchCategoryProvenance"],
  };
}

function parseExploreEntry(value: unknown): ValuedExploreEntry | null {
  const attachValuation = <T extends ExploreEntry>(entry: T) => {
    const valuation =
      isRecord(value) && value.valuation === undefined
        ? exploreValuation(entry)
        : isRecord(value) && isExploreValuation(value.valuation)
          ? value.valuation
          : null;
    const marketData =
      isRecord(value) && value.marketData !== undefined
        ? isTokenMarketDataV1(value.marketData)
          ? value.marketData
          : null
        : undefined;
    return valuation === null || marketData === null
      ? null
      : {
          ...entry,
          valuation,
          ...(marketData === undefined ? {} : { marketData }),
        };
  };
  if (isRecord(value) && value.exploreKind === "custom-project") {
    const entry = parseCustomExploreEntry(value);
    return entry ? attachValuation(entry) : null;
  }
  const token = parseLauncherToken(value);
  const expectedCategory =
    token?.launchStampProvenance?.kind === "custom-graph"
      ? "custom"
      : "classic";
  const categoryProvenance = isRecord(value)
    ? parseLaunchCategoryProvenance(
        value.launchCategoryProvenance,
        expectedCategory,
      )
    : null;
  if (
    !token ||
    !isRecord(value) ||
    value.exploreKind !== "token" ||
    categoryProvenance === null
  )
    return null;
  const stamp = token.launchStampProvenance;
  if (stamp) {
    if (
      categoryProvenance.source !== "canonical-launch-stamp-router" ||
      categoryProvenance.launchId.toLowerCase() !==
        stamp.launchId.toLowerCase() ||
      categoryProvenance.stampHash.toLowerCase() !==
        stamp.stampHash.toLowerCase() ||
      categoryProvenance.routerAddress.toLowerCase() !==
        stamp.routerAddress.toLowerCase() ||
      categoryProvenance.transactionHash.toLowerCase() !==
        stamp.transactionHash.toLowerCase() ||
      categoryProvenance.blockHash.toLowerCase() !==
        stamp.blockHash.toLowerCase() ||
      categoryProvenance.blockNumber !== stamp.blockNumber ||
      categoryProvenance.transactionIndex !== stamp.transactionIndex ||
      categoryProvenance.logIndex !== stamp.launchLogIndex
    ) {
      return null;
    }
  } else if (categoryProvenance.source === "canonical-launch-stamp-router") {
    return null;
  }
  return attachValuation({
    ...token,
    exploreKind: "token",
    launchCategoryProvenance: value.launchCategoryProvenance as Extract<
      ExploreEntry,
      { exploreKind: "token" }
    >["launchCategoryProvenance"],
  });
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

const MAX_VALUATION_BLOCK_DIGITS = 78;
const GRAPHQL_INT_MAXIMUM = 2_147_483_647n;

function isCanonicalValuationBlockNumber(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= MAX_VALUATION_BLOCK_DIGITS &&
    /^[1-9][0-9]*$/u.test(value);
}

function isCanonicalLiquidityBlockNumber(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 10 &&
    /^[1-9][0-9]*$/u.test(value) &&
    BigInt(value) <= GRAPHQL_INT_MAXIMUM;
}

function parseExploreValuationSnapshot(
  value: unknown,
): ExploreValuationSnapshotV1 | null {
  const fields = [
    "schemaVersion",
    "chainId",
    "blockNumber",
    "blockHash",
    "liquidityBlockNumber",
    "liquidityBlockHash",
    "rankingCommitment",
    "sort",
    "query",
    "socials",
    "pageSize",
  ];
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field)) ||
    value.schemaVersion !== "programmable.explore-valuation-snapshot.v1" ||
    value.chainId !== 1 ||
    !isCanonicalValuationBlockNumber(value.blockNumber) ||
    typeof value.blockHash !== "string" ||
    !/^0x[0-9a-f]{64}$/u.test(value.blockHash) ||
    !(
      (value.liquidityBlockNumber === "none" &&
        value.liquidityBlockHash === "none") ||
      (isCanonicalLiquidityBlockNumber(value.liquidityBlockNumber) &&
        typeof value.liquidityBlockHash === "string" &&
        /^0x[0-9a-f]{64}$/u.test(value.liquidityBlockHash))
    ) ||
    typeof value.rankingCommitment !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.rankingCommitment) ||
    (value.sort !== "market-cap" && value.sort !== "market-cap-asc") ||
    typeof value.query !== "string" ||
    (value.socials !== null && value.socials !== "yes" &&
      value.socials !== "no") ||
    !Number.isSafeInteger(value.pageSize) ||
    Number(value.pageSize) < 1
  ) return null;
  return value as unknown as ExploreValuationSnapshotV1;
}

function sameExploreValuationSnapshot(
  left: ExploreValuationSnapshotV1,
  right: ExploreValuationSnapshotV1,
) {
  return left.schemaVersion === right.schemaVersion &&
    left.chainId === right.chainId &&
    left.blockNumber === right.blockNumber &&
    left.blockHash === right.blockHash &&
    left.liquidityBlockNumber === right.liquidityBlockNumber &&
    left.liquidityBlockHash === right.liquidityBlockHash &&
    left.rankingCommitment === right.rankingCommitment &&
    left.sort === right.sort &&
    left.query === right.query &&
    left.socials === right.socials &&
    left.pageSize === right.pageSize;
}

function parseExplorePayload(value: unknown): ExplorePayload {
  if (!isRecord(value)) {
    throw new Error("The token registry returned an invalid response");
  }
  if (value.status !== "ready" && value.status !== "not-deployed") {
    throw new Error("The token registry returned an unknown status");
  }
  if (!Array.isArray(value.tokens)) {
    throw new Error("The token registry returned invalid token data");
  }
  if (
    value.dataQuality !== undefined &&
    !isExploreDataQuality(value.dataQuality)
  ) {
    throw new Error("The token registry returned invalid data quality");
  }

  const tokens = value.tokens.map(parseExploreEntry);
  if (tokens.some((token) => token === null)) {
    throw new Error("The token registry returned an invalid token record");
  }

  const valuationSnapshot = value.valuationSnapshot === undefined
    ? undefined
    : parseExploreValuationSnapshot(value.valuationSnapshot);
  if (valuationSnapshot === null) {
    throw new Error("The token registry returned an invalid valuation snapshot");
  }

  if (valuationSnapshot !== undefined) {
    if (
      typeof value.page !== "number" ||
      !Number.isSafeInteger(value.page) ||
      value.page < 1 ||
      typeof value.pageSize !== "number" ||
      !Number.isSafeInteger(value.pageSize) ||
      value.pageSize < 1 ||
      typeof value.total !== "number" ||
      !Number.isSafeInteger(value.total) ||
      value.total < 0 ||
      typeof value.totalPages !== "number" ||
      !Number.isSafeInteger(value.totalPages) ||
      value.totalPages < 0 ||
      value.totalPages !== Math.ceil(value.total / value.pageSize) ||
      (value.totalPages === 0
        ? value.page !== 1
        : value.page > value.totalPages)
    ) {
      throw new Error("The token registry returned invalid pagination data");
    }
  }

  return {
    status: value.status,
    tokens: tokens as ValuedExploreEntry[],
    page: Math.max(1, positiveInteger(value.page, 1)),
    pageSize: Math.max(
      1,
      positiveInteger(value.pageSize, EXPLORE_TOKENS_PER_PAGE),
    ),
    total: positiveInteger(value.total, tokens.length),
    totalPages: positiveInteger(value.totalPages, 0),
    ...(valuationSnapshot === undefined
      ? {}
      : { valuationSnapshot }),
    ...(value.dataQuality === undefined
      ? {}
      : { dataQuality: value.dataQuality }),
  };
}

function readApiError(value: unknown) {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : "Tokens are temporarily unavailable";
}

export function createExploreInitialState(
  response: ExploreInitialResponse | undefined,
  input: Readonly<{
    requestKey: string;
    contentKey: string;
  }>,
): ExploreState | null {
  if (response === undefined) return null;
  if (!response.ok) {
    return {
      phase: "error",
      message: readApiError(response.body),
      ...input,
    };
  }

  try {
    const payload = parseExplorePayload(response.body);
    if (
      payload.page !== 1 ||
      payload.pageSize !== EXPLORE_TOKENS_PER_PAGE ||
      payload.valuationSnapshot !== undefined
    ) {
      throw new Error("The token registry returned an unexpected first page");
    }
    return {
      phase: "ready",
      payload,
      ...input,
    };
  } catch (error) {
    return {
      phase: "error",
      message:
        error instanceof Error
          ? error.message
          : "The token registry returned an invalid response",
      ...input,
    };
  }
}

export function handledInitialExploreRequestKey(
  state: ExploreState | null,
  requestKey: string,
): string | null {
  return state?.phase === "ready" ? requestKey : null;
}

type PendingExploreRequest = {
  controller: AbortController;
  promise: Promise<ExplorePayload>;
  requestIdentity: string;
};

const pendingExploreRequests = new Map<string, PendingExploreRequest>();
const resolvedExplorePayloads = new Map<
  string,
  Readonly<{ payload: ExplorePayload; updatedAt: number }>
>();
const RESOLVED_EXPLORE_PAYLOAD_TTL_MS = 4_500;
const MAX_RESOLVED_EXPLORE_PAYLOADS = 24;
const EXPLORE_VALUATION_CONTINUATION_PARAMETERS = [
  "valuationBlock",
  "valuationBlockHash",
  "liquidityBlock",
  "liquidityBlockHash",
  "rankingCommitment",
] as const;

type ExploreValuationRequestContract = Readonly<{
  marketCapSort: boolean;
  page: number;
  pageSize: number;
  query: string;
  socials: "yes" | "no" | null;
  sort: string;
  continuation: Readonly<{
    blockNumber: string;
    blockHash: `0x${string}`;
    liquidityBlockNumber: string | "none";
    liquidityBlockHash: `0x${string}` | "none";
    rankingCommitment: `sha256:${string}`;
  }> | null;
}>;

function canonicalExploreSearchIdentity(search: URLSearchParams) {
  const canonical = new URLSearchParams(search);
  canonical.sort();
  return canonical.toString();
}

function exactPositiveSearchInteger(
  value: string | null,
  fallback: number,
  label: string,
) {
  const normalized = value ?? String(fallback);
  if (!/^[1-9][0-9]*$/u.test(normalized)) {
    throw new Error(`The token registry request has an invalid ${label}`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`The token registry request has an invalid ${label}`);
  }
  return parsed;
}

function exploreValuationRequestContract(
  search: URLSearchParams,
): ExploreValuationRequestContract {
  for (const parameter of EXPLORE_VALUATION_CONTINUATION_PARAMETERS) {
    if (search.getAll(parameter).length > 1) {
      throw new Error("The token registry request has duplicate valuation snapshot fields");
    }
  }
  const sort = parseExploreSort(search.get("sort"));
  const marketCapSort = sort === "market-cap" || sort === "market-cap-asc";
  const page = exactPositiveSearchInteger(search.get("page"), 1, "page");
  const pageSize = Math.min(
    exactPositiveSearchInteger(
      search.get("limit"),
      EXPLORE_TOKENS_PER_PAGE,
      "page size",
    ),
    EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
  );
  const supplied = EXPLORE_VALUATION_CONTINUATION_PARAMETERS.filter(
    (parameter) => search.has(parameter),
  ).length;
  if (!marketCapSort) {
    if (supplied > 0) {
      throw new Error("A valuation snapshot is not allowed for this sort");
    }
    return {
      marketCapSort,
      page,
      pageSize,
      query: (search.get("q") ?? "").trim(),
      socials:
        search.get("socials") === "yes" || search.get("socials") === "no"
          ? search.get("socials") as "yes" | "no"
          : null,
      sort,
      continuation: null,
    };
  }
  if (page === 1) {
    if (supplied > 0) {
      throw new Error("A valuation continuation is not allowed on page one");
    }
  } else if (supplied !== EXPLORE_VALUATION_CONTINUATION_PARAMETERS.length) {
    throw new Error("A complete valuation snapshot is required for this page");
  }

  const valuationBlock = search.get("valuationBlock");
  const valuationBlockHash = search.get("valuationBlockHash");
  const liquidityBlock = search.get("liquidityBlock");
  const liquidityBlockHash = search.get("liquidityBlockHash");
  const rankingCommitment = search.get("rankingCommitment");
  const continuation = page === 1
    ? null
    : valuationBlock &&
        isCanonicalValuationBlockNumber(valuationBlock) &&
        valuationBlockHash &&
        /^0x[0-9a-f]{64}$/u.test(valuationBlockHash) &&
        liquidityBlock &&
        liquidityBlockHash &&
        ((liquidityBlock === "none" && liquidityBlockHash === "none") ||
          (isCanonicalLiquidityBlockNumber(liquidityBlock) &&
            /^0x[0-9a-f]{64}$/u.test(liquidityBlockHash))) &&
        rankingCommitment &&
        /^sha256:[0-9a-f]{64}$/u.test(rankingCommitment)
      ? {
          blockNumber: valuationBlock,
          blockHash: valuationBlockHash as `0x${string}`,
          liquidityBlockNumber: liquidityBlock,
          liquidityBlockHash: liquidityBlockHash as `0x${string}` | "none",
          rankingCommitment: rankingCommitment as `sha256:${string}`,
        }
      : null;
  if (page > 1 && continuation === null) {
    throw new Error("The valuation snapshot continuation is malformed");
  }
  return {
    marketCapSort,
    page,
    pageSize,
    query: (search.get("q") ?? "").trim(),
    socials:
      search.get("socials") === "yes" || search.get("socials") === "no"
        ? search.get("socials") as "yes" | "no"
        : null,
    sort,
    continuation,
  };
}

function assertExploreValuationResponseContract(
  payload: ExplorePayload,
  contract: ExploreValuationRequestContract,
) {
  const snapshot = payload.valuationSnapshot;
  if (!contract.marketCapSort) {
    if (snapshot !== undefined) {
      throw new Error("The token registry returned an unexpected valuation snapshot");
    }
    return;
  }
  if (
    payload.page !== contract.page ||
    snapshot === undefined ||
    snapshot.sort !== contract.sort ||
    snapshot.query !== contract.query ||
    snapshot.socials !== contract.socials ||
    snapshot.pageSize !== contract.pageSize ||
    payload.pageSize !== contract.pageSize
  ) {
    throw new Error("The token registry returned an inconsistent valuation snapshot");
  }
  const continuation = contract.continuation;
  if (
    continuation &&
    (snapshot.blockNumber !== continuation.blockNumber ||
      snapshot.blockHash !== continuation.blockHash ||
      snapshot.liquidityBlockNumber !== continuation.liquidityBlockNumber ||
      snapshot.liquidityBlockHash !== continuation.liquidityBlockHash ||
      snapshot.rankingCommitment !== continuation.rankingCommitment)
  ) {
    throw new Error("The token registry changed the valuation snapshot");
  }
}

function assertUniqueExploreDatasetEntries(
  entries: readonly ValuedExploreEntry[],
) {
  const ids = new Set<string>();
  const tokenAddresses = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new Error("The token registry repeated an entry while filters were loading");
    }
    ids.add(entry.id);
    if (entry.exploreKind !== "token") continue;
    const tokenAddress = entry.tokenAddress.toLowerCase();
    if (tokenAddresses.has(tokenAddress)) {
      throw new Error("The token registry repeated a token while filters were loading");
    }
    tokenAddresses.add(tokenAddress);
  }
}

function valuationSnapshotMatchesSearch(
  snapshot: ExploreValuationSnapshotV1,
  search: URLSearchParams,
) {
  const firstPageSearch = new URLSearchParams(search);
  firstPageSearch.set("page", "1");
  for (const parameter of EXPLORE_VALUATION_CONTINUATION_PARAMETERS) {
    firstPageSearch.delete(parameter);
  }
  const contract = exploreValuationRequestContract(firstPageSearch);
  return contract.marketCapSort &&
    snapshot.sort === contract.sort &&
    snapshot.query === contract.query &&
    snapshot.socials === contract.socials &&
    snapshot.pageSize === contract.pageSize;
}

function applyExploreValuationContinuation(
  search: URLSearchParams,
  snapshot: ExploreValuationSnapshotV1,
) {
  search.set("sort", snapshot.sort);
  if (snapshot.query === "") search.delete("q");
  else search.set("q", snapshot.query);
  if (snapshot.socials === null) search.delete("socials");
  else search.set("socials", snapshot.socials);
  search.set("limit", String(snapshot.pageSize));
  search.set("valuationBlock", snapshot.blockNumber);
  search.set("valuationBlockHash", snapshot.blockHash);
  search.set("liquidityBlock", snapshot.liquidityBlockNumber);
  search.set("liquidityBlockHash", snapshot.liquidityBlockHash);
  search.set("rankingCommitment", snapshot.rankingCommitment);
}

function readResolvedExplorePayload(contentKey: string) {
  const cached = resolvedExplorePayloads.get(contentKey);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt >= RESOLVED_EXPLORE_PAYLOAD_TTL_MS) {
    resolvedExplorePayloads.delete(contentKey);
    return null;
  }
  resolvedExplorePayloads.delete(contentKey);
  resolvedExplorePayloads.set(contentKey, cached);
  return cached.payload;
}

function cacheResolvedExplorePayload(
  contentKey: string,
  payload: ExplorePayload,
) {
  resolvedExplorePayloads.delete(contentKey);
  resolvedExplorePayloads.set(contentKey, {
    payload,
    updatedAt: Date.now(),
  });
  while (resolvedExplorePayloads.size > MAX_RESOLVED_EXPLORE_PAYLOADS) {
    const oldestKey = resolvedExplorePayloads.keys().next().value;
    if (oldestKey === undefined) return;
    resolvedExplorePayloads.delete(oldestKey);
  }
}

async function fetchExplorePayload(
  search: URLSearchParams,
  signal: AbortSignal,
  contract: ExploreValuationRequestContract,
) {
  const requestUrl = `/api/explore?${search.toString()}`;
  let transientRetries = 0;
  while (true) {
    const response = await fetch(requestUrl, {
      headers: { Accept: "application/json" },
      signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (
        response.status === 503 &&
        contract.sort === "market-cap" &&
        transientRetries < EXPLORE_MARKET_CAP_TRANSIENT_RETRY_LIMIT &&
        !signal.aborted
      ) {
        transientRetries += 1;
        continue;
      }
      throw new Error(readApiError(body));
    }
    const payload = parseExplorePayload(body);
    assertExploreValuationResponseContract(payload, contract);
    return payload;
  }
}

export function loadExplorePayload(
  contentKey: string,
  search: URLSearchParams,
) {
  let contract: ExploreValuationRequestContract;
  try {
    contract = exploreValuationRequestContract(search);
  } catch (error) {
    return Promise.reject(error);
  }
  const resolved = readResolvedExplorePayload(contentKey);
  if (resolved) {
    try {
      assertExploreValuationResponseContract(resolved, contract);
      return Promise.resolve(resolved);
    } catch {
      resolvedExplorePayloads.delete(contentKey);
    }
  }
  const requestIdentity = canonicalExploreSearchIdentity(search);
  const pendingRequest = pendingExploreRequests.get(contentKey);
  if (pendingRequest?.requestIdentity === requestIdentity) {
    return pendingRequest.promise;
  }
  if (pendingRequest) {
    pendingExploreRequests.delete(contentKey);
    pendingRequest.controller.abort();
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, EXPLORE_REQUEST_TIMEOUT_MS);
  const request = (async (): Promise<ExplorePayload> => {
    try {
      const payload = await fetchExplorePayload(
        search,
        controller.signal,
        contract,
      );
      cacheResolvedExplorePayload(contentKey, payload);
      return payload;
    } catch (error) {
      if (timedOut) {
        throw new Error("Tokens took too long to respond");
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  })();

  const entry = { controller, promise: request, requestIdentity };
  pendingExploreRequests.set(contentKey, entry);
  const clearPendingRequest = () => {
    if (pendingExploreRequests.get(contentKey) === entry) {
      pendingExploreRequests.delete(contentKey);
    }
  };
  void request.then(clearPendingRequest, clearPendingRequest);

  return request;
}

function abortExplorePayload(contentKey: string) {
  const modelPagePrefix = `${contentKey}\u0000model-page:`;
  const snapshotBootstrapPrefix = `${contentKey}\u0000snapshot-bootstrap:`;
  for (const [key, pendingRequest] of pendingExploreRequests) {
    if (
      key !== contentKey &&
      !key.startsWith(modelPagePrefix) &&
      !key.startsWith(snapshotBootstrapPrefix)
    ) continue;
    pendingExploreRequests.delete(key);
    pendingRequest.controller.abort();
  }
}

export async function loadExplorePageWithValuationSnapshot(
  contentKey: string,
  search: URLSearchParams,
  cachedSnapshot: ExploreValuationSnapshotV1 | null = null,
) {
  const requestedSearch = new URLSearchParams(search);
  const requestedPage = exactPositiveSearchInteger(
    requestedSearch.get("page"),
    1,
    "page",
  );
  const contextSearch = new URLSearchParams(requestedSearch);
  contextSearch.set("page", "1");
  for (const parameter of EXPLORE_VALUATION_CONTINUATION_PARAMETERS) {
    contextSearch.delete(parameter);
  }
  const contextContract = exploreValuationRequestContract(contextSearch);
  if (!contextContract.marketCapSort || requestedPage === 1) {
    const payload = await loadExplorePayload(contentKey, requestedSearch);
    return {
      payload,
      valuationSnapshot: payload.valuationSnapshot ?? null,
    };
  }
  if (
    EXPLORE_VALUATION_CONTINUATION_PARAMETERS.some((parameter) =>
      requestedSearch.has(parameter)
    )
  ) {
    throw new Error("The valuation continuation must be bound by the client");
  }

  let valuationSnapshot =
    cachedSnapshot && valuationSnapshotMatchesSearch(cachedSnapshot, search)
      ? cachedSnapshot
      : null;
  if (valuationSnapshot === null) {
    const firstPageSearch = new URLSearchParams(requestedSearch);
    firstPageSearch.set("page", "1");
    for (const parameter of EXPLORE_VALUATION_CONTINUATION_PARAMETERS) {
      firstPageSearch.delete(parameter);
    }
    const firstPage = await loadExplorePayload(
      `${contentKey}\u0000snapshot-bootstrap:${canonicalExploreSearchIdentity(firstPageSearch)}`,
      firstPageSearch,
    );
    valuationSnapshot = firstPage.valuationSnapshot ?? null;
    if (valuationSnapshot === null) {
      throw new Error("The token registry did not bind the valuation snapshot");
    }
  }
  applyExploreValuationContinuation(requestedSearch, valuationSnapshot);
  const payload = await loadExplorePayload(contentKey, requestedSearch);
  if (
    !payload.valuationSnapshot ||
    !sameExploreValuationSnapshot(
      valuationSnapshot,
      payload.valuationSnapshot,
    )
  ) {
    throw new Error("The token registry changed the valuation snapshot");
  }
  return { payload, valuationSnapshot: payload.valuationSnapshot };
}

export async function loadExploreModelDataset(
  contentKey: string,
  search: URLSearchParams,
) {
  const firstPageSearch = new URLSearchParams(search);
  firstPageSearch.set("page", "1");
  firstPageSearch.set("limit", String(EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE));
  for (const parameter of EXPLORE_VALUATION_CONTINUATION_PARAMETERS) {
    if (firstPageSearch.has(parameter)) {
      throw new Error("The model dataset request carried a valuation continuation");
    }
  }
  const firstPage = await loadExplorePayload(
    `${contentKey}\u0000model-page:1`,
    firstPageSearch,
  );
  const marketCapSort =
    firstPageSearch.get("sort") === "market-cap" ||
    firstPageSearch.get("sort") === "market-cap-asc";
  const valuationSnapshot = firstPage.valuationSnapshot;
  if (marketCapSort !== (valuationSnapshot !== undefined)) {
    throw new Error("The token registry returned an inconsistent valuation snapshot");
  }
  if (firstPage.totalPages <= 1) {
    return firstPage;
  }

  const remainingPages = await Promise.all(
    Array.from({ length: firstPage.totalPages - 1 }, async (_, index) => {
      const page = index + 2;
      const pageSearch = new URLSearchParams(firstPageSearch);
      pageSearch.set("page", String(page));
      if (valuationSnapshot) {
        applyExploreValuationContinuation(pageSearch, valuationSnapshot);
      }
      const payload = await loadExplorePayload(
        `${contentKey}\u0000model-page:${page}`,
        pageSearch,
      );
      if (
        payload.status !== firstPage.status ||
        payload.page !== page ||
        payload.pageSize !== firstPage.pageSize ||
        payload.total !== firstPage.total ||
        payload.totalPages !== firstPage.totalPages
      ) {
        throw new Error("Tokens changed while filters were loading");
      }
      if (
        valuationSnapshot &&
        (!payload.valuationSnapshot ||
          !sameExploreValuationSnapshot(
            valuationSnapshot,
            payload.valuationSnapshot,
          ))
      ) {
        throw new Error("Token ranking changed while filters were loading");
      }
      return payload;
    }),
  );

  const tokens = [firstPage, ...remainingPages].flatMap(
    (payload) => payload.tokens,
  );
  assertUniqueExploreDatasetEntries(tokens);
  return {
    ...firstPage,
    tokens,
  };
}

export function paginateTokensBySocialPresence<
  T extends Readonly<{ links?: readonly TokenLink[] }>,
>(
  tokens: T[],
  socialFilter: ExploreSocialFilter,
  requestedPage: number,
  pageSize = EXPLORE_TOKENS_PER_PAGE,
) {
  const filtered = filterTokensBySocialPresence(tokens, socialFilter);
  const totalPages = Math.ceil(filtered.length / pageSize);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  return {
    tokens: filtered.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: filtered.length,
    totalPages,
  };
}

export function tokenLaunchModelGroup(
  token: Pick<ExploreEntry, "launchCategoryProvenance">,
): Exclude<ExploreModelFilter, "all"> | null {
  return token.launchCategoryProvenance.category === "classic"
    ? "classic"
    : token.launchCategoryProvenance.category === "custom"
      ? "custom-hook"
      : null;
}

export function filterTokensByLaunchModel<T extends ExploreEntry>(
  tokens: T[],
  modelFilter: ExploreModelFilter,
) {
  if (modelFilter === "all") return tokens;
  return tokens.filter((token) => tokenLaunchModelGroup(token) === modelFilter);
}

export function paginateTokensByExploreFilters<T extends ExploreEntry>(
  tokens: T[],
  socialFilter: ExploreSocialFilter,
  modelFilter: ExploreModelFilter,
  requestedPage: number,
  pageSize = EXPLORE_TOKENS_PER_PAGE,
) {
  const filtered = filterTokensByLaunchModel(
    filterTokensBySocialPresence(tokens, socialFilter),
    modelFilter,
  );
  const totalPages = Math.ceil(filtered.length / pageSize);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  return {
    tokens: filtered.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: filtered.length,
    totalPages,
  };
}

function getFallbackTokenImage(address: string) {
  const suffix = Number.parseInt(address.slice(-8), 16);
  const index = Number.isFinite(suffix)
    ? suffix % fallbackTokenImages.length
    : 0;
  return fallbackTokenImages[index];
}

function valuationForEntry(
  entry: ExploreEntry | ValuedExploreEntry,
): ExploreValuation {
  const explicit = (entry as Partial<ValuedExploreEntry>).valuation;
  return isExploreValuation(explicit) ? explicit : exploreValuation(entry);
}

export function getExploreValuationMetric(
  token: ExploreEntry | ValuedExploreEntry,
): MarketCapMetric | undefined {
  const valuation = valuationForEntry(token);
  if (valuation.status !== "available" || valuation.freshness !== "current")
    return undefined;
  const value = Number(BigInt(valuation.valueWad)) / 1e18;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (valuation.currency === "usd") return { kind: "usd", value };
  if (valuation.currency === "eth") return { kind: "eth", value };
  return { kind: "quote", symbol: valuation.quoteSymbol ?? "", value };
}

export function getExplorePaginationItems(
  currentPage: number,
  pageCount: number,
): PaginationItem[] {
  if (pageCount <= 4) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, "end-gap", pageCount];
  }

  if (currentPage >= pageCount - 2) {
    return [1, "start-gap", pageCount - 2, pageCount - 1, pageCount];
  }

  return [1, "start-gap", currentPage, "end-gap", pageCount];
}

export function tokenHasSocialLinks(
  token: Readonly<{ links?: readonly TokenLink[] }>,
) {
  return Boolean(
    token.links?.some((link) => link.kind === "x" || link.kind === "telegram"),
  );
}

export function filterTokensBySocialPresence<
  T extends Readonly<{ links?: readonly TokenLink[] }>,
>(tokens: T[], socialFilter: ExploreSocialFilter) {
  if (socialFilter === "all") return tokens;
  const shouldHaveSocials = socialFilter === "yes";
  return tokens.filter(
    (token) => tokenHasSocialLinks(token) === shouldHaveSocials,
  );
}

export function exploreTokenCardDescription(token: ExploreEntry) {
  const description = token.description?.trim();
  if (description) return description;

  return token.exploreKind === "token" &&
    isLaunchStampProvenanceV1(token.launchStampProvenance)
    ? "Canonical Router stamp. v4 pool initialized."
    : undefined;
}

export function getTokenCards(
  tokens: Array<ExploreEntry | ValuedExploreEntry>,
): TokenCard[] {
  return tokens.map((token) => {
    const valuation = valuationForEntry(token);
    return {
      id: token.id,
      name: token.name,
      description: exploreTokenCardDescription(token),
      imageUrl:
        token.imageUrl?.trim() ||
        getFallbackTokenImage(token.tokenAddress ?? token.id),
      links: [...(token.links ?? [])].sort(
        (left, right) => tokenLinkOrder[left.kind] - tokenLinkOrder[right.kind],
      ),
      valuation: getExploreValuationMetric(token),
      ...(valuation.status === "available"
        ? {
            valuationMetric:
              valuation.metric === "market-cap"
                ? ("Market cap" as const)
                : ("FDV" as const),
          }
        : {}),
      marketStatus: exploreMarketStatusLabel(token),
      usesFallbackImage: !token.imageUrl?.trim(),
      ...(token.tokenAddress === undefined
        ? {}
        : { tokenAddress: token.tokenAddress }),
      launchCategory:
        token.launchCategoryProvenance.category === "classic"
          ? "Classic"
          : "Custom",
    };
  });
}

function getTokenLinkLabel(kind: TokenLink["kind"]) {
  if (kind === "website") return "Website";
  if (kind === "telegram") return "Telegram";
  return "X";
}

function TelegramBrandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.8 3.2 19.5 20.1c-.25 1.2-.91 1.5-1.85.94l-5.03-3.71-2.43 2.34c-.27.27-.5.5-1.02.5l.36-5.13 9.34-8.44c.41-.36-.09-.56-.63-.2L6.7 13.67l-4.98-1.56c-1.08-.34-1.1-1.08.23-1.6L21.36 3c.9-.33 1.69.2 1.44 1.2Z"
      />
    </svg>
  );
}

function TokenLinkIcon({ kind }: { kind: TokenLink["kind"] }) {
  if (kind === "website") return <WebsiteLinkIcon />;
  if (kind === "telegram") return <TelegramBrandIcon />;
  return <XBrandIcon />;
}

const exploreSkeletonItems = Array.from(
  { length: EXPLORE_TOKENS_PER_PAGE },
  (_, index) => index,
);

function ExploreGridSkeleton() {
  return (
    <div
      className={`${styles.runnerGrid} ${styles.skeletonGrid}`}
      role="status"
      aria-label="Loading launches"
    >
      {exploreSkeletonItems.map((index) => (
        <article
          className={`${styles.runnerCard} ${styles.skeletonCard}`}
          key={index}
          aria-hidden="true"
        >
          <div className={`${styles.runnerHitArea} ${styles.skeletonHitArea}`}>
            <div className={`${styles.runnerArt} ${styles.skeletonArt}`} />
            <div className={`${styles.runnerBody} ${styles.skeletonBody}`}>
              <span className={styles.skeletonTitle} />
              <span className={styles.skeletonDescription} />
              <span className={styles.skeletonDescriptionShort} />
            </div>
          </div>
          <div className={`${styles.runnerMeta} ${styles.skeletonMetaRow}`}>
            <span className={styles.skeletonCategory} />
            <span className={styles.skeletonMeta} />
            <span className={styles.skeletonSocial} />
          </div>
        </article>
      ))}
    </div>
  );
}

function resultRangeLabel(payload: ExplorePayload | null) {
  if (!payload) return "Loading launch index";
  if (payload.status === "not-deployed") return "Explore unavailable";
  if (payload.total === 0) return "0 launches";

  const start = (payload.page - 1) * payload.pageSize + 1;
  const end = Math.min(payload.total, start + payload.tokens.length - 1);
  return `${start}–${end} of ${payload.total} ${
    payload.total === 1 ? "launch" : "launches"
  }`;
}

export function exploreDataQualityMessage(
  quality: ExploreDataQuality | undefined,
) {
  if (!quality) return null;
  if (quality.launchIdentity.status === "partial") {
    return "Some launches may be temporarily unavailable";
  }
  if (quality.launchIdentity.status === "last-known-good") {
    return "Launches may be out of date";
  }
  if (quality.valuation.status === "stale") {
    return "Prices may be out of date";
  }
  return null;
}

export function ExploreView({
  initialResponse,
  loadingOnly = false,
}: Readonly<{
  initialResponse?: ExploreInitialResponse;
  loadingOnly?: boolean;
}> = {}) {
  const preview = useInterfacePreview();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<TokenSort>("newest");
  const [socialFilter, setSocialFilter] = useState<ExploreSocialFilter>("all");
  const [modelFilter, setModelFilter] = useState<ExploreModelFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const refreshKey = useLiveDataRefresh({
    enabled: !preview && !loadingOnly,
  });
  const activeExploreContentKey = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultStatusRef = useRef<HTMLParagraphElement>(null);
  const modelDatasetCache = useRef<{
    key: string;
    payload: ExplorePayload;
  } | null>(null);
  const visibleValuationSnapshot = useRef<{
    epoch: string;
    snapshot: ExploreValuationSnapshotV1;
  } | null>(null);
  const filterRef = useRef<HTMLDetailsElement>(null);
  const valuationSnapshotEpoch = `${retryKey}\u0000${refreshKey}`;
  const contentKey = `${debouncedQuery}\u0000${sort}\u0000${socialFilter}\u0000${modelFilter}\u0000${currentPage}`;
  const requestKey = `${contentKey}\u0000${retryKey}\u0000${refreshKey}`;
  const modelDatasetKey = `${debouncedQuery}\u0000${sort}\u0000${socialFilter}\u0000${modelFilter}\u0000${retryKey}\u0000${refreshKey}`;
  const activeRequestContentKey =
    modelFilter === "all" ? contentKey : modelDatasetKey;
  const [initialState] = useState(() =>
    createExploreInitialState(initialResponse, {
      requestKey,
      contentKey,
    }),
  );
  const handledRequestKey = useRef<string | null>(
    handledInitialExploreRequestKey(initialState, requestKey),
  );
  const [state, setState] = useState<ExploreState>(() => {
    if (initialState !== null) return initialState;
    const cached = readResolvedExplorePayload(activeRequestContentKey);
    return cached
      ? {
          phase: "ready",
          payload: cached,
          requestKey,
          contentKey,
        }
      : { phase: "loading" };
  });
  useEffect(
    () => () => {
      if (activeExploreContentKey.current) {
        abortExplorePayload(activeExploreContentKey.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (normalizedQuery === debouncedQuery) return;

    const timer = window.setTimeout(() => {
      setCurrentPage(1);
      setDebouncedQuery(normalizedQuery);
    }, QUERY_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [debouncedQuery, normalizedQuery]);

  useEffect(() => {
    function closeFilter(event: PointerEvent | KeyboardEvent) {
      const filter = filterRef.current;
      if (!filter?.open) return;
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        filter.removeAttribute("open");
        filter.querySelector("summary")?.focus();
        return;
      }
      if (
        event instanceof PointerEvent &&
        event.target instanceof Node &&
        !filter.contains(event.target)
      ) {
        filter.removeAttribute("open");
      }
    }

    document.addEventListener("pointerdown", closeFilter);
    document.addEventListener("keydown", closeFilter);
    return () => {
      document.removeEventListener("pointerdown", closeFilter);
      document.removeEventListener("keydown", closeFilter);
    };
  }, []);

  useEffect(() => {
    if (preview || loadingOnly) return;

    if (handledRequestKey.current === requestKey) {
      activeExploreContentKey.current = activeRequestContentKey;
      if (initialState?.phase === "ready") {
        cacheResolvedExplorePayload(
          activeRequestContentKey,
          initialState.payload,
        );
      }
      return;
    }

    let ignore = false;
    const previousContentKey = activeExploreContentKey.current;
    if (previousContentKey && previousContentKey !== activeRequestContentKey) {
      abortExplorePayload(previousContentKey);
    }
    activeExploreContentKey.current = activeRequestContentKey;
    const search = new URLSearchParams({
      q: debouncedQuery,
      sort,
      page: String(currentPage),
      limit: String(EXPLORE_TOKENS_PER_PAGE),
    });
    if (socialFilter !== "all") {
      search.set("socials", socialFilter);
    }

    async function loadTokens() {
      try {
        let payload: ExplorePayload;
        if (modelFilter === "all") {
          const loaded = await loadExplorePageWithValuationSnapshot(
            activeRequestContentKey,
            search,
            visibleValuationSnapshot.current?.epoch ===
                valuationSnapshotEpoch
              ? visibleValuationSnapshot.current.snapshot
              : null,
          );
          payload = loaded.payload;
          if (!ignore) {
            visibleValuationSnapshot.current = loaded.valuationSnapshot
              ? {
                  epoch: valuationSnapshotEpoch,
                  snapshot: loaded.valuationSnapshot,
                }
              : null;
          }
        } else {
          let dataset =
            modelDatasetCache.current?.key === modelDatasetKey
              ? modelDatasetCache.current.payload
              : null;
          if (!dataset) {
            dataset = await loadExploreModelDataset(
              activeRequestContentKey,
              search,
            );
            if (ignore) return;
            modelDatasetCache.current = {
              key: modelDatasetKey,
              payload: dataset,
            };
          }
          payload = {
            status: dataset.status,
            ...paginateTokensByExploreFilters(
              dataset.tokens,
              "all",
              modelFilter,
              currentPage,
            ),
          };
        }
        if (ignore) return;
        if (payload.page !== currentPage) {
          setCurrentPage(payload.page);
        }
        handledRequestKey.current = requestKey;
        setState({
          phase: "ready",
          payload,
          requestKey,
          contentKey,
        });
      } catch (error) {
        if (ignore) return;
        const message =
          error instanceof Error
            ? error.message
            : "Tokens are temporarily unavailable";
        setState((current) =>
          preserveExplorePayloadOnRefreshFailure(current, {
            contentKey,
            requestKey,
            message,
          }),
        );
      }
    }

    void loadTokens();
    return () => {
      ignore = true;
    };
  }, [
    contentKey,
    currentPage,
    debouncedQuery,
    activeRequestContentKey,
    modelDatasetKey,
    modelFilter,
    initialState,
    loadingOnly,
    preview,
    requestKey,
    socialFilter,
    sort,
    valuationSnapshotEpoch,
  ]);

  const previewPayload = useMemo<ExplorePayload>(() => {
    const searchValue = debouncedQuery.toLowerCase();
    const filtered = EXPLORE_PREVIEW_TOKENS.filter((token) =>
      [token.name, token.symbol, token.tokenAddress].some((value) =>
        value.toLowerCase().includes(searchValue),
      ),
    );
    const ranked = [...filtered].sort((left, right) => {
      if (sort === "newest" || sort === "oldest") {
        const launchComparison = comparePreviewLaunchOrder(left, right);
        return sort === "newest" ? -launchComparison : launchComparison;
      }
      const leftFdv = BigInt(left.indexedMarketCapUsdWad ?? "0");
      const rightFdv = BigInt(right.indexedMarketCapUsdWad ?? "0");
      const delta = leftFdv === rightFdv ? 0 : leftFdv > rightFdv ? -1 : 1;
      return sort === "market-cap" ? delta : -delta;
    });

    const paginated = paginateTokensByExploreFilters(
      ranked.map((entry) => ({
        ...entry,
        valuation: exploreValuation(entry),
      })),
      socialFilter,
      modelFilter,
      currentPage,
    );

    return {
      status: "ready",
      ...paginated,
    };
  }, [currentPage, debouncedQuery, modelFilter, socialFilter, sort]);

  const displayState: ExploreState = preview
    ? {
        phase: "ready",
        payload: previewPayload,
        requestKey,
        contentKey,
      }
    : state;

  const payload = displayState.phase === "ready" ? displayState.payload : null;
  const cards = useMemo(
    () => getTokenCards(payload?.tokens ?? []),
    [payload?.tokens],
  );
  const pageCount = Math.max(1, payload?.totalPages ?? 0);
  const activePage = Math.min(payload?.page ?? currentPage, pageCount);
  const paginationItems = getExplorePaginationItems(activePage, pageCount);
  const resultLabel =
    displayState.phase === "error" ? "" : resultRangeLabel(payload);
  const dataQualityMessage = exploreDataQualityMessage(payload?.dataQuality);
  const busy =
    !preview &&
    (displayState.phase === "loading" ||
      displayState.requestKey !== requestKey);
  const activeFilterCount =
    Number(socialFilter !== "all") + Number(modelFilter !== "all");
  const hasPublicTokens =
    displayState.phase !== "ready" ||
    displayState.payload.total > 0 ||
    Boolean(debouncedQuery) ||
    socialFilter !== "all" ||
    modelFilter !== "all";

  function retryTokens() {
    resultStatusRef.current?.focus({ preventScroll: true });
    setRetryKey((value) => value + 1);
  }

  function renderTokenState() {
    if (
      displayState.phase === "loading" ||
      (displayState.phase === "error" && displayState.requestKey !== requestKey)
    ) {
      return (
        <div className={styles.loadingState}>
          <ExploreGridSkeleton />
        </div>
      );
    }

    if (displayState.phase === "error") {
      return (
        <div className={styles.messageState} role="alert">
          <div className={styles.messageCopy}>
            <h2>Couldn’t load launches</h2>
            <p>{displayState.message}</p>
          </div>
          <button className="text-button" type="button" onClick={retryTokens}>
            Try again
          </button>
        </div>
      );
    }

    if (displayState.payload.status === "not-deployed") {
      return (
        <div className={`${styles.emptyState} liquid-glass-surface`}>
          <div>
            <h2>Explore is getting ready</h2>
            <p>The launch index is not available in this environment yet.</p>
          </div>
        </div>
      );
    }

    if (cards.length === 0) {
      if (payload?.dataQuality?.launchIdentity.status === "partial") {
        return (
          <div className={`${styles.emptyState} liquid-glass-surface`}>
            <div>
              <h2>Launches are catching up</h2>
              <p>
                Some launches are temporarily unavailable. Try again in a
                moment.
              </p>
            </div>
            <button
              className={styles.emptyAction}
              type="button"
              onClick={retryTokens}
            >
              Refresh
            </button>
          </div>
        );
      }
      if (debouncedQuery || socialFilter !== "all" || modelFilter !== "all") {
        const hasActiveFilter = socialFilter !== "all" || modelFilter !== "all";
        const noMatchMessage = debouncedQuery
          ? hasActiveFilter
            ? "No tokens match this search and filters"
            : "No tokens match this search"
          : "No tokens match these filters";
        return (
          <div className={styles.messageState}>
            <div className={styles.messageCopy}>
              <h2>No matching launches</h2>
              <p>{noMatchMessage}</p>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setQuery("");
                setSocialFilter("all");
                setModelFilter("all");
                setCurrentPage(1);
                searchInputRef.current?.focus();
              }}
            >
              Clear filters
            </button>
          </div>
        );
      }

      return (
        <div className={`${styles.emptyState} liquid-glass-surface`}>
          <div>
            <h2>No launches yet</h2>
            <p>Be the first to launch a token and it will appear here.</p>
          </div>
          <Link className={styles.emptyAction} href="/launch">
            Start a launch
          </Link>
        </div>
      );
    }

    return (
      <div
        className={`${styles.runnerGrid} ${styles.revealedGrid}`}
        key={displayState.contentKey}
      >
        {cards.map((token, index) => {
          const href = token.tokenAddress
            ? `/token/${token.tokenAddress}`
            : null;
          const imageSource = getTokenCardImageSource(token.imageUrl);
          const valuationLabel = token.valuation
            ? formatMarketCapMetric(token.valuation)
            : null;
          const cardContent = (
            <>
              <div className={styles.runnerArt}>
                <Image
                  className={styles.runnerImage}
                  src={imageSource}
                  alt={token.usesFallbackImage ? "" : `${token.name} artwork`}
                  fill
                  loading={index < 3 ? "eager" : "lazy"}
                  priority={index < 3}
                  sizes="(max-width: 360px) 96px, (max-width: 420px) 104px, (max-width: 700px) 112px, (max-width: 768px) calc(50vw - 54px), (max-width: 900px) 330px, 313px"
                  unoptimized={!canOptimizeTokenImage(imageSource)}
                  draggable={false}
                />
              </div>

              <div className={styles.runnerBody}>
                <header className={styles.runnerHeading}>
                  <h3 title={token.name}>{token.name}</h3>
                </header>

                {token.description ? (
                  <p className={styles.runnerDescription}>
                    {token.description}
                  </p>
                ) : null}
              </div>
            </>
          );

          return (
            <article className={styles.runnerCard} key={token.id}>
              {href ? (
                <Link
                  className={styles.runnerHitArea}
                  href={href}
                  aria-label={`Open ${token.name}`}
                >
                  {cardContent}
                </Link>
              ) : (
                <div className={styles.runnerHitArea}>{cardContent}</div>
              )}

              <div className={styles.runnerMeta}>
                <span className={styles.runnerCategory}>
                  <span className="sr-only">Launch type: </span>
                  {token.launchCategory}
                </span>
                {valuationLabel ? (
                  <span className={styles.runnerMarketCap}>
                    <span className="sr-only">
                      {`${token.valuationMetric ?? "Valuation"}: `}
                    </span>
                    <span
                      className={styles.runnerMarketCapLabel}
                      aria-hidden="true"
                    >
                      {token.valuationMetric ?? "Value"}
                    </span>
                    <span className={styles.runnerMarketCapValue}>
                      {valuationLabel}
                    </span>
                  </span>
                ) : null}
                {token.marketStatus ? (
                  <span
                    className={styles.runnerMarketStatus}
                    aria-label={`Market status ${token.marketStatus}`}
                  >
                    {token.marketStatus}
                  </span>
                ) : null}
                {token.links.length > 0 ? (
                  <div
                    className={styles.runnerSocials}
                    role="group"
                    aria-label={`${token.name} links`}
                  >
                    {token.links.map((link) => {
                      const label = getTokenLinkLabel(link.kind);
                      return (
                        <a
                          className={styles.runnerSocialLink}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${token.name} ${label}`}
                          title={label}
                          key={`${link.kind}:${link.url}`}
                        >
                          <TokenLinkIcon kind={link.kind} />
                        </a>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className={`${styles.page} explore-page page-width`}>
        <header className={styles.pageHeading}>
          <h1 aria-label="Explore programmable launches">
            <span>Explore programmable</span>
            <span>launches</span>
          </h1>
        </header>

        <section
          className={`${styles.runnersSection} token-section`}
          id="tokens"
          aria-busy={busy}
        >
          <div className={styles.runnersIntro}>
            {hasPublicTokens ? (
              <div className="token-section-heading">
                <h2 className="sr-only">Launches</h2>
                <div className="token-toolbar">
                  <div
                    className="token-search liquid-glass-control"
                    role="search"
                  >
                    <Search aria-hidden="true" size={17} />
                    <label className="sr-only" htmlFor="explore-token-search">
                      Search by name, symbol or contract address
                    </label>
                    <input
                      ref={searchInputRef}
                      id="explore-token-search"
                      type="search"
                      autoComplete="off"
                      spellCheck={false}
                      value={query}
                      placeholder="Search by name, symbol or contract address"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {query ? (
                      <button
                        className={styles.searchClear}
                        type="button"
                        aria-label="Clear token search"
                        onClick={() => {
                          setQuery("");
                          setCurrentPage(1);
                          searchInputRef.current?.focus();
                        }}
                      >
                        <CloseIcon aria-hidden="true" size={15} />
                      </button>
                    ) : null}
                  </div>

                  <details
                    className="token-filter"
                    ref={filterRef}
                    onBlur={(event) => {
                      const nextTarget = event.relatedTarget;
                      if (
                        !(nextTarget instanceof Node) ||
                        !event.currentTarget.contains(nextTarget)
                      ) {
                        event.currentTarget.removeAttribute("open");
                      }
                    }}
                  >
                    <summary
                      className="liquid-glass-control"
                      aria-controls="explore-filter-panel"
                      aria-label={
                        activeFilterCount === 0
                          ? "Filter and sort tokens"
                          : `Filter and sort tokens, ${activeFilterCount} ${
                              activeFilterCount === 1 ? "filter" : "filters"
                            } active`
                      }
                    >
                      <SlidersHorizontal aria-hidden="true" size={16} />
                      <span>Filter</span>
                      {activeFilterCount > 0 ? (
                        <span
                          className={styles.activeFilterCount}
                          aria-hidden="true"
                        >
                          {activeFilterCount}
                        </span>
                      ) : null}
                      <ChevronDown
                        className="token-filter-chevron"
                        aria-hidden="true"
                        size={15}
                      />
                    </summary>
                    <div
                      id="explore-filter-panel"
                      className={`token-filter-menu ${styles.filterMenu} liquid-glass-surface liquid-glass-popover`}
                      role="group"
                      aria-label="Filter and sort tokens"
                    >
                      <div
                        className={styles.filterGroup}
                        role="group"
                        aria-labelledby="explore-sort-label"
                      >
                        <p
                          className={styles.filterLabel}
                          id="explore-sort-label"
                        >
                          Sort by
                        </p>
                        {sortOptions.map((option) => (
                          <button
                            key={option.id}
                            className={
                              sort === option.id ? "active" : undefined
                            }
                            type="button"
                            aria-pressed={sort === option.id}
                            onClick={() => {
                              setSort(option.id);
                              setCurrentPage(1);
                            }}
                          >
                            <span>{option.label}</span>
                            {sort === option.id ? (
                              <Check aria-hidden="true" size={15} />
                            ) : null}
                          </button>
                        ))}
                      </div>

                      <div
                        className={styles.filterGroup}
                        role="group"
                        aria-labelledby="explore-socials-label"
                      >
                        <p
                          className={styles.filterLabel}
                          id="explore-socials-label"
                        >
                          Socials
                        </p>
                        {socialFilterOptions.map((option) => (
                          <button
                            key={option.id}
                            className={
                              socialFilter === option.id ? "active" : undefined
                            }
                            type="button"
                            aria-pressed={socialFilter === option.id}
                            onClick={() => {
                              setSocialFilter((current) =>
                                current === option.id ? "all" : option.id,
                              );
                              setCurrentPage(1);
                            }}
                          >
                            <span>{option.label}</span>
                            {socialFilter === option.id ? (
                              <Check aria-hidden="true" size={15} />
                            ) : null}
                          </button>
                        ))}
                      </div>

                      <div
                        className={styles.filterGroup}
                        role="group"
                        aria-labelledby="explore-model-label"
                      >
                        <p
                          className={styles.filterLabel}
                          id="explore-model-label"
                        >
                          Model
                        </p>
                        {modelFilterOptions.map((option) => (
                          <button
                            key={option.id}
                            className={
                              modelFilter === option.id ? "active" : undefined
                            }
                            type="button"
                            aria-pressed={modelFilter === option.id}
                            onClick={() => {
                              setModelFilter((current) =>
                                current === option.id ? "all" : option.id,
                              );
                              setCurrentPage(1);
                            }}
                          >
                            <span>{option.label}</span>
                            {modelFilter === option.id ? (
                              <Check aria-hidden="true" size={15} />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  </details>

                  {displayState.phase === "ready" &&
                  displayState.payload.status === "ready" &&
                  displayState.payload.total > 0 &&
                  pageCount > 1 ? (
                    <nav
                      className="token-pagination liquid-glass-control"
                      aria-label="Launch pages"
                    >
                      <button
                        type="button"
                        aria-label="Previous launch page"
                        aria-disabled={activePage === 1 || busy}
                        disabled={activePage === 1 || busy}
                        onClick={() => {
                          if (busy) return;
                          setCurrentPage((page) => Math.max(1, page - 1));
                        }}
                      >
                        <ChevronLeft aria-hidden="true" size={15} />
                      </button>

                      <div className="token-pagination-pages">
                        {paginationItems.map((item) =>
                          typeof item === "number" ? (
                            <button
                              key={item}
                              className={
                                activePage === item ? "active" : undefined
                              }
                              type="button"
                              aria-label={`Launch page ${item}`}
                              aria-current={
                                activePage === item ? "page" : undefined
                              }
                              aria-disabled={busy}
                              disabled={busy}
                              onClick={() => {
                                if (busy) return;
                                setCurrentPage(item);
                              }}
                            >
                              {item}
                            </button>
                          ) : (
                            <span key={item} aria-hidden="true">
                              …
                            </span>
                          ),
                        )}
                      </div>

                      <button
                        type="button"
                        aria-label="Next launch page"
                        aria-disabled={activePage === pageCount || busy}
                        disabled={activePage === pageCount || busy}
                        onClick={() => {
                          if (busy) return;
                          setCurrentPage((page) =>
                            Math.min(pageCount, page + 1),
                          );
                        }}
                      >
                        <ChevronRight aria-hidden="true" size={15} />
                      </button>
                    </nav>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <p
            ref={resultStatusRef}
            className={
              hasPublicTokens && displayState.phase !== "error"
                ? styles.resultLabel
                : "sr-only"
            }
            role="status"
            aria-live="polite"
            aria-atomic="true"
            tabIndex={-1}
          >
            {resultLabel}
          </p>

          {displayState.phase === "ready" &&
          (displayState.refreshError || dataQualityMessage) ? (
            <div className="token-refresh-warning" role="status">
              <span>
                {displayState.refreshError
                  ? "Prices may be out of date"
                  : dataQualityMessage}
              </span>
              <button type="button" onClick={retryTokens}>
                Refresh
              </button>
            </div>
          ) : null}

          {renderTokenState()}
        </section>
      </div>
      <SiteFooter />
    </>
  );
}
