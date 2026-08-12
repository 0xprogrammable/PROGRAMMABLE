#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildLaunchBundle, LaunchBundleError, validateLaunchBundleOutput } from "./launch-bundle-core.mjs";
import { assertInsideRepository, resolveRepositoryRoot } from "./repository-root.mjs";
import { canonicalJson, validateAgainstSchema } from "./submission-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const MAX_INPUT_BYTES = 2_000_000;
main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (error) => {
    process.stdout.write(`${canonicalJson(failure(error))}\n`);
    process.exitCode = error instanceof LaunchBundleError ? 1 : 2;
  }
);

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write([
      "Usage: launch-bundle.mjs --submission <submission.json> --bindings <launch-bundle-input.json> --repository-root <path> --registry-root <path> --evidence-root <separate-path> [--write <path>]",
      "",
      "Build deterministic pre-authorization material that exactly maps to Admin DeploymentSpecV1, LaunchExecutorCallV1 and PoolConfigurationV1.",
      "The command performs no network, RPC, signing, deployment or authorization action. It binds exact local Git objects, file bytes and artifact bytecode; missing provenance fails closed.",
      "Runtime and deployment evidence remain NOT_RUN/NOT_PROVIDED for independent Admin verification. --bindings and --write are relative to --evidence-root; output never overwrites."
    ].join("\n") + "\n");
    return 0;
  }
  const options = parseArguments(argv);
  const repositoryRoot = resolveRepositoryRoot(options.repositoryRoot);
  const registryRoot = resolveRepositoryRoot(options.registryRoot);
  const evidenceRoot = realDirectory(options.evidenceRoot, "evidence root");
  const submissionPath = regularFile(repositoryRoot, options.submission, "submission");
  const bindingsPath = regularFile(evidenceRoot, options.bindings, "bindings");
  const submission = readJson(submissionPath, "submission");
  const bindings = readJson(bindingsPath, "bindings");
  const schema = readJson(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "references", "submission.schema.json"),
    "submission schema"
  );
  const bindingsSchema = readJson(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "references", "launch-bundle-input-v1.schema.json"),
    "launch-bundle input schema"
  );
  const outputSchema = readJson(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "references", "launch-bundle-output-v1.schema.json"),
    "launch-bundle output schema"
  );
  const structuralFindings = validateAgainstSchema(submission, schema);
  if (structuralFindings.length > 0) {
    throw new LaunchBundleError(
      "SUBMISSION_SCHEMA_INVALID",
      "submission does not satisfy the current launch-binding schema",
      { findings: structuralFindings.slice(0, 128) }
    );
  }
  const bindingFindings = validateAgainstSchema(bindings, bindingsSchema);
  if (bindingFindings.length > 0) {
    throw new LaunchBundleError(
      "BINDINGS_SCHEMA_INVALID",
      "bindings do not satisfy the closed launch-bundle input schema",
      { findings: bindingFindings.slice(0, 128) }
    );
  }
  const bundle = buildLaunchBundle({
    submission,
    bindings,
    repositoryRoot,
    registryRoot,
    evidenceRoot,
    submissionPath
  });
  const outputFindings = validateLaunchBundleOutput(bundle, { schema: outputSchema });
  if (outputFindings.length > 0) {
    throw new LaunchBundleError(
      "OUTPUT_CONTRACT_INVALID",
      "derived launch bundle does not satisfy the closed output contract",
      { findings: outputFindings.slice(0, 128) }
    );
  }
  let written = null;
  if (options.write !== null) {
    const target = writablePath(evidenceRoot, options.write);
    writeAtomically(target, `${canonicalJson(bundle)}\n`);
    written = {
      path: relative(evidenceRoot, target),
      bundleSha256: bundle.bundleSha256
    };
  }
  process.stdout.write(`${canonicalJson({
    schemaVersion: "1.0.0",
    command: "launch-bundle",
    ok: true,
    result: bundle,
    written
  })}\n`);
  return 0;
}

