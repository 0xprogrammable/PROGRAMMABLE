import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { programmablePublicOpenApi } from "../lib/public-openapi";

function validator(
  name: "OperationsHealth" | "TokenAnalyticsResponse" | "TokenChartResponse",
) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile({
    $schema: programmablePublicOpenApi.jsonSchemaDialect,
    ...programmablePublicOpenApi.components.schemas[name],
    components: { schemas: programmablePublicOpenApi.components.schemas },
  });
}

const TOKEN = "0x1111111111111111111111111111111111111111";
const QUOTE = "0x0000000000000000000000000000000000000000";
const POOL = `0x${"22".repeat(32)}`;
const identity = {
  chainId: "1",
  protocol: "uniswap_v4",
  tokenAddress: TOKEN,
  poolId: POOL,
  quoteAddress: QUOTE,
};

const SECURITY_KEYS = [
  "schemaVersion",
  "source",
  "fetchedAt",
  "identity",
  "tokenAddress",
  "isShowAlert",
  "isOpenSource",
  "isBlacklisted",
  "isHoneypot",
  "isOwnerRenounced",
  "isMintRenounced",
  "isFreezeAccountRenounced",
  "isWashTrading",
  "top10HolderRatio",
  "developerTeamHoldRatio",
  "creatorBalanceRatio",
  "suspectedInsiderHoldRatio",
  "rugRatio",
  "ratTraderAmountRatio",
  "bundlerTraderAmountRatio",
  "buyTaxRatio",
  "sellTaxRatio",
  "averageTaxRatio",
  "highTaxRatio",
  "burnRatio",
  "developerTokenBurnAmount",
  "developerTokenBurnRatio",
  "burnStatus",
  "creatorTokenStatus",
  "sniperCount",
  "canSellCount",
  "cannotSellCount",
  "hideRisk",
  "flags",
  "lockSummary",
] as const;

const POOL_KEYS = [
  "schemaVersion",
  "source",
  "marketScope",
  "poolAttribution",
  "currency",
  "fetchedAt",
  "identity",
  "tokenAddress",
  "providerAddress",
  "baseAddress",
  "quoteAddress",
  "token0Address",
  "token1Address",
  "quoteSymbol",
  "exchange",
  "liquidityUsd",
  "baseReserve",
  "quoteReserve",
  "baseReserveValueUsd",
  "quoteReserveValueUsd",
  "initialLiquidityUsd",
  "initialBaseReserve",
  "initialQuoteReserve",
  "priceUsd",
  "feeRatio",
  "creationTimestamp",
] as const;

