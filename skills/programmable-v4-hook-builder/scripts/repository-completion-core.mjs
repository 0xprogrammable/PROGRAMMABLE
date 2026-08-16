import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";
import { inspectCleanProjectSource, PROJECT_COMMAND_ENVIRONMENT_PROFILE,
  projectCommandEnvironmentSha256, projectCommandExecutionPlanSha256, projectCommandExecutorIdentity,
  projectCommandMaximumOutputBytes, projectCommandSignature, resolveProjectCommandCwd, resolveProjectCommandTool,
  validateProjectCommandSafety } from "./project-command-executor-core.mjs";
import { inspectProjectTradeCapability, projectArtifactSha256 } from "./project-contracts-core.mjs";
import { spawnSafeGitSync } from "./repository-root.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { validateAgainstSchema } from "./submission-core.mjs";
import { tradeRunnerDomainEvidenceMatchesV1, validateV4DeploymentEvidence } from "./v4-deployment-evidence-core.mjs";
import { validateV4HookSemanticContract } from "./v4-hook-semantic-contract-core.mjs";
import { TRADE_TEST_SEMANTIC_ADEQUACY_V1, tradeCapabilityManifestSha256V1, validateTradeCapabilityManifestV1,
  validateTradeResultPairV1, validateTradeTestResultV1 } from "./trade-capability-manifest-core.mjs";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(moduleDirectory, "..");
const severityOrder = Object.freeze({ blocker: 0, review: 1, advisory: 2 });
const alwaysRequiredCommandKinds = Object.freeze([
  "install", "build", "typecheck", "lint", "simulation", "test", "evidence"
]);
const contractRequiredCommandKinds = Object.freeze([
  "fuzz", "invariant", "gas", "code-size", "deployment-test"
]);
const schemaCache = new Map();

export function validateRepositoryPlan(projectSpec, productGraph, architectureCandidates, repositoryPlan, options = {}) {
  const findings = [];
  const add = findingAdder(findings);
  validateSchema(repositoryPlan, "repository-plan-v1.schema.json", "REPOSITORY_PLAN_SCHEMA_INVALID", add);
  if (!isObject(repositoryPlan)) return sorted(findings);

  bind(repositoryPlan.applicationId, projectSpec?.applicationId, "$.applicationId", "REPOSITORY_APPLICATION_ID_MISMATCH", add);
  bind(repositoryPlan.revision, projectSpec?.revision, "$.revision", "REPOSITORY_REVISION_MISMATCH", add);
  bind(repositoryPlan.projectSpecSha256, projectSpec && projectArtifactSha256(projectSpec), "$.projectSpecSha256", "REPOSITORY_PROJECT_SPEC_HASH_MISMATCH", add);
  bind(repositoryPlan.productGraphSha256, productGraph && projectArtifactSha256(productGraph), "$.productGraphSha256", "REPOSITORY_PRODUCT_GRAPH_HASH_MISMATCH", add);
  bind(repositoryPlan.architectureCandidatesSha256, architectureCandidates && projectArtifactSha256(architectureCandidates), "$.architectureCandidatesSha256", "REPOSITORY_ARCHITECTURE_HASH_MISMATCH", add);
  bind(repositoryPlan.selectedArchitectureId, architectureCandidates?.selection?.candidateId, "$.selectedArchitectureId", "REPOSITORY_SELECTION_MISMATCH", add);

  const selected = architectureCandidates?.candidates?.find(({ id }) => id === architectureCandidates?.selection?.candidateId);
  const systemNodes = new Map(coalesce(productGraph?.graphs?.system?.nodes, []).map((node) => [node.id, node]));
  const componentNodes = new Map(coalesce(productGraph?.graphs?.component?.components, []).map((node) => [node.id, node]));
  const knownGraphRefs = new Set([...systemNodes.keys(), ...componentNodes.keys()]);
  const inventory = indexArtifacts(repositoryPlan, knownGraphRefs, add);
  validateCommandPlan(repositoryPlan, selected, systemNodes, componentNodes, inventory, add);
  validateSelectedComponentCoverage(selected, componentNodes, inventory, add);
  validateToolchainPlan(selected, systemNodes, componentNodes, inventory, add);
  validateV4SemanticPlan(repositoryPlan, selected, systemNodes, inventory, options, add);
  const tradeProjection = validateTradeCapabilityPlan(projectSpec, productGraph, architectureCandidates, repositoryPlan, inventory, add);

  if (repositoryPlan.completionStatus === "COMPLETE") {
    validateCompleteArtifacts(repositoryPlan, inventory, options, add);
    validateCompleteCommandResults(repositoryPlan, inventory, add);
    if (any(options.verifyRepositoryFiles !== true, typeof options.repositoryRoot !== "string")) {
      add("blocker", "REPOSITORY_FILES_NOT_VERIFIED", "$.completionStatus", "COMPLETE requires repository file, Git, and semantic verification.");
    } else {
      verifyArtifactFiles(inventory, options.repositoryRoot, add);
      verifyGitBinding(repositoryPlan, options.repositoryRoot, add);
      validateCommandReceiptFiles(repositoryPlan, inventory, options.repositoryRoot, add);
      validateToolchainArtifactFiles(selected, systemNodes, componentNodes, inventory, options.repositoryRoot, add);
      validateV4SemanticArtifactFiles(repositoryPlan, inventory, options.repositoryRoot, add);
      validateTradeCapabilityFiles(repositoryPlan, inventory, options.repositoryRoot, tradeProjection, add);
    }
  }
  return sorted(findings);
}

export function requiredRepositoryCommandKinds(selected, systemNodes, componentNodes) {
  const required = new Set(alwaysRequiredCommandKinds);
  const selectedRefs = new Set(coalesce(selected?.graphNodeRefs, []));
  const contractLike = [...selectedRefs].some((id) => {
    const system = systemNodes.get(id);
    const component = componentNodes.get(id);
    return any(["contract", "hook", "token", "factory", "vault", "escrow", "game-contract", "nft-system"].includes(component?.type),
      system?.type === "contract");
  });
  if (contractLike) contractRequiredCommandKinds.forEach((kind) => required.add(kind));
  if (any(selected?.v4Usage?.pool?.disposition === "required", selected?.v4Usage?.customHook?.disposition === "required")) required.add("fork");
  return [...required].sort();
}

