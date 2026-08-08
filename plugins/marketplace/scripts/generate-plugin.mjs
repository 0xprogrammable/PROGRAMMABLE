#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const MARKETPLACE_ROOT = path.resolve(scriptDirectory, "..");
export const REPOSITORY_ROOT = path.resolve(MARKETPLACE_ROOT, "..", "..");
export const CANONICAL_SKILL_ROOT = path.join(
  REPOSITORY_ROOT,
  "skills",
  "programmable-v4-hook-builder"
);
export const METADATA_PATH = path.join(MARKETPLACE_ROOT, "metadata", "plugin.json");
export const PLUGIN_ROOT = path.join(MARKETPLACE_ROOT, "plugins", "programmable");
export const CODEX_MARKETPLACE_PATH = path.join(
  MARKETPLACE_ROOT,
  ".agents",
  "plugins",
  "marketplace.json"
);
export const CLAUDE_MARKETPLACE_PATH = path.join(
  MARKETPLACE_ROOT,
  ".claude-plugin",
  "marketplace.json"
);

const metadataKeys = [
  "schemaVersion",
  "marketplaceName",
  "marketplaceDisplayName",
  "pluginName",
  "version",
  "displayName",
  "description",
  "shortDescription",
  "longDescription",
  "developerName",
  "category",
  "capabilities",
  "defaultPrompt",
  "license",
  "keywords"
];
const productPolicyTerms = /\b(?:acceptance|accepted|approval|approved|audit|audited|candidate|deploy|deployed|deployment|fee|mainnet|permit|provider|routing|safe|submission|unruggable|verified|wallet)\b/i;
const pluginNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function loadMetadata(metadataPath = METADATA_PATH) {
  const source = fs.readFileSync(metadataPath, "utf8");
  let metadata;
  try {
    metadata = JSON.parse(source);
  } catch (error) {
    throw new Error(`plugin metadata must be valid JSON: ${error.message}`);
  }
  if (source !== serializeJson(metadata)) {
    throw new Error("plugin metadata must use canonical two-space JSON with one trailing newline");
  }
  validateMetadata(metadata);
  return metadata;
}

export function buildCodexManifest(metadata) {
  return {
    name: metadata.pluginName,
    version: metadata.version,
    description: metadata.description,
    author: { name: metadata.developerName },
    license: metadata.license,
    keywords: metadata.keywords,
    skills: "./skills/",
    interface: {
      displayName: metadata.displayName,
      shortDescription: metadata.shortDescription,
      longDescription: metadata.longDescription,
      developerName: metadata.developerName,
      category: metadata.category,
      capabilities: metadata.capabilities,
      defaultPrompt: metadata.defaultPrompt
    }
  };
}

export function buildClaudeManifest(metadata) {
  return {
    name: metadata.pluginName,
    displayName: metadata.displayName,
    version: metadata.version,
    description: metadata.description,
    author: { name: metadata.developerName },
    license: metadata.license,
    keywords: metadata.keywords,
    skills: "./skills/"
  };
}

export function buildCodexMarketplace(metadata) {
  return {
    name: metadata.marketplaceName,
    interface: { displayName: metadata.marketplaceDisplayName },
    plugins: [
      {
        name: metadata.pluginName,
        source: {
          source: "local",
          path: `./plugins/${metadata.pluginName}`
        },
        policy: {
          installation: "AVAILABLE",
          authentication: "ON_INSTALL"
        },
        category: metadata.category
      }
    ]
  };
}

export function buildClaudeMarketplace(metadata) {
  return {
    name: metadata.marketplaceName,
    owner: { name: metadata.developerName },
    description: `Local repository marketplace for ${metadata.marketplaceDisplayName}.`,
    plugins: [
      {
        name: metadata.pluginName,
        source: `./plugins/${metadata.pluginName}`
      }
    ]
  };
}

