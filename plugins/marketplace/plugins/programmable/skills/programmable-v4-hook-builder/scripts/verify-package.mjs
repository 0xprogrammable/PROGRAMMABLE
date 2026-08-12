#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { analyzeSubmission, canonicalJson, hasIncludedSwapClient } from "./submission-core.mjs";
import { applyRepositoryClosureToReport } from "./closure-report-core.mjs";
import {
  deploymentBindingEvidence,
  expectedRouterContract,
  inspectFeedBackedDependency,
  loadDeploymentRegistry,
  resolveDeploymentBinding
} from "./deployment-core.mjs";
import {
  buildReviewTarget,
  analyzeRepositoryReview,
  validateDependencyLock
} from "./review-target-core.mjs";
import { validateFoundryBuildInfo } from "./build-info-core.mjs";
import { validateFeeConformance } from "./fee-conformance-core.mjs";
import { parseCliOrExit } from "./cli-args.mjs";
import {
  assertInsideRepository,
  resolveRepositoryRoot
} from "./repository-root.mjs";
import {
  declaredSoliditySourceAndTestPaths,
  declaredSourceAndTestPaths,
  isGitLfsPointer
} from "./review-target-contract.mjs";
import {
  MAX_BUILD_INFO_BYTES,
  SHA256_DIGEST_PATTERN
} from "./verify-package-contracts.mjs";
import { createProposalReadinessValidator } from "./verify-package-proposal-readiness.mjs";
import { verifyUnsupportedPublicClaims } from "./verify-package-public-claims.mjs";
import {
  createVerifyPackageResourceRuntime,
  readJson
} from "./verify-package-resource-core.mjs";
import {
  maskSolidityTrivia,
  scanSolidity
} from "./verify-package-solidity-policy.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDirectory, "..");
const { options, positionals } = parseCliOrExit({
  command: "verify-package.mjs",
  usage: "verify-package.mjs [--repository-root <path>] [--require-intake-ready | --require-ready] <submission-directory>",
  summary: "Validate one public proposal or prototype package without executing submitter code.",
  options: [
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Use this Git worktree instead of the current directory." },
    { name: "--require-intake-ready", key: "requireIntakeReady", type: "boolean", description: "Fail unless static package intake is READY." },
    { name: "--require-ready", key: "requireReady", type: "boolean", description: "Deprecated alias for --require-intake-ready." }
  ],
  positionals: { min: 1, max: 1, names: ["submission-directory"] }
});

let schema;
let testedBaselineLock;
let deploymentRegistry;
let submissionTemplate;
try {
  schema = readJson(path.join(skillRoot, "references", "submission.schema.json"));
  testedBaselineLock = readJson(path.join(skillRoot, "assets", "templates", "dependency-lock.example.json"));
  submissionTemplate = readJson(path.join(skillRoot, "assets", "templates", "submission.example.json"));
  deploymentRegistry = loadDeploymentRegistry();
} catch (error) {
  fail(`trusted skill resource is invalid: ${error.message}`, 2);
}
const proposalReadinessErrors = createProposalReadinessValidator({ skillRoot, submissionTemplate });
const input = positionals[0];

let repositoryRoot;
let packageRoot;
try {
  repositoryRoot = resolveRepositoryRoot(options.repositoryRoot);
  packageRoot = assertInsideRepository(repositoryRoot, path.resolve(input));
} catch (error) {
  fail(error.message, 2);
}
if (!fs.statSync(packageRoot).isDirectory()) fail("submission path is not a directory", 2);

const errors = [];
const warnings = [];
const toolingBlockers = [];
const requiredFiles = ["submission.json", "PROPOSAL.md", "THREAT_MODEL.md", "TEST_PLAN.md", "EVIDENCE.md"];
const resourceRuntime = createVerifyPackageResourceRuntime({
  repositoryRoot,
  packageRoot,
  errors,
  toolingBlockers
});
const {
  resolveRepositoryFile,
  walkPackage,
  validatePackageBudgets,
  declaredBuildInfoBudgetPath,
  loadTrustedOrderedRemappings,
  trustedFirstPartyRoots,
  addToolingBlocker,
  relative
} = resourceRuntime;

let packageEntries;
try {
  packageEntries = walkPackage(packageRoot);
} catch (error) {
  fail(`package resource preflight failed: ${error.message}`, 2);
}