function indexArtifacts(repositoryPlan, knownGraphRefs, add) {
  const byId = new Map();
  const byPath = new Map();
  const groupById = new Map();
  for (const [group, artifacts] of Object.entries(coalesce(repositoryPlan.artifacts, {}))) {
    for (const [index, artifact] of coalesce(artifacts, []).entries()) {
      const base = `$.artifacts.${group}[${index}]`;
      if (byId.has(artifact?.id)) add("blocker", "REPOSITORY_ARTIFACT_ID_DUPLICATE", `${base}.id`, `Artifact id ${artifact?.id} is duplicated.`);
      else if (typeof artifact?.id === "string") byId.set(artifact.id, artifact);
      if (byPath.has(artifact?.path)) add("blocker", "REPOSITORY_ARTIFACT_PATH_DUPLICATE", `${base}.path`, `Artifact path ${artifact?.path} is duplicated.`);
      else if (typeof artifact?.path === "string") byPath.set(artifact.path, artifact);
      if (typeof artifact?.id === "string") groupById.set(artifact.id, group);
      for (const [refIndex, ref] of coalesce(artifact?.systemRefs, []).entries()) {
        if (!knownGraphRefs.has(ref)) add("blocker", "REPOSITORY_ARTIFACT_GRAPH_REF_UNKNOWN", `${base}.systemRefs[${refIndex}]`, `Unknown graph ref ${ref}.`);
      }
      if (all(artifact?.status === "planned", any(artifact.sha256 !== null, artifact.byteLength !== null))) {
        add("blocker", "PLANNED_ARTIFACT_HAS_MATERIALIZED_HASH", base, "Planned artifacts cannot carry hash or byte evidence.");
      }
      if (all(["materialized", "verified"].includes(artifact?.status), any(artifact.sha256 === null, artifact.byteLength === null))) {
        add("blocker", "MATERIALIZED_ARTIFACT_EVIDENCE_MISSING", base, "Verified artifacts need bytes and sha256.");
      }
    }
  }
  return { byId, byPath, groupById };
}

function validateCommandPlan(repositoryPlan, selected, systemNodes, componentNodes, inventory, add) {
  const commands = Array.isArray(repositoryPlan.commands) ? repositoryPlan.commands : [];
  const commandIds = new Set();
  const commandSignatures = new Map();
  for (const [index, command] of commands.entries()) {
    if (commandIds.has(command?.id)) add("blocker", "REPOSITORY_COMMAND_ID_DUPLICATE", `$.commands[${index}].id`, `Command id ${command?.id} is duplicated.`);
    commandIds.add(command?.id);
    if (command?.required !== true) {
      add("blocker", "REPOSITORY_COMMAND_OPTIONAL_FORBIDDEN", `$.commands[${index}].required`, "Command must be required.");
    }
    for (const issue of validateProjectCommandSafety(command)) {
      add("blocker", issue.code, `$.commands[${index}]`, issue.message);
    }
    const signature = projectCommandSignature(command);
    if (commandSignatures.has(signature)) {
      add("blocker", "PROJECT_COMMAND_REPEATED", `$.commands[${index}]`, `Commands ${commandSignatures.get(signature)} and ${command?.id} repeat argv and cwd.`);
    } else {
      commandSignatures.set(signature, command?.id);
    }
  }
  const requiredKinds = requiredRepositoryCommandKinds(selected, systemNodes, componentNodes);
  for (const kind of requiredKinds) {
    if (!commands.some((command) => all(command.kind === kind, command.required === true))) {
      add("blocker", "REPOSITORY_COMMAND_KIND_MISSING", "$.commands", `Repository plan must include a required ${kind} command.`, { kind });
    }
  }
  for (const [index, command] of commands.entries()) {
    const artifact = inventory.byId.get(`${command.id}-receipt`);
    if (any(!artifact, artifact?.kind !== "command-receipt", inventory.groupById.get(artifact?.id) !== "evidence", artifact?.path !== `.programmable/command-receipts/${command.id}.v1.json`)) add("blocker", "PROJECT_RECEIPT_ARTIFACT_BINDING_INVALID", `$.commands[${index}]`, "Canonical receipt missing.", { commandId: command.id });
    else if (all(repositoryPlan.completionStatus !== "COMPLETE", any(artifact.status !== "planned", artifact.sha256 !== null, artifact.byteLength !== null))) add("blocker", "PRE_RUN_RECEIPT_MATERIALIZED_FORBIDDEN", `$.commands[${index}]`, "Pre-run receipt must be planned/hash-free.", { commandId: command.id });
  }
  const receiptArtifactIds = new Set();
  for (const [index, result] of coalesce(repositoryPlan.commandResults, []).entries()) {
    const command = commands.find(({ id }) => id === result?.commandId);
    if (!command) add("blocker", "COMMAND_RESULT_COMMAND_UNKNOWN", `$.commandResults[${index}].commandId`, `Result references unknown command ${result?.commandId}.`);
    if (!inventory.byId.has(result?.evidenceArtifactId)) add("blocker", "COMMAND_RESULT_EVIDENCE_UNKNOWN", `$.commandResults[${index}].evidenceArtifactId`, "Unknown evidence.");
    else if (inventory.groupById.get(result.evidenceArtifactId) !== "evidence") add("blocker", "COMMAND_RESULT_EVIDENCE_GROUP_INVALID", `$.commandResults[${index}].evidenceArtifactId`, "Receipt must be evidence.");
    else if (inventory.byId.get(result.evidenceArtifactId)?.kind !== "command-receipt") add("blocker", "COMMAND_RESULT_EVIDENCE_KIND_INVALID", `$.commandResults[${index}].evidenceArtifactId`, "Result needs a receipt.");
    if (receiptArtifactIds.has(result?.evidenceArtifactId)) add("blocker", "COMMAND_RECEIPT_REUSED", `$.commandResults[${index}].evidenceArtifactId`, "Receipt reused.");
    receiptArtifactIds.add(result?.evidenceArtifactId);
  }
}

