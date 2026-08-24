import "server-only";

import {
  createPredictionAssetIdentityVerifierV2,
  type PredictionAssetIdentityFailureReasonV2,
  type PredictionAssetIdentityProbeV2,
  type PredictionAssetIdentityVerifierV2,
} from "./prediction-asset-identity-verification-v2.server";

const DEXSCREENER_TOKEN_PAIRS_ENDPOINT =
  "https://api.dexscreener.com/token-pairs/v1" as const;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 512_000;
const DEFAULT_MAXIMUM_ROWS = 256;
const MAXIMUM_LINK_ROWS = 32;
const MAXIMUM_RETURNED_LINKS = 8;
const ZERO_EVM_ADDRESS = `0x${"0".repeat(40)}`;
const UNSAFE_DISPLAY_TEXT_PATTERN =
  /[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const IDENTITY_FAILURE_REASONS = new Set([
  "identity-unconfigured",
  "identity-unavailable",
  "identity-invalid",
] as const satisfies readonly PredictionAssetIdentityFailureReasonV2[]);
const PRIVATE_HOST_SUFFIXES = Object.freeze([
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".arpa",
  ".test",
  ".invalid",
  ".example",
]);

export const PREDICTION_ASSET_AUTO_DISCOVERY_IDENTITY_SOURCE_V2 =
  "onchain-rpc" as const;
export const PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2 =
  "dexscreener" as const;
/** @deprecated Use the enrichment source constant for new code. */
export const PREDICTION_ASSET_AUTO_DISCOVERY_SOURCE_V2 =
  PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2;
export const PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2 =
  "informational-only" as const;

export type PredictionAssetAutoDiscoverySourceNetworkV2 =
  | "ethereum"
  | "base"
  | "bnb"
  | "robinhood"
  | "solana";

export type PredictionAssetAutoDiscoveryProbeFailureReasonV2 =
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

export type PredictionAssetAutoDiscoveryCandidateV2 = Readonly<{
  selectionKey: string;
  selection: Readonly<{
    mode: "custom";
    sourceNetwork: PredictionAssetAutoDiscoverySourceNetworkV2;
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
  token: Readonly<{
    address: string;
    name: string | null;
    symbol: string | null;
  }>;
  currentPriceUsd: number | null;
  /** Provider-reported display data. It is not circulating-supply evidence. */
  marketCapUsd: number | null;
  fdvUsd: number | null;
  matchingPairCount: number;
  pair: Readonly<{
    dexId: string;
    pairAddress: string;
    matchedSide: "base" | "quote";
    liquidityUsd: number | null;
    volume24hUsd: number | null;
    pairCreatedAt: number | null;
  }> | null;
  links: Readonly<{
    imageUrl: string | null;
    websites: readonly Readonly<{
      label: string | null;
      url: string;
    }>[];
    socials: readonly Readonly<{
      type: string | null;
      url: string;
    }>[];
  }>;
}>;

type PredictionAssetAutoDiscoveryResultBaseV2 = Readonly<{
  schemaVersion: 2;
  locator: string | null;
  /** Successful optional market-data enrichment, never identity authority. */
  source: typeof PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2 | null;
  observedAt: string;
  usage: typeof PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2;
}>;

export type PredictionAssetAutoDiscoveryUniqueV2 =
  PredictionAssetAutoDiscoveryResultBaseV2 & Readonly<{
    status: "unique";
    candidate: PredictionAssetAutoDiscoveryCandidateV2;
  }>;

export type PredictionAssetAutoDiscoveryAmbiguousV2 =
  PredictionAssetAutoDiscoveryResultBaseV2 & Readonly<{
    status: "ambiguous";
    candidates: readonly PredictionAssetAutoDiscoveryCandidateV2[];
  }>;

export type PredictionAssetAutoDiscoveryInconclusiveV2 =
  PredictionAssetAutoDiscoveryResultBaseV2 & Readonly<{
    status: "inconclusive";
    candidates: readonly PredictionAssetAutoDiscoveryCandidateV2[];
    failures: readonly Readonly<{
      sourceNetwork: PredictionAssetAutoDiscoverySourceNetworkV2;
      reason: PredictionAssetAutoDiscoveryProbeFailureReasonV2;
    }>[];
  }>;

export type PredictionAssetAutoDiscoveryNotFoundV2 =
  PredictionAssetAutoDiscoveryResultBaseV2 & Readonly<{
    status: "not-found";
  }>;

export type PredictionAssetAutoDiscoveryInvalidV2 =
  PredictionAssetAutoDiscoveryResultBaseV2 & Readonly<{
    status: "invalid";
    reason: "invalid-locator";
  }>;

export type PredictionAssetAutoDiscoveryResultV2 =
  | PredictionAssetAutoDiscoveryUniqueV2
  | PredictionAssetAutoDiscoveryAmbiguousV2
  | PredictionAssetAutoDiscoveryInconclusiveV2
  | PredictionAssetAutoDiscoveryNotFoundV2
  | PredictionAssetAutoDiscoveryInvalidV2;

export type PredictionAssetAutoDiscoveryReaderOptionsV2 = Readonly<{
  fetchImpl?: typeof fetch;
  identityVerifier?: PredictionAssetIdentityVerifierV2;
  now?: () => Date;
  timeoutMs?: number;
  maximumResponseBytes?: number;
  maximumRows?: number;
}>;

export type PredictionAssetAutoDiscoveryReadOptionsV2 = Readonly<{
  signal?: AbortSignal;
}>;

export type PredictionAssetAutoDiscoveryReaderV2 = Readonly<{
  read(
    locator: string,
    options?: PredictionAssetAutoDiscoveryReadOptionsV2,
  ): Promise<PredictionAssetAutoDiscoveryResultV2>;
}>;

type ProbeBinding = Readonly<{
  sourceNetwork: PredictionAssetAutoDiscoverySourceNetworkV2;
  namespace: "evm" | "solana";
  chainReference: string;
  providerChainId: string;
}>;

type NormalizedLocator = Readonly<{
  locator: string;
  namespace: "evm" | "solana";
}>;

type EnrichedProbeCandidate = Omit<
  PredictionAssetAutoDiscoveryCandidateV2,
  "provenance"
>;

type PairCandidate = Omit<
  EnrichedProbeCandidate,
  "matchingPairCount" | "pair"
> & Readonly<{
  pair: NonNullable<PredictionAssetAutoDiscoveryCandidateV2["pair"]>;
}>;

type ProbeOutcome =
  | Readonly<{
    status: "found";
    candidate: EnrichedProbeCandidate;
  }>
  | Readonly<{ status: "not-found" }>
  | Readonly<{
    status: "failed";
    reason: PredictionAssetAutoDiscoveryProbeFailureReasonV2;
  }>;

const EVM_PROBE_BINDINGS = Object.freeze([
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
] as const satisfies readonly ProbeBinding[]);

const SOLANA_PROBE_BINDING = Object.freeze({
  sourceNetwork: "solana",
  namespace: "solana",
  chainReference: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  providerChainId: "solana",
} as const satisfies ProbeBinding);

class PredictionAssetAutoDiscoveryReadError extends Error {
  constructor(
    readonly reason: PredictionAssetAutoDiscoveryProbeFailureReasonV2,
  ) {
    super(`Prediction asset auto-discovery failed: ${reason}`);
    this.name = "PredictionAssetAutoDiscoveryReadError";
  }
}

export function createPredictionAssetAutoDiscoveryReaderV2(
  options: PredictionAssetAutoDiscoveryReaderOptionsV2 = {},
): PredictionAssetAutoDiscoveryReaderV2 {
  const fetchImpl = options.fetchImpl ?? fetch;
  const identityVerifier = options.identityVerifier ??
    createPredictionAssetIdentityVerifierV2();
  const now = options.now ?? (() => new Date());
  const timeoutMs = boundedInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    1,
    30_000,
    "timeoutMs",
  );
  const maximumResponseBytes = boundedInteger(
    options.maximumResponseBytes,
    DEFAULT_MAXIMUM_RESPONSE_BYTES,
    2,
    2_000_000,
    "maximumResponseBytes",
  );
  const maximumRows = boundedInteger(
    options.maximumRows,
    DEFAULT_MAXIMUM_ROWS,
    1,
    1_000,
    "maximumRows",
  );

  return Object.freeze({
    async read(locator, readOptions = {}) {
      const observedAt = now().toISOString();
      const normalized = normalizePredictionAssetLocatorV2(locator);
      const base = {
        schemaVersion: 2 as const,
        locator: normalized?.locator ?? null,
        observedAt,
        usage: PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2,
      };
      if (normalized === null) {
        return {
          ...base,
          source: null,
          status: "invalid",
          reason: "invalid-locator",
        };
      }

      const bindings = normalized.namespace === "evm"
        ? EVM_PROBE_BINDINGS
        : [SOLANA_PROBE_BINDING];
      const outcomesPromise = readOptions.signal?.aborted
        ? bindings.map<ProbeOutcome>(() => ({
          status: "failed",
          reason: "aborted",
        }))
        : Promise.all(bindings.map((binding) => probeBinding({
          binding,
          locator: normalized.locator,
          fetchImpl,
          timeoutMs,
          maximumResponseBytes,
          maximumRows,
          signal: readOptions.signal,
        })));
      const identityPromise = Promise.resolve()
        .then(() => identityVerifier.verify(normalized.locator, {
          signal: readOptions.signal,
        }))
        .catch(() => bindings.map<PredictionAssetIdentityProbeV2>((binding) => ({
          sourceNetwork: binding.sourceNetwork,
          status: "failed",
          reason: "identity-unavailable",
        })));
      const [outcomes, rawIdentityProbes] = await Promise.all([
        outcomesPromise,
        identityPromise,
      ]);
      const identityProbes = normalizeIdentityProbes(bindings, rawIdentityProbes);

      const candidates: PredictionAssetAutoDiscoveryCandidateV2[] = [];
      const dexOutcomes = new Map<
        PredictionAssetAutoDiscoverySourceNetworkV2,
        ProbeOutcome
      >();
      for (let index = 0; index < outcomes.length; index += 1) {
        const outcome = outcomes[index];
        const binding = bindings[index];
        if (!outcome || !binding) continue;
        dexOutcomes.set(binding.sourceNetwork, outcome);
      }

      const failures: PredictionAssetAutoDiscoveryInconclusiveV2["failures"][number][] = [];
      for (const binding of bindings) {
        const identity = identityProbes.get(binding.sourceNetwork);
        const dex = dexOutcomes.get(binding.sourceNetwork);
        if (!identity) {
          failures.push({
            sourceNetwork: binding.sourceNetwork,
            reason: "identity-invalid",
          });
          continue;
        }
        if (identity.status === "failed") {
          failures.push({
            sourceNetwork: binding.sourceNetwork,
            reason: identity.reason,
          });
          continue;
        }
        if (identity.status === "verified-token") {
          // Token identity is established independently of DEX indexing. A
          // missing, stale or unavailable enrichment provider must never hide
          // an otherwise exact onchain identity.
          candidates.push(dex?.status === "found"
            ? verifiedEnrichedCandidate(dex.candidate)
            : identityOnlyCandidate(binding, normalized.locator));
          continue;
        }
        if (dex?.status === "found") {
          // A pool index is not proof that an address is a token on this chain.
          failures.push({
            sourceNetwork: binding.sourceNetwork,
            reason: "identity-mismatch",
          });
        }
      }

      // Identity verification, not pool-index presence, decides whether an EVM
      // address belongs to one or more supported chains. An unresolved identity
      // probe or a provider/identity conflict remains explicitly inconclusive.
      if (failures.length > 0) {
        return {
          ...base,
          source: enrichmentSourceForCandidates(candidates),
          status: "inconclusive",
          candidates,
          failures,
        };
      }
      if (candidates.length === 0) {
        return { ...base, source: null, status: "not-found" };
      }
      const source = enrichmentSourceForCandidates(candidates);
      if (candidates.length === 1) {
        return { ...base, source, status: "unique", candidate: candidates[0] };
      }
      return { ...base, source, status: "ambiguous", candidates };
    },
  });
}

function verifiedEnrichedCandidate(
  candidate: EnrichedProbeCandidate,
): PredictionAssetAutoDiscoveryCandidateV2 {
  return {
    ...candidate,
    provenance: {
      identity: {
        source: PREDICTION_ASSET_AUTO_DISCOVERY_IDENTITY_SOURCE_V2,
      },
      enrichment: {
        source: PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2,
      },
    },
  };
}

function enrichmentSourceForCandidates(
  candidates: readonly PredictionAssetAutoDiscoveryCandidateV2[],
) {
  return candidates.some(({ provenance }) => provenance.enrichment !== null)
    ? PREDICTION_ASSET_AUTO_DISCOVERY_ENRICHMENT_SOURCE_V2
    : null;
}

function identityOnlyCandidate(
  binding: ProbeBinding,
  locator: string,
): PredictionAssetAutoDiscoveryCandidateV2 {
  const canonicalLocator = canonicalIdentifier(locator, binding.namespace);
  return {
    selectionKey: binding.namespace === "evm"
      ? `evm:${binding.chainReference}:${canonicalLocator}`
      : `solana:${binding.chainReference}:${canonicalLocator}`,
    selection: {
      mode: "custom",
      sourceNetwork: binding.sourceNetwork,
      assetLocator: canonicalLocator,
    },
    namespace: binding.namespace,
    chainReference: binding.chainReference,
    providerChainId: binding.providerChainId,
    provenance: {
      identity: {
        source: PREDICTION_ASSET_AUTO_DISCOVERY_IDENTITY_SOURCE_V2,
      },
      enrichment: null,
    },
    token: {
      address: canonicalLocator,
      name: null,
      symbol: null,
    },
    currentPriceUsd: null,
    marketCapUsd: null,
    fdvUsd: null,
    matchingPairCount: 0,
    pair: null,
    links: { imageUrl: null, websites: [], socials: [] },
  };
}

function normalizeIdentityProbes(
  bindings: readonly ProbeBinding[],
  probes: unknown,
) {
  const expected = new Set(bindings.map(({ sourceNetwork }) => sourceNetwork));
  const normalized = new Map<
    PredictionAssetAutoDiscoverySourceNetworkV2,
    PredictionAssetIdentityProbeV2
  >();
  try {
    if (!Array.isArray(probes) || probes.length !== bindings.length) {
      return normalized;
    }
    for (const rawProbe of probes) {
      const values = exactPlainDataValues(rawProbe);
      if (values === null) return new Map();
      const sourceNetwork = values.get("sourceNetwork");
      const status = values.get("status");
      if (
        typeof sourceNetwork !== "string" ||
        !expected.has(sourceNetwork as PredictionAssetAutoDiscoverySourceNetworkV2) ||
        normalized.has(sourceNetwork as PredictionAssetAutoDiscoverySourceNetworkV2)
      ) {
        return new Map();
      }
      if (status === "verified-token" || status === "not-token") {
        if (!hasExactKeys(values, ["sourceNetwork", "status"])) return new Map();
        normalized.set(
          sourceNetwork as PredictionAssetAutoDiscoverySourceNetworkV2,
          {
            sourceNetwork: sourceNetwork as PredictionAssetAutoDiscoverySourceNetworkV2,
            status,
          },
        );
        continue;
      }
      const reason = values.get("reason");
      if (
        status !== "failed" ||
        !hasExactKeys(values, ["sourceNetwork", "status", "reason"]) ||
        typeof reason !== "string" ||
        !IDENTITY_FAILURE_REASONS.has(
          reason as PredictionAssetIdentityFailureReasonV2,
        )
      ) {
        return new Map();
      }
      normalized.set(
        sourceNetwork as PredictionAssetAutoDiscoverySourceNetworkV2,
        {
          sourceNetwork: sourceNetwork as PredictionAssetAutoDiscoverySourceNetworkV2,
          status: "failed",
          reason: reason as PredictionAssetIdentityFailureReasonV2,
        },
      );
    }
  } catch {
    return new Map();
  }
  if (normalized.size !== bindings.length) {
    return new Map<
      PredictionAssetAutoDiscoverySourceNetworkV2,
      PredictionAssetIdentityProbeV2
    >();
  }
  return normalized;
}

function exactPlainDataValues(value: unknown): ReadonlyMap<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return null;
  const values = new Map<string, unknown>();
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return null;
    values.set(key, descriptor.value);
  }
  return values;
}

