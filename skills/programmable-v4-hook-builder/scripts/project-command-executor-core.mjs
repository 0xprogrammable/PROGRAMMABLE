import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runBoundedChildProcess } from "./bounded-child-process-core.mjs";
import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";
import { spawnSafeGitSync } from "./repository-root.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { TRADE_TEST_SEMANTIC_ADEQUACY_V1,
  tradeCapabilityManifestSha256V1, validateTradeCapabilityManifestV1, validateTradeTestResultV1 } from "./trade-capability-manifest-core.mjs";
import { inspectForgeTradeTestRunnerOutputV1, prepareIsolatedSolidityCompilerCacheV1 } from "./v4-deployment-evidence-core.mjs";
export const PROJECT_COMMAND_EXECUTOR_ID = "programmable-project-command-executor";
export const PROJECT_COMMAND_EXECUTOR_VERSION = "1.0.0";
export const PROJECT_COMMAND_ENVIRONMENT_PROFILE = "sanitized-local-v1";
export const PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES = 8 * 1024 * 1024, PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const executorModulePath = fileURLToPath(import.meta.url);
const runnerModulePath = path.join(moduleDirectory, "bounded-child-process-core.mjs");
const emptySha256 = sha256Bytes(Buffer.alloc(0));
const shellExecutables = new Set([
  "bash", "cmd", "cmd.exe", "dash", "fish", "ksh", "powershell", "powershell.exe", "pwsh", "sh", "zsh"
]);
const trivialExecutables = new Set(["echo", "false", "printf", "pwd", "true", "whoami"]);
const credentialFlags = new Set(["--api-key", "--mnemonic", "--password", "--private-key", "--secret", "--token"]);
export class ProjectCommandExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProjectCommandExecutionError";
    this.code = code;
    Object.assign(this, details);
  }
}
export function projectCommandExecutionPlanSha256(repositoryPlan) {
  const artifacts = Object.fromEntries(Object.entries(coalesce(repositoryPlan?.artifacts, {})).map(([group, records]) => [
    group,
    coalesce(records, []).map((record) => ["command-receipt", "trade-test-result"].includes(record?.kind)
      ? { ...record, status: "planned", sha256: null, byteLength: null }
      : record)
  ]));
  return canonicalJsonSha256V2({
    schemaVersion: coalesce(repositoryPlan?.schemaVersion, null),
    applicationId: coalesce(repositoryPlan?.applicationId, null),
    revision: coalesce(repositoryPlan?.revision, null),
    projectSpecSha256: coalesce(repositoryPlan?.projectSpecSha256, null),
    architectureCandidatesSha256: coalesce(repositoryPlan?.architectureCandidatesSha256, null),
    productGraphSha256: coalesce(repositoryPlan?.productGraphSha256, null),
    selectedArchitectureId: coalesce(repositoryPlan?.selectedArchitectureId, null),
    repository: coalesce(repositoryPlan?.repository, null),
    completionStatus: "materializing",
    artifacts,
    tradeCapability: coalesce(repositoryPlan?.tradeCapability, null),
    v4HookSemanticContracts: coalesce(repositoryPlan?.v4HookSemanticContracts, []),
    commands: coalesce(repositoryPlan?.commands, []),
    commandResults: [],
    completionClaim: coalesce(repositoryPlan?.completionClaim, null),
    authorization: coalesce(repositoryPlan?.authorization, null)
  });
}
export function projectCommandExecutorIdentity() {
  return Object.freeze({
    id: PROJECT_COMMAND_EXECUTOR_ID,
    version: PROJECT_COMMAND_EXECUTOR_VERSION,
    modulePath: "scripts/project-command-executor-core.mjs",
    moduleSha256: sha256RegularFile(executorModulePath),
    runnerModulePath: "scripts/bounded-child-process-core.mjs",
    runnerModuleSha256: sha256RegularFile(runnerModulePath)
  });
}
export function inspectCleanProjectSource(repositoryRoot) {
  const root = fs.realpathSync(repositoryRoot);
  const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
  if (!topLevel.ok || fs.realpathSync(topLevel.output) !== root) {
    throw executionError("PROJECT_SOURCE_ROOT_INVALID", "repository root must be the exact Git worktree root");
  }
  const headCommit = requiredGit(root, ["rev-parse", "HEAD"], "PROJECT_SOURCE_HEAD_UNAVAILABLE");
  const tree = requiredGit(root, ["rev-parse", "HEAD^{tree}"], "PROJECT_SOURCE_TREE_UNAVAILABLE");
  const status = requiredGit(root, ["status", "--porcelain=v1", "--untracked-files=all"], "PROJECT_SOURCE_STATUS_UNAVAILABLE");
  if (status !== "") throw executionError("PROJECT_SOURCE_DIRTY", "project command execution requires a clean Git worktree", { porcelain: status.split("\n").slice(0, 32) });
  const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (all(!branch.ok, branch.status !== 1)) throw executionError("PROJECT_SOURCE_BRANCH_UNAVAILABLE", "project source branch cannot be resolved", { error: branch.error });
  return Object.freeze({ headCommit, tree, branch: branch.ok ? branch.output : null, gitStatusSha256: emptySha256 });
}
export function resolveProjectCommandCwd(repositoryRoot, repositoryCwd) {
  const root = fs.realpathSync(repositoryRoot);
  if (typeof repositoryCwd !== "string" || repositoryCwd.length === 0 || path.isAbsolute(repositoryCwd)) {
    throw executionError("PROJECT_COMMAND_CWD_INVALID", "command cwd must be repository-relative");
  }
  let current = root;
  for (const segment of repositoryCwd === "." ? [] : repositoryCwd.split("/")) {
    if (any(segment === "", segment === ".", segment === "..", segment.includes("\\"))) {
      throw executionError("PROJECT_COMMAND_CWD_INVALID", "command cwd contains an unsafe path segment");
    }
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw executionError("PROJECT_COMMAND_CWD_SYMLINK", "command cwd must not traverse a symbolic link", { cwd: repositoryCwd });
    if (!stat.isDirectory()) throw executionError("PROJECT_COMMAND_CWD_INVALID", "command cwd must resolve to a directory", { cwd: repositoryCwd });
  }
  return current;
}
export function resolveProjectCommandTool(requested, cwd, environmentPath = coalesce(process.env.PATH, "")) {
  if (typeof requested !== "string" || requested.length === 0 || requested.includes("\0")) {
    throw executionError("PROJECT_COMMAND_TOOL_INVALID", "command executable is invalid");
  }
  const candidates = [];
  if (path.isAbsolute(requested)) candidates.push(requested);
  else if (any(requested.includes("/"), requested.includes("\\"))) candidates.push(path.resolve(cwd, requested));
  else {
    const extensions = process.platform === "win32" ? coalesce(process.env.PATHEXT, ".EXE;.CMD;.BAT;.COM").split(";") : [""];
    for (const directory of environmentPath.split(path.delimiter).filter(Boolean)) {
      for (const extension of extensions) candidates.push(path.join(directory, `${requested}${extension}`));
    }
  }
  for (const candidate of candidates) {
    try {
      const stat = fs.lstatSync(candidate);
      if (all(!stat.isFile(), !stat.isSymbolicLink())) continue;
      const resolvedPath = fs.realpathSync(candidate);
      const resolvedStat = fs.lstatSync(resolvedPath);
      if (any(!resolvedStat.isFile(), resolvedStat.isSymbolicLink())) continue;
      return Object.freeze({ requested, resolvedPath, byteLength: resolvedStat.size, sha256: sha256RegularFile(resolvedPath) });
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error?.code)) throw error;
    }
  }
  throw executionError("PROJECT_COMMAND_TOOL_UNRESOLVED", `command executable cannot be resolved: ${requested}`);
}
export function validateProjectCommandSafety(command) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  if (!isPlainObject(command)) return [{ code: "PROJECT_COMMAND_INVALID", message: "command must be an object" }];
  if (!Array.isArray(command.argv) || command.argv.length === 0 || command.argv.some((argument) => typeof argument !== "string" || argument.length === 0 || argument.includes("\0"))) {
    return [{ code: "PROJECT_COMMAND_ARGV_INVALID", message: "command argv must be a non-empty string array" }];
  }
  if (!isPlainObject(command.executionPolicy)
    || Object.keys(command.executionPolicy).sort().join("\0") !== ["externalWrites", "networkAccess"].sort().join("\0")
    || command.executionPolicy.externalWrites !== false
    || !["forbidden", "read-only"].includes(command.executionPolicy.networkAccess)) {
    add("PROJECT_COMMAND_POLICY_INVALID", "command executionPolicy must forbid external writes and declare bounded network access");
  }
  const executable = path.basename(command.argv[0]).toLowerCase();
  const args = command.argv.slice(1);
  const first = coalesce(args[0], "").toLowerCase();
  if (shellExecutables.has(executable)) add("PROJECT_COMMAND_SHELL_FORBIDDEN", "shell interpreters are forbidden in repository plans");
  if (any(trivialExecutables.has(executable),
    all(args.length <= 1, ["--help", "--version", "-h", "-v", "help", "version"].includes(first)),
    looksLikeTrivialInlineProgram(executable, args))) {
    add("PROJECT_COMMAND_NOOP_FORBIDDEN", "version, help, echo, and trivial exit commands cannot prove a repository gate");
  }
  if (args.some((argument) => any(credentialFlags.has(argument.toLowerCase()), argument.toLowerCase() === "--broadcast"))) {
    add("PROJECT_COMMAND_EXTERNAL_WRITE_FLAG_FORBIDDEN", "credential and external-write flags are forbidden");
  }
  if (externalMutationCommand(executable, args)) add("PROJECT_COMMAND_EXTERNAL_MUTATION_FORBIDDEN", "the planned command can mutate an external system");
  if (all(command.kind === "install", packageInstallRunsLifecycleScripts(executable, args))) {
    add("PROJECT_COMMAND_INSTALL_SCRIPTS_FORBIDDEN", "dependency installation must disable package lifecycle scripts");
  }
  return issues;
}
export function projectCommandSignature(command) {
  return canonicalJsonSha256V2({ argv: coalesce(command?.argv, null), cwd: coalesce(command?.cwd, null) });
}
export function projectCommandEnvironmentSha256(command) {
  return canonicalJsonSha256V2({
    contract: "project-command-environment-v1", shell: false,
    environmentProfile: PROJECT_COMMAND_ENVIRONMENT_PROFILE, credentialsInherited: false,
    externalWrites: coalesce(command?.executionPolicy?.externalWrites, null),
    networkAccess: coalesce(command?.executionPolicy?.networkAccess, null),
    maximumOutputBytes: projectCommandMaximumOutputBytes(command)
  });
}
export function projectCommandMaximumOutputBytes(command) { return ["quote-test", "execution-test"].includes(command?.kind) ? PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES : PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES; }
export function createProjectCommandReceipt({ repositoryPlan, command, source, tool, executionResult, maximumOutputBytes, domainEvidence = null, tradeExecution = null }) {
  const rawStdout = Buffer.from(executionResult.stdout, "utf8");
  const normalized = normalizeValidatedTradeReceiptOutput(rawStdout, command, tradeExecution, domainEvidence);
  const stdout = normalized.stdout;
  const stderr = Buffer.from(executionResult.stderr, "utf8");
  const payload = {
    schemaVersion: "1.0.0",
    kind: "programmable-project-command-receipt",
    executor: projectCommandExecutorIdentity(),
    executionPolicy: {
      shell: false,
      environmentProfile: PROJECT_COMMAND_ENVIRONMENT_PROFILE,
      credentialsInherited: false,
      externalWrites: command.executionPolicy.externalWrites,
      networkAccess: command.executionPolicy.networkAccess,
      maximumOutputBytes
    },
    source: {
      ...source,
      executionPlanSha256: projectCommandExecutionPlanSha256(repositoryPlan),
      commandsSha256: canonicalJsonSha256V2(repositoryPlan.commands),
      commandSha256: canonicalJsonSha256V2(command)
    },
    commandId: command.id,
    commandKind: command.kind,
    argv: command.argv,
    argvSha256: canonicalJsonSha256V2(command.argv),
    cwd: command.cwd,
    timeoutMs: command.timeoutMs,
    tool,
    status: "passed",
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputExceeded: false,
    stdoutSha256: sha256Bytes(stdout),
    stdoutByteLength: stdout.length,
    stderrSha256: sha256Bytes(stderr),
    stderrByteLength: stderr.length,
    domainEvidence: normalized.domainEvidence,
    networkAccessed: null,
    externalActionsPerformed: []
  };
  return Object.freeze({ ...payload, receiptSha256: canonicalJsonSha256V2(payload) });
}
function normalizeValidatedTradeReceiptOutput(raw, command, execution, evidence) {
  if (execution === null) return { stdout: raw, domainEvidence: evidence };
  if (!['quote-test', 'execution-test'].includes(command.kind)) throw executionError('TRADE_RECEIPT_NORMALIZATION_INVALID', `trade command ${command.id} has an invalid kind`);
  if (!isPlainObject(evidence?.runnerEvidence) || canonicalJsonSha256V2(execution.runnerEvidence) !== canonicalJsonSha256V2(evidence.runnerEvidence)) throw executionError('TRADE_RECEIPT_NORMALIZATION_INVALID', `trade command ${command.id} lacks validated runner evidence`);
  if (execution.runnerEvidence.runnerOutputSha256 !== sha256Bytes(raw) || execution.runnerEvidence.runnerOutputByteLength !== raw.length) throw executionError('TRADE_RECEIPT_NORMALIZATION_DRIFT', `trade command ${command.id} raw parser binding drifted`);
  let output;
  try { output = parseBoundedStrictJsonBytes(raw, { maxSourceBytes: PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES, maxNodes: 5_000_000 }); } catch (error) { throw executionError('TRADE_RECEIPT_NORMALIZATION_INVALID', `trade command ${command.id} stdout cannot be normalized`, { cause: error.code }); }
  const [[suiteName, suite]] = Object.entries(output);
  const [[testSignature, observed]] = Object.entries(suite.test_results);
  const logPrefix = 'PROGRAMMABLE_TRADE_RESULT_V1:';
  const resultLog = `${logPrefix}${canonicalJsonV2(execution.result)}`;
  const observedResultLogs = observed.decoded_logs.filter((value) => value?.startsWith?.(logPrefix) === true).map((value) => value.replace(/\n$/u, ''));
  const expectedIdentity = { testSignature: execution.runnerEvidence.testSignature, status: 'Success', unitGas: execution.runnerEvidence.unitGas, decodedResultLogs: [resultLog] };
  if (canonicalJsonSha256V2({ testSignature, status: observed.status, unitGas: observed.kind.Unit.gas, decodedResultLogs: observedResultLogs }) !== canonicalJsonSha256V2(expectedIdentity)) throw executionError('TRADE_RECEIPT_NORMALIZATION_DRIFT', `trade command ${command.id} suite, test, status, gas, or result log drifted`);
  const stdout = Buffer.from(`${canonicalJsonV2({ contract: 'forge-trade-stdout-identity-v1', suiteName, ...expectedIdentity, callEvidence: execution.runnerEvidence.callEvidence })}\n`, 'utf8');
  const runnerEvidence = { ...evidence.runnerEvidence, runnerOutputSha256: sha256Bytes(stdout), runnerOutputByteLength: stdout.length };
  return { stdout, domainEvidence: Object.freeze({ ...evidence, runnerEvidence: Object.freeze(runnerEvidence) }) };
}
export async function executeProjectCommands({ repositoryRoot, repositoryPlan, outputPlanPath }) {
  const root = normalizeRoot(repositoryRoot);
  const source = inspectCleanProjectSource(root);
  assertProjectSourceBinding(source, repositoryPlan);
  const context = validateExecutionPreconditions(root, repositoryPlan, outputPlanPath);
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-command-"));
  const receipts = [];
  try {
    prepareIsolatedSolidityCompilerCacheV1(temporaryHome);
    const environment = sanitizedExecutionEnvironment(temporaryHome);
    for (const command of repositoryPlan.commands) {
      const tradeContext = coalesce(context.tradeTestsByCommand.get(command.id), null);
      const maximumOutputBytes = projectCommandMaximumOutputBytes(command);
      const before = inspectCleanProjectSource(root);
      assertSameProjectSource(source, before);
      const cwd = resolveProjectCommandCwd(root, command.cwd);
      const tool = resolveProjectCommandTool(command.argv[0], cwd, environment.PATH);
      let result;
      try {
        result = await runBoundedChildProcess({
          command: tool.resolvedPath,
          args: command.argv.slice(1),
          cwd,
          env: environment,
          timeoutMs: command.timeoutMs,
          maximumOutputBytes
        });
      } catch (error) {
        throw executionError("PROJECT_COMMAND_SPAWN_FAILED", `command ${command.id} could not start`, { commandId: command.id, cause: error.message });
      }
      const after = inspectCleanProjectSource(root);
      assertSameProjectSource(source, after);
      if (result.timedOut) throw executionError("PROJECT_COMMAND_TIMEOUT", `command ${command.id} exceeded ${command.timeoutMs}ms`, { commandId: command.id });
      if (result.outputExceeded) throw executionError("PROJECT_COMMAND_OUTPUT_LIMIT", `command ${command.id} exceeded the output limit`, { commandId: command.id });
      if (any(result.status !== 0, result.signal !== null)) {
        throw executionError("PROJECT_COMMAND_FAILED", `command ${command.id} failed`, { commandId: command.id, exitCode: result.status, signal: result.signal });
      }
      const tradeExecution = tradeContext === null ? null : parseTradeCommandResult(result.stdout, command, tradeContext, repositoryPlan.applicationId);
      const tradeResult = tradeExecution?.result ?? null;
      const domainEvidence = tradeExecution === null ? null : createTradeDomainEvidence(tradeExecution, tradeContext);
      const receipt = createProjectCommandReceipt({
        repositoryPlan,
        command,
        source,
        tool,
        executionResult: result,
        maximumOutputBytes,
        domainEvidence,
        tradeExecution
      });
      receipts.push({ command, receipt, artifact: context.receiptArtifacts.get(command.id), tradeResult, resultArtifact: coalesce(tradeContext?.resultArtifact, null) });
    }
    verifyBoundArtifacts(root, context.boundArtifacts);
    assertSameProjectSource(source, inspectCleanProjectSource(root));
    const completedPlan = materializeCompletedPlan(repositoryPlan, receipts);
    const writtenPaths = [];
    try {
      for (const { resultArtifact, tradeResult } of receipts.filter(({ tradeResult }) => tradeResult !== null)) {
        writeNewRepositoryJson(root, resultArtifact.path, tradeResult);
        writtenPaths.push(resultArtifact.path);
      }
      for (const { artifact, receipt } of receipts) {
        writeNewRepositoryJson(root, artifact.path, receipt);
        writtenPaths.push(artifact.path);
      }
      writeNewRepositoryJson(root, outputPlanPath, completedPlan);
      writtenPaths.push(outputPlanPath);
      verifyPendingEvidencePaths(root, writtenPaths);
    } catch (error) {
      removeExecutorFiles(root, writtenPaths);
      throw error;
    }
    return Object.freeze({
      status: "PROJECT_COMMAND_EVIDENCE_READY_TO_COMMIT",
      executionPlanSha256: projectCommandExecutionPlanSha256(repositoryPlan),
      source,
      outputPlanPath,
      receiptPaths: receipts.map(({ artifact }) => artifact.path),
      tradeResultPaths: receipts.filter(({ tradeResult }) => tradeResult !== null).map(({ resultArtifact }) => resultArtifact.path),
      commandResults: completedPlan.commandResults,
      repositoryPlan: completedPlan,
      networkAccessed: null,
      externalActionsPerformed: [],
      approvalCreated: false,
      auditClaimed: false,
      deploymentClaimed: false,
      productionClaimed: false
    });
  } finally {
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
}
function parseTradeCommandResult(stdout, command, context, applicationId) {
  const inspection = inspectForgeTradeTestRunnerOutputV1(stdout, context.test, command.id, { maxSourceBytes: PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES, maxNodes: 5_000_000 });
  if (!inspection.valid) throw executionError(inspection.error.code, inspection.error.message, inspection.error);
  const execution = inspection.execution;
  const value = execution.result;
  const semanticFindings = validateTradeTestResultV1(value, { manifest: context.manifest, test: context.test });
  if (semanticFindings.length > 0) throw executionError(semanticFindings[0].code, semanticFindings[0].message, { commandId: command.id, finding: semanticFindings[0] });
  const expectedContract = command.kind === "quote-test" ? "trade-quote-test-result-v1" : "trade-execution-test-result-v1";
  const { contentSha256, ...preimage } = coalesce(value, {});
  if (any(value?.contract !== expectedContract, value?.status !== "LOCAL_EVIDENCE_NOT_APPROVAL", contentSha256 !== canonicalJsonSha256V2(preimage))) throw executionError("TRADE_TEST_RESULT_CONTRACT_INVALID", `trade command ${command.id} emitted an invalid typed result contract`);
  const expectedIdentity = { applicationId, marketRef: context.market.marketSystemRef, testId: context.test.id, commandId: command.id };
  if (any(canonicalJsonSha256V2(value.identity) !== canonicalJsonSha256V2(expectedIdentity),
    value.context?.manifestSha256 !== context.manifestSha256,
    value.context?.mode?.id !== context.test.modeRef)) throw executionError("TRADE_TEST_RESULT_BINDING_MISMATCH", `trade result ${command.id} is not bound to its manifest, market, test, and mode`);
  if (all(command.kind === "execution-test", any(value.scenario !== context.test.scenario, value.outcome !== (context.test.expectedOutcome === "swap-succeeds" ? "swap-succeeded" : "reverted-before-effects")))) throw executionError("TRADE_TEST_RESULT_OUTCOME_MISMATCH", `trade execution result ${command.id} does not match its declared scenario`);
  return execution;
}
function createTradeDomainEvidence(execution, context) {
  const { result, runnerEvidence } = execution;
  const bytes = Buffer.from(`${canonicalJsonV2(result)}\n`, "utf8");
  return Object.freeze({
    contract: "trade-command-domain-evidence-v1",
    manifestArtifactId: context.manifestArtifact.id,
    manifestSha256: context.manifestSha256,
    marketRef: context.market.marketSystemRef,
    testId: context.test.id,
    modeRef: context.test.modeRef,
    semanticAdequacy: TRADE_TEST_SEMANTIC_ADEQUACY_V1,
    runnerEvidence,
    resultContract: result.contract,
    resultArtifactId: context.resultArtifact.id,
    resultArtifactPath: context.resultArtifact.path,
    resultArtifactSha256: sha256Bytes(bytes),
    resultArtifactByteLength: bytes.length
  });
}
function validateExecutionPreconditions(root, repositoryPlan, outputPlanPath) {
  if (any(!isPlainObject(repositoryPlan), repositoryPlan?.completionStatus !== "materializing")) {
    throw executionError("PROJECT_EXECUTION_PLAN_INVALID", "executor requires a materializing repository plan");
  }
  if (any(!Array.isArray(repositoryPlan.commands), repositoryPlan.commands.length === 0, coalesce(repositoryPlan.commandResults, []).length !== 0)) {
    throw executionError("PROJECT_EXECUTION_PLAN_INVALID", "executor requires commands with no pre-existing command results");
  }
  if (outputPlanPath !== ".programmable/repository-plan.v1.json") {
    throw executionError("PROJECT_EXECUTION_OUTPUT_PATH_INVALID", "completed repository plan must use .programmable/repository-plan.v1.json");
  }
  if (any(repositoryPlan.completionClaim?.externalActionsPerformed?.length !== 0,
    Object.values(coalesce(repositoryPlan.authorization, {})).some((value) => value !== false))) {
    throw executionError("PROJECT_EXECUTION_AUTHORITY_INVALID", "local command execution cannot carry external authorization");
  }
  const signatures = new Map();
  for (const command of repositoryPlan.commands) {
    if (command?.required !== true) throw executionError("PROJECT_COMMAND_OPTIONAL_FORBIDDEN", `command ${coalesce(command?.id, "<unknown>")} must be required`);
    const issues = validateProjectCommandSafety(command);
    if (issues.length > 0) throw executionError(issues[0].code, `${command.id}: ${issues[0].message}`, { commandId: command.id, issues });
    const signature = projectCommandSignature(command);
    if (signatures.has(signature)) {
      throw executionError("PROJECT_COMMAND_REPEATED", `commands ${signatures.get(signature)} and ${command.id} repeat the same argv and cwd`);
    }
    signatures.set(signature, command.id);
  }
  const artifacts = Object.values(coalesce(repositoryPlan.artifacts, {})).flat();
  const receiptArtifacts = new Map();
  const tradeResultArtifacts = new Map();
  const boundArtifacts = [];
  for (const artifact of artifacts) {
    if (!["command-receipt", "trade-test-result"].includes(artifact?.kind)) {
      boundArtifacts.push(artifact);
      continue;
    }
    const isReceipt = artifact.kind === "command-receipt";
    const suffix = isReceipt ? "-receipt" : "-result";
    if (any(typeof artifact.id !== "string", !String(coalesce(artifact.id, "")).endsWith(suffix))) {
      throw executionError(isReceipt ? "PROJECT_RECEIPT_ARTIFACT_INVALID" : "TRADE_RESULT_ARTIFACT_INVALID", `${artifact.kind} artifact id must end in ${suffix}`);
    }
    const commandId = artifact.id.slice(0, -suffix.length);
    const expectedPath = isReceipt
      ? `.programmable/command-receipts/${commandId}.v1.json`
      : `.programmable/trade-test-results/${commandId}.v1.json`;
    if (any(artifact.path !== expectedPath, artifact.status !== "planned", artifact.sha256 !== null, artifact.byteLength !== null)) {
      throw executionError(isReceipt ? "PROJECT_RECEIPT_ARTIFACT_INVALID" : "TRADE_RESULT_ARTIFACT_INVALID", `${artifact.kind} artifact ${artifact.id} must be an unmaterialized canonical path`);
    }
    const target = isReceipt ? receiptArtifacts : tradeResultArtifacts;
    if (target.has(commandId)) throw executionError(isReceipt ? "PROJECT_RECEIPT_ARTIFACT_DUPLICATE" : "TRADE_RESULT_ARTIFACT_DUPLICATE", `command ${commandId} has duplicate ${artifact.kind} artifacts`);
    target.set(commandId, artifact);
  }
  for (const command of repositoryPlan.commands) {
    if (!receiptArtifacts.has(command.id)) throw executionError("PROJECT_RECEIPT_ARTIFACT_MISSING", `command ${command.id} needs a planned receipt artifact`);
  }
  if (receiptArtifacts.size !== repositoryPlan.commands.length) {
    throw executionError("PROJECT_RECEIPT_ARTIFACT_ORPHAN", "repository plan contains a receipt artifact without a command");
  }
  const tradeCommandIds = new Set(repositoryPlan.commands.filter(({ kind }) => ["quote-test", "execution-test"].includes(kind)).map(({ id }) => id));
  if (any(tradeResultArtifacts.size !== tradeCommandIds.size, [...tradeResultArtifacts.keys()].some((id) => !tradeCommandIds.has(id)))) {
    throw executionError("TRADE_RESULT_ARTIFACT_CARDINALITY_INVALID", "each quote-test and execution-test command needs one canonical result artifact and no other command may have one");
  }
  verifyBoundArtifacts(root, boundArtifacts);
  for (const artifact of receiptArtifacts.values()) assertNewEvidencePath(root, artifact.path);
  for (const artifact of tradeResultArtifacts.values()) assertNewEvidencePath(root, artifact.path);
  assertNewEvidencePath(root, outputPlanPath);
  const tradeTestsByCommand = buildTradeExecutionContexts(root, repositoryPlan, artifacts, tradeResultArtifacts);
  return { receiptArtifacts, tradeResultArtifacts, tradeTestsByCommand, boundArtifacts };
}
function buildTradeExecutionContexts(root, repositoryPlan, artifacts, tradeResultArtifacts) {
  const result = new Map();
  const disposition = repositoryPlan.tradeCapability?.applicability;
  const specialCommands = repositoryPlan.commands.filter(({ kind }) => ["quote-test", "execution-test"].includes(kind));
  if (disposition !== "tradable") {
    if (specialCommands.length + tradeResultArtifacts.size !== 0) throw executionError("NO_MARKET_TRADE_EVIDENCE_FORBIDDEN", "only a tradable plan may execute trade tests");
    return result;
  }
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const byPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
  const commands = new Map(repositoryPlan.commands.map((command) => [command.id, command]));
  for (const market of repositoryPlan.tradeCapability.markets) {
    const manifestArtifact = byId.get(market.manifestArtifactId);
    if (manifestArtifact?.kind !== "trade-capability-manifest") throw executionError("TRADE_CAPABILITY_MANIFEST_REQUIRED", `market ${market.marketSystemRef} needs its declared manifest artifact`);
    const manifestBytes = fs.readFileSync(resolveRepositoryPath(root, manifestArtifact.path));
    let manifest;
    try {
      manifest = parseBoundedStrictJsonBytes(manifestBytes);
    } catch (error) {
      throw executionError("TRADE_CAPABILITY_MANIFEST_JSON_INVALID", error.message, { marketRef: market.marketSystemRef, cause: error.code });
    }
    if (manifestBytes.toString("utf8") !== `${canonicalJsonV2(manifest)}\n`) throw executionError("TRADE_CAPABILITY_MANIFEST_NOT_CANONICAL", `manifest ${manifestArtifact.id} must use canonical JSON plus one newline`);
    const manifestFindings = validateTradeCapabilityManifestV1(manifest, { applicationId: repositoryPlan.applicationId, marketRef: market.marketSystemRef, routeType: market.routeType });
    if (manifestFindings.length > 0) throw executionError(manifestFindings[0].code, manifestFindings[0].message, { finding: manifestFindings[0] });
    assertTradeManifestSourceBindings(manifest, manifestArtifact, byPath);
    if (any(manifest.applicationId !== repositoryPlan.applicationId, manifest.marketRef !== market.marketSystemRef, manifest.manifestId !== manifestArtifact.id, manifest.route?.type !== market.routeType, manifest.status !== "NOT_APPROVED")) {
      throw executionError("TRADE_CAPABILITY_MANIFEST_BINDING_INVALID", `manifest ${manifestArtifact.id} does not bind its plan market and non-approval status`);
    }
    const manifestSha256 = tradeCapabilityManifestSha256V1(manifest);
    for (const [collection, kind, ids] of [[manifest.testEvidence?.quoteTests, "quote-test", market.quoteCommandIds], [manifest.testEvidence?.executionTests, "execution-test", market.executionCommandIds]]) {
      const tests = Array.isArray(collection) ? collection : [];
      if (canonicalJsonV2(tests.map(({ commandId }) => commandId).sort()) !== canonicalJsonV2([...ids].sort())) throw executionError("TRADE_COMMAND_BINDING_INVALID", `manifest ${manifestArtifact.id} ${kind} commands do not match RepositoryPlan`);
      for (const test of tests) {
        const command = commands.get(test.commandId);
        const resultArtifact = tradeResultArtifacts.get(test.commandId);
        const sourceArtifact = byPath.get(test.testSourceArtifact?.path);
        if (command?.kind !== kind || canonicalJsonV2(command.argv) !== canonicalJsonV2(test.command?.argv) || command.cwd !== test.command?.workingDirectory) throw executionError("TRADE_COMMAND_BINDING_INVALID", `trade test ${test.id} command does not match its executable plan`);
        if (test.command?.environmentSha256 !== projectCommandEnvironmentSha256(command)) throw executionError("TRADE_TEST_ENVIRONMENT_BINDING_INVALID", `trade test ${test.id} does not bind the executor environment profile`);
        if (!resultArtifact || resultArtifact.path !== test.resultArtifactPath || byPath.get(test.resultArtifactPath)?.id !== resultArtifact.id) throw executionError("TRADE_RESULT_ARTIFACT_BINDING_INVALID", `trade test ${test.id} has no exact planned result artifact`);
        if (!sourceArtifact || sourceArtifact.status !== "verified" || sourceArtifact.sha256 !== test.testSourceArtifact?.sha256 || sourceArtifact.byteLength !== test.testSourceArtifact?.byteLength) throw executionError("TRADE_TEST_SOURCE_BINDING_INVALID", `trade test ${test.id} source artifact is not verified and hash-bound`);
        if (result.has(command.id)) throw executionError("TRADE_COMMAND_REUSED", `trade command ${command.id} is declared more than once`);
        result.set(command.id, { market, manifest, manifestArtifact, manifestSha256, test, resultArtifact });
      }
    }
  }
  if (any(result.size !== specialCommands.length, specialCommands.some(({ id }) => !result.has(id)))) throw executionError("TRADE_COMMAND_ORPHAN", "every trade command must bind exactly one manifest test");
  return result;
}

function assertTradeManifestSourceBindings(manifest, manifestArtifact, byPath) {
  const requireBound = (label, artifactPath, artifactSha256 = null, byteLength = null) => {
    const artifact = byPath.get(artifactPath);
    if (!artifact || artifact.status !== "verified" || (artifactSha256 !== null && artifact.sha256 !== artifactSha256) || (byteLength !== null && artifact.byteLength !== byteLength)) throw executionError("TRADE_MANIFEST_REPOSITORY_BINDING_INVALID", `${label} is not a verified RepositoryPlan artifact`);
  };
  requireBound("route implementation", manifest.source.routeImplementationPath, manifest.source.routeImplementationSha256);
  requireBound("route implementation closure", manifest.source.routeImplementationClosurePath, manifest.source.routeImplementationClosureSha256);
  if ([manifest.source.routeImplementationPath, manifest.source.routeImplementationClosurePath].some((value) => any(value === manifestArtifact.path, /^\.programmable\/(?:command-receipts|trade-test-results)\//u.test(value)))) throw executionError("TRADE_SOURCE_CLOSURE_INVALID", "route source closure must exclude its manifest and every post-run evidence path");
  requireBound("dependency lock", manifest.dependencies.lockfilePath, manifest.dependencies.lockfileSha256);
  const endpoints = [manifest.route.router, manifest.route.quoter, manifest.route.adapter, manifest.route.transport?.router, manifest.route.transport?.quoter].filter(Boolean);
  for (const endpoint of endpoints) requireBound("deployment evidence", endpoint.deploymentEvidenceRef);
  for (const funding of coalesce(manifest.route.fundingProfiles, [])) if (funding.permit2?.mode === "used") requireBound("Permit2 deployment evidence", funding.permit2.deploymentEvidenceRef);
  const conformance = manifest.route.canonicalInterface?.conformanceArtifact;
  if (manifest.route.canonicalInterface) requireBound("adapter interface schema", manifest.route.canonicalInterface.schemaPath, manifest.route.canonicalInterface.schemaSha256);
  if (conformance) requireBound("adapter conformance", conformance.path, conformance.sha256, conformance.byteLength);
  const fee = manifest.feeBehavior.programmableFeeV2;
  if (fee.applicability === "applicable") requireBound("fee conformance receipt", fee.receiptPath, fee.receiptSha256);
}

function materializeCompletedPlan(repositoryPlan, receipts) {
  const evidenceById = new Map(receipts.flatMap(({ artifact, receipt, resultArtifact, tradeResult }) => {
    const records = [[artifact.id, materializedJsonEvidence(receipt)]];
    if (tradeResult !== null) records.push([resultArtifact.id, materializedJsonEvidence(tradeResult)]);
    return records;
  }));
  const completedPlan = structuredClone(repositoryPlan);
  completedPlan.completionStatus = "COMPLETE";
  for (const records of Object.values(completedPlan.artifacts)) {
    for (const artifact of records) {
      const evidence = evidenceById.get(artifact.id);
      if (evidence) Object.assign(artifact, { status: "verified", ...evidence });
    }
  }
  completedPlan.commandResults = receipts.map(({ command, artifact, receipt }) => ({
    commandId: command.id,
    argvSha256: receipt.argvSha256,
    status: receipt.status,
    exitCode: receipt.exitCode,
    stdoutSha256: receipt.stdoutSha256,
    stderrSha256: receipt.stderrSha256,
    evidenceArtifactId: artifact.id
  }));
  return completedPlan;
}

function materializedJsonEvidence(value) {
  const bytes = Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8");
  return { sha256: sha256Bytes(bytes), byteLength: bytes.length };
}

function verifyBoundArtifacts(root, artifacts) {
  for (const artifact of artifacts) {
    if (artifact?.status !== "verified" || typeof artifact.sha256 !== "string" || !Number.isSafeInteger(artifact.byteLength)) {
      throw executionError("PROJECT_ARTIFACT_NOT_VERIFIED", `artifact ${coalesce(artifact?.id, "<unknown>")} must be verified before command execution`);
    }
    const resolved = resolveRepositoryPath(root, artifact.path);
    const stat = fs.lstatSync(resolved);
    if (any(!stat.isFile(), stat.isSymbolicLink())) throw executionError("PROJECT_ARTIFACT_FILE_INVALID", `artifact ${artifact.id} must be a regular non-symlink file`);
    if (any(stat.size !== artifact.byteLength, sha256Bytes(fs.readFileSync(resolved)) !== artifact.sha256)) {
      throw executionError("PROJECT_ARTIFACT_DRIFT", `artifact ${artifact.id} does not match its plan binding`);
    }
    const tracked = git(root, ["ls-files", "--error-unmatch", "--", artifact.path]);
    if (!tracked.ok) throw executionError("PROJECT_ARTIFACT_UNTRACKED", `artifact ${artifact.id} is not bound to the source commit`);
  }
}

function assertNewEvidencePath(root, repositoryPath) {
  const resolved = resolveRepositoryPath(root, repositoryPath);
  if (fs.existsSync(resolved)) throw executionError("PROJECT_EXECUTION_OUTPUT_EXISTS", `executor output already exists: ${repositoryPath}`);
  const tracked = git(root, ["ls-files", "--error-unmatch", "--", repositoryPath]);
  if (tracked.ok) throw executionError("PROJECT_EXECUTION_OUTPUT_TRACKED", `executor output path must be untracked: ${repositoryPath}`);
  const ignored = git(root, ["check-ignore", "--quiet", "--no-index", "--", repositoryPath]);
  if (ignored.ok) throw executionError("PROJECT_EXECUTION_OUTPUT_IGNORED", `durable executor evidence must not be ignored by Git: ${repositoryPath}`);
  ensureExistingParentsAreNotSymlinks(root, path.dirname(repositoryPath));
}

function verifyPendingEvidencePaths(root, expectedPaths) {
  const status = requiredGit(root, ["status", "--porcelain=v1", "--untracked-files=all"], "PROJECT_SOURCE_STATUS_UNAVAILABLE");
  const observed = status === "" ? [] : status.split("\n").map((line) => line.slice(3));
  const expected = [...expectedPaths].sort();
  if (JSON.stringify(observed.sort()) !== JSON.stringify(expected)) {
    throw executionError("PROJECT_SOURCE_DRIFT", "only new executor evidence may differ from the tested source commit", { expected, observed: observed.sort() });
  }
}

function writeNewRepositoryJson(root, repositoryPath, value) {
  const target = resolveRepositoryPath(root, repositoryPath);
  ensureDirectory(root, path.dirname(repositoryPath));
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const bytes = Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8");
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function ensureDirectory(root, repositoryDirectory) {
  if (repositoryDirectory === ".") return;
  let current = root;
  for (const segment of repositoryDirectory.split("/")) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stat = fs.lstatSync(current);
    if (any(!stat.isDirectory(), stat.isSymbolicLink())) throw executionError("PROJECT_EXECUTION_OUTPUT_PARENT_INVALID", "executor output parent must be a real directory");
  }
}

function ensureExistingParentsAreNotSymlinks(root, repositoryDirectory) {
  if (repositoryDirectory === ".") return;
  let current = root;
  for (const segment of repositoryDirectory.split("/")) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) return;
    const stat = fs.lstatSync(current);
    if (any(!stat.isDirectory(), stat.isSymbolicLink())) throw executionError("PROJECT_EXECUTION_OUTPUT_PARENT_INVALID", "executor output parent must be a real directory");
  }
}

function removeExecutorFiles(root, repositoryPaths) {
  for (const repositoryPath of repositoryPaths.reverse()) {
    const target = resolveRepositoryPath(root, repositoryPath);
    if (fs.existsSync(target) && fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
  }
}
function sanitizedExecutionEnvironment(temporaryHome) {
  const environment = {
    PATH: coalesce(process.env.PATH, ""), HOME: temporaryHome, TMPDIR: temporaryHome, TMP: temporaryHome, TEMP: temporaryHome,
    CI: "1", NO_COLOR: "1", TZ: "UTC", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1", FOUNDRY_COLOR: "never", FOUNDRY_FFI: "false", NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false", NPM_CONFIG_UPDATE_NOTIFIER: "false", NPM_CONFIG_USERCONFIG: path.join(temporaryHome, ".npmrc"),
    NPM_CONFIG_GLOBALCONFIG: path.join(temporaryHome, "global-npmrc"), NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/"
  };
  for (const key of ["COMSPEC", "PATHEXT", "SystemRoot", "WINDIR"]) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  return Object.freeze(environment);
}
function normalizeRoot(repositoryRoot) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0 || repositoryRoot.includes("\0")) {
    throw executionError("PROJECT_SOURCE_ROOT_INVALID", "repositoryRoot must be a non-empty path");
  }
  const stat = fs.lstatSync(repositoryRoot);
  if (any(!stat.isDirectory(), stat.isSymbolicLink())) throw executionError("PROJECT_SOURCE_ROOT_INVALID", "repositoryRoot must be a real directory");
  return fs.realpathSync(repositoryRoot);
}

function resolveRepositoryPath(root, repositoryPath) {
  if (typeof repositoryPath !== "string" || repositoryPath.length === 0 || path.isAbsolute(repositoryPath) || repositoryPath.includes("\\")) {
    throw executionError("PROJECT_REPOSITORY_PATH_INVALID", "repository path must be portable and relative");
  }
  const resolved = path.resolve(root, repositoryPath);
  const relative = path.relative(root, resolved);
  if (any(relative.startsWith(".."), path.isAbsolute(relative))) throw executionError("PROJECT_REPOSITORY_PATH_ESCAPE", "repository path escapes the project root");
  return resolved;
}

export function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function sha256RegularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (any(!stat.isFile(), stat.isSymbolicLink(), stat.size > 512 * 1024 * 1024)) {
    throw executionError("PROJECT_COMMAND_TOOL_INVALID", "bound executable must be a regular bounded file", { filePath });
  }
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let offset = 0;
    while (offset < stat.size) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
      if (bytesRead === 0) throw executionError("PROJECT_COMMAND_TOOL_INVALID", "bound executable changed while hashing", { filePath });
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return `sha256:${hash.digest("hex")}`;
}

