#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST_PATH = "lib/vendor/manual-router-authority-v1/manifest.json";
const FORBIDDEN_SOURCE = [
  /\b(?:eval)\s*\(/u,
  /\bnew\s+Function\s*\(/u,
  /\bimport\s*\(/u,
  /(?:^|[\n;])\s*import\s+[^;]*["'](?:node:)?(?:child_process|fs|net|tar)["']/mu,
  /(?:^|[\n;])\s*import\s+[^;]*["'](?:pg|postgres|tar-fs|tar-stream)["']/mu,
];

export async function verifyManualRouterAuthorityVendorV1(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const manifestSource = await readFile(resolve(root, input.manifestPath ?? MANIFEST_PATH), "utf8");
  const manifest = JSON.parse(manifestSource);
  if (
    manifest.schemaVersion !== "programmable.website-manual-router-vendor.v1"
    || manifest.adapter?.publicExport !== "./manual-router"
    || (
      manifest.adapter?.provisionalDirtySource === true
      && input.allowProvisional !== true
    )
    || !/^[0-9a-f]{40}$/u.test(manifest.adapter?.commit)
    || !/^[0-9a-f]{40}$/u.test(manifest.adapter?.tree)
    || !Array.isArray(manifest.exports)
    || !Array.isArray(manifest.closure)
    || !Array.isArray(manifest.artifacts)
  ) throw new Error("manual Router vendor manifest is invalid");
  const bundle = await readBound(root, manifest.bundle.path, manifest.bundle);
  const sourceMap = await readBound(root, manifest.bundle.sourceMapPath, {
    sha256: manifest.bundle.sourceMapSha256,
  });
  await readBound(root, manifest.bundle.metafilePath, {
    sha256: manifest.bundle.metafileSha256,
  });
  await readBound(root, manifest.bundle.closurePath, {
    sha256: manifest.bundle.closureSha256,
  });
  if (bundle.byteLength !== manifest.bundle.bytes) {
    throw new Error("manual Router vendor bundle byte count drifted");
  }
  const source = bundle.toString("utf8");
  for (const pattern of FORBIDDEN_SOURCE) {
    if (pattern.test(source)) throw new Error(`manual Router vendor bundle violates ${pattern}`);
  }
  const parsedMap = JSON.parse(sourceMap.toString("utf8"));
  if (
    parsedMap.version !== 3
    || (
      parsedMap.file !== undefined
      && parsedMap.file !== "manual-router-portable.v1.mjs"
    )
    || !Array.isArray(parsedMap.sources)
    || !Array.isArray(parsedMap.sourcesContent)
    || parsedMap.sources.length !== parsedMap.sourcesContent.length
    || parsedMap.sourcesContent.some((value) => typeof value !== "string")
  ) throw new Error("manual Router vendor source map is incomplete");
  await assertExactArtifactInventory(root, manifest.artifacts);
  for (const artifact of manifest.artifacts) {
    const bytes = await readBound(root, artifact.vendoredPath, artifact);
    if (bytes.byteLength !== artifact.bytes) {
      throw new Error(`manual Router vendor artifact byte count drifted: ${artifact.vendoredPath}`);
    }
    if (artifact.vendoredPath.endsWith(".json")) {
      JSON.parse(bytes.toString("utf8"));
    }
  }
  return Object.freeze({
    commit: manifest.adapter.commit,
    tree: manifest.adapter.tree,
    bundleSha256: manifest.bundle.sha256,
    closureFiles: manifest.closure.length,
    artifacts: manifest.artifacts.length,
  });
}

async function assertExactArtifactInventory(root, artifacts) {
  const byDirectory = new Map();
  for (const artifact of artifacts) {
    const path = artifact?.vendoredPath;
    if (!isSafeRelativePath(path)) {
      throw new Error("manual Router vendor artifact path is invalid");
    }
    const directory = dirname(path);
    const expected = byDirectory.get(directory) ?? new Set();
    if (expected.has(basename(path))) {
      throw new Error("manual Router vendor artifact inventory is ambiguous");
    }
    expected.add(basename(path));
    byDirectory.set(directory, expected);
  }
  for (const [directory, expected] of byDirectory) {
    const entries = await readdir(resolve(root, directory), { withFileTypes: true });
    const actual = entries.map((entry) => {
      if (!entry.isFile()) {
        throw new Error("manual Router vendor artifact inventory contains a directory");
      }
      return entry.name;
    }).sort();
    const wanted = [...expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      throw new Error("manual Router vendor artifact inventory drifted");
    }
  }
}

async function readBound(root, relativePath, binding) {
  if (
    !isSafeRelativePath(relativePath)
    || !/^[0-9a-f]{64}$/u.test(binding.sha256)
  ) throw new Error("manual Router vendor path binding is invalid");
  const bytes = await readFile(resolve(root, relativePath));
  if (sha256(bytes) !== binding.sha256) {
    throw new Error(`manual Router vendor bytes drifted: ${relativePath}`);
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
  verifyManualRouterAuthorityVendorV1()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "verification failed"}\n`);
      process.exitCode = 1;
    });
}
