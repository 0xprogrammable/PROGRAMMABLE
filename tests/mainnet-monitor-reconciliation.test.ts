import { describe, expect, it } from "vitest";

// The production monitor is intentionally a directly executable Node module.
// @ts-expect-error JavaScript monitor has no separate declaration file.
import { reconcileNativeFeeEvents } from "../contracts/scripts/monitor-meme-v1.mjs";

const transactionHash = `0x${"11".repeat(32)}`;
const poolId = `0x${"22".repeat(32)}`;
const sender = "0x3333333333333333333333333333333333333333";
const trackedLaunches = [{ poolId, totalSwapFeeBps: 100 }];

function hookFee(logIndex: number, amount: bigint) {
  return {
    eventName: "HookFee",
    transactionHash,
    logIndex,
    args: {
      poolId,
      sender,
      feeAmount0: amount,
      feeAmount1: 0n,
    },
  };
}

function hookSwap(logIndex: number, amount: bigint) {
  return {
    eventName: "HookSwap",
    transactionHash,
    logIndex,
    args: {
      id: poolId,
      sender,
      amount0: -amount,
      amount1: 0n,
      swapFee: 10_000,
    },
  };
}

function nativeAccrual(
  logIndex: number,
  creatorFee: bigint,
  launcherFee: bigint,
) {
  return {
    eventName: "NativeSwapFeesAccrued",
    transactionHash,
    logIndex,
    args: {
      poolId,
      swapSender: sender,
      grossNativeAmount: 0n,
      creatorFee,
      launcherFee,
    },
  };
}

describe("Mainnet monitor fee-event reconciliation", () => {
  it("reconciles multiple swaps from the same sender and pool in one transaction", () => {
    const firstFee = 108_298_807_823_119n;
    const secondFee = 6_588_695_009_962_382n;
    const events = [
      hookFee(719, firstFee),
      hookSwap(720, firstFee),
      nativeAccrual(721, 97_468_927_040_808n, 10_829_880_782_311n),
      hookFee(741, secondFee),
      hookSwap(742, secondFee),
      nativeAccrual(743, 5_929_825_508_966_144n, 658_869_500_996_238n),
    ];

    expect(reconcileNativeFeeEvents(events, trackedLaunches)).toBe(2);
  });

  it("reconciles only after sorting the complete event range", () => {
    const firstFee = 100n;
    const secondFee = 200n;
    const events = [
      nativeAccrual(9, 180n, 20n),
      hookSwap(8, secondFee),
      hookFee(7, secondFee),
      nativeAccrual(3, 90n, 10n),
      hookSwap(2, firstFee),
      hookFee(1, firstFee),
    ];

    expect(reconcileNativeFeeEvents(events, trackedLaunches)).toBe(2);
  });

  it("still fails closed on a real amount mismatch", () => {
    const events = [
      hookFee(1, 99n),
      hookSwap(2, 100n),
      nativeAccrual(3, 90n, 10n),
    ];

    expect(() =>
      reconcileNativeFeeEvents(events, trackedLaunches),
    ).toThrow("HookFee does not reconcile with native accrual");
  });

  it("still fails closed when a companion event is missing", () => {
    const events = [
      hookFee(1, 100n),
      nativeAccrual(3, 90n, 10n),
    ];

    expect(() =>
      reconcileNativeFeeEvents(events, trackedLaunches),
    ).toThrow("Native fee accrual is missing HookSwap");
  });
});
