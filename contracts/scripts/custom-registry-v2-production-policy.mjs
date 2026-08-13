import { readFile } from "node:fs/promises";
import path from "node:path";
import { bytesToHex, keccak256 } from "viem";

const EXPECTED_DESCRIPTOR_FIELDS = [
  "chainId",
  "launchWallet",
  "primaryContract",
  "primaryRuntimeCodeHash",
  "componentSetHash",
  "sourceArtifactHash",
  "configurationHash",
  "launchPlanHash",
  "projectCommitment",
  "marketMode",
  "protocolFeeBps",
];
const EXPECTED_DESCRIPTOR_TYPE =
  "LaunchDescriptorV2(uint256 chainId,address launchWallet,address primaryContract,bytes32 primaryRuntimeCodeHash,bytes32 componentSetHash,bytes32 sourceArtifactHash,bytes32 configurationHash,bytes32 launchPlanHash,bytes32 projectCommitment,uint8 marketMode,uint16 protocolFeeBps)";
const EXPECTED_APPROVAL_BINDING = {
  schema: "programmable.approval-registry-descriptor-binding.v3",
  domain: "programmable.approval-registry-descriptor-binding.v3",
  envelopeSchemaVersion: "1.0.0",
  audience: "programmable.custom-registry.v2",
  signature: "Ed25519-over-RFC8785-JCS-unsigned-envelope",
  releaseBindingSchema: "programmable.approval-registry-v2-release-binding.v2",
  releaseSupplementType: "approval-registry-v2-policy-split",
  approvalRepository: {
    repositoryId: "1318883798",
    repository: "0xprogrammable/programmable-open-hook-v2-internal",
    pullRequest: 31,
    base: "a0438feb095b0f5d55c37d7a2b62ec5bc2e8c3f9",
    sourceHead: "69fec69f661d224f7aa78264cbc2fc02ff20ae28",
    commit: "3c61bbb77cc7c3efb3fe4c8f9aca841dc55c9db0",
    tree: "c989d8697afdadcc151a5f1914b675d22d983258",
  },
  artifacts: {
    legacyPolicySchemaPath:
      "services/autonomous-approval-v1/schemas/approval-registry-v2-descriptor-binding-v1.schema.json",
    legacyPolicySchemaSha256:
      "0xd9e8f6cf8dc16cd0fbd34cd411a3c57d92d0fd925bb74ab25f1230510f66283d",
    schemaPath:
      "services/autonomous-approval-v1/schemas/approval-registry-v2-descriptor-binding-v2.schema.json",
    schemaSha256:
      "0x1a3449647184822eedb8a291911918880fb048355fda3877654cfc502cd78ca5",
    adapterPath:
      "services/autonomous-approval-v1/src/adapters/approval-registry-v2-descriptor-binding-v1.ts",
    adapterSha256:
      "0x8e74d43c9cb940eeddd5edc9974cca08961318a9512493b989e4ce51c9f854e2",
    archivePath:
      "services/autonomous-approval-v1/src/adapters/decision-receipt-key-epoch-archive-v1.ts",
    archiveSha256:
      "0xa88f849a9e128899decacd5da9af1c5cea92954c57f96bf49c5b1807889a0e3d",
    workerPath:
      "services/autonomous-approval-v1/src/internal/production-approval-registry-v2-descriptor-worker-v1.ts",
    workerSha256:
      "0xe5b597879d90ac95b552898279e3f367b8aae41597040af03d8cab972c8c6997",
  },
  approvalPolicyCommitment:
    "0xe9ae0d11c77f8ac815253099c926b4ae3846392f37da17f7b4f5083bf5fb1fde",
  policyCommitmentFields: [
    "approvalDescriptorSchemaPolicyCommitment",
    "registryOnchainPolicyCommitment",
  ],
  registryOnchainPolicyCommitmentDerivation:
    "keccak256 exact raw production policy document bytes, equal to deployed REGISTRY_POLICY_COMMITMENT",
  authority: {
    keyIdAndKeyEpochRequired: true,
    registryProjectionDeliveryAuthorityRequired: true,
    preAndPostSignCurrentnessRequired: true,
  },
  fieldMapping: {
    launchWallet: "eip155:<chainId> authenticated wallet",
    primaryRuntimeCodeHash:
      "keccak256 exact authenticated finalized runtime bytes and live EXTCODEHASH match",
    componentSetHash: "raw32 runtimeExpectationSetHash",
    sourceArtifactHash: "raw32 launchArtifactCommitmentHash",
    configurationHash: "raw32 root runtime expectation configurationHash",
    launchPlanHash: "raw32 semantic launchPlanHash",
    projectCommitment:
      "raw32 canonicalSha256 programmable.custom-registry-project.v3 over approvalRevision, decisionReceiptPayloadHash, grantBindingHash, headCommitOid, headRepositoryId, headTreeOid, launchArtifactCommitmentHash, policyHash, both named policyCommitments, pullRequest, routeBindingHash, routeSelectionBindingHash, signedDecisionReceiptArtifactHash, and sourceRevisionBindingHash",
    approvalEvidenceHash:
      "raw32 sha256 exact canonical signed authorization artifact",
    sha256Mappings: "strip sha256: prefix to raw bytes32 without rehash",
  },
  criteriaSemantics:
    "OUT_OF_SCOPE_APPLICANT_NEUTRAL_CRYPTOGRAPHIC_MAPPING_ONLY",
};