for (const file of requiredFiles) {
  const target = path.join(packageRoot, file);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) errors.push(`missing required file ${file}`);
}

let submission = null;
let preflight = null;
try {
  submission = readJson(path.join(packageRoot, "submission.json"));
  preflight = analyzeSubmission(submission, { schema });
  if (!preflight.findings.some(({ code, severity }) => code.startsWith("SCHEMA_") && severity !== "warning")) {
    const repositoryReview = analyzeRepositoryReview({ repositoryRoot, packageRoot, submission });
    preflight = applyRepositoryClosureToReport(preflight, repositoryReview.closure, {
      stage: submission.stage,
      runtimeAssets: repositoryReview.runtimeAssets
    });
  }
} catch (error) {
  errors.push(`submission.json: ${error.message}`);
}
validatePackageBudgets(
  packageEntries,
  declaredBuildInfoBudgetPath(submission),
  errors
);

if (!preflight) {
  errors.push("preflight report is unavailable");
} else if (
  submission?.stage === "prototype"
  && preflight.readiness?.implementation !== "STRUCTURALLY_COMPLETE"
) {
  errors.push(`prototype package requires STRUCTURALLY_COMPLETE; current implementation readiness is ${preflight.readiness?.implementation ?? "unavailable"}`);
}

const reportPath = path.join(packageRoot, "compatibility-report.json");
if (!fs.existsSync(reportPath)) {
  errors.push("compatibility-report.json is missing");
} else if (preflight) {
  try {
    const recorded = readJson(reportPath);
    if (canonicalJson(recorded) !== canonicalJson(preflight)) errors.push("compatibility-report.json differs from a fresh complete deterministic preflight");
  } catch (error) {
    errors.push(`compatibility-report.json: ${error.message}`);
  }
}

if (submission) {
  for (const field of ["github", "contact", "licenseDeclaration"]) {
    const value = submission.builder?.[field];
    if (typeof value !== "string" || value.trim().length === 0) errors.push(`builder.${field} is required for a public intake package`);
  }
  verifyUnsupportedPublicClaims({
    claimErrors: errors,
    packageEntries,
    packageRoot,
    repositoryRoot,
    submission,
    addToolingBlocker,
    relative
  });
  if (submission.stage === "proposal") {
    errors.push(...proposalReadinessErrors({ submission, packageRoot }));
  }

  const sourceAndTestPaths = declaredSourceAndTestPaths(submission);
  const sourceAndTestPathSet = new Set(sourceAndTestPaths);
  const listedPaths = [
    ...sourceAndTestPaths,
    submission.implementation?.specificationPath,
    submission.implementation?.testEvidencePath,
    submission.implementation?.dependencyLockPath,
    submission.implementation?.feeConformanceManifestPath,
    submission.implementation?.gateStatusPath,
    submission.implementation?.reviewTargetPath,
    submission.implementation?.runtimeAssetManifestPath,
    ...(submission.capabilityExtensions ?? []).flatMap((extension) => [
      extension?.schemaPath,
      ...(extension?.evidencePaths ?? [])
    ]),
    ...(submission.tokenBehaviorExtensions ?? []).flatMap((extension) => [
      ...(extension?.evidencePaths ?? [])
    ])
  ].filter(Boolean);
  for (const listedPath of [...new Set(listedPaths)]) {
    const target = resolveRepositoryFile(listedPath, errors);
    if (target && sourceAndTestPathSet.has(listedPath) && isGitLfsPointer(fs.readFileSync(target))) {
      addToolingBlocker(`Git LFS pointer is not materialized source/test content: ${listedPath}`);
    }
  }

  if (submission.stage === "prototype" && !resourceRuntime.repositoryResourceBlocked) {
    verifyPrototypePackage();
  }
}

const toolingBlocked = toolingBlockers.length > 0;
const intakeReady = errors.length === 0 && !toolingBlocked;
const declaredPackageDependencies = Array.isArray(submission?.integration?.sdkDependencies)
  ? submission.integration.sdkDependencies
  : [];
