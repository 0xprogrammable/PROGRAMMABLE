import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "../canonical-json-core.mjs";
import { keccak256Hex } from "../evm-encoding-core.mjs";
import { PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES, PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES,
  createProjectCommandReceipt, executeProjectCommands, projectCommandEnvironmentSha256,
  projectCommandMaximumOutputBytes, sha256Bytes } from "../project-command-executor-core.mjs";
import { compileProjectBundle, preflightProjectOutput, validateProjectOutput } from "../project-compiler-core.mjs";
import { TRADABLE_REFERENCE_PROFILE_ID, bindTradableReferenceIntent } from "../project-tradable-authoring-core.mjs";
import {
  ARCHITECTURE_ROLES,
  PRODUCT_GRAPH_NAMES,
  PROJECT_SPEC_FACETS,
  projectArtifactSha256,
  validateArchitectureCandidates,
  validateProductGraph,
  validateProjectSpec
} from "../project-contracts-core.mjs";
import { bindLocalReleaseHandoffV1, createNoMarketProjectAuthoring, renderGitHubSubmissionHandoffV1, sealProjectState, validateProjectState } from "../project-state-core.mjs";
import { validateRepositoryPlan } from "../repository-completion-core.mjs";
import { validateAgainstSchema } from "../submission-core.mjs";
import { architectureSnapshotSha256, createOpenWorldDraftPackage } from "../open-world-v2-core.mjs";
import { expectedTradeRunnerCallsV1, inspectForgeTradeTestRunnerOutputV1, validateV4DeploymentEvidence } from "../v4-deployment-evidence-core.mjs";
import { canonicalV4PermissionMask } from "../v4-hook-semantic-contract-core.mjs";
import {
  TRADE_TEST_EXECUTION_CALLDATA_FIXTURE_V1,
  TRADE_TEST_QUOTE_CALLDATA_FIXTURE_V1,
  TRADE_TEST_QUOTE_RETURN_DATA_FIXTURE_V1,
  createApplicableOpenWorldV2PrototypeFixture,
  createNoMarketOpenWorldV2PrototypeFixture,
  createStandardTradeCapabilityManifestFixtureV1,
  createTradeTestResultFixturesV1,
  tradeTestRevertDataFixtureV1
} from "./open-world-v2-prototype-fixture.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../..");
const compilerCli = path.join(skillRoot, "scripts/project-compiler.mjs");
const unifiedCli = path.join(skillRoot, "scripts/cli.mjs");

test("unified CLI grants the long bound only to written project materialization", () => {
  const source = fs.readFileSync(unifiedCli, "utf8");
  assert.match(source, /timeout:120_000\+2_580_000\*\+\(command\+args\[0\]\+args\.includes\("--write"\)==="projectmaterializetrue"\)/u);
  assert.equal((source.match(/2_580_000/gu) ?? []).length, 1);
  assert.equal((source.match(/120_000/gu) ?? []).length, 1);
});

test("local GitHub handoff binds exact no-market Submission bytes, report, commands, and RepositoryPlan artifact", () => {
  const build = (ideaText) => createNoMarketProjectAuthoring({ applicationId: "local-handoff", ideaText, sourcePath: "src/local.mjs", sourceBytes: Buffer.from("export const ok = true;\n"), testPath: "test/local.test.mjs", testBytes: Buffer.from('import test from "node:test"; test("ok", () => {});\n') });
  const authored = build("Preserve one bounded local record."), bytes = authored.files.get("GITHUB-SUBMISSION.md");
  const payload = JSON.parse(bytes.toString("utf8").split("\n\n")[1]);
  assert.deepEqual(payload.application, { applicationId: "local-handoff", classification: "no-market", ideaSha256: authored.projectSpec.intent.sha256, marketRef: null, tradeStatus: "NOT_APPLICABLE" });
  assert.deepEqual(payload.submission, { automaticMaterialization: false, byteLength: authored.files.get("submission/submission.v2.json").length, path: "submission/submission.v2.json", reportSha256: canonicalJsonSha256V2(authored.submissionReport), reportStatus: "REVIEW_REQUIRED", sha256: sha256Bytes(authored.files.get("submission/submission.v2.json")) });
  assert.equal(payload.status, "NOT_SUBMITTED"); assert.equal(payload.requiresHumanConfirmation, true);
  assert.equal(payload.externalRepository.numericRepositoryId.status, "UNRESOLVED_EXTERNAL_REQUIRED"); assert.equal(payload.externalRepository.canonicalRepositoryUri.status, "UNRESOLVED_EXTERNAL_REQUIRED");
  assert.equal(payload.localVerificationCommands.install, "node tools/project-stage.mjs install"); assert.equal(payload.localVerificationCommands.check, "npm test"); assert.match(payload.localVerificationCommands.requireOutput, /project require-output .*submission-evidence.*verification.*submission/u);
  assert.deepEqual(payload.evidenceBoundary, { approvalCreated: false, auditClaimed: false, deploymentPerformed: false, externalActionsPerformed: [], githubWritePerformed: false, launchPerformed: false, publicationPerformed: false });
  const artifact = authored.repositoryPlan.artifacts.documentation.find(({ path: artifactPath }) => artifactPath === "GITHUB-SUBMISSION.md");
  assert.equal(artifact.sha256, sha256Bytes(bytes)); assert.equal(artifact.byteLength, bytes.length);
  assert.deepEqual(validateRepositoryPlan(authored.projectSpec, authored.productGraph, authored.architectureCandidates, authored.repositoryPlan).filter(({ severity }) => severity === "blocker"), []);
  const changed = build("Preserve two bounded local records."), changedBytes = changed.files.get("GITHUB-SUBMISSION.md");
  assert.notEqual(sha256Bytes(changedBytes), sha256Bytes(bytes)); assert.notEqual(JSON.parse(changedBytes.toString("utf8").split("\n\n")[1]).submission.sha256, payload.submission.sha256);
  const driftedSubmission = Buffer.concat([authored.files.get("submission/submission.v2.json"), Buffer.from("\n")]);
  const drifted = renderGitHubSubmissionHandoffV1({ applicationId: "local-handoff", classification: "no-market", ideaSha256: authored.projectSpec.intent.sha256, submissionBytes: driftedSubmission, report: authored.submissionReport, tradeStatus: "NOT_APPLICABLE" });
  assert.notEqual(JSON.parse(drifted.toString("utf8").split("\n\n")[1]).submission.sha256, payload.submission.sha256);
  const poisoned = build("Preserve three bounded local records."), sourcePath = "submission/idea-source.v1.json", source = JSON.parse(poisoned.files.get(sourcePath)), submission = JSON.parse(poisoned.files.get("submission/submission.v2.json"));
  source.entries[0].sha256 = authored.projectSpec.intent.sha256; const sourceBytes = Buffer.from(JSON.stringify(source)); poisoned.files.set(sourcePath, sourceBytes); submission.intentPackage.ideaSource.sha256 = sha256Bytes(sourceBytes); submission.intentPackage.ideaSource.byteLength = sourceBytes.length; poisoned.files.set("submission/submission.v2.json", Buffer.from(JSON.stringify(submission)));
  assert.throws(() => bindLocalReleaseHandoffV1({ authored: poisoned, applicationId: "local-handoff", classification: "no-market", ideaSha256: poisoned.projectSpec.intent.sha256 }), /identity mismatch/u);
  const changedReport = renderGitHubSubmissionHandoffV1({ applicationId: "local-handoff", classification: "no-market", ideaSha256: authored.projectSpec.intent.sha256, submissionBytes: authored.files.get("submission/submission.v2.json"), report: { ...authored.submissionReport, findings: [{ code: "DRIFT" }] }, tradeStatus: "NOT_APPLICABLE" });
  assert.notEqual(sha256Bytes(changedReport), sha256Bytes(bytes));
});

test("tradable local handoff replaces the stale README boundary with exact NOT_APPROVED evidence bindings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-tradable-handoff-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stale = "The local quoter/router matrix is not RPC-backed `eth_call` evidence, fork evidence,\ndeployed-address verification, signature-based Permit2 coverage, a quoter/router audit or proof for a different package\nrevision.";
  fs.writeFileSync(path.join(root, "README.md"), `# Kernel\n\nThe example JSON under \`evidence/\` remains a placeholder checklist, not a complete receipt.\n\n${stale}\n`);
  const digest = (value) => sha256Bytes(Buffer.from(value)), ideaText = "idea", ideaSha256 = digest(ideaText), ideaSourceBytes = Buffer.from(JSON.stringify({ originalEntryId: "original-idea", entries: [{ id: "original-idea", publicTextUtf8: ideaText, sha256: ideaSha256 }] }) + "\n"), ideaBinding = { path: "idea-source.v1.json", sha256: sha256Bytes(ideaSourceBytes), byteLength: ideaSourceBytes.length }, submissionBytes = Buffer.from(JSON.stringify({ applicationId: "tradable-handoff", intentPackage: { ideaSource: ideaBinding }, tradeCapability: { applicability: "tradable", markets: [{ marketRef: "primary-market" }] } }) + "\n"), paths = { profile: "evidence/v4/primary-market.hook-semantic.v1.json", preimage: "evidence/v4/primary-market.deployment-preimage.v1.json", manifest: "evidence/v4/primary-market.deployment-manifest.v1.json", runtime: "evidence/v4/primary-market.runtime.bin" };
  const evidenceFiles = Object.values(paths).map((artifactPath, index) => ({ path: artifactPath, sha256: digest(`v4-${index}`) }));
  const tradeEvidence = { status: "NOT_APPROVED", manifest: { path: ".programmable/trade-capabilities/primary-market.v1.json", sha256: digest("manifest") }, feeConformance: { receiptPath: "submission/review/fee-conformance/primary-market.receipt.v1.json", receiptSha256: digest("receipt"), vectorSetPath: "submission/review/fee-conformance/primary-market.vectors.v1.json", vectorSetSha256: digest("vectors") }, forkEvidence: { path: "evidence/v4/primary-market.mainnet-fork-canary.v1.json", sha256: digest("fork") }, v4: { paths }, evidenceFiles };
  const authored = { projectSpec: { intent: { sha256: ideaSha256, verbatimText: ideaText } }, files: new Map([["submission/submission.v2.json", submissionBytes], ["submission/idea-source.v1.json", ideaSourceBytes]]), submissionReport: { status: "REVIEW_REQUIRED", automaticMaterialization: true } };
  bindLocalReleaseHandoffV1({ authored, applicationId: "tradable-handoff", classification: "tradable", marketRef: "primary-market", ideaSha256, repositoryRoot: root, tradeEvidence });
  const handoff = JSON.parse(authored.files.get("GITHUB-SUBMISSION.md").toString("utf8").split("\n\n")[1]), readme = authored.files.get("README.md").toString("utf8");
  assert.deepEqual(handoff.application, { applicationId: "tradable-handoff", classification: "tradable", ideaSha256, marketRef: "primary-market", tradeStatus: "NOT_APPROVED" });
  assert.equal(handoff.submission.automaticMaterialization, true); assert.equal(handoff.localVerificationCommands.install, "npm ci --ignore-scripts --prefer-offline --no-audit --no-fund"); assert.equal(handoff.localVerificationCommands.check, "node tools/run-project-gate.mjs evidence");
  assert.doesNotMatch(readme, /not RPC-backed `eth_call` evidence, fork evidence|placeholder checklist, not a complete receipt/u); assert.match(readme, /## Materialized local evidence[\s\S]*Status: \*\*NOT_APPROVED\*\*/u);
  for (const binding of [tradeEvidence.manifest, { path: tradeEvidence.feeConformance.receiptPath, sha256: tradeEvidence.feeConformance.receiptSha256 }, { path: tradeEvidence.feeConformance.vectorSetPath, sha256: tradeEvidence.feeConformance.vectorSetSha256 }, tradeEvidence.forkEvidence, ...evidenceFiles]) { assert.match(readme, new RegExp(binding.path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u")); assert.match(readme, new RegExp(binding.sha256, "u")); }
  assert.match(readme, /no audit, approval, production deployment, transaction broadcast, GitHub publication or launch is claimed/u);
  const compilerSource = fs.readFileSync(compilerCli, "utf8"), createIndex = compilerSource.indexOf("const authored = createTradableProjectAuthoring"), bindIndex = compilerSource.indexOf("bindLocalReleaseHandoffV1({ authored"), writeIndex = compilerSource.indexOf('writeOutputJson(repositoryRoot, ".programmable/project-spec.v1.json"', createIndex);
  assert.ok(createIndex >= 0 && createIndex < bindIndex && bindIndex < writeIndex);
  assert.throws(() => bindLocalReleaseHandoffV1({ authored, applicationId: "tradable-handoff", classification: "tradable", marketRef: "primary-market", ideaSha256: digest("different-idea"), repositoryRoot: root, tradeEvidence }), /identity mismatch/u);
});

test("tradable profile binding is closed, natural, and UTF-8 byte exact", () => {
  const blindIdea = "Please use the installed Programmable Hookbuilder to build a closed Uniswap v4 hook that charges a fixed fee on each swap's executed gross quote volume. Keep the buy and sell rates immutable after registration. Turn the idea into a complete local Git repository for later human review, and perform no publication or external write.";
  const secondBlindIdea = "Use the installed Programmable Hookbuilder to create a Uniswap v4 hook that collects a fee from each swap's executed gross quote volume. Make the buy and sell rates fixed after registration. Build the complete project in this fresh local Git repository for human review, and do not publish or write to external systems.";
  const ideas = [
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration.",
    "Make a Uniswap’s v4 hook that takes a fee from executed gross quote volume; make the buy and sell rates fixed after registration.",
    "Create a Uniswap version 4 hook which collects its fee from executed gross quote volume. Keep buy and sell rates unchanged after registration.",
    "✨ Build a Uniswap v4 hook that charges a fixed fee on each swap’s executed gross quote volume. Keep the buy and sell rates immutable after registration.",
    blindIdea,
    secondBlindIdea,
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Produce a complete local Git repository for human review. Do not publish or perform any external writes."
  ];
  for (const idea of ideas) {
    const binding = bindTradableReferenceIntent(idea, TRADABLE_REFERENCE_PROFILE_ID), bytes = Buffer.from(idea);
    assert.equal(binding.normalizedCapability.feeBasis, "executed-gross-quote-volume");
    assert.deepEqual(binding.normalizedCapability.extraMaterialClauses, []);
    for (const span of binding.capabilitySpans) assert.equal(sha256Bytes(bytes.subarray(span.startByte, span.endByte)), span.textSha256);
  }
  const blindBinding = bindTradableReferenceIntent(blindIdea, TRADABLE_REFERENCE_PROFILE_ID);
  assert.equal(Buffer.byteLength(blindIdea, "utf8"), 331);
  assert.equal(blindBinding.ideaByteLength, 331);
  assert.equal(blindBinding.ideaSha256, "sha256:c2376e5b8ebf5c181818264499c0d2db95099cf2e130f4e128613f0f8ab89814");
  const secondBlindBinding = bindTradableReferenceIntent(secondBlindIdea, TRADABLE_REFERENCE_PROFILE_ID);
  assert.equal(secondBlindBinding.ideaByteLength, 319);
  assert.equal(secondBlindBinding.ideaSha256, "sha256:6211cfb72046565ce105ae60c010e6eaca5c456dce05a725d64c45639b30ad6d");
  for (const idea of [
    "Build a Uniswap v4 hook that charges a fee on executed volume for token holders.",
    "Build a Uniswap v4 hook that charges dynamic fees on executed volume.",
    "Build a Uniswap v4 hook that charges a fee on executed trading volume. Keep buy and sell rates immutable after registration.",
    "Build a Uniswap v4 hook that charges a fee on gross quote volume. Keep buy and sell rates immutable after registration.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume.",
    "Build a Uniswap v4 hook that charges a fee for quote swaps and shows volume.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Turn the idea into a complete local Git repository for later human review, and add token-holder rewards.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Produce a complete local Git repository for human review. Do not publish or perform external writes. Add an oracle-adjusted rate.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Build the complete project in this fresh local Git repository for human review, and do not publish until review or write to external systems.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Build the complete project in this fresh local Git repository for human review, and do not publish or write to external systems except GitHub.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Build the complete project in this fresh local Git repository for human review, and do not publish and write to external systems.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Build the complete project in this fresh local Git repository for human review, and never publish and write to external systems.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Build the complete project in this fresh local Git repository for human review, and do not release the project and perform any external writes.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Build the complete project in this fresh local Git repository for human review, then deploy it.",
    "A cooperative commit-reveal riddle game for two players."
  ]) assert.throws(() => bindTradableReferenceIntent(idea, TRADABLE_REFERENCE_PROFILE_ID), ({ code }) => code === "TRADABLE_REFERENCE_PROFILE_MISMATCH");
});

test("generated build gate binds both exact Solidity settings and source partitions before reporting pass", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-build-info-gate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "out/build-info"), { recursive: true });
  const authoringSource = fs.readFileSync(path.join(skillRoot, "scripts/project-tradable-authoring-core.mjs"), "utf8");
  const segment = authoringSource.slice(authoringSource.indexOf("function renderProjectGateTool")), tick = String.fromCharCode(96);
  const start = segment.indexOf("return " + tick) + 8, end = segment.indexOf(tick + ";\n}\n\nfunction mitLicense");
  assert.ok(start >= 8 && end > start);
  const render = Function("forkTest", "marketRef", "return " + tick + segment.slice(start, end) + tick + ";");
  const baseSource = render("test/ProgrammableVolumeFeeHookV2MainnetForkCanary.t.sol", "primary-market")
    .replace('build:["forge",["build","--offline"]]', 'build:["node",["-e",""]]');
  const roots26 = [
    "src/ProgrammableVolumeFeeHookFactoryV2.sol", "src/ProgrammableVolumeFeeHookV2.sol", "test/MockReferenceToken.sol", "test/MockWETH9.sol",
    "test/ProgrammableTradeEvidenceRunnerV1.t.sol", "test/ProgrammableVolumeFeeHookV2.t.sol", "test/ProgrammableVolumeFeeHookV2Erc20.t.sol",
    "test/ProgrammableVolumeFeeHookV2MainnetForkCanary.t.sol", "test/ProgrammableVolumeFeeHookV2Parity.t.sol",
    "test/ProgrammableVolumeFeeHookV2UniversalRouterErc20.t.sol", "test/ProgrammableVolumeFeeHookV2UniversalRouterNative.t.sol",
    "test/V4PlannerEncodingParity.t.sol", "test/helpers/ProgrammableVolumeFeeHookV2Erc20Fixture.sol",
    "test/helpers/UniversalRouterV4Fixture.sol", "test/invariant/ProgrammableVolumeFeeHookV2.invariant.t.sol"
  ];
  const profile = (componentRefs, compilerVersion, evmTarget, cborMetadata) => ({ componentRefs, compilerVersion, evmTarget, optimizer: { enabled: true, runs: 200 }, viaIr: true, bytecodeHash: "none", cborMetadata });
  const baseLock = {
    tools: [{ id: "node", version: process.version, resolvedExecutableSha256: sha256Bytes(fs.readFileSync(process.execPath)) }],
    solidityProfiles: [
      profile(["pinned-route-component"], "0.8.17", "london", true),
      profile(["service-component", "factory-component", "v4-hook-system", "v4-hook-factory-system"], "0.8.26", "cancun", false)
    ]
  };
  const writeUnit = (name, solcVersion, evmVersion, appendCBOR, roots) => fs.writeFileSync(path.join(root, "out/build-info", name), JSON.stringify({
    solcVersion, input: { settings: { evmVersion, optimizer: { enabled: true, runs: 200 }, viaIR: true, metadata: { bytecodeHash: "none", ...(appendCBOR === undefined ? {} : { appendCBOR }) } }, sources: Object.fromEntries([...roots, "node_modules/dependency.sol"].map((sourcePath) => [sourcePath, {}])) }
  }));
  const run = (lock, roots = roots26) => {
    writeUnit("17.json", "0.8.17", "london", undefined, ["test/vendor/PinnedPermit2Artifact.sol"]);
    writeUnit("26.json", "0.8.26", "cancun", false, roots);
    const source = baseSource.replace('JSON.parse(fs.readFileSync(".programmable/project-toolchain-lock.v1.json","utf8"))', JSON.stringify(lock));
    return childProcess.spawnSync(process.execPath, ["--input-type=module", "-", "build"], { cwd: root, input: source, encoding: "utf8", shell: false });
  };
  const accepted = run(baseLock);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.stdout, "build:passed\n");
  const wrongCbor = structuredClone(baseLock);
  wrongCbor.solidityProfiles[0].cborMetadata = false;
  const rejectedCbor = run(wrongCbor);
  assert.notEqual(rejectedCbor.status, 0);
  assert.equal(rejectedCbor.stdout, "");
  assert.match(rejectedCbor.stderr, /build-info lock or source partition mismatch/u);
  const rejectedPartition = run(baseLock, roots26.slice(0, -1));
  assert.notEqual(rejectedPartition.status, 0);
  assert.equal(rejectedPartition.stdout, "");
  assert.match(rejectedPartition.stderr, /build-info lock or source partition mismatch/u);
});

