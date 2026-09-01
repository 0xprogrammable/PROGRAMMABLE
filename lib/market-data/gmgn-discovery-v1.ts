// Provider contract: GMGNAI/gmgn-skills@7a87b8f09de83209d7f55f2924cd5967ec197fda.
// This projection deliberately keeps only identity and numeric ranking signals.
// Programmable's canonical launch catalog remains the authority for token names,
// metadata, launch identity, and visibility.

export const PROGRAMMABLE_GMGN_DISCOVERY_SCHEMA_VERSION =
  "programmable.gmgn-discovery.v1" as const;

export const PROGRAMMABLE_GMGN_SEARCH_SCHEMA_VERSION =
  "programmable.gmgn-search.v1" as const;

export const GMGN_DISCOVERY_INTERVALS = [
  "1m",
  "5m",
  "1h",
  "6h",
  "24h",
] as const;

export const GMGN_TRENDING_MAXIMUM_LIMIT = 100 as const;
export const GMGN_HOT_SEARCH_MAXIMUM_LIMIT = 500 as const;
export const GMGN_SEARCH_MAXIMUM_QUERY_CODE_POINTS = 100 as const;

export type GmgnDiscoveryIntervalV1 =
  typeof GMGN_DISCOVERY_INTERVALS[number];
export type GmgnDiscoveryKindV1 = "trending" | "hot-search";

export type GmgnDiscoveryTokenV1 = Readonly<{
  chain: "eth";
  tokenAddress: `0x${string}`;
  rank: number;
  visitingCount: number | null;
  hotLevel: number | null;
  swaps: number | null;
  buys: number | null;
  sells: number | null;
  holderCount: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volumeUsd: number | null;
}>;

export type GmgnDiscoverySnapshotV1 = Readonly<{
  schemaVersion: typeof PROGRAMMABLE_GMGN_DISCOVERY_SCHEMA_VERSION;
  source: "gmgn";
  chainId: "1";
  providerChain: "eth";
  kind: GmgnDiscoveryKindV1;
  interval: GmgnDiscoveryIntervalV1;
  orderBy: "marketcap" | null;
  direction: "asc" | "desc" | null;
  requestedLimit: number;
  fetchedAt: string;
  providerVersion: string | null;
  providerItemCount: number;
  discardedProviderItemCount: number;
  duplicateProviderItemCount: number;
  tokens: readonly GmgnDiscoveryTokenV1[];
}>;

export type ParseGmgnDiscoverySnapshotInputV1 = Readonly<{
  kind: GmgnDiscoveryKindV1;
  interval: GmgnDiscoveryIntervalV1;
  orderBy?: "marketcap";
  direction?: "asc" | "desc";
  limit: number;
  fetchedAt: Date;
}>;

export type GmgnSearchTokenV1 = Readonly<{
  chain: "eth";
  tokenAddress: `0x${string}`;
  rank: number;
}>;

export type GmgnSearchSnapshotV1 = Readonly<{
  schemaVersion: typeof PROGRAMMABLE_GMGN_SEARCH_SCHEMA_VERSION;
  source: "gmgn";
  chainId: "1";
  providerChain: "eth";
  query: string;
  orderBy: "weight";
  fetchedAt: string;
  providerItemCount: number;
  discardedProviderItemCount: number;
  duplicateProviderItemCount: number;
  tokens: readonly GmgnSearchTokenV1[];
}>;

export type ParseGmgnSearchSnapshotInputV1 = Readonly<{
  query: string;
  fetchedAt: Date;
}>;

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const MAXIMUM_PROVIDER_ITEMS = 1_000;
const MAXIMUM_PROVIDER_VERSION_LENGTH = 256;
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}]/gu;

/**
 * Mirrors GMGN's public search boundary while keeping local `$SYMBOL` search
 * behavior. The provider cache and ranking commitment use the case-folded
 * value so equivalent queries share one immutable snapshot.
 */
export function normalizeGmgnSearchQueryV1(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1_024) return null;
  const normalized = value.normalize("NFC")
    .replace(INVISIBLE_OR_CONTROL, "")
    .trim()
    .replace(/^\$/u, "")
    .trim()
    .toLowerCase();
  const codePoints = [...normalized];
  return codePoints.length >= 1 &&
      codePoints.length <= GMGN_SEARCH_MAXIMUM_QUERY_CODE_POINTS
    ? normalized
    : null;
}

