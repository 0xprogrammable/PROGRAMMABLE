#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createBootstrapPlan } from "./hosted-db-bootstrap-runtime.mjs";
import {
  assertNoSecretOutput,
  discoverMigrationPlan,
  safeFailure,
  validateMigrationPlan,
} from "./hosted-db-operator-core.mjs";
import { validateReviewedBootstrapPlan } from "./bootstrap-evidence.mjs";
import {
  applyReviewedBootstrap,
  applyPendingMigrations,
  closeHostedDatabase,
  inspectBootstrapState,
  inspectMigrationState,
  openHostedDatabase,
} from "./hosted-db-postgres.mjs";

const run = promisify(execFile);
const workspace = fileURLToPath(new URL("../../", import.meta.url));

const HELP = `Usage:
  node scripts/data-pipeline/hosted-db-operator.mjs plan [--output FILE]
  node scripts/data-pipeline/hosted-db-operator.mjs dry-run --plan FILE --expected-project-ref REF
  node scripts/data-pipeline/hosted-db-operator.mjs verify --plan FILE --expected-project-ref REF
  node scripts/data-pipeline/hosted-db-operator.mjs apply --plan FILE --expected-project-ref REF --confirm-apply PLAN_SHA256
  node scripts/data-pipeline/hosted-db-operator.mjs bootstrap-plan [--output FILE]
  node scripts/data-pipeline/hosted-db-operator.mjs bootstrap-dry-run --plan FILE --expected-project-ref REF
  node scripts/data-pipeline/hosted-db-operator.mjs bootstrap-verify --plan FILE --expected-project-ref REF
  node scripts/data-pipeline/hosted-db-operator.mjs bootstrap-apply --plan FILE --expected-project-ref REF --confirm-apply PLAN_SHA256

Database credentials are accepted only through PROGRAMMABLE_MIGRATOR_DATABASE_URL.
The CA certificate is accepted only through PROGRAMMABLE_POSTGRES_SSL_CA_PEM.
`;

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    return { command: "help", flags: new Map() };
  }
  const flags = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("operator arguments are invalid");
    }
    if (flags.has(flag)) throw new Error("operator argument is duplicated");
    flags.set(flag, value);
  }
  return { command, flags };
}

function exactFlags(flags, allowed) {
  for (const flag of flags.keys()) {
    if (!allowed.includes(flag)) throw new Error("operator argument is not allowed");
  }
}

async function gitCommit() {
  const { stdout } = await run("git", ["rev-parse", "HEAD"], {
    cwd: workspace,
  });
  return stdout.trim();
}

async function assertMigrationCheckoutIsTrackedAndClean() {
  const [{ stdout: status }, { stdout: tracked }] = await Promise.all([
    run(
      "git",
      [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--",
        "supabase/migrations",
      ],
      { cwd: workspace },
    ),
    run("git", ["ls-files", "--", "supabase/migrations"], {
      cwd: workspace,
    }),
  ]);
  if (status.trim() !== "") {
    throw new Error("migration directory must match the exact commit");
  }
  const trackedSql = tracked
    .split("\n")
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const plan = await discoverMigrationPlan({
    workspace,
    repositoryCommit: await gitCommit(),
  });
  if (
    trackedSql.length !== plan.migrationCount ||
    trackedSql.some((file, index) => file !== plan.migrations[index].file)
  ) {
    throw new Error("every migration must be tracked by the exact commit");
  }
  return plan;
}

async function readReviewedPlan(planPath) {
  if (!planPath) throw new Error("--plan is required");
  const value = JSON.parse(await readFile(planPath, "utf8"));
  const plan = validateMigrationPlan(value);
  const checkout = await assertMigrationCheckoutIsTrackedAndClean();
  if (
    checkout.repositoryCommit !== plan.repositoryCommit ||
    checkout.planSha256 !== plan.planSha256
  ) {
    throw new Error("reviewed migration plan does not match this checkout");
  }
  return plan;
}

async function readReviewedBootstrapPlan(planPath) {
  if (!planPath) throw new Error("--plan is required");
  const plan = validateReviewedBootstrapPlan(
    JSON.parse(await readFile(planPath, "utf8")),
  );
  if ((await gitCommit()) !== plan.repositoryCommit) {
    throw new Error("reviewed bootstrap plan does not match this checkout");
  }
  const rebuilt = await createBootstrapPlan({
    repositoryCommit: plan.repositoryCommit,
    environment: process.env,
    createdAt: plan.createdAt,
  });
  if (rebuilt.planSha256 !== plan.planSha256) {
    throw new Error("reviewed bootstrap evidence changed after planning");
  }
  return plan;
}