function requiredGit(root, args, code) {
  const result = git(root, args);
  if (!result.ok) throw executionError(code, `Git evidence command failed: git ${args.join(" ")}`, { error: result.error });
  return result.output;
}

function assertProjectSourceBinding(source, repositoryPlan) {
  if (repositoryPlan?.repository?.headCommit !== source.headCommit) throw executionError("PROJECT_SOURCE_HEAD_MISMATCH", "repository plan is not bound to the executing HEAD");
  if (repositoryPlan?.repository?.branch !== source.branch) throw executionError("PROJECT_SOURCE_BRANCH_MISMATCH", "repository plan is not bound to the executing branch");
}

function assertSameProjectSource(expected, observed) {
  for (const key of ["headCommit", "tree", "branch", "gitStatusSha256"]) {
    if (expected[key] !== observed[key]) throw executionError("PROJECT_SOURCE_DRIFT", `project source changed during command execution: ${key}`);
  }
}

function looksLikeTrivialInlineProgram(executable, args) {
  if (!new Set(["node", "node.exe", "python", "python3", "python.exe"]).has(executable)) return false;
  if (!["-c", "-e", "--eval"].includes(args[0])) return false;
  const program = coalesce(args[1], "").replaceAll(/\s+/gu, "");
  return ["", "0", "pass", "exit(0)", "process.exit(0);", "process.exit(0)"].includes(program);
}

