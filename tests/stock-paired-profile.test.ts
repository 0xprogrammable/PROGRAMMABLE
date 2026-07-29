import {
  encodeFunctionData,
  getAddress,
} from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  parseStockPairedProfileRewards,
  prepareStockPairedRewardAction,
  prepareStockPairedRewardConversion,
} from "../lib/profile/stock-paired-rewards";
import {
  STOCK_QUOTE_ASSETS,
  stockFeeSplitVaultAbi,
} from "../lib/stock-paired";
import {
  buildStockPairedTokenApprovalTransaction,
} from "../lib/trade/stock-paired";
import {
  STOCK_TEST_ACCOUNT,
  STOCK_TEST_TOKEN,
  stockTradeDeployment,
} from "./stock-paired-fixture";

const vault = getAddress(
  "0x5555555555555555555555555555555555555555",
);

function response() {
  return {
    status: "ready",
    account: STOCK_TEST_ACCOUNT,
    chainId: 1,
    snapshotBlock: "123",
    rewards: [
      {
        model: "stock-paired",
        tokenAddress: STOCK_TEST_TOKEN,
        tokenName: "Stock Pair",
        tokenSymbol: "PAIR",
        poolId: `0x${"ab".repeat(32)}`,
        vaultAddress: vault,
        quoteAsset: STOCK_QUOTE_ASSETS[0].address,
        quoteAssetSymbol: STOCK_QUOTE_ASSETS[0].symbol,
        beneficiary: STOCK_TEST_ACCOUNT,
        payoutAddress: STOCK_TEST_ACCOUNT,
        shareBps: 10_000,
        claimableRaw: "10000000000000000",
        claimable: "0.01",
        estimatedEthRaw: "5000000000000000",
        estimatedEth: "0.005",
        estimatedUsdRaw: "10000000",
        estimatedUsd: "10",
        claimedRaw: "0",
        claimed: "0",
        generatedRaw: "10000000000000000",
        generated: "0.01",
        creatorFeesPendingRaw: "10000000000000000",
        beneficiaries: [
          {
            beneficiary: STOCK_TEST_ACCOUNT,
            payoutAddress: STOCK_TEST_ACCOUNT,
            shareBps: 10_000,
          },
        ],
        buySwapFeeBps: 100,
        sellSwapFeeBps: 100,
        programmableFeeBps: 10,
        launchTransactionHash: `0x${"42".repeat(32)}`,
      },
    ],
  };
}

