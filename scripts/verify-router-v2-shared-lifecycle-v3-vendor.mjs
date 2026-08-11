#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST_PATH =
  "lib/vendor/router-v2-shared-lifecycle-v3/manifest.json";
const TARGET_ROOT = "lib/vendor/router-v2-shared-lifecycle-v3";
const AUTHORITY_COMMIT = "a017d750fc3ad0805614487a7387c7e195b65bd0";
const AUTHORITY_TREE = "e54f9835068973befd79203aad98aee82552996c";
const AUTHORITY_MANIFEST_SHA256 =
  "fc5744aafd501601d828f026f46a05c00f310ef367f7fad547c05ad64710aa13";
const PORTABLE_BUNDLE_SHA256 =
  "7ccb8b73a2c35a803b31c8c4cca25e84b4c138ee5f61510eb182064a041a1886";
const FORBIDDEN_SOURCE = [
  /\b(?:eval)\s*\(/u,
  /\bnew\s+Function\s*\(/u,
  /\bimport\s*\(/u,
  /(?:^|[\n;])\s*import\s+[^;]*["'](?:node:)?(?:child_process|fs|net|tar)["']/mu,
  /(?:^|[\n;])\s*import\s+[^;]*["'](?:pg|postgres|tar-fs|tar-stream)["']/mu,
];

export async function verifyRouterV2SharedLifecycleV3Vendor(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const manifestPath = input.manifestPath ?? MANIFEST_PATH;
  const manifest = JSON.parse(await readFile(resolve(root, manifestPath), "utf8"));
  assertWebsiteManifest(manifest);

  const sourceManifestBytes = await readBound(
    root,
    manifest.sourceManifest.path,
    manifest.sourceManifest,
  );
  if (sha256(sourceManifestBytes) !== AUTHORITY_MANIFEST_SHA256) {
    throw new Error("Authority V3 source manifest drifted");
  }
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  assertSourceManifest(sourceManifest, manifest);
  assertExactSourceFileBindings(sourceManifest.files, manifest.files);

  const expectedInventory = new Set([manifestPath, manifest.sourceManifest.path]);
  for (const file of manifest.files) {
    const bytes = await readBound(root, file.vendoredPath, file);
    if (bytes.byteLength !== file.bytes) {
      throw new Error(`Authority V3 file byte count drifted: ${file.vendoredPath}`);
    }
    expectedInventory.add(file.vendoredPath);
    if (file.vendoredPath.endsWith(".json")) {
      JSON.parse(bytes.toString("utf8"));
    }
  }
  await assertExactInventory(root, expectedInventory);

  const bundleFile = manifest.files.find((file) =>
    file.sourcePath.endsWith("router-v2-shared-lifecycle-portable.v3.mjs"));
  const sourceMapFile = manifest.files.find((file) =>
    file.sourcePath.endsWith("router-v2-shared-lifecycle-portable.v3.mjs.map"));
  if (
    !bundleFile
    || !sourceMapFile
    || bundleFile.sha256 !== PORTABLE_BUNDLE_SHA256
  ) throw new Error("Authority V3 portable bundle binding is invalid");
  const bundle = (await readFile(resolve(root, bundleFile.vendoredPath))).toString("utf8");
  for (const pattern of FORBIDDEN_SOURCE) {
    if (pattern.test(bundle)) {
      throw new Error(`Authority V3 portable bundle violates ${pattern}`);
    }
  }
  const sourceMap = JSON.parse(await readFile(
    resolve(root, sourceMapFile.vendoredPath),
    "utf8",
  ));
  if (
    sourceMap.version !== 3
    || !Array.isArray(sourceMap.sources)
    || !Array.isArray(sourceMap.sourcesContent)
    || sourceMap.sources.length !== sourceMap.sourcesContent.length
    || sourceMap.sourcesContent.length === 0
    || sourceMap.sourcesContent.some((value) => typeof value !== "string")
  ) throw new Error("Authority V3 portable source map is incomplete");

  for (const path of manifest.admission.hardDenyStandaloneSchemaPaths) {
    const record = manifest.files.find((file) => file.sourcePath === path);
    if (!record) throw new Error(`Authority V3 hard-DENY schema is unbound: ${path}`);
    const schema = JSON.parse(await readFile(resolve(root, record.vendoredPath), "utf8"));
    if (
      !Object.hasOwn(schema, "not")
      || schema.not === null
      || typeof schema.not !== "object"
      || Array.isArray(schema.not)
      || Object.keys(schema.not).length !== 0
    ) throw new Error(`Authority V3 schema is not unconditional hard-DENY: ${path}`);
  }

  return Object.freeze({
    authorityCommit: manifest.authority.commit,
    authorityTree: manifest.authority.tree,
    contractCommit: manifest.contract.commit,
    contractTree: manifest.contract.tree,
    sourceManifestSha256: manifest.sourceManifest.sha256,
    bundleSha256: bundleFile.sha256,
    files: manifest.files.length,
    admittedSchemas: manifest.admission.admittedExactSchemaPaths.length,
    hardDenySchemas: manifest.admission.hardDenyStandaloneSchemaPaths.length,
    activationState: manifest.lifecycle.activationState,
  });
}

function assertExactSourceFileBindings(sourceFiles, vendoredFiles) {
  if (
    !Array.isArray(sourceFiles)
    || sourceFiles.length !== 33
    || sourceFiles.length !== vendoredFiles.length
  ) throw new Error("Authority V3 file binding inventory is invalid");
  const bySourcePath = new Map();
  for (const source of sourceFiles) {
    if (
      !isSafeRelativePath(source?.path)
      || typeof source.bytes !== "number"
      || !/^sha256:[0-9a-f]{64}$/u.test(source.sha256)
      || bySourcePath.has(source.path)
    ) throw new Error("Authority V3 source file binding is ambiguous");
    bySourcePath.set(source.path, source);
  }
  const seenVendoredPaths = new Set();
  for (const vendored of vendoredFiles) {
    const source = bySourcePath.get(vendored?.sourcePath);
    const expectedPath = `${TARGET_ROOT}/${vendored?.sourcePath ?? ""}`;
    if (
      !source
      || vendored.vendoredPath !== expectedPath
      || seenVendoredPaths.has(vendored.vendoredPath)
      || vendored.bytes !== source.bytes
      || vendored.sha256 !== source.sha256.slice("sha256:".length)
    ) throw new Error("Authority V3 vendored file does not match source manifest");
    seenVendoredPaths.add(vendored.vendoredPath);
    bySourcePath.delete(vendored.sourcePath);
  }
  if (bySourcePath.size !== 0 || seenVendoredPaths.size !== 33) {
    throw new Error("Authority V3 file bindings are not bijective");
  }
}

function assertWebsiteManifest(manifest) {
  if (
    manifest.schemaVersion
      !== "programmable.website-router-v2-shared-lifecycle-vendor.v3"
    || manifest.authority?.commit !== AUTHORITY_COMMIT
    || manifest.authority?.tree !== AUTHORITY_TREE
    || manifest.authority?.publicExport
      !== "@programmable/autonomous-approval-v1/router-v2-shared-lifecycle-v3"
    || manifest.sourceManifest?.sha256 !== AUTHORITY_MANIFEST_SHA256
    || manifest.lifecycle?.version !== "3.0.0"
    || manifest.lifecycle?.deploymentState !== "UNDEPLOYED"
    || manifest.lifecycle?.activationState !== "DENY"
    || manifest.lifecycle?.authorityIoState
      !== "HARD_DENY_REQUIRES_VERSIONED_DEPLOYMENT_BOUND_SUCCESSOR"
    || manifest.lifecycle?.websiteBindingState !== "UNBOUND_EXTERNAL_WRITER_DENY"
    || !Array.isArray(manifest.lifecycle?.requiredServiceEnvironmentVariableNames)
    || manifest.lifecycle.requiredServiceEnvironmentVariableNames.length !== 0
    || !Array.isArray(manifest.files)
    || manifest.files.length !== 33
    || !Array.isArray(manifest.runtimeExports)
    || !Array.isArray(manifest.admission?.admittedExactSchemaPaths)
    || manifest.admission.admittedExactSchemaPaths.length !== 6
    || !Array.isArray(manifest.admission?.hardDenyStandaloneSchemaPaths)
    || manifest.admission.hardDenyStandaloneSchemaPaths.length !== 17
  ) throw new Error("Website Authority V3 vendor manifest is invalid");
}

function assertSourceManifest(source, website) {
  if (
    source.schemaVersion
      !== "programmable.router-v2-shared-lifecycle-artifact-manifest.v3"
    || source.manifestHash !== website.sourceManifest.semanticHash
    || source.deploymentState !== "UNDEPLOYED"
    || source.activationState !== "DENY"
    || source.authorityIoState
      !== "HARD_DENY_REQUIRES_VERSIONED_DEPLOYMENT_BOUND_SUCCESSOR"
    || source.contractDeploymentBinding !== null
    || source.profileCapabilityBinding !== null
    || source.externalActionOccurred !== false
    || source.hookemonState !== "DENY"
    || source.shardsState !== "DENY"
    || JSON.stringify(source.contract) !== JSON.stringify(website.contract)
    || JSON.stringify(source.admittedExactSchemaPaths)
      !== JSON.stringify(website.admission.admittedExactSchemaPaths)
    || JSON.stringify(source.hardDenyStandaloneSchemaPaths)
      !== JSON.stringify(website.admission.hardDenyStandaloneSchemaPaths)
  ) throw new Error("Authority V3 source manifest no longer matches Website DENY");
}

async function assertExactInventory(root, expected) {
  const actual = await walkFiles(resolve(root, TARGET_ROOT), root);
  const normalizedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(normalizedExpected)) {
    throw new Error("Authority V3 vendor inventory drifted");
  }
}

async function walkFiles(directory, root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(path, root));
    else if (entry.isFile()) result.push(relative(root, path));
    else throw new Error("Authority V3 vendor inventory contains a non-file");
  }
  return result.sort();
}

async function readBound(root, path, receipt) {
  if (!isSafeRelativePath(path) || !/^[0-9a-f]{64}$/u.test(receipt.sha256)) {
    throw new Error("Authority V3 vendor path binding is invalid");
  }
  const bytes = await readFile(resolve(root, path));
  if (sha256(bytes) !== receipt.sha256) {
    throw new Error(`Authority V3 vendor bytes drifted: ${path}`);
  }
  return bytes;
}

function isSafeRelativePath(value) {
  return typeof value === "string"
    && !value.startsWith("/")
    && !value.includes("..")
    && /^[a-zA-Z0-9/_.-]+$/u.test(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyRouterV2SharedLifecycleV3Vendor()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "verification failed"}\n`,
      );
      process.exitCode = 1;
    });
}
