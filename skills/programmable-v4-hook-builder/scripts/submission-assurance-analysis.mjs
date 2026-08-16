import {
  isSafeRepositoryPath,
  objectAt,
  resolvedText
} from "./submission-analysis-helpers.mjs";
import { analyzeRisk, deriveFeatureTriggers } from "./submission-report-core.mjs";
import { requireResolvedText } from "./settlement-policy-core.mjs";

export function analyzeSubmissionAssurance(context) {
  const {
    submission,
    add,
    gate,
    stage,
    customHookDeclared,
    declaredImplementationSoliditySourcePaths,
    solidityBuildRequired,
    validateDeclaredPath,
    programmableCollection,
    routing,
    dataReconstruction,
    capabilityExtensions,
    packagesMissingSourceProvenance,
    hookUsed,
    permissions
  } = context;
  const security = objectAt(submission, "security");
  const hardSecurity = {
    usesTxOrigin: ["TX_ORIGIN_AUTHORIZATION", "tx.origin authorization is forbidden."],
    userControlledDelegatecall: ["USER_CONTROLLED_DELEGATECALL", "User-controlled delegatecall is forbidden."],
    arbitraryExecution: ["ARBITRARY_PROTOCOL_EXECUTION", "Arbitrary target and calldata execution with protocol authority is forbidden."],
    hiddenControls: ["HIDDEN_CONTROLS", "Undisclosed control or payout behavior is forbidden."],
    bypassesHookAddressValidation: ["HOOK_ADDRESS_VALIDATION_BYPASS", "Production hooks may not bypass BaseHook address and permission validation."]
  };
  for (const [field, [code, message]] of Object.entries(hardSecurity)) {
    if (security[field] === true) add("hard", code, `$.security.${field}`, message, "Remove the behavior or redesign the model with an explicit, reviewable mechanism.");
    else if (security[field] !== false) add("blocker", "SECURITY_ASSERTION_UNRESOLVED", `$.security.${field}`, "This security assertion must be explicitly true or false.", "Inspect the design and source before answering.");
  }
  const repairableSecurity = {
    unboundedCriticalLoop: ["UNBOUNDED_CRITICAL_LOOP", "The current revision has unbounded storage-dependent work on a callback or exit path."],
    ignoredCallResults: ["IGNORED_CALL_RESULT", "The current revision ignores a low-level or token-transfer result."],
    assumesOnchainSecrecy: ["ONCHAIN_SECRECY_ASSUMPTION", "The current revision treats public onchain data as secret."]
  };
  for (const [field, [code, message]] of Object.entries(repairableSecurity)) {
    if (security[field] === true) {
      add(
        "blocker",
        code,
        `$.security.${field}`,
        message,
        "Repair this revision with bounded work, checked results, or an explicit public-data design, then rerun the affected checks."
      );
    } else if (security[field] !== false) {
      add("blocker", "SECURITY_ASSERTION_UNRESOLVED", `$.security.${field}`, "This security assertion must be explicitly true or false.", "Inspect the design and source before answering.");
    }
  }
  const signature = objectAt(security, "signatureScheme");
  if (typeof signature.used !== "boolean") add("blocker", "SIGNATURE_USAGE_UNRESOLVED", "$.security.signatureScheme.used", "Signature usage is unresolved.", "State whether offchain signatures authorize any action.");
  if (signature.used === true) {
    if (!signature.standard) add("blocker", "SIGNATURE_STANDARD_UNRESOLVED", "$.security.signatureScheme.standard", "The signature standard is unresolved.", "Use a reviewed EIP-712 domain or document an equivalent reviewed scheme.");
    for (const field of ["nonce", "deadline", "chain", "verifyingContract", "action", "parameters"]) {
      if (signature[field] !== true) add("blocker", "SIGNATURE_BINDING_INCOMPLETE", `$.security.signatureScheme.${field}`, "The signature does not explicitly bind this security property.", "Bind nonce, deadline, chain, verifying contract, action and parameters.");
    }
    if (signature.erc1271 === false) {
      add(
        "warning",
        "EOA_SIGNER_KEY_OPERATIONS_REVIEW_REQUIRED",
        "$.security.signatureScheme.erc1271",
        "The declared signature model intentionally accepts only a fixed EOA signer and does not support ERC-1271 contract-wallet validation.",
        "Review signer provenance, custody, environment isolation, rotation and revocation, key-loss recovery, low-s enforcement and incident response before candidate approval."
      );
      gate(
        "eoa-signer-key-operations-review",
        "candidate",
        "The declared signature model uses a fixed EOA signer, so key provenance, custody, rotation, revocation, recovery and incident response require review."
      );
    } else if (signature.erc1271 !== true) {
      add(
        "blocker",
        "SIGNATURE_BINDING_INCOMPLETE",
        "$.security.signatureScheme.erc1271",
        "The signature model does not explicitly choose fixed-EOA or ERC-1271 contract-wallet behavior.",
        "Set erc1271 to false only for an intentionally fixed EOA signer, or true when ERC-1271 contract-wallet validation is supported."
      );
    }
    gate("signature-replay-and-wallet-tests", "prototype", "The model uses signatures.");
  }

  const implementation = objectAt(submission, "implementation");
  for (const [field, entries] of Object.entries({
    sourcePaths: implementation.sourcePaths ?? [],
    testPaths: implementation.testPaths ?? [],
    compilerBuildInfoPaths: implementation.compilerBuildInfoPaths ?? [],
    specificationPath: implementation.specificationPath ? [implementation.specificationPath] : [],
    testEvidencePath: implementation.testEvidencePath ? [implementation.testEvidencePath] : [],
    dependencyLockPath: implementation.dependencyLockPath ? [implementation.dependencyLockPath] : [],
    feeConformanceManifestPath: implementation.feeConformanceManifestPath ? [implementation.feeConformanceManifestPath] : [],
    gateStatusPath: implementation.gateStatusPath ? [implementation.gateStatusPath] : [],
    reviewTargetPath: implementation.reviewTargetPath ? [implementation.reviewTargetPath] : []
  })) {
    for (const [index, entry] of entries.entries()) {
      if (!isSafeRepositoryPath(entry)) {
        add("blocker", "IMPLEMENTATION_PATH_UNSAFE", `$.implementation.${field}${field.endsWith("Paths") ? `[${index}]` : ""}`, "Implementation paths must be repository-relative and cannot traverse parent directories.", "Use a normalized path inside the repository.");
      }
    }
  }
  if (stage === "prototype") {
    if (!Array.isArray(implementation.sourcePaths) || implementation.sourcePaths.length === 0) add("blocker", "SOURCE_PATHS_MISSING", "$.implementation.sourcePaths", "A prototype must identify its source files.", "List repository-relative contract and integration source paths.");
    if (!Array.isArray(implementation.testPaths) || implementation.testPaths.length === 0) add("blocker", "TEST_PATHS_MISSING", "$.implementation.testPaths", "A prototype must identify its tests.", "List repository-relative unit, fuzz, invariant and integration tests.");
    if (solidityBuildRequired && (!Array.isArray(implementation.compilerBuildInfoPaths) || implementation.compilerBuildInfoPaths.length !== 1)) add("blocker", "COMPILER_BUILD_INFO_PATHS_MISSING", "$.implementation.compilerBuildInfoPaths", "A prototype with declared Solidity source must bind exactly one compiler build-info artifact.", "List the one repository-relative Foundry build-info JSON file whose compiler input and settings produced the reviewed bytecode.");
    if (!solidityBuildRequired && (implementation.compilerBuildInfoPaths?.length ?? 0) !== 0) add("blocker", "COMPILER_BUILD_INFO_WITHOUT_SOLIDITY", "$.implementation.compilerBuildInfoPaths", "Compiler build-info is declared even though the project declares no Solidity source.", "Use an empty compilerBuildInfoPaths array for a no-Solidity project, or declare and bind the actual Solidity source.");
    if (customHookDeclared && declaredImplementationSoliditySourcePaths.length === 0) add("blocker", "SOLIDITY_SOURCE_MISSING", "$.implementation.sourcePaths", "A custom-hook prototype has no declared Solidity implementation source.", "List every .sol hook implementation file so the package verifier can bind and scan the complete import closure.");
    for (const [index, entry] of (implementation.sourcePaths ?? []).entries()) validateDeclaredPath(entry, `$.implementation.sourcePaths[${index}]`, "implementation source");
    for (const [index, entry] of (implementation.testPaths ?? []).entries()) validateDeclaredPath(entry, `$.implementation.testPaths[${index}]`, "implementation test");
    for (const [index, entry] of (implementation.compilerBuildInfoPaths ?? []).entries()) {
      validateDeclaredPath(entry, `$.implementation.compilerBuildInfoPaths[${index}]`, "compiler build-info");
      if (!/\.json$/i.test(entry)) add("blocker", "COMPILER_BUILD_INFO_PATH_TYPE_INVALID", `$.implementation.compilerBuildInfoPaths[${index}]`, "A declared Solidity compiler build-info artifact must be JSON.", "Use the exact repository-relative Foundry build-info JSON path.");
    }
    requireResolvedText(implementation.specificationPath, "$.implementation.specificationPath", "SPECIFICATION_PATH_MISSING", add);
    requireResolvedText(implementation.testEvidencePath, "$.implementation.testEvidencePath", "TEST_EVIDENCE_PATH_MISSING", add);
    if (solidityBuildRequired) requireResolvedText(implementation.dependencyLockPath, "$.implementation.dependencyLockPath", "DEPENDENCY_LOCK_PATH_MISSING", add);
    if (!Array.isArray(implementation.githubActionsRunIds) || implementation.githubActionsRunIds.length === 0) {
      add(
        "warning",
        "SOURCE_WORKFLOW_EVIDENCE_MISSING",
        "$.implementation.githubActionsRunIds",
        "The prototype has no exact successful source-repository workflow run bound to its reviewed commit.",
        "Run a credential-free build and test workflow at the exact public commit, then record its GitHub Actions run id. Registry intake checks validate the package only and are not project code tests."
      );
      gate(
        "source-workflow-evidence",
        "prototype",
        "A prototype needs exact builder-owned build and test workflow evidence; the central Registry never executes untrusted project code."
      );
    }
    if (
      programmableCollection.status === "implemented"
      && !resolvedText(implementation.feeConformanceManifestPath)
    ) {
      add(
        "warning",
        "PROGRAMMABLE_FEE_CONFORMANCE_EVIDENCE_MISSING",
        "$.implementation.feeConformanceManifestPath",
        "The prototype declares the mandatory Programmable fee implemented but does not bind a structural fee-conformance manifest.",
        "Generate the fee-conformance manifest from the exact source, factory, artifact, build info and named test evidence, then bind its repository path. This remains builder-supplied evidence until maintainers rebuild it independently."
      );
      gate(
        "custom-programmable-fee-review",
        "candidate",
        "An implemented platform fee without the standard structural receipt needs exact maintainer review; a custom implementation stays eligible and is not labeled unsafe."
      );
    }
    requireResolvedText(implementation.gateStatusPath, "$.implementation.gateStatusPath", "GATE_STATUS_PATH_MISSING", add);
    requireResolvedText(implementation.reviewTargetPath, "$.implementation.reviewTargetPath", "REVIEW_TARGET_PATH_MISSING", add);
    if ((submission.dependencies?.onchain?.length ?? 0) === 0) add("blocker", "PROTOCOL_DEPENDENCIES_MISSING", "$.dependencies.onchain", "A prototype must record its exact Uniswap and contract-library dependency closure.", "List the exact source and deployed dependencies and bind them through the dependency lock.");

    const boundSourcePaths = new Set(implementation.sourcePaths ?? []);
    const boundTestPaths = new Set(implementation.testPaths ?? []);
    for (const [field, entries, boundPaths, code, label] of [
      ["routingAndDiscoverability.sourcePaths", routing.sourcePaths ?? [], boundSourcePaths, "ROUTING_SOURCE_NOT_BOUND", "routing source"],
      ["routingAndDiscoverability.testPaths", routing.testPaths ?? [], boundTestPaths, "ROUTING_TEST_NOT_BOUND", "routing test"],
      ["dataReconstruction.sourcePaths", dataReconstruction.sourcePaths ?? [], boundSourcePaths, "DATA_SOURCE_NOT_BOUND", "indexer source"],
      ["dataReconstruction.testPaths", dataReconstruction.testPaths ?? [], boundTestPaths, "DATA_TEST_NOT_BOUND", "indexer recovery test"]
    ]) {
      for (const [index, entry] of entries.entries()) {
        if (!boundPaths.has(entry)) add("blocker", code, `$.integration.${field}[${index}]`, `The ${label} path is not part of the prototype implementation manifest.`, `Add ${entry} to the matching implementation source or test paths so package verification binds the exact file.`);
      }
    }
    for (const [index, extension] of capabilityExtensions.entries()) {
      for (const [field, boundPaths, code, label] of [
        ["sourcePaths", boundSourcePaths, "CAPABILITY_EXTENSION_SOURCE_NOT_BOUND", "capability extension source"],
        ["testPaths", boundTestPaths, "CAPABILITY_EXTENSION_TEST_NOT_BOUND", "capability extension test"]
      ]) {
        for (const [pathIndex, entry] of (extension?.[field] ?? []).entries()) {
          if (!boundPaths.has(entry)) add("blocker", code, `$.capabilityExtensions[${index}].${field}[${pathIndex}]`, `The ${label} path is not part of the implementation manifest.`, `Add ${entry} to implementation.${field} so the exact bytes enter the review target.`);
        }
      }
    }
  }

  if (
    stage === "proposal"
    && (
      (implementation.sourcePaths?.length ?? 0) > 0
      || (implementation.testPaths?.length ?? 0) > 0
      || resolvedText(implementation.testEvidencePath)
    )
  ) {
    add(
      "warning",
      "PROPOSAL_CONTAINS_UNVERIFIED_IMPLEMENTATION",
      "$.stage",
      "This proposal contains implementation or test material, but proposal status does not make those bytes a verified prototype.",
      "Keep proposal stage while the implementation is exploratory, or explicitly advance to prototype only after source closure, build information, exact workflow evidence and required gates are complete."
    );
  }

  const builder = objectAt(submission, "builder");
  if (stage === "prototype") {
    for (const field of ["github", "contact", "licenseDeclaration"]) requireResolvedText(builder[field], `$.builder.${field}`, "PROTOTYPE_IDENTITY_INCOMPLETE", add);
  } else {
    for (const field of ["github", "contact", "licenseDeclaration"]) {
      if (!resolvedText(builder[field])) add("warning", "BUILDER_FIELD_PENDING", `$.builder.${field}`, "This builder field may remain open during proposal work but is required before maintainer selection.", "Complete it in a prototype before requesting maintainer review.");
    }
  }

  const unresolved = Array.isArray(submission.unresolved) ? submission.unresolved : [];
  for (const [index, item] of unresolved.entries()) {
    add("blocker", "UNRESOLVED_DECISION", `$.unresolved[${index}]`, item, "Resolve the decision, update the locked design and rerun preflight.");
  }

  const derivedTriggers = deriveFeatureTriggers(submission);
  const risk = analyzeRisk(submission.risk, derivedTriggers, add);
  if (packagesMissingSourceProvenance.length > 0) {
    gate(
      "package-source-provenance-review",
      "candidate",
      `Exact registry artifacts without declared source provenance require attributable dependency review: ${packagesMissingSourceProvenance.join(", ")}.`
    );
    if (risk.effectiveTier === "high") {
      gate(
        "package-source-provenance-architecture-review",
        "candidate",
        "High-risk projects must resolve the trust boundary and review method for package dependencies whose source provenance is unavailable."
      );
    }
  }
  if (risk.effectiveTier) gate("independent-security-review-one", "candidate", "Every model needs an independent review scaled to its capability and value risk before selection.");
  if (risk.effectiveTier === "high") {
    gate("independent-security-review-two", "release", "High-risk models need a second independent review before a production release decision.");
    gate("public-bug-bounty", "release", "High-risk models need a funded public vulnerability disclosure path before availability.");
    gate("production-anomaly-monitoring", "release", "High-risk models need live accounting, callback and authority anomaly monitoring.");
  }
  if (submission.risk?.dimensions?.valueAtRisk === 5) gate("tvl5-economic-and-solvency-review", "candidate", "The maximum value-at-risk score needs a dedicated economic and solvency review regardless of aggregate tier.");

  for (const trigger of derivedTriggers) {
    if (trigger === "permissioned-asset") {
      gate("permissioned-asset-trust-and-legal-profile", "candidate", "The model uses permissioned assets or issuer controls.");
    }
    if (["custom-math", "custom-accounting", "return-delta", "hook-held-liquidity", "price-impact", "transfer-tax", "auto-liquidity"].includes(trigger)) {
      gate("independent-specialist-review", "candidate", `Feature trigger: ${trigger}.`);
    }
    if (trigger === "upgradeable") gate("upgrade-storage-and-authority-review", "candidate", "The model is upgradeable.");
    if (trigger === "autonomous") gate("autonomous-state-transition-invariants", "prototype", "The model changes behavior autonomously.");
  }

  gate("format-build-size-warnings", "prototype", "Every prototype must pass its declared language build and size checks without unexplained warnings.");
  if (solidityBuildRequired) gate("unit-integration-fuzz-invariant-tests", "prototype", "Declared Solidity behavior needs lifecycle and property evidence.");
  if (hookUsed === true) {
    gate("callback-authentication-and-permission-mask", "prototype", "Every hook must authenticate PoolManager and match its mined address permissions.");
    gate("callback-selector-return-length-and-self-call-tests", "prototype", "Every enabled callback must return the exact selector and ABI length and account for noSelfCall suppression.");
  }
  if (permissions.afterAddLiquidity === true || permissions.afterRemoveLiquidity === true) gate("fees-accrued-jit-liquidity-manipulation-tests", "prototype", "Liquidity callbacks expose feesAccrued and may be sensitive to just-in-time liquidity ordering.");
  if (permissions.beforeRemoveLiquidity === true || permissions.afterRemoveLiquidity === true) gate("liquidity-exit-liveness-invariants", "prototype", "Remove-liquidity callbacks can block LP exits and need failure, malformed-data, depleted-custody and gas-bound liveness tests.");
  if (solidityBuildRequired) gate("static-analysis", "prototype", "Declared Solidity source needs static findings with dispositions.");
  gate("pinned-fork-and-current-head-smoke", "candidate", "Every candidate must prove compatibility with exact deployments and current chain state.");
  gate("human-economic-and-security-review", "candidate", "Automation cannot accept its own output.");
  gate("runtime-source-config-verification", "release", "Deployment claims require runtime, source and configuration evidence.");
  gate("monitoring-and-lifecycle-evidence", "release", "Availability requires operational evidence after deployment.");
  gate("independent-routing-provider-approval", "external", "Routing or listing is controlled by each external provider.");
  Object.assign(context, { derivedTriggers, risk });
}
