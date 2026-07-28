import { describe, expect, it } from "vitest";

import {
  decideLifecycleAction,
  oracleBatchRepeatCount,
  predictKeeperExecutorAddress,
  reviewedKeeperExecutorSourceCommitment,
  validateMinedTransactionEnvelope,
} from "../scripts/serve-deep-mainnet-lifecycle-console.mjs";

function state(overrides: Record<string, unknown> = {}) {
  return {
    launched: false,
    cardinality: 0,
    cardinalityNext: 0,
    creatorFeesAccrued: "0",
    oracleReady: false,
    ...overrides,
  };
}

function evidence(
  transactions: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  return {
    transactions: {
      launch: null,
      deploy_keeper_executor: null,
      grow_oracle: null,
      fee_process_compound: null,
      ...transactions,
    },
    ...overrides,
  };
}

describe("Deep Full-Range Mainnet lifecycle state machine", () => {
  it("packs the complete 2 to 192 growth into one 12-call repeated-vault batch", () => {
    expect(oracleBatchRepeatCount(2)).toBe(12);
    expect(oracleBatchRepeatCount(18)).toBe(11);
    expect(oracleBatchRepeatCount(178)).toBe(1);
    expect(oracleBatchRepeatCount(192)).toBe(0);
  });

  it("pins the reviewed executor artifact and policy commitment", () => {
    expect(reviewedKeeperExecutorSourceCommitment()).toBe(
      "0x9072fa857d484b944205a969fda41727fa76d0f9e670916451b308615bb82175",
    );
    expect(
      predictKeeperExecutorAddress(
        "0x2bb333d48dfaf1596d9036671d2e43168994249e",
        43n,
      ),
    ).toBe("0xbdabd708ff728ca871739d05393ee60f4e63955e");
  });

  it("advances through one exact action at a time", () => {
    expect(decideLifecycleAction(state(), evidence())).toBe("launch");

    const launched = state({
      launched: true,
      cardinality: 1,
      cardinalityNext: 2,
      creatorFeesAccrued: "2970000000000000",
    });
    expect(
      decideLifecycleAction(
        launched,
        evidence({ launch: { receipt: {} } }),
      ),
    ).toBe("grow_oracle");

    const grown = { ...launched, cardinalityNext: 192 };
    expect(
      decideLifecycleAction(
        grown,
        evidence({
          launch: { receipt: {} },
          grow_oracle: { receipt: {} },
        }),
      ),
    ).toBe("wait_twap");

    const processedEvidence = evidence({
      launch: { receipt: {} },
      grow_oracle: { receipt: {} },
    });
    expect(
      decideLifecycleAction(
        { ...grown, oracleReady: false },
        processedEvidence,
      ),
    ).toBe("wait_twap");
    expect(
      decideLifecycleAction(
        { ...grown, oracleReady: true },
        processedEvidence,
      ),
    ).toBe("fee_process_compound");
    expect(
      decideLifecycleAction(
        { ...grown, creatorFeesAccrued: "0", oracleReady: true },
        evidence({
          ...processedEvidence.transactions,
          fee_process_compound: { receipt: {} },
        }),
      ),
    ).toBe("complete");
  });

  it("fails closed on missing or contradictory receipt history", () => {
    expect(() =>
      decideLifecycleAction(
        state({ launched: true, cardinalityNext: 2 }),
        evidence(),
      ),
    ).toThrow("without a recorded lifecycle launch receipt");

    expect(() =>
      decideLifecycleAction(
        state({
          launched: true,
          cardinality: 2,
          cardinalityNext: 192,
          creatorFeesAccrued: "1",
        }),
        evidence({ launch: { receipt: {} } }),
      ),
    ).toThrow("without the reviewed growth receipt");

    expect(() =>
      decideLifecycleAction(
        state({
          launched: true,
          cardinality: 2,
          cardinalityNext: 192,
          creatorFeesAccrued: "0",
          oracleReady: true,
        }),
        evidence({
          launch: { receipt: {} },
          grow_oracle: { receipt: {} },
        }),
      ),
    ).toThrow("combined process-and-compound action");
  });
});

describe("Deep lifecycle mined transaction envelope", () => {
  const prepared = {
    gas: "0x64",
    maxFeePerGas: "0xa",
    maxPriorityFeePerGas: "0x2",
  };

  it("accepts bounded EIP-1559 and legacy envelopes", () => {
    expect(
      validateMinedTransactionEnvelope(
        {
          gas: "0x5a",
          value: "0x32",
          maxFeePerGas: "0x9",
          maxPriorityFeePerGas: "0x2",
        },
        prepared,
        "1050",
      ),
    ).toEqual({
      feeMode: "eip1559",
      minedGasLimit: "90",
      minedFeeCeilingWei: "9",
      maximumPossibleDebitWei: "860",
      preparedMaximumTotalDebitWei: "1050",
    });

    expect(
      validateMinedTransactionEnvelope(
        { gas: "0x64", value: "0x32", gasPrice: "0xa" },
        prepared,
        "1050",
      ).feeMode,
    ).toBe("legacy");
  });

  it("rejects gas, fee, priority-fee, and maximum-debit expansion", () => {
    expect(() =>
      validateMinedTransactionEnvelope(
        {
          gas: "0x65",
          value: "0",
          maxFeePerGas: "0xa",
          maxPriorityFeePerGas: "0x2",
        },
        prepared,
        "1050",
      ),
    ).toThrow("gas limit");

    expect(() =>
      validateMinedTransactionEnvelope(
        {
          gas: "0x64",
          value: "0",
          maxFeePerGas: "0xb",
          maxPriorityFeePerGas: "0x2",
        },
        prepared,
        "1050",
      ),
    ).toThrow("fee ceiling");

    expect(() =>
      validateMinedTransactionEnvelope(
        {
          gas: "0x64",
          value: "0",
          maxFeePerGas: "0xa",
          maxPriorityFeePerGas: "0x3",
        },
        prepared,
        "1050",
      ),
    ).toThrow("priority-fee");

    expect(() =>
      validateMinedTransactionEnvelope(
        { gas: "0x64", value: "0x33", gasPrice: "0xa" },
        prepared,
        "1050",
      ),
    ).toThrow("maximum debit");
  });

  it("rejects transactions without an enforceable fee ceiling", () => {
    expect(() =>
      validateMinedTransactionEnvelope(
        { gas: "0x64", value: "0" },
        prepared,
        "1050",
      ),
    ).toThrow("no enforceable fee ceiling");

    expect(() =>
      validateMinedTransactionEnvelope(
        {
          gas: "0x64",
          value: "0",
          maxFeePerGas: "0xa",
        },
        prepared,
        "1050",
      ),
    ).toThrow("no priority-fee ceiling");
  });
});
