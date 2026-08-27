import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

import {
  getConfiguredClassicV4PublicRelease,
  isClassicV4PublicActionRelease,
} from "../../../../lib/classic-v4-release";
import { getWebsiteReadOnchainDeployment } from
  "../../../../lib/onchain/config";
import { withOperationalRpcFailover } from
  "../../../../lib/onchain/operational-rpc-failover.server";
import {
  ActionRpcIdentityError,
  readTradeActionModelFromRpc,
} from "../../../../lib/server/action-rpc-identity.server";
import { safeServerErrorSummary } from
  "../../../../lib/server/safe-error";
import {
  ClassicBondingInactiveError,
  parseClassicBondingGraduationRequest,
  prepareClassicBondingGraduation,
  type ClassicBondingGraduationRuntimeClient,
} from "../../../../lib/trade/bonding-graduation.server";
import { ClassicTradeInputError } from "../../../../lib/trade/classic";
import { ClassicTradeUnavailableError } from "../../../../lib/trade/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_000;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function runtimeClient(client: PublicClient): ClassicBondingGraduationRuntimeClient {
  return {
    getBalance: ({ address }: { address: Address }) =>
      client.getBalance({ address, blockTag: "latest" }),
    getGasPrice: () => client.getGasPrice(),
    getCode: ({ address, blockNumber }: { address: Address; blockNumber: bigint }) =>
      client.getCode({ address, blockNumber }),
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      const block = await client.getBlock({ blockNumber });
      return { timestamp: block.timestamp };
    },
    readContract: (input) =>
      client.readContract(input as never) as Promise<unknown>,
    async call(args: {
      account: Address;
      to: Address;
      data: Hex;
      value: bigint;
    }) {
      const result = await client.call(args);
      return { data: result.data };
    },
    estimateGas: (args: {
      account: Address;
      to: Address;
      data: Hex;
      value: bigint;
    }) => client.estimateGas(args),
  };
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: "The Bonding request is too large" }, 413);
  }

  let input: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) {
      return json({ error: "The Bonding request is too large" }, 413);
    }
    input = JSON.parse(text);
  } catch {
    return json({ error: "Send a valid JSON Bonding request" }, 400);
  }

  try {
    const bondingRequest = parseClassicBondingGraduationRequest(input);
    const release = getConfiguredClassicV4PublicRelease("production");
    if (!isClassicV4PublicActionRelease(release)) {
      throw new ClassicTradeUnavailableError(
        "Classic V4 Bonding is not publicly available",
      );
    }
    const rpcDeployment = getWebsiteReadOnchainDeployment("production");
    if (rpcDeployment.status !== "ready" || rpcDeployment.chainId !== 1) {
      throw new ClassicTradeUnavailableError(
        "The configured Ethereum RPC is unavailable",
      );
    }

    const prepared = await withOperationalRpcFailover(
      rpcDeployment,
      async ({ rpcUrl }) => {
        const client = createPublicClient({
          chain: mainnet,
          transport: http(rpcUrl, { retryCount: 1, timeout: 12_000 }),
        });
        const blockNumber = await client.getBlockNumber();
        const block = await client.getBlock({ blockNumber });
        if (!block.hash) throw new Error("The action snapshot has no block hash");
        const registry = await readTradeActionModelFromRpc({
          client,
          chainId: 1,
          token: bondingRequest.token,
          blockNumber,
          blockHash: block.hash,
        });
        return prepareClassicBondingGraduation(
          runtimeClient(client),
          release,
          registry,
          bondingRequest,
          blockNumber,
        );
      },
    );
    return json(prepared);
  } catch (error) {
    if (error instanceof ClassicTradeInputError) {
      return json({ error: error.message }, 400);
    }
    if (error instanceof ClassicBondingInactiveError) {
      return json(
        { error: error.message, code: "bonding-inactive" },
        409,
      );
    }
    if (
      error instanceof ClassicTradeUnavailableError ||
      error instanceof ActionRpcIdentityError
    ) {
      return json({ error: error.message }, 409);
    }
    console.error(
      "Bonding Max preparation failed",
      safeServerErrorSummary(error),
    );
    return json(
      {
        error:
          "The configured RPC could not prepare Bonding completion from current onchain state",
      },
      502,
    );
  }
}
