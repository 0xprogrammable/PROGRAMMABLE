const Q192 = 1n << 192n;
const WAD = 10n ** 18n;

function powerOfTen(decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError("Unsupported token decimals");
  }
  return 10n ** BigInt(decimals);
}

/**
 * Uniswap v4 stores sqrt(currency1 / currency0) in Q64.96. Classic pools
 * always put native ETH in currency0 and the launched token in currency1.
 * This returns ETH per whole token, scaled to 18 decimals.
 */
export function nativePriceWadFromSqrtPriceX96(
  sqrtPriceX96: bigint,
  tokenDecimals: number,
  nativeDecimals = 18,
) {
  if (sqrtPriceX96 <= 0n) {
    throw new RangeError("The pool price is not initialized");
  }

  const squaredPrice = sqrtPriceX96 * sqrtPriceX96;
  const numerator = Q192 * powerOfTen(tokenDecimals) * WAD;
  const denominator = squaredPrice * powerOfTen(nativeDecimals);
  return numerator / denominator;
}

export function marketCapNativeWad(
  totalSupplyRaw: bigint,
  tokenDecimals: number,
  nativePriceWad: bigint,
) {
  if (totalSupplyRaw < 0n || nativePriceWad < 0n) {
    throw new RangeError("Supply and price must not be negative");
  }
  return (totalSupplyRaw * nativePriceWad) / powerOfTen(tokenDecimals);
}

/**
 * Calculates market cap from the Q64.96 ratio in one division. This avoids
 * losing precision by first rounding a very small per-token price to wei.
 */
export function marketCapNativeWadFromSqrtPriceX96(
  totalSupplyRaw: bigint,
  sqrtPriceX96: bigint,
  nativeDecimals = 18,
) {
  if (totalSupplyRaw < 0n) {
    throw new RangeError("Supply must not be negative");
  }
  if (sqrtPriceX96 <= 0n) {
    throw new RangeError("The pool price is not initialized");
  }

  return (
    (totalSupplyRaw * Q192 * WAD) /
    (sqrtPriceX96 * sqrtPriceX96 * powerOfTen(nativeDecimals))
  );
}