function parseArguments(argv) {
  const definitions = new Map([
    ["--submission", "submission"],
    ["--bindings", "bindings"],
    ["--repository-root", "repositoryRoot"],
    ["--registry-root", "registryRoot"],
    ["--evidence-root", "evidenceRoot"],
    ["--write", "write"]
  ]);
  const options = {
    submission: null,
    bindings: null,
    repositoryRoot: null,
    registryRoot: null,
    evidenceRoot: null,
    write: null
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const separator = token.indexOf("=");
    const name = separator === -1 ? token : token.slice(0, separator);
    const key = definitions.get(name);
    if (!key || seen.has(name)) throw new LaunchBundleError("USAGE_ERROR", `unknown or repeated option ${name}`);
    seen.add(name);
    const value = separator === -1 ? argv[++index] : token.slice(separator + 1);
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) throw new LaunchBundleError("USAGE_ERROR", `${name} requires a value`);
    options[key] = value;
  }
  for (const key of ["submission", "bindings", "repositoryRoot", "registryRoot", "evidenceRoot"]) {
    if (options[key] === null) throw new LaunchBundleError("USAGE_ERROR", `missing --${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return options;
}

function realDirectory(input, label) {
  try {
    const target = fs.realpathSync(path.resolve(input));
    if (!fs.statSync(target).isDirectory()) throw new Error("not a directory");
    return target;
  } catch {
    throw new LaunchBundleError("INVALID_PATH", `${label} must be an existing real directory`);
  }
}

function regularFile(repositoryRoot, input, label) {
  const target = safeInside(repositoryRoot, input, false);
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 2 || stat.size > MAX_INPUT_BYTES) throw new LaunchBundleError("INVALID_PATH", `${label} must be a bounded regular file`);
  return target;
}

function writablePath(repositoryRoot, input) {
  const target = safeInside(repositoryRoot, input, true);
  const parent = path.dirname(target);
  if (!fs.existsSync(parent) || fs.lstatSync(parent).isSymbolicLink() || !fs.statSync(parent).isDirectory()) throw new LaunchBundleError("INVALID_PATH", "launch-bundle output parent must be an existing real directory");
  if (fs.existsSync(target)) throw new LaunchBundleError("OUTPUT_EXISTS", "refusing to overwrite an existing launch-bundle output");
  return target;
}

function safeInside(repositoryRoot, input, allowMissing) {
  if (typeof input !== "string" || input.length === 0 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(input)) throw new LaunchBundleError("INVALID_PATH", "path contains unsafe characters");
  try {
    return assertInsideRepository(repositoryRoot, path.resolve(repositoryRoot, input), { allowMissing });
  } catch (error) {
    throw new LaunchBundleError("INVALID_PATH", error.message);
  }
}

function readJson(target, label) {
  try {
    return parseBoundedStrictJsonBytes(fs.readFileSync(target), {
      maxSourceBytes: MAX_INPUT_BYTES,
      maxDepth: 256,
      maxNodes: 250_000,
      maxNumberCharacters: MAX_INPUT_BYTES
    });
  } catch {
    throw new LaunchBundleError("JSON_INVALID", `${label} must be duplicate-free UTF-8 JSON`);
  }
}

function writeAtomically(target, contents) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${process.pid}`);
  if (fs.existsSync(temporary)) throw new LaunchBundleError("OUTPUT_TEMPORARY_EXISTS", "refusing to reuse a launch-bundle temporary file");
  try {
    fs.writeFileSync(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function failure(error) {
  const known = error instanceof LaunchBundleError;
  const payload = {
    schemaVersion: "1.0.0",
    command: "launch-bundle",
    ok: false,
    error: {
      code: known ? error.code : "INTERNAL_ERROR",
      message: known ? error.message : "launch-bundle failed without a safe diagnostic"
    }
  };
  if (known && error.details !== null) payload.error.details = error.details;
  return payload;
}

function relative(repositoryRoot, target) {
  return path.relative(repositoryRoot, target).split(path.sep).join("/");
}
