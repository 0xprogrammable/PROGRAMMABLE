#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

const ADAPTER_COMMIT = "b180aca739e0745d16618542052e44b89e177bae";
const ADAPTER_TREE = "b7a90a8f7d0e48c581bf212595a1ad5d5906153f";
const BUNDLE_SHA256 =
  "2857f80616cd9dd3da6128a298f935c2cdc7acc8909bfd7fad58ed82776241de";
const SOURCE_DIRECTORY = "services/autonomous-approval-v1";
const PORTABLE_DIRECTORY = "artifacts/manual-router-portable-v2";
const GOLDEN =
  "artifacts/manual-router-authority-v2/manual-router-v2-disabled-golden.v1.json";
const TARGET_DIRECTORY = "lib/vendor/manual-router-authority-v2";

const [sourceArgument] = process.argv.slice(2);
if (!sourceArgument) {
  throw new Error("usage: vendor-manual-router-authority-v2.mjs <adapter-root>");
}

const websiteRoot = process.cwd();
const adapterRoot = resolve(sourceArgument);
const sourceRoot = join(adapterRoot, SOURCE_DIRECTORY);
assertExactCleanGit(adapterRoot);

const targetRoot = join(websiteRoot, TARGET_DIRECTORY);
const artifactsRoot = join(targetRoot, "artifacts");
await rm(targetRoot, { recursive: true, force: true });
await mkdir(artifactsRoot, { recursive: true });

const portableNames = [
  "manual-router-portable.v2.mjs",
  "manual-router-portable.v2.mjs.map",
  "manual-router-portable.v2.metafile.json",
  "manual-router-portable.v2.closure.json",
];
for (const name of portableNames) {
  await cp(join(sourceRoot, PORTABLE_DIRECTORY, name), join(targetRoot, name));
}

const schemaNames = (await readdir(join(sourceRoot, "schemas")))
  .filter((name) => /^manual-router-v2-.+\.schema\.json$/u.test(name))
  .sort();
for (const name of schemaNames) {
  await cp(join(sourceRoot, "schemas", name), join(artifactsRoot, name));
}
await cp(join(sourceRoot, GOLDEN), join(artifactsRoot, basename(GOLDEN)));

const closure = JSON.parse(await readFile(
  join(sourceRoot, PORTABLE_DIRECTORY, portableNames[3]),
  "utf8",
));
const bundle = await fileReceipt(join(targetRoot, portableNames[0]));
if (bundle.sha256 !== BUNDLE_SHA256) {
  throw new Error("Authority V2 bundle does not match the frozen release");
}
const files = Object.fromEntries(await Promise.all(portableNames.map(async (name) => [
  name,
  await fileReceipt(join(targetRoot, name)),
])));
const artifactNames = [...schemaNames, basename(GOLDEN)];
const artifacts = await Promise.all(artifactNames.map(async (name) => ({
  sourcePath: name === basename(GOLDEN) ? GOLDEN : `schemas/${name}`,
  vendoredPath: relative(websiteRoot, join(artifactsRoot, name)),
  ...await fileReceipt(join(artifactsRoot, name)),
})));
const sourceInputs = await Promise.all(closure.inputPaths.map(async (path) => ({
  path,
  ...await fileReceipt(join(sourceRoot, path)),
})));
const packageJson = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"));
const manifest = {
  schemaVersion: "programmable.website-manual-router-vendor.v2",
  adapter: {
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    publicExport: "./manual-router-v2",
    sourceEntry: closure.entryPoint,
    commit: ADAPTER_COMMIT,
    tree: ADAPTER_TREE,
    provisionalDirtySource: false,
  },
  exports: closure.runtimeExports,
  bundle: {
    path: relative(websiteRoot, join(targetRoot, portableNames[0])),
    ...bundle,
    sourceMapPath: relative(websiteRoot, join(targetRoot, portableNames[1])),
    sourceMapSha256: files[portableNames[1]].sha256,
    metafilePath: relative(websiteRoot, join(targetRoot, portableNames[2])),
    metafileSha256: files[portableNames[2]].sha256,
    closurePath: relative(websiteRoot, join(targetRoot, portableNames[3])),
    closureSha256: files[portableNames[3]].sha256,
  },
  closure: sourceInputs,
  artifacts,
};
await writeFile(
  join(targetRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

function assertExactCleanGit(root) {
  const git = (args) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  }).trim();
  if (
    git(["rev-parse", "HEAD"]) !== ADAPTER_COMMIT
    || git(["rev-parse", "HEAD^{tree}"]) !== ADAPTER_TREE
    || git(["status", "--porcelain=v1", "--untracked-files=all"]) !== ""
  ) throw new Error("Authority V2 source is not the exact clean frozen tree");
}

async function fileReceipt(path) {
  const bytes = await readFile(path);
  return {
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
