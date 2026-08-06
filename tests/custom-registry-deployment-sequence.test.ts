import { describe, expect, it } from "vitest";

// @ts-expect-error Directly executable Node module has no declaration file.
import * as deploymentSequence from "../scripts/serve-custom-registry-mainnet-deployer.mjs";

const {
  assertCustomRegistryCompletedState,
  assertCustomRegistryDeploymentSequenceState,
} = deploymentSequence;

const plan = {
  startingNonce: 207,
  endingNonce: 211,
  feePolicy: { maxFeePerGasWei: "500000000" },
  transactions: [
    { foundryGasLimit: "0x10" },
    { foundryGasLimit: "0x20" },
    { foundryGasLimit: "0x30" },
    { foundryGasLimit: "0x40" },
  ],
};

function state(confirmedNonce: number, pendingNonce: number, deployments: boolean[]) {
  return {
    confirmedNonce: `0x${confirmedNonce.toString(16)}`,
    pendingNonce: `0x${pendingNonce.toString(16)}`,
    balance: "0xffffffffffffffff",
    deployments: deployments.map((verified) => ({ verified })),
  };
}

describe("Custom Registry deployment sequence boundary", () => {
  it("accepts a fresh exact four-transaction plan", () => {
    expect(() =>
      assertCustomRegistryDeploymentSequenceState(
        plan,
        state(207, 207, [false, false, false, false]),
      ),
    ).not.toThrow();
  });

  it("accepts a correctly confirmed partial deployment", () => {
    expect(() =>
      assertCustomRegistryDeploymentSequenceState(
        plan,
        state(209, 209, [true, true, false, false]),
      ),
    ).not.toThrow();
  });

  it("rejects a stale plan after an unrelated nonce is consumed", () => {
    expect(() =>
      assertCustomRegistryDeploymentSequenceState(
        plan,
        state(208, 208, [false, false, false, false]),
      ),
    ).toThrow("reviewed nonce confirmed without the expected deployment");
  });

  it("rejects code at a future reviewed address", () => {
    expect(() =>
      assertCustomRegistryDeploymentSequenceState(
        plan,
        state(207, 207, [false, false, true, false]),
      ),
    ).toThrow("Expected code exists before its reviewed nonce");
  });

  it("rejects a pending nonce outside the four-step sequence", () => {
    expect(() =>
      assertCustomRegistryDeploymentSequenceState(
        plan,
        state(207, 212, [false, false, false, false]),
      ),
    ).toThrow("Pending nonce is outside the reviewed deployment sequence");
  });

  it("rejects insufficient balance for the remaining fixed ceiling", () => {
    const insufficient = state(207, 207, [false, false, false, false]);
    insufficient.balance = "0x1";
    expect(() =>
      assertCustomRegistryDeploymentSequenceState(plan, insufficient),
    ).toThrow("below the reviewed deployment ceiling");
  });
});

describe("completed Custom Registry deployment verification", () => {
  it("accepts all four independently verified contracts", () => {
    expect(() =>
      assertCustomRegistryCompletedState(
        plan,
        state(211, 211, [true, true, true, true]),
      ),
    ).not.toThrow();
  });

  it("accepts the verified release after later wallet transactions", () => {
    expect(() =>
      assertCustomRegistryCompletedState(
        plan,
        state(218, 218, [true, true, true, true]),
      ),
    ).not.toThrow();
  });

  it("rejects a missing Registry component", () => {
    expect(() =>
      assertCustomRegistryCompletedState(
        plan,
        state(211, 211, [true, true, false, true]),
      ),
    ).toThrow("not independently verified");
  });
});
