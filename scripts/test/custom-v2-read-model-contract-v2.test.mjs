import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  canonicalJson,
  canonicalSha256,
  deriveGenericLaunchReadModelContractV2,
  readProtectedDerivationInput,
  sha256Bytes,
} from "../custom-v2-read-model-contract-v2.mjs";

const DIGEST = (label) => sha256Bytes(Buffer.from(label, "utf8"));

async function fixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "generic-v2-contract-"));
  const registrySource = {
    repositoryId: "101",
    repositoryFullName: "0xprogrammable/programmable",
    commit: "1".repeat(40),
    tree: "2".repeat(40),
  };
  const registryAddress = "0x845506084a1afb969fa4def444a2bdeee794aaad";
  const registryRuntimeCodeKeccak256 = `0x${"3".repeat(64)}`;
  const registryPolicyCommitment = `0x${"4".repeat(64)}`;
  const sourceArtifactSha256 = DIGEST("registry-source");
  const abiArtifactSha256 = DIGEST("registry-abi");
  const eventSetSha256 = DIGEST("registry-events");
  const registryDeployment = {
    schemaVersion: "programmable.custom-registry-v2-deployment.v1",
    status: "live",
    generation: "2",
    chainId: "1",
    caip2: "eip155:1",
    publicReadEnabled: true,
    indexingEnabled: true,
    registry: {
      address: registryAddress,
      runtimeCodeKeccak256: registryRuntimeCodeKeccak256,
      deploymentTransactionHash: `0x${"5".repeat(64)}`,
      deploymentBlock: "100",
      deploymentBlockHash: `0x${"6".repeat(64)}`,
    },
    release: {
      sourceCommit: registrySource.commit,
      sourceTree: registrySource.tree,
      sourceArtifactSha256,
      abiArtifactSha256,
      eventSetSha256,
    },
    finality: {
      minimumConfirmations: "12",
      policyBindingHash: registryPolicyCommitment,
    },
    profiles: {
      NoMarket0: { marketMode: 0, protocolFeeBps: 0 },
      Standard10: { marketMode: 1, protocolFeeBps: 10 },
    },
  };
  const files = {
    "app/api/custom-launch/generic/v2/launches/route.ts": "feed\n",
    "config/custom-registry-v2.deployment.prelaunch.json":
      `${JSON.stringify(registryDeployment)}\n`,
    "config/generic-launch-public.v2.schema.json": "schema\n",
    "lib/server/custom-launch/generic-launch-postgres-v2.ts": "persistence\n",
    "lib/server/custom-launch/generic-launch-projector-v2.ts": "projector\n",
    "lib/server/custom-launch/generic-launch-read-v2.ts": "reader\n",
    "ops/website-projection-target/migrations/0005_generic_launch_admission_v2.sql":
      "migration\n",
  };
  for (const [path, source] of Object.entries(files)) {
    await mkdir(dirname(join(repoRoot, path)), { recursive: true });
    await writeFile(join(repoRoot, path), source, "utf8");
  }
  const artifact = (path) => ({
    path,
    sha256: sha256Bytes(Buffer.from(files[path], "utf8")),
  });
  const websiteSource = {
    repositoryId: "101",
    repositoryFullName: "0xprogrammable/programmable",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
  };
  const input = {
    schemaVersion:
      "programmable.generic-launch-read-model-contract-derivation-input.v1",
    websiteSource,
    implementation: {
      artifacts: [
        artifact("lib/server/custom-launch/generic-launch-projector-v2.ts"),
        artifact("lib/server/custom-launch/generic-launch-read-v2.ts"),
      ],
    },
    persistence: {
      artifacts: [
        artifact("lib/server/custom-launch/generic-launch-postgres-v2.ts"),
        artifact(
          "ops/website-projection-target/migrations/0005_generic_launch_admission_v2.sql",
        ),
      ],
      hostedEvidence: {
        targetBindingHash: DIGEST("target"),
        migrationPlanSha256: DIGEST("plan"),
        executionEvidenceSha256: DIGEST("execution"),
        catalogSha256: DIGEST("catalog"),
        migratedThrough: "0005",
      },
    },
    queryContract: {
      artifacts: [
        artifact("app/api/custom-launch/generic/v2/launches/route.ts"),
        artifact("config/generic-launch-public.v2.schema.json"),
      ],
      feedPath: "/api/custom-launch/generic/v2/launches",
      detailPathTemplate:
        "/api/custom-launch/generic/v2/launches/{recordHash}",
      readinessPath: "/api/custom-launch/generic/v2/readiness",
    },
    approvalArtifactSchema: {
      status: "frozen",
      source: {
        repositoryId: "202",
        repositoryFullName: "0xprogrammable/programmable-open-hook-v2-internal",
        commit: "c".repeat(40),
        tree: "d".repeat(40),
      },
      schemaVersion:
        "programmable.approval-registry-v2-descriptor-binding.v2",
      domain: "programmable.approval-registry-descriptor-binding.v3",
      audience: "programmable.custom-registry.v2",
      artifact: {
        path: "services/autonomous-approval-v1/schemas/approval-registry-v2-descriptor-binding-v2.schema.json",
        sha256: DIGEST("approval-schema"),
      },
      handoffEvidenceSha256: DIGEST("approval-schema-handoff"),
    },
    approvalRelease: {
      status: "live",
      source: {
        repositoryId: "202",
        repositoryFullName: "0xprogrammable/programmable-open-hook-v2-internal",
        commit: "e".repeat(40),
        tree: "f".repeat(40),
      },
      packageArtifactSha256: DIGEST("approval-package"),
      aggregateReadinessBindingHash: DIGEST("approval-readiness"),
      artifactVerifierBindingHash: DIGEST("approval-verifier"),
      liveDeploymentEvidenceSha256: DIGEST("approval-live"),
    },
    registryProjection: {
      status: "live",
      source: registrySource,
      artifacts: [
        artifact("config/custom-registry-v2.deployment.prelaunch.json"),
        artifact("lib/server/custom-launch/generic-launch-projector-v2.ts"),
      ],
      deploymentArtifactSha256: artifact(
        "config/custom-registry-v2.deployment.prelaunch.json",
      ).sha256,
      sourceArtifactSha256,
      abiArtifactSha256,
      eventSetSha256,
      registryAddress,
      registryRuntimeCodeKeccak256,
      registryPolicyCommitment,
      minimumFinalityBlocks: "12",
      liveVerificationEvidenceSha256: DIGEST("registry-live"),
      sourceVerificationEvidenceSha256: DIGEST("registry-source-verification"),
    },
  };
  return { repoRoot, input, files };
}

