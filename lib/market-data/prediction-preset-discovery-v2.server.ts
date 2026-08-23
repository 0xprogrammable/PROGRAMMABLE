import "server-only";

const COINGECKO_SIMPLE_PRICE_ENDPOINT =
  "https://api.coingecko.com/api/v3/simple/price" as const;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 32_768;
const DEFAULT_SUCCESS_CACHE_TTL_MS = 60_000;
const DEFAULT_MAXIMUM_DATA_AGE_MS = 10 * 60_000;
const DEFAULT_MAXIMUM_FUTURE_SKEW_MS = 5 * 60_000;

const PRESET_BINDINGS = Object.freeze([
  {
    presetId: "btc",
    selectionKey: "preset:btc",
    symbol: "BTC",
    providerId: "bitcoin",
  },
  {
    presetId: "eth",
    selectionKey: "preset:eth",
    symbol: "ETH",
    providerId: "ethereum",
  },
  {
    presetId: "sol",
    selectionKey: "preset:sol",
    symbol: "SOL",
    providerId: "solana",
  },
  {
    presetId: "bnb",
    selectionKey: "preset:bnb",
    symbol: "BNB",
    providerId: "binancecoin",
  },
] as const);

export const PREDICTION_PRESET_DISCOVERY_SOURCE_V2 =
  "coingecko-keyless-public" as const;
export const PREDICTION_PRESET_DISCOVERY_USAGE_V2 =
  "display-only-not-eligibility-or-settlement" as const;
export const PREDICTION_PRESET_DISCOVERY_SERVICE_LEVEL_V2 =
  "best-effort-no-sla" as const;

export type PredictionPresetDiscoveryUnavailableReasonV2 =
  | "aborted"
  | "timeout"
  | "rate-limited"
  | "provider-unavailable"
  | "response-too-large"
  | "response-invalid"
  | "incomplete-provider-data"
  | "stale-provider-data";

type PredictionPresetDiscoveryResultBaseV2 = Readonly<{
  schemaVersion: 2;
  source: typeof PREDICTION_PRESET_DISCOVERY_SOURCE_V2;
  providerTier: "keyless-public";
  observedAt: string;
  usage: typeof PREDICTION_PRESET_DISCOVERY_USAGE_V2;
  serviceLevel: typeof PREDICTION_PRESET_DISCOVERY_SERVICE_LEVEL_V2;
}>;

export type PredictionPresetMarketDataV2 = Readonly<{
  presetId: (typeof PRESET_BINDINGS)[number]["presetId"];
  selectionKey: (typeof PRESET_BINDINGS)[number]["selectionKey"];
  symbol: (typeof PRESET_BINDINGS)[number]["symbol"];
  providerId: (typeof PRESET_BINDINGS)[number]["providerId"];
  currentPriceUsd: number;
  marketCapUsd: number;
  sourceUpdatedAt: string;
}>;

export type PredictionPresetDiscoveryAvailableV2 =
  PredictionPresetDiscoveryResultBaseV2 & Readonly<{
    status: "available";
    cacheExpiresAt: string;
    presets: readonly PredictionPresetMarketDataV2[];
  }>;

export type PredictionPresetDiscoveryUnavailableV2 =
  PredictionPresetDiscoveryResultBaseV2 & Readonly<{
    status: "unavailable";
    reason: PredictionPresetDiscoveryUnavailableReasonV2;
  }>;

export type PredictionPresetDiscoveryResultV2 =
  | PredictionPresetDiscoveryAvailableV2
  | PredictionPresetDiscoveryUnavailableV2;

export type PredictionPresetDiscoveryReaderOptionsV2 = Readonly<{
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  maximumResponseBytes?: number;
  successCacheTtlMs?: number;
  maximumDataAgeMs?: number;
  maximumFutureSkewMs?: number;
}>;

export type PredictionPresetDiscoveryReadOptionsV2 = Readonly<{
  signal?: AbortSignal;
}>;

export type PredictionPresetDiscoveryReaderV2 = Readonly<{
  read(
    options?: PredictionPresetDiscoveryReadOptionsV2,
  ): Promise<PredictionPresetDiscoveryResultV2>;
}>;

class PredictionPresetDiscoveryReadError extends Error {
  constructor(
    readonly reason: PredictionPresetDiscoveryUnavailableReasonV2,
  ) {
    super(`Prediction preset discovery failed: ${reason}`);
    this.name = "PredictionPresetDiscoveryReadError";
  }
}

/**
 * CoinGecko documents its keyless public tier as dynamically rate-limited,
 * best-effort access for light experimentation. This dormant reader therefore
 * never supplies eligibility or settlement data, never serves expired cache,
 * and returns unavailable instead of inventing or silently retaining prices.
 */