function validateTradeCapabilityPlan(projectSpec, productGraph, architectureCandidates, repositoryPlan, inventory, add) {
  const projection = inspectProjectTradeCapability(projectSpec, productGraph, architectureCandidates);
  const markets = coalesce(repositoryPlan.tradeCapability?.markets, []);
  const commands = new Map(coalesce(repositoryPlan.commands, []).map((command) => [command.id, command]));
  const tradeCommands = coalesce(repositoryPlan.commands, []).filter(({ kind }) => ["quote-test", "execution-test"].includes(kind));
  const manifests = [...inventory.byId.values()].filter(({ kind }) => kind === "trade-capability-manifest");
  const results = [...inventory.byId.values()].filter(({ kind }) => kind === "trade-test-result");
  if (all(projection.applicability !== null, repositoryPlan.tradeCapability?.applicability !== projection.applicability)) {
    add("blocker", "TRADE_APPLICABILITY_MISMATCH", "$.tradeCapability.applicability", "Trade applicability differs.", { expected: projection.applicability, observed: coalesce(repositoryPlan.tradeCapability?.applicability, null) });
  }
  if (all(projection.applicability === "unresolved", repositoryPlan.completionStatus === "COMPLETE")) {
    add("blocker", "UNRESOLVED_TRADE_CAPABILITY_COMPLETE_FORBIDDEN", "$.completionStatus", "Unresolved trade blocks COMPLETE.");
  }
  if (["no-market", "unresolved"].includes(projection.applicability)) {
    if (markets.length + tradeCommands.length + manifests.length + results.length !== 0) {
      add("blocker", "NO_MARKET_TRADE_EVIDENCE_FORBIDDEN", "$.tradeCapability", "Trade output barred.", { markets: markets.length, commands: tradeCommands.length, manifests: manifests.length, results: results.length });
    }
    return projection;
  }
  if (projection.applicability !== "tradable") return projection;
  if (projection.marketRefs.length === 0) add("blocker", "TRADE_MARKET_CARDINALITY_INVALID", "$.tradeCapability.markets", "No tradable market.");
  const expectedRefs = new Set(projection.marketRefs);
  const planByRef = new Map();
  const referencedManifests = new Set();
  const referencedCommands = new Set();
  for (const [index, market] of markets.entries()) {
    const base = `$.tradeCapability.markets[${index}]`;
    if (planByRef.has(market?.marketSystemRef)) add("blocker", "TRADE_MARKET_CARDINALITY_INVALID", `${base}.marketSystemRef`, "Duplicate market route.", { marketRef: coalesce(market?.marketSystemRef, null) });
    else planByRef.set(market?.marketSystemRef, market);
    if (!expectedRefs.has(market?.marketSystemRef)) add("blocker", "TRADE_MARKET_REF_INVALID", `${base}.marketSystemRef`, "Market not projected.", { marketRef: coalesce(market?.marketSystemRef, null) });
    const manifest = inventory.byId.get(market?.manifestArtifactId);
    if (any(!manifest, manifest?.kind !== "trade-capability-manifest", inventory.groupById.get(manifest?.id) !== "configuration")) {
      add("blocker", "TRADE_CAPABILITY_MANIFEST_REQUIRED", `${base}.manifestArtifactId`, "Manifest missing.");
    } else {
      referencedManifests.add(manifest.id);
      const expectedPath = `.programmable/trade-capabilities/${market.marketSystemRef}.v1.json`;
      if (any(manifest.path !== expectedPath, !coalesce(manifest.systemRefs, []).includes(market.marketSystemRef))) add("blocker", "TRADE_CAPABILITY_MANIFEST_BINDING_INVALID", `${base}.manifestArtifactId`, "Manifest market mismatch.", { expectedPath, observedPath: manifest.path });
    }
    for (const [field, kind] of [["quoteCommandIds", "quote-test"], ["executionCommandIds", "execution-test"]]) {
      for (const [commandIndex, commandId] of coalesce(market?.[field], []).entries()) {
        const command = commands.get(commandId);
        if (any(!command, command?.kind !== kind)) add("blocker", "TRADE_COMMAND_BINDING_INVALID", `${base}.${field}[${commandIndex}]`, `Command must have kind ${kind}.`, { commandId });
        if (referencedCommands.has(commandId)) add("blocker", "TRADE_COMMAND_REUSED", `${base}.${field}[${commandIndex}]`, "Trade command is reused.", { commandId });
        referencedCommands.add(commandId);
      }
    }
  }
  for (const marketRef of expectedRefs) if (!planByRef.has(marketRef)) add("blocker", "TRADE_MARKET_CARDINALITY_INVALID", "$.tradeCapability.markets", "Market route missing.", { marketRef });
  if (referencedManifests.size !== manifests.length) add("blocker", "TRADE_CAPABILITY_MANIFEST_ORPHAN", "$.artifacts.configuration", "Orphan manifest.", { referenced: referencedManifests.size, observed: manifests.length });
  if (referencedCommands.size !== tradeCommands.length) add("blocker", "TRADE_COMMAND_ORPHAN", "$.commands", "Orphan command.", { referenced: referencedCommands.size, observed: tradeCommands.length });
  if (any(results.length !== referencedCommands.size, results.some((artifact) => inventory.groupById.get(artifact.id) !== "evidence"))) add("blocker", "TRADE_RESULT_ARTIFACT_CARDINALITY_INVALID", "$.artifacts.evidence", "Result count mismatch.", { expected: referencedCommands.size, observed: results.length });
  for (const command of tradeCommands) {
    const artifact = inventory.byId.get(`${command.id}-result`);
    if (any(!artifact, artifact?.kind !== "trade-test-result", artifact?.path !== `.programmable/trade-test-results/${command.id}.v1.json`)) add("blocker", "TRADE_RESULT_ARTIFACT_BINDING_INVALID", "$.artifacts.evidence", "Canonical result missing.", { commandId: command.id });
    else if (all(repositoryPlan.completionStatus !== "COMPLETE", any(artifact.status !== "planned", artifact.sha256 !== null, artifact.byteLength !== null))) add("blocker", "PRE_RUN_TRADE_RESULT_MATERIALIZED_FORBIDDEN", "$.artifacts.evidence", "Pre-run result must be planned/hash-free.", { commandId: command.id });
  }
  return projection;
}

function validateToolchainPlan(selected, systemNodes, componentNodes, inventory, add) {
  const contractRefs = selectedContractComponentRefs(selected, systemNodes, componentNodes);
  if (contractRefs.size === 0) return;
  const locks = [...inventory.byId.values()].filter((artifact) => (
    all(inventory.groupById.get(artifact.id) === "dependencyLocks", artifact.kind === "project-toolchain-lock")
  ));
  if (locks.length !== 1) {
    add("blocker", "PROJECT_TOOLCHAIN_LOCK_CARDINALITY_INVALID", "$.artifacts.dependencyLocks", "One project-toolchain-lock required.", { observed: locks.length });
    return;
  }
  for (const componentRef of contractRefs) {
    if (!coalesce(locks[0].systemRefs, []).includes(componentRef)) add("blocker", "PROJECT_TOOLCHAIN_LOCK_COMPONENT_UNBOUND", "$.artifacts.dependencyLocks", `Lock omits ${componentRef}.`, { componentRef });
  }
}

function validateSelectedComponentCoverage(selected, componentNodes, inventory, add) {
  const selectedComponents = coalesce(selected?.graphNodeRefs, []).map((id) => componentNodes.get(id)).filter(Boolean);
  for (const component of selectedComponents) {
    if (!["build", "reuse-pinned"].includes(component.disposition)) continue;
    for (const group of ["source", "configuration", "tests", "documentation"]) {
      const covered = [...inventory.byId.values()].some((artifact) => all(inventory.groupById.get(artifact.id) === group, coalesce(artifact.systemRefs, []).some((ref) => any(ref === component.id, component.systemRefs.includes(ref)))));
      if (!covered) add("blocker", "SELECTED_COMPONENT_ARTIFACT_COVERAGE_MISSING", `$.artifacts.${group}`, `${component.id} lacks ${group}.`, { componentRef: component.id, group });
    }
  }
}

