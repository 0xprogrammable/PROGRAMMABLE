#!/usr/bin/env node

import { resolve } from "node:path";

import {
  buildShardsSuccessorManifests,
  verifyShardsSuccessorManifests,
} from "./shards-successor-manifest-core.mjs";

if (process.argv.length !== 2) throw new TypeError("this verifier takes no arguments");

const result = await buildShardsSuccessorManifests({ contractsRoot: resolve(import.meta.dirname, "..") });
await verifyShardsSuccessorManifests(result);
process.stdout.write(
  `verified ${Object.values(result.input.outputs).map((path) => `contracts/${path}`).join(", ")}\n`,
);
