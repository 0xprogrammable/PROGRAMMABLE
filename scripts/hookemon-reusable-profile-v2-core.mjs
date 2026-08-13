import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readDependencyLock } from "./hookemon-v2-dependencies-core.mjs";

export const EIP170_LIMIT = 24_576;
export const EIP3860_LIMIT = 49_152;
export const ACTUAL_V2_COMMAND =
  "forge test --match-path test/router_vnext/ProgrammableExactHookemonNormalCreateProfileV1.t.sol --match-test '^testV2ActualEntrypoint' -vv";
export const ACTUAL_V2_TEST_SOURCE =
  "test/router_vnext/ProgrammableExactHookemonNormalCreateProfileV1.t.sol";
export const ACTUAL_V2_TEST_NAMES = [
  "testV2ActualEntrypointDownstreamFailureRollsBackAndSamePermitRetries",
  "testV2ActualEntrypointExecutesAuthorityPlanVerifierRegistryAndKernel",
  "testV2ActualEntrypointRepositoryOnceBlocksLaterReleaseRoute"
];
export const ACTUAL_V2_FORGE_VERSION = "1.7.1";
export const ACTUAL_V2_FORGE_COMMIT = "4072e48705af9d93e3c0f6e29e93b5e9a40caed8";
export const ACTUAL_V2_SOLC_VERSION = "0.8.26+commit.8a97fa7a.Darwin.appleclang";

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function gitBlobId(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export function keccak256Hex(hex) {
  return execFileSync("cast", ["keccak", hex], { encoding: "utf8" }).trim();
}

export function bytecodeBytes(hex) {
  const clean = hex.replace(/^0x/, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean)) throw new Error("malformed bytecode");
  return clean.length / 2;
}

export function canonicalAbi(abi) {
  return stable(abi);
}

export function exactAbiEntry(abi, expected) {
  return abi.some((entry) => canonicalJson(entry) === canonicalJson(expected));
}

export function scopeSlitherDetectors(detectors, analyzedFirstPartyPaths) {
  const analyzedPathSet = new Set(analyzedFirstPartyPaths);
  return detectors.filter((detector) => detector.elements?.some(
    (element) => analyzedPathSet.has(element.source_mapping?.filename_relative)
  ));
}

export function requireNoScopedHighOrMedium(detectors) {
  const unresolved = detectors.filter((detector) => detector.impact === "High" || detector.impact === "Medium");
  if (unresolved.length !== 0) {
    throw new Error(
      `scoped High/Medium requires source fix: ${unresolved.map((item) => `${item.check}:${item.id}`).join(",")}`
    );
  }
}

