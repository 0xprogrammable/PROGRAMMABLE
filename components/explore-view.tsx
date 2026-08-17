"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Search,
  X as CloseIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  formatMarketCapMetric,
  type MarketCapMetric,
} from "@/components/animated-market-cap";
import { XBrandIcon } from "@/components/brand-icons";
import { EXPLORE_PREVIEW_TOKENS } from "@/components/explore-preview-data";
import {
  isInterfacePreviewHost,
  useInterfacePreview,
} from "@/components/interface-preview";
import {
  LIVE_DATA_REFRESH_INTERVAL_MS,
  shouldRefreshLiveData,
  useLiveDataRefresh,
} from "@/components/use-live-data-refresh";
import { WebsiteLinkIcon } from "@/components/website-link-icon";
import { parseDiscoverableMarketTradeCapabilityV1 } from "@/lib/custom-launch/trade-capability-v1";
import {
  buildExploreDataQuality,
  exploreValuation,
  isExploreDataQuality,
  isExploreValuation,
  isExploreValuationQualifiedV1,
  type ExploreDataQuality,
  type ExploreValuation,
  type ValuedExploreEntry,
} from "@/lib/explore-financial-data";
import { DEFAULT_EXPLORE_VIEW_SORT } from "@/lib/explore-defaults";
import {
  isTokenMarketDataV1,
  marketDataStatusLabel,
} from "@/lib/market-data/market-data-v1";
import {
  applyTokenImageFallback,
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

type ExploreMarketStatus =
  | "No market"
  | "Waiting for first trade"
  | "Last verified"
  | "Provider recent"
  | "Limited market data"
  | "Unavailable";

type TokenCard = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl: string;
  links: readonly TokenLink[];
  valuation?: MarketCapMetric;
  valuationMetric?: "Market cap" | "FDV";
  marketStatus?: ExploreMarketStatus;
  usesFallbackImage: boolean;
  tokenAddress?: `0x${string}`;
  launchCategory: "Classic" | "Custom";
};

export function exploreMarketStatusLabel(
  entry: ExploreEntry | ValuedExploreEntry,
): ExploreMarketStatus | undefined {
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
  if (valuation.freshness === "provider-recent") return "Provider recent";
  if (valuation.freshness === "stale") return "Last verified";
  if (valuation.freshness === "unknown") return "Unavailable";
  return undefined;
}

export function exploreUnavailableFdvLabel(
  status: ExploreMarketStatus | undefined,
) {
  if (status === "Waiting for first trade") return status;
  if (status === "No market") return "No market yet";
  return "Not available yet";
}

type TokenSort = "newest" | "oldest" | "market-cap" | "market-cap-asc";
export type ExploreSocialFilter = "all" | "yes" | "no";
export type ExploreModelFilter = "all" | "classic" | "custom-hook";

type DexscreenerExploreMarketRead = Readonly<{
  provider: "dexscreener";
  status: "complete" | "partial" | "unavailable";
  currency: "USD";
  requestedCount: number;
  observedCount: number;
  qualifiedCount: number;
  unavailableCount: number;
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
}>;

type LegacyBitqueryExploreMarketRead = Readonly<{
  provider: "bitquery";
  status: "unavailable";
  phase: "market-core" | "market-liquidity" | "market-price";
}> & (
  | Readonly<{ category: "transport"; reason?: never; httpStatus?: never }>
  | Readonly<{ category: "response"; reason: "http-status"; httpStatus: 402 }>
);

type ExploreMarketRead =
  | DexscreenerExploreMarketRead
  | LegacyBitqueryExploreMarketRead;

type ExploreRanking = Readonly<{
  status: "complete" | "partial" | "unavailable";
  requested: "fdv";
  applied: "fdv" | "qualified-fdv-then-launch-order" | "launch-order";
  qualifiedCount?: number;
  totalCount?: number;
}>;

