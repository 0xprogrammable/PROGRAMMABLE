#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [id, name, summary] = process.argv.slice(2);

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id ?? "")) {
  fail("Usage: node scripts/new-model.mjs <model-id> <model-name> <specific summary>");
}
if (typeof name !== "string" || name.trim().length === 0) {
  fail("Model name is required.");
}
if (typeof summary !== "string" || summary.trim().length < 20) {
  fail("Summary must contain at least 20 characters.");
}

const destination = path.join(root, "models", id);
if (fs.existsSync(destination)) {
  fail(`models/${id} already exists.`);
}

fs.mkdirSync(destination, { recursive: false });
for (const templateName of ["README.md", "SECURITY.md", "TEST_PLAN.md", "model.json"]) {
  const templatePath = path.join(root, "templates", "model", `${templateName}.template`);
  const output = fs
    .readFileSync(templatePath, "utf8")
    .replaceAll("{{MODEL_ID}}", id)
    .replaceAll("{{MODEL_NAME}}", name.trim())
    .replaceAll("{{MODEL_SUMMARY}}", summary.trim());
  fs.writeFileSync(path.join(destination, templateName), output);
}

const registryPath = path.join(root, "models", "registry.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
registry.updatedAt = new Date().toISOString().slice(0, 10);
registry.models.push({
  id,
  name: name.trim(),
  status: "design",
  summary: summary.trim(),
  manifest: `models/${id}/model.json`,
  documentation: `models/${id}/README.md`
});
registry.models.sort((left, right) => left.id.localeCompare(right.id));
fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

console.log(`Created models/${id} and added it to models/registry.json.`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
