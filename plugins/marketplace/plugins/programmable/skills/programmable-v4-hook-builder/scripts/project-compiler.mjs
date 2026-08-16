#!/usr/bin/env node

import fs from "node:fs";
import childProcess from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";
import { parseCliOrExit } from "./cli-args.mjs";
import { createStandardV4ProductiveArtifactsV1 } from "./open-world-v2-draft-core.mjs";
import { sha256Bytes } from "./open-world-v2-core.mjs";
import { executeProjectCommands, projectCommandEnvironmentSha256 } from "./project-command-executor-core.mjs";
import { compileProjectBundle, preflightProjectOutput, validateProjectOutput } from "./project-compiler-core.mjs";
import { validateArchitectureCandidates, validateProductGraph, validateProjectSpec } from "./project-contracts-core.mjs";
import { bindLocalReleaseHandoffV1, createNoMarketProjectAuthoring, createProjectStateChain } from "./project-state-core.mjs";
import { authorTradableRepositoryPlan, bindTradableReferenceIntent, createTradableProjectAuthoring, TRADABLE_REFERENCE_PROFILE_ID } from "./project-tradable-authoring-core.mjs";
import { validateRepositoryPlan } from "./repository-completion-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { materializeStandardV4TradeEvidenceV1, renderStandardV4TradeEvidenceRunnerV1 } from "./template-catalog-materializer.mjs";
import { sha256 } from "./template-catalog-shared.mjs";
import { inspectForgeTradeTestRunnerOutputV1, materializeTradableReferenceKernel } from "./v4-deployment-evidence-core.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MAINNET_FORK_CANARY = Object.freeze({
  relativePath: "test/ProgrammableVolumeFeeHookV2MainnetForkCanary.t.sol",
  testName: "testPinnedMainnetRuntimesAndLocalHookRegistration",
  provider: "https://eth.drpc.org",
  blockNumber: 25708543,
  forkBlockNumber: 25708544,
  blockHash: "0x87dd2497fb2c5fba0f2c513fe1b441ae5660e8360bde1be308875be27c336162",
  rawContentSha256: "sha256:3082709a049a0117c3f1ff132529a06f3f6e595eae93c31907936737d9d7ae1f"
});
const MAINNET_FORK_RUNTIMES = Object.freeze([
  Object.freeze({ address: "0x000000000022d473030f116ddee9f6b43ac78ba3", codeByteLength: 9152, codeKeccak256: "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131", id: "permit2" }),
  Object.freeze({ address: "0x000000000004444c5dc75cb358380d2e3de08a90", codeByteLength: 24009, codeKeccak256: "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293", id: "pool-manager" }),
  Object.freeze({ address: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af", codeByteLength: 19499, codeKeccak256: "0x6a5f46971b50c6e1b7eef97902311444e479d734e4f80ad88367783cf373fe7f", id: "universal-router" }),
  Object.freeze({ address: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203", codeByteLength: 5820, codeKeccak256: "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441", id: "v4-quoter" })
]);
const MAINNET_FORK_RAW_RESULT = Object.freeze({
  blockHash: MAINNET_FORK_CANARY.blockHash,
  blockNumber: MAINNET_FORK_CANARY.blockNumber,
  chainId: "1",
  contentSha256: MAINNET_FORK_CANARY.rawContentSha256,
  kind: "mainnet-fork-canary-result",
  evidenceBoundary: Object.freeze({ approvalCreated: false, auditClaimed: false, externalActionsPerformed: Object.freeze([]), productionClaimed: false }),
  localFork: Object.freeze({ canonicalPoolManagerBound: true, forkBlockNumber: MAINNET_FORK_CANARY.forkBlockNumber, hookDeploymentLocalOnly: true, poolRegistrationLocalOnly: true, transactionBroadcast: false }),
  provider: Object.freeze({ credentialMode: "none", networkAccess: "read-only", url: MAINNET_FORK_CANARY.provider }),
  runtimes: MAINNET_FORK_RUNTIMES,
  schemaVersion: "1.0.0",
  status: "LOCAL_READ_ONLY_FORK_EVIDENCE_NOT_APPROVAL"
});

const cli = parseCliOrExit({
  command: "project-compiler",
  usage: "project-compiler <validate|validate-output|preflight|require-output|execute|materialize> [command options]",
  summary: "Validate project phases, cross-bound output, preflight machine artifacts, or execute one reviewed local plan.",
  positionals: { min: 1, max: 1, names: ["command"] },
  options: [
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Existing project repository root." },
    { name: "--state", key: "state", type: "value", valueName: "repository-path", description: "Repository-relative project-state-v1 JSON path." },
    { name: "--previous-state", key: "previousState", type: "value", valueName: "repository-path", description: "Repository-relative preceding checkpoint when sequence is greater than one." },
    { name: "--submission-root", key: "submissionRoot", type: "value", valueName: "repository-path", description: "Repository-relative Open World submission package directory for validate-output." },
    { name: "--plan", key: "plan", type: "value", valueName: "repository-path", description: "Repository-relative materializing repository-plan-v1 JSON path." },
    { name: "--output-plan", key: "outputPlan", type: "value", valueName: "repository-path", description: "New durable completed plan path; must be .programmable/repository-plan.v1.json." },
    { name: "--idea-file", key: "ideaFile", type: "value", valueName: "utf8-file", description: "Exact natural-language idea source for materialize." },
    { name: "--application-id", key: "applicationId", type: "value", valueName: "slug", description: "Application identity for materialize." },
    { name: "--classification", key: "classification", type: "value", valueName: "no-market|tradable", description: "Explicit trade classification for materialize." },
    { name: "--market-ref", key: "marketRef", type: "value", valueName: "slug", description: "Exact selected market identity for tradable materialize." },
    { name: "--reference-profile", key: "referenceProfile", type: "value", valueName: "profile-id", description: "Exact bundled profile requested by tradable materialize." },
    { name: "--source-contract", key: "sourceContract", type: "value", valueName: "mjs-file", description: "Idea-specific local source module for materialize." },
    { name: "--test-source", key: "testSource", type: "value", valueName: "test-mjs-file", description: "Real node:test source for materialize." },
    { name: "--output", key: "output", type: "value", valueName: "new-directory", description: "New repository directory for materialize." },
    { name: "--write", key: "write", type: "boolean", description: "Perform materialization; default is a no-write dry run." }
  ]
});

if (cli.positionals[0] !== "materialize" && cli.options.repositoryRoot === null) failUsage("missing required option --repository-root");

try {
  const repositoryRoot = cli.options.repositoryRoot === null ? null : fs.realpathSync(cli.options.repositoryRoot);
  if (cli.positionals[0] !== "materialize") rejectMaterializeOptions(cli.options);
  if (cli.positionals[0] === "materialize") {
    await materializeProject(cli.options);
  } else if (cli.positionals[0] === "validate") {
    if (cli.options.state === null) failUsage("validate requires --state");
    if (cli.options.submissionRoot !== null || cli.options.plan !== null || cli.options.outputPlan !== null) failUsage("validate does not accept --submission-root, --plan or --output-plan");
    const projectState = readRepositoryJson(repositoryRoot, cli.options.state);
    const previousState = cli.options.previousState === null ? null : readRepositoryJson(repositoryRoot, cli.options.previousState);
    const bound = Object.fromEntries(Object.entries(projectState.artifacts ?? {}).map(([name, binding]) => [
      name,
      binding === null ? undefined : readRepositoryJson(repositoryRoot, binding.path)
    ]));
    const report = compileProjectBundle({ ...bound, projectState, previousState }, { repositoryRoot, verifyRepositoryFiles: true });
    process.stdout.write(`${canonicalJsonV2(report)}\n`);
    if (report.status !== "PROJECT_COMPILATION_VALID") process.exitCode = 1;
  } else if (cli.positionals[0] === "validate-output") {
    if (cli.options.state === null || cli.options.submissionRoot === null) failUsage("validate-output requires --state and --submission-root");
    if (cli.options.plan !== null || cli.options.outputPlan !== null) failUsage("validate-output does not accept --plan or --output-plan");
    const projectState = readRepositoryJson(repositoryRoot, cli.options.state);
    const previousState = cli.options.previousState === null ? null : readRepositoryJson(repositoryRoot, cli.options.previousState);
    const bound = Object.fromEntries(Object.entries(projectState.artifacts ?? {}).map(([name, binding]) => [
      name,
      binding === null ? undefined : readRepositoryJson(repositoryRoot, binding.path)
    ]));
    const report = validateProjectOutput({
      ...bound,
      projectState,
      previousState,
      repositoryRoot,
      submissionRoot: resolveRepositoryDirectory(repositoryRoot, cli.options.submissionRoot)
    });
    process.stdout.write(`${canonicalJsonV2(report)}\n`);
    if (report.status !== "PROJECT_OUTPUT_VALID") process.exitCode = 1;
  } else if (["preflight", "require-output"].includes(cli.positionals[0])) {
    const strict = cli.positionals[0] === "require-output";
    if (cli.options.plan !== null || cli.options.outputPlan !== null) failUsage(`${cli.positionals[0]} does not accept --plan or --output-plan`);
    const hasState = cli.options.state !== null;
    const hasSubmission = cli.options.submissionRoot !== null;
    if (hasState !== hasSubmission) failUsage("preflight accepts --state and --submission-root only together");
    if (!hasState && cli.options.previousState !== null) failUsage(`${cli.positionals[0]} --previous-state requires --state and --submission-root`);
    const report = preflightProjectOutput({
      repositoryRoot,
      statePath: cli.options.state,
      previousStatePath: cli.options.previousState,
      submissionRoot: cli.options.submissionRoot
    });
    process.stdout.write(`${canonicalJsonV2(report)}\n`);
    if (strict ? report.status !== "PROJECT_PREFLIGHT_VALID" : !["PROJECT_PREFLIGHT_VALID", "PROJECT_PREFLIGHT_CLEAR"].includes(report.status)) process.exitCode = 1;
  } else if (cli.positionals[0] === "execute") {
    if (cli.options.plan === null || cli.options.outputPlan === null) failUsage("execute requires --plan and --output-plan");
    if (cli.options.state !== null || cli.options.previousState !== null || cli.options.submissionRoot !== null) failUsage("execute does not accept --state, --previous-state or --submission-root");
    const repositoryPlan = readRepositoryJson(repositoryRoot, cli.options.plan);
    const result = await executeProjectCommands({ repositoryRoot, repositoryPlan, outputPlanPath: cli.options.outputPlan });
    const { repositoryPlan: _repositoryPlan, ...summary } = result;
    process.stdout.write(`${canonicalJsonV2(summary)}\n`);
  } else {
    failUsage(`unknown command ${cli.positionals[0]}`);
  }
} catch (error) {
  const code = typeof error?.code === "string" ? `${error.code}: ` : "";
  process.stderr.write(`project-compiler: ${code}${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}

async function materializeProject(options) {
  const prohibited = [options.repositoryRoot, options.state, options.previousState, options.submissionRoot, options.plan, options.outputPlan];
  if (prohibited.some((value) => value !== null)) failUsage("materialize does not accept repository validation or execution options");
  for (const key of ["ideaFile", "applicationId", "classification", "output"]) if (options[key] === null) failUsage(`materialize requires --${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(options.applicationId) || options.applicationId.length > 120) failUsage("--application-id must be a lowercase slug");
  if (!["no-market", "tradable"].includes(options.classification)) failUsage("--classification must be no-market or tradable");
  const ideaBytes = readInputBytes(options.ideaFile, 1_000_000, "idea file");
  const ideaText = new TextDecoder("utf-8", { fatal: true }).decode(ideaBytes);
  if (ideaText.trim().length === 0) failUsage("--idea-file must contain non-whitespace UTF-8 text");
  const outputRoot = resolveNewOutput(options.output);
  if (options.classification === "tradable") {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(options.marketRef ?? "")) failUsage("tradable materialize requires --market-ref as a lowercase slug");
    if (options.referenceProfile !== TRADABLE_REFERENCE_PROFILE_ID) failUsage(`tradable materialize requires --reference-profile ${TRADABLE_REFERENCE_PROFILE_ID}`);
    if (options.sourceContract !== null || options.testSource !== null) failUsage("tradable materialize does not accept --source-contract or --test-source");
    return materializeTradableProject({ ...options, ideaText, ideaBytes, intentProfileBinding: bindTradableReferenceIntent(ideaText, options.referenceProfile), outputRoot });
  }
  if (options.marketRef !== null) failUsage("no-market materialize does not accept --market-ref");
  if (options.referenceProfile !== null) failUsage("no-market materialize does not accept --reference-profile");
  if (options.sourceContract === null || options.testSource === null) failUsage("no-market materialize requires --source-contract and --test-source");
  const sourceInput = readAuthoredModule(options.sourceContract, false);
  const testInput = readAuthoredModule(options.testSource, true);
  const sourcePath = `src/${sourceInput.basename}`;
  const testPath = `test/${testInput.basename}`;
  const authored = createNoMarketProjectAuthoring({ applicationId: options.applicationId, ideaText, sourcePath, sourceBytes: sourceInput.bytes, testPath, testBytes: testInput.bytes });
  const authoringFindings = [
    ...validateProjectSpec(authored.projectSpec),
    ...validateProductGraph(authored.projectSpec, authored.productGraph),
    ...validateArchitectureCandidates(authored.projectSpec, authored.productGraph, authored.architectureCandidates),
    ...validateRepositoryPlan(authored.projectSpec, authored.productGraph, authored.architectureCandidates, authored.repositoryPlan)
  ];
  if (authoringFindings.some(({ severity }) => severity === "blocker")) throw Object.assign(new Error("generated project artifacts fail bundled validation"), { code: "PROJECT_AUTHORING_INVALID", findings: authoringFindings });
  const inventory = fileInventory(authored.files);
  if (!options.write) {
    const payload = materializationReport({ status: "PROJECT_MATERIALIZATION_DRY_RUN_READY", applicationId: options.applicationId, classification: "no-market", writeRequested: false, writePerformed: false, outputRoot, ideaSha256: authored.projectSpec.intent.sha256, sourcePath, testPath, inventory, blockers: [] });
    process.stdout.write(`${canonicalJsonV2(payload)}\n`);
    return;
  }
  const temporaryRoot = fs.mkdtempSync(path.join(path.dirname(outputRoot), ".programmable-project-materialize-"));
  let exportRoot = null;
  try {
    for (const [relativePath, bytes] of authored.files) writeOutputFile(temporaryRoot, relativePath, bytes);
    writeOutputJson(temporaryRoot, ".programmable/project-spec.v1.json", authored.projectSpec);
    writeOutputJson(temporaryRoot, ".programmable/product-graph.v1.json", authored.productGraph);
    writeOutputJson(temporaryRoot, ".programmable/architecture-candidates.v1.json", authored.architectureCandidates);
    git(temporaryRoot, ["init", "-q", "-b", "main"]);
    git(temporaryRoot, ["config", "user.name", "Programmable Local Builder"]);
    git(temporaryRoot, ["config", "user.email", "local-builder@example.invalid"]);
    git(temporaryRoot, ["add", "."]);
    git(temporaryRoot, ["commit", "-qm", "materialize intent-bound local source"]);
    authored.repositoryPlan.repository.branch = git(temporaryRoot, ["branch", "--show-current"]);
    authored.repositoryPlan.repository.headCommit = git(temporaryRoot, ["rev-parse", "HEAD"]);
    writeOutputJson(temporaryRoot, ".programmable/repository-plan.materializing.v1.json", authored.repositoryPlan);
    const execution = await executeProjectCommands({ repositoryRoot: temporaryRoot, repositoryPlan: authored.repositoryPlan, outputPlanPath: ".programmable/repository-plan.v1.json" });
    fs.unlinkSync(path.join(temporaryRoot, ".programmable/repository-plan.materializing.v1.json"));
    const states = createProjectStateChain({ ...authored, repositoryPlan: execution.repositoryPlan });
    for (const state of states) writeOutputJson(temporaryRoot, `.programmable/project-states/${String(state.sequence).padStart(6, "0")}-${state.phase}.v1.json`, state);
    git(temporaryRoot, ["add", ".programmable"]);
    git(temporaryRoot, ["commit", "-qm", "record deterministic local evidence"]);
    const statePath = ".programmable/project-states/000006-submission-evidence.v1.json";
    const previousStatePath = ".programmable/project-states/000005-verification.v1.json";
    const preflight = preflightProjectOutput({ repositoryRoot: temporaryRoot, statePath, previousStatePath, submissionRoot: "submission" });
    if (preflight.status !== "PROJECT_PREFLIGHT_VALID") throw Object.assign(new Error(`materialized repository fails strict output preflight: ${preflight.findings.map(({ code, path: findingPath }) => `${code}@${findingPath}`).join(",")}`), { code: "PROJECT_MATERIALIZED_PREFLIGHT_INVALID", report: preflight });
    const sourceCommit = execution.repositoryPlan.repository.headCommit;
    const evidenceCommit = git(temporaryRoot, ["rev-parse", "HEAD"]);
    exportRoot = fs.mkdtempSync(path.join(path.dirname(outputRoot), ".programmable-project-export-"));
    git(path.dirname(outputRoot), ["clone", "-q", "--no-hardlinks", temporaryRoot, exportRoot]);
    git(exportRoot, ["remote", "remove", "origin"]);
    const exportedPreflight = preflightProjectOutput({ repositoryRoot: exportRoot, statePath, previousStatePath, submissionRoot: "submission" });
    if (exportedPreflight.status !== "PROJECT_PREFLIGHT_VALID") throw Object.assign(new Error("fresh committed export fails strict output preflight"), { code: "PROJECT_EXPORTED_PREFLIGHT_INVALID", report: exportedPreflight });
    fs.renameSync(exportRoot, outputRoot);
    exportRoot = null;
    const payload = materializationReport({ status: "PROJECT_PREFLIGHT_VALID", operation: "PROJECT_MATERIALIZATION_WRITTEN", applicationId: options.applicationId, classification: "no-market", writeRequested: true, writePerformed: true, outputRoot, ideaSha256: authored.projectSpec.intent.sha256, sourcePath, testPath, inventory: fileInventory(authored.files), sourceCommit, evidenceCommit, statePath, previousStatePath, submissionRoot: "submission", preflightReportSha256: exportedPreflight.reportSha256, blockers: [] });
    process.stdout.write(`${canonicalJsonV2(payload)}\n`);
  } finally {
    if (fs.existsSync(temporaryRoot)) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    if (exportRoot !== null && fs.existsSync(exportRoot)) fs.rmSync(exportRoot, { recursive: true, force: true });
  }
}

async function materializeTradableProject({ applicationId, marketRef, ideaText, ideaBytes, intentProfileBinding, outputRoot, write }) {
  if (!write) {
    process.stdout.write(`${canonicalJsonV2(materializationReport({ status: "PROJECT_MATERIALIZATION_DRY_RUN_READY", applicationId, classification: "tradable", marketRef, writeRequested: false, writePerformed: false, outputRoot, ideaSha256: sha256Bytes(ideaBytes), blockers: [] }))}\n`);
    return;
  }
  const temporaryParent = fs.mkdtempSync(path.join(path.dirname(outputRoot), ".programmable-tradable-materialize-"));
  const repositoryRoot = path.join(temporaryParent, "repository");
  let exportRoot = null;
  try {
    materializeTradableReferenceKernel({ skillRoot, outputRoot: repositoryRoot });
    installProjectDependencies(repositoryRoot);
    writeOutputFile(repositoryRoot, "test/ProgrammableTradeEvidenceRunnerV1.t.sol", Buffer.from(renderStandardV4TradeEvidenceRunnerV1()));
    writeOutputFile(repositoryRoot, MAINNET_FORK_CANARY.relativePath, Buffer.from(renderForkCanary()));
    fs.appendFileSync(path.join(repositoryRoot, ".gitignore"), ".programmable/repository-plan.materializing.v1.json\n");
    const coveragePath = `evidence/fee/${marketRef}.execution-surface-coverage.v1.json`;
    const coverage = { schemaVersion: "1.0.0", kind: "fee-execution-surface-coverage", status: "LOCAL_SOURCE_AND_TEST_COVERAGE_NOT_APPROVAL", applicationId, marketRef, surfaceId: "canonical-uniswap-v4-swap", modes: ["one-for-zero-exact-input", "one-for-zero-exact-output", "zero-for-one-exact-input", "zero-for-one-exact-output"], sourcePaths: ["src/ProgrammableVolumeFeeHookV2.sol", "src/ProgrammableVolumeFeeHookFactoryV2.sol"], testPaths: ["test/ProgrammableVolumeFeeHookV2.t.sol", "test/ProgrammableVolumeFeeHookV2UniversalRouterNative.t.sol", "test/ProgrammableVolumeFeeHookV2UniversalRouterErc20.t.sol", "test/invariant/ProgrammableVolumeFeeHookV2.invariant.t.sol"], evidenceBoundary: { approvalCreated: false, auditClaimed: false, externalActionsPerformed: [], productionClaimed: false } };
    writeOutputJson(repositoryRoot, coveragePath, coverage);
    writeOutputJson(repositoryRoot, ".programmable/project-toolchain-lock.v1.json", projectToolchainLock());
    initLocalGit(repositoryRoot);
    git(repositoryRoot, ["add", "."]); git(repositoryRoot, ["commit", "-qm", "materialize pinned v4 reference source"]);
    const sourceRevision = { revisionObjectId: git(repositoryRoot, ["rev-parse", "HEAD"]), treeObjectId: git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]) };
    const tradeEvidence = materializeStandardV4TradeEvidenceV1({ repositoryRoot, applicationId, marketRef, v4SystemRef: "v4-hook-system", sourceRevision, executionSurfaceCoverage: { evidenceRef: `${marketRef}-execution-surface-coverage`, sha256: sha256Bytes(fs.readFileSync(path.join(repositoryRoot, coveragePath))) }, installDependencies: false, dependencyInstallMode: "network-read-only", createTradeArtifacts: createStandardV4ProductiveArtifactsV1, inspectRunnerOutput: inspectForgeTradeTestRunnerOutputV1, renderForkCanary, inspectForkCanary, commandEnvironmentSha256: projectCommandEnvironmentSha256 });
    const authored = createTradableProjectAuthoring({ applicationId, ideaText, marketRef, repositoryRoot, tradeEvidence, intentProfileBinding });
    bindLocalReleaseHandoffV1({ authored, applicationId, classification: "tradable", marketRef, ideaSha256: authored.projectSpec.intent.sha256, repositoryRoot, tradeEvidence });
    writeOutputJson(repositoryRoot, ".programmable/project-spec.v1.json", authored.projectSpec);
    writeOutputJson(repositoryRoot, ".programmable/product-graph.v1.json", authored.productGraph);
    writeOutputJson(repositoryRoot, ".programmable/architecture-candidates.v1.json", authored.architectureCandidates);
    for (const [relative, bytes] of authored.files) writeOutputFile(repositoryRoot, relative, bytes);
    git(repositoryRoot, ["add", "."]); git(repositoryRoot, ["commit", "-qm", "bind typed local routing and fee evidence"]);
    const repositoryPlan = authorTradableRepositoryPlan({ repositoryRoot, ...authored, tradeEvidence });
    repositoryPlan.repository.branch = git(repositoryRoot, ["branch", "--show-current"]); repositoryPlan.repository.headCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
    writeOutputJson(repositoryRoot, ".programmable/repository-plan.materializing.v1.json", repositoryPlan);
    const planFindings = validateRepositoryPlan(authored.projectSpec, authored.productGraph, authored.architectureCandidates, repositoryPlan);
    if (planFindings.some(({ severity }) => severity === "blocker")) throw Object.assign(new Error(`tradable repository plan is invalid: ${planFindings.map(({ code, path: findingPath }) => `${code}@${findingPath}`).join(",")}`), { code: "TRADABLE_REPOSITORY_PLAN_INVALID", findings: planFindings });
    const execution = await executeProjectCommands({ repositoryRoot, repositoryPlan, outputPlanPath: ".programmable/repository-plan.v1.json" });
    fs.unlinkSync(path.join(repositoryRoot, ".programmable/repository-plan.materializing.v1.json"));
    const states = createProjectStateChain({ ...authored, repositoryPlan: execution.repositoryPlan });
    for (const state of states) writeOutputJson(repositoryRoot, `.programmable/project-states/${String(state.sequence).padStart(6, "0")}-${state.phase}.v1.json`, state);
    git(repositoryRoot, ["add", ".programmable"]); git(repositoryRoot, ["commit", "-qm", "record deterministic local command evidence"]);
    const statePath = ".programmable/project-states/000006-submission-evidence.v1.json", previousStatePath = ".programmable/project-states/000005-verification.v1.json";
    const preflight = preflightProjectOutput({ repositoryRoot, statePath, previousStatePath, submissionRoot: "submission" });
    if (preflight.status !== "PROJECT_PREFLIGHT_VALID") throw Object.assign(new Error(`tradable output preflight failed: ${preflight.findings.map(({ code, path: p }) => `${code}@${p}`).join(",")}`), { code: "TRADABLE_PREFLIGHT_INVALID", report: preflight });
    const evidenceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]), evidenceTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
    exportRoot = fs.mkdtempSync(path.join(path.dirname(outputRoot), ".programmable-project-export-"));
    git(path.dirname(outputRoot), ["clone", "-q", "--no-hardlinks", repositoryRoot, exportRoot]); git(exportRoot, ["remote", "remove", "origin"]);
    const exported = preflightProjectOutput({ repositoryRoot: exportRoot, statePath, previousStatePath, submissionRoot: "submission" });
    if (exported.status !== "PROJECT_PREFLIGHT_VALID") throw Object.assign(new Error("fresh tradable export fails strict preflight"), { code: "TRADABLE_EXPORT_INVALID", report: exported });
    fs.renameSync(exportRoot, outputRoot); exportRoot = null;
    process.stdout.write(`${canonicalJsonV2(materializationReport({ status: "PROJECT_PREFLIGHT_VALID", operation: "PROJECT_MATERIALIZATION_WRITTEN", applicationId, classification: "tradable", marketRef, writeRequested: true, writePerformed: true, outputRoot, ideaSha256: authored.projectSpec.intent.sha256, sourceCommit: sourceRevision.revisionObjectId, sourceTree: sourceRevision.treeObjectId, evidenceCommit, evidenceTree, statePath, previousStatePath, submissionRoot: "submission", preflightReportSha256: exported.reportSha256, tradeStatus: tradeEvidence.status, blockers: [] }))}\n`);
  } finally {
    if (fs.existsSync(temporaryParent)) fs.rmSync(temporaryParent, { recursive: true, force: true });
    if (exportRoot !== null && fs.existsSync(exportRoot)) fs.rmSync(exportRoot, { recursive: true, force: true });
  }
}