describe("public GMGN analytics and chart OpenAPI contract", () => {
  it("documents the secret-free effective GMGN runtime rate", () => {
    const operation = programmablePublicOpenApi.paths["/api/ops/health"].get;
    expect(operation).toMatchObject({
      operationId: "getOperationsHealth",
      security: [],
    });
    expect(operation.description).toContain("every server-side GMGN adapter");
    const gmgn = programmablePublicOpenApi.components.schemas
      .OperationsGmgnProvider;
    expect(gmgn.required).toContain("requestsPerSecond");
    expect(gmgn.required).toContain("accountGateMode");
    expect(gmgn.properties.requestsPerSecond).toEqual({
      type: "integer",
      minimum: 1,
      maximum: 20,
    });
    expect(gmgn.properties.accountGateMode).toEqual({
      type: "string",
      enum: [
        "multiflight-v1",
        "legacy-singleflight-v1",
        "unavailable",
      ],
    });

    const validate = validator("OperationsHealth");
    const health = {
      status: "ready",
      provider: { name: "gmgn", configured: true },
      providers: [
        {
          name: "gmgn",
          role: "primary-token-market",
          configured: true,
          requestsPerSecond: 20,
          accountGateMode: "multiflight-v1",
        },
        {
          name: "bitquery",
          role: "exact-pool-chart-fallback",
          configured: true,
        },
        {
          name: "dexscreener",
          role: "batch-fail-soft-fallback",
          configured: true,
        },
      ],
      checkedAt: "2026-09-01T00:00:00.000Z",
    };
    expect(validate(health), validate.errors?.map((error) =>
      `${error.instancePath} ${error.message}`).join("\n")).toBe(true);
    expect(validate({
      ...health,
      providers: [{ ...health.providers[0], requestsPerSecond: 21 },
        ...health.providers.slice(1)],
    })).toBe(false);
  });

  it("documents the private-rank discovery commitment in body and header", () => {
    const discovery = programmablePublicOpenApi.components.schemas
      .ExploreDiscoveryRanking;
    expect(discovery.required).toContain("rankingCommitment");
    expect(discovery.required).toContain("matchedUniqueTokenCount");
    expect(discovery.properties.rankingCommitment).toMatchObject({
      type: "string",
      pattern: "^sha256:[0-9a-f]{64}$",
    });
    expect(discovery.description).toContain("No raw GMGN ranking payload");
    const headers = programmablePublicOpenApi.paths["/api/explore"].get
      .responses["200"].headers;
    expect(headers["X-Programmable-Discovery-Ranking-Commitment"].schema)
      .toEqual({ type: "string", pattern: "^sha256:[0-9a-f]{64}$" });
    expect(headers["X-Programmable-Discovery-Matched-Unique-Count"].schema)
      .toEqual({ type: "string", pattern: "^(?:0|[1-9][0-9]*)$" });
  });

  it("documents canonical-bound analytics and private ranking cache semantics", () => {
    const operation = programmablePublicOpenApi.paths[
      "/api/explore/token/analytics"
    ].get;
    const parameters = new Map(
      operation.parameters.map((parameter) => [parameter.name, parameter]),
    );

    expect([...parameters.keys()]).toEqual([
      "chain",
      "address",
      "section",
      "limit",
    ]);
    expect(parameters.get("section")?.schema).toEqual({
      type: "string",
      enum: ["summary", "holders", "traders"],
      default: "summary",
    });
    expect(parameters.get("limit")?.schema).toEqual({
      type: "integer",
      const: 20,
      default: 20,
    });
    expect(operation.description).toContain("canonical Ethereum launch authorities");
    expect(operation.description).toContain("strict GMGN token_info admission proof");
    expect(operation.description).toContain("token-level security heuristics");
    expect(operation.description).toContain("unavailable pool attribution");
    expect(operation.description).toContain("token-address rankings");
    expect(operation.description).toContain("raw GMGN envelopes");
    const ranking = programmablePublicOpenApi.components.schemas
      .GmgnTokenWalletRanking;
    expect(ranking.required).toEqual(["fetchedAt", "wallets"]);
    expect(Object.keys(ranking.properties)).toEqual(["fetchedAt", "wallets"]);
    expect(ranking.properties.wallets.maxItems).toBe(20);
    expect(ranking.properties.wallets.items.required).toEqual([
      "address",
      "usdValue",
      "amountRatio",
      "buyVolumeUsd",
      "sellVolumeUsd",
      "profitUsd",
      "profitRatio",
    ]);
    expect(ranking.properties.wallets.items.additionalProperties).toBe(false);
    expect(ranking.description).toContain("transaction hashes");
    const headers = operation.responses["200"].headers;
    expect(headers["X-Programmable-Analytics-Provider"].schema).toEqual({
      const: "gmgn",
    });
    expect(headers["X-Programmable-Analytics-Read-Status"].schema.enum).toEqual([
      "ready",
      "partial",
      "unavailable",
    ]);
    expect(headers["Cache-Control"].description).toContain(
      "holders, traders, and unavailable responses are private no-store",
    );
  });

  it("documents pool currencies as address-sorted canonical derivations", () => {
    const pool = programmablePublicOpenApi.components.schemas
      .GmgnTokenPoolInfo;
    expect(pool.properties.token0Address.description).toContain(
      "Address-sorted Uniswap v4 currency0",
    );
    expect(pool.properties.token1Address.description).toContain(
      "Address-sorted Uniswap v4 currency1",
    );
  });

  it("accepts only the privacy-reduced seven-field wallet ranking", () => {
    const validate = validator("TokenAnalyticsResponse");
    const response = {
      schemaVersion: "programmable.token-analytics.v1",
      status: "ready",
      provider: "gmgn",
      analyticsScope: "token",
      poolAttribution: "unavailable",
      section: "holders",
      identity,
      analytics: {
        ranking: {
          fetchedAt: "2026-09-01T08:00:00.000Z",
          wallets: [{
            address: "0x3333333333333333333333333333333333333333",
            usdValue: 1200.5,
            amountRatio: 0.01,
            buyVolumeUsd: null,
            sellVolumeUsd: 25,
            profitUsd: -10,
            profitRatio: -0.05,
          }],
        },
      },
    };

    expect(validate(response), JSON.stringify(validate.errors)).toBe(true);

    const rawProviderMetadata = structuredClone(response) as Record<
      string,
      unknown
    >;
    const analytics = rawProviderMetadata.analytics as Record<string, unknown>;
    const ranking = analytics.ranking as Record<string, unknown>;
    ranking.source = "gmgn";
    expect(validate(rawProviderMetadata)).toBe(false);
  });

  it("publishes the exact closed security projection, including lock details", () => {
    const security = programmablePublicOpenApi.components.schemas
      .GmgnTokenSecurity;
    expect(security.required).toEqual(SECURITY_KEYS);
    expect(Object.keys(security.properties)).toEqual(SECURITY_KEYS);
    expect(security.additionalProperties).toBe(false);
    expect(security.properties.flags).toMatchObject({
      type: "array",
      maxItems: 64,
      items: { type: "string", maxLength: 128 },
    });

    const lockSummary = security.properties.lockSummary.oneOf[0];
    expect(lockSummary.required).toEqual([
      "isLocked",
      "lockRatio",
      "remainingLockRatio",
      "details",
    ]);
    expect(Object.keys(lockSummary.properties)).toEqual(lockSummary.required);
    expect(lockSummary.additionalProperties).toBe(false);
    expect(lockSummary.properties.details.maxItems).toBe(256);
    expect(lockSummary.properties.details.items.required).toEqual([
      "ratio",
      "poolAddress",
      "isBlackhole",
    ]);
    expect(Object.keys(lockSummary.properties.details.items.properties)).toEqual(
      lockSummary.properties.details.items.required,
    );
    expect(lockSummary.properties.details.items.additionalProperties).toBe(false);
    expect(security.properties.isShowAlert.type).toEqual(["boolean", "null"]);
    expect(security.properties.top10HolderRatio.type).toEqual([
      "string",
      "null",
    ]);
    expect(security.properties.sniperCount.type).toEqual(["integer", "null"]);
    expect(security.properties.lockSummary.oneOf[1]).toEqual({ type: "null" });
  });

  it("publishes the exact closed pool projection with required nullable values", () => {
    const pool = programmablePublicOpenApi.components.schemas.GmgnTokenPoolInfo;
    expect(pool.required).toEqual(POOL_KEYS);
    expect(Object.keys(pool.properties)).toEqual(POOL_KEYS);
    expect(pool.additionalProperties).toBe(false);
    expect(pool.properties.quoteSymbol.type).toEqual(["string", "null"]);
    for (const key of [
      "baseReserveValueUsd",
      "quoteReserveValueUsd",
      "initialLiquidityUsd",
      "initialBaseReserve",
      "initialQuoteReserve",
      "priceUsd",
      "feeRatio",
    ] as const) {
      expect(pool.properties[key].type).toEqual(["string", "null"]);
    }
  });

  it("validates exact summary projections and rejects unknown nested fields", () => {
    const validate = validator("TokenAnalyticsResponse");
    const response = {
      schemaVersion: "programmable.token-analytics.v1",
      status: "ready",
      provider: "gmgn",
      analyticsScope: "token",
      poolAttribution: "unavailable",
      section: "summary",
      identity,
      analytics: {
        security: {
          schemaVersion: "programmable.gmgn-token-security.v1",
          source: "gmgn",
          fetchedAt: "2026-09-01T08:00:00.000Z",
          identity,
          tokenAddress: TOKEN,
          isShowAlert: false,
          isOpenSource: true,
          isBlacklisted: false,
          isHoneypot: false,
          isOwnerRenounced: true,
          isMintRenounced: true,
          isFreezeAccountRenounced: null,
          isWashTrading: false,
          top10HolderRatio: "0.1",
          developerTeamHoldRatio: null,
          creatorBalanceRatio: null,
          suspectedInsiderHoldRatio: null,
          rugRatio: null,
          ratTraderAmountRatio: null,
          bundlerTraderAmountRatio: null,
          buyTaxRatio: "0",
          sellTaxRatio: "0",
          averageTaxRatio: "0",
          highTaxRatio: "0",
          burnRatio: null,
          developerTokenBurnAmount: null,
          developerTokenBurnRatio: null,
          burnStatus: null,
          creatorTokenStatus: null,
          sniperCount: null,
          canSellCount: null,
          cannotSellCount: null,
          hideRisk: false,
          flags: ["verified"],
          lockSummary: {
            isLocked: true,
            lockRatio: "0.95",
            remainingLockRatio: "0.05",
            details: [{
              ratio: "0.95",
              poolAddress: "0x3333333333333333333333333333333333333333",
              isBlackhole: false,
            }],
          },
        },
        pool: {
          schemaVersion: "programmable.gmgn-token-pool-info.v1",
          source: "gmgn",
          marketScope: "token",
          poolAttribution: "unavailable",
          currency: "USD",
          fetchedAt: "2026-09-01T08:00:00.000Z",
          identity,
          tokenAddress: TOKEN,
          providerAddress: TOKEN,
          baseAddress: TOKEN,
          quoteAddress: QUOTE,
          token0Address: QUOTE,
          token1Address: TOKEN,
          quoteSymbol: "ETH",
          exchange: "uniswap_v4",
          liquidityUsd: "12000",
          baseReserve: "10000",
          quoteReserve: "10",
          baseReserveValueUsd: "6000",
          quoteReserveValueUsd: "6000",
          initialLiquidityUsd: null,
          initialBaseReserve: null,
          initialQuoteReserve: null,
          priceUsd: "1",
          feeRatio: "0.01",
          creationTimestamp: 1_788_235_000,
        },
      },
    };

    expect(validate(response), JSON.stringify(validate.errors)).toBe(true);

    const securityExtra = structuredClone(response);
    Object.assign(securityExtra.analytics.security, { rawRisk: true });
    expect(validate(securityExtra)).toBe(false);

    const lockDetailExtra = structuredClone(response);
    Object.assign(
      lockDetailExtra.analytics.security.lockSummary.details[0],
      { providerPoolName: "hidden" },
    );
    expect(validate(lockDetailExtra)).toBe(false);

    const poolExtra = structuredClone(response);
    Object.assign(poolExtra.analytics.pool, { providerPayload: {} });
    expect(validate(poolExtra)).toBe(false);
  });

  it("accepts GMGN period-close charts without inventing a block number", () => {
    const validate = validator("TokenChartResponse");
    const chart = {
      schemaVersion: "programmable.gmgn-market-chart.v1",
      source: "gmgn",
      seriesScope: "token",
      poolAttribution: "unavailable",
      readStatus: "live",
      status: "insufficient-history",
      generatedAt: "2026-09-01T08:00:00.000Z",
      identity,
      identityProof: {
        schemaVersion: "programmable.gmgn-chart-identity-proof.v1",
        source: "gmgn-token-info",
        verifiedAt: "2026-09-01T07:59:59.000Z",
        identity,
        poolAttribution: "unavailable",
        canonicalSupply: {
          totalSupplyRaw: "1000000000000000000000000",
          tokenDecimals: 18,
        },
      },
      range: "1h",
      resolution: "1m",
      requestedFrom: "2026-09-01T07:00:00.000Z",
      requestedTo: "2026-09-01T08:00:00.000Z",
      points: [{
        time: "2026-09-01T07:59:00.000Z",
        bucketStart: "2026-09-01T07:59:00.000Z",
        bucketEnd: "2026-09-01T08:00:00.000Z",
        valueSemantics: "period-close",
        priceUsd: "0.125",
        ohlcUsd: {
          open: "0.1",
          high: "0.13",
          low: "0.09",
          close: "0.125",
        },
        volumeUsdWad: "1000000000000000000",
      }],
      candleCount: 1,
      volumeUsdWad: "1000000000000000000",
      asOfTime: "2026-09-01T08:00:00.000Z",
      truncated: false,
    };

    expect(validate(chart), JSON.stringify(validate.errors)).toBe(true);
    expect(chart.points[0]).not.toHaveProperty("blockNumber");
    expect(validate({ ...chart, seriesScope: undefined })).toBe(false);
    expect(validate({
      ...chart,
      poolAttribution: "exact",
      identityProof: { ...chart.identityProof, poolAttribution: "exact" },
    })).toBe(true);
  });

  it("accepts only the provider-neutral v2 error in current API responses", () => {
    const validate = validator("TokenChartResponse");
    const error = {
      schemaVersion: "programmable.market-chart-error.v2",
      source: "programmable",
      status: "unavailable",
      generatedAt: "2026-09-01T08:00:00.000Z",
      address: TOKEN,
      range: "1d",
      reason: "identity-unavailable",
      error: "Price history is temporarily unavailable",
    };
    expect(validate(error), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({
      ...error,
      schemaVersion: "programmable.market-chart-error.v1",
      source: "bitquery",
    })).toBe(false);
  });

  it("documents GMGN and Bitquery chart providers with their distinct semantics", () => {
    const schemas = programmablePublicOpenApi.components.schemas;
    expect(schemas.TokenChartResponse.oneOf).toEqual([
      { $ref: "#/components/schemas/GmgnMarketChart" },
      { $ref: "#/components/schemas/BitqueryMarketChart" },
      { $ref: "#/components/schemas/MarketChartError" },
    ]);
    expect(schemas.GmgnMarketChartPoint.properties.valueSemantics).toEqual({
      const: "period-close",
    });
    expect(schemas.GmgnMarketChart.properties.seriesScope).toEqual({
      const: "token",
    });
    expect(schemas.GmgnMarketChart.properties.poolAttribution).toEqual({
      type: "string",
      enum: ["exact", "unavailable"],
    });
    expect(schemas.GmgnMarketChart.description).toContain(
      "scoped to the token address",
    );
    expect(schemas.MarketChartError.properties.schemaVersion).toEqual({
      const: "programmable.market-chart-error.v2",
    });
    expect(schemas.MarketChartError.properties.source).toEqual({
      const: "programmable",
    });
    expect(schemas.MarketChartError.description).toContain(
      "before a chart provider can be selected",
    );
    expect(schemas.BitqueryMarketChartPoint.properties.valueSemantics).toEqual({
      const: "period-median",
    });
    const headers = programmablePublicOpenApi.paths[
      "/api/explore/token/chart"
    ].get.responses["200"].headers;
    expect(headers["X-Programmable-Market-Provider"].schema.enum).toEqual([
      "gmgn",
      "bitquery",
    ]);
    expect(headers["X-Programmable-Market-Read-Status"].schema.enum).toEqual([
      "live",
      "cache-fallback",
    ]);
    expect(headers["X-Programmable-Chart-Scope"].schema.enum).toEqual([
      "token",
      "pool",
    ]);
    expect(
      headers["X-Programmable-Chart-Pool-Attribution"].schema.enum,
    ).toEqual(["unavailable", "exact"]);
  });
});
