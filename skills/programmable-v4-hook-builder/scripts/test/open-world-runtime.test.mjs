import assert from "node:assert/strict";
import test from "node:test";

import { createOpenWorldRuntime } from "../open-world-runtime.mjs";

test("the decomposed open-world runtime installs every historical command function exactly once", () => {
  const runtime = createOpenWorldRuntime();
  assert.equal(Object.getPrototypeOf(runtime), null);
  assert.equal(Object.keys(runtime).length, 202);
  assert.ok(Object.values(runtime).every((value) => typeof value === "function"));
  for (const name of [
    "executeInit",
    "executeValidate",
    "executeValidateApplication",
    "executeMigrate",
    "executeApplication",
    "executePrepareRevision",
    "executeGitHubTransport",
    "executeGitHubStatus",
    "verifyApplicationV3LocalTransportSources",
    "verifyRemoteApplicationV3SourceBindings",
    "executeConfirmedApplicationV3GitHubTransport",
    "reconcileApplicationV3MutationReceipt",
    "readApplicationV3GitHubStatus",
    "materializePackageAsync",
    "normalizeOpenWorldFailure"
  ]) assert.equal(typeof runtime[name], "function", name);
});

test("command parsing receives its command-spec dependency explicitly", () => {
  const runtime = createOpenWorldRuntime();
  runtime.commandSpecs = new Map([["validate", {
    usage: "open-world.mjs validate <package-directory>",
    summary: "test-only contract fixture",
    options: [],
    positionals: { min: 1, max: 1, names: ["package-directory"] }
  }]]);
  assert.deepEqual(runtime.parseCommand("validate", ["fixture"]), {
    options: {},
    positionals: ["fixture"]
  });
});