export function renderForkCanary() {
  const runtimeNames = { permit2: "PERMIT2", "pool-manager": "POOL_MANAGER", "universal-router": "UNIVERSAL_ROUTER", "v4-quoter": "V4_QUOTER" };
  const solidityNumber = (value) => value >= 10_000 ? String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, "_") : String(value);
  const runtimeAssertions = MAINNET_FORK_RUNTIMES.map(({ id, codeByteLength, codeKeccak256 }) =>
    `        _assertRuntime(${runtimeNames[id]}, ${solidityNumber(codeByteLength)}, ${codeKeccak256});`
  ).join("\n");
  const rawResultLiteral = JSON.stringify(canonicalJsonV2(MAINNET_FORK_RAW_RESULT));
  return `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

${"import"} { Test } from "forge-std/Test.sol";
${"import"} { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
${"import"} { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
${"import"} { ProgrammableVolumeFeeHookFactoryV2 } ${"from"} "../src/ProgrammableVolumeFeeHookFactoryV2.sol";
${"import"} { ProgrammableVolumeFeeHookV2 } ${"from"} "../src/ProgrammableVolumeFeeHookV2.sol";
${"import"} { MockReferenceToken } ${"from"} "./MockReferenceToken.sol";

contract ProgrammableVolumeFeeHookV2MainnetForkCanaryTest is Test {
    bytes32 private constant BLOCK_HASH = ${MAINNET_FORK_CANARY.blockHash};
    string private constant RAW_RESULT =
        ${rawResultLiteral};
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address private constant UNIVERSAL_ROUTER = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;
    address private constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;

    function testPinnedMainnetRuntimesAndLocalHookRegistration() public {
        assertEq(block.chainid, 1, "fork chain mismatch");
        assertEq(block.number, ${solidityNumber(MAINNET_FORK_CANARY.forkBlockNumber)}, "fork block mismatch");
        assertEq(blockhash(${solidityNumber(MAINNET_FORK_CANARY.blockNumber)}), BLOCK_HASH, "fork parent block hash mismatch");
${runtimeAssertions}
        ProgrammableVolumeFeeHookFactoryV2 factory = new ProgrammableVolumeFeeHookFactoryV2();
        MockReferenceToken token = new MockReferenceToken("Fork Canary", "FCAN");
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config =
            ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig({
                poolManager: IPoolManager(POOL_MANAGER),
                currency0: CurrencyLibrary.ADDRESS_ZERO,
                currency1: Currency.wrap(address(token)),
                lpFeePips: 3000,
                tickSpacing: 60,
                quoteCurrency: address(0),
                projectFeeOwner: address(0xBEEF),
                selectedBuyHundredthsOfBip: 30_000,
                selectedSellHundredthsOfBip: 30_000,
                initialSqrtPriceX96: uint160(1) << 96
            });
        (address predicted, bytes32 userSalt) = _mineHook(factory, config);
        (ProgrammableVolumeFeeHookV2 hook, bytes32 poolId, int24 initialTick, bytes32 factoryReceipt) =
            factory.deployAndRegister(userSalt, config);
        assertEq(address(hook), predicted, "mined hook prediction mismatch");
        assertEq(address(hook.poolManager()), POOL_MANAGER, "canonical mainnet PoolManager mismatch");
        assertEq(uint160(address(hook)) & factory.ALL_HOOK_MASK(), factory.REQUIRED_HOOK_FLAGS(), "hook flags mismatch");
        assertTrue(hook.canonicalPoolRegistered(), "canonical pool unregistered");
        assertEq(poolId, hook.canonicalPoolId(), "canonical pool id mismatch");
        assertTrue(poolId != bytes32(0), "canonical pool id missing");
        assertEq(initialTick, 0, "initial tick mismatch");
        assertEq(hook.canonicalPoolInitialTick(), 0, "stored initial tick mismatch");
        assertEq(
            factory.runtimeConfigurationHashOf(address(hook)),
            hook.runtimeConfigurationHash(),
            "runtime receipt mismatch"
        );
        assertTrue(factory.runtimeConfigurationHashOf(address(hook)) != bytes32(0), "runtime receipt missing");
        assertEq(factory.factoryConfigurationHashOf(address(hook)), factoryReceipt, "factory receipt mismatch");
        assertTrue(factoryReceipt != bytes32(0), "factory receipt missing");
        emit log_string(string.concat("PROGRAMMABLE_MAINNET_FORK_CANARY_V1:", RAW_RESULT));
    }

    function _mineHook(
        ProgrammableVolumeFeeHookFactoryV2 factory,
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config
    ) private view returns (address predicted, bytes32 userSalt) {
        for (uint256 candidate; candidate < 1_000_000; ++candidate) {
            userSalt = bytes32(candidate);
            (predicted,,) = factory.predictHookAddress(userSalt, config);
            if ((uint160(predicted) & factory.ALL_HOOK_MASK()) == factory.REQUIRED_HOOK_FLAGS()) {
                return (predicted, userSalt);
            }
        }
        revert("valid mainnet fork hook salt not found");
    }

    function _assertRuntime(address target, uint256 expectedLength, bytes32 expectedCodehash) private view {
        assertEq(target.code.length, expectedLength, "mainnet runtime length mismatch");
        assertEq(target.codehash, expectedCodehash, "mainnet runtime codehash mismatch");
    }
}
`;
}

