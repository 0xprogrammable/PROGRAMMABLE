const GOLDEN_TOKEN_ADDRESS =
  "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce";
const GOLDEN_POOL_ID =
  "0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229";
const MAXIMUM_FUTURE_SKEW_MS = 60_000;
const MAXIMUM_STALE_AGE_MS = 24 * 60 * 60_000;
const MAXIMUM_DEFERRED_PCAN_AGE_MS = 96 * 60 * 60_000;
const MINIMUM_CONFIRMATIONS = 12;
const MAXIMUM_DEVIATION_BPS = 1_500;

function validMarketTime(value, nowMs) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) && parsed <= nowMs + MAXIMUM_FUTURE_SKEW_MS;
}

function positiveInteger(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}

function positiveDecimalToWad(value) {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/u.exec(
    String(value ?? ""),
  );
  if (!match) return null;
  const wad = BigInt(match[1]) * 10n ** 18n +
    BigInt((match[2] ?? "").slice(0, 18).padEnd(18, "0") || "0");
  return wad > 0n ? wad : null;
}

function exactGoldenPool(token) {
  const market = token?.marketData;
  if (
    token?.tokenAddress?.toLowerCase() !== GOLDEN_TOKEN_ADDRESS ||
    market?.schemaVersion !== "programmable.market-data.v1" ||
    market.source !== "bitquery" ||
    market.primaryPoolId !== GOLDEN_POOL_ID
  ) return null;
  const pool = market.pools?.find(
    (candidate) => candidate?.identity?.poolId === GOLDEN_POOL_ID,
  );
  return pool?.identity?.tokenAddress?.toLowerCase() === GOLDEN_TOKEN_ADDRESS &&
      pool?.identity?.chainId === "1" &&
      pool?.identity?.protocol === "uniswap_v4" &&
      pool?.source === "bitquery" &&
      ["complete", "partial"].includes(pool?.quality) &&
      pool?.asOfTime === pool?.latestTrade?.time
    ? pool
    : null;
}

export function boundedStaleMarketTimeV1(value, nowMs = Date.now()) {
  return validMarketTime(value, nowMs) &&
    nowMs - Date.parse(value) <= MAXIMUM_STALE_AGE_MS;
}

function currentMarketTime(value, nowMs) {
  return validMarketTime(value, nowMs) &&
    nowMs - Date.parse(value) <= 6 * 60_000;
}

/**
 * The general stale ceiling stays at 24 hours. An older value can only be
 * deferred when the response itself carries the exact PCAN token and primary
 * pool identity and is capped at 96 hours. That fixed window keeps this
 * historical correctness canary finite; it is never evidence that the current
 * provider path is fresh. Deferral is not acceptance: the release must
 * subsequently pass verifyBitqueryHistoricalGoldenReleaseV1.
 */
export function classifyBitqueryStaleMarketReleaseV1(input) {
  const nowMs = input?.nowMs ?? Date.now();
  const token = input?.token;
  const valuation = token?.valuation;
  if (
    valuation?.status !== "available" ||
    valuation.freshness !== "stale" ||
    !validMarketTime(valuation.asOfTime, nowMs)
  ) {
    throw new Error("stale market release candidate is invalid");
  }
  if (boundedStaleMarketTimeV1(valuation.asOfTime, nowMs)) {
    return Object.freeze({ status: "bounded" });
  }
  if (exactGoldenPool(token) === null) {
    throw new Error("stale market release candidate exceeds the 24 hour ceiling");
  }
  if (
    nowMs - Date.parse(valuation.asOfTime) > MAXIMUM_DEFERRED_PCAN_AGE_MS
  ) {
    throw new Error("historical PCAN release evidence exceeds the 96 hour ceiling");
  }
  return Object.freeze({
    status: "deferred-pcan",
    tokenAddress: GOLDEN_TOKEN_ADDRESS,
    poolId: GOLDEN_POOL_ID,
    asOfTime: valuation.asOfTime,
    valueWad: valuation.valueWad,
  });
}

/**
 * Resolve the direct-address PCAN canary after the independent parity read.
 * PCAN is intentionally absent from public Explore discovery. Its detail,
 * exact-pool valuation, chart observation and parity receipt are bound to one
 * token, pool, block, observation time and FDV. The chart value remains an
 * explicitly labelled period median and is never treated as the latest trade.
 * The only older-than-24h value admitted by
 * this function is the exact PCAN candidate classified above.
 */