function outputSecrets(environment) {
  return Object.entries(environment)
    .filter(
      ([name]) =>
        name.includes("DATABASE_URL") ||
        name.includes("API_KEY") ||
        name.includes("TOKEN") ||
        name.includes("SECRET") ||
        name.includes("SSL_CA") ||
        name.endsWith("RPC_URL"),
    )
    .map(([, value]) => value)
    .filter(Boolean);
}

async function writeOutput(value, outputPath) {
  assertNoSecretOutput(value, outputSecrets(process.env));
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath) {
    await writeFile(outputPath, serialized, { encoding: "utf8", flag: "wx" });
  } else {
    process.stdout.write(serialized);
  }
}

async function runDatabaseCommand(command, flags) {
  const allowed = ["--plan", "--expected-project-ref"];
  if (command === "apply") allowed.push("--confirm-apply");
  exactFlags(flags, allowed);
  const plan = await readReviewedPlan(flags.get("--plan"));
  if (
    command === "apply" &&
    flags.get("--confirm-apply") !== plan.planSha256
  ) {
    throw new Error("--confirm-apply must equal the reviewed plan commitment");
  }
  const connection = await openHostedDatabase({
    databaseUrl: process.env.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
    expectedProjectRef: flags.get("--expected-project-ref"),
    sslCaPem: process.env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
  });
  try {
    const state =
      command === "apply"
        ? await applyPendingMigrations({
            sql: connection.sql,
            workspace,
            plan,
          })
        : await inspectMigrationState({ sql: connection.sql, plan });
    const output = {
      kind: "programmable-hosted-db-operator-result",
      schemaVersion: 1,
      operation: command,
      planSha256: plan.planSha256,
      target: connection.target,
      state,
      changed:
        command === "apply" &&
        Array.isArray(state.appliedThisRun) &&
        state.appliedThisRun.length > 0,
    };
    await writeOutput(output);
    if (command === "verify" && state.status !== "current") {
      process.exitCode = 2;
    }
  } finally {
    await closeHostedDatabase(connection.sql);
  }
}

async function runBootstrapDatabaseCommand(command, flags) {
  const allowed = ["--plan", "--expected-project-ref"];
  if (command === "bootstrap-apply") allowed.push("--confirm-apply");
  exactFlags(flags, allowed);
  const plan = await readReviewedBootstrapPlan(flags.get("--plan"));
  if (
    command === "bootstrap-apply" &&
    flags.get("--confirm-apply") !== plan.planSha256
  ) {
    throw new Error("--confirm-apply must equal the reviewed plan commitment");
  }
  const connection = await openHostedDatabase({
    databaseUrl: process.env.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
    expectedProjectRef: flags.get("--expected-project-ref"),
    sslCaPem: process.env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
  });
  try {
    const migrationPlan = await assertMigrationCheckoutIsTrackedAndClean();
    const migrationState = await inspectMigrationState({
      sql: connection.sql,
      plan: migrationPlan,
    });
    if (migrationState.status !== "current") {
      throw new Error("all reviewed migrations must be current before bootstrap");
    }
    const state = command === "bootstrap-apply"
      ? await applyReviewedBootstrap({ sql: connection.sql, plan })
      : await inspectBootstrapState({ sql: connection.sql, plan });
    await writeOutput({
      kind: "programmable-hosted-db-bootstrap-result",
      schemaVersion: 1,
      operation: command,
      planSha256: plan.planSha256,
      target: connection.target,
      migrationPlanSha256: migrationPlan.planSha256,
      state,
      changed: state.changed === true,
    });
    if (command === "bootstrap-verify" && state.status !== "current") {
      process.exitCode = 2;
    }
  } finally {
    await closeHostedDatabase(connection.sql);
  }
}

async function main() {
  const { command, flags } = parseArguments(process.argv.slice(2));
  if (command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "plan") {
    exactFlags(flags, ["--output"]);
    const plan = await assertMigrationCheckoutIsTrackedAndClean();
    await writeOutput(plan, flags.get("--output"));
    return;
  }
  if (command === "bootstrap-plan") {
    exactFlags(flags, ["--output"]);
    const plan = await createBootstrapPlan({
      repositoryCommit: await gitCommit(),
      environment: process.env,
    });
    await writeOutput(plan, flags.get("--output"));
    return;
  }
  if (["dry-run", "verify", "apply"].includes(command)) {
    await runDatabaseCommand(command, flags);
    return;
  }
  if (["bootstrap-dry-run", "bootstrap-verify", "bootstrap-apply"].includes(command)) {
    await runBootstrapDatabaseCommand(command, flags);
    return;
  }
  throw new Error("unknown operator command");
}

main().catch((error) => {
  process.stderr.write(`${safeFailure(error)}\n`);
  process.exitCode = 1;
});