function hasExactKeys(
  value: ReadonlyMap<string, unknown>,
  expected: readonly string[],
) {
  return value.size === expected.length &&
    expected.every((key) => value.has(key));
}

async function probeBinding(input: Readonly<{
  binding: ProbeBinding;
  locator: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maximumResponseBytes: number;
  maximumRows: number;
  signal?: AbortSignal;
}>): Promise<ProbeOutcome> {
  try {
    const payload = await requestDexscreenerPairs(input);
    const candidate = parseProbeCandidate(
      payload,
      input.binding,
      input.locator,
      input.maximumRows,
    );
    return candidate === null
      ? { status: "not-found" }
      : { status: "found", candidate };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof PredictionAssetAutoDiscoveryReadError
        ? error.reason
        : "provider-unavailable",
    };
  }
}

async function requestDexscreenerPairs(input: Readonly<{
  binding: ProbeBinding;
  locator: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maximumResponseBytes: number;
  signal?: AbortSignal;
}>): Promise<unknown> {
  if (input.signal?.aborted) {
    throw new PredictionAssetAutoDiscoveryReadError("aborted");
  }
  const controller = new AbortController();
  let rejectDeadline!: (error: PredictionAssetAutoDiscoveryReadError) => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  let deadlineSettled = false;
  const abortWith = (reason: "aborted" | "timeout") => {
    if (deadlineSettled) return;
    deadlineSettled = true;
    controller.abort();
    rejectDeadline(new PredictionAssetAutoDiscoveryReadError(reason));
  };
  const abortFromCaller = () => abortWith("aborted");
  const timer = setTimeout(() => abortWith("timeout"), input.timeoutMs);
  input.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const url = `${DEXSCREENER_TOKEN_PAIRS_ENDPOINT}/${
      encodeURIComponent(input.binding.providerChainId)
    }/${encodeURIComponent(input.locator)}`;
    const response = await Promise.race([
      input.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      }),
      deadline,
    ]);

    if (response.status === 429) {
      abortUnreadResponse(response, controller);
      throw new PredictionAssetAutoDiscoveryReadError("rate-limited");
    }
    if (!response.ok) {
      abortUnreadResponse(response, controller);
      throw new PredictionAssetAutoDiscoveryReadError("provider-unavailable");
    }
    const contentType = response.headers.get("content-type");
    if (!contentType?.toLowerCase().startsWith("application/json")) {
      abortUnreadResponse(response, controller);
      throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
    }

    const body = await readBoundedResponseBody(
      response,
      input.maximumResponseBytes,
      deadline,
      controller,
    );
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
    }
  } finally {
    deadlineSettled = true;
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
  deadline: Promise<never>,
  controller: AbortController,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength)) {
      abortUnreadResponse(response, controller);
      throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
    }
    if (BigInt(declaredLength) > BigInt(maximumBytes)) {
      abortUnreadResponse(response, controller);
      throw new PredictionAssetAutoDiscoveryReadError("response-too-large");
    }
  }

  if (response.body === null || response.body === undefined) {
    const body = await Promise.race([response.text(), deadline]);
    if (new TextEncoder().encode(body).byteLength > maximumBytes) {
      controller.abort();
      throw new PredictionAssetAutoDiscoveryReadError("response-too-large");
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) {
        throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > maximumBytes) {
        controller.abort();
        void reader.cancel().catch(() => undefined);
        throw new PredictionAssetAutoDiscoveryReadError("response-too-large");
      }
      chunks.push(next.value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The request AbortController owns a body read that outlives its caller.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
  }
}

