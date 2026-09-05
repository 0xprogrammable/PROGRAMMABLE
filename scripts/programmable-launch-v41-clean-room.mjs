#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCleanRoomRunner } from "./lib/programmable-launch-clean-room-runner.mjs";
import * as releaseBinding from "./programmable-launch-v41-release-binding.mjs";
import { assertRobinhoodInitialBuyReviewV1 } from "../packages/launch/src/initial-buy-review-v1.mjs";
import { assertRobinhoodFeeReviewV1 } from "../packages/launch/src/fee-review-v1.mjs";
import { normalizeRobinhoodFundingPlanV1 } from "../packages/launch/src/funding-plan-v1.mjs";
import { ROBINHOOD_PROFILE_V41 } from "../packages/launch/src/profile-v41.mjs";

const runner = createCleanRoomRunner({
  CLEAN_ROOM_SCHEMA: "programmable.launch-v4-clean-room-evidence.v2",
  PREPARED_SCHEMA: "programmable.launch-v4-clean-room-prepared.v2",
  RECOVERY_SCHEMA: "programmable.launch-v4-clean-room-recovery.v2",
  PRODUCER_SCHEMA: "programmable.launch-v4-clean-room-producer.v2",
  REVIEWED_RELEASE_COORDINATE_SCHEMA: "programmable.launch-v4-clean-room-release-coordinate.v2",
  REVIEWED_RELEASE_COORDINATE_PATH: "docs/operations/releases/custom-launch-v4.1/clean-room-release-coordinate.json",
  RELEASE_TAG: "programmable-launch-v4.1.0",
  RELEASE_VERSION: "4.1.0",
  RELEASE_BINDING: releaseBinding,
  CLEAN_ROOM_WORKFLOW_PATH: ".github/workflows/programmable-launch-v41-clean-room.yml",
  EXAMPLE_PROJECT: "robinhood-v4-native20",
  TREE_DIGEST_DOMAIN: "programmable.launch-v4-clean-room-tree.v2",
  REQUIRE_NATIVE20: true,
  IDEMPOTENCY_PREFIX: "programmable-v41-clean-room-",
  ASSERT_FEE_REVIEW: assertRobinhoodFeeReviewV1,
  ASSERT_INITIAL_BUY_REVIEW: assertRobinhoodInitialBuyReviewV1,
  NORMALIZE_FUNDING_PLAN: normalizeRobinhoodFundingPlanV1,
  EXPECTED_PROFILE: ROBINHOOD_PROFILE_V41,
});

export const {
  CLEAN_ROOM_SCHEMA, PREPARED_SCHEMA, RECOVERY_SCHEMA, PRODUCER_SCHEMA,
  REVIEWED_RELEASE_COORDINATE_SCHEMA, REVIEWED_RELEASE_COORDINATE_PATH,
  RELEASE_REPOSITORY, RELEASE_MANIFEST_REPOSITORY, RELEASE_TAG, RELEASE_VERSION,
  RELEASE_SIGNER_WORKFLOW, PRODUCTION_REF, CHAIN_ID, CAIP2,
  canonicalJsonBytes, sha256, validateReleaseFiles, validateReviewedReleaseCoordinate,
  requireReviewedReleaseCoordinateReady, assertReleaseMatchesReviewedCoordinate,
  validateCleanRoomImage, prepareCleanRoom, validateProducerProvenance,
  buildCleanRoomRecoveryReceipt, validateCleanRoomRecoveryReceipt, buildCleanRoomEvidence,
  validateCleanRoomEvidence, runCleanRoom, verifyEvidenceFile, verifyRecoveryFile,
} = runner;

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runner.main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof runner.CleanRoomError ? error.code : "CLEAN_ROOM_INTERNAL_ERROR"}\n`);
    process.exitCode = 1;
  });
}
