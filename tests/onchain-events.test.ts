import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import {
  computeLaunchHash,
  pairVerifiedLaunchEvents,
} from "../lib/onchain/events";
import type {
  InitialBuyEventRecord,
  LaunchEventRecord,
  LiquidityEventRecord,
} from "../lib/onchain/types";

const launcher =
  "0x1111111111111111111111111111111111111111" as Address;
const hook =
  "0x2222222222222222222222222222222222222222" as Address;
const token =
  "0x3333333333333333333333333333333333333333" as Address;
const zeroHash = `0x${"00".repeat(32)}` as Hex;
const transactionHash = `0x${"44".repeat(32)}` as Hex;
const poolId = `0x${"55".repeat(32)}` as Hex;

function fixture() {
  const launch: LaunchEventRecord = {
    creator: "0x6666666666666666666666666666666666666666",
    token,
    poolId,
    feeHook: hook,
    positionRecipient:
      "0x7777777777777777777777777777777777777777",
    positionTokenId: 12n,
    totalSwapFeeBps: 100,
    launchHash: zeroHash,
    blockNumber: 100n,
    transactionHash,
    transactionIndex: 2,
    logIndex: 4,
  };
  const liquidity: LiquidityEventRecord = {
    token,
    totalSupply: 1_000_000_000n * 10n ** 18n,
    tokenLiquidityAmount: 999_000_000n * 10n ** 18n,
    lockedTokenDust: 1n,
    initialTick: 204_200,
    tickLower: 204_200,
    tickUpper: 887_200,
    lpFeePips: 0,
    launchHash: zeroHash,
    blockNumber: 100n,
    transactionHash,
    transactionIndex: 2,
    logIndex: 5,
  };
  const initialBuy: InitialBuyEventRecord = {
    creator: launch.creator,
    token,
    poolId,
    nativeAmount: 600_000_000_000_000n,
    tokenAmount: 437_000n * 10n ** 18n,
    launchHash: zeroHash,
    blockNumber: 100n,
    transactionHash,
    transactionIndex: 2,
    logIndex: 6,
  };
  const launchHash = computeLaunchHash(
    1,
    launcher,
    launch,
    liquidity,
    initialBuy,
  );
  launch.launchHash = launchHash;
  liquidity.launchHash = launchHash;
  initialBuy.launchHash = launchHash;
  return { launch, liquidity, initialBuy };
}

describe("launcher event verification", () => {
  it("accepts only the paired event record with its computed launch hash", () => {
    const { launch, liquidity, initialBuy } = fixture();
    expect(
      pairVerifiedLaunchEvents(
        1,
        launcher,
        hook,
        [launch],
        [liquidity],
        [initialBuy],
      ),
    ).toHaveLength(1);
  });

  it("rejects missing pairs, foreign hooks, and changed economics", () => {
    const { launch, liquidity, initialBuy } = fixture();
    expect(
      pairVerifiedLaunchEvents(
        1,
        launcher,
        hook,
        [launch],
        [],
        [initialBuy],
      ),
    ).toEqual([]);
    expect(
      pairVerifiedLaunchEvents(
        1,
        launcher,
        "0x8888888888888888888888888888888888888888",
        [launch],
        [liquidity],
        [initialBuy],
      ),
    ).toEqual([]);
    expect(
      pairVerifiedLaunchEvents(
        1,
        launcher,
        hook,
        [launch],
        [{ ...liquidity, totalSupply: liquidity.totalSupply + 1n }],
        [initialBuy],
      ),
    ).toEqual([]);
    expect(
      pairVerifiedLaunchEvents(
        1,
        launcher,
        hook,
        [launch],
        [liquidity],
        [{ ...initialBuy, tokenAmount: initialBuy.tokenAmount + 1n }],
      ),
    ).toEqual([]);
  });
});
