#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const referenceDirectory = path.resolve(scriptDirectory, "../references");
const applicationSchemaPath = path.join(referenceDirectory, "public-pr-application.schema.json");
const sourceSchemaPath = path.join(referenceDirectory, "github-public-source-contract-v1.schema.json");

const SOURCE_SCHEMA_ID = "urn:programmable:github-public-source-contract-v1";
const SOURCE_DEFINITION = "GitHubPublicSourceRequestV1";
const GENERATED_PREFIX = "githubSource__";
const DERIVATION_KEY = "x-programmable-derived-from";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(compareUtf8).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function localDefinitionName(reference) {
  const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(reference);
  return match?.[1] ?? null;
}

function collectReferences(value, result = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectReferences(entry, result);
    return result;
  }
  if (!value || typeof value !== "object") return result;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" && typeof entry === "string") result.add(entry);
    else collectReferences(entry, result);
  }
  return result;
}

function sourceClosure(sourceSchema) {
  if (sourceSchema.$id !== SOURCE_SCHEMA_ID) {
    throw new Error(`Unexpected GitHub source schema id: ${sourceSchema.$id ?? "missing"}`);
  }
  const queue = [SOURCE_DEFINITION];
  const definitions = new Map();
  while (queue.length > 0) {
    const name = queue.shift();
    if (definitions.has(name)) continue;
    const definition = sourceSchema.$defs?.[name];
    if (!definition) throw new Error(`Missing GitHub source definition: ${name}`);
    definitions.set(name, definition);
    for (const reference of collectReferences(definition)) {
      const referencedName = localDefinitionName(reference);
      if (!referencedName) throw new Error(`GitHub source definition ${name} has a non-local reference: ${reference}`);
      queue.push(referencedName);
    }
  }
  return Object.fromEntries([...definitions].sort(([left], [right]) => compareUtf8(left, right)));
}

function rewriteSourceReferences(value) {
  if (Array.isArray(value)) return value.map(rewriteSourceReferences);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (key !== "$ref" || typeof entry !== "string") return [key, rewriteSourceReferences(entry)];
    const name = localDefinitionName(entry);
    if (!name) throw new Error(`Cannot embed non-local GitHub source reference: ${entry}`);
    return [key, `#/$defs/${GENERATED_PREFIX}${name}`];
  }));
}

export function generatePublicApplicationSchema(applicationSchema, sourceSchema) {
  const closure = sourceClosure(sourceSchema);
  const applicationDefinitions = Object.fromEntries(
    Object.entries(applicationSchema.$defs ?? {}).filter(([name]) => !name.startsWith(GENERATED_PREFIX))
  );
  const embeddedDefinitions = Object.fromEntries(Object.entries(closure).map(([name, definition]) => [
    `${GENERATED_PREFIX}${name}`,
    rewriteSourceReferences(definition)
  ]));
  const generated = structuredClone(applicationSchema);
  generated.properties.source = { $ref: `#/$defs/${GENERATED_PREFIX}${SOURCE_DEFINITION}` };
  generated[DERIVATION_KEY] = {
    schemaId: SOURCE_SCHEMA_ID,
    definition: `#/$defs/${SOURCE_DEFINITION}`,
    semanticSha256: sha256(canonicalJson(closure))
  };
  generated.$defs = { ...applicationDefinitions, ...embeddedDefinitions };
  return generated;
}

export function serializePublicApplicationSchema(schema) {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

function main() {
  const argument = process.argv[2] ?? "--check";
  if (!["--check", "--write"].includes(argument) || process.argv.length > 3) {
    process.stderr.write("Usage: node generate-public-pr-application-schema.mjs [--check|--write]\n");
    process.exitCode = 2;
    return;
  }
  const current = readJson(applicationSchemaPath);
  const generatedBytes = serializePublicApplicationSchema(generatePublicApplicationSchema(current, readJson(sourceSchemaPath)));
  if (argument === "--write") {
    fs.writeFileSync(applicationSchemaPath, generatedBytes);
    process.stdout.write(`${path.relative(process.cwd(), applicationSchemaPath)} updated\n`);
    return;
  }
  const currentBytes = fs.readFileSync(applicationSchemaPath, "utf8");
  if (currentBytes !== generatedBytes) {
    process.stderr.write("public-pr-application.schema.json is stale; run the generator with --write.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write("public-pr-application.schema.json is self-contained and current\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
