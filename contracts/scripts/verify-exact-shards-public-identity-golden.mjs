import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const expected = JSON.parse(await readFile(
  new URL("../spec/exact-shards-public-identity-golden.json", import.meta.url),
));
const actual = JSON.parse(execFileSync(
  process.execPath,
  [new URL("generate-exact-shards-public-identity-golden.mjs", import.meta.url).pathname],
  { encoding: "utf8" },
));

assert.deepEqual(actual, expected, "ExactShards public identity golden drift");
assert.match(expected.project.digest, /^sha256:[0-9a-f]{64}$/u);
assert.equal(expected.project.rawBytes32, `0x${expected.project.digest.slice("sha256:".length)}`);
assert.match(expected.launch.digest, /^sha256:[0-9a-f]{64}$/u);
assert.equal(expected.launch.rawBytes32, `0x${expected.launch.digest.slice("sha256:".length)}`);
assert.notEqual(
  expected.oneBitMutation.mutatedIdentityMappingHash,
  expected.registryBinding.identityMappingHash,
  "one-bit Website identity mutation must fail the exact mapping gate",
);
assert.equal(expected.oneBitMutation.exactMappingAccepted, false);

process.stdout.write(
  `${expected.schemaVersion}: ${expected.project.digest} -> ${expected.launch.digest} -> ${expected.registryBinding.identityMappingHash}\n`,
);
