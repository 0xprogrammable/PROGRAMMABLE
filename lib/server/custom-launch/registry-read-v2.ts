import "server-only";

import { encodeAbiParameters, getAddress, keccak256 } from "viem";

const HASH32 = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

export const CUSTOM_REGISTRY_V2_MARKET_PROFILES = Object.freeze({
  NoMarket0: Object.freeze({ marketMode: 0, protocolFeeBps: 0 }),
  Standard10: Object.freeze({ marketMode: 1, protocolFeeBps: 10 }),
} as const);

export type CustomRegistryV2MarketProfile =
  keyof typeof CUSTOM_REGISTRY_V2_MARKET_PROFILES;

export type CustomRegistryV2ApiRecord = Readonly<{
  schemaVersion: "programmable.custom-registry-v2-read.v1";
  generation: "2";
  chainId: "1";
  status: "finalized";
  registry: Readonly<{
    address: `0x${string}`;
    runtimeCodeHash: `0x${string}`;
    policyCommitment: `0x${string}`;
    minimumFinalityBlocks: string;
  }>;
  launchId: `0x${string}`;
  descriptorHash: `0x${string}`;
  primaryContract: `0x${string}`;
  launchWallet: `0x${string}`;
  primaryRuntimeCodeHash: `0x${string}`;
  componentSetHash: `0x${string}`;
  sourceArtifactHash: `0x${string}`;
  configurationHash: `0x${string}`;
  launchPlanHash: `0x${string}`;
  projectCommitment: `0x${string}`;
  marketProfile: CustomRegistryV2MarketProfile;
  approval: Readonly<{
    approvalId: `0x${string}`;
    evidenceHash: `0x${string}`;
  }>;
  registration: Readonly<{
    evidenceHash: `0x${string}`;
    transactionHash: `0x${string}`;
    observedAtBlock: string;
    observedBlockHash: `0x${string}`;
    transactionIndex: string;
    logIndex: string;
    transitionSequence: string;
  }>;
  finality: Readonly<{
    evidenceHash: `0x${string}`;
    transactionHash: `0x${string}`;
    observedAtBlock: string;
    observedBlockHash: `0x${string}`;
    confirmedHeadBlock: string;
    confirmedHeadBlockHash: `0x${string}`;
    finalizedAtBlock: string;
    finalizedBlockHash: `0x${string}`;
    transactionIndex: string;
    logIndex: string;
    transitionSequence: string;
  }>;
}>;

export type CustomRegistryV2ReadBinding = Readonly<{
  registryAddress: `0x${string}`;
  registryRuntimeCodeHash: `0x${string}`;
  registryPolicyCommitment: `0x${string}`;
  minimumFinalityBlocks: string;
}>;

