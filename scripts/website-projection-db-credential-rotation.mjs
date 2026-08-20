#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  assertNoSecretOutput,
  safeFailure,
} from "./data-pipeline/hosted-db-operator-core.mjs";
import {
  openHostedDatabase,
  closeHostedDatabase,
} from "./data-pipeline/hosted-db-postgres.mjs";
import {
  inspectWebsiteProjectionCurrentRotationPosture,
} from "./website-projection-db-postgres.mjs";
import {
  discoverWebsiteProjectionPlan,
  validateWebsiteProjectionPlan,
  WEBSITE_PROJECTION_RUNTIME_ROLE,
} from "./website-projection-db-operator-core.mjs";
import {
  assertWebsiteProjectionRotationConfirmation,
  assertWebsiteProjectionRotationSourcePlan,
  buildWebsiteProjectionRotationReceipt,
  buildWebsiteProjectionRuntimeDatabaseUrl,
  validateWebsiteProjectionRotationPassword,
  WEBSITE_PROJECTION_NO_OVERLAP_CONFIRMATION,
  WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF,
  WEBSITE_PROJECTION_ROTATION_RECEIPT_LEAF,
  WEBSITE_PROJECTION_ROTATION_CONFIRMATION,
  WEBSITE_PROJECTION_RUNTIME_DATABASE_CA_PEM_LEAF,
  WEBSITE_PROJECTION_RUNTIME_DATABASE_ROLE_LEAF,
  WEBSITE_PROJECTION_RUNTIME_DATABASE_URL_LEAF,
} from "./website-projection-db-credential-rotation-core.mjs";
import {
  probeWebsiteProjectionRuntimeCredential,
  rotateWebsiteProjectionRuntimeCredential,
} from "./website-projection-db-credential-rotation-postgres.mjs";

