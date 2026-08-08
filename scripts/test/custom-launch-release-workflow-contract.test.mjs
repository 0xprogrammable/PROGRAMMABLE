import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  readCustomLaunchPublicFlag,
  resolveCustomLaunchStagingPolicy,
} from "../resolve-custom-launch-staging-policy.mjs";

const WORKFLOW_URL = new URL(
  "../../.github/workflows/deploy-production.yml",
  import.meta.url,
);

function workflowFailures(source) {
  const failures = [];
  const requireText = (id, text) => {
    if (!source.includes(text)) failures.push(id);
  };
  const requireOrder = (id, earlier, later) => {
    const earlierIndex = source.indexOf(earlier);
    const laterIndex = source.indexOf(later);
    if (earlierIndex < 0 || laterIndex <= earlierIndex) failures.push(id);
  };

  requireText("dispatch-boolean", "custom_launch_public_enablement:");
  requireText("dispatch-boolean-type", "type: boolean");
  requireText("dispatch-default-off", "default: false");
  requireText(
    "production-config-policy",
    "node scripts/resolve-custom-launch-staging-policy.mjs",
  );
  requireText(
    "production-config-input",
    "CUSTOM_LAUNCH_PUBLIC_ENABLEMENT_REQUESTED: ${{ inputs.custom_launch_public_enablement }}",
  );
  requireText("canonical-stage-name", "Stage programmable.market candidate");
  requireText(
    "canonical-rollback-target",
    '--target-url "https://programmable.market"',
  );
  requireText(
    "canonical-attestation-origin",
    '--production-origin "https://programmable.market"',
  );
  requireText(
    "canonical-summary-target",
    "Production target: https://programmable.market",
  );
  if (source.includes("programmable.family")) {
    failures.push("former-production-domain");
  }
  requireText(
    "protected-production-mode",
    "CUSTOM_LAUNCH_PRODUCTION_MODE: ${{ vars.CUSTOM_LAUNCH_PRODUCTION_MODE }}",
  );
  requireText(
    "protected-production-mode-input",
    '--production-mode "$CUSTOM_LAUNCH_PRODUCTION_MODE"',
  );
  const recordGateStart = source.indexOf(
    "      - name: Verify detached Custom Launch release record",
  );
  const recordGateEnd = source.indexOf(
    "      - name: Preserve detached Custom Launch release record",
  );
  const recordGateBlock =
    recordGateStart >= 0 && recordGateEnd > recordGateStart
      ? source.slice(recordGateStart, recordGateEnd)
      : "";
  if (
    !recordGateBlock.includes(
      "if: steps.custom-launch-policy.outputs.release_record_required == 'true'",
    )
  )
    failures.push("conditional-record-gate");
  requireText(
    "dedicated-record-ref",
    'record_ref="refs/remotes/origin/command-center-release-records"',
  );
  requireText(
    "dedicated-record-fetch",
    '"+refs/heads/command-center-release-records:$record_ref"',
  );
  requireText(
    "record-commit-format",
    '[[ ! "$RECORD_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]]',
  );
  requireText(
    "record-detached-from-subject",
    '[[ "$RECORD_COMMIT_SHA" == "$GITHUB_SHA" ]]',
  );
  requireText(
    "record-reachability",
    'git merge-base --is-ancestor "$RECORD_COMMIT_SHA" "$record_ref"',
  );
  requireText(
    "record-github-provenance",
    "commit.commit?.verification?.verified !== true",
  );
  requireText(
    "record-programmable-author",
    'commit.author?.login !== "0xprogrammable"',
  );
  requireText(
    "record-programmable-committer",
    'commit.committer?.login !== "0xprogrammable"',
  );
  requireText(
    "record-fixed-path",
    'record_path="release-records/custom-launch-v1/release-record.json"',
  );
  requireText("record-staging-level", "--require staging");
  requireText(
    "record-website-binding",
    '--expect-website-commit "$GITHUB_SHA"',
  );
  requireText(
    "record-backend-binding",
    '--expect-package-artifact-hash "$EXPECTED_PACKAGE_ARTIFACT_HASH"',
  );
  requireText(
    "record-protected-backend-identity",
    "EXPECTED_PACKAGE_ARTIFACT_HASH: ${{ secrets.PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH }}",
  );
  requireText(
    "record-cross-repository-attestation-binding",
    '--expect-cross-repository-attestation-commit "$EXPECTED_CROSS_REPOSITORY_ATTESTATION_COMMIT_SHA"',
  );
  requireText(
    "record-cross-repository-document-binding",
    '--expect-cross-repository-binding-document-sha256 "$EXPECTED_CROSS_REPOSITORY_BINDING_DOCUMENT_SHA256"',
  );
  requireText(
    "record-protected-cross-repository-attestation",
    "EXPECTED_CROSS_REPOSITORY_ATTESTATION_COMMIT_SHA: ${{ vars.PROGRAMMABLE_BACKEND_CROSS_REPOSITORY_ATTESTATION_COMMIT_SHA }}",
  );
  requireText(
    "record-protected-cross-repository-document",
    "EXPECTED_CROSS_REPOSITORY_BINDING_DOCUMENT_SHA256: ${{ vars.PROGRAMMABLE_BACKEND_CROSS_REPOSITORY_BINDING_DOCUMENT_SHA256 }}",
  );
  requireText(
    "record-private-backend-read-token",
    "PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN: ${{ secrets.PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN }}",
  );
  requireText(
    "record-live-cross-repository-verification",
    "--verify-cross-repository-attestation",
  );
  requireText(
    "record-closed-attestation-summary",
    '--cross-repository-attestation-summary "$attestation_summary_file"',
  );
  requireText(
    "record-attestation-summary-retention",
    "${{ runner.temp }}/custom-launch-cross-repository-attestation.json",
  );
  requireText(
    "record-rollback-id-binding",
    '--expect-rollback-deployment-id "$ROLLBACK_DEPLOYMENT_ID"',
  );
  requireText(
    "record-rollback-url-binding",
    '--expect-rollback-deployment-url "$ROLLBACK_DEPLOYMENT_URL"',
  );
  requireText(
    "record-rollback-commit-binding",
    '--expect-rollback-website-commit "$ROLLBACK_WEBSITE_COMMIT_SHA"',
  );
  requireText(
    "record-digest-binding",
    '--expect-detached-record-sha256 "$EXPECTED_RECORD_SHA256"',
  );
  requireText(
    "record-artifact-retention",
    "custom-launch-release-record-${{ github.run_id }}-${{ github.run_attempt }}",
  );
  requireText(
    "record-no-promotion-claim",
    "No promotion is authorized by this staging gate.",
  );
  requireOrder(
    "policy-after-pulled-config",
    "Pull production configuration",
    "Resolve Custom Launch release-record policy",
  );
  requireText(
    "candidate-runtime-commit-binding",
    '--env PROGRAMMABLE_RELEASE_COMMIT_SHA="$GITHUB_SHA"',
  );
  requireOrder(
    "record-after-rollback-capture",
    "Capture current production rollback target",
    "Verify detached Custom Launch release record",
  );
  requireOrder(
    "record-before-build",
    "Verify detached Custom Launch release record",
    "Build production deployment",
  );
  requireOrder(
    "record-before-stage",
    "Verify detached Custom Launch release record",
    "Stage production build without assigning domains",
  );
  requireText("candidate-canary", "Gate exact staged Custom Launch candidate");
  requireText(
    "candidate-canary-conditional",
    "id: custom-launch-canary\n        if: steps.custom-launch-policy.outputs.release_record_required == 'true'",
  );
  requireText(
    "candidate-canary-immutable-target",
    "STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}",
  );
  requireText(
    "candidate-canary-deployment-binding",
    '"--deployment-id=$STAGED_DEPLOYMENT_ID"',
  );
  requireText(
    "candidate-canary-package-binding",
    "PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH: ${{ secrets.PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH }}",
  );
  for (const binding of [
    "PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_ACCESS_TOKEN",
    "PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_IDENTITY_TOKEN",
    "PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_EXPECTED_GITHUB_USER_ID",
    "PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_OWN_APPLICATION_HANDLE",
    "PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_FOREIGN_APPLICATION_HANDLE",
  ])
    requireText(`candidate-canary-${binding.toLowerCase()}`, binding);
  requireText("candidate-canary-enabled", "--require-enabled");
  requireText("candidate-canary-authenticated", "--authenticated-canary");
  requireText(
    "candidate-canary-redacted-evidence",
    "custom-launch-candidate-canary-evidence.json",
  );
  requireText(
    "candidate-canary-artifact",
    "custom-launch-candidate-canary-${{ github.run_id }}-${{ github.run_attempt }}",
  );
  requireOrder(
    "candidate-canary-after-stage-resolution",
    "Resolve exact staged deployment",
    "Gate exact staged Custom Launch candidate",
  );
  if (/\bvercel\s+(?:promote|rollback)(?:\s|$)/mu.test(source)) {
    failures.push("stage-only");
  }
  return failures;
}