function validateV4SemanticPlan(repositoryPlan, selected, systemNodes, inventory, _options, add) {
  const requiredHookRefs = new Set(selected?.v4Usage?.customHook?.disposition === "required"
    ? coalesce(selected.v4Usage.customHook.systemNodeRefs, [])
    : []);
  const records = coalesce(repositoryPlan.v4HookSemanticContracts, []);
  const seen = new Set();
  for (const [index, record] of records.entries()) {
    const base = `$.v4HookSemanticContracts[${index}]`;
    if (seen.has(record?.systemRef)) add("blocker", "V4_SEMANTIC_CONTRACT_DUPLICATE", `${base}.systemRef`, `Hook ${record?.systemRef} has duplicate semantic contracts.`);
    seen.add(record?.systemRef);
    if (!requiredHookRefs.has(record?.systemRef)) add("blocker", "V4_SEMANTIC_CONTRACT_HOOK_UNKNOWN", `${base}.systemRef`, "Hook is not selected.");
    const system = systemNodes.get(record?.systemRef);
    if (system?.protocolRole !== "uniswap-v4-hook") add("blocker", "V4_SEMANTIC_CONTRACT_ROLE_INVALID", `${base}.systemRef`, "Not a v4 hook node.");
    requireArtifact(record?.profileArtifactId, "configuration", "v4-hook-semantic-contract", `${base}.profileArtifactId`, inventory, add);
    for (const [field, group] of [["sourceArtifactIds", "source"], ["deploymentArtifactIds", "deploymentInputs"], ["evidenceArtifactIds", "evidence"]]) {
      for (const [refIndex, artifactId] of coalesce(record?.[field], []).entries()) requireArtifact(artifactId, group, null, `${base}.${field}[${refIndex}]`, inventory, add);
    }
    const deploymentKinds = new Set(coalesce(record?.deploymentArtifactIds, []).map((id) => inventory.byId.get(id)?.kind));
    for (const kind of ["v4-deployment-preimage", "v4-deployment-manifest", "v4-runtime-code"]) {
      if (!deploymentKinds.has(kind)) add("blocker", "V4_DEPLOYMENT_ARTIFACT_KIND_MISSING", `${base}.deploymentArtifactIds`, `Hook semantic contract requires a ${kind} artifact.`, { kind });
    }
  }
  for (const hookRef of requiredHookRefs) {
    if (!seen.has(hookRef)) add("blocker", "V4_SEMANTIC_CONTRACT_REQUIRED", "$.v4HookSemanticContracts", `Hook ${hookRef} lacks semantic evidence.`, { systemRef: hookRef });
  }
  if (all(requiredHookRefs.size === 0, records.length > 0)) {
    add("blocker", "NO_HOOK_REPOSITORY_HAS_HOOK_CONTRACT", "$.v4HookSemanticContracts", "No-hook plan retains hook evidence.");
  }
}

function validateCompleteArtifacts(repositoryPlan, inventory, _options, add) {
  for (const [artifactId, artifact] of inventory.byId) {
    if (artifact.status !== "verified") add("blocker", "COMPLETE_ARTIFACT_NOT_VERIFIED", "$.artifacts", `COMPLETE repository artifact ${artifactId} is not verified.`, { artifactId, status: artifact.status });
  }
  if (repositoryPlan.repository?.headCommit === null) {
    add("blocker", "COMPLETE_REPOSITORY_COMMIT_UNBOUND", "$.repository.headCommit", "COMPLETE needs a Git commit.");
  }
}

function validateCompleteCommandResults(repositoryPlan, inventory, add) {
  const results = coalesce(repositoryPlan.commandResults, []);
  const resultsByCommand = new Map();
  for (const [index, result] of results.entries()) {
    if (resultsByCommand.has(result.commandId)) add("blocker", "COMMAND_RESULT_DUPLICATE", `$.commandResults[${index}].commandId`, `Command ${result.commandId} has duplicate results.`);
    resultsByCommand.set(result.commandId, result);
  }
  for (const [index, command] of coalesce(repositoryPlan.commands, []).entries()) {
    if (command.required !== true) continue;
    const result = resultsByCommand.get(command.id);
    if (!result) {
      add("blocker", "REQUIRED_COMMAND_RESULT_MISSING", `$.commands[${index}]`, `No result for ${command.id}.`);
      continue;
    }
    const expectedArgvSha256 = canonicalJsonSha256V2(command.argv);
    if (result.argvSha256 !== expectedArgvSha256) add("blocker", "COMMAND_ARGV_HASH_MISMATCH", `$.commandResults[${results.indexOf(result)}].argvSha256`, `Command ${command.id} argv differs.`, { expected: expectedArgvSha256, observed: result.argvSha256 });
    if (any(result.status !== "passed", result.exitCode !== 0)) add("blocker", "REQUIRED_COMMAND_NOT_PASSED", `$.commandResults[${results.indexOf(result)}]`, `Command ${command.id} failed.`, { status: result.status, exitCode: result.exitCode });
    const evidence = inventory.byId.get(result.evidenceArtifactId);
    if (evidence?.status !== "verified") add("blocker", "COMMAND_EVIDENCE_NOT_VERIFIED", `$.commandResults[${results.indexOf(result)}].evidenceArtifactId`, `Command ${command.id} evidence unverified.`);
  }
}

function validateCommandReceiptFiles(repositoryPlan, inventory, repositoryRoot, add) {
  const root = fs.realpathSync(repositoryRoot);
  let durable;
  try { durable = { source: inspectDurableProjectEvidence(repositoryRoot, repositoryPlan).source, error: null }; }
  catch (error) { durable = { source: null, error }; }
  for (const [index, result] of coalesce(repositoryPlan.commandResults, []).entries()) {
    const command = coalesce(repositoryPlan.commands, []).find(({ id }) => id === result.commandId);
    const artifact = inventory.byId.get(result.evidenceArtifactId);
    if (any(!command, !artifact)) continue;
    const receipt = readStrictArtifact(root, artifact, `$.commandResults[${index}].evidenceArtifactId`, "COMMAND_RECEIPT_JSON_INVALID", add);
    if (!receipt) continue;
    validateValueAgainstNamedSchema(receipt, "command-receipt-v1.schema.json", "COMMAND_RECEIPT_SCHEMA_INVALID", `$.commandResults[${index}].evidenceArtifactId`, add);
    const expected = {
      commandId: command.id,
      argv: command.argv,
      argvSha256: canonicalJsonSha256V2(command.argv),
      cwd: command.cwd,
      status: result.status,
      exitCode: result.exitCode,
      stdoutSha256: result.stdoutSha256,
      stderrSha256: result.stderrSha256
    };
    for (const [key, wanted] of Object.entries(expected)) {
      const observed = receipt[key];
      if (canonicalJsonSha256V2(observed) !== canonicalJsonSha256V2(wanted)) add("blocker", "COMMAND_RECEIPT_BINDING_MISMATCH", `$.commandResults[${index}].evidenceArtifactId`, `Receipt ${key} differs.`, { field: key, expected: wanted, observed: coalesce(observed, null) });
    }
    if (coalesce(receipt.externalActionsPerformed, []).length !== 0) add("blocker", "COMMAND_RECEIPT_EXTERNAL_ACTION", `$.commandResults[${index}].evidenceArtifactId`, "Receipt has external action.");
    for (const issue of validateProjectCommandReceipt(receipt, { command, repositoryPlan, repositoryRoot, durable })) {
      add("blocker", issue.code, `$.commandResults[${index}].evidenceArtifactId`, issue.message, issue.details);
    }
  }
}

