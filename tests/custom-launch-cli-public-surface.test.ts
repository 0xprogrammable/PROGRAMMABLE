import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1 } from
  "../lib/custom-launch/registry-public-manifest-v1";
import { programmableWellKnownDocumentV1 } from
  "../lib/server/custom-launch/well-known-v1";

const root = process.cwd();

describe("public Custom Launch CLI surface", () => {
  it("advertises live V1 reads and the fail-closed public write cutover", () => {
    const document = programmableWellKnownDocumentV1(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );
    expect(document.routerCustomIdentitySnapshotUrl).toBe(
      "https://programmable.market/api/indexers/v1/router-custom-identities",
    );
    expect(document.customLaunchApi).toMatchObject({
      status: "read-only",
      readStatus: "live",
      readyzUrl: "https://api.programmable.market/readyz",
      openApiUrl: "https://programmable.market/openapi/custom-launch-v1.json",
      legacyIntake: { registry: "closed", github: "closed" },
      cli: {
        packageName: "@programmable/launch",
        binary: "programmable-launch",
        releaseVersion: "1.0.1",
        tarballUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz",
      },
      releaseCandidate: {
        status: "private-canary-held",
        publicAuthorization: false,
        releaseVersion: "2.0.0-rc.2",
        releaseTag: "programmable-launch-v2.0.0-rc.2",
        tarballUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v2.0.0-rc.2/programmable-launch-2.0.0-rc.2.tgz",
        openApiUrl:
          "https://programmable.market/openapi/custom-launch-v2.json",
        feePolicy: {
          profileId:
            "programmable.fee-enforced-isolated-after-swap.zero-delta.v1",
          profileRevision: 2,
          launchProfileHash:
            "sha256:1eca209637922b9a8627d073a6d92fede0ae355fb5bd2dfebe3e5382f12f55f8",
          productionLaunchAuthorized: false,
          chainId: "1",
          network: "Ethereum Mainnet",
          chargeTrigger: "successful-swap",
          basis: "gross-unspecified-pool-currency-amount",
          assetMode: "unspecified-pool-currency-per-swap",
          ratePpm: 1_000,
          denominatorPpm: 1_000_000,
          ratePercent: "0.10%",
          rateBps: 10,
          recipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
          enforcement: {
            frozenProfile: true,
            customModuleMayReduce: false,
            customModuleMayRedirect: false,
          },
          lpFee: "separate-from-platform-fee",
          genericFeeClaiming: "not-live",
          genericBuybackManagement: "not-live",
        },
      },
      versions: {
        v1: {
          reads: "live",
          create: "read-only",
          createHttpStatus: 409,
          createErrorCode: "CUSTOM_LAUNCH_V1_READ_ONLY",
          retryable: false,
        },
        v2: {
          status: "release-candidate-held",
          createHttpStatus: 503,
          createErrorCode: "CUSTOM_LAUNCH_V2_UNAVAILABLE",
          retryAfter: "honor",
        },
      },
    });
    expect(document.publicCategories.custom).toMatchObject({
      discoveryStatus: "live",
      publicSubmissionStatus: "release-candidate-held",
      registryDiscoveryStatus: "prelaunch",
      legacyRegistrySubmissionStatus: "closed",
      legacyGithubSubmissionStatus: "closed",
    });
    expect(JSON.stringify(document)).not.toContain("api-live");
  });

  it("publishes a held, reference-complete V2 release-candidate contract", () => {
    const v1 = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v1.json"),
      "utf8",
    ));
    const v2 = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v2.json"),
      "utf8",
    ));

    expect(v2.openapi).toBe("3.1.0");
    expect(v2.info.version).toBe("2.0.0-rc.2");
    expect(v2["x-programmable-availability"]).toMatchObject({
      status: "release-candidate-held",
      publicAuthorized: false,
      privateCanaryOnly: true,
      publicCreate: {
        status: "held",
        httpStatus: 503,
        errorCode: "CUSTOM_LAUNCH_V2_UNAVAILABLE",
        retryAfterSeconds: 30,
      },
    });
    expect(Object.keys(v2.paths).sort()).toEqual([
      "/v2/custom-launches",
      "/v2/custom-launches/{launchId}",
    ]);
    const operations = Object.values(v2.paths).flatMap((path) =>
      Object.values(path as Record<string, unknown>)
    ) as Array<Record<string, unknown>>;
    const operationIds = operations.map(({ operationId }) => operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);

    const create = v2.paths["/v2/custom-launches"].post;
    expect(create["x-programmable-public-availability"]).toBe("held");
    expect(Object.keys(create.responses)).toEqual([
      "200", "202", "400", "401", "403", "409", "413", "415", "422", "429", "500", "503",
    ]);
    expect(create.parameters[0].schema).toMatchObject({
      minLength: 16,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
    });
    expect(create.requestBody.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/CustomLaunchCreateRequestV2",
    });
    expect(v2.components.responses.V2Unavailable.headers["Retry-After"])
      .toEqual({ $ref: "#/components/headers/RetryAfterSeconds" });
    expect(
      v2.components.responses.V2Unavailable.content["application/json"]
        .example.error.code,
    ).toBe("CUSTOM_LAUNCH_V2_UNAVAILABLE");

    const request = v2.components.schemas.CustomLaunchCreateRequestV2;
    expect(request.additionalProperties).toBe(false);
    expect(request.required).toEqual([
      "schemaVersion",
      "launchWallet",
      "chainId",
      "nonce",
      "sourceDescriptor",
      "sourceBundleManifest",
      "graphBundle",
      "launchProfile",
      "launchProfileSelection",
      "launchProfileHash",
      "launchIntentHash",
      "agentAttestation",
      "verificationBundle",
    ]);
    expect(request.properties.verificationBundle).toEqual({
      $ref: "#/components/schemas/ExactSourceVerificationBundleV2",
    });
    expect(v2.components.schemas.CustomLaunchResourceV2.properties.status.enum)
      .toContain("simulating");
    const sourceVerification =
      v2.components.schemas.CustomLaunchResourceV2.properties.sourceVerification;
    expect(v2.components.schemas.CustomLaunchResourceV2.required)
      .not.toContain("sourceVerification");
    expect(sourceVerification).toEqual({
      description:
        "Optional server-authored post-finality verification state returned by the single-resource GET. It is absent or null when no durable status exists; create and list responses do not populate it.",
      oneOf: [
        { $ref: "#/components/schemas/SourceVerificationStatusV1" },
        { type: "null" },
      ],
    });
    expect(v2.components.schemas.SourceVerificationStatusV1).toEqual({
      $ref:
        "./custom-launch-v1.json#/components/schemas/SourceVerificationStatusV1",
    });
    expect(v1.components.schemas.SourceVerificationStatusV1).toMatchObject({
      additionalProperties: false,
      required: ["schemaVersion", "status", "components", "updatedAt"],
      properties: {
        schemaVersion: {
          const: "programmable.source-verification-status.v1",
        },
        status: {
          enum: ["queued", "retrying", "exact_match", "needs_attention"],
        },
      },
    });
    expect(v1.components.schemas.SourceVerificationComponentV1).toMatchObject({
      additionalProperties: false,
      required: ["targetId", "address", "status", "provider"],
      properties: {
        status: {
          enum: ["queued", "retrying", "exact_match", "needs_attention"],
        },
        provider: {
          enum: ["sourcify", "etherscan", "blockscout", null],
        },
      },
    });
    expect(
      v1.components.schemas.SourceVerificationStatusV1.description,
    ).toContain("clients must not infer or submit this object");
    expect(
      v2.components.schemas.CustomLaunchSummaryV2.allOf[1].properties.output,
    ).toEqual({ type: "null" });
    expect(
      v2.components.schemas.CustomLaunchAuthorizedOutputV2.properties.simulation,
    ).toEqual({ $ref: "#/components/schemas/ExactSimulationEvidenceV2" });
    expect(
      v2.components.schemas.CustomLaunchAuthorizedOutputV2.properties
        .walletTransaction,
    ).toEqual({ $ref: "#/components/schemas/CustomLaunchWalletTransactionV1" });

    const documents = new Map<string, unknown>([
      ["", v2],
      ["./custom-launch-v1.json", v1],
    ]);
    const resolvePointer = (document: unknown, pointer: string): unknown =>
      pointer.slice(2).split("/").reduce<unknown>((current, segment) => {
        expect(current).toBeTypeOf("object");
        expect(current).not.toBeNull();
        const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
        return (current as Record<string, unknown>)[key];
      }, document);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value === null || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (typeof record.$ref === "string") {
        const [documentPath = "", fragment = ""] = record.$ref.split("#");
        const document = documents.get(documentPath);
        expect(document, `unknown OpenAPI document ${documentPath}`).toBeDefined();
        expect(fragment.startsWith("/")).toBe(true);
        expect(resolvePointer(document, `#${fragment}`)).toBeDefined();
      }
      Object.values(record).forEach(visit);
    };
    visit(v2);
  });

  it("ships the executable no-broadcast example in the public package", () => {
    const packageJson = JSON.parse(readFileSync(
      join(root, "packages/launch/package.json"),
      "utf8",
    ));
    expect(packageJson.files).toContain("examples");
    const guide = readFileSync(
      join(root, "packages/launch/examples/no-broadcast/README.md"),
      "utf8",
    );
    expect(guide).toContain("deterministic-hook-permission-grind-v1");
    expect(guide).toContain("afterInitialize");
    expect(guide).toContain("Stop after `validate`");
    expect(guide).toContain("CUSTOM_LAUNCH_V1_READ_ONLY");
    expect(guide).toContain("never submits, polls, signs, broadcasts");
    expect(guide).toContain("`submit: false`");
    expect(guide).toContain('`stopAt: "pre-submit"`');
  });

  it("keeps V1 reads live while documenting the exact non-retryable write fence", () => {
    const openApi = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v1.json"),
      "utf8",
    ));
    const post = openApi.paths["/v1/custom-launches"].post;
    expect(post).toMatchObject({
      deprecated: true,
      summary: "V1 launch creation is read-only",
    });
    expect(Object.keys(post.responses)).toEqual(["401", "403", "409"]);
    expect(post.responses["409"].content["application/json"].example.error)
      .toMatchObject({ code: "CUSTOM_LAUNCH_V1_READ_ONLY" });
    expect(openApi.paths["/v1/custom-launches"].get.responses["200"])
      .toBeDefined();
    expect(openApi.paths["/v1/custom-launches/{launchId}"].get.responses["200"])
      .toBeDefined();
    expect(openApi["x-programmable-availability"]).toEqual({
      v1Reads: "live",
      v1Create: {
        status: "read-only",
        httpStatus: 409,
        errorCode: "CUSTOM_LAUNCH_V1_READ_ONLY",
        retryable: false,
      },
      v2ReleaseCandidate: {
        status: "held",
        httpStatus: 503,
        errorCode: "CUSTOM_LAUNCH_V2_UNAVAILABLE",
        retryAfter: "honor-until-canary-and-public-activation",
      },
      legacyIntake: { registry: "closed", github: "closed" },
    });

    const compilationUnit =
      openApi.components.schemas.ExactSourceCompilationUnitV1;
    expect(compilationUnit.properties.standardJsonInputBase64.maxLength)
      .toBe(6_990_508);
    expect(compilationUnit.properties.standardJsonInputBase64.description)
      .toContain("5,242,880 bytes");

    const constants = readFileSync(
      join(root, "packages/launch/src/constants.mjs"),
      "utf8",
    );
    expect(constants).toContain("MAX_REQUEST_BYTES = 8_388_608");
    expect(constants).toContain("MAX_STANDARD_JSON_INPUT_BYTES = 5_242_880");
    expect(constants).toContain("MAX_TOTAL_STANDARD_JSON_INPUT_BYTES = 5_242_880");
  });
});