test("generic production staging remains record-free only while Custom Launch is disabled", () => {
  assert.deepEqual(
    resolveCustomLaunchStagingPolicy({
      requested: "false",
      productionEnvSource: "OTHER_FLAG=true\n",
      productionMode: "disabled",
    }),
    { releaseRecordRequired: false, configuredEnablement: false },
  );
  assert.deepEqual(
    resolveCustomLaunchStagingPolicy({
      requested: false,
      productionEnvSource: `${"PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED"}=\"false\"\n`,
      productionMode: "disabled",
    }),
    { releaseRecordRequired: false, configuredEnablement: false },
  );
});

test("enabled production configuration requires an explicit matching dispatch", () => {
  assert.deepEqual(
    resolveCustomLaunchStagingPolicy({
      requested: "true",
      productionEnvSource: "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED='true'\n",
      productionMode: "enabled",
    }),
    { releaseRecordRequired: true, configuredEnablement: true },
  );
  assert.throws(
    () =>
      resolveCustomLaunchStagingPolicy({
        requested: "false",
        productionEnvSource: "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=true\n",
        productionMode: "enabled",
      }),
    /disagree/,
  );
  assert.throws(
    () =>
      resolveCustomLaunchStagingPolicy({
        requested: "true",
        productionEnvSource:
          "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=false\n",
        productionMode: "disabled",
      }),
    /disagree/,
  );
});

