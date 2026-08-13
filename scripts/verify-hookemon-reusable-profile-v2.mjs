#!/usr/bin/env node
import path from "node:path";
import { buildManifest, canonicalJson, readJson, verifySemanticAssertions } from "./hookemon-reusable-profile-v2-core.mjs";

const root = process.cwd();
const descriptor = await readJson(path.join(root, "spec/router-vnext/hookemon-reusable-profile-v2-reviewed-input.json"));
const tracked = await readJson(path.join(root, "spec/router-vnext/hookemon-reusable-profile-v2-manifest.json"));
const generated = await buildManifest(root, descriptor);
if (canonicalJson(tracked) !== canonicalJson(generated)) throw new Error("tracked manifest is stale");
const errors = verifySemanticAssertions(generated);
if (errors.length) throw new Error(`semantic assertions failed: ${errors.join(", ")}`);
process.stdout.write(`Hookemon V2 manifest verified: ${generated.contentCommitmentSha256}\n`);