type ExploreCatalogBoundary = Readonly<{
  source: "envio-classic-v3";
  launchSource:
    | "envio-classic-v3"
    | "envio-classic-v3+registry.custom-launched";
  status: "current" | "last-known-good";
  lastIndexedAt: string;
  asOfBlock: string;
  asOfBlockHash: `0x${string}`;
  identityCount: number;
  identityCommitment: `sha256:${string}`;
  completeness: Readonly<{
    classic: "current" | "last-known-good";
    stock: "excluded";
    custom: "current" | "unavailable";
  }>;
  scope: Readonly<{
    included: readonly [
      "classic-v3",
      "official-main-token",
      "registry.custom-launched",
    ];
    excluded: readonly [
      "classic-v1",
      "classic-v2",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ];
    publicCategories: readonly ["classic", "custom"];
  }>;
  evidence: Readonly<{
    kind: "envio-indexer-state";
    deployment: string;
    sourceCommit: string;
    progressBlock: string;
    progressOccurrenceId: string;
    commitment: `sha256:${string}`;
  }>;
}>;

type ExplorePayload = {
  status: "ready" | "not-deployed";
  tokens: ValuedExploreEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  dataQuality?: ExploreDataQuality;
  marketRead?: ExploreMarketRead;
  ranking?: ExploreRanking;
  catalog?: ExploreCatalogBoundary;
};

export function exploreAppliedSortLabel(
  sort: TokenSort,
  ranking: ExploreRanking | undefined,
) {
  if (
    (sort === "market-cap" || sort === "market-cap-asc") &&
    ranking?.status === "unavailable"
  ) return "Launch order";
  if (
    (sort === "market-cap" || sort === "market-cap-asc") &&
    ranking?.status === "partial"
  ) return "Available FDV";
  return sortOptions.find((option) => option.id === sort)?.label ?? "Sort";
}

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
export const EXPLORE_MOBILE_TOKENS_PER_PAGE = 4;
export const EXPLORE_MOBILE_BREAKPOINT_PX = 700;
export const EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE = 100;

const EXPLORE_MOBILE_MEDIA_QUERY = `(max-width: ${EXPLORE_MOBILE_BREAKPOINT_PX}px)`;

export function exploreTokensPerPageForViewport(width: number) {
  return width <= EXPLORE_MOBILE_BREAKPOINT_PX
    ? EXPLORE_MOBILE_TOKENS_PER_PAGE
    : EXPLORE_TOKENS_PER_PAGE;
}