function abortUnreadResponse(
  response: Response,
  controller: AbortController,
) {
  controller.abort();
  if (response.body !== null && response.body !== undefined) {
    void response.body.cancel().catch(() => undefined);
  }
}

function parseProbeCandidate(
  payload: unknown,
  binding: ProbeBinding,
  locator: string,
  maximumRows: number,
): EnrichedProbeCandidate | null {
  if (!Array.isArray(payload) || payload.length > maximumRows) {
    throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
  }

  const pairs: PairCandidate[] = [];
  for (const row of payload) {
    if (!isPotentialExactPairRow(row, binding, locator)) continue;
    const parsed = parseExactPairRow(row, binding, locator);
    if (parsed !== null) pairs.push(parsed);
  }

  if (pairs.length === 0) return null;
  const selected = [...pairs].sort(comparePairCandidates)[0];
  if (!selected) return null;
  return { ...selected, matchingPairCount: pairs.length };
}

function isPotentialExactPairRow(
  candidate: unknown,
  binding: ProbeBinding,
  locator: string,
) {
  if (!isPlainRecord(candidate) || candidate.chainId !== binding.providerChainId) {
    return false;
  }
  const baseAddress = isPlainRecord(candidate.baseToken) &&
      typeof candidate.baseToken.address === "string"
    ? candidate.baseToken.address
    : null;
  const quoteAddress = isPlainRecord(candidate.quoteToken) &&
      typeof candidate.quoteToken.address === "string"
    ? candidate.quoteToken.address
    : null;
  return Boolean(
    baseAddress && sameLocator(baseAddress, locator, binding.namespace) ||
      quoteAddress && sameLocator(quoteAddress, locator, binding.namespace),
  );
}

