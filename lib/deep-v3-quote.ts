import { CurrencyAmount, Ether, Token } from "@uniswap/sdk-core";
import { Pool, Position } from "@uniswap/v4-sdk";

import { DEEP_V3_FIXED_POLICY } from "./deep-v3";
import { LaunchInputError } from "./launch-transaction";

const BASIS_POINTS = 10_000n;
const QUOTE_TOKEN = "0x1111111111111111111111111111111111111111";
const ZERO_HOOK = "0x0000000000000000000000000000000000000000";

export type DeepV3InitialBuyQuote = {
  grossNativeAmount: bigint;
  hookFeeAmount: bigint;
  poolNativeAmount: bigint;
  quotedInitialTokenOut: bigint;
  minimumInitialTokenOut: bigint;
  initialBuySqrtPriceLimitX96: bigint;
};

export async function quoteDeepV3InitialBuy(
  grossNativeAmount: bigint,
): Promise<DeepV3InitialBuyQuote> {
  if (grossNativeAmount < DEEP_V3_FIXED_POLICY.minimumInitialBuyWei) {
    throw new LaunchInputError(
      "The Initial Buy is below the Deep minimum",
    );
  }

  const hookFeeAmount =
    (grossNativeAmount *
      BigInt(DEEP_V3_FIXED_POLICY.totalHookFeeBps)) /
    BASIS_POINTS;
  const poolNativeAmount = grossNativeAmount - hookFeeAmount;
  const native = Ether.onChain(1);
  const token = new Token(1, QUOTE_TOKEN, 18, "DEEP", "Deep");
  const emptyPool = new Pool(
    native,
    token,
    DEEP_V3_FIXED_POLICY.lpFeePips,
    DEEP_V3_FIXED_POLICY.tickSpacing,
    ZERO_HOOK,
    DEEP_V3_FIXED_POLICY.initialSqrtPriceX96.toString(),
    "0",
    DEEP_V3_FIXED_POLICY.initialTick,
    [],
  );
  const position = Position.fromAmount1({
    pool: emptyPool,
    tickLower: DEEP_V3_FIXED_POLICY.fullRangeTickLower,
    tickUpper: DEEP_V3_FIXED_POLICY.initialTick,
    amount1: DEEP_V3_FIXED_POLICY.tokenSupplyWei.toString(),
  });
  const liquidity = position.liquidity.toString();
  const quotedPool = new Pool(
    native,
    token,
    DEEP_V3_FIXED_POLICY.lpFeePips,
    DEEP_V3_FIXED_POLICY.tickSpacing,
    ZERO_HOOK,
    DEEP_V3_FIXED_POLICY.initialSqrtPriceX96.toString(),
    "0",
    DEEP_V3_FIXED_POLICY.initialTick,
    [
      {
        index: DEEP_V3_FIXED_POLICY.fullRangeTickLower,
        liquidityGross: liquidity,
        liquidityNet: liquidity,
      },
      {
        index: DEEP_V3_FIXED_POLICY.initialTick,
        liquidityGross: liquidity,
        liquidityNet: `-${liquidity}`,
      },
    ],
  );

  let quotedInitialTokenOut: bigint;
  let nextSqrtRatioX96: bigint;
  try {
    const [output, nextPool] = await quotedPool.getOutputAmount(
      CurrencyAmount.fromRawAmount(
        native,
        poolNativeAmount.toString(),
      ),
    );
    if (!output.currency.isToken) throw new Error("currency");
    quotedInitialTokenOut = BigInt(output.quotient.toString());
    nextSqrtRatioX96 = BigInt(nextPool.sqrtRatioX96.toString());
  } catch {
    throw new LaunchInputError(
      "The Initial Buy could not be quoted safely",
    );
  }

  if (
    nextSqrtRatioX96 <
    DEEP_V3_FIXED_POLICY.minimumInitialBuySqrtPriceLimitX96
  ) {
    throw new LaunchInputError(
      "The Initial Buy is too large for Deep's fixed price protection",
    );
  }
  const minimumInitialTokenOut =
    (quotedInitialTokenOut *
      (BASIS_POINTS -
        BigInt(DEEP_V3_FIXED_POLICY.initialBuySlippageBps))) /
    BASIS_POINTS;
  if (minimumInitialTokenOut <= 1n) {
    throw new LaunchInputError(
      "The Initial Buy output protection is too small",
    );
  }

  return {
    grossNativeAmount,
    hookFeeAmount,
    poolNativeAmount,
    quotedInitialTokenOut,
    minimumInitialTokenOut,
    initialBuySqrtPriceLimitX96:
      DEEP_V3_FIXED_POLICY.minimumInitialBuySqrtPriceLimitX96,
  };
}