export function parseCustomRegistryV2ApiRecord(
  value: unknown,
  binding: CustomRegistryV2ReadBinding,
): CustomRegistryV2ApiRecord {
  const source = exactObject(value, "Custom Registry V2 read record", [
    "approval",
    "chainId",
    "componentSetHash",
    "configurationHash",
    "descriptorHash",
    "finality",
    "generation",
    "launchId",
    "launchPlanHash",
    "launchWallet",
    "marketMode",
    "primaryContract",
    "primaryRuntimeCodeHash",
    "projectCommitment",
    "protocolFeeBps",
    "registry",
    "registration",
    "schemaVersion",
    "sourceArtifactHash",
    "status",
  ]);
  if (
    source.schemaVersion !== "programmable.custom-registry-v2-read.v1"
    || source.generation !== "2"
    || source.chainId !== "1"
    || source.status !== "finalized"
  ) throw new TypeError("Custom Registry V2 read identity is invalid");

  const marketProfile = parseMarketProfile(
    source.marketMode,
    source.protocolFeeBps,
  );
  const registry = exactObject(source.registry, "registry identity", [
    "address",
    "minimumFinalityBlocks",
    "policyCommitment",
    "runtimeCodeHash",
  ]);
  const approval = exactObject(source.approval, "approval evidence", [
    "approvalId",
    "evidenceHash",
  ]);
  const registration = exactObject(source.registration, "registration evidence", [
    "evidenceHash",
    "logIndex",
    "observedAtBlock",
    "observedBlockHash",
    "transactionHash",
    "transactionIndex",
    "transitionSequence",
  ]);
  const finality = exactObject(source.finality, "finality evidence", [
    "confirmedHeadBlock",
    "confirmedHeadBlockHash",
    "evidenceHash",
    "finalizedAtBlock",
    "finalizedBlockHash",
    "logIndex",
    "observedAtBlock",
    "observedBlockHash",
    "transactionHash",
    "transactionIndex",
    "transitionSequence",
  ]);

  const registrationSequence = decimal(
    registration.transitionSequence,
    "registration transition sequence",
  );
  const finalitySequence = decimal(
    finality.transitionSequence,
    "finality transition sequence",
  );
  if (BigInt(finalitySequence) <= BigInt(registrationSequence)) {
    throw new TypeError("Custom Registry V2 lifecycle sequence is invalid");
  }
  const registrationBlock = decimal(
    registration.observedAtBlock,
    "registration observation block",
  );
  const observedAtBlock = decimal(
    finality.observedAtBlock,
    "finality observation block",
  );
  const confirmedHeadBlock = decimal(
    finality.confirmedHeadBlock,
    "confirmed head block",
  );
  const finalizedAtBlock = decimal(
    finality.finalizedAtBlock,
    "finalized block",
  );
  const minimumFinalityBlocks = decimal(
    registry.minimumFinalityBlocks,
    "minimum finality blocks",
  );
  if (BigInt(minimumFinalityBlocks) < 1n || BigInt(minimumFinalityBlocks) > 255n) {
    throw new TypeError("Custom Registry V2 minimum finality is invalid");
  }
  const registryAddress = address(registry.address, "registry address");
  const registryRuntimeCodeHash = hash32(registry.runtimeCodeHash, "registry runtime code hash");
  const registryPolicyCommitment = hash32(registry.policyCommitment, "registry policy commitment");
  if (
    registryAddress !== address(binding.registryAddress, "bound registry address")
    || registryRuntimeCodeHash !== hash32(
      binding.registryRuntimeCodeHash,
      "bound registry runtime code hash",
    )
    || registryPolicyCommitment !== hash32(
      binding.registryPolicyCommitment,
      "bound registry policy commitment",
    )
    || minimumFinalityBlocks !== decimal(
      binding.minimumFinalityBlocks,
      "bound minimum finality blocks",
    )
  ) throw new TypeError("Custom Registry V2 release binding is invalid");
  const registrationObservedBlockHash = hash32(
    registration.observedBlockHash,
    "registration observed block hash",
  );
  const finalityObservedBlockHash = hash32(
    finality.observedBlockHash,
    "finality observed block hash",
  );
  if (
    BigInt(observedAtBlock) !== BigInt(registrationBlock)
    || registrationObservedBlockHash !== finalityObservedBlockHash
    || BigInt(confirmedHeadBlock)
      < BigInt(observedAtBlock) + BigInt(minimumFinalityBlocks)
    || BigInt(finalizedAtBlock) <= BigInt(confirmedHeadBlock)
  ) throw new TypeError("Custom Registry V2 finality block relation is invalid");

  const chainId = 1n;
  const descriptorHash = computeCustomRegistryV2DescriptorHash({
    chainId,
    launchWallet: address(source.launchWallet, "launch wallet"),
    primaryContract: address(source.primaryContract, "primary contract"),
    primaryRuntimeCodeHash: hash32(source.primaryRuntimeCodeHash, "primary runtime code hash"),
    componentSetHash: hash32(source.componentSetHash, "component set hash"),
    sourceArtifactHash: hash32(source.sourceArtifactHash, "source artifact hash"),
    configurationHash: hash32(source.configurationHash, "configuration hash"),
    launchPlanHash: hash32(source.launchPlanHash, "launch plan hash"),
    projectCommitment: hash32(source.projectCommitment, "project commitment"),
    marketMode: marketProfile === "Standard10" ? 1 : 0,
    protocolFeeBps: marketProfile === "Standard10" ? 10 : 0,
  });
  const suppliedDescriptorHash = hash32(source.descriptorHash, "descriptor hash");
  if (descriptorHash !== suppliedDescriptorHash) {
    throw new TypeError("Custom Registry V2 descriptor hash is invalid");
  }
  const launchId = computeCustomRegistryV2LaunchId(descriptorHash, chainId);
  if (launchId !== hash32(source.launchId, "launch id")) {
    throw new TypeError("Custom Registry V2 launch id is invalid");
  }

  return Object.freeze({
    schemaVersion: "programmable.custom-registry-v2-read.v1" as const,
    generation: "2" as const,
    chainId: "1" as const,
    status: "finalized" as const,
    registry: Object.freeze({
      address: registryAddress,
      runtimeCodeHash: registryRuntimeCodeHash,
      policyCommitment: registryPolicyCommitment,
      minimumFinalityBlocks,
    }),
    launchId,
    descriptorHash,
    primaryContract: address(source.primaryContract, "primary contract"),
    launchWallet: address(source.launchWallet, "launch wallet"),
    primaryRuntimeCodeHash: hash32(
      source.primaryRuntimeCodeHash,
      "primary runtime code hash",
    ),
    componentSetHash: hash32(source.componentSetHash, "component set hash"),
    sourceArtifactHash: hash32(source.sourceArtifactHash, "source artifact hash"),
    configurationHash: hash32(source.configurationHash, "configuration hash"),
    launchPlanHash: hash32(source.launchPlanHash, "launch plan hash"),
    projectCommitment: hash32(source.projectCommitment, "project commitment"),
    marketProfile,
    approval: Object.freeze({
      approvalId: hash32(approval.approvalId, "approval id"),
      evidenceHash: hash32(approval.evidenceHash, "approval evidence hash"),
    }),
    registration: Object.freeze({
      evidenceHash: hash32(
        registration.evidenceHash,
        "registration evidence hash",
      ),
      transactionHash: hash32(registration.transactionHash, "registration transaction hash"),
      observedAtBlock: registrationBlock,
      observedBlockHash: registrationObservedBlockHash,
      transactionIndex: decimal(registration.transactionIndex, "registration transaction index"),
      logIndex: decimal(registration.logIndex, "registration log index"),
      transitionSequence: registrationSequence,
    }),
    finality: Object.freeze({
      evidenceHash: hash32(finality.evidenceHash, "finality evidence hash"),
      transactionHash: hash32(finality.transactionHash, "finality transaction hash"),
      observedAtBlock,
      observedBlockHash: finalityObservedBlockHash,
      confirmedHeadBlock,
      confirmedHeadBlockHash: hash32(
        finality.confirmedHeadBlockHash,
        "confirmed head block hash",
      ),
      finalizedAtBlock,
      finalizedBlockHash: hash32(finality.finalizedBlockHash, "finalized block hash"),
      transactionIndex: decimal(finality.transactionIndex, "finality transaction index"),
      logIndex: decimal(finality.logIndex, "finality log index"),
      transitionSequence: finalitySequence,
    }),
  });
}

