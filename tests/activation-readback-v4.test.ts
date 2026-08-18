import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  canonicalJsonSha256V4,
  createProductionActivationWebsiteReadbackHandlerV4,
  productionActivationWebsiteReadbackConfigurationSha256V4,
  type ProductionActivationWebsiteReadbackRuntimeConfigurationV4,
} from "../lib/server/custom-launch/activation-readback-v4";
import {
  canonicalizeJson,
  type JsonValue,
} from "../lib/server/projection-target/canonical-json";

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const PARENT = "c".repeat(40);
const PACKAGE_ARTIFACT = `sha256:${"d".repeat(64)}` as const;
const WRITE_CONTRACT = `sha256:${"e".repeat(64)}` as const;
const PROJECT_ID = "prj_MM8nbhoztJnz1yhimwc9CVFYhAd7";
const DEPLOYMENT_ID = "dpl_1234567890abcdefghijkl";
const DEPLOYMENT_HOST = "launcher-v4-activation-123.vercel.app";
const AUDIENCE = "programmable.website-projection.v1";

const GENERIC_BINDING = Object.freeze({
  schemaVersion: "programmable.generic-launch-read-binding.v2",
  bindingHash: `sha256:${"1".repeat(64)}`,
});
const READ_MODEL_CONTRACT = Object.freeze({
  schemaVersion: "programmable.generic-launch-read-model-contract.v2",
  contractHash: `sha256:${"2".repeat(64)}`,
});
const APPROVAL_VERIFIER = Object.freeze({
  schemaVersion: "programmable.approval-artifact-verifier-binding.v3",
  bindingHash: `sha256:${"3".repeat(64)}`,
});

function fixture() {
  const unsigned = Object.freeze({
    schemaVersion:
      "programmable.production-activation-website-provider-runtime-configuration.v4" as const,
    website: Object.freeze({
      serviceOrigin: "https://programmable.family" as const,
      audience: AUDIENCE,
      targetId: "website-projection",
      targetGeneration: "1",
      writeContractHash: WRITE_CONTRACT,
      providerProjectId: PROJECT_ID,
      routeHost: "programmable.family" as const,
    }),
    deployment: Object.freeze({
      websiteCommit: COMMIT,
      websiteTree: TREE,
      websiteParent: PARENT,
    }),
    genericPublic: Object.freeze({
      genericLaunchReadBindingSha256: canonicalJsonSha256V4(
        GENERIC_BINDING as unknown as JsonValue,
      ),
      genericLaunchReadModelContractSha256: canonicalJsonSha256V4(
        READ_MODEL_CONTRACT as unknown as JsonValue,
      ),
      approvalArtifactVerifierBindingSha256: canonicalJsonSha256V4(
        APPROVAL_VERIFIER as unknown as JsonValue,
      ),
    }),
    release: Object.freeze({
      approvalServicePackageArtifactHash: PACKAGE_ARTIFACT,
    }),
  });
  const configuration = Object.freeze({
    ...unsigned,
    configurationSha256:
      productionActivationWebsiteReadbackConfigurationSha256V4(unsigned),
  }) satisfies ProductionActivationWebsiteReadbackRuntimeConfigurationV4;
  const environment = Object.freeze({
    PROGRAMMABLE_ACTIVATION_WEBSITE_READBACK_V4_CONFIGURATION_JSON:
      canonicalizeJson(configuration),
    PROGRAMMABLE_GENERIC_LAUNCH_READ_BINDING_V2_JSON:
      canonicalizeJson(GENERIC_BINDING),
    PROGRAMMABLE_GENERIC_LAUNCH_READ_MODEL_CONTRACT_V2_JSON:
      canonicalizeJson(READ_MODEL_CONTRACT),
    PROGRAMMABLE_APPROVAL_V3_ARTIFACT_VERIFIER_BINDING_JSON:
      canonicalizeJson(APPROVAL_VERIFIER),
    PROGRAMMABLE_WEBSITE_PROJECTION_AUDIENCE: AUDIENCE,
    PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH:
      PACKAGE_ARTIFACT,
    PROGRAMMABLE_RELEASE_COMMIT_SHA: COMMIT,
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    VERCEL_PROJECT_ID: PROJECT_ID,
    VERCEL_DEPLOYMENT_ID: DEPLOYMENT_ID,
    VERCEL_GIT_COMMIT_SHA: COMMIT,
    VERCEL_URL: DEPLOYMENT_HOST,
  });
  return { configuration, environment };
}

function request(
  host = "programmable.family",
  path = "/.well-known/programmable/activation-readback-v4",
  init: RequestInit = {},
) {
  return new Request(`https://${host}${path}`, init);
}

