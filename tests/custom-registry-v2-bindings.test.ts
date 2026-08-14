import { createHash } from "node:crypto";
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

  it("binds the finalized deployment and immutable release artifacts", () => {
    const deployment = JSON.parse(readFileSync(resolve(
      process.cwd(),
      "config/custom-registry-v2.deployment.prelaunch.json",
    ), "utf8"));
    expect(deployment).toMatchObject({
      status: "live",
      generation: "2",
      publicReadEnabled: true,
      indexingEnabled: true,
      registry: {
        address: "0x845506084a1AfB969fa4DeF444A2bdeEe794AAad",
        runtimeCodeKeccak256:
          "0x74d8196e2d40d030c66b147e835cbdf6dd0ab61c964fb3ef3890d86ed7daf074",
        deploymentTransactionHash:
          "0x49d3f19cf9f8afdc307892a95a880652ad7c6c4763458e5846eef78ef60b2ed5",
        deploymentBlock: "25749665",
        deploymentBlockHash:
          "0x84eeb4d264b75c2b89fb56ce5b941dfd8ef6de18181b6d2bff34fbb7c9692127",
      },
      release: {
        sourceCommit: "269ffbd4efc26f0f9c666b025a397b67c425b03f",
        sourceTree: "41a137ab93cc6ce9eff4f4d61d6d85581b8e5048",
        sourceArtifactSha256:
          "sha256:a456dd803d9322a886481cb31e066c60b02fd7d995ea32d6e5e20f034f16480a",
        abiArtifactSha256:
          "sha256:46d0aebd00c0eb7b9a152cb0e230f7777e367397e8c2f1b130c276c1309df4eb",
        eventSetSha256:
          "sha256:e6bf7f9affb1141bb2e4e1b347616e66ca8055aeb7e072ff600de85cfbeb1ef5",
      },
      finality: {
        minimumConfirmations: "12",
        policyBindingHash:
          "0xa51733b58306cf89580bd3c4f39935583db3196c3ab62ecd73644fff2e13b892",
      },
      profiles: {
        NoMarket0: { marketMode: 0, protocolFeeBps: 0 },
        Standard10: { marketMode: 1, protocolFeeBps: 10 },
      },
    });

    for (const [path, expected] of [
      [
        "docs/security/abi/ProgrammableCustomRegistryV2.json",
        "46d0aebd00c0eb7b9a152cb0e230f7777e367397e8c2f1b130c276c1309df4eb",
      ],
      [
        "docs/security/CUSTOM_REGISTRY_EVENT_SET_V2.json",
        "e6bf7f9affb1141bb2e4e1b347616e66ca8055aeb7e072ff600de85cfbeb1ef5",
      ],
    ] as const) {
      expect(createHash("sha256").update(readFileSync(resolve(
        process.cwd(), path,
      ))).digest("hex")).toBe(expected);
    }
  });

  it("keeps the separate indexer source fail closed", () => {
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
