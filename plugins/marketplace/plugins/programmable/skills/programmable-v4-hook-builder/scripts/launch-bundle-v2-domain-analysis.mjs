import { analyzeReviewRequirements } from "./launch-bundle-v2-security-analysis.mjs";
import {
  ARCHITECTURE_DECISIONS_V1_SCHEMA_ID,
  IDEA_SOURCE_V1_SCHEMA_ID,
  INTENT_CONTRACT_V1_SCHEMA_ID,
  INTENT_FIDELITY_V1_SCHEMA_ID,
  REQUIRED_V4_CHECKS,
  REVIEW_STATES,
  addConflict,
  addUnresolved,
  applyDeclaredState,
  architectureSnapshotSha256V2,
  bindDeclaredEvidence,
  bindingState,
  canonicalPositiveUint256Decimal,
  exact,
  idSet,
  isObject,
  protocolHooks,
  requireEqual,
  sameScalar,
  sortedUniqueStrings,
  tracker,
  uniqueMap
} from "./launch-bundle-v2-shared.mjs";

export function analyzeIntentChain(context) {
  const {
    input,
    application,
    submission,
    ideaSource,
    intentContract,
    architectureDecisions,
    intentFidelity,
    artifacts,
    evidenceIndex,
    conflicts,
    unresolved,
    reviewItems,
    intentTracker,
    evidenceTracker
  } = context;
  const records = {
    ideaSource: artifacts.recordsByRole.get("idea-source"),
    intentContract: artifacts.recordsByRole.get("intent-contract"),
    architectureDecisions: artifacts.recordsByRole.get("architecture-decisions"),
    intentFidelity: artifacts.recordsByRole.get("intent-fidelity")
  };
  const documents = { ideaSource, intentContract, architectureDecisions, intentFidelity };
  const specs = {
    ideaSource: { artifactType: "idea-source", schemaId: IDEA_SOURCE_V1_SCHEMA_ID },
    intentContract: { artifactType: "intent-contract", schemaId: INTENT_CONTRACT_V1_SCHEMA_ID },
    architectureDecisions: { artifactType: "architecture-decisions", schemaId: ARCHITECTURE_DECISIONS_V1_SCHEMA_ID },
    intentFidelity: { artifactType: "intent-fidelity", schemaId: INTENT_FIDELITY_V1_SCHEMA_ID }
  };

  for (const key of Object.keys(specs)) {
    const record = records[key];
    const document = documents[key];
    if (!record || !isObject(document)) {
      addConflict(conflicts, intentTracker, "INTENT_ARTIFACT_MISSING", `$.artifacts.${key}`, `Exact ${key} bytes are required.`);
      continue;
    }
    if (document.applicationId !== input?.applicationId) {
      addConflict(conflicts, intentTracker, "INTENT_APPLICATION_ID_MISMATCH", `$.artifacts.${key}.content#/applicationId`, `${key} does not bind the launch bundle application id.`);
    }
    const submissionBinding = submission?.intentPackage?.[key];
    if (!isObject(submissionBinding)) {
      addConflict(conflicts, intentTracker, "SUBMISSION_INTENT_BINDING_MISSING", `$.artifacts.submission.content#/intentPackage/${key}`, `Submission is missing its ${key} content binding.`);
      continue;
    }
    for (const [field, expected] of [
      ["artifactType", specs[key].artifactType],
      ["schemaId", specs[key].schemaId],
      ["path", record.path],
      ["sha256", record.sha256],
      ["byteLength", record.byteLength]
    ]) {
      if (submissionBinding[field] !== expected) {
        addConflict(conflicts, intentTracker, "SUBMISSION_INTENT_BINDING_MISMATCH", `$.artifacts.submission.content#/intentPackage/${key}/${field}`, `${key}.${field} does not match the exact bound artifact bytes.`);
      }
    }
  }

  if (isObject(intentContract) && records.ideaSource && intentContract.ideaSourceSha256 !== records.ideaSource.sha256) {
    addConflict(conflicts, intentTracker, "INTENT_IDEA_DIGEST_MISMATCH", "$.artifacts.intentContract.content#/ideaSourceSha256", "Intent contract does not bind the exact idea-source bytes.");
  }
  if (isObject(architectureDecisions) && records.intentContract && architectureDecisions.intentContractSha256 !== records.intentContract.sha256) {
    addConflict(conflicts, intentTracker, "ARCHITECTURE_INTENT_DIGEST_MISMATCH", "$.artifacts.architectureDecisions.content#/intentContractSha256", "Architecture decisions do not bind the exact intent-contract bytes.");
  }
  if (isObject(intentFidelity)) {
    const expectedDigests = {
      ideaSourceSha256: records.ideaSource?.sha256,
      intentContractSha256: records.intentContract?.sha256,
      architectureDecisionsSha256: records.architectureDecisions?.sha256,
      architectureSnapshotSha256: isObject(submission) ? architectureSnapshotSha256V2(submission) : undefined
    };
    for (const [field, expected] of Object.entries(expectedDigests)) {
      if (typeof expected === "string" && intentFidelity.inputDigests?.[field] !== expected) {
        addConflict(conflicts, intentTracker, "FIDELITY_INPUT_DIGEST_MISMATCH", `$.artifacts.intentFidelity.content#/inputDigests/${field}`, `${field} does not bind the exact current input.`);
      }
    }
  }

  if (isObject(ideaSource)) {
    if (ideaSource.captureStatus === "unavailable-legacy") {
      addUnresolved(unresolved, intentTracker, "ORIGINAL_INTENT_UNAVAILABLE", "$.artifacts.ideaSource.content#/captureStatus", "The original builder intent is unavailable and must be recaptured before authorization.");
    }
    if (application?.intentCapture?.captureStatus !== ideaSource.captureStatus) {
      addConflict(conflicts, intentTracker, "APPLICATION_IDEA_CAPTURE_MISMATCH", "$.artifacts.application.content#/intentCapture/captureStatus", "Application intent capture status conflicts with the exact idea-source record.");
    }
    const ideaRecord = artifacts.recordsByRole.get("idea-source");
    requireEqual(application?.intentCapture?.ideaSourcePath, ideaRecord?.path, "APPLICATION_IDEA_SOURCE_PATH_MISMATCH", "$.artifacts.application.content#/intentCapture/ideaSourcePath", "Application intent capture does not bind the exact idea-source path.", conflicts, intentTracker);
    requireEqual(application?.intentCapture?.ideaSourceRepositoryRef, ideaRecord?.sourceRef, "APPLICATION_IDEA_SOURCE_REPOSITORY_MISMATCH", "$.artifacts.application.content#/intentCapture/ideaSourceRepositoryRef", "Application intent capture does not bind the exact idea-source repository.", conflicts, intentTracker);
    requireEqual(application?.intentCapture?.ideaSourceSha256, ideaRecord?.sha256, "APPLICATION_IDEA_SOURCE_SHA256_MISMATCH", "$.artifacts.application.content#/intentCapture/ideaSourceSha256", "Application intent capture does not bind the exact idea-source bytes.", conflicts, intentTracker);
    if (ideaSource.captureStatus === "captured-verbatim-public-safe") {
      const originalEntry = (Array.isArray(ideaSource.entries) ? ideaSource.entries : [])
        .find(({ id }) => id === ideaSource.originalEntryId);
      const excerpt = application?.intentCapture?.originalIdeaDisplayExcerpt;
      if (excerpt !== null && (typeof excerpt !== "string" || !originalEntry?.publicTextUtf8?.includes(excerpt))) {
        addConflict(conflicts, intentTracker, "APPLICATION_IDEA_DISPLAY_EXCERPT_MISMATCH", "$.artifacts.application.content#/intentCapture/originalIdeaDisplayExcerpt", "The optional display excerpt must be verbatim text from the exact public idea-source entry.");
      }
    }
  }
  if (isObject(intentContract)) {
    if (!["builder-confirmed", "delegated-defaults"].includes(intentContract.status)) {
      addUnresolved(unresolved, intentTracker, "INTENT_CONTRACT_UNCONFIRMED", "$.artifacts.intentContract.content#/status", "The intent contract is not builder-confirmed or explicitly delegated.");
    }
    if (!["builder-confirmed", "delegated-defaults"].includes(intentContract.confirmation?.state)) {
      addUnresolved(unresolved, intentTracker, "INTENT_CONFIRMATION_UNRESOLVED", "$.artifacts.intentContract.content#/confirmation/state", "Intent confirmation remains unresolved.");
    }
    for (const [index, fact] of (Array.isArray(intentContract.facts) ? intentContract.facts : []).entries()) {
      if (["unresolved", "legacy-unconfirmed", "default-proposed"].includes(fact?.state)) {
        addUnresolved(unresolved, intentTracker, "INTENT_FACT_UNRESOLVED", `$.artifacts.intentContract.content#/facts/${index}/state`, `Intent fact ${String(fact?.id)} is not fully resolved.`);
      }
    }
    for (const [index, ambiguity] of (Array.isArray(intentContract.ambiguities) ? intentContract.ambiguities : []).entries()) {
      if (ambiguity?.status === "open") {
        addUnresolved(unresolved, intentTracker, "INTENT_AMBIGUITY_OPEN", `$.artifacts.intentContract.content#/ambiguities/${index}`, `Material ambiguity ${String(ambiguity?.id)} remains open.`);
      }
    }
  }
  if (isObject(architectureDecisions)) {
    for (const [index, decision] of (Array.isArray(architectureDecisions.decisions) ? architectureDecisions.decisions : []).entries()) {
      if (decision?.status === "proposed") {
        addUnresolved(unresolved, intentTracker, "ARCHITECTURE_DECISION_UNRESOLVED", `$.artifacts.architectureDecisions.content#/decisions/${index}/status`, `Architecture decision ${String(decision?.id)} remains proposed.`);
      }
    }
  }
  if (isObject(intentFidelity)) {
    if (intentFidelity.overallStatus === "drift") {
      addConflict(conflicts, intentTracker, "INTENT_FIDELITY_DRIFT", "$.artifacts.intentFidelity.content#/overallStatus", "The current architecture drifts from confirmed intent.");
    } else if (intentFidelity.overallStatus !== "preserved") {
      addUnresolved(unresolved, intentTracker, "INTENT_FIDELITY_INCOMPLETE", "$.artifacts.intentFidelity.content#/overallStatus", "Intent fidelity is incomplete or unassessed.");
    }
    for (const [index, trace] of (Array.isArray(intentFidelity.traces) ? intentFidelity.traces : []).entries()) {
      if (trace?.status === "drift") {
        addConflict(conflicts, intentTracker, "INTENT_TRACE_DRIFT", `$.artifacts.intentFidelity.content#/traces/${index}/status`, `Fidelity trace ${String(trace?.factId)} records drift.`);
      } else if (trace?.status !== "preserved") {
        addUnresolved(unresolved, intentTracker, "INTENT_TRACE_INCOMPLETE", `$.artifacts.intentFidelity.content#/traces/${index}/status`, `Fidelity trace ${String(trace?.factId)} is not fully preserved.`);
      }
      bindDeclaredEvidence(trace?.evidenceRefs, `$.artifacts.intentFidelity.content#/traces/${index}/evidenceRefs`, evidenceIndex, unresolved, evidenceTracker, intentTracker);
    }
  }

  if (isObject(application)) {
    if (application.intentCapture?.agentInterpretationStatus !== "owner-confirmed") {
      addUnresolved(unresolved, intentTracker, "APPLICATION_INTENT_UNCONFIRMED", "$.artifacts.application.content#/intentCapture/agentInterpretationStatus", "Application intent has not been confirmed by its owner.");
    }
    if ((application.intentCapture?.unresolvedMaterialDecisions?.length ?? 0) > 0) {
      addUnresolved(unresolved, intentTracker, "APPLICATION_MATERIAL_DECISIONS_UNRESOLVED", "$.artifacts.application.content#/intentCapture/unresolvedMaterialDecisions", "Application still lists unresolved material decisions.");
    }
    if (application.fidelity?.status === "drift-detected") {
      addConflict(conflicts, intentTracker, "APPLICATION_FIDELITY_DRIFT", "$.artifacts.application.content#/fidelity/status", "Application reports intent drift.");
    } else if (application.fidelity?.status !== "complete") {
      addUnresolved(unresolved, intentTracker, "APPLICATION_FIDELITY_UNRESOLVED", "$.artifacts.application.content#/fidelity/status", "Application fidelity is not complete.");
    }
    if (application.fidelity?.status === "complete" && intentFidelity?.overallStatus !== "preserved") {
      addConflict(conflicts, intentTracker, "APPLICATION_FIDELITY_OVERCLAIM", "$.artifacts.application.content#/fidelity/status", "Application claims complete fidelity while the exact fidelity record is not preserved.");
    }
  }
  reviewItems.add("INTENT_FIDELITY_REQUIRES_HUMAN_CONFIRMATION", "$.artifacts.intentFidelity", "Content-addressed intent fidelity is required evidence but does not replace independent human confirmation.", []);
}

