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
  analyzeRepositoryClosure,
  parseRemappings,
  validateDependencyLock
} from "./review-target-core.mjs";
import { validateFoundryBuildInfo } from "./build-info-core.mjs";
import { parseCliOrExit } from "./cli-args.mjs";
import { findUnsupportedPublicClaims } from "./public-claims-core.mjs";
import {
  assertInsideRepository,
  resolveRepositoryRoot
} from "./repository-root.mjs";
import {
  declaredSoliditySourceAndTestPaths,
  declaredSourceAndTestPaths,
  isCanonicalReviewTargetPath,
  isGitLfsPointer,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";

const MAX_FILE_BYTES = REVIEW_TARGET_CONTRACT_V1.maximumFileBytes;
const MAX_BUILD_INFO_BYTES = 64_000_000;
const MAX_FILES = REVIEW_TARGET_CONTRACT_V1.maximumFiles;
const MAX_ENTRIES = 1_024;
const MAX_TOTAL_BYTES = REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes;
const MAX_TOTAL_INTAKE_BYTES = MAX_BUILD_INFO_BYTES + MAX_TOTAL_BYTES;
const MAX_PATH_DEPTH = REVIEW_TARGET_CONTRACT_V1.maximumPathDepth;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const TRUSTED_FIRST_PARTY_ROOTS = [
  "app",
  "contracts",
  "models",
  "script",
  "spec",
  "src",
  "submissions",
  "test"
];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDirectory, "..");
const { options, positionals } = parseCliOrExit({
  command: "verify-package.mjs",
  usage: "verify-package.mjs [--repository-root <path>] <submission-directory>",
  summary: "Validate one public proposal or prototype package without executing submitter code.",
  options: [
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Use this Git worktree instead of the current directory." }
  ],
  positionals: { min: 1, max: 1, names: ["submission-directory"] }
});

let schema;
let testedBaselineLock;
let deploymentRegistry;
try {
  schema = readJson(path.join(skillRoot, "references", "submission.schema.json"));
  testedBaselineLock = readJson(path.join(skillRoot, "assets", "templates", "dependency-lock.example.json"));
  deploymentRegistry = loadDeploymentRegistry();
} catch (error) {
  fail(`trusted skill resource is invalid: ${error.message}`, 2);
}
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
const repositoryResources = new Map();
let repositoryResourceBytes = 0;
let repositoryNormalResourceBytes = 0;
let repositoryResourceBlocked = false;

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
    preflight = applyRepositoryClosureToReport(
      preflight,
      analyzeRepositoryClosure({ repositoryRoot, packageRoot, submission }),
      { stage: submission.stage }
    );
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
} else if (submission?.stage === "prototype" && preflight.decision !== "PROTOTYPE_READY") {
  errors.push(`prototype package requires PROTOTYPE_READY; current decision is ${preflight.decision}`);
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
  rejectUnsupportedPublicClaims(errors);

  const sourceAndTestPaths = declaredSourceAndTestPaths(submission);
  const sourceAndTestPathSet = new Set(sourceAndTestPaths);
  const listedPaths = [
    ...sourceAndTestPaths,
    submission.implementation?.specificationPath,
    submission.implementation?.testEvidencePath,
    submission.implementation?.dependencyLockPath,
    submission.implementation?.gateStatusPath,
    submission.implementation?.reviewTargetPath,
    ...(submission.capabilityExtensions ?? []).flatMap((extension) => [
      extension?.schemaPath,
      ...(extension?.evidencePaths ?? [])
    ])
  ].filter(Boolean);
  for (const listedPath of [...new Set(listedPaths)]) {
    const target = resolveRepositoryFile(listedPath, errors);
    if (target && sourceAndTestPathSet.has(listedPath) && isGitLfsPointer(fs.readFileSync(target))) {
      addToolingBlocker(`Git LFS pointer is not materialized source/test content: ${listedPath}`);
    }
  }

  if (submission.stage === "prototype" && !repositoryResourceBlocked) {
    verifyPrototypePackage();
  }
}

const toolingBlocked = toolingBlockers.length > 0;
const declaredPackageDependencies = Array.isArray(submission?.integration?.sdkDependencies)
  ? submission.integration.sdkDependencies
  : [];