export function createPredictionPresetDiscoveryReaderV2(
  options: PredictionPresetDiscoveryReaderOptionsV2 = {},
): PredictionPresetDiscoveryReaderV2 {
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
    128,
    131_072,
    "maximumResponseBytes",
  );
  const successCacheTtlMs = boundedInteger(
    options.successCacheTtlMs,
    DEFAULT_SUCCESS_CACHE_TTL_MS,
    1,
    300_000,
    "successCacheTtlMs",
  );
  const maximumDataAgeMs = boundedInteger(
    options.maximumDataAgeMs,
    DEFAULT_MAXIMUM_DATA_AGE_MS,
    1_000,
    3_600_000,
    "maximumDataAgeMs",
  );
  const maximumFutureSkewMs = boundedInteger(
    options.maximumFutureSkewMs,
    DEFAULT_MAXIMUM_FUTURE_SKEW_MS,
    0,
    300_000,
    "maximumFutureSkewMs",
  );

  let cached:
    | Readonly<{
      expiresAtMs: number;
      result: PredictionPresetDiscoveryAvailableV2;
    }>
    | null = null;

  function observation() {
    const date = now();
    const timestampMs = date.getTime();
    if (!Number.isFinite(timestampMs)) {
      throw new RangeError("now must return a valid Date");
    }
    return { timestampMs, iso: date.toISOString() } as const;
  }

  function unavailable(
    observedAt: string,
    reason: PredictionPresetDiscoveryUnavailableReasonV2,
  ): PredictionPresetDiscoveryUnavailableV2 {
    return Object.freeze({
      schemaVersion: 2,
      status: "unavailable",
      reason,
      source: PREDICTION_PRESET_DISCOVERY_SOURCE_V2,
      providerTier: "keyless-public",
      observedAt,
      usage: PREDICTION_PRESET_DISCOVERY_USAGE_V2,
      serviceLevel: PREDICTION_PRESET_DISCOVERY_SERVICE_LEVEL_V2,
    });
  }

  return Object.freeze({
    async read(readOptions = {}) {
      const observed = observation();
      if (readOptions.signal?.aborted) {
        return unavailable(observed.iso, "aborted");
      }
      if (cached !== null && observed.timestampMs < cached.expiresAtMs) {
        return cached.result;
      }

      try {
        const payload = await requestCoinGeckoPresetData({
          fetchImpl,
          timeoutMs,
          maximumResponseBytes,
          signal: readOptions.signal,
        });
        const presets = parsePresetPayload(
          payload,
          observed.timestampMs,
          maximumDataAgeMs,
          maximumFutureSkewMs,
        );
        const sourceFreshUntilMs = Math.min(
          ...presets.map(({ sourceUpdatedAt }) =>
            new Date(sourceUpdatedAt).getTime() + maximumDataAgeMs
          ),
        );
        const cacheExpiresAtMs = Math.min(
          observed.timestampMs + successCacheTtlMs,
          sourceFreshUntilMs,
        );
        const result = Object.freeze({
          schemaVersion: 2,
          status: "available",
          source: PREDICTION_PRESET_DISCOVERY_SOURCE_V2,
          providerTier: "keyless-public",
          observedAt: observed.iso,
          usage: PREDICTION_PRESET_DISCOVERY_USAGE_V2,
          serviceLevel: PREDICTION_PRESET_DISCOVERY_SERVICE_LEVEL_V2,
          cacheExpiresAt: new Date(cacheExpiresAtMs).toISOString(),
          presets,
        } as const satisfies PredictionPresetDiscoveryAvailableV2);
        cached = Object.freeze({
          expiresAtMs: cacheExpiresAtMs,
          result,
        });
        return result;
      } catch (error) {
        return unavailable(
          observed.iso,
          error instanceof PredictionPresetDiscoveryReadError
            ? error.reason
            : "provider-unavailable",
        );
      }
    },
  });
}