function subscribeToExploreViewport(onChange: () => void) {
  const query = window.matchMedia(EXPLORE_MOBILE_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function exploreMobileViewportSnapshot() {
  return window.matchMedia(EXPLORE_MOBILE_MEDIA_QUERY).matches;
}

function exploreMobileViewportServerSnapshot() {
  return false;
}

function useExploreTokensPerPage() {
  const mobile = useSyncExternalStore(
    subscribeToExploreViewport,
    exploreMobileViewportSnapshot,
    exploreMobileViewportServerSnapshot,
  );
  return mobile
    ? EXPLORE_MOBILE_TOKENS_PER_PAGE
    : EXPLORE_TOKENS_PER_PAGE;
}
const QUERY_DEBOUNCE_MS = 200;
const EXPLORE_REQUEST_TIMEOUT_MS = 12_000;
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

function parseExploreMarketRead(value: unknown): ExploreMarketRead | null {
  if (
    isRecord(value) &&
    value.provider === "bitquery" &&
    value.status === "unavailable" &&
    ["market-core", "market-liquidity", "market-price"].includes(
      String(value.phase),
    )
  ) {
    if (
      value.category === "transport" &&
      value.reason === undefined &&
      value.httpStatus === undefined
    ) return value as LegacyBitqueryExploreMarketRead;
    if (
      value.category === "response" &&
      value.reason === "http-status" &&
      value.httpStatus === 402
    ) return value as LegacyBitqueryExploreMarketRead;
    return null;
  }
  if (
    !isRecord(value) ||
    value.provider !== "dexscreener" ||
    !["complete", "partial", "unavailable"].includes(String(value.status)) ||
    value.currency !== "USD" ||
    !["requestedCount", "observedCount", "qualifiedCount", "unavailableCount"]
      .every((field) => Number.isSafeInteger(value[field]) && Number(value[field]) >= 0) ||
    Number(value.qualifiedCount) > Number(value.observedCount) ||
    Number(value.observedCount) > Number(value.requestedCount) ||
    Number(value.unavailableCount) !==
      Number(value.requestedCount) - Number(value.qualifiedCount) ||
    (value.oldestFetchedAt !== null &&
      (typeof value.oldestFetchedAt !== "string" ||
        !Number.isFinite(Date.parse(value.oldestFetchedAt)))) ||
    (value.newestFetchedAt !== null &&
      (typeof value.newestFetchedAt !== "string" ||
        !Number.isFinite(Date.parse(value.newestFetchedAt))))
  ) return null;
  const observed = Number(value.observedCount);
  // Transport completion and pair coverage are independent. A complete
  // Dexscreener read can honestly observe only a small subset of the known
  // tokens when the remaining token requests returned no exact pair.
  if (value.status === "unavailable" && observed !== 0) return null;
  return value as ExploreMarketRead;
}

function parseExploreRanking(value: unknown, total: unknown): ExploreRanking | null {
  if (
    isRecord(value) &&
    value.status === "unavailable" &&
    value.requested === "fdv" &&
    value.applied === "launch-order" &&
    value.qualifiedCount === undefined &&
    value.totalCount === undefined
  ) return value as ExploreRanking;
  if (
    !isRecord(value) ||
    !["complete", "partial", "unavailable"].includes(String(value.status)) ||
    value.requested !== "fdv" ||
    !["fdv", "qualified-fdv-then-launch-order", "launch-order"].includes(
      String(value.applied),
    ) ||
    !Number.isSafeInteger(value.qualifiedCount) ||
    Number(value.qualifiedCount) < 0 ||
    !Number.isSafeInteger(value.totalCount) ||
    Number(value.totalCount) < 0 ||
    value.totalCount !== total ||
    Number(value.qualifiedCount) > Number(value.totalCount)
  ) return null;
  const qualified = Number(value.qualifiedCount);
  const count = Number(value.totalCount);
  if (
    (value.status === "complete" &&
      (qualified !== count || value.applied !== "fdv")) ||
    (value.status === "partial" &&
      (qualified === 0 || qualified >= count ||
        value.applied !== "qualified-fdv-then-launch-order")) ||
    (value.status === "unavailable" &&
      (qualified !== 0 || value.applied !== "launch-order"))
  ) return null;
  return value as ExploreRanking;
}

function exactIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value;
}

function exactStringArray(value: unknown, expected: readonly string[]) {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((item, index) => item === expected[index]);
}

function parseExploreCatalog(value: unknown): ExploreCatalogBoundary | null {
  if (!isRecord(value) || !isRecord(value.completeness) ||
    !isRecord(value.scope) || !isRecord(value.evidence)) return null;
  const expectedLaunchSource = value.completeness.custom === "current"
    ? "envio-classic-v3+registry.custom-launched"
    : "envio-classic-v3";
  if (
    value.source !== "envio-classic-v3" ||
    value.launchSource !== expectedLaunchSource ||
    !["current", "last-known-good"].includes(String(value.status)) ||
    !exactIsoTimestamp(value.lastIndexedAt) ||
    typeof value.asOfBlock !== "string" ||
    !/^[1-9][0-9]*$/u.test(value.asOfBlock) ||
    typeof value.asOfBlockHash !== "string" ||
    !/^0x[0-9a-f]{64}$/u.test(value.asOfBlockHash) ||
    !Number.isSafeInteger(value.identityCount) ||
    Number(value.identityCount) < 0 ||
    typeof value.identityCommitment !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.identityCommitment) ||
    !["current", "last-known-good"].includes(
      String(value.completeness.classic),
    ) ||
    value.completeness.stock !== "excluded" ||
    !["current", "unavailable"].includes(
      String(value.completeness.custom),
    ) ||
    !exactStringArray(value.scope.included, [
      "classic-v3",
      "official-main-token",
      "registry.custom-launched",
    ]) ||
    !exactStringArray(value.scope.excluded, [
      "classic-v1",
      "classic-v2",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ]) ||
    !exactStringArray(value.scope.publicCategories, ["classic", "custom"]) ||
    value.evidence.kind !== "envio-indexer-state" ||
    typeof value.evidence.deployment !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(value.evidence.deployment) ||
    typeof value.evidence.sourceCommit !== "string" ||
    !/^[0-9a-f]{40}$/u.test(value.evidence.sourceCommit) ||
    value.evidence.progressBlock !== value.asOfBlock ||
    typeof value.evidence.progressOccurrenceId !== "string" ||
    !/^1:0x[0-9a-f]{64}:0x[0-9a-f]{64}:[0-9]+$/u.test(
      value.evidence.progressOccurrenceId,
    ) ||
    typeof value.evidence.commitment !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.evidence.commitment)
  ) return null;
  return value as ExploreCatalogBoundary;
}

