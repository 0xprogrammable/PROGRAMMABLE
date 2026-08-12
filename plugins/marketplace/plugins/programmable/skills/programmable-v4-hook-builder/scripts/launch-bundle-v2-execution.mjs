import { canonicalJson, validateAgainstSchema } from "./submission-core.mjs";
import {
  FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID,
  validateFeeConformanceCompletionV1
} from "./fee-conformance-receipt-v1-core.mjs";
import {
  FEE_CONFORMANCE_VECTOR_SET_V1_SCHEMA_ID
} from "./fee-conformance-vector-set-v1-core.mjs";
import {
  TRADE_CAPABILITY_MANIFEST_V1_SCHEMA_ID,
  TRADE_EXECUTION_TEST_RESULT_V1_SCHEMA_ID,
  TRADE_QUOTE_TEST_RESULT_V1_SCHEMA_ID,
  tradeCapabilityManifestBytesV1,
  validateTradeCapabilityManifestV1,
  validateTradeResultPairV1,
  validateTradeTestResultV1
} from "./trade-capability-manifest-core.mjs";
import { reviewArtifactForKind } from "./launch-bundle-v2-artifacts.mjs";
import {
  hasExactApplicationPackageReviewBinding,
  registryVerificationDigestProjection
} from "./launch-bundle-v2-registry-projections.mjs";
import {
  addConflict,
  addUnresolved,
  bindDeclaredEvidence,
  bindingState,
  exact,
  executionSurfaceCoverageV1Schema,
  isObject,
  inspectTradeApplicationMirror,
  inspectTradeFeeProjection,
  requireEqual,
  sortedUniqueStrings,
  TRADE_BINDING_KEYS,
  tradeFindingBindingKeys,
  tracker,
  uniqueMap,
  validSlug
} from "./launch-bundle-v2-shared.mjs";

