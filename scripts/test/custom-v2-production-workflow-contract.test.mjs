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
  assert.match(proof, /id: "custom-v2", name: "Custom V2", scopeKey: "custom_v2"/u);
  assert.match(verify, /^  custom-v2:$/mu);
  assert.match(verify, /name: Verify exact Custom V2 surface[\s\S]*npm run verify:custom-v2:ci/u);
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
  assert.match(
    scope,
    /classify-verify-paths\.mjs --custom-v2-release/u,
  );
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
  assert.match(
    deploy,
    /--verification-mode "\$VERIFY_MODE"/u,
  );
  assert.match(
    deploy,
    /--verification-mode "\$\{\{ needs\.release-gate\.outputs\.verification_mode \}\}"/u,
  );
});

test("trusted-base classification bootstraps Custom V2 without narrowing legacy lanes", () => {
  const block = stepBlock(verify, "Classify changed paths");
  assert.match(block, /git show "\$BASE_SHA:scripts\/ci\/classify-verify-paths\.mjs"/u);
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
      new RegExp(`${input}:[\\s\\S]{0,240}default: false[\\s\\S]{0,80}type: boolean`, "u"),
    );
  }
  assert.match(deploy, /this does not change configuration/u);
  assert.match(deploy, /this does not activate them/u);
  assert.match(deploy, /verified_custom_v2: \$\{\{ steps\.verify-proof\.outputs\.verified_custom_v2 \}\}/u);
  const gate = stepBlock(deploy, "Gate exact unaliased Custom V2 staged candidate");
  assert.match(gate, /if: needs\.release-gate\.outputs\.verified_custom_v2 == 'true'/u);
  assert.match(gate, /STAGED_DEPLOYMENT_ID: \$\{\{ steps\.staged-deployment\.outputs\.deployment_id \}\}/u);
  assert.match(gate, /STAGED_TARGET_URL: \$\{\{ steps\.staged-deployment\.outputs\.target_url \}\}/u);
  assert.match(gate, /EXPECTED_GIT_HEAD: \$\{\{ github\.sha \}\}/u);
  assert.match(gate, /vercel env run --environment=production/u);
  assert.match(gate, /npm run probe:custom-v2:stage/u);
  assert.match(gate, /--registry-mode/u);
  assert.match(gate, /--generic-mode/u);
  assert.match(gate, /--authenticated-ingress-evidence-sha256/u);
  assert.doesNotMatch(gate, /echo .*AUTHENTICATED_INGRESS|set -x/u);
});