export function actualV2ReceiptErrors(receipt, rawLogBytes, expected) {
  const errors = [];
  const rawLog = rawLogBytes.toString("utf8");
  const rawLogSha256 = sha256(rawLogBytes);
  const contentAddressedRawLogPath =
    `security/receipts/hookemon-v2-actual-e2e-${rawLogSha256.slice(0, 8)}.log`;
  if (
    receipt?.receiptClass !== "LOCAL_ISOLATED_INTEGRATION_NOT_PRODUCTION_AUTHORITY_PROOF"
      || receipt?.activationAllowed !== false || receipt?.deploymentAddresses !== null
      || receipt?.releaseActivationTransaction !== null
  ) errors.push("receipt classification");
  if (
    receipt?.command !== ACTUAL_V2_COMMAND || receipt?.exitCode !== 0
      || receipt?.result?.passed !== 3 || receipt?.result?.failed !== 0 || receipt?.result?.skipped !== 0
      || canonicalJson(receipt?.testNames) !== canonicalJson(ACTUAL_V2_TEST_NAMES)
  ) errors.push("receipt command or result");
  if (
    receipt?.rawLog?.sha256 !== rawLogSha256
      || receipt?.rawLog?.byteLength !== rawLogBytes.length
      || receipt?.rawLog?.path !== contentAddressedRawLogPath
      || /\[FAIL(?:.|\n)*?\]/u.test(rawLog)
      || !rawLog.includes("3 tests passed, 0 failed, 0 skipped (3 total tests)")
  ) errors.push("receipt raw log");
  for (const testName of ACTUAL_V2_TEST_NAMES) {
    if (!rawLog.includes(`[PASS] ${testName}()`)) errors.push(`receipt pass ${testName}`);
  }
  if (
    receipt?.toolchain?.forgeVersion !== ACTUAL_V2_FORGE_VERSION
      || receipt?.toolchain?.forgeCommit !== ACTUAL_V2_FORGE_COMMIT
      || receipt?.toolchain?.solcVersion !== ACTUAL_V2_SOLC_VERSION
  ) errors.push("receipt toolchain");
  if (
    receipt?.testedSourceRevision?.commit !== expected.testedSourceCommit
      || receipt?.testedSourceRevision?.tree !== expected.testedSourceTree
      || receipt?.testSource?.path !== ACTUAL_V2_TEST_SOURCE
      || receipt?.testSource?.sha256 !== expected.testSourceSha256
      || receipt?.sourceBoundary?.productionSourceClosureCommitmentSha256 !== expected.productionSourceClosure
      || receipt?.sourceBoundary?.dependencyLock?.path !== expected.dependencyLockPath
      || receipt?.sourceBoundary?.dependencyLock?.sha256 !== expected.dependencyLockSha256
      || receipt?.sourceBoundary?.foundryConfigSha256 !== expected.foundryConfigSha256
      || receipt?.sourceBoundary?.remappingsSha256 !== expected.remappingsSha256
      || receipt?.sourceBoundary?.frozenSharedAuthoritySourceBundleCommitmentSha256
        !== expected.sourceBundleCommitmentSha256
  ) errors.push("receipt source boundary");
  if (
    receipt?.isolatedCheckout?.method !== `git archive ${expected.testedSourceCommit}`
      || receipt?.isolatedCheckout?.preexistingLibPresent !== false
      || receipt?.isolatedCheckout?.dependencyHydrationCommand
        !== "node scripts/hydrate-hookemon-v2-dependencies.mjs lib"
      || receipt?.isolatedCheckout?.dependencyVerificationResult
        !== "12 exact clean Git commit and tree pins"
      || !receipt?.limitations?.some((item) => item.includes("not production signer"))
  ) errors.push("receipt isolation or limitation");
  return errors;
}