function validateProjectCommandReceipt(receipt, { command, repositoryPlan, repositoryRoot, durable }) {
  const issues = [];
  const issue = (code, message, details = {}) => issues.push({ code, message, details });
  if (!isObject(receipt)) return [{ code: "COMMAND_RECEIPT_INVALID", message: "receipt must be an object", details: {} }];
  const source = durable.source;
  if (durable.error) issue(coalesce(durable.error.code, "COMMAND_RECEIPT_SOURCE_UNAVAILABLE"), durable.error.message);
  const expected = {
    executor: projectCommandExecutorIdentity(),
    executionPolicy: {
      shell: false,
      environmentProfile: PROJECT_COMMAND_ENVIRONMENT_PROFILE,
      credentialsInherited: false,
      externalWrites: command.executionPolicy?.externalWrites,
      networkAccess: command.executionPolicy?.networkAccess,
      maximumOutputBytes: projectCommandMaximumOutputBytes(command)
    },
    source: source ? {
      ...source,
      executionPlanSha256: projectCommandExecutionPlanSha256(repositoryPlan),
      commandsSha256: canonicalJsonSha256V2(repositoryPlan.commands),
      commandSha256: canonicalJsonSha256V2(command)
    } : null,
    commandId: command.id,
    commandKind: command.kind,
    argv: command.argv,
    argvSha256: canonicalJsonSha256V2(command.argv),
    cwd: command.cwd,
    timeoutMs: command.timeoutMs,
    status: "passed",
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputExceeded: false,
    networkAccessed: null,
    externalActionsPerformed: []
  };
  for (const [key, value] of Object.entries(expected)) {
    const observed = Object.hasOwn(receipt, key) ? receipt[key] : null;
    if (canonicalJsonSha256V2(observed) !== canonicalJsonSha256V2(value)) {
      issue("COMMAND_RECEIPT_EXECUTOR_BINDING_MISMATCH", `receipt field ${key} does not match executor evidence`, { field: key });
    }
  }
  try {
    const cwd = resolveProjectCommandCwd(repositoryRoot, command.cwd);
    const tool = resolveProjectCommandTool(command.argv[0], cwd);
    if (canonicalJsonSha256V2(receipt.tool) !== canonicalJsonSha256V2(tool)) issue("COMMAND_RECEIPT_TOOL_DRIFT", "resolved command tool no longer matches the receipt");
  } catch (error) {
    issue(coalesce(error.code, "COMMAND_RECEIPT_TOOL_UNAVAILABLE"), error.message);
  }
  const { receiptSha256, ...preimage } = receipt;
  if (receiptSha256 !== canonicalJsonSha256V2(preimage)) issue("COMMAND_RECEIPT_DIGEST_MISMATCH", "receipt self-digest does not match its canonical payload");
  return issues;
}

function inspectDurableProjectEvidence(repositoryRoot, repositoryPlan) {
  const root = fs.realpathSync(repositoryRoot);
  const current = inspectCleanProjectSource(root);
  const sourceCommit = repositoryPlan?.repository?.headCommit;
  if (current.headCommit === sourceCommit) throw gitEvidenceError("PROJECT_EVIDENCE_COMMIT_REQUIRED", "Evidence commit required.");
  if (!gitEvidence(root, ["merge-base", "--is-ancestor", sourceCommit, current.headCommit]).ok) throw gitEvidenceError("PROJECT_EVIDENCE_NOT_DESCENDANT", "Evidence is not a descendant.");
  if (current.branch !== repositoryPlan?.repository?.branch) throw gitEvidenceError("PROJECT_EVIDENCE_BRANCH_MISMATCH", "Evidence branch differs.");
  const sourceTree = requiredGitEvidence(root, ["rev-parse", `${sourceCommit}^{tree}`], "PROJECT_EVIDENCE_SOURCE_TREE_UNAVAILABLE");
  const diff = requiredGitEvidence(root, ["diff", "--name-status", "--find-renames=0", `${sourceCommit}..${current.headCommit}`, "--"], "PROJECT_EVIDENCE_DIFF_UNAVAILABLE");
  const changedPaths = new Set();
  for (const line of diff.split("\n").filter(Boolean)) {
    const [status, changedPath, extra] = line.split("\t");
    if (any(extra !== undefined, !["A", "M"].includes(status), !allowedEvidencePath(changedPath, repositoryPlan))) throw gitEvidenceError("PROJECT_EVIDENCE_DESCENDANT_SCOPE_INVALID", "evidence descendant changed a non-evidence path", { line });
    changedPaths.add(changedPath);
  }
  const requiredPaths = [
    ".programmable/repository-plan.v1.json",
    ...Object.values(coalesce(repositoryPlan?.artifacts, {})).flat().filter(({ kind }) => ["command-receipt", "trade-test-result"].includes(kind)).map(({ path: artifactPath }) => artifactPath)
  ];
  for (const requiredPath of requiredPaths) {
    if (!changedPaths.has(requiredPath)) throw gitEvidenceError("PROJECT_EVIDENCE_FILE_NOT_COMMITTED", `evidence descendant does not commit ${requiredPath}`);
    if (!gitEvidence(root, ["ls-files", "--error-unmatch", "--", requiredPath]).ok) throw gitEvidenceError("PROJECT_EVIDENCE_FILE_UNTRACKED", `evidence file is not tracked: ${requiredPath}`);
    if (gitEvidence(root, ["cat-file", "-e", `${sourceCommit}:${requiredPath}`]).ok) throw gitEvidenceError("PROJECT_EVIDENCE_PREEXISTED_SOURCE", `executor evidence pre-existed the tested source: ${requiredPath}`);
  }
  return {
    source: { headCommit: sourceCommit, tree: sourceTree, branch: repositoryPlan.repository.branch, gitStatusSha256: sha256Bytes(Buffer.alloc(0)) },
    evidence: { headCommit: current.headCommit, tree: current.tree, changedPaths: [...changedPaths].sort() }
  };
}