test("Custom V2 evidence is immutable while the workflow remains stage-only", () => {
  assert.match(deploy, /name: custom-v2-stage-evidence-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
  assert.match(deploy, /retention-days: 90/u);
  assert.match(deploy, /vercel deploy --prebuilt --prod --skip-domain/u);
  assert.doesNotMatch(deploy, /vercel (?:promote|rollback|alias)|--scope-production-alias/u);
  assert.match(deploy, /Stage-only: no production promotion was attempted\./u);
  assert.ok(
    deploy.indexOf("Resolve exact staged deployment")
      < deploy.indexOf("Gate exact unaliased Custom V2 staged candidate"),
  );
  assert.ok(
    deploy.indexOf("Gate exact unaliased Custom V2 staged candidate")
      < deploy.indexOf("Reverify staged candidate binding"),
  );
});

test("Generic signer OIDC proof is one-shot, two-Machine and cleanup-attested", () => {
  for (const input of [
    "custom_v2_generic_signer_probe_expected_json",
    "custom_v2_generic_signer_probe_expected_sha256",
  ]) assert.match(deploy, new RegExp(`${input}:`, "u"));
  const prepare = stepBlock(deploy, "Prepare one-shot Generic signer probe authority");
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
  assert.match(probeDeploy, /vercel deploy --prebuilt --prod --skip-domain/u);
  assert.match(probeDeploy, /PROGRAMMABLE_GENERIC_LAUNCH_SIGNER_PROBE_TOKEN/u);
  assert.match(probeDeploy, /PROGRAMMABLE_GENERIC_LAUNCH_SIGNER_PROBE_EXPECTED_V1_JSON/u);
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
  assert.match(reconciliation, /generic-signer-probe-authority\.outcome == 'success'/u);
  assert.doesNotMatch(reconciliation, /generic-signer-probe-deploy\.outcome == 'success'/u);
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
  assert.match(attest, /actions\/attest@59d89421af93a897026c735860bf21b6eb4f7b26/u);
  assert.match(attest, /create-storage-record: false/u);
  assert.match(
    deploy,
    /steps\.attest-generic-signer-probe-bundle\.outputs\.bundle-path/u,
  );
  assert.match(deploy, /attestations: write/u);
  assert.match(deploy, /id-token: write/u);
  assert.ok(
    deploy.indexOf("Reconcile every secret-bearing Generic signer probe deployment")
      < deploy.indexOf("Stage production build without assigning domains"),
  );
  assert.ok(
    deploy.indexOf("Reconcile all residual Generic signer probes before new authority")
      < deploy.indexOf("Prepare one-shot Generic signer probe authority"),
  );
  assert.ok(
    deploy.indexOf("Preserve pre-mutation Generic signer probe operation record")
      < deploy.indexOf("Deploy one-shot unaliased Generic signer probe candidate"),
  );
  assert.match(deploy, /^  generic-signer-probe-reconcile:$/mu);
  assert.match(
    deploy,
    /generic-signer-probe-reconcile:[\s\S]*needs: \[release-gate, deploy\][\s\S]*always\(\)[\s\S]*Delete every residual exact probe deployment and prove absence[\s\S]*reconcile-generic-signer-probe-deployments\.mjs/u,
  );
  assert.match(standaloneReconcile, /^name: Reconcile Generic Signer Probes$/mu);
  assert.match(standaloneReconcile, /^  workflow_dispatch:$/mu);
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
  assert.doesNotMatch(deploy, /vercel (?:promote|alias)/u);
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
  assert.match(probe, /completeness\?\.classic === "current"/u);
  assert.match(probe, /completeness\?\.stock === "excluded"/u);
  assert.match(
    probe,
    /completeness\?\.registryCustom === "current"/u,
  );
  assert.match(
    probe,
    /routerCustomStatus === "last-known-good"/u,
  );
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
  assert.match(probe, /if \(exactCatalog\) break/u);
  assert.doesNotMatch(probe, /CRON_SECRET|\/api\/ops\/index-v2/u);
  assert.doesNotMatch(probe, /\n        if:/u);

  const smoke = stepBlock(
    deploy,
    "Smoke staged static identity and Dex public APIs",
  );
  assert.doesNotMatch(smoke, /\n        if:/u);
  assert.match(
    smoke,
    /node scripts\/smoke-static-dexscreener-public-apis\.mjs/u,
  );
  assert.match(smoke, /PROGRAMMABLE_REQUIRE_SHARD_ROUTER_TRADE: "true"/u);
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
  assert.match(handoff, /Launch identities: validated Envio Classic V3 catalog/u);
  assert.match(handoff, /Envio catalog progress block:/u);
  assert.match(handoff, /Envio catalog identity count:/u);
  assert.match(
    handoff,
    /Market data provider: Dexscreener \(optional enrichment\)/u,
  );
  assert.match(handoff, /Explore market read status:/u);
  assert.match(handoff, /Token detail smoke:/u);
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
  assert.match(source, /marketProvider: "dexscreener"/u);
  assert.doesNotMatch(
    source,
    /PROGRAMMABLE_WEBSITE_MAINNET_RPC|BITQUERY_API_KEY|runtimeProductionProviderEndpoints|readPrimaryRpc|readBitquery|fetchBitquery/iu,
  );
  assert.doesNotMatch(source, /https?:\/\/[^"'`]*(?:drpc|bitquery)/iu);
  assert.doesNotMatch(source, /\/api\/explore\/profile\/claim|\/api\/trade\/prepare/u);
});