test("tradable materialize profile mismatch fails before output and aligned dry-run stays write-free", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-tradable-intent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const idea = path.join(root, "idea.txt"), output = path.join(root, "output"), base = [unifiedCli, "project", "materialize", "--idea-file", idea, "--application-id", "volume-fee-reference", "--classification", "tradable", "--market-ref", "primary-market", "--reference-profile", TRADABLE_REFERENCE_PROFILE_ID, "--output", output];
  fs.writeFileSync(idea, "A cooperative commit-reveal riddle game for two players.\n");
  const rejected = childProcess.spawnSync(process.execPath, base, { encoding: "utf8", shell: false });
  assert.equal(rejected.status, 2); assert.match(rejected.stderr, /TRADABLE_REFERENCE_PROFILE_MISMATCH/u); assert.equal(fs.existsSync(output), false);
  fs.writeFileSync(idea, "Build a Uniswap v4 hook that charges a fixed fee on executed gross quote volume. Keep buy and sell rates immutable after registration.\n");
  const dry = childProcess.spawnSync(process.execPath, base, { encoding: "utf8", shell: false });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout); assert.equal(JSON.parse(dry.stdout).status, "PROJECT_MATERIALIZATION_DRY_RUN_READY"); assert.equal(fs.existsSync(output), false);
});

test("ProjectSpec preserves intent bytes and classifies every required open-world facet", () => {
  const spec = makeProjectSpec();
  assert.deepEqual(validateProjectSpec(spec), []);
  assert.deepEqual(Object.keys(spec.facets), [...PROJECT_SPEC_FACETS]);

  const missingLifecycle = structuredClone(spec);
  missingLifecycle.facets.lifecycle.entries = missingLifecycle.facets.lifecycle.entries.filter(({ kind }) => kind !== "decommissioning");
  assert.ok(validateProjectSpec(missingLifecycle).some(({ code }) => code === "PROJECT_FACET_CLASSIFICATION_MISSING"));

  const disguisedAssumption = structuredClone(spec);
  disguisedAssumption.facets.assumptions.entries.find(({ provenance }) => provenance === "builder-assumption").sourceSpans = [sourceSpan(spec.intent.verbatimText)];
  assert.ok(validateProjectSpec(disguisedAssumption).some(({ code }) => code === "BUILDER_ASSUMPTION_MASQUERADES_AS_INTENT"));

  const duplicateTradeOwner = structuredClone(spec);
  duplicateTradeOwner.facets.valueFlow.entries[0].kind = "trade-capability";
  assert.ok(validateProjectSpec(duplicateTradeOwner).some(({ code }) => code === "TRADE_CAPABILITY_OWNER_INVALID"));
});

test("all nine product graphs are typed, reference-closed, and trace applicable intent", () => {
  const spec = makeProjectSpec();
  const graph = makeProductGraph(spec);
  assert.deepEqual(validateProductGraph(spec, graph), []);
  assert.deepEqual(Object.keys(graph.graphs), [...PRODUCT_GRAPH_NAMES]);

  const untraced = structuredClone(graph);
  untraced.graphs.system.nodes[0].facetEntryRefs.pop();
  assert.ok(validateProductGraph(spec, untraced).some(({ code }) => code === "PROJECT_FACET_GRAPH_TRACE_MISSING"));

  const missingComponent = structuredClone(graph);
  missingComponent.graphs.component.components = [];
  assert.ok(validateProductGraph(spec, missingComponent).some(({ code }) => ["APPLICABLE_GRAPH_EMPTY", "SYSTEM_COMPONENT_UNMAPPED"].includes(code)));

  const unknownFailure = structuredClone(graph);
  unknownFailure.graphs.state.transitions[0].failureRef = "failure-does-not-exist";
  assert.ok(validateProductGraph(spec, unknownFailure).some(({ code }) => code === "PRODUCT_GRAPH_SCHEMA_INVALID" || code === "FAILURE_REF_UNKNOWN"));

  const nonTradeMarket = structuredClone(graph);
  nonTradeMarket.graphs.system.nodes.push({ id: "price-reference", label: "Price reference", type: "market", protocolRole: "none", implementationStatus: "planned", facetEntryRefs: ["user-experience-fact"] });
  assert.deepEqual(validateProductGraph(spec, nonTradeMarket), []);
  const nonTradeArchitectures = makeArchitectures(spec, nonTradeMarket);
  nonTradeArchitectures.candidates[0].graphNodeRefs.push("price-reference");
  nonTradeArchitectures.productGraphSha256 = projectArtifactSha256(nonTradeMarket);
  const nonTradePlan = makePlanningRepositoryPlan({ projectSpec: spec, productGraph: nonTradeMarket, architectureCandidates: nonTradeArchitectures });
  assert.deepEqual(validateRepositoryPlan(spec, nonTradeMarket, nonTradeArchitectures, nonTradePlan), []);
  nonTradeMarket.graphs.system.nodes.at(-1).facetEntryRefs = ["trade-capability-not-applicable"];
  assert.ok(validateProductGraph(spec, nonTradeMarket).some(({ code }) => code === "NO_MARKET_TRADE_NODE_FORBIDDEN"));
});

test("architecture comparison requires exactly minimum-correct, v4-native, and hybrid before selection", () => {
  const spec = makeProjectSpec();
  const graph = makeProductGraph(spec);
  const architectures = makeArchitectures(spec, graph);
  assert.deepEqual(validateArchitectureCandidates(spec, graph, architectures), []);
  assert.deepEqual(architectures.candidates.map(({ role }) => role), [...ARCHITECTURE_ROLES]);

  const duplicatedRole = structuredClone(architectures);
  duplicatedRole.candidates[2].role = "v4-native";
  const roleFindings = validateArchitectureCandidates(spec, graph, duplicatedRole);
  assert.ok(roleFindings.some(({ code }) => code === "ARCHITECTURE_ROLE_CARDINALITY_INVALID"));

  const unresolvedSelection = structuredClone(architectures);
  unresolvedSelection.candidates[0].dimensions.gas.rating = "unknown";
  assert.ok(validateArchitectureCandidates(spec, graph, unresolvedSelection).some(({ code }) => code === "SELECTED_ARCHITECTURE_DIMENSION_UNKNOWN"));

  const placeholder = structuredClone(architectures);
  graph.graphs.system.nodes.push({
    id: "placeholder-hook",
    label: "Placeholder hook",
    type: "contract",
    protocolRole: "uniswap-v4-hook",
    implementationStatus: "planned",
    facetEntryRefs: []
  });
  placeholder.productGraphSha256 = projectArtifactSha256(graph);
  placeholder.candidates[0].graphNodeRefs.push("placeholder-hook");
  assert.ok(validateArchitectureCandidates(spec, graph, placeholder).some(({ code }) => code === "PLACEHOLDER_HOOK_FORBIDDEN"));
});

test("deterministic phase checkpoints bind immutable state and reject skipped or tampered transitions", () => {
  const bundle = makeArchitectureBundle();
  const reportA = compileProjectBundle(bundle, { verifyRepositoryFiles: false });
  const reportB = compileProjectBundle(structuredClone(bundle), { verifyRepositoryFiles: false });
  assert.equal(reportA.status, "PROJECT_COMPILATION_VALID");
  assert.equal(reportA.phaseDisposition, "PHASE_LOCALLY_COMPLETE");
  assert.equal(canonicalJsonV2(reportA), canonicalJsonV2(reportB));
  assert.equal(reportA.reportSha256, reportB.reportSha256);

  const tampered = structuredClone(bundle.projectState);
  tampered.next.action = "Different unbound action";
  const tamperFindings = validateProjectState(bundle.projectSpec, bundle.productGraph, bundle.architectureCandidates, undefined, tampered, { previousState: bundle.previousState });
  assert.ok(tamperFindings.some(({ code }) => code === "PROJECT_STATE_HASH_MISMATCH"));

  const skipped = sealProjectState({ ...statePayload(bundle, "verification", 1), artifacts: bundle.projectState.artifacts });
  assert.ok(validateProjectState(bundle.projectSpec, bundle.productGraph, bundle.architectureCandidates, undefined, skipped).some(({ code }) => ["INITIAL_STATE_PHASE_INVALID", "STATE_PHASE_SEQUENCE_PREMATURE"].includes(code)));
});

test("project output gate closes unresolved artifacts and rejects identity, facet, applicability, contract, and package drift deterministically", (t) => {
  const fixture = createUnresolvedOutputFixture(t);
  const reportA = validateProjectOutput(fixture.input);
  const reportB = validateProjectOutput(structuredCloneProjectOutputInput(fixture.input));
  assert.equal(reportA.status, "PROJECT_OUTPUT_DRAFT_UNRESOLVED", canonicalJsonV2(reportA));
  assert.equal(reportA.projection.applicability, "unresolved");
  assert.equal(reportA.submissionPackageStatus, "REVIEW_REQUIRED");
  assert.equal(reportA.evidenceBoundary.approvalCreated, false);
  assert.equal(reportA.evidenceBoundary.auditClaimed, false);
  assert.equal(canonicalJsonV2(reportA), canonicalJsonV2(reportB));
  assert.equal(reportA.reportSha256, reportB.reportSha256);
  assert.match(reportA.artifactHashes.submissionPackageInventory, /^sha256:[0-9a-f]{64}$/u);
  const delegated = childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "validate-output",
    "--repository-root",
    fixture.root,
    "--state",
    ".programmable/project-states/000004-repository-materialization.v1.json",
    "--previous-state",
    ".programmable/project-states/000003-architecture-selection.v1.json",
    "--submission-root",
    "submission"
  ], { encoding: "utf8", shell: false });
  assert.equal(delegated.status, 1, delegated.stderr || delegated.stdout);
  assert.equal(JSON.parse(delegated.stdout).status, "PROJECT_OUTPUT_DRAFT_UNRESOLVED");

  const mutate = (change) => {
    const input = structuredCloneProjectOutputInput(fixture.input);
    change(input);
    return validateProjectOutput(input);
  };
  const inventedContract = mutate(({ repositoryPlan }) => { repositoryPlan.schemaVersion = "programmable-mini-repository-plan-v1"; });
  assert.equal(inventedContract.status, "PROJECT_OUTPUT_INVALID");
  assert.ok(inventedContract.findings.some(({ code }) => code === "REPOSITORY_PLAN_SCHEMA_INVALID"));

  const applicationMismatch = mutate(({ projectSpec }) => { projectSpec.applicationId = "invented-application"; });
  assert.ok(applicationMismatch.findings.some(({ code }) => code === "PROJECT_OUTPUT_APPLICATION_ID_MISMATCH"));

  const facetMismatch = mutate(({ projectSpec }) => { projectSpec.facets.routing.entries[0].id = "invented-trade-facet"; });
  assert.ok(facetMismatch.findings.some(({ code }) => code === "PROJECT_OUTPUT_TRADE_FACET_MISMATCH"));

  const applicabilityMismatch = mutate(({ repositoryPlan }) => { repositoryPlan.tradeCapability.applicability = "no-market"; });
  assert.ok(applicabilityMismatch.findings.some(({ code }) => code === "PROJECT_OUTPUT_TRADE_APPLICABILITY_MISMATCH"));

  const boundIdeaPath = path.join(fixture.root, "submission/idea-source.v1.json"), boundIdeaBytes = fs.readFileSync(boundIdeaPath);
  fs.writeFileSync(boundIdeaPath, Buffer.concat([boundIdeaBytes, Buffer.from("\n")]));
  const identityDrift = validateProjectOutput(fixture.input);
  assert.ok(identityDrift.findings.some(({ code, details }) => code === "PROJECT_OUTPUT_SUBMISSION_UNREADABLE" && details?.code === "SUBMISSION_BOUND_FILE_IDENTITY_MISMATCH"));
  fs.writeFileSync(boundIdeaPath, boundIdeaBytes);
  writeFile(fixture.root, "submission/unbound-agent-output.json", "{\"contract\":\"invented\"}\n");
  const orphan = validateProjectOutput(fixture.input);
  assert.ok(orphan.findings.some(({ code }) => code === "PROJECT_OUTPUT_SUBMISSION_ORPHAN_FILE"));
});

test("project output gate accepts a canonical no-market prototype and forbids any manufactured route evidence", async (t) => {
  const prototype = createNoMarketOpenWorldV2PrototypeFixture("reward-service");
  const project = await createCompleteRepository(t, {
    extraFiles: [...prototype.files].map(([relativePath, bytes]) => [`submission/${relativePath}`, bytes])
  });
  const submissionRoot = path.join(project.root, "submission");
  const input = { ...project.bundle, repositoryRoot: project.root, submissionRoot };
  const report = validateProjectOutput(input);
  assert.equal(report.status, "PROJECT_OUTPUT_VALID", canonicalJsonV2(report));
  assert.equal(report.projection.applicability, "no-market");
  assert.deepEqual(report.projection.markets, []);
  const preflight = childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "preflight",
    "--repository-root",
    project.root,
    "--state",
    project.statePath,
    "--previous-state",
    project.previousStatePath,
    "--submission-root",
    "submission"
  ], { encoding: "utf8", shell: false });
  assert.equal(preflight.status, 0, preflight.stderr || preflight.stdout);
  const preflightReport = JSON.parse(preflight.stdout);
  assert.equal(preflightReport.status, "PROJECT_PREFLIGHT_VALID");
  assert.equal(preflightReport.canonicalOutput, true);
  assert.equal(preflightReport.outputBinding.reportSha256, report.reportSha256);
  const directPreflight = preflightProjectOutput({
    repositoryRoot: project.root,
    statePath: project.statePath,
    previousStatePath: project.previousStatePath,
    submissionRoot: "submission"
  });
  assert.equal(canonicalJsonV2(directPreflight), canonicalJsonV2(preflightReport));

  const manufactured = structuredCloneProjectOutputInput(input);
  manufactured.repositoryPlan.commands.push({
    id: "invented-quote-command",
    kind: "quote-test",
    argv: [process.execPath, "tools/project-stage.mjs", "quote"],
    cwd: ".",
    required: true,
    timeoutMs: 30000,
    executionPolicy: { networkAccess: "forbidden", externalWrites: false }
  });
  const rejected = validateProjectOutput(manufactured);
  assert.ok(rejected.findings.some(({ code }) => code === "PROJECT_OUTPUT_NONTRADABLE_EVIDENCE_FORBIDDEN"));

  const foreignSpec = makeProjectSpec();
  foreignSpec.applicationId = "foreign-reward-service";
  const duplicateGraph = makeProductGraph(makeProjectSpec());
  const foreignManifest = createStandardTradeCapabilityManifestFixtureV1({ applicationId: "foreign-market-app", marketRef: "foreign-market" });
  const poison = new Map([
    ["extras/project-spec.v1.json", Buffer.from(`${canonicalJsonV2(foreignSpec)}\n`)],
    ["extras/product-graph.v1.json", Buffer.from(`${canonicalJsonV2(duplicateGraph)}\n`)],
    ["extras/foreign.trade-capability.v1.json", Buffer.from(`${canonicalJsonV2(foreignManifest)}\n`)]
  ]);
  const poisoned = await createCompleteRepository(t, {
    extraFiles: [
      ...[...prototype.files].map(([relativePath, bytes]) => [`submission/${relativePath}`, bytes]),
      ...poison
    ],
    mutatePlan: (plan) => plan.artifacts.documentation.push(...[...poison].map(([artifactPath, bytes], index) => ({
      id: `foreign-project-metadata-${index}`,
      path: artifactPath,
      kind: "project-metadata",
      systemRefs: ["service-component"],
      required: true,
      status: "verified",
      sha256: sha256(bytes),
      byteLength: bytes.length
    })))
  });
  const poisonedOutput = validateProjectOutput({ ...poisoned.bundle, repositoryRoot: poisoned.root, submissionRoot: path.join(poisoned.root, "submission") });
  assert.equal(poisonedOutput.status, "PROJECT_OUTPUT_VALID", canonicalJsonV2(poisonedOutput));
  const poisonedPreflight = childProcess.spawnSync(process.execPath, [
    unifiedCli, "project", "preflight", "--repository-root", poisoned.root,
    "--state", poisoned.statePath, "--previous-state", poisoned.previousStatePath, "--submission-root", "submission"
  ], { encoding: "utf8", shell: false });
  assert.equal(poisonedPreflight.status, 1, poisonedPreflight.stderr || poisonedPreflight.stdout);
  const poisonedReport = JSON.parse(poisonedPreflight.stdout);
  assert.equal(poisonedReport.status, "PROJECT_PREFLIGHT_BLOCKED");
  assert.deepEqual(poisonedReport.findings.filter(({ code }) => code === "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_EXTRA").map(({ path: findingPath }) => findingPath), [
    "$.files.extras/foreign.trade-capability.v1.json",
    "$.files.extras/product-graph.v1.json",
    "$.files.extras/project-spec.v1.json"
  ]);
});

