#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createRegistrySnapshot, openGitRegistry, RegistryDiscoveryError } from "./registry-discovery-core.mjs";
import { canonicalJson } from "./submission-core.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(skillRoot, "references/programmable-registry-snapshot.json");

try {
  const args = process.argv.slice(2);
  if (
    args.length !== 5
    || args[0] !== "--write"
    || args[1] !== "--registry-root"
    || args[3] !== "--registry-commit"
  ) {
    throw new RegistryDiscoveryError(
      "USAGE_ERROR",
      "use update-registry-snapshot.mjs --write --registry-root <path> --registry-commit <exact-public-origin-main-commit>",
      { exitCode: 2 }
    );
  }
  const session = openGitRegistry({ commit: args[4], repositoryRoot: args[2] });
  const snapshot = await createRegistrySnapshot(session);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${canonicalJson(snapshot)}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 });
  fs.renameSync(temporary, target);
  process.stdout.write(`${canonicalJson({
    capturedAt: snapshot.capturedAt,
    ok: true,
    projects: snapshot.projects.length,
    registryDigest: snapshot.index.registryDigest,
    sourceCommit: snapshot.sourceReceipt.commitObjectId,
    sourceMode: session.source.mode,
    sourceTree: snapshot.sourceReceipt.treeObjectId
  })}\n`);
} catch (error) {
  process.stdout.write(`${canonicalJson({
    error: {
      code: error instanceof RegistryDiscoveryError ? error.code : "REGISTRY_SNAPSHOT_UPDATE_FAILED",
      message: error instanceof Error ? error.message : "Registry snapshot update failed"
    },
    ok: false
  })}\n`);
  process.exitCode = error instanceof RegistryDiscoveryError ? error.exitCode : 1;
}
