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
  it("advertises public V2 creation and retained V1 reads", () => {
    const document = programmableWellKnownDocumentV1(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );
    expect(document.routerCustomIdentitySnapshotUrl).toBe(
      "https://programmable.market/api/indexers/v1/router-custom-identities",
    );
    expect(document.customLaunchApi).toMatchObject({
      status: "live",
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
      publicRelease: {
        status: "live",
        apiVersion: "2",
        guideUrl: "https://programmable.market/docs/developers/custom-launch",
        openApiUrl: "https://programmable.market/openapi/custom-launch-v2.json",
        authentication: "wallet-bound-api-key",
        walletBoundary: "separate-wallet-signature",
        cli: {
          packageName: "@programmable/launch",
          binary: "programmable-launch",
          releaseVersion: "2.0.1",
          tarballUrl:
            "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v2.0.1/programmable-launch-2.0.1.tgz",
        },
      },
      integrationPreview: {
        status: "integration-pending",
        apiVersion: "3",
        publicAuthorization: false,
        createPath: "/v3/custom-launches",
        openApiUrl: "https://programmable.market/openapi/custom-launch-v3.json",
        profileId: "programmable.direct-native-hook-graph.v1",
        profileRevision: 2,
        requestSchemaVersion: "programmable.custom-launch-create-request.v3",
        minimumTargets: 3,
        maximumTargets: 16,
        projectOwnedToken: true,
        projectOwnedHook: true,
        hookPermissionMaskRange: { minimum: 0, maximum: 16_383 },
        exactGraphReceiptRequired: true,
        fundingAuthorization: {
          method: "eip-3009-receive-with-authorization",
          createRequestSignatureIncluded: false,
          fundingIntentStage: "pre-signature",
        },
        activationBlockers: [
          "platform-fee-conformance-authority",
          "production-deployment-readback",
          "end-to-end-general-hook-wallet-handoff",
        ],
        errorCode: "CUSTOM_LAUNCH_V3_INTEGRATION_PENDING",
      },
      releaseCandidate: {
        status: "promoted-to-public",
        publicAuthorization: true,
        releaseVersion: "2.0.1",
        releaseTag: "programmable-launch-v2.0.1",
        tarballUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v2.0.1/programmable-launch-2.0.1.tgz",
        openApiUrl:
          "https://programmable.market/openapi/custom-launch-v2.json",
        feePolicy: {
          profileId:
            "programmable.fee-enforced-isolated-after-swap.zero-delta.v1",
          profileRevision: 3,
          launchProfileHash:
            "sha256:fd2d738117c4c69304efb49c75d402d2e8b8968832fd2e27548c3d9814c5c9ee",
          productionLaunchAuthorized: true,
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
          status: "live",
          createHttpStatus: 202,
          replayHttpStatus: 200,
          retryAfter: "honor-on-429-or-503",
        },
        v3: {
          status: "integration-pending",
          publicAuthorization: false,
          createHttpStatus: 503,
          createErrorCode: "CUSTOM_LAUNCH_V3_INTEGRATION_PENDING",
          retryable: false,
        },
      },
    });
    expect(document.publicCategories.custom).toMatchObject({
      discoveryStatus: "live",
      publicSubmissionStatus: "closed",
      customLaunchApiStatus: "live",
      registryDiscoveryStatus: "legacy-closed",
      legacyRegistrySubmissionStatus: "closed",
      legacyGithubSubmissionStatus: "closed",
    });
    expect(JSON.stringify(document)).not.toContain("api-live");
    expect(JSON.stringify(document)).not.toContain("prelaunch");
  });

  it("publishes a public, reference-complete V2 contract", () => {
    const v1 = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v1.json"),
      "utf8",
    ));
    const v2 = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v2.json"),
      "utf8",
    ));

    expect(v2.openapi).toBe("3.1.0");
    expect(v2.info.version).toBe("2.0.0");
    expect(v2["x-programmable-availability"]).toMatchObject({
      status: "live",
      publicAuthorized: true,
      privateCanaryOnly: false,
      publicCreate: {
        status: "live",
      },
    });
    expect(v2["x-programmable-release-candidate"]).toMatchObject({
      status: "promoted-to-public",
      version: "2.0.1",
      launchProfileHash:
        "sha256:fd2d738117c4c69304efb49c75d402d2e8b8968832fd2e27548c3d9814c5c9ee",
      productionLaunchAuthorized: true,
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
    expect(create["x-programmable-public-availability"]).toBe("live");
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
    ).toBe("LAUNCH_UNAVAILABLE");

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
    expect(v2.components.schemas.FeeEnforcedLaunchProfileV2.properties)
      .toMatchObject({
        profileId: {
          const:
            "programmable.fee-enforced-isolated-after-swap.zero-delta.v1",
        },
        profileRevision: { const: 3 },
        profileVersion: { const: "2.0.0" },
        productionLaunchAuthorized: { const: true },
        chainId: { const: "1" },
      });
    expect(v2.components.schemas.FeeEnforcedLaunchProfileBindingV2.properties)
      .toMatchObject({
        profileId: {
          const:
            "programmable.fee-enforced-isolated-after-swap.zero-delta.v1",
        },
        profileRevision: { const: 3 },
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

  it("publishes a parallel fail-closed V3 profile contract without changing V2", () => {
    const v2 = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v2.json"),
      "utf8",
    ));
    const v3 = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v3.json"),
      "utf8",
    ));

    expect(v3.openapi).toBe("3.1.0");
    expect(v3["x-programmable-availability"]).toMatchObject({
      status: "integration-pending",
      publicAuthorized: false,
      publicCreate: {
        status: "integration-pending",
        path: "/v3/custom-launches",
        httpStatus: 503,
        errorCode: "CUSTOM_LAUNCH_V3_INTEGRATION_PENDING",
      },
      stableProductionVersion: "2",
      stableOpenApiUrl:
        "https://programmable.market/openapi/custom-launch-v2.json",
      activationBlockers: [
        "platform-fee-conformance-authority",
        "production-deployment-readback",
        "end-to-end-general-hook-wallet-handoff",
      ],
    });
    expect(Object.keys(v3.paths).sort()).toEqual([
      "/v3/custom-launches",
      "/v3/custom-launches/{launchId}",
      "/v3/wallet-admin/custom-launches/{launchId}/funding-authorization",
    ]);
    expect(v3.paths["/v3/custom-launches"].post
      ["x-programmable-public-availability"]).toBe("integration-pending");
    expect(v3.paths["/v3/custom-launches"].post.responses["503"]
      .headers["Retry-After"].schema.const).toBe("30");
    expect(v3.paths["/v3/custom-launches"].post.responses["202"])
      .toBeDefined();
    expect(v3.paths["/v3/custom-launches"].get.responses["200"])
      .toBeDefined();
    expect(v3.paths["/v3/custom-launches/{launchId}"].get.responses["200"])
      .toBeDefined();
    const fundingSubmission = v3.paths[
      "/v3/wallet-admin/custom-launches/{launchId}/funding-authorization"
    ].post;
    expect(fundingSubmission.security).toEqual([
      { CustomLaunchWebsiteToken: [] },
    ]);
    expect(fundingSubmission.parameters.map((parameter: { name: string }) =>
      parameter.name)).toEqual([
      "launchId",
      "Idempotency-Key",
      "X-Programmable-Privy-User-Id",
      "X-Programmable-Wallet-Address",
    ]);
    expect(fundingSubmission.requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/FundingAuthorizationSubmissionV1");
    expect(Object.keys(fundingSubmission.responses).sort()).toEqual([
      "200", "202", "400", "401", "403", "404", "409", "503",
    ]);
    expect(v3["x-programmable-funding-boundary"]
      .excludedFromFundingIntentHash).toEqual([
      "signature",
      "initializerCalldataHash",
      "graphCommitment",
      "permitDigest",
    ]);

    const request = v3.components.schemas.CustomLaunchCreateRequestV3;
    expect(request.additionalProperties).toBe(false);
    expect(request.required).toEqual([
      "schemaVersion",
      "launchWallet",
      "chainId",
      "nonce",
      "permitWindow",
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
    expect(request.properties.schemaVersion.const)
      .toBe("programmable.custom-launch-create-request.v3");
    expect(request.allOf[0].then.required)
      .toEqual(["fundingAuthorization", "fundingIntentHash"]);
    expect(request.properties.permitWindow.$ref)
      .toBe("#/components/schemas/DirectNativePermitWindowV1");
    expect(Object.keys(request.properties)).not.toContain("signature");

    const graph = v3.components.schemas.CustomGraphBundleV3;
    expect(graph.allOf[1].properties.targets).toMatchObject({
      minItems: 3,
      maxItems: 16,
    });
    expect(v3["x-programmable-profile"]).toMatchObject({
      profileId: "programmable.direct-native-hook-graph.v1",
      profileRevision: 2,
      productionLaunchAuthorized: false,
      minimumHookPermissionMask: 0,
      maximumHookPermissionMask: 16383,
      projectOwnedToken: true,
      projectOwnedHook: true,
      exactGraphReceiptRequired: true,
    });
    expect(v3.components.schemas.DirectNativeHookPermissionPolicyV1.properties)
      .toMatchObject({
        minimumMask: { const: 0 },
        maximumMask: { const: 16383 },
        requireHookMinerAddressMaskMatch: { const: true },
      });

    const profile = v3.components.schemas.DirectNativeHookGraphProfileV1;
    expect(profile.required).toEqual(expect.arrayContaining([
      "permitAuthority",
      "permitAuthorityRuntimeCodeHash",
      "platformFeePolicy",
      "platformFeeProofPolicy",
    ]));
    expect(profile.properties.permitAuthority.const)
      .toBe("0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b");
    expect(profile.properties).toMatchObject({
      profileVersion: { const: "2.0.0" },
      productionLaunchAuthorized: { const: false },
      routerRuntimeCodeHash: {
        const:
          "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
      },
      permitAuthorityRuntimeCodeHash: {
        const:
          "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
      },
      graphFactoryRuntimeCodeHash: {
        const:
          "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
      },
      poolManagerRuntimeCodeHash: {
        const:
          "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
      },
      fundingTokenRuntimeCodeHash: {
        const:
          "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505",
      },
    });
    expect(profile.properties.platformFeePolicy.$ref)
      .toBe("#/components/schemas/PlatformFeePolicyV1");
    expect(v3.components.schemas.PlatformFeePolicyV1.properties)
      .toMatchObject({
        accountingMode: {
          enum: ["additive-platform-share", "inclusive-selected-total"],
        },
        rateDenominator: { const: "1000000" },
        programmableFeeHundredthsOfBip: { const: "1000" },
      });
    expect(v3.components.schemas.SelectedFeeHundredthsOfBipV1.pattern)
      .toBe("^(?:0|[1-9][0-9]{0,5})$");
    expect(v3.components.schemas.DirectNativeTargetRolesV1.properties
      .initializerTargetId.description).toContain("componentKind is other");

    const binding = v3.components.schemas.DirectNativeProfileSelectionBindingV1;
    expect(binding.required).toEqual(expect.arrayContaining([
      "expectedPoolId",
      "platformFeeBinding",
    ]));
    const patch = v3.components.schemas.FundingSignaturePatchDescriptorV1;
    expect(patch.required).toEqual([
      "schemaVersion",
      "targetId",
      "unsignedInitializerCalldataSha256",
      "initializerCalldataLengthBytes",
      "signatureEncoding",
      "rOffsetBytes",
      "sOffsetBytes",
      "vOffsetBytes",
    ]);
    expect(patch.properties.signatureEncoding.const)
      .toBe("eip3009-r-s-v-abi-words");
    expect(v3.components.schemas.DirectNativePoolKeyV1.properties.fee.oneOf)
      .toEqual([
        { type: "integer", minimum: 0, maximum: 999999 },
        { const: 8388608 },
      ]);
    expect(v3.components.schemas.DirectNativePoolKeyV1.properties.tickSpacing)
      .toMatchObject({ type: "integer", minimum: 1, maximum: 32767 });
    const funding = v3.components.schemas.Eip3009FundingAuthorizationDescriptorV1;
    expect(funding.required).toEqual([
      "schemaVersion",
      "method",
      "token",
      "from",
      "to",
      "value",
      "validAfter",
      "validBefore",
      "nonce",
    ]);
    expect(Object.keys(funding.properties)).not.toEqual(
      expect.arrayContaining(["signature", "v", "r", "s"]),
    );
    expect(v3.components.schemas.FundingAuthorizationSubmissionV1
      .properties.signature.pattern).toBe("^0x[0-9a-f]{130}$");
    expect(v3.components.schemas.CustomLaunchResourceV3.properties.status.enum)
      .toEqual(expect.arrayContaining([
        "pending_review",
        "action_required",
        "awaiting_funding_authorization",
        "funding_authorization_verified",
        "authorized",
      ]));
    expect(v3.components.schemas.CustomLaunchOutputV3.oneOf[0]
      .properties.stage.const).toBe("platform-review-pending");
    expect(v3.components.schemas.CustomLaunchOutputV3.oneOf[1]
      .properties.stage.const).toBe("funding-signature-required");
    expect(v3.components.schemas.CustomLaunchOutputV3.oneOf[3]
      .properties.stage.const).toBe("router-transaction-required");
    expect(v3.components.schemas.CustomLaunchOutputV3.oneOf.every(
      (variant: { required: string[] }) =>
        variant.required.includes("fundingBoundary"),
    )).toBe(true);
    expect(v3.components.schemas.FundingBoundaryV3.properties).toMatchObject({
      approvalTransactionRequired: { const: false },
      permit2Used: { const: false },
      fundingSignatureProducedByService: { const: false },
      walletTransactionBroadcastByService: { const: false },
    });
    expect(v3.components.schemas.CustomLaunchOutputV3.oneOf[3]
      .properties.actionRequired.required).toEqual(expect.arrayContaining([
      "permitDigest",
      "initializerCalldataHash",
    ]));

    const serialized = JSON.stringify(v3);
    expect(serialized).not.toContain('"additive":true');

    const documents = new Map<string, unknown>([
      ["", v3],
      ["./custom-launch-v2.json", v2],
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
    visit(v3);
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
        status: "promoted-to-public",
        release: "2.0.0",
        publicAuthorization: true,
        openApiUrl: "https://programmable.market/openapi/custom-launch-v2.json",
      },
      v2: {
        status: "live",
        createHttpStatus: 202,
        replayHttpStatus: 200,
        retryAfter: "honor-on-429-or-503",
        openApiUrl: "https://programmable.market/openapi/custom-launch-v2.json",
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