function parseExactPairRow(
  row: Record<string, unknown>,
  binding: ProbeBinding,
  locator: string,
): PairCandidate | null {
  try {
    const chainId = requiredBoundedString(row.chainId, 64);
    if (chainId !== binding.providerChainId) return null;
    const baseToken = requiredToken(row.baseToken, binding.namespace);
    const quoteToken = requiredToken(row.quoteToken, binding.namespace);
    const baseMatches = sameLocator(baseToken.address, locator, binding.namespace);
    const quoteMatches = sameLocator(quoteToken.address, locator, binding.namespace);
    if (!baseMatches && !quoteMatches) return null;

    const matchedSide = baseMatches ? "base" as const : "quote" as const;
    const matchedToken = baseMatches ? baseToken : quoteToken;
    const priceUsd = optionalPositiveDecimal(row.priceUsd);
    const priceNative = optionalPositiveDecimal(row.priceNative);
    const currentPriceUsd = matchedSide === "base"
      ? priceUsd
      : dividePositive(priceUsd, priceNative);
    // DEX Screener's field is display-only provider data. Its presence does
    // not establish a circulating-supply definition or settlement evidence.
    const marketCapUsd = matchedSide === "base"
      ? optionalNonNegativeNumber(row.marketCap)
      : null;
    const fdvUsd = matchedSide === "base"
      ? optionalNonNegativeNumber(row.fdv)
      : null;
    const liquidityUsd = optionalNestedNonNegativeNumber(
      row.liquidity,
      "usd",
    );
    const volume24hUsd = optionalNestedNonNegativeNumber(row.volume, "h24");
    const pairCreatedAt = optionalNonNegativeSafeInteger(row.pairCreatedAt);
    // DEX Screener's pair `info` describes the listed/base token. When the
    // requested asset is the quote token, reusing it would attach the other
    // token's artwork and socials to the requested CA. Keep that enrichment
    // empty unless the requested identity is the base side of the exact pair.
    const links = matchedSide === "base"
      ? parseLinksSafely(row.info)
      : { imageUrl: null, websites: [], socials: [] };
    const canonicalLocator = canonicalIdentifier(locator, binding.namespace);

    return {
      selectionKey: binding.namespace === "evm"
        ? `evm:${binding.chainReference}:${canonicalLocator}`
        : `solana:${binding.chainReference}:${canonicalLocator}`,
      selection: {
        mode: "custom",
        sourceNetwork: binding.sourceNetwork,
        assetLocator: canonicalLocator,
      },
      namespace: binding.namespace,
      chainReference: binding.chainReference,
      providerChainId: binding.providerChainId,
      token: {
        address: canonicalIdentifier(matchedToken.address, binding.namespace),
        name: matchedToken.name,
        symbol: matchedToken.symbol,
      },
      currentPriceUsd,
      marketCapUsd,
      fdvUsd,
      pair: {
        dexId: requiredBoundedString(row.dexId, 64).toLowerCase(),
        pairAddress: canonicalIdentifier(
          requiredBoundedString(row.pairAddress, 128),
          binding.namespace,
        ),
        matchedSide,
        liquidityUsd,
        volume24hUsd,
        pairCreatedAt,
      },
      links,
    };
  } catch {
    // A malformed provider row is not identity evidence and must not poison a
    // later exact row or the independently verified identity-only candidate.
    return null;
  }
}

