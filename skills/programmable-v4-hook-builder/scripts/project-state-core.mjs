import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256V2 } from "./canonical-json-core.mjs";
import {
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_FEE_NOT_APPLICABLE,
  OPEN_WORLD_V2_SUBMISSION_FILE,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
  PROGRAMMABLE_FEE_V2,
  architectureSnapshotSha256,
  sha256Bytes,
  validateOpenWorldV2Package
} from "./open-world-v2-core.mjs";
import { bundledSchemas } from "./open-world-v2-contracts.mjs";
import { createOpenWorldDraftPackage } from "./open-world-v2-draft-core.mjs";
import { canonicalJson } from "./open-world-v2-primitives.mjs";
import { PROJECT_SPEC_FACETS, projectArtifactSha256 } from "./project-contracts-core.mjs";
import { validateAgainstSchema } from "./submission-core.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const severityOrder = Object.freeze({ blocker: 0, review: 1, advisory: 2 });
const phaseOrder = Object.freeze([
  "project-spec",
  "product-graphs",
  "architecture-selection",
  "repository-materialization",
  "verification",
  "submission-evidence"
]);
const phaseArtifacts = Object.freeze({
  "project-spec": ["projectSpec"],
  "product-graphs": ["projectSpec", "productGraph"],
  "architecture-selection": ["projectSpec", "productGraph", "architectureCandidates"],
  "repository-materialization": ["projectSpec", "productGraph", "architectureCandidates", "repositoryPlan"],
  verification: ["projectSpec", "productGraph", "architectureCandidates", "repositoryPlan"],
  "submission-evidence": ["projectSpec", "productGraph", "architectureCandidates", "repositoryPlan"]
});

export function validateProjectState(projectSpec, productGraph, architectureCandidates, repositoryPlan, projectState, options = {}) {
  const findings = [];
  const add = findingAdder(findings);
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references/project-state-v1.schema.json"), "utf8"));
  for (const finding of validateAgainstSchema(projectState, schema)) add("blocker", "PROJECT_STATE_SCHEMA_INVALID", finding.path ?? "$", `${finding.code ?? "SCHEMA"}: ${finding.message ?? String(finding)}`, { schema: schema.$id, schemaCode: finding.code ?? null });
  if (!isObject(projectState)) return sorted(findings);

  const expectedStateSha256 = projectStatePayloadSha256(projectState);
  if (projectState.integrity?.stateSha256 !== expectedStateSha256) add("blocker", "PROJECT_STATE_HASH_MISMATCH", "$.integrity.stateSha256", "State integrity must bind canonical JSON v2 of the complete state with integrity omitted.", { expected: expectedStateSha256, observed: projectState.integrity?.stateSha256 ?? null });
  bind(projectState.applicationId, projectSpec?.applicationId, "$.applicationId", "STATE_APPLICATION_ID_MISMATCH", add);
  bind(projectState.intentSha256, projectSpec?.intent?.sha256, "$.intentSha256", "STATE_INTENT_HASH_MISMATCH", add);

  const artifacts = { projectSpec, productGraph, architectureCandidates, repositoryPlan };
  const requiredBindings = phaseArtifacts[projectState.phase] ?? [];
  for (const key of Object.keys(artifacts)) validateArtifactBinding(key, artifacts[key], projectState.artifacts?.[key], requiredBindings, add, projectState.phase);

  const phaseIndex = phaseOrder.indexOf(projectState.phase);
  if (phaseIndex >= 0 && projectState.sequence < phaseIndex + 1) add("blocker", "STATE_PHASE_SEQUENCE_PREMATURE", "$.sequence", "A checkpoint cannot skip the required preceding phase sequence.", { phase: projectState.phase, minimumSequence: phaseIndex + 1, observed: projectState.sequence });
  if (phaseIndex >= phaseOrder.indexOf("architecture-selection")) bind(projectState.selectedArchitectureId, architectureCandidates?.selection?.candidateId, "$.selectedArchitectureId", "STATE_SELECTION_MISMATCH", add);
  else if (projectState.selectedArchitectureId !== null) add("blocker", "STATE_SELECTION_PREMATURE", "$.selectedArchitectureId", "Architecture selection cannot be recorded before the comparison phase.");

  validateProvenanceCheckpoint(projectSpec, projectState, add);
  validateGraphCheckpoint(productGraph, projectState, add);
  validateRepositoryCheckpoint(repositoryPlan, projectState, phaseIndex, add);
  validateCheckpointStatus(projectState, add);
  validatePreviousState(projectState, options.previousState, add);
  return sorted(findings);
}

export function projectStatePayloadSha256(projectState) {
  if (!isObject(projectState)) throw new TypeError("projectState must be an object");
  const { integrity: _integrity, ...payload } = projectState;
  return canonicalJsonSha256V2(payload);
}

export function sealProjectState(payload, { previousState = null } = {}) {
  if (!isObject(payload)) throw new TypeError("project state payload must be an object");
  const { integrity: _integrity, ...statePayload } = structuredClone(payload);
  return {
    ...statePayload,
    integrity: {
      canonicalization: "urn:programmable:canonical-json:2.0.0",
      stateSha256: canonicalJsonSha256V2(statePayload),
      previousStateSha256: previousState === null ? null : projectStatePayloadSha256(previousState)
    }
  };
}

export function createNoMarketProjectAuthoring({ applicationId, ideaText, sourcePath, sourceBytes, testPath, testBytes } = {}) {
  const projectSpec = authorProjectSpec(applicationId, ideaText);
  const productGraph = authorProductGraph(projectSpec, sourcePath, testPath);
  const architectureCandidates = authorArchitectures(projectSpec, productGraph);
  const submissionPackage = authorNoMarketSubmission(applicationId, ideaText, sourcePath, testPath);
  const files = authorRepositoryFiles({ applicationId, projectSpec, sourcePath, sourceBytes, testPath, testBytes, submissionPackage });
  const repositoryPlan = authorRepositoryPlan({ projectSpec, productGraph, architectureCandidates, files, sourcePath, testPath });
  const authored = { projectSpec, productGraph, architectureCandidates, repositoryPlan, files, submissionReport: submissionPackage.report };
  bindLocalReleaseHandoffV1({ authored, applicationId, classification: "no-market", marketRef: null, ideaSha256: projectSpec.intent.sha256 });
  return authored;
}