const DESCRIPTOR_TYPEHASH = keccak256(new TextEncoder().encode(
  "LaunchDescriptorV2(uint256 chainId,address launchWallet,address primaryContract,bytes32 primaryRuntimeCodeHash,bytes32 componentSetHash,bytes32 sourceArtifactHash,bytes32 configurationHash,bytes32 launchPlanHash,bytes32 projectCommitment,uint8 marketMode,uint16 protocolFeeBps)",
));
const LAUNCH_ID_DOMAIN = keccak256(new TextEncoder().encode(
  "programmable.custom-launch-id.v2",
));

export function computeCustomRegistryV2DescriptorHash(descriptor: Readonly<{
  chainId: bigint;
  launchWallet: `0x${string}`;
  primaryContract: `0x${string}`;
  primaryRuntimeCodeHash: `0x${string}`;
  componentSetHash: `0x${string}`;
  sourceArtifactHash: `0x${string}`;
  configurationHash: `0x${string}`;
  launchPlanHash: `0x${string}`;
  projectCommitment: `0x${string}`;
  marketMode: number;
  protocolFeeBps: number;
}>): `0x${string}` {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "uint256" }, { type: "address" },
      { type: "address" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "uint8" }, { type: "uint16" },
    ],
    [
      DESCRIPTOR_TYPEHASH,
      descriptor.chainId,
      getAddress(descriptor.launchWallet),
      getAddress(descriptor.primaryContract),
      descriptor.primaryRuntimeCodeHash,
      descriptor.componentSetHash,
      descriptor.sourceArtifactHash,
      descriptor.configurationHash,
      descriptor.launchPlanHash,
      descriptor.projectCommitment,
      descriptor.marketMode,
      descriptor.protocolFeeBps,
    ],
  ));
}

export function computeCustomRegistryV2LaunchId(
  descriptorHash: `0x${string}`,
  chainId = 1n,
): `0x${string}` {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32" }],
    [LAUNCH_ID_DOMAIN, chainId, 2n, descriptorHash],
  ));
}

function parseMarketProfile(
  marketMode: unknown,
  protocolFeeBps: unknown,
): CustomRegistryV2MarketProfile {
  if (marketMode === 0 && protocolFeeBps === 0) return "NoMarket0";
  if (marketMode === 1 && protocolFeeBps === 10) return "Standard10";
  throw new TypeError("Custom Registry V2 market profile is invalid");
}

function exactObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) throw new TypeError(`${label} keys are invalid`);
  return value as Record<string, unknown>;
}

function hash32(value: unknown, label: string): `0x${string}` {
  if (
    typeof value !== "string"
    || !HASH32.test(value)
    || value === `0x${"00".repeat(32)}`
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as `0x${string}`;
}

function address(value: unknown, label: string): `0x${string}` {
  if (
    typeof value !== "string"
    || !ADDRESS.test(value)
    || value === `0x${"00".repeat(20)}`
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as `0x${string}`;
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