function requiredToken(candidate: unknown, namespace: "evm" | "solana") {
  if (!isPlainRecord(candidate)) {
    throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
  }
  const address = requiredBoundedString(candidate.address, 128);
  if (
    namespace === "evm"
      ? !isEvmLocator(address)
      : !isSolanaLocator(address)
  ) {
    throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
  }
  return {
    address,
    name: optionalDisplayText(candidate.name, 80, true),
    symbol: optionalDisplayText(candidate.symbol, 24, false),
  };
}

function parseLinks(candidate: unknown): PredictionAssetAutoDiscoveryCandidateV2["links"] {
  if (candidate === undefined || candidate === null) {
    return { imageUrl: null, websites: [], socials: [] };
  }
  if (!isPlainRecord(candidate)) {
    throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
  }
  const imageUrl = safeHttpUrl(candidate.imageUrl);
  const websites = parseLinkRows(candidate.websites, "website");
  const socials = parseLinkRows(candidate.socials, "social");
  return { imageUrl, websites, socials };
}

function parseLinksSafely(
  candidate: unknown,
): PredictionAssetAutoDiscoveryCandidateV2["links"] {
  try {
    return parseLinks(candidate);
  } catch {
    return { imageUrl: null, websites: [], socials: [] };
  }
}

