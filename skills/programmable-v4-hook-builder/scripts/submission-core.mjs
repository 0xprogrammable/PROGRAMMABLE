import crypto from "node:crypto";
import path from "node:path";
import { analyzeSubmissionAssetsAndLaunch } from "./submission-assets-launch-analysis.mjs";
import { analyzeSubmissionAssurance } from "./submission-assurance-analysis.mjs";
import { analyzeSubmissionCapabilities } from "./submission-capabilities-analysis.mjs";
import { analyzeSubmissionSpecializedCapabilities } from "./submission-capability-specialized-analysis.mjs";
import { analyzeSubmissionCrossChainIdentity } from "./submission-cross-chain-identity-analysis.mjs";
import { analyzeSubmissionCrossChainState } from "./submission-cross-chain-state-analysis.mjs";
import { analyzeSubmissionDataAndHandoff } from "./submission-data-handoff-analysis.mjs";
import { analyzeSubmissionHookAccounting } from "./submission-hook-accounting-analysis.mjs";
import { analyzeSubmissionHook } from "./submission-hook-analysis.mjs";
import { analyzeSubmissionIntegrationClient } from "./submission-integration-client-analysis.mjs";
import { analyzeSubmissionModelAndMetadata } from "./submission-model-metadata-analysis.mjs";
import { analyzeSubmissionOperationsAndDependencies } from "./submission-operations-dependencies-analysis.mjs";
import { analyzeSubmissionProgrammableFee } from "./submission-programmable-fee-analysis.mjs";
import { analyzeSubmissionRoutingPolicy } from "./submission-routing-policy-analysis.mjs";
import {
  inspectBuilderTemplateCatalogProvenance,
  normalizeBuilderTemplate
} from "./builder-template-contract.mjs";
import {
  inspectPublicMetadataText,
  PROTECTED_PROVIDER_KEYS,
  publicIdentityKey,
  publicResourceUriKind
} from "./metadata-core.mjs";
import {
  isOfficialUniswapSdkPackage,
  OFFICIAL_UNISWAP_SDK_REPOSITORY
} from "./package-dependency-contract.mjs";
import { declaredSoliditySourceAndTestPaths } from "./review-target-contract.mjs";
import {
  collectOperationNames,
  hasResolvedPolicyValue,
  inspectProviderEvidence,
  isSafeRepositoryPath,
  isSortedUniqueUtf8,
  objectAt,
  resolvedText,
  sameStringList
} from "./submission-analysis-helpers.mjs";
import {
  PERMISSION_BITS,
  PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP,
  PROGRAMMABLE_FEE_MAX_SELECTED_HUNDREDTHS_OF_BIP,
  PROGRAMMABLE_FEE_OWNER,
  PROGRAMMABLE_FEE_POLICY_ID,
  PROGRAMMABLE_FEE_POLICY_VERSION,
  STANDARD_VERSION,
  UINT128_MAX
} from "./submission-constants-core.mjs";
import { findUnsupportedPublicClaims } from "./public-claims-core.mjs";
import { validateNoCustomHookRoute } from "./no-custom-hook-route-core.mjs";
import { analyzeProjectSurfaces, requiredProjectProfiles } from "./project-surfaces-core.mjs";
import {
  schemaFindingStopsSemanticReview,
  validateAgainstSchema
} from "./restricted-json-schema-core.mjs";
import { canonicalJson, isObject, sameValue } from "./submission-value-core.mjs";
import {
  analyzeRisk,
  buildReport,
  deriveFeatureTriggers
} from "./submission-report-core.mjs";
import {
  requireCapabilityMatch,
  requireDetailedText,
  requireNonEmptyArray,
  requirePresent,
  requireResolvedText,
  usesReviewedFullConsumptionZeroAmm,
  validateDeltaComponentPolicy,
  validateSettlementActions
} from "./settlement-policy-core.mjs";
import { validateTokenBehaviorExtensions } from "./token-behavior-validation-core.mjs";
import { hasConfiguredValue } from "./token-mechanics-policy-core.mjs";
import {
  resolveTokenMechanicsProfile,
  validateTokenMechanicsProfile
} from "./token-mechanics-resolution-core.mjs";
import { validateSubmissionTarget } from "./submission-target-validation-core.mjs";

