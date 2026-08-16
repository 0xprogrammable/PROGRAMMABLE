import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJsonSha256V2 } from "./canonical-json-core.mjs";
import {
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS,
  OPEN_WORLD_V2_SUBMISSION_FILE,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
  validateOpenWorldPackage
} from "./open-world-v2-core.mjs";
import {
  inspectProjectTradeCapability,
  projectArtifactSha256,
  validateArchitectureCandidates,
  validateProductGraph,
  validateProjectSpec
} from "./project-contracts-core.mjs";
import { validateRepositoryPlan } from "./repository-completion-core.mjs";
import { projectStatePayloadSha256, validateProjectState } from "./project-state-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { validateTradeCapabilityManifestV1 } from "./trade-capability-manifest-core.mjs";
export const PROJECT_COMPILER_VERSION = "1.0.0";

const phaseOrder = Object.freeze(["project-spec", "product-graphs", "architecture-selection", "repository-materialization", "verification", "submission-evidence"]);
const severityOrder = Object.freeze({ blocker: 0, review: 1, advisory: 2 });

/**
 * Compile one phase-bounded project bundle into a deterministic validation
 * report. This function never runs repository commands, grants approval, or
 * performs a network or external action. Static validation cannot authenticate
 * an unsigned deterministic receipt's issuer or prove functional completion;
 * both remain outside this report.
 */
export function compileProjectBundle(bundle, options = {}) {
  const {
    projectSpec,
    productGraph,
    architectureCandidates,
    repositoryPlan,
    projectState,
    previousState = null
  } = bundle ?? {};
  const phaseIndex = phaseOrder.indexOf(projectState?.phase);
  const findings = [];

  findings.push(...validateProjectSpec(projectSpec));
  if (phaseIndex >= 1 || productGraph !== undefined) findings.push(...validateProductGraph(projectSpec, productGraph));
  if (phaseIndex >= 2 || architectureCandidates !== undefined) findings.push(...validateArchitectureCandidates(projectSpec, productGraph, architectureCandidates));
  if (phaseIndex >= 3 || repositoryPlan !== undefined) {
    findings.push(...validateRepositoryPlan(projectSpec, productGraph, architectureCandidates, repositoryPlan, {
      repositoryRoot: options.repositoryRoot,
      verifyRepositoryFiles: options.verifyRepositoryFiles === true
    }));
  }
  findings.push(...validateProjectState(projectSpec, productGraph, architectureCandidates, repositoryPlan, projectState, { previousState }));

  const stableFindings = deduplicateAndSort(findings);
  const blockers = stableFindings.filter(({ severity }) => severity === "blocker");
  const reviews = stableFindings.filter(({ severity }) => severity === "review");
  const artifactHashes = Object.fromEntries(Object.entries({
    projectSpec,
    productGraph,
    architectureCandidates,
    repositoryPlan,
    projectState
  }).filter(([, value]) => value !== undefined && value !== null).map(([name, value]) => [name, name === "projectState" ? projectState.integrity?.stateSha256 ?? null : projectArtifactSha256(value)]));

  const receiptContentMatched = repositoryPlan?.completionStatus === "COMPLETE"
    && phaseIndex >= phaseOrder.indexOf("verification")
    && blockers.length === 0;
  const phaseDisposition = blockers.length > 0
    ? "BLOCKED"
    : reviews.length > 0
      ? "INDEPENDENT_REVIEW_REQUIRED"
      : projectState?.status === "locally-complete"
        ? "PHASE_LOCALLY_COMPLETE"
        : "PHASE_VALID_IN_PROGRESS";

  const reportPayload = {
    schemaVersion: "1.0.0",
    compilerVersion: PROJECT_COMPILER_VERSION,
    status: blockers.length === 0 ? "PROJECT_COMPILATION_VALID" : "PROJECT_COMPILATION_INVALID",
    phase: projectState?.phase ?? null,
    phaseDisposition,
    repositoryCompletion: "NOT_PROVEN",
    commandExecutionEvidence: receiptContentMatched ? "UNTRUSTED_DETERMINISTIC_RECEIPT_CONTENT_MATCH" : "NOT_PROVEN",
    artifactHashes,
    findingCounts: {
      blocker: blockers.length,
      review: reviews.length,
      advisory: stableFindings.filter(({ severity }) => severity === "advisory").length
    },
    findings: stableFindings,
    evidenceBoundary: {
      scope: "local-project-compilation", commandsExecuted: false, commandsReexecuted: false, receiptIssuerAuthenticated: false,
      repositoryFilesVerified: options.verifyRepositoryFiles === true, networkAccessed: false, externalActionsPerformed: [],
      approvalCreated: false, auditClaimed: false, deploymentClaimed: false, productionClaimed: false
    }
  };
  return {
    ...reportPayload,
    reportSha256: canonicalJsonSha256V2(reportPayload)
  };
}

function deduplicateAndSort(findings) {
  const unique = new Map();
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.code}:${finding.path}:${JSON.stringify(finding.details ?? {})}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  return [...unique.values()].sort((left, right) => (
    severityOrder[left.severity] - severityOrder[right.severity]
    || left.code.localeCompare(right.code)
    || left.path.localeCompare(right.path)
  ));
}

export const PROJECT_OUTPUT_VALIDATOR_VERSION = "1.0.0";

const routeTypes = new Set(["standard-uniswap-v4", "canonical-programmable-adapter"]);

