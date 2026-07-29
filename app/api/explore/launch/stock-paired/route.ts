import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  isHex,
  parseAbiItem,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";

import { uerc20ReadAbi } from "@/lib/onchain/abis";
import { safeServerErrorSummary } from "@/lib/server/safe-error";
import { getConfiguredStockPairedRelease } from "@/lib/stock-paired-release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const launchEvent = parseAbiItem(
  "event StockPairedTokenLaunched(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,address rewardVault,address positionRecipient,uint256 positionTokenId,bytes32 launchHash)",
);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function endpoints() {
  const primary =
    process.env.ETHEREUM_RPC_URL ??
    "https://ethereum-rpc.publicnode.com";
  const secondary =
    process.env.ETHEREUM_RPC_URL_B ??
    process.env.ETHEREUM_RPC_URL_SECONDARY ??
    (primary === "https://ethereum-rpc.publicnode.com"
      ? "https://rpc.mevblocker.io"
      : "https://ethereum-rpc.publicnode.com");
  return [primary, secondary] as const;
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
  const accountInput = search.get("account")?.trim() ?? "";
  const transactionInput = search.get("transaction")?.trim() ?? "";
  if (
    !isAddress(accountInput) ||
    !isHex(transactionInput, { strict: true }) ||
    transactionInput.length !== 66
  ) {
    return json({ error: "Invalid Stock-Paired launch lookup" }, 400);
  }
  const release = getConfiguredStockPairedRelease();
  if (!release) {
    return json({ status: "not-deployed", launch: null }, 409);
  }

  const account = getAddress(accountInput);
  const transactionHash = transactionInput as Hex;
  const clients = endpoints().map((endpoint) =>
    createPublicClient({
      chain: mainnet,
      transport: http(endpoint, { retryCount: 1, timeout: 12_000 }),
    }),
  );

  try {
    const receipts = await Promise.all(
      clients.map((client) =>
        client.getTransactionReceipt({ hash: transactionHash }),
      ),
    );
    const canonical = receipts[0];
    if (
      receipts.some(
        (receipt) =>
          receipt.status !== "success" ||
          !receipt.to ||
          !receipt.from ||
          receipt.blockHash.toLowerCase() !==
            canonical.blockHash.toLowerCase() ||
          receipt.blockNumber !== canonical.blockNumber ||
          receipt.transactionIndex !== canonical.transactionIndex ||
          receipt.to.toLowerCase() !==
            release.addresses.launcher.toLowerCase() ||
          receipt.from.toLowerCase() !== account.toLowerCase(),
      ) ||
      canonical.blockNumber < BigInt(release.startBlock)
    ) {
      return json({ error: "The Stock-Paired launch receipt is invalid" }, 409);
    }

    const launchLogs = canonical.logs.flatMap((log) => {
      if (
        log.address.toLowerCase() !==
        release.addresses.launcher.toLowerCase()
      ) {
        return [];
      }
      try {
        const decoded = decodeEventLog({
          abi: [launchEvent],
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        return decoded.eventName === "StockPairedTokenLaunched"
          ? [decoded.args]
          : [];
      } catch {
        return [];
      }
    });
    if (
      launchLogs.length !== 1 ||
      launchLogs[0].deployer.toLowerCase() !== account.toLowerCase()
    ) {
      return json({ error: "The launch event could not be verified" }, 409);
    }

    const token = getAddress(launchLogs[0].token);
    const [name, symbol] = await Promise.all([
      clients[0].readContract({
        address: token,
        abi: uerc20ReadAbi,
        functionName: "name",
      }),
      clients[0].readContract({
        address: token,
        abi: uerc20ReadAbi,
        functionName: "symbol",
      }),
    ]);
    return json({
      status: "ready",
      launch: {
        tokenAddress: token,
        name,
        symbol,
        quoteAsset: getAddress(launchLogs[0].quoteAsset),
        poolId: launchLogs[0].poolId,
        rewardVault: getAddress(launchLogs[0].rewardVault),
        positionRecipient: getAddress(
          launchLogs[0].positionRecipient,
        ),
        positionTokenId: launchLogs[0].positionTokenId.toString(),
        transactionHash,
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TransactionReceiptNotFoundError" ||
        error.message.includes("could not be found"))
    ) {
      return json({ status: "pending", launch: null }, 202);
    }
    console.error(
      "Stock-Paired launch lookup failed",
      safeServerErrorSummary(error),
    );
    return json({ error: "The launch receipt is temporarily unavailable" }, 503);
  }
}
