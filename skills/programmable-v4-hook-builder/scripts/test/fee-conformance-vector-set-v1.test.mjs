import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalFeeConformanceVectorSetBytesV1,
  feeConformanceVectorEvidenceDigestsV1,
  feeConformanceVectorSetSha256V1,
  projectFeeConformanceVectorCoverageV1,
  validateFeeConformanceVectorSetV1
} from "../fee-conformance-vector-set-v1-core.mjs";
import { validateFeeConformanceCompletionV1 } from "../fee-conformance-receipt-v1-core.mjs";
import { validateAgainstSchema } from "../submission-core.mjs";
import { createFeeConformanceFixtureV1 } from "./fee-conformance-v1-fixture.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../..");
const schema = JSON.parse(fs.readFileSync(path.join(
  skillRoot,
  "references",
  "fee-conformance-vector-set-v1.schema.json"
), "utf8"));

test("typed vector set recomputes fee math and closes receipt coverage exactly", () => {
  const fixture = createFeeConformanceFixtureV1();
  assert.deepEqual(validateAgainstSchema(fixture.vectorSet, schema), []);
  assert.deepEqual(validateFeeConformanceVectorSetV1(fixture.vectorSet, { receipt: fixture.receipt }), []);
  assert.deepEqual(projectFeeConformanceVectorCoverageV1(fixture.vectorSet), {
    modeCoverage: fixture.receipt.vectorSet.modeCoverage,
    assertionCoverage: fixture.receipt.vectorSet.assertionCoverage
  });
  assert.equal(feeConformanceVectorSetSha256V1(fixture.vectorSet), fixture.receipt.vectorSet.sha256);
  assert.deepEqual(feeConformanceVectorEvidenceDigestsV1(fixture.vectorSet), {
    "fee-v2-conformance-test-log": `sha256:${"aa".repeat(32)}`
  });
  assert.deepEqual(validateFeeConformanceCompletionV1({
    conformance: fixture.conformance,
    receipt: fixture.receipt,
    receiptEvidenceRef: fixture.receipt.receiptId,
    vectorSet: fixture.vectorSet,
    vectorSetBytes: fixture.vectorSetBytes,
    evidenceDigests: fixture.evidenceDigests,
    expected: fixture.expected
  }), []);
});

test("bogus arithmetic missing rate categories and stale vector ids cannot claim conformance", () => {
  const fixture = createFeeConformanceFixtureV1();

  const bogusMath = structuredClone(fixture.vectorSet);
  bogusMath.mathVectors[0].expected.platformFee = "999999";
  assert.match(validateFeeConformanceVectorSetV1(bogusMath).join("\n"), /authoritative policy result/);

  const missingCategory = structuredClone(fixture.vectorSet);
  missingCategory.mathVectors = missingCategory.mathVectors.filter(({ id }) => (
    id !== "one-for-zero-exact-input-below-floor"
  ));
  assert.match(validateFeeConformanceVectorSetV1(missingCategory).join("\n"), /missing below-floor/);

  const staleReceipt = structuredClone(fixture.receipt);
  staleReceipt.vectorSet.modeCoverage[0].vectorIds.pop();
  assert.match(
    validateFeeConformanceVectorSetV1(fixture.vectorSet, { receipt: staleReceipt }).join("\n"),
    /must exactly project every typed vector/
  );

  const noncanonicalBytes = Buffer.concat([
    canonicalFeeConformanceVectorSetBytesV1(fixture.vectorSet),
    Buffer.from("\n")
  ]);
  assert.match(validateFeeConformanceCompletionV1({
    ...fixture,
    receiptEvidenceRef: fixture.receipt.receiptId,
    vectorSetBytes: noncanonicalBytes
  }).join("\n"), /canonical validated vector-set bytes/);
});

test("custom-reviewed >=100 percent vectors require exact segregated funding and solvency/refund evidence", () => {
  const fixture = createFeeConformanceFixtureV1({
    collectionProfile: "custom-reviewed",
    externalFundingModels: ["sponsor-segregated", "collateral-segregated"]
  });
  assert.deepEqual(validateAgainstSchema(fixture.vectorSet, schema), []);
  assert.deepEqual(validateFeeConformanceVectorSetV1(fixture.vectorSet, { receipt: fixture.receipt }), []);
  const external = fixture.vectorSet.mathVectors.filter(({ fundingModel }) => fundingModel !== "user-funded");
  assert.equal(external.length, 8);
  for (const vector of external) {
    assert.equal(BigInt(vector.selectedTotalRate) >= 1_000_000n, true);
    assert.equal(vector.externalFundingAmount, vector.expected.totalFee);
    assert.equal(vector.expected.userQuoteResidual, vector.grossQuoteAmount);
  }

  const underfunded = structuredClone(fixture.vectorSet);
  const sponsored = underfunded.mathVectors.find(({ fundingModel }) => fundingModel === "sponsor-segregated");
  sponsored.externalFundingAmount = (BigInt(sponsored.externalFundingAmount) - 1n).toString();
  assert.match(validateFeeConformanceVectorSetV1(underfunded).join("\n"), /exactly equal the full segregated fee/);

  for (const kind of [
    "segregated-prefunding-solvency",
    "underfunded-no-state-change",
    "refund-cancel-obligations-preserved"
  ]) {
    const missing = structuredClone(fixture.vectorSet);
    missing.behaviorVectors = missing.behaviorVectors.filter((vector) => !(
      vector.kind === kind && vector.fundingModel === "sponsor-segregated"
    ));
    assert.match(validateFeeConformanceVectorSetV1(missing).join("\n"), new RegExp(kind));
  }
});

test("standard kernel stays below 100 percent and rejects external funding claims", () => {
  const fixture = createFeeConformanceFixtureV1();
  assert.deepEqual(fixture.vectorSet.supportedFundingModels, ["user-funded"]);
  assert.equal(fixture.vectorSet.mathVectors.every(({ selectedTotalRate }) => BigInt(selectedTotalRate) < 1_000_000n), true);
  const boundaryModes = fixture.vectorSet.behaviorVectors.filter(({ kind }) => kind === "user-funded-rate-boundary");
  assert.equal(boundaryModes.length, 4);
  assert.equal(boundaryModes.every(({ selectedTotalRate }) => selectedTotalRate === "1000000"), true);

  const forged = structuredClone(fixture.vectorSet);
  forged.supportedFundingModels.push("sponsor-segregated");
  assert.match(validateFeeConformanceVectorSetV1(forged).join("\n"), /standard-amm kernel supports only user-funded/);
});

test("chain and all policy amounts remain canonical uint256 decimal strings", () => {
  const fixture = createFeeConformanceFixtureV1();
  for (const value of [
    fixture.vectorSet.scope.chainId,
    ...fixture.vectorSet.mathVectors.flatMap((vector) => [
      vector.grossQuoteAmount,
      vector.selectedTotalRate,
      vector.platformRemainder,
      vector.projectRemainder,
      vector.externalFundingAmount,
      vector.expected.totalFee
    ])
  ]) assert.equal(typeof value, "string");

  for (const invalid of ["01", "+1", "1.0", "1e3", 1]) {
    const vectorSet = structuredClone(fixture.vectorSet);
    vectorSet.mathVectors[0].grossQuoteAmount = invalid;
    assert.match(validateFeeConformanceVectorSetV1(vectorSet).join("\n"), /canonical uint256 decimal string/);
  }
});