test("project materialize authors a complete idea-specific no-market repository and require-output fails closed", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-no-market-authoring-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const ideaPath = path.join(parent, "idea.txt");
  const sourcePath = path.join(parent, "cooperative-riddle.mjs");
  const testPath = path.join(parent, "cooperative-riddle.test.mjs");
  fs.writeFileSync(ideaPath, "A cooperative commit and reveal riddle game where every player must reveal before scoring.\n");
  fs.writeFileSync(sourcePath, `import crypto from "node:crypto";\nexport const commitment = (answer, salt) => crypto.createHash("sha256").update(answer + "\\0" + salt).digest("hex");\nexport class CooperativeRiddle {\n  #players; #answer; #commits = new Map(); #reveals = new Map();\n  constructor(players, answerDigest) { if (new Set(players).size !== players.length || players.length < 2) throw new Error("players"); this.#players = [...players]; this.#answer = answerDigest; }\n  commit(player, digest) { if (!this.#players.includes(player) || this.#commits.has(player)) throw new Error("commit"); this.#commits.set(player, digest); }\n  reveal(player, answer, salt) { if (this.#commits.size !== this.#players.length || this.#reveals.has(player) || this.#commits.get(player) !== commitment(answer, salt)) throw new Error("reveal"); this.#reveals.set(player, answer); }\n  score() { if (this.#reveals.size !== this.#players.length) throw new Error("incomplete"); return this.#players.filter((player) => commitment(this.#reveals.get(player), "answer") === this.#answer); }\n}\n`);
  fs.writeFileSync(testPath, `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { commitment, CooperativeRiddle } from "../src/cooperative-riddle.mjs";\ntest("all players commit and reveal before deterministic scoring", () => { const game = new CooperativeRiddle(["alice", "bob"], commitment("moss", "answer")); game.commit("alice", commitment("moss", "a")); assert.throws(() => game.reveal("alice", "moss", "a")); game.commit("bob", commitment("stone", "b")); game.reveal("alice", "moss", "a"); assert.throws(() => game.score()); game.reveal("bob", "stone", "b"); assert.deepEqual(game.score(), ["alice"]); });\ntest("a reveal must match its commitment", () => { const game = new CooperativeRiddle(["alice", "bob"], commitment("moss", "answer")); game.commit("alice", commitment("moss", "a")); game.commit("bob", commitment("stone", "b")); assert.throws(() => game.reveal("alice", "fern", "a")); });\n`);
  const output = path.join(parent, "riddle-circle");
  const args = [unifiedCli, "project", "materialize", "--idea-file", ideaPath, "--application-id", "riddle-circle", "--classification", "no-market", "--source-contract", sourcePath, "--test-source", testPath, "--output", output];
  const dry = childProcess.spawnSync(process.execPath, args, { encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  assert.equal(JSON.parse(dry.stdout).status, "PROJECT_MATERIALIZATION_DRY_RUN_READY");
  assert.equal(fs.existsSync(output), false);

  const written = childProcess.spawnSync(process.execPath, [...args, "--write"], { encoding: "utf8", shell: false, timeout: 60000 });
  assert.equal(written.status, 0, written.stderr || written.stdout);
  const materialization = JSON.parse(written.stdout);
  assert.equal(materialization.status, "PROJECT_PREFLIGHT_VALID");
  assert.equal(materialization.canonicalOutput, true);
  assert.equal(materialization.evidenceBoundary.approvalCreated, false);
  assert.equal(materialization.evidenceBoundary.networkAccessed, null);
  assert.equal(materialization.evidenceBoundary.externalWritesObserved, null);
  assert.equal(materialization.evidenceBoundary.executionIsolationEnforced, false);
  const authoredPlan = JSON.parse(fs.readFileSync(path.join(output, ".programmable/repository-plan.v1.json"), "utf8"));
  assert.ok(authoredPlan.commands.every(({ argv }) => argv[0] === "node"));
  for (const artifact of authoredPlan.artifacts.evidence.filter(({ kind }) => kind === "command-receipt")) {
    const receipt = JSON.parse(fs.readFileSync(path.join(output, artifact.path), "utf8"));
    assert.equal(receipt.tool.requested, "node");
    assert.equal(receipt.tool.resolvedPath, fs.realpathSync(process.execPath));
    assert.equal(receipt.tool.sha256, sha256(fs.readFileSync(process.execPath)));
  }
  const stateDirectory = path.join(output, ".programmable/project-states");
  assert.equal(fs.readdirSync(stateDirectory).length, 6);
  assert.equal(git(output, ["rev-list", "--count", "HEAD"]), "2");
  assert.equal(git(output, ["status", "--porcelain"]), "");
  const tracked = git(output, ["ls-files"]).split("\n");
  assert.ok(tracked.includes("submission/submission.v2.json"));
  assert.ok(tracked.includes("GITHUB-SUBMISSION.md"));
  const githubHandoff = JSON.parse(fs.readFileSync(path.join(output, "GITHUB-SUBMISSION.md"), "utf8").split("\n\n")[1]);
  assert.equal(githubHandoff.status, "NOT_SUBMITTED"); assert.equal(githubHandoff.requiresHumanConfirmation, true);
  assert.equal(githubHandoff.submission.sha256, sha256Bytes(fs.readFileSync(path.join(output, githubHandoff.submission.path))));
  assert.equal(tracked.some((filePath) => filePath.includes("trade-capabilit")), false);
  const npmTest = childProcess.spawnSync("npm", ["test", "--silent"], { cwd: output, encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(npmTest.status, 0, npmTest.stderr || npmTest.stdout);
  const strictArgs = ["--repository-root", output, "--state", ".programmable/project-states/000006-submission-evidence.v1.json", "--previous-state", ".programmable/project-states/000005-verification.v1.json", "--submission-root", "submission"];
  for (const command of ["validate-output", "require-output"]) {
    const result = childProcess.spawnSync(process.execPath, [unifiedCli, "project", command, ...strictArgs], { encoding: "utf8", shell: false, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, command === "validate-output" ? "PROJECT_OUTPUT_VALID" : "PROJECT_PREFLIGHT_VALID");
  }

  const reproducedOutput = path.join(parent, "riddle-circle-reproduced");
  const reproducedArgs = [...args];
  reproducedArgs[reproducedArgs.indexOf(output)] = reproducedOutput;
  const reproduced = childProcess.spawnSync(process.execPath, [...reproducedArgs, "--write"], { encoding: "utf8", shell: false, timeout: 60000 });
  assert.equal(reproduced.status, 0, reproduced.stderr || reproduced.stdout);
  assert.deepEqual(JSON.parse(reproduced.stdout), materialization);
  const blobs = (root) => new Map(git(root, ["ls-files", "-s"]).split("\n").map((line) => { const [metadata, filePath] = line.split("\t"); return [filePath, metadata.split(" ")[1]]; }));
  const originalBlobs = blobs(output);
  const reproducedBlobs = blobs(reproducedOutput);
  assert.deepEqual([...new Set([...originalBlobs.keys(), ...reproducedBlobs.keys()])].filter((filePath) => originalBlobs.get(filePath) !== reproducedBlobs.get(filePath)), []);
  assert.equal(git(reproducedOutput, ["rev-parse", "HEAD^{tree}"]), git(output, ["rev-parse", "HEAD^{tree}"]));
  assert.equal(JSON.parse(reproduced.stdout).evidenceCommit, materialization.evidenceCommit);
  const physical = (root) => {
    const files = [];
    const visit = (directory, prefix = "") => fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).forEach((entry) => {
      if (prefix === "" && entry.name === ".git") return;
      const relativePath = path.posix.join(prefix, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath, relativePath);
      else files.push({ path: relativePath, sha256: sha256(fs.readFileSync(absolutePath)) });
    });
    return files;
  };
  assert.deepEqual(physical(reproducedOutput), physical(output));

  writeFile(output, "config/trade-capability.json", `${canonicalJsonV2({ status: "NOT_APPROVED", classification: "tradable", market: {}, quote: "invented", execution: "invented", permit2: "invented", hookData: "0x", modes: [], limits: {}, fee: {}, claims: {} })}\n`);
  const mutated = childProcess.spawnSync(process.execPath, [unifiedCli, "project", "require-output", ...strictArgs], { encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(mutated.status, 1, mutated.stderr || mutated.stdout);
  assert.equal(JSON.parse(mutated.stdout).status, "PROJECT_PREFLIGHT_BLOCKED");

  const dustyTestPath = path.join(parent, "dusty-riddle.test.mjs");
  fs.writeFileSync(dustyTestPath, `import fs from "node:fs";\nimport test from "node:test";\ntest("writes ignored nondeterministic dust", () => { fs.mkdirSync("node_modules", { recursive: true }); fs.writeFileSync("node_modules/nondeterministic-dust.txt", String(Date.now())); });\n`);
  const dustyOutput = path.join(parent, "dusty-riddle");
  const dusty = childProcess.spawnSync(process.execPath, [unifiedCli, "project", "materialize", "--idea-file", ideaPath, "--application-id", "dusty-riddle", "--classification", "no-market", "--source-contract", sourcePath, "--test-source", dustyTestPath, "--output", dustyOutput, "--write"], { encoding: "utf8", shell: false, timeout: 60000 });
  assert.equal(dusty.status, 0, dusty.stderr || dusty.stdout);
  assert.equal(JSON.parse(dusty.stdout).status, "PROJECT_PREFLIGHT_VALID");
  assert.equal(fs.existsSync(path.join(dustyOutput, "node_modules")), false);
  assert.equal(git(dustyOutput, ["status", "--porcelain", "--untracked-files=all"]), "");

  const failingTestPath = path.join(parent, "failing-riddle.test.mjs");
  fs.writeFileSync(failingTestPath, `import assert from "node:assert/strict";\nimport test from "node:test";\ntest("fails", () => assert.fail("expected failure"));\n`);
  const failedOutput = path.join(parent, "failed-riddle");
  const failed = childProcess.spawnSync(process.execPath, [unifiedCli, "project", "materialize", "--idea-file", ideaPath, "--application-id", "failed-riddle", "--classification", "no-market", "--source-contract", sourcePath, "--test-source", failingTestPath, "--output", failedOutput, "--write"], { encoding: "utf8", shell: false, timeout: 60000 });
  assert.equal(failed.status, 2, failed.stderr || failed.stdout);
  assert.equal(fs.existsSync(failedOutput), false);
});

test("project preflight rejects forged authority and exact blind trade claims while ignoring unrelated JSON", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-preflight-adapter-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(root, "config/settings.json", `${canonicalJsonV2({ feature: true })}\n`);
  writeFile(root, "config/trade-capability.v1.json", `${canonicalJsonV2({
    $schema: "urn:programmable:trade-capability-manifest:1.0.0",
    schemaVersion: "1.0.0",
    manifestId: "bilateral-intent-market-local",
    applicationId: "programmable-bilateral-intent-venue",
    marketRef: "token0-token1-local",
    status: "NOT_APPROVED",
    routeType: "canonical-adapter",
    interface: {
      quote: "quote(bytes)",
      quoteSelector: "0xedfa3568",
      buildExecution: "buildExecution(bytes)",
      buildExecutionSelector: "0x21be7c85"
    },
    modes: ["zero-for-one-exact-input", "zero-for-one-exact-output", "one-for-zero-exact-input", "one-for-zero-exact-output"],
    slippageBps: { minimum: 0, maximum: 500 },
    deadline: "required-and-enforced",
    hookData: "required-nonempty-sha256-bound-adapter-consumed",
    funding: "test-permit2-allowance-transfer",
    fee: { quoteCurrency: "token1", totalHundredthsBip: 3000, programmableHundredthsBip: 1000, projectHundredthsBip: 2000 },
    assurance: "LOCAL_TEST_FIXTURE_ONLY_NOT_APPROVED_OR_DEPLOYED"
  })}\n`);
  const run = (repositoryRoot) => childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "preflight",
    "--repository-root",
    repositoryRoot
  ], { encoding: "utf8", shell: false });
  const first = run(root);
  const second = run(root);
  assert.equal(first.status, 1, first.stderr || first.stdout);
  assert.equal(second.status, 1, second.stderr || second.stdout);
  assert.equal(first.stdout, second.stdout);
  const report = JSON.parse(first.stdout);
  assert.equal(report.status, "PROJECT_PREFLIGHT_BLOCKED");
  assert.equal(report.canonicalOutput, false);
  assert.deepEqual(report.inventory.map(({ path: artifactPath }) => artifactPath), ["config/trade-capability.v1.json"]);
  assert.ok(report.findings.some(({ code, details }) => (
    code === "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_INVALID"
    && details.kind === "trade-capability-manifest-v1"
    && details.validatorCodes.includes("TRADE_CAPABILITY_MANIFEST_SCHEMA_INVALID")
  )));
  assert.match(report.reportSha256, /^sha256:[0-9a-f]{64}$/u);

  const forgedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-preflight-forged-"));
  t.after(() => fs.rmSync(forgedRoot, { recursive: true, force: true }));
  const forgedPayload = {
    schemaVersion: "1.0.0",
    validatorVersion: "1.0.0",
    status: "PROJECT_OUTPUT_VALID",
    artifactHashes: {
      projectSpec: `sha256:${"1".repeat(64)}`,
      productGraph: `sha256:${"2".repeat(64)}`,
      architectureCandidates: `sha256:${"3".repeat(64)}`,
      repositoryPlan: `sha256:${"4".repeat(64)}`,
      projectState: `sha256:${"5".repeat(64)}`,
      submissionPackageInventory: canonicalJsonSha256V2([])
    },
    submissionPackageInventory: { fileCount: 0, totalByteLength: 0, files: [] },
    projection: { applicationId: "forged", tradeFacetEntryRef: "forged", applicability: "no-market", markets: [] }
  };
  const forgedReport = { ...forgedPayload, reportSha256: canonicalJsonSha256V2(forgedPayload) };
  const forged = preflightProjectOutput({
    repositoryRoot: forgedRoot,
    boundPaths: ["project-spec.v1.json", "product-graph.v1.json", "architecture-candidates.v1.json", "repository-plan.v1.json", "project-state.v1.json", "submission.v2.json"],
    outputReport: forgedReport
  });
  assert.equal(forged.status, "PROJECT_PREFLIGHT_BLOCKED");
  assert.equal(forged.canonicalOutput, false);
  assert.deepEqual(forged.inventory, []);
  assert.ok(forged.findings.some(({ code }) => code === "PROJECT_PREFLIGHT_CALLER_BINDING_FORBIDDEN"));

  const standardRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-preflight-standard-"));
  t.after(() => fs.rmSync(standardRoot, { recursive: true, force: true }));
  writeFile(standardRoot, "config/trade-capability.json", `${canonicalJsonV2({
    status: "NOT_APPROVED",
    classification: "tradable",
    marketCount: 1,
    market: { currency0: "native-eth", currency1: "FARM", lpFeePips: 3000, tickSpacing: 60, poolIdSource: "FarmMarket.poolId()" },
    quote: "FarmMarket.quote",
    execution: "FarmMarket.execute (Universal-Router-shaped)",
    permit2: "MockPermit2 locally; pinned canonical Permit2 required for deployment",
    hookData: "abi.encode(uint8(1)) exactly",
    modes: ["eth-farm-exact-input", "eth-farm-exact-output", "farm-eth-exact-input", "farm-eth-exact-output"],
    limits: { slippage: "finite caller bound", deadline: "finite caller timestamp" },
    fee: { policy: "programmable-volume-fee-v2", quoteCurrency: "native-eth", programmableRate: 1000, totalRate: 3000 },
    claims: { audit: false, deployed: false, routeApproved: false, registryAccepted: false }
  })}\n`);
  const standard = run(standardRoot);
  assert.equal(standard.status, 1, standard.stderr || standard.stdout);
  const standardReport = JSON.parse(standard.stdout);
  assert.equal(standardReport.status, "PROJECT_PREFLIGHT_BLOCKED");
  assert.deepEqual(standardReport.inventory.map(({ path: artifactPath }) => artifactPath), ["config/trade-capability.json"]);
  assert.ok(standardReport.findings.some(({ code, details }) => (
    code === "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_INVALID" && details.kind === "trade-capability-manifest-v1"
  )));
});

test("project preflight keeps a valid unresolved proposal noncanonical and blocks adjacent no-market machine drift", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-preflight-unresolved-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const draft = createOpenWorldDraftPackage({
    applicationId: "community-repair-credits",
    publicIdeaText: "Build community repair credits; I have not decided whether they should ever be tradable or have a pool.",
    sourceRef: "blind-natural-idea"
  });
  for (const file of draft.files) writeFile(root, `programmable/community-repair-credits/${file.path}`, file.content);
  const run = () => childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "preflight",
    "--repository-root",
    root
  ], { encoding: "utf8", shell: false });
  const unresolved = run();
  assert.equal(unresolved.status, 1, unresolved.stderr || unresolved.stdout);
  const draftReport = JSON.parse(unresolved.stdout);
  assert.equal(draftReport.status, "PROJECT_PREFLIGHT_DRAFT_UNRESOLVED");
  assert.equal(draftReport.canonicalOutput, false);
  assert.ok(draftReport.findings.some(({ code }) => code === "PROJECT_PREFLIGHT_DRAFT_UNRESOLVED"));

  const noMarketSpec = makeProjectSpec();
  noMarketSpec.applicationId = "community-repair-credits";
  writeFile(root, ".programmable/project-spec.v1.json", `${canonicalJsonV2(noMarketSpec)}\n`);
  const drifted = run();
  assert.equal(drifted.status, 1, drifted.stderr || drifted.stdout);
  const driftReport = JSON.parse(drifted.stdout);
  assert.equal(driftReport.status, "PROJECT_PREFLIGHT_BLOCKED");
  assert.ok(driftReport.findings.some(({ code, details }) => (
    code === "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_UNBOUND" && details.kind === "project-spec-v1"
  )));
});

