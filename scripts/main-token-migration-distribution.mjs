#!/usr/bin/env node

import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS,
  buildMainTokenMigrationDistribution,
} from "./main-token-migration-distribution-core.mjs";

const MAX_FROZEN_SOURCE_BYTES = 10 * 1024 * 1024;
const DEFAULT_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function usage() {
  return [
    "Usage:",
    "  node scripts/main-token-migration-distribution.mjs \\",
    "    --snapshot <final-snapshot.json> \\",
    "    --target-design <activated-target-design.json> \\",
    "    --manual-review-decisions <same-address-decisions.json> \\",
    "    --manual-review-evidence-root <absolute-evidence-directory> \\",
    "    --output <distribution-plan.json>",
    "",
    "This command is offline. It does not deploy, sign, broadcast, or distribute tokens.",
  ].join("\n");
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(usage());
    }
    if (values.has(key)) throw new Error(`Duplicate argument: ${key}`);
    values.set(key, value);
  }
  const allowed = new Set([
    "--snapshot",
    "--target-design",
    "--manual-review-decisions",
    "--manual-review-evidence-root",
    "--output",
  ]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`Unknown argument: ${key}\n${usage()}`);
  }
  for (const key of allowed) {
    if (!values.has(key)) throw new Error(`Missing argument: ${key}\n${usage()}`);
  }
  return {
    manualReviewDecisionsPath: values.get("--manual-review-decisions"),
    manualReviewEvidenceRoot: values.get("--manual-review-evidence-root"),
    outputPath: values.get("--output"),
    snapshotPath: values.get("--snapshot"),
    targetDesignPath: values.get("--target-design"),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readFrozenMigrationSourceFiles(
  configuredRoot = DEFAULT_REPOSITORY_ROOT,
) {
  if (!path.isAbsolute(configuredRoot ?? "")) {
    throw new Error("Frozen-source repository root must be absolute");
  }
  const configuredRootMetadata = await lstat(configuredRoot);
  if (!configuredRootMetadata.isDirectory() || configuredRootMetadata.isSymbolicLink()) {
    throw new Error("Frozen-source repository root is not a physical directory");
  }
  const root = await realpath(configuredRoot);
  const files = new Map();
  for (const sourcePath of MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS) {
    const candidate = path.resolve(root, sourcePath);
    const relative = path.relative(root, candidate);
    if (
      relative !== sourcePath ||
      relative === "" ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Frozen source escapes its repository root: ${sourcePath}`);
    }
    let metadata;
    let physicalPath;
    try {
      metadata = await lstat(candidate);
      physicalPath = await realpath(candidate);
    } catch {
      throw new Error(`Frozen source is missing or unreadable: ${sourcePath}`);
    }
    if (physicalPath !== candidate) {
      throw new Error(`Frozen source escapes its repository root: ${sourcePath}`);
    }
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1 ||
      metadata.size > MAX_FROZEN_SOURCE_BYTES
    ) {
      throw new Error(`Frozen source is not a bounded physical file: ${sourcePath}`);
    }
    const bytes = await readFile(candidate);
    if (bytes.byteLength !== metadata.size) {
      throw new Error(`Frozen source changed while being read: ${sourcePath}`);
    }
    files.set(sourcePath, bytes);
  }
  return files;
}

async function readManualReviewEvidence(decisions, configuredRoot) {
  if (!path.isAbsolute(configuredRoot ?? "")) {
    throw new Error("Manual-review evidence root must be an absolute directory");
  }
  const root = await realpath(configuredRoot);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("Manual-review evidence root is not a physical directory");
  }
  const files = new Map();
  for (const [index, decision] of (decisions.decisions ?? []).entries()) {
    const filename = decision?.reviewEvidenceFile;
    if (
      typeof filename !== "string" ||
      filename !== path.basename(filename) ||
      filename.length === 0
    ) {
      throw new Error(`Manual-review evidence ${index} has an unsafe filename`);
    }
    if (files.has(filename)) {
      throw new Error(`Manual-review evidence filename is duplicated: ${filename}`);
    }
    const candidate = path.resolve(root, filename);
    if (path.dirname(candidate) !== root) {
      throw new Error(`Manual-review evidence escapes its root: ${filename}`);
    }
    const metadata = await lstat(candidate);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1 ||
      metadata.size > 10 * 1024 * 1024
    ) {
      throw new Error(`Manual-review evidence is not a bounded physical file: ${filename}`);
    }
    files.set(filename, await readFile(candidate));
  }
  return files;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const [snapshot, manualReviewDecisions, targetDesign, targetDesignSourceFiles] =
    await Promise.all([
    readJson(options.snapshotPath),
    readJson(options.manualReviewDecisionsPath),
    readJson(options.targetDesignPath),
    readFrozenMigrationSourceFiles(),
  ]);
  const manualReviewEvidenceFiles = await readManualReviewEvidence(
    manualReviewDecisions,
    options.manualReviewEvidenceRoot,
  );
  const plan = buildMainTokenMigrationDistribution(
    snapshot,
    manualReviewDecisions,
    targetDesign,
    manualReviewEvidenceFiles,
    targetDesignSourceFiles,
  );
  await writeFile(options.outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
    flag: "wx",
  });
  process.stdout.write(
    `${JSON.stringify({
      allocationCount: plan.allocationCount,
      distributionPlanSha256: plan.distributionPlanSha256,
      merkleRoot: plan.merkleRoot,
      migrationTotalRaw: plan.reconciliation.migrationTotalRaw,
      targetDesignSha256: plan.targetDesignSha256,
      output: options.outputPath,
      remainderRaw: plan.reconciliation.remainderRaw,
    })}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
