const GOLDEN_TOKEN_ADDRESS =
  "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce";
const GOLDEN_POOL_ID =
  "0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229";
const GOLDEN_QUOTE_ADDRESS =
  "0x0000000000000000000000000000000000000000";
const MAXIMUM_FUTURE_SKEW_MS = 60_000;
const MAXIMUM_STALE_AGE_MS = 24 * 60 * 60_000;
const MAXIMUM_DEFERRED_PCAN_AGE_MS = 96 * 60 * 60_000;
const MINIMUM_CONFIRMATIONS = 12;
const MAXIMUM_EXECUTION_USD_DEVIATION_BPS = 25;
const MAINNET_POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90";
const MAINNET_ETH_USD_FEED = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";

function validMarketTime(value, nowMs) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) && parsed <= nowMs + MAXIMUM_FUTURE_SKEW_MS;
}

function positiveInteger(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}

function positiveDecimal(value) {
  return typeof value === "string" &&
    value.length <= 160 &&
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value) &&
    !/^0(?:\.0+)?$/u.test(value);
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
 * subsequently pass verifyBitqueryHistoricalGoldenReleaseV2.
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
 * Resolve the direct-address PCAN canary after the independent execution read.
 * PCAN is intentionally absent from public Explore discovery. Its detail,
 * exact-pool valuation, chart observation and execution receipt are bound to one
 * token, pool, block, observation time and FDV. The chart value remains an
 * explicitly labelled period median and is never treated as the latest trade.
 * The only older-than-24h value admitted by
 * this function is the exact PCAN candidate classified above.
 */
