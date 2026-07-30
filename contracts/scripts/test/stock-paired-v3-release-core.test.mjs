import assert from "node:assert/strict";
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