const result = {
  validationState: toolingBlocked ? "TOOLING_BLOCKED" : "COMPLETED",
  toolingBlocked,
  readiness: preflight?.readiness ?? null,
  intake: {
    state: intakeReady ? "READY" : "BLOCKED",
    assurance: "static-structure-and-builder-declared-evidence-only"
  },
  sandboxVerification: {
    state: "NOT_RUN"
  },
  intakeValidated: intakeReady,
  packageStructureValid: errors.length === 0,
  package: relative(packageRoot),
  stage: submission?.stage ?? null,
  preflightDecision: preflight?.decision ?? null,
  preflightDecisionCompatibility: preflight?.decisionCompatibility ?? null,
  accepted: false,
  releaseEligible: false,
  available: false,
  deprecatedBooleanProjections: {
    state: "DEPRECATED_COMPATIBILITY_ONLY",
    fields: {
      intakeValidated: "use intake.state",
      accepted: "use externalAuthority.acceptance",
      releaseEligible: "use externalAuthority.releaseEligibility",
      available: "use externalAuthority.availability"
    }
  },
  externalAuthority: {
    acceptance: "NOT_CHECKED",
    releaseEligibility: "NOT_CHECKED",
    availability: "NOT_CHECKED"
  },
  packageDependencyEvidence: {
    state: declaredPackageDependencies.length === 0
      ? "not-declared"
      : "builder-declared-requires-attributable-verification",
    declaredPackages: declaredPackageDependencies.length,
    integrityVerified: false,
    centralSourceVerified: false
  },
  submissionHash: preflight?.submissionHash ?? null,
  errors: [...new Set(errors)].sort(),
  warnings: [...new Set(warnings)].sort(),
  note: "This gate validates public intake structure, deterministic preflight freshness and builder-declared evidence without executing submitter code or evidence commands. READY is static intake assurance only. Sandbox rebuild and independent verification were not run; this is not prototype validation, acceptance, an audit, deployment evidence, routing approval or availability."
};

console.log(JSON.stringify(result, null, 2));
if (!intakeReady || ((options.requireIntakeReady || options.requireReady) && result.intake.state !== "READY")) process.exitCode = 1;

function verifyPrototypePackage() {
  let dependencyLock = null;
  const lockPath = submission.implementation?.dependencyLockPath;
  if (lockPath) {
    const target = resolveRepositoryFile(lockPath, errors);
    if (target) {
      try {
        dependencyLock = readJson(target);
      } catch (error) {
        errors.push(`dependency lock: ${error.message}`);
      }
    }
  }

  let freshReviewTarget = null;
  try {
    freshReviewTarget = buildReviewTarget({ repositoryRoot, packageRoot, submission });
  } catch (error) {
    if (/Git LFS pointer/u.test(error.message)) addToolingBlocker(`review target: ${error.message}`);
    else errors.push(`review target: ${error.message}`);
  }

  if (dependencyLock && freshReviewTarget) {
    errors.push(...validateDependencyLock(dependencyLock, freshReviewTarget.externalImports, {
      submission,
      testedBaselineLock,
      importResolutions: freshReviewTarget.importResolutions,
      repositoryRoot
    }));
  }
  verifyCompilerBuildInfo(dependencyLock, freshReviewTarget);
  verifyProgrammableFeeConformance();

  const reviewTargetPath = submission.implementation?.reviewTargetPath;
  if (reviewTargetPath && freshReviewTarget) {
    const target = resolveRepositoryFile(reviewTargetPath, errors);
    if (target) {
      try {
        const recorded = readJson(target);
        if (canonicalJson(recorded) !== canonicalJson(freshReviewTarget)) errors.push("review target differs from the current complete declared source and evidence closure");
      } catch (error) {
        errors.push(`review target record: ${error.message}`);
      }
    }
  }

  verifyGateStatus(freshReviewTarget);
  verifyProtocolRecords();

  for (const record of freshReviewTarget?.files ?? []) {
    if (!record.path.endsWith(".sol")) continue;
    if (record.kind === "solidity-dependency-import" || record.kind === "solidity-package-dependency-import") continue;
    const target = resolveRepositoryFile(record.path, errors);
    if (target) scanSolidity(target, errors, warnings, { submission, relative });
  }
}

function verifyProgrammableFeeConformance() {
  const manifestPath = submission.implementation?.feeConformanceManifestPath;
  if (!manifestPath) return;
  const manifest = resolveRepositoryFile(manifestPath, errors);
  if (!manifest) return;
  let result;
  try {
    result = validateFeeConformance({
      root: repositoryRoot,
      manifestPath
    });
  } catch (error) {
    errors.push(`fee conformance: ${error.message}`);
    return;
  }
  if (result?.ok !== true) {
    const messages = Array.isArray(result?.errors) && result.errors.length > 0
      ? result.errors
      : ["structural fee-conformance result is invalid"];
    errors.push(...messages.map((message) => `fee conformance: ${message}`));
  }
  for (const warning of result?.warnings ?? []) warnings.push(`fee conformance: ${warning}`);
}