export function verifyBitqueryHistoricalGoldenReleaseV2(input) {
  const nowMs = input?.nowMs ?? Date.now();
  const detailToken = input?.detailToken;
  const chart = input?.chart;
  const parity = input?.parity;
  const detailPool = exactGoldenPool(detailToken);
  const detailValuation = detailToken?.valuation;
  const poolValuation = detailPool?.valuation;
  const trade = detailPool?.latestTrade;
  const lastPoint = Array.isArray(chart?.points) ? chart.points.at(-1) : null;
  const expectedValue = detailValuation?.valueWad;
  const expectedTime = detailValuation?.asOfTime;
  const expectedBlock = trade?.blockNumber;
  const expectedPrice = positiveInteger(trade?.priceUsdWad)
    ? BigInt(trade.priceUsdWad)
    : null;
  const periodMedianIsPositive = positiveDecimal(
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
    !positiveInteger(expectedValue) ||
    !validMarketTime(expectedTime, nowMs) ||
    poolValuation.valueUsdWad !== expectedValue ||
    poolValuation.fdvUsdWad !== expectedValue ||
    poolValuation.asOfTime !== expectedTime ||
    chart?.valuation?.status !== "unavailable" ||
    chart.valuation.reason !== "source-unavailable" ||
    "fdvUsdWad" in chart ||
    "valuationMetric" in chart ||
    chart?.schemaVersion !== "programmable.market-chart.v1" ||
    chart.source !== "bitquery" ||
    chart.readStatus !== "live" ||
    !["ready", "insufficient-history", "partial"].includes(chart.status) ||
    chart?.address?.toLowerCase() !== GOLDEN_TOKEN_ADDRESS ||
    chart?.range !== "all" ||
    chart?.identity?.chainId !== "1" ||
    chart?.identity?.tokenAddress?.toLowerCase() !== GOLDEN_TOKEN_ADDRESS ||
    chart?.identity?.poolId !== GOLDEN_POOL_ID ||
    chart?.identity?.quoteAddress !== GOLDEN_QUOTE_ADDRESS ||
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
    !periodMedianIsPositive ||
    parity?.schemaVersion !== "programmable.bitquery-golden-market-execution.v1" ||
    parity.providerCount !== 2 ||
    parity.tokenAddress !== GOLDEN_TOKEN_ADDRESS ||
    parity.poolId !== GOLDEN_POOL_ID ||
    parity.quoteAddress !== GOLDEN_QUOTE_ADDRESS ||
    parity.poolManager !== MAINNET_POOL_MANAGER ||
    parity.transactionHash !== trade?.transactionHash?.toLowerCase() ||
    parity.transactionIndex !== trade?.transactionIndex ||
    parity.bitqueryTradeOrdinal !== trade?.logIndex ||
    !Number.isSafeInteger(parity.receiptLogIndex) ||
    parity.receiptLogIndex < 0 ||
    parity.blockNumber !== expectedBlock ||
    parity.blockTime !== trade?.time ||
    !/^0x[0-9a-f]{64}$/u.test(parity.blockHash ?? "") ||
    parity.executionTokenSide !== trade?.tokenSide ||
    !/^-?[1-9][0-9]*$/u.test(parity.executionAmount0 ?? "") ||
    !positiveInteger(parity.executionAmount1) ||
    !positiveInteger(parity.executionNativeAmountWei) ||
    !positiveInteger(parity.executionTokenAmountRaw) ||
    parity.executionPriceQuoteWad !== trade?.priceQuoteWad ||
    !positiveInteger(parity.executionSqrtPriceX96) ||
    !positiveInteger(parity.executionLiquidity) ||
    parity.chainlink?.feedAddress !== MAINNET_ETH_USD_FEED ||
    !Number.isSafeInteger(parity.chainlink?.decimals) ||
    parity.chainlink.decimals < 0 ||
    parity.chainlink.decimals > 36 ||
    !positiveInteger(parity.chainlink?.roundId) ||
    !positiveInteger(parity.chainlink?.answer) ||
    !positiveInteger(parity.chainlink?.updatedAt) ||
    !positiveInteger(parity.chainlink?.answeredInRound) ||
    BigInt(parity.chainlink.answeredInRound) < BigInt(parity.chainlink.roundId) ||
    !Number.isSafeInteger(parity.confirmations) ||
    parity.confirmations < MINIMUM_CONFIRMATIONS ||
    parity.bitqueryFdvUsdWad !== expectedValue ||
    !positiveInteger(parity.chainlinkExecutionFdvUsdWad) ||
    !Number.isSafeInteger(parity.executionUsdDeviationBps) ||
    parity.executionUsdDeviationBps < 0 ||
    parity.executionUsdDeviationBps > MAXIMUM_EXECUTION_USD_DEVIATION_BPS
  ) {
    throw new Error("historical PCAN release evidence is not exactly bound");
  }

  return Object.freeze({
    schemaVersion: "programmable.bitquery-historical-release.v2",
    tokenAddress: GOLDEN_TOKEN_ADDRESS,
    poolId: GOLDEN_POOL_ID,
    transactionHash: parity.transactionHash,
    receiptLogIndex: parity.receiptLogIndex,
    blockNumber: expectedBlock,
    asOfTime: expectedTime,
    bitqueryFdvUsdWad: expectedValue,
    chainlinkExecutionFdvUsdWad: parity.chainlinkExecutionFdvUsdWad,
    confirmations: parity.confirmations,
    temporalStatus,
  });
}

export const BITQUERY_HISTORICAL_RELEASE_V2 = Object.freeze({
  tokenAddress: GOLDEN_TOKEN_ADDRESS,
  poolId: GOLDEN_POOL_ID,
  quoteAddress: GOLDEN_QUOTE_ADDRESS,
  maximumStaleAgeMs: MAXIMUM_STALE_AGE_MS,
  maximumDeferredPcanAgeMs: MAXIMUM_DEFERRED_PCAN_AGE_MS,
  minimumConfirmations: MINIMUM_CONFIRMATIONS,
  maximumExecutionUsdDeviationBps: MAXIMUM_EXECUTION_USD_DEVIATION_BPS,
});
