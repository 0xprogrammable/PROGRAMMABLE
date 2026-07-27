import { describe, expect, it } from "vitest";

// The production helper is intentionally a directly executable Node module.
// @ts-expect-error JavaScript deployment tool has no separate declaration file.
import { assertDeploymentSequenceState } from "../scripts/serve-v2-metamask-deployer.mjs";

const plan = {
  startingNonce: 7,
  endingNonce: 10,
  feePolicy: {
    maxFeePerGasWei: "500000000",
  },
  transactions: [
    { foundryGasLimit: "0x10" },
    { foundryGasLimit: "0x20" },
    { foundryGasLimit: "0x30" },
  ],
};

function state(
  confirmedNonce: number,
  pendingNonce: number,
  deployments: boolean[],
) {
  return {
    confirmedNonce: `0x${confirmedNonce.toString(16)}`,
    pendingNonce: `0x${pendingNonce.toString(16)}`,
    balance: "0xffffffffffffffff",
    deployments: deployments.map((verified) => ({ verified })),
  };
}

describe("V2 deployment sequence boundary", () => {
  it("accepts the fresh plan before its first transaction", () => {
    expect(() =>
      assertDeploymentSequenceState(plan, state(7, 7, [false, false, false])),
    ).not.toThrow();
  });

  it("accepts a correctly confirmed partial deployment", () => {
    expect(() =>
      assertDeploymentSequenceState(plan, state(8, 8, [true, false, false])),
    ).not.toThrow();
  });

  it("rejects a stale plan when its nonce was consumed elsewhere", () => {
    expect(() =>
      assertDeploymentSequenceState(plan, state(8, 8, [false, false, false])),
    ).toThrow("reviewed nonce confirmed without the expected deployment");
  });

  it("rejects code appearing ahead of the reviewed nonce", () => {
    expect(() =>
      assertDeploymentSequenceState(plan, state(7, 7, [false, true, false])),
    ).toThrow("Expected code exists before its reviewed nonce");
  });

  it("rejects pending transactions outside the reviewed sequence", () => {
    expect(() =>
      assertDeploymentSequenceState(plan, state(7, 11, [false, false, false])),
    ).toThrow("Pending nonce is outside the reviewed deployment sequence");
  });

  it("rejects a deployment-state list with the wrong length", () => {
    expect(() =>
      assertDeploymentSequenceState(plan, state(7, 7, [false, false])),
    ).toThrow("reviewed transaction count");
  });

  it("rejects a wallet that cannot cover the remaining fixed ceiling", () => {
    const insufficient = state(7, 7, [false, false, false]);
    insufficient.balance = "0x1";
    expect(() => assertDeploymentSequenceState(plan, insufficient)).toThrow(
      "below the reviewed deployment ceiling",
    );
  });
});
