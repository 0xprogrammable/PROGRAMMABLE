import { HttpRequestError, TimeoutError } from "viem";

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const PRESERVED_HTTP_STATUSES = new Set([
  ...RETRYABLE_HTTP_STATUSES,
  413,
]);
const DEFAULT_DELAYS_MS = [200, 800] as const;
const MAXIMUM_ATTEMPTS = 3;
const MAXIMUM_DEADLINE_MS = 20_000;
const MAXIMUM_CALL_BUDGET = 256;

export type RpcRetryOptions = Readonly<{
  maximumAttempts?: number;
  delaysMs?: readonly number[];
  deadlineMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}>;

export type RpcCallBudget = Readonly<{
  claim: () => number;
  remainingMs: () => number;
}>;

export class RpcRetriesExhaustedError extends Error {
  constructor(providerId: string, operation: string, cause: unknown) {
    super(`${providerId} exhausted transient retries for ${operation}`, {
      cause,
    });
    this.name = "RpcRetriesExhaustedError";
  }
}

export class RpcDeadlineExceededError extends Error {
  constructor(providerId: string, operation: string) {
    super(`${providerId} exceeded the deadline for ${operation}`);
    this.name = "RpcDeadlineExceededError";
  }
}

export class RpcCallBudgetExceededError extends Error {
  constructor(providerId: string, operation: string) {
    super(`${providerId} exhausted the call budget for ${operation}`);
    this.name = "RpcCallBudgetExceededError";
  }
}

function requireBoundedInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function createRpcCallBudget({
  providerId,
  operationName,
  maximumCalls,
  deadlineMs,
}: Readonly<{
  providerId: string;
  operationName: string;
  maximumCalls: number;
  deadlineMs: number;
}>): RpcCallBudget {
  requireBoundedInteger(
    maximumCalls,
    "maximumCalls",
    1,
    MAXIMUM_CALL_BUDGET,
  );
  requireBoundedInteger(deadlineMs, "deadlineMs", 1, MAXIMUM_DEADLINE_MS);
  const startedAt = Date.now();
  let calls = 0;
  return Object.freeze({
    claim() {
      const remainingMs = deadlineMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        throw new RpcDeadlineExceededError(providerId, operationName);
      }
      if (calls >= maximumCalls) {
        throw new RpcCallBudgetExceededError(providerId, operationName);
      }
      calls += 1;
      return remainingMs;
    },
    remainingMs() {
      return Math.max(0, deadlineMs - (Date.now() - startedAt));
    },
  });
}

export function isTransientRpcError(error: unknown) {
  if (error instanceof TimeoutError) return true;
  if (error instanceof HttpRequestError) {
    if (error.status !== undefined) {
      return RETRYABLE_HTTP_STATUSES.has(error.status);
    }
    return error.cause instanceof TypeError;
  }
  return false;
}

export function preserveTypedHttpError(response: Response, url: string) {
  if (!PRESERVED_HTTP_STATUSES.has(response.status)) return;
  throw new HttpRequestError({
    headers: response.headers,
    status: response.status,
    url,
  });
}

function retryAfterMs(error: unknown) {
  if (!(error instanceof HttpRequestError)) return null;
  const value = error.headers?.get("Retry-After");
  if (!value || !/^\d+$/.test(value)) return null;
  return Math.min(Number(value) * 1_000, 2_000);
}

function withHardDeadline<T>(
  operation: () => Promise<T>,
  remainingMs: number,
  providerId: string,
  operationName: string,
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation(),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(new RpcDeadlineExceededError(providerId, operationName)),
        remainingMs,
      );
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

export async function withBoundedRpcRetry<T>(
  operation: (attempt: number, remainingMs: number) => Promise<T>,
  {
    providerId,
    operationName,
    retryOptions = {},
    budget,
  }: Readonly<{
    providerId: string;
    operationName: string;
    retryOptions?: RpcRetryOptions;
    budget?: RpcCallBudget;
  }>,
): Promise<T> {
  const maximumAttempts = requireBoundedInteger(
    retryOptions.maximumAttempts ?? MAXIMUM_ATTEMPTS,
    "maximumAttempts",
    1,
    MAXIMUM_ATTEMPTS,
  );
  const deadlineMs = requireBoundedInteger(
    retryOptions.deadlineMs ?? MAXIMUM_DEADLINE_MS,
    "deadlineMs",
    1,
    MAXIMUM_DEADLINE_MS,
  );
  const delaysMs = retryOptions.delaysMs ?? DEFAULT_DELAYS_MS;
  const sleep =
    retryOptions.sleep ??
    ((delay: number) =>
      new Promise<void>((resolvePromise) =>
        setTimeout(resolvePromise, delay),
      ));
  const callBudget =
    budget ??
    createRpcCallBudget({
      providerId,
      operationName,
      maximumCalls: maximumAttempts,
      deadlineMs,
    });

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const remainingMs = callBudget.claim();
    try {
      return await withHardDeadline(
        () => operation(attempt, remainingMs),
        remainingMs,
        providerId,
        operationName,
      );
    } catch (error) {
      if (!isTransientRpcError(error)) throw error;
      if (attempt === maximumAttempts) {
        throw new RpcRetriesExhaustedError(
          providerId,
          operationName,
          error,
        );
      }
      const configuredDelay =
        delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 0;
      const delayMs = retryAfterMs(error) ?? configuredDelay;
      if (callBudget.remainingMs() <= delayMs) {
        throw new RpcDeadlineExceededError(providerId, operationName);
      }
      await withHardDeadline(
        () => sleep(delayMs),
        callBudget.remainingMs(),
        providerId,
        operationName,
      );
    }
  }

  throw new RpcRetriesExhaustedError(
    providerId,
    operationName,
    new Error("unreachable retry state"),
  );
}
