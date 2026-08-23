import "server-only";

import {
  isEvmPredictionAssetLocatorV2,
  isPredictionSourceNetworkIdV2,
  isSolanaPredictionAssetLocatorV2,
  predictionAssetSelectionKeyV2,
  predictionSourceNetworkV2,
  type PredictionCustomAssetSelectionV2,
  type PredictionSourceNetworkIdV2,
} from "../prediction-market-assets-v2";

const DEXSCREENER_TOKEN_PAIRS_ENDPOINT =
  "https://api.dexscreener.com/token-pairs/v1" as const;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 512_000;
const DEFAULT_MAXIMUM_ROWS = 256;

const DEXSCREENER_CHAIN_ID_BY_SOURCE_NETWORK = Object.freeze({
  ethereum: "ethereum",
  base: "base",
  bnb: "bsc",
  robinhood: "robinhood",
  solana: "solana",
} as const satisfies Record<PredictionSourceNetworkIdV2, string>);

export const PREDICTION_ASSET_DISCOVERY_SOURCE_V2 = "dexscreener" as const;
export const PREDICTION_ASSET_DISCOVERY_USAGE_V2 =
  "informational-only" as const;

export type PredictionAssetDiscoveryUnavailableReasonV2 =
  | "invalid-selection"
  | "aborted"
  | "timeout"
  | "rate-limited"
  | "provider-unavailable"
  | "response-too-large"
  | "response-invalid"
  | "not-found"
  | "market-data-unavailable";

type PredictionAssetDiscoveryResultBaseV2 = Readonly<{
  schemaVersion: 2;
  /** Provider lookup identity only; never a release or settlement bytes32 key. */
  selectionKey: string | null;
  source: typeof PREDICTION_ASSET_DISCOVERY_SOURCE_V2;
  observedAt: string;
  usage: typeof PREDICTION_ASSET_DISCOVERY_USAGE_V2;
}>;

export type PredictionAssetDiscoveryAvailableV2 =
  PredictionAssetDiscoveryResultBaseV2 & Readonly<{
    selectionKey: string;
    status: "available";
    currentPriceUsd: number;
    marketCapUsd: number;
    pair: Readonly<{
      providerChainId: string;
      dexId: string;
      pairAddress: string;
      liquidityUsd: number;
    }>;
  }>;

export type PredictionAssetDiscoveryUnavailableV2 =
  PredictionAssetDiscoveryResultBaseV2 & Readonly<{
    status: "unavailable";
    reason: PredictionAssetDiscoveryUnavailableReasonV2;
  }>;

export type PredictionAssetDiscoveryResultV2 =
  | PredictionAssetDiscoveryAvailableV2
  | PredictionAssetDiscoveryUnavailableV2;

export type PredictionAssetDiscoveryReaderOptionsV2 = Readonly<{
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  maximumResponseBytes?: number;
  maximumRows?: number;
}>;

export type PredictionAssetDiscoveryReadOptionsV2 = Readonly<{
  signal?: AbortSignal;
}>;

export type PredictionAssetDiscoveryReaderV2 = Readonly<{
  read(
    selection: PredictionCustomAssetSelectionV2,
    options?: PredictionAssetDiscoveryReadOptionsV2,
  ): Promise<PredictionAssetDiscoveryResultV2>;
}>;

type DiscoveryBinding = Readonly<{
  selectionKey: string;
  providerChainId: string;
  locator: string;
  namespace: "evm" | "solana";
}>;

type PairCandidate = Readonly<{
  dexId: string;
  pairAddress: string;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
}>;

class PredictionAssetDiscoveryReadError extends Error {
  constructor(
    readonly reason: PredictionAssetDiscoveryUnavailableReasonV2,
  ) {
    super(`Prediction asset discovery failed: ${reason}`);
    this.name = "PredictionAssetDiscoveryReadError";
  }
}

