#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { canonicalizeJson } from "../packages/launch/src/canonical-json.mjs";

export const PROGRAMMABLE_LAUNCH_TAG_RULESET = Object.freeze({
  id: 21679403,
  name: "Protect Programmable Launch CLI release tags",
  enforcement: "active",
  target: "tag",
  include: Object.freeze(["refs/tags/programmable-launch-v*"]),
  exclude: Object.freeze([]),
  ruleTypes: Object.freeze(["deletion", "update"]),
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameStrings(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function fail(detail) {
  throw new Error(`Programmable Launch CLI tag ruleset mismatch: ${detail}`);
}

export function assertProgrammableLaunchTagRuleset(ruleset) {
  const expected = PROGRAMMABLE_LAUNCH_TAG_RULESET;

  if (!isRecord(ruleset)) {
    fail("response must be an object");
  }
  for (const field of ["id", "name", "enforcement", "target"]) {
    if (ruleset[field] !== expected[field]) {
      fail(`${field} is not the exact protected value`);
    }
  }
  if (!Array.isArray(ruleset.bypass_actors) || ruleset.bypass_actors.length !== 0) {
    fail("bypass_actors must be an empty array");
  }

  if (!isRecord(ruleset.conditions)) {
    fail("conditions must be an object");
  }
  if (
    Object.keys(ruleset.conditions).length !== 1 ||
    !Object.hasOwn(ruleset.conditions, "ref_name")
  ) {
    fail("conditions must contain only ref_name");
  }
  const refName = ruleset.conditions.ref_name;
  if (!isRecord(refName)) {
    fail("conditions.ref_name must be an object");
  }
  if (
    Object.keys(refName).sort().join(",") !== "exclude,include" ||
    !sameStrings(refName.include, expected.include) ||
    !sameStrings(refName.exclude, expected.exclude)
  ) {
    fail("conditions.ref_name does not exactly protect the release tag pattern");
  }

  if (!Array.isArray(ruleset.rules) || ruleset.rules.length !== expected.ruleTypes.length) {
    fail("rules must contain exactly update and deletion protections");
  }
  const actualRuleTypes = [];
  for (const rule of ruleset.rules) {
    if (!isRecord(rule) || Object.keys(rule).join(",") !== "type") {
      fail("each rule must contain only its exact type");
    }
    actualRuleTypes.push(rule.type);
  }
  actualRuleTypes.sort();
  if (!sameStrings(actualRuleTypes, expected.ruleTypes)) {
    fail("rules must contain exactly update and deletion protections");
  }

  // updated_at is deliberately not an authorization input. GitHub may serialize
  // the same instant with a different timezone spelling; the stable protection
  // fields above are the fail-closed release boundary.
  return ruleset;
}

// GitHub omits bypass_actors unless the caller can write the ruleset. Never
// infer an empty list from omission: use the freshly verified owner signature.
export function assertOwnerBoundProgrammableLaunchTagRuleset(live, owner) {
  assertProgrammableLaunchTagRuleset(owner);
  if (!isRecord(live)) fail("live response must be an object");
  if (Object.hasOwn(live, "bypass_actors")) assertProgrammableLaunchTagRuleset(live);
  for (const field of ["id", "name", "target", "enforcement", "conditions", "rules"]) {
    if (canonicalizeJson(live[field]) !== canonicalizeJson(owner[field])) {
      fail(`live ${field} differs from the signed owner observation`);
    }
  }
  const observedUpdate = Date.parse(owner.updated_at);
  if (typeof owner.updated_at !== "string" || !Number.isFinite(observedUpdate)
    || typeof live.updated_at !== "string" || Date.parse(live.updated_at) !== observedUpdate) {
    fail("live updated_at differs from the signed owner observation");
  }
  return owner;
}

async function main(argv) {
  if (argv.length !== 1 && !(argv.length === 2 && argv[1] === "--owner-preflight")) {
    throw new Error("Usage: verify-programmable-launch-tag-ruleset.mjs <ruleset.json>");
  }
  const ruleset = JSON.parse(await readFile(argv[0], "utf8"));
  if (argv.length === 1) return assertProgrammableLaunchTagRuleset(ruleset);
  const { verifyImmutableReleaseOwnerPreflight, IMMUTABLE_RELEASE_PREFLIGHT_ALLOWED_SIGNERS_PATH } =
    await import("./verify-immutable-release-owner-preflight.mjs");
  const verified = verifyImmutableReleaseOwnerPreflight({
    recordBase64: process.env.IMMUTABLE_RELEASES_PREFLIGHT_RECORD_BASE64,
    signatureBase64: process.env.IMMUTABLE_RELEASES_PREFLIGHT_SIGNATURE_BASE64,
    allowedSignersPath: IMMUTABLE_RELEASE_PREFLIGHT_ALLOWED_SIGNERS_PATH,
    repository: process.env.GITHUB_REPOSITORY,
    repositoryId: process.env.GITHUB_REPOSITORY_ID,
    revision: process.env.GITHUB_SHA,
    environment: "production",
    actorId: process.env.GITHUB_ACTOR_ID,
    actorLogin: process.env.GITHUB_ACTOR,
  });
  return assertOwnerBoundProgrammableLaunchTagRuleset(ruleset, verified.tagRuleset);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