export function verifyBitqueryHistoricalGoldenReleaseV1(input) {
  const nowMs = input?.nowMs ?? Date.now();
  const detailToken = input?.detailToken;
  const chart = input?.chart;
  const parity = input?.parity;
  const detailPool = exactGoldenPool(detailToken);
  const detailValuation = detailToken?.valuation;
  const poolValuation = detailPool?.valuation;
  const chartValuation = chart?.valuation;
  const trade = detailPool?.latestTrade;
  const lastPoint = Array.isArray(chart?.points) ? chart.points.at(-1) : null;
  const expectedValue = detailValuation?.valueWad;
  const expectedTime = detailValuation?.asOfTime;
  const expectedBlock = trade?.blockNumber;
  const expectedPrice = positiveInteger(trade?.priceUsdWad)
    ? BigInt(trade.priceUsdWad)
    : null;
  const periodMedian = positiveDecimalToWad(
    lastPoint?.priceUsd ?? lastPoint?.priceQuote,
  );
  let temporalStatus;
  if (detailValuation?.freshness === "current") {
    if (!currentMarketTime(detailValuation.asOfTime, nowMs)) {
      throw new Error("current PCAN release evidence is not current");
    }
    temporalStatus = "current";
  } else {
    temporalStatus = classifyBitqueryStaleMarketReleaseV1({
      token: detailToken,
      nowMs,
    }).status;
  }

  if (
    detailPool === null ||
    detailValuation?.status !== "available" ||
    detailValuation.source !== "bitquery" ||
    detailValuation.metric !== "fdv" ||
    detailValuation.supplyBasis !== "total" ||
    detailValuation.currency !== "usd" ||
    !["current", "stale"].includes(detailValuation.freshness) ||
    poolValuation?.status !== "available" ||
    poolValuation.metric !== "fdv" ||
    poolValuation.supplyBasis !== "total" ||
    poolValuation.freshness !== detailValuation.freshness ||
    chartValuation?.status !== "available" ||
    chartValuation.metric !== "fdv" ||
    chartValuation.supplyBasis !== "total" ||
    chartValuation.freshness !== detailValuation.freshness ||
    !positiveInteger(expectedValue) ||
    !validMarketTime(expectedTime, nowMs) ||
    poolValuation.valueUsdWad !== expectedValue ||
    poolValuation.fdvUsdWad !== expectedValue ||
    poolValuation.asOfTime !== expectedTime ||
    chartValuation.valueUsdWad !== expectedValue ||
    chartValuation.fdvUsdWad !== expectedValue ||
    chartValuation.asOfTime !== expectedTime ||
    chart?.schemaVersion !== "programmable.market-chart.v1" ||
    chart.source !== "bitquery" ||
    chart.readStatus !== "live" ||
    !["ready", "insufficient-history", "partial"].includes(chart.status) ||
    chart?.address?.toLowerCase() !== GOLDEN_TOKEN_ADDRESS ||
    chart?.range !== "all" ||
    chart?.identity?.chainId !== "1" ||
    chart?.identity?.tokenAddress?.toLowerCase() !== GOLDEN_TOKEN_ADDRESS ||
    chart?.identity?.poolId !== GOLDEN_POOL_ID ||
    chart?.identity?.protocol !== "uniswap_v4" ||
    !Array.isArray(chart?.points) ||
    chart.points.length < 1 ||
    chart.asOfTime !== lastPoint?.observedAt ||
    lastPoint?.observedAt !== trade?.time ||
    lastPoint?.valueSemantics !== "period-median" ||
    lastPoint?.time !== lastPoint?.bucketEnd ||
    !validMarketTime(lastPoint?.bucketStart, nowMs) ||
    !validMarketTime(lastPoint?.bucketEnd, nowMs) ||
    Date.parse(lastPoint.bucketStart) >= Date.parse(lastPoint.bucketEnd) ||
    Date.parse(lastPoint.observedAt) < Date.parse(lastPoint.bucketStart) ||
    Date.parse(lastPoint.observedAt) > Date.parse(lastPoint.bucketEnd) ||
    lastPoint?.blockNumber !== expectedBlock ||
    expectedPrice === null ||
    periodMedian === null ||
    parity?.schemaVersion !== "programmable.bitquery-golden-market-parity.v1" ||
    parity.tokenAddress !== GOLDEN_TOKEN_ADDRESS ||
    parity.poolId !== GOLDEN_POOL_ID ||
    parity.blockNumber !== expectedBlock ||
    parity.blockTime !== trade?.time ||
    !/^0x[0-9a-f]{64}$/u.test(parity.blockHash ?? "") ||
    !positiveInteger(parity.historicalPoolLiquidity) ||
    !Number.isSafeInteger(parity.confirmations) ||
    parity.confirmations < MINIMUM_CONFIRMATIONS ||
    parity.bitqueryFdvUsdWad !== expectedValue ||
    !positiveInteger(parity.onchainFdvUsdWad) ||
    !Number.isSafeInteger(parity.deviationBps) ||
    parity.deviationBps < 0 ||
    parity.deviationBps > MAXIMUM_DEVIATION_BPS
  ) {
    throw new Error("historical PCAN release evidence is not exactly bound");
  }

  return Object.freeze({
    schemaVersion: "programmable.bitquery-historical-release.v1",
    tokenAddress: GOLDEN_TOKEN_ADDRESS,
    poolId: GOLDEN_POOL_ID,
    blockNumber: expectedBlock,
    asOfTime: expectedTime,
    bitqueryFdvUsdWad: expectedValue,
    historicalPoolLiquidity: parity.historicalPoolLiquidity,
    confirmations: parity.confirmations,
    temporalStatus,
  });
}

export const BITQUERY_HISTORICAL_RELEASE_V1 = Object.freeze({
  tokenAddress: GOLDEN_TOKEN_ADDRESS,
  poolId: GOLDEN_POOL_ID,
  maximumStaleAgeMs: MAXIMUM_STALE_AGE_MS,
  maximumDeferredPcanAgeMs: MAXIMUM_DEFERRED_PCAN_AGE_MS,
  minimumConfirmations: MINIMUM_CONFIRMATIONS,
  maximumDeviationBps: MAXIMUM_DEVIATION_BPS,
});
