import fs from "node:fs";
import childProcess from "node:child_process";
import path from "node:path";
import process from "node:process";
import {canonicalJsonV2} from "./canonical-json-core.mjs";
import {chunkValues,composeTemplate} from "./template-catalog-composition.mjs";
import {renderTemplateFiles} from "./template-catalog-renderer.mjs";
import {MAX_DIRECT_TEMPLATE_ITEMS,assertRelativePath,assertSafeText,compareUtf8,fail,sha256} from "./template-catalog-shared.mjs";
import {parseBoundedStrictJsonBytes} from "./strict-json-core.mjs";
const s256=(bytes)=>`sha256:${sha256(bytes)}`;
const F={maxSourceBytes:2**27,maxNodes:5e6};

export function materializeTemplate({catalog,starterId,packIds=[],capabilityIds=[],customCapabilities=[],localTags=[],targetDirectory}){
  const plan = composeTemplate({ catalog, starterId, packIds, capabilityIds, customCapabilities, localTags });
  enforceMaterializationWindow(plan);
  const target = validateNewTarget(targetDirectory);
  const files = renderTemplateFiles(plan, { catalog });
  const parent = path.dirname(target);
  const temporary = fs.mkdtempSync(path.join(parent, ".programmable-template-"));
  fs.chmodSync(temporary, 0o700);

  let renamed = false;
  try {
    assertCanonicalMaterializationParent(parent, temporary);
    for (const [relativePath, contents] of files) {
      assertRelativePath(relativePath, "materialized template path");
      const outputPath = path.resolve(temporary, relativePath);
      if (!outputPath.startsWith(`${temporary}${path.sep}`)) {
        fail("CATALOG_PATH_INVALID", `Materialized template path escapes its target: ${relativePath}.`);
      }
      fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(outputPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
    assertCanonicalMaterializationParent(parent, temporary);
    fs.renameSync(temporary, target);
    renamed = true;
  } finally {
    if (!renamed && fs.existsSync(temporary)) {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  return {
    schemaVersion: "1.0.0",
    kind: "template-materialization",
    targetDirectory: target,
    catalogDigest: plan.catalogDigest,
    selectionDigest: plan.selectionDigest,
    starterId: plan.selection.starterId,
    selectedPackIds: plan.selection.selectedPackIds,
    capabilityIds: plan.selection.requestedCapabilityIds,
    customCapabilityIds: plan.customCapabilities.map(({ id }) => id),
    localTags: plan.tagSuggestions.ownerProvidedLocalTags,
    files: files.map(([relativePath, contents]) => ({
      path: relativePath,
      bytes: Buffer.byteLength(contents, "utf8"),
      sha256: sha256(Buffer.from(contents, "utf8"))
    }))
  };
}

export function enforceMaterializationWindow(plan) {
  const customCapabilities = plan.customCapabilities.map((capability) => ({
    id: capability.id,
    label: capability.label,
    catalogStatus: capability.catalogStatus,
    automaticDecision: capability.automaticDecision,
    reviewRoute: capability.reviewRoute,
    eligibilityEffect: capability.eligibilityEffect
  }));
  const capabilityIds = [...new Set([
    ...plan.machineCapabilities.knownCapabilityIds,
    ...customCapabilities.map(({ id }) => id)
  ])].sort(compareUtf8);
  const localProjectTags = [...new Set([
    plan.selection.starterId,
    ...plan.selection.selectedPackIds,
    ...plan.machineCapabilities.knownCapabilityIds,
    ...customCapabilities.map(({ id }) => id),
    ...plan.tagSuggestions.ownerProvidedLocalTags
  ])].sort(compareUtf8);
  if (
    plan.machineCapabilities.knownCapabilityIds.length <= MAX_DIRECT_TEMPLATE_ITEMS
    && customCapabilities.length <= MAX_DIRECT_TEMPLATE_ITEMS
    && localProjectTags.length <= MAX_DIRECT_TEMPLATE_ITEMS
  ) return;

  fail(
    "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED",
    "Builder template materialized provenance exceeds the direct review window and requires a split review plan.",
    {
      status: "HOLD_SPLIT_REVIEW",
      ideaEligibility: "ELIGIBLE_FOR_REVIEW",
      designEligible: true,
      automaticAdverseDecision: false,
      automaticMaterialization: false,
      classification: "tooling-split-review",
      maximumItemsPerChunk: MAX_DIRECT_TEMPLATE_ITEMS,
      capabilityCount: capabilityIds.length,
      capabilityChunks: chunkValues(capabilityIds, MAX_DIRECT_TEMPLATE_ITEMS),
      requestedCapabilityCount: plan.selection.requestedCapabilityIds.length,
      requestedCapabilityChunks: chunkValues(
        plan.selection.requestedCapabilityIds,
        MAX_DIRECT_TEMPLATE_ITEMS
      ),
      ...(plan.directCapabilityLegos === undefined ? {} : {
        directCapabilityLegos: structuredClone(plan.directCapabilityLegos)
      }),
      customCapabilityCount: customCapabilities.length,
      customCapabilityChunks: chunkValues(customCapabilities, MAX_DIRECT_TEMPLATE_ITEMS),
      localProjectTagCount: localProjectTags.length,
      localProjectTagChunks: chunkValues(localProjectTags, MAX_DIRECT_TEMPLATE_ITEMS),
      ownerProvidedLocalTagCount: plan.tagSuggestions.ownerProvidedLocalTags.length,
      maximumOwnerProvidedLocalTagsPerChunk: MAX_DIRECT_TEMPLATE_ITEMS,
      ownerProvidedLocalTagChunks: chunkValues(
        plan.tagSuggestions.ownerProvidedLocalTags,
        MAX_DIRECT_TEMPLATE_ITEMS
      ),
      routingCapabilityChunks: chunkValues(capabilityIds, MAX_DIRECT_TEMPLATE_ITEMS),
      manualProvenanceFallback: {
        schemaVersion: "1.0.0",
        source: "manual",
        templateSelection: null
      },
      routingSelection: {
        catalogDigest: plan.catalogDigest,
        selectionDigest: plan.selectionDigest,
        starterId: plan.selection.starterId,
        requestedPackIds: [...plan.selection.requestedPackIds],
        selectedPackIds: [...plan.selection.selectedPackIds],
        requestedCapabilityIds: [...plan.selection.requestedCapabilityIds],
        ...(plan.directCapabilityLegos === undefined ? {} : {
          directCapabilityLegos: structuredClone(plan.directCapabilityLegos)
        })
      }
    }
  );
}

export function validateNewTarget(targetDirectory) {
  if (typeof targetDirectory !== "string" || targetDirectory.length === 0 || targetDirectory.includes("\0")) {
    fail("TARGET_INVALID", "Target directory must be a nonempty local path.");
  }
  const target = path.resolve(targetDirectory);
  const parent = path.dirname(target);
  if (target === parent || [".", "..", ""].includes(path.basename(target))) {
    fail("TARGET_INVALID", "Target directory must name one new child directory.");
  }
  assertSafeText(path.basename(target), "target directory name", { maximumBytes: 200 });
  let targetStat;
  try {
    targetStat = fs.lstatSync(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (targetStat) {
    fail("TARGET_EXISTS", "Target directory must not already exist, even when it is empty.", { target });
  }
  let parentStat;
  try {
    parentStat = fs.lstatSync(parent);
  } catch (error) {
    if (error?.code === "ENOENT") fail("TARGET_PARENT_MISSING", "Target parent directory must already exist.", { parent });
    throw error;
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    fail("TARGET_PARENT_INVALID", "Target parent must be a real local directory, not a symbolic link.", { parent });
  }
  let canonicalParent;
  try {
    canonicalParent = fs.realpathSync(parent);
  } catch (error) {
    fail("TARGET_PARENT_INVALID", `Target parent cannot be resolved without symbolic links: ${error.message}`, { parent });
  }
  const platformCanonicalParent = canonicalizePlatformRootAlias(parent);
  if (canonicalParent !== platformCanonicalParent) {
    fail(
      "TARGET_PARENT_INVALID",
      "Target parent and every ancestor must use one canonical path without symbolic links.",
      { parent, platformCanonicalParent, canonicalParent }
    );
  }
  return path.join(canonicalParent, path.basename(target));
}

export function renderStandardV4TradeEvidenceRunnerV1() {
  return `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProgrammableTradeEvidenceHarnessV1 } from "${"./"}ProgrammableVolumeFeeHookV2UniversalRouterNative.t.sol";

contract ProgrammableTradeEvidenceRunnerV1 is ProgrammableTradeEvidenceHarnessV1 {
    function test_discover_profile() public {
        _evidenceDiscoverProfile();
    }

    function test_discover_quote_zero_for_one_exact_input() public {
        _evidenceDiscoverQuote(0);
    }

    function test_discover_quote_zero_for_one_exact_output() public {
        _evidenceDiscoverQuote(1);
    }

    function test_discover_quote_one_for_zero_exact_input() public {
        _evidenceDiscoverQuote(2);
    }

    function test_discover_quote_one_for_zero_exact_output() public {
        _evidenceDiscoverQuote(3);
    }

    function test_discover_execute_zero_for_one_exact_input() public {
        _evidenceDiscoverExecution(0);
    }

    function test_discover_execute_zero_for_one_exact_output() public {
        _evidenceDiscoverExecution(1);
    }

    function test_discover_execute_one_for_zero_exact_input() public {
        _evidenceDiscoverExecution(2);
    }

    function test_discover_execute_one_for_zero_exact_output() public {
        _evidenceDiscoverExecution(3);
    }

    function test_discover_reject_expired_deadline_revert() public {
        _evidenceDiscoverRejection(0);
    }

    function test_discover_reject_slippage_bound_revert() public {
        _evidenceDiscoverRejection(1);
    }

    function test_discover_reject_funding_requirement_revert() public {
        _evidenceDiscoverRejection(2);
    }

    function test_quote_zero_for_one_exact_input() public {
        _evidenceQuoteAndEmit(0, "quote-zero-for-one-exact-input.json");
    }

    function test_quote_zero_for_one_exact_output() public {
        _evidenceQuoteAndEmit(1, "quote-zero-for-one-exact-output.json");
    }

    function test_quote_one_for_zero_exact_input() public {
        _evidenceQuoteAndEmit(2, "quote-one-for-zero-exact-input.json");
    }

    function test_quote_one_for_zero_exact_output() public {
        _evidenceQuoteAndEmit(3, "quote-one-for-zero-exact-output.json");
    }

    function test_execute_zero_for_one_exact_input() public {
        _evidenceExecuteAndEmit(0, "execute-zero-for-one-exact-input.json");
    }

    function test_execute_zero_for_one_exact_output() public {
        _evidenceExecuteAndEmit(1, "execute-zero-for-one-exact-output.json");
    }

    function test_execute_one_for_zero_exact_input() public {
        _evidenceExecuteAndEmit(2, "execute-one-for-zero-exact-input.json");
    }

    function test_execute_one_for_zero_exact_output() public {
        _evidenceExecuteAndEmit(3, "execute-one-for-zero-exact-output.json");
    }

    function test_reject_expired_deadline_revert() public {
        _evidenceRejectDeadline("expired-deadline-revert.json");
    }

    function test_reject_slippage_bound_revert() public {
        _evidenceRejectSlippage("slippage-bound-revert.json");
    }

    function test_reject_funding_requirement_revert() public {
        _evidenceRejectFunding("funding-requirement-revert.json");
    }
}
`;
}

const STANDARD_V4_EVIDENCE_MODES = Object.freeze([
  Object.freeze({ id: "zero-for-one-exact-input", index: 0, exactInput: true, zeroForOne: true }),
  Object.freeze({ id: "zero-for-one-exact-output", index: 1, exactInput: false, zeroForOne: true }),
  Object.freeze({ id: "one-for-zero-exact-input", index: 2, exactInput: true, zeroForOne: false }),
  Object.freeze({ id: "one-for-zero-exact-output", index: 3, exactInput: false, zeroForOne: false })
]);
const STANDARD_V4_REJECTIONS = Object.freeze([
  Object.freeze({ id: "expired-deadline-revert", index: 0, modeRef: "zero-for-one-exact-input" }),
  Object.freeze({ id: "slippage-bound-revert", index: 1, modeRef: "zero-for-one-exact-output" }),
  Object.freeze({ id: "funding-requirement-revert", index: 2, modeRef: "one-for-zero-exact-input" })
]);

export function materializeStandardV4TradeEvidenceV1({
  repositoryRoot,
  applicationId,
  marketRef,
  v4SystemRef,
  sourceRevision,
  executionSurfaceCoverage,
  repositoryUri = undefined,
  installDependencies = true,
  createTradeArtifacts,
  inspectRunnerOutput,
  renderForkCanary,
  inspectForkCanary,commandEnvironmentSha256:E
} = {}) {
  if ([createTradeArtifacts,inspectRunnerOutput,renderForkCanary,inspectForkCanary,E].some((x)=>typeof x!=="function")) throw new TypeError("Missing tradable callbacks.");
  const root = requireEvidenceRepositoryRoot(repositoryRoot);
  for (const value of [applicationId, marketRef, v4SystemRef]) if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) throw new Error("Invalid tradable slug.");
  const runnerPath = "test/ProgrammableTradeEvidenceRunnerV1.t.sol";
  const runnerSource = renderStandardV4TradeEvidenceRunnerV1();
  const forkCanaryPath = "test/ProgrammableVolumeFeeHookV2MainnetForkCanary.t.sol";
  const forkCanarySource = renderForkCanary();
  verifyEvidenceFile(root, runnerPath, Buffer.from(runnerSource, "utf8"));
  verifyEvidenceFile(root, forkCanaryPath, Buffer.from(forkCanarySource, "utf8"));
  verifySourceRevision(root, sourceRevision, [runnerPath, forkCanaryPath, "src/ProgrammableVolumeFeeHookV2.sol", "src/ProgrammableVolumeFeeHookFactoryV2.sol"]);
  if (installDependencies) runEvidenceCommand(root, "npm", ["ci", "--ignore-scripts", "--offline"]);
  runEvidenceCommand(root, "forge", ["build", "--offline"]);

  const forkArgs = ["test", "--match-path", forkCanaryPath, "--match-test", "testPinnedMainnetRuntimesAndLocalHookRegistration", "--fork-url", "https://eth.drpc.org", "--fork-block-number", "25708544", "--json", "-vv"];
  const forkStdout = runEvidenceCommand(root, "forge", forkArgs);
  const forkEvidence = inspectForkCanary(forkStdout, { marketRef, sourceRevision: sourceRevision.revisionObjectId, sourceTree: sourceRevision.treeObjectId, sourceArtifactSha256: shaEvidenceFile(root, "src/ProgrammableVolumeFeeHookV2.sol").slice(7), testArtifact: { path: forkCanaryPath, sha256: sha256(Buffer.from(forkCanarySource, "utf8")) }, argv: ["forge", ...forkArgs], forgeVersion: evidenceCommandVersion(root, "forge"), providerUriSha256: sha256(Buffer.from("https://eth.drpc.org", "utf8")) });
  if (forkEvidence?.valid !== true || !forkEvidence.bytes || !forkEvidence.path || !forkEvidence.evidenceRef || !/^sha256:[0-9a-f]{64}$/u.test(forkEvidence.sha256 ?? "")) throw new Error("Invalid fork evidence.");
  const forkFile = writeEvidenceFile(root, forkEvidence.path, Buffer.from(forkEvidence.bytes));
  if (forkFile.sha256 !== forkEvidence.sha256 || forkFile.byteLength !== forkEvidence.byteLength) throw new Error("Mainnet fork canary evidence bytes do not match the inspected binding.");

  const profileRun = runForgeEvidence(root, runnerPath, "test_discover_profile()");
  const profile = discoveryLog(profileRun.stdout, "test_discover_profile()");
  const quoteRuns = new Map();
  const executionRuns = new Map();
  for (const mode of STANDARD_V4_EVIDENCE_MODES) {
    const suffix = mode.id.replaceAll("-", "_");
    const quoteRun = runForgeEvidence(root, runnerPath, `test_discover_quote_${suffix}()`);
    const executionRun = runForgeEvidence(root, runnerPath, `test_discover_execute_${suffix}()`);
    quoteRuns.set(mode.id, bindQuoteDiscovery(quoteRun, discoveryLog(quoteRun.stdout, mode.id), profile, mode));
    executionRuns.set(mode.id, bindRouterDiscovery(executionRun, discoveryLog(executionRun.stdout, mode.id), profile, true));
  }
  const rejectionRuns = new Map();
  for (const scenario of STANDARD_V4_REJECTIONS) {
    const signature = `test_discover_reject_${scenario.id.replaceAll("-", "_")}()`;
    const run = runForgeEvidence(root, runnerPath, signature);
    rejectionRuns.set(scenario.id, bindRouterDiscovery(run, discoveryLog(run.stdout, scenario.id), profile, false));
  }

  const p={networkAccess:"forbidden",externalWrites:false},e=E({kind:"quote-test",executionPolicy:p});
  if(e!==E({kind:"execution-test",executionPolicy:p})||!/^sha256:[\da-f]{64}$/u.test(e)) throw new Error("Trade environments differ.");
  const authored = authorStandardV4EvidenceInputs({
    root, applicationId, marketRef, repositoryUri: repositoryUri ?? `urn:programmable:local-project:${applicationId}`,
    sourceRevision, runnerPath, runnerSource, profile, quoteRuns, executionRuns, rejectionRuns,environmentSha256:e
  });
  const productiveInputs = authorStandardV4ProductiveInputs({ root, applicationId, marketRef, v4SystemRef, sourceRevision, executionSurfaceCoverage, profile, authored, quoteRuns, executionRuns, forkEvidence });
  const artifacts = createTradeArtifacts(productiveInputs);
  const manifestPath = `.programmable/trade-capabilities/${marketRef}.v1.json`;
  const manifestFile = writeCanonicalEvidence(root, manifestPath, artifacts.manifest);
  const typedFiles = writeStandardV4TypedArtifacts(root, artifacts);
  const results = [];
  for (const declaration of [...artifacts.manifest.testEvidence.quoteTests, ...artifacts.manifest.testEvidence.executionTests]) {
    const value = artifacts.resultsByPath[declaration.resultArtifactPath];
    const sourceFixturePath = `test/vectors/trade-results/${declaration.commandId}.json`;
    const file = writeCanonicalEvidence(root, sourceFixturePath, value);
    const finalRun = runForgeEvidence(root, runnerPath, declaration.runnerTestSignature);
    const inspection = inspectRunnerOutput(finalRun.stdout, declaration, declaration.commandId,F);
    if (!inspection.valid) throw new Error(`Final trade evidence ${declaration.commandId} failed: ${inspection.error.code} ${inspection.error.message}`);
    if (canonicalJsonV2(inspection.execution.result) !== canonicalJsonV2(value)) throw new Error(`Final trade evidence ${declaration.commandId} emitted different typed bytes.`);
    results.push(Object.freeze({ commandId: declaration.commandId, sourceFixturePath, declaredResultPath: declaration.resultArtifactPath, ...file, value }));
  }
  const inventory = evidenceRepositoryInventory(root);
  return Object.freeze({
    profileId: "programmable-volume-fee-v2", status: "NOT_APPROVED",
    assurance: "LOCAL_REAL_V4_TEST_EVIDENCE_NOT_APPROVAL", applicationId, marketRef, repositoryRoot: root,
    manifest: Object.freeze({ path: manifestPath, ...manifestFile, value: artifacts.manifest }),
    results: Object.freeze(results), evidenceFiles: Object.freeze([...authored.evidenceFiles, { path: forkEvidence.path, ...forkFile, value: forkEvidence.value }, ...productiveInputs.evidenceFiles, ...typedFiles]),
    commands: Object.freeze([...artifacts.manifest.testEvidence.quoteTests, ...artifacts.manifest.testEvidence.executionTests].map((test) => Object.freeze({ commandId: test.commandId, argv: Object.freeze([...test.command.argv]), workingDirectory: test.command.workingDirectory, environmentSha256: test.command.environmentSha256 }))),
    runtimeDiscovery: Object.freeze(authored.constructorInput.runtimeDiscovery), feeConformance: artifacts.feeConformance, v4: artifacts.v4, forkEvidence: Object.freeze({ evidenceRef: forkEvidence.evidenceRef, path: forkEvidence.path, sha256: forkFile.sha256, byteLength: forkFile.byteLength, value: forkEvidence.value }), forkCommand: Object.freeze({ id: "mainnet-fork-canary", argv: Object.freeze(["forge", ...forkArgs]), workingDirectory: ".", kind: "fork", required: true, timeoutMs: 300000, policy: Object.freeze({ networkAccess: "read-only", externalWrites: false }) }), behaviorCommands: productiveInputs.behaviorCommands, inventory: Object.freeze(inventory)
  });
}

function authorStandardV4EvidenceInputs({ root, applicationId, marketRef, repositoryUri, sourceRevision, runnerPath, runnerSource, profile, quoteRuns, executionRuns, rejectionRuns,environmentSha256 }) {
  const shaFile = (relative) => s256(fs.readFileSync(path.join(root, ...relative.split("/"))));
  const closurePaths = gitEvidence(root, ["ls-tree", "-r", "--name-only", sourceRevision.revisionObjectId]).split("\n").filter(Boolean).sort(compareUtf8);
  const closure = { kind: "route-implementation-closure", sourceRevision: sourceRevision.revisionObjectId, sourceTree: sourceRevision.treeObjectId, root: "src/ProgrammableVolumeFeeHookV2.sol", paths: closurePaths };
  const hookData = { kind: "gross-quote-witness", solidityType: "uint256", encoding: "abi-v2", value: quoteRuns.values().next().value.log.hookData };
  const deploymentRecords = [
    ["universal-router", profile.router, profile.routerCodehash, "@uniswap/universal-router"],
    ["v4-quoter", profile.quoter, profile.quoterCodehash, "@uniswap/v4-periphery"],
    ["permit2", profile.permit2, profile.permit2Codehash, "@uniswap/permit2"]
  ].map(([id, address, runtimeCodeKeccak256, dependency]) => ({ id, address: lowerAddress(address), runtimeCodeKeccak256, dependency, assurance: "LOCAL_TEST_RUNTIME_ONLY_NOT_DEPLOYMENT_OR_APPROVAL" }));
  const files = [];
  const closureFile = writeCanonicalEvidence(root, "evidence/trade/route-implementation-closure.v1.json", closure); files.push({ path: "evidence/trade/route-implementation-closure.v1.json", ...closureFile });
  const hookDataFile = writeCanonicalEvidence(root, "evidence/trade/hook-data-contract.v1.json", hookData); files.push({ path: "evidence/trade/hook-data-contract.v1.json", ...hookDataFile });
  for (const record of deploymentRecords) { const relative = `evidence/deployments/${record.id}.json`; files.push({ path: relative, ...writeCanonicalEvidence(root, relative, record) }); }
  const lock = parseBoundedStrictJsonBytes(fs.readFileSync(path.join(root, "package-lock.json")));
  const packageIds = [
    ["v4-core", "v4-core", "@uniswap/v4-core"], ["v4-periphery", "v4-periphery", "@uniswap/v4-periphery"],
    ["universal-router", "universal-router", "@uniswap/universal-router"], ["v4-quoter", "v4-quoter", "@uniswap/v4-periphery"],
    ["permit2", "permit2", "@uniswap/permit2"]
  ];
  const dependencies = packageIds.map(([id, role, packageName]) => {
    const pinned = lock.packages?.[`node_modules/${packageName}`];
    if (!pinned?.version || !pinned?.resolved || !pinned?.integrity) throw new Error(`Missing exact lock identity for ${packageName}.`);
    return { id, role, sourceUri: pinned.resolved, resolvedIdentity: `${packageName}@${pinned.version} ${pinned.integrity}`, contentSha256: hashEvidenceDirectory(path.join(root, "node_modules", ...packageName.split("/"))) };
  });
  dependencies.push({ id: "trade-integration", role: "trade-integration", sourceUri: repositoryUri, resolvedIdentity: shaFile(runnerPath), contentSha256: shaFile("test/helpers/UniversalRouterV4Fixture.sol") });
  const runnerBytes = Buffer.from(runnerSource, "utf8");
  const modes = Object.fromEntries(STANDARD_V4_EVIDENCE_MODES.map((mode) => [mode.id, successfulModeEvidence(mode, profile, quoteRuns.get(mode.id), executionRuns.get(mode.id))]));
  const negative = Object.fromEntries(STANDARD_V4_REJECTIONS.map((scenario) => [scenario.id, rejectedModeEvidence(scenario, profile, modes[scenario.modeRef], rejectionRuns.get(scenario.id))]));
  const constructorInput = {
    applicationId, marketRef, manifestId: `${marketRef}-trade-capability`,
    chain: { chainId: String(profile.chainId), networkRef: "foundry-local-v4", deploymentProfileSha256: s256(Buffer.from(canonicalJsonV2(profile))), referenceBlock: { number: String(Number(profile.blockNumber) - 1), hash: profile.blockHash.toLowerCase(), timestamp: String(profile.blockTimestamp) } },
    source: { repositoryUri, identityKind: "content-addressed-route-implementation-closure", routeImplementationPath: "src/ProgrammableVolumeFeeHookV2.sol", routeImplementationSha256: shaFile("src/ProgrammableVolumeFeeHookV2.sol"), routeImplementationClosurePath: "evidence/trade/route-implementation-closure.v1.json", routeImplementationClosureSha256: closureFile.sha256 },
    dependencies: { lockfilePath: "package-lock.json", lockfileSha256: shaFile("package-lock.json"), entries: dependencies },
    poolKey: { currency0: lowerAddress(profile.currency0), currency1: lowerAddress(profile.currency1), fee: profile.fee, tickSpacing: profile.tickSpacing, hooks: lowerAddress(profile.hooks) },
    runtimeDiscovery: {
      router: endpointEvidence(profile.router, profile.routerCodehash, "universal-router", "evidence/deployments/universal-router.json"),
      quoter: endpointEvidence(profile.quoter, profile.quoterCodehash, "v4-quoter", "evidence/deployments/v4-quoter.json"),
      permit2: endpointEvidence(profile.permit2, profile.permit2Codehash, "permit2", "evidence/deployments/permit2.json")
    },
    generationIdentitySha256: s256(Buffer.from(canonicalJsonV2({ closureSha256: closureFile.sha256, runnerSha256: s256(runnerBytes), profile }))),
    routeInterface: { id: "uniswap-v4-universal-router", version: "2.1.0", abiSha256: s256(Buffer.from("execute(bytes,bytes[],uint256)|quoteExactInputSingle|quoteExactOutputSingle", "utf8")) },
    hookData: { mode: "bound", contractId: "gross-quote-witness", contractVersion: "1.0.0", contractSha256: hookDataFile.sha256, consumer: "hook", encoding: "abi-v2", solidityType: "uint256", required: true, maximumBytes: 32, example: hookData.value },
    testContract: { sourceArtifact: { path: runnerPath, sha256: s256(runnerBytes), byteLength: runnerBytes.length }, environment: "local-v4-integration", environmentSha256, workingDirectory: "." },
    policy: { defaultSlippageBps: 50, maximumSlippageBps: 500, maximumDeadlineWindowSeconds: 1800 }, evidence: { modes, negative }
  };
  return { constructorInput, evidenceFiles: files.map(Object.freeze) };
}

function authorStandardV4ProductiveInputs({ root, applicationId, marketRef, v4SystemRef, sourceRevision, executionSurfaceCoverage, profile, authored, quoteRuns, executionRuns, forkEvidence }) {
  if (!executionSurfaceCoverage?.evidenceRef || !/^sha256:[0-9a-f]{64}$/u.test(executionSurfaceCoverage.sha256 ?? "")) throw new Error("Tradable fee evidence requires exact execution-surface coverage.");
  const testPaths = ["test/ProgrammableVolumeFeeHookV2.t.sol", "test/ProgrammableVolumeFeeHookV2UniversalRouterNative.t.sol", "test/ProgrammableVolumeFeeHookV2UniversalRouterErc20.t.sol", "test/invariant/ProgrammableVolumeFeeHookV2.invariant.t.sol"];
  const runs = testPaths.map((testPath) => ({ argv: ["forge", "test", "--offline", "--json", "--match-path", testPath], testPath, stdout: runEvidenceCommand(root, "forge", ["test", "--offline", "--json", "--match-path", testPath]) }));
  const required = ["testPolicyIdentityAndHighRateBoundary", "testFuzzSplitAndUnsplitHaveSameLifetimeEntitlement", "testOnlyExactOwnersCanClaimAndRemaindersSurvive", "testNativeClaimRecipientCannotReenterAnyClaimPath", "testAlternatePoolCannotReuseScopeOrRemainders", "testPoolManagerCallbackAuthentication", "testV4QuoterToUniversalRouterNativeExactOutputBuyRefundsUnusedMaximumInput", "testUniversalRouterNativeExactOutputMultihopPreservesPerHopHookData", "testV4QuoterToUniversalRouterPermit2ExactOutputBuy", "invariant_CurrentLiabilityIsSegregatedAndFullyFunded"];
  const behaviorValue = { schemaVersion: "1.0.0", kind: "standard-v4-kernel-behavior-evidence", status: "LOCAL_TEST_EVIDENCE_NOT_APPROVAL", applicationId, marketRef, sourceRevision: sourceRevision.revisionObjectId, sourceTree: sourceRevision.treeObjectId, sourceArtifacts: ["src/ProgrammableVolumeFeeHookV2.sol", "src/ProgrammableVolumeFeeHookFactoryV2.sol", ...testPaths].map((filePath) => ({ path: filePath, sha256: shaEvidenceFile(root, filePath) })), runs: runs.map(({ argv, stdout, testPath }) => normalizedForgePassReport(stdout, testPath, argv)), evidenceBoundary: { approvalCreated: false, auditClaimed: false, productionClaimed: false, externalActionsPerformed: [] } };
  const observed = new Set(behaviorValue.runs.flatMap(({ tests }) => tests));
  for (const name of required) if (![...observed].some((testName) => testName.includes(name))) throw new Error(`Required productive kernel test did not pass: ${name}.`);
  const evidenceFiles = [], behaviorPath = `evidence/fee/${marketRef}.kernel-behavior.v1.json`, behaviorFile = writeCanonicalEvidence(root, behaviorPath, behaviorValue), behaviorEvidence = { evidenceRef: `${marketRef}-kernel-behavior`, evidenceSha256: behaviorFile.sha256 }; evidenceFiles.push({ path: behaviorPath, ...behaviorFile, value: behaviorValue });
  const quoteCurrency = `0x${String(profile.hookConstructorArgs).slice(-40).toLowerCase()}`;
  if (quoteCurrency !== lowerAddress(profile.currency0) || quoteCurrency !== "0x0000000000000000000000000000000000000000") throw new Error("Native reference profile quote currency is not the exact constructor-bound pool currency0.");
  const modeEvidence = {};
  for (const mode of STANDARD_V4_EVIDENCE_MODES) {
    const quote = quoteRuns.get(mode.id), execution = executionRuns.get(mode.id), value = { schemaVersion: "1.0.0", kind: "standard-v4-mode-evidence", status: "LOCAL_REAL_V4_TEST_EVIDENCE_NOT_APPROVAL", applicationId, marketRef, modeId: mode.id, sourceRevision: sourceRevision.revisionObjectId, quote: { log: quote.log, call: quote.call }, execution: { log: execution.log, call: execution.call }, ...execution.fee };
    const relative = `evidence/fee/${marketRef}.${mode.id}.v1.json`, file = writeCanonicalEvidence(root, relative, value); evidenceFiles.push({ path: relative, ...file, value }); modeEvidence[mode.id] = { evidenceRef: `${marketRef}-${mode.id}`, evidenceSha256: file.sha256, ...execution.fee };
  }
  const chainValue = { schemaVersion: "1.0.0", kind: "local-v4-chain-profile-evidence", status: "LOCAL_TEST_RUNTIME_ONLY_NOT_DEPLOYMENT_OR_APPROVAL", sourceRevision: sourceRevision.revisionObjectId, chainId: String(profile.chainId), blockNumber: String(Number(profile.blockNumber) - 1), blockHash: profile.blockHash.toLowerCase(), poolManager: lowerAddress(profile.poolManager), poolManagerCodeKeccak256: profile.poolManagerCodehash.toLowerCase(), poolId: profile.poolId.toLowerCase() };
  const deployerValue = { schemaVersion: "1.0.0", kind: "local-create2-deployer-evidence", status: "LOCAL_TEST_RUNTIME_ONLY_NOT_DEPLOYMENT_OR_APPROVAL", sourceRevision: sourceRevision.revisionObjectId, address: lowerAddress(profile.hookFactory), runtimeCodeKeccak256: profile.hookFactoryCodehash.toLowerCase(), sourcePath: "src/ProgrammableVolumeFeeHookFactoryV2.sol", sourceSha256: shaEvidenceFile(root, "src/ProgrammableVolumeFeeHookFactoryV2.sol"), effectiveSalt: profile.hookEffectiveSalt.toLowerCase(), userSalt: profile.hookUserSalt.toLowerCase(), expectedAddress: lowerAddress(profile.hooks) };
  const chainPath = `evidence/v4/${marketRef}.local-chain-profile.v1.json`, deployerPath = `evidence/v4/${marketRef}.local-create2-deployer.v1.json`, chainFile = writeCanonicalEvidence(root, chainPath, chainValue), deployerFile = writeCanonicalEvidence(root, deployerPath, deployerValue); evidenceFiles.push({ path: chainPath, ...chainFile, value: chainValue }, { path: deployerPath, ...deployerFile, value: deployerValue });
  const routerEvidence = Object.values(modeEvidence).map(({ evidenceRef }) => evidenceRef).sort(compareUtf8), behaviorRef = behaviorEvidence.evidenceRef;
  return { trade: authored.constructorInput, fee: { sourceRevision, executionSurfaceCoverage, behaviorEvidence, modeEvidence }, v4: { systemRef: v4SystemRef, runtimeProfile: { ...profile, blockNumber: Number(profile.blockNumber) - 1 }, forkEvidence: { evidenceRef: forkEvidence.evidenceRef, sha256: forkEvidence.sha256 }, hookFactorySourceSha256: deployerValue.sourceSha256, chainProfileEvidence: { path: chainPath, sha256: chainFile.sha256 }, create2DeployerEvidence: { path: deployerPath, sha256: deployerFile.sha256 }, evidence: { unit: behaviorRef, negative: behaviorRef, fuzz: behaviorRef, invariant: behaviorRef, router: routerEvidence } }, evidenceFiles: evidenceFiles.map(Object.freeze), behaviorCommands: Object.freeze(runs.map(({ argv, testPath }) => Object.freeze({ id: `kernel-${path.basename(testPath).replace(/[^a-z0-9]+/giu, "-").toLowerCase().replace(/^-|-$/gu, "")}`, argv: Object.freeze([...argv]), workingDirectory: ".", kind: testPath.includes("invariant/") ? "invariant" : "test", required: true, timeoutMs: 300000, policy: Object.freeze({ networkAccess: "forbidden", externalWrites: false }) }))) };
}

function normalizedForgePassReport(stdout, testPath, argv) {
  const parsed = parseBoundedStrictJsonBytes(Buffer.from(stdout, "utf8"), F), tests = [];
  for (const suite of Object.values(parsed)) for (const [name, result] of Object.entries(suite?.test_results ?? {})) { if (result?.status !== "Success") throw new Error(`Forge evidence command contains a non-passing test: ${name}.`); tests.push(name); }
  tests.sort(compareUtf8); if (tests.length === 0) throw new Error(`Forge evidence command passed no tests for ${testPath}.`);
  return { argv, argvSha256: s256(Buffer.from(canonicalJsonV2(argv), "utf8")), workingDirectory: ".", testPath, testCount: tests.length, tests };
}

function writeStandardV4TypedArtifacts(root, artifacts) {
  const records = [[artifacts.feeConformance.receiptPath, artifacts.feeConformance.receiptBytes, artifacts.feeConformance.receipt], [artifacts.feeConformance.vectorSetPath, artifacts.feeConformance.vectorSetBytes, artifacts.feeConformance.vectorSet], [artifacts.v4.paths.profile, artifacts.v4.profileBytes, artifacts.v4.hook], [artifacts.v4.paths.preimage, artifacts.v4.preimageBytes, artifacts.v4.preimage], [artifacts.v4.paths.manifest, artifacts.v4.deploymentBytes, artifacts.v4.deployment], [artifacts.v4.paths.runtime, artifacts.v4.runtimeBytes, null]];
  return records.map(([relative, bytes, value]) => Object.freeze({ path: relative, ...writeEvidenceFile(root, relative, bytes), ...(value === null ? {} : { value }) }));
}

function successfulModeEvidence(mode, profile, quote, execution) {
  const log = execution.log;
  const inputCurrency = lowerAddress(mode.zeroForOne ? profile.currency0 : profile.currency1);
  const outputCurrency = lowerAddress(mode.zeroForOne ? profile.currency1 : profile.currency0);
  const inputBefore = mode.zeroForOne ? log.nativeBefore : log.projectBefore;
  const inputAfter = mode.zeroForOne ? log.nativeAfter : log.projectAfter;
  const outputBefore = mode.zeroForOne ? log.projectBefore : log.nativeBefore;
  const outputAfter = mode.zeroForOne ? log.projectAfter : log.nativeAfter;
  return {
    sender: lowerAddress(profile.testAccount), recipient: lowerAddress(profile.testAccount),
    amountSpecified: log.amountSpecified, amountQuoted: log.amountQuoted, slippageBps: 50, deadline: log.deadline,
    quote: { calldataSha256: quote.call.calldataSha256, returnDataSha256: quote.call.outputSha256, stateBeforeSha256: sha256Label(quote.log.stateBeforeSha256), stateAfterSha256: sha256Label(quote.log.stateAfterSha256) },
    execution: {
      executionKind: "foundry-call", executionDigestSha256: s256(Buffer.from(canonicalJsonV2({ log, call: execution.call }), "utf8")),
      actionPlanSha256: execution.call.calldataSha256, calldataSha256: execution.call.calldataSha256,
      fundingWitnessSha256: sha256Label(log.fundingBeforeSha256), stateWitness: stateWitnessFromDiscovery(log),
      transactionHash: null, gasUsed: String(execution.gas), amountIn: log.amountIn, amountOut: log.amountOut,
      slippageGuardAmount: log.slippageGuardAmount,
      walletBalances: [
        { account: lowerAddress(profile.testAccount), currency: inputCurrency, before: inputBefore, after: inputAfter },
        { account: lowerAddress(profile.testAccount), currency: outputCurrency, before: outputBefore, after: outputAfter }
      ],
      refundAmount: log.refundAmount, dustAmount: log.dustAmount,
      approvalChanged: log.approvalBeforeSha256 !== log.approvalAfterSha256,
      fundsChangedBeforeExecution: log.fundingBeforeSha256 !== log.fundingAfterSha256,
      lockStateChanged: log.lockBeforeSha256 !== log.lockAfterSha256,
      applicationStateChanged: log.applicationBeforeSha256 !== log.applicationAfterSha256
    }
  };
}

function rejectedModeEvidence(scenario, profile, successful, rejection) {
  const log = rejection.log;
  const mode = STANDARD_V4_EVIDENCE_MODES.find(({ id }) => id === scenario.modeRef);
  const inputCurrency = lowerAddress(mode.zeroForOne ? profile.currency0 : profile.currency1);
  const outputCurrency = lowerAddress(mode.zeroForOne ? profile.currency1 : profile.currency0);
  const inputBalance = mode.zeroForOne ? log.nativeBefore : log.projectBefore;
  const outputBalance = mode.zeroForOne ? log.projectBefore : log.nativeBefore;
  return {
    modeRef: scenario.modeRef, expectedRevertDataSha256: rejection.call.outputSha256,
    sender: successful.sender, recipient: successful.recipient, amountSpecified: log.amountSpecified,
    amountQuoted: log.amountQuoted, slippageBps: 50, deadline: log.deadline,
    execution: {
      executionKind: "foundry-call", executionDigestSha256: s256(Buffer.from(canonicalJsonV2({ log, call: rejection.call }), "utf8")),
      actionPlanSha256: rejection.call.calldataSha256, calldataSha256: rejection.call.calldataSha256,
      fundingWitnessSha256: sha256Label(log.fundingBeforeSha256), stateWitness: stateWitnessFromDiscovery(log),
      transactionHash: null, gasUsed: String(rejection.gas), slippageGuardAmount: log.slippageGuardAmount,
      walletBalances: [
        { account: successful.sender, currency: inputCurrency, before: inputBalance, after: inputBalance },
        { account: successful.recipient, currency: outputCurrency, before: outputBalance, after: outputBalance }
      ],
      refundAmount: "0", dustAmount: "0",
      approvalChanged: log.approvalBeforeSha256 !== log.approvalAfterSha256,
      fundsChangedBeforeExecution: log.fundingBeforeSha256 !== log.fundingAfterSha256,
      lockStateChanged: log.lockBeforeSha256 !== log.lockAfterSha256,
      applicationStateChanged: log.applicationBeforeSha256 !== log.applicationAfterSha256
    }
  };
}

export function bindQuoteDiscovery(run,log,profile,mode){
  const o=forgeEvidenceObservation(run.stdout),s=mode.exactInput?"0xaa9d21cb":"0x58733073",t=lowerAddress(profile.quoter),m=o.calls.filter((x)=>lowerAddress(x.address)===t&&x.kind==="CALL"&&x.success===true&&String(x.data).toLowerCase().startsWith(s)&&uintFromCallOutput(x.output)===BigInt(log.amountQuoted)),n=mode.id==="zero-for-one-exact-output"?2:1;
  if(m.length!==n)throw new Error(`Discovery quote ${mode.id} call cardinality is not ${n}.`);
  return Object.freeze({log,stdout:run.stdout,gas:o.gas,call:callEvidence(m.at(-1))});
}

function bindRouterDiscovery(run, log, profile, succeeded) {
  const observation = forgeEvidenceObservation(run.stdout);
  const calldata = String(log.callData).toLowerCase();
  const output = String(succeeded ? log.returnData : log.revertData).toLowerCase();
  const matches = observation.calls.filter((trace) => lowerAddress(trace.address) === lowerAddress(profile.router) && trace.kind === "CALL" && trace.success === succeeded && String(trace.data).toLowerCase() === calldata && String(trace.output).toLowerCase() === output);
  if (matches.length === 0) throw new Error("Discovery execution lacks its exact real Universal Router CALL trace.");
  return Object.freeze({log,stdout:run.stdout,gas:observation.gas,call:callEvidence(matches[0]),fee:succeeded?grossQuoteFromLogs(observation.logs,profile.hooks,true):null});
}

function forgeEvidenceObservation(stdout) {
  const parsed = parseBoundedStrictJsonBytes(Buffer.from(stdout, "utf8"), F);
  const suites = Object.values(parsed);
  if (suites.length !== 1) throw new Error("Forge discovery must emit exactly one suite.");
  const tests = Object.values(suites[0]?.test_results ?? {});
  if (tests.length !== 1 || tests[0]?.status !== "Success") throw new Error("Forge discovery must pass exactly one test.");
  const gas = tests[0]?.kind?.Unit?.gas;
  if (!Number.isSafeInteger(gas) || gas <= 0) throw new Error("Forge discovery lacks unit gas evidence.");
  const arenas = (tests[0]?.traces ?? []).filter((entry) => Array.isArray(entry) && entry[0] === "Execution").flatMap((entry) => entry[1]?.arena ?? []);
  const calls = arenas.map((node) => node?.trace).filter((trace) => trace && ["CALL", "STATICCALL"].includes(trace.kind));
  return { test: tests[0], gas, calls, logs: arenas.flatMap((node) => node?.logs ?? []) };
}

export function grossQuoteFromLogs(logs,hook,full=false){
  const t="0xbe168d5510947b6d85cd324787c4816d47e9e9137f8f3559647469ab5f3e3b51",v=new Map();
  for(const e of logs){const r=e?.raw_log??e;if(lowerAddress(e.address)===lowerAddress(hook)&&r?.topics?.[0]===t&&/^0x[0-9a-f]{512}$/u.test(r.data??"")){const w=r.data.slice(2).match(/.{64}/gu).slice(1,6).map((x)=>BigInt(`0x${x}`));v.set(w.join(":"),w);}}
  const [s,e,g,p,q]=[...v.values()][0]??[],f=(p??0n)+(q??0n);
  if(v.size!==1||g<=0n||e!==(s<1000n?1000n:s)||f!==g*1000n/1000000n+g*(e-1000n)/1000000n)throw new Error("Invalid gross amount.");
  return full?{grossQuoteAmount:g.toString(),hookFeeAmount:f.toString(),selectedRateHundredthsOfBip:s.toString()}:g.toString();
}

function discoveryLog(stdout,label){const o=forgeEvidenceObservation(stdout),p="PROGRAMMABLE_TRADE_DISCOVERY_V1:",l=(o.test.decoded_logs??[]).filter((e)=>typeof e==="string"&&e.startsWith(p));if(l.length!==1)throw new Error(`Forge discovery ${label} must emit exactly one typed discovery log.`);return parseBoundedStrictJsonBytes(Buffer.from(l[0].slice(p.length),"utf8"));}
function runForgeEvidence(root,runnerPath,signature){return{stdout:runEvidenceCommand(root,"forge",["test","--offline","--json","-vvvv","--match-path",runnerPath,"--match-test",exactForgeTestPattern(signature)])};}
export function exactForgeTestPattern(signature){if(typeof signature!=="string"||signature.length===0)throw new TypeError("Forge test signature must be nonempty.");return`^${signature.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&")}$`;}
function runEvidenceCommand(root,command,args){const r=childProcess.spawnSync(command,args,{cwd:root,encoding:"utf8",shell:false,maxBuffer:128*1024*1024,env:process.env});if(r.error)throw new Error(`${command} failed to start: ${r.error.message}`);if(r.status!==0)throw new Error(`${command} ${args.join(" ")} failed (${r.status}): ${String(r.stderr).slice(-4000)}`);return r.stdout;}
function evidenceCommandVersion(root,command){return runEvidenceCommand(root,command,["--version"]).trim().slice(0,500);}

function endpointEvidence(address, runtimeCodeKeccak256, sourceDependencyRef, deploymentEvidenceRef) {
  return { address: lowerAddress(address), runtimeCodeKeccak256: runtimeCodeKeccak256.toLowerCase(), sourceDependencyRef, deploymentEvidenceRef };
}

function stateWitnessFromDiscovery(log) {
  return {
    approvalBeforeSha256: sha256Label(log.approvalBeforeSha256), approvalAfterSha256: sha256Label(log.approvalAfterSha256),
    fundingBeforeSha256: sha256Label(log.fundingBeforeSha256), fundingAfterSha256: sha256Label(log.fundingAfterSha256),
    walletBeforeSha256: sha256Label(log.walletBeforeSha256), walletAfterSha256: sha256Label(log.walletAfterSha256),
    lockBeforeSha256: sha256Label(log.lockBeforeSha256), lockAfterSha256: sha256Label(log.lockAfterSha256),
    applicationBeforeSha256: sha256Label(log.applicationBeforeSha256), applicationAfterSha256: sha256Label(log.applicationAfterSha256)
  };
}

function callEvidence(trace) {
  return { calldataSha256: sha256Hex(trace.data), outputSha256: sha256Hex(trace.output) };
}

function uintFromCallOutput(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64,}$/u.test(value)) return -1n;
  return BigInt(`0x${value.slice(2, 66)}`);
}

function sha256Hex(value) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) throw new Error("Forge trace bytes are not canonical hex.");
  return s256(Buffer.from(value.slice(2), "hex"));
}

function sha256Label(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) throw new Error("Runtime state digest is not bytes32.");
  return `sha256:${value.slice(2).toLowerCase()}`;
}

function lowerAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) throw new Error("Runtime discovery address is invalid.");
  return value.toLowerCase();
}

function writeCanonicalEvidence(root, relative, value) {
  return writeEvidenceFile(root, relative, Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8"));
}

function writeEvidenceFile(root, relative, bytes) {
  assertRelativePath(relative, "tradable evidence path");
  const destination = path.resolve(root, ...relative.split("/"));
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Tradable evidence path escaped the repository.");
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
  return Object.freeze({ sha256: s256(bytes), byteLength: bytes.length });
}

function verifyEvidenceFile(root, relative, expected) {
  assertRelativePath(relative, "precommitted tradable source path");
  const target = path.resolve(root, ...relative.split("/")), observed = fs.readFileSync(target);
  if (!observed.equals(expected)) throw new Error(`Precommitted tradable source bytes differ from the productive renderer: ${relative}.`);
}

function shaEvidenceFile(root, relative) { return s256(fs.readFileSync(path.join(root, ...relative.split("/")))); }

function verifySourceRevision(root, sourceRevision, paths) {
  if (!/^[0-9a-f]{40}$/u.test(sourceRevision?.revisionObjectId ?? "") || !/^[0-9a-f]{40}$/u.test(sourceRevision?.treeObjectId ?? "")) throw new Error("Tradable evidence requires exact source commit and tree object IDs.");
  if (gitEvidence(root, ["rev-parse", "HEAD"]) !== sourceRevision.revisionObjectId || gitEvidence(root, ["rev-parse", "HEAD^{tree}"]) !== sourceRevision.treeObjectId) throw new Error("Tradable source revision does not match the repository HEAD and tree.");
  if (gitEvidence(root, ["status", "--porcelain", "--untracked-files=no"]) !== "") throw new Error("Tradable source revision has tracked working-tree drift.");
  for (const relative of paths) { const committed = gitEvidenceBytes(root, ["show", `${sourceRevision.revisionObjectId}:${relative}`]); if (!committed.equals(fs.readFileSync(path.join(root, ...relative.split("/"))))) throw new Error(`Tradable source file is not byte-bound to the source revision: ${relative}.`); }
}

function gitEvidence(root, args) { return gitEvidenceBytes(root, args).toString("utf8").trim(); }
function gitEvidenceBytes(root, args) {
  const result = childProcess.spawnSync("git", args, { cwd: root, encoding: null, shell: false, maxBuffer: 128 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.error?.message ?? result.stderr.toString("utf8").slice(-2000)}`);
  return result.stdout;
}

function requireEvidenceRepositoryRoot(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) throw new Error("Tradable evidence repositoryRoot is required.");
  const resolved = path.resolve(value);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(resolved) !== resolved) throw new Error("Tradable evidence repositoryRoot must be one canonical real directory.");
  for (const required of ["package-lock.json", "src/ProgrammableVolumeFeeHookV2.sol", "test/helpers/UniversalRouterV4Fixture.sol"]) if (!fs.lstatSync(path.join(resolved, required)).isFile()) throw new Error(`Tradable reference kernel is missing ${required}.`);
  return resolved;
}

function evidenceRepositoryInventory(root) {
  const files = [];
  const visit = (directory, prefix = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if ([".git", "cache", "node_modules", "out"].includes(entry.name)) continue;
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Tradable repository inventory rejects symlink ${relative}.`);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) { const bytes = fs.readFileSync(absolute); files.push(Object.freeze({ path: relative, sha256: s256(bytes), byteLength: bytes.length })); }
      else throw new Error(`Tradable repository inventory rejects ${relative}.`);
    }
  };
  visit(root);
  return files;
}

