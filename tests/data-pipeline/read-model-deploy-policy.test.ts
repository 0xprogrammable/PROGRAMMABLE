import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as deployPolicy from "../../scripts/perf/read-model-deploy-policy.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { runtimeProductionProviderBindingsFromUrls } from "../../scripts/perf/read-model-provider-binding.mjs";

const {
  createStagedReleaseAttestation,
  evaluateReadModelDeployPolicy,
  PROJECTOR_WAKE_ROUTE,
  readReleasePolicyExpectations,
  validateStagedReleaseAttestation,
  QUICKNODE_STREAM_SECRET_ENV_NAME,
  RELEASE_GATED_FLAG_NAMES,
  REQUIRED_NON_SECRET_RUNTIME_ENV_NAMES,
  REQUIRED_SERVER_SECRET_ENV_NAMES,
  WORKER_ACTIVATION_FLAG_NAMES,
} = deployPolicy;

const ROOT = process.cwd();
const ALCHEMY_URL = "https://eth-mainnet.g.alchemy.com/v2/abcdefgh";
const QUICKNODE_URL = "https://programmable.quiknode.pro/abcdefgh";
const EXPECTATIONS = readReleasePolicyExpectations(ROOT);
const PROVIDER_BINDINGS = runtimeProductionProviderBindingsFromUrls({
  PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY_URL,
  PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE_URL,
});
const COMMITMENTS = Object.freeze({
  PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
    PROVIDER_BINDINGS.find(
      ({ vendorGroup }: { vendorGroup: string }) => vendorGroup === "alchemy",
    ).endpointCommitment,
  PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
    PROVIDER_BINDINGS.find(
      ({ vendorGroup }: { vendorGroup: string }) => vendorGroup === "quicknode",
    ).endpointCommitment,
});

function environmentFile(input: {
  indexed?: Partial<Record<string, string | undefined>>;
  workers?: Partial<Record<string, string | undefined>>;
  nonSecret?: Partial<Record<string, string | undefined>>;
  serverSecrets?: Partial<Record<string, string | undefined>>;
  includeRuntimeProviders?: boolean;
} = {}) {
  const values: Record<string, string | undefined> = {
    ...Object.fromEntries(
      RELEASE_GATED_FLAG_NAMES.map((name: string) => [name, "false"]),
    ),
    ...Object.fromEntries(
      WORKER_ACTIVATION_FLAG_NAMES.map((name: string) => [name, "false"]),
    ),
    ...EXPECTATIONS,
    ...Object.fromEntries(
      REQUIRED_SERVER_SECRET_ENV_NAMES.map((name: string) => [name, ""]),
    ),
    ...(input.includeRuntimeProviders
      ? {
          PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY_URL,
          PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE_URL,
        }
      : {}),
    ...input.indexed,
    ...input.workers,
    ...input.nonSecret,
    ...input.serverSecrets,
  };
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
}