export function bindLocalReleaseHandoffV1({ authored, applicationId, classification, marketRef = null, ideaSha256, repositoryRoot = null, tradeEvidence = null } = {}) {
  if (!(authored?.files instanceof Map)) throw new TypeError("authored.files must be a Map");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(applicationId ?? "") || !["no-market", "tradable"].includes(classification)) throw new TypeError("local handoff identity is invalid");
  if ((classification === "tradable") !== (typeof marketRef === "string" && marketRef.length > 0)) throw new TypeError("local handoff market identity is invalid");
  const submissionPath = "submission/submission.v2.json", submissionBytes = authored.files.get(submissionPath);
  if (!Buffer.isBuffer(submissionBytes)) throw new Error("handoff requires Submission bytes");
  const submission = JSON.parse(submissionBytes.toString("utf8")), report = authored.submissionReport, ideaBinding = submission.intentPackage?.ideaSource, ideaBytes = authored.files.get(`submission/${ideaBinding?.path}`), ideaSource = Buffer.isBuffer(ideaBytes) ? JSON.parse(ideaBytes.toString("utf8")) : null, originalIdea = ideaSource?.entries?.find(({ id }) => id === ideaSource.originalEntryId);
  const markets = submission.tradeCapability?.markets ?? [];
  if (authored.projectSpec?.intent?.sha256 !== ideaSha256 || originalIdea?.sha256 !== ideaSha256 || originalIdea?.publicTextUtf8 !== authored.projectSpec.intent.verbatimText || sha256Bytes(ideaBytes) !== ideaBinding.sha256 || ideaBytes.length !== ideaBinding.byteLength || submission.applicationId !== applicationId || submission.tradeCapability?.applicability !== classification || (classification === "tradable" ? markets.length !== 1 || markets[0].marketRef !== marketRef : markets.length !== 0)) throw new Error("handoff identity mismatch");
  if (!/^sha256:[0-9a-f]{64}$/u.test(ideaSha256 ?? "") || typeof report?.status !== "string" || typeof report?.automaticMaterialization !== "boolean") throw new Error("handoff report incomplete");
  const handoff = renderGitHubSubmissionHandoffV1({ applicationId, classification, marketRef, ideaSha256, submissionBytes, report, tradeStatus: classification === "tradable" ? tradeEvidence?.status : "NOT_APPLICABLE" });
  authored.files.set("GITHUB-SUBMISSION.md", handoff);
  if (classification === "no-market") {
    const artifact = authored.repositoryPlan?.artifacts?.documentation?.find(({ path: artifactPath }) => artifactPath === "GITHUB-SUBMISSION.md");
    if (!artifact) throw new Error("no-market RepositoryPlan omits the local GitHub handoff");
    artifact.sha256 = sha256Bytes(handoff); artifact.byteLength = handoff.length;
  } else {
    if (typeof repositoryRoot !== "string" || !tradeEvidence) throw new Error("tradable handoff requires its materialized repository and evidence");
    authored.files.set("README.md", renderTradableEvidenceReadmeV1(fs.readFileSync(path.join(repositoryRoot, "README.md")), tradeEvidence));
  }
  return authored;
}

export function renderGitHubSubmissionHandoffV1({ applicationId, classification, marketRef = null, ideaSha256, submissionBytes, report, tradeStatus } = {}) {
  if (!Buffer.isBuffer(submissionBytes) || !/^sha256:[0-9a-f]{64}$/u.test(ideaSha256 ?? "")) throw new TypeError("handoff requires exact idea and Submission bytes");
  if (classification === "tradable" && tradeStatus !== "NOT_APPROVED") throw new Error("tradable handoff must remain NOT_APPROVED");
  const state = ".programmable/project-states/000006-submission-evidence.v1.json", previous = ".programmable/project-states/000005-verification.v1.json";
  const payload = {
    schemaVersion: "1.0.0", kind: "github-submission-handoff", status: "NOT_SUBMITTED", requiresHumanConfirmation: true,
    application: { applicationId, classification, marketRef, ideaSha256, tradeStatus },
    submission: { path: "submission/submission.v2.json", sha256: sha256Bytes(submissionBytes), byteLength: submissionBytes.length, reportStatus: report.status, reportSha256: canonicalJsonSha256V2(report), automaticMaterialization: report.automaticMaterialization },
    externalRepository: { numericRepositoryId: { status: "UNRESOLVED_EXTERNAL_REQUIRED", value: null }, canonicalRepositoryUri: { status: "UNRESOLVED_EXTERNAL_REQUIRED", value: null } },
    localIdentityCommands: {
      sourceCommit: "git rev-list --max-parents=0 HEAD", sourceTree: "git rev-parse \"$(git rev-list --max-parents=0 HEAD)^{tree}\"",
      evidenceCommit: "git rev-parse HEAD", evidenceTree: "git rev-parse HEAD^{tree}", worktree: "git status --porcelain --untracked-files=all", submissionSha256: "shasum -a 256 submission/submission.v2.json"
    },
    localVerificationCommands: {
      install: classification === "tradable" ? "npm ci --ignore-scripts --prefer-offline --no-audit --no-fund" : "node tools/project-stage.mjs install",
      check: classification === "tradable" ? "node tools/run-project-gate.mjs evidence" : "npm test",
      requireOutput: `node \"$SKILL_ROOT/scripts/cli.mjs\" project require-output --repository-root . --state ${state} --previous-state ${previous} --submission-root submission`
    },
    evidenceBoundary: { githubWritePerformed: false, externalActionsPerformed: [], approvalCreated: false, auditClaimed: false, deploymentPerformed: false, publicationPerformed: false, launchPerformed: false }
  };
  return Buffer.from(`# GitHub submission handoff\n\n${canonicalJson(payload)}\n`, "utf8");
}

