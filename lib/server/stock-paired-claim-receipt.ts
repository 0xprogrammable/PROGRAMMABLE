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
  let receipts;
  try {
    receipts = await Promise.all(
      input.rpcClients.map((client) =>
        client.getTransactionReceipt({
          hash: input.transactionHash,
        }),
      ),
    );
  } catch {
    throw new StockPairedClaimReceiptError(
      "The claim is not visible on both Ethereum RPCs yet",
    );
  }
  const canonical = receipts[0];
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
    receipts.some(
      (receipt) =>
        receipt.status !== "success" ||
        !receipt.to ||
        receipt.to.toLowerCase() !== input.vaultAddress.toLowerCase() ||
        receipt.from.toLowerCase() !== input.account.toLowerCase() ||
        receipt.blockHash.toLowerCase() !== canonical.blockHash.toLowerCase() ||
        receipt.blockNumber !== canonical.blockNumber ||
        receipt.transactionIndex !== canonical.transactionIndex,
    ) ||
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