export function parseGmgnSearchSnapshotV1(
  response: unknown,
  input: ParseGmgnSearchSnapshotInputV1,
): GmgnSearchSnapshotV1 | null {
  const query = normalizeGmgnSearchQueryV1(input.query);
  if (query === null || !Number.isFinite(input.fetchedAt.getTime())) return null;
  const data = unwrapSuccessfulData(response);
  if (
    data === null ||
    !isRecord(data) ||
    !Array.isArray(data.coins) ||
    !Array.isArray(data.wallets) ||
    data.coins.length > MAXIMUM_PROVIDER_ITEMS ||
    data.wallets.length > 50
  ) return null;

  const tokens: GmgnSearchTokenV1[] = [];
  const addresses = new Set<string>();
  let discardedProviderItemCount = 0;
  let duplicateProviderItemCount = 0;
  for (const [providerIndex, coin] of data.coins.entries()) {
    if (!isRecord(coin) || coin.chain !== "eth") {
      discardedProviderItemCount += 1;
      continue;
    }
    const tokenAddress = canonicalAddress(coin.address);
    if (tokenAddress === null) {
      discardedProviderItemCount += 1;
      continue;
    }
    if (addresses.has(tokenAddress)) {
      duplicateProviderItemCount += 1;
      continue;
    }
    addresses.add(tokenAddress);
    tokens.push(Object.freeze({
      chain: "eth",
      tokenAddress,
      rank: providerIndex + 1,
    }));
  }

  const snapshot: GmgnSearchSnapshotV1 = Object.freeze({
    schemaVersion: PROGRAMMABLE_GMGN_SEARCH_SCHEMA_VERSION,
    source: "gmgn",
    chainId: "1",
    providerChain: "eth",
    query,
    orderBy: "weight",
    fetchedAt: input.fetchedAt.toISOString(),
    providerItemCount: data.coins.length,
    discardedProviderItemCount,
    duplicateProviderItemCount,
    tokens: Object.freeze(tokens),
  });
  return isGmgnSearchSnapshotV1(snapshot) ? snapshot : null;
}

export function isGmgnSearchSnapshotV1(
  value: unknown,
): value is GmgnSearchSnapshotV1 {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== PROGRAMMABLE_GMGN_SEARCH_SCHEMA_VERSION ||
    value.source !== "gmgn" ||
    value.chainId !== "1" ||
    value.providerChain !== "eth" ||
    normalizeGmgnSearchQueryV1(value.query) !== value.query ||
    value.orderBy !== "weight" ||
    !exactIsoTime(value.fetchedAt) ||
    !unsignedSafeInteger(value.providerItemCount) ||
    !unsignedSafeInteger(value.discardedProviderItemCount) ||
    !unsignedSafeInteger(value.duplicateProviderItemCount) ||
    !Array.isArray(value.tokens) ||
    value.tokens.length > MAXIMUM_PROVIDER_ITEMS ||
    value.tokens.some((token) => !isGmgnSearchTokenV1(token)) ||
    Number(value.providerItemCount) !== value.tokens.length +
      Number(value.discardedProviderItemCount) +
      Number(value.duplicateProviderItemCount)
  ) return false;
  const tokens = value.tokens as readonly GmgnSearchTokenV1[];
  return new Set(tokens.map((token) => token.tokenAddress)).size ===
      tokens.length &&
    tokens.every((token, index) => index === 0 ||
      tokens[index - 1]!.rank < token.rank);
}

export function parseGmgnDiscoverySnapshotV1(
  response: unknown,
  input: ParseGmgnDiscoverySnapshotInputV1,
): GmgnDiscoverySnapshotV1 | null {
  if (!validParseInput(input)) return null;
  const data = unwrapSuccessfulData(response);
  if (data === null) return null;

  const extracted = input.kind === "trending"
    ? extractTrendingItems(data, input.limit)
    : extractHotSearchItems(data, input.interval, input.limit);
  if (extracted === null) return null;

  const parsed: Array<Readonly<{
    token: GmgnDiscoveryTokenV1;
    providerIndex: number;
  }>> = [];
  let discarded = extracted.foreignItemCount;
  for (const [providerIndex, item] of extracted.items.entries()) {
    const token = parseDiscoveryToken(item);
    if (token === null) {
      discarded += 1;
      continue;
    }
    parsed.push({ token, providerIndex });
  }
  parsed.sort((left, right) =>
    left.token.rank - right.token.rank ||
    left.providerIndex - right.providerIndex
  );

  const tokens: GmgnDiscoveryTokenV1[] = [];
  const addresses = new Set<string>();
  let duplicates = 0;
  for (const candidate of parsed) {
    if (addresses.has(candidate.token.tokenAddress)) {
      duplicates += 1;
      continue;
    }
    addresses.add(candidate.token.tokenAddress);
    tokens.push(Object.freeze(candidate.token));
  }

  const snapshot: GmgnDiscoverySnapshotV1 = Object.freeze({
    schemaVersion: PROGRAMMABLE_GMGN_DISCOVERY_SCHEMA_VERSION,
    source: "gmgn",
    chainId: "1",
    providerChain: "eth",
    kind: input.kind,
    interval: input.interval,
    orderBy: input.orderBy ?? null,
    direction: input.direction ?? null,
    requestedLimit: input.limit,
    fetchedAt: input.fetchedAt.toISOString(),
    providerVersion: extracted.providerVersion,
    providerItemCount: extracted.providerItemCount,
    discardedProviderItemCount: discarded,
    duplicateProviderItemCount: duplicates,
    tokens: Object.freeze(tokens),
  });
  return isGmgnDiscoverySnapshotV1(snapshot) ? snapshot : null;
}

