import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID,
  REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1,
  STANDARD_AMM_QUADRANTS_V1,
  canonicalFeeConformanceReceiptBytesV1,
  createFeeConformanceReceiptV1,
  feeConformanceReceiptScopeProfileKeyV1,
  feeConformanceReceiptSha256V1,
  projectFeeConformanceReceiptV1,
  validateFeeConformanceCompletionV1,
  validateFeeConformanceReceiptV1
} from "../fee-conformance-receipt-v1-core.mjs";
import { UINT256_MAX_V2 } from "../fee-policy-v2-core.mjs";
import { validateAgainstSchema } from "../submission-core.mjs";
import { createFeeConformanceFixtureV1 } from "./fee-conformance-v1-fixture.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../..");
const receiptSchema = JSON.parse(fs.readFileSync(path.join(
  skillRoot,
  "references",
  "fee-conformance-receipt-v1.schema.json"
), "utf8"));

function standardModes() {
  return [
    {
      id: "one-for-zero-exact-input",
      executionModel: "synchronous",
      direction: "one-for-zero",
      exactness: "exact-input",
      quoteRole: "unspecified"
    },
    {
      id: "one-for-zero-exact-output",
      executionModel: "synchronous",
      direction: "one-for-zero",
      exactness: "exact-output",
      quoteRole: "specified"
    },
    {
      id: "zero-for-one-exact-input",
      executionModel: "synchronous",
      direction: "zero-for-one",
      exactness: "exact-input",
      quoteRole: "specified"
    },
    {
      id: "zero-for-one-exact-output",
      executionModel: "synchronous",
      direction: "zero-for-one",
      exactness: "exact-output",
      quoteRole: "unspecified"
    }
  ];
}

function makeReceipt(overrides = {}) {
  const modes = standardModes();
  const base = {
    receiptId: "fee-conformance-main-market",
    applicationId: "bound-open-world-project",
    scope: {
      feeScopeId: "main-market-scope",
      marketRef: "main-market",
      chainId: "1",
      poolId: `0x${"11".repeat(32)}`,
      quoteCurrency: `0x${"00".repeat(20)}`,
      collectionProfile: "standard-amm"
    },
    implementation: {
      artifactRef: "hook-implementation",
      artifactSha256: `sha256:${"22".repeat(32)}`,
      sourceRef: "project-source",
      revisionObjectId: "33".repeat(20),
      treeObjectId: "44".repeat(20),
      path: "src/ProgrammableVolumeFeeHookV2.sol"
    },
    executionSurfaceCoverageSha256: `sha256:${"55".repeat(32)}`,
    surfaceScopeMappings: [{
      surfaceId: "canonical-hook-surface",
      marketRef: "main-market",
      feeScopeId: "main-market-scope",
      collectionProfile: "standard-amm",
      implementationArtifactRef: "hook-implementation",
      implementationArtifactSha256: `sha256:${"22".repeat(32)}`,
      modes
    }],
    vectorSet: {
      evidenceRef: "fee-vector-set-main-market",
      sha256: `sha256:${"66".repeat(32)}`,
      modeCoverage: modes.map((mode) => ({
        surfaceId: "canonical-hook-surface",
        modeId: mode.id,
        vectorIds: [`vector-${mode.id}`]
      })),
      assertionCoverage: REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1.map((assertionId) => ({
        assertionId,
        vectorIds: [`vector-${assertionId}`]
      }))
    }
  };
  return createFeeConformanceReceiptV1({ ...base, ...overrides });
}

function expectedFor(receipt) {
  return {
    applicationId: receipt.applicationId,
    feeScope: {
      id: receipt.scope.feeScopeId,
      marketRef: receipt.scope.marketRef,
      chainId: receipt.scope.chainId,
      poolId: receipt.scope.poolId.toUpperCase().replace("0X", "0x"),
      quoteCurrency: receipt.scope.quoteCurrency.toUpperCase().replace("0X", "0x"),
      collectionProfile: receipt.scope.collectionProfile
    },
    collectionProfile: receipt.scope.collectionProfile,
    implementation: { ...receipt.implementation },
    executionSurfaceCoverageSha256: receipt.executionSurfaceCoverageSha256,
    surfaceScopeMappings: structuredClone(receipt.surfaceScopeMappings),
    vectorSetSha256: receipt.vectorSet.sha256
  };
}

