import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  materializeCustomLaunchApiReleaseBindingV1,
} from "../generate-custom-launch-api-release-binding-v1.mjs";
import {
  createCustomLaunchV3RollbackConfigurationSnapshotV1,
  materializeCustomLaunchV3RollbackConfigurationSnapshotV1,
} from "../generate-custom-launch-v3-rollback-configuration-snapshot-v1.mjs";
import { canonicalize } from "../verify-custom-launch-release-record-v2.mjs";

const execFile = promisify(execFileCallback);
const runtimeMigrations = Object.freeze([
  "0001_custom_launch_api_private_schema_v1.sql",
  "0002_reserve_custom_launch_permit_nonce.sql",
  "0003_harden_custom_launch_api_limits_v1.sql",
  "0004_exact_source_verification_v1.sql",
  "0005_fee_enforced_launch_profile_v2.sql",
  "0006_public_launch_profile_rev3.sql",
  "0007_direct_native_hook_profile_v3.sql",
  "0008_direct_native_platform_admission_v3.sql",
]);
const supabaseMigrations = Object.freeze([
  "20260824110842_programmable_custom_launch_api_private_schema_v1.sql",
  "20260824112627_reserve_custom_launch_permit_nonce.sql",
  "20260824121433_harden_custom_launch_api_limits_v1.sql",
  "20260825053733_exact_source_verification_v1.sql",
  "20260825123910_fee_enforced_launch_profile_v2.sql",
  "20260825203306_public_launch_profile_rev3.sql",
  "20260826000538_direct_native_hook_profile_v3.sql",
  "20260826045034_direct_native_platform_admission_v3.sql",
]);
const apiRoutes = Object.freeze([
  Object.freeze({ method: "GET", path: "/v3/custom-launches" }),
  Object.freeze({ method: "GET", path: "/v3/custom-launches/{id}" }),
  Object.freeze({ method: "GET", path: "/v3/wallet-admin/custom-launches" }),
  Object.freeze({ method: "GET", path: "/v3/wallet-admin/custom-launches/{id}" }),
  Object.freeze({ method: "POST", path: "/v3/custom-launches" }),
  Object.freeze({
    method: "POST",
    path: "/v3/wallet-admin/custom-launches/{id}/funding-authorization",
  }),
]);
const chain = Object.freeze({
  chainId: "1",
  router: "0x1111111111111111111111111111111111111111",
  routerRuntimeCodeHash: `0x${"1".repeat(64)}`,
  graphFactory: "0x2222222222222222222222222222222222222222",
  graphFactoryRuntimeCodeHash: `0x${"2".repeat(64)}`,
  poolManager: "0x3333333333333333333333333333333333333333",
  poolManagerRuntimeCodeHash: `0x${"3".repeat(64)}`,
  permitAuthority: "0x4444444444444444444444444444444444444444",
  permitAuthorityRuntimeCodeHash: `0x${"4".repeat(64)}`,
});
const platformAdmissionPolicy = Object.freeze({
  schemaVersion: "programmable.direct-native-platform-admission-policy.v1",
  mode: "deterministic-exact-source-graph-static-baseline-v1",
  receiptSchemaVersion: "programmable.platform-admission-receipt.v1",
  engineId: "programmable.direct-native-static-admission",
  engineVersion: "1.0.0",
  exactSourceCompilerGraphBindingRequired: true,
  staticBaselineGateVersion: "1.0.0",
  blockingFindingRules: Object.freeze([
    Object.freeze({ code: "SOURCE_TARGET_ANALYSIS_INCOMPLETE", targetRoles: ["any"] }),
    Object.freeze({ code: "V4_CALLBACK_AUTHENTICATION_REVIEW_REQUIRED", targetRoles: ["hook"] }),
    Object.freeze({ code: "V4_ENABLED_CALLBACK_IMPLEMENTATION_MISSING", targetRoles: ["hook"] }),
    Object.freeze({ code: "SOURCE_MUTABLE_BLOCKLIST_SURFACE", targetRoles: ["token"] }),
    Object.freeze({ code: "SOURCE_MUTABLE_TRANSFER_RESTRICTION", targetRoles: ["token"] }),
    Object.freeze({ code: "SOURCE_PUBLIC_MINT_SURFACE", targetRoles: ["token"] }),
    Object.freeze({ code: "SOURCE_MUTABLE_PAUSE_SURFACE", targetRoles: ["token"] }),
    Object.freeze({ code: "SOURCE_MUTABLE_TAX_OR_FEE_SURFACE", targetRoles: ["token"] }),
    Object.freeze({ code: "SOURCE_PROXY_OR_UPGRADE_SURFACE", targetRoles: ["token", "hook"] }),
    Object.freeze({ code: "SOURCE_SELFDESTRUCT_SURFACE", targetRoles: ["token", "hook"] }),
    Object.freeze({ code: "RUNTIME_CALLCODE", targetRoles: ["token", "hook"] }),
    Object.freeze({ code: "RUNTIME_DELEGATECALL", targetRoles: ["token", "hook"] }),
    Object.freeze({ code: "RUNTIME_SELFDESTRUCT", targetRoles: ["token", "hook"] }),
  ]),
  warningDisposition: "bound-and-visible",
  noBlockingFindingDisposition: "router-simulation-eligible",
  blockingFindingDisposition: "action-required",
  routerSimulationRequiredBeforeAuthorization: true,
  receiptAuthority: "platform-only",
  assurance: "launch-admission-only",
  safetyClaim: false,
  feeBehaviorClaim: false,
});

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function prettySha256(value) {
  return sha256(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

async function json(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function initializeRepository(root, remote, branch) {
  await execFile("git", ["init", "--quiet", "--initial-branch", branch, root]);
  await execFile("git", ["-C", root, "config", "user.name", "Programmable Fixture"]);
  await execFile("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
  await execFile("git", ["-C", root, "remote", "add", "origin", remote]);
  await execFile("git", ["-C", root, "add", "."]);
  await execFile("git", ["-C", root, "commit", "--quiet", "--no-gpg-sign", "-m", "fixture"]);
  const [{ stdout: commit }, { stdout: tree }] = await Promise.all([
    execFile("git", ["-C", root, "rev-parse", "HEAD"]),
    execFile("git", ["-C", root, "rev-parse", "HEAD^{tree}"]),
  ]);
  return Object.freeze({ commit: commit.trim(), tree: tree.trim() });
}

async function releaseFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "programmable-v3-binding-generator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const websiteRoot = join(root, "website");
  const backendRoot = join(root, "backend");
  await json(join(websiteRoot, "public/openapi/custom-launch-v3.json"), {
    openapi: "3.1.0",
    info: { title: "fixture", version: "3.2.0" },
    "x-programmable-profile": {
      profileId: "programmable.direct-native-hook-graph.v1",
      profileVersion: "3.0.0",
      profileRevision: 3,
      productionLaunchAuthorized: true,
    },
  });
  await json(join(websiteRoot, "packages/launch/package.json"), {
    name: "@programmable/launch",
    version: "3.2.0",
  });
  const profile = {
    schemaVersion: "programmable.direct-native-hook-graph-admission-profile.v3",
    profileId: "programmable.direct-native-hook-graph.v1",
    profileVersion: "3.0.0",
    profileRevision: 3,
    productionLaunchAuthorized: true,
    platformAdmissionPolicy,
    chain,
  };
  const contract = {
    schemaVersion: "programmable.custom-launch-api-contract.v3",
    requestSchemaVersion: "programmable.custom-launch-create-request.v3",
    profileId: "programmable.direct-native-hook-graph.v1",
    profileVersion: "3.0.0",
    routes: apiRoutes,
  };
  await json(join(
    backendRoot,
    "services/custom-launch-api-v1/release/direct-native-hook-graph-admission-profile.v3.json",
  ), profile);
  await json(join(
    backendRoot,
    "services/custom-launch-api-v1/release/custom-launch-api-contract.v3.json",
  ), contract);
  const migrationBytes = [];
  for (let index = 0; index < runtimeMigrations.length; index += 1) {
    const bytes = Buffer.from(`-- exact migration ${index + 1}\nselect ${index + 1};\n`);
    migrationBytes.push(bytes);
    const runtimePath = join(
      backendRoot,
      "services/custom-launch-api-v1/migrations",
      runtimeMigrations[index],
    );
    const supabasePath = join(
      backendRoot,
      "services/custom-launch-api-v1/supabase/migrations",
      supabaseMigrations[index],
    );
    await mkdir(dirname(runtimePath), { recursive: true });
    await mkdir(dirname(supabasePath), { recursive: true });
    await writeFile(runtimePath, bytes);
    await writeFile(supabasePath, bytes);
  }
  const website = await initializeRepository(
    websiteRoot,
    "https://github.com/0xprogrammable/PROGRAMMABLE.git",
    "production",
  );
  const backend = await initializeRepository(
    backendRoot,
    "https://github.com/0xprogrammable/programmable-open-hook-v2-internal.git",
    "main",
  );
  const inventory = {
    schemaVersion: "programmable.custom-launch-api-migration-inventory.v1",
    migrations: runtimeMigrations.map((name, index) => ({
      path: `migrations/${name}`,
      sha256: sha256(migrationBytes[index]),
    })),
  };
  const readiness = {
    schemaVersion: "programmable.custom-launch-api-readiness.v2",
    status: "ready",
    service: "custom-launch-api-v1",
    sourceCommit: backend.commit,
    sourceTree: backend.tree,
    migrationInventorySha256: prettySha256(inventory),
    apiContractSha256: prettySha256(contract),
    publicProfile: {
      profileId: profile.profileId,
      profileVersion: profile.profileVersion,
      profileSha256: sha256(Buffer.from(canonicalize(profile), "utf8")),
      productionLaunchAuthorized: true,
    },
    chain,
  };
  const imageTag = `main-${backend.commit.slice(0, 12)}`;
  const imageDigest = `sha256:${"9".repeat(64)}`;
  const paths = {
    readiness: join(root, "readyz.json"),
    releases: join(root, "fly-releases.json"),
    machines: join(root, "fly-machines.json"),
    images: join(root, "fly-images.json"),
    migrationList: join(root, "supabase-migration-list.json"),
    databaseEvidence: join(root, "database-schema-evidence.json"),
  };
  await json(paths.readiness, readiness);
  await json(paths.releases, [{
    Version: 12,
    Status: "succeeded",
    ImageRef: `registry.fly.io/programmable-custom-launch-api:${imageTag}`,
  }]);
  await json(paths.machines, ["one", "two"].map((id) => ({
    id,
    state: "started",
    region: "fra",
    host_status: "ok",
    image_ref: {
      registry: "registry.fly.io",
      repository: "programmable-custom-launch-api",
      tag: imageTag,
      digest: imageDigest,
    },
  })));
  await json(paths.images, ["one", "two"].map((id) => ({
    MachineID: id,
    Registry: "registry.fly.io",
    Repository: "programmable-custom-launch-api",
    Tag: imageTag,
    Digest: imageDigest,
  })));
  await json(paths.migrationList, {
    message: "Finished supabase migration list.",
    migrations: supabaseMigrations.map((name) => ({
      local: name.split("_", 1)[0],
      remote: name.split("_", 1)[0],
      time: "2026-08-26 00:00:00",
    })),
  });
  return { root, websiteRoot, backendRoot, website, backend, readiness, paths };
}

test("binding generator derives exact revision 3 artifacts and retained database evidence", async (t) => {
  const fixture = await releaseFixture(t);
  const staleReadiness = structuredClone(fixture.readiness);
  staleReadiness.sourceTree = "a".repeat(40);
  await json(fixture.paths.readiness, staleReadiness);
  const input = {
    websiteRoot: fixture.websiteRoot,
    backendRoot: fixture.backendRoot,
    flyReleases: fixture.paths.releases,
    flyMachines: fixture.paths.machines,
    flyImages: fixture.paths.images,
    apiReadiness: fixture.paths.readiness,
    supabaseMigrationList: fixture.paths.migrationList,
    databaseSchemaEvidenceOutput: fixture.paths.databaseEvidence,
  };
  await assert.rejects(
    materializeCustomLaunchApiReleaseBindingV1(input),
    /readiness differs from the exact backend artifacts/u,
  );
  await json(fixture.paths.readiness, fixture.readiness);
  const result = await materializeCustomLaunchApiReleaseBindingV1(input);
  const bindingBytes = await readFile(result.outputPath);
  const binding = JSON.parse(bindingBytes);
  assert.equal(result.documentSha256, sha256(bindingBytes));
  assert.equal(binding.backend.candidateCommitSha, fixture.backend.commit);
  assert.equal(binding.backend.candidateTreeSha, fixture.backend.tree);
  assert.equal(binding.website.candidateCommitSha, fixture.website.commit);
  assert.equal(binding.website.candidateTreeSha, fixture.website.tree);
  assert.equal(binding.api.profileVersion, "3.0.0");
  assert.match(binding.api.publicProfilePath, /admission-profile\.v3\.json$/u);
  assert.equal(binding.fly.imageTag, `main-${fixture.backend.commit.slice(0, 12)}`);
  assert.equal(binding.fly.imageDigest, `sha256:${"9".repeat(64)}`);
  const databaseEvidenceBytes = await readFile(fixture.paths.databaseEvidence);
  const databaseEvidence = JSON.parse(databaseEvidenceBytes);
  assert.equal(binding.database.schemaEvidenceSha256, sha256(databaseEvidenceBytes));
  assert.equal(databaseEvidence.status, "passed");
  assert.equal(databaseEvidence.supabaseMigrationList.migrations.length, 8);
  assert.equal(databaseEvidence.mirrorByteChecks.length, 8);
  assert.ok(databaseEvidence.mirrorByteChecks.every((check) => check.byteEqual));
  assert.equal((await stat(result.outputPath)).mode & 0o777, 0o600);
  const beforeRetry = Buffer.from(bindingBytes);
  await assert.rejects(
    materializeCustomLaunchApiReleaseBindingV1(input),
    /repository is not clean|output already exists/u,
  );
  assert.deepEqual(await readFile(result.outputPath), beforeRetry);
});

test("rollback snapshot retains only exact deployment and env metadata", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "programmable-v3-rollback-generator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const productionBinding = {
    status: "verified",
    deploymentId: `dpl_${"a".repeat(24)}`,
    deploymentUrl: "https://launcher-old.vercel.app",
    gitHead: "b".repeat(40),
    targetUrl: "https://programmable.market/",
  };
  const environmentReadback = {
    envs: [
      {
        configurationId: null,
        createdAt: 2,
        key: "ZETA_SECRET",
        target: ["production"],
        type: "sensitive",
        updatedAt: 3,
        value: "must-never-be-retained",
      },
      {
        configurationId: null,
        createdAt: 1,
        key: "ALPHA_MODE",
        target: ["production"],
        type: "plain",
        updatedAt: 4,
      },
    ],
  };
  const snapshot = createCustomLaunchV3RollbackConfigurationSnapshotV1({
    productionBinding,
    environmentReadback,
  });
  assert.deepEqual(
    snapshot.environment.variables.map((entry) => entry.name),
    ["ALPHA_MODE", "ZETA_SECRET"],
  );
  assert.equal(JSON.stringify(snapshot).includes("must-never-be-retained"), false);
  assert.equal(JSON.stringify(snapshot).includes('"value"'), false);
  const bindingPath = join(root, "production-binding.json");
  const outputPath = join(root, "rollback-snapshot.json");
  await json(bindingPath, productionBinding);
  const result = await materializeCustomLaunchV3RollbackConfigurationSnapshotV1({
    productionBindingPath: bindingPath,
    outputPath,
    environmentReadback,
  });
  const outputBytes = await readFile(outputPath);
  assert.equal(result.configurationSnapshotSha256, sha256(outputBytes));
  assert.equal(outputBytes.includes("must-never-be-retained"), false);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  await assert.rejects(
    materializeCustomLaunchV3RollbackConfigurationSnapshotV1({
      productionBindingPath: bindingPath,
      outputPath,
      environmentReadback,
    }),
    /output already exists/u,
  );
  const duplicate = structuredClone(environmentReadback);
  duplicate.envs[1].key = duplicate.envs[0].key;
  assert.throws(
    () => createCustomLaunchV3RollbackConfigurationSnapshotV1({
      productionBinding,
      environmentReadback: duplicate,
    }),
    /duplicate names/u,
  );
});
