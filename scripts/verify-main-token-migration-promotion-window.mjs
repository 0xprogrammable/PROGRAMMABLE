#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { verifyMainTokenMigrationPromotionWindow } from
  "./main-token-migration-activation-core.mjs";

const MANIFEST_URL = new URL(
  "../config/main-token-migration-activation.v2.json",
  import.meta.url,
);

async function main() {
  const payload = JSON.parse(await readFile(MANIFEST_URL, "utf8"));
  const nowTimestamp = BigInt(Math.floor(Date.now() / 1_000));
  const activation = verifyMainTokenMigrationPromotionWindow(
    payload,
    nowTimestamp,
  );
  process.stdout.write(`${JSON.stringify({
    deadlineTimestampExclusive:
      activation.deadlineTimestampExclusive.toString(),
    minimumPublicLeadSeconds:
      activation.minimumPublicLeadSeconds.toString(),
    releaseId: activation.releaseId,
    schema: "programmable-main-token-migration-promotion-check/v1",
    snapshotBoundaryRule: activation.snapshotBoundaryRule,
    status: "ready",
    targetChainId: activation.targetChainId.toString(),
    targetTokenAddress: activation.targetTokenAddress,
    targetTokenRuntimeCodeKeccak256:
      activation.targetTokenRuntimeCodeKeccak256,
    migrationDistributorAddress: activation.migrationDistributorAddress,
    migrationDistributorRuntimeCodeKeccak256:
      activation.migrationDistributorRuntimeCodeKeccak256,
    targetDesignSha256: activation.targetDesignSha256,
    windowStartTimestamp: activation.windowStartTimestamp.toString(),
  })}\n`);
}

main().catch((error) => {
  const message = error instanceof Error
    ? error.message
    : "Migration promotion window check failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
