import childProcess from "node:child_process";
import crypto from "node:crypto";
import process from "node:process";
import { canonicalJson } from "./submission-core.mjs";
import {
  CONTROL_OR_BIDI,
  MAXIMUM_SOURCE_OBJECT_BYTES,
  PROGRAMMABLE_REGISTRY,
  SNAPSHOT_SOURCE_RECEIPT_VERSION,
  UNPAIRED_SURROGATE
} from "./registry-discovery-definitions.mjs";
import {
  compareUtf8,
  decoder,
  fail,
  parseJsonBytes,
  sha256
} from "./registry-discovery-primitives.mjs";

export function createGitSourceReceipt({ bindings, commit, objectStore, tree }) {
  const paths = bindings
    .map(({ bytes, mode, objectId, path: sourcePath }) => ({
      blobObjectId: objectId,
      byteLength: bytes.length,
      mode,
      path: sourcePath,
      sha256: sha256(bytes)
    }))
    .sort((left, right) => compareUtf8(left.path, right.path));
  const used = new Set([commit]);
  for (const binding of paths) resolveReceiptPath(tree, binding.path, objectStore, used);
  const objects = [...used]
    .sort(compareUtf8)
    .map((objectId) => {
      const object = objectStore.get(objectId);
      if (object === undefined) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "Git source object inventory is incomplete");
      return {
        byteLength: object.bytes.length,
        contentBase64: object.bytes.toString("base64"),
        objectId,
        type: object.type
      };
    });
  return {
    authority: "public-released-git-baseline",
    commitObjectId: commit,
    objects,
    paths,
    repository: {
      defaultBranch: PROGRAMMABLE_REGISTRY.defaultBranch,
      numericRepositoryId: PROGRAMMABLE_REGISTRY.numericRepositoryId,
      repository: PROGRAMMABLE_REGISTRY.repository,
      repositoryUri: PROGRAMMABLE_REGISTRY.repositoryUri
    },
    schemaVersion: SNAPSHOT_SOURCE_RECEIPT_VERSION,
    treeObjectId: tree
  };
}

export function resolveGitPath(repositoryRoot, rootTree, sourcePath, objectStore) {
  const segments = validateSourcePath(sourcePath);
  let treeObjectId = rootTree;
  for (let position = 0; position < segments.length; position += 1) {
    const treeBytes = loadGitObject(repositoryRoot, "tree", treeObjectId, objectStore);
    const entry = parseGitTree(treeBytes).get(segments[position]);
    if (entry === undefined) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `Git source path ${sourcePath} is missing`);
    const final = position === segments.length - 1;
    if (!final) {
      if (entry.mode !== "40000") fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `Git source path ${sourcePath} crosses a non-tree object`);
      treeObjectId = entry.objectId;
      continue;
    }
    if (entry.mode !== "100644") fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `Git source path ${sourcePath} is not a regular non-executable blob`);
    const bytes = loadGitObject(repositoryRoot, "blob", entry.objectId, objectStore);
    return { bytes, mode: entry.mode, objectId: entry.objectId, path: sourcePath };
  }
  fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `Git source path ${sourcePath} is invalid`);
}

export function resolveReceiptPath(rootTree, sourcePath, objectStore, usedObjectIds) {
  const segments = validateSourcePath(sourcePath);
  let treeObjectId = rootTree;
  for (let position = 0; position < segments.length; position += 1) {
    const treeObject = objectStore.get(treeObjectId);
    if (treeObject?.type !== "tree") fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `snapshot source tree for ${sourcePath} is missing`);
    usedObjectIds.add(treeObjectId);
    const entry = parseGitTree(treeObject.bytes).get(segments[position]);
    if (entry === undefined) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `snapshot source path ${sourcePath} is missing`);
    const final = position === segments.length - 1;
    if (!final) {
      if (entry.mode !== "40000") fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `snapshot source path ${sourcePath} crosses a non-tree object`);
      treeObjectId = entry.objectId;
      continue;
    }
    const blob = objectStore.get(entry.objectId);
    if (entry.mode !== "100644" || blob?.type !== "blob") fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `snapshot source path ${sourcePath} is not a regular blob`);
    usedObjectIds.add(entry.objectId);
    return { bytes: blob.bytes, mode: entry.mode, objectId: entry.objectId };
  }
  fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `snapshot source path ${sourcePath} is invalid`);
}

