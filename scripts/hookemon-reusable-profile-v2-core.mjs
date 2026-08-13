import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const EIP170_LIMIT = 24_576;
export const EIP3860_LIMIT = 49_152;

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
  const [provenanceBytes, slitherBytes, testEvidenceBytes] = await Promise.all([
    readFile(path.join(root, provenancePath)),
    readFile(path.join(root, slitherPath)),
    readFile(path.join(root, testEvidencePath))
  ]);
  const provenance = JSON.parse(provenanceBytes);
  const slither = JSON.parse(slitherBytes);
  const testEvidence = JSON.parse(testEvidenceBytes);
  const sharedRevision = descriptor.sourceRevisions.sharedShardsAuthority;
  const sourceBundle = provenance.sourceBundle;
  if (
    provenance.remoteReachabilityProven !== false
      || sharedRevision.remoteReachabilityProven !== false
      || sourceBundle?.identity?.commit !== sharedRevision.localFrozenSourceBundle?.commit
      || sourceBundle?.identity?.tree !== sharedRevision.localFrozenSourceBundle?.tree
      || !Array.isArray(sourceBundle?.files) || sourceBundle.files.length !== 5
      || provenance.activationAllowed !== false
      || provenance.releasePublicationGate?.satisfied !== false
      || descriptor.externalActivationGates?.sharedAuthorityCanonicalPublicationEvidence !== null
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
  const reproducibleBuilds = testEvidence.reproducibleNormalBuilds;
  const profileArtifact = contracts.find((contract) => contract.contractName === "ProgrammableExactHookemonReusableNormalCreateProfileV2");
  const actualV2Source = actualV2?.testSourcePath
    ? await readFile(path.join(root, actualV2.testSourcePath))
    : null;
  if (
    testEvidence.activationAllowed !== false
      || actualV2?.result !== requirements.actualV2EndToEndTests
      || !actualV2Source || actualV2.testSourceSha256 !== sha256(actualV2Source)
      || actualV2.entrypoint !== "launchExactHookemonV2"
      || actualV2.testNames?.length !== 3
      || !actualV2Source.includes(Buffer.from("launchExactHookemonV2"))
      || actualV2.testNames.some((testName) => !actualV2Source.includes(Buffer.from(`function ${testName}(`)))
      || requirements.reproducibleCleanBuilds !== 2
      || reproducibleBuilds?.cleanBuildsCompared !== requirements.reproducibleCleanBuilds
      || reproducibleBuilds?.artifactBindingsCanonicalSha256Build1 !== requirements.artifactBindingsCanonicalSha256
      || reproducibleBuilds?.artifactBindingsCanonicalSha256Build2 !== requirements.artifactBindingsCanonicalSha256
      || sha256(canonicalJson(contracts)) !== requirements.artifactBindingsCanonicalSha256
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
      productionSourceClosure,
      slitherTriage: { path: slitherPath, sha256: sha256(slitherBytes), content: slither },
      tests: { path: testEvidencePath, sha256: sha256(testEvidenceBytes), content: testEvidence }
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
  if (
    sharedRevision?.remoteReachabilityProven !== false
      || !sharedRevision?.localFrozenSourceBundle?.commit
      || !sharedRevision?.localFrozenSourceBundle?.tree
      || provenance?.remoteReachabilityProven !== false
      || provenance?.releasePublicationGate?.satisfied !== false
      || provenance?.sourceBundle?.files?.length !== 5
      || descriptor?.externalActivationGates?.sharedAuthorityCanonicalPublicationEvidence !== null
  ) errors.push("shared Authority external publication gate");
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
  if (
    !requirements || !profileArtifact || !lifecycle
      || requirements.measuredKernelRegistrationGas > requirements.kernelRegistrationGasRegressionMaximum
      || profileArtifact.runtimeCodeLength > requirements.profileRuntimeByteRegressionMaximum
      || lifecycle.kernelRegistrationGasUsed !== requirements.measuredKernelRegistrationGas
      || lifecycle.kernelRegistrationGasRegressionMaximum !== requirements.kernelRegistrationGasRegressionMaximum
      || lifecycle.profileRuntimeByteRegressionMaximum !== requirements.profileRuntimeByteRegressionMaximum
  ) errors.push("Kernel/Profile scan envelope");
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
