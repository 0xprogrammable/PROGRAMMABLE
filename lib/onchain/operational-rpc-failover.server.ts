import "server-only";

import {
  HttpRequestError,
  RpcRequestError,
  SocketClosedError,
  TimeoutError,
} from "viem";

import type { OnchainDeployment } from "./types";

const CAPACITY_MESSAGE =
  /(?:monthly[_\s-]*capacity[_\s-]*(?:exceeded|reached)|capacity[_\s-]*(?:exceeded|reached)|rate[_\s-]*limit(?:ed)?|too many requests)/iu;
const ARCHIVE_LIMITATION_MESSAGE =
  /archive requests require a personal token/iu;

function errorChain(error: unknown) {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return chain;
}

function rpcCapacityMessage(error: RpcRequestError) {
  const details = [
    error.details,
    typeof error.data === "string" ? error.data : undefined,
    error.cause instanceof Error ? error.cause.message : undefined,
  ].filter((value): value is string => Boolean(value));
  return details.some((value) => CAPACITY_MESSAGE.test(value));
}

function rpcArchiveLimitationMessage(error: RpcRequestError) {
  const details = [
    error.details,
    typeof error.data === "string" ? error.data : undefined,
    error.cause instanceof Error ? error.cause.message : undefined,
  ].filter((value): value is string => Boolean(value));
  return details.some((value) => ARCHIVE_LIMITATION_MESSAGE.test(value));
}

/**
 * Provider failover is intentionally narrower than a generic retry. A
 * secondary RPC is eligible only when the primary transport is unavailable or
 * explicitly rejects capacity. Contract, chain, decoding and integrity errors
 * stay on the primary path and remain visible to the caller.
 */
export function isOperationalRpcFailoverEligible(error: unknown) {
  return errorChain(error).some((candidate) => {
    if (candidate instanceof OperationalRpcUnavailableError) return true;
    if (
      candidate instanceof TimeoutError ||
      candidate instanceof SocketClosedError
    ) {
      return true;
    }
    if (candidate instanceof HttpRequestError) {
      return (
        candidate.status === undefined ||
        candidate.status === 408 ||
        candidate.status === 429 ||
        candidate.status >= 500
      );
    }
    if (candidate instanceof RpcRequestError) {
      return (
        candidate.code === 429 ||
        candidate.code === -32_005 ||
        rpcCapacityMessage(candidate) ||
        rpcArchiveLimitationMessage(candidate)
      );
    }
    return false;
  });
}

function singleRpcDeployment<Deployment extends OnchainDeployment>(
  deployment: Deployment,
  rpcUrl: string,
): Deployment {
  return {
    ...deployment,
    rpcUrl,
    rpcUrlSecondary: null,
  } as Deployment;
}

export class OperationalRpcUnavailableError extends Error {
  override name = "OperationalRpcUnavailableError";

  constructor() {
    super("Operational RPC reads are temporarily unavailable");
  }
}

/**
 * Runs one complete read against the configured primary. The fixed secondary
 * receives exactly one attempt only after an eligible transport/capacity
 * failure. Reads never rotate providers mid-operation.
 */
export async function withOperationalRpcFailover<
  Deployment extends OnchainDeployment,
  Output,
>(
  deployment: Deployment,
  read: (deployment: Deployment) => Promise<Output>,
) {
  const primary = singleRpcDeployment(deployment, deployment.rpcUrl);
  try {
    return await read(primary);
  } catch (primaryError) {
    const secondaryUrl = deployment.rpcUrlSecondary;
    if (
      !secondaryUrl ||
      secondaryUrl === deployment.rpcUrl ||
      !isOperationalRpcFailoverEligible(primaryError)
    ) {
      throw primaryError;
    }

    try {
      return await read(singleRpcDeployment(deployment, secondaryUrl));
    } catch (secondaryError) {
      if (isOperationalRpcFailoverEligible(secondaryError)) {
        // Do not retain transport errors: framework cache logging serializes
        // nested causes and can otherwise expose authenticated RPC URLs.
        throw new OperationalRpcUnavailableError();
      }
      throw secondaryError;
    }
  }
}

/** Provider-neutral telemetry fields; endpoint URLs and request bodies stay out. */
export function safeOperationalRpcError(error: unknown) {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  return {
    name: error.name,
    category: isOperationalRpcFailoverEligible(error)
      ? "rpc-unavailable"
      : "read-failed",
  } as const;
}
