import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./submission-core.mjs";

export function validateStarterCatalogClosure(findings, context) {
  const { packageEntries, packageEntriesByPath, read, relative } = context;
  const catalogRelativePath = "assets/starter-catalog/catalog.json";
  let catalog;
  try {
    catalog = JSON.parse(read(catalogRelativePath));
  } catch (error) {
    findings.push(`${catalogRelativePath}: ${error.message}`);
    return;
  }
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    findings.push(`${catalogRelativePath}: expected an object`);
    return;
  }
  if (catalog.schemaVersion !== "1.0.0" || catalog.kind !== "programmable-starter-catalog") {
    findings.push(`${catalogRelativePath}: unsupported schemaVersion or kind`);
  }
  if (!Array.isArray(catalog.entries) || catalog.entries.length === 0) {
    findings.push(`${catalogRelativePath}: entries must be a non-empty array`);
    return;
  }

  const listedPaths = new Set();
  const listedIds = new Map();
  for (const [index, entry] of catalog.entries.entries()) {
    const label = `${catalogRelativePath}: entries[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    if (typeof entry.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) {
      findings.push(`${label}.id must be kebab-case`);
    } else if (listedIds.has(entry.id)) {
      findings.push(`${label}.id duplicates ${entry.id}`);
    } else {
      listedIds.set(entry.id, entry.kind);
    }
    if (entry.kind !== "starter" && entry.kind !== "pack") {
      findings.push(`${label}.kind must be starter or pack`);
      continue;
    }
    const expectedPrefix = entry.kind === "starter" ? "starters/" : "packs/";
    if (!isSafeCatalogMemberPath(entry.path, expectedPrefix)) {
      findings.push(`${label}.path must be a normalized ${expectedPrefix} JSON path`);
      continue;
    }
    if (listedPaths.has(entry.path)) {
      findings.push(`${label}.path duplicates ${entry.path}`);
      continue;
    }
    listedPaths.add(entry.path);
    const memberRelativePath = `assets/starter-catalog/${entry.path}`;
    const memberEntry = packageEntriesByPath.get(memberRelativePath);
    if (!memberEntry?.stat.isFile()) {
      findings.push(`${catalogRelativePath}: missing catalog member ${memberRelativePath}`);
      continue;
    }
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      findings.push(`${label}.sha256 must be a lowercase SHA-256 digest`);
    } else {
      const actualDigest = crypto.createHash("sha256").update(fs.readFileSync(memberEntry.path)).digest("hex");
      if (actualDigest !== entry.sha256) {
        findings.push(`${catalogRelativePath}: digest mismatch for ${memberRelativePath}`);
      }
    }
    try {
      const member = JSON.parse(fs.readFileSync(memberEntry.path, "utf8"));
      if (member.id !== entry.id || member.kind !== entry.kind || member.schemaVersion !== "1.0.0") {
        findings.push(`${catalogRelativePath}: identity mismatch for ${memberRelativePath}`);
      }
    } catch (error) {
      findings.push(`${memberRelativePath}: ${error.message}`);
    }
  }

  for (const mandatoryId of catalog.mandatoryPacks ?? []) {
    if (listedIds.get(mandatoryId) !== "pack") {
      findings.push(`${catalogRelativePath}: mandatory pack ${mandatoryId} is not a listed pack`);
    }
  }

  const actualMemberPaths = packageEntries
    .map((entry) => relative(entry.path))
    .filter((entryPath) => /^assets\/starter-catalog\/(?:packs|starters)\/[^/]+\.json$/.test(entryPath))
    .map((entryPath) => entryPath.slice("assets/starter-catalog/".length));
  for (const memberPath of actualMemberPaths) {
    if (!listedPaths.has(memberPath)) {
      findings.push(`${catalogRelativePath}: unlisted catalog member assets/starter-catalog/${memberPath}`);
    }
  }
}

export function validateTemplateCatalogHistory(findings, { read }) {
  const relativePath = "references/template-catalog-history.json";
  let history;
  let catalog;
  let catalogBytes;
  try {
    const historySource = read(relativePath);
    history = JSON.parse(historySource);
    if (historySource !== `${canonicalJson(history)}\n`) {
      findings.push(`${relativePath}: history must be canonical JSON with one final newline`);
    }
    catalogBytes = Buffer.from(read("assets/starter-catalog/catalog.json"), "utf8");
    catalog = JSON.parse(catalogBytes);
  } catch (error) {
    findings.push(`${relativePath}: ${error.message}`);
    return;
  }
  if (
    history?.schemaVersion !== "1.0.0"
    || Object.keys(history).sort().join(",") !== "releases,schemaVersion"
    || !Array.isArray(history.releases)
    || history.releases.length < 1
    || history.releases.length > 128
  ) {
    findings.push(`${relativePath}: history contract is invalid`);
    return;
  }
  const currentManifestSha256 = `sha256:${crypto.createHash("sha256").update(catalogBytes).digest("hex")}`;
  const tags = new Set();
  for (const [index, release] of history.releases.entries()) {
    const label = `${relativePath}: releases[${index}]`;
    if (
      !release
      || typeof release !== "object"
      || Array.isArray(release)
      || Object.keys(release).sort().join(",") !== "catalogDigest,catalogManifestSha256,commit,definitions,releasedAt,repository,skillTree,tag"
      || !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(release.tag ?? "")
      || tags.has(release.tag)
      || release.repository !== "0xprogrammable/programmable-v4-builder"
      || !/^[0-9a-f]{40}$/.test(release.commit ?? "")
      || !/^[0-9a-f]{40}$/.test(release.skillTree ?? "")
      || !/^[0-9a-f]{64}$/.test(release.catalogDigest ?? "")
      || !/^sha256:[0-9a-f]{64}$/.test(release.catalogManifestSha256 ?? "")
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(release.releasedAt ?? "")
      || !Array.isArray(release.definitions)
      || release.definitions.length < 1
      || release.definitions.length > 128
    ) {
      findings.push(`${label} is invalid`);
      continue;
    }
    tags.add(release.tag);
    const ids = [];
    for (const definition of release.definitions) {
      if (
        !definition
        || typeof definition !== "object"
        || Array.isArray(definition)
        || Object.keys(definition).sort().join(",") !== "definitionSha256,id,kind"
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(definition.id ?? "")
        || !new Set(["pack", "starter"]).has(definition.kind)
        || !/^[0-9a-f]{64}$/.test(definition.definitionSha256 ?? "")
      ) findings.push(`${label} has an invalid definition receipt`);
      ids.push(definition?.id);
    }
    const sortedIds = [...ids].sort();
    if (ids.some((id, position) => id !== sortedIds[position]) || new Set(ids).size !== ids.length) {
      findings.push(`${label} definition receipts must be sorted and unique`);
    }
    if (release.catalogManifestSha256 === currentManifestSha256) {
      const expected = (catalog.entries ?? []).map(({ id, kind, sha256: definitionSha256 }) => ({ definitionSha256, id, kind }));
      const expectedCatalogDigest = crypto.createHash("sha256")
        .update(Buffer.from("programmable.template-catalog.v1", "utf8"))
        .update(Buffer.from([0]))
        .update(Buffer.from(canonicalJson(catalog), "utf8"))
        .digest("hex");
      if (release.catalogDigest !== expectedCatalogDigest) {
        findings.push(`${label} has the wrong catalog digest for the manifest it claims`);
      }
      if (JSON.stringify(release.definitions) !== JSON.stringify(expected)) {
        findings.push(`${label} does not match the current catalog manifest it claims`);
      }
    }
  }
}

function isSafeCatalogMemberPath(candidate, expectedPrefix) {
  if (typeof candidate !== "string" || !candidate.startsWith(expectedPrefix) || !candidate.endsWith(".json")) {
    return false;
  }
  if (candidate.includes("\\") || path.posix.isAbsolute(candidate)) return false;
  const segments = candidate.split("/");
  return segments.length === 2 && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
