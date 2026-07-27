import type { LauncherToken } from "../tokens";

import type {
  ExplorePage,
  ExploreReadModel,
  ExploreSort,
} from "./types";

const DEFAULT_PAGE_SIZE = 6;
const MAX_PAGE_SIZE = 100;

export function parseExploreSort(value: string | null): ExploreSort {
  if (value === "oldest") return "oldest";
  if (value === "market-cap" || value === "highest-market-cap") {
    return "market-cap";
  }
  return "newest";
}

function launchOrder(token: LauncherToken) {
  return {
    block: BigInt(token.launchBlockNumber ?? "0"),
    transactionIndex: token.launchTransactionIndex ?? 0,
    logIndex: token.launchLogIndex ?? 0,
  };
}

function compareLaunchOrder(
  first: LauncherToken,
  second: LauncherToken,
) {
  const a = launchOrder(first);
  const b = launchOrder(second);
  if (a.block !== b.block) return a.block < b.block ? -1 : 1;
  if (a.transactionIndex !== b.transactionIndex) {
    return a.transactionIndex - b.transactionIndex;
  }
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  return first.tokenAddress.localeCompare(second.tokenAddress);
}

export function filterAndSortTokens(
  tokens: LauncherToken[],
  query: string,
  sort: ExploreSort,
) {
  const normalizedQuery = query
    .trim()
    .toLowerCase()
    .replace(/^\$/, "");
  const filtered = normalizedQuery
    ? tokens.filter(
        (token) =>
          token.name.toLowerCase().includes(normalizedQuery) ||
          token.symbol.toLowerCase().includes(normalizedQuery) ||
          token.tokenAddress.toLowerCase().includes(normalizedQuery),
      )
    : [...tokens];

  return filtered.sort((first, second) => {
    if (sort === "market-cap") {
      const firstCap = BigInt(first.marketCapEthWei ?? "0");
      const secondCap = BigInt(second.marketCapEthWei ?? "0");
      if (firstCap !== secondCap) return firstCap > secondCap ? -1 : 1;
      return compareLaunchOrder(second, first);
    }
    const comparison = compareLaunchOrder(first, second);
    return sort === "oldest" ? comparison : -comparison;
  });
}

function positiveInteger(value: number, fallback: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1) return fallback;
  return Math.min(value, maximum);
}

export function paginateExplore(
  model: ExploreReadModel,
  options: {
    query?: string;
    sort?: ExploreSort;
    page?: number;
    pageSize?: number;
  } = {},
): ExplorePage {
  const query = options.query?.trim() ?? "";
  const sort = options.sort ?? "newest";
  const pageSize = positiveInteger(
    options.pageSize ?? DEFAULT_PAGE_SIZE,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  );
  const requestedPage = positiveInteger(
    options.page ?? 1,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const sorted = filterAndSortTokens(model.tokens, query, sort);
  const totalPages = Math.ceil(sorted.length / pageSize);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  return {
    status: model.status,
    tokens: sorted.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: sorted.length,
    totalPages,
    sort,
    query,
    snapshot: model.snapshot,
    launcherFeesAccruedWei: model.launcherFeesAccruedWei,
    launcherFeesAccruedEth: model.launcherFeesAccruedEth,
  };
}
