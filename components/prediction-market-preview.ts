import type { Address, Hex } from "viem";

import type { PredictionMarketView } from "@/lib/prediction-market-trading";
import { formatPredictionMarketObservation } from "@/lib/prediction-market-trading";

export const PREDICTION_PREVIEW_MARKET_KEY =
  `0x${"11".repeat(32)}` as Hex;

const vault = "0x1111111111111111111111111111111111111001" as Address;
const checkpoint = "0x1111111111111111111111111111111111111002" as Address;
const router = "0x1111111111111111111111111111111111111003" as Address;
const hook = "0x1111111111111111111111111111111111111004" as Address;
const yesToken = "0x1111111111111111111111111111111111111005" as Address;
const noToken = "0x1111111111111111111111111111111111111006" as Address;

function marketFixture({
  accountedLiabilityAtoms,
  hoursUntilResult,
  probabilityYesBps,
  semanticKey,
  thresholdAtoms,
  nowSeconds,
}: {
  accountedLiabilityAtoms: bigint;
  hoursUntilResult: number;
  probabilityYesBps: number;
  semanticKey: Hex;
  thresholdAtoms: bigint;
  nowSeconds: number;
}): PredictionMarketView {
  const observationTime = BigInt(nowSeconds + hoursUntilResult * 60 * 60);
  const cutoff = observationTime - 60n;
  const thresholdLabel = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Number(thresholdAtoms / 100_000_000n));
  return {
    accountedLiabilityAtoms,
    blockNumber: 43_200_000n,
    blockTimestamp: BigInt(nowSeconds),
    canonicalPoolId: semanticKey,
    checkpoint,
    checkpointStatus: "AWAITING",
    cutoff,
    fallbackChallengeDeadline: 0n,
    fallbackRequestedAt: 0n,
    hardResolutionDeadline: observationTime + 7n * 24n * 60n * 60n,
    liquidity: 200_000n,
    noBalanceAtoms: 37_500n,
    noToken,
    noTokenName: `BTC ≥ $${thresholdLabel} · NO`,
    observationTime,
    poolId: semanticKey,
    poolKey: {
      currency0: yesToken,
      currency1: noToken,
      fee: 200,
      hooks: hook,
      tickSpacing: 10,
    },
    probabilityYesBps,
    protocolFee: 0,
    resolvedPriceAtoms: 0n,
    resolutionDeadline: observationTime + 26n * 60n * 60n,
    router,
    semanticKey,
    sqrtPriceX96: 1n << 96n,
    state: "OPEN",
    thresholdAtoms,
    tick: 0,
    title: `Will BTC be at or above $${thresholdLabel} on ${formatPredictionMarketObservation(observationTime)}?`,
    vault,
    yesBalanceAtoms: 82_400n,
    yesToken,
    yesTokenName: `BTC ≥ $${thresholdLabel} · YES`,
  };
}

export function predictionPreviewMarkets(nowSeconds: number) {
  return [
    marketFixture({
      accountedLiabilityAtoms: 42_850_000n,
      hoursUntilResult: 36,
      nowSeconds,
      probabilityYesBps: 6_400,
      semanticKey: PREDICTION_PREVIEW_MARKET_KEY,
      thresholdAtoms: 60_000n * 100_000_000n,
    }),
    marketFixture({
      accountedLiabilityAtoms: 18_240_000n,
      hoursUntilResult: 74,
      nowSeconds,
      probabilityYesBps: 3_700,
      semanticKey: `0x${"22".repeat(32)}`,
      thresholdAtoms: 65_000n * 100_000_000n,
    }),
    marketFixture({
      accountedLiabilityAtoms: 9_610_000n,
      hoursUntilResult: 168,
      nowSeconds,
      probabilityYesBps: 5_200,
      semanticKey: `0x${"33".repeat(32)}`,
      thresholdAtoms: 58_000n * 100_000_000n,
    }),
  ] as const;
}
