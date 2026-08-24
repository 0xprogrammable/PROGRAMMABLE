import {
  normalizePredictionTokenProfileV2,
  type PredictionTokenProfileV2,
} from "./token-profile-v2";
import {
  isCanonicalPredictionAssetLogoCapabilityV2,
  type PredictionAssetLogoProxyV2,
} from "./asset-logo-v2";

export const PREDICTION_ASSET_AUTO_DISCOVERY_IDENTITY_SOURCE_V2 =
  "onchain-rpc" as const;
export const PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2 =
  "dexscreener" as const;
/** @deprecated Use the enrichment source constant for new code. */
export const PREDICTION_ASSET_AUTO_DISCOVERY_SOURCE_V2 =
  PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2;
export const PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2 =
  "informational-only" as const;

export type PredictionAssetAutoDiscoveryNetworkV2 =
  | "ethereum"
  | "base"
  | "bnb"
  | "robinhood"
  | "solana";

export type PredictionAssetAutoDiscoveryFailureReasonV2 =
  | "aborted"
  | "timeout"
  | "rate-limited"
  | "provider-unavailable"
  | "response-too-large"
  | "response-invalid"
  | "identity-unconfigured"
  | "identity-unavailable"
  | "identity-invalid"
  | "identity-mismatch"
  | "market-data-missing";

export type PredictionAssetAutoDiscoveryClientPairV2 = Readonly<{
  dexId: string;
  pairAddress: string;
  matchedSide: "base" | "quote";
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  pairCreatedAt: number | null;
}>;

export type PredictionAssetAutoDiscoveryClientCandidateV2 = Readonly<{
  selectionKey: string;
  selection: Readonly<{
    mode: "custom";
    sourceNetwork: PredictionAssetAutoDiscoveryNetworkV2;
    assetLocator: string;
  }>;
  namespace: "evm" | "solana";
  chainReference: string;
  providerChainId: string;
  provenance: Readonly<{
    identity: Readonly<{
      source: typeof PREDICTION_ASSET_AUTO_DISCOVERY_IDENTITY_SOURCE_V2;
    }>;
    enrichment: Readonly<{
      source: typeof PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2;
    }> | null;
  }>;
  currentPriceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  matchingPairCount: number;
  pair: PredictionAssetAutoDiscoveryClientPairV2 | null;
  /** Server-issued display transport. Never persisted as canonical artwork. */
  logoProxy: PredictionAssetLogoProxyV2 | null;
  /** Verified identity plus optional display-only provider enrichment. */
  profile: PredictionTokenProfileV2;
}>;

export type PredictionAssetAutoDiscoveryClientFailureV2 = Readonly<{
  sourceNetwork: PredictionAssetAutoDiscoveryNetworkV2;
  reason: PredictionAssetAutoDiscoveryFailureReasonV2;
}>;

type PredictionAssetAutoDiscoveryClientBaseV2 = Readonly<{
  schemaVersion: 2;
  locator: string | null;
  /** Successful optional market-data enrichment, never identity authority. */
  source: typeof PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2 | null;
  observedAt: string;
  usage: typeof PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2;
}>;

export type PredictionAssetAutoDiscoveryClientResultV2 =
  | (PredictionAssetAutoDiscoveryClientBaseV2 & Readonly<{
    status: "unique";
    locator: string;
    candidate: PredictionAssetAutoDiscoveryClientCandidateV2;
  }>)
  | (PredictionAssetAutoDiscoveryClientBaseV2 & Readonly<{
    status: "ambiguous";
    locator: string;
    candidates: readonly PredictionAssetAutoDiscoveryClientCandidateV2[];
  }>)
  | (PredictionAssetAutoDiscoveryClientBaseV2 & Readonly<{
    status: "inconclusive";
    locator: string;
    candidates: readonly PredictionAssetAutoDiscoveryClientCandidateV2[];
    failures: readonly PredictionAssetAutoDiscoveryClientFailureV2[];
  }>)
  | (PredictionAssetAutoDiscoveryClientBaseV2 & Readonly<{
    status: "not-found";
    locator: string;
  }>)
  | (PredictionAssetAutoDiscoveryClientBaseV2 & Readonly<{
    status: "invalid";
    locator: null;
    reason: "invalid-locator";
  }>);

type NamespaceV2 = "evm" | "solana";

