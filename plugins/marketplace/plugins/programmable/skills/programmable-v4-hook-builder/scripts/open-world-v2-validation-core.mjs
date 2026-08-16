import { validateOpenWorldPackageFromDisk } from "./open-world-v2-package-io.mjs";
import {
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS,
  OPEN_WORLD_V2_REVIEW_PACKAGE_IO_LIMITS,
  OPEN_WORLD_V2_SUBMISSION_FILE,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS
} from "./open-world-v2-contracts.mjs";
import { createOpenWorldV2ValidationRuntime } from "./open-world-v2-validation-runtime.mjs";
import { validateOpenWorldV2Intake } from "./open-world-v2-validation-intake.mjs";
import { validateOpenWorldV2Intent } from "./open-world-v2-validation-intent.mjs";
import { validateOpenWorldV2Graph } from "./open-world-v2-validation-graph.mjs";
import { validateOpenWorldV2Fee } from "./open-world-v2-validation-fee.mjs";
import { finalizeOpenWorldV2Validation } from "./open-world-v2-validation-report.mjs";

export function validateOpenWorldPackage({ packageRoot, fragmentLimits } = {}) {
  return validateOpenWorldPackageFromDisk({
    packageRoot,
    fragmentLimits,
    artifacts: OPEN_WORLD_V2_ARTIFACTS,
    supportingArtifacts: OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
    optionalSupportingArtifacts: OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS,
    submissionFile: OPEN_WORLD_V2_SUBMISSION_FILE,
    reviewPackageIoLimits: OPEN_WORLD_V2_REVIEW_PACKAGE_IO_LIMITS,
    validateSubmissionPackage: validateOpenWorldV2Package
  });
}

export function validateOpenWorldV2Package(options = {}) {
  const context = createOpenWorldV2ValidationRuntime(options);
  const earlyReport = validateOpenWorldV2Intake(context);
  if (earlyReport !== null) return earlyReport;
  validateOpenWorldV2Intent(context);
  validateOpenWorldV2Graph(context);
  validateOpenWorldV2Fee(context);
  return finalizeOpenWorldV2Validation(context);
}
