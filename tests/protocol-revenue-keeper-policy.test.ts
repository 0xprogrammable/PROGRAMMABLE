import { describe, expect, it } from "vitest";

import {
  evaluateProtocolRevenueEconomics,
  evaluateProtocolRevenueState,
  evaluateProtocolRevenueV2Action,
} from "../lib/protocol-revenue/keeper-policy";

const DELEGATION_HASH = `0x${"11".repeat(32)}`;

describe("protocol revenue keeper policy", () => {
  it("processes due revenue before any other action", () => {
    const base = {
      stateTimestamp: 2_000n,
      pendingRevenue: 0n,
      vaultNextRunAt: 1_900n,
      vaultMinimumRevenue: 100n,
      vaultMaximumRevenue: 1_000n,
      coordinatorTotalClaimed: 0n,
      vaultTotalRevenueDeposited: 0n,
      rewardWalletBalance: 0n,
      permissionAvailable: 1_000n,
      maximumTransfer: 500n,
      claimReady: false,
      claimAccruedRevenue: 0n,
      claimMinimumRevenue: 100n,
      latestNonce: 7,
      pendingNonce: 7,
    } as const;

    expect(
      evaluateProtocolRevenueV2Action({ ...base, pendingRevenue: 300n }),
    ).toEqual({ status: "process", revenue: 300n });
  });

  it("transfers the complete unprocessed claim instead of the wallet balance", () => {
    const base = {
      stateTimestamp: 2_000n,
      pendingRevenue: 200n,
      vaultNextRunAt: 2_100n,
      vaultMinimumRevenue: 100n,
      vaultMaximumRevenue: 2_000n,
      coordinatorTotalClaimed: 1_000n,
      vaultTotalRevenueDeposited: 300n,
      rewardWalletBalance: 1_500n,
      permissionAvailable: 1_500n,
      maximumTransfer: 1_500n,
      claimReady: false,
      claimAccruedRevenue: 0n,
      claimMinimumRevenue: 100n,
      latestNonce: 7,
      pendingNonce: 7,
    } as const;

    expect(
      evaluateProtocolRevenueV2Action(base),
    ).toEqual({ status: "transfer", amount: 700n });
    expect(
      evaluateProtocolRevenueV2Action({
        ...base,
        rewardWalletBalance: 699n,
      }),
    ).toEqual({ status: "permission_exhausted" });
    expect(
      evaluateProtocolRevenueV2Action({
        ...base,
        vaultTotalRevenueDeposited: 1_001n,
      }),
    ).toEqual({ status: "accounting_mismatch" });
  });

  it("claims only inside the five-minute window before the vault cycle", () => {
    const base = {
      stateTimestamp: 2_000n,
      pendingRevenue: 0n,
      vaultNextRunAt: 2_500n,
      vaultMinimumRevenue: 100n,
      vaultMaximumRevenue: 2_000n,
      coordinatorTotalClaimed: 1_000n,
      vaultTotalRevenueDeposited: 1_000n,
      rewardWalletBalance: 500n,
      permissionAvailable: 1_000n,
      maximumTransfer: 1_000n,
      claimReady: true,
      claimAccruedRevenue: 300n,
      claimMinimumRevenue: 100n,
      latestNonce: 7,
      pendingNonce: 7,
    } as const;
    expect(evaluateProtocolRevenueV2Action(base)).toEqual({
      status: "not_due",
      nextRunAt: 2_200n,
    });
    expect(evaluateProtocolRevenueV2Action({
      ...base,
      stateTimestamp: 2_200n,
    })).toEqual({
      status: "claim",
      accruedRevenue: 300n,
    });
    expect(
      evaluateProtocolRevenueV2Action({
        ...base,
        claimReady: false,
      }),
    ).toEqual({ status: "below_minimum", minimumRevenue: 100n });
    expect(
      evaluateProtocolRevenueV2Action({ ...base, pendingNonce: 8 }),
    ).toEqual({ status: "pending_transaction" });
  });

  it("catches up the exact live untransferred claim balance", () => {
    expect(evaluateProtocolRevenueV2Action({
      stateTimestamp: 1_785_973_700n,
      pendingRevenue: 100_000_000_000_000_000n,
      vaultNextRunAt: 1_786_020_347n,
      vaultMinimumRevenue: 1_000_000_000_000_000n,
      vaultMaximumRevenue: 5_000_000_000_000_000_000n,
      coordinatorTotalClaimed: 1_051_686_789_475_590_097n,
      vaultTotalRevenueDeposited: 300_000_000_000_000_000n,
      rewardWalletBalance: 830_100_252_895_636_119n,
      permissionAvailable: 4_700_000_000_000_000_000n,
      maximumTransfer: 5_000_000_000_000_000_000n,
      claimReady: false,
      claimAccruedRevenue: 0n,
      claimMinimumRevenue: 1_000_000_000_000_000n,
      latestNonce: 7,
      pendingNonce: 7,
    })).toEqual({
      status: "transfer",
      amount: 751_686_789_475_590_097n,
    });
  });

  it("requires a live delegation, due cadence, minimum revenue and clear nonce", () => {
    const base = {
      delegationHash: DELEGATION_HASH,
      finalizedTimestamp: 2_000n,
      nextRunAt: 1_900n,
      availableRevenue: 1_000_000n,
      minimumRevenue: 100_000n,
      latestNonce: 7,
      pendingNonce: 7,
    } as const;

    expect(evaluateProtocolRevenueState(base)).toEqual({ status: "ready" });
    expect(
      evaluateProtocolRevenueState({
        ...base,
        delegationHash: `0x${"00".repeat(32)}`,
      }),
    ).toEqual({ status: "delegation_missing" });
    expect(
      evaluateProtocolRevenueState({ ...base, pendingNonce: 8 }),
    ).toEqual({ status: "pending_transaction" });
    expect(
      evaluateProtocolRevenueState({ ...base, nextRunAt: 2_001n }),
    ).toEqual({ status: "not_due", nextRunAt: 2_001n });
    expect(
      evaluateProtocolRevenueState({ ...base, availableRevenue: 99_999n }),
    ).toEqual({ status: "below_minimum", minimumRevenue: 100_000n });
  });

  it("buffers gas and requires the 0.5% keeper allocation to replenish it", () => {
    const decision = evaluateProtocolRevenueEconomics({
      availableRevenue: 1_000_000_000n,
      gasEstimate: 800n,
      maxFeePerGas: 4_000n,
      maximumGasPrice: 5_000n,
      minimumRevenueGasMultiplier: 250n,
      keeperBalance: 100_000_000n,
      keeperGasShareBps: 50n,
    });

    expect(decision).toEqual({
      status: "ready",
      gasLimit: 1_000n,
      maximumGasCost: 4_000_000n,
      keeperFunding: 5_000_000n,
    });
  });

  it("fails closed on expensive gas, poor economics and low keeper balance", () => {
    const base = {
      availableRevenue: 1_000_000_000n,
      gasEstimate: 800n,
      maxFeePerGas: 4_000n,
      maximumGasPrice: 5_000n,
      minimumRevenueGasMultiplier: 250n,
      keeperBalance: 100_000_000n,
      keeperGasShareBps: 50n,
    } as const;

    expect(
      evaluateProtocolRevenueEconomics({
        ...base,
        maxFeePerGas: 5_001n,
      }).status,
    ).toBe("gas_price_too_high");
    expect(
      evaluateProtocolRevenueEconomics({
        ...base,
        availableRevenue: 999_999_999n,
      }).status,
    ).toBe("uneconomic");
    expect(
      evaluateProtocolRevenueEconomics({
        ...base,
        keeperBalance: 7_999_999n,
      }).status,
    ).toBe("keeper_balance_low");
  });
});