/**
 * Validate the complete, agent-facing project output as one closed artifact
 * system. This gate only inspects exact local bytes. It cannot approve, audit,
 * deploy, publish, or authenticate the issuer of deterministic local evidence.
 */
export function validateProjectOutput({
  repositoryRoot,
  submissionRoot,
  projectSpec,
  productGraph,
  architectureCandidates,
  repositoryPlan,
  projectState,
  previousState = null
} = {}) {
  const findings = [];
  const add = (severity, code, findingPath, message, details = undefined) => findings.push({
    severity,
    code,
    path: findingPath,
    message,
    ...(details === undefined ? {} : { details })
  });
  const compilation = compileProjectBundle({
    projectSpec,
    productGraph,
    architectureCandidates,
    repositoryPlan,
    projectState,
    previousState
  }, { repositoryRoot, verifyRepositoryFiles: true });
  for (const finding of compilation.findings) findings.push({ ...finding, path: `$.project${finding.path.slice(1)}` });
  if (compilation.status !== "PROJECT_COMPILATION_VALID") {
    add("blocker", "PROJECT_OUTPUT_COMPILATION_INVALID", "$.project", "The bound ProjectSpec, ProductGraph, ArchitectureCandidates, RepositoryPlan, or ProjectState is invalid.");
  }

  const requiredArtifacts = { projectSpec, productGraph, architectureCandidates, repositoryPlan, projectState };
  for (const [name, value] of Object.entries(requiredArtifacts)) {
    if ([undefined, null].includes(value)) add("blocker", "PROJECT_OUTPUT_ARTIFACT_MISSING", `$.project.${name}`, "Every agent-facing project output artifact is required.", { artifact: name });
  }

  let submissionReport = null;
  let submission = null;
  let submissionInventory = null;
  try {
    submissionReport = validateOpenWorldPackage({ packageRoot: submissionRoot });
    submission = readJsonInside(submissionRoot, OPEN_WORLD_V2_SUBMISSION_FILE);
    submissionInventory = inspectSubmissionPackage(submissionRoot, submission);
    for (const orphanPath of submissionInventory.orphanPaths) {
      add("blocker", "PROJECT_OUTPUT_SUBMISSION_ORPHAN_FILE", "$.submission", "The canonical output package contains an unbound adjacent file.", { path: orphanPath });
    }
    if (submissionReport.valid !== true) {
      add("blocker", "PROJECT_OUTPUT_SUBMISSION_INVALID", "$.submission", "The exact Open World submission package failed its bundled schema and semantic validators.", {
        status: submissionReport.status ?? "INVALID",
        blockerCodes: uniqueSorted((submissionReport.findings ?? []).filter(({ severity }) => severity === "blocker").map(({ code }) => code))
      });
    }
  } catch (error) {
    add("blocker", "PROJECT_OUTPUT_SUBMISSION_UNREADABLE", "$.submission", "The exact Open World submission package could not be read and validated.", {
      code: typeof error?.code === "string" ? error.code : "SUBMISSION_PACKAGE_ERROR"
    });
  }

  const projection = inspectProjectTradeCapability(projectSpec, productGraph, architectureCandidates);
  if (submission !== null) validateIdentityAndTradeProjection({
    repositoryRoot,
    submissionRoot,
    projectSpec,
    repositoryPlan,
    projectState,
    submission,
    projection,
    add
  });

  const stableFindings = deduplicateAndSort(findings);
  const blockers = stableFindings.filter(({ severity }) => severity === "blocker");
  const draftUnresolved = blockers.length === 0 && (
    projection.applicability === "unresolved" || submission?.stage === "proposal"
  );
  const reportPayload = {
    schemaVersion: "1.0.0",
    validatorVersion: PROJECT_OUTPUT_VALIDATOR_VERSION,
    status: blockers.length > 0
      ? "PROJECT_OUTPUT_INVALID"
      : draftUnresolved
        ? "PROJECT_OUTPUT_DRAFT_UNRESOLVED"
        : "PROJECT_OUTPUT_VALID",
    projectCompilationStatus: compilation.status,
    submissionPackageStatus: submissionReport?.status ?? "INVALID",
    artifactHashes: {
      ...compilation.artifactHashes,
      submissionPackageInventory: submissionInventory?.inventorySha256 ?? null
    },
    submissionPackageInventory: submissionInventory === null ? null : {
      fileCount: submissionInventory.files.length,
      totalByteLength: submissionInventory.totalByteLength,
      files: submissionInventory.files
    },
    projection: {
      applicationId: projectSpec?.applicationId ?? null,
      tradeFacetEntryRef: projection.tradeEntryId,
      applicability: projection.applicability,
      markets: [...projection.marketRefs]
    },
    findingCounts: {
      blocker: blockers.length,
      review: stableFindings.filter(({ severity }) => severity === "review").length,
      advisory: stableFindings.filter(({ severity }) => severity === "advisory").length
    },
    findings: stableFindings,
    evidenceBoundary: {
      scope: "deterministic-local-project-output-validation",
      repositoryFilesVerified: true,
      submissionPackageBytesVerified: submissionReport?.valid === true,
      commandsReexecuted: false,
      receiptIssuerAuthenticated: false,
      networkAccessed: false,
      externalActionsPerformed: [],
      approvalCreated: false,
      auditClaimed: false,
      deploymentClaimed: false,
      productionClaimed: false
    }
  };
  return { ...reportPayload, reportSha256: canonicalJsonSha256V2(reportPayload) };
}