test("project output gate accepts a COMPLETE tradable prototype and fails closed on market, route, completion, and manifest-byte drift", async (t) => {
  const fixture = await createTradableOutputFixture(t);
  const report = validateProjectOutput(fixture.input);
  assert.equal(report.status, "PROJECT_OUTPUT_VALID", canonicalJsonV2(report));
  assert.equal(report.projection.applicability, "tradable");
  assert.deepEqual(report.projection.markets, ["main-market"]);
  assert.equal(report.evidenceBoundary.commandsReexecuted, false);
  assert.equal(report.evidenceBoundary.approvalCreated, false);
  const preflight = childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "preflight",
    "--repository-root",
    fixture.input.repositoryRoot,
    "--state",
    ".programmable/project-states/000005-verification.v1.json",
    "--previous-state",
    ".programmable/project-states/000004-repository-materialization.v1.json",
    "--submission-root",
    "submission"
  ], { encoding: "utf8", shell: false });
  assert.equal(preflight.status, 0, preflight.stderr || preflight.stdout);
  const preflightReport = JSON.parse(preflight.stdout);
  assert.equal(preflightReport.status, "PROJECT_PREFLIGHT_VALID");
  assert.equal(preflightReport.outputBinding.reportSha256, report.reportSha256);

  const mutate = (change) => {
    const input = structuredCloneProjectOutputInput(fixture.input);
    change(input);
    return validateProjectOutput(input);
  };
  const incomplete = mutate(({ repositoryPlan }) => { repositoryPlan.completionStatus = "materializing"; });
  assert.ok(incomplete.findings.some(({ code }) => code === "PROJECT_OUTPUT_TRADABLE_COMPLETE_REQUIRED"));

  const marketDrift = mutate(({ repositoryPlan }) => { repositoryPlan.tradeCapability.markets[0].marketSystemRef = "invented-market"; });
  assert.ok(marketDrift.findings.some(({ code }) => code === "PROJECT_OUTPUT_PLAN_MARKET_BIJECTION_INVALID"));

  const routeDrift = mutate(({ repositoryPlan }) => { repositoryPlan.tradeCapability.markets[0].routeType = "canonical-programmable-adapter"; });
  assert.ok(routeDrift.findings.some(({ code }) => code === "PROJECT_OUTPUT_ROUTE_TYPE_MISMATCH"));

  const manifestDrift = mutate(({ repositoryPlan }) => {
    const artifact = repositoryPlan.artifacts.configuration.find(({ kind }) => kind === "trade-capability-manifest");
    artifact.sha256 = `sha256:${"0".repeat(64)}`;
  });
  assert.ok(manifestDrift.findings.some(({ code }) => code === "PROJECT_OUTPUT_MANIFEST_BYTES_MISMATCH"));
});

test("repository plans cannot claim COMPLETE from hashes alone or omit contract and v4 proof", () => {
  const bundle = makeArchitectureBundle();
  const plan = makePlanningRepositoryPlan(bundle);
  plan.completionStatus = "COMPLETE";
  const hashOnly = validateRepositoryPlan(bundle.projectSpec, bundle.productGraph, bundle.architectureCandidates, plan);
  assert.ok(hashOnly.some(({ code }) => code === "REPOSITORY_FILES_NOT_VERIFIED"));
  assert.ok(hashOnly.some(({ code }) => code === "COMPLETE_ARTIFACT_NOT_VERIFIED"));

  const forcedRoute = makePlanningRepositoryPlan(bundle);
  forcedRoute.artifacts.configuration.push({ ...forcedRoute.artifacts.configuration[0], id: "forced-route", path: ".programmable/trade-capabilities/fake-market.v1.json", kind: "trade-capability-manifest" });
  assert.ok(validateRepositoryPlan(bundle.projectSpec, bundle.productGraph, bundle.architectureCandidates, forcedRoute).some(({ code }) => code === "NO_MARKET_TRADE_EVIDENCE_FORBIDDEN"));

  const mismatchedDisposition = makePlanningRepositoryPlan(bundle);
  mismatchedDisposition.tradeCapability.applicability = "unresolved";
  assert.ok(validateRepositoryPlan(bundle.projectSpec, bundle.productGraph, bundle.architectureCandidates, mismatchedDisposition).some(({ code }) => code === "TRADE_APPLICABILITY_MISMATCH"));

  const unresolvedSpec = makeProjectSpec();
  unresolvedSpec.facets.routing.applicability = "unresolved";
  unresolvedSpec.facets.routing.entries[0].applicability = "unresolved";
  const unresolvedGraph = makeProductGraph(unresolvedSpec);
  const unresolvedArchitectures = makeArchitectures(unresolvedSpec, unresolvedGraph);
  const unresolvedPlan = makePlanningRepositoryPlan({ projectSpec: unresolvedSpec, productGraph: unresolvedGraph, architectureCandidates: unresolvedArchitectures });
  unresolvedPlan.tradeCapability.applicability = "unresolved";
  unresolvedPlan.completionStatus = "COMPLETE";
  assert.ok(validateRepositoryPlan(unresolvedSpec, unresolvedGraph, unresolvedArchitectures, unresolvedPlan).some(({ code }) => code === "UNRESOLVED_TRADE_CAPABILITY_COMPLETE_FORBIDDEN"));

  const contractGraph = structuredClone(bundle.productGraph);
  contractGraph.graphs.system.nodes[0].type = "contract";
  contractGraph.graphs.system.nodes[0].protocolRole = "uniswap-v4-hook";
  contractGraph.graphs.component.components[0].type = "hook";
  contractGraph.graphs.deployment.targets[0].type = "contract";
  const v4Architectures = makeArchitectures(bundle.projectSpec, contractGraph);
  v4Architectures.candidates[0].v4Usage.customHook = {
    disposition: "required",
    systemNodeRefs: ["settlement-service"],
    rationale: "The selected candidate requires atomic pool callbacks."
  };
  v4Architectures.productGraphSha256 = projectArtifactSha256(contractGraph);
  const v4Plan = makePlanningRepositoryPlan({ ...bundle, productGraph: contractGraph, architectureCandidates: v4Architectures });
  const v4Findings = validateRepositoryPlan(bundle.projectSpec, contractGraph, v4Architectures, v4Plan);
  assert.ok(v4Findings.some(({ code }) => code === "PROJECT_TOOLCHAIN_LOCK_CARDINALITY_INVALID"));
  assert.ok(v4Findings.some(({ code }) => code === "V4_SEMANTIC_CONTRACT_REQUIRED"));
  assert.ok(v4Findings.some(({ code, details }) => code === "REPOSITORY_COMMAND_KIND_MISSING" && details.kind === "fork"));
});

test("tradable RepositoryPlans project selected standard-v4 and canonical-adapter markets bijectively", () => {
  for (const routeType of ["standard-uniswap-v4", "canonical-programmable-adapter"]) {
    const fixture = makeTradablePlanningBundle(routeType);
    assert.deepEqual(validateProjectSpec(fixture.projectSpec), []);
    assert.deepEqual(validateProductGraph(fixture.projectSpec, fixture.productGraph), []);
    assert.deepEqual(validateArchitectureCandidates(fixture.projectSpec, fixture.productGraph, fixture.architectureCandidates), []);
    assert.deepEqual(validateRepositoryPlan(fixture.projectSpec, fixture.productGraph, fixture.architectureCandidates, fixture.repositoryPlan), []);

    const missingManifest = structuredClone(fixture.repositoryPlan);
    missingManifest.artifacts.configuration = missingManifest.artifacts.configuration.filter(({ kind }) => kind !== "trade-capability-manifest");
    assert.ok(validateRepositoryPlan(fixture.projectSpec, fixture.productGraph, fixture.architectureCandidates, missingManifest).some(({ code }) => code === "TRADE_CAPABILITY_MANIFEST_REQUIRED"));

    const orphanResult = structuredClone(fixture.repositoryPlan);
    orphanResult.artifacts.evidence.push({ ...orphanResult.artifacts.evidence.find(({ kind }) => kind === "trade-test-result"), id: "orphan-trade-result", path: ".programmable/trade-test-results/orphan.v1.json" });
    assert.ok(validateRepositoryPlan(fixture.projectSpec, fixture.productGraph, fixture.architectureCandidates, orphanResult).some(({ code }) => code === "TRADE_RESULT_ARTIFACT_CARDINALITY_INVALID"));

    const unresolvedMarket = structuredClone(fixture.productGraph);
    unresolvedMarket.graphs.system.nodes.find(({ id }) => id === "primary-market").implementationStatus = "external-unresolved";
    assert.ok(validateProductGraph(fixture.projectSpec, unresolvedMarket).some(({ code }) => code === "TRADE_MARKET_GRAPH_REQUIRED"));
  }
});

test("v4 semantic RepositoryPlan records require the exact version and bundled validator path", () => {
  const repositoryPlanSchema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references/repository-plan-v1.schema.json"), "utf8"));
  const schema = { $schema: repositoryPlanSchema.$schema, $id: "urn:programmable:test:v4-semantic-record", $ref: "#/$defs/v4HookSemanticContract", $defs: repositoryPlanSchema.$defs };
  const record = { systemRef: "v4-hook-system", contractVersion: "1.0.0", validatorPath: "scripts/v4-hook-semantic-contract-core.mjs", profileArtifactId: "primary-market-v4-hook-semantic", sourceArtifactIds: ["programmable-volume-fee-hook-v2"], deploymentArtifactIds: ["primary-market-v4-deployment-preimage", "primary-market-v4-deployment-manifest", "primary-market-v4-runtime-code"], evidenceArtifactIds: ["primary-market-mainnet-fork-canary"] };
  assert.deepEqual(validateAgainstSchema(record, schema), []);
  for (const field of ["contractVersion", "validatorPath"]) {
    const missing = structuredClone(record); delete missing[field];
    assert.notDeepEqual(validateAgainstSchema(missing, schema), [], field);
  }
});