function renderTradableEvidenceReadmeV1(readmeBytes, evidence) {
  const stale = "The local quoter/router matrix is not RPC-backed `eth_call` evidence, fork evidence,\ndeployed-address verification, signature-based Permit2 coverage, a quoter/router audit or proof for a different package\nrevision.";
  const staleReceipt = "The example JSON under `evidence/` remains a placeholder checklist, not a complete receipt.";
  const replacement = "The local quoter/router matrix is not RPC-backed `eth_call` evidence, deployed-address verification,\nsignature-based Permit2 coverage, a quoter/router audit or proof for a different package revision. A separate pinned\nread-only mainnet fork canary observes exact external runtime hashes and local-only registration; it is not a deployment,\ntransaction broadcast, audit, approval or production claim.";
  const source = readmeBytes.toString("utf8");
  if (!source.includes(stale) || !source.includes(staleReceipt) || source.includes("## Materialized local evidence")) throw new Error("tradable README boundary cannot be deterministically rebound");
  const file = (artifactPath) => {
    const binding = evidence.evidenceFiles.find(({ path: evidencePath }) => evidencePath === artifactPath);
    if (!binding || !/^sha256:[0-9a-f]{64}$/u.test(binding.sha256 ?? "")) throw new Error(`tradable README evidence is missing ${artifactPath}`);
    return { path: artifactPath, sha256: binding.sha256 };
  };
  const entries = [
    { label: "Trade capability manifest", path: evidence.manifest.path, sha256: evidence.manifest.sha256 },
    { label: "Fee conformance receipt", path: evidence.feeConformance.receiptPath, sha256: evidence.feeConformance.receiptSha256 },
    { label: "Fee conformance vector set", path: evidence.feeConformance.vectorSetPath, sha256: evidence.feeConformance.vectorSetSha256 },
    { label: "Read-only mainnet fork canary", path: evidence.forkEvidence.path, sha256: evidence.forkEvidence.sha256 },
    ...[["V4 semantic profile", evidence.v4.paths.profile], ["V4 deployment preimage", evidence.v4.paths.preimage], ["V4 deployment manifest", evidence.v4.paths.manifest], ["V4 runtime code", evidence.v4.paths.runtime]].map(([label, artifactPath]) => ({ label, ...file(artifactPath) }))
  ];
  for (const entry of entries) if (!entry.path || !/^sha256:[0-9a-f]{64}$/u.test(entry.sha256 ?? "")) throw new Error(`tradable README evidence binding is invalid: ${entry.label}`);
  const appendix = `\n\n## Materialized local evidence\n\nStatus: **${evidence.status}**. These repository-local artifacts are byte-bound to this candidate:\n\n${entries.map(({ label, path: artifactPath, sha256 }) => `- ${label}: \`${artifactPath}\` — \`${sha256}\``).join("\n")}\n\nBoundary: local evidence only; no audit, approval, production deployment, transaction broadcast, GitHub publication or launch is claimed.\n`;
  const receiptBoundary = "The legacy example JSON under `evidence/` remains illustrative only. The materialized typed receipt and vector set listed below are this candidate's local fee-conformance artifacts; they remain NOT_APPROVED.";
  return Buffer.from(`${source.replace(stale, replacement).replace(staleReceipt, receiptBoundary).trimEnd()}${appendix}`, "utf8");
}

export function createProjectStateChain({ projectSpec, productGraph, architectureCandidates, repositoryPlan }) {
  const artifactPaths = {
    projectSpec: ".programmable/project-spec.v1.json",
    productGraph: ".programmable/product-graph.v1.json",
    architectureCandidates: ".programmable/architecture-candidates.v1.json",
    repositoryPlan: ".programmable/repository-plan.v1.json"
  };
  const phases = ["project-spec", "product-graphs", "architecture-selection", "repository-materialization", "verification", "submission-evidence"];
  const entries = Object.values(projectSpec.facets).flatMap(({ entries: values }) => values);
  const provenanceRefs = (provenance) => entries.filter((entry) => entry.provenance === provenance).map(({ id }) => id);
  const binding = (value, key) => value === undefined ? null : { path: artifactPaths[key], sha256: projectArtifactSha256(value) };
  const states = [];
  for (const [index, phase] of phases.entries()) {
    const sequence = index + 1;
    const graph = sequence >= 2 ? productGraph : undefined;
    const architectures = sequence >= 3 ? architectureCandidates : undefined;
    const plan = sequence >= 4 ? repositoryPlan : undefined;
    states.push(sealProjectState({
      schemaVersion: "1.0.0", applicationId: projectSpec.applicationId, sequence, phase, status: "locally-complete", intentSha256: projectSpec.intent.sha256,
      artifacts: { projectSpec: binding(projectSpec, "projectSpec"), productGraph: binding(graph, "productGraph"), architectureCandidates: binding(architectures, "architectureCandidates"), repositoryPlan: binding(plan, "repositoryPlan") },
      selectedArchitectureId: architectures?.selection.candidateId ?? null,
      provenanceRefs: { confirmed: provenanceRefs("confirmed"), builderAssumptions: provenanceRefs("builder-assumption"), ownerRequired: [], externalUnresolved: [] },
      graphRefs: { invariants: graph?.graphs.invariant.invariants.map(({ id }) => id) ?? [], failures: graph?.graphs.failureRecovery.failures.map(({ id }) => id) ?? [], recoveries: graph?.graphs.failureRecovery.recoveries.map(({ id }) => id) ?? [] },
      repository: { root: ".", branch: plan?.repository.branch ?? null, headCommit: plan?.repository.headCommit ?? null, generatedPaths: plan === undefined ? [] : Object.values(plan.artifacts).flat().map(({ path: artifactPath }) => artifactPath) },
      commandResults: plan?.commandResults ?? [], blockers: [],
      next: { action: sequence === 6 ? "Run strict project output preflight." : `Continue after ${phase}.`, workingDirectory: ".", resumeCommand: ["node", "scripts/cli.mjs", "project", "validate", "--repository-root", ".", "--state", `.programmable/project-states/${String(sequence).padStart(6, "0")}-${phase}.v1.json`] },
      authorization: noProjectAuthorization()
    }, { previousState: states.at(-1) ?? null }));
  }
  return states;
}

function authorProjectSpec(applicationId, ideaText) {
  const ideaBytes = Buffer.from(ideaText, "utf8");
  const span = { startByte: 0, endByte: ideaBytes.length, sha256: sha256Bytes(ideaBytes) };
  const entry = (id, kind, provenance = "builder-assumption", applicability = "applicable") => ({
    id, kind, applicability, statement: provenance === "confirmed" ? "The exact supplied idea is the authoritative product intent." : `${id} is a bounded local authoring assumption.`, provenance,
    sourceSpans: provenance === "confirmed" ? [span] : [], rationale: "The assumption is explicit and can be replaced only by a new intent-bound revision.", ownerQuestion: null, externalDependencyRefs: [], evidenceRefs: []
  });
  const facets = Object.fromEntries(PROJECT_SPEC_FACETS.map((name) => [name, { applicability: "applicable", summary: `${name} is modeled as an explicit local reference boundary.`, entries: [entry(`${camelSlug(name)}-boundary`, "product-boundary")] }]));
  facets.userExperience.entries = [entry("preserved-user-idea", "user-intent", "confirmed")];
  facets.lifecycle.entries = ["creation", "use", "claim", "exit", "decommissioning"].map((kind) => entry(`lifecycle-${kind}`, kind));
  facets.parameters.entries = [entry("parameter-mutable", "mutable-parameter"), entry("parameter-immutable", "immutable-parameter")];
  facets.assumptions.entries = [entry("assumption-intent-source", "confirmed-assumption", "confirmed"), entry("assumption-local-reference", "builder-assumption")];
  facets.priceAndMarketMechanics = { applicability: "not-applicable", summary: "The requested classification has no market or price discovery.", entries: [entry("market-not-applicable", "market-applicability", "builder-assumption", "not-applicable")] };
  facets.routing = { applicability: "not-applicable", summary: "No market exists, so no quote or execution route may be manufactured.", entries: [entry("trade-capability-not-applicable", "trade-capability", "builder-assumption", "not-applicable")] };
  facets.ownerDecisions = { applicability: "not-applicable", summary: "No material owner decision is asserted by this local reference output.", entries: [entry("owner-decision-none", "no-owner-decision", "builder-assumption", "not-applicable")] };
  return { schemaVersion: "1.0.0", applicationId, revision: 1, intent: { encoding: "utf-8", verbatimText: ideaText, byteLength: ideaBytes.length, sha256: sha256Bytes(ideaBytes) }, facets, extensions: [] };
}

function authorProductGraph(projectSpec, sourcePath, testPath) {
  const facetEntryRefs = Object.values(projectSpec.facets).flatMap(({ entries }) => entries.filter(({ applicability }) => applicability !== "not-applicable").map(({ id }) => id));
  const invariant = "bounded-state-conservation";
  const failure = "local-kernel-failure";
  const recovery = "restore-local-state";
  return {
    schemaVersion: "1.0.0", applicationId: projectSpec.applicationId, revision: projectSpec.revision, projectSpecSha256: projectArtifactSha256(projectSpec),
    graphs: {
      system: { applicability: "applicable", justification: "One local kernel is the smallest implementation boundary.", nodes: [{ id: "local-kernel", label: "Idea-specific local kernel", type: "service", protocolRole: "none", implementationStatus: "planned", facetEntryRefs }], edges: [] },
      state: { applicability: "applicable", justification: "The kernel has explicit available and completed states.", states: [{ id: "available-state", label: "Available", initial: true, terminal: false, entryAuthorityRefs: ["local-user"], invariantRefs: [invariant] }, { id: "completed-state", label: "Completed", initial: false, terminal: true, entryAuthorityRefs: ["local-user"], invariantRefs: [invariant] }], transitions: [{ id: "complete-transition", from: "available-state", to: "completed-state", trigger: "The idea-specific completion condition succeeds.", guards: ["The local input passes the authored contract guards."], effects: ["The bounded state transition is recorded."], authorityRefs: ["local-user"], failureRef: failure }] },
      value: { applicability: "applicable", justification: "No financial asset or market value is created; only local records move.", nodes: [{ id: "input-record", label: "Input record", type: "source", assetRefs: ["local-record"], custodyRef: null }, { id: "completed-record", label: "Completed record", type: "sink", assetRefs: ["local-record"], custodyRef: null }], edges: [{ id: "record-transition", from: "input-record", to: "completed-record", assetRef: "local-record", amountModel: "One bounded local record.", purpose: "Represent the idea-specific state transition.", authorityRefs: ["local-user"], liabilityEffect: "none", backingRef: null, failureDestinationRef: null, conservationInvariantRef: invariant }] },
      authority: { applicability: "applicable", justification: "Only the local caller invokes the generated reference behavior.", nodes: [{ id: "local-user", label: "Local caller", type: "user", mutable: false, trustAssumption: "The caller supplies locally tested inputs." }], edges: [{ id: "local-user-controls-kernel", authorityRef: "local-user", targetRef: "local-kernel", capability: "invoke", scope: "Local reference execution only.", revocable: false, delayModel: "Immediate." }] },
      trust: { applicability: "applicable", justification: "Untrusted input crosses one local validation boundary.", zones: [{ id: "caller-zone", label: "Caller", trustModel: "Input is untrusted.", memberRefs: ["local-user"] }, { id: "kernel-zone", label: "Kernel", trustModel: "Behavior is limited to the supplied source and tests.", memberRefs: ["local-kernel"] }], boundaries: [{ id: "caller-kernel-boundary", fromZone: "caller-zone", toZone: "kernel-zone", assumption: "Input guards are exercised by the supplied tests.", failureRef: failure, mitigationRefs: [invariant] }] },
      component: { applicability: "applicable", justification: "One source module is the complete local reference component.", components: [{ id: "service-component", label: "Idea-specific service component", type: "backend", disposition: "build", systemRefs: ["local-kernel"], responsibilities: ["Implement only the supplied no-market idea behavior."], interfaceRefs: [], authorityRefs: ["local-user"], valueNodeRefs: ["input-record", "completed-record"], artifactRefs: [sourcePath] }], edges: [] },
      deployment: { applicability: "applicable", justification: "A local non-deployed target records the execution boundary.", targets: [{ id: "local-deployment", label: "Local Node runtime", type: "service", systemRef: "local-kernel", chainRef: null, artifactPath: "deploy/local-service.json", addressStatus: "not-applicable", address: null, evidenceRefs: [] }], edges: [] },
      invariant: { applicability: "applicable", justification: "The authored test binds the expected state transition.", invariants: [{ id: invariant, kind: "lifecycle", statement: "A failed invocation cannot silently become a completed local record.", scopeRefs: ["service-component", "local-kernel"], testRefs: [testPath], failureRef: failure }], dependencies: [] },
      failureRecovery: { applicability: "applicable", justification: "Local failure is explicit and does not trigger an external action.", failures: [{ id: failure, label: "Local kernel failure", severity: "high", trigger: "The authored contract rejects input or its test fails.", affectedRefs: ["service-component", "local-kernel"], detection: "A required local command exits nonzero.", recoveryRef: recovery }], recoveries: [{ id: recovery, label: "Restore local state", authorityRefs: ["local-user"], steps: ["Preserve inputs, correct source or tests, and create a new revision."], restoresInvariantRefs: [invariant], terminalDisposition: "resume" }], edges: [{ id: "local-recovery-edge", failureRef: failure, recoveryRef: recovery, preconditions: ["No external action was performed."] }] }
    }, extensions: []
  };
}

function authorArchitectures(projectSpec, productGraph) {
  const dimensions = (rating) => Object.fromEntries(["trust", "capital", "liquidity", "latency", "gas", "operations", "review"].map((name) => [name, { rating, rationale: `${name} is bounded by the local no-market classification.` }]));
  const v4Usage = { pool: { disposition: "not-required", systemNodeRefs: [], rationale: "No market or pool exists." }, customHook: { disposition: "not-required", systemNodeRefs: [], rationale: "No hook is required." } };
  const candidate = (id, role, disposition, rating) => ({ id, role, disposition, summary: `${role} comparison.`, justification: disposition === "modeled" ? "The supplied local source and tests are the smallest correct no-market boundary." : "This role would add market machinery without a market.", graphNodeRefs: disposition === "modeled" ? ["local-kernel", "service-component"] : [], facetEntryRefs: [], v4Usage: structuredClone(v4Usage), dimensions: dimensions(rating), gates: [{ id: `${id}-gate`, criterion: "Preserve the supplied idea without manufacturing a market, pool, hook, or route.", nonCompensable: true, result: disposition === "modeled" ? "pass" : "inapplicable", rationale: "The no-market classification fixes the architecture boundary.", evidenceRefs: disposition === "modeled" ? ["evidence/architecture.md"] : [] }] });
  return { schemaVersion: "1.0.0", applicationId: projectSpec.applicationId, revision: projectSpec.revision, projectSpecSha256: projectArtifactSha256(projectSpec), productGraphSha256: projectArtifactSha256(productGraph), candidates: [candidate("minimum-correct-candidate", "minimum-correct", "modeled", "lower"), candidate("v4-native-candidate", "v4-native", "inapplicable", "not-applicable"), candidate("hybrid-candidate", "hybrid", "inapplicable", "not-applicable")], selection: { candidateId: "minimum-correct-candidate", rationale: "The idea-specific local source and tests preserve the no-market boundary with the least machinery.", decisiveGateRefs: ["minimum-correct-candidate-gate"] } };
}

function authorNoMarketSubmission(applicationId, ideaText, sourcePath, testPath) {
  const draft = createOpenWorldDraftPackage({ applicationId, publicIdeaText: ideaText });
  if (draft.materializationAllowed !== true) throw Object.assign(new Error("Open World draft authoring failed"), { code: "NO_MARKET_DRAFT_INVALID" });
  const values = Object.fromEntries(draft.files.map((file) => [file.path, JSON.parse(file.content)]));
  const submission = values[OPEN_WORLD_V2_SUBMISSION_FILE];
  const ideaSource = values[OPEN_WORLD_V2_ARTIFACTS.ideaSource.file];
  const intentContract = values[OPEN_WORLD_V2_ARTIFACTS.intentContract.file];
  const architectureDecisions = values[OPEN_WORLD_V2_ARTIFACTS.architectureDecisions.file];
  const intentFidelity = values[OPEN_WORLD_V2_ARTIFACTS.intentFidelity.file];
  const ideaSchemaPath = "schemas/idea-source-v1.schema.json";
  const ideaSchemaBytes = jsonBytes(bundledSchemas.ideaSource);
  const ideaProfile = { kind: "repository", schemaId: bundledSchemas.ideaSource.$id, path: ideaSchemaPath, sha256: sha256Bytes(ideaSchemaBytes), byteLength: ideaSchemaBytes.length };
  submission.stage = "prototype";
  submission.project = { name: applicationId, summary: { language: "en", text: "An idea-specific local reference implementation with no token, market, pool, hook, route, or fee-bearing execution scope." }, repository: null, license: "MIT" };
  submission.targets = [{ id: "local-node-runtime", kind: "idea-bound-local-runtime", profileSchema: structuredClone(ideaProfile), profile: structuredClone(ideaSource) }];
  submission.components = [{ id: "local-kernel", kind: "idea-specific-local-kernel", profileSchema: structuredClone(ideaProfile), profile: structuredClone(ideaSource), implementationRefs: [sourcePath], authorityRefs: [] }];
  submission.assets = []; submission.markets = []; submission.hooks = []; submission.lifecyclePhases = []; submission.valueFlows = []; submission.capabilityProfiles = [];
  submission.tradeCapability = { applicability: "no-market", facetEntryRef: "trade-capability-not-applicable", markets: [] };
  submission.implementation = { sourcePaths: [sourcePath], testPaths: [testPath], evidenceRefs: [] };
  submission.supportingPackage.securityAssessment = null;
  submission.programmableFee.feeScopes = [];
  submission.programmableFee.executionScopeRefs = [];
  submission.programmableFee.collectionProfileSchema = builtinSchema(OPEN_WORLD_V2_FEE_NOT_APPLICABLE.collectionProfileSchemaId);
  submission.programmableFee.collectionProfile = structuredClone(OPEN_WORLD_V2_FEE_NOT_APPLICABLE.collectionProfile);
  submission.programmableFee.conformance = { status: "not-applicable", evidenceRefs: [], evidenceDigests: [], scopeArtifacts: [] };
  submission.supportingPackage.feePolicy = null;
  intentContract.status = "builder-confirmed";
  intentContract.route = { id: "CUSTOM_ARCHITECTURE", reasons: [{ language: "en", text: "The supplied implementation is explicitly classified as a local no-market architecture." }], blockedByRefs: [] };
  intentContract.facts[0] = { ...intentContract.facts[0], kind: "idea-specific-local-implementation", state: "confirmed", semanticPayload: structuredClone(ideaSource), payloadSchema: structuredClone(ideaProfile) };
  intentContract.confirmation = { state: "builder-confirmed", ideaEntryId: "original-idea", confirmedFactIds: [intentContract.facts[0].id], delegatedDefaultFactIds: [] };
  intentFidelity.overallStatus = "preserved";
  intentFidelity.traces[0] = { ...intentFidelity.traces[0], status: "preserved", architectureRefs: [{ collection: "components", id: "local-kernel" }], implementationRefs: [sourcePath], testRefs: [testPath], difference: null };
  const records = { ideaSource, intentContract, architectureDecisions, intentFidelity };
  records.ideaSource = record(records.ideaSource);
  intentContract.ideaSourceSha256 = records.ideaSource.sha256;
  records.intentContract = record(intentContract);
  architectureDecisions.intentContractSha256 = records.intentContract.sha256;
  records.architectureDecisions = record(architectureDecisions);
  intentFidelity.inputDigests = { ideaSourceSha256: records.ideaSource.sha256, intentContractSha256: records.intentContract.sha256, architectureDecisionsSha256: records.architectureDecisions.sha256, architectureSnapshotSha256: architectureSnapshotSha256(submission) };
  records.intentFidelity = record(intentFidelity);
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_ARTIFACTS)) submission.intentPackage[key] = artifactBinding(spec, records[key].bytes);
  const supportingRecords = {};
  for (const key of ["feePolicySchema", "securityAssessmentSchema"]) {
    const spec = OPEN_WORLD_V2_SUPPORTING_ARTIFACTS[key];
    supportingRecords[key] = record(values[spec.file]);
    submission.supportingPackage[key] = artifactBinding(spec, supportingRecords[key].bytes);
  }
  const submissionBytes = jsonBytes(submission);
  const extensionSchemaBytes = { [ideaSchemaPath]: ideaSchemaBytes };
  const report = validateOpenWorldV2Package({
    submission, submissionBytes,
    records: Object.fromEntries(Object.entries(records).map(([key, value]) => [key, { value: value.value, bytes: value.bytes }])),
    supportingRecords: Object.fromEntries(Object.entries(supportingRecords).map(([key, value]) => [key, { value: value.value, bytes: value.bytes }])),
    extensionSchemaBytes
  });
  if (report.valid !== true) throw Object.assign(new Error("Generated no-market Submission V2 fails bundled validation"), { code: "NO_MARKET_SUBMISSION_INVALID", findings: report.findings });
  const files = new Map([[ideaSchemaPath, ideaSchemaBytes], [OPEN_WORLD_V2_SUBMISSION_FILE, submissionBytes]]);
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_ARTIFACTS)) files.set(spec.file, records[key].bytes);
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS)) if (supportingRecords[key]) files.set(spec.file, supportingRecords[key].bytes);
  return { submission, files, report };
}

function authorRepositoryFiles({ applicationId, projectSpec, sourcePath, sourceBytes, testPath, testBytes, submissionPackage }) {
  const files = new Map([[sourcePath, Buffer.from(sourceBytes)], [testPath, Buffer.from(testBytes)]]);
  const stageTool = `import crypto from "node:crypto";\nimport fs from "node:fs";\nconst stage = process.argv[2];\nconst targets = { install: "package-lock.json", typecheck: ${JSON.stringify(sourcePath)}, evidence: "evidence/architecture.md" };\nconst target = targets[stage];\nif (!target) throw new Error("unknown stage");\nconst bytes = fs.readFileSync(target);\nif (bytes.length === 0) throw new Error("empty required artifact");\nprocess.stdout.write(stage + ":" + target + ":sha256:" + crypto.createHash("sha256").update(bytes).digest("hex") + "\\n");\n`;
  const simulationTool = `const moduleValue = await import(new URL(${JSON.stringify(`../${sourcePath}`)}, import.meta.url));\nif (Object.keys(moduleValue).length === 0) throw new Error("source contract exports no behavior");\nprocess.stdout.write("simulation:module-load-and-export-boundary:ok\\n");\n`;
  const packageJson = { name: applicationId, version: "0.0.0", private: true, type: "module", license: "MIT", scripts: { test: `node --test ${testPath}` } };
  const packageLock = { name: applicationId, version: "0.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: applicationId, version: "0.0.0", license: "MIT" } } };
  const license = "MIT License\n\nCopyright (c) 2026 Output Authors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n";
  files.set("tools/project-stage.mjs", Buffer.from(stageTool));
  files.set("tools/project-simulation.mjs", Buffer.from(simulationTool));
  files.set(".gitignore", Buffer.from("node_modules/\n.programmable/repository-plan.materializing.v1.json\n"));
  files.set("package.json", jsonBytes(packageJson));
  files.set("package-lock.json", jsonBytes(packageLock));
  files.set("deploy/local-service.json", jsonBytes({ schemaVersion: "1.0.0", status: "LOCAL_REFERENCE_NOT_DEPLOYED", applicationId, networkAccessed: false, externalActionsPerformed: [] }));
  files.set("evidence/architecture.md", Buffer.from("# Architecture evidence\n\nThe supplied source and tests are bound as one local no-market reference. No token, market, pool, hook, quote, execution route, deployment, approval, or audit is claimed.\n"));
  files.set("README.md", Buffer.from(`# ${applicationId}\n\nIdea-bound local no-market reference output. Intent SHA-256: ${projectSpec.intent.sha256}.\n\nRun \`npm test\` for the supplied behavioral tests. This repository is not an approval, audit, deployment, or production claim.\n`));
  files.set("GITHUB-SUBMISSION.md", Buffer.from("# GitHub submission handoff\n\nstatus: NOT_SUBMITTED\nrequiresHumanConfirmation: true\n\nA public Application V3 transport cannot be authored until a real GitHub numeric repository ID, canonical repository URI, commit object ID, and tree object ID exist. This local output performs no GitHub write, submission, publication, approval, or launch action.\n"));
  files.set("LICENSE", Buffer.from(license));
  for (const [relativePath, bytes] of submissionPackage.files) files.set(`submission/${relativePath}`, Buffer.from(bytes));
  return files;
}