function validateIdentityAndTradeProjection({
  repositoryRoot,
  submissionRoot,
  projectSpec,
  repositoryPlan,
  projectState,
  submission,
  projection,
  add
}) {
  bindEqual(projectSpec?.applicationId, submission.applicationId, "$.submission.applicationId", "PROJECT_OUTPUT_APPLICATION_ID_MISMATCH", "Submission applicationId differs from ProjectSpec.", add);
  bindEqual(projection.tradeEntryId, submission.tradeCapability?.facetEntryRef, "$.submission.tradeCapability.facetEntryRef", "PROJECT_OUTPUT_TRADE_FACET_MISMATCH", "Submission trade facet differs from the canonical ProjectSpec routing facet.", add);
  bindEqual(projection.applicability, repositoryPlan?.tradeCapability?.applicability, "$.project.repositoryPlan.tradeCapability.applicability", "PROJECT_OUTPUT_TRADE_APPLICABILITY_MISMATCH", "RepositoryPlan trade applicability differs from the Project projection.", add);
  bindEqual(projection.applicability, submission.tradeCapability?.applicability, "$.submission.tradeCapability.applicability", "PROJECT_OUTPUT_TRADE_APPLICABILITY_MISMATCH", "Submission trade applicability differs from the Project projection.", add);

  const planMarkets = Array.isArray(repositoryPlan?.tradeCapability?.markets) ? repositoryPlan.tradeCapability.markets : [];
  const submissionMarkets = Array.isArray(submission.tradeCapability?.markets) ? submission.tradeCapability.markets : [];
  const expectedRefs = [...projection.marketRefs];
  compareSet(expectedRefs, planMarkets.map(({ marketSystemRef }) => marketSystemRef), "$.project.repositoryPlan.tradeCapability.markets", "PROJECT_OUTPUT_PLAN_MARKET_BIJECTION_INVALID", add);
  compareSet(expectedRefs, submissionMarkets.map(({ marketRef }) => marketRef), "$.submission.tradeCapability.markets", "PROJECT_OUTPUT_SUBMISSION_MARKET_BIJECTION_INVALID", add);

  const tradeCommands = (repositoryPlan?.commands ?? []).filter(({ kind }) => ["quote-test", "execution-test"].includes(kind));
  const artifacts = Object.values(repositoryPlan?.artifacts ?? {}).flat();
  const manifests = artifacts.filter(({ kind }) => kind === "trade-capability-manifest");
  const results = artifacts.filter(({ kind }) => kind === "trade-test-result");
  if (["no-market", "unresolved"].includes(projection.applicability)) {
    if (planMarkets.length + submissionMarkets.length + tradeCommands.length + manifests.length + results.length !== 0) {
      add("blocker", "PROJECT_OUTPUT_NONTRADABLE_EVIDENCE_FORBIDDEN", "$.tradeCapability", "No-market and unresolved outputs must contain zero routes, manifests, trade commands, and trade results.", {
        planMarkets: planMarkets.length,
        submissionMarkets: submissionMarkets.length,
        manifests: manifests.length,
        tradeCommands: tradeCommands.length,
        tradeResults: results.length
      });
    }
    if (projection.applicability === "unresolved" && repositoryPlan?.completionStatus === "COMPLETE") {
      add("blocker", "PROJECT_OUTPUT_UNRESOLVED_COMPLETE_FORBIDDEN", "$.project.repositoryPlan.completionStatus", "An unresolved trade projection must never claim COMPLETE.");
    }
    return;
  }

  if (projection.applicability !== "tradable") {
    add("blocker", "PROJECT_OUTPUT_TRADE_PROJECTION_INVALID", "$.tradeCapability", "Trade applicability must resolve to tradable, no-market, or unresolved.");
    return;
  }
  if (expectedRefs.length === 0) add("blocker", "PROJECT_OUTPUT_TRADABLE_MARKETS_REQUIRED", "$.tradeCapability", "A tradable output requires at least one selected market.");
  if (repositoryPlan?.completionStatus !== "COMPLETE") add("blocker", "PROJECT_OUTPUT_TRADABLE_COMPLETE_REQUIRED", "$.project.repositoryPlan.completionStatus", "Tradable output requires a COMPLETE RepositoryPlan with exact local command evidence.");
  if (!isVerificationPhase(projectState?.phase)) add("blocker", "PROJECT_OUTPUT_TRADABLE_VERIFICATION_PHASE_REQUIRED", "$.project.projectState.phase", "Tradable output requires a verification or submission-evidence ProjectState.");

  const planByMarket = uniqueMap(planMarkets, "marketSystemRef");
  const submissionByMarket = uniqueMap(submissionMarkets, "marketRef");
  const artifactsById = uniqueMap(artifacts, "id");
  for (const marketRef of expectedRefs) {
    const planned = planByMarket.get(marketRef);
    const declared = submissionByMarket.get(marketRef);
    if (!planned || !declared) continue;
    const base = `$.tradeCapability.markets.${marketRef}`;
    if (!routeTypes.has(planned.routeType) || planned.routeType !== declared.routeType) {
      add("blocker", "PROJECT_OUTPUT_ROUTE_TYPE_MISMATCH", `${base}.routeType`, "Project, RepositoryPlan, and Submission must bind the same canonical route type.", { planned: planned.routeType ?? null, submitted: declared.routeType ?? null });
    }
    if ((planned.quoteCommandIds?.length ?? 0) === 0 || (planned.executionCommandIds?.length ?? 0) === 0) {
      add("blocker", "PROJECT_OUTPUT_TRADE_COMMANDS_REQUIRED", base, "Every tradable market requires real quote and execution command evidence.");
    }
    const artifact = artifactsById.get(planned.manifestArtifactId);
    if (!artifact) {
      add("blocker", "PROJECT_OUTPUT_MANIFEST_ARTIFACT_MISSING", `${base}.manifest`, "RepositoryPlan manifest artifact is missing.");
      continue;
    }
    if (artifact.kind !== "trade-capability-manifest" || artifact.status !== "verified") {
      add("blocker", "PROJECT_OUTPUT_MANIFEST_ARTIFACT_INVALID", `${base}.manifest`, "RepositoryPlan manifest artifact must be a verified trade-capability manifest.", { artifactId: artifact.id, kind: artifact.kind, status: artifact.status });
    }
    compareManifestBytes({ repositoryRoot, submissionRoot, artifact, binding: declared.manifest, marketRef, findingPath: `${base}.manifest`, add });
  }
}

