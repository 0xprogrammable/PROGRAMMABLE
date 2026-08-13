import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as historicalReleaseGate from "../../scripts/perf/bitquery-historical-release-gate.mjs";

const {
  boundedStaleMarketTimeV1,
  classifyBitqueryStaleMarketReleaseV1,
  verifyBitqueryHistoricalGoldenReleaseV2,
} = historicalReleaseGate;

const TOKEN = "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce";
const POOL =
  "0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229";
const QUOTE = "0x0000000000000000000000000000000000000000";
const BLOCK = "25731000";
const TIME = "2026-08-10T11:50:47.000Z";
const NOW = Date.parse("2026-08-13T00:00:00.000Z");
const PRICE = "2000000000000000000000";
const FDV = "2000000000000000000000000";
const TRANSACTION_HASH = `0x${"33".repeat(32)}`;
const POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90";
const ETH_USD_FEED = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
const MAXIMUM_DEFERRED_PCAN_AGE_MS = 96 * 60 * 60_000;

function detailToken(overrides: Record<string, unknown> = {}) {
  return {
    tokenAddress: TOKEN,
    tokenDecimals: 18,
    totalSupplyRaw: "1000000000000000000000",
    valuation: {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      source: "bitquery",
      freshness: "stale",
      valueWad: FDV,
      asOfTime: TIME,
    },
    marketData: {
      schemaVersion: "programmable.market-data.v1",
      source: "bitquery",
      primaryPoolId: POOL,
      pools: [{
        identity: {
          chainId: "1",
          tokenAddress: TOKEN,
          poolId: POOL,
          protocol: "uniswap_v4",
        },
        source: "bitquery",
        status: "stale",
        quality: "partial",
        asOfTime: TIME,
        latestTrade: {
          transactionHash: TRANSACTION_HASH,
          transactionIndex: 66,
          logIndex: 0,
          blockNumber: BLOCK,
          time: TIME,
          tokenSide: "sell",
          tokenAmount: "1",
          priceQuoteWad: "1000000000000",
          quoteAddress: QUOTE,
          priceUsdWad: PRICE,
        },
        valuation: {
          status: "available",
          metric: "fdv",
          supplyBasis: "total",
          freshness: "stale",
          valueUsdWad: FDV,
          fdvUsdWad: FDV,
          asOfTime: TIME,
        },
      }],
    },
    ...overrides,
  };
}

function chart() {
  return {
    schemaVersion: "programmable.market-chart.v1",
    source: "bitquery",
    readStatus: "live",
    status: "ready",
    range: "all",
    address: TOKEN,
    identity: {
      chainId: "1",
      tokenAddress: TOKEN,
      poolId: POOL,
      quoteAddress: QUOTE,
      protocol: "uniswap_v4",
    },
    points: [
      {
        blockNumber: "25730000",
        time: "2026-08-10T11:00:00.000Z",
        bucketStart: "2026-08-10T10:00:00.000Z",
        bucketEnd: "2026-08-10T11:00:00.000Z",
        observedAt: "2026-08-10T10:50:47.000Z",
        valueSemantics: "period-median",
        priceUsd: "1900",
      },
      {
        blockNumber: BLOCK,
        time: "2026-08-10T12:00:00.000Z",
        bucketStart: "2026-08-10T11:00:00.000Z",
        bucketEnd: "2026-08-10T12:00:00.000Z",
        observedAt: TIME,
        valueSemantics: "period-median",
        priceUsd: "2000",
      },
    ],
    valuation: {
      status: "unavailable",
      reason: "source-unavailable",
    },
    asOfTime: TIME,
  };
}

function parity(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "programmable.bitquery-golden-market-execution.v1",
    providerCount: 2,
    tokenAddress: TOKEN,
    poolId: POOL,
    quoteAddress: QUOTE,
    poolManager: POOL_MANAGER,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 66,
    bitqueryTradeOrdinal: 0,
    receiptLogIndex: 122,
    blockNumber: BLOCK,
    blockHash: `0x${"11".repeat(32)}`,
    blockTime: TIME,
    executionTokenSide: "sell",
    executionAmount0: "-1000000000000",
    executionAmount1: "1000000000000000000",
    executionNativeAmountWei: "1000000000000",
    executionTokenAmountRaw: "1000000000000000000",
    executionPriceQuoteWad: "1000000000000",
    executionSqrtPriceX96: "1000000000000000000",
    executionLiquidity: "1000000",
    confirmations: 20,
    chainlink: {
      feedAddress: ETH_USD_FEED,
      decimals: 8,
      roundId: "100",
      answer: "200000000000",
      updatedAt: "1786359287",
      answeredInRound: "100",
    },
    bitqueryFdvUsdWad: FDV,
    chainlinkExecutionFdvUsdWad: FDV,
    executionUsdDeviationBps: 0,
    ...overrides,
  };
}