type NetworkBindingV2 = Readonly<{
  sourceNetwork: PredictionAssetAutoDiscoveryNetworkV2;
  namespace: NamespaceV2;
  chainReference: string;
  providerChainId: string;
}>;

const NETWORK_BINDINGS_V2 = Object.freeze([
  Object.freeze({
    sourceNetwork: "ethereum",
    namespace: "evm",
    chainReference: "1",
    providerChainId: "ethereum",
  }),
  Object.freeze({
    sourceNetwork: "base",
    namespace: "evm",
    chainReference: "8453",
    providerChainId: "base",
  }),
  Object.freeze({
    sourceNetwork: "bnb",
    namespace: "evm",
    chainReference: "56",
    providerChainId: "bsc",
  }),
  Object.freeze({
    sourceNetwork: "robinhood",
    namespace: "evm",
    chainReference: "4663",
    providerChainId: "robinhood",
  }),
  Object.freeze({
    sourceNetwork: "solana",
    namespace: "solana",
    chainReference: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    providerChainId: "solana",
  }),
] as const satisfies readonly NetworkBindingV2[]);

const FAILURE_REASONS_V2 = new Set<PredictionAssetAutoDiscoveryFailureReasonV2>([
  "aborted",
  "timeout",
  "rate-limited",
  "provider-unavailable",
  "response-too-large",
  "response-invalid",
  "identity-unconfigured",
  "identity-unavailable",
  "identity-invalid",
  "identity-mismatch",
  "market-data-missing",
]);
const EVM_ADDRESS_V2 = /^0x[0-9a-f]{40}$/u;
const ZERO_EVM_ADDRESS_V2 = `0x${"0".repeat(40)}`;
const BASE58_ALPHABET_V2 =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX_V2 = new Map(
  [...BASE58_ALPHABET_V2].map((character, index) => [character, index] as const),
);
const DEX_ID_V2 = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAX_CANDIDATES_V2 = 4;
const MAX_FAILURES_V2 = 4;
const MAX_LINKS_PER_KIND_V2 = 8;
const MAX_MATCHING_PAIRS_V2 = 256;
const MAX_URL_LENGTH_V2 = 2_048;
const MAX_USD_VALUE_V2 = 1e18;

const BASE_KEYS_V2 = Object.freeze([
  "schemaVersion",
  "locator",
  "source",
  "observedAt",
  "usage",
  "status",
] as const);

/** Stable UI identity; it is not the protocol AssetRegistry key. */
export function predictionAutoDiscoveryCandidateKeyV2(
  candidate: PredictionAssetAutoDiscoveryClientCandidateV2,
) {
  return `${candidate.profile.chain.id}:${candidate.profile.address}`;
}

/**
 * Parse the public discovery response into a client-safe, display-only DTO.
 * Unknown, conflicting or widened response shapes fail closed.
 */
export function parsePredictionAssetAutoDiscoveryV2(
  value: unknown,
  expectedLocator: string,
): PredictionAssetAutoDiscoveryClientResultV2 | null {
  try {
    return parseResult(value, normalizeExpectedLocator(expectedLocator));
  } catch {
    return null;
  }
}