function compareManifestBytes({ repositoryRoot, submissionRoot, artifact, binding, marketRef, findingPath, add }) {
  try {
    const repositoryBytes = readBytesInside(repositoryRoot, artifact.path);
    const submissionBytes = readBytesInside(submissionRoot, binding?.path);
    const repositorySha256 = sha256(repositoryBytes);
    const submissionSha256 = sha256(submissionBytes);
    if (
      !repositoryBytes.equals(submissionBytes)
      || artifact.sha256 !== repositorySha256
      || artifact.byteLength !== repositoryBytes.length
      || binding?.sha256 !== submissionSha256
      || binding?.byteLength !== submissionBytes.length
    ) {
      add("blocker", "PROJECT_OUTPUT_MANIFEST_BYTES_MISMATCH", findingPath, "RepositoryPlan and Submission must bind byte-identical canonical trade manifests.", {
        marketRef,
        repositorySha256,
        submissionSha256,
        repositoryByteLength: repositoryBytes.length,
        submissionByteLength: submissionBytes.length
      });
    }
  } catch (error) {
    add("blocker", "PROJECT_OUTPUT_MANIFEST_UNREADABLE", findingPath, "Bound trade manifest bytes could not be read inside their declared roots.", { marketRef, code: typeof error?.code === "string" ? error.code : "MANIFEST_READ_ERROR" });
  }
}

function readJsonInside(root, relativePath) {
  return parseBoundedStrictJsonBytes(readBytesInside(root, relativePath));
}

function inspectSubmissionPackage(root, submission) {
  const files = walkBoundedPackage(root), filesByPath = new Map(files.map((file) => [file.path, file]));
  const expected = new Set([
    OPEN_WORLD_V2_SUBMISSION_FILE,
    ...Object.values(OPEN_WORLD_V2_ARTIFACTS).map(({ file }) => file),
    ...Object.values(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS)
      .filter(({ file }) => file !== OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessment.file || submission.supportingPackage?.securityAssessment !== null)
      .map(({ file }) => file)
  ]);
  if (submission.supportingPackage?.feePolicy !== null && submission.supportingPackage?.feePolicy !== undefined) {
    expected.add(OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS.feePolicy.file);
  }
  collectBoundPaths(submission, expected, new Set(), filesByPath);
  for (const market of submission.tradeCapability?.markets ?? []) {
    const manifestPath = market?.manifest?.path;
    if (typeof manifestPath !== "string") continue;
    const manifest = readJsonInside(root, manifestPath);
    for (const key of ["quoteTests", "executionTests"]) {
      for (const declaration of manifest.testEvidence?.[key] ?? []) {
        if (typeof declaration?.resultArtifactPath === "string") expected.add(declaration.resultArtifactPath);
      }
    }
  }
  const actualPaths = new Set(files.map(({ path: filePath }) => filePath));
  const missingPaths = [...expected].filter((filePath) => !actualPaths.has(filePath)).sort();
  if (missingPaths.length > 0) throw Object.assign(new Error("bound submission package files are missing"), { code: "SUBMISSION_BOUND_FILE_MISSING" });
  const orphanPaths = files.map(({ path: filePath }) => filePath).filter((filePath) => !expected.has(filePath));
  return {
    files,
    totalByteLength: files.reduce((total, file) => total + file.byteLength, 0),
    orphanPaths,
    inventorySha256: canonicalJsonSha256V2(files)
  };
}

function collectBoundPaths(value, output, seen = new Set(), filesByPath = null) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (
    typeof value.path === "string"
    && typeof value.sha256 === "string"
    && Number.isInteger(value.byteLength)
  ) { const observed = { sha256: value.sha256, byteLength: value.byteLength, ...filesByPath?.get(value.path) }; if (`${observed.sha256}:${observed.byteLength}` !== `${value.sha256}:${value.byteLength}`) throw Object.assign(new Error("bound submission package file identity differs"), { code: "SUBMISSION_BOUND_FILE_IDENTITY_MISMATCH" }); output.add(value.path); }
  for (const nested of Array.isArray(value) ? value : Object.values(value)) collectBoundPaths(nested, output, seen, filesByPath);
}

