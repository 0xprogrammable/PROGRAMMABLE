import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

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
const exactTransportUnavailableMarketPhases =
  /\["market-core", "market-liquidity", "market-price"\]\.includes\(\s*marketRead\.phase,\s*\)/u;

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
  assert.match(
    verify,
    /name: Verify exact Website projection database operator[\s\S]*node --test scripts\/website-projection-db-operator\.test\.mjs/u,
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

test("Custom-only changes do not invoke the public data smoke", () => {
  const smoke = stepBlock(deploy, "Smoke staged Bitquery public APIs");
  assert.match(
    smoke,
    /if: >-[\s\S]*verified_custom_v2 != 'true'[\s\S]*verified_interface == 'true'[\s\S]*verified_read_model == 'true'/u,
  );
  assert.match(
    smoke,
    /\/api\/explore\?limit=20&page=1&sort=market-cap/u,
  );
  assert.match(smoke, /\/api\/explore\?limit=20&page=1&sort=newest/u);
  assert.match(smoke, /\/api\/explore\/token\?address=/u);
  assert.match(smoke, /\/api\/explore\/token\/chart\?address=/u);
  assert.match(smoke, /\/api\/explore\/profile\?account=/u);
  assert.match(
    smoke,
    /const requestUrl = new URL\(path, target\);[\s\S]*for \(let attempt = 0; attempt < 2; attempt \+= 1\) \{[\s\S]*const response = await fetch\(requestUrl, \{[\s\S]*if \(response\.status === 503 && attempt === 0\) continue;[\s\S]*if \(!response\.ok\)/u,
  );
  assert.match(
    smoke,
    /response\.status === 200[\s\S]*retryWhen\?\.\(result\) === true/u,
  );
  assert.match(
    smoke,
    /token\.valuation\.freshness === "current"[\s\S]*\["market-cap", "market-cap-asc"\]\.includes\(expectedSort\)[\s\S]*response\.body\?\.sort === expectedSort/u,
  );
  assert.match(
    smoke,
    /sort=market-cap",\s*\(response\) =>\s*emptyCurrentBitqueryFdvRanking\(response, "market-cap"\),/u,
  );
  assert.equal(smoke.match(/emptyCurrentBitqueryFdvRanking/gu)?.length, 2);
  assert.match(smoke, /id: public-provider-smoke/u);
  assert.match(smoke, /highest\.status !== 200/u);
  assert.match(smoke, /newest\.status !== 200/u);
  assert.match(
    smoke,
    /response\.body\?\.page === 1[\s\S]*response\.body\?\.pageSize === 20[\s\S]*tokens\.length === Math\.min\(20, total\)[\s\S]*totalPages === Math\.ceil\(total \/ 20\)/u,
  );
  assert.match(smoke, /exactExplorePage\(highest, highestTokens\)/u);
  assert.match(smoke, /exactExplorePage\(newest, newestTokens\)/u);
  assert.match(
    smoke,
    /function exactCurrentLaunchIdentity\(response\)[\s\S]*launchIdentity\?\.status === "current"[\s\S]*launchIdentity\.canonical === "current"[\s\S]*launchIdentity\.custom === "current"[\s\S]*Number\.isSafeInteger\(launchIdentity\.ageMs\)[\s\S]*launchIdentity\.ageMs >= 0[\s\S]*launchIdentity\.ageMs < 60_000[\s\S]*positiveInteger\.test\(String\(launchIdentity\.asOfBlock \?\? ""\)\)[\s\S]*String\(launchIdentity\.referenceBlock \?\? ""\)/u,
  );
  assert.match(smoke, /!exactCurrentLaunchIdentity\(highest\)/u);
  assert.match(smoke, /!exactCurrentLaunchIdentity\(newest\)/u);
  assert.match(
    smoke,
    /function exactExploreIdentity\(token\)[\s\S]*function exactDegradedLaunchOrder\([\s\S]*highest\.body\?\.total !== newest\.body\?\.total[\s\S]*highestTokens\.length !== newestTokens\.length[\s\S]*new Set\(highestIdentities\)\.size === highestIdentities\.length[\s\S]*identity === newestIdentities\[index\]/u,
  );
  assert.match(
    smoke,
    /!exactDegradedLaunchOrder\(\s*highest,\s*highestTokens,\s*newest,\s*newestTokens,\s*\)/u,
  );
  assert.match(
    smoke,
    /\["current", "transport-unavailable"\]\.includes\([\s\S]*newestMarketReadStatus !== highestMarketReadStatus/u,
  );
  assert.match(
    smoke,
    /if \(marketReadStatus === "current"\)[\s\S]*exactCurrentExploreSources\(highest\)[\s\S]*Highest FDV returned no Bitquery valuation[\s\S]*\/api\/explore\/token\?address=[\s\S]*\/api\/explore\/token\/chart\?address=/u,
  );
  assert.match(
    smoke,
    /x-programmable-read-source"\) === "drpc"[\s\S]*x-programmable-data-quality"\) === "partial"[\s\S]*x-programmable-market-read-status"\) ===[\s\S]*"transport-unavailable"[\s\S]*x-programmable-market-provider"\) ===[\s\S]*"bitquery"/u,
  );
  assert.match(
    smoke,
    /!response\.headers\.has\("x-programmable-market-source"\)[\s\S]*!response\.headers\.has\("x-programmable-price-source"\)[\s\S]*!response\.headers\.has\("x-programmable-market-as-of"\)/u,
  );
  assert.match(
    smoke,
    /marketRead\?\.provider === "bitquery"[\s\S]*marketRead\.status === "unavailable"[\s\S]*marketRead\.category === "transport"/u,
  );
  assert.match(smoke, exactTransportUnavailableMarketPhases);
  assert.match(
    smoke,
    /valuation\?\.status === "unavailable"[\s\S]*valuation\.available === 0[\s\S]*valuation\.unavailable === tokens\.length[\s\S]*tokens\.every\(exactUnavailableValuation\)/u,
  );
  assert.match(
    smoke,
    /ranking\?\.status === "unavailable"[\s\S]*ranking\.requested === "fdv"[\s\S]*ranking\.applied === "launch-order"[\s\S]*: ranking === undefined/u,
  );
  assert.match(
    smoke,
    /detailStatus = "skipped-provider-unavailable"[\s\S]*chartStatus = "skipped-provider-unavailable"[\s\S]*const profileToken =/u,
  );
  assert.match(
    smoke,
    /"market_read_status=" \+ marketReadStatus[\s\S]*"detail_status=" \+ detailStatus[\s\S]*"chart_status=" \+ chartStatus/u,
  );
  assert.match(
    smoke,
    /x-programmable-launch-source"\) ===[\s\S]*"drpc"/u,
  );
  assert.match(
    smoke,
    /x-programmable-read-source"\) ===[\s\S]*"drpc\+bitquery"/u,
  );
  assert.match(
    smoke,
    /x-programmable-market-source"\) ===[\s\S]*"bitquery"/u,
  );
  assert.match(
    smoke,
    /profile\.headers\.get\("x-programmable-launch-source"\) !== "drpc"/u,
  );
  assert.match(
    smoke,
    /profile\.headers\.get\("x-programmable-read-source"\) !== "drpc"/u,
  );
  assert.match(
    smoke,
    /profile\.headers\.get\("x-programmable-rpc-provider"\) !==[\s\S]*"drpc-primary"/u,
  );
  assert.match(smoke, /verified-staged-drpc-bitquery-public-apis/u);
  assert.match(smoke, /creatorClaimPrepare: "separate-live-probe-required"/u);
  assert.match(smoke, /tradePrepare: "separate-live-probe-required"/u);
  assert.doesNotMatch(smoke, /\/api\/explore\/profile\/claim/u);
  assert.doesNotMatch(smoke, /\/api\/trade\/prepare/u);
  assert.doesNotMatch(smoke, /method:\s*"POST"/u);

  const handoff = stepBlock(deploy, "Record staged candidate handoff");
  assert.match(
    handoff,
    /MARKET_READ_STATUS: \$\{\{ steps\.public-provider-smoke\.outputs\.market_read_status \}\}/u,
  );
  assert.match(handoff, /Explore market read status:/u);
  assert.match(handoff, /Token detail smoke:/u);
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
    assert.equal(deploy.includes(`      - name: ${retired}`), false);
  }
});

test("the staged transport contract rejects removal of exact-pool liquidity", () => {
  const smoke = stepBlock(deploy, "Smoke staged Bitquery public APIs");
  const mutated = smoke.replace('"market-liquidity", ', "");
  assert.notEqual(mutated, smoke);
  assert.doesNotMatch(mutated, exactTransportUnavailableMarketPhases);
});

test("degraded Highest must match the exact Newest launch identity order", () => {
  const smoke = stepBlock(deploy, "Smoke staged Bitquery public APIs");
  const helperStart = smoke.indexOf("function exactExploreIdentity(token)");
  const helperEnd = smoke.indexOf(
    "function exactUnavailableValuation(token)",
    helperStart,
  );
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  const helperSource = smoke.slice(helperStart, helperEnd);
  const exactDegradedLaunchOrder = runInNewContext(
    `(() => {\n${helperSource}\nreturn exactDegradedLaunchOrder;\n})()`,
    { address: /^0x[0-9a-f]{40}$/u },
  );
  const canonicalAddress = `0x${"1".repeat(40)}`;
  const canonical = {
    exploreKind: "token",
    id: `1:${canonicalAddress}`,
    tokenAddress: canonicalAddress,
  };
  const custom = {
    exploreKind: "custom-project",
    id: "custom:reviewer-p1",
    customProjectId: `sha256:${"2".repeat(64)}`,
    customLaunchId: `sha256:${"3".repeat(64)}`,
  };
  const page = {
    body: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
  };

  assert.equal(
    exactDegradedLaunchOrder(page, [canonical, custom], page, [canonical, custom]),
    true,
  );
  assert.equal(
    exactDegradedLaunchOrder(page, [custom, canonical], page, [canonical, custom]),
    false,
    "a reordered degraded Highest page must be rejected",
  );
  assert.equal(
    exactDegradedLaunchOrder(
      { body: { ...page.body, total: 3, totalPages: 1 } },
      [canonical, custom],
      page,
      [canonical, custom],
    ),
    false,
    "mismatched page totals must be rejected",
  );
  assert.equal(
    exactDegradedLaunchOrder(page, [canonical, canonical], page, [canonical, canonical]),
    false,
    "duplicate launch identities must be rejected",
  );
});
