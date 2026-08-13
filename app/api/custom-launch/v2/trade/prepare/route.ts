import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { mainnet, sepolia } from "viem/chains";

import {
  CustomMarketTradeInputErrorV1,
  CustomMarketTradeUnavailableErrorV1,
  parseCustomMarketTradeRequestV1,
} from "@/lib/custom-launch/trade-v1";
import { tradeActionRpcProviders } from "@/lib/server/action-rpc-quorum.server";
import {
  prepareCustomMarketTradeV1,
  selectConservativeCustomPreparationV1,
  type CustomMarketTradeRuntimeClientV1,
} from "@/lib/server/custom-launch/trade-v1";
import { isCustomLaunchRegistryPublicReadEnabled } from
  "@/lib/server/custom-launch/public-readiness";
import { safeServerErrorSummary } from "@/lib/server/safe-error";

export const dynamic = "force-dynamic";
export const maxDuration = 20;
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 12_000;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function runtimeClient(
  chainId: 1 | 11_155_111,
  endpoint: string,
): CustomMarketTradeRuntimeClientV1 {
  const client = createPublicClient({
    chain: chainId === 1 ? mainnet : sepolia,
    transport: http(endpoint, { retryCount: 1, timeout: 12_000 }),
  });
  return {
    getChainId: () => client.getChainId(),
    async getBlock() {
      const block = await client.getBlock({ blockTag: "latest" });
      if (block.number === null) throw new Error("Latest block number is unavailable");
      return { number: block.number, timestamp: block.timestamp };
    },
    getBalance: ({ address }) => client.getBalance({ address, blockTag: "latest" }),
    getGasPrice: () => client.getGasPrice(),
    getCode: ({ address }) => client.getCode({ address, blockTag: "latest" }),
    readContract: (input) => client.readContract(input as never) as Promise<unknown>,
    estimateGas: (input: {
      account: Address;
      to: Address;
      data: Hex;
      value: bigint;
    }) => client.estimateGas(input),
    async call(input: {
      account?: Address;
      to: Address;
      data: Hex;
      value?: bigint;
    }) {
      const result = await client.call(input);
      return { data: result.data };
    },
  };
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: "The Custom trade request is too large" }, 413);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) {
      return json({ error: "The Custom trade request is too large" }, 413);
    }
    body = JSON.parse(text) as unknown;
  } catch {
    return json({ error: "Send a valid JSON Custom trade request" }, 400);
  }
  try {
    if (!isCustomLaunchRegistryPublicReadEnabled()) {
      throw new CustomMarketTradeUnavailableErrorV1(
        "Custom trade preparation is unavailable",
      );
    }
    const tradeRequest = parseCustomMarketTradeRequestV1(body);
    const providers = tradeActionRpcProviders(tradeRequest.chainId);
    const results = await Promise.allSettled(providers.map(({ endpoint }) =>
      prepareCustomMarketTradeV1({
        client: runtimeClient(tradeRequest.chainId, endpoint),
        request: tradeRequest,
      })));
    const inputFailure = results.find((result): result is PromiseRejectedResult =>
      result.status === "rejected"
      && result.reason instanceof CustomMarketTradeInputErrorV1);
    if (inputFailure) throw inputFailure.reason;
    if (results.some((result) => result.status === "rejected")) {
      throw new CustomMarketTradeUnavailableErrorV1(
        "The Custom trade could not be verified across independent RPCs",
      );
    }
    const [first, second] = results.map((result) =>
      (result as PromiseFulfilledResult<Awaited<ReturnType<
        typeof prepareCustomMarketTradeV1
      >>>).value);
    return json(selectConservativeCustomPreparationV1(first, second));
  } catch (error) {
    if (error instanceof CustomMarketTradeInputErrorV1) {
      return json({ error: error.message }, 400);
    }
    if (error instanceof CustomMarketTradeUnavailableErrorV1) {
      return json({ error: error.message }, 409);
    }
    console.error("Custom trade preparation failed", safeServerErrorSummary(error));
    return json({
      error: "The Custom trade could not be prepared from current onchain state",
    }, 502);
  }
}