export function createPredictionAssetDiscoveryReaderV2(
  options: PredictionAssetDiscoveryReaderOptionsV2 = {},
): PredictionAssetDiscoveryReaderV2 {
  const fetchImpl = options.fetchImpl ?? fetch;
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

  function unavailable(
    binding: DiscoveryBinding | null,
    reason: PredictionAssetDiscoveryUnavailableReasonV2,
  ): PredictionAssetDiscoveryUnavailableV2 {
    return {
      schemaVersion: 2,
      selectionKey: binding?.selectionKey ?? null,
      status: "unavailable",
      reason,
      source: PREDICTION_ASSET_DISCOVERY_SOURCE_V2,
      observedAt: now().toISOString(),
      usage: PREDICTION_ASSET_DISCOVERY_USAGE_V2,
    };
  }

  return Object.freeze({
    async read(selection, readOptions = {}) {
      const binding = discoveryBinding(selection);
      if (binding === null) return unavailable(null, "invalid-selection");
      if (readOptions.signal?.aborted) return unavailable(binding, "aborted");

      try {
        const payload = await requestDexscreenerPairs({
          binding,
          fetchImpl,
          timeoutMs,
          maximumResponseBytes,
          signal: readOptions.signal,
        });
        const candidates = parsePairCandidates(
          payload,
          binding,
          maximumRows,
        );
        if (candidates.status !== "available") {
          return unavailable(binding, candidates.status);
        }

        const selected = [...candidates.pairs].sort(comparePairCandidates)[0];
        if (!selected) return unavailable(binding, "market-data-unavailable");
        return {
          schemaVersion: 2,
          selectionKey: binding.selectionKey,
          status: "available",
          source: PREDICTION_ASSET_DISCOVERY_SOURCE_V2,
          observedAt: now().toISOString(),
          usage: PREDICTION_ASSET_DISCOVERY_USAGE_V2,
          currentPriceUsd: selected.priceUsd,
          marketCapUsd: selected.marketCapUsd,
          pair: {
            providerChainId: binding.providerChainId,
            dexId: selected.dexId,
            pairAddress: selected.pairAddress,
            liquidityUsd: selected.liquidityUsd,
          },
        };
      } catch (error) {
        return unavailable(
          binding,
          error instanceof PredictionAssetDiscoveryReadError
            ? error.reason
            : "provider-unavailable",
        );
      }
    },
  });
}

function discoveryBinding(
  selection: PredictionCustomAssetSelectionV2,
): DiscoveryBinding | null {
  if (
    !selection ||
    typeof selection !== "object" ||
    selection.mode !== "custom" ||
    !isPredictionSourceNetworkIdV2(selection.sourceNetwork) ||
    typeof selection.assetLocator !== "string"
  ) {
    return null;
  }
  const network = predictionSourceNetworkV2(selection.sourceNetwork);
  if (!network) return null;
  const selectionKey = predictionAssetSelectionKeyV2(selection);
  if (!selectionKey) return null;
  const locator = selection.assetLocator.trim();
  if (network.namespace === "evm") {
    if (!isEvmPredictionAssetLocatorV2(locator)) return null;
    const canonicalLocator = locator.toLowerCase();
    return {
      selectionKey,
      providerChainId:
        DEXSCREENER_CHAIN_ID_BY_SOURCE_NETWORK[selection.sourceNetwork],
      locator: canonicalLocator,
      namespace: "evm",
    };
  }
  if (!isSolanaPredictionAssetLocatorV2(locator)) return null;
  return {
    selectionKey,
    providerChainId:
      DEXSCREENER_CHAIN_ID_BY_SOURCE_NETWORK[selection.sourceNetwork],
    locator,
    namespace: "solana",
  };
}

