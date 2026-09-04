import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as deployPolicy from "../../scripts/perf/read-model-deploy-policy.mjs";

const {
  RESET_POLICY_MODE,
  RELEASE_GATED_FLAG_NAMES,
  REQUIRED_NON_SECRET_RUNTIME_ENV_NAMES,
  REQUIRED_SERVER_SECRET_ENV_NAMES,
  WORKER_ACTIVATION_FLAG_NAMES,
  createStagedReleaseAttestation,
  evaluateReadModelDeployPolicy,
  validateBoundVercelProductionMetadata,
  validateStagedReleaseAttestation,
} = deployPolicy;

function resetEnvironment(
  overrides: Partial<Record<string, string | undefined>> = {},
) {
  return Object.entries({
    ...Object.fromEntries(
      RELEASE_GATED_FLAG_NAMES.map((name: string) => [name, "false"]),
    ),
    ...Object.fromEntries(
      WORKER_ACTIVATION_FLAG_NAMES.map((name: string) => [name, "false"]),
    ),
    ...overrides,
  })
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
}

describe("Explore index-reset production deploy policy", () => {
  it("accepts only the provider-free reset state", () => {
    const policy = evaluateReadModelDeployPolicy(resetEnvironment());

    expect(policy).toMatchObject({
      mode: "index-reset",
      evidenceRequired: false,
      providerCredentialsRequired: false,
      policyReady: true,
      commitmentsReady: true,
      runtimeProviderBinding: "not-required",
      activeFlagNames: [],
      invalidFlagNames: [],
      invalidServerSecretEnvironmentNames: [],
      invalidProductionRpcRuntimeEnvironmentNames: [],
    });
    expect(policy.indexedFlags).toEqual(
      Object.fromEntries(
        RELEASE_GATED_FLAG_NAMES.map((name: string) => [name, false]),
      ),
    );
    expect(policy.workerActivationFlags).toEqual(
      Object.fromEntries(
        WORKER_ACTIVATION_FLAG_NAMES.map((name: string) => [name, false]),
      ),
    );
    expect(RESET_POLICY_MODE).toBe("index-reset");
    expect(REQUIRED_SERVER_SECRET_ENV_NAMES).toEqual([]);
    expect(REQUIRED_NON_SECRET_RUNTIME_ENV_NAMES).toEqual([]);
  });

  it("does not inspect or require provider configuration", () => {
    const withoutAnyProviderSettings = evaluateReadModelDeployPolicy(
      resetEnvironment(),
      {},
    );
    const withUnrelatedLegacySettings = evaluateReadModelDeployPolicy(
      `${resetEnvironment()}\nLEGACY_RPC_URL=not-a-url\nLEGACY_MARKET_TOKEN=short`,
      { LEGACY_COMMITMENT: "not-a-commitment" },
    );

    expect(withoutAnyProviderSettings.policyReady).toBe(true);
    expect(withUnrelatedLegacySettings).toMatchObject({
      policyReady: true,
      providerCredentialsRequired: false,
      commitmentsReady: true,
    });
  });

  it("retains the value-free production metadata and project binding", () => {
    const projectId = "prj_1234567890abcdef";
    const exact = {
      schemaVersion: "programmable.vercel-sensitive-production-metadata.v1",
      vercelProjectId: projectId,
      target: "production",
      envs: [
        {
          key: "UNRELATED_RUNTIME_SECRET",
          type: "sensitive",
          target: ["production"],
        },
      ],
    };
    expect(
      validateBoundVercelProductionMetadata(JSON.stringify(exact), projectId),
    ).toEqual({
      schemaVersion: exact.schemaVersion,
      vercelProjectId: projectId,
      target: "production",
      environmentRecordCount: 1,
    });
    expect(() =>
      validateBoundVercelProductionMetadata(
        JSON.stringify(exact),
        "prj_different123456",
      ),
    ).toThrow(/metadata is invalid/u);
    expect(() =>
      validateBoundVercelProductionMetadata(
        JSON.stringify({
          ...exact,
          envs: [{ ...exact.envs[0], value: "must-not-be-present" }],
        }),
        projectId,
      ),
    ).toThrow(/metadata is invalid/u);
  });

  it("fails closed when any indexed read or worker is enabled", () => {
    for (const name of [
      ...RELEASE_GATED_FLAG_NAMES,
      ...WORKER_ACTIVATION_FLAG_NAMES,
    ]) {
      const policy = evaluateReadModelDeployPolicy(
        resetEnvironment({ [name]: "true" }),
      );
      expect(policy.policyReady, name).toBe(false);
      expect(policy.activeFlagNames, name).toContain(name);
    }
  });

  it("fails closed on missing, malformed, or duplicated release flags", () => {
    const releaseFlag = RELEASE_GATED_FLAG_NAMES[0];
    const missing = evaluateReadModelDeployPolicy(
      resetEnvironment({ [releaseFlag]: undefined }),
    );
    expect(missing.policyReady).toBe(false);
    expect(missing.invalidFlagNames).toContain(releaseFlag);

    const malformed = evaluateReadModelDeployPolicy(
      resetEnvironment({ [releaseFlag]: "FALSE" }),
    );
    expect(malformed.policyReady).toBe(false);
    expect(malformed.invalidFlagNames).toContain(releaseFlag);

    expect(() =>
      evaluateReadModelDeployPolicy(
        `${resetEnvironment()}\n${releaseFlag}=false`,
      ),
    ).toThrow(/duplicated/u);
  });

  it("treats absent workers as disabled but rejects malformed worker values", () => {
    const absentWorkers = evaluateReadModelDeployPolicy(
      resetEnvironment(
        Object.fromEntries(
          WORKER_ACTIVATION_FLAG_NAMES.map((name: string) => [name, undefined]),
        ),
      ),
    );
    expect(absentWorkers.policyReady).toBe(true);

    const malformedWorker = evaluateReadModelDeployPolicy(
      resetEnvironment({ [WORKER_ACTIVATION_FLAG_NAMES[0]]: "0" }),
    );
    expect(malformedWorker.policyReady).toBe(false);
    expect(malformedWorker.invalidFlagNames).toContain(
      WORKER_ACTIVATION_FLAG_NAMES[0],
    );
  });

  it("creates a canonical attestation bound to the exact reset candidate", () => {
    const policy = evaluateReadModelDeployPolicy(resetEnvironment());
    const result = createStagedReleaseAttestation({
      policy,
      verifiedSha: "a".repeat(40),
      vercelProjectId: "prj_1234567890abcdef",
      stagedDeploymentId: `dpl_${"b".repeat(24)}`,
      stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
      productionOrigin: "https://programmable.market",
      expectedMode: "index-reset",
      timestamp: "2026-09-04T12:34:56.000Z",
    });

    expect(JSON.parse(result.json)).toEqual({
      schemaVersion: 1,
      verifiedSha: "a".repeat(40),
      vercelProjectId: "prj_1234567890abcdef",
      stagedDeploymentId: `dpl_${"b".repeat(24)}`,
      stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
      productionOrigin: "https://programmable.market",
      policyMode: "index-reset",
      indexedFlags: policy.indexedFlags,
      workerActivationFlags: policy.workerActivationFlags,
      timestamp: "2026-09-04T12:34:56.000Z",
    });
    expect(result.sha256).toBe(
      createHash("sha256").update(result.json, "utf8").digest("hex"),
    );
    expect(
      validateStagedReleaseAttestation(JSON.parse(result.json), {
        verifiedSha: "a".repeat(40),
        vercelProjectId: "prj_1234567890abcdef",
        stagedDeploymentId: `dpl_${"b".repeat(24)}`,
        stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
        productionOrigin: "https://programmable.market",
        requireIndexedFlagsFalse: true,
        nowMs: Date.parse("2026-09-04T12:35:00.000Z"),
      }),
    ).toEqual(JSON.parse(result.json));
  });

  it("rejects stale, provider-mode, active-index, and mismatched attestations", () => {
    const policy = evaluateReadModelDeployPolicy(resetEnvironment());
    const value = JSON.parse(
      createStagedReleaseAttestation({
        policy,
        verifiedSha: "a".repeat(40),
        vercelProjectId: "prj_1234567890abcdef",
        stagedDeploymentId: `dpl_${"b".repeat(24)}`,
        stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
        productionOrigin: "https://programmable.market",
        expectedMode: "index-reset",
        timestamp: "2026-09-04T12:34:56.000Z",
      }).json,
    );
    const expected = {
      verifiedSha: value.verifiedSha,
      vercelProjectId: value.vercelProjectId,
      stagedDeploymentId: value.stagedDeploymentId,
      stagedDeploymentUrl: value.stagedDeploymentUrl,
      productionOrigin: value.productionOrigin,
      nowMs: Date.parse("2026-09-04T12:35:00.000Z"),
    };

    expect(() =>
      validateStagedReleaseAttestation(
        { ...value, policyMode: "provider-backed" },
        expected,
      ),
    ).toThrow(/reset mode/u);
    expect(() =>
      validateStagedReleaseAttestation(
        {
          ...value,
          indexedFlags: {
            ...value.indexedFlags,
            INDEXED_EXPLORE_LIST_READS_ENABLED: true,
          },
        },
        expected,
      ),
    ).toThrow(/reset mode/u);
    expect(() =>
      validateStagedReleaseAttestation(value, {
        ...expected,
        verifiedSha: "c".repeat(40),
      }),
    ).toThrow(/verifiedSha does not match/u);
    expect(() =>
      validateStagedReleaseAttestation(value, {
        ...expected,
        nowMs: Date.parse("2026-09-05T12:35:00.000Z"),
      }),
    ).toThrow(/timestamp is invalid/u);
  });

  it("rejects a non-reset policy or non-canonical deployment identity", () => {
    const policy = evaluateReadModelDeployPolicy(resetEnvironment());
    const valid = {
      policy,
      verifiedSha: "a".repeat(40),
      vercelProjectId: "prj_1234567890abcdef",
      stagedDeploymentId: `dpl_${"b".repeat(24)}`,
      stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
      productionOrigin: "https://programmable.market",
      expectedMode: "index-reset",
      timestamp: "2026-09-04T12:34:56.000Z",
    };

    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        expectedMode: "provider-backed",
      }),
    ).toThrow(/runtime mode/u);
    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        stagedDeploymentUrl: "https://programmable.market",
      }),
    ).toThrow(/deployment-specific Vercel host/u);
    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        productionOrigin: "https://programmable.market/",
      }),
    ).toThrow(/canonical Programmable domain/u);
    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        vercelProjectId: "other-project",
      }),
    ).toThrow(/project ID/u);
  });
});
