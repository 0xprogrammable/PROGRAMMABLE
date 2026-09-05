#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as releaseTools from "../../scripts/programmable-launch-v41-release-binding.mjs";
import * as originalPostdeployTools from "./robinhood-custom-launch-postdeploy-core.mjs";
import { createRobinhoodPostdeploymentCli } from "./finalize-robinhood-custom-launch-deployment.mjs";
import {
  robinhoodV41BackendPromotionTools as backendTools,
  requireRobinhoodV41BackendReleasePins,
} from "./robinhood-backend-promotion-v41.mjs";
import {
  robinhoodV41BackendStageContext,
  prepareRobinhoodV41ReleaseBinding,
  robinhoodV41ConsumerInputs,
} from "./robinhood-custom-launch-v41-release-context.mjs";

const promotionTools = originalPostdeployTools.createRobinhoodPromotionTools({
  releaseTools, backendTools,
  backendStageContext: robinhoodV41BackendStageContext,
  prepareReleaseBinding: prepareRobinhoodV41ReleaseBinding,
  consumerInputs: robinhoodV41ConsumerInputs,
});
const cli = createRobinhoodPostdeploymentCli({
  releaseTools, backendTools,
  postdeployTools: {
    ...originalPostdeployTools, ...promotionTools,
    ROBINHOOD_PROMOTION_BUNDLE_PATH: releaseTools.V4_ROBINHOOD_PROMOTION_BUNDLE_PATH,
  },
  backendStageContext: robinhoodV41BackendStageContext,
  allowedCommands: ["verify-backend-import", "authorize-backend", "promote",
    "verify-promotion", "materialize-release-assets", "apply"],
});

export async function runRobinhoodV41PostdeploymentCli(argv, dependencies = {}) {
  requireRobinhoodV41BackendReleasePins();
  return cli.runRobinhoodPostdeploymentCli(argv, dependencies);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runRobinhoodV41PostdeploymentCli(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
