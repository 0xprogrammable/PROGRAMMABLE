import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { programmablePublicOpenApi } from "../lib/public-openapi";

function validator(name: "ExploreIndexResetError") {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile({
    $schema: programmablePublicOpenApi.jsonSchemaDialect,
    ...programmablePublicOpenApi.components.schemas[name],
    components: { schemas: programmablePublicOpenApi.components.schemas },
  });
}

const explorePaths = [
  "/api/explore",
  "/api/explore/token",
  "/api/explore/token/analytics",
] as const;

describe("public Explore indexing-reset OpenAPI contract", () => {
  it("documents one deterministic reset error for every JSON Explore read", () => {
    const validate = validator("ExploreIndexResetError");

    expect(
      validate({
        error: "Token data is temporarily unavailable",
      }),
      JSON.stringify(validate.errors),
    ).toBe(true);
    expect(
      validate({
        error: "Token data is temporarily unavailable",
        status: "index_rebuilding",
      }),
      JSON.stringify(validate.errors),
    ).toBe(true);
    expect(
      validate({
        error: "Token data is temporarily unavailable",
        status: "ready",
      }),
    ).toBe(false);
    expect(
      validate({
        error: "Token data is temporarily unavailable",
        provider: "unexpected",
      }),
    ).toBe(false);

    for (const path of explorePaths) {
      const operation = programmablePublicOpenApi.paths[path].get;
      expect(Object.keys(operation.responses).sort()).toEqual(["400", "503"]);
      expect(operation.responses["503"]).toMatchObject({
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ExploreIndexResetError",
            },
          },
        },
        headers: {
          "Cache-Control": { schema: { const: "no-store" } },
          "Retry-After": { schema: { const: "3600" } },
          "X-Programmable-Indexing-Status": {
            schema: { const: "reset" },
          },
        },
      });
      expect(Object.keys(operation.responses["503"].headers).sort()).toEqual([
        "Cache-Control",
        "Retry-After",
        "X-Programmable-Indexing-Status",
      ]);
    }
  });

  it("retains the accepted query shapes without advertising a live result", () => {
    const list = programmablePublicOpenApi.paths["/api/explore"].get;
    const listParameters = new Map(
      list.parameters.map((parameter) => [parameter.name, parameter]),
    );
    expect([...listParameters.keys()]).toEqual([
      "chain",
      "page",
      "limit",
      "q",
      "model",
      "socials",
      "sort",
      "rankingCommitment",
    ]);
    expect(listParameters.get("chain")?.schema).toEqual({
      type: "integer",
      enum: [1, 4663],
      default: 1,
    });
    expect(listParameters.get("model")?.schema).toEqual({
      type: "string",
      enum: ["classic", "custom"],
    });

    const detail = programmablePublicOpenApi.paths["/api/explore/token"].get;
    expect(detail.parameters.map((parameter) => parameter.name)).toEqual([
      "chain",
      "address",
    ]);
    expect(
      detail.parameters.find((parameter) => parameter.name === "address"),
    ).toMatchObject({ required: true, in: "query" });

    const analytics =
      programmablePublicOpenApi.paths["/api/explore/token/analytics"].get;
    expect(analytics.parameters.map((parameter) => parameter.name)).toEqual([
      "chain",
      "address",
      "section",
      "limit",
    ]);
    expect(
      analytics.parameters.find((parameter) => parameter.name === "limit")
        ?.schema,
    ).toEqual({ type: "integer", const: 20, default: 20 });
  });

  it("publishes an explicit provider-free reset boundary", () => {
    expect(
      programmablePublicOpenApi["x-programmable-availability"].exploreIndexing,
    ).toEqual({
      status: "reset",
      publicReadStatus: 503,
      providerCalls: false,
      fallbacks: false,
      backgroundWorkers: false,
    });
    expect(
      programmablePublicOpenApi["x-programmable-boundary"].identity,
    ).toContain("no token identity is served");
    expect(
      programmablePublicOpenApi["x-programmable-boundary"].marketData,
    ).toContain("No token market, ranking, search, analytics or chart data");

    const serialized = JSON.stringify(programmablePublicOpenApi);
    expect(serialized).not.toMatch(/gmgn|dexscreener|bitquery/iu);
    expect(serialized).not.toContain("X-Programmable-Market-Provider");
    expect(serialized).not.toContain("X-Programmable-Read-Source");
    expect(programmablePublicOpenApi.components.schemas).not.toHaveProperty(
      "ExploreListResponse",
    );
    expect(programmablePublicOpenApi.components.schemas).not.toHaveProperty(
      "TokenDetailResponse",
    );
    expect(programmablePublicOpenApi.components.schemas).not.toHaveProperty(
      "TokenAnalyticsResponse",
    );
  });

  it("keeps Custom Launch and API-key contracts intact", () => {
    expect(programmablePublicOpenApi.paths).toHaveProperty(
      "/v1/custom-launches",
    );
    expect(programmablePublicOpenApi.paths).toHaveProperty(
      "/v1/custom-launches/{launchId}",
    );
    expect(programmablePublicOpenApi.paths).toHaveProperty(
      "/api/custom-launch/registry/v2/readiness",
    );
    expect(programmablePublicOpenApi.components.securitySchemes).toHaveProperty(
      "CustomLaunchApiKey",
    );
  });
});
