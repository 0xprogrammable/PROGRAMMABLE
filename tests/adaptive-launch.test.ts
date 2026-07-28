import { describe, expect, it } from "vitest";
import { decodeFunctionData, type Address, type Hex } from "viem";

import {
  validatePreparedAdaptiveLaunchTransactionAgainstManifest,
} from "@/lib/adaptive-launch-validation";
import {
  ADAPTIVE_MAX_FDV_INDEX,
  ADAPTIVE_MIN_FDV_INDEX,
  createAdaptiveDraft,
} from "@/lib/launch";
import {
  adaptiveCurveLaunchAbi,
  buildPlanHash,
  encodeAdaptiveLaunch,
  LaunchInputError,
  validateAdaptiveLaunchDraft,
} from "@/lib/launch-transaction";

const account =
  "0x1111111111111111111111111111111111111111" as Address;
const launcher =
  "0x2222222222222222222222222222222222222222" as Address;
const launchSalt =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
const hookSalt =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;

function draft() {
  return {
    ...createAdaptiveDraft(),
    tokenName: "Adaptive Token",
    tokenSymbol: "ADAPT",
    tokenDescription: "Immutable adaptive fee curve",
    initialBuyEth: "0",
    launchSalt,
    hookSalt,
  };
}

describe("Adaptive launch transaction boundary", () => {
  it("encodes the immutable curve into the launch bytes", () => {
    const value = draft();
    expect(validateAdaptiveLaunchDraft(value, { requireHookSalt: true }))
      .toHaveLength(4);

    const data = encodeAdaptiveLaunch(value, launchSalt);
    const decoded = decodeFunctionData({
      abi: adaptiveCurveLaunchAbi,
      data,
    });
    expect(decoded.functionName).toBe("launch");
    expect(decoded.args[0]).not.toBe("0x");
  });

  it("rejects missing full-range endpoints and out-of-range fees", () => {
    const invalidEndpoint = draft();
    invalidEndpoint.adaptiveCurvePoints = [
      ...invalidEndpoint.adaptiveCurvePoints,
    ];
    invalidEndpoint.adaptiveCurvePoints[0] = {
      fdvIndex: ADAPTIVE_MIN_FDV_INDEX + 1,
      totalSwapFeeBps: 500,
    };
    expect(() => validateAdaptiveLaunchDraft(invalidEndpoint)).toThrow(
      LaunchInputError,
    );

    const invalidFee = draft();
    invalidFee.adaptiveCurvePoints = [
      ...invalidFee.adaptiveCurvePoints,
    ];
    invalidFee.adaptiveCurvePoints[1] = {
      fdvIndex: -204_200,
      totalSwapFeeBps: 1_001,
    };
    expect(() => validateAdaptiveLaunchDraft(invalidFee)).toThrow(
      "between 1% and 10%",
    );
  });

  it("accepts two immutable boundary points and an optional zero buy", () => {
    const value = draft();
    value.adaptiveCurvePoints = [
      { fdvIndex: ADAPTIVE_MIN_FDV_INDEX, totalSwapFeeBps: 1_000 },
      { fdvIndex: ADAPTIVE_MAX_FDV_INDEX, totalSwapFeeBps: 100 },
    ];
    expect(validateAdaptiveLaunchDraft(value)).toHaveLength(2);
  });

  it("rejects any prepared transaction that differs from the current curve", () => {
    const value = draft();
    const data = encodeAdaptiveLaunch(value, launchSalt);
    const transaction = {
      kind: "launch" as const,
      chainId: 1,
      to: launcher,
      data,
      value: "0",
      gasLimit: "7000000",
    };
    const planHash = buildPlanHash(account, {
      kind: "launch",
      chainId: 1,
      to: launcher,
      data,
      value: "0",
    });
    const manifest = {
      chainId: 1,
      adaptiveLaunchStatus: "ready",
      adaptiveCurveLaunch: launcher,
    };

    expect(
      validatePreparedAdaptiveLaunchTransactionAgainstManifest(
        { transaction, draft: value, account, planHash },
        manifest,
      ),
    ).toEqual(transaction);

    value.adaptiveCurvePoints[1] = {
      ...value.adaptiveCurvePoints[1],
      totalSwapFeeBps: 525,
    };
    expect(() =>
      validatePreparedAdaptiveLaunchTransactionAgainstManifest(
        { transaction, draft: value, account, planHash },
        manifest,
      ),
    ).toThrow("does not match");
  });
});
