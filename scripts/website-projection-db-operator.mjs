#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  assertNoSecretOutput,
  safeFailure,
} from "./data-pipeline/hosted-db-operator-core.mjs";
import {
  assertWebsiteProjectionApplyConfirmation,
  discoverWebsiteProjectionPlan,
  validateWebsiteProjectionPlan,
} from "./website-projection-db-operator-core.mjs";
import {
  applyWebsiteProjectionMigrations,
  inspectWebsiteProjectionDatabase,
} from "./website-projection-db-postgres.mjs";
import {
  closeHostedDatabase,
  openHostedDatabase,
} from "./data-pipeline/hosted-db-postgres.mjs";

const run = promisify(execFile);
const workspace = fileURLToPath(new URL("../", import.meta.url));
const migrationRoot = "ops/website-projection-target/migrations";
const CREDENTIAL_ENVIRONMENT_NAME =
  /(?:DATABASE_URL|PASSWORD|API_KEY|TOKEN|SECRET|SSL_CA(?:_PEM)?|RPC_URL)$/u;

const HELP = `Usage:
  node scripts/website-projection-db-operator.mjs plan [--output FILE]
  node scripts/website-projection-db-operator.mjs dry-run --plan FILE --expected-project-ref REF
  node scripts/website-projection-db-operator.mjs verify --plan FILE --expected-project-ref REF
  node scripts/website-projection-db-operator.mjs apply --plan FILE --expected-project-ref REF --confirm-apply PLAN_SHA256 --confirm-target REF

Database credentials are accepted only through PROGRAMMABLE_MIGRATOR_DATABASE_URL.
The CA certificate is accepted only through PROGRAMMABLE_POSTGRES_SSL_CA_PEM.
The runtime bootstrap password is accepted only through
PROGRAMMABLE_WEBSITE_PROJECTION_RUNTIME_PASSWORD.
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

async function gitObject(expression) {
  const { stdout } = await run("git", ["rev-parse", expression], {
    cwd: workspace,
  });
  return stdout.trim();
}

async function assertMigrationCheckoutIsTrackedAndClean() {
  const [{ stdout: status }, { stdout: tracked }, commit, tree] =
    await Promise.all([
      run("git", [
        "status", "--porcelain=v1", "--untracked-files=all", "--", migrationRoot,
      ], { cwd: workspace }),
      run("git", ["ls-files", "--", migrationRoot], { cwd: workspace }),
      gitObject("HEAD"),
      gitObject("HEAD^{tree}"),
    ]);
  if (status.trim() !== "") {
    throw new Error("migration directory must match the exact commit");
  }
  const plan = await discoverWebsiteProjectionPlan({
    workspace,
    repositoryCommit: commit,
    repositoryTree: tree,
  });
  const trackedSql = tracked.split("\n").filter(Boolean).sort();
  if (trackedSql.length !== plan.migrationCount
    || trackedSql.some((file, index) => file !== plan.migrations[index].file)) {
    throw new Error("every migration must be tracked by the exact commit");
  }
  return plan;
}

async function readReviewedPlan(planPath) {
  if (!planPath) throw new Error("--plan is required");
  const plan = validateWebsiteProjectionPlan(
    JSON.parse(await readFile(planPath, "utf8")),
  );
  const checkout = await assertMigrationCheckoutIsTrackedAndClean();
  if (checkout.repositoryCommit !== plan.repositoryCommit
    || checkout.repositoryTree !== plan.repositoryTree
    || checkout.planSha256 !== plan.planSha256) {
    throw new Error("reviewed migration plan does not match this checkout");
  }
  return plan;
}

function outputSecrets(environment) {
  return Object.entries(environment)
    .filter(([name]) => CREDENTIAL_ENVIRONMENT_NAME.test(name))
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
  if (command === "apply") allowed.push("--confirm-apply", "--confirm-target");
  exactFlags(flags, allowed);
  const plan = await readReviewedPlan(flags.get("--plan"));
  const expectedProjectRef = flags.get("--expected-project-ref");
  if (command === "apply") {
    assertWebsiteProjectionApplyConfirmation({
      plan,
      expectedProjectRef,
      confirmApply: flags.get("--confirm-apply"),
      confirmTarget: flags.get("--confirm-target"),
    });
  }
  const connection = await openHostedDatabase({
    databaseUrl: process.env.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
    expectedProjectRef,
    sslCaPem: process.env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
  });
  try {
    const state = command === "apply"
      ? await applyWebsiteProjectionMigrations({
          sql: connection.sql,
          workspace,
          plan,
          expectedProjectRef,
          sessionIdentity: connection.sessionIdentity,
          runtimePassword:
            process.env.PROGRAMMABLE_WEBSITE_PROJECTION_RUNTIME_PASSWORD,
        })
      : await inspectWebsiteProjectionDatabase({
          sql: connection.sql,
          plan,
          expectedProjectRef,
          sessionIdentity: connection.sessionIdentity,
        });
    await writeOutput({
      kind: "programmable-website-projection-db-operator-result",
      schemaVersion: 1,
      operation: command,
      planSha256: plan.planSha256,
      target: connection.target,
      operatorIdentity: connection.operatorIdentity,
      state,
      changed: command === "apply" && state.appliedThisRun.length > 0,
    });
    if (command === "verify" && state.status !== "current") process.exitCode = 2;
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
    await writeOutput(
      await assertMigrationCheckoutIsTrackedAndClean(),
      flags.get("--output"),
    );
    return;
  }
  if (["dry-run", "verify", "apply"].includes(command)) {
    await runDatabaseCommand(command, flags);
    return;
  }
  throw new Error("unknown operator command");
}

main().catch((error) => {
  process.stderr.write(`${safeFailure(error)}\n`);
  process.exitCode = 1;
});
