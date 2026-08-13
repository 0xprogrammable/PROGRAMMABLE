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

export async function loadCustomRegistryV2ProductionPolicy(root) {
  const constructorPath = path.join(
    root,
    "config/custom-registry-v2-production-constructor.json",
  );
  const constructorPolicy = JSON.parse(await readFile(constructorPath, "utf8"));
  if (
    constructorPolicy.schemaVersion !==
      "programmable.custom-registry-v2-production-constructor.v1" ||
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
      "programmable.custom-registry-v2-production-policy.v1" ||
    policy.registryGeneration !== 2 ||
    policy.chainId !== "1" ||
    policy.registrySource?.repositoryId !== "1314365508" ||
    policy.registrySource?.repository !== "0xprogrammable/programmable" ||
    policy.registrySource?.commit !==
      "d276f09c81fc4b182ad98cf96980a27c37d68643" ||
    policy.registrySource?.tree !==
      "8661c0a6655f7009b9f4b4a81af2cb0104b8e728" ||
    JSON.stringify(policy.descriptorBinding?.fields) !==
      JSON.stringify(EXPECTED_DESCRIPTOR_FIELDS) ||
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
