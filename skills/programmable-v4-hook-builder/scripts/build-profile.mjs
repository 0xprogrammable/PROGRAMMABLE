#!/usr/bin/env node

import process from "node:process";
import { parseCli, renderHelp } from "./cli-args.mjs";
import { inspectBuildProfiles, listBuildProfiles, showBuildProfile } from "./build-profile-core.mjs";
import { canonicalJson } from "./submission-core.mjs";

class UsageError extends Error {}

const specification = {
  command: "build-profile.mjs",
  usage: "build-profile.mjs <list | show | detect> [profile-id] [--repository-root <path>]",
  summary: "List or detect bounded build profiles without running project code or accessing the network.",
  options: [
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Inspect this repository for detect mode." }
  ],
  positionals: { min: 1, max: 2, names: ["operation", "profile-id"] }
};

const argumentsList = process.argv.slice(2);
if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
  process.stdout.write(`${renderHelp(specification)}\n`);
} else {
  let parsed;
  try {
    parsed = parseCli(specification, argumentsList);
  } catch (error) {
    writeCanonicalError("USAGE_ERROR", error, 2);
  }

  if (parsed) {
    try {
      const { options, positionals } = parsed;
      const [operation, profileId] = positionals;
      let result;
      if (operation === "list" && profileId === undefined && options.repositoryRoot === null) {
        result = listBuildProfiles();
      } else if (operation === "show" && profileId !== undefined && options.repositoryRoot === null) {
        result = showBuildProfile(profileId);
      } else if (operation === "detect" && profileId === undefined) {
        result = inspectBuildProfiles(options.repositoryRoot ?? process.cwd());
      } else {
        throw new UsageError("use list, show <profile-id>, or detect; --repository-root is only valid with detect");
      }
      process.stdout.write(`${canonicalJson(result)}\n`);
    } catch (error) {
      writeCanonicalError(error instanceof UsageError ? "USAGE_ERROR" : "BUILD_PROFILE_FAILED", error, error instanceof UsageError ? 2 : 1);
    }
  }
}

function writeCanonicalError(code, error, exitCode) {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${canonicalJson({
    schemaVersion: "1.0.0",
    ok: false,
    error: { code, message }
  })}\n`);
  process.exitCode = exitCode;
}
