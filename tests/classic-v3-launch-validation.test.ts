import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

import { assertClassicV4ExpectedResult } from "../lib/classic-v3-launch-validation";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TOKEN = "0x1111111111111111111111111111111111111111" as Address;
const REWARD_VAULT =
  "0x2222222222222222222222222222222222222222" as Address;
const POSITION_RECIPIENT =
  "0x3333333333333333333333333333333333333333" as Address;
const HOOK = "0x4444444444444444444444444444444444444444" as Address;
const TOKEN_RUNTIME_CODE_HASH = `0x${"aa".repeat(32)}` as Hex;
const HOOK_RUNTIME_CODE_HASH = `0x${"bb".repeat(32)}` as Hex;
const LAUNCH_ID = `0x${"cc".repeat(32)}` as Hex;
const LAUNCH_HASH = `0x${"dd".repeat(32)}` as Hex;
const INITIAL_BUY = 600_000_000_000_000n;

function expectedResultFixture(positionTokenId: bigint) {
  const poolKey = {
    currency0: ZERO_ADDRESS,
    currency1: TOKEN,
    fee: 0,
    tickSpacing: 200,
    hooks: HOOK,
  } as const;
  const poolId = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks",
      ),
      [
        poolKey.currency0,
        poolKey.currency1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks,
      ],
    ),
  );
  const stampRequest = {
    launchId: LAUNCH_ID,
    token: TOKEN,
    tokenRuntimeCodeHash: TOKEN_RUNTIME_CODE_HASH,
    poolKey,
    hookRuntimeCodeHash: HOOK_RUNTIME_CODE_HASH,
    components: [
      {
        resultIndex: 0,
        account: TOKEN,
        runtimeCodeHash: TOKEN_RUNTIME_CODE_HASH,
        kind: 1,
        scope: 1,
      },
      {
        resultIndex: 1,
        account: REWARD_VAULT,
        runtimeCodeHash: `0x${"01".repeat(32)}` as Hex,
        kind: 0,
        scope: 1,
      },
      {
        resultIndex: 2,
        account: POSITION_RECIPIENT,
        runtimeCodeHash: `0x${"02".repeat(32)}` as Hex,
        kind: 0,
        scope: 1,
      },
      {
        resultIndex: 255,
        account: HOOK,
        runtimeCodeHash: HOOK_RUNTIME_CODE_HASH,
        kind: 2,
        scope: 2,
      },
    ],
  } as const;
  const result = {
    token: TOKEN,
    rewardVault: REWARD_VAULT,
    positionRecipient: POSITION_RECIPIENT,
    positionTokenId,
    tokenLiquidityAmount: 1n,
    lockedTokenDust: 0n,
    initialBuyNativeAmount: INITIAL_BUY,
    initialBuyTokenAmount: 1n,
    initialBuyCustody: ZERO_ADDRESS,
    poolId,
    launchHash: LAUNCH_HASH,
  } as const;

  return { stampRequest, result };
}

describe("Classic V4 expected result validation", () => {
  it("accepts zero as the prelaunch position token sentinel", () => {
    const { stampRequest, result } = expectedResultFixture(0n);

    expect(() =>
      assertClassicV4ExpectedResult(stampRequest, result, INITIAL_BUY),
    ).not.toThrow();
  });

  it("rejects a volatile positive position token ID", () => {
    const { stampRequest, result } = expectedResultFixture(386_159n);

    expect(() =>
      assertClassicV4ExpectedResult(stampRequest, result, INITIAL_BUY),
    ).toThrow("The prepared Classic launch result is invalid");
  });
});