test("derives all six content-addressed bindings and the runtime contract", async (t) => {
  const { repoRoot, input } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const result = await deriveGenericLaunchReadModelContractV2(input, { repoRoot });
  const again = await deriveGenericLaunchReadModelContractV2(
    JSON.parse(JSON.stringify(input)),
    { repoRoot },
  );

  assert.equal(canonicalJson(result), canonicalJson(again));
  assert.equal(result.contract.schemaVersion,
    "programmable.generic-launch-read-model-contract.v2");
  assert.equal(result.contract.sourceLane, "generic.finalized-launch-v2");
  assert.deepEqual(
    Object.keys(result.componentBindingHashes).sort(),
    [
      "approvalArtifactSchemaBindingHash",
      "approvalReleaseBindingHash",
      "implementationBindingHash",
      "persistenceBindingHash",
      "queryContractBindingHash",
      "registryProjectionBindingHash",
    ],
  );
  assert.equal(new Set(Object.values(result.componentBindingHashes)).size, 6);
  assert.equal(
    result.readModelBindingHash,
    canonicalSha256(result.contract.schemaVersion, result.contract),
  );
  assert.equal(
    result.derivationHash,
    canonicalSha256(result.schemaVersion, {
      schemaVersion: result.schemaVersion,
      websiteSource: result.websiteSource,
      components: result.components,
      componentBindingHashes: result.componentBindingHashes,
      contract: result.contract,
      readModelBindingHash: result.readModelBindingHash,
    }),
  );
});

