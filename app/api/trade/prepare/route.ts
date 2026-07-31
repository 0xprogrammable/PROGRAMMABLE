import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import {
  ActionLookupError,
  actionTokenAsExploreModel,
  lookupActionTokenByAddress,
} from "../../../../lib/data-pipeline/action-lookup";
import {
  ClassicTradeInputError,
} from "../../../../lib/trade/classic";
import {
  ClassicTradeUnavailableError,
  getPinnedOfficialTradeStack,
  parseClassicTradeRequest,
  prepareClassicTrade,
  resolveTradeDeployment,
  type ClassicTradeRuntimeClient,
} from "../../../../lib/trade/server";
import {
  prepareStockPairedTrade,
  resolveStockPairedTradeDeployment,
  StockPairedTradeUnavailableError,
} from "../../../../lib/trade/stock-paired";
import { tradeActionRpcProviders } from "../../../../lib/server/action-rpc-quorum.server";
import { safeServerErrorSummary } from "../../../../lib/server/safe-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 10_000;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function runtimeClient(
  chainId: number,
  endpoint: string,
): ClassicTradeRuntimeClient {
  const chain = chainId === 1 ? mainnet : sepolia;
  const client = createPublicClient({
    chain,
    transport: http(endpoint, {
      retryCount: 1,
      timeout: 12_000,
    }),
  });

  return {
    getChainId: () => client.getChainId(),
    async getBlock() {
      const block = await client.getBlock({ blockTag: "latest" });
      return { timestamp: block.timestamp };
    },
    getBalance: ({ address }: { address: Address }) =>
      client.getBalance({ address, blockTag: "latest" }),
    getGasPrice: () => client.getGasPrice(),
    getCode: ({
      address,
      blockNumber,
    }: {
      address: Address;
      blockNumber?: bigint;
    }) =>
      client.getCode({
        address,
        ...(blockNumber === undefined
          ? { blockTag: "latest" as const }
          : { blockNumber }),
      }),
    readContract: (input) =>
      client.readContract(input as never) as Promise<unknown>,
    estimateGas: (args: {
      account: Address;
      to: Address;
      data: Hex;
      value: bigint;
    }) => client.estimateGas(args),
    async call(args: {
      to: Address;
      data: Hex;
      account?: Address;
    }) {
      const result = await client.call(args);
      return { data: result.data };
    },
  };
}

function selectConservativeTradeQuote<T extends {
  quote: { amountOut: string };
  transaction: { kind: string };
}>(primary: T, secondary: T) {
  if (primary.transaction.kind !== secondary.transaction.kind) {
    throw new ClassicTradeUnavailableError(
      "Independent RPCs disagree on the required trade step",
    );
  }
  const left = BigInt(primary.quote.amountOut);
  const right = BigInt(secondary.quote.amountOut);
  const high = left > right ? left : right;
  const low = left > right ? right : left;
  if (low <= 0n || (high - low) * 10_000n > low * 300n) {
    throw new ClassicTradeUnavailableError(
      "Independent RPC quotes differ too much",
    );
  }
  return left <= right ? primary : secondary;
}

export async function POST(request: NextRequest) {
  const contentLength = Number(
    request.headers.get("content-length") ?? "0",
  );
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    return json({ error: "The trade request is too large" }, 413);
  }

  let input: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) {
      return json({ error: "The trade request is too large" }, 413);
    }
    input = JSON.parse(text);
  } catch {
    return json({ error: "Send a valid JSON trade request" }, 400);
  }

  try {
    const tradeRequest = parseClassicTradeRequest(input);
    getPinnedOfficialTradeStack(tradeRequest.chainId);
    const actionChainId =
      tradeRequest.chainId === 1 || tradeRequest.chainId === 11_155_111
        ? tradeRequest.chainId
        : (() => {
            throw new ClassicTradeUnavailableError(
              `Classic trading is not supported on chain ${tradeRequest.chainId}`,
            );
          })();
    const indexedLaunch = await lookupActionTokenByAddress({
      chainId: actionChainId,
      token: tradeRequest.token,
    });
    const registry = actionTokenAsExploreModel(indexedLaunch);
    const indexedToken = registry.tokens[0];
    if (indexedToken?.launchModel === "stock-paired") {
      const { deployment } = resolveStockPairedTradeDeployment(
        tradeRequest.chainId,
        registry,
        tradeRequest.token,
      );
      const providers = tradeActionRpcProviders(tradeRequest.chainId);
      const preparations = await Promise.allSettled(
        providers.map((provider) =>
          prepareStockPairedTrade(
            runtimeClient(tradeRequest.chainId, provider.endpoint),
            deployment,
            tradeRequest,
          ),
        ),
      );
      const inputFailure = preparations.find(
        (
          result,
        ): result is PromiseRejectedResult =>
          result.status === "rejected" &&
          result.reason instanceof ClassicTradeInputError,
      );
      if (inputFailure) throw inputFailure.reason;
      if (preparations.some((result) => result.status === "rejected")) {
        throw new ClassicTradeUnavailableError(
          "The Stock-Paired trade could not be verified across both independent RPCs",
        );
      }
      const [primary, secondary] = preparations.map(
        (result) =>
          (
            result as PromiseFulfilledResult<
              Awaited<ReturnType<typeof prepareStockPairedTrade>>
            >
          ).value,
      );
      return json(selectConservativeTradeQuote(primary, secondary));
    }
    const deployment = resolveTradeDeployment(
      tradeRequest.chainId,
      registry,
      tradeRequest.token,
    );
    const providers = tradeActionRpcProviders(tradeRequest.chainId);
    const preparations = await Promise.allSettled(
      providers.map((provider) =>
        prepareClassicTrade(
          runtimeClient(tradeRequest.chainId, provider.endpoint),
          deployment,
          tradeRequest,
          registry,
        ),
      ),
    );
    const inputFailure = preparations.find(
      (
        result,
      ): result is PromiseRejectedResult =>
        result.status === "rejected" &&
        result.reason instanceof ClassicTradeInputError,
    );
    if (inputFailure) {
      throw inputFailure.reason;
    }
    if (preparations.some((result) => result.status === "rejected")) {
      throw new ClassicTradeUnavailableError(
        "The trade could not be verified across both independent RPCs",
      );
    }
    const [primary, secondary] = preparations.map(
      (result) =>
        (result as PromiseFulfilledResult<
          Awaited<ReturnType<typeof prepareClassicTrade>>
        >).value,
    );
    const prepared = selectConservativeTradeQuote(primary, secondary);
    return json(prepared);
  } catch (error) {
    if (error instanceof ClassicTradeInputError) {
      return json({ error: error.message }, 400);
    }
    if (
      error instanceof ClassicTradeUnavailableError ||
      error instanceof StockPairedTradeUnavailableError
    ) {
      return json({ error: error.message }, 409);
    }
    if (error instanceof ActionLookupError) {
      return json(
        { error: "This token is not a verified Programmable launch" },
        409,
      );
    }
    console.error(
      "Trade preparation failed",
      safeServerErrorSummary(error),
    );
    return json(
      {
        error:
          "The trade could not be prepared from the current onchain state",
      },
      502,
    );
  }
}
