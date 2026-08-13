const DEFAULT_CACHE_TTL_MS = 10_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 4_000;

export class ApplicantRefreshUserUnavailableErrorV1 extends Error {
  readonly status = 429;
  readonly code = "applicant_session_rate_limited";
  readonly retryable = true;

  constructor() {
    super("Applicant authentication is temporarily rate limited. Retry shortly");
    this.name = "ApplicantRefreshUserUnavailableErrorV1";
  }
}

export type ApplicantRefreshUserGateV1<T> = Readonly<{
  refresh: (key: string) => Promise<T>;
  invalidate: () => void;
  setSource: (source: () => Promise<T>) => void;
}>;

type InFlightV1<T> = {
  readonly generation: number;
  readonly key: string;
  promise: Promise<T>;
};

type CachedV1<T> = Readonly<{
  generation: number;
  key: string;
  value: T;
  expiresAt: number;
}>;

/**
 * Privy's browser `refreshUser` endpoint is a deliberately small bucket. The
 * Applicant flow can ask for the same current user from several effects and
 * from list/resolve/preflight in one operation. This gate coalesces equal
 * requests and keeps only a short-lived successful snapshot; failures are
 * never cached as authority.
 */
export function createApplicantRefreshUserGateV1<T>(input: Readonly<{
  source: () => Promise<T>;
  now?: () => number;
  cacheTtlMs?: number;
  rateLimitCooldownMs?: number;
  shouldCache?: (value: T) => boolean;
  isRateLimited?: (error: unknown) => boolean;
}>): ApplicantRefreshUserGateV1<T> {
  const now = input.now ?? Date.now;
  const cacheTtlMs = input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const rateLimitCooldownMs =
    input.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  const shouldCache = input.shouldCache
    ?? ((value: T) => value !== null && value !== undefined);
  const isRateLimited = input.isRateLimited
    ?? applicantRefreshUserIsRateLimitedV1;
  let source = input.source;

  if (!Number.isFinite(cacheTtlMs) || cacheTtlMs < 0) {
    throw new RangeError("Applicant refresh cache TTL is invalid");
  }
  if (!Number.isFinite(rateLimitCooldownMs) || rateLimitCooldownMs < 0) {
    throw new RangeError("Applicant refresh rate-limit cooldown is invalid");
  }

  let generation = 0;
  const cachedByKey = new Map<string, CachedV1<T>>();
  const inFlightByKey = new Map<string, InFlightV1<T>>();
  let sourceInFlight: Promise<T> | null = null;
  let nextSourceAt = 0;
  let rateLimitRetryAt = 0;
  let rateLimitError: unknown = null;

  const refresh = (key: string): Promise<T> => {
    if (typeof key !== "string" || key.length === 0) {
      return Promise.reject(new TypeError("Applicant refresh key is invalid"));
    }

    const currentTime = now();
    const cached = cachedByKey.get(key);
    if (
      cached !== undefined
      && cached.generation === generation
      && cached.expiresAt > currentTime
    ) {
      return Promise.resolve(cached.value);
    }
    if (cached !== undefined) cachedByKey.delete(key);

    const inFlight = inFlightByKey.get(key);
    if (
      inFlight !== undefined
      && inFlight.generation === generation
    ) {
      return inFlight.promise;
    }
    if (inFlight !== undefined) inFlightByKey.delete(key);

    if (
      sourceInFlight !== null
      || nextSourceAt > currentTime
      || rateLimitRetryAt > currentTime
    ) {
      return Promise.reject(
        rateLimitError
          ?? new ApplicantRefreshUserUnavailableErrorV1(),
      );
    }

    const requestGeneration = generation;
    nextSourceAt = currentTime + rateLimitCooldownMs;
    const request = Promise.resolve().then(source).then(
      (value) => {
        if (requestGeneration === generation) {
          rateLimitRetryAt = 0;
          rateLimitError = null;
          if (shouldCache(value)) {
            cachedByKey.set(key, Object.freeze({
              generation,
              key,
              value,
              expiresAt: now() + cacheTtlMs,
            }));
          }
        }
        return value;
      },
      (error: unknown) => {
        if (requestGeneration === generation && isRateLimited(error)) {
          const unavailable = new ApplicantRefreshUserUnavailableErrorV1();
          rateLimitRetryAt = now() + rateLimitCooldownMs;
          rateLimitError = unavailable;
          throw unavailable;
        }
        throw error;
      },
    );
    const entry: InFlightV1<T> = {
      generation: requestGeneration,
      key,
      promise: request,
    };
    inFlightByKey.set(key, entry);
    sourceInFlight = request;
    request.then(
      () => {
        if (inFlightByKey.get(key) === entry) inFlightByKey.delete(key);
        if (sourceInFlight === request) sourceInFlight = null;
      },
      () => {
        if (inFlightByKey.get(key) === entry) inFlightByKey.delete(key);
        if (sourceInFlight === request) sourceInFlight = null;
      },
    );
    return request;
  };

  const invalidate = (): void => {
    generation += 1;
    cachedByKey.clear();
  };

  const setSource = (nextSource: () => Promise<T>): void => {
    if (typeof nextSource !== "function") {
      throw new TypeError("Applicant refresh source is invalid");
    }
    source = nextSource;
  };

  return Object.freeze({ refresh, invalidate, setSource });
}

export function applicantRefreshUserIsRateLimitedV1(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const record = error as Readonly<Record<string, unknown>>;
  return record.privyErrorCode === "too_many_requests"
    || record.code === "too_many_requests"
    || record.status === 429
    || record.name === "TooManyRequestsError";
}

export function isApplicantRefreshUserUnavailableErrorV1(
  error: unknown,
): error is ApplicantRefreshUserUnavailableErrorV1 {
  return error instanceof ApplicantRefreshUserUnavailableErrorV1;
}