export function materializeDistribution({
  canonicalSkillRoot = CANONICAL_SKILL_ROOT,
  metadataPath = METADATA_PATH,
  pluginRoot = PLUGIN_ROOT,
  codexMarketplacePath = CODEX_MARKETPLACE_PATH,
  claudeMarketplacePath = CLAUDE_MARKETPLACE_PATH
} = {}) {
  const metadata = loadMetadata(metadataPath);
  assertPluginDestination(pluginRoot, metadata.pluginName);
  const sourceRows = walkFiles(canonicalSkillRoot);
  if (sourceRows.length === 0) throw new Error("canonical skill contains no files");

  const pluginParent = path.dirname(pluginRoot);
  fs.mkdirSync(pluginParent, { recursive: true });
  const stagingRoot = path.join(pluginParent, `.${metadata.pluginName}.stage-${process.pid}`);
  if (fs.existsSync(stagingRoot)) {
    throw new Error(`refusing to reuse plugin staging path: ${stagingRoot}`);
  }

  try {
    fs.mkdirSync(path.join(stagingRoot, ".codex-plugin"), { recursive: true });
    fs.mkdirSync(path.join(stagingRoot, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(stagingRoot, ".codex-plugin", "plugin.json"),
      serializeJson(buildCodexManifest(metadata)),
      { mode: 0o644 }
    );
    fs.writeFileSync(
      path.join(stagingRoot, ".claude-plugin", "plugin.json"),
      serializeJson(buildClaudeManifest(metadata)),
      { mode: 0o644 }
    );

    const copiedSkillRoot = path.join(stagingRoot, "skills", path.basename(canonicalSkillRoot));
    for (const row of sourceRows) {
      const destination = path.join(copiedSkillRoot, ...row.relativePath.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(row.absolutePath, destination);
      fs.chmodSync(destination, row.mode);
    }

    if (fs.existsSync(pluginRoot)) fs.rmSync(pluginRoot, { recursive: true, force: false });
    fs.renameSync(stagingRoot, pluginRoot);
    writeAtomically(codexMarketplacePath, serializeJson(buildCodexMarketplace(metadata)));
    writeAtomically(claudeMarketplacePath, serializeJson(buildClaudeMarketplace(metadata)));
  } catch (error) {
    if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }

  return verifyDistribution({
    canonicalSkillRoot,
    metadataPath,
    pluginRoot,
    codexMarketplacePath,
    claudeMarketplacePath
  });
}

export function verifyDistribution({
  canonicalSkillRoot = CANONICAL_SKILL_ROOT,
  metadataPath = METADATA_PATH,
  pluginRoot = PLUGIN_ROOT,
  codexMarketplacePath = CODEX_MARKETPLACE_PATH,
  claudeMarketplacePath = CLAUDE_MARKETPLACE_PATH
} = {}) {
  const metadata = loadMetadata(metadataPath);
  assertPluginDestination(pluginRoot, metadata.pluginName);
  const expectedManifests = new Map([
    [".claude-plugin/plugin.json", serializeJson(buildClaudeManifest(metadata))],
    [".codex-plugin/plugin.json", serializeJson(buildCodexManifest(metadata))]
  ]);

  const sourceRows = walkFiles(canonicalSkillRoot);
  const expectedPaths = new Set(expectedManifests.keys());
  const copiedSkillRoot = path.join(pluginRoot, "skills", path.basename(canonicalSkillRoot));
  for (const row of sourceRows) {
    expectedPaths.add(`skills/${path.basename(canonicalSkillRoot)}/${row.relativePath}`);
    const copiedPath = path.join(copiedSkillRoot, ...row.relativePath.split("/"));
    const copiedStat = lstatRegularFile(copiedPath, `copied skill file ${row.relativePath}`);
    const copiedMode = copiedStat.mode & 0o777;
    if (copiedMode !== row.mode) {
      throw new Error(`copied skill mode mismatch for ${row.relativePath}`);
    }
    const copiedBytes = fs.readFileSync(copiedPath);
    if (!copiedBytes.equals(row.bytes)) {
      throw new Error(`copied skill bytes differ for ${row.relativePath}`);
    }
  }

  for (const [relativePath, expected] of expectedManifests) {
    const manifestPath = path.join(pluginRoot, ...relativePath.split("/"));
    lstatRegularFile(manifestPath, relativePath);
    const actual = fs.readFileSync(manifestPath, "utf8");
    if (actual !== expected) throw new Error(`${relativePath} differs from generated bytes`);
  }

  const actualRows = walkFiles(pluginRoot);
  for (const row of actualRows) {
    if (!expectedPaths.has(row.relativePath)) {
      throw new Error(`generated plugin contains undeclared file: ${row.relativePath}`);
    }
  }
  if (actualRows.length !== expectedPaths.size) {
    throw new Error("generated plugin is missing one or more declared files");
  }

  const expectedCodexMarketplace = serializeJson(buildCodexMarketplace(metadata));
  lstatRegularFile(codexMarketplacePath, "Codex marketplace.json");
  if (fs.readFileSync(codexMarketplacePath, "utf8") !== expectedCodexMarketplace) {
    throw new Error("Codex marketplace.json differs from generated bytes");
  }
  const expectedClaudeMarketplace = serializeJson(buildClaudeMarketplace(metadata));
  lstatRegularFile(claudeMarketplacePath, "Claude marketplace.json");
  if (fs.readFileSync(claudeMarketplacePath, "utf8") !== expectedClaudeMarketplace) {
    throw new Error("Claude marketplace.json differs from generated bytes");
  }

  return {
    pluginRoot,
    codexMarketplacePath,
    claudeMarketplacePath,
    skillFiles: sourceRows.length,
    skillTreeDigest: treeDigest(sourceRows),
    codexManifestSha256: sha256(Buffer.from(expectedManifests.get(".codex-plugin/plugin.json"))),
    claudeManifestSha256: sha256(Buffer.from(expectedManifests.get(".claude-plugin/plugin.json"))),
    codexMarketplaceSha256: sha256(Buffer.from(expectedCodexMarketplace)),
    claudeMarketplaceSha256: sha256(Buffer.from(expectedClaudeMarketplace))
  };
}

export function walkFiles(root) {
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`expected a real directory: ${root}`);
  }
  const rows = [];
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      Buffer.compare(Buffer.from(left.name), Buffer.from(right.name))
    );
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`symbolic links are not allowed: ${absolutePath}`);
      if (stat.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!stat.isFile()) throw new Error(`unsupported filesystem entry: ${absolutePath}`);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      rows.push({
        absolutePath,
        relativePath,
        mode: stat.mode & 0o777,
        bytes: fs.readFileSync(absolutePath)
      });
    }
  };
  visit(root);
  return rows.sort((left, right) =>
    Buffer.compare(Buffer.from(left.relativePath), Buffer.from(right.relativePath))
  );
}

