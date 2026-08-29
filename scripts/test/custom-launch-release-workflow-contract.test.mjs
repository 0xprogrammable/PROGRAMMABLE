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

function mutateWorkflowStep(source, startMarker, endMarker, mutate) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing workflow step ${startMarker}`);
  return `${source.slice(0, start)}${mutate(source.slice(start, end))}${source.slice(end)}`;
}

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
  requireText("dispatch-dark-release-boolean", "custom_launch_dark_release:");
  if (source.includes("\n  push:\n")) failures.push("dispatch-only-stage");
  requireText(
    "exact-production-verify-proof-gate",
    "name: Consume exact full production Verify proof",
  );
  requireText(
    "proof-exact-artifact-download",
    "artifact-ids: ${{ steps.resolve-proof.outputs.artifact_id }}",
  );
  requireText(
    "proof-exact-artifact-run",
    "run-id: ${{ steps.resolve-proof.outputs.verify_run_id }}",
  );
  requireText("proof-download-digest-fail-closed", "digest-mismatch: error");
  requireText("proof-sigstore-verification", "gh attestation verify \"$proof\"");
  requireText(
    "proof-signer-workflow",
    '--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/verify.yml"',
  );
  if (
    source.includes('--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/verify.yml"') &&
    source.includes('--cert-identity ')
  ) {
    failures.push("proof-attestation-filters-mutually-exclusive");
  }
  requireText("proof-source-ref", '--source-ref "$GITHUB_REF"');
  requireText("proof-source-digest", '--source-digest "$GITHUB_SHA"');
  requireText("proof-signer-digest", '--signer-digest "$GITHUB_SHA"');
  requireText("proof-hosted-runner", "--deny-self-hosted-runners");
  requireText(
    "proof-content-verifier",
    "node scripts/production-verify-proof.mjs verify",
  );
  requireText(
    "proof-bound-deploy-checkout",
    "ref: ${{ needs.release-gate.outputs.verified_sha }}",
  );
  requireText(
    "proof-post-approval-revalidation",
    "name: Revalidate exact Verify proof after production approval",
  );
  requireText(
    "proof-post-approval-artifact-identity",
    'test "$REVALIDATED_ARTIFACT_ID" = "$EXPECTED_ARTIFACT_ID"',
  );
  requireText(
    "proof-post-approval-artifact-digest",
    'test "$REVALIDATED_ARTIFACT_DIGEST" = "$EXPECTED_ARTIFACT_DIGEST"',
  );
  const releaseGateStart = source.indexOf("  release-gate:");
  const deployJobStart = source.indexOf("  deploy:");
  const releaseGateBlock = releaseGateStart >= 0 && deployJobStart > releaseGateStart
    ? source.slice(releaseGateStart, deployJobStart)
    : "";
  if (!releaseGateBlock.includes("actions: read")) failures.push("proof-actions-read");
  if (!releaseGateBlock.includes("attestations: read")) {
    failures.push("proof-attestations-read");
  }
  if (!releaseGateBlock.includes("node scripts/production-verify-proof.mjs resolve")) {
    failures.push("proof-resolver");
  }
  const deployJobBlock = deployJobStart >= 0 ? source.slice(deployJobStart) : "";
  if (!deployJobBlock.includes("actions: read")) {
    failures.push("proof-revalidation-actions-read");
  }
  if (
    !deployJobBlock.includes("attestations: read") &&
    !deployJobBlock.includes("attestations: write")
  ) {
    failures.push("proof-revalidation-attestations-read");
  }
  for (const forbidden of [
    "npm ci",
    "pnpm --dir indexer",
    "npm run verify",
    "npm run db:test:pglite",
    "npm run contracts:verify:ci",
    "npm run contracts:slither",
  ]) {
    if (releaseGateBlock.includes(forbidden)) {
      failures.push(`proof-gate-repeats-${forbidden}`);
    }
  }
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
  requireText(
    "dark-release-config-input",
    "CUSTOM_LAUNCH_DARK_RELEASE_REQUESTED: ${{ inputs.custom_launch_dark_release }}",
  );
  requireText(
    "dark-release-policy-input",
    '--dark-release-requested "$CUSTOM_LAUNCH_DARK_RELEASE_REQUESTED"',
  );
  requireText("canonical-stage-name", "Stage programmable.market candidate");
  requireText(
    "canonical-rollback-target",
    '--target-url "https://programmable.market"',
  );
  requireText(
    "canonical-summary-target",
    'echo "- Target: $STAGED_TARGET_URL"',
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
  const v3RecordGateStart = source.indexOf(
    "      - name: Verify detached Custom Launch V3 release record",
  );
  const v3RecordGateEnd = source.indexOf(
    "      - name: Set up Fly CLI for read-only release verification",
    v3RecordGateStart,
  );
  const v3RecordGateBlock =
    v3RecordGateStart >= 0 && v3RecordGateEnd > v3RecordGateStart
      ? source.slice(v3RecordGateStart, v3RecordGateEnd)
      : "";
  const provenanceRequirements = [
    ["programmable-author-id", "commit.author?.id !== 309941960"],
    [
      "programmable-author-login",
      'commit.author?.login !== "programmable-infra"',
    ],
    ["programmable-committer-id", "commit.committer?.id !== 309941960"],
    [
      "programmable-committer-login",
      'commit.committer?.login !== "programmable-infra"',
    ],
    [
      "programmable-email-id",
      "^309941960\\+[A-Za-z0-9-]+@users\\.noreply\\.github\\.com$",
    ],
  ];
  for (const [lane, block] of [
    ["v1", recordGateBlock],
    ["v3", v3RecordGateBlock],
  ]) {
    for (const [id, text] of provenanceRequirements) {
      if (!block.includes(text)) failures.push(`record-${lane}-${id}`);
    }
  }
  if (!recordGateBlock.includes("commit.commit?.verification?.verified !== true")) {
    failures.push("record-v1-github-provenance");
  }
  if (
    !v3RecordGateBlock.includes(
      "commit.commit?.verification?.verified !== Boolean(true)",
    )
  ) {
    failures.push("record-v3-github-provenance");
  }
  requireText(
    "record-fixed-path",
    'record_path="release-records/custom-launch-v1/release-record.json"',
  );
  requireText(
    "record-verification-level-binding",
    "RECORD_VERIFICATION_LEVEL: ${{ steps.custom-launch-policy.outputs.release_record_verification_level }}",
  );
  requireText("record-verification-level-allowlist", "staging|dark-staging) ;;");
  requireText(
    "record-verification-level-argument",
    '--require "$RECORD_VERIFICATION_LEVEL"',
  );
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
  if (!recordGateBlock.includes(
    '--expect-detached-record-sha256 "$EXPECTED_RECORD_SHA256"',
  )) failures.push("record-digest-binding");
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
  const sourceBuildStart = source.indexOf(
    "      - name: Stage production source build without assigning domains",
  );
  const sourceBuildEnd = source.indexOf(
    "      - name: Resolve exact staged deployment",
  );
  const sourceBuildBlock =
    sourceBuildStart >= 0 && sourceBuildEnd > sourceBuildStart
      ? source.slice(sourceBuildStart, sourceBuildEnd)
      : "";
  if (!sourceBuildBlock.includes(
    "vercel deploy --prod --skip-domain --archive=tgz",
  )) failures.push("stage-skips-domain-assignment");
  if (source.includes("vercel build --prod") || source.includes("--prebuilt")) {
    failures.push("stage-must-build-source-on-vercel");
  }
  requireOrder(
    "record-after-rollback-capture",
    "Capture current production rollback target",
    "Verify detached Custom Launch release record",
  );
  requireOrder(
    "record-before-stage",
    "Verify detached Custom Launch release record",
    "Stage production source build without assigning domains",
  );
  requireOrder(
    "proof-before-production-configuration",
    "Verify Sigstore provenance and exact proof contents",
    "Pull production configuration",
  );
  requireOrder(
    "proof-revalidation-before-install",
    "Confirm consumed Verify proof identity after production approval",
    "Install dependencies",
  );
  requireText("candidate-canary", "Gate exact staged Custom Launch candidate");
  const candidateGateStart = source.indexOf(
    "      - name: Gate exact staged Custom Launch candidate",
  );
  const candidateGateEnd = source.indexOf(
    "      - name: Preserve redacted Custom Launch candidate evidence",
  );
  const candidateGateBlock =
    candidateGateStart >= 0 && candidateGateEnd > candidateGateStart
      ? source.slice(candidateGateStart, candidateGateEnd)
      : "";
  requireText(
    "candidate-canary-conditional",
    "id: custom-launch-canary\n        if: steps.custom-launch-policy.outputs.staging_mode == 'enabled'",
  );
  requireText(
    "candidate-canary-immutable-target",
    "STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}",
  );
  if (!candidateGateBlock.includes('"--deployment-id=$STAGED_DEPLOYMENT_ID"')) {
    failures.push("candidate-canary-deployment-binding");
  }
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
  const tokenImageProbeStart = source.indexOf(
    "      - name: Probe staged token image runtime without writes",
  );
  const tokenImageProbeEnd = source.indexOf(
    "      - name: Probe exact staged Custom Launch V3 release",
  );
  const tokenImageProbeBlock =
    tokenImageProbeStart >= 0 && tokenImageProbeEnd > tokenImageProbeStart
      ? source.slice(tokenImageProbeStart, tokenImageProbeEnd)
      : "";
  for (const [id, binding] of [
    ["token-image-probe-target", "STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}"],
    ["token-image-probe-route", '"/api/token-image"'],
    ["token-image-probe-method", 'method: "POST"'],
    ["token-image-probe-json", 'contentType !== "application/json"'],
    ["token-image-probe-status", "response.status !== 401"],
    ["token-image-probe-error", 'body.error !== "Connect your wallet and try again"'],
    ["token-image-probe-bounded", "readBoundedResponseText(response"],
  ]) {
    if (!tokenImageProbeBlock.includes(binding)) failures.push(id);
  }
  if (
    /(?:^|[{,\n])\s*["']?(?:authorization|cookie|x-privy-identity-token)["']?\s*:/iu
      .test(tokenImageProbeBlock)
    || /\n\s+"?body"?\s*:|new\s+(?:FormData|File)\b/iu
      .test(tokenImageProbeBlock)
  ) {
    failures.push("token-image-probe-must-not-send-upload-authority-or-content");
  }
  requireOrder(
    "token-image-probe-after-stage-resolution",
    "Resolve exact staged deployment",
    "Probe staged token image runtime without writes",
  );
  const darkGateStart = source.indexOf(
    "      - name: Gate exact staged dark Custom Launch candidate",
  );
  const darkGateEnd = source.indexOf(
    "      - name: Preserve redacted Custom Launch dark release evidence",
  );
  const darkGateBlock =
    darkGateStart >= 0 && darkGateEnd > darkGateStart
      ? source.slice(darkGateStart, darkGateEnd)
      : "";
  if (!darkGateBlock.includes("if: steps.custom-launch-policy.outputs.staging_mode == 'dark'")) {
    failures.push("dark-candidate-conditional");
  }
  for (const [id, binding] of [
    ["dark-candidate-disabled", "--require-disabled"],
    ["dark-candidate-evidence-output", "--dark-release-evidence-output=$evidence_path"],
    ["dark-candidate-deployment-binding", "--deployment-id=$STAGED_DEPLOYMENT_ID"],
    ["dark-candidate-record-subject", "--release-subject-sha256=$RELEASE_SUBJECT_SHA256"],
    ["dark-candidate-record-digest", "--detached-record-sha256=$DETACHED_RECORD_SHA256"],
    ["dark-candidate-attestation", "--cross-repository-attestation-commit-sha=$CROSS_REPOSITORY_ATTESTATION_COMMIT_SHA"],
    ["dark-candidate-binding-document", "--cross-repository-binding-document-sha256=$CROSS_REPOSITORY_BINDING_DOCUMENT_SHA256"],
  ]) {
    if (!darkGateBlock.includes(binding)) failures.push(id);
  }
  if (darkGateBlock.includes("--require-enabled")) {
    failures.push("dark-candidate-must-not-enable");
  }
  if (darkGateBlock.includes("--authenticated-canary")) {
    failures.push("dark-candidate-must-not-authenticate");
  }
  for (const secret of [
    "PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_ACCESS_TOKEN",
    "PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_IDENTITY_TOKEN",
  ]) {
    if (darkGateBlock.includes(secret)) failures.push(`dark-candidate-${secret.toLowerCase()}`);
  }
  requireText(
    "dark-candidate-evidence-artifact",
    "custom-launch-dark-release-${{ github.run_id }}-${{ github.run_attempt }}",
  );
  requireOrder(
    "dark-candidate-after-stage-resolution",
    "Resolve exact staged deployment",
    "Gate exact staged dark Custom Launch candidate",
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
    {
      releaseRecordRequired: false,
      releaseRecordVerificationLevel: "none",
      configuredEnablement: false,
      stagingMode: "generic-disabled",
    },
  );
  assert.deepEqual(
    resolveCustomLaunchStagingPolicy({
      requested: false,
      productionEnvSource: `${"PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED"}=\"false\"\n`,
      productionMode: "disabled",
    }),
    {
      releaseRecordRequired: false,
      releaseRecordVerificationLevel: "none",
      configuredEnablement: false,
      stagingMode: "generic-disabled",
    },
  );
});

