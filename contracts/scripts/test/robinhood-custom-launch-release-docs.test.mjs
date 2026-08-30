import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function repositoryText(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("operator runbooks use repo-root commands and independently frozen provider commitments", async () => {
  const [
    security,
    handoff,
    commitmentHelper,
    packageBytes,
    ownerEnvelopeCore,
    postdeployment,
    releaseReadme,
    phaseACapture,
  ] = await Promise.all([
    repositoryText("contracts/security/ROBINHOOD-CUSTOM-LAUNCH.md"),
    repositoryText(
      "docs/operations/releases/custom-launch-v4/OWNER-WALLET-HANDOFF.md",
    ),
    repositoryText(
      "contracts/scripts/commit-robinhood-custom-launch-provider-endpoints.mjs",
    ),
    repositoryText("package.json"),
    repositoryText(
      "contracts/scripts/robinhood-custom-launch-owner-envelope-core.mjs",
    ),
    repositoryText(
      "docs/operations/releases/custom-launch-v4/POSTDEPLOYMENT.md",
    ),
    repositoryText("docs/operations/releases/custom-launch-v4/README.md"),
    repositoryText(
      "contracts/scripts/capture-robinhood-custom-launch-postdeployment.mjs",
    ),
  ]);
  const packageJson = JSON.parse(packageBytes);

  assert.match(
    security,
    /npm run contracts:robinhood:sourcify:review --/u,
  );
  assert.match(security, /forge script --root contracts/u);
  assert.doesNotMatch(security, /forge --root contracts/u);
  assert.doesNotMatch(security, /^forge verify-contract/gmu);
  assert.doesNotMatch(security, /^forge script(?! --root contracts)/gmu);
  assert.doesNotMatch(
    `${security}\n${handoff}`,
    /export ROBINHOOD_MAINNET_RPC_URL_(?:PRIMARY|SECONDARY)=['"]/u,
  );
  assert.doesNotMatch(
    `${security}\n${handoff}`,
    /--rpc-url\s+"\$ROBINHOOD_MAINNET_RPC_URL/u,
  );
  assert.match(
    handoff,
    /npm run --silent contracts:robinhood:provider-commitments/u,
  );
  assert.match(
    handoff,
    /ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY='<review-frozen-sha256-primary>'/u,
  );
  assert.match(
    handoff,
    /ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY='<review-frozen-sha256-secondary>'/u,
  );
  assert.match(handoff, /not review/u);
  assert.doesNotMatch(handoff, /reviewed-provider-commitments\.env/u);
  assert.doesNotMatch(
    handoff,
    /contracts:robinhood:provider-commitments\s*\\\s*\n\s*>/u,
  );
  assert.match(
    commitmentHelper,
    /ROBINHOOD_RPC_PROVIDER_COMMITMENTS_MATCH_REVIEW/u,
  );
  assert.match(commitmentHelper, /reviewedCount !== 2/u);
  assert.match(
    commitmentHelper,
    /role: "primary",\s+providerId: "quicknode"/u,
  );
  assert.doesNotMatch(commitmentHelper, /providerId: "drpc"/u);
  assert.match(
    ownerEnvelopeCore,
    /role: "primary",\s+providerId: "quicknode",\s+trustDomain: "quicknode\.com"/u,
  );
  assert.match(handoff, /Hood Explorer\s+Indexer/u);
  assert.match(handoff, /Programmable Production 3/u);
  assert.match(
    handoff,
    /sha256:c03afd37c077e78bea30f69d1ce139d026cb4fad86fa74122257bba8f5e9a910/u,
  );
  for (const historicalBoundary of [postdeployment, releaseReadme]) {
    assert.match(historicalBoundary, /historical Phase A/u);
    assert.match(historicalBoundary, /dRPC then\s+Alchemy/u);
    assert.match(historicalBoundary, /QuickNode[\s\S]*Programmable Production 3/u);
  }
  assert.match(
    phaseACapture,
    /collectL2\(endpoints\.l2\[0\], \{ role: "primary", providerId: "drpc"/u,
  );
  assert.match(
    phaseACapture,
    /collectL2\(endpoints\.l2\[1\], \{ role: "secondary", providerId: "alchemy"/u,
  );
  assert.doesNotMatch(security, /=<[^>]+>/u);
  assert.match(
    security,
    /contracts\/spec\/robinhood-custom-launch\/standard-json\//u,
  );
  assert.match(handoff, /second closing nonce\/vacancy snapshot/u);
  assert.doesNotMatch(
    security,
    /contracts:robinhood:postdeploy:(?:assemble|verify)\s/u,
  );

  for (const command of [
    "contracts:robinhood:bindings:verify",
    "contracts:robinhood:router-abi:verify",
    "contracts:robinhood:source-inputs:verify",
    "contracts:robinhood:provider-commitments",
    "contracts:robinhood:owner-envelope:refresh",
    "contracts:robinhood:owner-wallet-request:verify",
    "contracts:robinhood:sourcify:review",
    "contracts:robinhood:sourcify:submit",
    "contracts:robinhood:sourcify:recover",
    "contracts:robinhood:sourcify:test",
  ]) {
    assert.equal(typeof packageJson.scripts[command], "string", command);
  }
});

test("both no-CBOR providers remain outside the independent exact binding", async () => {
  const [security, postdeployment, capture, captureCore, finalizer, postdeployCore] =
    await Promise.all([
      repositoryText("contracts/security/ROBINHOOD-CUSTOM-LAUNCH.md"),
      repositoryText(
        "docs/operations/releases/custom-launch-v4/POSTDEPLOYMENT.md",
      ),
      repositoryText(
        "contracts/scripts/capture-robinhood-custom-launch-postdeployment.mjs",
      ),
      repositoryText("contracts/scripts/robinhood-custom-launch-capture-v2.mjs"),
      repositoryText(
        "contracts/scripts/finalize-robinhood-custom-launch-deployment.mjs",
      ),
      repositoryText(
        "contracts/scripts/robinhood-custom-launch-postdeploy-core.mjs",
      ),
    ]);

  for (const runbook of [security, postdeployment]) {
    assert.match(runbook, /PARTIAL_NO_CBOR_NOT_RELEASE_AUTHORITY/u);
    assert.match(runbook, /PARTIAL_NO_CBOR_EXACT_BYTES/u);
    assert.match(runbook, /Sourcify V2/u);
    assert.match(runbook, /appendCBOR=false/u);
    assert.match(runbook, /Cloudflare/u);
  }
  assert.match(postdeployment, /releaseAuthority=false/u);
  assert.match(postdeployment, /promotionRequirement=false/u);
  assert.match(
    postdeployment,
    /exactSourceAuthority=protected-hosted-build-finalized-transaction-bytecode/u,
  );
  assert.match(postdeployment, /must all be `match`/u);
  assert.match(postdeployment, /`exact_match` is rejected/u);
  assert.match(security, /git ls-remote origin refs\/heads\/production/u);
  assert.match(security, /externalActionPossible=true/u);
  assert.match(security, /directory-`fsync`/u);
  assert.match(postdeployment, /contracts:robinhood:sourcify:recover/u);
  assert.match(postdeployment, /GET-only/u);
  assert.doesNotMatch(
    `${security}\n${postdeployment}`,
    /Sourcify V2 exact (?:creation|match)/u,
  );
  assert.doesNotMatch(
    security,
    /Post-publication evidence must query both providers/u,
  );

  for (const authoritativeGate of [capture, captureCore, finalizer, postdeployCore]) {
    assert.doesNotMatch(authoritativeGate, /blockscout/iu);
  }
});