function verifyCompilerBuildInfo(dependencyLock, freshReviewTarget) {
  const buildInfoPaths = submission.implementation?.compilerBuildInfoPaths;
  const hasSoliditySource = declaredSoliditySourceAndTestPaths(submission).length > 0;
  if (!hasSoliditySource) {
    if ((buildInfoPaths?.length ?? 0) !== 0) {
      errors.push("build info: compiler build-info is forbidden when no Solidity source is declared");
    }
    return;
  }
  if (!Array.isArray(buildInfoPaths) || buildInfoPaths.length !== 1) {
    errors.push(
      "build info: prototype must declare exactly one implementation.compilerBuildInfoPaths entry"
    );
    return;
  }

  const buildInfoPath = buildInfoPaths[0];
  const target = resolveRepositoryFile(buildInfoPath, errors, {
    errorPrefix: "build info",
    maxFileBytes: MAX_BUILD_INFO_BYTES,
    resourceClass: "build-info"
  });
  if (!target) return;

  let buildInfo;
  try {
    buildInfo = readJson(target, MAX_BUILD_INFO_BYTES);
  } catch (error) {
    errors.push(`build info: JSON: ${error.message}`);
    return;
  }

  if (!dependencyLock?.compiler) {
    errors.push("build info: locked compiler settings are unavailable");
    return;
  }
  if (!freshReviewTarget) {
    errors.push("build info: fresh review target is unavailable");
    return;
  }

  let remappings;
  try {
    remappings = loadTrustedOrderedRemappings();
  } catch (error) {
    errors.push(`build info: trusted remappings are invalid: ${error.message}`);
    return;
  }

  const validationErrors = validateFoundryBuildInfo({
    buildInfo,
    reviewTarget: freshReviewTarget,
    declaredCompiler: dependencyLock.compiler,
    pathMetadata: {
      repositoryRoot,
      buildInfoPath: relative(target),
      firstPartyRoots: trustedFirstPartyRoots(),
      remappings
    }
  });
  errors.push(...validationErrors.map((message) => `build info: ${message}`));
}