function validateToolchainArtifactFiles(selected, systemNodes, componentNodes, inventory, repositoryRoot, add) {
  const contractRefs = selectedContractComponentRefs(selected, systemNodes, componentNodes);
  if (contractRefs.size === 0) return;
  const artifact = [...inventory.byId.values()].find((candidate) => (
    all(inventory.groupById.get(candidate.id) === "dependencyLocks", candidate.kind === "project-toolchain-lock")
  ));
  if (!artifact) return;
  const lock = readStrictArtifact(fs.realpathSync(repositoryRoot), artifact, "$.artifacts.dependencyLocks", "PROJECT_TOOLCHAIN_LOCK_JSON_INVALID", add);
  if (!lock) return;
  validateValueAgainstNamedSchema(lock, "project-toolchain-lock-v1.schema.json", "PROJECT_TOOLCHAIN_LOCK_SCHEMA_INVALID", "$.artifacts.dependencyLocks", add);
  const profiles = coalesce(lock.solidityProfiles, []);
  for (const componentRef of contractRefs) {
    if (!profiles.some((profile) => coalesce(profile.componentRefs, []).includes(componentRef))) add("blocker", "SOLIDITY_PROFILE_COMPONENT_UNBOUND", "$.artifacts.dependencyLocks", `No Solidity toolchain profile binds contract component ${componentRef}.`, { componentRef });
  }
  for (const [index, profile] of profiles.entries()) {
    if (any(typeof profile?.compilerVersion !== "string", !/^0\.[0-9]+\.[0-9]+/u.test(coalesce(profile?.compilerVersion, "")))) add("blocker", "SOLIDITY_COMPILER_VERSION_UNRESOLVED", `$.artifacts.dependencyLocks.solidityProfiles[${index}].compilerVersion`, "Solidity compiler version must be exact.");
    if (!/^sha256:[0-9a-f]{64}$/u.test(coalesce(profile?.resolvedCompilerBinarySha256, ""))) add("blocker", "SOLIDITY_COMPILER_BINARY_HASH_UNRESOLVED", `$.artifacts.dependencyLocks.solidityProfiles[${index}].resolvedCompilerBinarySha256`, "Version text alone is insufficient; bind the resolved compiler binary sha256.");
  }
}

function verifyArtifactFiles(inventory, repositoryRoot, add) {
  const root = fs.realpathSync(repositoryRoot);
  for (const [artifactId, artifact] of inventory.byId) {
    const resolved = resolveInside(root, artifact.path);
    if (any(resolved === null, !fs.existsSync(coalesce(resolved, "")))) {
      add("blocker", "REPOSITORY_ARTIFACT_FILE_MISSING", "$.artifacts", `Missing artifact ${artifactId}.`, { artifactId, path: artifact.path });
      continue;
    }
    const stat = fs.lstatSync(resolved);
    if (any(!stat.isFile(), stat.isSymbolicLink())) {
      add("blocker", "REPOSITORY_ARTIFACT_FILE_TYPE_INVALID", "$.artifacts", `Invalid file ${artifactId}.`, { artifactId, path: artifact.path });
      continue;
    }
    const real = fs.realpathSync(resolved);
    if (!insideRoot(root, real)) {
      add("blocker", "REPOSITORY_ARTIFACT_ESCAPES_ROOT", "$.artifacts", `Artifact ${artifactId} escapes root.`, { artifactId, path: artifact.path });
      continue;
    }
    const bytes = fs.readFileSync(real);
    bind(artifact.byteLength, bytes.length, "$.artifacts", "REPOSITORY_ARTIFACT_BYTE_LENGTH_MISMATCH", add, { artifactId, path: artifact.path });
    bind(artifact.sha256, sha256Bytes(bytes), "$.artifacts", "REPOSITORY_ARTIFACT_HASH_MISMATCH", add, { artifactId, path: artifact.path });
  }
}

function verifyGitBinding(repositoryPlan, repositoryRoot, add) {
  try {
    inspectDurableProjectEvidence(repositoryRoot, repositoryPlan);
  } catch (error) {
    add("blocker", coalesce(error.code, "REPOSITORY_GIT_EVIDENCE_INVALID"), "$.repository", error.message, { error: error.message });
  }
}

function validateV4SemanticArtifactFiles(repositoryPlan, inventory, repositoryRoot, add) {
  const root = fs.realpathSync(repositoryRoot);
  for (const [index, record] of coalesce(repositoryPlan.v4HookSemanticContracts, []).entries()) {
    const profileArtifact = inventory.byId.get(record.profileArtifactId);
    if (!profileArtifact) continue;
    const hook = readStrictArtifact(root, profileArtifact, `$.v4HookSemanticContracts[${index}].profileArtifactId`, "V4_SEMANTIC_PROFILE_JSON_INVALID", add);
    if (!hook) continue;
    for (const finding of validateV4HookSemanticContract(hook, { stage: "prototype", path: `$.v4HookSemanticContracts[${index}].hook` })) {
      add(finding.severity === "blocker" ? "blocker" : "review", finding.code, finding.path, finding.message, finding.details);
    }
    for (const finding of validateV4DeploymentEvidence(record, hook, inventory, root, index)) {
      add(finding.severity, finding.code, finding.path, finding.message, finding.details);
    }
  }
}

