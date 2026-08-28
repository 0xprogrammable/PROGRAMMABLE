import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const openApi = JSON.parse(readFileSync(
  join(root, "public/openapi/custom-launch-v3.json"),
  "utf8",
));

const collection = openApi.paths["/v1/partner/subkeys"];
const rotation = openApi.paths["/v1/partner/subkeys/{subkeyId}/rotate"].post;
const revocation = openApi.paths["/v1/partner/subkeys/{subkeyId}"].delete;

describe("public partner subkey OpenAPI", () => {
  it("publishes only the root-owned public subkey routes", () => {
    expect(collection).toBeDefined();
    expect(Object.keys(collection).sort()).toEqual(["get", "post"]);
    expect(rotation).toBeDefined();
    expect(revocation).toBeDefined();
    expect(Object.keys(openApi.paths).some((path) => path.startsWith("/v1/admin/")))
      .toBe(false);
    expect(openApi["x-programmable-partner-credentials"].rootSubkeyRoutes)
      .toEqual([
        "GET /v1/partner/subkeys",
        "POST /v1/partner/subkeys",
        "POST /v1/partner/subkeys/{subkeyId}/rotate",
        "DELETE /v1/partner/subkeys/{subkeyId}",
      ]);
  });

  it("requires a root bearer with the non-delegable management scope", () => {
    for (const operation of [collection.get, collection.post, rotation, revocation]) {
      expect(operation.security).toEqual([{ PartnerRootApiKey: [] }]);
      expect(operation["x-programmable-required-scope"])
        .toBe("partner-subkeys:manage");
      expect(operation["x-programmable-budget-class"])
        .toBe("partner-subkey-admin");
    }
    expect(openApi.components.securitySchemes.PartnerRootApiKey).toMatchObject({
      type: "http",
      scheme: "bearer",
      bearerFormat: "pm_partner_root_<22-char-key-id>_<43-char-secret>",
    });
    expect(openApi.components.schemas.PartnerSubkeyScopeV1.enum).toEqual([
      "custom-launch:create",
      "custom-launch:read",
    ]);
    expect(openApi.components.schemas.PartnerSubkeyScopeV1.enum)
      .not.toContain("partner-subkeys:manage");
  });

  it("keeps permit recovery wallet-only and publishes partner principal boundaries", () => {
    const partnerContract = openApi["x-programmable-partner-credentials"];
    const permit = openApi.paths[
      "/v3/custom-launches/{launchId}/permit-reissues"
    ].post;

    expect(permit.security).toEqual([{ WalletCustomLaunchApiKey: [] }]);
    expect(openApi.components.securitySchemes.WalletCustomLaunchApiKey)
      .toMatchObject({
        type: "http",
        scheme: "bearer",
        bearerFormat: "pm_live_*",
      });
    expect(partnerContract.permitReissueDispositionCredentialKind)
      .toBe("wallet-only");
    expect(partnerContract.metadataPolicySameAsWalletKeys).toBe(true);
    expect(partnerContract.controllerWallet).toEqual({
      walletKey: "must-equal-key-wallet-binding",
      partnerCredential: "selected-by-exact-request",
      mustReviewSignAndBroadcast: true,
    });
    expect(partnerContract.launchHistoryVisibility).toEqual({
      root: "root-credential-principal-only",
      subkey: "subkey-credential-principal-only",
      rootAggregatesSubkeys: false,
      rotationMigratesHistory: false,
      revokedCredentialCanRead: false,
    });
    expect(rotation.description).toMatch(/new isolated launch principal/i);
    expect(rotation.description).toMatch(/history is not migrated/i);
  });

  it("binds POST to an exact idempotency key and closed child limits", () => {
    for (const operation of [collection.post, rotation]) {
      const idempotency = operation.parameters.find(
        ({ name, in: location }: { name: string; in: string }) =>
          name === "Idempotency-Key" && location === "header",
      );
      expect(idempotency).toMatchObject({
        required: true,
        schema: {
          minLength: 16,
          maxLength: 128,
          pattern: "^[A-Za-z0-9._:-]+$",
        },
      });
      expect(operation.requestBody.content["application/json"].schema.$ref)
        .toBe("#/components/schemas/PartnerSubkeyRequestV1");
    }

    const request = openApi.components.schemas.PartnerSubkeyRequestV1;
    expect(request.required).toEqual([
      "schemaVersion",
      "displayName",
      "scopes",
      "budgets",
      "expiresAt",
    ]);
    expect(request.additionalProperties).toBe(false);
    expect(request.properties.schemaVersion.const)
      .toBe("programmable.partner-subkey-request.v1");
    expect(request.properties.displayName).toMatchObject({
      minLength: 1,
      maxLength: 96,
    });
    expect(request.properties.scopes).toMatchObject({
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
    });
    expect(openApi.components.schemas.PartnerSubkeyBudgetLimitsV1.properties)
      .toMatchObject({
        prepareRequestsPerHour: { minimum: 1, maximum: 10_000 },
        readRequestsPerMinute: { minimum: 1, maximum: 10_000 },
      });
  });

  it("separates first secret delivery from an idempotent replay", () => {
    for (const operation of [collection.post, rotation]) {
      expect(operation.responses["201"].content["application/json"].schema.$ref)
        .toBe("#/components/schemas/PartnerSubkeyCreatedResultV1");
      expect(operation.responses["200"].content["application/json"].schema.$ref)
        .toBe("#/components/schemas/PartnerSubkeyReplayResultV1");
    }

    const created = openApi.components.schemas.PartnerSubkeyCreatedResultV1;
    expect(created.properties).toMatchObject({
      schemaVersion: { const: "programmable.partner-subkey-result.v1" },
      disposition: { const: "created" },
      apiKey: {
        type: "string",
        pattern: "^pm_partner_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$",
      },
      secretState: { const: "delivered-once" },
    });
    const replay = openApi.components.schemas.PartnerSubkeyReplayResultV1;
    expect(replay.properties).toMatchObject({
      disposition: { const: "replayed" },
      apiKey: { type: "null" },
      secretState: { const: "already-delivered" },
    });
    expect(openApi.components.schemas.PartnerSubkeyListV1.properties.credentials
      .items.$ref).toBe("#/components/schemas/PartnerSubkeyMetadataV1");
    expect(openApi.components.schemas.PartnerSubkeyMetadataV1.properties)
      .not.toHaveProperty("apiKey");
  });

  it("documents exact revocation and bounded error behavior", () => {
    expect(revocation.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/PartnerSubkeyRevocationV1");
    expect(openApi.components.schemas.PartnerSubkeyRevocationV1.properties)
      .toMatchObject({
        schemaVersion: { const: "programmable.partner-subkey-revocation.v1" },
        disposition: { enum: ["revoked", "already_revoked"] },
      });

    for (const operation of [collection.get, collection.post, rotation, revocation]) {
      expect(operation.responses).toHaveProperty("400");
      expect(operation.responses).toHaveProperty("401");
      expect(operation.responses).toHaveProperty("403");
      expect(operation.responses).toHaveProperty("429");
      expect(operation.responses).toHaveProperty("500");
      expect(operation.responses).not.toHaveProperty("503");
    }
    expect(collection.post.responses).toHaveProperty("409");
    expect(rotation.responses).toHaveProperty("404");
    expect(rotation.responses).toHaveProperty("409");
    expect(revocation.responses).toHaveProperty("404");
    expect(openApi.components.responses.PartnerRateLimited.headers)
      .toMatchObject({
        "Retry-After": { $ref: "#/components/headers/RetryAfter" },
        "X-Request-Id": { $ref: "#/components/headers/RequestId" },
      });
    expect(openApi.components.responses.PartnerInternalError.description)
      .toMatch(/requestId.*never includes a credential, secret/);
  });
});
