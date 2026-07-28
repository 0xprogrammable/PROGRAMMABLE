import { describe, expect, it } from "vitest";
import {
  decodeAbiParameters,
  decodeFunctionData,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

import {
  isAdaptiveDeploymentReady,
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
const hookSaltNonce =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;
const hookFactory =
  "0x3333333333333333333333333333333333333333" as Address;
const positionForwarderFactory =
  "0x4444444444444444444444444444444444444444" as Address;
const runtimeHash = `0x${"11".repeat(32)}`;
const adaptiveLaunchParameters = parseAbiParameters(
  "(string name,string symbol,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,(bytes32 hookSaltNonce,int24[] fdvIndexes,uint16[] totalSwapFeeBps) curve) parameters",
);

function draft() {
  return {
    ...createAdaptiveDraft(),
    tokenName: "Adaptive Token",
    tokenSymbol: "ADAPT",
    tokenDescription: "Immutable adaptive fee curve",
    initialBuyEth: "0",
    launchSalt,
    hookSaltNonce,
  };
}

describe("Adaptive launch transaction boundary", () => {
  it("encodes the immutable curve into the launch bytes", () => {
    const value = draft();
    expect(validateAdaptiveLaunchDraft(value, { requireHookSaltNonce: true }))
      .toHaveLength(4);

    const data = encodeAdaptiveLaunch(value, launchSalt);
    const decoded = decodeFunctionData({
      abi: adaptiveCurveLaunchAbi,
      data,
    });
    expect(decoded.functionName).toBe("launch");
    expect(decoded.args[0]).not.toBe("0x");
    const [parameters] = decodeAbiParameters(
      adaptiveLaunchParameters,
      decoded.args[0] as Hex,
    );
    expect(parameters.curve.hookSaltNonce).toBe(hookSaltNonce);
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
      adaptiveCurveFeeHookFactory: hookFactory,
      adaptiveCurveLaunch: launcher,
      lockedPositionFeeForwarderFactory: positionForwarderFactory,
      runtimeCodeHashes: {
        adaptiveCurveFeeHookFactory: runtimeHash,
        adaptiveCurveLaunch: runtimeHash,
        lockedPositionFeeForwarderFactory: runtimeHash,
      },
    };

    expect(isAdaptiveDeploymentReady(manifest, 1)).toBe(true);
    expect(
      isAdaptiveDeploymentReady(
        { ...manifest, adaptiveCurveFeeHookFactory: null },
        1,
      ),
    ).toBe(false);
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