const result = {
  validationState: toolingBlocked ? "TOOLING_BLOCKED" : "COMPLETED",
  toolingBlocked,
  intakeValidated: errors.length === 0,
  packageStructureValid: errors.length === 0,
  package: relative(packageRoot),
  stage: submission?.stage ?? null,
  preflightDecision: preflight?.decision ?? null,
  designReadyForPrototype: preflight?.decision === "PROTOTYPE_READY" && !toolingBlocked,
  prototypeIntakeValidated: submission?.stage === "prototype" && preflight?.decision === "PROTOTYPE_READY" && errors.length === 0,
  accepted: false,
  releaseEligible: false,
  available: false,
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
  note: "This gate validates public intake structure, deterministic preflight freshness and declared evidence without executing submitter code. It is not acceptance, an audit, deployment evidence, routing approval or availability."
};

console.log(JSON.stringify(result, null, 2));
if (!result.intakeValidated) process.exit(1);

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
    if (target) scanSolidity(target, errors, warnings);
  }
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

function scanSolidity(file, scanErrors, scanWarnings) {
  // Intake binds the declared compiler artifact to the reviewed source bytes,
  // but AST output is optional. Keep this policy gate independent of optional
  // compiler output: erase comments and literals, then reject every assembly
  // form.
  const source = maskSolidityTrivia(fs.readFileSync(file, "utf8"));
  const name = relative(file);
  if (submission.hook?.used === false) {
    const hookInterface = /\b(?:BaseHook|IHooks|getHookPermissions)\b|\bHooks\s*\./u;
    const hookCallback = /\bfunction\s+(?:beforeInitialize|afterInitialize|beforeAddLiquidity|afterAddLiquidity|beforeRemoveLiquidity|afterRemoveLiquidity|beforeSwap|afterSwap|beforeDonate|afterDonate)\s*\(/u;
    if (hookInterface.test(source)) {
      scanErrors.push(`${name}: hook.used=false conflicts with a Solidity v4 hook interface or permission declaration`);
    }
    if (hookCallback.test(source)) {
      scanErrors.push(`${name}: hook.used=false conflicts with a Solidity v4 hook callback declaration`);
    }
  }
  const assemblyPolicy = inspectInlineAssembly(source);
  if (assemblyPolicy.present) {
    scanErrors.push(`${name}: contains local inline assembly that requires an isolated maintainer review before intake`);
  }
  if (assemblyPolicy.usesOrigin) {
    scanErrors.push(`${name}: uses Yul origin()`);
  }
  const prohibited = [
    [/\btx\s*\.\s*origin\b/, "uses tx.origin"],
    [/\bdelegatecall\b\s*(?:\{[^}]*\}\s*)?\(/s, "uses delegatecall"],
    [/\bselfdestruct\b\s*\(/, "uses selfdestruct"],
    [/pragma\s+solidity\s+(?:\^|~|>=|<=|>|<)/, "uses a floating Solidity pragma"]
  ];
  const review = [
    [/\.call\s*(?:\{|\()/, "contains a low-level call"],
    [/\b(?:TODO|FIXME|XXX)\b/, "contains an unresolved implementation marker"]
  ];
  for (const [pattern, message] of prohibited) if (pattern.test(source)) scanErrors.push(`${name}: ${message}`);
  for (const [pattern, message] of review) if (pattern.test(source)) scanWarnings.push(`${name}: ${message}; include an explicit review disposition`);

  const authorityText = (submission.authorities ?? []).flatMap((authority) => authority.capabilities ?? []).join(" ").toLowerCase();
  if (/\b(?:onlyOwner|onlyRole|AccessControl|Ownable)\b/.test(source) && (submission.authorities?.length ?? 0) === 0) {
    scanErrors.push(`${name}: source declares privileged access control but submission.authorities is empty`);
  }
  const capabilityNames = {
    mint: ["mint", "issue"],
    blacklist: ["blacklist", "blockAccount", "denylist"],
    pause: ["pause", "freeze", "halt"],
    upgrade: ["upgrade", "setImplementation", "changeImplementation"],
    feeRecipient: ["setFeeRecipient", "changeFeeRecipient"],
    payout: ["payout", "setReceiver", "setRecipient", "redirect"],
    rescue: ["rescue", "sweep", "recover"]
  };
  for (const [capability, functionNames] of Object.entries(capabilityNames)) {
    const alternatives = functionNames.join("|");
    const callable = new RegExp(`\\bfunction\\s+(?:${alternatives})\\w*\\s*\\([^)]*\\)[\\s\\S]{0,400}\\b(?:public|external)\\b`, "i");
    if (callable.test(source) && !authorityText.includes(capability.toLowerCase()) && !functionNames.some((entry) => authorityText.includes(entry.toLowerCase()))) {
      scanErrors.push(`${name}: public or external ${capability} capability is not declared in submission.authorities`);
    }
  }
}

function maskSolidityTrivia(source) {
  let output = "";
  let mode = "code";
  let quote = null;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (mode === "line-comment") {
      if (current === "\n") {
        output += "\n";
        mode = "code";
      } else {
        output += " ";
      }
      continue;
    }

    if (mode === "block-comment") {
      if (current === "*" && next === "/") {
        output += "  ";
        index += 1;
        mode = "code";
      } else {
        output += current === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (mode === "string") {
      output += current === "\n" ? "\n" : " ";
      if (current === "\\") {
        if (next !== undefined) {
          output += next === "\n" ? "\n" : " ";
          index += 1;
        }
      } else if (current === quote) {
        mode = "code";
        quote = null;
      }
      continue;
    }

    if (current === "/" && next === "/") {
      output += "  ";
      index += 1;
      mode = "line-comment";
    } else if (current === "/" && next === "*") {
      output += "  ";
      index += 1;
      mode = "block-comment";
    } else if (current === '"' || current === "'") {
      output += " ";
      mode = "string";
      quote = current;
    } else {
      output += current;
    }
  }

  return output;
}

function inspectInlineAssembly(source) {
  let present = false;
  let usesOrigin = false;
  const assemblyPattern = /\bassembly\b/g;
  let match;

  while ((match = assemblyPattern.exec(source)) !== null) {
    present = true;
    let cursor = match.index + match[0].length;
    cursor = skipWhitespace(source, cursor);

    if (source[cursor] === "(") {
      cursor = closingDelimiter(source, cursor, "(", ")");
      if (cursor === -1) break;
      cursor = skipWhitespace(source, cursor + 1);
      assemblyPattern.lastIndex = cursor;
    }

    if (source[cursor] !== "{") continue;
    const close = closingDelimiter(source, cursor, "{", "}");
    if (close === -1) {
      usesOrigin ||= /\borigin\s*\(\s*\)/.test(source.slice(cursor + 1));
      break;
    } else {
      usesOrigin ||= /\borigin\s*\(\s*\)/.test(source.slice(cursor + 1, close));
      assemblyPattern.lastIndex = close + 1;
    }
  }

  return { present, usesOrigin };
}

function skipWhitespace(source, start) {
  let cursor = start;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  return cursor;
}

function closingDelimiter(source, start, open, close) {
  let depth = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    if (source[cursor] === open) depth += 1;
    else if (source[cursor] === close) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

function rejectUnsupportedPublicClaims(claimErrors) {
  const targets = packageEntries
    .filter((entry) => entry.stat.isFile() && entry.stat.size <= MAX_FILE_BYTES && /\.(?:md|txt|json|sol|ya?ml)$/i.test(entry.path))
    .map((entry) => entry.path);
  for (const target of targets) {
    const text = fs.readFileSync(target, "utf8");
    for (const finding of findUnsupportedPublicClaims(text)) {
      claimErrors.push(`${relative(target)} contains an unsupported ${finding} claim`);
    }
  }
}

function resolveRepositoryFile(
  relativePath,
  resolutionErrors,
  {
    errorPrefix = null,
    maxFileBytes = MAX_FILE_BYTES,
    resourceClass = "normal"
  } = {}
) {
  const addError = (message) => {
    resolutionErrors.push(errorPrefix ? `${errorPrefix}: ${message}` : message);
  };
  if (!safeRepositoryRelativePath(relativePath)) {
    addError(`invalid repository-relative path: ${String(relativePath)}`);
    return null;
  }

  const lexicalTarget = path.resolve(repositoryRoot, relativePath);
  try {
    if (fs.lstatSync(lexicalTarget).isSymbolicLink()) {
      addError(`implementation path contains a symbolic link: ${relativePath}`);
      return null;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      addError(repositoryPathResolutionError(error, relativePath));
      return null;
    }
  }

  let target;
  try {
    target = assertInsideRepository(repositoryRoot, lexicalTarget);
  } catch (error) {
    addError(repositoryPathResolutionError(error, relativePath));
    return null;
  }

  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    addError(repositoryPathResolutionError(error, relativePath));
    return null;
  }
  if (stat.isSymbolicLink()) {
    addError(`implementation path contains a symbolic link: ${relativePath}`);
    return null;
  }
  if (!stat.isFile()) {
    addError(`implementation path is not a file: ${relativePath}`);
    return null;
  }
  if (stat.size > maxFileBytes) {
    addError(`implementation file exceeds the ${maxFileBytes} byte review limit: ${relativePath}`);
    repositoryResourceBlocked = true;
    return null;
  }

  const repositoryPath = path.relative(repositoryRoot, target).replaceAll(path.sep, "/");
  if (repositoryPath.split("/").length > MAX_PATH_DEPTH) {
    addError(`implementation path exceeds the ${MAX_PATH_DEPTH} segment review limit: ${relativePath}`);
    repositoryResourceBlocked = true;
    return null;
  }
  if (!repositoryResources.has(target)) {
    if (repositoryResources.size >= MAX_FILES) {
      addError(`declared repository resources exceed the ${MAX_FILES} file review limit`);
      repositoryResourceBlocked = true;
      return null;
    }
    if (
      resourceClass === "normal" &&
      repositoryNormalResourceBytes + stat.size > MAX_TOTAL_BYTES
    ) {
      addError(`declared normal repository resources exceed the ${MAX_TOTAL_BYTES} byte review limit`);
      repositoryResourceBlocked = true;
      return null;
    }
    if (repositoryResourceBytes + stat.size > MAX_TOTAL_INTAKE_BYTES) {
      addError(`declared repository resources exceed the ${MAX_TOTAL_INTAKE_BYTES} byte review limit`);
      repositoryResourceBlocked = true;
      return null;
    }
    repositoryResources.set(target, { size: stat.size, resourceClass });
    repositoryResourceBytes += stat.size;
    if (resourceClass === "normal") repositoryNormalResourceBytes += stat.size;
  }
  return target;
}

function readJson(target, maxFileBytes = MAX_FILE_BYTES) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error("symbolic links are not allowed");
  if (!stat.isFile()) throw new Error("not a regular file");
  if (stat.size > maxFileBytes) throw new Error(`file exceeds ${maxFileBytes} bytes`);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function walkPackage(directory, depth = 0, state = { entries: 0, files: 0, bytes: 0 }) {
  if (depth > MAX_PATH_DEPTH) throw new Error(`package contains a directory deeper than ${MAX_PATH_DEPTH} segments`);
  const entries = [];
  const directoryHandle = fs.opendirSync(directory);
  try {
    let directoryEntry;
    while ((directoryEntry = directoryHandle.readSync()) !== null) {
      const target = path.join(directory, directoryEntry.name);
      const stat = fs.lstatSync(target);
      state.entries += 1;
      if (state.entries > MAX_ENTRIES) throw new Error(`package exceeds the ${MAX_ENTRIES} filesystem entry review limit`);
      if (stat.isSymbolicLink()) throw new Error(`symbolic links are not allowed: ${path.relative(packageRoot, target).replaceAll(path.sep, "/")}`);
      entries.push({ path: target, stat });
      if (stat.isFile()) {
        state.files += 1;
        state.bytes += stat.size;
        const relativePath = path.relative(packageRoot, target).replaceAll(path.sep, "/");
        if (state.files > MAX_FILES) throw new Error(`package exceeds the ${MAX_FILES} file review limit`);
        if (relativePath === "submission.json" && stat.size > MAX_FILE_BYTES) {
          throw new Error(`file exceeds the ${MAX_FILE_BYTES} byte review limit: ${relativePath}`);
        }
        if (state.bytes > MAX_TOTAL_INTAKE_BYTES) {
          throw new Error(`package exceeds the ${MAX_TOTAL_INTAKE_BYTES} byte review limit`);
        }
        if (relativePath.split("/").length > MAX_PATH_DEPTH) throw new Error(`path exceeds the ${MAX_PATH_DEPTH} segment review limit: ${relativePath}`);
      } else if (stat.isDirectory()) {
        entries.push(...walkPackage(target, depth + 1, state));
      } else {
        throw new Error(`unsupported filesystem entry: ${path.relative(packageRoot, target).replaceAll(path.sep, "/")}`);
      }
    }
  } finally {
    directoryHandle.closeSync();
  }
  return entries;
}

function validatePackageBudgets(entries, buildInfoTarget, budgetErrors) {
  let normalBytes = 0;
  let blocked = false;
  for (const entry of entries) {
    if (!entry.stat.isFile()) continue;
    const relativePath = path.relative(packageRoot, entry.path).replaceAll(path.sep, "/");
    const exactBuildInfo =
      buildInfoTarget !== null && path.resolve(entry.path) === buildInfoTarget;
    if (exactBuildInfo) continue;
    normalBytes += entry.stat.size;
    if (entry.stat.size > MAX_FILE_BYTES) {
      budgetErrors.push(
        `package resource preflight: file exceeds the ${MAX_FILE_BYTES} byte review limit: ${relativePath}`
      );
      blocked = true;
    }
  }
  if (normalBytes > MAX_TOTAL_BYTES) {
    budgetErrors.push(
      `package resource preflight: normal files exceed the ${MAX_TOTAL_BYTES} byte review limit`
    );
    blocked = true;
  }
  if (blocked) repositoryResourceBlocked = true;
}

function declaredBuildInfoBudgetPath(value) {
  if (value?.stage !== "prototype") return null;
  if (declaredSoliditySourceAndTestPaths(value).length === 0) return null;
  const paths = value.implementation?.compilerBuildInfoPaths;
  if (
    !Array.isArray(paths) ||
    paths.length !== 1 ||
    !safeRepositoryRelativePath(paths[0])
  ) {
    return null;
  }
  return path.resolve(repositoryRoot, paths[0]);
}

function loadTrustedOrderedRemappings() {
  const source = fs.readFileSync(path.join(repositoryRoot, "remappings.txt"), "utf8");
  const validated = new Map(
    parseRemappings(source).map(({ prefix, target }) => [prefix, target])
  );
  const ordered = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    const prefix = line.slice(0, separator).trim();
    ordered.push(`${prefix}=${validated.get(prefix)}`);
  }
  return ordered;
}

function trustedFirstPartyRoots() {
  const packagePath = path.relative(repositoryRoot, packageRoot).replaceAll(path.sep, "/");
  return [...new Set([
    ...TRUSTED_FIRST_PARTY_ROOTS,
    ...(packagePath ? [packagePath] : [])
  ])].sort();
}

function safeRepositoryRelativePath(value) {
  return isCanonicalReviewTargetPath(value);
}

function addToolingBlocker(message) {
  const normalized = `tooling blocked: ${message}`;
  toolingBlockers.push(normalized);
  errors.push(normalized);
}

function repositoryPathResolutionError(error, relativePath) {
  if (
    error?.code === "ENOENT" ||
    /(?:does not exist|no existing ancestor)/i.test(error?.message ?? "")
  ) {
    return `implementation path does not exist: ${relativePath}`;
  }
  if (/symbolic|symlink/i.test(error?.message ?? "")) {
    return `implementation path contains a symbolic link: ${relativePath}`;
  }
  if (/(?:outside|escape)/i.test(error?.message ?? "")) {
    return `implementation path resolves outside repository: ${relativePath}`;
  }
  return `implementation path cannot be resolved: ${relativePath}`;
}

function relative(target) {
  return path.relative(repositoryRoot, target).replaceAll(path.sep, "/");
}

function fail(message, code) {
  console.error(`verify-package: ${message}`);
  process.exit(code);
}