test("dark release requires an explicit disabled record-bound dispatch", () => {
  assert.deepEqual(
    resolveCustomLaunchStagingPolicy({
      requested: "false",
      darkReleaseRequested: "true",
      productionEnvSource: "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=false\n",
      productionMode: "disabled",
    }),
    {
      releaseRecordRequired: true,
      releaseRecordVerificationLevel: "dark-staging",
      configuredEnablement: false,
      stagingMode: "dark",
    },
  );
  assert.throws(
    () => resolveCustomLaunchStagingPolicy({
      requested: "true",
      darkReleaseRequested: "true",
      productionEnvSource: "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=true\n",
      productionMode: "enabled",
    }),
    /mutually exclusive/,
  );
  for (const darkReleaseRequested of [null, "", "TRUE", "1"]) {
    assert.throws(() => resolveCustomLaunchStagingPolicy({
      requested: "false",
      darkReleaseRequested,
      productionEnvSource: "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=false\n",
      productionMode: "disabled",
    }));
  }
});

test("enabled production configuration requires an explicit matching dispatch", () => {
  assert.deepEqual(
    resolveCustomLaunchStagingPolicy({
      requested: "true",
      productionEnvSource: "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED='true'\n",
      productionMode: "enabled",
    }),
    {
      releaseRecordRequired: true,
      releaseRecordVerificationLevel: "staging",
      configuredEnablement: true,
      stagingMode: "enabled",
    },
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
    mutateWorkflowStep(
      source,
      "      - name: Verify detached Custom Launch release record",
      "      - name: Preserve detached Custom Launch release record",
      (step) => step.replaceAll("309941960", "0"),
    ),
    mutateWorkflowStep(
      source,
      "      - name: Verify detached Custom Launch V3 release record",
      "      - name: Set up Fly CLI for read-only release verification",
      (step) => step.replaceAll("309941960", "0"),
    ),
    source.replace(
      "if: steps.custom-launch-policy.outputs.release_record_required == 'true'",
      "if: always()",
    ),
    source.replace(
      '--require "$RECORD_VERIFICATION_LEVEL"',
      "--require clearance",
    ),
    source.replace("staging|dark-staging) ;;", "staging) ;;"),
    source.replace(
      '--dark-release-requested "$CUSTOM_LAUNCH_DARK_RELEASE_REQUESTED"',
      "",
    ),
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
    source.replaceAll('--env PROGRAMMABLE_RELEASE_COMMIT_SHA="$GITHUB_SHA"', ""),
    source.replace("--authenticated-canary", ""),
    source.replace("--require-disabled", ""),
    source.replace("--dark-release-evidence-output=$evidence_path", ""),
    source.replace("--release-subject-sha256=$RELEASE_SUBJECT_SHA256", ""),
    source.replace('"--deployment-id=$STAGED_DEPLOYMENT_ID"', ""),
    source.replace(
      "custom-launch-candidate-canary-${{ github.run_id }}-${{ github.run_attempt }}",
      "missing-candidate-artifact",
    ),
    source.replace(
      "custom-launch-dark-release-${{ github.run_id }}-${{ github.run_attempt }}",
      "missing-dark-release-artifact",
    ),
    source.replaceAll("--skip-domain", ""),
    source.replace(
      "vercel deploy --prod --skip-domain --archive=tgz",
      "vercel deploy --prebuilt --prod --skip-domain --archive=tgz",
    ),
    source.replace("response.status !== 401", "response.status !== 500"),
    source.replace(
      'accept: "application/json",',
      'accept: "application/json",\n              "Authorization": "Bearer unsafe",',
    ),
    source.replace('--source-digest "$GITHUB_SHA"', ""),
    source.replace('--signer-digest "$GITHUB_SHA"', ""),
    source.replace("--deny-self-hosted-runners", ""),
    source.replace("      attestations: read\n", ""),
    source.replace(
      "      attestations: write\n      contents: read\n      deployments: write",
      "      contents: read\n      deployments: write",
    ),
    source.replace("run-id: ${{ steps.resolve-proof.outputs.verify_run_id }}", ""),
    source.replace(
      'test "$REVALIDATED_ARTIFACT_DIGEST" = "$EXPECTED_ARTIFACT_DIGEST"',
      "",
    ),
    source.replace("digest-mismatch: error", "digest-mismatch: warn"),
    source.replace(
      "node scripts/production-verify-proof.mjs resolve",
      "node scripts/production-verify-proof.mjs verify",
    ),
    source.replace("workflow_dispatch:\n", "push:\n    branches: [production]\n"),
    source.replace(
      "https://programmable.market",
      "https://programmable.family",
    ),
    `${source}\n      - run: vercel promote "$DEPLOYMENT_URL"\n`,
  ];
  for (const [index, mutation] of mutations.entries()) {
    assert.notDeepEqual(workflowFailures(mutation), [], `mutation ${index} was not detected`);
  }
});