function parseResult(
  value: unknown,
  expectedLocator: string | null,
): PredictionAssetAutoDiscoveryClientResultV2 | null {
  const record = exactRecord(value, BASE_KEYS_V2, [
    "candidate",
    "candidates",
    "failures",
    "reason",
  ]);
  if (
    !record ||
    record.schemaVersion !== 2 ||
    record.usage !== PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2
  ) return null;
  const source = parseEnrichmentSource(record.source);
  if (source === undefined) return null;

  const observedAtMs = canonicalInstantMs(record.observedAt);
  if (observedAtMs === null) return null;
  const observedAt = record.observedAt as string;
  const status = record.status;
  const shared = Object.freeze({
    schemaVersion: 2 as const,
    source,
    observedAt,
    usage: PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2,
  });

  if (status === "invalid") {
    if (
      expectedLocator !== null ||
      !hasExactKeys(record, [...BASE_KEYS_V2, "reason"]) ||
      record.locator !== null ||
      record.reason !== "invalid-locator" ||
      source !== null
    ) return null;
    return Object.freeze({
      ...shared,
      locator: null,
      status: "invalid" as const,
      reason: "invalid-locator" as const,
    });
  }

  const normalizedLocator = canonicalLocator(record.locator);
  if (
    expectedLocator === null ||
    normalizedLocator === null ||
    normalizedLocator !== record.locator ||
    normalizedLocator !== expectedLocator
  ) {
    return null;
  }

  if (status === "not-found") {
    if (!hasExactKeys(record, BASE_KEYS_V2) || source !== null) return null;
    return Object.freeze({
      ...shared,
      locator: normalizedLocator,
      status: "not-found" as const,
    });
  }

  if (status === "unique") {
    if (!hasExactKeys(record, [...BASE_KEYS_V2, "candidate"])) return null;
    const candidate = parseCandidate(
      record.candidate,
      normalizedLocator,
      observedAtMs,
    );
    if (
      candidate === null ||
      source !== enrichmentSourceForCandidates([candidate])
    ) return null;
    return Object.freeze({
      ...shared,
      locator: normalizedLocator,
      status: "unique" as const,
      candidate,
    });
  }

  if (status === "ambiguous") {
    if (!hasExactKeys(record, [...BASE_KEYS_V2, "candidates"])) return null;
    const candidates = parseCandidates(
      record.candidates,
      normalizedLocator,
      observedAtMs,
      2,
    );
    if (
      candidates === null ||
      locatorNamespace(normalizedLocator) !== "evm" ||
      source !== enrichmentSourceForCandidates(candidates)
    ) {
      return null;
    }
    return Object.freeze({
      ...shared,
      locator: normalizedLocator,
      status: "ambiguous" as const,
      candidates,
    });
  }

  if (status === "inconclusive") {
    if (
      !hasExactKeys(record, [...BASE_KEYS_V2, "candidates", "failures"])
    ) return null;
    const candidates = parseCandidates(
      record.candidates,
      normalizedLocator,
      observedAtMs,
      0,
    );
    const failures = parseFailures(record.failures, normalizedLocator);
    if (
      candidates === null ||
      failures === null ||
      source !== enrichmentSourceForCandidates(candidates)
    ) return null;
    const occupiedNetworks = new Set(
      candidates.map(({ selection }) => selection.sourceNetwork),
    );
    if (failures.some(({ sourceNetwork }) => occupiedNetworks.has(sourceNetwork))) {
      return null;
    }
    return Object.freeze({
      ...shared,
      locator: normalizedLocator,
      status: "inconclusive" as const,
      candidates,
      failures,
    });
  }

  return null;
}

function parseCandidates(
  value: unknown,
  locator: string,
  observedAtMs: number,
  minimumLength: 0 | 2,
): readonly PredictionAssetAutoDiscoveryClientCandidateV2[] | null {
  if (
    !Array.isArray(value) ||
    value.length < minimumLength ||
    value.length > maximumOutcomes(locator, MAX_CANDIDATES_V2)
  ) return null;

  const candidates: PredictionAssetAutoDiscoveryClientCandidateV2[] = [];
  const keys = new Set<string>();
  const networks = new Set<PredictionAssetAutoDiscoveryNetworkV2>();
  for (const rawCandidate of value) {
    const candidate = parseCandidate(rawCandidate, locator, observedAtMs);
    if (candidate === null) return null;
    const key = predictionAutoDiscoveryCandidateKeyV2(candidate);
    if (
      keys.has(key) ||
      networks.has(candidate.selection.sourceNetwork)
    ) return null;
    keys.add(key);
    networks.add(candidate.selection.sourceNetwork);
    candidates.push(candidate);
  }
  return Object.freeze(candidates);
}