function walkBoundedPackage(root) {
  const realRoot = fs.realpathSync(root);
  const files = [];
  const pending = [realRoot];
  let totalByteLength = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory).sort().reverse()) {
      const candidate = path.join(directory, name);
      const stat = fs.lstatSync(candidate);
      const relativePath = path.relative(realRoot, candidate).split(path.sep).join("/");
      if (stat.isSymbolicLink()) throw Object.assign(new Error("submission package symlinks are forbidden"), { code: "SUBMISSION_PACKAGE_SYMLINK_FORBIDDEN" });
      if (stat.isDirectory()) {
        pending.push(candidate);
        continue;
      }
      if (!stat.isFile()) throw Object.assign(new Error("submission package entries must be regular files"), { code: "SUBMISSION_PACKAGE_ENTRY_INVALID" });
      if (files.length >= 512) throw Object.assign(new Error("submission package file limit exceeded"), { code: "SUBMISSION_PACKAGE_FILE_LIMIT" });
      totalByteLength += stat.size;
      if (stat.size > 1_000_000 || totalByteLength > 12_000_000) throw Object.assign(new Error("submission package byte limit exceeded"), { code: "SUBMISSION_PACKAGE_BYTE_LIMIT" });
      const bytes = fs.readFileSync(candidate);
      files.push({ path: relativePath, sha256: sha256(bytes), byteLength: bytes.length });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function readBytesInside(root, relativePath) {
  if (typeof root !== "string" || root.length === 0) throw Object.assign(new Error("root required"), { code: "ROOT_REQUIRED" });
  if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)) throw Object.assign(new Error("unsafe path"), { code: "PATH_INVALID" });
  const realRoot = fs.realpathSync(root);
  const resolved = path.resolve(realRoot, relativePath);
  if (!inside(realRoot, resolved)) throw Object.assign(new Error("path escapes root"), { code: "PATH_ESCAPE" });
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error("regular file required"), { code: "FILE_INVALID" });
  const real = fs.realpathSync(resolved);
  if (!inside(realRoot, real)) throw Object.assign(new Error("file resolves outside root"), { code: "PATH_ESCAPE" });
  return fs.readFileSync(real);
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function bindEqual(expected, observed, findingPath, code, message, add) {
  if (expected !== observed) add("blocker", code, findingPath, message, { expected: expected ?? null, observed: observed ?? null });
}

function compareSet(expectedValues, observedValues, findingPath, code, add) {
  const expected = uniqueSorted(expectedValues);
  const observed = uniqueSorted(observedValues);
  const duplicates = observedValues.length !== observed.length;
  if (duplicates || JSON.stringify(expected) !== JSON.stringify(observed)) add("blocker", code, findingPath, "Trade markets must form an exact, duplicate-free bijection.", { expected, observed, duplicates });
}

function uniqueMap(values, key) {
  return new Map(values.map((value) => [value?.[key], value]));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)));
}