function authorRepositoryPlan({ projectSpec, productGraph, architectureCandidates, files, sourcePath, testPath }) {
  const artifact = (id, artifactPath, kind) => ({ id, path: artifactPath, kind, systemRefs: ["service-component"], required: true, status: "verified", sha256: sha256Bytes(files.get(artifactPath)), byteLength: files.get(artifactPath).length });
  const receipt = (id) => ({ id: `${id}-receipt`, path: `.programmable/command-receipts/${id}.v1.json`, kind: "command-receipt", systemRefs: ["service-component"], required: true, status: "planned", sha256: null, byteLength: null });
  const command = (id, kind, argv) => ({ id, kind, argv, cwd: ".", required: true, timeoutMs: 30000, executionPolicy: { networkAccess: "forbidden", externalWrites: false } });
  const commands = [
    command("install-command", "install", ["node", "tools/project-stage.mjs", "install"]),
    command("build-command", "build", ["node", "--check", sourcePath]),
    command("typecheck-command", "typecheck", ["node", "tools/project-stage.mjs", "typecheck"]),
    command("lint-command", "lint", ["node", "--check", testPath]),
    command("simulation-command", "simulation", ["node", "tools/project-simulation.mjs"]),
    command("test-command", "test", ["node", "--test", "--test-reporter=dot", testPath]),
    command("evidence-command", "evidence", ["node", "tools/project-stage.mjs", "evidence"])
  ];
  const submissionPaths = [...files.keys()].filter((filePath) => filePath.startsWith("submission/")).sort();
  return {
    schemaVersion: "1.0.0", applicationId: projectSpec.applicationId, revision: projectSpec.revision, projectSpecSha256: projectArtifactSha256(projectSpec), architectureCandidatesSha256: projectArtifactSha256(architectureCandidates), productGraphSha256: projectArtifactSha256(productGraph), selectedArchitectureId: architectureCandidates.selection.candidateId,
    repository: { root: ".", branch: null, headCommit: null }, completionStatus: "materializing",
    artifacts: {
      source: [artifact("source-contract", sourcePath, "application-source"), artifact("stage-tool", "tools/project-stage.mjs", "verification-source"), artifact("simulation-tool", "tools/project-simulation.mjs", "simulation-source")],
      configuration: [artifact("gitignore", ".gitignore", "repository-configuration"), artifact("package-configuration", "package.json", "repository-configuration")],
      dependencyLocks: [artifact("dependency-lock", "package-lock.json", "dependency-lock")], tests: [artifact("behavior-test", testPath, "unit-test")],
      deploymentInputs: [artifact("local-deployment-input", "deploy/local-service.json", "service-deployment-input")],
      evidence: [artifact("architecture-evidence", "evidence/architecture.md", "architecture-evidence"), ...commands.map(({ id }) => receipt(id))],
      documentation: [artifact("readme", "README.md", "readme"), artifact("github-submission-handoff", "GITHUB-SUBMISSION.md", "submission-transport-plan"), artifact("mit-license", "LICENSE", "license"), ...submissionPaths.map((artifactPath, index) => artifact(`submission-package-${String(index + 1).padStart(2, "0")}`, artifactPath, artifactPath.endsWith("submission.v2.json") ? "submission-v2" : "submission-package-artifact"))]
    },
    tradeCapability: { applicability: "no-market", markets: [] }, v4HookSemanticContracts: [], commands, commandResults: [],
    completionClaim: { scope: "local-repository-evidence-only", approvalCreated: false, auditClaimed: false, productionClaimed: false, externalActionsPerformed: [] }, authorization: noProjectAuthorization()
  };
}

