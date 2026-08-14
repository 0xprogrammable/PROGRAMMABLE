import {
  decodeEventLog,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { stockFeeSplitVaultAbi } from "../stock-paired";
import { getConfiguredStockPairedReleases } from "../stock-paired-release";

export class StockPairedClaimReceiptError extends Error {
  constructor(
    message: string,
    readonly code: "pending" | "invalid" | "unavailable" = "invalid",
  ) {
    super(message);
    this.name = "StockPairedClaimReceiptError";
  }
}

function isReceiptNotFound(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "TransactionReceiptNotFoundError" ||
    error.message.toLowerCase().includes("transaction receipt not found") ||
    error.message
      .toLowerCase()
      .includes("transaction receipt could not be found")
  );
}

export async function verifyStockPairedClaimReceipt(input: {
  rpcClient: PublicClient;
  transactionHash: Hex;
  account: Address;
  vaultAddress: Address;
  quoteAsset: Address;
  minimumAmount: bigint;
}) {
  let canonical: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>;
  try {
    canonical = await input.rpcClient.getTransactionReceipt({
      hash: input.transactionHash,
    });
  } catch (error) {
    const unavailable = !isReceiptNotFound(error);
    throw new StockPairedClaimReceiptError(
      unavailable
        ? "The configured RPC could not verify the claim receipt"
        : "The claim receipt is still pending on Ethereum",
      unavailable ? "unavailable" : "pending",
    );
  }
  const releases = getConfiguredStockPairedReleases();
  const earliestStartBlock = releases.reduce(
    (earliest, release) =>
      BigInt(release.startBlock) < earliest
        ? BigInt(release.startBlock)
        : earliest,
    releases.length > 0 ? BigInt(releases[0].startBlock) : 0n,
  );
  if (
    releases.length === 0 ||
    canonical.status !== "success" ||
    canonical.transactionHash.toLowerCase() !==
      input.transactionHash.toLowerCase() ||
    !canonical.to ||
    canonical.to.toLowerCase() !== input.vaultAddress.toLowerCase() ||
    canonical.from.toLowerCase() !== input.account.toLowerCase() ||
    canonical.blockNumber < earliestStartBlock
  ) {
    throw new StockPairedClaimReceiptError(
      "The Stock-Paired claim receipt is invalid",
      "invalid",
    );
  }
  const claims = canonical.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== input.vaultAddress.toLowerCase()) {
      return [];
    }
    try {
      const decoded = decodeEventLog({
        abi: stockFeeSplitVaultAbi,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      return decoded.eventName === "BeneficiaryFeesClaimed"
        ? [decoded.args]
        : [];
    } catch {
      return [];
    }
  });
  if (
    claims.length !== 1 ||
    claims[0].beneficiary.toLowerCase() !== input.account.toLowerCase() ||
    claims[0].payoutAddress.toLowerCase() !== input.account.toLowerCase() ||
    claims[0].quoteAsset.toLowerCase() !== input.quoteAsset.toLowerCase() ||
    claims[0].amount < input.minimumAmount ||
    claims[0].beneficiaryTotalClaimed < claims[0].amount ||
    claims[0].vaultTotalReceived < claims[0].beneficiaryTotalClaimed
  ) {
    throw new StockPairedClaimReceiptError(
      "The Stock-Paired claim event does not match this conversion",
      "invalid",
    );
  }
  return claims[0].amount;
}