export function analyzeExecutionSurfaceCoverage({
  input,
  application,
  submission,
  feePolicy,
  securityEnvelope,
  executionSurfaceCoverage,
  artifacts,
  sourceSnapshots,
  evidenceIndex,
  conflicts,
  unresolved,
  executionTracker,
  evidenceTracker
}) {
  const coveragePath = "$.artifacts.executionSurfaceCoverage";
  const binding = artifacts.rawRecordsByRole.get("execution-surface-coverage");
  if (!binding || !isObject(executionSurfaceCoverage)) {
    addConflict(conflicts, executionTracker, "EXECUTION_SURFACE_COVERAGE_BINDING_MISSING", coveragePath, "Launch preparation requires one parseable, exact execution-surface coverage artifact.");
    return [];
  }
  if (binding.contentMatched !== true) {
    addConflict(conflicts, executionTracker, "EXECUTION_SURFACE_CONTENT_BINDING_MISMATCH", coveragePath, "Execution-surface path, Git blob, SHA-256, byte length and inline bytes must all describe the same exact file.");
  }

  for (const finding of validateAgainstSchema(executionSurfaceCoverage, executionSurfaceCoverageV1Schema)) {
    addConflict(
      conflicts,
      executionTracker,
      "EXECUTION_SURFACE_COVERAGE_SCHEMA_INVALID",
      `${coveragePath}.content#${String(finding.path ?? "$").slice(1)}`,
      finding.message ?? "Execution-surface coverage does not match its closed v1 contract."
    );
  }
  requireEqual(executionSurfaceCoverage.applicationId, application?.applicationId, "EXECUTION_SURFACE_APPLICATION_ID_MISMATCH", `${coveragePath}.content#/applicationId`, "Execution-surface coverage does not bind the exact Application V3 id.", conflicts, executionTracker);
  requireEqual(executionSurfaceCoverage.applicationRevision, application?.applicationRevision, "EXECUTION_SURFACE_APPLICATION_REVISION_MISMATCH", `${coveragePath}.content#/applicationRevision`, "Execution-surface coverage does not bind the exact Application V3 revision.", conflicts, executionTracker);
  requireEqual(executionSurfaceCoverage.securityAssessmentSha256, artifacts.rawRecordsByRole.get("security")?.sha256, "EXECUTION_SURFACE_SECURITY_DIGEST_MISMATCH", `${coveragePath}.content#/securityAssessmentSha256`, "Execution-surface coverage does not bind the exact derived security assessment.", conflicts, executionTracker);
  if (securityEnvelope?.assessment?.state !== "source-assessed") {
    addUnresolved(unresolved, executionTracker, "EXECUTION_SURFACE_SECURITY_NOT_SOURCE_ASSESSED", `${coveragePath}.content#/securityAssessmentSha256`, "Execution-surface absence and control claims require an exact source-assessed security result.");
  }

  const expectedVerificationProjection = registryVerificationDigestProjection(application?.source?.verificationReports);
  requireEqual(
    executionSurfaceCoverage.sourceVerificationBindingsSha256,
    expectedVerificationProjection.aggregateSha256,
    "EXECUTION_SURFACE_SOURCE_VERIFICATION_DIGEST_MISMATCH",
    `${coveragePath}.content#/sourceVerificationBindingsSha256`,
    "Execution-surface discovery does not bind the exact aggregate of every per-repository verifier association.",
    conflicts,
    executionTracker
  );
  const applicationVerificationReports = Array.isArray(application?.source?.verificationReports)
    ? application.source.verificationReports
    : [];
  if (applicationVerificationReports.length === 0 || applicationVerificationReports.some(({ result }) => result !== "VERIFIED")) {
    addUnresolved(unresolved, executionTracker, "EXECUTION_SURFACE_SOURCE_CLOSURE_UNVERIFIED", `${coveragePath}.content#/sourceVerificationBindingsSha256`, "Every Application V3 source repository must have one exact VERIFIED closure report before execution-surface coverage can match.");
  }

  const applicationBinding = artifacts.rawRecordsByRole.get("application");
  const reviewBinding = reviewArtifactForKind(application, "execution-surface-coverage", artifacts);
  if (
    !reviewBinding
    || reviewBinding.sourceRef !== applicationBinding?.sourceRef
    || reviewBinding.path !== binding.path
    || reviewBinding.sha256 !== binding.sha256
    || reviewBinding.byteLength !== binding.byteLength
  ) {
    addConflict(conflicts, executionTracker, "EXECUTION_SURFACE_APPLICATION_REVIEW_BINDING_MISMATCH", coveragePath, "Execution-surface coverage must resolve exactly once as an application-package review record bound to these exact bytes.");
  }

  const discovery = executionSurfaceCoverage.discovery;
  if (discovery?.state === "UNRESOLVED") {
    addUnresolved(unresolved, executionTracker, "EXECUTION_SURFACE_DISCOVERY_UNRESOLVED", `${coveragePath}.content#/discovery/state`, "Execution entrypoint discovery has not been independently completed; the idea remains reviewable but launch is on hold.");
  } else if (discovery?.state === "CONFLICT") {
    addConflict(conflicts, executionTracker, "EXECUTION_SURFACE_DISCOVERY_CONFLICT", `${coveragePath}.content#/discovery/state`, "Execution entrypoint discovery records a conflict that must be resolved before launch.");
  } else if (discovery?.state !== "VERIFIED") {
    addUnresolved(unresolved, executionTracker, "EXECUTION_SURFACE_DISCOVERY_UNRESOLVED", `${coveragePath}.content#/discovery/state`, "Execution entrypoint discovery has no exact VERIFIED state.");
  }
  if ((discovery?.evidenceRefs?.length ?? 0) === 0) {
    addUnresolved(unresolved, executionTracker, "EXECUTION_SURFACE_DISCOVERY_EVIDENCE_MISSING", `${coveragePath}.content#/discovery/evidenceRefs`, "A discovery declaration without independently bound evidence cannot prove that no route was omitted.");
  }
  bindDeclaredEvidence(discovery?.evidenceRefs, `${coveragePath}.content#/discovery/evidenceRefs`, evidenceIndex, unresolved, evidenceTracker, executionTracker);
  const verifierEvidenceBound = applicationVerificationReports.length > 0 && applicationVerificationReports.every((report) => (
    (discovery?.evidenceRefs ?? []).some((ref) => {
      const evidence = evidenceIndex.get(ref) ?? [...evidenceIndex.values()].find(({ path }) => path === ref);
      return evidence?.path === report.reportPath && evidence?.sha256 === report.reportSha256;
    })
  ));
  if (!verifierEvidenceBound) {
    addUnresolved(unresolved, executionTracker, "EXECUTION_SURFACE_DISCOVERY_VERIFIER_EVIDENCE_MISSING", `${coveragePath}.content#/discovery/evidenceRefs`, "Discovery must cite every exact persisted source-closure verifier report; a coverage declaration alone is insufficient.");
  }

  const surfaces = Array.isArray(executionSurfaceCoverage.surfaces) ? executionSurfaceCoverage.surfaces : [];
  const candidates = sortedUniqueStrings(discovery?.candidateSurfaceIds);
  const declaredIds = sortedUniqueStrings(surfaces.map(({ id }) => id));
  const uncovered = sortedUniqueStrings(executionSurfaceCoverage.uncoveredSurfaceIds);
  if (canonicalJson(candidates) !== canonicalJson(declaredIds) || uncovered.length > 0) {
    addUnresolved(unresolved, executionTracker, "EXECUTION_SURFACE_DISCOVERY_COVERAGE_INCOMPLETE", `${coveragePath}.content#/discovery/candidateSurfaceIds`, "Candidate, declared and explicitly uncovered entrypoint sets are not one complete exact enumeration; launch remains on hold.");
  }

  const sourceMap = new Map((Array.isArray(sourceSnapshots) ? sourceSnapshots : []).map((source) => [source.id, source]));
  const applicationRepositories = new Map([
    application?.source?.primary,
    ...(Array.isArray(application?.source?.companions) ? application.source.companions : [])
  ].filter(isObject).map((repository) => [repository.id, repository]));
  const marketMap = uniqueMap(Array.isArray(submission?.markets) ? submission.markets : [], "id", "EXECUTION_SURFACE_MARKET_ID_DUPLICATE", "$.artifacts.submission.content#/markets", conflicts, executionTracker);
  const policyScopes = Array.isArray(feePolicy?.feeScopes) ? feePolicy.feeScopes : [];
  const submissionScopes = Array.isArray(submission?.programmableFee?.feeScopes) ? submission.programmableFee.feeScopes : [];
  const inputScopes = Array.isArray(input?.feeScopeBindings) ? input.feeScopeBindings : [];
  const seenIds = new Set();
  const seenEntrypoints = new Set();
  const results = [];
  const reachabilityFields = [
    "programmableFactoryReachable",
    "programmableRouterReachable",
    "programmableUiReachable",
    "programmableBackendReachable",
    "programmableHookReachable"
  ];

  for (const [index, surface] of surfaces.entries()) {
    const base = `${coveragePath}.content#/surfaces/${index}`;
    const local = tracker();
    if (!isObject(surface)) continue;
    if (seenIds.has(surface.id)) addConflict(conflicts, local, "EXECUTION_SURFACE_ID_DUPLICATE", `${base}/id`, `Execution surface ${String(surface.id)} is declared more than once.`);
    seenIds.add(surface.id);
    const entrypointIdentity = `${String(surface.sourceRef)}:${String(surface.revisionObjectId)}:${String(surface.path)}`;
    if (seenEntrypoints.has(entrypointIdentity)) addConflict(conflicts, local, "EXECUTION_SURFACE_MULTIPLE_CLASSIFICATION", base, "One source entrypoint is classified more than once.");
    seenEntrypoints.add(entrypointIdentity);

    const market = marketMap.get(surface.marketRef);
    if (!market) {
      addConflict(conflicts, local, "EXECUTION_SURFACE_MARKET_UNBOUND", `${base}/marketRef`, "Execution surface marketRef is absent from the exact submission graph.");
    } else if (market.executionClass !== surface.executionClass) {
      addConflict(conflicts, local, "EXECUTION_SURFACE_CLASSIFICATION_MISMATCH", `${base}/executionClass`, "Execution coverage cannot relabel a submitted route to evade its canonical Fee V2 or external-control requirements.");
    }

    const source = sourceMap.get(surface.sourceRef);
    const applicationRepository = applicationRepositories.get(surface.sourceRef);
    if (!source || !applicationRepository) {
      addConflict(conflicts, local, "EXECUTION_SURFACE_SOURCE_UNBOUND", `${base}/sourceRef`, "Every execution entrypoint must resolve to one exact Application V3 source repository snapshot.");
    } else {
      requireEqual(surface.revisionObjectId, source.revisionObjectId, "EXECUTION_SURFACE_REVISION_MISMATCH", `${base}/revisionObjectId`, "Execution entrypoint revision differs from its exact source snapshot.", conflicts, local);
      requireEqual(surface.treeObjectId, source.treeObjectId, "EXECUTION_SURFACE_TREE_MISMATCH", `${base}/treeObjectId`, "Execution entrypoint tree differs from its exact source snapshot.", conflicts, local);
      if (applicationRepository.sourceClosureMode === "inline" && !applicationRepository.sourcePaths?.includes(surface.path)) {
        addConflict(conflicts, local, "EXECUTION_SURFACE_OUTSIDE_SOURCE_CLOSURE", `${base}/path`, "Execution entrypoint path is absent from the exact inline source closure.");
      }
      if (!["inline", "manifest"].includes(applicationRepository.sourceClosureMode)) {
        addUnresolved(unresolved, local, "EXECUTION_SURFACE_SOURCE_CLOSURE_UNRESOLVED", `${base}/path`, "Execution entrypoint path has no recognized exact source-closure mode.");
      }
    }

    const artifact = evidenceIndex.get(surface.artifactRef);
    if (
      !artifact
      || artifact.sourceRef !== surface.sourceRef
      || artifact.path !== surface.path
      || artifact.sha256 !== surface.artifactSha256
      || artifact.contentMatched !== true
    ) {
      addConflict(conflicts, local, "EXECUTION_SURFACE_ARTIFACT_BINDING_MISMATCH", `${base}/artifactRef`, "Execution entrypoint does not resolve to one exact content-bound implementation artifact.");
    }
    if (!(surface.evidenceRefs ?? []).includes(surface.artifactRef) || (surface.evidenceRefs?.length ?? 0) < 2) {
      addUnresolved(unresolved, local, "EXECUTION_SURFACE_INDEPENDENT_EVIDENCE_MISSING", `${base}/evidenceRefs`, "Each route needs its exact implementation plus independent coverage/control evidence; its own declaration is insufficient.");
    }
    bindDeclaredEvidence(surface.evidenceRefs, `${base}/evidenceRefs`, evidenceIndex, unresolved, evidenceTracker, local);
    const modeIds = (Array.isArray(surface.modes) ? surface.modes : []).map(({ id }) => id);
    if (
      modeIds.length === 0
      || new Set(modeIds).size !== modeIds.length
      || modeIds.some((id, modeIndex) => modeIndex > 0 && String(modeIds[modeIndex - 1]).localeCompare(String(id)) >= 0)
    ) {
      addConflict(conflicts, local, "EXECUTION_SURFACE_MODES_INVALID", `${base}/modes`, "Every exposed execution mode must be declared exactly once in ascending canonical order.");
    }

    if (surface.executionClass === "programmable-canonical") {
      if (surface.feeScopeId === null) {
        addConflict(conflicts, local, "CANONICAL_EXECUTION_SURFACE_FEE_SCOPE_MISSING", `${base}/feeScopeId`, "Every Programmable-controlled execution route must bind exactly one Fee V2 scope.");
      } else {
        const policyMatches = policyScopes.filter(({ id }) => id === surface.feeScopeId && market?.canonicalScopes?.includes(id));
        const submissionMatches = submissionScopes.filter(({ id, marketRef }) => id === surface.feeScopeId && marketRef === surface.marketRef);
        const inputMatches = inputScopes.filter(({ feeScopeId, marketRef }) => feeScopeId === surface.feeScopeId && marketRef === surface.marketRef);
        if (policyMatches.length !== 1 || submissionMatches.length !== 1 || inputMatches.length !== 1) {
          addConflict(conflicts, local, "CANONICAL_EXECUTION_SURFACE_FEE_SCOPE_CARDINALITY_INVALID", `${base}/feeScopeId`, "A Programmable-controlled route must resolve to exactly one matching policy, submission and implementation Fee V2 scope.");
        }
      }
      if (surface.control?.controller !== "programmable" || surface.control?.independentlyVerified !== true) {
        addConflict(conflicts, local, "CANONICAL_EXECUTION_SURFACE_CONTROL_MISMATCH", `${base}/control`, "Canonical execution must be explicitly Programmable-controlled and independently verified.");
      }
      if (
        !reachabilityFields.some((field) => surface.control?.[field] === true)
        || reachabilityFields.some((field) => typeof surface.control?.[field] !== "boolean")
      ) {
        addConflict(conflicts, local, "CANONICAL_EXECUTION_SURFACE_NOT_REACHABLE", `${base}/control`, "A canonical declaration must identify at least one exact reachable Programmable Factory, Router, UI, backend or hook path and resolve every reachability field.");
      }
    } else if (surface.executionClass === "external") {
      const independentlyExternal = surface.feeScopeId === null
        && surface.control?.controller === "independent-third-party"
        && surface.control?.independentlyVerified === true
        && reachabilityFields.every((field) => surface.control?.[field] === false);
      if (!independentlyExternal) {
        addConflict(conflicts, local, "EXTERNAL_EXECUTION_SURFACE_NOT_INDEPENDENT", `${base}/control`, "An external route must be independently third-party controlled, carry no Fee V2 scope and be unreachable through every Programmable Factory, Router, UI, backend and hook path.");
      }
    } else if (surface.executionClass === "non-launchable") {
      if (surface.feeScopeId !== null || reachabilityFields.some((field) => surface.control?.[field] === true)) {
        addConflict(conflicts, local, "NON_LAUNCHABLE_EXECUTION_SURFACE_REACHABLE", `${base}/control`, "A non-launchable route cannot carry a canonical fee scope or remain reachable from a Programmable execution path.");
      }
    } else {
      addUnresolved(unresolved, local, "EXECUTION_SURFACE_CLASSIFICATION_UNRESOLVED", `${base}/executionClass`, "Unknown execution classification keeps launch on hold while preserving idea eligibility.");
    }

    if (
      validSlug(surface.id)
      && validSlug(surface.marketRef)
      && ["programmable-canonical", "external", "non-launchable", "unknown"].includes(surface.executionClass)
      && ["programmable", "independent-third-party", "none", "unknown"].includes(surface.control?.controller)
    ) {
      results.push({
        id: surface.id,
        marketRef: surface.marketRef,
        executionClass: surface.executionClass,
        controller: surface.control.controller,
        feeScopeId: validSlug(surface.feeScopeId) ? surface.feeScopeId : null,
        state: bindingState(local)
      });
    }
    executionTracker.conflicts += local.conflicts;
    executionTracker.unresolved += local.unresolved;
  }

  for (const market of marketMap.values()) {
    if (["programmable-canonical", "external"].includes(market.executionClass) && !surfaces.some(({ marketRef }) => marketRef === market.id)) {
      addUnresolved(unresolved, executionTracker, "EXECUTION_SURFACE_MARKET_COVERAGE_MISSING", `${coveragePath}.content#/surfaces`, `Executable market ${market.id} has no exact enumerated entrypoint.`);
    }
  }
  return results.sort((left, right) => left.id.localeCompare(right.id));
}