function isVerificationPhase(phase) {
  return ["verification", "submission-evidence"].includes(phase);
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export const PROJECT_PREFLIGHT_VERSION = "1.0.0";

const machineArtifactNames = new Map([
  ["trade-capability.v1.json", "trade-capability-manifest-v1"], ["trade-capability.json", "trade-capability-manifest-v1"],
  ["submission.v2.json", "submission-v2"], ["project-spec.v1.json", "project-spec-v1"], ["product-graph.v1.json", "product-graph-v1"],
  ["architecture-candidates.v1.json", "architecture-candidates-v1"], ["repository-plan.v1.json", "repository-plan-v1"], ["project-state.v1.json", "project-state-v1"]
]);
const machineArtifactContractIds = new Map([
  ["urn:programmable:trade-capability-manifest:1.0.0", "trade-capability-manifest-v1"], ["trade-capability-manifest-v1", "trade-capability-manifest-v1"], ["urn:programmable:v4-hook-submission:2.0.0", "submission-v2"]
]);
const machineArtifactPathClaims = [
  ["trade-capability-manifest-v1", /(?:^|\/)trade-capabilities\/[^/]+\.v1\.json$/u], ["trade-capability-manifest-v1", /\.trade-capability\.v1\.json$/u],
  ["project-state-v1", /(?:^|\/)project-states\/\d{6}-[^/]+\.v1\.json$/u]
];
const machineArtifactStructures = [
  ["trade-capability-manifest-v1", ["status", "classification", "market", "quote", "execution", "permit2", "hookData", "modes", "limits", "fee", "claims"]],
  ["submission-v2", ["standardVersion", "tradeCapability", "intentPackage"]], ["project-spec-v1", ["intent", "facets", "applicationId"]],
  ["product-graph-v1", ["graphs", "projectSpecSha256", "applicationId"]], ["architecture-candidates-v1", ["candidates", "selection", "productGraphSha256"]],
  ["repository-plan-v1", ["repository", "artifacts", "commands", "completionStatus"]],
  ["project-state-v1", ["integrity", "phase", "next", "artifacts"]]
];
const machineArtifactSchemaValidators = new Map([
  ["trade-capability-manifest-v1", (value) => validateTradeCapabilityManifestV1(value)], ["project-spec-v1", (value) => validateProjectSpec(value)],
  ["product-graph-v1", (value) => validateProductGraph(undefined, value)], ["architecture-candidates-v1", (value) => validateArchitectureCandidates(undefined, undefined, value)],
  ["repository-plan-v1", (value) => validateRepositoryPlan(undefined, undefined, undefined, value)],
  ["project-state-v1", (value) => validateProjectState(undefined, undefined, undefined, undefined, value)]
]);
const singletonClaimRoles = [
  ["projectSpec", "project-spec-v1"], ["productGraph", "product-graph-v1"],
  ["architectureCandidates", "architecture-candidates-v1"], ["repositoryPlan", "repository-plan-v1"]
];
const claimHashReaders = new Map([
  ["canonical", (claim) => projectArtifactSha256(claim.value)], ["state", (claim) => claim.value?.integrity?.stateSha256], ["raw", (claim) => claim.sha256]
]);
/** Inventory known Builder machine-contract claims before an agent presents
 * repository output. Arbitrary JSON is ignored; recognized claims are never
 * canonical unless bound by one PROJECT_OUTPUT_VALID system. */
export function preflightProjectOutput({ repositoryRoot, statePath = null, previousStatePath = null, submissionRoot = null, boundPaths: callerBoundPaths = [], outputReport: callerReport = null } = {}) {
  const findings = [];
  const add = (severity, code, findingPath, message, details = undefined) => findings.push({
    severity, code, path: findingPath, message, ...(details === undefined ? {} : { details })
  });
  let claims = [];
  try {
    claims = collectMachineArtifactClaims(repositoryRoot);
  } catch (error) {
    add("blocker", "PROJECT_PREFLIGHT_INVENTORY_FAILED", "$", "Repository machine-artifact inventory failed closed.", {
      code: typeof error?.code === "string" ? error.code : "INVENTORY_ERROR"
    });
  }
  if (callerReport !== null || callerBoundPaths.length > 0) {
    add("blocker", "PROJECT_PREFLIGHT_CALLER_BINDING_FORBIDDEN", "$.output", "Caller-supplied reports and path bindings cannot create canonical output authority.");
  }
  let outputReport = null;
  let expectedClaims = [];
  if ([statePath, previousStatePath, submissionRoot].some((value) => value !== null)) {
    try {
      ({ outputReport, expectedClaims } = loadProjectOutputContext({ repositoryRoot, statePath, previousStatePath, submissionRoot, claims }));
    } catch (error) {
      add("blocker", "PROJECT_PREFLIGHT_OUTPUT_SYSTEM_UNREADABLE", "$.output", "The repository-bound project output system could not be loaded and recomputed.", {
        code: typeof error?.code === "string" ? error.code : "OUTPUT_SYSTEM_READ_ERROR"
      });
    }
  }
  const expectedByPath = new Map(expectedClaims.map((claim) => [normalizeClaimPath(claim.path), claim]));
  [expectedByPath.size !== expectedClaims.length].filter(Boolean).forEach(() => add("blocker", "PROJECT_PREFLIGHT_EXPECTED_CLAIM_BIJECTION_INVALID", "$.output", "Repository-bound claim paths must be unique."));
  const fullValid = outputReport?.status === "PROJECT_OUTPUT_VALID";
  const draftSystem = outputReport?.status === "PROJECT_OUTPUT_DRAFT_UNRESOLVED";
  let draftObserved = draftSystem;
  if (outputReport !== null && !fullValid && !draftSystem) {
    add("blocker", "PROJECT_PREFLIGHT_OUTPUT_SYSTEM_INVALID", "$.output", "The supplied cross-artifact output system is not PROJECT_OUTPUT_VALID.", { status: outputReport.status ?? null });
  }
  const actualPaths = new Set(claims.map(({ path: claimPath }) => claimPath));
  for (const claim of claims) {
    const validation = validateMachineArtifactClaim(claim, repositoryRoot);
    if (!validation.valid) {
      add("blocker", "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_INVALID", `$.files.${claim.path}`, "A recognized Builder machine-artifact claim fails its bundled validator.", {
        kind: claim.kind,
        validatorCodes: validation.codes
      });
      continue;
    }
    if (validation.draftUnresolved) {
      draftObserved = true;
      add("review", "PROJECT_PREFLIGHT_DRAFT_UNRESOLVED", `$.files.${claim.path}`, "A valid proposal remains DRAFT/UNRESOLVED and is not canonical project output.", { kind: claim.kind });
      if (outputReport === null) continue;
    }
    const expected = expectedByPath.get(claim.path);
    if (expected === undefined) {
      add("blocker", outputReport === null ? "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_UNBOUND" : "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_EXTRA", `$.files.${claim.path}`, "A recognized machine artifact is outside the exact repository-derived output claim inventory.", { kind: claim.kind });
      continue;
    }
    if ([expected.kind === claim.kind, expected.sha256 === claimHashReaders.get(expected.hashMode)(claim)].includes(false)) {
      add("blocker", "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_BINDING_MISMATCH", `$.files.${claim.path}`, "A recognized machine artifact differs from its canonical role, path, or hash binding.", { expectedKind: expected.kind, observedKind: claim.kind });
    }
  }
  for (const expected of expectedClaims.filter(({ path: expectedPath }) => !actualPaths.has(normalizeClaimPath(expectedPath)))) {
    add("blocker", "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_MISSING", `$.files.${expected.path}`, "A repository-derived canonical machine artifact claim is missing from the exact inventory.", { kind: expected.kind });
  }
  const stableFindings = deduplicateAndSort(findings);
  const blockerCount = stableFindings.filter(({ severity }) => severity === "blocker").length;
  const status = blockerCount > 0
    ? "PROJECT_PREFLIGHT_BLOCKED"
    : draftObserved
      ? "PROJECT_PREFLIGHT_DRAFT_UNRESOLVED"
      : fullValid
        ? "PROJECT_PREFLIGHT_VALID"
        : "PROJECT_PREFLIGHT_CLEAR";
  const inventory = claims.map(({ value: _value, parseError: _parseError, ...claim }) => claim);
  const payload = {
    schemaVersion: "1.0.0",
    preflightVersion: PROJECT_PREFLIGHT_VERSION,
    status,
    canonicalOutput: status === "PROJECT_PREFLIGHT_VALID",
    outputBinding: outputReport === null ? null : {
      status: outputReport.status ?? null,
      reportSha256: outputReport.reportSha256 ?? null,
      artifactHashes: outputReport.artifactHashes ?? null,
      projection: outputReport.projection
    },
    inventory,
    inventorySha256: canonicalJsonSha256V2(inventory),
    findingCounts: {
      blocker: blockerCount,
      review: stableFindings.filter(({ severity }) => severity === "review").length,
      advisory: stableFindings.filter(({ severity }) => severity === "advisory").length
    },
    findings: stableFindings,
    evidenceBoundary: {
      scope: "local-machine-artifact-preflight",
      commandsExecuted: false,
      networkAccessed: false,
      approvalCreated: false,
      auditClaimed: false,
      deploymentClaimed: false,
      productionClaimed: false
    }
  };
  return { ...payload, reportSha256: canonicalJsonSha256V2(payload) };
}
function loadProjectOutputContext({ repositoryRoot, statePath, previousStatePath, submissionRoot, claims }) {
  if (statePath === null || submissionRoot === null) throw Object.assign(new Error("state and submission root are required together"), { code: "OUTPUT_SYSTEM_PATHS_REQUIRED" });
  const root = fs.realpathSync(repositoryRoot);
  const projectState = readJsonInside(root, statePath);
  const previousState = previousStatePath === null ? null : readJsonInside(root, previousStatePath);
  const bound = Object.fromEntries(Object.entries(projectState.artifacts ?? {}).map(([name, binding]) => [
    name,
    binding === null ? undefined : readJsonInside(root, binding.path)
  ]));
  const submissionDirectory = resolveDirectoryInside(root, submissionRoot);
  const outputReport = validateProjectOutput({ ...bound, projectState, previousState, repositoryRoot: root, submissionRoot: submissionDirectory });
  const prefix = path.relative(root, submissionDirectory);
  const packageFiles = new Map((outputReport.submissionPackageInventory?.files ?? []).map((file) => [file.path, file]));
  const expectedClaims = singletonClaimRoles.map(([role, kind]) => ({ path: projectState.artifacts[role].path, kind, hashMode: "canonical", sha256: projectState.artifacts[role].sha256 }));
  expectedClaims.push(...projectStateClaimAncestry(projectState, statePath, previousState, previousStatePath, claims));
  const submissionFile = packageFiles.get(OPEN_WORLD_V2_SUBMISSION_FILE);
  expectedClaims.push({ path: path.join(prefix, OPEN_WORLD_V2_SUBMISSION_FILE), kind: "submission-v2", hashMode: "raw", sha256: submissionFile.sha256 });
  const planArtifacts = new Map(Object.values(bound.repositoryPlan?.artifacts ?? {}).flat().map((artifact) => [artifact.id, artifact]));
  expectedClaims.push(...(bound.repositoryPlan?.tradeCapability?.markets ?? []).map((market) => {
    const artifact = planArtifacts.get(market.manifestArtifactId);
    return { path: artifact.path, kind: "trade-capability-manifest-v1", hashMode: "raw", sha256: artifact.sha256 };
  }));
  const submission = readJsonInside(submissionDirectory, OPEN_WORLD_V2_SUBMISSION_FILE);
  expectedClaims.push(...(submission.tradeCapability?.markets ?? []).map(({ manifest }) => ({ path: path.join(prefix, manifest.path), kind: "trade-capability-manifest-v1", hashMode: "raw", sha256: manifest.sha256 })));
  return { outputReport, expectedClaims };
}
function projectStateClaimAncestry(projectState, statePath, previousState, previousStatePath, claims) {
  const ancestry = [{ path: normalizeClaimPath(statePath), kind: "project-state-v1", hashMode: "state", sha256: projectState.integrity.stateSha256, value: projectState }];
  [[previousStatePath, previousState]].filter(([claimPath]) => claimPath !== null).forEach(([claimPath, value]) => ancestry.push({ path: normalizeClaimPath(claimPath), kind: "project-state-v1", hashMode: "state", sha256: value.integrity.stateSha256, value }));
  let cursor = ancestry.at(-1).value;
  while (cursor.sequence > 1) {
    const matches = claims.filter(({ kind }) => kind === "project-state-v1")
      .filter(({ value }) => value?.integrity?.stateSha256 === cursor.integrity.previousStateSha256)
      .filter(({ value }) => value?.sequence === cursor.sequence - 1)
      .filter(({ value }) => value?.applicationId === projectState.applicationId)
      .filter(({ value }) => value?.intentSha256 === projectState.intentSha256)
      .filter(({ value }) => projectStatePayloadSha256(value) === value.integrity.stateSha256);
    if (matches.length === 0) break;
    requireOutput(matches.length === 1, "PROJECT_STATE_ANCESTRY_INVALID");
    ancestry.push({ path: matches[0].path, kind: "project-state-v1", hashMode: "state", sha256: matches[0].value.integrity.stateSha256, value: matches[0].value });
    cursor = matches[0].value;
  }
  requireOutput(ancestry.slice(0, -1).every(({ value }, index) => validateProjectState(undefined, undefined, undefined, undefined, value, { previousState: ancestry[index + 1].value }).every(({ code }) => code === "BOUND_PHASE_ARTIFACT_UNAVAILABLE")), "PROJECT_STATE_ANCESTRY_INVALID");
  return ancestry.map(({ value: _value, ...claim }) => claim);
}
function requireOutput(condition, code) {
  if (!condition) throw Object.assign(new Error("repository-bound output state ancestry is invalid"), { code });
}
function resolveDirectoryInside(root, relativePath) {
  const realRoot = fs.realpathSync(root);
  const resolved = path.resolve(realRoot, relativePath);
  if (normalizeClaimPath(relativePath) === null || !inside(realRoot, resolved)) throw Object.assign(new Error("unsafe directory path"), { code: "OUTPUT_SYSTEM_PATH_INVALID" });
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Object.assign(new Error("regular directory required"), { code: "OUTPUT_SYSTEM_DIRECTORY_INVALID" });
  const real = fs.realpathSync(resolved);
  if (!inside(realRoot, real)) throw Object.assign(new Error("directory resolves outside repository"), { code: "OUTPUT_SYSTEM_PATH_ESCAPE" });
  return real;
}
function collectMachineArtifactClaims(repositoryRoot) {
  const root = fs.realpathSync(repositoryRoot);
  const excluded = new Set([".git", ".agents", ".codex", ".claude", ".cursor", "node_modules", "out", "cache", "dist", "coverage", ".next", ".turbo", ".venv"]);
  const pending = [root];
  const claims = [];
  let jsonFiles = 0;
  let jsonBytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory).sort().reverse()) {
      if (excluded.has(name)) continue;
      const target = path.join(directory, name);
      const stat = fs.lstatSync(target);
      const relativePath = normalizeClaimPath(path.relative(root, target));
      if (stat.isDirectory()) {
        if (!stat.isSymbolicLink()) pending.push(target);
        continue;
      }
      if (!name.endsWith(".json")) continue;
      jsonFiles += 1;
      jsonBytes += stat.size;
      if (jsonFiles > 4096) throw Object.assign(new Error("JSON inventory file limit exceeded"), { code: "PREFLIGHT_JSON_FILE_LIMIT" });
      if (stat.size > 1_000_000 || jsonBytes > 24_000_000) throw Object.assign(new Error("JSON inventory byte limit exceeded"), { code: "PREFLIGHT_JSON_BYTE_LIMIT" });
      let value = null;
      let parseError = null;
      try {
        if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error("regular non-symlink JSON required"), { code: "PREFLIGHT_JSON_FILE_INVALID" });
        value = parseBoundedStrictJsonBytes(fs.readFileSync(target));
      } catch (error) {
        parseError = typeof error?.code === "string" ? error.code : "STRICT_JSON_INVALID";
      }
      const kind = classifyMachineArtifact(relativePath, value);
      if (kind !== null) claims.push({
        path: relativePath,
        kind,
        sha256: stat.isFile() && !stat.isSymbolicLink() ? sha256(fs.readFileSync(target)) : null,
        byteLength: stat.size,
        value,
        parseError
      });
    }
  }
  return claims.sort((left, right) => left.path.localeCompare(right.path));
}
function classifyMachineArtifact(relativePath, value) {
  const basename = path.posix.basename(relativePath);
  const nameClaim = machineArtifactNames.get(basename);
  if (nameClaim !== undefined) return nameClaim;
  const declaredClaim = [value?.$schema, value?.contract?.id].map((id) => machineArtifactContractIds.get(id)).find(Boolean);
  if (declaredClaim !== undefined) return declaredClaim;
  const pathClaim = machineArtifactPathClaims.find(([, pattern]) => pattern.test(relativePath));
  if (pathClaim !== undefined) return pathClaim[0];
  const structuralClaim = machineArtifactStructures.find(([, fields]) => fields.every((field) => value?.[field] !== undefined));
  return structuralClaim?.[0] ?? null;
}
function validateMachineArtifactClaim(claim, repositoryRoot) {
  if (claim.parseError !== null || claim.value === null) return { valid: false, draftUnresolved: false, codes: [claim.parseError ?? "STRICT_JSON_INVALID"] };
  if (claim.kind === "submission-v2") {
    try {
      const report = validateOpenWorldPackage({ packageRoot: path.dirname(path.join(repositoryRoot, claim.path)) });
      return {
        valid: report.valid === true,
        draftUnresolved: report.valid === true && claim.value.stage === "proposal" && claim.value.tradeCapability?.applicability === "unresolved",
        codes: uniqueSorted((report.findings ?? []).filter(({ severity }) => severity === "blocker").map(({ code }) => code))
      };
    } catch (error) {
      return { valid: false, draftUnresolved: false, codes: [typeof error?.code === "string" ? error.code : "SUBMISSION_PACKAGE_INVALID"] };
    }
  }
  const findings = machineArtifactSchemaValidators.get(claim.kind)(claim.value);
  const schemaCodes = uniqueSorted(findings.filter(({ severity, code }) => severity === "blocker" && code.includes("SCHEMA_INVALID")).map(({ code }) => code));
  return { valid: schemaCodes.length === 0, draftUnresolved: false, codes: schemaCodes };
}
function normalizeClaimPath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) return null;
  const normalized = value.split(path.sep).join("/").replace(/^\.\//u, "");
  return normalized.startsWith("../") ? null : normalized;
}
