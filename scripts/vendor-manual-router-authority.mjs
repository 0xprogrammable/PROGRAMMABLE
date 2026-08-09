#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build, version as esbuildVersion } from "esbuild";

const OUTPUT_DIRECTORY = "lib/vendor/manual-router-authority-v1";
const MANIFEST_NAME = "manifest.json";
const SOURCE_ENTRY = "src/public-api/manual-router.ts";
const ADAPTER_ARTIFACT_DIRECTORY = "artifacts/manual-router-portable-v1";
const BUNDLE_NAME = "manual-router-portable.v1.mjs";
const SOURCE_MAP_NAME = `${BUNDLE_NAME}.map`;
const METAFILE_NAME = "manual-router-portable.v1.metafile.json";
const CLOSURE_NAME = "manual-router-portable.v1.closure.json";
const REPRODUCTION_SCRIPT = "scripts/generate-manual-router-portable-bundle.mjs";
const ALLOWED_EXTERNAL_IMPORTS = new Set(["node:crypto", "node:util"]);
const FORBIDDEN_SPECIFIERS = Object.freeze([
  "child_process", "fs", "net", "node:child_process", "node:fs",
  "node:net", "node:tar", "pg", "postgres", "tar", "tar-fs",
  "tar-stream",
]);
const FORBIDDEN_PATH = /(?:^|\/)(?:compiler|runner|postgres|persistence|runtime)(?:\/|\.|$)/iu;
const FORBIDDEN_RUNTIME_SOURCE = [
  /\b(?:eval)\s*\(/u,
  /\bnew\s+Function\b/u,
  /\bimport\s*\(/u,
  /\brequire\s*\(/u,
  /\bcreateRequire\b/u,
  /\bAjv\b|ajv\/dist|codegen/u,
];

/**
 * Rebuilds the Adapter's public ./manual-router entry independently, proves
 * byte parity with its reviewed artifacts, then vendors those exact bytes.
 */
export async function vendorManualRouterAuthorityV1(input) {
  const websiteRoot = resolve(input.websiteRoot);
  const sourceRoot = resolve(input.sourceRoot);
  assertGitIdentity(
    sourceRoot,
    input.expectedCommit,
    input.expectedTree,
    input.allowDirtyProvisional === true,
  );
  const packageJson = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"));
  if (
    packageJson?.exports?.["./manual-router"] === undefined
    || packageJson?.private !== true
  ) throw new Error("Adapter package does not expose the reviewed ./manual-router boundary");
  const generated = await rebuildAdapterBundle(sourceRoot);
  const adapterArtifactDirectory = join(sourceRoot, ADAPTER_ARTIFACT_DIRECTORY);
  const observed = Object.freeze({
    bundle: await readFile(join(adapterArtifactDirectory, BUNDLE_NAME), "utf8"),
    sourceMap: await readFile(join(adapterArtifactDirectory, SOURCE_MAP_NAME), "utf8"),
    metafile: await readFile(join(adapterArtifactDirectory, METAFILE_NAME), "utf8"),
    closure: await readFile(join(adapterArtifactDirectory, CLOSURE_NAME), "utf8"),
  });
  if (
    observed.bundle !== generated.bundle
    || observed.sourceMap !== generated.sourceMap
    || observed.metafile !== generated.metafile
  ) throw new Error("Adapter portable artifact is not byte-identical to an independent rebuild");
  const closure = assertAdapterClosure(
    JSON.parse(observed.closure),
    observed,
    generated.inputPaths,
    generated.externalImports,
    generated.runtimeExports,
  );
  assertRuntimeSourceAllowed(observed.bundle);
  assertReadableSourceMap(observed.sourceMap, BUNDLE_NAME);
  const sourceInputs = await sourceInputManifest(sourceRoot, generated.inputPaths);

  const outputDirectory = join(websiteRoot, OUTPUT_DIRECTORY);
  const artifactsDirectory = join(outputDirectory, "artifacts");
  // This directory is generated exclusively by this command. Recreate it so
  // an older Golden or schema can never survive beside the exact manifest.
  await rm(artifactsDirectory, { recursive: true, force: true });
  await mkdir(artifactsDirectory, { recursive: true });
  for (const [name, source] of [
    [BUNDLE_NAME, observed.bundle],
    [SOURCE_MAP_NAME, observed.sourceMap],
    [METAFILE_NAME, observed.metafile],
    [CLOSURE_NAME, observed.closure],
  ]) await writeFile(join(outputDirectory, name), source, "utf8");

  const goldenPath = await exactGoldenPath(sourceRoot);
  const artifactPaths = [
    ...await exactSchemaPaths(sourceRoot),
    goldenPath,
    REPRODUCTION_SCRIPT,
  ];
  const artifacts = [];
  for (const path of artifactPaths) {
    const bytes = await readFile(join(sourceRoot, path));
    const target = join(artifactsDirectory, basename(path));
    await writeFile(target, bytes);
    artifacts.push(Object.freeze({
      sourcePath: path,
      vendoredPath: relative(websiteRoot, target),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    }));
  }

  const bundlePath = join(outputDirectory, BUNDLE_NAME);
  const sourceMapPath = join(outputDirectory, SOURCE_MAP_NAME);
  const metafilePath = join(outputDirectory, METAFILE_NAME);
  const closurePath = join(outputDirectory, CLOSURE_NAME);
  const manifest = Object.freeze({
    schemaVersion: "programmable.website-manual-router-vendor.v1",
    adapter: Object.freeze({
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      publicExport: "./manual-router",
      sourceEntry: SOURCE_ENTRY,
      commit: input.expectedCommit,
      tree: input.expectedTree,
      provisionalDirtySource: input.allowDirtyProvisional === true,
    }),
    exports: Object.freeze(closure.runtimeExports),
    bundle: Object.freeze({
      path: relative(websiteRoot, bundlePath),
      bytes: Buffer.byteLength(observed.bundle, "utf8"),
      sha256: sha256(observed.bundle),
      sourceMapPath: relative(websiteRoot, sourceMapPath),
      sourceMapSha256: sha256(observed.sourceMap),
      metafilePath: relative(websiteRoot, metafilePath),
      metafileSha256: sha256(observed.metafile),
      closurePath: relative(websiteRoot, closurePath),
      closureSha256: sha256(observed.closure),
    }),
    closure: sourceInputs,
    artifacts: Object.freeze(artifacts),
  });
  await writeFile(
    join(outputDirectory, MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

async function rebuildAdapterBundle(root) {
  const outfile = join(root, ADAPTER_ARTIFACT_DIRECTORY, BUNDLE_NAME);
  const result = await build({
    absWorkingDir: root,
    entryPoints: [SOURCE_ENTRY],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: ["node20"],
    minify: false,
    treeShaking: true,
    charset: "utf8",
    legalComments: "none",
    sourcemap: "external",
    sourcesContent: true,
    metafile: true,
    write: false,
    logLevel: "silent",
  });
  const bundle = requiredOutput(result.outputFiles, ".mjs").text;
  const sourceMap = requiredOutput(result.outputFiles, ".mjs.map").text;
  const metafile = `${JSON.stringify(sortJson(result.metafile), null, 2)}\n`;
  const inputPaths = Object.keys(result.metafile.inputs).sort(compare);
  const externalImports = [...new Set(Object.values(result.metafile.outputs)
    .flatMap((value) => value.imports)
    .filter((value) => value.external)
    .map((value) => value.path))].sort(compare);
  const runtimeExports = [...new Set(Object.values(result.metafile.outputs)
    .flatMap((value) => value.exports))].sort(compare);
  assertClosureAllowed(inputPaths, externalImports, result.metafile.inputs);
  assertRuntimeSourceAllowed(bundle);
  assertReadableSourceMap(sourceMap, BUNDLE_NAME);
  return Object.freeze({
    bundle,
    sourceMap,
    metafile,
    inputPaths,
    externalImports,
    runtimeExports,
  });
}

function assertGitIdentity(root, expectedCommit, expectedTree, allowDirtyProvisional) {
  if (!/^[0-9a-f]{40}$/u.test(expectedCommit) || !/^[0-9a-f]{40}$/u.test(expectedTree)) {
    throw new Error("expected Adapter commit and tree must be exact Git object ids");
  }
  const commit = git(root, ["rev-parse", "HEAD"]);
  const tree = git(root, ["rev-parse", "HEAD^{tree}"]);
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (
    commit !== expectedCommit
    || tree !== expectedTree
    || (status !== "" && !allowDirtyProvisional)
  ) {
    throw new Error("Adapter source is not the exact clean WRITER_STABLE tree");
  }
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function exactGoldenPath(root) {
  const directories = [
    "artifacts/manual-router-authority-v1",
    "test/fixtures",
  ];
  const matches = [];
  for (const directory of directories) {
    let names = [];
    try {
      names = await readdir(join(root, directory));
    } catch {
      names = [];
    }
    for (const name of names.filter((value) =>
      /^manual-router-authority-golden\.v[1-9][0-9]*\.json$/u.test(value))) {
      matches.push({ name, path: `${directory}/${name}` });
    }
  }
  if (matches.length < 1) throw new Error("Adapter has no Router golden fixture");
  matches.sort((left, right) => goldenVersion(right.name) - goldenVersion(left.name));
  return matches[0].path;
}

async function exactSchemaPaths(root) {
  const names = (await readdir(join(root, "schemas"))).filter((name) =>
    /^manual-router-[a-z0-9-]+\.v1\.schema\.json$/u.test(name)).sort(compare);
  for (const required of [
    "manual-router-complete-signed-artifact.v1.schema.json",
    "manual-router-signed-artifact-publish-request.v1.schema.json",
    "manual-router-operator-reissue-state-request.v1.schema.json",
    "manual-router-operator-reissue-state-response.v1.schema.json",
  ]) {
    if (!names.includes(required)) {
      throw new Error(`Adapter is missing required Router schema ${required}`);
    }
  }
  return names.map((name) => `schemas/${name}`);
}

function goldenVersion(name) {
  return Number(name.match(/\.v([1-9][0-9]*)\.json$/u)?.[1] ?? "0");
}

function requiredOutput(files, suffix) {
  const matches = files.filter((file) => file.path.endsWith(suffix));
  if (matches.length !== 1) throw new Error(`expected one generated ${suffix} file`);
  return matches[0];
}

function assertReadableSourceMap(source, expectedFile) {
  const parsed = JSON.parse(source);
  if (
    parsed.version !== 3
    || (parsed.file !== undefined && parsed.file !== expectedFile)
    || !Array.isArray(parsed.sources)
    || !Array.isArray(parsed.sourcesContent)
    || parsed.sources.length !== parsed.sourcesContent.length
    || parsed.sourcesContent.some((value) => typeof value !== "string")
  ) throw new Error("portable Adapter source map does not embed its complete source closure");
}

async function sourceInputManifest(root, inputs) {
  const result = [];
  for (const path of inputs) {
    const bytes = await readFile(join(root, path));
    result.push(Object.freeze({ path, bytes: bytes.byteLength, sha256: sha256(bytes) }));
  }
  return Object.freeze(result);
}

function assertAdapterClosure(
  raw,
  observed,
  inputPaths,
  externalImports,
  runtimeExports,
) {
  if (
    raw?.schemaVersion !== "programmable.manual-router-portable-closure.v1"
    || raw.entryPoint !== SOURCE_ENTRY
    || raw.esbuildVersion !== esbuildVersion
    || JSON.stringify(raw.inputPaths) !== JSON.stringify(inputPaths)
    || JSON.stringify(raw.externalImports) !== JSON.stringify(externalImports)
    || JSON.stringify(raw.runtimeExports) !== JSON.stringify(runtimeExports)
    || raw.bundleSha256 !== `sha256:${sha256(observed.bundle)}`
    || raw.sourceMapSha256 !== `sha256:${sha256(observed.sourceMap)}`
    || raw.metafileSha256 !== `sha256:${sha256(observed.metafile)}`
  ) throw new Error("Adapter portable closure manifest is not byte-bound");
  return raw;
}

function assertClosureAllowed(inputPaths, externalImports, inputs) {
  for (const path of inputPaths) {
    const normalized = path.replaceAll("\\", "/");
    if (
      FORBIDDEN_PATH.test(normalized)
      || FORBIDDEN_SPECIFIERS.some((specifier) =>
        normalized.includes(`/node_modules/${specifier}/`))
    ) throw new Error(`portable Adapter closure contains forbidden path: ${path}`);
    if (inputs[path]?.imports?.some((entry) => entry.kind === "dynamic-import")) {
      throw new Error(`portable Adapter closure contains dynamic import: ${path}`);
    }
  }
  if (externalImports.some((path) => !ALLOWED_EXTERNAL_IMPORTS.has(path))) {
    throw new Error(`portable Adapter closure has unsupported external imports: ${externalImports}`);
  }
}

function assertRuntimeSourceAllowed(source) {
  for (const pattern of FORBIDDEN_RUNTIME_SOURCE) {
    if (pattern.test(source)) throw new Error(`portable Adapter bundle violates ${pattern}`);
  }
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort(compare).map((key) =>
    [key, sortJson(value[key])]));
}

function compare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error("invalid vendor arguments");
    values.set(name, value);
  }
  for (const name of ["--source-root", "--expected-commit", "--expected-tree"]) {
    if (!values.has(name)) throw new Error(`${name} is required`);
  }
  return Object.freeze({
    websiteRoot: process.cwd(),
    sourceRoot: values.get("--source-root"),
    expectedCommit: values.get("--expected-commit"),
    expectedTree: values.get("--expected-tree"),
    allowDirtyProvisional: values.get("--allow-dirty-provisional") === "true",
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  vendorManualRouterAuthorityV1(parseArguments(process.argv.slice(2)))
    .then((manifest) => process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "vendor failed"}\n`);
      process.exitCode = 1;
    });
}