export function analyzeLaunchExecutionEvidence(context) {
  return {
    executionSurfaces: analyzeExecutionSurfaceCoverage(context),
    tradeCapabilities: analyzeTradeCapabilities(context)
  };
}

export function analyzeTradeCapabilities({ input, application, submission, feePolicy, artifacts, sourceSnapshots, evidenceIndex, conflicts, unresolved, reviewItems, tradeCapabilityTracker }) {
  const root = "$.artifacts.submission.content#/tradeCapability";
  const projection = submission?.tradeCapability;
  const declarations = Array.isArray(projection?.markets) ? projection.markets : [];
  const manifests = Array.isArray(artifacts?.tradeCapabilityRecords) ? artifacts.tradeCapabilityRecords : [];
  const objects = (value) => [].concat(value ?? []).filter(isObject);
  const evidence = [...evidenceIndex.values()];
  const appRecords = objects(application?.reviewPackage?.records);
  const appSourceRef = artifacts?.rawRecordsByRole?.get("application")?.sourceRef ?? null;
  const sources = new Map(objects(sourceSnapshots).map((source) => [source.id, source]));
  const applicationSourceRefs = new Set(objects(application?.source?.primary).concat(objects(application?.source?.companions)).map(({ id }) => id));
  const markets = new Map(objects(submission?.markets).map((market) => [market.id, market]));
  const used = { manifests: new Set(), origins: new Set(), mirrors: new Set(), reviews: new Set() };
  const refs = new Set();
  const output = [];
  const emit = (local, categories, code, path, message, evidenceRefs = [], pending = false) => {
    const state = Number(pending);
    const field = ["conflicts", "unresolved"][state];
    [addConflict, addUnresolved][state]([conflicts, unresolved][state], tradeCapabilityTracker, code, path, message, evidenceRefs);
    if (local) local[field] += 1;
    for (const key of new Set(categories)) if (key) key[field] += 1;
  };
  if (!isObject(projection)) emit(null, [], "TRADE_CAPABILITY_PROJECTION_MISSING", root, "Launch requires the exact Submission V2 trade-capability projection.");
  else if (!["tradable", "no-market", "unresolved"].includes(projection.applicability)) emit(null, [], "TRADE_CAPABILITY_APPLICABILITY_INVALID", `${root}/applicability`, "Trade applicability is invalid.");
  else if (projection.applicability === "unresolved") emit(null, [], "TRADE_CAPABILITY_UNRESOLVED", `${root}/applicability`, "Trade capability remains unresolved.", [], true);
  if ([projection?.applicability === "tradable", declarations.length === 0].every(Boolean)) emit(null, [], "TRADE_CAPABILITY_MANIFEST_MISSING", `${root}/markets`, "Tradable applicability requires at least one selected manifest.");
  if ([["no-market", "unresolved"].includes(projection?.applicability), declarations.length > 0].every(Boolean)) emit(null, [], "TRADE_CAPABILITY_NONTRADABLE_MANIFEST_FORBIDDEN", `${root}/markets`, "No-market and unresolved applicability require zero route manifests.");

  for (const [index, declaration] of declarations.entries()) {
    const base = `${root}/markets/${index}`;
    const local = tracker();
    const states = Object.fromEntries(TRADE_BINDING_KEYS.map((key) => [key, tracker()]));
    const fail = (keys, code, path, message, evidenceRefs = []) => emit(local, keys.map((key) => states[key]), code, path, message, evidenceRefs);
    const findings = (values, receiptKeys = ["submissionProjection"]) => {
      for (const finding of values) fail(sortedUniqueStrings([...receiptKeys, ...tradeFindingBindingKeys(finding)]), finding.code, `${base}/manifest#${String(finding.path ?? "$").replace(/^\$/, "")}`, finding.message);
    };
    if (!isObject(declaration)) { fail(["submissionProjection"], "TRADE_CAPABILITY_MARKET_INVALID", base, "Selected trade market must be an object."); continue; }
    const matches = manifests.filter((record) => [record.path === declaration.manifest?.path, record.schemaId === declaration.manifest?.schemaId,
      record.sha256 === declaration.manifest?.sha256, record.byteLength === declaration.manifest?.byteLength].every(Boolean));
    if (matches.length !== 1) { fail(["submissionProjection"], "TRADE_CAPABILITY_MANIFEST_CARDINALITY_INVALID", `${base}/manifest`, "Selected market must resolve to one exact source-origin manifest.", matches.map(({ id }) => id)); continue; }
    const [origin] = matches;
    if (used.manifests.has(origin.id)) fail(["submissionProjection"], "TRADE_CAPABILITY_MANIFEST_REUSED", `${base}/manifest`, "One manifest cannot satisfy multiple selected markets.", [origin.id]);
    used.manifests.add(origin.id); refs.add(origin.id);
    if ([origin.schemaId !== TRADE_CAPABILITY_MANIFEST_V1_SCHEMA_ID, origin.contentMatched !== true, origin.mediaType !== "application/json", !isObject(origin.parsed)].some(Boolean)) {
      fail(["submissionProjection"], "TRADE_CAPABILITY_MANIFEST_CONTENT_INVALID", `${base}/manifest`, "Manifest must be exact typed parseable JSON.", [origin.id]); continue;
    }
    const manifest = origin.parsed;
    if (origin.content !== `${tradeCapabilityManifestBytesV1(manifest).toString("utf8")}\n`) fail(["submissionProjection"], "TRADE_CAPABILITY_MANIFEST_NOT_CANONICAL", `${base}/manifest`, "Manifest must be canonical JSON plus one newline.", [origin.id]);
    if (manifest.manifestId !== origin.id) fail(["submissionProjection"], "TRADE_CAPABILITY_MANIFEST_ID_MISMATCH", `${base}/manifest`, "Manifest id must equal its source artifact id.", [origin.id]);
    const manifestFindings = validateTradeCapabilityManifestV1(manifest, { applicationId: submission?.applicationId, marketRef: declaration.marketRef, routeType: declaration.routeType });
    findings(manifestFindings);
    if (manifestFindings.some(({ details }) => details?.schemaCode !== undefined)) continue;
    if ([!applicationSourceRefs.has(origin.sourceRef), origin.sourceRef === appSourceRef, manifest.source?.repositoryUri !== sources.get(origin.sourceRef)?.repositoryUri].some(Boolean)) fail(["submissionProjection"], "TRADE_CAPABILITY_SOURCE_BINDING_MISMATCH", `${base}/manifest`, "Manifest must originate in one exact Application source snapshot, distinct from its Application-package mirror.", [origin.id]);

    const bindMirror = (kind, record, schemaId, keys) => {
      const inspected = inspectTradeApplicationMirror({ kind, origin: record, schemaId, applicationRecords: appRecords, applicationSourceRef: appSourceRef, evidenceRecords: evidence });
      for (const [code, message] of inspected.issues) fail(keys, code, `${base}/manifest`, message, inspected.mirrors.map(({ id }) => id));
      for (const { index: reviewIndex } of inspected.reviews) {
        if (used.reviews.has(reviewIndex)) fail(keys, "TRADE_APPLICATION_REVIEW_RECORD_REUSED", `${base}/manifest`, "Application trade review records must be bijective.");
        used.reviews.add(reviewIndex);
      }
      for (const mirror of inspected.mirrors) {
        if (used.mirrors.has(mirror.id)) fail(keys, "TRADE_APPLICATION_MIRROR_REUSED", `${base}/manifest`, "Application trade mirrors must be bijective.", [mirror.id]);
        used.mirrors.add(mirror.id); refs.add(mirror.id);
      }
    };
    bindMirror("trade-capability-manifest", origin, TRADE_CAPABILITY_MANIFEST_V1_SCHEMA_ID, ["applicationReviewRecord"]);
    const market = markets.get(declaration.marketRef);
    if ([!market, !["programmable-canonical", "external"].includes(market?.executionClass)].some(Boolean)) fail(["route"], "TRADE_CAPABILITY_MARKET_NOT_LAUNCHABLE", `${base}/marketRef`, "Selected trade market must be canonical or independently external.");
    if ([typeof market?.profile?.chainId === "string", manifest.chain?.chainId !== market?.profile?.chainId].every(Boolean)) fail(["chain"], "TRADE_CAPABILITY_CHAIN_ID_MISMATCH", `${base}/manifest#/chain/chainId`, "Manifest and selected market chain IDs differ.", [origin.id]);
    const feeCheck = inspectTradeFeeProjection({ manifest, market, declaration, policyScopes: objects(feePolicy?.feeScopes), submissionScopes: objects(submission?.programmableFee?.feeScopes), inputScopes: objects(input?.feeScopeBindings), evidenceRecords: evidence, receiptSchemaId: FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID });
    for (const [code, message] of feeCheck.issues) fail(["fee"], code, `${base}/manifest#/feeBehavior/programmableFeeV2`, message);
    if (feeCheck.receipt) refs.add(feeCheck.receipt.id);

    const observed = [];
    const receiptIds = { quoteReceipts: [], executionReceipts: [] };
    for (const [testsKey, receiptKey, schemaId, contract] of [["quoteTests", "quoteReceipts", TRADE_QUOTE_TEST_RESULT_V1_SCHEMA_ID, "trade-quote-test-result-v1"], ["executionTests", "executionReceipts", TRADE_EXECUTION_TEST_RESULT_V1_SCHEMA_ID, "trade-execution-test-result-v1"]]) {
      for (const [testIndex, test] of objects(manifest.testEvidence?.[testsKey]).entries()) {
        const testPath = `${base}/manifest#/testEvidence/${testsKey}/${testIndex}`;
        const sourceFiles = evidence.filter((record) => [record.sourceRef === origin.sourceRef, record.path === test.testSourceArtifact?.path].every(Boolean));
        if ([sourceFiles.length !== 1, sourceFiles[0]?.sha256 !== test.testSourceArtifact?.sha256, sourceFiles[0]?.byteLength !== test.testSourceArtifact?.byteLength, sourceFiles[0]?.contentMatched !== true, sourceFiles[0]?.schemaId !== null, sourceFiles[0]?.evidenceType === "trade-test-result", test.testSourceArtifact?.path === test.resultArtifactPath].some(Boolean)) fail([receiptKey], "TRADE_TEST_SOURCE_BINDING_INVALID", `${testPath}/testSourceArtifact`, "Test source must be one exact untyped source artifact, distinct from every reported result.", sourceFiles.map(({ id }) => id));
        else refs.add(sourceFiles[0].id);
        const resultFiles = evidence.filter((record) => [record.sourceRef === origin.sourceRef, record.path === test.resultArtifactPath].every(Boolean));
        if (resultFiles.length !== 1) { fail([receiptKey], "TRADE_TEST_RESULT_CARDINALITY_INVALID", `${testPath}/resultArtifactPath`, "Every declared test requires one distinct source-origin typed result.", resultFiles.map(({ id }) => id)); continue; }
        const [record] = resultFiles;
        if (used.origins.has(record.id)) fail([receiptKey], "TRADE_TEST_RESULT_REUSED", `${testPath}/resultArtifactPath`, "Trade result paths must be bijective.", [record.id]);
        used.origins.add(record.id); refs.add(record.id); receiptIds[receiptKey].push(record.id);
        if ([record.schemaId !== schemaId, record.evidenceType !== "trade-test-result", record.contentMatched !== true,
          record.parsed?.$schema !== schemaId, record.parsed?.contract !== contract, record.content !== `${canonicalJson(record.parsed)}\n`].some(Boolean)) fail([receiptKey], "TRADE_TEST_RESULT_CONTENT_INVALID", `${testPath}/resultArtifactPath`, "Trade result must be exact canonical typed JSON.", [record.id]);
        bindMirror("trade-test-result", record, schemaId, ["applicationReviewRecord", receiptKey]);
        if (!isObject(record.parsed)) continue;
        const resultFindings = validateTradeTestResultV1(record.parsed, { manifest, test });
        findings(resultFindings, [receiptKey]);
        if (resultFindings.some(({ details }) => details?.schemaCode !== undefined)) continue;
        const expectedOutcome = { "swap-succeeds": "swap-succeeded", "reverts-before-effects": "reverted-before-effects" }[test.expectedOutcome];
        if ([testsKey === "executionTests", [record.parsed.scenario !== test.scenario, record.parsed.outcome !== expectedOutcome].some(Boolean)].every(Boolean)) fail([receiptKey, "modes"], "TRADE_TEST_RESULT_OUTCOME_MISMATCH", `${testPath}/resultArtifactPath`, "Execution scenario/outcome differs from its declaration.", [record.id]);
        observed.push({ kind: testsKey, test, result: record.parsed });
      }
    }
    for (const execution of observed.filter(({ kind, test }) => [kind === "executionTests", test.scenario === "successful-swap"].every(Boolean))) {
      const quote = observed.find(({ kind, test }) => [kind === "quoteTests", test.modeRef === execution.test.modeRef].every(Boolean));
      if (!quote) fail(["quoteReceipts", "executionReceipts", "modes"], "TRADE_QUOTE_EXECUTION_PAIR_MISSING", `${base}/manifest#/testEvidence`, "Supported execution mode lacks its quote pair.");
      else findings(validateTradeResultPairV1(quote.result, execution.result, { manifest, quoteTest: quote.test, executionTest: execution.test }), ["quoteReceipts", "executionReceipts"]);
    }
    if ([validSlug(declaration.marketRef), validSlug(manifest.manifestId), validSlug(origin.sourceRef), typeof manifest.chain?.chainId === "string",
      typeof manifest.poolKey?.poolId === "string", ["standard-uniswap-v4", "canonical-programmable-adapter"].includes(manifest.route?.type)].every(Boolean)) {
      output.push({ marketRef: declaration.marketRef, manifestId: manifest.manifestId, sourceRef: origin.sourceRef, path: origin.path, sha256: origin.sha256, chainId: manifest.chain.chainId, poolId: manifest.poolKey.poolId, routeType: manifest.route.type, quoteReceiptRefs: sortedUniqueStrings(receiptIds.quoteReceipts), executionReceiptRefs: sortedUniqueStrings(receiptIds.executionReceipts), bindings: Object.fromEntries(TRADE_BINDING_KEYS.map((key) => [key, bindingState(states[key])])), state: bindingState(local) });
    }
  }
  if ((input?.artifacts?.tradeCapabilities?.length ?? 0) !== manifests.length) emit(null, [], "TRADE_CAPABILITY_ARTIFACT_SET_INVALID", "$.artifacts.tradeCapabilities", "Every direct trade manifest requires a valid content binding.");
  for (const record of manifests) if (!used.manifests.has(record.id)) emit(null, [], "ORPHAN_TRADE_CAPABILITY_MANIFEST", "$.artifacts.tradeCapabilities", `Unselected trade manifest ${record.id} is forbidden.`, [record.id]);
  const typed = evidence.filter((record) => [record.schemaId === TRADE_CAPABILITY_MANIFEST_V1_SCHEMA_ID,
    [TRADE_QUOTE_TEST_RESULT_V1_SCHEMA_ID, TRADE_EXECUTION_TEST_RESULT_V1_SCHEMA_ID].includes(record.schemaId), record.evidenceType === "trade-test-result"].some(Boolean));
  for (const record of typed) if ([!used.origins.has(record.id), !used.mirrors.has(record.id)].every(Boolean)) emit(null, [], "ORPHAN_TRADE_TEST_EVIDENCE", "$.artifacts.evidence", `Trade evidence ${record.id} is not consumed bijectively.`, [record.id]);
  for (const { record, index } of appRecords.map((record, index) => ({ record, index }))) if ([["trade-capability-manifest", "trade-test-result"].includes(record?.kind), !used.reviews.has(index)].every(Boolean)) emit(null, [], "ORPHAN_TRADE_APPLICATION_REVIEW_RECORD", `$.artifacts.application.content#/reviewPackage/records/${index}`, "Application trade record is not consumed bijectively.");
  if (declarations.length > 0) reviewItems.add("TRADE_CAPABILITY_EVIDENCE_NOT_AUTHORIZATION", root, "Trade manifests and local results are review evidence, not approval, deployment proof, live-route proof, or execution authorization.", [...refs]);
  return output.sort((left, right) => left.marketRef.localeCompare(right.marketRef));
}

