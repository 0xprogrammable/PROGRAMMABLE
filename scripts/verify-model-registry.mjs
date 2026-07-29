#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(root, "models", "registry.json");
const allowedStatuses = new Set(["design", "candidate", "available", "retired"]);
const errors = [];

function readJson(relativePath) {
  try {
    const absolutePath = resolveRepositoryPath(relativePath);
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    errors.push(`${relativePath ?? "<missing path>"}: ${error.message}`);
    return null;
  }
}

function resolveRepositoryPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error("expected a non-empty repository-relative path");
  }

  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`path escapes the repository: ${relativePath}`);
  }
  return absolutePath;
}

function requirePath(relativePath, context) {
  try {
    if (!fs.existsSync(resolveRepositoryPath(relativePath))) {
      errors.push(`${context}: missing ${relativePath}`);
    }
  } catch (error) {
    errors.push(`${context}: ${error.message}`);
  }
}

const registry = readJson(path.relative(root, registryPath));
if (!registry) {
  process.exit(1);
}

if (registry.schemaVersion !== 1) {
  errors.push("models/registry.json: schemaVersion must be 1");
}
if (!Array.isArray(registry.models) || registry.models.length === 0) {
  errors.push("models/registry.json: models must be a non-empty array");
}

const ids = new Set();
for (const entry of registry.models ?? []) {
  const context = `model ${entry?.id ?? "<missing id>"}`;

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry?.id ?? "")) {
    errors.push(`${context}: invalid id`);
  } else if (ids.has(entry.id)) {
    errors.push(`${context}: duplicate id`);
  } else {
    ids.add(entry.id);
  }

  if (!allowedStatuses.has(entry?.status)) {
    errors.push(`${context}: invalid status ${entry?.status}`);
  }
  if (typeof entry?.name !== "string" || entry.name.length === 0) {
    errors.push(`${context}: name is required`);
  }
  if (typeof entry?.summary !== "string" || entry.summary.length < 20) {
    errors.push(`${context}: summary must be specific`);
  }

  requirePath(entry?.manifest, context);
  requirePath(entry?.documentation, context);

  const manifest = readJson(entry?.manifest);
  if (!manifest) continue;

  for (const field of ["id", "name", "status", "summary", "documentation"]) {
    if (manifest[field] !== entry[field]) {
      errors.push(`${context}: registry and manifest disagree on ${field}`);
    }
  }
  if (manifest.schemaVersion !== 1) {
    errors.push(`${context}: manifest schemaVersion must be 1`);
  }
  if (!allowedStatuses.has(manifest.status)) {
    errors.push(`${context}: manifest has invalid status`);
  }
  if (manifest.network?.chainId !== 1 || manifest.network?.name !== "Ethereum") {
    errors.push(`${context}: current registry accepts Ethereum chain 1 only`);
  }

  requirePath(manifest.security, context);

  if (manifest.status === "available") {
    if (typeof manifest.currentRelease !== "string" || manifest.currentRelease.length === 0) {
      errors.push(`${context}: available models require currentRelease`);
    }

    for (const field of ["releaseManifest", "specification", "deployment"]) {
      if (typeof manifest[field] !== "string" || manifest[field].length === 0) {
        errors.push(`${context}: available models require ${field}`);
      } else {
        requirePath(manifest[field], context);
      }
    }

    const specification = readJson(manifest.specification);
    const deployment = readJson(manifest.deployment);
    const release = readJson(manifest.releaseManifest);

    if (specification?.release !== manifest.currentRelease) {
      errors.push(`${context}: specification release does not match currentRelease`);
    }
    if (deployment?.release !== manifest.currentRelease) {
      errors.push(`${context}: deployment release does not match currentRelease`);
    }
    if (release?.release !== manifest.currentRelease || release?.model !== manifest.id) {
      errors.push(`${context}: release manifest does not match model`);
    }
    if (specification?.chainId !== manifest.network.chainId || deployment?.chainId !== manifest.network.chainId) {
      errors.push(`${context}: chainId differs across model evidence`);
    }
  } else {
    for (const field of ["currentRelease", "releaseManifest", "specification", "deployment"]) {
      if (manifest[field] !== null) {
        errors.push(`${context}: ${field} must be null until the model is available`);
      }
    }
    if (!Array.isArray(manifest.releaseGates) || manifest.releaseGates.length === 0) {
      errors.push(`${context}: non-available models require explicit release gates`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const summary = registry.models.map(({ id, status }) => `${id}:${status}`).join(", ");
console.log(`Verified ${registry.models.length} launch models (${summary}).`);