export function isGmgnDiscoverySnapshotV1(
  value: unknown,
): value is GmgnDiscoverySnapshotV1 {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== PROGRAMMABLE_GMGN_DISCOVERY_SCHEMA_VERSION ||
    value.source !== "gmgn" ||
    value.chainId !== "1" ||
    value.providerChain !== "eth" ||
    (value.kind !== "trending" && value.kind !== "hot-search") ||
    !isDiscoveryInterval(value.interval) ||
    !validRankingIntent(
      value.kind,
      value.orderBy,
      value.direction,
    ) ||
    !validLimit(value.kind, value.requestedLimit) ||
    !exactIsoTime(value.fetchedAt) ||
    !nullableBoundedString(value.providerVersion, MAXIMUM_PROVIDER_VERSION_LENGTH) ||
    !unsignedSafeInteger(value.providerItemCount) ||
    !unsignedSafeInteger(value.discardedProviderItemCount) ||
    !unsignedSafeInteger(value.duplicateProviderItemCount) ||
    !Array.isArray(value.tokens) ||
    value.tokens.length > Number(value.requestedLimit) ||
    value.tokens.some((token) => !isGmgnDiscoveryTokenV1(token)) ||
    Number(value.providerItemCount) !== value.tokens.length +
      Number(value.discardedProviderItemCount) +
      Number(value.duplicateProviderItemCount)
  ) return false;
  const tokens = value.tokens as readonly GmgnDiscoveryTokenV1[];
  if (new Set(tokens.map((token) => token.tokenAddress)).size !== tokens.length) {
    return false;
  }
  return tokens.every((token, index) =>
    index === 0 || tokens[index - 1]!.rank <= token.rank
  );
}

function extractTrendingItems(
  value: unknown,
  requestedLimit: number,
): Readonly<{
  items: readonly unknown[];
  providerVersion: null;
  providerItemCount: number;
  foreignItemCount: 0;
}> | null {
  if (!isRecord(value) || !Array.isArray(value.rank)) return null;
  if (value.rank.length > requestedLimit) return null;
  return {
    items: value.rank,
    providerVersion: null,
    providerItemCount: value.rank.length,
    foreignItemCount: 0,
  };
}

function extractHotSearchItems(
  value: unknown,
  interval: GmgnDiscoveryIntervalV1,
  requestedLimit: number,
): Readonly<{
  items: readonly unknown[];
  providerVersion: string | null;
  providerItemCount: number;
  foreignItemCount: number;
}> | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  let exactBlock: Record<string, unknown> | null = null;
  let providerItemCount = 0;
  let foreignItemCount = 0;
  for (const block of value) {
    if (!isRecord(block) || !Array.isArray(block.tokens)) return null;
    providerItemCount += block.tokens.length;
    if (providerItemCount > MAXIMUM_PROVIDER_ITEMS) return null;
    if (block.chain === "eth" && block.interval === interval) {
      if (exactBlock !== null || block.tokens.length > requestedLimit) return null;
      exactBlock = block;
    } else {
      foreignItemCount += block.tokens.length;
    }
  }
  if (exactBlock === null || !Array.isArray(exactBlock.tokens)) return null;
  return {
    items: exactBlock.tokens,
    providerVersion: boundedString(
      exactBlock.version,
      MAXIMUM_PROVIDER_VERSION_LENGTH,
    ),
    providerItemCount,
    foreignItemCount,
  };
}

function parseDiscoveryToken(value: unknown): GmgnDiscoveryTokenV1 | null {
  if (!isRecord(value) || value.chain !== "eth") return null;
  const tokenAddress = canonicalAddress(value.address);
  const rank = positiveSafeInteger(value.rank);
  if (tokenAddress === null || rank === null) return null;
  return {
    chain: "eth",
    tokenAddress,
    rank,
    visitingCount: optionalUnsignedSafeInteger(value.visiting_count),
    hotLevel: optionalNonNegativeNumber(value.hot_level),
    swaps: optionalUnsignedSafeInteger(value.swaps),
    buys: optionalUnsignedSafeInteger(value.buys),
    sells: optionalUnsignedSafeInteger(value.sells),
    holderCount: optionalUnsignedSafeInteger(value.holder_count),
    priceUsd: optionalNonNegativeNumber(value.price),
    marketCapUsd: optionalNonNegativeNumber(value.market_cap),
    liquidityUsd: optionalNonNegativeNumber(value.liquidity),
    volumeUsd: optionalNonNegativeNumber(value.volume),
  };
}

