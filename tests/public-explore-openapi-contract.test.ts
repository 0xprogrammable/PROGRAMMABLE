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
});
