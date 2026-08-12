import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../..");

test("historical V1 schema and policy bytes are explicitly frozen without rewriting their history", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "historical-v1-freeze.json"), "utf8"));
  assert.equal(manifest.schemaVersion, "1.0.0");
  assert.equal(manifest.status, "FROZEN_FROM_BUILDER_0_5_1");
  assert.match(manifest.historyDisclosure, /were not immutable before this manifest/u);
  assert.equal(manifest.files.length, 2);
  for (const record of manifest.files) {
    const absolutePath = path.resolve(skillRoot, record.path);
    assert.ok(absolutePath.startsWith(`${skillRoot}${path.sep}`));
    const digest = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex")}`;
    assert.equal(digest, record.sha256, record.path);
    assert.match(record.lastContentCommit, /^[0-9a-f]{40}$/u);
  }
});
