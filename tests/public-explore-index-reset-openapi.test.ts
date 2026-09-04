import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { programmablePublicOpenApi } from "../lib/public-openapi";

function validator(name: "OperationsHealth" | "MarketChartError") {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile({
    $schema: programmablePublicOpenApi.jsonSchemaDialect,
    ...programmablePublicOpenApi.components.schemas[name],
    components: { schemas: programmablePublicOpenApi.components.schemas },
  });
}

describe("provider-neutral Explore reset OpenAPI contract", () => {
  it("documents provider-free operations health", () => {
    const operation = programmablePublicOpenApi.paths["/api/ops/health"].get;
    const validate = validator("OperationsHealth");

    expect(operation.summary).toBe("Read the Explore indexing state");
    expect(operation.description).toContain("performs no provider or indexer");
    expect(Object.keys(operation.responses)).toEqual(["200"]);
    expect(operation.responses["200"].headers).toEqual({
      "Cache-Control": {
        description:
          "Reset responses are never stored by clients or shared caches.",
        schema: { const: "no-store" },
      },
      "X-Programmable-Indexing-Status": {
        description:
          "Explore indexing is intentionally reset while it is rebuilt.",
        schema: { const: "reset" },
      },
    });
    expect(
      validate({
        status: "index-reset",
        providers: [],
      }),
      JSON.stringify(validate.errors),
    ).toBe(true);
    expect(
      validate({
        status: "index-reset",
        providers: [{ name: "unexpected" }],
      }),
    ).toBe(false);
    expect(
      validate({
        status: "index-reset",
        providers: [],
        checkedAt: "2026-09-04T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("documents only the provider-neutral chart reset response", () => {
    const operation =
      programmablePublicOpenApi.paths["/api/explore/token/chart"].get;
    const validate = validator("MarketChartError");
    const error = {
      schemaVersion: "programmable.market-chart-error.v2",
      source: "programmable",
      status: "unavailable",
      generatedAt: "2026-09-04T08:00:00.000Z",
      address: "0x1111111111111111111111111111111111111111",
      range: "1d",
      reason: "identity-unavailable",
      error: "Price history is temporarily unavailable",
    };

    expect(Object.keys(operation.responses).sort()).toEqual(["400", "503"]);
    expect(
      operation.responses["503"].content["application/json"].schema,
    ).toEqual({ $ref: "#/components/schemas/MarketChartError" });
    expect(operation.responses["503"].headers).toMatchObject({
      "Cache-Control": { schema: { const: "no-store" } },
      "X-Programmable-Indexing-Status": { schema: { const: "reset" } },
    });
    expect(validate(error), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...error, reason: "market-data-unavailable" })).toBe(
      false,
    );
    expect(
      validate({
        ...error,
        schemaVersion: "programmable.market-chart-error.v1",
      }),
    ).toBe(false);
    expect(validate({ ...error, source: "external" })).toBe(false);
  });

  it("contains no retired Explore provider or fallback components", () => {
    const schemas = programmablePublicOpenApi.components.schemas;
    for (const name of [
      "OperationsPrimaryProvider",
      "OperationsGmgnProvider",
      "OperationsBitqueryProvider",
      "OperationsDexscreenerProvider",
      "DexscreenerExploreMarketRead",
      "GmgnExploreMarketRead",
      "ExploreMarketRead",
      "GmgnMarketSnapshot",
      "TokenAnalyticsResponse",
      "BitqueryMarketChart",
      "GmgnMarketChart",
      "TokenChartResponse",
    ]) {
      expect(schemas).not.toHaveProperty(name);
    }
  });
});