async function requestCoinGeckoPresetData(input: Readonly<{
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maximumResponseBytes: number;
  signal?: AbortSignal;
}>): Promise<unknown> {
  if (input.signal?.aborted) {
    throw new PredictionPresetDiscoveryReadError("aborted");
  }

  const controller = new AbortController();
  let rejectDeadline!: (error: PredictionPresetDiscoveryReadError) => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  let deadlineSettled = false;
  let abortReason: "aborted" | "timeout" | null = null;
  const abortWith = (reason: "aborted" | "timeout") => {
    if (deadlineSettled) return;
    abortReason = reason;
    deadlineSettled = true;
    controller.abort();
    rejectDeadline(new PredictionPresetDiscoveryReadError(reason));
  };
  const abortFromCaller = () => abortWith("aborted");
  const timer = setTimeout(() => abortWith("timeout"), input.timeoutMs);
  input.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const url = new URL(COINGECKO_SIMPLE_PRICE_ENDPOINT);
    url.searchParams.set(
      "ids",
      PRESET_BINDINGS.map(({ providerId }) => providerId).join(","),
    );
    url.searchParams.set("vs_currencies", "usd");
    url.searchParams.set("include_market_cap", "true");
    url.searchParams.set("include_last_updated_at", "true");
    url.searchParams.set("precision", "full");

    let response: Response;
    try {
      response = await Promise.race([
        input.fetchImpl(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        }),
        deadline,
      ]);
    } catch (error) {
      if (abortReason !== null) {
        throw new PredictionPresetDiscoveryReadError(abortReason);
      }
      throw error;
    }

    if (response.status === 429) {
      abortUnreadResponse(response, controller);
      throw new PredictionPresetDiscoveryReadError("rate-limited");
    }
    if (!response.ok) {
      abortUnreadResponse(response, controller);
      throw new PredictionPresetDiscoveryReadError("provider-unavailable");
    }
    const contentType = response.headers.get("content-type");
    if (!contentType?.toLowerCase().startsWith("application/json")) {
      abortUnreadResponse(response, controller);
      throw new PredictionPresetDiscoveryReadError("response-invalid");
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
      throw new PredictionPresetDiscoveryReadError("response-invalid");
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
      throw new PredictionPresetDiscoveryReadError("response-invalid");
    }
    if (BigInt(declaredLength) > BigInt(maximumBytes)) {
      abortUnreadResponse(response, controller);
      throw new PredictionPresetDiscoveryReadError("response-too-large");
    }
  }

  if (response.body === null || response.body === undefined) {
    const body = await Promise.race([response.text(), deadline]);
    if (new TextEncoder().encode(body).byteLength > maximumBytes) {
      controller.abort();
      throw new PredictionPresetDiscoveryReadError("response-too-large");
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
        throw new PredictionPresetDiscoveryReadError("response-invalid");
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > maximumBytes) {
        controller.abort();
        void reader.cancel().catch(() => undefined);
        throw new PredictionPresetDiscoveryReadError("response-too-large");
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
    throw new PredictionPresetDiscoveryReadError("response-invalid");
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

function parsePresetPayload(
  payload: unknown,
  observedAtMs: number,
  maximumDataAgeMs: number,
  maximumFutureSkewMs: number,
): readonly PredictionPresetMarketDataV2[] {
  if (!isPlainRecord(payload)) {
    throw new PredictionPresetDiscoveryReadError("response-invalid");
  }
  const expectedProviderIds = PRESET_BINDINGS.map(({ providerId }) =>
    providerId
  );
  if (!hasExactKeys(payload, expectedProviderIds)) {
    const missingExpected = expectedProviderIds.some((providerId) =>
      !Object.hasOwn(payload, providerId)
    );
    throw new PredictionPresetDiscoveryReadError(
      missingExpected ? "incomplete-provider-data" : "response-invalid",
    );
  }

  const presets = PRESET_BINDINGS.map((binding) => {
    const row = payload[binding.providerId];
    if (!isPlainRecord(row)) {
      throw new PredictionPresetDiscoveryReadError(
        "incomplete-provider-data",
      );
    }
    if (!hasExactKeys(row, ["usd", "usd_market_cap", "last_updated_at"])) {
      throw new PredictionPresetDiscoveryReadError("response-invalid");
    }

    const currentPriceUsd = positiveFiniteNumber(row.usd);
    const marketCapUsd = positiveFiniteNumber(row.usd_market_cap);
    const updatedAtSeconds = positiveInteger(row.last_updated_at);
    if (
      currentPriceUsd === null ||
      marketCapUsd === null ||
      updatedAtSeconds === null
    ) {
      throw new PredictionPresetDiscoveryReadError(
        "incomplete-provider-data",
      );
    }

    const sourceUpdatedAtMs = updatedAtSeconds * 1_000;
    if (
      !Number.isSafeInteger(sourceUpdatedAtMs) ||
      sourceUpdatedAtMs > observedAtMs + maximumFutureSkewMs ||
      observedAtMs - sourceUpdatedAtMs > maximumDataAgeMs
    ) {
      throw new PredictionPresetDiscoveryReadError("stale-provider-data");
    }

    return Object.freeze({
      presetId: binding.presetId,
      selectionKey: binding.selectionKey,
      symbol: binding.symbol,
      providerId: binding.providerId,
      currentPriceUsd,
      marketCapUsd,
      sourceUpdatedAt: new Date(sourceUpdatedAtMs).toISOString(),
    });
  });

  return Object.freeze(presets);
}

function hasExactKeys(
  candidate: Record<string, unknown>,
  expectedKeys: readonly string[],
) {
  const keys = Object.keys(candidate);
  return keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(candidate, key));
}

function positiveFiniteNumber(candidate: unknown) {
  return typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate > 0
    ? candidate
    : null;
}

function positiveInteger(candidate: unknown) {
  return typeof candidate === "number" &&
      Number.isSafeInteger(candidate) &&
      candidate > 0
    ? candidate
    : null;
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
    throw new RangeError(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

export const readPredictionPresetDiscoveryV2 =
  createPredictionPresetDiscoveryReaderV2().read;
