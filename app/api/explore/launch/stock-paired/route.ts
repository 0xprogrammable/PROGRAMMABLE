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
import { getConfiguredStockPairedReleases } from "@/lib/stock-paired-release";
import {
  coordinatePublicRouteRead,
  PUBLIC_INDEXED_ROUTE_READS,
  preparePublicRouteRequest,
  STOCK_PAIRED_ROUTE_SCOPES,
} from "@/lib/data-pipeline/public-route-readiness.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const launchEvent = parseAbiItem(
  "event StockPairedTokenLaunched(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,address rewardVault,address positionRecipient,uint256 positionTokenId,bytes32 launchHash)",
);
const ethLaunchEvent = parseAbiItem(
  "event StockPairedEthTokenLaunched(address indexed creator,address indexed token,address indexed quoteAsset,uint256 initialBuyEthAmount,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount,bytes32 launchHash)",
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

async function readLegacyLaunchLookup(request: NextRequest) {
  const search = new URLSearchParams(request.nextUrl.searchParams);
  search.delete("__read_model_probe");
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
  const releases = getConfiguredStockPairedReleases();
  if (releases.length === 0) {
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
    const release =
      canonical.to === null
        ? null
        : releases.find(
            (candidate) =>
              candidate.addresses.ethLaunchCoordinator.toLowerCase() ===
              canonical.to?.toLowerCase(),
          ) ?? null;
    if (
      !release ||
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
            release.addresses.ethLaunchCoordinator.toLowerCase() ||
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
      launchLogs[0].deployer.toLowerCase() !==
        release.addresses.ethLaunchCoordinator.toLowerCase()
    ) {
      return json({ error: "The launch event could not be verified" }, 409);
    }
    const ethLaunchLogs = canonical.logs.flatMap((log) => {
      if (
        log.address.toLowerCase() !==
        release.addresses.ethLaunchCoordinator.toLowerCase()
      ) {
        return [];
      }
      try {
        const decoded = decodeEventLog({
          abi: [ethLaunchEvent],
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        return decoded.eventName === "StockPairedEthTokenLaunched"
          ? [decoded.args]
          : [];
      } catch {
        return [];
      }
    });
    if (
      ethLaunchLogs.length !== 1 ||
      ethLaunchLogs[0].creator.toLowerCase() !== account.toLowerCase() ||
      ethLaunchLogs[0].token.toLowerCase() !==
        launchLogs[0].token.toLowerCase() ||
      ethLaunchLogs[0].quoteAsset.toLowerCase() !==
        launchLogs[0].quoteAsset.toLowerCase() ||
      ethLaunchLogs[0].launchHash.toLowerCase() !==
        launchLogs[0].launchHash.toLowerCase() ||
      ethLaunchLogs[0].initialBuyEthAmount <= 0n ||
      ethLaunchLogs[0].initialBuyQuoteAmount <= 0n ||
      ethLaunchLogs[0].initialBuyTokenAmount <= 0n
    ) {
      return json(
        { error: "The ETH launch event could not be verified" },
        409,
      );
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
        creator: account,
        initialBuyEthAmount:
          ethLaunchLogs[0].initialBuyEthAmount.toString(),
        initialBuyQuoteAmount:
          ethLaunchLogs[0].initialBuyQuoteAmount.toString(),
        initialBuyTokenAmount:
          ethLaunchLogs[0].initialBuyTokenAmount.toString(),
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

export async function GET(request: NextRequest) {
  const routeRequest = await preparePublicRouteRequest(
    request.nextUrl.searchParams,
    request.headers,
    "launch-lookup",
  );
  if (routeRequest.probeFailure) return routeRequest.probeFailure;
  const search = routeRequest.searchParams;
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

  try {
    return await coordinatePublicRouteRead({
      route: "launch-lookup",
      scope: STOCK_PAIRED_ROUTE_SCOPES,
      ...(routeRequest.releaseProbe
        ? { releaseProbe: routeRequest.releaseProbe }
        : {}),
      indexed: (readTransaction) =>
        PUBLIC_INDEXED_ROUTE_READS.launchLookup(readTransaction, {
          chainId: 1,
          surface: "stock-paired",
          account: getAddress(accountInput),
          transactionHash: transactionInput,
        }),
      async legacy() {
        return {
          source: "rpc" as const,
          response: await readLegacyLaunchLookup(request),
        };
      },
    });
  } catch (error) {
    console.error(
      "Stock-Paired launch lookup coordination failed",
      safeServerErrorSummary(error),
    );
    return json({ error: "The launch receipt is temporarily unavailable" }, 503);
  }
}
