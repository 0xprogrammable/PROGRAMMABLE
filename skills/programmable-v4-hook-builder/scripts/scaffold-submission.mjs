#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseCliOrExit } from "./cli-args.mjs";
import { assertInsideRepository, resolveRepositoryRoot } from "./repository-root.mjs";

const MAX_MODEL_ID_LENGTH = 64;
const MAX_MODEL_NAME_LENGTH = 80;
const templateFiles = ["PROPOSAL.md", "THREAT_MODEL.md", "TEST_PLAN.md", "EVIDENCE.md"];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDirectory, "..");
const templateRoot = path.join(skillRoot, "assets", "templates");
const { options, positionals } = parseCliOrExit({
  command: "scaffold-submission.mjs",
  usage: "scaffold-submission.mjs <model-id> [--repository-root <path>] [--name <display-name>] [--destination <path>]",
  summary: "Create one isolated Programmable hook proposal package without changing the model registry.",
  options: [
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Use this Git worktree instead of the current directory." },
    { name: "--name", key: "modelName", type: "value", valueName: "display-name", description: "Set a human-readable model name of at most 80 characters." },
    { name: "--destination", key: "destination", type: "value", valueName: "path", description: "Create the package under this in-repository directory." }
  ],
  positionals: { min: 1, max: 1, names: ["model-id"] }
});
const modelId = positionals[0];
validateModelId(modelId);
const displayName = normalizeModelName(options.modelName, modelId);

let repositoryRoot;
try {
  repositoryRoot = resolveRepositoryRoot(options.repositoryRoot);
} catch (error) {
  fail(error.message);
}
let destinationRoot = path.resolve(options.destination ?? path.join(repositoryRoot, "submissions"));
try {
  destinationRoot = assertInsideRepository(repositoryRoot, destinationRoot, { allowMissing: true });
} catch (error) {
  fail(error.message);
}

let destination = path.join(destinationRoot, modelId);
try {
  destination = assertInsideRepository(repositoryRoot, destination, { allowMissing: true });
} catch (error) {
  fail(error.message);
}
if (fs.existsSync(destination)) fail(`destination already exists: ${path.relative(repositoryRoot, destination)}`);

let renderedPackage;
try {
  renderedPackage = preloadPackage(modelId, displayName);
} catch (error) {
  fail(`cannot load scaffold resources: ${error.message}`);
}

try {
  writePackageAtomically({ destinationRoot, destination, modelId, renderedPackage });
} catch (error) {
  fail(error.message);
}

console.log(`Created ${path.relative(repositoryRoot, destination)} without changing the launch-model registry.`);

function validateModelId(value) {
  if (value.length > MAX_MODEL_ID_LENGTH) {
    fail(`model id must be at most ${MAX_MODEL_ID_LENGTH} characters`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    fail("model id must use lowercase kebab-case");
  }
}

function normalizeModelName(value, id) {
  if (value === null) return id.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    fail("model name must not contain control or bidirectional formatting characters");
  }
  const normalized = value.trim();
  if (normalized.length === 0) fail("model name must not be empty");
  if (normalized.length > MAX_MODEL_NAME_LENGTH) {
    fail(`model name must be at most ${MAX_MODEL_NAME_LENGTH} characters`);
  }
  return normalized;
}

function preloadPackage(id, name) {
  const rendered = new Map();
  for (const file of templateFiles) {
    const source = fs.readFileSync(path.join(templateRoot, file), "utf8");
    if (source.length === 0) throw new Error(`${file} is empty`);
    rendered.set(
      file,
      source
        .replaceAll("{{MODEL_ID}}", id)
        .replaceAll("{{MODEL_NAME}}", name)
        .replaceAll("{{MODEL_SUMMARY}}", "Describe the model in one concrete sentence before implementation begins.")
    );
  }

  const submission = JSON.parse(fs.readFileSync(path.join(templateRoot, "submission.example.json"), "utf8"));
  if (!submission || typeof submission !== "object" || Array.isArray(submission) || !submission.model || typeof submission.model !== "object") {
    throw new Error("submission.example.json is not a valid submission template");
  }
  submission.$schema = "urn:programmable:v4-hook-submission:1.1.0";
  submission.model.id = id;
  submission.model.name = name;
  rendered.set("submission.json", `${JSON.stringify(submission, null, 2)}\n`);
  return rendered;
}

function writePackageAtomically({ destinationRoot: root, destination: target, modelId: id, renderedPackage: files }) {
  fs.mkdirSync(root, { recursive: true });
  const lockPath = path.join(root, `.${id}.scaffold.lock`);
  let lock = null;
  let staging = null;
  try {
    try {
      lock = fs.openSync(lockPath, "wx");
    } catch (error) {
      if (error.code === "EEXIST") throw new Error(`another scaffold operation is already creating ${id}`);
      throw error;
    }
    if (fs.existsSync(target)) throw new Error(`destination already exists: ${path.relative(repositoryRoot, target)}`);

    staging = fs.mkdtempSync(path.join(root, `.${id}.staging-`));
    for (const [file, contents] of files) {
      fs.writeFileSync(path.join(staging, file), contents, { flag: "wx" });
    }
    if (fs.existsSync(target)) throw new Error(`destination already exists: ${path.relative(repositoryRoot, target)}`);
    fs.renameSync(staging, target);
    staging = null;
  } finally {
    if (staging && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (lock !== null) fs.closeSync(lock);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
}

function fail(message) {
  console.error(`scaffold-submission: ${message}`);
  process.exit(2);
}