function verifyGateStatus(freshReviewTarget) {
  const gatePath = submission.implementation?.gateStatusPath;
  if (!gatePath) return;
  const target = resolveRepositoryFile(gatePath, errors);
  if (!target) return;
  let status;
  try {
    status = readJson(target);
  } catch (error) {
    errors.push(`gate status: ${error.message}`);
    return;
  }
  if (status.schemaVersion !== 1) errors.push("gate status schemaVersion must be 1");
  if (status.attestation !== "builder-declared-untrusted") errors.push("gate status must identify builder evidence as declared and untrusted");
  if (status.standardVersion !== preflight.standardVersion) errors.push("gate status standardVersion differs from the preflight report");
  if (status.submissionHash !== preflight.submissionHash) errors.push("gate status submissionHash differs from the preflight report");
  if (status.validatorSha256 !== preflight.toolchain?.validatorSha256) errors.push("gate status validatorSha256 differs from the preflight report");
  if (status.schemaSha256 !== preflight.toolchain?.schemaSha256) errors.push("gate status schemaSha256 differs from the preflight report");
  if (status.deploymentSnapshotSha256 !== preflight.toolchain?.deploymentSnapshotSha256) errors.push("gate status deploymentSnapshotSha256 differs from the preflight report");
  if (status.officialDeploymentReferenceSha256 !== preflight.toolchain?.officialDeploymentReferenceSha256) errors.push("gate status officialDeploymentReferenceSha256 differs from the preflight report");
  if (status.policyBundleSha256 !== preflight.toolchain?.policyBundleSha256) errors.push("gate status policyBundleSha256 differs from the preflight report");
  if (!SHA256_DIGEST_PATTERN.test(status.reviewTargetHash ?? "")) {
    errors.push("gate status reviewTargetHash must be an exact SHA-256 review-target digest");
  } else if (status.reviewTargetHash !== freshReviewTarget?.reviewTargetHash) {
    errors.push("gate status reviewTargetHash differs from the current complete declared source and evidence closure");
  }
  const records = new Map();
  for (const gate of status.gates ?? []) {
    if (!gate || typeof gate.id !== "string" || records.has(gate.id)) {
      errors.push("gate status contains a missing or duplicate gate id");
      continue;
    }
    records.set(gate.id, gate);
    if (!["planned", "completed", "failed", "blocked", "tooling-blocked"].includes(gate.status)) errors.push(`gate ${gate.id} has an invalid status`);
    if (!Array.isArray(gate.evidence)) errors.push(`gate ${gate.id} evidence must be an array`);
    for (const evidence of gate.evidence ?? []) {
      const evidencePath = evidence?.path;
      const file = resolveRepositoryFile(evidencePath, errors);
      if (!file) continue;
      const digest = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
      if (evidence.sha256 !== digest) errors.push(`gate ${gate.id} evidence hash differs from ${evidencePath}`);
      if (evidence.gateId !== gate.id) errors.push(`gate ${gate.id} evidence gateId differs from its parent gate`);
      if (evidence.result !== "passed") errors.push(`gate ${gate.id} evidence result must be passed`);
      if (typeof evidence.scope !== "string" || evidence.scope.trim().length < 12) errors.push(`gate ${gate.id} evidence needs a precise scope for ${evidencePath}`);
      if (typeof evidence.command !== "string" || evidence.command.trim().length === 0) errors.push(`gate ${gate.id} evidence is missing the exact command for ${evidencePath}`);
      if (typeof evidence.toolVersion !== "string" || evidence.toolVersion.trim().length === 0) errors.push(`gate ${gate.id} evidence is missing the tool version for ${evidencePath}`);
      if (!/^[a-fA-F0-9]{40}$/.test(evidence.commit ?? "")) errors.push(`gate ${gate.id} evidence is missing an exact 40-character commit for ${evidencePath}`);
      if (evidence.reviewTargetHash !== status.reviewTargetHash) errors.push(`gate ${gate.id} evidence reviewTargetHash differs from the gate status review target`);
    }
  }
  for (const required of preflight.requiredGates.filter((gate) => gate.stage === "prototype")) {
    const record = records.get(required.id);
    if (!record) {
      errors.push(`prototype gate is missing from gate status: ${required.id}`);
      continue;
    }
    if (record.status !== "completed") errors.push(`prototype gate is not completed: ${required.id}`);
    if (!Array.isArray(record.evidence) || record.evidence.length === 0) errors.push(`prototype gate has no evidence record: ${required.id}`);
  }
  const maintainerOnly = new Set(preflight.requiredGates.filter((gate) => ["candidate", "release", "external"].includes(gate.stage)).map((gate) => gate.id));
  for (const id of maintainerOnly) {
    if (records.get(id)?.status === "completed") errors.push(`builder gate status cannot complete maintainer or external gate: ${id}`);
  }
}

function verifyProtocolRecords() {
  const records = submission.dependencies?.onchain ?? [];
  const targetChainId = submission.target?.chainId;
  for (const [index, record] of records.entries()) {
    const inspection = inspectFeedBackedDependency(record, { chainId: targetChainId, registry: deploymentRegistry });
    for (const message of inspection.errors) {
      errors.push(`onchain dependency ${index} (${record.name ?? "unnamed"}): ${message}`);
    }
    for (const message of inspection.warnings) {
      warnings.push(`onchain dependency ${index} (${record.name ?? "unnamed"}): ${message}`);
    }
  }
  const includedSwapClient = hasIncludedSwapClient(submission);
  const requiredRecords = [];
  if (prototypeRequiresPoolManagerRecord()) {
    requiredRecords.push({ label: "PoolManager", pattern: /\bpool\s*manager\b/i });
  }
  if (includedSwapClient) {
    requiredRecords.push(
      { label: "Universal Router", dependencyId: submission.integration?.routerDependencyId },
      { label: "Permit2", dependencyId: submission.integration?.permit2DependencyId },
      { label: "StateView", dependencyId: submission.integration?.stateViewDependencyId },
      { label: "V4Quoter", dependencyId: submission.integration?.quoterDependencyId }
    );
  }

  const resolvedRequiredRecords = new Map();
  for (const required of requiredRecords) {
    const record = required.pattern
      ? records.find((entry) => required.pattern.test(`${entry.name ?? ""} ${entry.kind ?? ""}`))
      : typeof required.dependencyId === "string" && required.dependencyId.length > 0
        ? records.find((entry) => entry?.id === required.dependencyId)
        : null;
    if (!record) {
      errors.push(`prototype is missing an exact ${required.label} onchain dependency record`);
      continue;
    }
    resolvedRequiredRecords.set(required.label, record);
    for (const field of ["repository", "revision", "deploymentRecordId", "chainAddress", "runtimeHash", "deploymentEvidencePath", "trust", "failure", "fallback"]) {
      if (record[field] === null || record[field] === undefined || record[field] === "") errors.push(`${required.label} dependency record is missing ${field}`);
    }
  }
  for (const [index, record] of records.entries()) verifyDeploymentEvidence(record, index);
  const generation = submission.integration?.routerGeneration;
  const router = resolvedRequiredRecords.get("Universal Router");
  if (includedSwapClient && router && generation && generation !== "custom-reviewed") {
    try {
      const expected = expectedRouterContract(generation);
      const deployment = resolveDeploymentBinding(deploymentRegistry, { id: router.deploymentRecordId });
      if (deployment.record.contract !== expected) errors.push(`Universal Router deployment record identifies ${deployment.record.contract}, not selected generation ${expected}`);
    } catch (error) {
      errors.push(`Universal Router deployment record: ${error.message}`);
    }
  }
}