describe("production activation Website readback v4", () => {
  it("emits the consumer's exact canonical, LF-terminated public identity", async () => {
    const { environment } = fixture();
    const response = createProductionActivationWebsiteReadbackHandlerV4(
      environment,
    )(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    const expected = {
      schemaVersion:
        "programmable.production-activation-website-provider-readback.v4",
      serviceOrigin: "https://programmable.family",
      audience: AUDIENCE,
      targetId: "website-projection",
      targetGeneration: "1",
      writeContractHash: WRITE_CONTRACT,
      providerProjectId: PROJECT_ID,
      providerDeploymentId: DEPLOYMENT_ID,
      providerDeploymentState: "READY",
      routeHost: "programmable.family",
    };
    expect(body).toBe(`${canonicalizeJson(expected)}\n`);
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(
      Object.keys(expected).sort(),
    );
    expect(body).not.toContain("generic-launch-read-model-contract");
    expect(body).not.toContain(PACKAGE_ARTIFACT);
  });

  it("supports the exact immutable production deployment host for dark readback", () => {
    const { environment } = fixture();
    const response = createProductionActivationWebsiteReadbackHandlerV4(
      environment,
    )(request(DEPLOYMENT_HOST));
    expect(response.status).toBe(200);
  });

  it("fails closed when runtime configuration is unavailable", () => {
    const { environment } = fixture();
    const response = createProductionActivationWebsiteReadbackHandlerV4({
      ...environment,
      PROGRAMMABLE_ACTIVATION_WEBSITE_READBACK_V4_CONFIGURATION_JSON: undefined,
    })(request());
    expect(response.status).toBe(503);
  });

  it.each([
    ["query", request("programmable.family",
      "/.well-known/programmable/activation-readback-v4?alternate=1")],
    ["path", request("programmable.family",
      "/.well-known/programmable/activation-readback-v3")],
    ["host", request("unbound.example")],
    ["protocol", new Request(
      "http://programmable.family/.well-known/programmable/activation-readback-v4",
    )],
    ["method", request("programmable.family",
      "/.well-known/programmable/activation-readback-v4", { method: "POST" })],
  ])("rejects an inexact %s request without consulting configuration", (
    _name,
    input,
  ) => {
    const response = createProductionActivationWebsiteReadbackHandlerV4({})(input);
    expect(response.status).toBe(400);
  });

  it.each([
    ["target environment", { VERCEL_TARGET_ENV: "preview" }],
    ["Vercel environment", { VERCEL_ENV: "preview" }],
    ["project", { VERCEL_PROJECT_ID: "prj_substituted12345678901234" }],
    ["deployment", { VERCEL_DEPLOYMENT_ID: "invalid" }],
    ["source", { VERCEL_GIT_COMMIT_SHA: "f".repeat(40) }],
    ["release", { PROGRAMMABLE_RELEASE_COMMIT_SHA: "f".repeat(40) }],
    ["audience", { PROGRAMMABLE_WEBSITE_PROJECTION_AUDIENCE: "other" }],
    ["artifact", {
      PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH:
        `sha256:${"f".repeat(64)}`,
    }],
    ["Generic binding", {
      PROGRAMMABLE_GENERIC_LAUNCH_READ_BINDING_V2_JSON:
        canonicalizeJson({ ...GENERIC_BINDING, substituted: true }),
    }],
    ["read-model contract", {
      PROGRAMMABLE_GENERIC_LAUNCH_READ_MODEL_CONTRACT_V2_JSON:
        canonicalizeJson({ ...READ_MODEL_CONTRACT, substituted: true }),
    }],
    ["artifact verifier", {
      PROGRAMMABLE_APPROVAL_V3_ARTIFACT_VERIFIER_BINDING_JSON:
        canonicalizeJson({ ...APPROVAL_VERIFIER, substituted: true }),
    }],
  ])("fails closed on substituted %s identity", (_name, replacement) => {
    const { environment } = fixture();
    const response = createProductionActivationWebsiteReadbackHandlerV4({
      ...environment,
      ...replacement,
    })(request());
    expect(response.status).toBe(503);
  });

  it("rejects configuration extras and a stale self-commitment", () => {
    const { configuration, environment } = fixture();
    for (const candidate of [
      { ...configuration, unexpected: true },
      { ...configuration, configurationSha256: `sha256:${"0".repeat(64)}` },
    ]) {
      const response = createProductionActivationWebsiteReadbackHandlerV4({
        ...environment,
        PROGRAMMABLE_ACTIVATION_WEBSITE_READBACK_V4_CONFIGURATION_JSON:
          canonicalizeJson(candidate),
      })(request());
      expect(response.status).toBe(503);
    }
  });

  it("uses the consumer's exact identity grammar", () => {
    const { configuration, environment } = fixture();
    const unsigned = {
      schemaVersion: configuration.schemaVersion,
      website: {
        ...configuration.website,
        targetId: "website/projection",
      },
      deployment: configuration.deployment,
      genericPublic: configuration.genericPublic,
      release: configuration.release,
    } as const;
    const candidate = {
      ...unsigned,
      configurationSha256:
        productionActivationWebsiteReadbackConfigurationSha256V4(unsigned),
    };
    const response = createProductionActivationWebsiteReadbackHandlerV4({
      ...environment,
      PROGRAMMABLE_ACTIVATION_WEBSITE_READBACK_V4_CONFIGURATION_JSON:
        canonicalizeJson(candidate),
    })(request());
    expect(response.status).toBe(503);
  });

  it("rejects duplicate-key and oversized configuration before exposure", () => {
    const { environment } = fixture();
    for (const source of [
      '{"schemaVersion":"a","schemaVersion":"b"}',
      "x".repeat(65_537),
    ]) {
      const response = createProductionActivationWebsiteReadbackHandlerV4({
        ...environment,
        PROGRAMMABLE_ACTIVATION_WEBSITE_READBACK_V4_CONFIGURATION_JSON: source,
      })(request());
      expect(response.status).toBe(503);
    }
  });
});
