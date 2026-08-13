import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CUSTOM_REGISTRY_V2_EVENT_ABI,
  CUSTOM_REGISTRY_V2_EVENT_SIGNATURES,
} from "../lib/data-pipeline/custom-registry-v2-event-manifest";
import {
  computeCustomRegistryV2DescriptorHash,
  computeCustomRegistryV2LaunchId,
  parseCustomRegistryV2ApiRecord,
} from "../lib/server/custom-launch/registry-read-v2";

const hash = (byte: string) => `0x${byte.repeat(64)}`;
const address = (byte: string) => `0x${byte.repeat(40)}`;
const readBinding = {
  registryAddress: address("2") as `0x${string}`,
  registryRuntimeCodeHash: hash("3") as `0x${string}`,
  registryPolicyCommitment: hash("4") as `0x${string}`,
  minimumFinalityBlocks: "12",
};
const parse = (value: unknown) => parseCustomRegistryV2ApiRecord(value, readBinding);

function finalizedRecord(marketMode = 1, protocolFeeBps = 10) {
  const descriptor = {
    chainId: 1n,
    launchWallet: address("4") as `0x${string}`,
    primaryContract: address("3") as `0x${string}`,
    primaryRuntimeCodeHash: hash("5") as `0x${string}`,
    componentSetHash: hash("6") as `0x${string}`,
    sourceArtifactHash: hash("7") as `0x${string}`,
    configurationHash: hash("8") as `0x${string}`,
    launchPlanHash: hash("9") as `0x${string}`,
    projectCommitment: hash("a") as `0x${string}`,
    marketMode,
    protocolFeeBps,
  };
  const descriptorHash = computeCustomRegistryV2DescriptorHash(descriptor);
  return {
    schemaVersion: "programmable.custom-registry-v2-read.v1",
    generation: "2",
    chainId: "1",
    status: "finalized",
    registry: {
      address: address("2"),
      runtimeCodeHash: hash("3"),
      policyCommitment: hash("4"),
      minimumFinalityBlocks: "12",
    },
    launchId: computeCustomRegistryV2LaunchId(descriptorHash),
    descriptorHash,
    primaryContract: descriptor.primaryContract,
    launchWallet: descriptor.launchWallet,
    primaryRuntimeCodeHash: descriptor.primaryRuntimeCodeHash,
    componentSetHash: descriptor.componentSetHash,
    sourceArtifactHash: descriptor.sourceArtifactHash,
    configurationHash: descriptor.configurationHash,
    launchPlanHash: descriptor.launchPlanHash,
    projectCommitment: descriptor.projectCommitment,
    marketMode,
    protocolFeeBps,
    approval: { approvalId: hash("b"), evidenceHash: hash("c") },
    registration: {
      evidenceHash: hash("d"),
      transactionHash: hash("5"),
      observedAtBlock: "100",
      observedBlockHash: hash("f"),
      transactionIndex: "1",
      logIndex: "2",
      transitionSequence: "2",
    },
    finality: {
      evidenceHash: hash("e"),
      transactionHash: hash("6"),
      observedAtBlock: "100",
      observedBlockHash: hash("f"),
      confirmedHeadBlock: "112",
      confirmedHeadBlockHash: hash("1"),
      finalizedAtBlock: "113",
      finalizedBlockHash: hash("2"),
      transactionIndex: "3",
      logIndex: "4",
      transitionSequence: "3",
    },
  };
}