function isGmgnDiscoveryTokenV1(value: unknown): value is GmgnDiscoveryTokenV1 {
  if (!isRecord(value)) return false;
  return value.chain === "eth" &&
    canonicalAddress(value.tokenAddress) !== null &&
    positiveSafeInteger(value.rank) !== null &&
    nullableUnsignedSafeInteger(value.visitingCount) &&
    nullableNonNegativeNumber(value.hotLevel) &&
    nullableUnsignedSafeInteger(value.swaps) &&
    nullableUnsignedSafeInteger(value.buys) &&
    nullableUnsignedSafeInteger(value.sells) &&
    nullableUnsignedSafeInteger(value.holderCount) &&
    nullableNonNegativeNumber(value.priceUsd) &&
    nullableNonNegativeNumber(value.marketCapUsd) &&
    nullableNonNegativeNumber(value.liquidityUsd) &&
    nullableNonNegativeNumber(value.volumeUsd);
}

function isGmgnSearchTokenV1(value: unknown): value is GmgnSearchTokenV1 {
  return isRecord(value) &&
    value.chain === "eth" &&
    canonicalAddress(value.tokenAddress) === value.tokenAddress &&
    positiveSafeInteger(value.rank) !== null;
}

function unwrapSuccessfulData(value: unknown): unknown | null {
  let current = value;
  for (let depth = 0; depth < 2; depth += 1) {
    if (!hasExactOptionalEthereumChain(current)) return null;
    if (!isRecord(current) || current.code === undefined) break;
    if ((current.code !== 0 && current.code !== "0") || current.data === undefined) {
      return null;
    }
    current = current.data;
  }
  return hasExactOptionalEthereumChain(current) ? current : null;
}

function hasExactOptionalEthereumChain(value: unknown): boolean {
  return !isRecord(value) ||
    !Object.prototype.hasOwnProperty.call(value, "chain") ||
    value.chain === "eth";
}

function validParseInput(input: ParseGmgnDiscoverySnapshotInputV1): boolean {
  return (input.kind === "trending" || input.kind === "hot-search") &&
    isDiscoveryInterval(input.interval) &&
    validRankingIntent(
      input.kind,
      input.orderBy ?? null,
      input.direction ?? null,
    ) &&
    validLimit(input.kind, input.limit) &&
    Number.isFinite(input.fetchedAt.getTime());
}

function validRankingIntent(
  kind: unknown,
  orderBy: unknown,
  direction: unknown,
): boolean {
  if (kind === "hot-search") return orderBy === null && direction === null;
  if (kind !== "trending") return false;
  return (orderBy === null && direction === null) ||
    (orderBy === "marketcap" &&
      (direction === "asc" || direction === "desc"));
}

function validLimit(kind: unknown, value: unknown): boolean {
  const maximum = kind === "trending"
    ? GMGN_TRENDING_MAXIMUM_LIMIT
    : kind === "hot-search"
      ? GMGN_HOT_SEARCH_MAXIMUM_LIMIT
      : 0;
  return Number.isSafeInteger(value) && Number(value) >= 1 &&
    Number(value) <= maximum;
}

function isDiscoveryInterval(value: unknown): value is GmgnDiscoveryIntervalV1 {
  return GMGN_DISCOVERY_INTERVALS.includes(value as GmgnDiscoveryIntervalV1);
}

function canonicalAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return ADDRESS.test(normalized) ? normalized as `0x${string}` : null;
}

function positiveSafeInteger(value: unknown): number | null {
  const parsed = providerNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function optionalUnsignedSafeInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = providerNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : null;
}

function optionalNonNegativeNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = providerNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function providerNumber(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function unsignedSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nullableUnsignedSafeInteger(value: unknown): boolean {
  return value === null || unsignedSafeInteger(value);
}

function nullableNonNegativeNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" &&
    Number.isFinite(value) && value >= 0);
}

function boundedString(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" && value.length > 0 &&
      value.length <= maximumLength
    ? value
    : null;
}

function nullableBoundedString(value: unknown, maximumLength: number): boolean {
  return value === null || boundedString(value, maximumLength) !== null;
}

function exactIsoTime(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