function parseLinkRows(
  candidate: unknown,
  kind: "website",
): PredictionAssetAutoDiscoveryCandidateV2["links"]["websites"];
function parseLinkRows(
  candidate: unknown,
  kind: "social",
): PredictionAssetAutoDiscoveryCandidateV2["links"]["socials"];
function parseLinkRows(
  candidate: unknown,
  kind: "website" | "social",
): PredictionAssetAutoDiscoveryCandidateV2["links"]["websites"] |
  PredictionAssetAutoDiscoveryCandidateV2["links"]["socials"] {
  if (candidate === undefined || candidate === null) return [];
  if (!Array.isArray(candidate) || candidate.length > MAXIMUM_LINK_ROWS) {
    throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
  }
  const rows: { descriptor: string | null; url: string }[] = [];
  const seen = new Set<string>();
  for (const row of candidate) {
    if (!isPlainRecord(row)) continue;
    const url = safeHttpUrl(row.url);
    if (url === null || seen.has(url)) continue;
    seen.add(url);
    rows.push({
      descriptor: optionalDisplayText(
        kind === "website" ? row.label : row.type,
        64,
        true,
      ),
      url,
    });
  }
  rows.sort((first, second) => {
    const url = compareText(first.url, second.url);
    if (url !== 0) return url;
    return compareText(first.descriptor ?? "", second.descriptor ?? "");
  });
  const selected = rows.slice(0, MAXIMUM_RETURNED_LINKS);
  if (kind === "website") {
    return selected.map((row) => ({
      label: row.descriptor,
      url: row.url,
    }));
  }
  return selected.map((row) => ({
    type: row.descriptor?.toLowerCase() ?? null,
    url: row.url,
  }));
}