export function treeDigest(rows) {
  const hash = crypto.createHash("sha256");
  for (const row of rows) {
    hash.update(Buffer.from(row.relativePath));
    hash.update(Buffer.from([0]));
    hash.update(Buffer.from(row.mode.toString(8)));
    hash.update(Buffer.from([0]));
    hash.update(Buffer.from(String(row.bytes.length)));
    hash.update(Buffer.from([0]));
    hash.update(Buffer.from(sha256(row.bytes)));
    hash.update(Buffer.from([10]));
  }
  return hash.digest("hex");
}

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateMetadata(metadata) {
  if (!isPlainObject(metadata)) throw new Error("plugin metadata must be an object");
  const keys = Object.keys(metadata).sort();
  const expectedKeys = [...metadataKeys].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error("plugin metadata keys differ from the closed neutral schema");
  }
  if (metadata.schemaVersion !== "1.0.0") throw new Error("unsupported plugin metadata schemaVersion");
  for (const key of metadataKeys.filter((key) => !["capabilities", "defaultPrompt", "keywords"].includes(key))) {
    requirePortableString(metadata[key], key);
  }
  if (!pluginNamePattern.test(metadata.pluginName) || metadata.pluginName.length > 64) {
    throw new Error("pluginName must be kebab-case and at most 64 characters");
  }
  if (!pluginNamePattern.test(metadata.marketplaceName) || metadata.marketplaceName.length > 64) {
    throw new Error("marketplaceName must be kebab-case and at most 64 characters");
  }
  if (!semverPattern.test(metadata.version)) throw new Error("version must use strict semver");
  if (metadata.pluginName !== "programmable") throw new Error("pluginName must remain programmable");
  if (metadata.shortDescription.length < 25 || metadata.shortDescription.length > 64) {
    throw new Error("shortDescription must contain 25-64 characters");
  }
  validateStringArray(metadata.capabilities, "capabilities", { maximum: 8 });
  validateStringArray(metadata.defaultPrompt, "defaultPrompt", { maximum: 3, maximumLength: 128 });
  validateStringArray(metadata.keywords, "keywords", { maximum: 16, maximumLength: 64 });
  if (!metadata.defaultPrompt.some((value) => value.includes("$programmable-v4-hook-builder"))) {
    throw new Error("defaultPrompt must invoke $programmable-v4-hook-builder");
  }
  for (const [location, value] of stringLeaves(metadata)) {
    if (productPolicyTerms.test(value)) {
      throw new Error(`neutral plugin metadata contains product-policy term at ${location}`);
    }
  }
}

function validateStringArray(value, label, { maximum, maximumLength = 128 }) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must contain 1-${maximum} strings`);
  }
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    requirePortableString(value[index], `${label}[${index}]`, maximumLength);
    if (seen.has(value[index])) throw new Error(`${label} contains a duplicate value`);
    seen.add(value[index]);
  }
}

function requirePortableString(value, label, maximumLength = 1024) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new Error(`${label} must be a non-empty string of at most ${maximumLength} characters`);
  }
  if (value.normalize("NFC") !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be NFC text without control characters`);
  }
}

function* stringLeaves(value, prefix = "$") {
  if (typeof value === "string") {
    yield [prefix, value];
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      yield* stringLeaves(value[index], `${prefix}[${index}]`);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      yield* stringLeaves(child, `${prefix}.${key}`);
    }
  }
}

function assertPluginDestination(pluginRoot, pluginName) {
  const resolved = path.resolve(pluginRoot);
  if (
    path.basename(resolved) !== pluginName ||
    path.basename(path.dirname(resolved)) !== "plugins"
  ) {
    throw new Error(`plugin output must be plugins/${pluginName}`);
  }
}

function lstatRegularFile(target, label) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file`);
  return stat;
}

function writeAtomically(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${process.pid}`);
  if (fs.existsSync(temporary)) throw new Error(`refusing to reuse temporary file: ${temporary}`);
  try {
    fs.writeFileSync(temporary, contents, { mode: 0o644, flag: "wx" });
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function renderHelp() {
  return [
    "Usage: generate-plugin.mjs --write|--check",
    "",
    "Generate or verify the repo-local Codex and Claude plugin from one canonical skill.",
    "No connector, MCP server, application id, or product policy is generated."
  ].join("\n");
}

function main(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(renderHelp());
    return;
  }
  if (argv.length !== 1 || !["--write", "--check"].includes(argv[0])) {
    console.error(renderHelp());
    process.exitCode = 2;
    return;
  }
  const result = argv[0] === "--write" ? materializeDistribution() : verifyDistribution();
  console.log(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