export { validateAgainstSchema } from "./restricted-json-schema-core.mjs";
export { canonicalJson } from "./submission-value-core.mjs";
export { normativePolicyInventory } from "./normative-policy-core.mjs";
export {
  KNOWN_EVM_NETWORKS,
  PERMISSION_BITS,
  PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP,
  PROGRAMMABLE_FEE_MAX_SELECTED_HUNDREDTHS_OF_BIP,
  PROGRAMMABLE_FEE_OWNER,
  PROGRAMMABLE_FEE_POLICY_ID,
  PROGRAMMABLE_FEE_POLICY_VERSION,
  PROGRAMMABLE_LAUNCH_CHAIN_ID,
  REPORT_VERSION,
  RISK_DIMENSION_MAX,
  STANDARD_VERSION,
  UINT128_MAX
} from "./submission-constants-core.mjs";
export {
  isSafeGitReference,
  isSupportedGitHubRepositoryUrl,
  parseCanonicalProvenanceScalar
} from "./submission-provenance-core.mjs";
export { validateSettlementActions } from "./settlement-policy-core.mjs";

const soliditySourceExtension = /\.sol$/i;
const javascriptSourceExtension = /\.(?:[cm]?[jt]sx?)$/i;
const declarativeReviewExtension = /\.(?:json|md|txt|toml|ya?ml)$/i;
const declarativeReviewBasenames = new Set([".gas-snapshot", "foundry.lock"]);
const knownModelCategories = new Set([
  "permissionless-token",
  "permissioned-asset",
  "market-structure",
  "liquidity-management",
  "distribution",
  "oracle-linked",
  "privacy"
]);
const transferTaxCapabilityIds = new Set([
  "fee-on-transfer-token",
  "tax-financed-auto-liquidity",
  "token-tax-accumulator",
  "token-transfer-tax"
]);
const autoLiquidityCapabilityIds = new Set([
  "tax-financed-auto-liquidity",
  "token-managed-automatic-liquidity",
  "token-owned-liquidity-inventory"
]);
const includedSwapClientRoutingModes = new Set(["programmable-app", "custom-reviewed"]);
const noIncludedSwapClientRoutingModes = new Set(["uniswap-interface-api", "uniswapx-filler", "not-planned"]);
export function hasIncludedSwapClient(submission) {
  return includedSwapClientRoutingModes.has(
    submission?.integration?.routingAndDiscoverability?.routingMode
  );
}


