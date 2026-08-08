import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbiItem,
  type Hex,
  type PublicClient,
} from "viem";
import { describe, expect, it } from "vitest";

import {
  verifyStockPairedClaimReceipt,
} from "../lib/server/stock-paired-claim-receipt";
import { STOCK_QUOTE_ASSETS } from "../lib/stock-paired";
import { getConfiguredStockPairedRelease } from "../lib/stock-paired-release";
import { STOCK_TEST_ACCOUNT } from "./stock-paired-fixture";

const claimEvent = parseAbiItem(
  "event BeneficiaryFeesClaimed(address indexed beneficiary,address indexed payoutAddress,address indexed quoteAsset,uint256 amount,uint256 beneficiaryTotalClaimed,uint256 vaultTotalReceived)",
);
const vault = getAddress(
  "0x5555555555555555555555555555555555555555",
);
const transactionHash = `0x${"91".repeat(32)}` as Hex;

function receipt(payoutAddress = STOCK_TEST_ACCOUNT) {
  const release = getConfiguredStockPairedRelease();
  if (!release) throw new Error("Stock-Paired release fixture is unavailable");
  return {
    status: "success",
    transactionHash,
    to: vault,
    from: STOCK_TEST_ACCOUNT,
    blockHash: `0x${"81".repeat(32)}`,
    blockNumber: BigInt(release.startBlock + 100),
    transactionIndex: 3,
    logs: [
      {
        address: vault,
        topics: encodeEventTopics({
          abi: [claimEvent],
          eventName: "BeneficiaryFeesClaimed",
          args: {
            beneficiary: STOCK_TEST_ACCOUNT,
            payoutAddress,
            quoteAsset: STOCK_QUOTE_ASSETS[0].address,
          },
        }),
        data: encodeAbiParameters(
          [
            { type: "uint256" },
            { type: "uint256" },
            { type: "uint256" },
          ],
          [1_000n, 2_000n, 3_000n],
        ),
      },
    ],
  };
}

function rpcClients(candidate: ReturnType<typeof receipt>) {
  return [
    { getTransactionReceipt: async () => candidate },
    { getTransactionReceipt: async () => candidate },
  ] as unknown as readonly PublicClient[];
}

describe("Stock-Paired claim receipt verification", () => {
  it("binds conversion to the beneficiary, payout wallet, asset and amount", async () => {
    await expect(
      verifyStockPairedClaimReceipt({
        rpcClients: rpcClients(receipt()),
        transactionHash,
        account: STOCK_TEST_ACCOUNT,
        vaultAddress: vault,
        quoteAsset: STOCK_QUOTE_ASSETS[0].address,
        minimumAmount: 1_000n,
      }),
    ).resolves.toBe(1_000n);
  });

  it("accepts two matching receipts when another RPC is unavailable", async () => {
    const candidate = receipt();
    const clients = [
      { getTransactionReceipt: async () => candidate },
      { getTransactionReceipt: async () => candidate },
      {
        getTransactionReceipt: async () => {
          throw new Error("RPC unavailable");
        },
      },
    ] as unknown as readonly PublicClient[];
    await expect(
      verifyStockPairedClaimReceipt({
        rpcClients: clients,
        transactionHash,
        account: STOCK_TEST_ACCOUNT,
        vaultAddress: vault,
        quoteAsset: STOCK_QUOTE_ASSETS[0].address,
        minimumAmount: 1_000n,
      }),
    ).resolves.toBe(1_000n);
  });

  it("fails closed with an explicit pending code until two receipts exist", async () => {
    const pending = new Error("Transaction receipt could not be found");
    pending.name = "TransactionReceiptNotFoundError";
    const clients = [
      { getTransactionReceipt: async () => receipt() },
      {
        getTransactionReceipt: async () => {
          throw pending;
        },
      },
    ] as unknown as readonly PublicClient[];

    await expect(
      verifyStockPairedClaimReceipt({
        rpcClients: clients,
        transactionHash,
        account: STOCK_TEST_ACCOUNT,
        vaultAddress: vault,
        quoteAsset: STOCK_QUOTE_ASSETS[0].address,
        minimumAmount: 1_000n,
      }),
    ).rejects.toMatchObject({ code: "pending" });
  });

  it("distinguishes an unavailable receipt quorum from pending", async () => {
    const clients = [
      { getTransactionReceipt: async () => receipt() },
      {
        getTransactionReceipt: async () => {
          throw new Error("RPC unavailable");
        },
      },
    ] as unknown as readonly PublicClient[];

    await expect(
      verifyStockPairedClaimReceipt({
        rpcClients: clients,
        transactionHash,
        account: STOCK_TEST_ACCOUNT,
        vaultAddress: vault,
        quoteAsset: STOCK_QUOTE_ASSETS[0].address,
        minimumAmount: 1_000n,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("rejects same-header receipts with divergent claim logs", async () => {
    const otherPayout = getAddress(
      "0x6666666666666666666666666666666666666666",
    );
    const clients = [
      { getTransactionReceipt: async () => receipt() },
      { getTransactionReceipt: async () => receipt(otherPayout) },
    ] as unknown as readonly PublicClient[];

    await expect(
      verifyStockPairedClaimReceipt({
        rpcClients: clients,
        transactionHash,
        account: STOCK_TEST_ACCOUNT,
        vaultAddress: vault,
        quoteAsset: STOCK_QUOTE_ASSETS[0].address,
        minimumAmount: 1_000n,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects a claim paid to another wallet", async () => {
    await expect(
      verifyStockPairedClaimReceipt({
        rpcClients: rpcClients(
          receipt(
            getAddress(
              "0x9999999999999999999999999999999999999999",
            ),
          ),
        ),
        transactionHash,
        account: STOCK_TEST_ACCOUNT,
        vaultAddress: vault,
        quoteAsset: STOCK_QUOTE_ASSETS[0].address,
        minimumAmount: 1_000n,
      }),
    ).rejects.toThrow(/does not match/);
  });
});
