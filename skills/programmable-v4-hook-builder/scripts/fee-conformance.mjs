#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  createFeeConformanceManifest,
  validateFeeConformance
} from "./fee-conformance-core.mjs";

const USAGE = `Usage:
  fee-conformance.mjs check --root <candidate-root> --manifest <manifest.json>
  fee-conformance.mjs create --root <candidate-root> --source <source.sol> \\
    --artifact <artifact.json> --build-info <build-info.json> \\
    --evidence <evidence.json> --contract <ContractName> \\
    --supporting-source hook-factory:<factory.sol> --out <manifest.json> [--force]

The result is structural candidate evidence only. It is not an audit, deployment
receipt, runtime proof, or substitute for an isolated maintainer rebuild.`;

try {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "check") {
    requireOptions(options, ["root", "manifest"]);
    rejectOptions(options, ["source", "artifact", "buildInfo", "evidence", "contract", "out", "force", "supportingSource"]);
    const result = validateFeeConformance({ root: options.root, manifestPath: options.manifest });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } else if (command === "create") {
    requireOptions(options, ["root", "source", "artifact", "buildInfo", "evidence", "contract", "out", "supportingSource"]);
    rejectOptions(options, ["manifest"]);
    const root = fs.realpathSync(path.resolve(options.root));
    const out = resolveOutput(root, options.out);
    if (fs.existsSync(out) && !options.force) {
      throw new Error(`refusing to overwrite ${path.relative(root, out)} without --force`);
    }
    const supportingSources = options.supportingSource.map(parseSupportingSource);
    const manifest = createFeeConformanceManifest({
      root,
      source: options.source,
      artifact: options.artifact,
      buildInfo: options.buildInfo,
      evidence: options.evidence,
      contractName: options.contract,
      supportingSources
    });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "w" });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: "FEE_CONFORMANCE_MANIFEST_CREATED",
      manifest: path.relative(root, out).replaceAll("\\", "/"),
      next: "Run fee-conformance.mjs check against this manifest."
    }, null, 2)}\n`);
  } else {
    throw new Error(`unknown command ${command}`);
  }
} catch (error) {
  process.stderr.write(`fee-conformance.mjs: ${error.message}\n\n${USAGE}\n`);
  process.exitCode = 2;
}

function parseArguments(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  const command = argv[0];
  const options = {
    root: null,
    manifest: null,
    source: null,
    artifact: null,
    buildInfo: null,
    evidence: null,
    contract: null,
    out: null,
    force: false,
    supportingSource: []
  };
  const names = new Map([
    ["--root", "root"],
    ["--manifest", "manifest"],
    ["--source", "source"],
    ["--artifact", "artifact"],
    ["--build-info", "buildInfo"],
    ["--evidence", "evidence"],
    ["--contract", "contract"],
    ["--out", "out"]
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--force") {
      if (options.force) throw new Error("--force may only be provided once");
      options.force = true;
      continue;
    }
    if (token === "--supporting-source") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--supporting-source requires role:path");
      options.supportingSource.push(value);
      index += 1;
      continue;
    }
    const key = names.get(token);
    if (!key) throw new Error(`unknown option ${token}`);
    if (options[key] !== null) throw new Error(`${token} may only be provided once`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function requireOptions(options, keys) {
  for (const key of keys) {
    if (key === "supportingSource") {
      if (options.supportingSource.length === 0) throw new Error("--supporting-source is required");
    } else if (options[key] === null) {
      const flag = key === "buildInfo" ? "--build-info" : `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
      throw new Error(`${flag} is required`);
    }
  }
}

function rejectOptions(options, keys) {
  for (const key of keys) {
    const supplied = key === "supportingSource" ? options.supportingSource.length > 0 : Boolean(options[key]);
    if (supplied) throw new Error(`${key} is not valid for this command`);
  }
}

function parseSupportingSource(value) {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("--supporting-source must use role:path");
  }
  return { role: value.slice(0, separator), path: value.slice(separator + 1) };
}

function resolveOutput(root, requested) {
  const resolved = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(root, requested);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("--out must stay inside --root");
  }
  let cursor = root;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) break;
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error("--out may not contain symbolic links");
  }
  return resolved;
}