test("productive standard-v4 fee return API exposes its local vector-set reference", () => {
  const source = fs.readFileSync(path.join(skillRoot, "scripts/open-world-v2-draft-core.mjs"), "utf8");
  assert.match(source, /const vectorSetRef = `fee-vector-set-\$\{trade\.marketRef\}`;/u);
  assert.match(source, /feeConformance: Object\.freeze\(\{[^}]*vectorSet, vectorSetRef, vectorSetBytes,/u);
});

test("productive tradable plan preserves Foundry artifacts until every typed trade replay completes", () => {
  const source = fs.readFileSync(path.join(skillRoot, "scripts/project-tradable-authoring-core.mjs"), "utf8"), trade = source.indexOf("for (const evidenceCommand of tradeEvidence.commands)"), slither = source.indexOf('commands.push(command("slither-command"', trade);
  assert.ok(trade >= 0 && slither > trade); assert.match(source, /full:\["forge",\["test","--offline","-q","--no-match-path","\$\{forkTest\}"\]\]/u);
});

test("tradable execution authors distinct typed quote and execution results with closed receipt bindings", async (t) => {
  const fixture = createMaterializedTradableRepository(t);
  assert.deepEqual(validateRepositoryPlan(
    fixture.bundle.projectSpec,
    fixture.bundle.productGraph,
    fixture.bundle.architectureCandidates,
    fixture.plan
  ), []);

  const execution = await executeProjectCommands({
    repositoryRoot: fixture.root,
    repositoryPlan: fixture.plan,
    outputPlanPath: ".programmable/repository-plan.v1.json"
  });
  assert.equal(execution.status, "PROJECT_COMMAND_EVIDENCE_READY_TO_COMMIT");
  assert.equal(execution.approvalCreated, false);
  assert.equal(execution.externalActionsPerformed.length, 0);
  assert.equal(execution.tradeResultPaths.length, fixture.manifest.testEvidence.quoteTests.length + fixture.manifest.testEvidence.executionTests.length);
  assert.equal(new Set([...execution.receiptPaths, ...execution.tradeResultPaths]).size, execution.receiptPaths.length + execution.tradeResultPaths.length);

  git(fixture.root, ["add", ".programmable"]);
  git(fixture.root, ["commit", "-qm", "record typed trade execution evidence"]);
  const completed = execution.repositoryPlan;
  assert.deepEqual(validateRepositoryPlan(
    fixture.bundle.projectSpec,
    fixture.bundle.productGraph,
    fixture.bundle.architectureCandidates,
    completed,
    { repositoryRoot: fixture.root, verifyRepositoryFiles: true }
  ), []);

  const resultArtifact = completed.artifacts.evidence.find(({ kind }) => kind === "trade-test-result");
  const commandId = resultArtifact.id.slice(0, -"-result".length);
  const receiptArtifact = completed.artifacts.evidence.find(({ id }) => id === `${commandId}-receipt`);
  const receipt = JSON.parse(fs.readFileSync(path.join(fixture.root, receiptArtifact.path), "utf8"));
  assert.equal(receipt.domainEvidence.contract, "trade-command-domain-evidence-v1");
  assert.equal(receipt.domainEvidence.semanticAdequacy, "PARTIAL_EVIDENCE");
  assert.equal(receipt.domainEvidence.runnerEvidence.contract, "forge-test-json-v1");
  assert.equal(receipt.domainEvidence.runnerEvidence.testsObserved, 1);
  assert.equal(receipt.domainEvidence.runnerEvidence.passedTests, 1);
  assert.equal(receipt.domainEvidence.runnerEvidence.callEvidence[0].role, commandId.startsWith("quote-") ? "quote-target" : "execution-target");
  assert.equal(receipt.domainEvidence.resultArtifactPath, resultArtifact.path);
  assert.notEqual(receipt.stdoutSha256, resultArtifact.sha256);
  const negativeTest = fixture.manifest.testEvidence.executionTests.find(({ scenario }) => scenario === "expired-deadline-revert");
  const negativeReceiptArtifact = completed.artifacts.evidence.find(({ id }) => id === `${negativeTest.commandId}-receipt`);
  const negativeReceipt = JSON.parse(fs.readFileSync(path.join(fixture.root, negativeReceiptArtifact.path), "utf8"));
  const negativeCall = negativeReceipt.domainEvidence.runnerEvidence.callEvidence.find(({ role }) => role === "execution-target");
  assert.equal(negativeCall.outcome, "reverted");
  assert.equal(negativeCall.outputSha256, negativeTest.expectedRevertDataSha256);
  receipt.domainEvidence.resultArtifactSha256 = sha256(Buffer.from("tampered trade result"));
  writeFile(fixture.root, receiptArtifact.path, `${canonicalJsonV2(receipt)}\n`);
  const mutationFindings = validateRepositoryPlan(
    fixture.bundle.projectSpec,
    fixture.bundle.productGraph,
    fixture.bundle.architectureCandidates,
    completed,
    { repositoryRoot: fixture.root, verifyRepositoryFiles: true }
  );
  assert.ok(mutationFindings.some(({ code }) => code === "TRADE_DOMAIN_RECEIPT_BINDING_MISMATCH"));
});

test("Forge runner evidence rejects zero tests and a one-PASS canonical result printer without route calls", () => {
  const manifest = createStandardTradeCapabilityManifestFixtureV1({ applicationId: "runner-regression", marketRef: "primary-market" });
  const declaration = manifest.testEvidence.quoteTests[0];
  const zero = inspectForgeTradeTestRunnerOutputV1("{}\n", declaration);
  assert.equal(zero.valid, false);
  assert.equal(zero.error.code, "TRADE_TEST_RUNNER_ZERO_TESTS");

  const result = createTradeTestResultFixturesV1(manifest).get(declaration.resultArtifactPath);
  const fabricated = {
    [`${declaration.command.argv[6]}:FabricatedTradeTest`]: {
      duration: "1ms",
      test_results: {
        [declaration.runnerTestSignature]: {
          status: "Success",
          reason: null,
          decoded_logs: [`PROGRAMMABLE_TRADE_RESULT_V1:${canonicalJsonV2(result)}\n`],
          kind: { Unit: { gas: 1 } },
          traces: []
        }
      },
      warnings: []
    }
  };
  const printer = inspectForgeTradeTestRunnerOutputV1(`${canonicalJsonV2(fabricated)}\n`, declaration);
  assert.equal(printer.valid, false);
  assert.equal(printer.error.code, "TRADE_TEST_TRACE_EVIDENCE_MISSING");
});

test("standard V4Quoter evidence requires a real CALL trace while adapter quotes retain STATICCALL", () => {
  const manifest = createStandardTradeCapabilityManifestFixtureV1({ applicationId: "v4-quoter-call-regression", marketRef: "primary-market" });
  const declaration = structuredClone(manifest.testEvidence.quoteTests[0]);
  const result = structuredClone(createTradeTestResultFixturesV1(manifest).get(declaration.resultArtifactPath));
  // Captured from the byte-identical V2 kernel's pinned V4Quoter during a clean Forge -vvvv run.
  const quoterAddress = "0x13aa49bac059d709dd0a18d6bb63290076a702d7";
  const quoteCalldata = "0xaa9d21cb0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000015cf58144ef33af1e14b5208015d11f9143e27b90000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000000000000000000000000000000000000000003c00000000000000000000000010fd02f4021ee8a06ce487fb32658969090e60cc00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000";
  const quoteOutput = "0x0000000000000000000000000000000000000000000000000d68796fa838ac9b00000000000000000000000000000000000000000000000000000000000310cb";
  declaration.targetAddress = quoterAddress;
  result.context.route.quoteTarget = quoterAddress;
  result.observation.callBinding.target = quoterAddress;
  result.observation.callDataSha256 = sha256(Buffer.from(quoteCalldata.slice(2), "hex"));
  result.observation.returnDataSha256 = sha256(Buffer.from(quoteOutput.slice(2), "hex"));
  result.observation.callBinding.calldataSha256 = result.observation.callDataSha256;
  result.observation.callBinding.reencodedCalldataSha256 = result.observation.callDataSha256;
  assert.equal(expectedTradeRunnerCallsV1(result, declaration)[0].callKind, "CALL");

  const forgeOutput = (callKind) => ({
    [`${declaration.command.argv[6]}:RealV4QuoterTraceTest`]: {
      duration: "1ms",
      test_results: {
        [declaration.runnerTestSignature]: {
          status: "Success",
          reason: null,
          decoded_logs: [`PROGRAMMABLE_TRADE_RESULT_V1:${canonicalJsonV2(result)}\n`],
          kind: { Unit: { gas: 1 } },
          traces: [["Execution", {
            arena: [{
              trace: {
                kind: callKind,
                address: declaration.targetAddress,
                data: quoteCalldata,
                output: quoteOutput,
                success: true,
                status: "Return"
              }
            }]
          }]]
        }
      },
      warnings: []
    }
  });

  const call = inspectForgeTradeTestRunnerOutputV1(`${canonicalJsonV2(forgeOutput("CALL"))}\n`, declaration);
  assert.equal(call.valid, true, call.error?.message);
  assert.equal(call.execution.runnerEvidence.callEvidence[0].callKind, "CALL");

  const staticcall = inspectForgeTradeTestRunnerOutputV1(`${canonicalJsonV2(forgeOutput("STATICCALL"))}\n`, declaration);
  assert.equal(staticcall.valid, false);
  assert.equal(staticcall.error.code, "TRADE_TEST_TRACE_BINDING_INVALID");

  const adapterResult = structuredClone(result);
  adapterResult.context.route.type = "canonical-programmable-adapter";
  assert.equal(expectedTradeRunnerCallsV1(adapterResult, declaration)[0].callKind, "STATICCALL");
});

test("validated trade receipts normalize duration, warning, object-order, and trace-order drift", () => {
  const firstRaw = deterministicForgeOutput({ suiteDuration: "1ms", testDuration: "2ms", warning: "first", unrelatedFirst: true });
  const secondRaw = deterministicForgeOutput({ suiteDuration: "99ms", testDuration: "101ms", warning: "second", unrelatedFirst: false, reverseKeys: true });
  assert.notEqual(sha256Bytes(Buffer.from(firstRaw)), sha256Bytes(Buffer.from(secondRaw)));
  const first = deterministicTradeReceipt(firstRaw);
  const second = deterministicTradeReceipt(secondRaw);
  assert.equal(first.stdoutSha256, second.stdoutSha256);
  assert.equal(first.stdoutByteLength, second.stdoutByteLength);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.equal(first.domainEvidence.runnerEvidence.runnerOutputSha256, first.stdoutSha256);
  assert.equal(first.domainEvidence.runnerEvidence.runnerOutputByteLength, first.stdoutByteLength);
  assert.equal(first.executionPolicy.maximumOutputBytes, PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES);
  assert.deepEqual(validateAgainstSchema(first, commandReceiptSchema), []);
});

test("validated trade receipt identity binds exact suite and rejects gas, decoded-log, and relevant-call drift", () => {
  const baseline = deterministicTradeReceipt(deterministicForgeOutput({}));
  const renamed = deterministicTradeReceipt(deterministicForgeOutput({ suiteName: "test/Route.t.sol:RenamedRouteTest" }));
  assert.notEqual(renamed.stdoutSha256, baseline.stdoutSha256);
  for (const mutate of [
    (output) => { output[deterministicSuite].test_results["testQuote()"].kind.Unit.gas = 124; },
    (output) => { output[deterministicSuite].test_results["testQuote()"].decoded_logs[0] += " "; }
  ]) assert.throws(() => deterministicTradeReceipt(deterministicForgeOutput({ mutate })), ({ code }) => code === "TRADE_RECEIPT_NORMALIZATION_DRIFT");
  const parserBoundRaw = deterministicForgeOutput({});
  for (const mutate of [
    (output) => { deterministicRelevantTrace(output).output = "0xdd"; },
    (output) => { output[deterministicSuite].test_results["testQuote()"].traces[0][1].arena.push({ trace: { ...deterministicRelevantTrace(output) } }); }
  ]) assert.throws(() => deterministicTradeReceipt(deterministicForgeOutput({ mutate }), parserBoundRaw), ({ code }) => code === "TRADE_RECEIPT_NORMALIZATION_DRIFT");
});

test("non-trade receipts retain exact raw stdout identity and cannot claim the trade output cap", () => {
  const nonTrade = { ...deterministicCommand, id: "build-primary", kind: "build", argv: ["npm", "run", "build"] };
  const make = (stdout) => createProjectCommandReceipt({
    repositoryPlan: { ...deterministicPlan, commands: [nonTrade] }, command: nonTrade,
    source: deterministicSource, tool: deterministicTool, executionResult: { stdout, stderr: "" },
    maximumOutputBytes: PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES
  });
  const first = make("first\n");
  assert.equal(projectCommandMaximumOutputBytes(nonTrade), PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES);
  assert.equal(first.executionPolicy.maximumOutputBytes, PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES);
  assert.notEqual(first.stdoutSha256, make("second\n").stdoutSha256);
  const oversized = structuredClone(first);
  oversized.executionPolicy.maximumOutputBytes = PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES;
  assert.ok(validateAgainstSchema(oversized, commandReceiptSchema).some(({ path: issuePath }) => issuePath.endsWith(".executionPolicy.maximumOutputBytes")));
});

test("validated Forge trade parser accepts an explicit narrow high-volume bound", () => {
  const raw = deterministicForgeOutput({});
  const declaration = {
    commandId: deterministicCommand.id, runnerContract: "forge-test-json-v1", runnerTestSignature: "testQuote()", resultContract: "trade-quote-test-result-v1",
    command: { argv: deterministicCommand.argv, workingDirectory: "." },
    testSourceArtifact: { path: "test/Route.t.sol", sha256: `sha256:${"4".repeat(64)}`, byteLength: 1 }
  };
  const boundedOut = inspectForgeTradeTestRunnerOutputV1(raw, declaration, deterministicCommand.id, { maxSourceBytes: Buffer.byteLength(raw) - 1, maxNodes: 1000 });
  assert.equal(boundedOut.valid, false);
  assert.equal(boundedOut.error.cause, "STRICT_JSON_SOURCE_LIMIT");
  assert.equal(inspectForgeTradeTestRunnerOutputV1(raw, declaration, deterministicCommand.id, { maxSourceBytes: Buffer.byteLength(raw), maxNodes: 1000 }).valid, true);
});

test("executor receipts survive an evidence-only commit while static completion stays unproven", async (t) => {
  const fixture = await createCompleteRepository(t);
  const planFindings = validateRepositoryPlan(
    fixture.bundle.projectSpec,
    fixture.bundle.productGraph,
    fixture.bundle.architectureCandidates,
    fixture.bundle.repositoryPlan,
    { repositoryRoot: fixture.root, verifyRepositoryFiles: true }
  );
  assert.deepEqual(planFindings, []);

  const result = childProcess.spawnSync(process.execPath, [
    compilerCli,
    "validate",
    "--repository-root",
    fixture.root,
    "--state",
    fixture.statePath,
    "--previous-state",
    fixture.previousStatePath
  ], { encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "PROJECT_COMPILATION_VALID");
  assert.equal(report.repositoryCompletion, "NOT_PROVEN");
  assert.equal(report.commandExecutionEvidence, "UNTRUSTED_DETERMINISTIC_RECEIPT_CONTENT_MATCH");
  assert.equal(report.evidenceBoundary.commandsReexecuted, false);
  assert.equal(report.evidenceBoundary.receiptIssuerAuthenticated, false);
  assert.deepEqual(report.evidenceBoundary.externalActionsPerformed, []);
  assert.equal(report.evidenceBoundary.approvalCreated, false);
  assert.equal(report.evidenceBoundary.auditClaimed, false);

  const cloneParent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-clone-"));
  t.after(() => fs.rmSync(cloneParent, { recursive: true, force: true }));
  const cloneRoot = path.join(cloneParent, "project");
  const clone = childProcess.spawnSync("git", ["clone", "-q", fixture.root, cloneRoot], { encoding: "utf8", shell: false });
  assert.equal(clone.status, 0, clone.stderr);
  const clonedValidation = childProcess.spawnSync(process.execPath, [
    compilerCli,
    "validate",
    "--repository-root",
    cloneRoot,
    "--state",
    fixture.statePath,
    "--previous-state",
    fixture.previousStatePath
  ], { encoding: "utf8", shell: false });
  assert.equal(clonedValidation.status, 0, clonedValidation.stderr || clonedValidation.stdout);
  const clonedReport = JSON.parse(clonedValidation.stdout);
  assert.equal(clonedReport.repositoryCompletion, "NOT_PROVEN");
  assert.equal(clonedReport.commandExecutionEvidence, "UNTRUSTED_DETERMINISTIC_RECEIPT_CONTENT_MATCH");

  const changed = path.join(fixture.root, "src/app.mjs");
  fs.appendFileSync(changed, "// drift\n");
  const driftFindings = validateRepositoryPlan(
    fixture.bundle.projectSpec,
    fixture.bundle.productGraph,
    fixture.bundle.architectureCandidates,
    fixture.bundle.repositoryPlan,
    { repositoryRoot: fixture.root, verifyRepositoryFiles: true }
  );
  assert.ok(driftFindings.some(({ code }) => ["REPOSITORY_ARTIFACT_HASH_MISMATCH", "PROJECT_SOURCE_DIRTY"].includes(code)));
});

test("executor and COMPLETE validation reject repeated, no-op, symlinked, timed-out, drifted, and fabricated evidence", async (t) => {
  const cliFixture = createMaterializedRepository(t);
  const materializingPlanPath = ".programmable/repository-plan.materializing.v1.json";
  writeFile(cliFixture.root, materializingPlanPath, `${canonicalJsonV2(cliFixture.plan)}\n`);
  const executed = childProcess.spawnSync(process.execPath, [
    compilerCli,
    "execute",
    "--repository-root",
    cliFixture.root,
    "--plan",
    materializingPlanPath,
    "--output-plan",
    ".programmable/repository-plan.v1.json"
  ], { encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  assert.equal(JSON.parse(executed.stdout).status, "PROJECT_COMMAND_EVIDENCE_READY_TO_COMMIT");

  const repeated = createMaterializedRepository(t, { mutatePlan: (plan) => { plan.commands[1].argv = [...plan.commands[0].argv]; } });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: repeated.root, repositoryPlan: repeated.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => code === "PROJECT_COMMAND_REPEATED"
  );

  const noOp = createMaterializedRepository(t, { mutatePlan: (plan) => { plan.commands[0].argv = [process.execPath, "--version"]; } });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: noOp.root, repositoryPlan: noOp.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => code === "PROJECT_COMMAND_NOOP_FORBIDDEN"
  );

  const symlinked = createMaterializedRepository(t, {
    setup: (root, plan) => { fs.symlinkSync(".", path.join(root, "linked")); plan.commands[0].cwd = "linked"; }
  });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: symlinked.root, repositoryPlan: symlinked.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => code === "PROJECT_COMMAND_CWD_SYMLINK"
  );

  const timedOut = createMaterializedRepository(t, {
    extraFiles: [["tools/slow-stage.mjs", "setTimeout(() => {}, 10000);\n"]],
    mutatePlan: (plan) => { plan.commands[0].argv = [process.execPath, "tools/slow-stage.mjs"]; plan.commands[0].timeoutMs = 100; }
  });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: timedOut.root, repositoryPlan: timedOut.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => code === "PROJECT_COMMAND_TIMEOUT"
  );

  const drifted = createMaterializedRepository(t, {
    extraFiles: [["tools/drift-stage.mjs", "import fs from 'node:fs';\nfs.appendFileSync('src/app.mjs', '// changed\\n');\n"]],
    mutatePlan: (plan) => { plan.commands[0].argv = [process.execPath, "tools/drift-stage.mjs"]; }
  });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: drifted.root, repositoryPlan: drifted.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => ["PROJECT_SOURCE_DIRTY", "PROJECT_SOURCE_DRIFT"].includes(code)
  );

  const fabricated = await createCompleteRepository(t);
  const forgedPlan = structuredClone(fabricated.bundle.repositoryPlan);
  const receiptArtifact = forgedPlan.artifacts.evidence.find(({ kind }) => kind === "command-receipt");
  const receiptPath = path.join(fabricated.root, receiptArtifact.path);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  delete receipt.executor;
  const forgedBytes = Buffer.from(`${canonicalJsonV2(receipt)}\n`);
  fs.writeFileSync(receiptPath, forgedBytes);
  receiptArtifact.sha256 = sha256(forgedBytes);
  receiptArtifact.byteLength = forgedBytes.length;
  writeFile(fabricated.root, ".programmable/repository-plan.v1.json", `${canonicalJsonV2(forgedPlan)}\n`);
  git(fabricated.root, ["add", ".programmable"]);
  git(fabricated.root, ["commit", "-qm", "attempt fabricated receipt"]);
  const forgedFindings = validateRepositoryPlan(
    fabricated.bundle.projectSpec,
    fabricated.bundle.productGraph,
    fabricated.bundle.architectureCandidates,
    forgedPlan,
    { repositoryRoot: fabricated.root, verifyRepositoryFiles: true }
  );
  assert.ok(forgedFindings.some(({ code }) => ["COMMAND_RECEIPT_SCHEMA_INVALID", "COMMAND_RECEIPT_EXECUTOR_BINDING_MISMATCH"].includes(code)));
});

test("executor resolves portable node argv through sanitized PATH and binds the exact runtime identity", async (t) => {
  const fixture = createMaterializedRepository(t);
  const shimRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-node-path-shim-"));
  t.after(() => fs.rmSync(shimRoot, { recursive: true, force: true }));
  fs.symlinkSync(process.execPath, path.join(shimRoot, process.platform === "win32" ? "node.exe" : "node"));
  const previousPath = process.env.PATH;
  process.env.PATH = [shimRoot, previousPath].filter(Boolean).join(path.delimiter);
  let execution;
  try {
    execution = await executeProjectCommands({ repositoryRoot: fixture.root, repositoryPlan: fixture.plan, outputPlanPath: ".programmable/repository-plan.v1.json" });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
  assert.equal(execution.status, "PROJECT_COMMAND_EVIDENCE_READY_TO_COMMIT");
  assert.ok(execution.repositoryPlan.commands.every(({ argv }) => argv[0] === "node"));
  const nodeBytes = fs.readFileSync(process.execPath);
  for (const receiptPath of execution.receiptPaths) {
    const receipt = JSON.parse(fs.readFileSync(path.join(fixture.root, receiptPath), "utf8"));
    assert.equal(receipt.tool.requested, "node");
    assert.equal(receipt.tool.resolvedPath, fs.realpathSync(process.execPath));
    assert.equal(receipt.tool.byteLength, nodeBytes.length);
    assert.equal(receipt.tool.sha256, sha256(nodeBytes));
    assert.equal(childProcess.spawnSync(receipt.tool.resolvedPath, ["--version"], { encoding: "utf8", shell: false }).stdout.trim(), process.version);
  }
});

test("valid no-op package receipts and self-consistent forgeries remain statically untrusted", async (t) => {
  const fixture = await createCompleteRepository(t, {
    extraFiles: [["package.json", '{"scripts":{"pretend":"node -e \\"process.exit(0)\\""}}\n']],
    mutatePlan: (plan) => { plan.commands[0].argv = ["npm", "run", "--silent", "pretend"]; }
  });
  const plan = structuredClone(fixture.bundle.repositoryPlan);
  const receiptArtifact = plan.artifacts.evidence.find(({ id }) => id === "install-command-receipt");
  const receiptPath = path.join(fixture.root, receiptArtifact.path);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  const forgedStdout = Buffer.from("forged output never emitted by the package script\n");
  receipt.stdoutSha256 = sha256(forgedStdout);
  receipt.stdoutByteLength = forgedStdout.length;
  const { receiptSha256: _receiptSha256, ...receiptPayload } = receipt;
  receipt.receiptSha256 = canonicalJsonSha256V2(receiptPayload);
  const receiptBytes = Buffer.from(`${canonicalJsonV2(receipt)}\n`);
  fs.writeFileSync(receiptPath, receiptBytes);
  receiptArtifact.sha256 = sha256(receiptBytes);
  receiptArtifact.byteLength = receiptBytes.length;
  plan.commandResults.find(({ commandId }) => commandId === receipt.commandId).stdoutSha256 = receipt.stdoutSha256;
  writeFile(fixture.root, ".programmable/repository-plan.v1.json", `${canonicalJsonV2(plan)}\n`);

  const first = makeState({ projectSpec: fixture.bundle.projectSpec }, "project-spec", 1, null);
  const second = makeState({ projectSpec: fixture.bundle.projectSpec, productGraph: fixture.bundle.productGraph }, "product-graphs", 2, first);
  const third = makeState({ projectSpec: fixture.bundle.projectSpec, productGraph: fixture.bundle.productGraph, architectureCandidates: fixture.bundle.architectureCandidates }, "architecture-selection", 3, second);
  const fourth = makeState({ ...fixture.bundle, repositoryPlan: plan }, "repository-materialization", 4, third, plan);
  const fifth = makeState({ ...fixture.bundle, repositoryPlan: plan }, "verification", 5, fourth, plan);
  writeFile(fixture.root, ".programmable/project-states/000004-repository-materialization.v1.json", `${canonicalJsonV2(fourth)}\n`);
  writeFile(fixture.root, ".programmable/project-states/000005-verification.v1.json", `${canonicalJsonV2(fifth)}\n`);
  git(fixture.root, ["add", ".programmable"]);
  git(fixture.root, ["commit", "-qm", "forge self-consistent unsigned receipt"]);

  const report = compileProjectBundle({ ...fixture.bundle, repositoryPlan: plan, projectState: fifth, previousState: fourth }, {
    repositoryRoot: fixture.root,
    verifyRepositoryFiles: true
  });
  assert.equal(report.status, "PROJECT_COMPILATION_VALID");
  assert.equal(report.repositoryCompletion, "NOT_PROVEN");
  assert.equal(report.commandExecutionEvidence, "UNTRUSTED_DETERMINISTIC_RECEIPT_CONTENT_MATCH");
  assert.equal(report.evidenceBoundary.receiptIssuerAuthenticated, false);
  assert.equal(report.evidenceBoundary.commandsReexecuted, false);
});

test("v4 deployment proof recomputes Ethereum CREATE2, permission bits, runtime, manager, and chain bindings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-v4-preimage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const creationCode = Buffer.from("60006000", "hex");
  const constructorArgs = Buffer.alloc(0);
  const salt = Buffer.alloc(32, 0x11);
  const runtime = Buffer.from("6000", "hex");
  const deployer = "0x2222222222222222222222222222222222222222";
  const manager = "0x3333333333333333333333333333333333333333";
  const initcodeHash = keccak256Hex(Buffer.concat([creationCode, constructorArgs]));
  const create2Digest = keccak256Hex(Buffer.concat([Buffer.from([0xff]), Buffer.from(deployer.slice(2), "hex"), salt, Buffer.from(initcodeHash.slice(2), "hex")]));
  const expectedAddress = `0x${create2Digest.slice(-40)}`;
  const addressMask = Number(BigInt(expectedAddress) & 0x3fffn);
  const permissionNames = [
    "beforeInitialize", "afterInitialize", "beforeAddLiquidity", "afterAddLiquidity", "beforeRemoveLiquidity", "afterRemoveLiquidity",
    "beforeSwap", "afterSwap", "beforeDonate", "afterDonate", "beforeSwapReturnDelta", "afterSwapReturnDelta",
    "afterAddLiquidityReturnDelta", "afterRemoveLiquidityReturnDelta"
  ];
  const permissions = Object.fromEntries(permissionNames.map((name, index) => [name, (addressMask & (1 << (13 - index))) !== 0]));
  const permissionMask = canonicalV4PermissionMask(permissions);
  const preimage = { schemaVersion: "1.0.0", systemRef: "hook-system", creationCode: `0x${creationCode.toString("hex")}`, constructorArgs: "0x", salt: `0x${salt.toString("hex")}` };
  const manifest = {
    schemaVersion: "1.0.0",
    systemRef: "hook-system",
    preimageArtifactId: "hook-preimage",
    runtimeArtifactId: "hook-runtime",
    chainProfile: { id: "ethereum-fork", chainId: 1, blockNumber: 1, blockHash: `0x${"44".repeat(32)}`, poolManager: manager, evidenceRef: "evidence/chain.json" },
    create2Deployer: { address: deployer, runtimeCodeKeccak256: `0x${"55".repeat(32)}`, evidenceRef: "evidence/deployer.json" },
    hookMiner: { repository: "https://github.com/Uniswap/v4-periphery", commit: "a".repeat(40), sourceSha256: `sha256:${"66".repeat(32)}`, saltSha256: sha256(salt) },
    hashes: { creationCodeKeccak256: keccak256Hex(creationCode), constructorArgsKeccak256: keccak256Hex(constructorArgs), initcodeKeccak256: initcodeHash },
    permissions: { permissionMask, getHookPermissionsMask: permissionMask, addressLowBitsMask: permissionMask },
    addresses: { expected: expectedAddress, actual: expectedAddress },
    runtime: { byteLength: runtime.length, codeSha256: sha256(runtime), codeKeccak256: keccak256Hex(runtime) },
    proof: { expectedEqualsActual: true, permissionsMatch: true, runtimeMatches: true, poolManagerMatches: true, chainProfileMatches: true }
  };
  writeFile(root, "deploy/preimage.json", `${canonicalJsonV2(preimage)}\n`);
  writeFile(root, "deploy/manifest.json", `${canonicalJsonV2(manifest)}\n`);
  writeFile(root, "deploy/runtime.bin", runtime);
  writeFile(root, "evidence/chain.json", "{}\n");
  writeFile(root, "evidence/deployer.json", "{}\n");
  const artifacts = [
    artifactRecord("hook-preimage", "deploy/preimage.json", "v4-deployment-preimage"),
    artifactRecord("hook-manifest", "deploy/manifest.json", "v4-deployment-manifest"),
    artifactRecord("hook-runtime", "deploy/runtime.bin", "v4-runtime-code"),
    artifactRecord("chain-evidence", "evidence/chain.json", "chain-profile"),
    artifactRecord("deployer-evidence", "evidence/deployer.json", "create2-deployer-evidence")
  ];
  const inventory = { byId: new Map(artifacts.map((artifact) => [artifact.id, artifact])), byPath: new Map(artifacts.map((artifact) => [artifact.path, artifact])) };
  const hook = {
    permissions,
    profile: {
      poolManager: { address: manager },
      deployment: {
        creationCodeHash: sha256(creationCode), constructorArgsHash: sha256(constructorArgs), initcodeHash: sha256(Buffer.concat([creationCode, constructorArgs])),
        hookMinerSaltSha256: sha256(salt), expectedAddress, runtimeCodeHash: sha256(runtime), permissionMask, poolManagerAddress: manager
      }
    }
  };
  const record = { deploymentArtifactIds: ["hook-preimage", "hook-manifest", "hook-runtime"], systemRef: "hook-system" };
  assert.deepEqual(validateV4DeploymentEvidence(record, hook, inventory, root, 0), []);

  manifest.hashes.initcodeKeccak256 = `0x${"00".repeat(32)}`;
  writeFile(root, "deploy/manifest.json", `${canonicalJsonV2(manifest)}\n`);
  assert.ok(validateV4DeploymentEvidence(record, hook, inventory, root, 0).some(({ code }) => code === "V4_ETHEREUM_PREIMAGE_HASH_MISMATCH"));
});

