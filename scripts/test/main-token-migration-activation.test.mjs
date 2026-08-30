import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseMainTokenMigrationActivationManifest,
  verifyMainTokenMigrationPromotionWindow,
} from "../main-token-migration-activation-core.mjs";
import { MAIN_TOKEN_MIGRATION_POLICY } from
  "../main-token-migration-snapshot-core.mjs";

const DISABLED_MANIFEST_URL = new URL(
  "../../config/main-token-migration-activation.v2.json",
  import.meta.url,
);
const START = 1_900_000_000n;
const ELIGIBILITY_HASH = `0x${"12".repeat(32)}`;
const TARGET_TOKEN = "0x5555555555555555555555555555555555555555";
const DISTRIBUTOR = "0x6666666666666666666666666666666666666666";
const TARGET_DESIGN_SHA256 = `sha256:${"56".repeat(32)}`;

function activeManifest(overrides = {}) {
  return {
    schema: MAIN_TOKEN_MIGRATION_POLICY.activationSchema,
    releaseId: MAIN_TOKEN_MIGRATION_POLICY.releaseId,
    enabled: true,
    sourceChainId: MAIN_TOKEN_MIGRATION_POLICY.chainId.toString(),
    sourceTokenAddress: MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
    sourceTokenRuntimeCodeKeccak256:
      MAIN_TOKEN_MIGRATION_POLICY.tokenRuntimeCodeKeccak256,
    sourceTokenDecimals: MAIN_TOKEN_MIGRATION_POLICY.tokenDecimals.toString(),
    sourceTokenTotalSupplyRaw:
      MAIN_TOKEN_MIGRATION_POLICY.tokenTotalSupplyRaw.toString(),
    targetChainId: MAIN_TOKEN_MIGRATION_POLICY.targetChainId.toString(),
    targetTokenTotalSupplyRaw:
      MAIN_TOKEN_MIGRATION_POLICY.targetTokenTotalSupplyRaw.toString(),
    targetTokenAddress: TARGET_TOKEN,
    targetTokenRuntimeCodeKeccak256: `0x${"34".repeat(32)}`,
    migrationDistributorAddress: DISTRIBUTOR,
    migrationDistributorRuntimeCodeKeccak256: `0x${"78".repeat(32)}`,
    targetDesignSha256: TARGET_DESIGN_SHA256,
    migrationWallet: MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
    windowDurationSeconds:
      MAIN_TOKEN_MIGRATION_POLICY.windowSeconds.toString(),
    windowStartTimestamp: START.toString(),
    deadlineTimestampExclusive:
      (START + MAIN_TOKEN_MIGRATION_POLICY.windowSeconds).toString(),
    snapshotBoundaryRule: MAIN_TOKEN_MIGRATION_POLICY.snapshotBoundaryRule,
    minimumPublicLeadSeconds:
      MAIN_TOKEN_MIGRATION_POLICY.minimumPublicLeadSeconds.toString(),
    sponsorEligibilityBlockNumber: "100",
    sponsorEligibilityBlockHash: ELIGIBILITY_HASH,
    ...overrides,
  };
}

test("keeps the checked-in V2 activation completely disabled", async () => {
  const manifest = JSON.parse(await readFile(DISABLED_MANIFEST_URL, "utf8"));
  assert.deepEqual(parseMainTokenMigrationActivationManifest(manifest), {
    enabled: false,
    releaseId: MAIN_TOKEN_MIGRATION_POLICY.releaseId,
    schema: MAIN_TOKEN_MIGRATION_POLICY.activationSchema,
    snapshotBoundaryRule: MAIN_TOKEN_MIGRATION_POLICY.snapshotBoundaryRule,
  });
  assert.throws(
    () => parseMainTokenMigrationActivationManifest(manifest, {
      requireEnabled: true,
    }),
    /manifest is not enabled/u,
  );
});

test("accepts only the exact planned 96-hour activation and sponsor anchor", () => {
  const activation = parseMainTokenMigrationActivationManifest(
    activeManifest(),
    { requireEnabled: true },
  );
  assert.equal(activation.windowStartTimestamp, START);
  assert.equal(
    activation.deadlineTimestampExclusive,
    START + MAIN_TOKEN_MIGRATION_POLICY.windowSeconds,
  );
  assert.equal(activation.sponsorEligibilityBlockNumber, 100n);
  assert.equal(activation.sponsorEligibilityBlockHash, ELIGIBILITY_HASH);
  assert.equal(activation.targetChainId, 4_663n);
  assert.equal(activation.targetTokenAddress, TARGET_TOKEN);
  assert.equal(activation.migrationDistributorAddress, DISTRIBUTOR);
  assert.equal(
    activation.targetDesignSha256,
    TARGET_DESIGN_SHA256,
  );

  assert.throws(
    () => parseMainTokenMigrationActivationManifest(activeManifest({
      deadlineTimestampExclusive:
        (START + MAIN_TOKEN_MIGRATION_POLICY.windowSeconds - 1n).toString(),
    })),
    /deadline is not exactly 96 hours/u,
  );
  assert.throws(
    () => parseMainTokenMigrationActivationManifest(activeManifest({
      snapshotBoundaryRule: "operator-selected-block",
    })),
    /snapshot boundary rule is not frozen/u,
  );
  assert.throws(
    () => parseMainTokenMigrationActivationManifest(activeManifest({
      sponsorEligibilityBlockHash: null,
    })),
    /sponsor eligibility block hash is malformed/u,
  );
  assert.throws(
    () => parseMainTokenMigrationActivationManifest(activeManifest({
      targetTokenAddress: null,
    })),
    /targetTokenAddress is not a deployed contract address/u,
  );
  assert.throws(
    () => parseMainTokenMigrationActivationManifest(activeManifest({
      migrationDistributorAddress: TARGET_TOKEN,
    })),
    /target contracts are not distinct/u,
  );
  assert.throws(
    () => parseMainTokenMigrationActivationManifest(activeManifest({
      targetDesignSha256: `sha256:${"0".repeat(63)}`,
    })),
    /target design SHA-256 is malformed/u,
  );
  assert.throws(
    () => parseMainTokenMigrationActivationManifest({
      ...activeManifest(),
      unexpected: true,
    }),
    /manifest fields are not exact/u,
  );
});

test("fails promotion closed once the 900-second public lead is missed", () => {
  const manifest = activeManifest();
  assert.doesNotThrow(() => verifyMainTokenMigrationPromotionWindow(
    manifest,
    START - MAIN_TOKEN_MIGRATION_POLICY.minimumPublicLeadSeconds,
  ));
  assert.throws(
    () => verifyMainTokenMigrationPromotionWindow(
      manifest,
      START - MAIN_TOKEN_MIGRATION_POLICY.minimumPublicLeadSeconds + 1n,
    ),
    /minimum public lead time has been missed/u,
  );
});
