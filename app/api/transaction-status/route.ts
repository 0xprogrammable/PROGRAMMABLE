import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isHex, type Hex } from "viem";
import { mainnet, sepolia } from "viem/chains";

import { getOnchainDeployment } from "@/lib/onchain/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TransactionLookupClient = Pick<
  ReturnType<typeof createPublicClient>,
  "getTransaction" | "getTransactionReceipt"
>;

type TransactionLookup =
  | {
      status: "confirmed";
      blockNumber: string;
    }
  | {
      status: "reverted";
      blockNumber: string;
    }
  | {
      status: "pending";
      blockNumber: null;
    }
  | {
      status: "not-found";
      blockNumber: null;
    }
  | {
      status: "unavailable";
      error: unknown;
    };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isTransactionNotFoundError(
  error: unknown,
  kind: "receipt" | "transaction",
) {
  if (!(error instanceof Error)) {
    return false;
  }

  if (
    kind === "receipt" &&
    error.name === "TransactionReceiptNotFoundError"
  ) {
    return true;
  }
  if (
    kind === "transaction" &&
    error.name === "TransactionNotFoundError"
  ) {
    return true;
  }

  const message = error.message.toLowerCase();
  const mentionsExpectedSubject =
    kind === "receipt"
      ? message.includes("transaction receipt")
      : message.includes("transaction") &&
        !message.includes("transaction receipt");
  return (
    mentionsExpectedSubject &&
    (message.includes("could not be found") ||
      message.includes(
        kind === "receipt"
          ? "transaction receipt not found"
          : "transaction not found",
      ))
  );
}

async function lookupTransaction(
  client: TransactionLookupClient,
  hash: Hex,
): Promise<TransactionLookup> {
  try {
    const receipt = await client.getTransactionReceipt({ hash });
    return {
      status: receipt.status === "success" ? "confirmed" : "reverted",
      blockNumber: receipt.blockNumber.toString(),
    };
  } catch (error) {
    if (!isTransactionNotFoundError(error, "receipt")) {
      return { status: "unavailable", error };
    }
  }

  try {
    await client.getTransaction({ hash });
    return { status: "pending", blockNumber: null };
  } catch (error) {
    if (isTransactionNotFoundError(error, "transaction")) {
      return { status: "not-found", blockNumber: null };
    }
    return { status: "unavailable", error };
  }
}

function publicClient(
  rpcUrl: string,
  requestedChainId: 1 | 11_155_111,
) {
  return createPublicClient({
    chain: requestedChainId === 1 ? mainnet : sepolia,
    transport: http(rpcUrl, {
      retryCount: 1,
      timeout: 12_000,
    }),
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

  const transactionHash = hash as Hex;
  const secondaryRpcUrl =
    deployment.rpcUrlSecondary &&
    deployment.rpcUrlSecondary !== deployment.rpcUrl
      ? deployment.rpcUrlSecondary
      : null;
  const primaryLookup = lookupTransaction(
    publicClient(deployment.rpcUrl, requestedChainId),
    transactionHash,
  );
  const secondaryLookup = secondaryRpcUrl
    ? lookupTransaction(
        publicClient(secondaryRpcUrl, requestedChainId),
        transactionHash,
      )
    : null;
  const primary = await primaryLookup;

  if (primary.status === "confirmed" || primary.status === "reverted") {
    return json(primary);
  }

  if (!secondaryLookup) {
    if (primary.status === "pending") {
      return json(primary);
    }
    if (primary.status === "not-found") {
      return json(primary);
    }
    console.error("Transaction status lookup failed", primary.error);
    return json({ error: "Transaction status is unavailable" }, 503);
  }

  const secondary = await secondaryLookup;

  if (primary.status === "pending") {
    if (
      secondary.status === "confirmed" ||
      secondary.status === "reverted"
    ) {
      return json(secondary);
    }
    return json(primary);
  }

  if (
    secondary.status !== "not-found" &&
    secondary.status !== "unavailable"
  ) {
    return json(secondary);
  }

  if (
    primary.status === "not-found" &&
    secondary.status === "not-found"
  ) {
    return json({ status: "not-found", blockNumber: null });
  }

  console.error("Transaction status lookup failed", {
    primary:
      primary.status === "unavailable" ? primary.error : primary.status,
    secondary:
      secondary.status === "unavailable"
        ? secondary.error
        : secondary.status,
  });
  return json({ error: "Transaction status is unavailable" }, 503);
}