function prototypeRequiresPoolManagerRecord() {
  if (submission.hook?.used === true) return true;
  if (typeof submission.target?.officialLaunchProfileId === "string" && submission.target.officialLaunchProfileId.trim().length > 0) return true;
  if (submission.hook?.nestedActions?.directPoolManagerCalls === true) return true;

  const poolManagerBinding = /\b(?:IPoolManager|PoolManager|PoolManagerAddress|poolManager|unlockCallback)\b/u;
  for (const sourcePath of declaredSoliditySourceAndTestPaths(submission)) {
    const target = resolveRepositoryFile(sourcePath, errors);
    if (!target) continue;
    const source = maskSolidityTrivia(fs.readFileSync(target, "utf8"));
    if (poolManagerBinding.test(source)) return true;
  }
  return false;
}

function verifyDeploymentEvidence(record, index) {
  if (!record?.deploymentEvidencePath) return;
  const target = resolveRepositoryFile(record.deploymentEvidencePath, errors);
  if (!target) return;
  let evidence;
  try {
    evidence = readJson(target);
  } catch (error) {
    errors.push(`onchain dependency ${index} deployment evidence: ${error.message}`);
    return;
  }
  let deploymentBinding = null;
  try {
    deploymentBinding = resolveDeploymentBinding(deploymentRegistry, { id: record.deploymentRecordId });
  } catch (error) {
    errors.push(`onchain dependency ${index} deployment evidence record: ${error.message}`);
  }
  const expected = {
    schemaVersion: 1,
    attestation: "builder-declared-untrusted",
    deploymentRecordId: record.deploymentRecordId,
    ...(deploymentBinding ? deploymentBindingEvidence(deploymentBinding, deploymentRegistry) : {}),
    chainId: submission.target?.chainId,
    address: record.chainAddress,
    runtimeHash: record.runtimeHash,
    sourceRepository: record.repository,
    sourceRevision: record.revision
  };
  for (const [field, value] of Object.entries(expected)) if (evidence?.[field] !== value) errors.push(`onchain dependency ${index} deployment evidence ${field} differs from submission`);
  if (!Number.isInteger(evidence?.observedBlock) || evidence.observedBlock <= 0) errors.push(`onchain dependency ${index} deployment evidence needs a positive observedBlock`);
  if (typeof evidence?.rpcClass !== "string" || evidence.rpcClass.trim().length === 0) errors.push(`onchain dependency ${index} deployment evidence needs rpcClass`);
  if (evidence?.sourceStatus !== "matched") errors.push(`onchain dependency ${index} deployment evidence sourceStatus must be matched`);
  if (typeof evidence?.verificationProvider !== "string" || evidence.verificationProvider.trim().length === 0) errors.push(`onchain dependency ${index} deployment evidence needs verificationProvider`);
  if (typeof evidence?.compiler !== "string" || evidence.compiler.trim().length === 0) errors.push(`onchain dependency ${index} deployment evidence needs compiler`);
}

function fail(message, code) {
  console.error(`verify-package: ${message}`);
  process.exit(code);
}
