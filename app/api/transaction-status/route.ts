import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isHex, type Hex } from "viem";
import { mainnet, sepolia } from "viem/chains";

import { getOnchainDeployment } from "@/lib/onchain/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const hash = request.nextUrl.searchParams.get("hash");
  const requestedChainId = Number(
    request.nextUrl.searchParams.get("chainId"),
  );

  if (
    !hash ||
    !isHex(hash, { strict: true }) ||
    hash.length !== 66 ||
    (requestedChainId !== 1 && requestedChainId !== 11_155_111)
  ) {
    return json({ error: "Invalid transaction lookup" }, 400);
  }

  const deployment = getOnchainDeployment();
  if (deployment.chainId !== requestedChainId) {
    return json({ error: "Transaction network does not match" }, 409);
  }

  const client = createPublicClient({
    chain: requestedChainId === 1 ? mainnet : sepolia,
    transport: http(deployment.rpcUrl, {
      retryCount: 1,
      timeout: 12_000,
    }),
  });

  try {
    const receipt = await client.getTransactionReceipt({
      hash: hash as Hex,
    });
    return json({
      status: receipt.status === "success" ? "confirmed" : "reverted",
      blockNumber: receipt.blockNumber.toString(),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TransactionReceiptNotFoundError" ||
        error.message.includes("could not be found"))
    ) {
      return json({ status: "pending", blockNumber: null });
    }
    console.error("Transaction status lookup failed", error);
    return json({ error: "Transaction status is unavailable" }, 503);
  }
}
