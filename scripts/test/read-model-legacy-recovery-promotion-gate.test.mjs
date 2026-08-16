import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createLegacyRecoveryStageHandoff,
  disabledLegacyRecoveryRuntimeFlags,
  LEGACY_RECOVERY_INDEXED_FLAG_NAMES,
  LEGACY_RECOVERY_WORKER_FLAG_NAMES,
  verifyLegacyRecoveryPromotionHandoff,
} from "../perf/read-model-legacy-recovery-promotion-gate.mjs";

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const TARGET = "https://programmable-stage-abc.vercel.app";
const DEPLOYMENT_ID = `dpl_${"c".repeat(24)}`;
const PROJECT_ID = "prj_1234567890abcdef";
const ROLLBACK_ID = `dpl_${"d".repeat(24)}`;
const ROLLBACK_HEAD = "e".repeat(40);
const CREATED_AT = "2026-08-16T18:30:00.000Z";
const DIGEST = `sha256:${"1".repeat(64)}`;

function writeJson(directory, name, value) {
  const path = join(directory, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return path;
}

function evidence(directory, overrides = {}) {
  const seed = {
    ok: true,
    targetUrl: `${TARGET}/`,
    deploymentId: DEPLOYMENT_ID,
    gitHead: COMMIT,
    refreshBlockNumber: "25740000",
    tokenCount: 343,
    updated: true,
    portfolioHistoryStatus: "recorded",
    portfolioHistoryPath: "portfolio-history/1/2026-08-16T18.json",
    ...overrides.seed,
  };
  const smoke = {
    status: "verified-staged-static-identity-dexscreener-public-apis",
    catalogSource: "durable-blob",
    catalogStatus: "current",
    lastIndexedAt: CREATED_AT,
    healthStatus: "degraded",
    healthAuthority: "informational-only",
    marketProvider: "dexscreener",
    marketReadStatus: "partial",
    tokenAddress: `0x${"2".repeat(40)}`,
    profileAccount: `0x${"3".repeat(40)}`,
    profileStatus: "fail-closed-unavailable",
    detailStatus: "verified-dexscreener-market",
    chartStatus: "unavailable",
    creatorClaimPrepare: "separate-live-probe-required",
    tradePrepare: "separate-live-probe-required",
    ...overrides.smoke,
  };
  const customV2 = {
    schemaVersion: "programmable.custom-v2-stage-evidence.v1",
    status: "verified-staged",
    deployment: {
      id: DEPLOYMENT_ID,
      targetUrl: `${TARGET}/`,
      gitHead: COMMIT,
    },
    matrix: {
      registryMode: "prelaunch",
      genericMode: "disabled",
      authenticatedIngress: false,
    },
    publicResponseDigests: {
      registryManifest: DIGEST,
      registryReadiness: DIGEST,
      genericReadiness: DIGEST,
      feed: DIGEST,
      detail: DIGEST,
    },
    checks: [
      "registry-v2-manifest",
      "registry-v2-prelaunch",
      "approval-v3-unavailable",
      "generic-v2-projector-unauthorized",
      "generic-v2-signer-probe-disabled",
      "generic-v2-disabled",
      "generic-v2-detail-disabled",
      "custom-v2-ui-routes",
    ].map((id) => ({ id, status: "pass", detail: `${id} passed` })),
    ...overrides.customV2,
  };
  return {
    seedEvidencePath: writeJson(directory, "seed.json", seed),
    publicSmokeEvidencePath: writeJson(directory, "smoke.json", smoke),
    customV2EvidencePath: writeJson(directory, "custom-v2.json", customV2),
  };
}

function runtimeEnvironment(overrides = {}) {
  return [
    ...LEGACY_RECOVERY_INDEXED_FLAG_NAMES,
    ...LEGACY_RECOVERY_WORKER_FLAG_NAMES,
    "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED",
    "PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED",
  ].map((name) => `${name}=${overrides[name] ?? "false"}`).join("\n");
}

function validInput(directory, overrides = {}) {
  return {
    commit: COMMIT,
    tree: TREE,
    deploymentId: DEPLOYMENT_ID,
    targetUrl: TARGET,
    projectId: PROJECT_ID,
    rollbackDeploymentId: ROLLBACK_ID,
    rollbackDeploymentUrl: "https://programmable-rollback-abc.vercel.app",
    rollbackGitHead: ROLLBACK_HEAD,
    runId: "31960000000",
    runAttempt: "1",
    verificationMode: "custom-v2-release",
    verifiedCustomV2: true,
    verifyRunId: "31959999999",
    verifyRunAttempt: "1",
    verifyArtifactId: "9266999999",
    verifyArtifactDigest: DIGEST,
    verifyProofSha256: DIGEST,
    customLaunchConfiguredEnablement: false,
    customLaunchStagingMode: "generic-disabled",
    launchControls: {
      customLaunchPublicEnablement: false,
      customLaunchDarkRelease: false,
      customV2RegistryLive: false,
      customV2GenericPublicReadEnabled: false,
      customV2DetailRecordHashConfigured: false,
      customV2AuthenticatedIngressEvidenceConfigured: false,
      customV2GenericSignerProbeConfigured: false,
    },
    runtimeEnvSource: runtimeEnvironment(),
    createdAt: CREATED_AT,
    ...evidence(directory),
    ...overrides,
  };
}

function withDirectory(operation) {
  const directory = mkdtempSync(join(tmpdir(), "legacy-recovery-gate-"));
  try {
    return operation(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("creates and verifies only the exact legacy Blob plus Dex recovery handoff", () => {
  withDirectory((directory) => {
    const result = createLegacyRecoveryStageHandoff(validInput(directory));
    const handoff = JSON.parse(result.json);
    assert.equal(handoff.status, "promotion-review-ready");
    assert.equal(handoff.stage.seed.tokenCount, 343);
    assert.equal(handoff.stage.publicSmoke.marketProvider, "dexscreener");
    assert.equal(handoff.stage.customV2.registryMode, "prelaunch");
    assert.equal(
      Object.values(handoff.runtime.disabledFlags).every((value) => !value),
      true,
    );
    assert.deepEqual(
      verifyLegacyRecoveryPromotionHandoff(handoff, {
        commit: COMMIT,
        tree: TREE,
        deploymentId: DEPLOYMENT_ID,
        targetUrl: TARGET,
        projectId: PROJECT_ID,
        rollbackDeploymentId: ROLLBACK_ID,
        rollbackGitHead: ROLLBACK_HEAD,
        runId: "31960000000",
        runAttempt: "1",
        nowMs: Date.parse(CREATED_AT) + 60_000,
      }),
      handoff,
    );
  });
});

test("accepts missing, empty or exact false runtime flags and rejects every active or ambiguous flag", () => {
  assert.equal(
    Object.values(disabledLegacyRecoveryRuntimeFlags("")).every((value) => !value),
    true,
  );
  assert.equal(
    Object.values(disabledLegacyRecoveryRuntimeFlags(
      'PROGRAMMABLE_PROJECTOR_ACTIVE="false"\nPROGRAMMABLE_MARKET_PROJECTOR_ACTIVE=',
    )).every((value) => !value),
    true,
  );
  for (const name of [
    ...LEGACY_RECOVERY_INDEXED_FLAG_NAMES,
    ...LEGACY_RECOVERY_WORKER_FLAG_NAMES,
    "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED",
    "PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED",
  ]) {
    assert.throws(
      () => disabledLegacyRecoveryRuntimeFlags(`${name}=true`),
      /active runtime flags/u,
    );
  }
  assert.throws(
    () => disabledLegacyRecoveryRuntimeFlags(
      "PROGRAMMABLE_PROJECTOR_ACTIVE=false\nPROGRAMMABLE_PROJECTOR_ACTIVE=false",
    ),
    /runtime flag/u,
  );
  assert.throws(
    () => disabledLegacyRecoveryRuntimeFlags(
      "PROGRAMMABLE_PROJECTOR_ACTIVE=${UNREVIEWED}",
    ),
    /runtime flag/u,
  );
});

test("rejects any enabled launch control, empty seed or activated Custom V2 surface", () => {
  for (const control of [
    "customLaunchPublicEnablement",
    "customLaunchDarkRelease",
    "customV2RegistryLive",
    "customV2GenericPublicReadEnabled",
    "customV2DetailRecordHashConfigured",
    "customV2AuthenticatedIngressEvidenceConfigured",
    "customV2GenericSignerProbeConfigured",
  ]) {
    withDirectory((directory) => {
      const input = validInput(directory);
      input.launchControls = { ...input.launchControls, [control]: true };
      assert.throws(
        () => createLegacyRecoveryStageHandoff(input),
        /launch control/u,
      );
    });
  }
  withDirectory((directory) => {
    const input = validInput(directory);
    const seed = JSON.parse(
      readFileSync(input.seedEvidencePath, "utf8"),
    );
    writeFileSync(
      input.seedEvidencePath,
      `${JSON.stringify({ ...seed, tokenCount: 0 }, null, 2)}\n`,
      { mode: 0o600 },
    );
    assert.throws(
      () => createLegacyRecoveryStageHandoff(input),
      /seed evidence/u,
    );
  });
  withDirectory((directory) => {
    const input = validInput(directory);
    const customV2 = JSON.parse(
      readFileSync(input.customV2EvidencePath, "utf8"),
    );
    writeFileSync(
      input.customV2EvidencePath,
      `${JSON.stringify({
        ...customV2,
        matrix: {
          ...customV2.matrix,
          registryMode: "live",
        },
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
    assert.throws(
      () => createLegacyRecoveryStageHandoff(input),
      /Custom V2 evidence/u,
    );
  });
});

test("rejects identity drift, stale handoffs and any widened cutover authority", () => {
  withDirectory((directory) => {
    const handoff = JSON.parse(
      createLegacyRecoveryStageHandoff(validInput(directory)).json,
    );
    assert.throws(
      () => verifyLegacyRecoveryPromotionHandoff(handoff, {
        commit: "f".repeat(40),
        nowMs: Date.parse(CREATED_AT),
      }),
      /commit expectation/u,
    );
    assert.throws(
      () => verifyLegacyRecoveryPromotionHandoff(handoff, {
        nowMs: Date.parse(CREATED_AT) + 2 * 60 * 60 * 1_000 + 1,
      }),
      /timestamp/u,
    );
    assert.throws(
      () => verifyLegacyRecoveryPromotionHandoff({
        ...handoff,
        authority: {
          ...handoff.authority,
          projectorDatabaseOrIndexedPublicCutoverAuthorized: true,
        },
      }, { nowMs: Date.parse(CREATED_AT) }),
      /cutover authority/u,
    );
    assert.throws(
      () => verifyLegacyRecoveryPromotionHandoff(
        { ...handoff, unreviewed: true },
        { nowMs: Date.parse(CREATED_AT) },
      ),
      /handoff/u,
    );
  });
});