describe("Bitquery historical release gate", () => {
  it("publishes the finite deferred PCAN evidence ceiling", () => {
    expect(
      historicalReleaseGate.BITQUERY_HISTORICAL_RELEASE_V2
        .maximumDeferredPcanAgeMs,
    ).toBe(MAXIMUM_DEFERRED_PCAN_AGE_MS);
  });

  it("accepts an older-than-24h PCAN observation only after exact parity", () => {
    const token = detailToken();
    expect(boundedStaleMarketTimeV1(TIME, NOW)).toBe(false);
    expect(classifyBitqueryStaleMarketReleaseV1({ token, nowMs: NOW })).toMatchObject({
      status: "deferred-pcan",
      tokenAddress: TOKEN,
      poolId: POOL,
    });
    expect(verifyBitqueryHistoricalGoldenReleaseV2({
      detailToken: token,
      chart: chart(),
      parity: parity(),
      nowMs: NOW,
    })).toMatchObject({
      schemaVersion: "programmable.bitquery-historical-release.v2",
      temporalStatus: "deferred-pcan",
      transactionHash: TRANSACTION_HASH,
      receiptLogIndex: 122,
      blockNumber: BLOCK,
      bitqueryFdvUsdWad: FDV,
      chainlinkExecutionFdvUsdWad: FDV,
      confirmations: 20,
    });
  });

  it("accepts the canonical high precision period median emitted by PCAN", () => {
    const highPrecisionChart = chart();
    const lastPoint = highPrecisionChart.points[1] as {
      priceUsd?: string;
      priceQuote?: string;
    };
    delete lastPoint.priceUsd;
    lastPoint.priceQuote = "0.00000001100841713949";
    expect(verifyBitqueryHistoricalGoldenReleaseV2({
      detailToken: detailToken(),
      chart: highPrecisionChart,
      parity: parity(),
      nowMs: NOW,
    })).toMatchObject({
      schemaVersion: "programmable.bitquery-historical-release.v2",
      receiptLogIndex: 122,
    });
  });

  it("accepts the exact 96h boundary and rejects evidence one millisecond older", () => {
    const token = detailToken();
    const boundaryNow = Date.parse(TIME) + MAXIMUM_DEFERRED_PCAN_AGE_MS;
    expect(classifyBitqueryStaleMarketReleaseV1({
      token,
      nowMs: boundaryNow,
    })).toMatchObject({ status: "deferred-pcan" });
    expect(() => classifyBitqueryStaleMarketReleaseV1({
      token,
      nowMs: boundaryNow + 1,
    })).toThrow("historical PCAN release evidence exceeds the 96 hour ceiling");
    expect(() => verifyBitqueryHistoricalGoldenReleaseV2({
      detailToken: token,
      chart: chart(),
      parity: parity(),
      nowMs: boundaryNow + 1,
    })).toThrow("historical PCAN release evidence exceeds the 96 hour ceiling");
  });

  it.each([
    ["schema", { schemaVersion: "programmable.bitquery-golden-market-execution.v2" }],
    ["token", { tokenAddress: "0x1111111111111111111111111111111111111111" }],
    ["pool", { poolId: `0x${"22".repeat(32)}` }],
    ["transaction", { transactionHash: `0x${"44".repeat(32)}` }],
    ["receipt log", { receiptLogIndex: -1 }],
    ["execution quote", { executionPriceQuoteWad: "1000000000001" }],
    ["Chainlink feed", { chainlink: { ...parity().chainlink, feedAddress: TOKEN } }],
    ["Chainlink round", { chainlink: { ...parity().chainlink, answeredInRound: "99" } }],
    ["block", { blockNumber: "25731001" }],
    ["value", { bitqueryFdvUsdWad: (BigInt(FDV) + 1n).toString() }],
    ["confirmations", { confirmations: 11 }],
    ["execution liquidity", { executionLiquidity: "0" }],
    ["execution USD deviation", { executionUsdDeviationBps: 26 }],
  ])("fails closed when the deferred PCAN parity drifts in %s", (_field, drift) => {
    expect(() => verifyBitqueryHistoricalGoldenReleaseV2({
      detailToken: detailToken(),
      chart: chart(),
      parity: parity(drift),
      nowMs: NOW,
    })).toThrow("historical PCAN release evidence is not exactly bound");
  });

  it("fails closed when the last chart observation is not the exact trade block", () => {
    const driftedChart = chart();
    driftedChart.points[1].blockNumber = "25731001";
    expect(() => verifyBitqueryHistoricalGoldenReleaseV2({
      detailToken: detailToken(),
      chart: driftedChart,
      parity: parity(),
      nowMs: NOW,
    })).toThrow("historical PCAN release evidence is not exactly bound");
  });

  it("fails closed when the chart quote identity is not canonical native ETH", () => {
    const driftedChart = chart();
    driftedChart.identity.quoteAddress =
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
    expect(() => verifyBitqueryHistoricalGoldenReleaseV2({
      detailToken: detailToken(),
      chart: driftedChart,
      parity: parity(),
      nowMs: NOW,
    })).toThrow("historical PCAN release evidence is not exactly bound");
  });

  it("keeps the 24h ceiling hard for every non-PCAN token", () => {
    const token = detailToken({
      tokenAddress: "0x1111111111111111111111111111111111111111",
    });
    expect(() => classifyBitqueryStaleMarketReleaseV1({
      token,
      nowMs: NOW,
    })).toThrow("exceeds the 24 hour ceiling");
  });

  it("does not defer PCAN when its primary pool binding is wrong", () => {
    const token = detailToken();
    token.marketData.primaryPoolId = `0x${"22".repeat(32)}`;
    expect(() => classifyBitqueryStaleMarketReleaseV1({
      token,
      nowMs: NOW,
    })).toThrow("exceeds the 24 hour ceiling");
  });
});