export function normalizePredictionAssetLocatorV2(
  candidate: unknown,
): NormalizedLocator | null {
  if (typeof candidate !== "string") return null;
  const locator = candidate.trim();
  if (isEvmLocator(locator)) {
    return { locator: locator.toLowerCase(), namespace: "evm" };
  }
  if (isSolanaLocator(locator)) {
    return { locator, namespace: "solana" };
  }
  return null;
}

function isEvmLocator(candidate: string) {
  return /^0x[0-9a-fA-F]{40}$/u.test(candidate) &&
    candidate.toLowerCase() !== ZERO_EVM_ADDRESS;
}

function isSolanaLocator(candidate: string) {
  if (candidate.length < 32 || candidate.length > 44) return false;
  const bytes: number[] = [0];
  for (const character of candidate) {
    const value = BASE58_VALUE_BY_CHARACTER.get(character);
    if (value === undefined) return false;
    let carry = value;
    for (let index = 0; index < bytes.length; index += 1) {
      const next = bytes[index]! * 58 + carry;
      bytes[index] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
    if (bytes.length > 32) return false;
  }
  let leadingZeroes = 0;
  while (candidate[leadingZeroes] === "1") leadingZeroes += 1;
  const significantBytes = bytes.length === 1 && bytes[0] === 0
    ? 0
    : bytes.length;
  return significantBytes + leadingZeroes === 32 && significantBytes > 0;
}

const BASE58_VALUE_BY_CHARACTER = new Map(
  [..."123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"]
    .map((character, index) => [character, index] as const),
);

function sameLocator(
  candidate: string,
  locator: string,
  namespace: "evm" | "solana",
) {
  return namespace === "evm"
    ? candidate.toLowerCase() === locator
    : candidate === locator;
}

function canonicalIdentifier(
  candidate: string,
  namespace: "evm" | "solana",
) {
  return namespace === "evm" ? candidate.toLowerCase() : candidate;
}

function requiredBoundedString(candidate: unknown, maximumLength: number) {
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.length > maximumLength ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(candidate)
  ) {
    throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
  }
  return candidate;
}

