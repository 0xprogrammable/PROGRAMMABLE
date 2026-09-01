import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deploy = readFileSync(".github/workflows/deploy-production.yml", "utf8");
const standaloneReconcile = readFileSync(
  ".github/workflows/reconcile-generic-signer-probes.yml",
  "utf8",
);
const verify = readFileSync(".github/workflows/verify.yml", "utf8");
const proof = readFileSync("scripts/production-verify-proof.mjs", "utf8");
const stageGate = readFileSync("scripts/custom-v2-stage-gate.mjs", "utf8");
const signerProbeGate = readFileSync(
  "scripts/custom-v2-signer-probe-gate.mjs",
  "utf8",
);
const reconciler = readFileSync(
  "scripts/reconcile-generic-signer-probe-deployments.mjs",
  "utf8",
);
const boundedReader = readFileSync("scripts/read-bounded-response.mjs", "utf8");
function stepBlock(source, name) {
  const start = source.indexOf(`      - name: ${name}`);
  assert.notEqual(start, -1, `missing step ${name}`);
  const end = source.indexOf("\n      - name:", start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

test("Custom V2 production proof is a dedicated versioned protected lane", () => {
  assert.match(proof, /programmable\.production-verify-proof\.v4/u);
  assert.match(proof, /"custom_v2"/u);
  assert.match(
    proof,
    /id: "custom-v2", name: "Custom V2", scopeKey: "custom_v2"/u,
  );
  assert.match(verify, /^  custom-v2:$/mu);
  assert.match(
    verify,
    /name: Verify exact Custom V2 surface[\s\S]*npm run verify:custom-v2:ci/u,
  );
  const projectionDatabaseOperator = stepBlock(
    verify,
    "Verify exact Website projection database operator",
  );
  assert.match(projectionDatabaseOperator, /node --test/u);
  assert.match(
    projectionDatabaseOperator,
    /scripts\/website-projection-db-operator\.test\.mjs/u,
  );
  assert.match(
    projectionDatabaseOperator,
    /scripts\/website-projection-db-credential-rotation\.test\.mjs/u,
  );
  assert.match(
    verify,
    /name: Verify exact Generic V2 read-model contract derivation[\s\S]*node --test scripts\/test\/custom-v2-read-model-contract-v2\.test\.mjs/u,
  );
  assert.match(verify, /PRODUCTION_VERIFY_SCOPE_CUSTOM_V2:/u);
  assert.match(verify, /PRODUCTION_VERIFY_CUSTOM_V2_RESULT:/u);
  assert.match(verify, /verified Custom V2|CUSTOM_V2_RESULT/u);
});

test("manual Generic release verification runs the complete current Custom V2 tree", () => {
  assert.match(
    verify,
    /^  workflow_dispatch:[\s\S]*verification_mode:[\s\S]*custom-v2-release/mu,
  );
  const scope = stepBlock(verify, "Classify changed paths");
  assert.match(scope, /VERIFICATION_MODE:/u);
  assert.match(scope, /test "\$GITHUB_EVENT_NAME" = workflow_dispatch/u);
  assert.match(scope, /test "\$GITHUB_REF" = refs\/heads\/production/u);
  assert.match(scope, /classify-verify-paths\.mjs --custom-v2-release/u);
  assert.match(
    verify,
    /name: Bind production Verify proof[\s\S]*github\.event_name == 'workflow_dispatch'[\s\S]*inputs\.verification_mode == 'custom-v2-release'/u,
  );
  assert.match(proof, /verificationMode/u);
  assert.match(proof, /workflow_dispatch/u);
  assert.match(proof, /validateVerificationModeScope/u);
  assert.match(
    deploy,
    /PRODUCTION_VERIFY_MODE:[\s\S]*custom-v2-release[\s\S]*--verification-mode "\$PRODUCTION_VERIFY_MODE"/u,
  );
  assert.match(deploy, /--verification-mode "\$VERIFY_MODE"/u);
  assert.match(
    deploy,
    /--verification-mode "\$\{\{ needs\.release-gate\.outputs\.verification_mode \}\}"/u,
  );
});

test("trusted-base classification bootstraps Custom V2 without narrowing legacy lanes", () => {
  const block = stepBlock(verify, "Classify changed paths");
  assert.match(
    block,
    /git show "\$BASE_SHA:scripts\/ci\/classify-verify-paths\.mjs"/u,
  );
  assert.match(block, /if ! grep -Eq '\^custom_v2=\(true\|false\)\$'/u);
  assert.match(block, /echo 'custom_v2=true'/u);
  assert.match(block, /changing or narrowing any trusted-base legacy result/u);
});

test("Custom V2 stage expectations are explicit, observational, and default disabled", () => {
  for (const input of [
    "custom_v2_registry_live",
    "custom_v2_generic_public_read_enabled",
  ]) {
    assert.match(
      deploy,
      new RegExp(
        `${input}:[\\s\\S]{0,240}default: false[\\s\\S]{0,80}type: boolean`,
        "u",
      ),
    );
  }
  assert.match(deploy, /this does not change configuration/u);
  assert.match(deploy, /this does not activate them/u);
  assert.match(
    deploy,
    /verified_custom_v2: \$\{\{ steps\.verify-proof\.outputs\.verified_custom_v2 \}\}/u,
  );
  const gate = stepBlock(
    deploy,
    "Gate exact unaliased Custom V2 staged candidate",
  );
  assert.match(
    gate,
    /if: needs\.release-gate\.outputs\.verified_custom_v2 == 'true'/u,
  );
  assert.match(
    gate,
    /STAGED_DEPLOYMENT_ID: \$\{\{ steps\.staged-deployment\.outputs\.deployment_id \}\}/u,
  );
  assert.match(
    gate,
    /STAGED_TARGET_URL: \$\{\{ steps\.staged-deployment\.outputs\.target_url \}\}/u,
  );
  assert.match(gate, /EXPECTED_GIT_HEAD: \$\{\{ github\.sha \}\}/u);
  assert.match(
    gate,
    /vercel env run -e production --token="\$VERCEL_TOKEN" --/u,
  );
  assert.doesNotMatch(gate, /vercel env run --environment=production/u);
  assert.match(gate, /npm run probe:custom-v2:stage/u);
  assert.match(gate, /--registry-mode/u);
  assert.match(gate, /--generic-mode/u);
  assert.match(gate, /--authenticated-ingress-evidence-sha256/u);
  assert.doesNotMatch(gate, /echo .*AUTHENTICATED_INGRESS|set -x/u);
});

test("Custom V2 evidence is immutable while the workflow remains stage-only", () => {
  assert.match(
    deploy,
    /name: custom-v2-stage-evidence-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u,
  );
  assert.match(deploy, /retention-days: 90/u);
  const sourceBuild = stepBlock(
    deploy,
    "Stage production source build without assigning domains",
  );
  assert.match(
    sourceBuild,
    /vercel deploy --prod --skip-domain --archive=tgz/u,
  );
  assert.match(
    sourceBuild,
    /--env PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE=true/u,
  );
  assert.doesNotMatch(deploy, /vercel build --prod|--prebuilt/u);
  assert.doesNotMatch(
    deploy,
    /vercel (?:promote|rollback)|--scope-production-alias/u,
  );
  assert.match(deploy, /Stage-only: no production promotion was attempted\./u);
  assert.ok(
    deploy.indexOf("Resolve exact staged deployment") <
      deploy.indexOf("Gate exact unaliased Custom V2 staged candidate"),
  );
  assert.ok(
    deploy.indexOf("Gate exact unaliased Custom V2 staged candidate") <
      deploy.indexOf("Reverify staged candidate binding"),
  );
  const stablePreview = stepBlock(
    deploy,
    "Bind exact candidate to stable protected preview",
  );
  assert.match(
    stablePreview,
    /STABLE_PREVIEW_HOST: launcher-v4-aficialais-projects\.vercel\.app/u,
  );
  assert.match(stablePreview, /VERCEL_SCOPE: aficialais-projects/u);
  assert.match(stablePreview, /test "\$VERCEL_SCOPE" = aficialais-projects/u);
  assert.match(
    stablePreview,
    /vercel alias set "\$EXPECTED_DEPLOYMENT_ID" "\$STABLE_PREVIEW_HOST" \\\n+            --scope="\$VERCEL_SCOPE"/u,
  );
  assert.match(
    stablePreview,
    /vercel inspect "\$STABLE_PREVIEW_HOST" --format=json \\\n+            --scope="\$VERCEL_SCOPE"/u,
  );
  assert.match(
    stablePreview,
    /inspected\.id !== process\.env\.EXPECTED_DEPLOYMENT_ID/u,
  );
  assert.match(stablePreview, /inspected\.url !== expectedTarget\.hostname/u);
  assert.doesNotMatch(stablePreview, /inspected\.aliases/u);
  assert.match(
    stablePreview,
    /test "\$STABLE_PREVIEW_HOST" != programmable\.market/u,
  );
  assert.doesNotMatch(stablePreview, /\*\.vercel\.app/u);
  assert.equal(deploy.match(/vercel alias set/gu)?.length, 1);
  assert.doesNotMatch(deploy.replace(stablePreview, ""), /vercel alias/u);
  assert.ok(
    deploy.indexOf("Reverify staged candidate binding") <
      deploy.indexOf("Bind exact candidate to stable protected preview"),
  );
});

test("staging validates release policy and conditionally proves wake authentication", () => {
  const policy = stepBlock(deploy, "Validate staged read-model release policy");
  assert.match(policy, /id: read-model-policy/u);
  assert.match(policy, /npm run perf:read-model:deploy-policy --/u);
  assert.match(policy, /--env-file \.vercel\/\.env\.production\.local/u);
  assert.match(
    policy,
    /--sensitive-env-metadata "\$RUNNER_TEMP\/vercel-production-env-metadata\.json"/u,
  );
  assert.doesNotMatch(policy, /continue-on-error/u);

  const canary = stepBlock(
    deploy,
    "Verify staged QuickNode wake authentication",
  );
  assert.match(
    canary,
    /if: steps\.read-model-policy\.outputs\.wake_canary_required == 'true'/u,
  );
  assert.match(
    canary,
    /PROGRAMMABLE_QUICKNODE_STREAM_SECRET: \$\{\{ secrets\.PROGRAMMABLE_QUICKNODE_STREAM_SECRET \}\}/u,
  );
  assert.match(canary, /npm run perf:read-model:wake-canary --/u);
  assert.match(canary, /--target-url "\$STAGED_TARGET_URL"/u);
  assert.doesNotMatch(canary, /continue-on-error/u);
  assert.ok(
    deploy.indexOf("Resolve exact staged deployment") <
      deploy.indexOf("Verify staged QuickNode wake authentication"),
  );
});

test("every staged source build proves the token image runtime without a write", () => {
  const probe = stepBlock(
    deploy,
    "Probe staged token image runtime without writes",
  );
  assert.match(
    probe,
    /STAGED_TARGET_URL: \$\{\{ steps\.staged-deployment\.outputs\.target_url \}\}/u,
  );
  assert.match(probe, /"\/api\/token-image"/u);
  assert.match(probe, /method: "POST"/u);
  assert.match(probe, /contentType !== "application\/json"/u);
  assert.match(probe, /readBoundedResponseText\(response/u);
  assert.match(probe, /response\.status !== 401/u);
  assert.match(probe, /body\.error !== "Connect your wallet and try again"/u);
  assert.doesNotMatch(
    probe,
    /(?:^|[{,\n])\s*["']?(?:authorization|cookie|x-privy-identity-token)["']?\s*:/iu,
  );
  assert.doesNotMatch(probe, /\n\s+"?body"?\s*:|new\s+(?:FormData|File)\b/iu);
  assert.ok(
    deploy.indexOf("Resolve exact staged deployment") <
      deploy.indexOf("Probe staged token image runtime without writes"),
  );
});

test("Generic signer OIDC proof is one-shot, two-Machine and cleanup-attested", () => {
  for (const input of [
    "custom_v2_generic_signer_probe_expected_json",
    "custom_v2_generic_signer_probe_expected_sha256",
  ])
    assert.match(deploy, new RegExp(`${input}:`, "u"));
  const prepare = stepBlock(
    deploy,
    "Prepare one-shot Generic signer probe authority",
  );
  assert.match(prepare, /randomBytes\(32\)\.toString\("hex"\)/u);
  assert.match(prepare, /::add-mask::/u);
  assert.match(prepare, /generic-launch-read-stage-probe-operation\.v1/u);
  assert.match(prepare, /recoveryId/u);
  assert.doesNotMatch(prepare, /secret=.*GITHUB_OUTPUT/u);
  const preflight = stepBlock(
    deploy,
    "Reconcile all residual Generic signer probes before new authority",
  );
  assert.match(preflight, /--scope all-project-probes/u);
  assert.match(preflight, /reconcile-generic-signer-probe-deployments\.mjs/u);
  const operationRecord = stepBlock(
    deploy,
    "Preserve pre-mutation Generic signer probe operation record",
  );
  assert.match(operationRecord, /actions\/upload-artifact@043fb46/u);
  const probeDeploy = stepBlock(
    deploy,
    "Deploy one-shot unaliased Generic signer probe candidate",
  );
  assert.match(
    probeDeploy,
    /vercel deploy --prod --skip-domain --archive=tgz/u,
  );
  assert.match(probeDeploy, /PROGRAMMABLE_GENERIC_LAUNCH_SIGNER_PROBE_TOKEN/u);
  assert.match(
    probeDeploy,
    /PROGRAMMABLE_GENERIC_LAUNCH_SIGNER_PROBE_EXPECTED_V1_JSON/u,
  );
  assert.match(probeDeploy, /programmableGenericSignerProbeRecoveryId/u);
  assert.match(probeDeploy, /programmableGenericSignerProbe=one-shot-v1/u);
  assert.match(probeDeploy, /programmableRepositoryId=1314365508/u);
  const prove = stepBlock(
    deploy,
    "Prove both exact Generic signer Machines from Vercel OIDC",
  );
  assert.match(prove, /npm run probe:custom-v2:signer-stage/u);
  const reconciliation = stepBlock(
    deploy,
    "Reconcile every secret-bearing Generic signer probe deployment",
  );
  assert.match(reconciliation, /always\(\)/u);
  assert.match(
    reconciliation,
    /generic-signer-probe-authority\.outcome == 'success'/u,
  );
  assert.doesNotMatch(
    reconciliation,
    /generic-signer-probe-deploy\.outcome == 'success'/u,
  );
  assert.match(
    reconciliation,
    /reconcile-generic-signer-probe-deployments\.mjs/u,
  );
  const localCleanup = stepBlock(
    deploy,
    "Remove local Generic signer probe credential",
  );
  assert.match(localCleanup, /always\(\)/u);
  assert.match(localCleanup, /unlinkSync\(target\)/u);
  const clean = stepBlock(
    deploy,
    "Prove clean candidate carries no Generic signer probe authority",
  );
  assert.match(clean, /response\.status !== 503/u);
  assert.match(clean, /probe_unavailable/u);
  assert.match(clean, /readBoundedResponseText/u);
  assert.doesNotMatch(clean, /response\.(?:json|text)\(\)/u);
  const attest = stepBlock(
    deploy,
    "Attest canonical Generic signer probe cleanup bundle",
  );
  assert.match(
    attest,
    /actions\/attest@59d89421af93a897026c735860bf21b6eb4f7b26/u,
  );
  assert.match(attest, /create-storage-record: false/u);
  assert.match(
    deploy,
    /steps\.attest-generic-signer-probe-bundle\.outputs\.bundle-path/u,
  );
  assert.match(deploy, /attestations: write/u);
  assert.match(deploy, /id-token: write/u);
  assert.ok(
    deploy.indexOf(
      "Reconcile every secret-bearing Generic signer probe deployment",
    ) <
      deploy.indexOf("Stage production source build without assigning domains"),
  );
  assert.ok(
    deploy.indexOf(
      "Reconcile all residual Generic signer probes before new authority",
    ) < deploy.indexOf("Prepare one-shot Generic signer probe authority"),
  );
  assert.ok(
    deploy.indexOf(
      "Preserve pre-mutation Generic signer probe operation record",
    ) <
      deploy.indexOf(
        "Deploy one-shot unaliased Generic signer probe candidate",
      ),
  );
  assert.match(deploy, /^  generic-signer-probe-reconcile:$/mu);
  assert.match(
    deploy,
    /generic-signer-probe-reconcile:[\s\S]*needs: \[release-gate, deploy\][\s\S]*always\(\)[\s\S]*Delete every residual exact probe deployment and prove absence[\s\S]*reconcile-generic-signer-probe-deployments\.mjs/u,
  );
  assert.match(
    standaloneReconcile,
    /^name: Reconcile Generic Signer Probes$/mu,
  );
  assert.match(standaloneReconcile, /^  workflow_dispatch:$/mu);
  assert.match(standaloneReconcile, /github\.repository_id == 1314365508/u);
  assert.match(standaloneReconcile, /group: programmable-production/u);
  assert.match(standaloneReconcile, /cancel-in-progress: false/u);
  assert.match(standaloneReconcile, /environment:[\s\S]*name: production/u);
  assert.match(standaloneReconcile, /--scope all-project-probes/u);
  assert.match(
    standaloneReconcile,
    /reconcile-generic-signer-probe-deployments\.mjs/u,
  );
  assert.match(standaloneReconcile, /actions\/attest@59d89421/u);
  assert.doesNotMatch(
    standaloneReconcile,
    /PROGRAMMABLE_GENERIC_LAUNCH_SIGNER_PROBE_TOKEN/u,
  );
  assert.doesNotMatch(deploy, /vercel promote/u);
});

test("new stage and cleanup HTTP consumers share the bounded streaming reader", () => {
  assert.match(boundedReader, /headers\?\.get\?\.\("content-length"\)/u);
  assert.match(boundedReader, /body\?\.getReader\?\.\(\)/u);
  assert.match(boundedReader, /reader\.cancel/u);
  assert.match(boundedReader, /reader\.releaseLock\(\)/u);
  assert.match(boundedReader, /length > maximumBytes/u);
  assert.match(boundedReader, /Buffer\.alloc\(maximumBytes\)/u);
  assert.match(boundedReader, /bytes\.set\(value/u);
  assert.match(boundedReader, /chunkCount > MAXIMUM_CHUNKS/u);
  assert.doesNotMatch(boundedReader, /chunks\.push|Buffer\.concat/u);
  for (const source of [stageGate, signerProbeGate, reconciler]) {
    assert.match(source, /from "\.\/read-bounded-response\.mjs"/u);
    assert.match(source, /readBoundedResponseText/u);
  }
  const stagedJsonHelper = stageGate.slice(
    stageGate.indexOf("const requestJson ="),
    stageGate.indexOf("const manifestResult ="),
  );
  assert.doesNotMatch(stagedJsonHelper, /response\.(?:json|text)\(\)/u);
  assert.doesNotMatch(signerProbeGate, /response\.(?:json|text)\(\)/u);
  assert.doesNotMatch(reconciler, /response\.(?:json|text)\(\)/u);
});

test("every staged candidate proves the Envio catalog before public data smoke", () => {
  const probe = stepBlock(
    deploy,
    "Probe exact staged Envio Classic V3 catalog",
  );
  assert.match(probe, /VERCEL_AUTOMATION_BYPASS_SECRET:/u);
  assert.match(probe, /\/api\/explore\?limit=1&page=1&sort=newest/u);
  assert.match(probe, /catalog\?\.source === "envio-classic-v3"/u);
  assert.match(probe, /const classicCurrent =/u);
  assert.match(probe, /completeness\?\.classic === "current"/u);
  assert.match(probe, /const routerOnlyFallback =/u);
  assert.match(probe, /launchSource === "canonical-launch-stamp-router"/u);
  assert.match(probe, /completeness\?\.classic === "unavailable"/u);
  assert.match(
    probe,
    /routerStamp\.projectedIdentityCount === body\.catalog\.identityCount/u,
  );
  assert.match(probe, /const expectedEnvioLaunchSource =/u);
  assert.match(
    probe,
    /const expectedLaunchSource = routerOnlyFallback\s+\? "canonical-launch-stamp-router"\s+: expectedEnvioLaunchSource/u,
  );
  assert.match(probe, /classicCurrent \|\| routerOnlyFallback/u);
  assert.match(probe, /completeness\?\.stock === "excluded"/u);
  assert.match(probe, /completeness\?\.registryCustom === "current"/u);
  assert.match(probe, /routerCustomStatus === "last-known-good"/u);
  assert.match(
    probe,
    /envio-classic-v3\+registry\.custom-launched\+canonical-launch-stamp-router/u,
  );
  assert.match(probe, /expectedCustomStatus/u);
  assert.match(probe, /routerCustomAvailable/u);
  assert.doesNotMatch(probe, /tokens\[0\].*launchModel/u);
  assert.match(probe, /body\.total >= 1/u);
  assert.match(probe, /let exactCatalog = false/u);
  assert.match(probe, /attempt < 5/u);
  assert.match(probe, /response = undefined/u);
  assert.match(probe, /if \(attempt === 4\) throw error/u);
  assert.match(probe, /continue/u);
  assert.match(probe, /if \(exactCatalog\) \{/u);
  assert.doesNotMatch(probe, /CRON_SECRET|\/api\/ops\/index-v2/u);
  assert.doesNotMatch(probe, /\n        if:/u);

  const gmgnRequirement = stepBlock(
    deploy,
    "Resolve staged GMGN market requirement",
  );
  assert.notEqual(deploy.indexOf("Pull production configuration"), -1);
  assert.ok(
    deploy.indexOf("Pull production configuration") <
      deploy.indexOf("Resolve staged GMGN market requirement"),
  );
  assert.ok(
    deploy.indexOf("Resolve staged GMGN market requirement") <
      deploy.indexOf("Smoke staged static identity and Dex public APIs"),
  );
  assert.match(
    deploy,
    /VERCEL_ORG_ID: \$\{\{ secrets\.VERCEL_ORG_ID \}\}[\s\S]*VERCEL_PROJECT_ID: \$\{\{ secrets\.VERCEL_PROJECT_ID \}\}/u,
  );
  assert.doesNotMatch(deploy, /\bprj_[A-Za-z0-9]{8,128}\b/u);
  assert.match(
    gmgnRequirement,
    /vercel env ls production --format json --token="\$VERCEL_TOKEN" \|\n\s+node scripts\/bind-vercel-sensitive-production-metadata\.mjs \\\n\s+--metadata-file "\$metadata_file" \\\n\s+--vercel-project-id "\$VERCEL_PROJECT_ID"/u,
  );
  assert.match(
    gmgnRequirement,
    /node scripts\/bind-vercel-sensitive-production-metadata\.mjs/u,
  );
  assert.match(
    gmgnRequirement,
    /node scripts\/resolve-gmgn-production-requirement\.mjs/u,
  );
  assert.match(gmgnRequirement, /--metadata-file "\$metadata_file"/u);
  assert.doesNotMatch(
    gmgnRequirement,
    /\.vercel\/\.env\.production\.local|process\.env\.GMGN_API_KEY|set -x|console\.log/u,
  );
  assert.doesNotMatch(gmgnRequirement, /vercel env ls production[^\n]*>[^|]/u);
  assert.match(gmgnRequirement, /set -euo pipefail/u);
  assert.match(gmgnRequirement, /readonly require_gmgn_market/u);
  assert.equal(gmgnRequirement.match(/require_gmgn_market=/gu)?.length, 2);
  assert.doesNotMatch(gmgnRequirement, /continue-on-error:/u);
  assert.match(
    gmgnRequirement,
    /echo "require_gmgn_market=\$require_gmgn_market" >> "\$GITHUB_OUTPUT"/u,
  );
  assert.match(gmgnRequirement, /requireGmgnMarket/u);

  const smoke = stepBlock(
    deploy,
    "Smoke staged static identity and Dex public APIs",
  );
  assert.doesNotMatch(smoke, /\n        if:/u);
  assert.doesNotMatch(smoke, /continue-on-error:/u);
  assert.match(
    smoke,
    /node scripts\/smoke-static-dexscreener-public-apis\.mjs/u,
  );
  assert.match(smoke, /PROGRAMMABLE_REQUIRE_SHARD_ROUTER_TRADE: "true"/u);
  assert.match(
    smoke,
    /PROGRAMMABLE_REQUIRE_GMGN_MARKET: \$\{\{ steps\.gmgn-market-requirement\.outputs\.require_gmgn_market \}\}/u,
  );
  assert.equal(
    smoke.match(/smoke-static-dexscreener-public-apis\.mjs/gu)?.length,
    1,
  );
  assert.doesNotMatch(smoke, /node --input-type=module|bitquery|drpc/iu);
  assert.ok(
    deploy.indexOf("Probe exact staged Envio Classic V3 catalog") <
      deploy.indexOf("Smoke staged static identity and Dex public APIs"),
  );

  const handoff = stepBlock(deploy, "Record staged candidate handoff");
  for (const output of [
    "gmgn_account_gate_mode",
    "gmgn_requests_per_second",
    "discovery_status",
    "discovery_matched_count",
    "discovery_ranking_commitment",
    "analytics_summary_status",
    "analytics_holders_status",
    "analytics_traders_status",
    "market_cap_desc_source",
    "market_cap_desc_status",
    "market_cap_desc_gmgn_status",
    "market_cap_desc_matched_count",
    "market_cap_desc_ranking_commitment",
    "market_cap_asc_source",
    "market_cap_asc_status",
    "market_cap_asc_gmgn_status",
    "market_cap_asc_matched_count",
    "market_cap_asc_ranking_commitment",
  ]) {
    assert.match(
      deploy,
      new RegExp(
        `${output}: \\$\\{\\{ steps\\.public-provider-smoke\\.outputs\\.${output} \\}\\}`,
        "u",
      ),
    );
  }
  assert.match(
    handoff,
    /GMGN_MARKET_REQUIRED: \$\{\{ steps\.gmgn-market-requirement\.outputs\.require_gmgn_market \}\}/u,
  );
  assert.match(
    handoff,
    /GMGN_ACCOUNT_GATE_MODE: \$\{\{ steps\.public-provider-smoke\.outputs\.gmgn_account_gate_mode \}\}/u,
  );
  assert.match(
    handoff,
    /GMGN_REQUESTS_PER_SECOND: \$\{\{ steps\.public-provider-smoke\.outputs\.gmgn_requests_per_second \}\}/u,
  );
  assert.match(handoff, /GMGN market required by staged public smoke:/u);
  assert.match(handoff, /GMGN account gate mode:/u);
  assert.match(handoff, /Effective GMGN requests per second:/u);
  assert.match(
    handoff,
    /PREVIOUS_DEPLOYMENT_URL: \$\{\{ steps\.production-before\.outputs\.deployment_url \}\}/u,
  );
  assert.match(
    handoff,
    /READ_MODEL_POLICY_MODE: \$\{\{ steps\.read-model-policy\.outputs\.mode \}\}/u,
  );
  assert.match(
    handoff,
    /WAKE_CANARY_REQUIRED: \$\{\{ steps\.read-model-policy\.outputs\.wake_canary_required \}\}/u,
  );
  assert.match(handoff, /Candidate-only provider retry flag:/u);
  assert.match(
    handoff,
    /Launch identities: validated current Classic or bounded Router fallback/u,
  );
  assert.match(handoff, /Catalog mode:/u);
  assert.match(handoff, /Catalog progress block:/u);
  assert.match(handoff, /Catalog identity count:/u);
  assert.match(
    handoff,
    /MARKET_PROVIDER: \$\{\{ steps\.public-provider-smoke\.outputs\.market_provider \}\}/u,
  );
  assert.match(handoff, /Visible market provider:/u);
  assert.match(handoff, /Explore market read status:/u);
  assert.match(
    handoff,
    /DETAIL_MARKET_PROVIDER: \$\{\{ steps\.public-provider-smoke\.outputs\.detail_market_provider \}\}/u,
  );
  assert.match(handoff, /Token detail market provider:/u);
  assert.match(handoff, /Token detail smoke:/u);
  for (const output of [
    "discovery_status",
    "discovery_matched_count",
    "discovery_ranking_commitment",
    "analytics_summary_status",
    "analytics_holders_status",
    "analytics_traders_status",
  ]) {
    assert.match(
      handoff,
      new RegExp(`public-provider-smoke\\.outputs\\.${output}`, "u"),
    );
  }
  assert.match(handoff, /GMGN discovery ranking commitment:/u);
  assert.match(handoff, /GMGN analytics summary:/u);
  assert.match(handoff, /Descending market-cap ranking: source/u);
  assert.match(handoff, /Ascending market-cap ranking: source/u);
  assert.match(handoff, /SHARD trade adapter smoke:/u);
  assert.match(handoff, /Market chart smoke:/u);

  for (const retired of [
    "Resolve read-model release policy",
    "Attest exact staged release policy",
    "Preserve staged release attestation",
    "Record staged release attestation",
    "Refresh and prove exact staged durable read model",
    "Smoke staged public market APIs",
    "Gate exact staged operational health",
  ]) {
    assert.equal(deploy.includes("      - name: " + retired), false);
  }
});

test("the staged public smoke is a separate bounded script", () => {
  const source = readFileSync(
    "scripts/smoke-static-dexscreener-public-apis.mjs",
    "utf8",
  );
  assert.match(source, /readBoundedResponseText/u);
  assert.match(source, /response.status === 503 && attempt === 0/u);
  assert.match(source, /exactSamePageOrder\(highest, newest\)/u);
  assert.match(
    source,
    /exactVisibleMarketRead\(newest, newestTokens, validationNowMs\)/u,
  );
  assert.match(
    source,
    /exactMarketCapRanking\(\s*highest,\s*completeCatalogTokens,\s*"desc"/u,
  );
  assert.match(
    source,
    /sortMetric !==\s*"gmgn-market-cap\+gmgn-token-info-fdv\+dexscreener-fdv-fallback"/u,
  );
  assert.match(source, /exactDetailMarketRead\(/u);
  assert.match(source, /environment\.PROGRAMMABLE_REQUIRE_GMGN_MARKET/u);
  assert.match(source, /if \(requireGmgnMarket\)/u);
  assert.match(source, /exactGmgnDetailProof/u);
  assert.match(
    source,
    /qualifiedGmgnFdv\(candidate\.detailToken, now\(\)\.getTime\(\)\)/u,
  );
  assert.match(source, /VISIBLE_EXPLORE_PAGE_SIZE = 9/u);
  assert.match(source, /model=classic/u);
  assert.match(source, /exactGmgnEligibleCanonicalToken/u);
  assert.match(
    source,
    /marketProvider: newest\.headers\.get\("x-programmable-market-provider"\)/u,
  );
  assert.match(source, /marketReadStatus: newest\.body\.marketRead\.status/u);
  assert.match(source, /`market_provider=\$\{marketProvider\}`/u);
  assert.match(source, /`gmgn_account_gate_mode=\$\{gmgnAccountGateMode\}`/u);
  assert.match(
    source,
    /`gmgn_requests_per_second=\$\{gmgnRequestsPerSecond\}`/u,
  );
  assert.match(source, /`detail_market_provider=\$\{detailMarketProvider\}`/u);
  assert.doesNotMatch(
    source,
    /PROGRAMMABLE_WEBSITE_MAINNET_RPC|BITQUERY_API_KEY|runtimeProductionProviderEndpoints|readPrimaryRpc|readBitquery|fetchBitquery/iu,
  );
  assert.doesNotMatch(source, /https?:\/\/[^"'`]*(?:drpc|bitquery)/iu);
  assert.doesNotMatch(
    source,
    /\/api\/explore\/profile\/claim|\/api\/trade\/prepare/u,
  );
});