test("authoritative receipt schema and semantic validator accept one exact standard-amm scope", () => {
  const receipt = makeReceipt();
  assert.equal(receipt.$schema, FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID);
  assert.deepEqual(validateAgainstSchema(receipt, receiptSchema), []);
  assert.deepEqual(validateFeeConformanceReceiptV1(receipt), []);
  assert.deepEqual(validateFeeConformanceReceiptV1(receipt, expectedFor(receipt)), []);
  assert.deepEqual(
    receipt.surfaceScopeMappings[0].modes.map(({ id }) => id),
    STANDARD_AMM_QUADRANTS_V1
  );
  assert.match(feeConformanceReceiptSha256V1(receipt), /^sha256:[0-9a-f]{64}$/);
  assert.equal(canonicalFeeConformanceReceiptBytesV1(receipt).at(-1), 10);
  assert.match(
    feeConformanceReceiptScopeProfileKeyV1(receipt),
    /bound-open-world-project:main-market-scope:1:0x(?:11){32}:0x(?:00){20}:standard-amm/
  );
  const projection = projectFeeConformanceReceiptV1(receipt);
  assert.deepEqual(projection.surfaceScopeMappings[0].modes, standardModes());
  assert.equal(projection.vectorSetSha256, receipt.vectorSet.sha256);
});

test("complete cannot be asserted with arbitrary strings or a dangling vector-set digest", () => {
  const bundle = createFeeConformanceFixtureV1();
  const { receipt } = bundle;
  const arbitrary = validateFeeConformanceCompletionV1({
    conformance: { status: "complete", evidenceRefs: ["looks-good"] },
    receipt,
    receiptEvidenceRef: receipt.receiptId,
    vectorSet: bundle.vectorSet,
    vectorSetBytes: bundle.vectorSetBytes,
    evidenceDigests: bundle.evidenceDigests,
    expected: expectedFor(receipt)
  });
  assert.match(arbitrary.join("\n"), /typed fee-conformance receipt/);
  assert.match(arbitrary.join("\n"), /exact vector-set evidence bytes/);

  assert.deepEqual(validateFeeConformanceCompletionV1({
    conformance: bundle.conformance,
    receipt,
    receiptEvidenceRef: receipt.receiptId,
    vectorSet: bundle.vectorSet,
    vectorSetBytes: bundle.vectorSetBytes,
    evidenceDigests: bundle.evidenceDigests,
    expected: bundle.expected
  }), []);

  const wrongId = structuredClone(receipt);
  wrongId.receiptId = "different-receipt";
  assert.match(validateFeeConformanceCompletionV1({
    conformance: bundle.conformance,
    receipt: wrongId,
    receiptEvidenceRef: receipt.receiptId,
    vectorSet: bundle.vectorSet,
    vectorSetBytes: bundle.vectorSetBytes,
    evidenceDigests: bundle.evidenceDigests,
    expected: bundle.expected
  }).join("\n"), /receipt evidence binding id/);
});

test("stale scope profile implementation coverage surface or mode bindings fail closed", () => {
  const receipt = makeReceipt();
  for (const [label, mutate, pattern] of [
    ["scope", (expected) => { expected.feeScope.chainId = "8453"; }, /expected chainId/],
    ["profile", (expected) => { expected.collectionProfile = "custom-reviewed"; }, /expected collectionProfile/],
    ["implementation", (expected) => { expected.implementation.artifactSha256 = `sha256:${"77".repeat(32)}`; }, /expected artifactSha256/],
    ["coverage", (expected) => { expected.executionSurfaceCoverageSha256 = `sha256:${"88".repeat(32)}`; }, /execution-surface coverage/],
    ["surface", (expected) => { expected.surfaceScopeMappings[0].surfaceId = "stale-surface"; }, /surface\/scope\/implementation mappings/],
    ["mode", (expected) => { expected.surfaceScopeMappings[0].modes.pop(); }, /surface\/scope\/implementation mappings/],
    ["mode semantics", (expected) => { expected.surfaceScopeMappings[0].modes[0].quoteRole = "specified"; }, /surface\/scope\/implementation mappings/],
    ["vectors", (expected) => { expected.vectorSetSha256 = `sha256:${"99".repeat(32)}`; }, /vector-set digest/]
  ]) {
    const expected = expectedFor(receipt);
    mutate(expected);
    assert.match(validateFeeConformanceReceiptV1(receipt, expected).join("\n"), pattern, label);
  }
});

