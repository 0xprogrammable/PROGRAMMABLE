import { describe, expect, it } from "vitest";

// @ts-expect-error JavaScript operational helper has no declaration file.
import { MAINNET_CANARY_MAX_GAS_PRICE_WEI, maximumMainnetCanaryOutflowWei, prepareMainnetCanaryGas, shouldPrepareMainnetCanaryBuy } from "../scripts/mainnet-canary-policy.mjs";

describe("Mainnet canary transaction policy", () => {
  it("caps the complete reviewed lifecycle at an exact maximum outflow", () => {
    expect(MAINNET_CANARY_MAX_GAS_PRICE_WEI).toBe(500_000_000n);
    expect(
      maximumMainnetCanaryOutflowWei(
        600_000_000_000_000n,
        100_000_000_000_000n,
      ),
    ).toBe(3_415_000_000_000_000n);
  });

  it("accepts the current launch estimate below both caps", () => {
    expect(
      prepareMainnetCanaryGas({
        actionId: "launch",
        estimatedGas: 3_546_663n,
        quotedGasPriceWei: 115_827_148n,
        valueWei: 600_000_000_000_000n,
        balanceWei: 10_000_000_000_000_000n,
      }),
    ).toEqual({
      gasLimit: 4_255_996n,
      gasPriceWei: 144_783_935n,
      reviewedGasLimit: 4_500_000n,
      maximumCostWei: 2_850_000_000_000_000n,
    });
  });

  it("rejects gas drift, fee spikes and insufficient balances", () => {
    expect(() =>
      prepareMainnetCanaryGas({
        actionId: "launch",
        estimatedGas: 4_000_000n,
        quotedGasPriceWei: 100_000_000n,
        valueWei: 600_000_000_000_000n,
        balanceWei: 10_000_000_000_000_000n,
      }),
    ).toThrow("more gas");

    expect(() =>
      prepareMainnetCanaryGas({
        actionId: "launch",
        estimatedGas: 3_500_000n,
        quotedGasPriceWei: 450_000_000n,
        valueWei: 600_000_000_000_000n,
        balanceWei: 10_000_000_000_000_000n,
      }),
    ).toThrow("above the reviewed canary ceiling");

    expect(() =>
      prepareMainnetCanaryGas({
        actionId: "launch",
        estimatedGas: 3_500_000n,
        quotedGasPriceWei: 100_000_000n,
        valueWei: 600_000_000_000_000n,
        balanceWei: 1n,
      }),
    ).toThrow("below the reviewed transaction ceiling");
  });

  it("covers the independently simulated buy and launcher claim estimates", () => {
    expect(
      prepareMainnetCanaryGas({
        actionId: "buy",
        estimatedGas: 147_261n,
        quotedGasPriceWei: 100_000_000n,
        valueWei: 100_000_000_000_000n,
        balanceWei: 10_000_000_000_000_000n,
      }).gasLimit,
    ).toBe(176_714n);
    expect(
      prepareMainnetCanaryGas({
        actionId: "launcher-claim",
        estimatedGas: 87_238n,
        quotedGasPriceWei: 100_000_000n,
        valueWei: 0n,
        balanceWei: 10_000_000_000_000_000n,
      }).gasLimit,
    ).toBe(104_686n);
  });

  it("cannot skip the separate buy after the atomic Dev Buy", () => {
    expect(
      shouldPrepareMainnetCanaryBuy({
        transactions: { launch: { transactionHash: "0xlaunch" }, buy: null },
      }),
    ).toBe(true);
    expect(
      shouldPrepareMainnetCanaryBuy({
        transactions: {
          launch: { transactionHash: "0xlaunch" },
          buy: { transactionHash: "0xbuy" },
        },
      }),
    ).toBe(false);
  });
});
