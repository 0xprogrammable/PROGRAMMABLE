import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { previewFeeSplitV2 } from "../fee-policy-v2-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const vectorPath = path.resolve(
  testDirectory,
  "../../assets/reference-kernels/programmable-volume-fee-v2/test/vectors/fee-policy-v2-vectors.json"
);

test("checked-in fee vectors match the JavaScript policy math exactly", () => {
  const vectors = JSON.parse(fs.readFileSync(vectorPath, "utf8"));
  assert.equal(vectors.schemaVersion, "1.0.0");
  const fields = [
    "grossQuoteAmount",
    "selectedTotalRate",
    "platformRemainder",
    "projectRemainder",
    "totalFee",
    "projectFee",
    "platformFee",
    "nextProjectRemainder",
    "nextPlatformRemainder",
    "atomicGrossFundingSufficient"
  ];
  const vectorCount = vectors.grossQuoteAmount.length;
  assert.ok(vectorCount > 0);
  for (const field of fields) assert.equal(vectors[field].length, vectorCount, field);

  for (let index = 0; index < vectorCount; index += 1) {
    const split = previewFeeSplitV2({
      grossQuoteAmount: BigInt(vectors.grossQuoteAmount[index]),
      selectedTotalRate: BigInt(vectors.selectedTotalRate[index]),
      platformRemainder: BigInt(vectors.platformRemainder[index]),
      projectRemainder: BigInt(vectors.projectRemainder[index])
    });
    assert.equal(split.totalFee, BigInt(vectors.totalFee[index]), `totalFee[${index}]`);
    assert.equal(split.projectFee, BigInt(vectors.projectFee[index]), `projectFee[${index}]`);
    assert.equal(split.platformFee, BigInt(vectors.platformFee[index]), `platformFee[${index}]`);
    assert.equal(
      split.nextProjectRemainder,
      BigInt(vectors.nextProjectRemainder[index]),
      `nextProjectRemainder[${index}]`
    );
    assert.equal(
      split.nextPlatformRemainder,
      BigInt(vectors.nextPlatformRemainder[index]),
      `nextPlatformRemainder[${index}]`
    );
    assert.equal(
      split.atomicGrossFundingSufficient,
      vectors.atomicGrossFundingSufficient[index] === 1,
      `atomicGrossFundingSufficient[${index}]`
    );
  }
});
