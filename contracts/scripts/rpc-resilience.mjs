import { HttpRequestError, TimeoutError } from "viem";

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const PRESERVED_HTTP_STATUSES = new Set([
  ...RETRYABLE_HTTP_STATUSES,
  413,
]);
const DEFAULT_DELAYS_MS = [200, 800];
const MAXIMUM_ATTEMPTS = 3;
const MAXIMUM_DEADLINE_MS = 20_000;
const MAXIMUM_CALL_BUDGET = 256;
const MAXIMUM_RETRY_AFTER_MS = 2_000;

export class RpcTransportError extends Error {
  constructor(providerId, cause) {
    super(`${providerId} transport failed`, { cause });
    this.name = "RpcTransportError";
  }
}

export class RpcTimeoutError extends Error {
  constructor(providerId, cause) {
    super(`${providerId} timed out`, { cause });
    this.name = "RpcTimeoutError";
  }
}

export class RpcHttpError extends Error {
  constructor(providerId, status, retryAfterMs = null) {
    super(`${providerId} returned HTTP ${status}`);
    this.name = "RpcHttpError";
    this.status = status;
    this.retryAfterMs =
      Number.isFinite(retryAfterMs) && retryAfterMs >= 0
        ? Math.min(retryAfterMs, MAXIMUM_RETRY_AFTER_MS)
        : null;
  }
}

export class RpcRequestShapeUnsupportedError extends Error {
  constructor(providerId, operation) {
    super(`${providerId} does not support ${operation}`);
    this.name = "RpcRequestShapeUnsupportedError";
  }
}

export class RpcRetriesExhaustedError extends Error {
  constructor(providerId, operation, cause) {
    super(`${providerId} exhausted transient retries for ${operation}`, {
      cause,
    });
    this.name = "RpcRetriesExhaustedError";
  }
}

export class RpcDeadlineExceededError extends Error {
  constructor(providerId, operation) {
    super(`${providerId} exceeded the deadline for ${operation}`);
    this.name = "RpcDeadlineExceededError";
  }
}

export class RpcCallBudgetExceededError extends Error {
  constructor(providerId, operation) {
    super(`${providerId} exhausted the call budget for ${operation}`);
    this.name = "RpcCallBudgetExceededError";
  }
}

function requireBoundedInteger(value, label, minimum, maximum) {
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
  maximumCalls = MAXIMUM_ATTEMPTS,
  deadlineMs = MAXIMUM_DEADLINE_MS,
}) {
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

function isTypedTransportError(error) {
  return (
    error instanceof RpcTransportError ||
    (error instanceof HttpRequestError &&
      error.status === undefined &&
      error.cause instanceof TypeError)
  );
}

export function isTransientRpcError(error) {
  if (error instanceof RpcTimeoutError || error instanceof TimeoutError) {
    return true;
  }
  if (isTypedTransportError(error)) return true;
  if (error instanceof RpcHttpError) {
    return RETRYABLE_HTTP_STATUSES.has(error.status);
  }
  if (error instanceof HttpRequestError && error.status !== undefined) {
    return RETRYABLE_HTTP_STATUSES.has(error.status);
  }
  return false;
}

export function isRequestShapeUnsupportedError(error) {
  return (
    error instanceof RpcRequestShapeUnsupportedError ||
    (error instanceof HttpRequestError && error.status === 413)
  );
}

export function preserveTypedHttpError(response, url) {
  if (!PRESERVED_HTTP_STATUSES.has(response.status)) return;
  throw new HttpRequestError({
    headers: response.headers,
    status: response.status,
    url,
  });
}

function retryAfterMs(error) {
  if (error instanceof RpcHttpError) return error.retryAfterMs;
  if (error instanceof HttpRequestError) {
    const value = error.headers?.get("Retry-After");
    if (value && /^\d+$/.test(value)) {
      return Math.min(Number(value) * 1_000, MAXIMUM_RETRY_AFTER_MS);
    }
  }
  return null;
}

function withHardDeadline(operation, remainingMs, providerId, operationName) {
  let timeoutId;
  return Promise.race([
    operation(),
    new Promise((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(new RpcDeadlineExceededError(providerId, operationName)),
        remainingMs,
      );
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

export async function withBoundedRpcRetry(
  operation,
  {
    providerId = "RPC provider",
    operationName = "RPC read",
    maximumAttempts = MAXIMUM_ATTEMPTS,
    delaysMs = DEFAULT_DELAYS_MS,
    deadlineMs = MAXIMUM_DEADLINE_MS,
    sleep = (delayMs) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs)),
    budget = createRpcCallBudget({
      providerId,
      operationName,
      maximumCalls: maximumAttempts,
      deadlineMs,
    }),
  } = {},
) {
  requireBoundedInteger(
    maximumAttempts,
    "maximumAttempts",
    1,
    MAXIMUM_ATTEMPTS,
  );

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const remainingMs = budget.claim();
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
        throw new RpcRetriesExhaustedError(providerId, operationName, error);
      }
      const configuredDelay =
        delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 0;
      const delayMs = retryAfterMs(error) ?? configuredDelay;
      const remainingBeforeDelay = budget.remainingMs();
      if (remainingBeforeDelay <= delayMs) {
        throw new RpcDeadlineExceededError(providerId, operationName);
      }
      await withHardDeadline(
        () => sleep(delayMs),
        remainingBeforeDelay,
        providerId,
        operationName,
      );
    }
  }

  throw new RpcRetriesExhaustedError(providerId, operationName);
}