test("fails closed while the Approval release handoff is unresolved", async (t) => {
  const { repoRoot, input } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  input.approvalRelease.status = "pending";
  input.approvalRelease.liveDeploymentEvidenceSha256 = null;
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(input, { repoRoot }),
    /Approval release|live deployment/u,
  );
});

test("rejects a local artifact whose bytes drift after review", async (t) => {
  const { repoRoot, input } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await writeFile(
    join(repoRoot, "lib/server/custom-launch/generic-launch-read-v2.ts"),
    "drift\n",
    "utf8",
  );
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(input, { repoRoot }),
    /artifact bytes do not match/u,
  );

  const linked = await fixture();
  t.after(() => rm(linked.repoRoot, { recursive: true, force: true }));
  const target = join(linked.repoRoot, "reader-target.ts");
  const path = join(
    linked.repoRoot,
    "lib/server/custom-launch/generic-launch-read-v2.ts",
  );
  await writeFile(target, "reader\n", "utf8");
  await rm(path);
  await symlink(target, path);
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(linked.input, {
      repoRoot: linked.repoRoot,
    }),
    /ELOOP|symbolic link/iu,
  );
});

test("rejects unsorted, duplicate and escaping artifact inventories", async (t) => {
  const { repoRoot, input } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  input.implementation.artifacts.reverse();
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(input, { repoRoot }),
    /unique and sorted/u,
  );

  const duplicate = (await fixture());
  t.after(() => rm(duplicate.repoRoot, { recursive: true, force: true }));
  duplicate.input.queryContract.artifacts.push(
    duplicate.input.queryContract.artifacts[1],
  );
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(duplicate.input, {
      repoRoot: duplicate.repoRoot,
    }),
    /unique and sorted/u,
  );

  const escaping = (await fixture());
  t.after(() => rm(escaping.repoRoot, { recursive: true, force: true }));
  escaping.input.implementation.artifacts[0].path = "../outside";
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(escaping.input, {
      repoRoot: escaping.repoRoot,
    }),
    /path is invalid/u,
  );
});

test("requires the exact live Registry deployment artifact in the closure", async (t) => {
  const { repoRoot, input } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  input.registryProjection.deploymentArtifactSha256 = DIGEST("other");
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(input, { repoRoot }),
    /deployment artifact is not in the projection closure/u,
  );

  const matrixDrift = await fixture();
  t.after(() => rm(matrixDrift.repoRoot, { recursive: true, force: true }));
  matrixDrift.input.registryProjection.sourceArtifactSha256 = DIGEST("drift");
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(matrixDrift.input, {
      repoRoot: matrixDrift.repoRoot,
    }),
    /does not match the live deployment config/u,
  );
});

test("binds generation-two routes and a clean exact Website checkout", async (t) => {
  const { repoRoot, input } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  input.queryContract.feedPath = "/api/custom-launch/generic/v1/launches";
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(input, { repoRoot }),
    /query paths are invalid/u,
  );

  const checkout = await fixture();
  t.after(() => rm(checkout.repoRoot, { recursive: true, force: true }));
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(checkout.input, {
      repoRoot: checkout.repoRoot,
      gitIdentity: () => ({ commit: "9".repeat(40), tree: "8".repeat(40) }),
    }),
    /does not match the checkout/u,
  );
});

test("reads only an owner-only content-addressed regular input file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "generic-v2-protected-input-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "input.json");
  const bytes = Buffer.from('{"schemaVersion":"example"}\n', "utf8");
  await writeFile(path, bytes, { mode: 0o600 });
  assert.deepEqual(
    await readProtectedDerivationInput(path, sha256Bytes(bytes)),
    { schemaVersion: "example" },
  );

  await assert.rejects(
    readProtectedDerivationInput(path, DIGEST("wrong")),
    /digest does not match/u,
  );
  await chmod(path, 0o644);
  await assert.rejects(
    readProtectedDerivationInput(path, sha256Bytes(bytes)),
    /owner-only regular file/u,
  );
  await chmod(path, 0o600);
  const link = join(root, "input-link.json");
  await symlink(path, link);
  await assert.rejects(
    readProtectedDerivationInput(link, sha256Bytes(bytes)),
    /ELOOP|symbolic link/iu,
  );
});