function exploreCatalogBoundaryKey(value: ExploreCatalogBoundary) {
  return JSON.stringify(value);
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
  const marketRead = parseExploreMarketRead(value.marketRead);
  if (value.marketRead !== undefined && marketRead === null) {
    throw new Error("The token registry returned invalid market read data");
  }
  const ranking = parseExploreRanking(value.ranking, value.total);
  if (
    value.ranking !== undefined &&
    (ranking === null || marketRead === null)
  ) {
    throw new Error("The token registry returned invalid ranking data");
  }
  const catalog = parseExploreCatalog(value.catalog);
  if (catalog === null) {
    throw new Error("The token registry returned invalid catalog data");
  }

  const tokens = value.tokens.map(parseExploreEntry);
  if (tokens.some((token) => token === null)) {
    throw new Error("The token registry returned an invalid token record");
  }

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
    (value.totalPages === 0 ? value.page !== 1 : value.page > value.totalPages)
  ) {
    throw new Error("The token registry returned invalid pagination data");
  }
  const availableValuations = tokens.filter(
    (token) => token?.valuation.status === "available",
  ).length;
  if (marketRead !== null && value.dataQuality === undefined) {
    throw new Error("The token registry returned inconsistent market read data");
  }
  if (
    value.dataQuality !== undefined &&
    (value.dataQuality.generatedAt !== catalog.lastIndexedAt ||
      value.dataQuality.launchIdentity.asOfBlock !== catalog.asOfBlock ||
      value.dataQuality.launchIdentity.custom !== catalog.completeness.custom)
  ) {
    throw new Error("The token registry returned inconsistent catalog data");
  }
  if (
    marketRead?.status === "unavailable" && availableValuations !== 0
  ) {
    throw new Error("The token registry returned inconsistent market read data");
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
    ...(value.dataQuality === undefined
      ? {}
      : { dataQuality: value.dataQuality }),
    ...(marketRead === null ? {} : { marketRead }),
    ...(ranking === null ? {} : { ranking }),
    catalog,
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
      payload.pageSize !== EXPLORE_TOKENS_PER_PAGE
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

type ExploreRequestContract = Readonly<{
  page: number;
  pageSize: number;
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

function exploreRequestContract(
  search: URLSearchParams,
): ExploreRequestContract {
  const page = exactPositiveSearchInteger(search.get("page"), 1, "page");
  const pageSize = Math.min(
    exactPositiveSearchInteger(
      search.get("limit"),
      EXPLORE_TOKENS_PER_PAGE,
      "page size",
    ),
    EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
  );
  return { page, pageSize };
}

function assertExploreResponseContract(
  payload: ExplorePayload,
  contract: ExploreRequestContract,
) {
  if (
    payload.page !== contract.page ||
    payload.pageSize !== contract.pageSize
  ) {
    throw new Error("The token registry returned an inconsistent page");
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

function shouldRetryMissingBitqueryFdv(
  search: URLSearchParams,
  payload: ExplorePayload,
) {
  const sort = search.get("sort");
  if (sort !== "market-cap" && sort !== "market-cap-asc") return false;
  if (payload.marketRead !== undefined) return false;
  return !payload.tokens.some((token) => {
    const valuation = token.valuation;
    return valuation.status === "available" &&
      valuation.metric === "fdv" &&
      valuation.supplyBasis === "total" &&
      valuation.currency === "usd" &&
      valuation.freshness === "current" &&
      valuation.source === "bitquery" &&
      BigInt(valuation.valueWad) > 0n;
  });
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
  if (payload.marketRead?.status === "unavailable") return;
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
  contract: ExploreRequestContract,
) {
  const requestUrl = `/api/explore?${search.toString()}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal.throwIfAborted();
    const attemptController = new AbortController();
    let timedOut = false;
    const abortAttempt = () => attemptController.abort(signal.reason);
    signal.addEventListener("abort", abortAttempt, { once: true });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, EXPLORE_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(requestUrl, {
        headers: { Accept: "application/json" },
        signal: attemptController.signal,
      });
      signal.throwIfAborted();
      if (timedOut) throw new Error("Tokens took too long to respond");
      if (response.status === 503 && attempt === 0) {
        continue;
      }
      const body: unknown = await response.json().catch(() => null);
      signal.throwIfAborted();
      if (timedOut) throw new Error("Tokens took too long to respond");
      if (response.status !== 200) {
        throw new Error(readApiError(body));
      }
      const payload = parseExplorePayload(body);
      assertExploreResponseContract(payload, contract);
      const marketReadStatus = response.headers.get(
        "X-Programmable-Market-Read-Status",
      );
      const expectedLegacyStatus =
        payload.marketRead?.provider === "bitquery"
          ? payload.marketRead.category === "transport"
            ? "transport-unavailable"
            : "response-unavailable"
          : null;
      if (
        payload.marketRead?.provider === "dexscreener" &&
        marketReadStatus !== payload.marketRead.status
      ) {
        throw new Error("The token registry returned inconsistent market read data");
      }
      if (
        expectedLegacyStatus !== null &&
        marketReadStatus !== expectedLegacyStatus
      ) {
        throw new Error("The token registry returned inconsistent market read data");
      }
      if (
        marketReadStatus !== null &&
        ![
          "complete",
          "partial",
          "unavailable",
          "current",
          "transport-unavailable",
          "response-unavailable",
        ].includes(marketReadStatus)
      ) {
        throw new Error("The token registry returned inconsistent market read data");
      }
      if (
        attempt === 0 &&
        shouldRetryMissingBitqueryFdv(search, payload)
      ) continue;
      return payload;
    } catch (error) {
      signal.throwIfAborted();
      if (timedOut) throw new Error("Tokens took too long to respond");
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
      signal.removeEventListener("abort", abortAttempt);
    }
  }
  throw new Error("Tokens are temporarily unavailable");
}

export function loadExplorePayload(
  contentKey: string,
  search: URLSearchParams,
) {
  let contract: ExploreRequestContract;
  try {
    contract = exploreRequestContract(search);
  } catch (error) {
    return Promise.reject(error);
  }
  const resolved = readResolvedExplorePayload(contentKey);
  if (resolved) {
    try {
      assertExploreResponseContract(resolved, contract);
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
  const request = (async (): Promise<ExplorePayload> => {
    const payload = await fetchExplorePayload(
      search,
      controller.signal,
      contract,
    );
    controller.signal.throwIfAborted();
    cacheResolvedExplorePayload(contentKey, payload);
    return payload;
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
  for (const [key, pendingRequest] of pendingExploreRequests) {
    if (key !== contentKey && !key.startsWith(modelPagePrefix)) continue;
    pendingExploreRequests.delete(key);
    pendingRequest.controller.abort();
  }
}

export async function loadExplorePage(
  contentKey: string,
  search: URLSearchParams,
) {
  return loadExplorePayload(contentKey, new URLSearchParams(search));
}

export async function loadExploreModelDataset(
  contentKey: string,
  search: URLSearchParams,
) {
  const firstPageSearch = new URLSearchParams(search);
  firstPageSearch.set("page", "1");
  firstPageSearch.set("limit", String(EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE));
  const firstPage = await loadExplorePayload(
    `${contentKey}\u0000model-page:1`,
    firstPageSearch,
  );
  if (firstPage.catalog === undefined) {
    throw new Error("Tokens changed while filters were loading");
  }
  const firstPageCatalog = firstPage.catalog;
  if (firstPage.totalPages <= 1) {
    return firstPage;
  }

  const remainingPages = await Promise.all(
    Array.from({ length: firstPage.totalPages - 1 }, async (_, index) => {
      const page = index + 2;
      const pageSearch = new URLSearchParams(firstPageSearch);
      pageSearch.set("page", String(page));
      const payload = await loadExplorePayload(
        `${contentKey}\u0000model-page:${page}`,
        pageSearch,
      );
      if (
        payload.status !== firstPage.status ||
        payload.page !== page ||
        payload.pageSize !== firstPage.pageSize ||
        payload.total !== firstPage.total ||
        payload.totalPages !== firstPage.totalPages ||
        payload.catalog === undefined ||
        exploreCatalogBoundaryKey(payload.catalog) !==
          exploreCatalogBoundaryKey(firstPageCatalog)
      ) {
        throw new Error("Tokens changed while filters were loading");
      }
      return payload;
    }),
  );

  const pages = [firstPage, ...remainingPages];
  let tokens = pages.flatMap(
    (payload) => payload.tokens,
  );
  assertUniqueExploreDatasetEntries(tokens);
  const degradedPages = pages.filter(
    (payload) => payload.marketRead?.status === "unavailable",
  );
  if (degradedPages.length > 0 && degradedPages.length !== pages.length) {
    throw new Error("Tokens changed while filters were loading");
  }
  const degradedPage = degradedPages[0];
  if (degradedPage !== undefined) {
    const markerIsConsistent = degradedPages.every((payload) =>
      payload.marketRead?.provider === degradedPage.marketRead?.provider &&
      payload.marketRead?.status === degradedPage.marketRead?.status &&
      (payload.marketRead?.provider !== "dexscreener" ||
        degradedPage.marketRead?.provider !== "dexscreener" ||
        payload.marketRead.currency === degradedPage.marketRead.currency) &&
      (payload.marketRead?.provider !== "bitquery" ||
        degradedPage.marketRead?.provider !== "bitquery" ||
        (payload.marketRead.category === degradedPage.marketRead.category &&
          payload.marketRead.phase === degradedPage.marketRead.phase &&
          payload.marketRead.reason === degradedPage.marketRead.reason &&
          payload.marketRead.httpStatus === degradedPage.marketRead.httpStatus)) &&
      payload.ranking?.status === degradedPage.ranking?.status &&
      payload.ranking?.requested === degradedPage.ranking?.requested &&
      payload.ranking?.applied === degradedPage.ranking?.applied
    );
    if (!markerIsConsistent) {
      throw new Error("Tokens changed while filters were loading");
    }
    const sourceQuality = degradedPage.dataQuality;
    if (sourceQuality === undefined) {
      throw new Error("Tokens changed while filters were loading");
    }
    tokens = tokens.map((entry): ValuedExploreEntry => {
      if (entry.exploreKind === "custom-project") {
        const {
          marketData: _marketData,
          liquidityEvidence: _liquidityEvidence,
          fdvUsdWad: _fdvUsdWad,
          ...identity
        } = entry as typeof entry & Readonly<{ fdvUsdWad?: string }>;
        void _marketData;
        void _liquidityEvidence;
        void _fdvUsdWad;
        return {
          ...identity,
          valuation: {
            status: "unavailable",
            reason: entry.markets.length === 0
              ? "no-market"
              : "source-unavailable",
          },
        };
      }
      const {
        marketData: _marketData,
        liquidityEvidence: _liquidityEvidence,
        fdvUsdWad: _fdvUsdWad,
        ...identity
      } = entry;
      void _marketData;
      void _liquidityEvidence;
      void _fdvUsdWad;
      return {
        ...identity,
        valuation: { status: "unavailable", reason: "source-unavailable" },
      };
    });
    const marketSort = firstPageSearch.get("sort") === "market-cap" ||
      firstPageSearch.get("sort") === "market-cap-asc";
    if (marketSort && degradedPage.ranking === undefined) {
      throw new Error("Tokens changed while filters were loading");
    }
    return {
      ...firstPage,
      tokens,
      dataQuality: buildExploreDataQuality({
        entries: tokens,
        generatedAt: sourceQuality.generatedAt,
        canonicalStatus: sourceQuality.launchIdentity.canonical,
        customStatus: sourceQuality.launchIdentity.custom,
        identityAsOfBlock: sourceQuality.launchIdentity.asOfBlock,
        referenceBlock: sourceQuality.launchIdentity.referenceBlock,
        identityAgeMs: sourceQuality.launchIdentity.ageMs,
      }),
      marketRead: degradedPage.marketRead,
      ...(degradedPage.ranking === undefined
        ? {}
        : { ranking: degradedPage.ranking }),
    };
  }
  return {
    ...firstPage,
    tokens,
  };
}

export function paginateExploreModelDataset(
  dataset: ExplorePayload,
  modelFilter: ExploreModelFilter,
  requestedPage: number,
  pageSize = EXPLORE_TOKENS_PER_PAGE,
): ExplorePayload {
  const page = paginateTokensByExploreFilters(
    dataset.tokens,
    "all",
    modelFilter,
    requestedPage,
    pageSize,
  );
  return {
    status: dataset.status,
    ...page,
    ...(dataset.dataQuality === undefined
      ? {}
      : {
          dataQuality: buildExploreDataQuality({
            entries: page.tokens,
            generatedAt: dataset.dataQuality.generatedAt,
            canonicalStatus: dataset.dataQuality.launchIdentity.canonical,
            customStatus: dataset.dataQuality.launchIdentity.custom,
            identityAsOfBlock: dataset.dataQuality.launchIdentity.asOfBlock,
            referenceBlock: dataset.dataQuality.launchIdentity.referenceBlock,
            identityAgeMs: dataset.dataQuality.launchIdentity.ageMs,
          }),
        }),
    ...(dataset.marketRead === undefined
      ? {}
      : { marketRead: dataset.marketRead }),
    ...(dataset.ranking === undefined ? {} : { ranking: dataset.ranking }),
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
  if (!isExploreValuationQualifiedV1(valuation)) return undefined;
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
      symbol: token.symbol?.trim() ?? "",
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
  const [sort, setSort] = useState<TokenSort>(DEFAULT_EXPLORE_VIEW_SORT);
  const [socialFilter, setSocialFilter] = useState<ExploreSocialFilter>("all");
  const [modelFilter, setModelFilter] = useState<ExploreModelFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = useExploreTokensPerPage();
  const [retryKey, setRetryKey] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const refreshKey = useLiveDataRefresh({
    enabled: !preview && !loadingOnly,
  });
  const activeExploreContentKey = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultStatusRef = useRef<HTMLParagraphElement>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const modelDatasetCache = useRef<{
    key: string;
    payload: ExplorePayload;
  } | null>(null);
  const filterRef = useRef<HTMLDetailsElement>(null);
  const contentKey = `${debouncedQuery}\u0000${sort}\u0000${socialFilter}\u0000${modelFilter}\u0000${currentPage}\u0000${pageSize}`;
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
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    },
    [],
  );

  async function copyContractAddress(token: TokenCard) {
    if (!token.tokenAddress) return;

    try {
      await navigator.clipboard.writeText(token.tokenAddress);
      setCopyFeedback(`${token.name} contract address copied`);
      setCopiedTokenId(token.id);
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopyFeedback("");
        setCopiedTokenId(null);
        copyFeedbackTimerRef.current = null;
      }, 1800);
    } catch {
      setCopyFeedback("Contract address could not be copied");
      setCopiedTokenId(null);
    }
  }

  useEffect(() => {
    if (normalizedQuery === debouncedQuery) return;

    const timer = window.setTimeout(() => {
      setCurrentPage(1);
      setDebouncedQuery(normalizedQuery);
    }, QUERY_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [debouncedQuery, normalizedQuery]);

  useEffect(() => {
    return subscribeToExploreViewport(() => setCurrentPage(1));
  }, []);

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
    if (
      preview ||
      loadingOnly ||
      (typeof window !== "undefined" &&
        isInterfacePreviewHost(window.location.hostname))
    ) {
      return;
    }

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
      limit: String(pageSize),
    });
    if (socialFilter !== "all") {
      search.set("socials", socialFilter);
    }

    async function loadTokens() {
      try {
        let payload: ExplorePayload;
        if (modelFilter === "all") {
          payload = await loadExplorePage(
            activeRequestContentKey,
            search,
          );
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
            modelDatasetCache.current =
              dataset.marketRead?.status === "unavailable"
                ? null
                : {
                    key: modelDatasetKey,
                    payload: dataset,
                  };
          }
          payload = paginateExploreModelDataset(
            dataset,
            modelFilter,
            currentPage,
            pageSize,
          );
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
    pageSize,
    initialState,
    loadingOnly,
    preview,
    requestKey,
    socialFilter,
    sort,
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
      pageSize,
    );

    return {
      status: "ready",
      ...paginated,
    };
  }, [currentPage, debouncedQuery, modelFilter, pageSize, socialFilter, sort]);

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
  const resultLabel =
    displayState.phase === "error" ? "" : resultRangeLabel(payload);
  const dataQualityMessage = exploreDataQualityMessage(payload?.dataQuality);
  const busy =
    !preview &&
    (displayState.phase === "loading" ||
      displayState.requestKey !== requestKey);
  const activeFilterCount =
    Number(socialFilter !== "all") + Number(modelFilter !== "all");
  const ranking = payload?.ranking;
  const activeSortLabel = exploreAppliedSortLabel(sort, ranking);
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
        <div className={styles.loadingState} aria-busy="true">
          <span className="sr-only" role="status">
            Loading launches
          </span>
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
                  loading={index < Math.min(pageSize, 4) ? "eager" : "lazy"}
                  priority={index < Math.min(pageSize, 4)}
                  sizes="(max-width: 700px) calc((100vw - 42px) / 2), (max-width: 900px) 330px, 299px"
                  unoptimized={!canOptimizeTokenImage(imageSource)}
                  draggable={false}
                  onError={(event) => {
                    applyTokenImageFallback(
                      event.currentTarget,
                      getFallbackTokenImage(token.tokenAddress ?? token.id),
                    );
                  }}
                />
              </div>

              <div className={styles.runnerBody}>
                <header className={styles.runnerHeading}>
                  <h3 title={token.name}>{token.name}</h3>
                  {token.symbol ? <span>${token.symbol}</span> : null}
                </header>
                <div className={styles.runnerData}>
                  <span>
                    <small>{token.valuationMetric ?? "FDV"}</small>
                    <strong>
                      {valuationLabel ??
                        exploreUnavailableFdvLabel(token.marketStatus)}
                    </strong>
                  </span>
                </div>
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
                {token.tokenAddress ? (
                  <div className={styles.runnerContract}>
                    <code title={token.tokenAddress}>
                      {`${token.tokenAddress.slice(0, 6)}…${token.tokenAddress.slice(-4)}`}
                    </code>
                    <button
                      className={styles.runnerCopyButton}
                      type="button"
                      aria-label={
                        copiedTokenId === token.id
                          ? `${token.name} contract address copied`
                          : `Copy ${token.name} contract address`
                      }
                      title={
                        copiedTokenId === token.id
                          ? "Copied"
                          : "Copy contract address"
                      }
                      data-state={
                        copiedTokenId === token.id ? "copied" : undefined
                      }
                      onClick={() => void copyContractAddress(token)}
                    >
                      {copiedTokenId === token.id ? (
                        <Check aria-hidden="true" size={15} strokeWidth={2} />
                      ) : (
                        <Copy aria-hidden="true" size={14} strokeWidth={1.8} />
                      )}
                    </button>
                  </div>
                ) : null}
                {token.marketStatus && token.marketStatus !== "Unavailable" ? (
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
    <div className={`${styles.page} explore-page page-width`}>
        <header className={styles.pageHeading}>
          <h1>Explore Hooks</h1>
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
                <div
                  className="token-toolbar"
                  inert={loadingOnly ? true : undefined}
                >
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
                      placeholder="Search"
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
                          ? `Filter and sort tokens, ${activeSortLabel} selected`
                          : `Filter and sort tokens, ${activeSortLabel} selected, ${activeFilterCount} ${
                              activeFilterCount === 1 ? "filter" : "filters"
                            } active`
                      }
                    >
                      <span>{`Sort: ${activeSortLabel}`}</span>
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
                        aria-labelledby="explore-model-label"
                      >
                        <p className={styles.filterLabel} id="explore-model-label">
                          Hook Type
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

                      <div
                        className={styles.filterGroup}
                        role="group"
                        aria-labelledby="explore-fdv-label"
                      >
                        <p className={styles.filterLabel} id="explore-fdv-label">
                          FDV
                        </p>
                        {sortOptions.slice(2).map((option) => (
                          <button
                            key={option.id}
                            className={sort === option.id ? "active" : undefined}
                            type="button"
                            aria-pressed={sort === option.id}
                            onClick={() => {
                              setSort(option.id);
                              setCurrentPage(1);
                            }}
                          >
                            <span>{option.id === "market-cap" ? "Highest" : "Lowest"}</span>
                            {sort === option.id ? <Check aria-hidden="true" size={15} /> : null}
                          </button>
                        ))}
                      </div>

                      <div
                        className={styles.filterGroup}
                        role="group"
                        aria-labelledby="explore-age-label"
                      >
                        <p className={styles.filterLabel} id="explore-age-label">
                          Age
                        </p>
                        {sortOptions.slice(0, 2).map((option) => (
                          <button
                            key={option.id}
                            className={sort === option.id ? "active" : undefined}
                            type="button"
                            aria-pressed={sort === option.id}
                            onClick={() => {
                              setSort(option.id);
                              setCurrentPage(1);
                            }}
                          >
                            <span>{option.label}</span>
                            {sort === option.id ? <Check aria-hidden="true" size={15} /> : null}
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

                      <span className="token-pagination-pages" aria-live="polite">
                        {activePage} / {pageCount}
                      </span>

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
            className="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            tabIndex={-1}
          >
            {resultLabel}
          </p>

          <p className="sr-only" role="status" aria-live="polite">
            {copyFeedback}
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
  );
}