function parseCandidate(
  value: unknown,
  locator: string,
  observedAtMs: number,
): PredictionAssetAutoDiscoveryClientCandidateV2 | null {
  const candidate = exactRecord(value, [
    "selectionKey",
    "selection",
    "namespace",
    "chainReference",
    "providerChainId",
    "provenance",
    "token",
    "currentPriceUsd",
    "marketCapUsd",
    "fdvUsd",
    "matchingPairCount",
    "pair",
    "links",
  ], ["logoProxy"]);
  if (!candidate) return null;

  const selection = exactRecord(candidate.selection, [
    "mode",
    "sourceNetwork",
    "assetLocator",
  ]);
  if (
    !selection ||
    selection.mode !== "custom" ||
    typeof selection.sourceNetwork !== "string"
  ) return null;
  const binding = networkBinding(selection.sourceNetwork);
  if (!binding) return null;
  if (
    candidate.namespace !== binding.namespace ||
    candidate.chainReference !== binding.chainReference ||
    candidate.providerChainId !== binding.providerChainId ||
    selection.assetLocator !== locator ||
    locatorNamespace(locator) !== binding.namespace
  ) return null;

  const expectedSelectionKey =
    `${binding.namespace}:${binding.chainReference}:${locator}`;
  if (candidate.selectionKey !== expectedSelectionKey) return null;

  const provenance = parseProvenance(candidate.provenance);
  if (provenance === null) return null;

  const token = exactRecord(candidate.token, ["address", "name", "symbol"]);
  if (
    !token ||
    token.address !== locator ||
    !nullableBoundedString(token.name, 128) ||
    !nullableBoundedString(token.symbol, 32)
  ) return null;

  const currentPriceUsd = nullableUsd(candidate.currentPriceUsd, false);
  const marketCapUsd = nullableUsd(candidate.marketCapUsd, true);
  const fdvUsd = nullableUsd(candidate.fdvUsd, true);
  if (
    currentPriceUsd === undefined ||
    marketCapUsd === undefined ||
    fdvUsd === undefined ||
    !Number.isSafeInteger(candidate.matchingPairCount) ||
    (candidate.matchingPairCount as number) < 0 ||
    (candidate.matchingPairCount as number) > MAX_MATCHING_PAIRS_V2
  ) return null;

  const pair = candidate.pair === null ? null : parsePair(candidate.pair, binding);
  const links = parseLinks(candidate.links);
  if (candidate.pair !== null && pair === null || links === null) return null;
  if ((pair === null) !== (provenance.enrichment === null)) return null;
  if (pair === null) {
    if (
      candidate.matchingPairCount !== 0 ||
      token.name !== null ||
      token.symbol !== null ||
      currentPriceUsd !== null ||
      marketCapUsd !== null ||
      fdvUsd !== null ||
      !linksAreEmpty(links)
    ) return null;
  } else if (candidate.matchingPairCount === 0) {
    return null;
  }
  if (
    pair?.matchedSide === "quote" &&
    (marketCapUsd !== null || fdvUsd !== null)
  ) return null;

  const profile = normalizePredictionTokenProfileV2({
    chain: binding.sourceNetwork,
    address: token.address,
    name: token.name,
    symbol: token.symbol,
    websites: links.websites,
    socials: links.socials,
    priceUsd: currentPriceUsd,
    marketCapUsd,
    fdvUsd,
    liquidityUsd: pair?.liquidityUsd,
    pairCreatedAtMs: pair?.pairCreatedAt,
  }, observedAtMs);
  if (
    profile === null ||
    profile.chain.id !== binding.sourceNetwork ||
    profile.address !== locator
  ) return null;
  const logoProxy = provenance.enrichment !== null &&
      Object.hasOwn(candidate, "logoProxy")
    ? parseLogoProxy(candidate.logoProxy)
    : null;

  return Object.freeze({
    selectionKey: expectedSelectionKey,
    selection: Object.freeze({
      mode: "custom" as const,
      sourceNetwork: binding.sourceNetwork,
      assetLocator: locator,
    }),
    namespace: binding.namespace,
    chainReference: binding.chainReference,
    providerChainId: binding.providerChainId,
    provenance,
    currentPriceUsd,
    marketCapUsd,
    fdvUsd,
    matchingPairCount: candidate.matchingPairCount as number,
    pair,
    logoProxy,
    profile,
  });
}

function parseLogoProxy(
  value: unknown,
): PredictionAssetLogoProxyV2 | null {
  if (value === null) return null;
  const proxy = exactRecord(value, ["assetId", "capability"]);
  if (
    !proxy ||
    typeof proxy.assetId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(proxy.assetId) ||
    !isCanonicalPredictionAssetLogoCapabilityV2(proxy.capability)
  ) return null;
  return Object.freeze({
    assetId: proxy.assetId,
    capability: proxy.capability,
  });
}

