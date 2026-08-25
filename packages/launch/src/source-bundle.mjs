import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";

import { keccak256 } from "viem";

import { canonicalizeJson } from "./canonical-json.mjs";
import {
  SOURCE_BUNDLE_CONTENT_SCHEMA,
  SOURCE_MANIFEST_SCHEMA,
} from "./constants.mjs";
import {
  canonicalRelativePath,
  compareUtf8,
  resolveInside,
  sha256Digest,
} from "./io.mjs";

export async function buildSourceBundle(sourceRoot, paths) {
  const collected = new Map();
  for (const candidate of paths) {
    const relativePath = canonicalRelativePath(candidate, "source bundle path");
    const absolutePath = resolveInside(sourceRoot, relativePath, "source bundle path");
    await collectPath(sourceRoot, relativePath, absolutePath, collected);
  }
  const contentEntries = [...collected.values()].sort((left, right) => compareUtf8(left.path, right.path));
  if (contentEntries.length === 0) throw new TypeError("source bundle must not be empty");
  const manifest = {
    schemaVersion: SOURCE_MANIFEST_SCHEMA,
    entries: contentEntries.map(({ contentBase64, ...entry }) => entry),
  };
  const sourceBundleDigest = keccak256(`0x${Buffer.concat([
    Buffer.from("programmable.source-bundle.v2", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(manifest), "utf8"),
  ]).toString("hex")}`);
  const bundleContent = {
    schemaVersion: SOURCE_BUNDLE_CONTENT_SCHEMA,
    entries: contentEntries,
  };
  const bundleContentSha256 = sha256Digest(
    Buffer.from(canonicalizeJson(bundleContent), "utf8"),
  );
  return { manifest, sourceBundleDigest, bundleContentSha256, bundleContent };
}

async function collectPath(sourceRoot, relativePath, absolutePath, collected) {
  const info = await lstat(absolutePath);
  if (info.isDirectory()) {
    const children = await readdir(absolutePath);
    children.sort(compareUtf8);
    for (const child of children) {
      const childRelative = `${relativePath}/${child}`;
      await collectPath(sourceRoot, childRelative, path.join(absolutePath, child), collected);
    }
    return;
  }
  if (!info.isFile() && !info.isSymbolicLink()) {
    throw new TypeError(`source bundle path ${relativePath} is not a regular file or symlink`);
  }
  if (collected.has(relativePath)) return;
  let bytes;
  let kind;
  let mode;
  let symlinkTarget;
  if (info.isSymbolicLink()) {
    kind = "symlink";
    mode = "120000";
    symlinkTarget = await readlink(absolutePath, { encoding: "utf8" });
    if (symlinkTarget.length === 0 || symlinkTarget.includes("\0")) {
      throw new TypeError(`source symlink ${relativePath} has an invalid target`);
    }
    const lexicalTarget = path.resolve(path.dirname(absolutePath), symlinkTarget);
    const resolvedRoot = path.resolve(sourceRoot);
    if (lexicalTarget !== resolvedRoot && !lexicalTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new TypeError(`source symlink ${relativePath} escapes the source root`);
    }
    bytes = Buffer.from(symlinkTarget, "utf8");
  } else {
    kind = "file";
    mode = (info.mode & 0o111) === 0 ? "100644" : "100755";
    symlinkTarget = null;
    bytes = await readFile(absolutePath);
  }
  collected.set(relativePath, {
    path: relativePath,
    kind,
    mode,
    byteLength: String(bytes.byteLength),
    contentSha256: sha256Digest(bytes),
    symlinkTarget,
    contentBase64: bytes.toString("base64"),
  });
}