function makeProjectSpec() {
  const verbatimText = "Alice wants a bounded service that records rewards and lets users exit safely.";
  const facets = Object.fromEntries(PROJECT_SPEC_FACETS.map((name) => [name, {
    applicability: "applicable",
    summary: `${name} is explicitly modeled for this fixture.`,
    entries: [facetEntry(`${slug(name)}-fact`, "product-fact", "confirmed", verbatimText)]
  }]));
  facets.lifecycle.entries = [
    facetEntry("lifecycle-creation", "creation", "confirmed", verbatimText),
    facetEntry("lifecycle-use", "use", "builder-assumption", verbatimText),
    facetEntry("lifecycle-claim", "claim", "builder-assumption", verbatimText),
    facetEntry("lifecycle-exit", "exit", "confirmed", verbatimText),
    facetEntry("lifecycle-decommissioning", "decommissioning", "builder-assumption", verbatimText)
  ];
  facets.parameters.entries = [
    facetEntry("parameter-mutable", "mutable-parameter", "builder-assumption", verbatimText),
    facetEntry("parameter-immutable", "immutable-parameter", "builder-assumption", verbatimText)
  ];
  facets.assumptions.entries = [
    facetEntry("assumption-confirmed", "confirmed-assumption", "confirmed", verbatimText),
    facetEntry("assumption-builder", "builder-assumption", "builder-assumption", verbatimText)
  ];
  facets.priceAndMarketMechanics = {
    applicability: "not-applicable",
    summary: "This fixture has no market or price discovery.",
    entries: [{
      ...facetEntry("market-not-applicable", "market-applicability", "builder-assumption", verbatimText),
      applicability: "not-applicable"
    }]
  };
  facets.routing = {
    applicability: "not-applicable",
    summary: "This fixture is a no-market reward service and must not manufacture a trade route.",
    entries: [{
      ...facetEntry("trade-capability-not-applicable", "trade-capability", "builder-assumption", verbatimText),
      applicability: "not-applicable"
    }]
  };
  facets.ownerDecisions = {
    applicability: "not-applicable",
    summary: "No material owner decision remains open in this fixture.",
    entries: [{
      ...facetEntry("owner-decision-none", "no-owner-decision", "builder-assumption", verbatimText),
      applicability: "not-applicable"
    }]
  };
  return {
    schemaVersion: "1.0.0",
    applicationId: "reward-service",
    revision: 1,
    intent: {
      encoding: "utf-8",
      verbatimText,
      byteLength: Buffer.byteLength(verbatimText),
      sha256: sha256(Buffer.from(verbatimText))
    },
    facets,
    extensions: []
  };
}

function facetEntry(id, kind, provenance, intent) {
  return {
    id,
    kind,
    applicability: "applicable",
    statement: `${id} is explicit.`,
    provenance,
    sourceSpans: provenance === "confirmed" ? [sourceSpan(intent)] : [],
    rationale: `${id} is required for complete product modeling.`,
    ownerQuestion: provenance === "owner-required" ? `Should ${id} be enabled?` : null,
    externalDependencyRefs: provenance === "external-unresolved" ? ["external-dependency"] : [],
    evidenceRefs: []
  };
}

function sourceSpan(intent) {
  const bytes = Buffer.from(intent);
  return { startByte: 0, endByte: bytes.length, sha256: sha256(bytes) };
}

function makeProductGraph(spec) {
  const applicableFacetRefs = Object.values(spec.facets).flatMap(({ entries }) => entries.filter(({ applicability }) => applicability !== "not-applicable").map(({ id }) => id));
  const failure = "service-unavailable";
  const recovery = "restore-service";
  const invariant = "reward-conservation";
  return {
    schemaVersion: "1.0.0",
    applicationId: spec.applicationId,
    revision: spec.revision,
    projectSpecSha256: projectArtifactSha256(spec),
    graphs: {
      system: {
        applicability: "applicable",
        justification: "The user and service form the smallest correct no-pool system.",
        nodes: [{ id: "settlement-service", label: "Reward service", type: "service", protocolRole: "none", implementationStatus: "planned", facetEntryRefs: applicableFacetRefs }],
        edges: []
      },
      state: {
        applicability: "applicable",
        justification: "Use and exit have explicit states.",
        states: [
          { id: "active-state", label: "Active", initial: true, terminal: false, entryAuthorityRefs: ["user-authority"], invariantRefs: [invariant] },
          { id: "exited-state", label: "Exited", initial: false, terminal: true, entryAuthorityRefs: ["user-authority"], invariantRefs: [invariant] }
        ],
        transitions: [{ id: "exit-transition", from: "active-state", to: "exited-state", trigger: "User requests exit.", guards: ["User is authenticated."], effects: ["Liability is settled."], authorityRefs: ["user-authority"], failureRef: failure }]
      },
      value: {
        applicability: "applicable",
        justification: "Reward liabilities and exits are explicit.",
        nodes: [
          { id: "reward-account", label: "Reward account", type: "liability", assetRefs: ["reward-unit"], custodyRef: null },
          { id: "user-account", label: "User account", type: "sink", assetRefs: ["reward-unit"], custodyRef: null }
        ],
        edges: [{ id: "reward-exit-flow", from: "reward-account", to: "user-account", assetRef: "reward-unit", amountModel: "Exact recorded reward amount.", purpose: "Exit settlement.", authorityRefs: ["user-authority"], liabilityEffect: "settles", backingRef: null, failureDestinationRef: null, conservationInvariantRef: invariant }]
      },
      authority: {
        applicability: "applicable",
        justification: "Only the user may exit their record.",
        nodes: [{ id: "user-authority", label: "Authenticated user", type: "user", mutable: false, trustAssumption: "Authentication binds the record owner." }],
        edges: [{ id: "user-controls-service", authorityRef: "user-authority", targetRef: "settlement-service", capability: "exit", scope: "Only the caller's record.", revocable: false, delayModel: "Immediate." }]
      },
      trust: {
        applicability: "applicable",
        justification: "User input crosses into the service trust zone.",
        zones: [
          { id: "user-zone", label: "User", trustModel: "Untrusted input.", memberRefs: ["user-authority"] },
          { id: "service-zone", label: "Service", trustModel: "Locally verified implementation.", memberRefs: ["settlement-service"] }
        ],
        boundaries: [{ id: "user-service-boundary", fromZone: "user-zone", toZone: "service-zone", assumption: "Input is authenticated and validated.", failureRef: failure, mitigationRefs: [invariant] }]
      },
      component: {
        applicability: "applicable",
        justification: "One service is the minimum implementation.",
        components: [{ id: "service-component", label: "Reward service component", type: "backend", disposition: "build", systemRefs: ["settlement-service"], responsibilities: ["Record rewards and settle exits."], interfaceRefs: [], authorityRefs: ["user-authority"], valueNodeRefs: ["reward-account", "user-account"], artifactRefs: ["src/app.mjs"] }],
        edges: []
      },
      deployment: {
        applicability: "applicable",
        justification: "The service has one locally verifiable deployment target.",
        targets: [{ id: "service-deployment", label: "Service target", type: "service", systemRef: "settlement-service", chainRef: null, artifactPath: "deploy/service.json", addressStatus: "not-applicable", address: null, evidenceRefs: [] }],
        edges: []
      },
      invariant: {
        applicability: "applicable",
        justification: "Reward accounting cannot create value on exit.",
        invariants: [{ id: invariant, kind: "accounting", statement: "Every exit reduces the recorded liability by exactly the delivered amount.", scopeRefs: ["service-component", "reward-account", "user-account"], testRefs: ["test/app.test.mjs"], failureRef: failure }],
        dependencies: []
      },
      failureRecovery: {
        applicability: "applicable",
        justification: "Service failure has an explicit manual recovery path.",
        failures: [{ id: failure, label: "Service unavailable", severity: "high", trigger: "The service cannot complete an exit.", affectedRefs: ["service-component", "settlement-service"], detection: "The required exit command fails.", recoveryRef: recovery }],
        recoveries: [{ id: recovery, label: "Restore service", authorityRefs: ["user-authority"], steps: ["Preserve the record and retry after service restoration."], restoresInvariantRefs: [invariant], terminalDisposition: "resume" }],
        edges: [{ id: "service-recovery-edge", failureRef: failure, recoveryRef: recovery, preconditions: ["The preserved record is intact."] }]
      }
    },
    extensions: []
  };
}

function makeArchitectures(spec, graph) {
  const dimensions = (rating) => Object.fromEntries(["trust", "capital", "liquidity", "latency", "gas", "operations", "review"].map((name) => [name, { rating, rationale: `${name} is explicitly compared.` }]));
  const noV4 = { pool: { disposition: "not-required", systemNodeRefs: [], rationale: "No pool is needed." }, customHook: { disposition: "not-required", systemNodeRefs: [], rationale: "No hook is needed." } };
  const candidate = (id, role, disposition, rating) => ({
    id,
    role,
    disposition,
    summary: `${role} candidate.`,
    justification: disposition === "modeled" ? "This is the smallest correct product architecture." : "This role was investigated and would add machinery without product value.",
    graphNodeRefs: disposition === "modeled" ? ["settlement-service", "service-component"] : [],
    facetEntryRefs: [],
    v4Usage: structuredClone(noV4),
    dimensions: dimensions(rating),
    gates: [{ id: `${id}-gate`, criterion: "Preserve intent without unnecessary custody or protocol machinery.", nonCompensable: true, result: disposition === "modeled" ? "pass" : "inapplicable", rationale: "The graph and design evidence establish the disposition.", evidenceRefs: disposition === "modeled" ? ["evidence/architecture.md"] : [] }]
  });
  return {
    schemaVersion: "1.0.0",
    applicationId: spec.applicationId,
    revision: spec.revision,
    projectSpecSha256: projectArtifactSha256(spec),
    productGraphSha256: projectArtifactSha256(graph),
    candidates: [
      candidate("minimum-correct-candidate", "minimum-correct", "modeled", "lower"),
      candidate("v4-native-candidate", "v4-native", "inapplicable", "not-applicable"),
      candidate("hybrid-candidate", "hybrid", "inapplicable", "not-applicable")
    ],
    selection: { candidateId: "minimum-correct-candidate", rationale: "The no-hook, no-pool service is the smallest architecture that preserves the product intent.", decisiveGateRefs: ["minimum-correct-candidate-gate"] }
  };
}

function makeTradablePlanningBundle(routeType, { marketRef = "primary-market", tradeFacetEntryRef = "primary-trade-capability" } = {}) {
  const projectSpec = makeProjectSpec();
  projectSpec.facets.routing = {
    applicability: "applicable",
    summary: "The selected market requires a declared executable trade route.",
    entries: [facetEntry(tradeFacetEntryRef, "trade-capability", "builder-assumption", projectSpec.intent.verbatimText)]
  };
  projectSpec.facets.priceAndMarketMechanics = {
    applicability: "applicable",
    summary: "The selected market supplies bounded price discovery.",
    entries: [facetEntry("primary-market-mechanics", "market-mechanics", "builder-assumption", projectSpec.intent.verbatimText)]
  };
  const productGraph = makeProductGraph(projectSpec);
  const standard = routeType === "standard-uniswap-v4";
  productGraph.graphs.system.nodes.push({
    id: marketRef, label: "Primary market", type: "market",
    protocolRole: standard ? "uniswap-v4-pool" : "external-protocol",
    implementationStatus: "planned", facetEntryRefs: [tradeFacetEntryRef, "primary-market-mechanics"]
  });
  const architectureCandidates = makeArchitectures(projectSpec, productGraph);
  const selected = architectureCandidates.candidates[0];
  selected.graphNodeRefs.push(marketRef);
  if (standard) selected.v4Usage.pool = { disposition: "required", systemNodeRefs: [marketRef], rationale: "The standard route executes against this selected v4 pool." };
  architectureCandidates.productGraphSha256 = projectArtifactSha256(productGraph);
  const bundle = { projectSpec, productGraph, architectureCandidates };
  const repositoryPlan = makePlanningRepositoryPlan(bundle);
  const tradeCommands = [
    { id: "primary-quote-command", kind: "quote-test", argv: [process.execPath, "tools/project-stage.mjs", "quote-primary"] },
    { id: "primary-execution-command", kind: "execution-test", argv: [process.execPath, "tools/project-stage.mjs", "execute-primary"] }
  ].map((command) => ({ ...command, cwd: ".", required: true, timeoutMs: 30000, executionPolicy: { networkAccess: "forbidden", externalWrites: false } }));
  if (standard) tradeCommands.push({ id: "fork-command", kind: "fork", argv: [process.execPath, "tools/project-stage.mjs", "fork-primary"], cwd: ".", required: true, timeoutMs: 30000, executionPolicy: { networkAccess: "forbidden", externalWrites: false } });
  repositoryPlan.commands.push(...tradeCommands);
  const planned = (id, artifactPath, kind) => ({ id, path: artifactPath, kind, systemRefs: [marketRef], required: true, status: "planned", sha256: null, byteLength: null });
  repositoryPlan.artifacts.configuration.push(planned("primary-trade-manifest", `.programmable/trade-capabilities/${marketRef}.v1.json`, "trade-capability-manifest"));
  for (const command of tradeCommands) {
    repositoryPlan.artifacts.evidence.push(planned(`${command.id}-receipt`, `.programmable/command-receipts/${command.id}.v1.json`, "command-receipt"));
    if (["quote-test", "execution-test"].includes(command.kind)) repositoryPlan.artifacts.evidence.push(planned(`${command.id}-result`, `.programmable/trade-test-results/${command.id}.v1.json`, "trade-test-result"));
  }
  repositoryPlan.tradeCapability = {
    applicability: "tradable",
    markets: [{ marketSystemRef: marketRef, routeType, manifestArtifactId: "primary-trade-manifest", quoteCommandIds: ["primary-quote-command"], executionCommandIds: ["primary-execution-command"] }]
  };
  return { ...bundle, repositoryPlan };
}

