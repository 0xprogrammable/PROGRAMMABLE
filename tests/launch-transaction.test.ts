import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  getCreate2Address,
  keccak256,
  toHex,
} from "viem";

import {
  buildDirectLaunchAmounts,
  directLiquidityLauncherAbi,
  encodeNewDirectLaunch,
  HOOK_FLAG_MASK,
  integerSquareRoot,
  mineStandardHookSalt,
  parseDecimalAmount,
  STANDARD_HOOK_FLAGS,
  tokensPerEthToSqrtPriceX96,
} from "../lib/launch-transaction";
import { createEmptyDraft } from "../lib/launch";

const Q96 = 1n << 96n;

function directDraft() {
  return {
    ...createEmptyDraft(),
    liquidityMode: "direct" as const,
    tokenName: "Direct Token",
    tokenSymbol: "DIRECT",
    tokenSupply: "1000000000",
    tokenDescription: "A fixed supply direct launch",
    directEthAmount: "2.5",
    directTokenAmount: "250000",
    directTokensPerEth: "100000",
    launchSalt:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
  };
}

describe("direct launch transaction math", () => {
  it("parses decimal values without floating point rounding", () => {
    expect(parseDecimalAmount("2.500000000000000001", 18, "amount")).toBe(
      2_500_000_000_000_000_001n,
    );
    expect(() => parseDecimalAmount("1e3", 18, "amount")).toThrow(
      "positive decimal",
    );
    expect(() => parseDecimalAmount("1.001", 2, "amount")).toThrow(
      "up to 2 decimal places",
    );
  });

  it("computes exact canonical prices in Q64.96", () => {
    expect(tokensPerEthToSqrtPriceX96("1", 18)).toBe(Q96);
    expect(tokensPerEthToSqrtPriceX96("100", 18)).toBe(10n * Q96);
  });

  it("uses token decimals in the raw currency ratio", () => {
    const expected = integerSquareRoot(
      ((10n ** 18n * 10n ** 6n) << 192n) / 10n ** 36n,
    );
    expect(tokensPerEthToSqrtPriceX96("1", 6)).toBe(expected);
    expect(expected).toBeLessThan(Q96);
  });

  it("rejects liquidity above the new token supply", () => {
    expect(() =>
      buildDirectLaunchAmounts(
        {
          ...directDraft(),
          tokenSupply: "100",
          directTokenAmount: "101",
        },
        18,
      ),
    ).toThrow("cannot exceed the token supply");
  });

  it("keeps the protocol-tested direct path fixed at 0.30 percent", () => {
    expect(() =>
      buildDirectLaunchAmounts(
        { ...directDraft(), lpFeePercent: "1" },
        18,
      ),
    ).toThrow("fixed 0.30% pool fee");
  });
});

describe("direct launch calldata", () => {
  it("encodes the exact new-token launch struct", () => {
    const draft = directDraft();
    const amounts = buildDirectLaunchAmounts(draft, 18);
    const hookSalt =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    const data = encodeNewDirectLaunch(
      draft,
      amounts,
      draft.launchSalt as `0x${string}`,
      hookSalt,
    );
    const decoded = decodeFunctionData({
      abi: directLiquidityLauncherAbi,
      data,
    });

    expect(decoded.functionName).toBe("launch");
    expect(decoded.args?.[0]).toMatchObject({
      name: "Direct Token",
      symbol: "DIRECT",
      tokenLiquidityAmount: 250_000n * 10n ** 18n,
      hookSalt,
    });
  });

  it("mines an address with exactly the v4 callback mask", () => {
    const factory = "0x1111111111111111111111111111111111111111";
    const initCodeHash = keccak256(toHex("launcher hook fixture"));
    const mined = mineStandardHookSalt(factory, initCodeHash);
    const recomputed = getCreate2Address({
      from: factory,
      salt: mined.salt,
      bytecodeHash: initCodeHash,
    });

    expect(recomputed).toBe(mined.address);
    expect(BigInt(mined.address) & HOOK_FLAG_MASK).toBe(
      STANDARD_HOOK_FLAGS,
    );
  });
});
