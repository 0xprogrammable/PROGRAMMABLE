#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createActivationImportTools } from "./programmable-v4-api-activation.mjs";
import * as cleanRoom from "./programmable-launch-v41-clean-room.mjs";
import * as binding from "./programmable-launch-v41-release-binding.mjs";
import * as activation from "../lib/custom-launch/v41-api-activation.mjs";

const tools = createActivationImportTools({
  cleanRoom, binding, activation,
  artifactPrefix: "programmable-launch-v41-clean-room",
  trustedVerifierPaths: [
    activation.CLEAN_ROOM_WORKFLOW,
    "scripts/programmable-launch-v41-clean-room.mjs",
    "scripts/lib/programmable-launch-clean-room-runner.mjs",
    "packages/launch/src/fee-review-v1.mjs",
    "packages/launch/src/fee-policy-v1.mjs",
    "packages/launch/src/funding-plan-v1.mjs",
    "packages/launch/src/initial-buy-review-v1.mjs",
    "packages/launch/src/initial-buy-quote-v1.mjs",
    "packages/launch/src/profile-v41.mjs",
  ],
});
export const { assertActivationJsonEqual, assertRunMetadata, assertProducerMetadata,
  assertVerifiedAttestation, createActivationRecord, auditActivation } = tools;
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(tools.runCli(process.argv.slice(2)))}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