function parseProvenance(
  value: unknown,
): PredictionAssetAutoDiscoveryClientCandidateV2["provenance"] | null {
  const provenance = exactRecord(value, ["identity", "enrichment"]);
  const identity = exactRecord(provenance?.identity, ["source"]);
  if (
    !provenance ||
    !identity ||
    identity.source !== PREDICTION_ASSET_AUTO_DISCOVERY_IDENTITY_SOURCE_V2
  ) return null;

  let enrichment: Readonly<{
    source: typeof PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2;
  }> | null = null;
  if (provenance.enrichment !== null) {
    const candidate = exactRecord(provenance.enrichment, ["source"]);
    if (
      !candidate ||
      candidate.source !== PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2
    ) return null;
    enrichment = Object.freeze({
      source: PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2,
    });
  }

  return Object.freeze({
    identity: Object.freeze({
      source: PREDICTION_ASSET_AUTO_DISCOVERY_IDENTITY_SOURCE_V2,
    }),
    enrichment,
  });
}

function enrichmentSourceForCandidates(
  candidates: readonly PredictionAssetAutoDiscoveryClientCandidateV2[],
) {
  return candidates.some(({ provenance }) => provenance.enrichment !== null)
    ? PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2
    : null;
}

function parseEnrichmentSource(value: unknown) {
  if (value === null) return null;
  return value === PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2
    ? PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2
    : undefined;
}

function parsePair(
  value: unknown,
  binding: NetworkBindingV2,
): PredictionAssetAutoDiscoveryClientPairV2 | null {
  const pair = exactRecord(value, [
    "dexId",
    "pairAddress",
    "matchedSide",
    "liquidityUsd",
    "volume24hUsd",
    "pairCreatedAt",
  ]);
  if (
    !pair ||
    typeof pair.dexId !== "string" ||
    !DEX_ID_V2.test(pair.dexId) ||
    pair.matchedSide !== "base" && pair.matchedSide !== "quote"
  ) return null;
  const pairAddress = canonicalLocator(pair.pairAddress);
  if (
    pairAddress === null ||
    pairAddress !== pair.pairAddress ||
    locatorNamespace(pairAddress) !== binding.namespace
  ) return null;
  const liquidityUsd = nullableUsd(pair.liquidityUsd, true);
  const volume24hUsd = nullableUsd(pair.volume24hUsd, true);
  const pairCreatedAt = nullableTimestampMs(pair.pairCreatedAt);
  if (
    liquidityUsd === undefined ||
    volume24hUsd === undefined ||
    pairCreatedAt === undefined
  ) return null;

  return Object.freeze({
    dexId: pair.dexId,
    pairAddress,
    matchedSide: pair.matchedSide,
    liquidityUsd,
    volume24hUsd,
    pairCreatedAt,
  });
}

type ParsedLinksV2 = Readonly<{
  websites: readonly Readonly<{ label: string | null; url: string }>[];
  socials: readonly Readonly<{ type: string | null; url: string }>[];
}>;

function parseLinks(value: unknown): ParsedLinksV2 | null {
  const links = exactRecord(value, ["websites", "socials"]);
  if (!links) return null;
  const websites = parseLinkRows(links.websites, "label");
  const socials = parseLinkRows(links.socials, "type");
  if (websites === null || socials === null) return null;
  return Object.freeze({
    websites,
    socials,
  });
}

function linksAreEmpty(links: ParsedLinksV2) {
  return links.websites.length === 0 &&
    links.socials.length === 0;
}

function parseLinkRows<Key extends "label" | "type">(
  value: unknown,
  descriptorKey: Key,
): readonly Readonly<{ url: string } & Record<Key, string | null>>[] | null {
  if (!Array.isArray(value) || value.length > MAX_LINKS_PER_KIND_V2) return null;
  const rows: Readonly<{ url: string } & Record<Key, string | null>>[] = [];
  const urls = new Set<string>();
  for (const rawRow of value) {
    const row = exactRecord(rawRow, [descriptorKey, "url"]);
    if (
      !row ||
      !nullableBoundedString(row[descriptorKey], 64) ||
      typeof row.url !== "string" ||
      row.url.length === 0 ||
      row.url.length > MAX_URL_LENGTH_V2 ||
      new TextEncoder().encode(row.url).length > MAX_URL_LENGTH_V2 ||
      urls.has(row.url)
    ) return null;
    urls.add(row.url);
    rows.push(Object.freeze({
      [descriptorKey]: row[descriptorKey] as string | null,
      url: row.url,
    }) as Readonly<{ url: string } & Record<Key, string | null>>);
  }
  return Object.freeze(rows);
}