function record(value) {
  const bytes = jsonBytes(value);
  return { value, bytes, sha256: sha256Bytes(bytes) };
}
function artifactBinding(spec, bytes) {
  return { artifactType: spec.artifactType, schemaId: spec.schemaId, path: spec.file, sha256: sha256Bytes(bytes), byteLength: bytes.length };
}
function builtinSchema(schemaId) {
  return { kind: "builtin", schemaId, path: null, sha256: null, byteLength: null };
}
function jsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}
function camelSlug(value) {
  return value.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();
}
function noProjectAuthorization() {
  return { approval: false, signature: false, deployment: false, publication: false, execution: false, registryWrite: false };
}

function validateArtifactBinding(key, value, binding, requiredBindings, add, phase) {
  if (requiredBindings.includes(key) && !isObject(binding)) {
    add("blocker", "PHASE_ARTIFACT_BINDING_MISSING", `$.artifacts.${key}`, `${phase} checkpoint requires ${key}.`);
    return;
  }
  if (binding === null && value !== undefined && value !== null) add("blocker", "UNBOUND_PHASE_ARTIFACT_PRESENT", `$.artifacts.${key}`, `${key} was loaded but is not hash-bound by the project state.`);
  else if (isObject(binding) && !isObject(value)) add("blocker", "BOUND_PHASE_ARTIFACT_UNAVAILABLE", `$.artifacts.${key}`, `${key} is hash-bound by state but was not loaded.`);
  else if (isObject(binding) && isObject(value)) bind(binding.sha256, projectArtifactSha256(value), `$.artifacts.${key}.sha256`, "STATE_ARTIFACT_HASH_MISMATCH", add);
}