function hashEvidenceDirectory(root) {
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Installed dependency is not a real directory: ${root}.`);
  return s256(Buffer.from(canonicalJsonV2(evidenceRepositoryInventory(root))));
}

export function canonicalizePlatformRootAlias(value) {
  for (const candidate of ["/etc", "/tmp", "/var"]) {
    if (value !== candidate && !value.startsWith(`${candidate}${path.sep}`)) continue;
    let canonicalCandidate;
    try {
      canonicalCandidate = fs.realpathSync(candidate);
    } catch {
      continue;
    }
    if (canonicalCandidate === candidate) return value;
    return `${canonicalCandidate}${value.slice(candidate.length)}`;
  }
  return value;
}

export function assertCanonicalMaterializationParent(parent, temporary) {
  let canonicalParent;
  let canonicalTemporary;
  try {
    canonicalParent = fs.realpathSync(parent);
    canonicalTemporary = fs.realpathSync(temporary);
  } catch (error) {
    fail("TARGET_PARENT_INVALID", `Materialization parent changed during the write: ${error.message}`, { parent });
  }
  if (
    canonicalParent !== parent
    || path.dirname(canonicalTemporary) !== canonicalParent
    || !path.basename(canonicalTemporary).startsWith(".programmable-template-")
  ) {
    fail(
      "TARGET_PARENT_INVALID",
      "Materialization parent changed or escaped its canonical directory during the write.",
      { parent, canonicalParent, canonicalTemporary }
    );
  }
}