test("protected production mode rejects drift and invalid values", () => {
  assert.throws(
    () =>
      resolveCustomLaunchStagingPolicy({
        requested: "true",
        productionEnvSource: "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=true\n",
        productionMode: "disabled",
      }),
    /production mode.*disagree/u,
  );
  for (const productionMode of [undefined, "", "true", "Enabled", " enabled"]) {
    assert.throws(() =>
      resolveCustomLaunchStagingPolicy({
        requested: "false",
        productionEnvSource:
          "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=false\n",
        productionMode,
      }),
    );
  }
});

test("production flag parsing rejects duplicates, expansion, casing and whitespace drift", () => {
  for (const source of [
    "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=true\nPROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=true\n",
    "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=${ENABLE_CUSTOM}\n",
    "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=True\n",
    "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED= true\n",
  ]) {
    assert.throws(() => readCustomLaunchPublicFlag(source));
  }
});

test("the production workflow enforces the complete conditional detached-record contract", async () => {
  const source = await readFile(WORKFLOW_URL, "utf8");
  assert.deepEqual(workflowFailures(source), []);
});

test("workflow contract detects weakened record and stage-only gates", async () => {
  const source = await readFile(WORKFLOW_URL, "utf8");
  const mutations = [
    source.replace(
      "if: steps.custom-launch-policy.outputs.release_record_required == 'true'",
      "if: always()",
    ),
    source.replace("--require staging", "--require clearance"),
    source.replace(
      '--expect-package-artifact-hash "$EXPECTED_PACKAGE_ARTIFACT_HASH"',
      "",
    ),
    source.replace(
      '--expect-cross-repository-attestation-commit "$EXPECTED_CROSS_REPOSITORY_ATTESTATION_COMMIT_SHA"',
      "",
    ),
    source.replace(
      '--expect-cross-repository-binding-document-sha256 "$EXPECTED_CROSS_REPOSITORY_BINDING_DOCUMENT_SHA256"',
      "",
    ),
    source.replace("--verify-cross-repository-attestation", ""),
    source.replace(
      "PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN: ${{ secrets.PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN }}",
      "PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN: missing",
    ),
    source.replace(
      'git merge-base --is-ancestor "$RECORD_COMMIT_SHA" "$record_ref"',
      "",
    ),
    source.replace("commit.commit?.verification?.verified !== true", "false"),
    source.replace(
      '--expect-detached-record-sha256 "$EXPECTED_RECORD_SHA256"',
      "",
    ),
    source.replace(
      "CUSTOM_LAUNCH_PRODUCTION_MODE: ${{ vars.CUSTOM_LAUNCH_PRODUCTION_MODE }}",
      "CUSTOM_LAUNCH_PRODUCTION_MODE: enabled",
    ),
    source.replace('--production-mode "$CUSTOM_LAUNCH_PRODUCTION_MODE"', ""),
    source.replace('--env PROGRAMMABLE_RELEASE_COMMIT_SHA="$GITHUB_SHA"', ""),
    source.replace("--authenticated-canary", ""),
    source.replace('"--deployment-id=$STAGED_DEPLOYMENT_ID"', ""),
    source.replace(
      "custom-launch-candidate-canary-${{ github.run_id }}-${{ github.run_attempt }}",
      "missing-candidate-artifact",
    ),
    source.replace(
      "https://programmable.market",
      "https://programmable.family",
    ),
    `${source}\n      - run: vercel promote "$DEPLOYMENT_URL"\n`,
  ];
  for (const mutation of mutations) {
    assert.notDeepEqual(workflowFailures(mutation), []);
  }
});
