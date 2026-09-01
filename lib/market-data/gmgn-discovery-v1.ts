// Provider contract: GMGNAI/gmgn-skills@267ff6ba86aaeb5d4a4f23409b3cfef7ef32ff62.
// This projection deliberately keeps only identity and numeric ranking signals.
// Programmable's canonical launch catalog remains the authority for token names,
// metadata, launch identity, and visibility.

export const PROGRAMMABLE_GMGN_DISCOVERY_SCHEMA_VERSION =
  "programmable.gmgn-discovery.v1" as const;

export const GMGN_DISCOVERY_INTERVALS = [
  "1m",
  "5m",
  "1h",
  "6h",
  "24h",
] as const;

export const GMGN_TRENDING_MAXIMUM_LIMIT = 100 as const;
export const GMGN_HOT_SEARCH_MAXIMUM_LIMIT = 500 as const;

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
  limit: number;
  fetchedAt: Date;
}>;

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const MAXIMUM_PROVIDER_ITEMS = 1_000;
const MAXIMUM_PROVIDER_VERSION_LENGTH = 256;

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
    validLimit(input.kind, input.limit) &&
    Number.isFinite(input.fetchedAt.getTime());
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