function validateTradeCapabilityFiles(repositoryPlan, inventory, repositoryRoot, projection, add) {
  if (projection.applicability !== "tradable") return;
  const root = fs.realpathSync(repositoryRoot);
  const commands = new Map(coalesce(repositoryPlan.commands, []).map((command) => [command.id, command]));
  const resultsByCommand = new Map(coalesce(repositoryPlan.commandResults, []).map((result) => [result.commandId, result]));
  const seenResults = new Set();
  for (const [marketIndex, market] of coalesce(repositoryPlan.tradeCapability?.markets, []).entries()) {
    const base = `$.tradeCapability.markets[${marketIndex}]`;
    const manifestArtifact = inventory.byId.get(market.manifestArtifactId);
    if (!manifestArtifact) continue;
    const manifest = readStrictArtifact(root, manifestArtifact, `${base}.manifestArtifactId`, "TRADE_CAPABILITY_MANIFEST_JSON_INVALID", add);
    if (!manifest) continue;
    if (fs.readFileSync(resolveInside(root, manifestArtifact.path), "utf8") !== `${canonicalJsonV2(manifest)}\n`) add("blocker", "TRADE_CAPABILITY_MANIFEST_NOT_CANONICAL", `${base}.manifestArtifactId`, "Manifest not canonical.");
    applyTradeFindings(validateTradeCapabilityManifestV1(manifest, { applicationId: repositoryPlan.applicationId, marketRef: market.marketSystemRef, routeType: market.routeType }), `${base}.manifestArtifactId`, add);
    validateManifestRepositoryBindings(manifest, manifestArtifact, inventory, `${base}.manifestArtifactId`, add);
    const manifestSha256 = tradeCapabilityManifestSha256V1(manifest);
    if (any(manifest.applicationId !== repositoryPlan.applicationId, manifest.marketRef !== market.marketSystemRef, manifest.manifestId !== manifestArtifact.id, manifest.route?.type !== market.routeType, manifest.status !== "NOT_APPROVED")) add("blocker", "TRADE_CAPABILITY_MANIFEST_BINDING_INVALID", `${base}.manifestArtifactId`, "Manifest binding mismatch.");
    const observedTradeResults = [];
    for (const [tests, kind] of [[coalesce(manifest.testEvidence?.quoteTests, []), "quote-test"], [coalesce(manifest.testEvidence?.executionTests, []), "execution-test"]]) {
      for (const [testIndex, test] of tests.entries()) {
        const command = commands.get(test.commandId);
        const resultArtifact = inventory.byPath.get(test.resultArtifactPath);
        const sourceArtifact = inventory.byPath.get(test.testSourceArtifact?.path);
        const resultPath = `${base}.${kind === "quote-test" ? "quoteCommandIds" : "executionCommandIds"}[${testIndex}]`;
        if (command?.kind !== kind || canonicalJsonSha256V2(command?.argv) !== canonicalJsonSha256V2(test.command?.argv) || command?.cwd !== test.command?.workingDirectory) add("blocker", "TRADE_COMMAND_BINDING_INVALID", resultPath, "Command mismatch.", { commandId: test.commandId });
        if (all(Boolean(command), test.command?.environmentSha256 !== projectCommandEnvironmentSha256(command))) add("blocker", "TRADE_TEST_ENVIRONMENT_BINDING_INVALID", resultPath, "Executor profile mismatch.", { commandId: test.commandId });
        if (any(!sourceArtifact, inventory.groupById.get(sourceArtifact?.id) !== "tests", sourceArtifact?.sha256 !== test.testSourceArtifact?.sha256, sourceArtifact?.byteLength !== test.testSourceArtifact?.byteLength)) add("blocker", "TRADE_TEST_SOURCE_BINDING_INVALID", resultPath, "Test source binding mismatch.", { commandId: test.commandId });
        if (any(!resultArtifact, resultArtifact?.kind !== "trade-test-result", inventory.groupById.get(resultArtifact?.id) !== "evidence", seenResults.has(resultArtifact?.id))) {
          add("blocker", "TRADE_RESULT_ARTIFACT_BINDING_INVALID", resultPath, "Distinct declared result missing.", { commandId: test.commandId });
          continue;
        }
        seenResults.add(resultArtifact.id);
        const tradeResult = readStrictArtifact(root, resultArtifact, resultPath, "TRADE_TEST_RESULT_JSON_INVALID", add);
        if (!tradeResult) continue;
        if (fs.readFileSync(resolveInside(root, resultArtifact.path), "utf8") !== `${canonicalJsonV2(tradeResult)}\n`) add("blocker", "TRADE_TEST_RESULT_NOT_CANONICAL", resultPath, "Result is not canonical JSON.");
        applyTradeFindings(validateTradeTestResultV1(tradeResult, { manifest, test }), resultPath, add);
        if (all(kind === "execution-test", any(tradeResult.scenario !== test.scenario, tradeResult.outcome !== (test.expectedOutcome === "swap-succeeds" ? "swap-succeeded" : "reverted-before-effects")))) add("blocker", "TRADE_TEST_RESULT_OUTCOME_MISMATCH", resultPath, "Scenario/outcome mismatch.");
        observedTradeResults.push({ kind, test, result: tradeResult });
        const commandResult = resultsByCommand.get(test.commandId);
        const receiptArtifact = inventory.byId.get(commandResult?.evidenceArtifactId);
        const receipt = receiptArtifact && readStrictArtifact(root, receiptArtifact, resultPath, "COMMAND_RECEIPT_JSON_INVALID", add);
        const expectedDomain = { contract: "trade-command-domain-evidence-v1", manifestArtifactId: manifestArtifact.id, manifestSha256, marketRef: market.marketSystemRef, testId: test.id, modeRef: test.modeRef, semanticAdequacy: TRADE_TEST_SEMANTIC_ADEQUACY_V1, runnerEvidence: receipt?.domainEvidence?.runnerEvidence ?? null, resultContract: kind === "quote-test" ? "trade-quote-test-result-v1" : "trade-execution-test-result-v1", resultArtifactId: resultArtifact.id, resultArtifactPath: resultArtifact.path, resultArtifactSha256: resultArtifact.sha256, resultArtifactByteLength: resultArtifact.byteLength };
        if (any(!receipt, !tradeRunnerDomainEvidenceMatchesV1(receipt, test, tradeResult), canonicalJsonSha256V2(coalesce(receipt?.domainEvidence, null)) !== canonicalJsonSha256V2(expectedDomain))) add("blocker", "TRADE_DOMAIN_RECEIPT_BINDING_MISMATCH", resultPath, "Runner mismatch.", { commandId: test.commandId });
      }
    }
    for (const execution of observedTradeResults.filter(({ kind, test }) => all(kind === "execution-test", test.scenario === "successful-swap"))) {
      const quote = observedTradeResults.find(({ kind, test }) => all(kind === "quote-test", test.modeRef === execution.test.modeRef));
      if (quote) applyTradeFindings(validateTradeResultPairV1(quote.result, execution.result, { manifest, quoteTest: quote.test, executionTest: execution.test }), base, add);
    }
  }
  const plannedResults = [...inventory.byId.values()].filter(({ kind }) => kind === "trade-test-result");
  if (seenResults.size !== plannedResults.length) add("blocker", "TRADE_RESULT_ARTIFACT_ORPHAN", "$.artifacts.evidence", "Unconsumed trade result.", { consumed: seenResults.size, observed: plannedResults.length });
}

function applyTradeFindings(findings, fallbackPath, add) {
  for (const finding of findings) add("blocker", finding.code, coalesce(finding.path, fallbackPath), finding.message, finding.details);
}

