import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RETIRED_ROBINHOOD_QUICKNODE_COMMITMENT_RECORD_BASENAME,
  ROBINHOOD_PROVIDER_COMMITMENT_RECORD_BASENAMES,
  readReviewedRobinhoodProviderCommitments,
} from "../robinhood-custom-launch-provider-commitment-custody.mjs";

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
    captureWorkflow,
    stageSchemaBytes,
    commitmentCustody,
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
    repositoryText(
      ".github/workflows/capture-robinhood-custom-launch-postdeployment.yml",
    ),
    repositoryText(
      "docs/operations/releases/custom-launch-v4/stage-bundle.schema.json",
    ),
    repositoryText(
      "contracts/scripts/robinhood-custom-launch-provider-commitment-custody.mjs",
    ),
  ]);
  const packageJson = JSON.parse(packageBytes);
  const stageSchema = JSON.parse(stageSchemaBytes);

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
  assert.match(handoff, /ROBINHOOD_CUSTODY_ROOT='\/absolute\/owner-only\//u);
  assert.doesNotMatch(handoff, /<review-frozen-sha256-(?:primary|secondary)>/u);
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
  for (const basename of ROBINHOOD_PROVIDER_COMMITMENT_RECORD_BASENAMES) {
    assert.ok(handoff.includes(basename));
    assert.ok(postdeployment.includes(basename));
    assert.ok(commitmentCustody.includes(`"${basename}"`));
  }
  assert.match(handoff, /retired generic QuickNode record[\s\S]*rejected/u);
  assert.ok(
    commitmentCustody.includes(
      `"${RETIRED_ROBINHOOD_QUICKNODE_COMMITMENT_RECORD_BASENAME}"`,
    ),
  );
  assert.match(
    handoff,
    /https:\/\/<HOOD_EXPLORER_INDEXER_ENDPOINT>\.robinhood-mainnet\.quiknode\.pro\/<TOKEN>\//u,
  );
  assert.match(handoff, /\.ethereum-mainnet\.quiknode\.pro` is rejected/u);
  assert.match(
    handoff,
    /sha256:c03afd37c077e78bea30f69d1ce139d026cb4fad86fa74122257bba8f5e9a910/u,
  );
  for (const phaseABoundary of [postdeployment, releaseReadme]) {
    assert.match(phaseABoundary, /Phase A[\s\S]*QuickNode[\s\S]*Alchemy/u);
    assert.match(phaseABoundary, /owner(?:-wallet)? action-time/iu);
    assert.match(phaseABoundary, /QuickNode[\s\S]*Programmable Production 3/u);
    assert.doesNotMatch(
      phaseABoundary,
      /historical Phase A[\s\S]{0,200}dRPC then\s+Alchemy/u,
    );
  }
  assert.match(
    phaseACapture,
    /collectL2\(endpoints\.l2\[0\], \{ role: "primary", providerId: "quicknode"/u,
  );
  assert.match(
    phaseACapture,
    /collectL2\(endpoints\.l2\[1\], \{ role: "secondary", providerId: "alchemy"/u,
  );
  assert.match(
    phaseACapture,
    /resolveReviewedRobinhoodProviderCommitments/u,
  );
  assert.match(commitmentCustody, /ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY/u);
  assert.match(
    phaseACapture,
    /assertRobinhoodCaptureL2EndpointCommitments/u,
  );
  for (const [runtimeVariable, commitmentSecret] of [
    [
      "ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY",
      "ROBINHOOD_MAINNET_QUICKNODE_RPC_COMMITMENT_PUBLIC_PRODUCTION_2FB6A4E",
    ],
    [
      "ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY",
      "ROBINHOOD_MAINNET_ALCHEMY_RPC_COMMITMENT_PUBLIC_PRODUCTION_2FB6A4E",
    ],
  ]) {
    assert.ok(
      captureWorkflow.includes(
        `${runtimeVariable}: \${{ secrets.${commitmentSecret} }}`,
      ),
    );
  }
  assert.doesNotMatch(
    captureWorkflow,
    /secrets\.ROBINHOOD_MAINNET_RPC_COMMITMENT_(?:PRIMARY|SECONDARY)/u,
  );
  assert.ok(
    stageSchema.$defs.captureClosure.required.includes(
      "l2ProviderEndpointCommitments",
    ),
  );
  assert.equal(
    stageSchema.$defs.captureClosure.properties
      .l2ProviderEndpointCommitments.uniqueItems,
    true,
  );
  assert.doesNotMatch(security, /=<[^>]+>/u);
  assert.match(
    security,
    /contracts\/spec\/robinhood-custom-launch\/standard-json\//u,
  );
  assert.match(
    handoff,
    /second closing\s+nonce\/balance\/fee\/code\/vacancy\/simulation\/gas snapshot/u,
  );
  assert.match(handoff, /two identical state-relevant snapshots/u);
  assert.match(handoff, /highest base fee, gas price and\s+priority fee/u);
  assert.match(handoff, /including exact `accessList: \[\]`/u);
  assert.match(handoff, /`accessList` is required and must be exactly `\[\]`/u);
  assert.match(handoff, /balance must cover the maximum debit/u);
  assert.match(
    handoff,
    /`2 \* pendingBaseFee \+ maxPriorityFeePerGas` formula/u,
  );
  assert.match(
    handoff,
    /Any funding insufficiency, fee-cap violation,\s+or state drift fails closed/u,
  );
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

test("provider commitment custody accepts only exact versioned records", async (t) => {
  const custodyRoot = await mkdtemp(
    path.join(os.homedir(), ".programmable-custody-test-"),
  );
  t.after(() => rm(custodyRoot, { recursive: true, force: true }));
  await chmod(custodyRoot, 0o700);
  const commitments = [`sha256:${"1".repeat(64)}`, `sha256:${"2".repeat(64)}`];
  await Promise.all(
    ROBINHOOD_PROVIDER_COMMITMENT_RECORD_BASENAMES.map(
      async (basename, index) => {
        const record = path.join(custodyRoot, basename);
        await writeFile(record, `${commitments[index]}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o400,
        });
        await chmod(record, 0o400);
      },
    ),
  );

  assert.deepEqual(
    await readReviewedRobinhoodProviderCommitments({
      custodyRoot,
      repositoryRoot,
    }),
    commitments,
  );
  await rm(
    path.join(custodyRoot, ROBINHOOD_PROVIDER_COMMITMENT_RECORD_BASENAMES[0]),
  );
  const retiredRecord = path.join(
    custodyRoot,
    RETIRED_ROBINHOOD_QUICKNODE_COMMITMENT_RECORD_BASENAME,
  );
  await writeFile(retiredRecord, `${commitments[0]}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o400,
  });
  await chmod(retiredRecord, 0o400);
  await assert.rejects(
    readReviewedRobinhoodProviderCommitments({
      custodyRoot,
      repositoryRoot,
    }),
    /retired generic QuickNode commitment record is forbidden/u,
  );
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
