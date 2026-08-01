import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertNoSecretOutput,
  buildBootstrapPlan,
  compareMigrationHistory,
  discoverMigrationPlan,
  safeFailure,
  validateDirectSupabaseTarget,
  validateMigrationPlan,
} from "./hosted-db-operator-core.mjs";

const COMMIT = "a".repeat(40);
const HASH = `0x${"1".repeat(64)}`;

async function fixture(files) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "db-operator-test-"));
  const root = path.join(workspace, "supabase", "migrations");
  await mkdir(root, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(root, name), contents);
  }
  return { workspace, root };
}

test("migration discovery includes every ordered current and later file", async (t) => {
  const { workspace } = await fixture({
    "20260731000200_second.sql": "select 2;\n",
    "20260731000100_first.sql": "select 1;\n",
    "20270101000000_later.sql": "select 3;\n",
  });
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverMigrationPlan({ workspace, repositoryCommit: COMMIT });
  assert.equal(plan.migrationCount, 3);
  assert.deepEqual(
    plan.migrations.map(({ version, ordinal }) => [version, ordinal]),
    [
      ["20260731000100", 1],
      ["20260731000200", 2],
      ["20270101000000", 3],
    ],
  );
  assert.equal(validateMigrationPlan(plan), plan);
});

test("migration discovery rejects noncanonical files and symlinks", async (t) => {
  const noncanonical = await fixture({ "1_bad.sql": "select 1;\n" });
  t.after(() => rm(noncanonical.workspace, { recursive: true, force: true }));
  await assert.rejects(
    discoverMigrationPlan({
      workspace: noncanonical.workspace,
      repositoryCommit: COMMIT,
    }),
    /noncanonical migration/u,
  );

  const linked = await fixture({
    "20260731000100_first.sql": "select 1;\n",
  });
  t.after(() => rm(linked.workspace, { recursive: true, force: true }));
  await symlink(
    path.join(linked.root, "20260731000100_first.sql"),
    path.join(linked.root, "20260731000200_link.sql"),
  );
  await assert.rejects(
    discoverMigrationPlan({ workspace: linked.workspace, repositoryCommit: COMMIT }),
    /regular file/u,
  );
});

test("reviewed plan commitment detects file and order tampering", async (t) => {
  const { workspace } = await fixture({
    "20260731000100_first.sql": "select 1;\n",
  });
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverMigrationPlan({ workspace, repositoryCommit: COMMIT });
  const tampered = structuredClone(plan);
  tampered.migrations[0].bytes += 1;
  assert.throws(() => validateMigrationPlan(tampered), /commitment/u);
});

test("direct target validation accepts only the expected 5432 endpoint", () => {
  const projectRef = "abcdefghijklmnopqrst";
  const target = validateDirectSupabaseTarget(
    `postgresql://postgres:private@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
    projectRef,
  );
  assert.deepEqual(target, {
    projectRef,
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    database: "postgres",
    sslMode: "verify-full",
  });
  assert.doesNotMatch(JSON.stringify(target), /private/u);
  assert.throws(
    () =>
      validateDirectSupabaseTarget(
        `postgresql://postgres:private@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
        projectRef,
      ),
    /direct Supabase endpoint/u,
  );
  assert.throws(
    () =>
      validateDirectSupabaseTarget(
        `postgresql://postgres:private@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
        projectRef,
      ),
    /direct Supabase endpoint/u,
  );
});

test("history verification is prefix-only and requires file evidence", async (t) => {
  const { workspace } = await fixture({
    "20260731000100_first.sql": "select 1;\n",
    "20260731000200_second.sql": "select 2;\n",
  });
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverMigrationPlan({ workspace, repositoryCommit: COMMIT });
  const first = plan.migrations[0];
  const state = compareMigrationHistory({
    plan,
    historyRows: [{ version: first.version, name: first.name, statements: ["select 1"] }],
    evidenceTablePresent: true,
    evidenceRows: [
      {
        version: first.version,
        name: first.name,
        file_name: path.posix.basename(first.file),
        ordinal: first.ordinal,
        file_sha256: first.fileSha256,
        plan_sha256: plan.planSha256,
        repository_commit: plan.repositoryCommit,
      },
    ],
  });
  assert.equal(state.status, "pending");
  assert.deepEqual(state.pending.map(({ version }) => version), [
    "20260731000200",
  ]);
  assert.throws(
    () =>
      compareMigrationHistory({
        plan,
        historyRows: [
          { version: first.version, name: first.name, statements: ["select 1"] },
        ],
        evidenceTablePresent: false,
        evidenceRows: [],
      }),
    /evidence is missing/u,
  );
  assert.throws(
    () =>
      compareMigrationHistory({
        plan,
        historyRows: [
          { version: plan.migrations[1].version, name: "second", statements: ["select 2"] },
        ],
        evidenceTablePresent: true,
        evidenceRows: [],
      }),
    /exact local prefix/u,
  );
});

test("bootstrap plan exposes exact binding facts and remains fail closed", () => {
  const binding = {
    schemaVersion: 1,
    chainId: 1,
    startBlock: 100,
    confirmations: 12,
    sources: [
      {
        contractName: "Launcher",
        address: `0x${"2".repeat(40)}`,
        startBlock: 101,
        runtimeCodeHash: HASH,
      },
    ],
    releases: [
      {
        model: "classic",
        releaseVersion: "classic-v1",
        activationBlock: 101,
        sourceContracts: ["Launcher"],
        dynamicContracts: [],
      },
    ],
  };
  const providers = ["envio_deployment", "rpc_provider", "rpc_provider", "uniswap_subgraph"].map(
    (providerType, index) => ({
      providerType,
      redactedIdentity: `provider-${index}`,
      deploymentCommitment: `0x${String(index + 2).repeat(64)}`,
      schemaCommitment: `0x${String(index + 6).repeat(64)}`,
    }),
  );
  const plan = buildBootstrapPlan({
    binding,
    bindingSha256: HASH,
    repositoryCommit: COMMIT,
    providers,
  });
  assert.equal(plan.execution.mode, "plan-only");
  assert.equal(plan.execution.ready, false);
  assert.deepEqual(plan.releases[0].scope, {
    chainId: 1,
    releaseId: "classic-v1",
    modelId: "classic",
    sourceGroup: "core",
  });
  assert.ok(
    plan.releases[0].sourceBindings[0].unresolved.includes(
      "abiEventSetCommitment",
    ),
  );
});

test("secret guard and safe failures do not echo credentials", () => {
  assert.throws(
    () => assertNoSecretOutput({ value: "top-secret" }, ["top-secret"]),
    /credential/u,
  );
  assert.equal(safeFailure(new Error("postgres://user:secret@example")), "operator failed");
  const postgresError = new Error("postgres://user:secret@example");
  postgresError.code = "42P01";
  assert.equal(safeFailure(postgresError), "operator failed (42P01)");
});