export function loadGitObject(repositoryRoot, type, objectId, objectStore) {
  const existing = objectStore.get(objectId);
  if (existing !== undefined) {
    if (existing.type !== type) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `Git object ${objectId} has conflicting types`);
    return existing.bytes;
  }
  const bytes = gitObjectBytes(repositoryRoot, type, objectId);
  assertGitObjectId(type, bytes, objectId, `Registry ${type} object`);
  objectStore.set(objectId, Object.freeze({ bytes, type }));
  return bytes;
}

export function parseGitTree(bytes) {
  const entries = new Map();
  let cursor = 0;
  while (cursor < bytes.length) {
    const space = bytes.indexOf(0x20, cursor);
    const nul = space < 0 ? -1 : bytes.indexOf(0x00, space + 1);
    if (space <= cursor || nul <= space + 1 || nul + 21 > bytes.length) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "Git tree object is malformed");
    const mode = bytes.subarray(cursor, space).toString("ascii");
    let name;
    try { name = decoder.decode(bytes.subarray(space + 1, nul)); } catch { fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "Git tree path is not UTF-8"); }
    if (
      !new Set(["100644", "100755", "120000", "160000", "40000"]).has(mode)
      || name.length === 0
      || name === "."
      || name === ".."
      || name.includes("/")
      || CONTROL_OR_BIDI.test(name)
      || UNPAIRED_SURROGATE.test(name)
      || entries.has(name)
    ) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "Git tree entry is unsafe or unsupported");
    const objectId = bytes.subarray(nul + 1, nul + 21).toString("hex");
    entries.set(name, { mode, objectId });
    cursor = nul + 21;
  }
  if (entries.size === 0) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "Git tree object is empty");
  return entries;
}

export function commitTreeObjectId(bytes) {
  let source;
  try { source = decoder.decode(bytes); } catch { fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "Registry commit object is not UTF-8"); }
  const header = source.split("\n\n", 1)[0];
  const treeLines = header.split("\n").filter((line) => line.startsWith("tree "));
  if (treeLines.length !== 1 || !/^tree [0-9a-f]{40}$/u.test(treeLines[0])) {
    fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "Registry commit object has no unique root tree");
  }
  return treeLines[0].slice(5);
}

export function validateSourcePath(sourcePath) {
  if (
    typeof sourcePath !== "string"
    || sourcePath.length < 1
    || sourcePath.length > 4096
    || sourcePath.startsWith("/")
    || sourcePath.endsWith("/")
    || sourcePath.includes("\\")
    || CONTROL_OR_BIDI.test(sourcePath)
    || UNPAIRED_SURROGATE.test(sourcePath)
  ) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot source path is unsafe");
  const segments = sourcePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", "snapshot source path is unsafe");
  }
  return segments;
}

export function parseCanonicalRegistrySource(bytes, label) {
  const value = parseJsonBytes(bytes, label);
  if (decoder.decode(bytes) !== `${canonicalJson(value)}\n`) fail("REGISTRY_INDEX_INVALID", `${label} bytes are not canonical`);
  return value;
}

export function gitText(repositoryRoot, args, label) {
  return decoder.decode(gitCommand(repositoryRoot, args, label)).trim();
}

export function gitObjectBytes(repositoryRoot, type, objectId) {
  return gitCommand(repositoryRoot, ["cat-file", type, objectId], `Registry ${type} object`);
}

export function gitCommand(repositoryRoot, args, label) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const result = childProcess.spawnSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-C", repositoryRoot, ...args],
    {
      encoding: null,
      env: { ...environment, GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0", LANG: "C", LC_ALL: "C" },
      maxBuffer: MAXIMUM_SOURCE_OBJECT_BYTES,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `${label} could not be read from the exact Git object database`);
  }
  return result.stdout;
}

export function isCanonicalRegistryRemote(value) {
  return new Set([
    `${PROGRAMMABLE_REGISTRY.repositoryUri}.git`,
    PROGRAMMABLE_REGISTRY.repositoryUri,
    "git@github.com:0xprogrammable/submit-launch.git",
    "ssh://git@github.com/0xprogrammable/submit-launch.git",
    "https://github.com/0xprogrammable/programmable-registry.git",
    "https://github.com/0xprogrammable/programmable-registry",
    "git@github.com:0xprogrammable/programmable-registry.git",
    "ssh://git@github.com/0xprogrammable/programmable-registry.git"
  ]).has(value);
}

export function assertGitObjectId(type, bytes, expected, label) {
  if (gitObjectId(type, bytes) !== expected) fail("REGISTRY_SNAPSHOT_SOURCE_INVALID", `${label} does not match its object id`);
}

export function gitObjectId(type, bytes) {
  return crypto.createHash("sha1").update(`${type} ${bytes.length}\0`).update(bytes).digest("hex");
}
