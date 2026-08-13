#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildManifest, canonicalJson, readJson, verifySemanticAssertions } from "./hookemon-reusable-profile-v2-core.mjs";

const root = process.cwd();
const descriptorPath = path.join(root, "spec/router-vnext/hookemon-reusable-profile-v2-reviewed-input.json");
const outputPath = path.join(root, "spec/router-vnext/hookemon-reusable-profile-v2-manifest.json");
const manifest = await buildManifest(root, await readJson(descriptorPath));
const errors = verifySemanticAssertions(manifest);
if (errors.length) throw new Error(`semantic assertions failed: ${errors.join(", ")}`);
await writeFile(outputPath, canonicalJson(manifest));
process.stdout.write(`${outputPath}\n${manifest.contentCommitmentSha256}\n`);
