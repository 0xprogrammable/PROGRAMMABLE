import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const expected = JSON.parse(await readFile(new URL("../spec/launch-permit-v1-golden.json", import.meta.url)));
const actual = JSON.parse(execFileSync(process.execPath, [new URL("generate-launch-permit-v1-golden.mjs", import.meta.url).pathname], {
  encoding: "utf8",
}));
assert.deepEqual(actual, expected, "LaunchPermitV1 golden drift");
process.stdout.write(`${expected.schemaVersion}: ${expected.permitDigest}\n`);