export function analyzeFeeScopes(context) {
  const { input, submission, feePolicy, evidenceIndex, conflicts, unresolved, feeTracker, evidenceTracker } = context;
  const bindings = Array.isArray(input?.feeScopeBindings) ? input.feeScopeBindings : [];
  const policyScopes = Array.isArray(feePolicy?.feeScopes) ? feePolicy.feeScopes : [];
  const submissionScopes = Array.isArray(submission?.programmableFee?.feeScopes)
    ? submission.programmableFee.feeScopes
    : [];
  const policyMap = uniqueMap(policyScopes, "id", "FEE_POLICY_SCOPE_ID_DUPLICATE", "$.artifacts.feePolicy.content#/feeScopes", conflicts, feeTracker);
  const submissionMap = uniqueMap(submissionScopes, "id", "SUBMISSION_FEE_SCOPE_ID_DUPLICATE", "$.artifacts.submission.content#/programmableFee/feeScopes", conflicts, feeTracker);
  const bindingMap = uniqueMap(bindings, "feeScopeId", "FEE_SCOPE_BINDING_DUPLICATE", "$.feeScopeBindings", conflicts, feeTracker);
  const marketIds = idSet(submission?.markets);
  const protocolIds = idSet(input?.protocolContexts);
  const protocolMap = new Map((Array.isArray(input?.protocolContexts) ? input.protocolContexts : [])
    .filter((contextRecord) => typeof contextRecord?.id === "string")
    .map((contextRecord) => [contextRecord.id, contextRecord]));
  const results = [];
  const canonicalMarkets = (Array.isArray(submission?.markets) ? submission.markets : [])
    .filter((market) => market?.executionClass === "programmable-canonical");
  if (canonicalMarkets.length === 0) {
    addConflict(conflicts, feeTracker, "PROGRAMMABLE_CANONICAL_MARKET_MISSING", "$.artifacts.submission.content#/markets", "A launch bundle must contain at least one programmable-canonical execution market with an active Fee V2 scope.");
  }

  for (const [index, market] of (Array.isArray(submission?.markets) ? submission.markets : []).entries()) {
    const marketPath = `$.artifacts.submission.content#/markets/${index}`;
    const canonicalScopes = Array.isArray(market?.canonicalScopes) ? market.canonicalScopes : [];
    const scopesForMarket = [...submissionMap.values()].filter((scope) => scope.marketRef === market?.id);
    const bindingsForMarket = [...bindingMap.values()].filter((binding) => binding.marketRef === market?.id);
    if (market?.executionClass === "programmable-canonical") {
      if (canonicalScopes.length !== 1) {
        addConflict(conflicts, feeTracker, "CANONICAL_MARKET_SCOPE_CARDINALITY_INVALID", `${marketPath}/canonicalScopes`, "A programmable-canonical market must declare exactly one canonical fee scope.");
        continue;
      }
      const [scopeId] = canonicalScopes;
      if (!policyMap.has(scopeId)) {
        addConflict(conflicts, feeTracker, "CANONICAL_MARKET_POLICY_SCOPE_MISSING", `${marketPath}/canonicalScopes`, `Canonical market scope ${String(scopeId)} is absent from the exact fee-policy instance.`);
      }
      if (scopesForMarket.length !== 1 || scopesForMarket[0]?.id !== scopeId) {
        addConflict(conflicts, feeTracker, "CANONICAL_MARKET_SUBMISSION_SCOPE_MISMATCH", `${marketPath}/canonicalScopes`, "A programmable-canonical market must map to exactly one matching submission fee scope.");
      }
      if (bindingsForMarket.length !== 1 || bindingsForMarket[0]?.feeScopeId !== scopeId) {
        addConflict(conflicts, feeTracker, "CANONICAL_MARKET_IMPLEMENTATION_SCOPE_MISMATCH", `$.feeScopeBindings`, "A programmable-canonical market must map to exactly one matching implementation binding.");
      }
    } else if (["external", "non-launchable"].includes(market?.executionClass)) {
      if (canonicalScopes.length !== 0 || scopesForMarket.length !== 0 || bindingsForMarket.length !== 0) {
        addConflict(conflicts, feeTracker, "NON_CANONICAL_MARKET_SCOPE_FORBIDDEN", marketPath, "External and non-launchable markets cannot carry Programmable canonical execution fee scopes.");
      }
    } else if (market?.executionClass === "unknown" || market?.executionClass === undefined) {
      addUnresolved(unresolved, feeTracker, "MARKET_EXECUTION_CLASS_UNRESOLVED", `${marketPath}/executionClass`, "Every market must resolve to programmable-canonical, external, or non-launchable; unknown keeps launch on hold without rejecting the product idea.");
    } else {
      addConflict(conflicts, feeTracker, "MARKET_EXECUTION_CLASS_INVALID", `${marketPath}/executionClass`, "Unknown market execution class.");
    }
  }

  for (const [feeScopeId, scope] of [...policyMap.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const local = tracker();
    const binding = bindingMap.get(feeScopeId);
    const submissionScope = submissionMap.get(feeScopeId);
    if (!binding) {
      addUnresolved(unresolved, local, "FEE_SCOPE_IMPLEMENTATION_UNBOUND", `$.feeScopeBindings[feeScopeId=${feeScopeId}]`, "The fee policy scope has no exact implementation binding.");
    } else {
      for (const field of ["chainId", "poolId", "quoteCurrency", "collectionProfile"]) {
        if (!sameScalar(binding[field], scope[field], field === "poolId" || field === "quoteCurrency")) {
          addConflict(conflicts, local, "FEE_SCOPE_POLICY_BINDING_MISMATCH", `$.feeScopeBindings[feeScopeId=${feeScopeId}].${field}`, `${field} does not match the exact fee policy scope.`);
        }
      }
      if (!marketIds.has(binding.marketRef)) {
        addConflict(conflicts, local, "FEE_SCOPE_MARKET_UNBOUND", `$.feeScopeBindings[feeScopeId=${feeScopeId}].marketRef`, "The fee scope marketRef is not present in the submission graph.");
      }
      if (binding.protocolContextRef !== null && !protocolIds.has(binding.protocolContextRef)) {
        addConflict(conflicts, local, "FEE_SCOPE_PROTOCOL_CONTEXT_UNBOUND", `$.feeScopeBindings[feeScopeId=${feeScopeId}].protocolContextRef`, "The fee scope protocol context does not exist.");
      } else if (binding.protocolContextRef !== null && !protocolMap.get(binding.protocolContextRef)?.marketRefs?.includes(binding.marketRef)) {
        addConflict(conflicts, local, "FEE_SCOPE_PROTOCOL_MARKET_MISMATCH", `$.feeScopeBindings[feeScopeId=${feeScopeId}].protocolContextRef`, "The bound protocol context does not include the fee scope market.");
      }
      applyDeclaredState(binding.state, `$.feeScopeBindings[feeScopeId=${feeScopeId}].state`, "FEE_SCOPE", local, conflicts, unresolved);
      if (binding.state === "not-applicable") {
        addConflict(conflicts, local, "FEE_SCOPE_NOT_APPLICABLE_FORBIDDEN", `$.feeScopeBindings[feeScopeId=${feeScopeId}].state`, "A declared fee policy scope cannot be marked not applicable.");
      }
      if (binding.state === "satisfied" && (binding.evidenceRefs?.length ?? 0) === 0) {
        addUnresolved(unresolved, local, "FEE_SCOPE_EVIDENCE_UNRESOLVED", `$.feeScopeBindings[feeScopeId=${feeScopeId}].evidenceRefs`, "A satisfied fee scope needs exact evidence content bindings.");
      }
      if (binding.implementationRef === null || binding.implementationSourceRef === null) {
        addUnresolved(unresolved, local, "FEE_SCOPE_IMPLEMENTATION_PATH_UNRESOLVED", `$.feeScopeBindings[feeScopeId=${feeScopeId}].implementationRef`, "The collection implementation path is unresolved.");
      } else if (![...evidenceIndex.values()].some(({ path, sourceRef }) => (
        path === binding.implementationRef && sourceRef === binding.implementationSourceRef
      ))) {
        addUnresolved(unresolved, local, "FEE_SCOPE_IMPLEMENTATION_BYTES_UNBOUND", `$.feeScopeBindings[feeScopeId=${feeScopeId}].implementationRef`, "The declared implementation path has no exact evidence content binding.");
      }
      bindDeclaredEvidence(binding.evidenceRefs, `$.feeScopeBindings[feeScopeId=${feeScopeId}].evidenceRefs`, evidenceIndex, unresolved, evidenceTracker, local);
    }
    if (!submissionScope) {
      addUnresolved(unresolved, local, "SUBMISSION_FEE_SCOPE_UNRESOLVED", `$.artifacts.submission.content#/programmableFee/feeScopes/${feeScopeId}`, "The submission graph does not bind this fee policy scope.");
    } else {
      for (const field of ["chainId", "poolId", "quoteCurrency", "collectionProfile"]) {
        if (submissionScope[field] === null || submissionScope[field] === undefined) {
          addUnresolved(unresolved, local, "SUBMISSION_FEE_SCOPE_FIELD_UNRESOLVED", `$.artifacts.submission.content#/programmableFee/feeScopes/${feeScopeId}/${field}`, `${field} remains unresolved in the submission.`);
        } else if (!sameScalar(submissionScope[field], scope[field], field === "poolId" || field === "quoteCurrency")) {
          addConflict(conflicts, local, "SUBMISSION_FEE_SCOPE_MISMATCH", `$.artifacts.submission.content#/programmableFee/feeScopes/${feeScopeId}/${field}`, `${field} conflicts with the exact fee policy scope.`);
        }
      }
    }
    results.push({
      feeScopeId,
      chainId: canonicalPositiveUint256Decimal(scope?.chainId) ? scope.chainId : null,
      state: bindingState(local),
      marketRef: binding?.marketRef ?? submissionScope?.marketRef ?? null,
      protocolContextRef: binding?.protocolContextRef ?? null,
      evidenceRefs: sortedUniqueStrings(binding?.evidenceRefs)
    });
    feeTracker.conflicts += local.conflicts;
    feeTracker.unresolved += local.unresolved;
  }

  for (const feeScopeId of bindingMap.keys()) {
    if (!policyMap.has(feeScopeId)) {
      addConflict(conflicts, feeTracker, "FEE_SCOPE_BINDING_WITHOUT_POLICY", `$.feeScopeBindings[feeScopeId=${feeScopeId}]`, "A fee scope binding exists outside the exact fee policy.");
    }
  }
  for (const feeScopeId of submissionMap.keys()) {
    if (!policyMap.has(feeScopeId)) {
      addConflict(conflicts, feeTracker, "SUBMISSION_FEE_SCOPE_WITHOUT_POLICY", `$.artifacts.submission.content#/programmableFee/feeScopes/${feeScopeId}`, "A submission fee scope is not covered by the exact fee policy.");
    }
  }
  const declaredRefs = new Set(Array.isArray(submission?.programmableFee?.executionScopeRefs) ? submission.programmableFee.executionScopeRefs : []);
  for (const feeScopeId of policyMap.keys()) {
    if (!declaredRefs.has(feeScopeId)) {
      addUnresolved(unresolved, feeTracker, "SUBMISSION_FEE_SCOPE_REF_MISSING", "$.artifacts.submission.content#/programmableFee/executionScopeRefs", `Fee scope ${feeScopeId} is not referenced by the submission.`);
    }
  }
  for (const feeScopeId of declaredRefs) {
    if (!policyMap.has(feeScopeId)) {
      addConflict(conflicts, feeTracker, "SUBMISSION_FEE_SCOPE_REF_UNKNOWN", "$.artifacts.submission.content#/programmableFee/executionScopeRefs", `Fee scope ref ${feeScopeId} has no exact fee policy scope.`);
    }
  }
  return results;
}

export function analyzeProtocolContexts(context) {
  const { input, submission, evidenceIndex, conflicts, unresolved, reviewItems, evidenceTracker } = context;
  const contexts = Array.isArray(input?.protocolContexts) ? input.protocolContexts : [];
  const ids = new Set();
  const results = [];
  const graphSets = {
    targetRefs: idSet(submission?.targets),
    assetRefs: idSet(submission?.assets),
    marketRefs: idSet(submission?.markets),
    hookRefs: idSet(submission?.hooks)
  };
  const v4HookIds = new Set(
    (Array.isArray(submission?.hooks) ? submission.hooks : [])
      .filter((hook) => isObject(hook?.permissions))
      .map((hook) => hook.id)
  );
  const coveredV4Hooks = new Set();

  for (const [index, protocol] of contexts.entries()) {
    const base = `$.protocolContexts[${index}]`;
    const local = tracker();
    if (!isObject(protocol) || typeof protocol.id !== "string" || typeof protocol.protocolId !== "string") continue;
    if (ids.has(protocol.id)) {
      addConflict(conflicts, local, "PROTOCOL_CONTEXT_ID_DUPLICATE", `${base}.id`, `Duplicate protocol context id ${protocol.id}.`);
    }
    ids.add(protocol.id);
    for (const field of ["targetRefs", "assetRefs", "marketRefs", "hookRefs"]) {
      for (const ref of Array.isArray(protocol[field]) ? protocol[field] : []) {
        if (!graphSets[field].has(ref)) {
          addConflict(conflicts, local, "PROTOCOL_GRAPH_REF_UNBOUND", `${base}.${field}`, `${ref} is not present in submission.${field.replace("Refs", "s")}.`);
        }
      }
    }
    analyzeReviewRequirements({
      requirements: protocol.reviewChecks,
      basePath: `${base}.reviewChecks`,
      evidenceIndex,
      conflicts,
      unresolved,
      reviewItems,
      evidenceTracker,
      localTracker: local
    });

    const v4Relevant = protocol.protocolId === "uniswap-v4";
    const unresolvedCheckIds = [];
    const conflictCheckIds = [];
    if (v4Relevant) {
      for (const hookRef of Array.isArray(protocol.hookRefs) ? protocol.hookRefs : []) coveredV4Hooks.add(hookRef);
      if (!isObject(protocol.v4)) {
        addUnresolved(unresolved, local, "V4_CONTEXT_UNRESOLVED", `${base}.v4`, "The Uniswap v4 context is missing its protocol invariant review state.");
      } else {
        const callbackUsed = protocolHooks(submission, protocol.hookRefs).some((hook) => (
          Object.values(hook.permissions ?? {}).some((value) => value === true)
        ));
        if (callbackUsed && protocol.v4.poolManagerAddress === null) {
          addUnresolved(unresolved, local, "V4_POOL_MANAGER_UNRESOLVED", `${base}.v4.poolManagerAddress`, "A v4 callback path needs an exact PoolManager address binding.");
        }
        if (protocol.v4.customAccountingUsed === null) {
          addUnresolved(unresolved, local, "V4_CUSTOM_ACCOUNTING_USAGE_UNRESOLVED", `${base}.v4.customAccountingUsed`, "Custom-accounting usage remains unresolved.");
        }
        if (protocol.v4.nativeAmmMode === "none" && protocol.v4.customAccountingUsed === false) {
          addConflict(conflicts, local, "V4_ZERO_AMM_ACCOUNTING_CONFLICT", `${base}.v4`, "A zero-native-AMM v4 path must identify the custom or async accounting mechanism rather than requiring liquidity.");
        }
        for (const checkId of REQUIRED_V4_CHECKS) {
          const check = protocol.v4[checkId];
          if (!isObject(check) || !REVIEW_STATES.has(check.state)) {
            unresolvedCheckIds.push(checkId);
            addUnresolved(unresolved, local, "V4_INVARIANT_STATE_UNRESOLVED", `${base}.v4.${checkId}`, `${checkId} has no valid review state.`);
            continue;
          }
          if (check.state === "conflict") {
            conflictCheckIds.push(checkId);
            addConflict(conflicts, local, "V4_INVARIANT_CONFLICT", `${base}.v4.${checkId}`, `${checkId} is in conflict.`);
          } else if (check.state === "unresolved") {
            unresolvedCheckIds.push(checkId);
            addUnresolved(unresolved, local, "V4_INVARIANT_UNRESOLVED", `${base}.v4.${checkId}`, `${checkId} remains unresolved.`);
          } else if (check.state === "not-applicable") {
            if (checkId === "customAccountingReview" && protocol.v4.customAccountingUsed === true) {
              conflictCheckIds.push(checkId);
              addConflict(conflicts, local, "V4_CUSTOM_ACCOUNTING_REVIEW_REQUIRED", `${base}.v4.${checkId}`, "Custom accounting is used, so its accounting review cannot be marked not applicable.");
            } else {
              reviewItems.add("V4_INVARIANT_APPLICABILITY_REVIEW", `${base}.v4.${checkId}`, `${checkId} is marked not applicable and must be confirmed by independent review.`, sortedUniqueStrings(check.evidenceRefs));
            }
          }
          if (check.state === "satisfied" && (check.evidenceRefs?.length ?? 0) === 0) {
            unresolvedCheckIds.push(checkId);
            addUnresolved(unresolved, local, "V4_INVARIANT_EVIDENCE_UNRESOLVED", `${base}.v4.${checkId}.evidenceRefs`, `${checkId} is declared satisfied without exact evidence.`);
          }
          bindDeclaredEvidence(check.evidenceRefs, `${base}.v4.${checkId}.evidenceRefs`, evidenceIndex, unresolved, evidenceTracker, local);
        }
        if (protocol.v4.nativeAmmMode === "none") {
          reviewItems.add("V4_ZERO_NATIVE_AMM_SUPPORTED", `${base}.v4.nativeAmmMode`, "Zero native AMM liquidity is preserved as a valid v4 custom-accounting design; accounting and settlement evidence still require review.", []);
        }
      }
    }
    results.push({
      id: protocol.id,
      protocolId: protocol.protocolId,
      state: bindingState(local),
      v4Relevant,
      nativeAmmMode: v4Relevant && isObject(protocol.v4) ? protocol.v4.nativeAmmMode ?? null : null,
      customAccountingUsed: v4Relevant && isObject(protocol.v4) ? protocol.v4.customAccountingUsed ?? null : null,
      unresolvedCheckIds: [...new Set(unresolvedCheckIds)].sort(),
      conflictCheckIds: [...new Set(conflictCheckIds)].sort()
    });
  }
  for (const hookId of v4HookIds) {
    if (!coveredV4Hooks.has(hookId)) {
      unresolved.add("V4_HOOK_CONTEXT_UNBOUND", "$.protocolContexts", `Submission hook ${hookId} has v4 permissions but no explicit Uniswap v4 protocol context.`, []);
    }
  }
  return results.sort((left, right) => left.id.localeCompare(right.id));
}