function parseFailures(
  value: unknown,
  locator: string,
): readonly PredictionAssetAutoDiscoveryClientFailureV2[] | null {
  const maximum = maximumOutcomes(locator, MAX_FAILURES_V2);
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    return null;
  }
  const namespace = locatorNamespace(locator);
  const networks = new Set<PredictionAssetAutoDiscoveryNetworkV2>();
  const failures: PredictionAssetAutoDiscoveryClientFailureV2[] = [];
  for (const rawFailure of value) {
    const failure = exactRecord(rawFailure, ["sourceNetwork", "reason"]);
    if (
      !failure ||
      typeof failure.sourceNetwork !== "string" ||
      typeof failure.reason !== "string" ||
      !FAILURE_REASONS_V2.has(
        failure.reason as PredictionAssetAutoDiscoveryFailureReasonV2,
      )
    ) return null;
    const binding = networkBinding(failure.sourceNetwork);
    if (
      !binding ||
      binding.namespace !== namespace ||
      networks.has(binding.sourceNetwork)
    ) return null;
    networks.add(binding.sourceNetwork);
    failures.push(Object.freeze({
      sourceNetwork: binding.sourceNetwork,
      reason: failure.reason as PredictionAssetAutoDiscoveryFailureReasonV2,
    }));
  }
  return Object.freeze(failures);
}

function maximumOutcomes(locator: string, limit: number) {
  return locatorNamespace(locator) === "evm" ? limit : 1;
}

function networkBinding(value: string): NetworkBindingV2 | null {
  return NETWORK_BINDINGS_V2.find(({ sourceNetwork }) => sourceNetwork === value)
    ?? null;
}

function canonicalLocator(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (EVM_ADDRESS_V2.test(value) && value !== ZERO_EVM_ADDRESS_V2) return value;
  return isCanonicalSolanaAddress(value) ? value : null;
}

function normalizeExpectedLocator(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const normalizedEvm = trimmed.toLowerCase();
  if (
    EVM_ADDRESS_V2.test(normalizedEvm) &&
    normalizedEvm !== ZERO_EVM_ADDRESS_V2
  ) return normalizedEvm;
  return isCanonicalSolanaAddress(trimmed) ? trimmed : null;
}

function locatorNamespace(value: string): NamespaceV2 {
  return value.startsWith("0x") ? "evm" : "solana";
}

function isCanonicalSolanaAddress(value: string) {
  if (value.length < 32 || value.length > 44) return false;
  const littleEndian = [0];
  for (const character of value) {
    const alphabetIndex = BASE58_INDEX_V2.get(character);
    if (alphabetIndex === undefined) return false;
    let carry = alphabetIndex;
    for (let index = 0; index < littleEndian.length; index += 1) {
      carry += littleEndian[index]! * 58;
      littleEndian[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      littleEndian.push(carry & 0xff);
      carry >>= 8;
    }
    if (littleEndian.length > 32) return false;
  }
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === "1") {
    leadingZeroes += 1;
  }
  const significantBytes = littleEndian.length === 1 && littleEndian[0] === 0
    ? 0
    : littleEndian.length;
  return significantBytes + leadingZeroes === 32 && significantBytes > 0;
}

function canonicalInstantMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 &&
      new Date(parsed).toISOString() === value
    ? parsed
    : null;
}

function nullableUsd(
  value: unknown,
  allowZero: boolean,
): number | null | undefined {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value > MAX_USD_VALUE_V2 ||
    (allowZero ? value < 0 : value <= 0)
  ) return undefined;
  return value;
}

function nullableTimestampMs(value: unknown): number | null | undefined {
  if (value === null) return null;
  return Number.isSafeInteger(value) && (value as number) >= 0 &&
      Number.isFinite(new Date(value as number).getTime())
    ? value as number
    : undefined;
}

function nullableBoundedString(value: unknown, maximumLength: number) {
  return value === null || (
    typeof value === "string" &&
    value.length <= maximumLength &&
    new TextEncoder().encode(value).length <= maximumLength * 4
  );
}

function exactRecord(
  value: unknown,
  requiredKeys: readonly string[],
  allowedAdditionalKeys: readonly string[] = [],
): Record<string, unknown> | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return null;
  const record = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.some((key) => typeof key !== "string")) return null;
  const allowed = new Set([...requiredKeys, ...allowedAdditionalKeys]);
  if (
    requiredKeys.some((key) => !Object.hasOwn(record, key)) ||
    ownKeys.some((key) => !allowed.has(key as string))
  ) return null;
  return record;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
) {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key));
}
