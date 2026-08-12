#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { assertInsideRepository, resolveRepositoryRoot } from "./repository-root.mjs";
import { buildReviewTarget } from "./review-target-core.mjs";
import { canonicalJson } from "./submission-core.mjs";
import { sanitizeMessage } from "./cli-runtime.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const MAX_SUBMISSION_BYTES = 2_000_000;
const args = process.argv.slice(2);

if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  process.stdout.write("Usage: cli-review-target.mjs <repository-root> <submission-directory>\n");
  process.exit(0);
}

if (args.length !== 2) fail("expected one repository root and one submission directory");

try {
  const repositoryRoot = resolveRepositoryRoot(args[0]);
  const packageRoot = assertInsideRepository(repositoryRoot, path.resolve(repositoryRoot, args[1]));
  const packageStat = fs.lstatSync(packageRoot);
  if (!packageStat.isDirectory() || packageStat.isSymbolicLink()) {
    throw new Error("submission package must be a regular directory");
  }
  const submissionPath = assertInsideRepository(repositoryRoot, path.join(packageRoot, "submission.json"));
  const submissionStat = fs.lstatSync(submissionPath);
  if (!submissionStat.isFile() || submissionStat.isSymbolicLink()) {
    throw new Error("submission.json must be a regular file");
  }
  if (submissionStat.size > MAX_SUBMISSION_BYTES) {
    throw new Error(`submission.json exceeds ${MAX_SUBMISSION_BYTES} bytes`);
  }
  const submission = parseBoundedStrictJsonBytes(fs.readFileSync(submissionPath), {
    maxSourceBytes: MAX_SUBMISSION_BYTES
  });
  const target = buildReviewTarget({ repositoryRoot, packageRoot, submission });
  process.stdout.write(`${canonicalJson(target)}\n`);
} catch (error) {
  fail(error?.message ?? "review-target construction failed");
}

function fail(message) {
  process.stderr.write(`cli-review-target: ${sanitizeMessage(message)}\n`);
  process.exit(2);
}
