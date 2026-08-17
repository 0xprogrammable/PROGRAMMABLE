import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

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
import {
  ActionRpcIdentityError,
  readTradeActionModelFromRpc,
} from "../../../../lib/server/action-rpc-identity.server";
import { getWebsiteReadOnchainDeployment } from
  "../../../../lib/onchain/config";
import { withOperationalRpcFailover } from
  "../../../../lib/onchain/operational-rpc-failover.server";
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
  client: PublicClient,
): ClassicTradeRuntimeClient {
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
    if (actionChainId !== 1) {
      throw new ClassicTradeUnavailableError(
        "Trading identity is only available on Ethereum mainnet",
      );
    }
    const rpcDeployment = getWebsiteReadOnchainDeployment("production");
    if (
      rpcDeployment.status !== "ready" ||
      rpcDeployment.chainId !== actionChainId
    ) {
      throw new ClassicTradeUnavailableError(
        "The configured Ethereum RPC is unavailable",
      );
    }
    const prepared = await withOperationalRpcFailover(
      rpcDeployment,
      async ({ rpcUrl }) => {
        const client = createPublicClient({
          chain: actionChainId === 1 ? mainnet : sepolia,
          transport: http(rpcUrl, {
            retryCount: 1,
            timeout: 12_000,
          }),
        });
        const blockNumber = await client.getBlockNumber();
        const block = await client.getBlock({ blockNumber });
        if (!block.hash) {
          throw new Error("The action snapshot has no block hash");
        }
        const registry = await readTradeActionModelFromRpc({
          client,
          chainId: actionChainId,
          token: tradeRequest.token,
          blockNumber,
          blockHash: block.hash,
        });
        const indexedToken = registry.tokens.find(
          (candidate) =>
            candidate.tokenAddress.toLowerCase() ===
            tradeRequest.token.toLowerCase(),
        );
        if (indexedToken?.launchModel === "stock-paired") {
          const { deployment } = resolveStockPairedTradeDeployment(
            tradeRequest.chainId,
            registry,
            tradeRequest.token,
          );
          return prepareStockPairedTrade(
            runtimeClient(client),
            deployment,
            tradeRequest,
          );
        }
        const deployment = resolveTradeDeployment(
          tradeRequest.chainId,
          registry,
          tradeRequest.token,
        );
        return prepareClassicTrade(
          runtimeClient(client),
          deployment,
          tradeRequest,
          registry,
        );
      },
    );
    return json(prepared);
  } catch (error) {
    if (error instanceof ClassicTradeInputError) {
      return json({ error: error.message }, 400);
    }
    if (
      error instanceof ClassicTradeUnavailableError ||
      error instanceof StockPairedTradeUnavailableError ||
      error instanceof ActionRpcIdentityError
    ) {
      return json({ error: error.message }, 409);
    }
    console.error(
      "Trade preparation failed",
      safeServerErrorSummary(error),
    );
    return json(
      {
        error:
          "The configured RPC could not prepare the trade from the current onchain state",
      },
      502,
    );
  }
}
