import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { keccak256 } from "viem";

import {
  loadExactShardsCreationCode,
  loadExactShardsBuildBindings,
  predictExactShardsLaunchV2,
} from "./shards-v2-predictor.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const contractsRoot = resolve(scriptsDir, "..");
const vectorPath = resolve(contractsRoot, "spec/shards-v2-predictor-golden.json");
const vector = JSON.parse(await readFile(vectorPath, "utf8"));
const creationCode = await loadExactShardsCreationCode(contractsRoot);
const buildBindings = await loadExactShardsBuildBindings(contractsRoot);
const input = {
  ...vector.input,
  chainId: BigInt(vector.input.chainId),
  params: {
    ...vector.input.params,
    startSqrtPriceX96: BigInt(vector.input.params.startSqrtPriceX96),
  },
  hookSalt: vector.expected.hookSalt,
  ...creationCode,
};
const actual = predictExactShardsLaunchV2(input);

assert.equal(vector.schemaVersion, "programmable.exact-shards-v2-predictor-golden.v1");
assert.equal(vector.activationAllowed, false);
assert.equal(vector.launchAllowed, false);
assert.deepEqual(vector.buildBindings, buildBindings);
assert.equal(vector.input.creationCodeHashes.shardToken, keccak256(creationCode.shardTokenCreationCode));
assert.equal(vector.input.creationCodeHashes.shardHook, keccak256(creationCode.shardHookCreationCode));
assert.equal(vector.input.creationCodeHashes.shardNft, keccak256(creationCode.shardNftCreationCode));
for (const [field, expected] of Object.entries(vector.expected)) {
  if (field === "attempts") continue;
  const value = actual[field];
  assert.notEqual(value, undefined, `unknown expected field ${field}`);
  assert.equal(typeof value === "bigint" ? value.toString() : value, expected, field);
}
assert.equal(actual.hasRequiredHookFlags, true);
assert.equal(keccak256(actual.innerCalldata), actual.innerCalldataKeccak256);
process.stdout.write(`verified ${vectorPath}\n`);