function makeArchitectureBundle() {
  const projectSpec = makeProjectSpec();
  const productGraph = makeProductGraph(projectSpec);
  const architectureCandidates = makeArchitectures(projectSpec, productGraph);
  const first = makeState({ projectSpec }, "project-spec", 1, null);
  const second = makeState({ projectSpec, productGraph }, "product-graphs", 2, first);
  const projectState = makeState({ projectSpec, productGraph, architectureCandidates }, "architecture-selection", 3, second);
  return { projectSpec, productGraph, architectureCandidates, projectState, previousState: second };
}

function makeState(bundle, phase, sequence, previousState, repositoryPlan = undefined) {
  const spec = bundle.projectSpec;
  const graph = bundle.productGraph;
  const architectures = bundle.architectureCandidates;
  const plan = repositoryPlan ?? bundle.repositoryPlan;
  const entries = Object.values(spec.facets).flatMap(({ entries: values }) => values);
  const group = (provenance) => entries.filter((entry) => entry.provenance === provenance).map(({ id }) => id);
  const binding = (value, filePath) => value ? { path: filePath, sha256: projectArtifactSha256(value) } : null;
  return sealProjectState({
    schemaVersion: "1.0.0",
    applicationId: spec.applicationId,
    sequence,
    phase,
    status: "locally-complete",
    intentSha256: spec.intent.sha256,
    artifacts: {
      projectSpec: binding(spec, ".programmable/project-spec.v1.json"),
      productGraph: binding(graph, ".programmable/product-graph.v1.json"),
      architectureCandidates: binding(architectures, ".programmable/architecture-candidates.v1.json"),
      repositoryPlan: binding(plan, ".programmable/repository-plan.v1.json")
    },
    selectedArchitectureId: architectures?.selection?.candidateId ?? null,
    provenanceRefs: { confirmed: group("confirmed"), builderAssumptions: group("builder-assumption"), ownerRequired: group("owner-required"), externalUnresolved: group("external-unresolved") },
    graphRefs: {
      invariants: (graph?.graphs?.invariant?.invariants ?? []).map(({ id }) => id),
      failures: (graph?.graphs?.failureRecovery?.failures ?? []).map(({ id }) => id),
      recoveries: (graph?.graphs?.failureRecovery?.recoveries ?? []).map(({ id }) => id)
    },
    repository: { root: ".", branch: plan?.repository?.branch ?? null, headCommit: plan?.repository?.headCommit ?? null, generatedPaths: plan ? Object.values(plan.artifacts).flat().map(({ path: artifactPath }) => artifactPath) : [] },
    commandResults: plan?.commandResults ?? [],
    blockers: [],
    next: { action: `Continue after ${phase}.`, workingDirectory: ".", resumeCommand: ["node", "scripts/project-compiler.mjs", "validate", "--repository-root", ".", "--state", `.programmable/project-states/${String(sequence).padStart(6, "0")}-${phase}.v1.json`] },
    authorization: disabledReleaseActions()
  }, { previousState });
}

function statePayload(bundle, phase, sequence) {
  const state = makeState(bundle, "architecture-selection", 3, bundle.previousState);
  const { integrity: _integrity, ...payload } = state;
  return { ...payload, phase, sequence };
}

function makePlanningRepositoryPlan(bundle) {
  const artifact = (id, artifactPath, kind) => ({ id, path: artifactPath, kind, systemRefs: ["service-component"], required: true, status: "planned", sha256: null, byteLength: null });
  const commands = ["install", "build", "typecheck", "lint", "simulation", "test", "evidence"].map((kind) => ({
    id: `${kind}-command`,
    kind,
    argv: ["node", "tools/project-stage.mjs", kind],
    cwd: ".",
    required: true,
    timeoutMs: 30000,
    executionPolicy: { networkAccess: "forbidden", externalWrites: false }
  }));
  return {
    schemaVersion: "1.0.0",
    applicationId: bundle.projectSpec.applicationId,
    revision: bundle.projectSpec.revision,
    projectSpecSha256: projectArtifactSha256(bundle.projectSpec),
    architectureCandidatesSha256: projectArtifactSha256(bundle.architectureCandidates),
    productGraphSha256: projectArtifactSha256(bundle.productGraph),
    selectedArchitectureId: bundle.architectureCandidates.selection.candidateId,
    repository: { root: ".", branch: null, headCommit: null },
    completionStatus: "planning",
    artifacts: {
      source: [
        artifact("source-artifact", "src/app.mjs", "application-source"),
        artifact("stage-tool-artifact", "tools/project-stage.mjs", "verification-source")
      ],
      configuration: [artifact("configuration-artifact", ".gitignore", "repository-configuration")],
      dependencyLocks: [artifact("dependency-lock-artifact", "package-lock.json", "dependency-lock")],
      tests: [artifact("test-artifact", "test/app.test.mjs", "unit-test")],
      deploymentInputs: [artifact("deployment-artifact", "deploy/service.json", "service-deployment-input")],
      evidence: [
        artifact("evidence-artifact", "evidence/architecture.md", "architecture-evidence"),
        ...commands.map(({ id }) => artifact(`${id}-receipt`, `.programmable/command-receipts/${id}.v1.json`, "command-receipt"))
      ],
      documentation: [artifact("documentation-artifact", "README.md", "readme")]
    },
    tradeCapability: { applicability: "no-market", markets: [] },
    v4HookSemanticContracts: [],
    commands,
    commandResults: [],
    completionClaim: { scope: "local-repository-evidence-only", approvalCreated: false, auditClaimed: false, productionClaimed: false, externalActionsPerformed: [] },
    authorization: disabledReleaseActions()
  };
}

