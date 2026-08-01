import assert from "node:assert/strict";
import test from "node:test";
import {
  declaredSoliditySourceAndTestPaths,
  isCanonicalReviewTargetPath,
  isGitLfsPointer,
  REVIEW_TARGET_CLOSURE_METHOD_V1,
  REVIEW_TARGET_CONTRACT_V1
} from "../review-target-contract.mjs";

test("review-target authority separation is visibly versioned as closure method v9", () => {
  assert.equal(
    REVIEW_TARGET_CLOSURE_METHOD_V1,
    "declared-bytes-and-resolved-solidity-and-javascript-imports-v9"
  );
  assert.notEqual(
    REVIEW_TARGET_CLOSURE_METHOD_V1,
    "declared-bytes-and-resolved-solidity-and-javascript-imports-v8"
  );
});

test("canonical review paths accept NFC UTF-8 and spaces through the bounded contract", () => {
  const exactDepth = Array.from({ length: 24 }, (_, index) => `segment ${index}`).join("/");
  const exactBytes = `${"é".repeat(250)}/${"a".repeat(250)}/${"b".repeat(250)}/${"c".repeat(21)}`;

  assert.equal(isCanonicalReviewTargetPath("app/Über uns/route test.ts"), true);
  assert.equal(isCanonicalReviewTargetPath(exactDepth), true);
  assert.equal(Buffer.byteLength(exactBytes, "utf8"), REVIEW_TARGET_CONTRACT_V1.maximumPathBytes);
  assert.equal(isCanonicalReviewTargetPath(exactBytes), true);
  assert.equal(isCanonicalReviewTargetPath(`${exactDepth}/too-deep`), false);
  assert.equal(isCanonicalReviewTargetPath(`${exactBytes}x`), false);
  assert.equal(isCanonicalReviewTargetPath("app/U\u0308ber uns/route.ts"), false);
  assert.equal(isCanonicalReviewTargetPath("app/.git/config"), false);
  assert.equal(isCanonicalReviewTargetPath("app/.GIT/config"), false);
  assert.equal(isCanonicalReviewTargetPath("app/.Git/config"), false);
  assert.equal(isCanonicalReviewTargetPath("C:/src/Hook.sol"), false);
});

test("Solidity closure discovery includes implementation and every declared integration/app surface", () => {
  const submission = {
    implementation: {
      sourcePaths: ["contracts/Token.sol"],
      testPaths: ["test/Token.t.sol"]
    },
    integration: {
      appSourcePaths: ["app/RouterAdapter.sol"],
      integrationTestPaths: ["app/RouterAdapter.test.sol"],
      routingAndDiscoverability: { sourcePaths: ["routing/Encoder.sol"], testPaths: [] },
      dataReconstruction: { sourcePaths: ["indexer/Decoder.sol"], testPaths: [] },
      platformHandoff: {
        websiteRegistryPath: "models/registry.json",
        uiSourcePaths: ["ui/View.tsx"],
        apiSourcePaths: ["api/Quote.sol"],
        indexerSourcePaths: [],
        testPaths: ["test/Handoff.sol"]
      }
    },
    capabilityExtensions: [{ sourcePaths: ["extensions/Rule.sol"], testPaths: [] }]
  };

  assert.deepEqual(declaredSoliditySourceAndTestPaths(submission), [
    "api/Quote.sol",
    "app/RouterAdapter.sol",
    "app/RouterAdapter.test.sol",
    "contracts/Token.sol",
    "extensions/Rule.sol",
    "indexer/Decoder.sol",
    "routing/Encoder.sol",
    "test/Handoff.sol",
    "test/Token.t.sol"
  ]);
});

test("Git LFS pointers are recognized as pointers rather than source bytes", () => {
  const pointer = Buffer.from([
    "version https://git-lfs.github.com/spec/v1",
    `oid sha256:${"a".repeat(64)}`,
    "size 12345",
    ""
  ].join("\n"));

  assert.equal(isGitLfsPointer(pointer), true);
  assert.equal(isGitLfsPointer(Buffer.from("export const version = 'https://git-lfs.github.com/spec/v1';\n")), false);
});
