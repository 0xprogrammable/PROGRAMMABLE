import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import {
  getOnchainDeployment,
  readExploreModel,
} from "../../../../lib/onchain";
import {
  ClassicTradeInputError,
} from "../../../../lib/trade/classic";
import {
  ClassicTradeUnavailableError,
  parseClassicTradeRequest,
  prepareClassicTrade,
  resolveClassicTradeDeployment,
  type ClassicTradeRuntimeClient,
} from "../../../../lib/trade/server";

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

function runtimeClient(chainId: number): ClassicTradeRuntimeClient {
  const chain = chainId === 1 ? mainnet : sepolia;
  const endpoint =
    chainId === 1
      ? process.env.ETHEREUM_RPC_URL ??
        "https://ethereum-rpc.publicnode.com"
      : process.env.SEPOLIA_RPC_URL ??
        "https://ethereum-sepolia-rpc.publicnode.com";
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
    getCode: ({ address }: { address: Address }) =>
      client.getCode({ address }),
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
    const deployment = resolveClassicTradeDeployment(
      tradeRequest.chainId,
    );
    const registryDeployment = getOnchainDeployment(
      tradeRequest.chainId === 1 ? "production" : "rehearsal",
    );
    const registry = await readExploreModel(registryDeployment);
    const prepared = await prepareClassicTrade(
      runtimeClient(tradeRequest.chainId),
      deployment,
      tradeRequest,
      registry,
    );
    return json(prepared);
  } catch (error) {
    if (error instanceof ClassicTradeInputError) {
      return json({ error: error.message }, 400);
    }
    if (error instanceof ClassicTradeUnavailableError) {
      return json({ error: error.message }, 409);
    }
    return json(
      {
        error:
          "The trade could not be prepared from the current onchain state",
      },
      502,
    );
  }
}
