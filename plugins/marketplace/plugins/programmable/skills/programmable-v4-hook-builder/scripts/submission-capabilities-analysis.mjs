import { hasResolvedPolicyValue, objectAt } from "./submission-analysis-helpers.mjs";
import {
  requireCapabilityMatch,
  requireDetailedText,
  requireNonEmptyArray,
  requirePresent
} from "./settlement-policy-core.mjs";

export function analyzeSubmissionCapabilities(context) {
  const {
    submission,
    add,
    gate,
    model,
    assets,
    operations,
    validateDeclaredPath
  } = context;
  const capabilityProfiles = objectAt(submission, "capabilities");
  for (const name of ["externalCalls", "permissionedAsset", "oracle", "keeper", "proof", "crossChain", "externalLiquidity", "asyncSwap", "customCurve"]) {
    const profile = objectAt(capabilityProfiles, name);
    if (typeof profile.used !== "boolean") {
      add("blocker", "CAPABILITY_USAGE_UNRESOLVED", `$.capabilities.${name}.used`, `Usage of the ${name} capability is unresolved.`, "Set used to true or false after inspecting the design and complete the policy when it is true.");
    }
  }

  const capabilityExtensions = Array.isArray(submission.capabilityExtensions) ? submission.capabilityExtensions : [];
  const projectCapabilityIds = new Set((submission.projectCapabilities ?? []).map((capability) => capability?.id));
  const capabilityExtensionIds = new Set();
  for (const [index, extension] of capabilityExtensions.entries()) {
    const extensionPath = `$.capabilityExtensions[${index}]`;
    if (capabilityExtensionIds.has(extension?.capabilityId)) {
      add("blocker", "CAPABILITY_EXTENSION_DUPLICATE", `${extensionPath}.capabilityId`, "Capability extension identifiers must be unique.", "Merge duplicate declarations under one stable capabilityId.");
    }
    capabilityExtensionIds.add(extension?.capabilityId);
    if (!projectCapabilityIds.has(extension?.capabilityId)) {
      add(
        "blocker",
        "CAPABILITY_EXTENSION_PROJECT_PROFILE_MISSING",
        `${extensionPath}.capabilityId`,
        "A capability extension is outside the project capability graph and therefore has no derived security profiles.",
        "Declare the same stable id in projectCapabilities, bind its surfaces, set every security trigger and use the exact derived requiredProfiles list."
      );
    }
    for (const [field, role] of [
      ["sourcePaths", "capability extension source"],
      ["testPaths", "capability extension test"],
      ["evidencePaths", "capability extension evidence"]
    ]) {
      for (const [pathIndex, entry] of (extension?.[field] ?? []).entries()) {
        validateDeclaredPath(entry, `${extensionPath}.${field}[${pathIndex}]`, role);
      }
    }
    if (extension?.schemaPath !== null && extension?.schemaPath !== undefined) {
      validateDeclaredPath(extension.schemaPath, `${extensionPath}.schemaPath`, "capability extension schema");
    }
    add(
      "warning",
      "CAPABILITY_EXTENSION_REQUIRES_ARCHITECTURE_REVIEW",
      extensionPath,
      `Novel capability ${extension?.capabilityId ?? "without an id"} is preserved for architecture review rather than forced into the current catalog.`,
      "Review its declared interactions, trust boundary, failure mode, schema and exact source/evidence bytes before defining adapters or approval requirements."
    );
    gate("novel-capability-architecture-review", "candidate", "At least one capability extension is outside the current acceleration catalog.");
  }

  const externalCalls = objectAt(capabilityProfiles, "externalCalls");
  if (externalCalls.used === true) {
    requireNonEmptyArray(externalCalls.targets, "$.capabilities.externalCalls.targets", "EXTERNAL_CALL_TARGETS_MISSING", "List every exact target or target registry.", add);
    requireNonEmptyArray(externalCalls.callSites, "$.capabilities.externalCalls.callSites", "EXTERNAL_CALL_SITES_MISSING", "List every callback and lifecycle action that performs an external call.", add);
    for (const field of ["reentrancyPolicy", "stateDriftPolicy", "returnValuePolicy", "failureAtomicity"]) requireDetailedText(externalCalls[field], `$.capabilities.externalCalls.${field}`, "EXTERNAL_CALL_POLICY_INCOMPLETE", add);
    gate("external-call-reentrancy-and-failure-tests", "prototype", "The declared model makes external calls.");
  }

  const permissionedAsset = objectAt(capabilityProfiles, "permissionedAsset");
  const permissionedExpected = model.category === "permissioned-asset" || assets.some((asset) => asset?.origin === "permissioned-adapter" || (asset?.controls?.length ?? 0) > 0 || (asset?.behaviors ?? []).some((behavior) => ["pausable", "blacklistable", "confiscatable"].includes(behavior)));
  requireCapabilityMatch(permissionedAsset.used, permissionedExpected, "permissionedAsset", "PERMISSIONED_ASSET_PROFILE_MISMATCH", add);
  if (permissionedAsset.used === true) {
    for (const field of ["issuer", "jurisdiction", "underlyingClaim", "custodian", "adapter", "hooks", "positionManager", "swapEligibility", "liquidityEligibility", "positionTransferability", "pauseFreezeUnwind", "redemption", "routingLimitations"]) requireDetailedText(permissionedAsset[field], `$.capabilities.permissionedAsset.${field}`, "PERMISSIONED_ASSET_PROFILE_INCOMPLETE", add);
    requireNonEmptyArray(permissionedAsset.legalDocuments, "$.capabilities.permissionedAsset.legalDocuments", "PERMISSIONED_ASSET_LEGAL_DOCUMENTS_MISSING", "Link the exact issuer and legal documents; token pairing is not ownership of an underlying asset.", add);
    gate("permissioned-asset-legal-and-trust-review", "candidate", "The model depends on issuer controls, legal claims or permission adapters.");
  }

  const oracle = objectAt(capabilityProfiles, "oracle");
  const oracleDependencyText = [...(submission.dependencies?.onchain ?? []), ...(submission.dependencies?.offchain ?? [])].map((dependency) => `${dependency?.name ?? ""} ${dependency?.kind ?? ""}`).join(" ");
  const oracleExpected = operations.oracle?.required === true || model.category === "oracle-linked" || /\b(?:oracle|price feed|chainlink|pyth)\b/i.test(`${model.summary ?? ""} ${model.whyV4 ?? ""} ${oracleDependencyText}`);
  requireCapabilityMatch(oracle.used, oracleExpected, "oracle", "ORACLE_PROFILE_MISMATCH", add);
  if (oracle.used === true) {
    for (const field of ["source", "value", "deployment", "runtimeHash", "decimals", "heartbeatSeconds", "maxAgeSeconds", "observationType", "windowSeconds", "minimumAnswer", "maximumAnswer", "maximumDeviation", "roundChecks", "manipulationResistance", "governance", "fallback", "maxFallbackAgeSeconds", "failureRule"]) requirePresent(oracle[field], `$.capabilities.oracle.${field}`, "ORACLE_POLICY_INCOMPLETE", "Define the exact feed, bounds, freshness, manipulation, governance and bounded failure behavior.", add);
    if (Number.isInteger(oracle.heartbeatSeconds) && Number.isInteger(oracle.maxAgeSeconds) && oracle.maxAgeSeconds < oracle.heartbeatSeconds) add("blocker", "ORACLE_MAX_AGE_BELOW_HEARTBEAT", "$.capabilities.oracle.maxAgeSeconds", "The accepted oracle age is shorter than its declared heartbeat.", "Use coherent freshness bounds and test delayed and stale rounds.");
    if (oracle.fallback === "last-good-bounded" && (!Number.isInteger(oracle.maxFallbackAgeSeconds) || oracle.maxFallbackAgeSeconds <= 0)) add("blocker", "ORACLE_FALLBACK_UNBOUNDED", "$.capabilities.oracle.maxFallbackAgeSeconds", "A last-good fallback needs a finite maximum age.", "Set a finite fallback horizon and revert or enter a static safe mode afterward.");
    gate("oracle-freshness-manipulation-and-failure-tests", "prototype", "The model consumes an oracle.");
    gate("oracle-deployment-and-governance-review", "candidate", "The model consumes an oracle.");
  }

  const keeper = objectAt(capabilityProfiles, "keeper");
  const keeperExpected = operations.keeper?.required === true;
  requireCapabilityMatch(keeper.used, keeperExpected, "keeper", "KEEPER_PROFILE_MISMATCH", add);
  if (keeper.used === true) {
    for (const field of ["executionMode", "minIntervalSeconds", "maxDelaySeconds", "permissionlessFallbackAfterSeconds", "idempotencyKey", "duplicateBehavior", "lastProcessedState", "boundedWork", "maxItems", "retryPolicy", "zeroWorkBehavior", "fundingSource", "minimumGasRunway", "alertThreshold", "maximumGas", "failureImpact", "userExitIndependent", "poolBinding", "slippage", "deadline", "mevPolicy"]) requirePresent(keeper[field], `$.capabilities.keeper.${field}`, "KEEPER_POLICY_INCOMPLETE", "Define liveness, idempotency, bounded work, funding, fallback, slippage, deadline and failure semantics.", add);
    if (keeper.executionMode === "operator-with-permissionless-fallback" && (!Number.isInteger(keeper.permissionlessFallbackAfterSeconds) || keeper.permissionlessFallbackAfterSeconds <= 0)) add("blocker", "KEEPER_FALLBACK_UNRESOLVED", "$.capabilities.keeper.permissionlessFallbackAfterSeconds", "The permissionless keeper fallback needs a finite activation delay.", "Set the delay and test duplicate execution at the boundary.");
    if (keeper.userExitIndependent !== true) add("blocker", "KEEPER_CAN_BLOCK_EXIT", "$.capabilities.keeper.userExitIndependent", "A keeper outage must not trap user funds or block the defined exit path.", "Make exit independent of keeper liveness or redesign the custody model.");
    gate("keeper-idempotency-liveness-and-gas-tests", "prototype", "The model requires autonomous or scheduled execution.");
    gate("keeper-monitoring-and-fallback-proof", "candidate", "The model requires autonomous or scheduled execution.");
  }

  const proof = objectAt(capabilityProfiles, "proof");
  const proofText = `${model.summary ?? ""} ${model.whyV4 ?? ""} ${(submission.dependencies?.onchain ?? []).map((dependency) => `${dependency.name ?? ""} ${dependency.kind ?? ""}`).join(" ")}`;
  const proofExpected = model.category === "privacy" || /\b(?:zero[- ]knowledge|zkp?|zk[- ]snark|zk[- ]stark|snark|stark|verifier|nullifier|cryptographic proof)\b/i.test(proofText);
  requireCapabilityMatch(proof.used, proofExpected, "proof", "PROOF_PROFILE_MISMATCH", add);
  if (proof.used === true) {
    for (const field of ["proofSystem", "circuitRevision", "verifyingKeyHash", "verifierAddress", "runtimeHash", "setupType", "setupProvenance", "replayMode", "nullifierScope", "nullifierDerivation", "nullifierStorage", "atomicSpentCheck", "resetPolicy", "maximumProofBytes", "maximumVerificationGas", "verifierAuthority", "failureRule", "privacyClaim", "metadataLeakage"]) requirePresent(proof[field], `$.capabilities.proof.${field}`, "PROOF_POLICY_INCOMPLETE", "Define the exact circuit, verifier, setup, domain, replay, gas, failure and privacy model.", add);
    requireNonEmptyArray(proof.publicInputs, "$.capabilities.proof.publicInputs", "PROOF_PUBLIC_INPUTS_MISSING", "List and bind every public input.", add);
    const bindings = objectAt(proof, "domainBindings");
    for (const field of ["chainId", "verifyingContract", "modelVersion", "pool", "action", "actorOrRecipient", "amountBounds", "epochOrDeadline"]) {
      if (bindings[field] !== true) add("blocker", "PROOF_DOMAIN_BINDING_INCOMPLETE", `$.capabilities.proof.domainBindings.${field}`, "The proof is not bound to this execution domain and action.", "Bind the field in the circuit or prove a separately reviewed equivalent replay boundary.");
    }
    if (proof.replayMode === "single-use" && proof.atomicSpentCheck !== true) add("blocker", "PROOF_NULLIFIER_NOT_ATOMIC", "$.capabilities.proof.atomicSpentCheck", "A single-use proof needs an atomic spent check and state update.", "Check and consume the nullifier in the same transaction before value is released.");
    gate("proof-domain-replay-and-verifier-tests", "prototype", "The model verifies cryptographic proofs.");
    gate("independent-circuit-and-privacy-review", "candidate", "The model verifies cryptographic proofs.");
  }

  const crossChain = objectAt(capabilityProfiles, "crossChain");
  const dependencyText = [...(submission.dependencies?.onchain ?? []), ...(submission.dependencies?.offchain ?? [])].map((dependency) => `${dependency.name ?? ""} ${dependency.kind ?? ""} ${dependency.trust ?? ""}`).join(" ");
  const crossChainDeclared = (submission.risk?.featureTriggers ?? [])
    .some((trigger) => /\bcross[- ]chain\b/i.test(trigger));
  const crossChainConfigured = Object.entries(crossChain)
    .some(([field, value]) => field !== "used" && hasResolvedPolicyValue(value));
  const crossChainExpected =
    crossChainDeclared ||
    crossChainConfigured ||
    /\b(?:bridge|cross[- ]chain|cross[- ]domain|message relay|wormhole|vaa|layerzero|endpointv2|hyperlane|axelar|ccip)\b/i
      .test(`${model.summary ?? ""} ${model.whyV4 ?? ""} ${dependencyText}`);
  requireCapabilityMatch(crossChain.used, crossChainExpected, "crossChain", "CROSS_CHAIN_PROFILE_MISMATCH", add);
  Object.assign(context, { capabilityProfiles, capabilityExtensions, crossChain });
}
