import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isHex, type Hex } from "viem";
import { mainnet, sepolia } from "viem/chains";

import { getOnchainDeployment } from "@/lib/onchain/config";
import { stockPairedActionRpcProviders } from "@/lib/server/action-rpc-quorum.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TransactionLookupClient = Pick<
  ReturnType<typeof createPublicClient>,
  "getTransaction" | "getTransactionReceipt"
>;

type TerminalTransactionLookup = {
  status: "confirmed" | "reverted";
  blockNumber: string;
  receiptIdentity: string;
};

type TransactionLookup =
  | TerminalTransactionLookup
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

function publicTransactionStatus(
  lookup: Exclude<TransactionLookup, { status: "unavailable" }>,
) {
  if (lookup.status === "confirmed" || lookup.status === "reverted") {
    return {
      status: lookup.status,
      blockNumber: lookup.blockNumber,
    };
  }
  return {
    status: lookup.status,
    blockNumber: lookup.blockNumber,
  };
}

function lookupErrorOrStatus(lookup: TransactionLookup) {
  if (lookup.status === "unavailable") {
    return lookup.error;
  }
  return lookup.status;
}

function terminalReceiptIdentity(receipt: {
  status: string;
  blockHash?: string;
  blockNumber: bigint;
  transactionIndex?: number;
  to?: string | null;
  from?: string;
}) {
  return [
    receipt.status,
    receipt.blockHash?.toLowerCase() ?? "",
    receipt.blockNumber.toString(),
    receipt.transactionIndex?.toString() ?? "",
    receipt.to?.toLowerCase() ?? "",
    receipt.from?.toLowerCase() ?? "",
  ].join(":");
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
      receiptIdentity: terminalReceiptIdentity(receipt),
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
  const policy = request.nextUrl.searchParams.get("policy");
  const requestedChainId = Number(
    request.nextUrl.searchParams.get("chainId"),
  );

  if (
    !hash ||
    !isHex(hash, { strict: true }) ||
    hash.length !== 66 ||
    (policy !== null && policy !== "stock-paired") ||
    (requestedChainId !== 1 && requestedChainId !== 11_155_111)
  ) {
    return json({ error: "Invalid transaction lookup" }, 400);
  }

  const transactionHash = hash as Hex;
  if (policy === "stock-paired") {
    if (requestedChainId !== 1) {
      return json(
        { error: "Stock-Paired transaction status is Mainnet-only" },
        409,
      );
    }
    let providers: ReturnType<typeof stockPairedActionRpcProviders>;
    try {
      providers = stockPairedActionRpcProviders();
    } catch {
      return json(
        { error: "Stock-Paired transaction status requires two RPCs" },
        503,
      );
    }
    const [primaryProvider, secondaryProvider] = providers;
    if (!primaryProvider || !secondaryProvider) {
      return json(
        { error: "Stock-Paired transaction status requires two RPCs" },
        503,
      );
    }
    const [primary, secondary] = await Promise.all([
      lookupTransaction(
        publicClient(primaryProvider.endpoint, 1),
        transactionHash,
      ),
      lookupTransaction(
        publicClient(secondaryProvider.endpoint, 1),
        transactionHash,
      ),
    ]);
    const primaryTerminal =
      primary.status === "confirmed" || primary.status === "reverted";
    const secondaryTerminal =
      secondary.status === "confirmed" || secondary.status === "reverted";

    if (primaryTerminal && secondaryTerminal) {
      if (primary.receiptIdentity !== secondary.receiptIdentity) {
        return json(
          { error: "Independent RPCs disagree on the transaction receipt" },
          503,
        );
      }
      return json(publicTransactionStatus(primary));
    }

    if (
      primary.status === "unavailable" ||
      secondary.status === "unavailable"
    ) {
      console.error("Stock-Paired transaction status lookup failed", {
        primary: lookupErrorOrStatus(primary),
        secondary: lookupErrorOrStatus(secondary),
      });
      return json({ error: "Transaction status is unavailable" }, 503);
    }

    return json({ status: "pending", blockNumber: null });
  }

  const deployment = getOnchainDeployment();
  if (deployment.chainId !== requestedChainId) {
    return json({ error: "Transaction network does not match" }, 409);
  }

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
    return json(publicTransactionStatus(primary));
  }

  if (!secondaryLookup) {
    if (primary.status === "pending") {
      return json(publicTransactionStatus(primary));
    }
    if (primary.status === "not-found") {
      return json(publicTransactionStatus(primary));
    }
    console.error(
      "Transaction status lookup failed",
      lookupErrorOrStatus(primary),
    );
    return json({ error: "Transaction status is unavailable" }, 503);
  }

  const secondary = await secondaryLookup;

  if (primary.status === "pending") {
    if (
      secondary.status === "confirmed" ||
      secondary.status === "reverted"
    ) {
      return json(publicTransactionStatus(secondary));
    }
    return json(publicTransactionStatus(primary));
  }

  if (
    secondary.status !== "not-found" &&
    secondary.status !== "unavailable"
  ) {
    return json(publicTransactionStatus(secondary));
  }

  if (
    primary.status === "not-found" &&
    secondary.status === "not-found"
  ) {
    return json({ status: "not-found", blockNumber: null });
  }

  console.error("Transaction status lookup failed", {
    primary: lookupErrorOrStatus(primary),
    secondary: lookupErrorOrStatus(secondary),
  });
  return json({ error: "Transaction status is unavailable" }, 503);
}