export function inspectForkCanary(stdout, context = {}) {
  const { marketRef, sourceRevision, sourceTree, sourceArtifactSha256, testArtifact, argv, forgeVersion, providerUriSha256 } = context;
  const objectId = /^(?!0{40}$)[0-9a-f]{40}$/u;
  const digest = /^(?!0{64}$)[0-9a-f]{64}$/u;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(marketRef ?? "")) throw new Error("Fork evidence requires an explicit canonical marketRef.");
  if (!objectId.test(sourceRevision ?? "") || !objectId.test(sourceTree ?? "")) throw new Error("Fork evidence requires exact nonzero lowercase Git commit and tree identities.");
  if (![sourceArtifactSha256, testArtifact?.sha256, providerUriSha256].every((value) => digest.test(value ?? ""))) throw new Error("Fork evidence requires exact non-placeholder source, test and provider SHA-256 identities.");
  if (testArtifact?.path !== MAINNET_FORK_CANARY.relativePath || Object.keys(testArtifact ?? {}).sort().join(",") !== "path,sha256") throw new Error("Fork evidence requires the exact tracked canary test artifact binding.");
  const expectedArgv = ["forge", "test", "--match-path", MAINNET_FORK_CANARY.relativePath, "--match-test", MAINNET_FORK_CANARY.testName, "--fork-url", MAINNET_FORK_CANARY.provider, "--fork-block-number", String(MAINNET_FORK_CANARY.forkBlockNumber), "--json", "-vv"];
  if (canonicalJsonV2(argv) !== canonicalJsonV2(expectedArgv)) throw new Error("Fork evidence argv differs from the frozen read-only canary command.");
  if (providerUriSha256 !== sha256(Buffer.from(MAINNET_FORK_CANARY.provider, "utf8"))) throw new Error("Fork evidence provider URI digest mismatch.");
  const expectedTestSha256 = sha256(Buffer.from(renderForkCanary(), "utf8"));
  if (testArtifact.sha256 !== expectedTestSha256) throw new Error("Fork evidence test source digest mismatch.");
  if (typeof forgeVersion !== "string" || forgeVersion.length === 0 || forgeVersion.length > 500 || forgeVersion.trim() !== forgeVersion || forgeVersion.includes("\u0000")) throw new Error("Fork evidence requires one bounded exact Forge version identity.");

  const parsed = parseBoundedStrictJsonBytes(Buffer.from(stdout, "utf8"));
  const suiteKey = `${MAINNET_FORK_CANARY.relativePath}:ProgrammableVolumeFeeHookV2MainnetForkCanaryTest`;
  if (Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, suiteKey)) throw new Error("Fork canary must report exactly its frozen test suite.");
  const suite = parsed[suiteKey];
  const testKey = `${MAINNET_FORK_CANARY.testName}()`;
  if (Object.keys(suite?.test_results ?? {}).length !== 1 || !Object.hasOwn(suite.test_results, testKey)) throw new Error("Fork canary must report exactly its frozen test.");
  const test = suite.test_results[testKey];
  if (test?.status !== "Success" || test?.reason !== null) throw new Error("Fork canary did not pass without a failure reason.");
  const expectedLog = `PROGRAMMABLE_MAINNET_FORK_CANARY_V1:${canonicalJsonV2(MAINNET_FORK_RAW_RESULT)}`;
  if (!Array.isArray(test.decoded_logs) || test.decoded_logs.length !== 1 || test.decoded_logs[0] !== expectedLog) throw new Error("Fork canary must emit exactly one byte-exact structured observation.");
  const rawResult = parseBoundedStrictJsonBytes(Buffer.from(test.decoded_logs[0].slice("PROGRAMMABLE_MAINNET_FORK_CANARY_V1:".length), "utf8"));
  const { contentSha256: rawContentSha256, ...rawPayload } = rawResult;
  if (rawContentSha256 !== MAINNET_FORK_CANARY.rawContentSha256 || canonicalJsonSha256V2(rawPayload) !== rawContentSha256 || canonicalJsonV2(rawResult) !== canonicalJsonV2(MAINNET_FORK_RAW_RESULT)) throw new Error("Fork canary observation content binding mismatch.");

  const payload = {
    schemaVersion: "1.0.0", kind: "mainnet-fork-canary-evidence", status: "LOCAL_READ_ONLY_FORK_EVIDENCE_NOT_APPROVAL",
    sourceRevision, sourceTree, sourceArtifactSha256,
    testArtifact: { path: testArtifact.path, sha256: testArtifact.sha256 },
    execution: { argv: [...argv], argvSha256: canonicalJsonSha256V2(argv), forgeVersion, providerUriSha256, networkAccess: "read-only", externalWrites: false, transactionBroadcast: false, exitCode: 0, suitesObserved: 1, testsObserved: 1, passedTests: 1, failedTests: 0 },
    observation: rawResult,
    evidenceBoundary: { approvalCreated: false, auditClaimed: false, externalActionsPerformed: [], productionClaimed: false }
  };
  const value = { ...payload, contentSha256: canonicalJsonSha256V2(payload) };
  const bytes = Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8");
  return Object.freeze({ valid: true, evidenceRef: `${marketRef}-mainnet-fork-canary`, path: `evidence/v4/${marketRef}.mainnet-fork-canary.v1.json`, value: Object.freeze(value), bytes, sha256: `sha256:${sha256(bytes)}`, byteLength: bytes.length, rawResult: Object.freeze(rawResult) });
}