async function requestDexscreenerPairs(input: Readonly<{
  binding: DiscoveryBinding;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maximumResponseBytes: number;
  signal?: AbortSignal;
}>): Promise<unknown> {
  if (input.signal?.aborted) {
    throw new PredictionAssetDiscoveryReadError("aborted");
  }
  const controller = new AbortController();
  let rejectDeadline!: (error: PredictionAssetDiscoveryReadError) => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  let deadlineSettled = false;
  const abortWith = (reason: "aborted" | "timeout") => {
    if (deadlineSettled) return;
    deadlineSettled = true;
    controller.abort();
    rejectDeadline(new PredictionAssetDiscoveryReadError(reason));
  };
  const abortFromCaller = () => abortWith("aborted");
  const timer = setTimeout(() => abortWith("timeout"), input.timeoutMs);
  input.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const url = `${DEXSCREENER_TOKEN_PAIRS_ENDPOINT}/${
      encodeURIComponent(input.binding.providerChainId)
    }/${encodeURIComponent(input.binding.locator)}`;
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
      throw new PredictionAssetDiscoveryReadError("rate-limited");
    }
    if (!response.ok) {
      abortUnreadResponse(response, controller);
      throw new PredictionAssetDiscoveryReadError("provider-unavailable");
    }
    const contentType = response.headers.get("content-type");
    if (!contentType?.toLowerCase().startsWith("application/json")) {
      abortUnreadResponse(response, controller);
      throw new PredictionAssetDiscoveryReadError("response-invalid");
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
      throw new PredictionAssetDiscoveryReadError("response-invalid");
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
      throw new PredictionAssetDiscoveryReadError("response-invalid");
    }
    if (BigInt(declaredLength) > BigInt(maximumBytes)) {
      abortUnreadResponse(response, controller);
      throw new PredictionAssetDiscoveryReadError("response-too-large");
    }
  }

  if (response.body === null || response.body === undefined) {
    const body = await Promise.race([response.text(), deadline]);
    if (new TextEncoder().encode(body).byteLength > maximumBytes) {
      controller.abort();
      throw new PredictionAssetDiscoveryReadError("response-too-large");
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
        throw new PredictionAssetDiscoveryReadError("response-invalid");
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > maximumBytes) {
        controller.abort();
        void reader.cancel().catch(() => undefined);
        throw new PredictionAssetDiscoveryReadError("response-too-large");
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
    throw new PredictionAssetDiscoveryReadError("response-invalid");
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

function parsePairCandidates(
  payload: unknown,
  binding: DiscoveryBinding,
  maximumRows: number,
):
  | Readonly<{ status: "available"; pairs: readonly PairCandidate[] }>
  | Readonly<{ status: "not-found" | "market-data-unavailable" }> {
  if (!Array.isArray(payload) || payload.length > maximumRows) {
    throw new PredictionAssetDiscoveryReadError("response-invalid");
  }

  let boundPairCount = 0;
  const pairs: PairCandidate[] = [];
  for (const row of payload) {
    if (!isPlainRecord(row)) {
      throw new PredictionAssetDiscoveryReadError("response-invalid");
    }
    const chainId = optionalBoundedString(row.chainId, 64);
    if (chainId === null || chainId !== binding.providerChainId) continue;
    if (row.baseToken !== undefined && !isPlainRecord(row.baseToken)) {
      throw new PredictionAssetDiscoveryReadError("response-invalid");
    }
    const baseAddress = isPlainRecord(row.baseToken)
      ? optionalBoundedString(row.baseToken.address, 128)
      : null;
    if (baseAddress === null || !sameLocator(baseAddress, binding)) continue;
    boundPairCount += 1;

    const dexId = optionalBoundedString(row.dexId, 64);
    const pairAddress = optionalBoundedString(row.pairAddress, 128);
    const priceUsd = optionalPositiveDecimal(row.priceUsd);
    const marketCapUsd = optionalNonNegativeNumber(row.marketCap);
    if (
      row.liquidity !== undefined &&
      row.liquidity !== null &&
      !isPlainRecord(row.liquidity)
    ) {
      throw new PredictionAssetDiscoveryReadError("response-invalid");
    }
    const liquidityUsd = isPlainRecord(row.liquidity)
      ? optionalNonNegativeNumber(row.liquidity.usd)
      : null;
    if (
      dexId === null ||
      pairAddress === null ||
      priceUsd === null ||
      marketCapUsd === null ||
      liquidityUsd === null
    ) {
      continue;
    }
    pairs.push({
      dexId: dexId.toLowerCase(),
      pairAddress: binding.namespace === "evm"
        ? pairAddress.toLowerCase()
        : pairAddress,
      priceUsd,
      marketCapUsd,
      liquidityUsd,
    });
  }

  if (pairs.length > 0) return { status: "available", pairs };
  return boundPairCount > 0
    ? { status: "market-data-unavailable" }
    : { status: "not-found" };
}

function sameLocator(candidate: string, binding: DiscoveryBinding) {
  return binding.namespace === "evm"
    ? candidate.toLowerCase() === binding.locator
    : candidate === binding.locator;
}

function optionalBoundedString(candidate: unknown, maximumLength: number) {
  if (candidate === undefined || candidate === null) return null;
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.length > maximumLength
  ) {
    throw new PredictionAssetDiscoveryReadError("response-invalid");
  }
  return candidate;
}

function optionalPositiveDecimal(candidate: unknown) {
  if (candidate === undefined || candidate === null) return null;
  if (
    typeof candidate !== "string" ||
    candidate.length > 128 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(candidate)
  ) {
    throw new PredictionAssetDiscoveryReadError("response-invalid");
  }
  const value = Number(candidate);
  if (!Number.isFinite(value) || value <= 0) {
    throw new PredictionAssetDiscoveryReadError("response-invalid");
  }
  return value;
}

function optionalNonNegativeNumber(candidate: unknown) {
  if (candidate === undefined || candidate === null) return null;
  if (
    typeof candidate !== "number" ||
    !Number.isFinite(candidate) ||
    candidate < 0
  ) {
    throw new PredictionAssetDiscoveryReadError("response-invalid");
  }
  return candidate;
}

function comparePairCandidates(first: PairCandidate, second: PairCandidate) {
  if (first.liquidityUsd !== second.liquidityUsd) {
    return first.liquidityUsd > second.liquidityUsd ? -1 : 1;
  }
  const pairAddress = compareText(first.pairAddress, second.pairAddress);
  if (pairAddress !== 0) return pairAddress;
  const dexId = compareText(first.dexId, second.dexId);
  if (dexId !== 0) return dexId;
  if (first.priceUsd !== second.priceUsd) {
    return first.priceUsd < second.priceUsd ? -1 : 1;
  }
  if (first.marketCapUsd !== second.marketCapUsd) {
    return first.marketCapUsd < second.marketCapUsd ? -1 : 1;
  }
  return 0;
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

export const readPredictionAssetDiscoveryV2 =
  createPredictionAssetDiscoveryReaderV2().read;