export async function loadCustomRegistryV2ProductionPolicy(root) {
  const constructorPath = path.join(
    root,
    "config/custom-registry-v2-production-constructor.json",
  );
  const constructorPolicy = JSON.parse(await readFile(constructorPath, "utf8"));
  if (
    constructorPolicy.schemaVersion !==
      "programmable.custom-registry-v2-production-constructor.v3" ||
    constructorPolicy.policyDocument !==
      "config/custom-registry-v2-production-policy.json" ||
    constructorPolicy.policyCommitmentAlgorithm !==
      "keccak256-raw-file-bytes" ||
    constructorPolicy.initialAdminDelaySeconds !== 172800 ||
    constructorPolicy.minimumFinalityBlocks !== 12 ||
    constructorPolicy.chainId !== "1" ||
    constructorPolicy.registryGeneration !== 2
  )
    throw new Error(
      "Custom Registry V2 production constructor policy is invalid",
    );

  const documentPath = path.join(root, constructorPolicy.policyDocument);
  const documentBytes = await readFile(documentPath);
  const policy = JSON.parse(documentBytes);
  if (
    policy.schemaVersion !==
      "programmable.custom-registry-v2-production-policy.v3" ||
    policy.registryGeneration !== 2 ||
    policy.chainId !== "1" ||
    policy.registrySource?.repositoryId !== "1314365508" ||
    policy.registrySource?.repository !== "0xprogrammable/programmable" ||
    policy.registrySource?.commit !==
      "d276f09c81fc4b182ad98cf96980a27c37d68643" ||
    policy.registrySource?.tree !==
      "8661c0a6655f7009b9f4b4a81af2cb0104b8e728" ||
    policy.descriptorBinding?.type !== EXPECTED_DESCRIPTOR_TYPE ||
    JSON.stringify(policy.descriptorBinding?.fields) !==
      JSON.stringify(EXPECTED_DESCRIPTOR_FIELDS) ||
    policy.descriptorBinding?.launchId !==
      "keccak256(abi.encode(LAUNCH_ID_DOMAIN,chainId,registryGeneration,descriptorHash))" ||
    JSON.stringify(policy.approvalDescriptorBinding) !==
      JSON.stringify(EXPECTED_APPROVAL_BINDING) ||
    policy.approval?.approvalEvidenceSingleUse !== true ||
    policy.registration?.registrationEvidenceSingleUse !== true ||
    policy.finality?.minimumFinalityBlocks !== 12 ||
    policy.finality?.canonicalNativeBlockhashRequired !== true ||
    policy.finality?.finalityEvidenceSingleUse !== true ||
    policy.revocation?.revocationEvidenceSingleUse !== true ||
    policy.profiles?.Standard10?.marketMode !== 1 ||
    policy.profiles?.Standard10?.protocolFeeBps !== 10 ||
    policy.profiles?.NoMarket0?.marketMode !== 0 ||
    policy.profiles?.NoMarket0?.protocolFeeBps !== 0 ||
    policy.controllerPolicy?.defaultAdminDelaySeconds !== 172800 ||
    policy.controllerPolicy?.operationalControllersMustHaveRuntimeCode !== true
  )
    throw new Error("Custom Registry V2 production policy document is invalid");

  return {
    constructorPolicy,
    policy,
    documentPath,
    documentBytes,
    registryPolicyCommitment: keccak256(bytesToHex(documentBytes)),
  };
}

export function assertCustomRegistryV2ProductionConstructor(config, loaded) {
  if (
    config.initialAdminDelay !==
      BigInt(loaded.constructorPolicy.initialAdminDelaySeconds) ||
    config.minimumFinalityBlocks !==
      BigInt(loaded.constructorPolicy.minimumFinalityBlocks) ||
    config.registryPolicyCommitment !== loaded.registryPolicyCommitment
  )
    throw new Error(
      "constructor does not match the committed production policy",
    );
}