function optionalDisplayText(
  candidate: unknown,
  maximumLength: number,
  allowWhitespace: boolean,
) {
  if (candidate === undefined || candidate === null) return null;
  if (typeof candidate !== "string") return null;
  const normalized = candidate.normalize("NFC").trim();
  if (!normalized || UNSAFE_DISPLAY_TEXT_PATTERN.test(normalized)) return null;
  const text = allowWhitespace ? normalized.replace(/\s+/gu, " ") : normalized;
  if (
    (!allowWhitespace && /\s/u.test(text)) ||
    Array.from(text).length > maximumLength ||
    new TextEncoder().encode(text).length > maximumLength * 4
  ) return null;
  return text;
}

function optionalPositiveDecimal(candidate: unknown) {
  if (candidate === undefined || candidate === null) return null;
  if (
    typeof candidate !== "string" ||
    candidate.length > 128 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(candidate)
  ) {
    throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
  }
  const value = Number(candidate);
  if (!Number.isFinite(value)) {
    throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
  }
  return value > 0 ? value : null;
}

function optionalNonNegativeNumber(candidate: unknown) {
  if (candidate === undefined || candidate === null) return null;
  if (
    typeof candidate !== "number" ||
    !Number.isFinite(candidate) ||
    candidate < 0
  ) {
    throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
  }
  return candidate;
}

function optionalNonNegativeSafeInteger(candidate: unknown) {
  if (candidate === undefined || candidate === null) return null;
  if (!Number.isSafeInteger(candidate) || (candidate as number) < 0) {
    throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
  }
  return candidate as number;
}

function optionalNestedNonNegativeNumber(
  candidate: unknown,
  key: string,
) {
  if (candidate === undefined || candidate === null) return null;
  if (!isPlainRecord(candidate)) {
    throw new PredictionAssetAutoDiscoveryReadError("response-invalid");
  }
  return optionalNonNegativeNumber(candidate[key]);
}

function dividePositive(
  numerator: number | null,
  denominator: number | null,
) {
  if (numerator === null || denominator === null) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function safeHttpUrl(candidate: unknown) {
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.length > 2_048 ||
    /[\u0000-\u0020\u007f]/u.test(candidate)
  ) {
    return null;
  }
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      (url.port && url.port !== "443") ||
      !isPublicWebHostname(hostname)
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isPublicWebHostname(hostname: string) {
  if (!hostname || hostname.endsWith(".") || hostname.includes(":")) {
    return false;
  }
  if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u.test(hostname)) return false;
  if (!/^[a-z0-9.-]+$/u.test(hostname) || !hostname.includes(".")) {
    return false;
  }
  const labels = hostname.split(".");
  if (labels.some((label) =>
    !label || label.length > 63 || label.startsWith("-") || label.endsWith("-")
  )) {
    return false;
  }
  return hostname !== "localhost" &&
    !PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function comparePairCandidates(first: PairCandidate, second: PairCandidate) {
  const priceAvailability = Number(second.currentPriceUsd !== null) -
    Number(first.currentPriceUsd !== null);
  if (priceAvailability !== 0) return priceAvailability;
  const liquidity = compareNullableNumberDescending(
    first.pair.liquidityUsd,
    second.pair.liquidityUsd,
  );
  if (liquidity !== 0) return liquidity;
  const volume = compareNullableNumberDescending(
    first.pair.volume24hUsd,
    second.pair.volume24hUsd,
  );
  if (volume !== 0) return volume;
  const pairAddress = compareText(
    first.pair.pairAddress,
    second.pair.pairAddress,
  );
  if (pairAddress !== 0) return pairAddress;
  return compareText(first.pair.dexId, second.pair.dexId);
}

function compareNullableNumberDescending(
  first: number | null,
  second: number | null,
) {
  if (first === second) return 0;
  if (first === null) return 1;
  if (second === null) return -1;
  return first > second ? -1 : 1;
}

function compareText(first: string, second: string) {
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  return Boolean(
    candidate && typeof candidate === "object" && !Array.isArray(candidate),
  );
}

function boundedInteger(
  candidate: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
) {
  const value = candidate ?? fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

export const readPredictionAssetAutoDiscoveryV2 =
  createPredictionAssetAutoDiscoveryReaderV2().read;
