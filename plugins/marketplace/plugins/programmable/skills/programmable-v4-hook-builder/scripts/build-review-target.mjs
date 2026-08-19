#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseCliOrExit } from "./cli-args.mjs";
import { buildReviewTarget } from "./review-target-core.mjs";
import { assertInsideRepository, resolveRepositoryRoot } from "./repository-root.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const MAX_JSON_BYTES = 2_000_000;
const { options, positionals } = parseCliOrExit({
  command: "build-review-target.mjs",
  usage: "build-review-target.mjs [--repository-root <path>] <submission-directory> [--write <path>]",
  summary: "Build the exact source-and-evidence closure for one proposal or prototype package.",
  options: [
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Use this Git worktree instead of the current directory." },
    { name: "--write", key: "output", type: "value", valueName: "path", description: "Write the review target to this in-repository path." }
  ],
  positionals: { min: 1, max: 1, names: ["submission-directory"] }
});
const packageInput = positionals[0];
const outputInput = options.output;
let repositoryRoot;
try {
  repositoryRoot = resolveRepositoryRoot(options.repositoryRoot);
} catch (error) {
  fail(error.message);
}

let packageRoot;
try {
  packageRoot = assertInsideRepository(repositoryRoot, path.resolve(packageInput));
} catch (error) {
  fail(error.message);
}
let submission;
let target;
try {
  const submissionPath = path.join(packageRoot, "submission.json");
  const stat = fs.statSync(submissionPath);
  if (!stat.isFile()) throw new Error("submission.json is not a regular file");
  if (stat.size > MAX_JSON_BYTES) throw new Error(`submission.json exceeds ${MAX_JSON_BYTES} bytes`);
  submission = parseBoundedStrictJsonBytes(fs.readFileSync(submissionPath), {
    maxSourceBytes: MAX_JSON_BYTES
  });
  target = buildReviewTarget({ repositoryRoot, packageRoot, submission });
} catch (error) {
  fail(error.message);
}
const output = `${JSON.stringify(target, null, 2)}\n`;

if (outputInput || submission.implementation?.reviewTargetPath) {
  let targetPath;
  try {
    targetPath = assertInsideRepository(repositoryRoot, path.resolve(repositoryRoot, outputInput ?? submission.implementation.reviewTargetPath), { allowMissing: true });
  } catch (error) {
    fail(error.message);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, output);
}

process.stdout.write(output);

function fail(message) {
  console.error(`build-review-target: ${message}`);
  process.exit(2);
}