function externalMutationCommand(executable, args) {
  const first = coalesce(args[0], "").toLowerCase();
  if (["gh", "gh.exe", "scp", "scp.exe", "ssh", "ssh.exe"].includes(executable)) return true;
  if (all(executable === "git", ["push", "send-email"].includes(first))) return true;
  if (all(["npm", "npm.cmd", "pnpm", "pnpm.cmd", "yarn", "yarn.cmd"].includes(executable),
    ["deprecate", "dist-tag", "login", "owner", "publish", "star", "team", "token", "unpublish"].includes(first))) return true;
  if (all(executable === "cast", ["publish", "send", "wallet"].includes(first))) return true;
  if (all(executable === "forge", first === "script")) return true;
  if (["kubectl", "terraform", "vercel"].includes(executable)) return true;
  if (all(executable === "docker", ["login", "push"].includes(first))) return true;
  if (["curl", "wget"].includes(executable)) return args.some((argument) => /^(?:--data|--form|--request|--upload-file|-d|-f|-t|-x)$/iu.test(argument));
  return false;
}

function packageInstallRunsLifecycleScripts(executable, args) {
  if (!["npm", "npm.cmd", "pnpm", "pnpm.cmd", "yarn", "yarn.cmd"].includes(executable)) return false;
  if (!["ci", "install"].includes(coalesce(args[0], "").toLowerCase())) return false;
  return !args.includes("--ignore-scripts");
}

function git(root, args) {
  const result = spawnSafeGitSync(["-C", root, ...args], {
    encoding: "utf8",
    timeout: 10_000
  });
  return result.status === 0
    ? { ok: true, status: 0, output: result.stdout.trim() }
    : { ok: false, status: result.status, error: (result.stderr || result.error?.message || `exit ${result.status}`).trim() };
}

function executionError(code, message, details = {}) {
  return new ProjectCommandExecutionError(code, message, details);
}

function coalesce(value, fallback) {
  return value == null ? fallback : value;
}

function any(...conditions) {
  return conditions.some(Boolean);
}

function all(...conditions) {
  return conditions.every(Boolean);
}

function isPlainObject(value) {
  return all(value !== null, typeof value === "object", !Array.isArray(value));
}
