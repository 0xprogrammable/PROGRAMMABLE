import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build, version as esbuildVersion } from "esbuild";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputDirectory = resolve(root, "artifacts/manual-router-portable-v1");
const paths = Object.freeze({
  bundle: resolve(outputDirectory, "manual-router-portable.v1.mjs"),
  sourceMap: resolve(outputDirectory, "manual-router-portable.v1.mjs.map"),
  metafile: resolve(outputDirectory, "manual-router-portable.v1.metafile.json"),
  closure: resolve(outputDirectory, "manual-router-portable.v1.closure.json"),
});
const arguments_ = process.argv.slice(2);
if (arguments_.length !== 1 || !["--check", "--write"].includes(arguments_[0])) {
  throw new Error(
    "Usage: node scripts/generate-manual-router-portable-bundle.mjs --check|--write",
  );
}

const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/public-api/manual-router.ts"],
  outfile: paths.bundle,
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
const bundle = output(result.outputFiles, ".mjs");
const sourceMap = output(result.outputFiles, ".mjs.map");
const metafile = `${JSON.stringify(sortJson(result.metafile), null, 2)}\n`;
const parsedMap = JSON.parse(sourceMap.text);
if (
  !Array.isArray(parsedMap.sources)
  || !Array.isArray(parsedMap.sourcesContent)
  || parsedMap.sources.length !== parsedMap.sourcesContent.length
  || parsedMap.sourcesContent.some((source) => typeof source !== "string")
) throw new Error("Portable manual Router source map does not retain exact sourcesContent.");

const inputPaths = Object.keys(result.metafile.inputs).sort(compare);
const bundleMetadata = Object.values(result.metafile.outputs).find((value) =>
  value.entryPoint === "src/public-api/manual-router.ts");
if (bundleMetadata === undefined || !Array.isArray(bundleMetadata.exports)) {
  throw new Error("Portable manual Router metafile omits the entry-point exports.");
}
const runtimeExports = [...bundleMetadata.exports].sort(compare);
const externalImports = [...new Set(Object.values(result.metafile.outputs)
  .flatMap((value) => value.imports)
  .filter((value) => value.external)
  .map((value) => value.path))].sort(compare);
const forbiddenInput = inputPaths.find((path) =>
  /(?:^|\/)(?:runner|postgres|persistence|runtime)(?:\/|$)/u.test(path)
  || /\/(?:router-custom-graph-compiler|operator(?:-cli)?|self-service|durable-(?:artifact|bundle)|json-schema)\.ts$/u
    .test(path));
if (forbiddenInput !== undefined) {
  throw new Error(`Portable manual Router closure contains forbidden input ${forbiddenInput}.`);
}
if (externalImports.some((path) => !["node:crypto", "node:util"].includes(path))) {
  throw new Error(`Portable manual Router closure has unsupported external imports: ${externalImports}.`);
}
for (const input of Object.values(result.metafile.inputs)) {
  if (input.imports.some((entry) => entry.kind === "dynamic-import")) {
    throw new Error("Portable manual Router closure contains a dynamic import.");
  }
}
if (/\beval\s*\(|\bnew\s+Function\b|\brequire\s*\(|\bcreateRequire\b/u.test(bundle.text)) {
  throw new Error("Portable manual Router bundle contains dynamic code or CommonJS loading.");
}
if (/\bAjv\b|ajv\/dist|codegen/u.test(bundle.text)) {
  throw new Error("Portable manual Router bundle contains AJV code generation.");
}
if (bundle.contents.byteLength > 1_048_576 || sourceMap.contents.byteLength > 1_048_576) {
  throw new Error("Portable manual Router bundle or source map exceeds 1 MiB.");
}

const metafileBytes = Buffer.from(metafile, "utf8");
const closureCore = {
  schemaVersion: "programmable.manual-router-portable-closure.v1",
  entryPoint: "src/public-api/manual-router.ts",
  bundlePath: "artifacts/manual-router-portable-v1/manual-router-portable.v1.mjs",
  sourceMapPath: "artifacts/manual-router-portable-v1/manual-router-portable.v1.mjs.map",
  metafilePath: "artifacts/manual-router-portable-v1/manual-router-portable.v1.metafile.json",
  esbuildVersion,
  platform: "node",
  format: "esm",
  target: "node20",
  minified: false,
  bundleBytes: bundle.contents.byteLength,
  bundleSha256: sha256(bundle.contents),
  sourceMapBytes: sourceMap.contents.byteLength,
  sourceMapSha256: sha256(sourceMap.contents),
  metafileBytes: metafileBytes.byteLength,
  metafileSha256: sha256(metafileBytes),
  inputPaths,
  externalImports,
  runtimeExports,
};
const closure = `${JSON.stringify({
  ...closureCore,
  closureHash: canonicalSha256(closureCore.schemaVersion, closureCore),
}, null, 2)}\n`;
const expected = new Map([
  [paths.bundle, bundle.text],
  [paths.sourceMap, sourceMap.text],
  [paths.metafile, metafile],
  [paths.closure, closure],
]);
if (arguments_[0] === "--write") {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([...expected].map(([path, bytes]) =>
    writeFile(path, bytes, { encoding: "utf8", mode: 0o644 })));
} else {
  for (const [path, bytes] of expected) {
    let observed;
    try {
      observed = await readFile(path, "utf8");
    } catch (error) {
      throw new Error(`Portable manual Router artifact is missing at ${path}.`, { cause: error });
    }
    if (observed !== bytes) {
      throw new Error(`Portable manual Router artifact drifted at ${path}.`);
    }
  }
}
process.stdout.write(`${closureCore.bundleSha256}\n`);

function output(files, suffix) {
  const selected = files.find((file) => file.path.endsWith(suffix));
  if (selected === undefined) throw new Error(`esbuild omitted ${suffix} output.`);
  return selected;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalSha256(domain, value) {
  return sha256(Buffer.from(`${domain}\0${canonicalize(value)}`, "utf8"));
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort(compare).map((key) =>
    `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, sortJson(value[key])]));
}

function compare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
