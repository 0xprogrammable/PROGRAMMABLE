import { describe, expect, it } from "vitest";

import {
  evaluateProtocolRevenueEconomics,
  evaluateProtocolRevenueState,
} from "../lib/protocol-revenue/keeper-policy";

const DELEGATION_HASH = `0x${"11".repeat(32)}`;

describe("protocol revenue keeper policy", () => {
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