describe("read-model production deploy policy", () => {
  it("binds legacy-only to exact false indexed flags and disabled workers", () => {
    const policy = evaluateReadModelDeployPolicy(
      environmentFile({
        workers: { PROGRAMMABLE_PROJECTOR_ACTIVE: undefined },
      }),
      {},
      EXPECTATIONS,
    );
    expect(policy).toMatchObject({
      mode: "legacy-only",
      evidenceRequired: false,
      policyReady: true,
      commitmentsReady: true,
      indexedFlags: Object.fromEntries(
        RELEASE_GATED_FLAG_NAMES.map((name: string) => [name, false]),
      ),
      workerActivationFlags: {
        PROGRAMMABLE_PROJECTOR_ACTIVE: false,
        PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE: false,
      },
    });
  });

  it("treats either active worker as an evidence-gated runtime", () => {
    for (const worker of WORKER_ACTIVATION_FLAG_NAMES) {
      const policy = evaluateReadModelDeployPolicy(
        environmentFile({
          workers: { [worker]: "true" },
          serverSecrets: {
            [QUICKNODE_STREAM_SECRET_ENV_NAME]: "[sensitive]",
          },
          includeRuntimeProviders: true,
        }),
        COMMITMENTS,
        EXPECTATIONS,
      );
      expect(policy).toMatchObject({
        mode: "indexed-or-shadow",
        evidenceRequired: true,
        policyReady: true,
        commitmentsReady: true,
        runtimeProviderBinding: "verified",
        wakeRoute: "/api/ops/projector-wake",
        wakeCanaryRequired: true,
        streamSecretReady: true,
      });
      expect(policy.nonLegacyFlags).toContain(worker);
    }
  });

  it("requires a bounded server-only stream secret for an active worker", () => {
    for (const value of [undefined, "too-short", "x".repeat(1_025)]) {
      const policy = evaluateReadModelDeployPolicy(
        environmentFile({
          workers: { PROGRAMMABLE_PROJECTOR_ACTIVE: "true" },
          serverSecrets: {
            [QUICKNODE_STREAM_SECRET_ENV_NAME]: value,
          },
          includeRuntimeProviders: true,
        }),
        COMMITMENTS,
        EXPECTATIONS,
      );
      expect(policy).toMatchObject({
        policyReady: false,
        wakeCanaryRequired: true,
        streamSecretReady: false,
        invalidServerSecretEnvironmentNames: [
          QUICKNODE_STREAM_SECRET_ENV_NAME,
        ],
      });
    }

    for (const value of ["[sensitive]", "x".repeat(32)]) {
      const policy = evaluateReadModelDeployPolicy(
        environmentFile({
          workers: { PROGRAMMABLE_PROJECTOR_ACTIVE: "true" },
          serverSecrets: {
            [QUICKNODE_STREAM_SECRET_ENV_NAME]: value,
          },
          includeRuntimeProviders: true,
        }),
        COMMITMENTS,
        EXPECTATIONS,
      );
      expect(policy).toMatchObject({
        policyReady: true,
        wakeCanaryRequired: true,
        streamSecretReady: true,
        invalidServerSecretEnvironmentNames: [],
      });
    }
  });

  it("fails closed on ambiguous flags and missing or drifted provenance", () => {
    const ambiguous = evaluateReadModelDeployPolicy(
      environmentFile({
        workers: { PROGRAMMABLE_PROJECTOR_ACTIVE: "TRUE" },
        includeRuntimeProviders: true,
      }),
      COMMITMENTS,
      EXPECTATIONS,
    );
    expect(ambiguous.policyReady).toBe(false);
    expect(ambiguous.invalidFlagNames).toEqual([
      "PROGRAMMABLE_PROJECTOR_ACTIVE",
    ]);

    const missingIndexedFlag = environmentFile()
      .split("\n")
      .filter((line) => !line.startsWith(`${RELEASE_GATED_FLAG_NAMES[0]}=`))
      .join("\n");
    const missing = evaluateReadModelDeployPolicy(
      missingIndexedFlag,
      {},
      EXPECTATIONS,
    );
    expect(missing.policyReady).toBe(false);
    expect(missing.invalidFlagNames).toContain(RELEASE_GATED_FLAG_NAMES[0]);

    for (const name of REQUIRED_NON_SECRET_RUNTIME_ENV_NAMES) {
      const drifted = evaluateReadModelDeployPolicy(
        environmentFile({ nonSecret: { [name]: undefined } }),
        {},
        EXPECTATIONS,
      );
      expect(drifted.policyReady).toBe(false);
      expect(drifted.invalidNonSecretEnvironmentNames).toContain(name);
    }
    const wrongGraph = evaluateReadModelDeployPolicy(
      environmentFile({
        nonSecret: {
          PROGRAMMABLE_UNISWAP_GRAPH_SCHEMA_COMMITMENT: `0x${"00".repeat(32)}`,
        },
      }),
      {},
      EXPECTATIONS,
    );
    expect(wrongGraph.policyReady).toBe(false);
    expect(wrongGraph.invalidNonSecretEnvironmentNames).toContain(
      "PROGRAMMABLE_UNISWAP_GRAPH_SCHEMA_COMMITMENT",
    );
  });

  it("creates a canonical non-secret attestation for the exact staged target", () => {
    const policy = evaluateReadModelDeployPolicy(
      environmentFile(),
      {},
      EXPECTATIONS,
    );
    const result = createStagedReleaseAttestation({
      policy,
      verifiedSha: "a".repeat(40),
      vercelProjectId: "prj_1234567890abcdef",
      stagedDeploymentId: `dpl_${"b".repeat(24)}`,
      stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
      productionOrigin: "https://programmable.family",
      expectedMode: "legacy-only",
      timestamp: "2026-08-01T12:34:56.000Z",
    });
    expect(JSON.parse(result.json)).toEqual({
      schemaVersion: 1,
      verifiedSha: "a".repeat(40),
      vercelProjectId: "prj_1234567890abcdef",
      stagedDeploymentId: `dpl_${"b".repeat(24)}`,
      stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
      productionOrigin: "https://programmable.family",
      policyMode: "legacy-only",
      indexedFlags: policy.indexedFlags,
      workerActivationFlags: policy.workerActivationFlags,
      timestamp: "2026-08-01T12:34:56.000Z",
    });
    expect(result.sha256).toBe(
      createHash("sha256").update(result.json, "utf8").digest("hex"),
    );
    expect(result.json).not.toMatch(/(?:password|postgresql:\/\/)/iu);
    expect(
      validateStagedReleaseAttestation(JSON.parse(result.json), {
        verifiedSha: "a".repeat(40),
        vercelProjectId: "prj_1234567890abcdef",
        stagedDeploymentId: `dpl_${"b".repeat(24)}`,
        stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
        productionOrigin: "https://programmable.family",
        nowMs: Date.parse("2026-08-01T12:35:00.000Z"),
      }),
    ).toEqual(JSON.parse(result.json));
  });

  it("rejects stale, mutated or publicly exposed cutover attestations", () => {
    const policy = evaluateReadModelDeployPolicy(
      environmentFile({
        indexed: Object.fromEntries(
          RELEASE_GATED_FLAG_NAMES.map((name: string) => [
            name,
            name === "INDEXED_READ_SHADOW_COMPARE_ENABLED" ? "false" : "true",
          ]),
        ),
        workers: Object.fromEntries(
          WORKER_ACTIVATION_FLAG_NAMES.map((name: string) => [name, "true"]),
        ),
        serverSecrets: {
          [QUICKNODE_STREAM_SECRET_ENV_NAME]: "[sensitive]",
        },
        includeRuntimeProviders: true,
      }),
      COMMITMENTS,
      EXPECTATIONS,
    );
    const value = JSON.parse(
      createStagedReleaseAttestation({
        policy,
        verifiedSha: "a".repeat(40),
        vercelProjectId: "prj_1234567890abcdef",
        stagedDeploymentId: `dpl_${"b".repeat(24)}`,
        stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
        productionOrigin: "https://programmable.family",
        expectedMode: "indexed-or-shadow",
        timestamp: "2026-08-01T12:34:56.000Z",
      }).json,
    );
    const expected = {
      verifiedSha: value.verifiedSha,
      vercelProjectId: value.vercelProjectId,
      stagedDeploymentId: value.stagedDeploymentId,
      stagedDeploymentUrl: value.stagedDeploymentUrl,
      productionOrigin: value.productionOrigin,
      requireWorkersActive: true,
      requireIndexedRoutesActive: true,
      nowMs: Date.parse("2026-08-01T12:35:00.000Z"),
    };
    expect(() =>
      validateStagedReleaseAttestation(
        { ...value, verifiedSha: "c".repeat(40) },
        expected,
      ),
    ).toThrow("verifiedSha does not match");
    expect(() =>
      validateStagedReleaseAttestation(
        {
          ...value,
          indexedFlags: {
            ...value.indexedFlags,
            INDEXED_EXPLORE_LIST_READS_ENABLED: false,
          },
        },
        expected,
      ),
    ).toThrow("does not activate exact indexed routes");
    expect(() =>
      validateStagedReleaseAttestation(value, {
        ...expected,
        nowMs: Date.parse("2026-08-02T12:35:00.000Z"),
      }),
    ).toThrow("timestamp is invalid");
  });

  it("rejects an attestation for a different mode, target or project", () => {
    const policy = evaluateReadModelDeployPolicy(
      environmentFile(),
      {},
      EXPECTATIONS,
    );
    const valid = {
      policy,
      verifiedSha: "a".repeat(40),
      vercelProjectId: "prj_1234567890abcdef",
      stagedDeploymentId: `dpl_${"b".repeat(24)}`,
      stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
      productionOrigin: "https://programmable.family",
      expectedMode: "legacy-only",
      timestamp: "2026-08-01T12:34:56.000Z",
    };
    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        expectedMode: "indexed-or-shadow",
      }),
    ).toThrow("runtime mode");
    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        stagedDeploymentUrl: "https://programmable.family",
      }),
    ).toThrow("deployment-specific Vercel host");
    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        productionOrigin: "https://programmable.family/",
      }),
    ).toThrow("canonical Programmable domain");
    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        vercelProjectId: "other-project",
      }),
    ).toThrow("project ID");
  });

  it("publishes every exact non-secret runtime name in the env schema", () => {
    const example = readFileSync(resolve(ROOT, ".env.example"), "utf8");
    for (const name of [
      ...WORKER_ACTIVATION_FLAG_NAMES,
      ...REQUIRED_NON_SECRET_RUNTIME_ENV_NAMES,
      ...REQUIRED_SERVER_SECRET_ENV_NAMES,
    ]) {
      expect(example.match(new RegExp(`^${name}=`, "gmu"))).toHaveLength(1);
      expect(example).not.toContain(`NEXT_PUBLIC_${name}`);
    }
    for (const [name, value] of Object.entries(EXPECTATIONS)) {
      expect(example).toContain(`${name}=${value}`);
    }
    expect(example).toContain(`${QUICKNODE_STREAM_SECRET_ENV_NAME}=\n`);
    expect(PROJECTOR_WAKE_ROUTE).toBe("/api/ops/projector-wake");
  });

  it("smokes the legacy release corpus and stops at a staged candidate", () => {
    const workflow = readFileSync(
      resolve(ROOT, ".github/workflows/deploy-production.yml"),
      "utf8",
    );
    expect(workflow).toContain("Attest exact staged release policy");
    expect(workflow).toContain("staged-release-attestation.json");
    expect(workflow).toContain("attestation_sha256");
    expect(workflow).toContain("Smoke legacy staged public APIs");
    expect(workflow).toContain(
      '"x-vercel-protection-bypass": automationBypassSecret',
    );
    expect(workflow).toContain("headers: legacySmokeRequestHeaders");
    expect(workflow).toContain('"/api/ops/health"');
    expect(workflow).toContain('"/api/indexers/v1/token-list"');
    expect(workflow).toContain("/api/explore/token?address=");
    expect(workflow).toContain("/api/explore/profile?account=");
    expect(workflow).toContain("releaseToken.creatorAddress");
    expect(workflow).toContain("Reverify staged candidate binding");
    expect(workflow).toContain("Record staged candidate handoff");
    expect(workflow).toContain(
      "Stage-only: no production promotion was attempted.",
    );
    expect(workflow).not.toContain("vercel promote");
    expect(workflow).not.toContain("vercel rollback");
  });
});