describe("Stock-Paired profile rewards", () => {
  it("accepts exact quote-denominated reward accounting", () => {
    expect(
      parseStockPairedProfileRewards(response(), STOCK_TEST_ACCOUNT),
    ).toMatchObject({
      status: "ready",
      account: STOCK_TEST_ACCOUNT,
      rewards: [
        {
          tokenAddress: STOCK_TEST_TOKEN,
          quoteAssetSymbol: "NVDAon",
          claimable: "0.01",
          estimatedEth: "0.005",
          estimatedUsd: "10",
          shareBps: 10_000,
        },
      ],
    });
  });

  it("rejects another beneficiary or inconsistent display amounts", () => {
    expect(() =>
      parseStockPairedProfileRewards(
        {
          ...response(),
          rewards: [
            {
              ...response().rewards[0],
              beneficiary:
                "0x9999999999999999999999999999999999999999",
            },
          ],
        },
        STOCK_TEST_ACCOUNT,
      ),
    ).toThrow(/another wallet/);
    expect(() =>
      parseStockPairedProfileRewards(
        {
          ...response(),
          rewards: [{ ...response().rewards[0], claimable: "0.02" }],
        },
        STOCK_TEST_ACCOUNT,
      ),
    ).toThrow(/claimable/);
    expect(() =>
      parseStockPairedProfileRewards(
        {
          ...response(),
          rewards: [
            {
              ...response().rewards[0],
              estimatedUsd: "11",
            },
          ],
        },
        STOCK_TEST_ACCOUNT,
      ),
    ).toThrow(/estimate/);
  });

  it("accepts only the canonical beneficiary claim transaction", async () => {
    const data = encodeFunctionData({
      abi: stockFeeSplitVaultAbi,
      functionName: "claim",
    });
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ready",
        action: "claim",
        account: STOCK_TEST_ACCOUNT,
        vaultAddress: vault,
        transaction: {
          kind: "claim-stock-paired-rewards",
          chainId: 1,
          from: STOCK_TEST_ACCOUNT,
          to: vault,
          data,
          value: "0",
          gasLimit: "150000",
        },
      }),
    }));
    await expect(
      prepareStockPairedRewardAction({
        action: "claim",
        account: STOCK_TEST_ACCOUNT,
        vaultAddress: vault,
        chainId: 1,
        fetcher,
      }),
    ).resolves.toMatchObject({
      transaction: {
        kind: "claim-stock-paired-rewards",
        from: STOCK_TEST_ACCOUNT,
        to: vault,
      },
    });
  });

  it("accepts only an exact quote-asset conversion approval", async () => {
    const parsed = parseStockPairedProfileRewards(
      response(),
      STOCK_TEST_ACCOUNT,
    );
    if (parsed.status !== "ready") throw new Error("fixture not ready");
    const reward = parsed.rewards[0];
    const amountIn = reward.claimableRaw;
    const deadline = "12000";
    const deployment = stockTradeDeployment({
      token: reward.tokenAddress,
      quoteAsset: reward.quoteAsset,
      poolId: reward.poolId,
    });
    const claimedAmount = (BigInt(amountIn) + 100n).toString();
    const transaction = buildStockPairedTokenApprovalTransaction({
      deployment,
      inputAsset: reward.quoteAsset,
      amountIn: BigInt(claimedAmount),
    });
    const body = {
      status: "approval-required",
      approvalState: "token-to-permit2",
      action: "convert-to-eth",
      launchModel: "stock-paired",
      conversion: "quote-asset-to-eth",
      chainId: 1,
      owner: STOCK_TEST_ACCOUNT,
      token: reward.tokenAddress,
      quoteAsset: reward.quoteAsset,
      inputAsset: reward.quoteAsset,
      poolId: reward.poolId,
      vaultAddress: reward.vaultAddress,
      claimTransactionHash: `0x${"75".repeat(32)}`,
      claimedAmount,
      quote: {
        amountIn: claimedAmount,
        amountOut: "5000000000000000",
        usdAmountOut: "10000000",
        amountOutMinimum: "4950000000000000",
        gasEstimate: "120000",
        slippageBps: 100,
        deadline,
      },
      transaction,
    };
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    }));
    await expect(
      prepareStockPairedRewardConversion({
        account: STOCK_TEST_ACCOUNT,
        reward,
        claimTransactionHash: body.claimTransactionHash as `0x${string}`,
        amountIn,
        deadline,
        chainId: 1,
        fetcher,
      }),
    ).resolves.toMatchObject({
      status: "approval-required",
      approvalState: "token-to-permit2",
      transaction: {
        kind: "token-to-permit2",
        to: reward.quoteAsset,
      },
      quote: {
        amountIn: claimedAmount,
      },
    });
  });

  it("rejects a conversion that changes the exact approval amount", async () => {
    const parsed = parseStockPairedProfileRewards(
      response(),
      STOCK_TEST_ACCOUNT,
    );
    if (parsed.status !== "ready") throw new Error("fixture not ready");
    const reward = parsed.rewards[0];
    const amountIn = reward.claimableRaw;
    const deadline = "12000";
    const deployment = stockTradeDeployment({
      token: reward.tokenAddress,
      quoteAsset: reward.quoteAsset,
      poolId: reward.poolId,
    });
    const alteredTransaction =
      buildStockPairedTokenApprovalTransaction({
        deployment,
        inputAsset: reward.quoteAsset,
        amountIn: BigInt(amountIn) + 1n,
      });
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: "approval-required",
        approvalState: "token-to-permit2",
        action: "convert-to-eth",
        launchModel: "stock-paired",
        conversion: "quote-asset-to-eth",
        chainId: 1,
        owner: STOCK_TEST_ACCOUNT,
        token: reward.tokenAddress,
        quoteAsset: reward.quoteAsset,
        inputAsset: reward.quoteAsset,
        poolId: reward.poolId,
        vaultAddress: reward.vaultAddress,
        claimTransactionHash: `0x${"75".repeat(32)}`,
        claimedAmount: amountIn,
        quote: {
          amountIn,
          amountOut: "5000000000000000",
          usdAmountOut: "10000000",
          amountOutMinimum: "4950000000000000",
          gasEstimate: "120000",
          slippageBps: 100,
          deadline,
        },
        transaction: alteredTransaction,
      }),
    }));
    await expect(
      prepareStockPairedRewardConversion({
        account: STOCK_TEST_ACCOUNT,
        reward,
        claimTransactionHash: `0x${"75".repeat(32)}`,
        amountIn,
        deadline,
        chainId: 1,
        fetcher,
      }),
    ).rejects.toThrow(/canonical/);
  });
});