describe("Custom Registry V2 offchain bindings", () => {
  it("binds only the six generation 2 lifecycle and descriptor events", () => {
    expect(CUSTOM_REGISTRY_V2_EVENT_SIGNATURES).toEqual([
      "CustomLaunchApprovalAuthorizedV2(bytes32 indexed approvalId, bytes32 indexed descriptorHash, uint64 validAfterBlock, uint64 expiresAtBlock, bytes32 approvalEvidenceHash, uint64 transitionSequence)",
      "CustomLaunchRegisteredV2(bytes32 indexed launchId, bytes32 indexed descriptorHash, address indexed primaryContract, bytes32 approvalId, bytes32 approvalEvidenceHash, bytes32 registrationEvidenceHash, uint64 observedAtBlock, uint64 transitionSequence)",
      "CustomLaunchDescriptorCommittedV2(bytes32 indexed launchId, bytes32 indexed descriptorHash, address indexed primaryContract, address launchWallet, bytes32 primaryRuntimeCodeHash, bytes32 componentSetHash, bytes32 projectCommitment, uint8 marketMode, uint16 protocolFeeBps)",
      "CustomLaunchDescriptorEvidenceCommittedV2(bytes32 indexed launchId, bytes32 indexed sourceArtifactHash, bytes32 indexed configurationHash, bytes32 launchPlanHash)",
      "CustomLaunchFinalizedV2(bytes32 indexed launchId, bytes32 indexed descriptorHash, bytes32 indexed finalityEvidenceHash, uint64 observedAtBlock, bytes32 observedBlockHash, uint64 confirmedHeadBlock, bytes32 confirmedHeadBlockHash, uint64 finalizedAtBlock, uint64 transitionSequence)",
      "CustomLaunchRevokedV2(bytes32 indexed launchId, bytes32 indexed descriptorHash, bytes32 indexed revocationEvidenceHash, bytes32 reasonHash, uint64 revokedAtBlock, uint64 transitionSequence)",
    ]);
    expect(CUSTOM_REGISTRY_V2_EVENT_ABI).toHaveLength(6);
    const contractAbi = JSON.parse(readFileSync(resolve(
      process.cwd(),
      "docs/security/abi/ProgrammableCustomRegistryV2.json",
    ), "utf8")).abi as readonly Record<string, unknown>[];
    expect([...CUSTOM_REGISTRY_V2_EVENT_ABI]
      .map(normalizeEventAbi)
      .sort(compareAbiItems)).toEqual(
      contractAbi
        .filter((item) => item.type === "event"
          && String(item.name).startsWith("CustomLaunch"))
        .map(normalizeEventAbi)
        .sort(compareAbiItems),
    );
  });

  it("keeps the deployment and index source fail closed", () => {
    const deployment = JSON.parse(readFileSync(resolve(
      process.cwd(),
      "config/custom-registry-v2.deployment.prelaunch.json",
    ), "utf8"));
    expect(deployment).toMatchObject({
      status: "prelaunch",
      generation: "2",
      publicReadEnabled: false,
      indexingEnabled: false,
      registry: {
        address: null,
        runtimeCodeKeccak256: null,
        deploymentTransactionHash: null,
        deploymentBlock: null,
        deploymentBlockHash: null,
      },
      profiles: {
        NoMarket0: { marketMode: 0, protocolFeeBps: 0 },
        Standard10: { marketMode: 1, protocolFeeBps: 10 },
      },
    });

    const config = readFileSync(resolve(
      process.cwd(),
      "indexer/config.custom-registry-v2.prelaunch.yaml",
    ), "utf8");
    expect(config).toContain("status: prelaunch");
    expect(config).toContain("active: false");
    expect(config).toContain("address: null");
    expect(config).toContain("start_block: null");
    const configuredEvents = [...config.matchAll(/^  - "(.+)"$/gmu)]
      .map((match) => match[1]);
    expect(configuredEvents).toEqual(CUSTOM_REGISTRY_V2_EVENT_SIGNATURES);
  });

  it.each([
    [0, 0, "NoMarket0"],
    [1, 10, "Standard10"],
  ] as const)("maps mode %i and fee %i to %s", (marketMode, protocolFeeBps, profile) => {
    expect(parse({
      ...finalizedRecord(marketMode, protocolFeeBps),
    })).toMatchObject({ marketProfile: profile });
  });

  it.each([
    [0, 10],
    [1, 0],
    [1, 11],
    [2, 10],
  ])("rejects an unsupported mode/fee pair", (marketMode, protocolFeeBps) => {
    expect(() => parse({
      ...finalizedRecord(),
      marketMode,
      protocolFeeBps,
    })).toThrow(/market profile/u);
  });

  it("rejects non-final records, added fields and impossible finality", () => {
    expect(() => parse({
      ...finalizedRecord(),
      status: "registered",
    })).toThrow(/identity/u);
    expect(() => parse({
      ...finalizedRecord(),
      extra: true,
    })).toThrow(/keys/u);
    expect(() => parse({
      ...finalizedRecord(),
      finality: { ...finalizedRecord().finality, confirmedHeadBlock: "99" },
    })).toThrow(/block relation/u);
    expect(() => parse({
      ...finalizedRecord(),
      finality: { ...finalizedRecord().finality, transitionSequence: "2" },
    })).toThrow(/lifecycle sequence/u);
    expect(() => parse({
      ...finalizedRecord(),
      descriptorHash: `0x${"00".repeat(32)}`,
    })).toThrow(/descriptor hash/u);
    expect(() => parse({
      ...finalizedRecord(),
      launchId: hash("1"),
    })).toThrow(/launch id/u);
    expect(() => parse({
      ...finalizedRecord(),
      registry: { ...finalizedRecord().registry, minimumFinalityBlocks: "13" },
    })).toThrow(/release binding/u);
    expect(() => parse({
      ...finalizedRecord(),
      registration: { ...finalizedRecord().registration, observedBlockHash: hash("a") },
    })).toThrow(/block relation/u);
  });
});

function compareAbiItems(
  left: Readonly<{ name?: unknown }>,
  right: Readonly<{ name?: unknown }>,
): number {
  return String(left.name).localeCompare(String(right.name));
}

function normalizeEventAbi(value: unknown) {
  const event = value as Readonly<Record<string, unknown>>;
  return {
    type: event.type,
    name: event.name,
    inputs: (event.inputs as readonly Record<string, unknown>[]).map((input) => ({
      name: input.name,
      type: input.type,
      indexed: input.indexed === true,
    })),
  };
}
