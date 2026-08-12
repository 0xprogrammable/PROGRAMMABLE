import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateReviewedDriftReceipt } from "../reviewed-drift-receipt-core.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = path.join(skillRoot, "references/upstream-sources.json");
const receiptPath = path.join(skillRoot, "references/upstream-reviewed-drift-v1.json");
const sourceBytes = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBytes);
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const availablePaths = new Set(walkFiles(skillRoot));

test("reviewed upstream drift receipt is source-bound and keeps baseline and deployment feed unchanged", () => {
  assert.equal(validateReviewedDriftReceipt(receipt, source, { sourceBytes, availablePaths }), true);
  assert.equal(receipt.entries.length, 7);
  assert.equal(receipt.testedBaseline.action, "unchanged");
  assert.equal(receipt.deploymentFeed.action, "unchanged");
});

test("reviewed upstream drift receipt rejects commit, range and changed-file tampering", () => {
  const commitTamper = structuredClone(receipt);
  commitTamper.entries[0].toCommit = "0".repeat(40);
  assert.throws(() => validateReviewedDriftReceipt(commitTamper, source, { sourceBytes, availablePaths }), /toCommit binding/u);

  const rangeTamper = structuredClone(receipt);
  rangeTamper.entries[0].fromCommit = rangeTamper.entries[0].toCommit;
  assert.throws(() => validateReviewedDriftReceipt(rangeTamper, source, { sourceBytes, availablePaths }), /non-empty commit range/u);

  const fileTamper = structuredClone(receipt);
  fileTamper.entries[0].changedFiles.push("../outside");
  assert.throws(() => validateReviewedDriftReceipt(fileTamper, source, { sourceBytes, availablePaths }), /unique|sort order|unsafe/u);
});

test("reviewed upstream drift receipt rejects source-map, baseline and adoption drift", () => {
  const sourceTamper = Buffer.from(sourceBytes);
  sourceTamper[0] = sourceTamper[0] === 0x7b ? 0x20 : 0x7b;
  assert.throws(() => validateReviewedDriftReceipt(receipt, source, { sourceBytes: sourceTamper, availablePaths }), /source-map byte digest/u);

  const baselineTamper = structuredClone(receipt);
  baselineTamper.testedBaseline.bindings[0].commit = "0".repeat(40);
  assert.throws(() => validateReviewedDriftReceipt(baselineTamper, source, { sourceBytes, availablePaths }), /tested baseline bindings/u);

  const adoptionTamper = structuredClone(receipt);
  adoptionTamper.entries[0].adoptedGuidance = ["references/does-not-exist.md"];
  assert.throws(() => validateReviewedDriftReceipt(adoptionTamper, source, { sourceBytes, availablePaths }), /missing package path/u);
});

function walkFiles(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(absolute));
    } else if (entry.isFile()) {
      result.push(path.relative(skillRoot, absolute).split(path.sep).join("/"));
    }
  }
  return result;
}