function rejectMaterializeOptions(options) {
  if ([options.ideaFile, options.applicationId, options.classification, options.marketRef, options.referenceProfile, options.sourceContract, options.testSource, options.output].some((value) => value !== null) || options.write) failUsage("materialize authoring options are accepted only by the materialize command");
}
function readInputBytes(inputPath, maximumBytes, label) {
  const resolved = path.resolve(inputPath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) throw Object.assign(new Error(`${label} must be a bounded regular non-symlink file`), { code: "PROJECT_AUTHORING_INPUT_INVALID" });
  return fs.readFileSync(resolved);
}
function readAuthoredModule(inputPath, testSource) {
  const bytes = readInputBytes(inputPath, 1_000_000, testSource ? "test source" : "source contract");
  const basename = path.basename(inputPath);
  const pattern = testSource ? /^[a-z0-9]+(?:-[a-z0-9]+)*\.test\.mjs$/u : /^[a-z0-9]+(?:-[a-z0-9]+)*\.mjs$/u;
  if (!pattern.test(basename)) failUsage(testSource ? "--test-source basename must be a lowercase *.test.mjs file" : "--source-contract basename must be a lowercase *.mjs file");
  if (testSource && !bytes.toString("utf8").includes("node:test")) failUsage("--test-source must use node:test");
  return { basename, bytes };
}
function resolveNewOutput(outputPath) {
  const requested = path.resolve(outputPath);
  const parent = fs.realpathSync(path.dirname(requested));
  const resolved = path.join(parent, path.basename(requested));
  if (fs.existsSync(resolved)) throw Object.assign(new Error("--output must name a new directory"), { code: "PROJECT_OUTPUT_EXISTS" });
  return resolved;
}
function writeOutputFile(root, relativePath, bytes) {
  if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) throw Object.assign(new Error("unsafe generated output path"), { code: "PROJECT_OUTPUT_PATH_INVALID" });
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}
function writeOutputJson(root, relativePath, value) {
  writeOutputFile(root, relativePath, Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8"));
}
function initLocalGit(root) {
  const template = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-git-template-"));
  try { git(root, ["-c", `init.templateDir=${template}`, "init", "-q", "-b", "main"]); } finally { fs.rmSync(template, { recursive: true, force: true }); }
  const hooks = path.join(root, ".git", "programmable-empty-hooks"); fs.mkdirSync(hooks);
  for (const [key, value] of [["user.name", "Programmable Local Builder"], ["user.email", "local-builder@example.invalid"], ["core.hooksPath", hooks], ["commit.gpgSign", "false"], ["tag.gpgSign", "false"]]) git(root, ["config", key, value]);
}
function git(root, args) {
  const result = childProcess.spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false, env: { PATH: process.env.PATH ?? "", HOME: path.join(root, ".git", "programmable-home"), LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" } });
  if (result.status !== 0) throw Object.assign(new Error(result.stderr.trim() || `git ${args[0]} failed`), { code: "PROJECT_LOCAL_GIT_FAILED" });
  return result.stdout.trim();
}
function fileInventory(files) {
  return [...files].map(([filePath, bytes]) => ({ path: filePath, sha256: sha256Bytes(bytes), byteLength: bytes.length })).sort((left, right) => left.path.localeCompare(right.path));
}
function installProjectDependencies(repositoryRoot) {
  const isolationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-npm-install-")), cacheRoot = path.join(isolationRoot, "cache"), homeRoot = path.join(isolationRoot, "home"), temporaryRoot = path.join(isolationRoot, "tmp");
  fs.mkdirSync(cacheRoot); fs.mkdirSync(homeRoot); fs.mkdirSync(temporaryRoot);
  try {
    const env = { PATH: process.env.PATH ?? "", CI: "true", HOME: homeRoot, TMPDIR: temporaryRoot, LANG: "C.UTF-8", npm_config_cache: cacheRoot, npm_config_userconfig: path.join(homeRoot, ".npmrc"), npm_config_globalconfig: path.join(homeRoot, "global-npmrc"), npm_config_registry: "https://registry.npmjs.org/" };
    const result = childProcess.spawnSync("npm", ["ci", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund"], { cwd: repositoryRoot, encoding: "utf8", shell: false, timeout: 600000, maxBuffer: 16 * 1024 * 1024, env });
    if (result.error || result.status !== 0) throw Object.assign(new Error(result.error?.message ?? ((result.stderr || result.stdout).slice(-8192) || "npm ci failed")), { code: "PROJECT_DEPENDENCY_INSTALL_FAILED" });
  } finally { fs.rmSync(isolationRoot, { recursive: true, force: true }); }
}
function projectToolchainLock() {
  const forge = resolvedExecutable("forge"), npm = resolvedExecutable("npm"), slither = resolvedExecutable("slither"), compiler17 = resolvedSolc("0.8.17", forge), compiler26 = resolvedSolc("0.8.26", forge);
  const profile = (id, componentRefs, version, compiler, evmTarget, cborMetadata) => ({ id, componentRefs, compilerVersion: version, resolvedCompilerBinarySha256: sha256Bytes(fs.readFileSync(compiler)), evmTarget, optimizer: { enabled: true, runs: 200 }, viaIr: true, bytecodeHash: "none", cborMetadata });
  return { schemaVersion: "1.0.0", platform: { os: process.platform, architecture: process.arch }, tools: [{ id: "forge", version: commandVersion(forge, ["--version"]), resolvedExecutableSha256: sha256Bytes(fs.readFileSync(forge)) }, { id: "node", version: process.version, resolvedExecutableSha256: sha256Bytes(fs.readFileSync(process.execPath)) }, { id: "npm", version: commandVersion(npm, ["--version"]), resolvedExecutableSha256: sha256Bytes(fs.readFileSync(npm)) }, { id: "slither", version: commandVersion(slither, ["--version"]), resolvedExecutableSha256: sha256Bytes(fs.readFileSync(slither)) }], solidityProfiles: [profile("foundry-solc-0-8-17", ["pinned-route-component"], "0.8.17", compiler17, "london", true), profile("foundry-solc-0-8-26", ["service-component", "factory-component", "v4-hook-system", "v4-hook-factory-system"], "0.8.26", compiler26, "cancun", false)] };
}
function resolvedExecutable(command) {
  const result = childProcess.spawnSync("which", [command], { encoding: "utf8", shell: false });
  if (result.status !== 0 || result.stdout.trim().length === 0) throw Object.assign(new Error(`required tool is unresolved: ${command}`), { code: "PROJECT_TOOLCHAIN_UNRESOLVED" });
  const resolved = fs.realpathSync(result.stdout.trim());
  if (!fs.statSync(resolved).isFile()) throw Object.assign(new Error(`required tool is not a regular file: ${command}`), { code: "PROJECT_TOOLCHAIN_UNRESOLVED" });
  return resolved;
}
function resolvedSolc(version, forge) {
  const svmRoot = process.env.SVM_HOME ?? path.join(os.homedir(), process.platform === "darwin" ? "Library/Application Support/svm" : ".svm");
  const forgeHome = path.dirname(path.dirname(path.dirname(forge)));
  const candidates = [path.join(svmRoot, version, `solc-${version}`), path.join(os.homedir(), ".svm", version, `solc-${version}`), path.join(forgeHome, "Library/Application Support/svm", version, `solc-${version}`), path.join(forgeHome, ".svm", version, `solc-${version}`)];
  try { candidates.push(resolvedExecutable("solc")); } catch (error) { if (error?.code !== "PROJECT_TOOLCHAIN_UNRESOLVED") throw error; }
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const resolved = fs.realpathSync(candidate), observed = commandVersion(resolved, ["--version"]);
    if (fs.statSync(resolved).isFile() && observed.includes(`Version: ${version}`)) return resolved;
  }
  throw Object.assign(new Error(`required solc ${version} binary is unresolved`), { code: "PROJECT_TOOLCHAIN_UNRESOLVED" });
}
function commandVersion(executable, argv) {
  const result = childProcess.spawnSync(executable, argv, { encoding: "utf8", shell: false });
  if (result.status !== 0 || result.stdout.trim().length === 0) throw Object.assign(new Error(`tool version is unresolved: ${path.basename(executable)}`), { code: "PROJECT_TOOLCHAIN_UNRESOLVED" });
  return result.stdout.trim().slice(0, 300);
}
function materializationReport(fields) {
  const { outputRoot: _environmentSpecificOutputRoot, ...stableFields } = fields;
  const payload = { schemaVersion: "1.0.0", kind: "project-materialization-report", ...stableFields, outputLocationBound: false, canonicalOutput: fields.status === "PROJECT_PREFLIGHT_VALID", evidenceBoundary: { scope: "local-project-authoring", commandsExecuted: fields.writePerformed, executionPolicy: "declared-per-command-and-external-writes-false", executionIsolationEnforced: false, networkAccessed: null, externalWritesObserved: null, authoredCommandExternalActionsObserved: null, builderExternalActionsPerformed: [], approvalCreated: false, auditClaimed: false, deploymentClaimed: false, productionClaimed: false } };
  return { ...payload, reportSha256: canonicalJsonSha256V2(payload) };
}

function resolveRepositoryDirectory(repositoryRoot, repositoryPath) {
  if (typeof repositoryPath !== "string" || repositoryPath.length === 0 || path.isAbsolute(repositoryPath)) {
    throw new Error("submission root must be non-empty and repository-relative");
  }
  const resolved = path.resolve(repositoryRoot, repositoryPath);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`path escapes repository root: ${repositoryPath}`);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`submission root must be a non-symlink directory: ${repositoryPath}`);
  const real = fs.realpathSync(resolved);
  const realRelative = path.relative(repositoryRoot, real);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error(`path resolves outside repository root: ${repositoryPath}`);
  return real;
}

function readRepositoryJson(repositoryRoot, repositoryPath) {
  if (typeof repositoryPath !== "string" || repositoryPath.length === 0 || path.isAbsolute(repositoryPath)) {
    throw new Error("JSON paths must be non-empty and repository-relative");
  }
  const resolved = path.resolve(repositoryRoot, repositoryPath);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`path escapes repository root: ${repositoryPath}`);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`JSON input must be a regular non-symlink file: ${repositoryPath}`);
  const real = fs.realpathSync(resolved);
  const realRelative = path.relative(repositoryRoot, real);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error(`path resolves outside repository root: ${repositoryPath}`);
  return parseBoundedStrictJsonBytes(fs.readFileSync(real));
}

function failUsage(message) {
  process.stderr.write(`project-compiler: ${message}\n`);
  process.stderr.write("Try 'project-compiler --help' for usage.\n");
  process.exit(2);
}