function validateProvenanceCheckpoint(projectSpec, projectState, add) {
  if (!isObject(projectSpec)) return;
  const expected = { confirmed: [], builderAssumptions: [], ownerRequired: [], externalUnresolved: [] };
  const keyByProvenance = { confirmed: "confirmed", "builder-assumption": "builderAssumptions", "owner-required": "ownerRequired", "external-unresolved": "externalUnresolved" };
  for (const facet of Object.values(projectSpec.facets ?? {})) for (const entry of facet?.entries ?? []) expected[keyByProvenance[entry.provenance]]?.push(entry.id);
  for (const key of Object.keys(expected)) compareSorted(projectState.provenanceRefs?.[key], expected[key], "STATE_PROVENANCE_PARTITION_MISMATCH", `$.provenanceRefs.${key}`, `Checkpoint must preserve the complete ${key} provenance partition.`, add);
}

function validateGraphCheckpoint(productGraph, projectState, add) {
  if (!isObject(productGraph)) return;
  const expected = {
    invariants: (productGraph.graphs?.invariant?.invariants ?? []).map(({ id }) => id),
    failures: (productGraph.graphs?.failureRecovery?.failures ?? []).map(({ id }) => id),
    recoveries: (productGraph.graphs?.failureRecovery?.recoveries ?? []).map(({ id }) => id)
  };
  for (const key of Object.keys(expected)) compareSorted(projectState.graphRefs?.[key], expected[key], "STATE_GRAPH_REF_PARTITION_MISMATCH", `$.graphRefs.${key}`, `Checkpoint must preserve every modeled ${key} id.`, add);
}