test("duplicates missing quadrants uncovered modes missing assertions and placeholders are rejected", () => {
  const valid = makeReceipt();
  const mutations = [
    ["duplicate surface", (receipt) => { receipt.surfaceScopeMappings.push(structuredClone(receipt.surfaceScopeMappings[0])); }, /surfaceId values must be unique/],
    ["duplicate mode", (receipt) => { receipt.surfaceScopeMappings[0].modes.push(structuredClone(receipt.surfaceScopeMappings[0].modes[0])); }, /id values must be unique/],
    ["missing quadrant", (receipt) => { receipt.surfaceScopeMappings[0].modes.pop(); }, /standard-amm coverage is missing/],
    ["missing mode coverage", (receipt) => { receipt.vectorSet.modeCoverage.pop(); }, /missing vector coverage/],
    ["duplicate mode coverage", (receipt) => { receipt.vectorSet.modeCoverage.push(structuredClone(receipt.vectorSet.modeCoverage[0])); }, /surfaceId \+ modeId values must be unique/],
    ["missing assertion", (receipt) => { receipt.vectorSet.assertionCoverage.pop(); }, /mandatory assertions/],
    ["duplicate assertion", (receipt) => { receipt.vectorSet.assertionCoverage[1].assertionId = receipt.vectorSet.assertionCoverage[0].assertionId; }, /must be unique/],
    ["placeholder implementation", (receipt) => { receipt.implementation.artifactSha256 = `sha256:${"00".repeat(32)}`; }, /non-placeholder sha256/],
    ["placeholder coverage", (receipt) => { receipt.executionSurfaceCoverageSha256 = `sha256:${"00".repeat(32)}`; }, /non-placeholder sha256/],
    ["cross-scope mapping", (receipt) => { receipt.surfaceScopeMappings[0].feeScopeId = "other-scope"; }, /must equal the receipt feeScopeId/],
    ["wrong artifact mapping", (receipt) => { receipt.surfaceScopeMappings[0].implementationArtifactRef = "other-artifact"; }, /must equal the receipt implementation artifactRef/]
  ];
  for (const [label, mutate, pattern] of mutations) {
    const receipt = structuredClone(valid);
    mutate(receipt);
    assert.match(validateFeeConformanceReceiptV1(receipt).join("\n"), pattern, label);
  }
});

test("chainId is an exact positive uint256 string and repository paths have no arbitrary length cap", () => {
  const maximum = makeReceipt({
    scope: {
      ...makeReceipt().scope,
      chainId: UINT256_MAX_V2.toString()
    },
    implementation: {
      ...makeReceipt().implementation,
      path: `src/${"a".repeat(3_000)}.sol`
    }
  });
  assert.deepEqual(validateFeeConformanceReceiptV1(maximum), []);
  assert.deepEqual(validateAgainstSchema(maximum, receiptSchema), []);
  assert.equal(receiptSchema.$defs.repositoryPath.maxLength, undefined);

  for (const chainId of ["", "0", "01", "+1", "-1", " 1", "1 ", "1.0", "1e3", 1, (UINT256_MAX_V2 + 1n).toString()]) {
    const receipt = structuredClone(maximum);
    receipt.scope.chainId = chainId;
    assert.match(validateFeeConformanceReceiptV1(receipt).join("\n"), /canonical positive uint256/);
  }
});

test("custom-reviewed profiles remain open while every declared mode stays vector-bound", () => {
  const mode = {
    id: "finalized-batch-fill",
    executionModel: "asynchronous",
    direction: "profile-specific",
    exactness: "profile-specific",
    quoteRole: "profile-specific"
  };
  const receipt = makeReceipt({
    scope: {
      ...makeReceipt().scope,
      collectionProfile: "custom-reviewed"
    },
    surfaceScopeMappings: [{
      ...makeReceipt().surfaceScopeMappings[0],
      collectionProfile: "custom-reviewed",
      modes: [mode]
    }],
    vectorSet: {
      ...makeReceipt().vectorSet,
      modeCoverage: [{
        surfaceId: "canonical-hook-surface",
        modeId: mode.id,
        vectorIds: ["vector-finalized-batch-fill"]
      }]
    }
  });
  assert.deepEqual(validateFeeConformanceReceiptV1(receipt), []);
  assert.deepEqual(validateAgainstSchema(receipt, receiptSchema), []);
});
