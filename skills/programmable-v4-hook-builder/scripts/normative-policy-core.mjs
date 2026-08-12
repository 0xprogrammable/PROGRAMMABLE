import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const skillRoot = path.resolve(path.dirname(modulePath), "..");
const normativePropertyManifestPath = path.resolve(
  skillRoot,
  "references",
  "normative-property-manifest-v1.json"
);
const allowedNormativePropertyRoles = new Set([
  "agent-contract",
  "authoring-template",
  "blind-evaluation-fixture",
  "builder-catalog",
  "enforcement-implementation",
  "enforcement-test",
  "legal-or-provenance",
  "normative-reference",
  "reference-kernel",
  "test-vector"
]);
let policyBundlePaths = null;

export function normativePolicyInventory() {
  return getNormativePolicyPaths().map((target) => path.relative(skillRoot, target).split(path.sep).join("/"));
}

export function getNormativePolicyPaths() {
  // Keep generic helpers such as canonicalJson importable in the deliberately
  // minimal mutation fixture. Resolve the complete package policy closure only
  // when validation or explicit inventory inspection actually needs it.
  policyBundlePaths ??= Object.freeze(resolveNormativePolicyPaths());
  return policyBundlePaths;
}

function resolveNormativePolicyPaths() {
  const manifest = JSON.parse(fs.readFileSync(normativePropertyManifestPath, "utf8"));
  if (
    manifest?.$schema !== "urn:programmable:normative-property-manifest-v1:1.0.0"
    || manifest?.schemaVersion !== "1.0.0"
    || manifest?.kind !== "programmable-normative-property-manifest"
    || !Array.isArray(manifest?.entries)
    || manifest.entries.length === 0
  ) {
    throw new Error("Invalid normative property manifest header.");
  }

  const targets = new Set();
  const seenEntries = new Set();
  for (const entry of manifest.entries) {
    if (
      !entry
      || typeof entry !== "object"
      || Array.isArray(entry)
      || typeof entry.path !== "string"
      || !allowedNormativePropertyRoles.has(entry.role)
      || typeof entry.recursive !== "boolean"
      || Object.keys(entry).some((key) => !["path", "role", "recursive", "excludePrefixes"].includes(key))
    ) {
      throw new Error("Invalid normative property manifest entry.");
    }
    const normalizedPath = path.posix.normalize(entry.path);
    if (
      normalizedPath !== entry.path
      || normalizedPath.startsWith("../")
      || normalizedPath.startsWith("/")
      || normalizedPath.includes("\\")
      || seenEntries.has(normalizedPath)
    ) {
      throw new Error(`Unsafe or duplicate normative property path: ${entry.path}`);
    }
    seenEntries.add(normalizedPath);
    const excludePrefixes = entry.excludePrefixes ?? [];
    if (
      !Array.isArray(excludePrefixes)
      || excludePrefixes.some((prefix) => typeof prefix !== "string" || !prefix.startsWith(`${normalizedPath}/`))
    ) {
      throw new Error(`Invalid normative property exclusions for ${entry.path}.`);
    }
    const absolute = path.resolve(skillRoot, normalizedPath);
    if (entry.recursive) {
      if (!fs.statSync(absolute).isDirectory()) {
        throw new Error(`Recursive normative property target is not a directory: ${entry.path}`);
      }
      collectNormativeFiles(absolute, excludePrefixes, targets);
    } else {
      if (!fs.statSync(absolute).isFile()) {
        throw new Error(`Normative property target is not a file: ${entry.path}`);
      }
      targets.add(absolute);
    }
  }
  if (!targets.has(normativePropertyManifestPath)) {
    throw new Error("The normative property manifest must bind itself.");
  }
  return [...targets].sort((left, right) => left.localeCompare(right));
}

function collectNormativeFiles(directory, excludePrefixes, targets) {
  for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.resolve(directory, dirent.name);
    const relative = path.relative(skillRoot, absolute).split(path.sep).join("/");
    if (excludePrefixes.some((prefix) => relative.startsWith(prefix))) continue;
    if (dirent.isDirectory()) collectNormativeFiles(absolute, excludePrefixes, targets);
    else if (dirent.isFile()) targets.add(absolute);
    else throw new Error(`Unsupported normative property filesystem entry: ${relative}`);
  }
}
