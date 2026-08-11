#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const AUTHORITY_COMMIT = "a017d750fc3ad0805614487a7387c7e195b65bd0";
const AUTHORITY_TREE = "e54f9835068973befd79203aad98aee82552996c";
const AUTHORITY_MANIFEST_SHA256 =
  "fc5744aafd501601d828f026f46a05c00f310ef367f7fad547c05ad64710aa13";
const PORTABLE_BUNDLE_SHA256 =
  "7ccb8b73a2c35a803b31c8c4cca25e84b4c138ee5f61510eb182064a041a1886";
const SOURCE_DIRECTORY = "services/autonomous-approval-v1";
const SOURCE_MANIFEST =
  "artifacts/router-v2-shared-lifecycle-v3/artifact-manifest.v3.json";
const TARGET_DIRECTORY = "lib/vendor/router-v2-shared-lifecycle-v3";

const [sourceArgument] = process.argv.slice(2);
if (!sourceArgument) {
  throw new Error(
    "usage: vendor-router-v2-shared-lifecycle-v3.mjs <authority-root>",
  );
}

const websiteRoot = process.cwd();
const authorityRoot = resolve(sourceArgument);
const sourceRoot = join(authorityRoot, SOURCE_DIRECTORY);
const targetRoot = join(websiteRoot, TARGET_DIRECTORY);

assertExactCleanGit(authorityRoot);
const sourceManifestBytes = await readFile(join(sourceRoot, SOURCE_MANIFEST));
if (sha256(sourceManifestBytes) !== AUTHORITY_MANIFEST_SHA256) {
  throw new Error("Authority V3 manifest does not match the frozen release");
}
const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
assertFrozenSourceManifest(sourceManifest);

await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });
await writeFile(
  join(targetRoot, "artifact-manifest.v3.json"),
  sourceManifestBytes,
);

const files = [];
for (const file of sourceManifest.files) {
  assertSafeRelativePath(file.path);
  const sourcePath = join(sourceRoot, file.path);
  const bytes = await readFile(sourcePath);
  const receipt = fileReceipt(bytes);
  if (
    receipt.bytes !== file.bytes
    || `sha256:${receipt.sha256}` !== file.sha256
  ) throw new Error(`Authority V3 source receipt drifted: ${file.path}`);
  const targetPath = join(targetRoot, file.path);
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath);
  files.push(Object.freeze({
    sourcePath: file.path,
    vendoredPath: relative(websiteRoot, targetPath),
    ...receipt,
  }));
}

const closure = JSON.parse(await readFile(
  join(
    sourceRoot,
    "artifacts/router-v2-shared-lifecycle-v3/"
      + "router-v2-shared-lifecycle-portable.v3.closure.json",
  ),
  "utf8",
));
if (
  closure.bundleSha256 !== `sha256:${PORTABLE_BUNDLE_SHA256}`
  || closure.activationAllowed !== false
  || closure.deploymentState !== "UNDEPLOYED"
) throw new Error("Authority V3 portable closure is not source-only DENY");

const packageJson = JSON.parse(await readFile(
  join(sourceRoot, "package.json"),
  "utf8",
));
const websiteManifest = {
  schemaVersion: "programmable.website-router-v2-shared-lifecycle-vendor.v3",
  authority: {
    repository:
      "https://github.com/0xprogrammable/programmable-open-hook-v2-internal.git",
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    publicExport: sourceManifest.publicPackageExport,
    publicSource: sourceManifest.publicSourcePath,
    commit: AUTHORITY_COMMIT,
    tree: AUTHORITY_TREE,
  },
  sourceManifest: {
    path: relative(
      websiteRoot,
      join(targetRoot, "artifact-manifest.v3.json"),
    ),
    ...fileReceipt(sourceManifestBytes),
    semanticHash: sourceManifest.manifestHash,
  },
  lifecycle: {
    version: sourceManifest.lifecycleVersion,
    deploymentState: sourceManifest.deploymentState,
    activationState: sourceManifest.activationState,
    authorityIoState: sourceManifest.authorityIoState,
    websiteBindingState: sourceManifest.websiteBindingState,
    requiredServiceEnvironmentVariableNames:
      sourceManifest.requiredServiceEnvironmentVariableNames,
  },
  contract: sourceManifest.contract,
  admission: {
    policy: sourceManifest.standaloneSchemaAdmissionPolicy,
    admittedExactSchemaPaths: sourceManifest.admittedExactSchemaPaths,
    hardDenyStandaloneSchemaPaths:
      sourceManifest.hardDenyStandaloneSchemaPaths,
  },
  runtimeExports: closure.runtimeExports,
  files,
};
await writeFile(
  join(targetRoot, "manifest.json"),
  `${JSON.stringify(websiteManifest, null, 2)}\n`,
  "utf8",
);

function assertExactCleanGit(root) {
  const git = (args) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  }).trim();
  if (
    git(["rev-parse", "HEAD"]) !== AUTHORITY_COMMIT
    || git(["rev-parse", "HEAD^{tree}"]) !== AUTHORITY_TREE
    || git(["status", "--porcelain=v1", "--untracked-files=all"]) !== ""
  ) throw new Error("Authority V3 source is not the exact clean frozen tree");
}

function assertFrozenSourceManifest(manifest) {
  if (
    manifest.schemaVersion
      !== "programmable.router-v2-shared-lifecycle-artifact-manifest.v3"
    || manifest.packageName !== "@programmable/autonomous-approval-v1"
    || manifest.publicPackageExport
      !== "@programmable/autonomous-approval-v1/router-v2-shared-lifecycle-v3"
    || manifest.lifecycleVersion !== "3.0.0"
    || manifest.deploymentState !== "UNDEPLOYED"
    || manifest.activationState !== "DENY"
    || manifest.authorityIoState
      !== "HARD_DENY_REQUIRES_VERSIONED_DEPLOYMENT_BOUND_SUCCESSOR"
    || manifest.websiteBindingState !== "UNBOUND_EXTERNAL_WRITER_DENY"
    || manifest.contractDeploymentBinding !== null
    || manifest.profileCapabilityBinding !== null
    || manifest.externalActionOccurred !== false
    || manifest.hookemonState !== "DENY"
    || manifest.shardsState !== "DENY"
    || !Array.isArray(manifest.requiredServiceEnvironmentVariableNames)
    || manifest.requiredServiceEnvironmentVariableNames.length !== 0
    || !Array.isArray(manifest.files)
    || manifest.files.length !== 33
    || !Array.isArray(manifest.admittedExactSchemaPaths)
    || manifest.admittedExactSchemaPaths.length !== 6
    || !Array.isArray(manifest.hardDenyStandaloneSchemaPaths)
    || manifest.hardDenyStandaloneSchemaPaths.length !== 17
    || manifest.contract?.commit
      !== "ea0e4424b886a0c1ae928fc73d62bd8e907b44cd"
    || manifest.contract?.tree
      !== "8c5e0822d7ff256cad3d9e0350c980473d36aecc"
    || manifest.contract?.artifactSha256
      !== "sha256:f9d110d2850c4934ba0c22493eaa9d0f090bee6f0e6a1339ee3002344da1065a"
  ) throw new Error("Authority V3 source manifest is not the frozen DENY release");
}

function assertSafeRelativePath(value) {
  if (
    typeof value !== "string"
    || value.startsWith("/")
    || value.includes("..")
    || !/^[a-zA-Z0-9/_.-]+$/u.test(value)
  ) throw new Error("Authority V3 manifest contains an unsafe path");
}

function fileReceipt(bytes) {
  return {
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
