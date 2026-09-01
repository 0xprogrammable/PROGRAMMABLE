import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { programmablePublicOpenApi } from "../lib/public-openapi";

function validator(name: "TokenAnalyticsResponse" | "TokenChartResponse") {
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

describe("public GMGN analytics and chart OpenAPI contract", () => {
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
    expect(operation.description).toContain("exact GMGN token_info proof");
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

  it("accepts only the privacy-reduced seven-field wallet ranking", () => {
    const validate = validator("TokenAnalyticsResponse");
    const response = {
      schemaVersion: "programmable.token-analytics.v1",
      status: "ready",
      provider: "gmgn",
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

  it("accepts GMGN period-close charts without inventing a block number", () => {
    const validate = validator("TokenChartResponse");
    const chart = {
      schemaVersion: "programmable.gmgn-market-chart.v1",
      source: "gmgn",
      readStatus: "live",
      status: "insufficient-history",
      generatedAt: "2026-09-01T08:00:00.000Z",
      identity,
      identityProof: {
        schemaVersion: "programmable.gmgn-chart-identity-proof.v1",
        source: "gmgn-token-info",
        verifiedAt: "2026-09-01T07:59:59.000Z",
        identity,
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
  });
});