export function analyzeFeeConformanceReceipts({
  input,
  application,
  submission,
  feePolicy,
  executionSurfaceCoverage,
  artifacts,
  sourceSnapshots,
  evidenceIndex,
  conflicts,
  unresolved,
  reviewItems,
  feeTracker,
  evidenceTracker
}) {
  const basePath = "$.artifacts.submission.content#/programmableFee/conformance";
  const conformance = submission?.programmableFee?.conformance;
  if (!isObject(conformance)) {
    addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_DECLARATION_INVALID", basePath, "Launch preparation requires an explicit fee-conformance declaration.");
    return;
  }

  const evidenceRefs = Array.isArray(conformance.evidenceRefs) ? conformance.evidenceRefs : [];
  bindDeclaredEvidence(evidenceRefs, `${basePath}/evidenceRefs`, evidenceIndex, unresolved, evidenceTracker, feeTracker);
  if (conformance.status !== "complete") {
    if (conformance.status === "required") {
      addUnresolved(unresolved, feeTracker, "FEE_CONFORMANCE_RECEIPT_MISSING", basePath, "Fee conformance remains required; every exact policy scope/profile needs one typed receipt and vector set before launch preparation can match.");
    } else {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_DECLARATION_INVALID", `${basePath}/status`, "Fee conformance status must be required or complete.");
    }
    return;
  }

  reviewItems.add(
    "FEE_CONFORMANCE_RECEIPT_NOT_AUTHORIZATION",
    basePath,
    "Typed fee-conformance receipts are structural source and test evidence only; they are not an audit, deployment receipt, runtime attestation, approval, or admin authorization.",
    evidenceRefs
  );

  const referencedEvidence = evidenceRefs
    .map((ref) => evidenceIndex.get(ref))
    .filter((record) => record !== undefined);
  const receiptBindings = referencedEvidence.filter(({ schemaId }) => schemaId === FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID);
  const vectorBindings = referencedEvidence.filter(({ schemaId }) => schemaId === FEE_CONFORMANCE_VECTOR_SET_V1_SCHEMA_ID);
  const applicationSourceRef = artifacts.rawRecordsByRole.get("application")?.sourceRef ?? null;

  for (const binding of receiptBindings) {
    if (
      binding.contentMatched !== true
      || binding.mediaType !== "application/json"
      || !isObject(binding.parsed)
    ) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_RECEIPT_CONTENT_INVALID", `${basePath}/evidenceRefs`, `Typed receipt ${binding.id} is not one exact parseable canonical JSON content binding.`, [binding.id]);
    }
    if (!hasExactApplicationPackageReviewBinding(application, "fee-conformance-receipt", binding, applicationSourceRef)) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_RECEIPT_APPLICATION_REVIEW_MISMATCH", `${basePath}/evidenceRefs`, `Typed receipt ${binding.id} is not bound exactly once by the accepted Application V3 review package.`, [binding.id]);
    }
  }
  for (const binding of vectorBindings) {
    if (
      binding.contentMatched !== true
      || binding.mediaType !== "application/json"
      || !isObject(binding.parsed)
    ) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_VECTOR_SET_CONTENT_INVALID", `${basePath}/evidenceRefs`, `Typed vector set ${binding.id} is not one exact parseable canonical JSON content binding.`, [binding.id]);
    }
    if (!hasExactApplicationPackageReviewBinding(application, "fee-conformance-vector-set", binding, applicationSourceRef)) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_VECTOR_SET_APPLICATION_REVIEW_MISMATCH", `${basePath}/evidenceRefs`, `Typed vector set ${binding.id} is not bound exactly once by the accepted Application V3 review package.`, [binding.id]);
    }
  }

  const policyScopes = Array.isArray(feePolicy?.feeScopes) ? feePolicy.feeScopes : [];
  const submissionScopes = Array.isArray(submission?.programmableFee?.feeScopes)
    ? submission.programmableFee.feeScopes
    : [];
  const inputScopes = Array.isArray(input?.feeScopeBindings) ? input.feeScopeBindings : [];
  const sourceMap = new Map((Array.isArray(sourceSnapshots) ? sourceSnapshots : []).map((source) => [source.id, source]));
  const executionCoverageBinding = artifacts.rawRecordsByRole.get("execution-surface-coverage");
  const executionSurfaces = Array.isArray(executionSurfaceCoverage?.surfaces)
    ? executionSurfaceCoverage.surfaces
    : [];
  const evidenceDigests = new Map(evidenceRefs.flatMap((ref) => {
    const record = evidenceIndex.get(ref);
    return record ? [[ref, record.sha256]] : [];
  }));
  const usedVectorIds = new Set();

  for (const policyScope of policyScopes) {
    if (!isObject(policyScope) || typeof policyScope.id !== "string") continue;
    const scopePath = `${basePath}/receipts[feeScopeId=${policyScope.id},collectionProfile=${String(policyScope.collectionProfile)}]`;
    const matchingReceipts = receiptBindings.filter((binding) => (
      binding.parsed?.scope?.feeScopeId === policyScope.id
      && binding.parsed?.scope?.collectionProfile === policyScope.collectionProfile
    ));
    if (matchingReceipts.length === 0) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_RECEIPT_MISSING", scopePath, "A complete conformance claim must reference exactly one typed receipt for this exact fee scope and collection profile.");
      continue;
    }
    if (matchingReceipts.length !== 1) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_RECEIPT_CARDINALITY_INVALID", scopePath, "More than one referenced typed receipt claims the same exact fee scope and collection profile.", matchingReceipts.map(({ id }) => id));
      continue;
    }

    const [receiptBinding] = matchingReceipts;
    const receipt = receiptBinding.parsed;
    const exactSubmissionScopes = submissionScopes.filter(({ id }) => id === policyScope.id);
    const exactInputScopes = inputScopes.filter(({ feeScopeId }) => feeScopeId === policyScope.id);
    if (exactSubmissionScopes.length !== 1 || exactInputScopes.length !== 1) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_SCOPE_BINDING_INVALID", scopePath, "Receipt validation requires exactly one submission scope and one implementation binding for the policy scope.", [receiptBinding.id]);
      continue;
    }
    const [submissionScope] = exactSubmissionScopes;
    const [inputScope] = exactInputScopes;

    const implementationCandidates = [...evidenceIndex.values()].filter((record) => (
      record.sourceRef === inputScope.implementationSourceRef
      && record.path === inputScope.implementationRef
    ));
    const implementationSource = sourceMap.get(inputScope.implementationSourceRef);
    if (
      implementationCandidates.length !== 1
      || implementationCandidates[0].contentMatched !== true
      || !implementationSource
    ) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_IMPLEMENTATION_BINDING_INVALID", scopePath, "The receipt implementation must resolve to one exact content-bound artifact at one exact source revision and tree.", [receiptBinding.id]);
      continue;
    }
    const [implementation] = implementationCandidates;

    const surfaceScopeMappings = executionSurfaces
      .filter((surface) => (
        surface?.executionClass === "programmable-canonical"
        && surface?.feeScopeId === policyScope.id
      ))
      .map((surface) => ({
        surfaceId: surface.id,
        marketRef: surface.marketRef,
        feeScopeId: policyScope.id,
        collectionProfile: policyScope.collectionProfile,
        implementationArtifactRef: implementation.id,
        implementationArtifactSha256: implementation.sha256,
        modes: structuredClone(Array.isArray(surface.modes) ? surface.modes : [])
      }))
      .sort((left, right) => String(left.surfaceId).localeCompare(String(right.surfaceId)));
    if (surfaceScopeMappings.length === 0) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_EXECUTION_SURFACE_MISSING", scopePath, "The receipt scope has no exact programmable-canonical execution surface to cover.", [receiptBinding.id]);
    }

    const vectorRef = receipt?.vectorSet?.evidenceRef;
    const vectorBinding = typeof vectorRef === "string" ? evidenceIndex.get(vectorRef) : null;
    if (
      !vectorBinding
      || vectorBinding.schemaId !== FEE_CONFORMANCE_VECTOR_SET_V1_SCHEMA_ID
      || vectorBinding.contentMatched !== true
      || vectorBinding.mediaType !== "application/json"
      || !isObject(vectorBinding.parsed)
    ) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_VECTOR_SET_BINDING_INVALID", scopePath, "The typed receipt does not resolve to exact canonical bytes for its typed vector set.", [receiptBinding.id]);
      continue;
    }
    usedVectorIds.add(vectorBinding.id);
    if (!hasExactApplicationPackageReviewBinding(application, "fee-conformance-vector-set", vectorBinding, applicationSourceRef)) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_VECTOR_SET_APPLICATION_REVIEW_MISMATCH", scopePath, "The receipt vector set is not bound exactly once by the accepted Application V3 review package.", [receiptBinding.id, vectorBinding.id]);
    }

    const expected = {
      applicationId: application?.applicationId,
      feeScope: {
        id: policyScope.id,
        feeScopeId: policyScope.id,
        marketRef: submissionScope.marketRef,
        chainId: policyScope.chainId,
        poolId: policyScope.poolId,
        quoteCurrency: policyScope.quoteCurrency,
        collectionProfile: policyScope.collectionProfile
      },
      collectionProfile: policyScope.collectionProfile,
      implementation: {
        artifactRef: implementation.id,
        artifactSha256: implementation.sha256,
        sourceRef: implementation.sourceRef,
        revisionObjectId: implementationSource.revisionObjectId,
        treeObjectId: implementationSource.treeObjectId,
        path: implementation.path
      },
      executionSurfaceCoverageSha256: executionCoverageBinding?.sha256,
      surfaceScopeMappings,
      vectorSetSha256: vectorBinding.sha256
    };
    const errors = validateFeeConformanceCompletionV1({
      conformance,
      receipt,
      receiptEvidenceRef: receiptBinding.id,
      vectorSet: vectorBinding.parsed,
      vectorSetBytes: Buffer.from(vectorBinding.content, "utf8"),
      evidenceDigests,
      expected
    });
    for (const error of errors) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_RECEIPT_INVALID", scopePath, error, [receiptBinding.id, vectorBinding.id]);
    }
  }

  for (const binding of receiptBindings) {
    const matchesPolicyScope = policyScopes.some((scope) => (
      scope?.id === binding.parsed?.scope?.feeScopeId
      && scope?.collectionProfile === binding.parsed?.scope?.collectionProfile
    ));
    if (!matchesPolicyScope) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_RECEIPT_SCOPE_UNKNOWN", `${basePath}/evidenceRefs`, `Typed receipt ${binding.id} does not map to an exact policy scope/profile.`, [binding.id]);
    }
  }
  for (const binding of vectorBindings) {
    if (!usedVectorIds.has(binding.id)) {
      addConflict(conflicts, feeTracker, "FEE_CONFORMANCE_VECTOR_SET_UNUSED", `${basePath}/evidenceRefs`, `Referenced typed vector set ${binding.id} is not the exact vector set of one validated scope receipt.`, [binding.id]);
    }
  }
}