function validateRepositoryCheckpoint(repositoryPlan, projectState, phaseIndex, add) {
  if (!isObject(repositoryPlan)) return;
  if (phaseIndex >= phaseOrder.indexOf("repository-materialization")) {
    const expectedPaths = Object.values(repositoryPlan.artifacts ?? {}).flat().map(({ path: artifactPath }) => artifactPath);
    compareSorted(projectState.repository?.generatedPaths, expectedPaths, "STATE_REPOSITORY_PATHS_MISMATCH", "$.repository.generatedPaths", "Checkpoint generatedPaths must equal the complete repository-plan artifact inventory.", add);
    if (projectState.status === "locally-complete" && repositoryPlan.completionStatus !== "COMPLETE") add("blocker", "MATERIALIZATION_PHASE_REPOSITORY_INCOMPLETE", "$.status", "A locally-complete materialization checkpoint requires a COMPLETE repository plan.");
  }
  if (phaseIndex >= phaseOrder.indexOf("verification")) {
    if (repositoryPlan.completionStatus !== "COMPLETE") add("blocker", "VERIFICATION_PHASE_REPOSITORY_INCOMPLETE", "$.phase", "Verification and submission-evidence checkpoints require a COMPLETE repository plan.");
    if (canonicalJsonSha256V2(projectState.commandResults ?? []) !== canonicalJsonSha256V2(repositoryPlan.commandResults ?? [])) add("blocker", "STATE_COMMAND_RESULTS_MISMATCH", "$.commandResults", "Verification checkpoint must carry the exact repository command-result set.");
  }
}