const run = promisify(execFile);
const workspace = fileURLToPath(new URL("../", import.meta.url));
const HELP = `Usage:
  node scripts/website-projection-db-credential-rotation.mjs preflight \\
    --expected-project-ref ${WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF} \\
    --plan /secure/reviewed-website-projection-plan.json

  node scripts/website-projection-db-credential-rotation.mjs rotate \\
    --expected-project-ref ${WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF} \\
    --plan /secure/reviewed-website-projection-plan.json \\
    --password-file /secure/new-runtime-password \\
    --output-directory /secure/website-projection-runtime-v1 \\
    --confirm-rotate '${WEBSITE_PROJECTION_ROTATION_CONFIRMATION}' \\
    --confirm-no-overlap '${WEBSITE_PROJECTION_NO_OVERLAP_CONFIRMATION}'

Use exactly one of --password-file FILE or --password-stdin yes. A password file
must be an owner-only regular file with mode 0600. Stdin must be a non-TTY pipe.
The output directory must not exist; its parent must be owner-only mode 0700.
Both protected paths must resolve outside the Git checkout.
The reviewed migration plan must also be an outside-checkout 0600 regular file.

The authenticated migration authority remains PROGRAMMABLE_MIGRATOR_DATABASE_URL.
The provider CA remains PROGRAMMABLE_POSTGRES_SSL_CA_PEM. Neither is accepted on
the command line. No command changes Vercel or generates a password.
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
    if (!flag?.startsWith("--") || value === undefined
      || value.startsWith("--") || flags.has(flag)) {
      throw new Error("rotation operator arguments are invalid");
    }
    flags.set(flag, value);
  }
  return { command, flags };
}

function exactFlags(flags, allowed) {
  for (const name of flags.keys()) {
    if (!allowed.includes(name)) {
      throw new Error("rotation operator argument is not allowed");
    }
  }
}

async function gitObject(expression) {
  const { stdout } = await run("git", ["rev-parse", expression], {
    cwd: workspace,
  });
  return stdout.trim();
}

async function exactCheckoutIdentity() {
  const [{ stdout: status }, commit, tree, parent] = await Promise.all([
    run("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: workspace,
    }),
    gitObject("HEAD"),
    gitObject("HEAD^{tree}"),
    gitObject("HEAD^"),
  ]);
  if (status.trim() !== ""
    || !/^[0-9a-f]{40}$/u.test(commit)
    || !/^[0-9a-f]{40}$/u.test(tree)
    || !/^[0-9a-f]{40}$/u.test(parent)) {
    throw new Error("rotation operator requires an exact clean reviewed commit");
  }
  return Object.freeze({ commit, tree, parent });
}

function permissionMode(metadata) {
  return metadata.mode & 0o777;
}

function assertCurrentOwner(metadata, label) {
  if (typeof process.geteuid === "function" && metadata.uid !== process.geteuid()) {
    throw new Error(`${label} must be owned by the operator user`);
  }
}

function isInsideWorkspace(candidate) {
  const relative = path.relative(workspace, candidate);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function readProtectedPasswordFile(filePath) {
  if (!path.isAbsolute(filePath ?? "")) {
    throw new Error("rotation password file path must be absolute");
  }
  const fileReal = await realpath(filePath);
  if (fileReal !== filePath || isInsideWorkspace(fileReal)) {
    throw new Error("rotation password file must be a bounded owner-only regular file");
  }
  let handle;
  try {
    handle = await open(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const metadata = await handle.stat();
    assertCurrentOwner(metadata, "rotation password file");
    if (!metadata.isFile()
      || permissionMode(metadata) !== 0o600
      || metadata.size < 24 || metadata.size > 512) {
      throw new Error("rotation password file must be a bounded owner-only regular file");
    }
    return validateWebsiteProjectionRotationPassword(
      await handle.readFile({ encoding: "utf8" }),
    );
  } finally {
    await handle?.close();
  }
}

async function readReviewedPlan(planPath, source) {
  if (!path.isAbsolute(planPath ?? "")) {
    throw new Error("reviewed rotation plan path must be absolute");
  }
  const planReal = await realpath(planPath);
  if (planReal !== planPath || isInsideWorkspace(planReal)) {
    throw new Error("reviewed rotation plan must be a protected regular file");
  }
  let handle;
  let reviewedPlan;
  try {
    handle = await open(
      planPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const metadata = await handle.stat();
    assertCurrentOwner(metadata, "reviewed rotation plan");
    if (!metadata.isFile()
      || permissionMode(metadata) !== 0o600
      || metadata.size < 1 || metadata.size > 131_072) {
      throw new Error("reviewed rotation plan must be a protected regular file");
    }
    reviewedPlan = validateWebsiteProjectionPlan(
      JSON.parse(await handle.readFile({ encoding: "utf8" })),
    );
  } finally {
    await handle?.close();
  }
  const currentPlan = await discoverWebsiteProjectionPlan({
    workspace,
    repositoryCommit: source.commit,
    repositoryTree: source.tree,
  });
  return assertWebsiteProjectionRotationSourcePlan({
    reviewedPlan,
    currentPlan,
  });
}

async function readProtectedPasswordStdin() {
  if (process.stdin.isTTY) {
    throw new Error("rotation password stdin must be a non-TTY pipe");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 514) {
      throw new Error("rotation password stdin is too large");
    }
    chunks.push(chunk);
  }
  let value = Buffer.concat(chunks).toString("utf8");
  if (value.endsWith("\r\n")) value = value.slice(0, -2);
  else if (value.endsWith("\n")) value = value.slice(0, -1);
  return validateWebsiteProjectionRotationPassword(value);
}

async function readRotationPassword(flags) {
  const passwordFile = flags.get("--password-file");
  const passwordStdin = flags.get("--password-stdin");
  if ((passwordFile === undefined) === (passwordStdin === undefined)
    || (passwordStdin !== undefined && passwordStdin !== "yes")) {
    throw new Error("rotation requires exactly one protected password input");
  }
  return passwordFile === undefined
    ? await readProtectedPasswordStdin()
    : await readProtectedPasswordFile(passwordFile);
}

async function prepareProtectedOutputDirectory(outputDirectory) {
  if (!path.isAbsolute(outputDirectory ?? "")) {
    throw new Error("rotation output directory path must be absolute");
  }
  const parent = path.dirname(outputDirectory);
  const parentReal = await realpath(parent);
  if (parentReal !== parent || isInsideWorkspace(parentReal)) {
    throw new Error("rotation output parent must be an exact real path");
  }
  const parentMetadata = await lstat(parent);
  assertCurrentOwner(parentMetadata, "rotation output parent");
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()
    || permissionMode(parentMetadata) !== 0o700) {
    throw new Error("rotation output parent must be an owner-only directory");
  }
  try {
    await lstat(outputDirectory);
    throw new Error("rotation output directory already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const stage = path.join(
    parent,
    `.${path.basename(outputDirectory)}.stage-${randomUUID()}`,
  );
  await mkdir(stage, { mode: 0o700 });
  const stageMetadata = await lstat(stage);
  if (!stageMetadata.isDirectory() || permissionMode(stageMetadata) !== 0o700) {
    throw new Error("rotation staging directory is not protected");
  }
  return Object.freeze({ final: outputDirectory, stage });
}

async function writeProtectedFile(directory, name, value) {
  const target = path.join(directory, name);
  await writeFile(target, value, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const metadata = await lstat(target);
  assertCurrentOwner(metadata, "rotation output file");
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || permissionMode(metadata) !== 0o600) {
    throw new Error("rotation output file is not protected");
  }
}

function secretValues(runtimePassword, runtimeDatabaseUrl) {
  return [
    runtimePassword,
    runtimeDatabaseUrl,
    process.env.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
  ].filter(Boolean);
}

async function writeStdout(value, secrets) {
  assertNoSecretOutput(value, secrets);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function withAuthority(expectedProjectRef, callback) {
  const connection = await openHostedDatabase({
    databaseUrl: process.env.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
    expectedProjectRef,
    sslCaPem: process.env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
  });
  try {
    return await callback(connection);
  } finally {
    await closeHostedDatabase(connection.sql);
  }
}

async function preflight(flags) {
  exactFlags(flags, ["--expected-project-ref", "--plan"]);
  const expectedProjectRef = flags.get("--expected-project-ref");
  if (expectedProjectRef !== WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF) {
    throw new Error("preflight target must be the exact production project");
  }
  const source = await exactCheckoutIdentity();
  const plan = await readReviewedPlan(flags.get("--plan"), source);
  const result = await withAuthority(expectedProjectRef, async (connection) => ({
    schemaVersion:
      "programmable.website-projection-runtime-credential-rotation-preflight.v1",
    changed: false,
    source,
    target: connection.target,
    operatorIdentity: connection.operatorIdentity,
    posture: await inspectWebsiteProjectionCurrentRotationPosture({
      sql: connection.sql,
      plan,
      expectedProjectRef,
      sessionIdentity: connection.sessionIdentity,
    }),
  }));
  await writeStdout(result, [process.env.PROGRAMMABLE_MIGRATOR_DATABASE_URL]);
}

async function rotate(flags) {
  exactFlags(flags, [
    "--expected-project-ref",
    "--plan",
    "--password-file",
    "--password-stdin",
    "--output-directory",
    "--confirm-rotate",
    "--confirm-no-overlap",
  ]);
  const expectedProjectRef = flags.get("--expected-project-ref");
  assertWebsiteProjectionRotationConfirmation({
    expectedProjectRef,
    confirmRotate: flags.get("--confirm-rotate"),
    confirmNoOverlap: flags.get("--confirm-no-overlap"),
  });
  const source = await exactCheckoutIdentity();
  const plan = await readReviewedPlan(flags.get("--plan"), source);
  const runtimePassword = await readRotationPassword(flags);
  const runtimeDatabaseUrl = buildWebsiteProjectionRuntimeDatabaseUrl(
    runtimePassword,
    { projectRef: expectedProjectRef },
  );
  const output = await prepareProtectedOutputDirectory(
    flags.get("--output-directory"),
  );
  const secrets = secretValues(runtimePassword, runtimeDatabaseUrl);
  let published = false;
  let credentialCommitted = false;
  try {
    await writeProtectedFile(
      output.stage,
      WEBSITE_PROJECTION_RUNTIME_DATABASE_URL_LEAF,
      runtimeDatabaseUrl,
    );
    await writeProtectedFile(
      output.stage,
      WEBSITE_PROJECTION_RUNTIME_DATABASE_ROLE_LEAF,
      WEBSITE_PROJECTION_RUNTIME_ROLE,
    );
    await writeProtectedFile(
      output.stage,
      WEBSITE_PROJECTION_RUNTIME_DATABASE_CA_PEM_LEAF,
      process.env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
    );
    const receipt = await withAuthority(expectedProjectRef, async (connection) => {
      const rotation = await rotateWebsiteProjectionRuntimeCredential({
        sql: connection.sql,
        plan,
        expectedProjectRef,
        sessionIdentity: connection.sessionIdentity,
        runtimePassword,
      });
      credentialCommitted = true;
      const runtime = await probeWebsiteProjectionRuntimeCredential({
        databaseUrl: runtimeDatabaseUrl,
        expectedProjectRef,
        sslCaPem: process.env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
      });
      return buildWebsiteProjectionRotationReceipt({
        sourceCommit: source.commit,
        sourceTree: source.tree,
        sourceParent: source.parent,
        target: connection.target,
        migrationEvidence: rotation.before.migrationEvidence,
        preRotationCatalogSha256: rotation.before.catalogSha256,
        postRotationCatalogSha256: rotation.after.catalogSha256,
        runtimeProbe: runtime.attestation,
        caPem: process.env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
        outputFiles: {
          databaseUrl: WEBSITE_PROJECTION_RUNTIME_DATABASE_URL_LEAF,
          databaseRole: WEBSITE_PROJECTION_RUNTIME_DATABASE_ROLE_LEAF,
          databaseCaPem: WEBSITE_PROJECTION_RUNTIME_DATABASE_CA_PEM_LEAF,
          receipt: WEBSITE_PROJECTION_ROTATION_RECEIPT_LEAF,
        },
        rotatedAt: new Date().toISOString(),
      });
    });
    assertNoSecretOutput(receipt, secrets);
    await writeProtectedFile(
      output.stage,
      WEBSITE_PROJECTION_ROTATION_RECEIPT_LEAF,
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    await rename(output.stage, output.final);
    published = true;
    await writeStdout(receipt, secrets);
  } catch (error) {
    if (credentialCommitted && error?.code !== "WPR01") {
      const postCommitFailure = new Error(
        "website projection rotation failed after credential commit",
        { cause: error },
      );
      postCommitFailure.code = "WPR01";
      throw postCommitFailure;
    }
    throw error;
  } finally {
    if (!published) {
      await rm(output.stage, { recursive: true, force: true });
    }
  }
}

async function main() {
  const { command, flags } = parseArguments(process.argv.slice(2));
  if (command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "preflight") return await preflight(flags);
  if (command === "rotate") return await rotate(flags);
  throw new Error("unknown rotation operator command");
}

main().catch((error) => {
  process.stderr.write(`${safeFailure(error)}\n`);
  process.exitCode = 1;
});
