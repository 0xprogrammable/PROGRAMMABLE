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

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
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
  if (
    provenance.upstream.commit !== descriptor.sourceRevisions.sharedShardsAuthority.commit
      || provenance.upstream.tree !== descriptor.sourceRevisions.sharedShardsAuthority.tree
  ) throw new Error("shared Authority provenance mismatch");
  if (
    slither.activationAllowed !== false || slither.scope.actionableHighFindings !== 0
      || slither.scope.actionableMediumFindings !== 0 || slither.scope.untriagedHighOrMediumFindings !== 0
      || slither.scope.byImpact.High !== 0 || slither.scope.byImpact.Medium !== 0
      || slither.scope.lowDetectorInstances !== slither.scope.lowTriage.length
      || slither.rawReport.sha256 !== descriptor.evidenceRequirements.slitherReportSha256
      || slither.rawReport.byteLength !== descriptor.evidenceRequirements.slitherReportByteLength
      || slither.rawReport.detectorInstances !== descriptor.evidenceRequirements.slitherTotalDetectorInstances
  ) throw new Error("Slither evidence mismatch or unresolved scoped finding");
  const requirements = descriptor.evidenceRequirements;
  const lifecycle = testEvidence.focusedSharedAuthorityRegistryLifecycle;
  const profileArtifact = contracts.find((contract) => contract.contractName === "ProgrammableExactHookemonReusableNormalCreateProfileV2");
  if (
    testEvidence.activationAllowed !== false
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
  const slither = manifest.evidenceBindings?.slitherTriage?.content;
  if (slither && (
    slither.activationAllowed !== false || slither.scope?.byImpact?.High !== 0 || slither.scope?.byImpact?.Medium !== 0
      || slither.scope?.actionableHighFindings !== 0 || slither.scope?.actionableMediumFindings !== 0
      || slither.scope?.untriagedHighOrMediumFindings !== 0
  )) errors.push("slither scope");
  return errors;
}