export function canonicalPublicationErrors(sharedRevision, provenance, descriptorEvidence) {
  const errors = [];
  const identity = sharedRevision?.localFrozenSourceBundle;
  const gate = provenance?.releasePublicationGate;
  const expectedRepository = "0xprogrammable/programmable";
  const expectedBranch = "codex/shards-registry-gen2-freeze-8afe454-20260813";
  const expectedCommitUrl = identity?.commit
    ? `https://github.com/${expectedRepository}/commit/${identity.commit}`
    : null;
  if (
    provenance?.claimedCanonicalRemote !== `https://github.com/${expectedRepository}.git`
      || provenance?.remoteReachabilityProven !== true
      || sharedRevision?.remoteReachabilityProven !== true
      || gate?.satisfied !== true
      || gate?.repository !== expectedRepository
      || gate?.branch !== expectedBranch
      || gate?.commit !== identity?.commit
      || gate?.tree !== identity?.tree
      || gate?.commitUrl !== expectedCommitUrl
      || gate?.verification?.authenticatedGitHubApiResolvedExactCommitAndTree !== true
      || gate?.verification?.anonymousGitHubApiResolvedExactCommitAndTree !== true
      || gate?.verification?.authenticatedGitHubApiResolvedExactBranchHead !== true
  ) errors.push("canonical provenance publication");
  if (
    descriptorEvidence?.repository !== expectedRepository
      || descriptorEvidence?.branch !== expectedBranch
      || descriptorEvidence?.commit !== identity?.commit
      || descriptorEvidence?.tree !== identity?.tree
      || descriptorEvidence?.commitUrl !== expectedCommitUrl
      || descriptorEvidence?.authenticatedGitHubApiResolvedExactCommitAndTree !== true
      || descriptorEvidence?.anonymousGitHubApiResolvedExactCommitAndTree !== true
      || descriptorEvidence?.authenticatedGitHubApiResolvedExactBranchHead !== true
  ) errors.push("descriptor publication evidence");
  return errors;
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function sourceClassification(sourcePath) {
  if (sourcePath.startsWith("src/router_vnext/")) return "first-party-production";
  if (sourcePath.startsWith("dependencies/shards-launch-permit-")) return "frozen-interface-dependency";
  if (sourcePath.startsWith("lib/openzeppelin-contracts/")) return "openzeppelin-library-dependency";
  return "compiler-resolved-dependency";
}

export async function deriveProductionSourceClosure(root, descriptor) {
  const sources = new Map();
  const artifactSet = [];
  for (const contract of descriptor.contracts) {
    const artifactPath = path.join("out", path.basename(contract.sourcePath), `${contract.contractName}.json`);
    const artifact = await readJson(path.join(root, artifactPath));
    const artifactId = `${contract.sourcePath}:${contract.contractName}`;
    artifactSet.push(artifactId);
    for (const [sourcePath, metadata] of Object.entries(artifact.metadata?.sources ?? {})) {
      const source = await readFile(path.join(root, sourcePath));
      const actualSolcKeccak256 = keccak256Hex(`0x${source.toString("hex")}`);
      if (metadata.keccak256 !== actualSolcKeccak256) {
        throw new Error(`stale compiler source metadata: ${sourcePath}`);
      }
      const record = {
        path: sourcePath,
        sha256: sha256(source),
        solcKeccak256: actualSolcKeccak256,
        classification: sourceClassification(sourcePath)
      };
      const existing = sources.get(sourcePath);
      if (existing && canonicalJson(existing) !== canonicalJson(record)) {
        throw new Error(`compiler source closure conflict: ${sourcePath}`);
      }
      sources.set(sourcePath, record);
    }
  }
  const closure = {
    derivation: "solc-metadata-sources-union-v1",
    artifactSet: artifactSet.sort(),
    files: [...sources.values()].sort((a, b) => a.path.localeCompare(b.path))
  };
  closure.commitmentSha256 = sha256(canonicalJson(closure));
  return closure;
}

export function sourceClosureCommitment(closure) {
  return sha256(canonicalJson({
    derivation: closure.derivation,
    artifactSet: closure.artifactSet,
    files: closure.files
  }));
}

function slitherScopeIsConsistent(slither, productionSourceClosure) {
  const scope = slither?.scope;
  if (!scope || sourceClosureCommitment(productionSourceClosure) !== productionSourceClosure.commitmentSha256) {
    return false;
  }
  const firstPartyPaths = productionSourceClosure.files
    .filter((file) => file.classification === "first-party-production")
    .map((file) => file.path);
  const impactTotal = Object.values(scope.byImpact ?? {}).reduce((sum, count) => sum + count, 0);
  return (
    scope.productionSourceClosureCommitmentSha256 === productionSourceClosure.commitmentSha256
      && canonicalJson(scope.analyzedFirstPartyPaths) === canonicalJson(firstPartyPaths)
      && scope.scopedDetectorIds?.length === scope.detectorInstances
      && scope.scopedDetectorSetCommitmentSha256 === sha256(canonicalJson(scope.scopedDetectorIds))
      && impactTotal === scope.detectorInstances
      && scope.lowDetectorInstances === scope.lowTriage?.length
  );
}

export async function buildManifest(root, descriptor) {
  if (descriptor.activationAllowed !== false) throw new Error("activationAllowed must remain false");
  const contracts = [];
  for (const contract of descriptor.contracts) {
    const source = await readFile(path.join(root, contract.sourcePath));
    const artifactPath = path.join(root, "out", path.basename(contract.sourcePath), `${contract.contractName}.json`);
    const artifact = await readJson(artifactPath);
    const creation = artifact.bytecode.object;
    const runtime = artifact.deployedBytecode.object;
    const creationLength = bytecodeBytes(creation);
    const runtimeLength = bytecodeBytes(runtime);
    contracts.push({
      ...contract,
      sourceSha256: sha256(source),
      abiCanonicalSha256: sha256(canonicalJson(canonicalAbi(artifact.abi))),
      creationCodeKeccak256: keccak256Hex(creation),
      creationCodeLength: creationLength,
      eip3860Margin: EIP3860_LIMIT - creationLength,
      runtimeCodeKeccak256: keccak256Hex(runtime),
      runtimeCodeLength: runtimeLength,
      eip170Margin: EIP170_LIMIT - runtimeLength,
      immutableReferenceGroups: Object.keys(artifact.deployedBytecode.immutableReferences ?? {}).length,
      note: "Runtime hash is the canonical unpatched compiler runtime template. Deployment evidence must separately bind the immutable-patched onchain extcodehash."
    });
  }
  if (contracts.some((contract) => contract.eip170Required && contract.eip170Margin < 0)) {
    throw new Error("EIP-170 limit exceeded");
  }
  const productionSourceClosure = await deriveProductionSourceClosure(root, descriptor);
  const provenancePath = descriptor.sourceRevisions.sharedShardsAuthority.provenancePath;
  const slitherPath = descriptor.evidenceRequirements.slitherScopedTriagePath;
  const testEvidencePath = descriptor.evidenceRequirements.testEvidencePath;
  const receiptPath = descriptor.evidenceRequirements.actualV2ReceiptPath;
  const dependencyLockPath = descriptor.sourceRevisions.foundryDependencyLock.path;
  if (dependencyLockPath !== "dependencies/foundry-dependencies-v1.json") {
    throw new Error("unexpected dependency lock path");
  }
  const [provenanceBytes, slitherBytes, testEvidenceBytes, receiptBytes, dependencyLockBytes] = await Promise.all([
    readFile(path.join(root, provenancePath)),
    readFile(path.join(root, slitherPath)),
    readFile(path.join(root, testEvidencePath)),
    readFile(path.join(root, receiptPath)),
    readFile(path.join(root, dependencyLockPath))
  ]);
  const provenance = JSON.parse(provenanceBytes);
  const slither = JSON.parse(slitherBytes);
  const testEvidence = JSON.parse(testEvidenceBytes);
  const actualV2Receipt = JSON.parse(receiptBytes);
  const dependencyLock = JSON.parse(dependencyLockBytes);
  const { lock: validatedDependencyLock } = await readDependencyLock(root);
  if (canonicalJson(validatedDependencyLock) !== canonicalJson(dependencyLock)) {
    throw new Error("dependency lock validation mismatch");
  }
  const actualV2RawLogPath = actualV2Receipt.rawLog?.path;
  const actualV2RawLogBytes = await readFile(path.join(root, actualV2RawLogPath));
  const sharedRevision = descriptor.sourceRevisions.sharedShardsAuthority;
  const sourceBundle = provenance.sourceBundle;
  if (
    canonicalPublicationErrors(
      sharedRevision,
      provenance,
      descriptor.externalActivationGates?.sharedAuthorityCanonicalPublicationEvidence
    ).length !== 0
      || sourceBundle?.identity?.commit !== sharedRevision.localFrozenSourceBundle?.commit
      || sourceBundle?.identity?.tree !== sharedRevision.localFrozenSourceBundle?.tree
      || !Array.isArray(sourceBundle?.files) || sourceBundle.files.length !== 5
      || provenance.activationAllowed !== false
  ) throw new Error("shared Authority local source bundle or remote publication gate mismatch");
  const sourceBundlePaths = new Set();
  for (const file of sourceBundle.files) {
    const fileBytes = await readFile(path.join(root, path.dirname(provenancePath), file.path));
    if (
      sourceBundlePaths.has(file.path) || sha256(fileBytes) !== file.sha256
        || gitBlobId(fileBytes) !== file.gitBlob
        || !fileBytes.includes(Buffer.from("SPDX-License-Identifier: MIT"))
    ) throw new Error(`shared Authority source bundle mismatch: ${file.path}`);
    sourceBundlePaths.add(file.path);
  }
  if (
    slither.activationAllowed !== false || slither.scope.actionableHighFindings !== 0
      || slither.scope.actionableMediumFindings !== 0 || slither.scope.untriagedHighOrMediumFindings !== 0
      || slither.scope.byImpact.High !== 0 || slither.scope.byImpact.Medium !== 0
      || slither.scope.lowDetectorInstances !== slither.scope.lowTriage.length
      || !slitherScopeIsConsistent(slither, productionSourceClosure)
      || slither.rawReport.sha256 !== descriptor.evidenceRequirements.slitherReportSha256
      || slither.rawReport.byteLength !== descriptor.evidenceRequirements.slitherReportByteLength
      || slither.rawReport.detectorInstances !== descriptor.evidenceRequirements.slitherTotalDetectorInstances
      || slither.tool.slither !== descriptor.evidenceRequirements.slitherVersion
      || slither.rawReport.success !== true
      || slither.command !== `slither . --compile-force-framework foundry --exclude-dependencies --filter-paths 'lib/|test/|dependencies/' --json ${descriptor.evidenceRequirements.slitherReportPath}`
  ) throw new Error("Slither evidence mismatch or unresolved scoped finding");
  const requirements = descriptor.evidenceRequirements;
  const lifecycle = testEvidence.focusedSharedAuthorityRegistryLifecycle;
  const actualV2 = testEvidence.actualV2EntrypointEndToEnd;
  const isolatedBuilds = testEvidence.isolatedCleanBuildObservation;
  const profileArtifact = contracts.find((contract) => contract.contractName === "ProgrammableExactHookemonReusableNormalCreateProfileV2");
  const actualV2Source = await readFile(path.join(root, ACTUAL_V2_TEST_SOURCE));
  const foundryConfigBytes = await readFile(path.join(root, "foundry.toml"));
  const remappingsBytes = await readFile(path.join(root, "remappings.txt"));
  const testedSourceCommit = descriptor.sourceRevisions.testedCandidateSourceRevision.commit;
  const testedSourceTree = descriptor.sourceRevisions.testedCandidateSourceRevision.tree;
  const receiptErrors = actualV2ReceiptErrors(actualV2Receipt, actualV2RawLogBytes, {
    testedSourceCommit,
    testedSourceTree,
    testSourceSha256: sha256(actualV2Source),
    productionSourceClosure: productionSourceClosure.commitmentSha256,
    dependencyLockPath,
    dependencyLockSha256: sha256(dependencyLockBytes),
    foundryConfigSha256: sha256(foundryConfigBytes),
    remappingsSha256: sha256(remappingsBytes),
    sourceBundleCommitmentSha256: sha256(canonicalJson(sourceBundle))
  });
  if (
    testEvidence.activationAllowed !== false
      || receiptErrors.length !== 0
      || requirements.actualV2EndToEndTests !== "3 passed; 0 failed; 0 skipped"
      || actualV2?.receiptPath !== receiptPath || actualV2.rawLogCommitted !== true
      || !actualV2Source.includes(Buffer.from("launchExactHookemonV2"))
      || ACTUAL_V2_TEST_NAMES.some((testName) => !actualV2Source.includes(Buffer.from(`function ${testName}(`)))
      || requirements.isolatedCleanBuildsObserved !== 2
      || isolatedBuilds?.evidenceClass !== "LOCAL_OBSERVATION_RERUNNABLE_NOT_SELF_PROVING"
      || isolatedBuilds?.testedSourceCommit !== testedSourceCommit
      || isolatedBuilds?.testedSourceTree !== testedSourceTree
      || isolatedBuilds?.cleanBuildsCompared !== requirements.isolatedCleanBuildsObserved
      || isolatedBuilds?.artifactBindingsCanonicalSha256Build1 !== requirements.artifactBindingsCanonicalSha256
      || isolatedBuilds?.artifactBindingsCanonicalSha256Build2 !== requirements.artifactBindingsCanonicalSha256
      || sha256(canonicalJson(contracts)) !== requirements.artifactBindingsCanonicalSha256
      || dependencyLock.activationAllowed !== false || dependencyLock.dependencies?.length !== 12
      || descriptor.sourceRevisions.foundryDependencyLock.sha256 !== sha256(dependencyLockBytes)
      || descriptor.sourceRevisions.foundryDependencyLock.pinCount !== 12
      || descriptor.sourceRevisions.foundryDependencyLock.libTracked !== false
      || lifecycle?.result !== requirements.focusedLifecycleTests
      || testEvidence.focusedHookemonPostconditions?.result !== requirements.focusedPostconditionTests
      || testEvidence.fullForgeSuite?.result !== requirements.fullForgeSuite
      || lifecycle?.kernelRegistrationGasUsed !== requirements.measuredKernelRegistrationGas
      || lifecycle?.kernelRegistrationGasRegressionMaximum !== requirements.kernelRegistrationGasRegressionMaximum
      || lifecycle?.profileRuntimeByteRegressionMaximum !== requirements.profileRuntimeByteRegressionMaximum
      || requirements.measuredKernelRegistrationGas > requirements.kernelRegistrationGasRegressionMaximum
      || !profileArtifact || profileArtifact.runtimeCodeLength > requirements.profileRuntimeByteRegressionMaximum
  ) throw new Error("test evidence, Kernel gas, or Profile scan envelope mismatch");
  const manifest = {
    schemaVersion: 2,
    status: descriptor.reviewStatus,
    activationAllowed: false,
    deploymentAddresses: null,
    releaseActivationTransaction: null,
    reviewedInput: descriptor,
    artifacts: contracts,
    evidenceBindings: {
      sharedAuthorityProvenance: { path: provenancePath, sha256: sha256(provenanceBytes), content: provenance },
      frozenSharedAuthoritySourceBundle: sourceBundle,
      foundryDependencyLock: {
        path: dependencyLockPath,
        sha256: sha256(dependencyLockBytes),
        content: dependencyLock
      },
      productionSourceClosure,
      slitherTriage: { path: slitherPath, sha256: sha256(slitherBytes), content: slither },
      tests: { path: testEvidencePath, sha256: sha256(testEvidenceBytes), content: testEvidence },
      actualV2Receipt: { path: receiptPath, sha256: sha256(receiptBytes), content: actualV2Receipt },
      actualV2RawLog: {
        path: actualV2RawLogPath,
        sha256: sha256(actualV2RawLogBytes),
        byteLength: actualV2RawLogBytes.length
      }
    }
  };
  manifest.contentCommitmentSha256 = sha256(canonicalJson(manifest));
  return manifest;
}

export function verifySemanticAssertions(manifest) {
  const errors = [];
  const descriptor = manifest.reviewedInput;
  const boundary = descriptor?.productBoundary;
  if (manifest.activationAllowed !== false || descriptor?.activationAllowed !== false) errors.push("activation false");
  if (manifest.deploymentAddresses !== null || manifest.releaseActivationTransaction !== null) errors.push("null live evidence");
  const sharedRevision = descriptor?.sourceRevisions?.sharedShardsAuthority;
  const provenance = manifest.evidenceBindings?.sharedAuthorityProvenance?.content;
  const dependencyLock = manifest.evidenceBindings?.foundryDependencyLock;
  if (
    canonicalPublicationErrors(
      sharedRevision,
      provenance,
      descriptor?.externalActivationGates?.sharedAuthorityCanonicalPublicationEvidence
    ).length !== 0
      || !sharedRevision?.localFrozenSourceBundle?.commit
      || !sharedRevision?.localFrozenSourceBundle?.tree
      || provenance?.sourceBundle?.files?.length !== 5
  ) errors.push("shared Authority external publication gate");
  if (
    dependencyLock?.content?.activationAllowed !== false
      || dependencyLock?.content?.dependencies?.length !== 12
      || dependencyLock?.sha256 !== descriptor?.sourceRevisions?.foundryDependencyLock?.sha256
      || descriptor?.sourceRevisions?.foundryDependencyLock?.pinCount !== 12
      || descriptor?.sourceRevisions?.foundryDependencyLock?.libTracked !== false
  ) errors.push("foundry dependency lock");
  if (!boundary || boundary.hiddenManualPerLaunchTransition !== false) errors.push("no hidden transition");
  if (boundary?.registryPrivilegedPreauthorizationPerLaunch !== false) errors.push("no Registry preauth");
  for (const field of ["tokenName", "tokenSymbol", "applicant and funding wallet"]) {
    if (!boundary?.websiteSelectedAfterApproval?.includes(field)) errors.push(`website field ${field}`);
  }
  for (const field of [
    "complete contract graph and runtime set",
    "29,000 project plus 1,000 Programmable inclusive quote-fee policy",
    "position timelock and approved multisig holder semantics"
  ]) {
    if (!boundary?.durableTechnicalApproval?.includes(field)) errors.push(`durable field ${field}`);
  }
  if (!descriptor?.securitySemantics?.repositoryOnce?.includes("every later route")) errors.push("repo once");
  if (!descriptor?.securitySemantics?.rollback?.includes("rolls back")) errors.push("rollback");
  if (!descriptor?.securitySemantics?.registryWriter?.includes("only WRITER_ROLE")) errors.push("sole writer");
  if (!descriptor?.atomicOrder?.includes("registryRegisterFromSameBlockAuthorityConsumption")) errors.push("same block");
  if (manifest.artifacts?.some((artifact) => artifact.eip170Required && artifact.eip170Margin < 0)) {
    errors.push("EIP170");
  }
  const requirements = descriptor?.evidenceRequirements;
  const profileArtifact = manifest.artifacts?.find(
    (artifact) => artifact.contractName === "ProgrammableExactHookemonReusableNormalCreateProfileV2"
  );
  const lifecycle = manifest.evidenceBindings?.tests?.content?.focusedSharedAuthorityRegistryLifecycle;
  const actualV2ReceiptBinding = manifest.evidenceBindings?.actualV2Receipt;
  const actualV2Receipt = manifest.evidenceBindings?.actualV2Receipt?.content;
  const actualV2RawLog = manifest.evidenceBindings?.actualV2RawLog;
  if (
    !requirements || !profileArtifact || !lifecycle
      || requirements.measuredKernelRegistrationGas > requirements.kernelRegistrationGasRegressionMaximum
      || profileArtifact.runtimeCodeLength > requirements.profileRuntimeByteRegressionMaximum
      || lifecycle.kernelRegistrationGasUsed !== requirements.measuredKernelRegistrationGas
      || lifecycle.kernelRegistrationGasRegressionMaximum !== requirements.kernelRegistrationGasRegressionMaximum
      || lifecycle.profileRuntimeByteRegressionMaximum !== requirements.profileRuntimeByteRegressionMaximum
  ) errors.push("Kernel/Profile scan envelope");
  if (
    !actualV2ReceiptBinding || !actualV2Receipt || !actualV2RawLog
      || actualV2ReceiptBinding.path !== requirements?.actualV2ReceiptPath
      || actualV2Receipt.activationAllowed !== false
      || actualV2Receipt.receiptClass !== "LOCAL_ISOLATED_INTEGRATION_NOT_PRODUCTION_AUTHORITY_PROOF"
      || actualV2RawLog.sha256 !== actualV2Receipt.rawLog?.sha256
      || actualV2RawLog.byteLength !== actualV2Receipt.rawLog?.byteLength
      || actualV2RawLog.path !== actualV2Receipt.rawLog?.path
      || actualV2RawLog.path
        !== `security/receipts/hookemon-v2-actual-e2e-${actualV2RawLog.sha256?.slice(0, 8)}.log`
      || actualV2Receipt.command !== ACTUAL_V2_COMMAND
      || actualV2Receipt.toolchain?.forgeVersion !== ACTUAL_V2_FORGE_VERSION
      || actualV2Receipt.toolchain?.forgeCommit !== ACTUAL_V2_FORGE_COMMIT
      || actualV2Receipt.toolchain?.solcVersion !== ACTUAL_V2_SOLC_VERSION
      || actualV2Receipt.testedSourceRevision?.commit
        !== descriptor?.sourceRevisions?.testedCandidateSourceRevision?.commit
      || actualV2Receipt.testedSourceRevision?.tree
        !== descriptor?.sourceRevisions?.testedCandidateSourceRevision?.tree
      || actualV2Receipt.result?.passed !== 3 || actualV2Receipt.result?.failed !== 0
      || actualV2Receipt.result?.skipped !== 0
      || canonicalJson(actualV2Receipt.testNames) !== canonicalJson(ACTUAL_V2_TEST_NAMES)
      || !actualV2Receipt.limitations?.some((item) => item.includes("not production signer"))
  ) errors.push("actual V2 committed receipt");
  const closure = manifest.evidenceBindings?.productionSourceClosure;
  const slither = manifest.evidenceBindings?.slitherTriage?.content;
  if (
    !closure || !slither || !slitherScopeIsConsistent(slither, closure)
      || slither.activationAllowed !== false || slither.scope?.byImpact?.High !== 0
      || slither.scope?.byImpact?.Medium !== 0 || slither.scope?.actionableHighFindings !== 0
      || slither.scope?.actionableMediumFindings !== 0 || slither.scope?.untriagedHighOrMediumFindings !== 0
      || slither.tool?.slither !== requirements?.slitherVersion
      || slither.rawReport?.sha256 !== requirements?.slitherReportSha256
      || slither.rawReport?.byteLength !== requirements?.slitherReportByteLength
      || slither.rawReport?.detectorInstances !== requirements?.slitherTotalDetectorInstances
      || slither.rawReport?.success !== true
  ) errors.push("slither scope");
  return errors;
}
