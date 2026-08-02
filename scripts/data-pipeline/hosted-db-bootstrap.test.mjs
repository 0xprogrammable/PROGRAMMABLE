import assert from "node:assert/strict";
import test from "node:test";

import { createBootstrapPlan } from "./hosted-db-bootstrap-runtime.mjs";
import { validateReviewedBootstrapPlan } from "./bootstrap-evidence.mjs";
import { canonicalJson, sha256 } from "./hosted-db-operator-core.mjs";

const repositoryCommit = "561abe6a36caa0e9b5bc4ea20d10edca0f5401bc";
const createdAt = "2026-08-01T09:00:00.000Z";
const environment = Object.freeze({
  PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL:
    "https://eth-mainnet.g.alchemy.com/v2/abcdefgh",
  PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL:
    "https://example.quiknode.pro/abcdefgh",
});

test("builds a complete deterministic candidate-only bootstrap plan", async () => {
  const left = await createBootstrapPlan({
    repositoryCommit,
    environment,
    createdAt,
  });
  const right = await createBootstrapPlan({
    repositoryCommit,
    environment,
    createdAt,
  });
  assert.deepEqual(left, right);
  assert.equal(validateReviewedBootstrapPlan(left), left);
  assert.equal(left.execution.ready, true);
  assert.equal(left.execution.targetDatabaseMode, "candidate-only");
  assert.equal(
    left.providerBindings[0].redactedIdentity,
    "envio:production-7f24e63",
  );
  assert.equal(
    left.candidateIsolation.canonicalReleaseEnvioIdentity,
    left.providerBindings[0].redactedIdentity,
  );
  assert.equal(
    left.candidateIsolation.canonicalReleaseEnvioEndpoint,
    "https://indexer.hyperindex.xyz/d7a39a2/v1/graphql",
  );
  assert.equal(left.candidateIsolation.legacyProductionDeploymentRegistered, false);
  assert.equal(left.releases.length, 5);
  assert.equal(
    JSON.stringify(left).includes("unresolved"),
    false,
  );
  const classic = left.releases.find(
    ({ scope }) => scope.releaseId === "classic-v3",
  );
  assert.ok(classic);
  assert.equal(
    classic.sourceBindings.find(
      ({ sourceName }) => sourceName === "ClassicV3RewardVaultFactory",
    )?.sourceRole,
    "vault_factory",
  );
  const stock = left.releases.find(
    ({ scope }) => scope.releaseId === "stock-paired-v3",
  );
  assert.ok(stock);
  const stockTemplate = stock.dynamicSourceTemplates[0];
  assert.equal(stockTemplate.immutableBindingSpec.factoryConfigurationField, null);
  assert.deepEqual(
    [...new Set(
      stockTemplate.immutableBindingSpec.bindings
        .filter(({ source }) => source === "deferred_allocation_evidence")
        .map(({ evidenceRole }) => evidenceRole),
    )].sort(),
    ["beneficiary_count", "configuration_hash"],
  );
  for (const release of left.releases) {
    assert.equal(
      new Set(release.projectionEventRules.map(
        ({ sourceRole, eventType }) => `${sourceRole}\0${eventType}`,
      )).size,
      release.projectionEventRules.length,
    );
  }
});

test("rejects a bootstrap plan whose canonical release is not the candidate", async () => {
  const plan = await createBootstrapPlan({
    repositoryCommit,
    environment,
    createdAt,
  });
  const identity = structuredClone(plan);
  identity.candidateIsolation.canonicalReleaseEnvioIdentity =
    "envio:production-legacy";
  assert.throws(
    () => validateReviewedBootstrapPlan(recommit(identity)),
    /candidate database isolation is invalid/u,
  );

  const endpoint = structuredClone(plan);
  endpoint.candidateIsolation.canonicalReleaseEnvioEndpoint =
    "https://indexer.hyperindex.xyz/legacy1/v1/graphql";
  assert.throws(
    () => validateReviewedBootstrapPlan(recommit(endpoint)),
    /candidate initialization input drifted/u,
  );
});

function recommit(plan) {
  const payload = structuredClone(plan);
  delete payload.planSha256;
  plan.planSha256 = sha256(canonicalJson(payload));
  return plan;
}

test("rejects semantic role drift even after the outer plan is recommitted", async () => {
  const plan = await createBootstrapPlan({
    repositoryCommit,
    environment,
    createdAt,
  });
  const changed = structuredClone(plan);
  changed.releases[0].sourceBindings[0].sourceRole = "wrong";
  assert.throws(
    () => validateReviewedBootstrapPlan(recommit(changed)),
    /source commitment drifted/u,
  );
});

test("rejects recovery selector, ABI and creation-code evidence drift", async () => {
  const plan = await createBootstrapPlan({
    repositoryCommit,
    environment,
    createdAt,
  });
  const selector = structuredClone(plan);
  selector.releases[0].sourceBindings[1].recoverySelector = "0x00000000";
  assert.throws(
    () => validateReviewedBootstrapPlan(recommit(selector)),
    /source commitment drifted/u,
  );

  const abi = structuredClone(plan);
  abi.releases[0].sourceBindings[0].abiEventSetCommitment =
    `0x${"11".repeat(32)}`;
  assert.throws(
    () => validateReviewedBootstrapPlan(recommit(abi)),
    /source commitment drifted/u,
  );

  const creation = structuredClone(plan);
  creation.releases[1].dynamicSourceTemplates[0]
    .deployedArtifactCreationCodeHash = `0x${"22".repeat(32)}`;
  assert.throws(
    () => validateReviewedBootstrapPlan(recommit(creation)),
    /creation-code evidence drifted/u,
  );
});

test("rejects dynamic lineage, RPC endpoint and activation input drift", async () => {
  const plan = await createBootstrapPlan({
    repositoryCommit,
    environment,
    createdAt,
  });
  const dynamic = structuredClone(plan);
  dynamic.releases[1].dynamicSourceTemplates[0]
    .parentFactoryReleaseBindingId =
      dynamic.releases[1].sourceBindings[1].bindingId;
  assert.throws(
    () => validateReviewedBootstrapPlan(recommit(dynamic)),
    /dynamic source identity is invalid/u,
  );

  const rpc = structuredClone(plan);
  rpc.providerBindings[1].endpointUrlCommitment =
    `0x${"33".repeat(32)}`;
  assert.throws(
    () => validateReviewedBootstrapPlan(recommit(rpc)),
    /provider deterministic identity drifted/u,
  );

  const activation = structuredClone(plan);
  activation.releases[0].activation.nextGeneration = "2";
  assert.throws(
    () => validateReviewedBootstrapPlan(recommit(activation)),
    /activation input drifted/u,
  );
});

test("rejects release replay across canonical scopes", async () => {
  const plan = await createBootstrapPlan({
    repositoryCommit,
    environment,
    createdAt,
  });
  const replay = structuredClone(plan);
  [replay.releases[0], replay.releases[1]] = [
    replay.releases[1],
    replay.releases[0],
  ];
  replay.releases[0].ordinal = 1;
  replay.releases[1].ordinal = 2;
  assert.throws(
    () => validateReviewedBootstrapPlan(recommit(replay)),
    /release identity is invalid/u,
  );
});