function validateManifestRepositoryBindings(manifest, manifestArtifact, inventory, findingPath, add) {
  const requireBound = (label, artifactPath, artifactSha256 = null, byteLength = null, artifactId = null) => {
    const artifact = inventory.byPath.get(artifactPath);
    if (any(!artifact, artifact?.status !== "verified", all(artifactId !== null, artifact?.id !== artifactId),
      all(artifactSha256 !== null, artifact?.sha256 !== artifactSha256), all(byteLength !== null, artifact?.byteLength !== byteLength))) {
      add("blocker", "TRADE_MANIFEST_REPOSITORY_BINDING_INVALID", findingPath, `Unbound: ${label}.`, { artifactPath, artifactId, artifactSha256, byteLength });
    }
  };
  requireBound("route implementation", manifest.source.routeImplementationPath, manifest.source.routeImplementationSha256);
  requireBound("route implementation closure", manifest.source.routeImplementationClosurePath, manifest.source.routeImplementationClosureSha256);
  if ([manifest.source.routeImplementationPath, manifest.source.routeImplementationClosurePath].some((value) => any(value === manifestArtifact.path, /^\.programmable\/(?:command-receipts|trade-test-results)\//u.test(value)))) add("blocker", "TRADE_SOURCE_CLOSURE_INVALID", findingPath, "Source closure includes output evidence.");
  requireBound("dependency lock", manifest.dependencies.lockfilePath, manifest.dependencies.lockfileSha256);
  const endpoints = [manifest.route.router, manifest.route.quoter, manifest.route.adapter, manifest.route.transport?.router, manifest.route.transport?.quoter].filter(Boolean);
  for (const endpoint of endpoints) requireBound("deployment evidence", endpoint.deploymentEvidenceRef);
  for (const funding of coalesce(manifest.route.fundingProfiles, [])) if (funding.permit2?.mode === "used") requireBound("Permit2 deployment evidence", funding.permit2.deploymentEvidenceRef);
  const conformance = manifest.route.canonicalInterface?.conformanceArtifact;
  if (manifest.route.canonicalInterface) requireBound("adapter interface schema", manifest.route.canonicalInterface.schemaPath, manifest.route.canonicalInterface.schemaSha256);
  if (conformance) requireBound("adapter conformance", conformance.path, conformance.sha256, conformance.byteLength);
  const fee = manifest.feeBehavior.programmableFeeV2;
  if (fee.applicability === "applicable") requireBound("fee conformance receipt", fee.receiptPath, fee.receiptSha256, null, fee.receiptArtifactId);
}

function selectedContractComponentRefs(selected, systemNodes, componentNodes) {
  const result = new Set();
  for (const id of coalesce(selected?.graphNodeRefs, [])) {
    const component = componentNodes.get(id);
    if (["contract", "hook", "token", "factory", "vault", "escrow", "game-contract", "nft-system"].includes(component?.type)) result.add(id);
    const system = systemNodes.get(id);
    if (system?.type === "contract") result.add(id);
  }
  return result;
}

function requireArtifact(artifactId, group, kind, findingPath, inventory, add) {
  const artifact = inventory.byId.get(artifactId);
  if (!artifact) {
    add("blocker", "V4_SEMANTIC_ARTIFACT_UNKNOWN", findingPath, `Semantic-contract artifact ${artifactId} is unknown.`);
    return;
  }
  if (inventory.groupById.get(artifactId) !== group) add("blocker", "V4_SEMANTIC_ARTIFACT_GROUP_INVALID", findingPath, `Artifact ${artifactId} must be in ${group}.`, { observed: inventory.groupById.get(artifactId) });
  if (all(kind !== null, artifact.kind !== kind)) add("blocker", "V4_SEMANTIC_ARTIFACT_KIND_INVALID", findingPath, `Artifact ${artifactId} must have kind ${kind}.`, { observed: artifact.kind });
}

function readStrictArtifact(root, artifact, findingPath, code, add) {
  const resolved = resolveInside(root, artifact.path);
  if (any(resolved === null, !fs.existsSync(coalesce(resolved, "")))) return null;
  try {
    return parseBoundedStrictJsonBytes(fs.readFileSync(resolved));
  } catch (error) {
    add("blocker", code, findingPath, error.message, { artifactId: artifact.id, path: artifact.path });
    return null;
  }
}

function validateValueAgainstNamedSchema(value, schemaName, code, findingPath, add) {
  let schema = schemaCache.get(schemaName);
  if (!schema) {
    schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", schemaName), "utf8"));
    schemaCache.set(schemaName, schema);
  }
  for (const finding of validateAgainstSchema(value, schema)) add("blocker", code, coalesce(finding.path, findingPath), `${coalesce(finding.code, "SCHEMA")}: ${coalesce(finding.message, String(finding))}`, { schema: schema.$id, schemaCode: coalesce(finding.code, null) });
}

function validateSchema(value, schemaName, code, add) {
  let schema = schemaCache.get(schemaName);
  if (!schema) {
    schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", schemaName), "utf8"));
    schemaCache.set(schemaName, schema);
  }
  for (const finding of validateAgainstSchema(value, schema)) add("blocker", code, coalesce(finding.path, "$"), `${coalesce(finding.code, "SCHEMA")}: ${coalesce(finding.message, String(finding))}`, { schema: schema.$id, schemaCode: coalesce(finding.code, null) });
}

function resolveInside(root, repositoryPath) {
  if (typeof repositoryPath !== "string") return null;
  const resolved = path.resolve(root, repositoryPath);
  return insideRoot(root, resolved) ? resolved : null;
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return any(relative === "", all(!relative.startsWith(".."), !path.isAbsolute(relative)));
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function allowedEvidencePath(repositoryPath, repositoryPlan) {
  if (any(repositoryPath === ".programmable/repository-plan.v1.json",
    repositoryPath === ".programmable/project-spec.v1.json",
    repositoryPath === ".programmable/product-graph.v1.json",
    repositoryPath === ".programmable/architecture-candidates.v1.json",
    /^\.programmable\/project-states\/[0-9]{6}-[a-z0-9-]+\.v1\.json$/u.test(repositoryPath))) return true;
  return Object.values(coalesce(repositoryPlan?.artifacts, {})).flat().some((artifact) => all(["command-receipt", "trade-test-result"].includes(artifact.kind), artifact.path === repositoryPath));
}

function requiredGitEvidence(root, args, code) {
  const result = gitEvidence(root, args);
  if (!result.ok) throw gitEvidenceError(code, `Git evidence command failed: git ${args.join(" ")}`, { error: result.error });
  return result.output;
}

function gitEvidence(root, args) {
  const result = spawnSafeGitSync(["-C", root, ...args], { encoding: "utf8", timeout: 10_000 });
  return result.status === 0
    ? { ok: true, status: 0, output: result.stdout.trim() }
    : { ok: false, status: result.status, error: (result.stderr || result.error?.message || `exit ${result.status}`).trim() };
}

function gitEvidenceError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function bind(observed, expected, findingPath, code, add, details = {}) {
  if (any(expected === undefined, expected === null, observed === expected)) return;
  add("blocker", code, findingPath, "Bound value does not match its authoritative source.", { ...details, expected, observed: coalesce(observed, null) });
}

function findingAdder(findings) {
  const seen = new Set();
  return (severity, code, findingPath, message, details = {}) => {
    const key = `${severity}:${code}:${findingPath}:${JSON.stringify(details)}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ severity, code, path: findingPath, message, details });
  };
}

function sorted(findings) {
  return findings.sort((left, right) => (
    severityOrder[left.severity] - severityOrder[right.severity]
    || left.code.localeCompare(right.code)
    || left.path.localeCompare(right.path)
  ));
}

function isObject(value) {
  return all(value !== null, typeof value === "object", !Array.isArray(value));
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
