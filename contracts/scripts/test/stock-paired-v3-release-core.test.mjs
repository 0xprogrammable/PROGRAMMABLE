import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  STOCK_PAIRED_V3_MANIFEST_PATH,
  STOCK_PAIRED_V3_SOURCE_COMMITMENT,
  stockPairedReleaseDescriptor,
} from "../../../scripts/stock-paired-v3-release-core.mjs";

test("resolves the V3 release without changing the public model name", () => {
  assert.deepEqual(stockPairedReleaseDescriptor("v3"), {
    version: "v3",
    expanded: true,
    v3: true,
    manifestPath: STOCK_PAIRED_V3_MANIFEST_PATH,
    defaultCanaryPort: 4195,
  });
  assert.match(STOCK_PAIRED_V3_SOURCE_COMMITMENT, /^0x[0-9a-f]{64}$/);
});

test("preserves the reviewed V1 and V2 canary endpoints", () => {
  assert.equal(
    stockPairedReleaseDescriptor("v1").manifestPath,
    "contracts/deployments/mainnet-stock-paired-v1.json",
  );
  assert.equal(stockPairedReleaseDescriptor("v1").defaultCanaryPort, 4191);
  assert.equal(
    stockPairedReleaseDescriptor("v2").manifestPath,
    "contracts/deployments/mainnet-stock-paired-v2.json",
  );
  assert.equal(stockPairedReleaseDescriptor("v2").defaultCanaryPort, 4193);
});

test("rejects unknown release selectors", () => {
  assert.throws(
    () => stockPairedReleaseDescriptor("latest"),
    /must be v1, v2 or v3/,
  );
});

test("records exact V3 sources and the separately gated public activation", () => {
  const manifest = JSON.parse(
    readFileSync(STOCK_PAIRED_V3_MANIFEST_PATH, "utf8"),
  );
  const evidence = JSON.parse(
    readFileSync(
      "contracts/deployments/evidence/stock-paired-v3-mainnet-release.json",
      "utf8",
    ),
  );
  const fields = ["positionPlanner", "launcher", "ethLaunchCoordinator"];

  assert.equal(
    manifest.status,
    "deployment-source-and-lifecycle-verified",
  );
  assert.equal(manifest.sourceVerification.status, "verified");
  assert.equal(manifest.activation.publicLaunchesEnabled, true);
  assert.equal(manifest.lifecycleEvidence.releaseEligible, true);
  assert.equal(evidence.publicLaunchesEnabled, true);

  for (const field of fields) {
    const source = manifest.sourceVerification[field];
    const captured = evidence.sourceVerification.contracts[field];
    assert.equal(source.status, "verified");
    assert.equal(source.etherscan.status, "exact-match");
    assert.equal(source.etherscan.similarMatch, null);
    assert.equal(source.sourcify.status, "match");
    assert.equal(source.sourcify.creationMatch, "match");
    assert.equal(source.sourcify.runtimeMatch, "match");
    assert.equal(source.address, captured.address);
    assert.equal(source.etherscan.url, captured.url);
    assert.equal(source.sourcify.url, captured.sourcify.url);
    assert.equal(captured.status, "exact-match");
    assert.match(source.etherscan.submissionGuid, /^[a-z0-9]+$/);
  }
});
