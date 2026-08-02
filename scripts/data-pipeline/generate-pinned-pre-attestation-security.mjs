import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  OFFICIAL_POSTGRES_17_TOOLCHAIN,
  PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE,
  PINNED_PRE_ATTESTATION_SNAPSHOT,
} from "./candidate-restore.mjs";
import { canonicalJson, sha256 } from "./hosted-db-operator-core.mjs";

const executeFile = promisify(execFile);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const COMMITTED_ASSET = path.join(
  SCRIPT_DIRECTORY,
  "pinned-pre-attestation-security.sql.gz",
);
const SCHEMAS = Object.freeze([
  "programmable_private",
  "programmable_release_probe_private",
  "supabase_migrations",
]);

function requiredEnvironment(name, pattern) {
  const value = process.env[name];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

async function verifyMigrationSources() {
  if (
    PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE.length !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.migrationSourceCount ||
    sha256(canonicalJson(PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE)) !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.migrationSourceClosureSha256
  ) {
    throw new Error("pinned migration source manifest changed");
  }
  for (const source of PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE) {
    const fileName = `${source.version}_${source.name}.sql`;
    const bytes = await readFile(
      path.join(REPOSITORY_ROOT, "supabase", "migrations", fileName),
    );
    if (bytes.byteLength !== source.bytes || sha256(bytes) !== source.sha256) {
      throw new Error(`pinned migration source changed at ordinal ${source.ordinal}`);
    }
  }
}

async function main() {
  if (process.argv.slice(2).some((argument) => argument !== "--write")) {
    throw new Error("usage: generate-pinned-pre-attestation-security.mjs [--write]");
  }
  const writeAsset = process.argv.includes("--write");
  const pgDumpBinary = requiredEnvironment(
    "PROGRAMMABLE_PG_DUMP_BINARY",
    /^\//u,
  );
  const host = requiredEnvironment(
    "PROGRAMMABLE_ACL_SOURCE_HOST",
    /^(?:\/private\/tmp\/[A-Za-z0-9._/-]+|127\.0\.0\.1|localhost)$/u,
  );
  const port = requiredEnvironment("PROGRAMMABLE_ACL_SOURCE_PORT", /^\d{1,5}$/u);
  const database = requiredEnvironment(
    "PROGRAMMABLE_ACL_SOURCE_DATABASE",
    /^programmable_[a-z0-9_]{3,63}$/u,
  );
  const username = requiredEnvironment(
    "PROGRAMMABLE_ACL_SOURCE_USER",
    /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u,
  );
  await verifyMigrationSources();
  const binary = await readFile(pgDumpBinary);
  if (
    binary.byteLength !== OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries.pg_dump.bytes ||
    sha256(binary) !== OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries.pg_dump.sha256
  ) {
    throw new Error("pg_dump is not the pinned official PostgreSQL 17 binary");
  }
  const dump = await executeFile(
    pgDumpBinary,
    [
      "--schema-only",
      "--no-owner",
      "--host",
      host,
      "--port",
      port,
      "--username",
      username,
      "--dbname",
      database,
      ...SCHEMAS.flatMap((schema) => ["--schema", schema]),
    ],
    {
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LANG: "C", LC_ALL: "C" },
    },
  );
  const normalized = Buffer.from(
    dump.stdout
      .toString("utf8")
      .split(/\r?\n/u)
      .filter((line) => /^(?:GRANT |REVOKE |ALTER DEFAULT PRIVILEGES )/u.test(line))
      .join("\n") + "\n",
  );
  if (
    normalized.byteLength !== PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureBytes ||
    sha256(normalized) !== PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureSha256 ||
    normalized.toString("utf8").trimEnd().split("\n").length !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureStatementCount
  ) {
    throw new Error("fresh baseline database does not reproduce the pinned security SQL");
  }
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "programmable-pinned-security-"),
  );
  try {
    const sqlPath = path.join(directory, "security.sql");
    await writeFile(sqlPath, normalized, { mode: 0o600 });
    const compressed = (
      await executeFile("/usr/bin/gzip", ["-n", "-9", "-c", sqlPath], {
        encoding: "buffer",
        maxBuffer: 1024 * 1024,
        env: { LANG: "C", LC_ALL: "C" },
      })
    ).stdout;
    if (
      compressed.byteLength !==
        PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureGzipBytes ||
      sha256(compressed) !==
        PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureGzipSha256
    ) {
      throw new Error("deterministic gzip output differs from the pinned asset");
    }
    if (writeAsset) {
      await writeFile(COMMITTED_ASSET, compressed, { mode: 0o644 });
      await chmod(COMMITTED_ASSET, 0o644);
    } else if (!(await readFile(COMMITTED_ASSET)).equals(compressed)) {
      throw new Error("committed security asset differs from fresh deterministic output");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  process.stdout.write(
    `${canonicalJson({
      kind: "programmable-pinned-security-closure-provenance",
      schemaVersion: 1,
      repositoryCommit: PINNED_PRE_ATTESTATION_SNAPSHOT.repositoryCommit,
      migrationSourceCount: PINNED_PRE_ATTESTATION_SNAPSHOT.migrationSourceCount,
      migrationSourceClosureSha256:
        PINNED_PRE_ATTESTATION_SNAPSHOT.migrationSourceClosureSha256,
      securityClosureSha256:
        PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureSha256,
      securityClosureGzipSha256:
        PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureGzipSha256,
      written: writeAsset,
    })}\n`,
  );
}

await main();