export function submissionHash(submission) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(submission)).digest("hex")}`;
}

export function permissionMask(permissions) {
  if (!isObject(permissions)) return null;

  let mask = 0;
  for (const [name, bit] of Object.entries(PERMISSION_BITS)) {
    if (typeof permissions[name] !== "boolean") return null;
    if (permissions[name]) mask |= bit;
  }
  return `0x${mask.toString(16).padStart(4, "0")}`;
}

export function analyzeSubmission(submission, { schema } = {}) {
  const findings = schema ? validateAgainstSchema(submission, schema) : [];
  const gates = new Map();
  const packagesMissingSourceProvenance = [];

  function add(severity, code, path, message, remediation) {
    findings.push({ severity, code, path, message, remediation });
  }

  function gate(id, stage, reason) {
    if (!gates.has(id)) gates.set(id, { id, stage, reason });
  }

  if (findings.some((finding) => schemaFindingStopsSemanticReview(finding))) {
    return buildReport(submission, findings, gates, null, [], null, null, schema);
  }

  if (!isObject(submission)) {
    add("hard", "SUBMISSION_NOT_OBJECT", "$", "The submission root must be an object.", "Start from the supplied submission template.");
    return buildReport(submission, findings, gates, null, [], null, null, schema);
  }

  if (submission.standardVersion !== STANDARD_VERSION) {
    add("blocker", "STANDARD_VERSION_MISMATCH", "$.standardVersion", `Expected standard version ${STANDARD_VERSION}.`, "Regenerate from the current template and review every changed field.");
  }

  const stage = submission.stage;
  const tokenMechanicsResolution = resolveTokenMechanicsProfile(submission, add);
  const declaredImplementationSourcePaths = Array.isArray(submission.implementation?.sourcePaths)
    ? submission.implementation.sourcePaths
    : [];
  const declaredImplementationSoliditySourcePaths = declaredImplementationSourcePaths.filter((entry) => (
    typeof entry === "string" && soliditySourceExtension.test(entry)
  ));
  const declaredSoliditySourcePaths = declaredSoliditySourceAndTestPaths(submission);
  const customHookDeclared = submission.hook?.used === true;
  const solidityBuildRequired = customHookDeclared || declaredSoliditySourcePaths.length > 0;
  const toolingReviewPaths = new Set();

  function validateDeclaredPath(entry, findingPath, role) {
    if (!isSafeRepositoryPath(entry)) {
      add(
        "blocker",
        "DECLARED_REPOSITORY_PATH_UNSAFE",
        findingPath,
        `The declared ${role} path is not a normalized repository-relative path.`,
        "Use a bounded repository-relative path without parent traversal, absolute roots, backslashes or control characters."
      );
      return;
    }
    if (
      !soliditySourceExtension.test(entry)
      && !javascriptSourceExtension.test(entry)
      && !declarativeReviewExtension.test(entry)
      && !declarativeReviewBasenames.has(path.posix.basename(entry))
    ) {
      const key = `${role}\0${entry}`;
      if (!toolingReviewPaths.has(key)) {
        toolingReviewPaths.add(key);
        add(
          "warning",
          "DECLARED_FILE_TOOLING_REVIEW_REQUIRED",
          findingPath,
          `${entry} is bound as exact bytes, but the current deterministic validator has no semantic dependency-closure scanner for this ${role} file type.`,
          "Keep the file in the exact review target and add a language-specific scanner or an attributable manual review before candidate approval."
        );
      }
      gate(
        "declared-file-tooling-or-manual-review",
        "candidate",
        "At least one declared project file is byte-bound but needs a language-specific scanner or attributable manual review."
      );
    }
  }

  const context = {
    submission,
    add,
    gate,
    stage,
    tokenMechanicsResolution,
    declaredImplementationSourcePaths,
    declaredImplementationSoliditySourcePaths,
    declaredSoliditySourcePaths,
    customHookDeclared,
    solidityBuildRequired,
    packagesMissingSourceProvenance,
    permissionMask,
    hasIncludedSwapClient,
    validateDeclaredPath
  };

  analyzeSubmissionModelAndMetadata(context);
  analyzeSubmissionAssetsAndLaunch(context);
  analyzeSubmissionHook(context);
  analyzeSubmissionProgrammableFee(context);
  analyzeSubmissionHookAccounting(context);
  analyzeSubmissionOperationsAndDependencies(context);
  analyzeSubmissionIntegrationClient(context);
  analyzeSubmissionRoutingPolicy(context);
  analyzeSubmissionDataAndHandoff(context);
  analyzeSubmissionCapabilities(context);
  analyzeSubmissionCrossChainIdentity(context);
  analyzeSubmissionCrossChainState(context);
  analyzeSubmissionSpecializedCapabilities(context);
  analyzeSubmissionAssurance(context);

  const { mask, derivedTriggers, risk } = context;

  return buildReport(submission, findings, gates, mask, derivedTriggers, risk.score, risk, schema);
}
