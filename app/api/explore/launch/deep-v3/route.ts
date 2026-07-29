import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";

import {
  parseDeepV3LaunchReceipts,
  type DeepV3LaunchReceipt,
} from "@/lib/deep-v3-launch-confirmation";
import {
  configuredMainnetDeepV3Manifest,
} from "@/lib/deep-v3-release";
import { requireIndependentDeepV3RpcUrls } from "@/lib/deep-v3-runtime-binding";
import {
  resolveVerifiedDeepV3ReadRelease,
} from "@/lib/onchain/deep-v3-read-model";
import {
  readDeepV3ProfileToken,
  type DeepV3ProfileClient,
} from "@/lib/profile/deep-v3-profile.server";
import { safeServerErrorSummary } from "@/lib/server/safe-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONFIRMATIONS = 12n;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, max-age=0, no-store" },
  });
}

function isReceiptPending(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "TransactionReceiptNotFoundError" ||
      error.name === "TransactionNotFoundError")
  );
}

function receiptShape(
  receipt: Awaited<
    ReturnType<
      ReturnType<typeof createPublicClient>["getTransactionReceipt"]
    >
  >,
): DeepV3LaunchReceipt {
  return {
    status: receipt.status,
    from: receipt.from,
    to: receipt.to,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    transactionHash: receipt.transactionHash,
    transactionIndex: receipt.transactionIndex,
    logs: receipt.logs.map((log) => ({
      address: log.address,
      topics: log.topics as readonly Hex[],
      data: log.data,
      logIndex: log.logIndex,
    })),
  };
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some(
      (key) => key !== "account" && key !== "transaction",
    ) ||
    search.getAll("account").length !== 1 ||
    search.getAll("transaction").length !== 1
  ) {
    return json({ error: "Unsupported query parameters" }, 400);
  }
  const rawAccount = search.get("account")?.trim() ?? "";
  const rawTransaction = search.get("transaction")?.trim() ?? "";
  if (!isAddress(rawAccount)) {
    return json({ error: "Enter a valid Ethereum wallet" }, 400);
  }
  if (
    !isHex(rawTransaction, { strict: true }) ||
    rawTransaction.length !== 66
  ) {
    return json({ error: "Enter a valid launch transaction hash" }, 400);
  }

  const release = resolveVerifiedDeepV3ReadRelease(
    configuredMainnetDeepV3Manifest,
    1,
  );
  if (!release) {
    return json(
      { error: "Deep is not enabled by the verified release manifest" },
      503,
    );
  }

  let endpoints: readonly [string, string];
  try {
    endpoints = requireIndependentDeepV3RpcUrls(
      process.env.ETHEREUM_RPC_URL,
      process.env.ETHEREUM_RPC_URL_B,
    );
  } catch (error) {
    console.error(
      "Deep V3 launch confirmation RPC setup failed",
      safeServerErrorSummary(error),
    );
    return json(
      { error: "Launch confirmation is temporarily unavailable" },
      503,
    );
  }
  const clients = endpoints.map((endpoint) =>
    createPublicClient({
      chain: mainnet,
      transport: http(endpoint, {
        retryCount: 1,
        timeout: 12_000,
      }),
    }),
  );

  let receipts;
  try {
    receipts = await Promise.all(
      clients.map((client) =>
        client.getTransactionReceipt({
          hash: rawTransaction as Hex,
        }),
      ),
    );
  } catch (error) {
    if (isReceiptPending(error)) {
      return json({ status: "pending", launch: null }, 202);
    }
    console.error(
      "Deep V3 receipt lookup failed",
      safeServerErrorSummary(error),
    );
    return json(
      { error: "Launch confirmation is temporarily unavailable" },
      503,
    );
  }
  if (receipts.some((receipt) => receipt.status !== "success")) {
    return json({ error: "The Deep launch transaction reverted" }, 409);
  }

  try {
    const heads = await Promise.all(
      clients.map((client) => client.getBlockNumber()),
    );
    const lowestHead = heads[0] < heads[1] ? heads[0] : heads[1];
    const launchBlock =
      receipts[0].blockNumber < receipts[1].blockNumber
        ? receipts[0].blockNumber
        : receipts[1].blockNumber;
    if (lowestHead < launchBlock + CONFIRMATIONS) {
      return json({ status: "pending", launch: null }, 202);
    }

    const account = getAddress(rawAccount) as Address;
    const transactionHash = rawTransaction as Hex;
    const provenance = parseDeepV3LaunchReceipts({
      receipts: receipts.map(receiptShape),
      release: {
        startBlock: release.startBlock,
        launcher: release.addresses.launcher,
        feeHook: release.addresses.feeHook,
      },
      account,
      transactionHash,
    });
    const profile = await readDeepV3ProfileToken({
      manifest: configuredMainnetDeepV3Manifest,
      chainId: 1,
      account,
      candidate: provenance,
      clients:
        clients as unknown as readonly DeepV3ProfileClient[],
    });

    return json({
      status: "ready",
      launch: {
        tokenAddress: profile.token.tokenAddress,
        name: profile.token.tokenName,
        symbol: profile.token.tokenSymbol,
        deepReleaseVersion: profile.token.deepReleaseVersion,
        deepV3Provenance: provenance,
      },
      snapshot: profile.snapshot,
    });
  } catch (error) {
    console.error(
      "Deep V3 launch confirmation failed",
      safeServerErrorSummary(error),
    );
    return json(
      { error: "Launch confirmation is temporarily unavailable" },
      503,
    );
  }
}