function validateCheckpointStatus(projectState, add) {
  const blockers = projectState.blockers ?? [];
  const expectedKind = { "blocked-owner": "owner-required", "blocked-external": "external-unresolved" }[projectState.status];
  if (expectedKind && !blockers.some(({ kind }) => kind === expectedKind)) add("blocker", "STATE_BLOCKED_STATUS_UNEXPLAINED", "$.status", `${projectState.status} requires a matching blocker record.`);
  if (projectState.status === "blocked-repository" && !blockers.some(({ kind }) => ["repository", "evidence"].includes(kind))) add("blocker", "STATE_BLOCKED_STATUS_UNEXPLAINED", "$.status", "blocked-repository requires a repository or evidence blocker.");
  if (projectState.status === "locally-complete" && blockers.length > 0) add("blocker", "LOCALLY_COMPLETE_STATE_HAS_BLOCKERS", "$.blockers", "A locally-complete phase cannot retain open blockers.");
}

function validatePreviousState(projectState, previousState, add) {
  if (projectState.sequence === 1) {
    if (projectState.integrity?.previousStateSha256 !== null) add("blocker", "INITIAL_STATE_HAS_PREDECESSOR", "$.integrity.previousStateSha256", "Sequence 1 must not claim a previous state.");
    if (projectState.phase !== "project-spec") add("blocker", "INITIAL_STATE_PHASE_INVALID", "$.phase", "The immutable checkpoint chain must begin at project-spec.");
    return;
  }
  if (!isObject(previousState)) {
    add("blocker", "PREVIOUS_STATE_REQUIRED", "$.integrity.previousStateSha256", "Every checkpoint after sequence 1 must provide its exact preceding state.");
    return;
  }
  const previousPayloadSha256 = projectStatePayloadSha256(previousState);
  bind(previousState.integrity?.stateSha256, previousPayloadSha256, "$.integrity.previousStateSha256", "PREVIOUS_STATE_SELF_HASH_MISMATCH", add);
  bind(projectState.integrity?.previousStateSha256, previousPayloadSha256, "$.integrity.previousStateSha256", "PREVIOUS_STATE_HASH_MISMATCH", add);
  bind(projectState.sequence, previousState.sequence + 1, "$.sequence", "STATE_SEQUENCE_NOT_CONTIGUOUS", add);
  bind(projectState.applicationId, previousState.applicationId, "$.applicationId", "STATE_APPLICATION_CHANGED", add);
  bind(projectState.intentSha256, previousState.intentSha256, "$.intentSha256", "STATE_INTENT_CHANGED", add);
  const previousPhase = phaseOrder.indexOf(previousState.phase);
  const currentPhase = phaseOrder.indexOf(projectState.phase);
  if (currentPhase < previousPhase || currentPhase > previousPhase + 1) add("blocker", "STATE_PHASE_TRANSITION_INVALID", "$.phase", "Checkpoint phase may stay in place or advance exactly one phase.", { previous: previousState.phase, current: projectState.phase });
  if (currentPhase === previousPhase + 1 && previousState.status !== "locally-complete") add("blocker", "STATE_PHASE_ADVANCED_BEFORE_COMPLETION", "$.phase", "A phase can advance only after its preceding checkpoint is locally complete.");
}

function compareSorted(observedValue, expectedValue, code, findingPath, message, add) {
  const observed = [...(observedValue ?? [])].sort();
  const expected = [...expectedValue].sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) add("blocker", code, findingPath, message, { expected, observed });
}

function bind(observed, expected, findingPath, code, add) {
  if (expected !== undefined && expected !== null && observed !== expected) add("blocker", code, findingPath, "Bound value does not match its authoritative source.", { expected, observed: observed ?? null });
}

function findingAdder(findings) {
  return (severity, code, findingPath, message, details = {}) => findings.push({ severity, code, path: findingPath, message, details });
}

function sorted(findings) {
  return findings.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || left.code.localeCompare(right.code) || left.path.localeCompare(right.path));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
