import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { programmablePublicOpenApi } from "../lib/public-openapi";

function responseValidator(name: "ExploreListResponse" | "TokenDetailResponse") {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile({
    $schema: programmablePublicOpenApi.jsonSchemaDialect,
    ...programmablePublicOpenApi.components.schemas[name],
    components: {
      schemas: programmablePublicOpenApi.components.schemas,
    },
  });
}

describe("public Explore OpenAPI contract", () => {
  it("documents exact-bound GMGN observations without treating them as identity authority", () => {
    const entrySchema = programmablePublicOpenApi.components.schemas.ExploreEntry;
    const gmgnSchema = programmablePublicOpenApi.components.schemas.GmgnMarketSnapshot;

    expect(entrySchema.properties.gmgnMarketData).toEqual({
      $ref: "#/components/schemas/GmgnMarketSnapshot",
    });
    expect(gmgnSchema).toMatchObject({
      properties: {
        source: { const: "gmgn" },
        marketScope: { const: "token" },
        poolAttribution: {
          type: "string",
          enum: ["exact", "unavailable"],
        },
        identity: { $ref: "#/components/schemas/GmgnMarketIdentity" },
      },
      additionalProperties: false,
    });
    expect(gmgnSchema.required).toEqual(expect.arrayContaining([
      "marketScope",
      "poolAttribution",
    ]));
    expect(gmgnSchema.description).toContain("GMGN token-level");
    expect(gmgnSchema.description).toContain("20-byte pool locators");
    expect(gmgnSchema.description).toContain("canonical request PoolId");
  });

  it("documents concrete Dexscreener and GMGN market-read variants", () => {
    const schemas = programmablePublicOpenApi.components.schemas;

    expect(schemas.ExploreMarketRead.oneOf).toEqual([
      { $ref: "#/components/schemas/DexscreenerExploreMarketRead" },
      { $ref: "#/components/schemas/GmgnExploreMarketRead" },
    ]);
    expect(schemas.DexscreenerExploreMarketRead).toMatchObject({
      required: [
        "provider",
        "status",
        "currency",
        "requestedCount",
        "observedCount",
        "qualifiedCount",
        "unavailableCount",
        "oldestFetchedAt",
        "newestFetchedAt",
      ],
      properties: {
        provider: { const: "dexscreener" },
      },
      additionalProperties: false,
    });
    expect(schemas.GmgnExploreMarketRead).toMatchObject({
      properties: {
        provider: { const: "gmgn" },
        fallbackProvider: { const: "dexscreener" },
        gmgnObservedCount: { type: "integer", minimum: 0 },
        fallbackRequestedCount: { type: "integer", minimum: 0 },
        fallbackObservedCount: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    });
    expect(schemas.ExploreReadyListResponse.required).toContain("marketRead");
    expect(schemas.ExploreReadyListResponse.properties.marketRead).toEqual({
      $ref: "#/components/schemas/ExploreMarketRead",
    });
  });

  it("documents GMGN-primary market-cap ranking without claiming full coverage", () => {
    const schema = programmablePublicOpenApi.components.schemas
      .ExploreMarketCapRanking;
    expect(schema).toMatchObject({
      required: expect.arrayContaining([
        "primaryProvider",
        "source",
        "rankingCommitment",
        "status",
        "gmgnStatus",
        "matchedTokenCount",
        "metricOrder",
        "gmgnHydrationRequestedCount",
        "gmgnHydrationQualifiedCount",
        "fallbackRequestedCount",
        "canonicalTailCount",
      ]),
      properties: {
        requested: { const: "market-cap" },
        primaryProvider: { const: "gmgn" },
        fallbackProvider: { const: "dexscreener" },
        rankingCommitment: {
          type: "string",
          pattern: "^sha256:[0-9a-f]{64}$",
        },
      },
      additionalProperties: false,
    });
    expect(schema.description).toContain("never compared across tiers");
    const ready = programmablePublicOpenApi.components.schemas
      .ExploreReadyListResponse;
    expect(ready.properties.ranking).toEqual({
      $ref: "#/components/schemas/ExploreMarketCapRanking",
    });
    expect(ready.properties.sortMetric.enum).toContain(
      "gmgn-market-cap+gmgn-token-info-fdv+dexscreener-fdv-fallback",
    );
    const headers = programmablePublicOpenApi.paths["/api/explore"].get
      .responses["200"].headers;
    expect(headers["X-Programmable-Ranking-Primary-Provider"].schema).toEqual({
      const: "gmgn",
    });
    expect(headers["X-Programmable-Ranking-Commitment"].schema).toEqual({
      type: "string",
      pattern: "^sha256:[0-9a-f]{64}$",
    });
    expect(schema.properties.asOfTime.description).toContain(
      "exactly that rank snapshot time",
    );
  });

  it("documents canonical GMGN search intersection and headers", () => {
    const schemas = programmablePublicOpenApi.components.schemas;
    const response = programmablePublicOpenApi.paths["/api/explore"].get
      .responses["200"];
    const query = programmablePublicOpenApi.paths["/api/explore"].get
      .parameters.find((parameter) => parameter.name === "q");

    expect(query).toMatchObject({
      schema: { type: "string", minLength: 1, maxLength: 100 },
    });
    expect(query?.description).toContain("foreign coins and wallet rows");
    expect(schemas.ExploreReadyListResponse.properties.search).toEqual({
      $ref: "#/components/schemas/ExploreSearchRanking",
    });
    expect(schemas.ExploreSearchRanking).toMatchObject({
      required: expect.arrayContaining([
        "rankingCommitment",
        "matchedUniqueTokenCount",
        "providerOnlyCanonicalTokenCount",
        "duplicateProviderItemCount",
      ]),
      properties: {
        provider: { const: "gmgn" },
        requested: { const: "search" },
        orderBy: { const: "weight" },
      },
      additionalProperties: false,
    });
    expect(schemas.ExploreSearchRanking.description).toContain(
      "canonical Ethereum Programmable catalog",
    );
    expect(response.headers["X-Programmable-Search-Provider"].schema)
      .toEqual({ const: "gmgn" });
    expect(response.headers["X-Programmable-Search-Read-Status"].schema.enum)
      .toEqual(["complete", "partial", "unavailable"]);
    expect(response.headers["X-Programmable-Search-Ranking-Commitment"].schema)
      .toEqual({
        type: "string",
        pattern: "^sha256:[0-9a-f]{64}$",
      });
  });

  it("validates both provider reads and rejects cross-provider fields", () => {
    const validate = responseValidator("ExploreListResponse");
    const ready = {
      status: "ready",
      chainId: 1,
      tokens: [],
      page: 1,
      pageSize: 9,
      total: 0,
      totalPages: 0,
      sort: "newest",
      query: "",
      catalog: {
        source: "envio-classic-v3",
        launchSource: "envio-classic-v3",
        status: "current",
        lastIndexedAt: "2026-08-31T12:00:00.000Z",
        identityCount: 1,
      },
    };
    const dexscreener = {
      provider: "dexscreener",
      status: "unavailable",
      currency: "USD",
      requestedCount: 0,
      observedCount: 0,
      qualifiedCount: 0,
      unavailableCount: 0,
      oldestFetchedAt: null,
      newestFetchedAt: null,
    };
    const gmgn = {
      provider: "gmgn",
      fallbackProvider: "dexscreener",
      status: "partial",
      currency: "USD",
      requestedCount: 1,
      observedCount: 1,
      qualifiedCount: 1,
      unavailableCount: 0,
      gmgnObservedCount: 1,
      gmgnQualifiedCount: 1,
      fallbackRequestedCount: 0,
      fallbackObservedCount: 0,
      fallbackQualifiedCount: 0,
      oldestFetchedAt: "2026-08-31T12:00:00.000Z",
      newestFetchedAt: "2026-08-31T12:00:00.000Z",
    };

    expect(
      validate({ ...ready, marketRead: dexscreener }),
      JSON.stringify(validate.errors),
    ).toBe(true);
    expect(
      validate({ ...ready, marketRead: gmgn }),
      JSON.stringify(validate.errors),
    ).toBe(true);
    expect(validate({
      ...ready,
      marketRead: { ...dexscreener, fallbackProvider: "dexscreener" },
    })).toBe(false);
    const incompleteGmgn = Object.fromEntries(
      Object.entries(gmgn).filter(([name]) => name !== "gmgnObservedCount"),
    );
    expect(validate({ ...ready, marketRead: incompleteGmgn })).toBe(false);
  });

  it("documents the market response headers emitted by ready Explore reads", () => {
    const response = programmablePublicOpenApi.paths["/api/explore"].get
      .responses["200"];

    expect(response.headers["X-Programmable-Market-Provider"].schema.enum)
      .toEqual(["dexscreener", "gmgn", "gmgn+dexscreener"]);
    expect(response.headers["X-Programmable-Market-Read-Status"].schema.enum)
      .toEqual(["complete", "partial", "unavailable"]);
    expect(response.headers["X-Programmable-Market-Source"].description)
      .toContain("Omitted when no provider observation was accepted");
    expect(response.headers["X-Programmable-Price-Source"].description)
      .toContain("Omitted when no valuation qualified");
    expect(response.headers["X-Programmable-Market-As-Of"].schema)
      .toEqual({ type: "string", format: "date-time" });
    expect(response.headers["X-Programmable-Chain-Id"]).toBeDefined();
    expect(response.headers["X-Programmable-Launch-Source"]).toBeDefined();
    expect(response.headers["X-Programmable-Read-Source"]).toBeDefined();
    expect(response.headers["X-Programmable-Canonical-Read-Status"])
      .toBeDefined();
    expect(response.headers["X-Programmable-Router-Read-Status"])
      .toBeDefined();
    expect(response.headers["X-Programmable-Identity-Last-Indexed-At"])
      .toBeDefined();
  });

  it("documents every accepted list query including chain and model", () => {
    const operation = programmablePublicOpenApi.paths["/api/explore"].get;
    const parameters = new Map(
      operation.parameters.map((parameter) => [parameter.name, parameter]),
    );

    expect([...parameters.keys()]).toEqual([
      "chain",
      "page",
      "limit",
      "q",
      "model",
      "socials",
      "sort",
    ]);
    expect(parameters.get("chain")?.schema).toEqual({
      type: "integer",
      enum: [1, 4663],
      default: 1,
    });
    expect(parameters.get("model")?.schema).toEqual({
      type: "string",
      enum: ["classic", "custom"],
    });
    expect(parameters.get("sort")?.schema).toEqual({
      type: "string",
      enum: [
        "newest",
        "oldest",
        "trending",
        "market-cap",
        "market-cap-asc",
        "highest-market-cap",
        "lowest-market-cap",
      ],
      default: "newest",
    });
    expect(parameters.get("sort")?.description).toContain("chain=1");
  });

  it("documents canonical-intersected Trending metadata and headers", () => {
    const schemas = programmablePublicOpenApi.components.schemas;
    const response = programmablePublicOpenApi.paths["/api/explore"].get
      .responses["200"];

    expect(schemas.ExploreReadyListResponse.properties.sort.enum).toContain(
      "trending",
    );
    expect(schemas.ExploreReadyListResponse.properties.discovery).toEqual({
      $ref: "#/components/schemas/ExploreDiscoveryRanking",
    });
    expect(schemas.ExploreDiscoveryRanking).toMatchObject({
      properties: {
        provider: { const: "gmgn" },
        requested: { const: "trending" },
        snapshotCount: { type: "integer", minimum: 0, maximum: 2 },
        observedTokenCount: { type: "integer", minimum: 0, maximum: 200 },
      },
      additionalProperties: false,
    });
    expect(schemas.ExploreDiscoveryRanking.description).toContain(
      "filtered canonical Programmable catalog",
    );
    expect(response.headers["X-Programmable-Discovery-Provider"].schema)
      .toEqual({ const: "gmgn" });
    expect(response.headers["X-Programmable-Discovery-Read-Status"].schema.enum)
      .toEqual(["complete", "partial", "unavailable"]);
    expect(response.headers["X-Programmable-Discovery-Matched-Count"])
      .toBeDefined();
  });

  it("validates the real catalog-free planned list response", () => {
    const validate = responseValidator("ExploreListResponse");
    const planned = {
      status: "not-deployed",
      activationStage: "planned-not-deployed",
      chainId: 4663,
      tokens: [],
      page: 1,
      pageSize: 9,
      total: 0,
      totalPages: 0,
      sort: "newest",
      query: "",
    };

    expect(validate(planned), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...planned, catalog: {} })).toBe(false);
  });

  it("documents chain-scoped token reads and their planned response", () => {
    const operation = programmablePublicOpenApi.paths["/api/explore/token"].get;
    const parameters = new Map(
      operation.parameters.map((parameter) => [parameter.name, parameter]),
    );
    expect([...parameters.keys()]).toEqual(["chain", "address"]);
    expect(parameters.get("chain")?.schema).toEqual({
      type: "integer",
      enum: [1, 4663],
      default: 1,
    });

    const validate = responseValidator("TokenDetailResponse");
    const planned = {
      status: "not-deployed",
      activationStage: "planned-not-deployed",
      chainId: 4663,
      token: null,
      customProject: null,
      routerTradeProject: null,
      platformFeeCertification: null,
      sourceVerification: null,
      creatorArticle: null,
      snapshot: null,
    };
    expect(validate(planned), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...planned, catalog: {} })).toBe(false);
  });

  it("documents token market headers only where a market read can occur", () => {
    const responses = programmablePublicOpenApi.paths["/api/explore/token"].get
      .responses;
    const readyHeaders = responses["200"].headers;
    const notFoundHeaders = responses["404"].headers;

    expect(readyHeaders["X-Programmable-Market-Provider"].schema.enum)
      .toEqual(["dexscreener", "gmgn", "gmgn+dexscreener"]);
    expect(readyHeaders["X-Programmable-Market-Read-Status"].schema.enum)
      .toEqual(["complete", "partial", "unavailable"]);
    expect(readyHeaders["X-Programmable-Market-Source"]).toBeDefined();
    expect(readyHeaders["X-Programmable-Price-Source"]).toBeDefined();
    expect(readyHeaders["X-Programmable-Market-As-Of"]).toBeDefined();

    expect(notFoundHeaders["X-Programmable-Read-Source"].description)
      .toContain("identity sources only");
    expect(notFoundHeaders).not.toHaveProperty(
      "X-Programmable-Market-Provider",
    );
    expect(notFoundHeaders).not.toHaveProperty(
      "X-Programmable-Market-Read-Status",
    );
  });
});
