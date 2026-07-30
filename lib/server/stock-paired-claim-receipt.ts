import {
  decodeEventLog,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { stockFeeSplitVaultAbi } from "../stock-paired";
import { getConfiguredStockPairedReleases } from "../stock-paired-release";

export class StockPairedClaimReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockPairedClaimReceiptError";
  }
}

export async function verifyStockPairedClaimReceipt(input: {
  rpcClients: readonly PublicClient[];
  transactionHash: Hex;
  account: Address;
  vaultAddress: Address;
  quoteAsset: Address;
  minimumAmount: bigint;
}) {
  const receiptResults = await Promise.allSettled(
    input.rpcClients.map((client) =>
        client.getTransactionReceipt({
          hash: input.transactionHash,
        }),
    ),
  );
  const receipts = receiptResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (receipts.length < 2) {
    throw new StockPairedClaimReceiptError(
      "The claim is not visible on both Ethereum RPCs yet",
    );
  }
  const receiptKey = (receipt: (typeof receipts)[number]) =>
    [
      receipt.blockHash.toLowerCase(),
      receipt.blockNumber.toString(),
      receipt.transactionIndex.toString(),
      receipt.status,
      receipt.to?.toLowerCase() ?? "",
      receipt.from.toLowerCase(),
    ].join(":");
  const canonical = receipts.find(
    (candidate) =>
      receipts.filter((receipt) => receiptKey(receipt) === receiptKey(candidate))
        .length >= 2,
  );
  if (!canonical) {
    throw new StockPairedClaimReceiptError(
      "Independent Ethereum RPCs disagree on the claim receipt",
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
    !canonical.to ||
    canonical.to.toLowerCase() !== input.vaultAddress.toLowerCase() ||
    canonical.from.toLowerCase() !== input.account.toLowerCase() ||
    canonical.blockNumber < earliestStartBlock
  ) {
    throw new StockPairedClaimReceiptError(
      "The Stock-Paired claim receipt is invalid",
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
    );
  }
  return claims[0].amount;
}
