#!/usr/bin/env node

import { resolve } from "node:path";

import {
  buildShardsSuccessorManifests,
  writeShardsSuccessorManifests,
} from "./shards-successor-manifest-core.mjs";

const arguments_ = new Set(process.argv.slice(2));
for (const argument of arguments_) {
  if (argument !== "--write") throw new TypeError(`unknown argument: ${argument}`);
}

const contractsRoot = resolve(import.meta.dirname, "..");
const result = await buildShardsSuccessorManifests({ contractsRoot });
if (arguments_.has("--write")) {
  await writeShardsSuccessorManifests(result);
  process.stdout.write(
    `wrote ${Object.values(result.input.outputs).map((path) => `contracts/${path}`).join(", ")}\n`,
  );
} else {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "programmable.exact-shards-successor-manifest-set.v2",
    manifests: result.manifests,
  }, null, 2)}\n`);
}