function createMaterializedTradableRepository(t, {
  marketRef = "primary-market",
  tradeFacetEntryRef = "primary-trade-capability",
  manifestTemplate = null,
  feeReceiptBytes = null,
  preserveFeeBinding = false
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-trade-executor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = makeTradablePlanningBundle("standard-uniswap-v4", { marketRef, tradeFacetEntryRef });
  const plan = bundle.repositoryPlan;
  const placeholderCommands = new Set(["primary-quote-command", "primary-execution-command"]);
  plan.commands = plan.commands.filter(({ id }) => !placeholderCommands.has(id));
  plan.artifacts.configuration = plan.artifacts.configuration.filter(({ kind }) => kind !== "trade-capability-manifest");
  plan.artifacts.evidence = plan.artifacts.evidence.filter(({ id }) => ![...placeholderCommands].some((commandId) => id === `${commandId}-receipt` || id === `${commandId}-result`));

  const manifest = manifestTemplate === null
    ? createStandardTradeCapabilityManifestFixtureV1({ applicationId: bundle.projectSpec.applicationId, marketRef })
    : structuredClone(manifestTemplate);
  if (manifestTemplate === null) manifest.manifestId = "primary-trade-manifest";
  const declarations = [...manifest.testEvidence.quoteTests, ...manifest.testEvidence.executionTests];
  const testFunctions = declarations.map((declaration) => {
    const functionName = declaration.runnerTestSignature.slice(0, -2);
    const fixturePath = `fixtures/trade/${declaration.commandId}.v1.json`;
    if (declaration.resultContract === "trade-quote-test-result-v1") return `  function ${functionName}() external { _quote("${fixturePath}"); }`;
    if (declaration.expectedOutcome === "swap-succeeds") return `  function ${functionName}() external { _execute("${fixturePath}"); }`;
    return `  function ${functionName}() external { _reject("${fixturePath}", hex"${tradeTestRevertDataFixtureV1(declaration.scenario).slice(2)}"); }`;
  }).join("\n");
  const testSource = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\ninterface Vm {\n  function readFile(string calldata path) external view returns (string memory);\n  function etch(address target, bytes calldata code) external;\n  function mockCallRevert(address callee, bytes calldata data, bytes calldata revertData) external;\n}\n\ncontract TraceTarget {\n  fallback() external { assembly { mstore(0, shl(224, ${TRADE_TEST_QUOTE_RETURN_DATA_FIXTURE_V1})) return(0, 4) } }\n}\n\ncontract TradeCapabilityRouteTest {\n  bool public constant IS_TEST = true;\n  event log_string(string value);\n  Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));\n  address private constant ROUTER = ${manifest.route.router.address};\n  address private constant QUOTER = ${manifest.route.quoter.address};\n  bytes4 private constant QUOTE_CALLDATA = ${TRADE_TEST_QUOTE_CALLDATA_FIXTURE_V1};\n  bytes4 private constant EXECUTION_CALLDATA = ${TRADE_TEST_EXECUTION_CALLDATA_FIXTURE_V1};\n\n  function setUp() external {\n    TraceTarget implementation = new TraceTarget();\n    vm.etch(ROUTER, address(implementation).code);\n    vm.etch(QUOTER, address(implementation).code);\n  }\n\n  function _emit(string memory fixturePath) private {\n    emit log_string(string.concat("PROGRAMMABLE_TRADE_RESULT_V1:", vm.readFile(fixturePath)));\n  }\n\n  function _quote(string memory fixturePath) private {\n    (bool ok, bytes memory output) = QUOTER.call(abi.encodePacked(QUOTE_CALLDATA));\n    require(ok && keccak256(output) == keccak256(hex"${TRADE_TEST_QUOTE_RETURN_DATA_FIXTURE_V1.slice(2)}"), "quote trace mismatch");\n    _emit(fixturePath);\n  }\n\n  function _execute(string memory fixturePath) private {\n    (bool ok,) = ROUTER.call(abi.encodePacked(EXECUTION_CALLDATA));\n    require(ok, "execution trace mismatch");\n    _emit(fixturePath);\n  }\n\n  function _reject(string memory fixturePath, bytes memory expectedRevertData) private {\n    bytes memory callData = abi.encodePacked(EXECUTION_CALLDATA);\n    vm.mockCallRevert(ROUTER, callData, expectedRevertData);\n    (bool ok, bytes memory output) = ROUTER.call(callData);\n    require(!ok && keccak256(output) == keccak256(expectedRevertData), "revert trace mismatch");\n    _emit(fixturePath);\n  }\n\n${testFunctions}\n}\n`;
  const stageTool = `import fs from "node:fs";\nconst stage = process.argv[2];\nconst targets = { install: "package-lock.json", build: "src/app.mjs", typecheck: "src/app.mjs", lint: ".gitignore", simulation: "deploy/service.json", test: "test/app.test.mjs", evidence: "evidence/architecture.md", "fork-primary": "src/TradeCapabilityRoute.sol" };\nconst target = targets[stage];\nif (!target) throw new Error("unknown stage");\nconst bytes = fs.readFileSync(target);\nif (bytes.length === 0) throw new Error("empty stage target");\nprocess.stdout.write(stage + ":" + target + ":" + bytes.length + "\\n");\n`;
  const defaultFeeReceiptPath = "evidence/fee-conformance-main-market.receipt.v1.json";
  const preservedFeeReceiptPath = manifest.feeBehavior.programmableFeeV2.receiptPath;
  const selectedFeeReceiptPath = preserveFeeBinding ? preservedFeeReceiptPath : defaultFeeReceiptPath;
  const files = new Map([
    ["src/app.mjs", "export const rewardService = true;\n"],
    ["src/TradeCapabilityRoute.sol", "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ncontract TradeCapabilityRoute { function route(bytes calldata) external pure returns (bytes memory) { return hex\"01\"; } }\n"],
    ["tools/project-stage.mjs", stageTool],
    [".gitignore", "cache/\nnode_modules/\nout/\nsubmission/\n.programmable/repository-plan.materializing.v1.json\n"],
    ["foundry.toml", "[profile.default]\nsrc = \"src\"\ntest = \"test\"\nout = \"out\"\nlibs = []\nfs_permissions = [{ access = \"read\", path = \"./fixtures\" }]\n"],
    ["package-lock.json", "{\"lockfileVersion\":3}\n"],
    ["test/app.test.mjs", "import assert from 'node:assert/strict';\nimport { rewardService } from '../src/app.mjs';\nassert.equal(rewardService, true);\n"],
    ["test/TradeCapabilityRoute.t.sol", testSource],
    ["deploy/service.json", "{\"service\":\"local\"}\n"],
    ["evidence/architecture.md", "# Architecture evidence\n\nThe selected market has a bounded local v4 route.\n"],
    ["evidence/trade/route-implementation-closure.v1.json", "{\"paths\":[\"package-lock.json\",\"src/TradeCapabilityRoute.sol\",\"test/TradeCapabilityRoute.t.sol\"]}\n"],
    ["evidence/deployments/universal-router.json", "{\"deployment\":\"local-universal-router-fixture\"}\n"],
    ["evidence/deployments/v4-quoter.json", "{\"deployment\":\"local-v4-quoter-fixture\"}\n"],
    ["evidence/deployments/permit2.json", "{\"deployment\":\"local-permit2-fixture\"}\n"],
    [selectedFeeReceiptPath, feeReceiptBytes ?? "{\"status\":\"local-fixture-not-approval\"}\n"],
    ["README.md", "# Tradable reward service\n"]
  ]);
  for (const [relativePath, contents] of files) writeFile(root, relativePath, contents);

  const fileBinding = (relativePath) => {
    const bytes = fs.readFileSync(path.join(root, relativePath));
    return { path: relativePath, sha256: sha256(bytes), byteLength: bytes.length };
  };
  Object.assign(manifest.source, {
    repositoryUri: "https://github.com/example/tradable-reward-service",
    routeImplementationSha256: fileBinding(manifest.source.routeImplementationPath).sha256,
    routeImplementationClosureSha256: fileBinding(manifest.source.routeImplementationClosurePath).sha256
  });
  manifest.dependencies.lockfilePath = "package-lock.json";
  manifest.dependencies.lockfileSha256 = fileBinding("package-lock.json").sha256;
  const feeBinding = fileBinding(selectedFeeReceiptPath);
  if (!preserveFeeBinding) Object.assign(manifest.feeBehavior.programmableFeeV2, { receiptArtifactId: "fee-conformance-main-market", receiptPath: feeBinding.path, receiptSha256: feeBinding.sha256 });
  const sourceBinding = fileBinding("test/TradeCapabilityRoute.t.sol");
  const tradeCommands = [];
  for (const [tests, kind] of [[manifest.testEvidence.quoteTests, "quote-test"], [manifest.testEvidence.executionTests, "execution-test"]]) {
    for (const declaration of tests) {
      const command = {
        id: declaration.commandId,
        kind,
        argv: [...declaration.command.argv],
        cwd: ".",
        required: true,
        timeoutMs: 30000,
        executionPolicy: { networkAccess: "forbidden", externalWrites: false }
      };
      declaration.command = { argv: [...command.argv], workingDirectory: command.cwd, environmentSha256: projectCommandEnvironmentSha256(command) };
      declaration.testSourceArtifact = { ...sourceBinding };
      declaration.resultArtifactPath = `.programmable/trade-test-results/${command.id}.v1.json`;
      tradeCommands.push(command);
    }
  }
  const results = createTradeTestResultFixturesV1(manifest);
  for (const declaration of declarations) writeFile(root, `fixtures/trade/${declaration.commandId}.v1.json`, `${canonicalJsonV2(results.get(declaration.resultArtifactPath))}\n`);
  writeFile(root, `.programmable/trade-capabilities/${marketRef}.v1.json`, `${canonicalJsonV2(manifest)}\n`);

  const planned = (id, artifactPath, kind, systemRefs = [marketRef]) => ({ id, path: artifactPath, kind, systemRefs, required: true, status: "planned", sha256: null, byteLength: null });
  plan.artifacts.source.push(planned("trade-route-source", manifest.source.routeImplementationPath, "trade-route-source"));
  plan.artifacts.configuration.push(planned("foundry-configuration", "foundry.toml", "repository-configuration"));
  plan.artifacts.configuration.push(planned(manifest.manifestId, `.programmable/trade-capabilities/${marketRef}.v1.json`, "trade-capability-manifest"));
  plan.artifacts.tests.push(planned("trade-route-test-source", sourceBinding.path, "trade-route-test"));
  plan.artifacts.tests.push(...declarations.map(({ commandId }) => planned(`${commandId}-fixture`, `fixtures/trade/${commandId}.v1.json`, "trade-result-fixture")));
  plan.artifacts.deploymentInputs.push(
    planned("universal-router-deployment", manifest.route.router.deploymentEvidenceRef, "route-deployment-evidence"),
    planned("v4-quoter-deployment", manifest.route.quoter.deploymentEvidenceRef, "route-deployment-evidence"),
    planned("permit2-deployment", manifest.route.fundingProfiles.find(({ permit2 }) => permit2.mode === "used").permit2.deploymentEvidenceRef, "route-deployment-evidence")
  );
  plan.artifacts.evidence.push(
    planned("trade-route-closure", manifest.source.routeImplementationClosurePath, "trade-route-source-closure"),
    planned(preserveFeeBinding ? manifest.feeBehavior.programmableFeeV2.receiptArtifactId : "fee-conformance-main-market", feeBinding.path, "fee-conformance-receipt")
  );
  plan.commands.push(...tradeCommands);
  for (const command of tradeCommands) {
    plan.artifacts.evidence.push(planned(`${command.id}-receipt`, `.programmable/command-receipts/${command.id}.v1.json`, "command-receipt"));
    plan.artifacts.evidence.push(planned(`${command.id}-result`, `.programmable/trade-test-results/${command.id}.v1.json`, "trade-test-result"));
  }
  plan.tradeCapability.markets[0] = {
    marketSystemRef: marketRef,
    routeType: manifest.route.type,
    manifestArtifactId: manifest.manifestId,
    quoteCommandIds: manifest.testEvidence.quoteTests.map(({ commandId }) => commandId),
    executionCommandIds: manifest.testEvidence.executionTests.map(({ commandId }) => commandId)
  };
  for (const group of Object.keys(plan.artifacts)) plan.artifacts[group] = plan.artifacts[group].map((artifact) => {
    if (["command-receipt", "trade-test-result"].includes(artifact.kind)) return artifact;
    const binding = fileBinding(artifact.path);
    return { ...artifact, status: "verified", sha256: binding.sha256, byteLength: binding.byteLength };
  });
  plan.completionStatus = "materializing";

  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Trade Executor Test"]);
  git(root, ["config", "user.email", "trade-executor@example.invalid"]);
  git(root, ["add", "."]);
  if (preserveFeeBinding && selectedFeeReceiptPath.startsWith("submission/")) git(root, ["add", "-f", "--", selectedFeeReceiptPath]);
  git(root, ["commit", "-qm", "tradable source fixture"]);
  plan.repository.branch = git(root, ["branch", "--show-current"]);
  plan.repository.headCommit = git(root, ["rev-parse", "HEAD"]);
  return { root, bundle, plan, manifest };
}

async function createCompleteRepository(t, options = {}) {
  const ready = createMaterializedRepository(t, options);
  const execution = await executeProjectCommands({
    repositoryRoot: ready.root,
    repositoryPlan: ready.plan,
    outputPlanPath: ".programmable/repository-plan.v1.json"
  });
  assert.equal(execution.status, "PROJECT_COMMAND_EVIDENCE_READY_TO_COMMIT");
  const plan = execution.repositoryPlan;
  const first = makeState({ projectSpec: ready.bundle.projectSpec }, "project-spec", 1, null);
  const second = makeState({ projectSpec: ready.bundle.projectSpec, productGraph: ready.bundle.productGraph }, "product-graphs", 2, first);
  const third = makeState({ projectSpec: ready.bundle.projectSpec, productGraph: ready.bundle.productGraph, architectureCandidates: ready.bundle.architectureCandidates }, "architecture-selection", 3, second);
  const fourth = makeState({ ...ready.bundle, repositoryPlan: plan }, "repository-materialization", 4, third, plan);
  const fifth = makeState({ ...ready.bundle, repositoryPlan: plan }, "verification", 5, fourth, plan);
  const jsonFiles = new Map([
    [".programmable/project-spec.v1.json", ready.bundle.projectSpec],
    [".programmable/product-graph.v1.json", ready.bundle.productGraph],
    [".programmable/architecture-candidates.v1.json", ready.bundle.architectureCandidates],
    [".programmable/project-states/000004-repository-materialization.v1.json", fourth],
    [".programmable/project-states/000005-verification.v1.json", fifth]
  ]);
  for (const [relativePath, value] of jsonFiles) writeFile(ready.root, relativePath, `${canonicalJsonV2(value)}\n`);
  git(ready.root, ["add", ".programmable"]);
  git(ready.root, ["commit", "-qm", "record deterministic execution evidence"]);
  return {
    root: ready.root,
    statePath: ".programmable/project-states/000005-verification.v1.json",
    previousStatePath: ".programmable/project-states/000004-repository-materialization.v1.json",
    bundle: { ...ready.bundle, repositoryPlan: plan, projectState: fifth, previousState: fourth }
  };
}

function createMaterializedRepository(t, { extraFiles = [], mutatePlan = null, setup = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-compiler-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = makeArchitectureBundle();
  const plan = makePlanningRepositoryPlan(bundle);
  const fileContents = new Map([
    ["src/app.mjs", "export const rewardService = true;\n"],
    ["tools/project-stage.mjs", `import fs from "node:fs";\nconst stage = process.argv[2];\nconst targets = { install: "package-lock.json", build: "src/app.mjs", typecheck: "src/app.mjs", lint: ".gitignore", simulation: "deploy/service.json", test: "test/app.test.mjs", evidence: "evidence/architecture.md" };\nconst target = targets[stage];\nif (!target) throw new Error("unknown stage");\nconst bytes = fs.readFileSync(target);\nif (bytes.length === 0) throw new Error("empty stage target");\nprocess.stdout.write(stage + ":" + target + ":" + bytes.length + "\\n");\n`],
    [".gitignore", "node_modules/\n.programmable/repository-plan.materializing.v1.json\n"],
    ["package-lock.json", "{\"lockfileVersion\":3}\n"],
    ["test/app.test.mjs", "import assert from 'node:assert/strict';\nimport { rewardService } from '../src/app.mjs';\nassert.equal(rewardService, true);\n"],
    ["deploy/service.json", "{\"service\":\"local\"}\n"],
    ["evidence/architecture.md", "# Architecture evidence\n\nNo hook and no pool are required.\n"],
    ["README.md", "# Reward service\n"],
    ...extraFiles
  ]);
  for (const [relativePath, contents] of fileContents) writeFile(root, relativePath, contents);
  const materialize = (artifact) => {
    if (artifact.kind === "command-receipt") return artifact;
    const bytes = fs.readFileSync(path.join(root, artifact.path));
    return { ...artifact, status: "verified", sha256: sha256(bytes), byteLength: bytes.length };
  };
  for (const group of Object.keys(plan.artifacts)) plan.artifacts[group] = plan.artifacts[group].map(materialize);
  plan.completionStatus = "materializing";

  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Project Compiler Test"]);
  git(root, ["config", "user.email", "project-compiler@example.invalid"]);
  if (setup) setup(root, plan);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  plan.repository.branch = git(root, ["branch", "--show-current"]);
  plan.repository.headCommit = git(root, ["rev-parse", "HEAD"]);
  if (mutatePlan) mutatePlan(plan);
  return { root, bundle, plan };
}

function createUnresolvedOutputFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-output-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectSpec = makeProjectSpec();
  projectSpec.facets.routing.applicability = "unresolved";
  projectSpec.facets.routing.entries[0].id = "routing-trade-capability";
  projectSpec.facets.routing.entries[0].applicability = "unresolved";
  const productGraph = makeProductGraph(projectSpec);
  const architectureCandidates = makeArchitectures(projectSpec, productGraph);
  const repositoryPlan = makePlanningRepositoryPlan({ projectSpec, productGraph, architectureCandidates });
  repositoryPlan.tradeCapability.applicability = "unresolved";
  const first = makeState({ projectSpec }, "project-spec", 1, null);
  const second = makeState({ projectSpec, productGraph }, "product-graphs", 2, first);
  const third = makeState({ projectSpec, productGraph, architectureCandidates }, "architecture-selection", 3, second);
  const materializationState = makeState({ projectSpec, productGraph, architectureCandidates, repositoryPlan }, "repository-materialization", 4, third, repositoryPlan);
  const { integrity: _integrity, ...stateWithoutIntegrity } = materializationState;
  const projectState = sealProjectState({ ...stateWithoutIntegrity, status: "in-progress" }, { previousState: third });
  const projectFiles = new Map([
    [".programmable/project-spec.v1.json", projectSpec],
    [".programmable/product-graph.v1.json", productGraph],
    [".programmable/architecture-candidates.v1.json", architectureCandidates],
    [".programmable/repository-plan.v1.json", repositoryPlan],
    [".programmable/project-states/000003-architecture-selection.v1.json", third],
    [".programmable/project-states/000004-repository-materialization.v1.json", projectState]
  ]);
  for (const [relativePath, value] of projectFiles) writeFile(root, relativePath, `${canonicalJsonV2(value)}\n`);
  const draft = createOpenWorldDraftPackage({
    applicationId: projectSpec.applicationId,
    publicIdeaText: "Build a reward service; whether it needs a trade market remains unresolved.",
    sourceRef: "blind-natural-idea"
  });
  assert.equal(draft.materializationAllowed, true);
  for (const file of draft.files) writeFile(root, `submission/${file.path}`, file.content);
  return {
    root,
    input: {
      repositoryRoot: root,
      submissionRoot: path.join(root, "submission"),
      projectSpec,
      productGraph,
      architectureCandidates,
      repositoryPlan,
      projectState,
      previousState: third
    }
  };
}

async function createTradableOutputFixture(t) {
  const applicationId = "reward-service";
  const prototype = createApplicableOpenWorldV2PrototypeFixture(applicationId);
  const submission = structuredClone(prototype.submission);
  const declaration = submission.tradeCapability.markets[0];
  const originalManifest = JSON.parse(prototype.files.get(declaration.manifest.path).toString("utf8"));
  const originalResultPaths = [
    ...originalManifest.testEvidence.quoteTests,
    ...originalManifest.testEvidence.executionTests
  ].map(({ resultArtifactPath }) => resultArtifactPath);
  const feeReceiptPath = submission.programmableFee.conformance.scopeArtifacts[0].receipt.path;
  const project = createMaterializedTradableRepository(t, {
    marketRef: declaration.marketRef,
    tradeFacetEntryRef: declaration.facetEntryRef ?? submission.tradeCapability.facetEntryRef,
    manifestTemplate: originalManifest,
    feeReceiptBytes: prototype.files.get(feeReceiptPath),
    preserveFeeBinding: true
  });
  const execution = await executeProjectCommands({
    repositoryRoot: project.root,
    repositoryPlan: project.plan,
    outputPlanPath: ".programmable/repository-plan.v1.json"
  });
  assert.equal(execution.status, "PROJECT_COMMAND_EVIDENCE_READY_TO_COMMIT");
  const repositoryPlan = execution.repositoryPlan;
  const first = makeState({ projectSpec: project.bundle.projectSpec }, "project-spec", 1, null);
  const second = makeState({ projectSpec: project.bundle.projectSpec, productGraph: project.bundle.productGraph }, "product-graphs", 2, first);
  const third = makeState({ projectSpec: project.bundle.projectSpec, productGraph: project.bundle.productGraph, architectureCandidates: project.bundle.architectureCandidates }, "architecture-selection", 3, second);
  const fourth = makeState({ ...project.bundle, repositoryPlan }, "repository-materialization", 4, third, repositoryPlan);
  const projectState = makeState({ ...project.bundle, repositoryPlan }, "verification", 5, fourth, repositoryPlan);
  const projectFiles = new Map([
    [".programmable/project-spec.v1.json", project.bundle.projectSpec],
    [".programmable/product-graph.v1.json", project.bundle.productGraph],
    [".programmable/architecture-candidates.v1.json", project.bundle.architectureCandidates],
    [".programmable/project-states/000004-repository-materialization.v1.json", fourth],
    [".programmable/project-states/000005-verification.v1.json", projectState]
  ]);
  for (const [relativePath, value] of projectFiles) writeFile(project.root, relativePath, `${canonicalJsonV2(value)}\n`);
  git(project.root, ["add", ".programmable"]);
  git(project.root, ["commit", "-qm", "record tradable project output evidence"]);

  const submissionRoot = path.join(project.root, "submission");
  const packageFiles = new Map([...prototype.files].map(([relativePath, bytes]) => [relativePath, Buffer.from(bytes)]));
  for (const resultPath of originalResultPaths) packageFiles.delete(resultPath);
  const manifestBytes = Buffer.from(`${canonicalJsonV2(project.manifest)}\n`, "utf8");
  packageFiles.set(declaration.manifest.path, manifestBytes);
  declaration.manifest.sha256 = sha256(manifestBytes);
  declaration.manifest.byteLength = manifestBytes.length;
  for (const testDeclaration of [...project.manifest.testEvidence.quoteTests, ...project.manifest.testEvidence.executionTests]) {
    packageFiles.set(testDeclaration.resultArtifactPath, fs.readFileSync(path.join(project.root, testDeclaration.resultArtifactPath)));
  }
  const fidelityBinding = submission.intentPackage.intentFidelity;
  const fidelity = JSON.parse(packageFiles.get(fidelityBinding.path).toString("utf8"));
  fidelity.inputDigests.architectureSnapshotSha256 = architectureSnapshotSha256(submission);
  const fidelityBytes = Buffer.from(`${canonicalJsonV2(fidelity)}\n`, "utf8");
  packageFiles.set(fidelityBinding.path, fidelityBytes);
  fidelityBinding.sha256 = sha256(fidelityBytes);
  fidelityBinding.byteLength = fidelityBytes.length;
  packageFiles.set("submission.v2.json", Buffer.from(`${canonicalJsonV2(submission)}\n`, "utf8"));
  for (const [relativePath, bytes] of packageFiles) writeFile(submissionRoot, relativePath, bytes);
  return {
    input: {
      repositoryRoot: project.root,
      submissionRoot,
      projectSpec: project.bundle.projectSpec,
      productGraph: project.bundle.productGraph,
      architectureCandidates: project.bundle.architectureCandidates,
      repositoryPlan,
      projectState,
      previousState: fourth
    }
  };
}

function structuredCloneProjectOutputInput(input) {
  return {
    repositoryRoot: input.repositoryRoot,
    submissionRoot: input.submissionRoot,
    projectSpec: structuredClone(input.projectSpec),
    productGraph: structuredClone(input.productGraph),
    architectureCandidates: structuredClone(input.architectureCandidates),
    repositoryPlan: structuredClone(input.repositoryPlan),
    projectState: structuredClone(input.projectState),
    previousState: structuredClone(input.previousState)
  };
}

const deterministicTarget = "0x1111111111111111111111111111111111111111";
const deterministicCallData = "0xaabb";
const deterministicReturnData = "0xcc";
const deterministicSuite = "test/Route.t.sol:RouteTest";
const deterministicResult = Object.freeze({
  contract: "trade-quote-test-result-v1", status: "LOCAL_EVIDENCE_NOT_APPROVAL", value: "17",
  context: Object.freeze({ route: Object.freeze({ type: "standard-uniswap-v4" }) }),
  observation: Object.freeze({
    callBinding: Object.freeze({ target: deterministicTarget }),
    callDataSha256: sha256Bytes(Buffer.from(deterministicCallData.slice(2), "hex")),
    returnDataSha256: sha256Bytes(Buffer.from(deterministicReturnData.slice(2), "hex"))
  })
});
const deterministicResultLog = `PROGRAMMABLE_TRADE_RESULT_V1:${canonicalJsonV2(deterministicResult)}`;
const deterministicCommand = Object.freeze({
  id: "quote-primary", kind: "quote-test",
  argv: ["forge", "test", "--offline", "--json", "-vvvv", "--match-path", "test/Route.t.sol", "--match-test", "^testQuote\\(\\)$"],
  cwd: ".", required: true, timeoutMs: 30000,
  executionPolicy: Object.freeze({ networkAccess: "forbidden", externalWrites: false })
});
const deterministicPlan = Object.freeze({
  schemaVersion: "1.0.0", applicationId: "receipt-determinism", revision: 1,
  completionStatus: "materializing", commands: [deterministicCommand], commandResults: [], artifacts: {},
  repository: Object.freeze({ branch: "main", headCommit: "1".repeat(40) }), authorization: Object.freeze({ approvalCreated: false })
});
const deterministicSource = Object.freeze({ headCommit: "1".repeat(40), tree: "2".repeat(40), branch: "main", gitStatusSha256: sha256Bytes(Buffer.alloc(0)) });
const deterministicTool = Object.freeze({ requested: "forge", resolvedPath: "/usr/local/bin/forge", byteLength: 1, sha256: `sha256:${"3".repeat(64)}` });
const commandReceiptSchema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references/command-receipt-v1.schema.json"), "utf8"));

function deterministicTradeReceipt(stdout, parserBoundStdout = stdout) {
  const bytes = Buffer.from(parserBoundStdout, "utf8");
  const runnerEvidence = {
    contract: "forge-test-json-v1", matchPath: "test/Route.t.sol", testSignature: "testQuote()",
    sourcePath: "test/Route.t.sol", sourceArtifactSha256: `sha256:${"4".repeat(64)}`, sourceArtifactByteLength: 1,
    suitesObserved: 1, testsObserved: 1, passedTests: 1, failedTests: 0, resultLogsObserved: 1, unitGas: 123,
    callEvidence: [{ role: "quote-target", target: deterministicTarget, callKind: "CALL", calldataSha256: sha256Bytes(Buffer.from(deterministicCallData.slice(2), "hex")), outcome: "succeeded", outputSha256: sha256Bytes(Buffer.from(deterministicReturnData.slice(2), "hex")), occurrences: 1 }],
    runnerOutputSha256: sha256Bytes(bytes), runnerOutputByteLength: bytes.length
  };
  const domainEvidence = {
    contract: "trade-command-domain-evidence-v1", manifestArtifactId: "primary-market", manifestSha256: `sha256:${"5".repeat(64)}`,
    marketRef: "primary-market", testId: "quote-primary", modeRef: "zero-for-one-exact-input", semanticAdequacy: "PARTIAL_EVIDENCE",
    runnerEvidence, resultContract: "trade-quote-test-result-v1", resultArtifactId: "quote-primary-result",
    resultArtifactPath: ".programmable/trade-test-results/quote-primary.v1.json", resultArtifactSha256: `sha256:${"6".repeat(64)}`, resultArtifactByteLength: 1
  };
  return createProjectCommandReceipt({
    repositoryPlan: deterministicPlan, command: deterministicCommand, source: deterministicSource, tool: deterministicTool,
    executionResult: { stdout, stderr: "" }, maximumOutputBytes: PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES,
    domainEvidence, tradeExecution: Object.freeze({ result: deterministicResult, runnerEvidence: Object.freeze(runnerEvidence) })
  });
}

function deterministicForgeOutput({ suiteName = deterministicSuite, suiteDuration = "1ms", testDuration = "2ms", warning = "none", unrelatedFirst = true, reverseKeys = false, mutate = null } = {}) {
  const relevant = { trace: { address: deterministicTarget, kind: "CALL", data: deterministicCallData, success: true, status: "Return", output: deterministicReturnData } };
  const unrelated = { trace: { address: "0x2222222222222222222222222222222222222222", kind: "STATICCALL", data: "0x", success: true, status: "Return", output: "0x" } };
  const observed = { duration: testDuration, status: "Success", reason: null, decoded_logs: [deterministicResultLog], kind: { Unit: { gas: 123 } }, traces: [["Execution", { arena: unrelatedFirst ? [unrelated, relevant] : [relevant, unrelated] }]] };
  const suite = reverseKeys ? { warnings: [warning], test_results: { "testQuote()": observed }, duration: suiteDuration } : { duration: suiteDuration, test_results: { "testQuote()": observed }, warnings: [warning] };
  const output = { [suiteName]: suite };
  if (mutate) mutate(output);
  return `${JSON.stringify(output)}\n`;
}

function deterministicRelevantTrace(output) {
  return output[deterministicSuite].test_results["testQuote()"].traces[0][1].arena.find(({ trace }) => trace.address === deterministicTarget).trace;
}

function disabledReleaseActions() {
  return { approval: false, signature: false, deployment: false, publication: false, execution: false, registryWrite: false };
}

function writeFile(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function artifactRecord(id, artifactPath, kind) {
  return { id, path: artifactPath, kind, status: "verified" };
}

function git(root, args) {
  const result = childProcess.spawnSync("git", ["-C", root, ...args], { encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function slug(value) {
  return value.replaceAll(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
