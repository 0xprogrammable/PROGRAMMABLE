import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createGenericLaunchRecordV2,
  parseGenericLaunchRecordV2,
  type GenericLaunchSourceProjectionV2,
} from "../lib/server/custom-launch/generic-launch-contract-v2";

const sha = (character: string) => `sha256:${character.repeat(64)}` as const;
const hash = (character: string) => `0x${character.repeat(64)}` as const;
const address = (character: string) => `0x${character.repeat(40)}` as const;
const READ_MODEL_BINDING = sha("f");

function record(sourceProjection = projection()) {
  return createGenericLaunchRecordV2({
    sourceProjection,
    readModelBindingHash: READ_MODEL_BINDING,
  });
}

function projection(): GenericLaunchSourceProjectionV2 {
  return {
    schemaVersion: "programmable.generic-launch-source-projection.v2",
    sourceRevision: {
      repositoryId: "123456789",
      repositoryFullName: "alice/example-hook",
      commitObjectId: "a".repeat(40),
      treeObjectId: "b".repeat(40),
    },
    approval: {
      approvalRevision: "7",
      approvalId: hash("1"),
      approvalEvidenceHash: hash("2"),
      signedReceiptArtifactHash: sha("2"),
    },
    descriptor: {
      descriptorHash: hash("3"),
      launchId: hash("4"),
      launchWallet: address("5"),
      primaryContract: address("7"),
      primaryRuntimeCodeHash: hash("8"),
      componentSetHash: hash("9"),
      sourceArtifactHash: hash("a"),
      configurationHash: hash("b"),
      launchPlanHash: hash("c"),
      projectCommitment: hash("d"),
      marketMode: "Standard10",
      marketModeValue: 1,
      protocolFeeBps: 10,
    },
    lifecycle: {
      chainId: "1",
      generation: "2",
      registryAddress: address("6"),
      registryRuntimeCodeKeccak256: hash("7"),
      registryPolicyCommitment: hash("8"),
      minimumFinalityBlocks: "12",
      primaryLaunch: {
        transactionHash: hash("9"),
        sender: address("5"),
        blockHash: hash("a"),
        blockNumber: "88",
        transactionIndex: "2",
        status: "success",
      },
      authorization: {
        eventName: "CustomLaunchApprovalAuthorizedV2",
        transactionHash: hash("a"),
        blockHash: hash("b"),
        blockNumber: "90",
        transactionIndex: "3",
        logIndex: "4",
        removed: false,
      },
      registration: [
        {
          eventName: "CustomLaunchRegisteredV2",
          transactionHash: hash("b"),
          blockHash: hash("c"),
          blockNumber: "95",
          transactionIndex: "4",
          logIndex: "5",
          removed: false,
        },
        {
          eventName: "CustomLaunchDescriptorCommittedV2",
          transactionHash: hash("b"),
          blockHash: hash("c"),
          blockNumber: "95",
          transactionIndex: "4",
          logIndex: "6",
          removed: false,
        },
        {
          eventName: "CustomLaunchDescriptorEvidenceCommittedV2",
          transactionHash: hash("b"),
          blockHash: hash("c"),
          blockNumber: "95",
          transactionIndex: "4",
          logIndex: "7",
          removed: false,
        },
      ],
      finalization: {
        eventName: "CustomLaunchFinalizedV2",
        transactionHash: hash("c"),
        blockHash: hash("d"),
        blockNumber: "100",
        transactionIndex: "5",
        logIndex: "8",
        removed: false,
      },
      latestCommonHead: "112",
      latestCommonHeadHash: hash("e"),
      latestStatus: "finalized",
      revokedAtBlock: "0",
      revocationEvidenceHash: hash("0"),
    },
  };
}

describe("Generic launch record V2", () => {
  it("content-addresses the exact public Approval and Registry projection", () => {
    const value = record();
    expect(parseGenericLaunchRecordV2(value)).toEqual(value);
    expect(value.sourceProjectionHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(value.recordHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(value.sourceProjection).toEqual(projection());
  });

  it("rejects an approval artifact that does not join raw to onchain evidence", () => {
    const sourceProjection = projection();
    expect(() => record({
      ...sourceProjection,
      approval: {
        ...sourceProjection.approval,
        signedReceiptArtifactHash: sha("f"),
      },
    })).toThrow(/artifact\/evidence join/u);
  });

  it.each([
    ["revoked status", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      lifecycle: { ...candidate.lifecycle, latestStatus: "revoked" },
    })],
    ["revoked block", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      lifecycle: { ...candidate.lifecycle, revokedAtBlock: "111" },
    })],
    ["revocation evidence", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      lifecycle: { ...candidate.lifecycle, revocationEvidenceHash: hash("f") },
    })],
    ["wrong generation", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      lifecycle: { ...candidate.lifecycle, generation: "1" },
    })],
  ])("rejects %s", (_label, mutate) => {
    expect(() => record(
      mutate(projection()) as GenericLaunchSourceProjectionV2,
    )).toThrow(/finalized and non-revoked/u);
  });

  it("requires the common finalized head to cover the exact finality depth", () => {
    const sourceProjection = projection();
    expect(() => record({
      ...sourceProjection,
      lifecycle: { ...sourceProjection.lifecycle, latestCommonHead: "111" },
    })).toThrow(/finality is insufficient/u);
  });

  it("binds the independently verified primary receipt sender to the launch wallet", () => {
    const sourceProjection = projection();
    expect(() => record({
      ...sourceProjection,
      lifecycle: {
        ...sourceProjection.lifecycle,
        primaryLaunch: {
          ...sourceProjection.lifecycle.primaryLaunch,
          sender: address("f"),
        },
      },
    })).toThrow(/primary launch sender/u);
  });

  it.each([
    ["launch wallet", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      descriptor: { ...candidate.descriptor, launchWallet: address("0") },
    })],
    ["primary contract", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      descriptor: { ...candidate.descriptor, primaryContract: address("0") },
    })],
    ["registry address", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      lifecycle: { ...candidate.lifecycle, registryAddress: address("0") },
    })],
  ])("rejects a zero %s", (_label, mutate) => {
    expect(() => record(
      mutate(projection()) as GenericLaunchSourceProjectionV2,
    )).toThrow(/invalid/u);
  });

  it.each([
    ["primary after authorization", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      lifecycle: {
        ...candidate.lifecycle,
        primaryLaunch: {
          ...candidate.lifecycle.primaryLaunch,
          blockNumber: "91",
        },
      },
    })],
    ["primary later in authorization block", (
      candidate: GenericLaunchSourceProjectionV2,
    ) => ({
      ...candidate,
      lifecycle: {
        ...candidate.lifecycle,
        primaryLaunch: {
          ...candidate.lifecycle.primaryLaunch,
          blockNumber: "90",
          transactionIndex: "3",
        },
      },
    })],
    ["authorization after registration", (
      candidate: GenericLaunchSourceProjectionV2,
    ) => ({
      ...candidate,
      lifecycle: {
        ...candidate.lifecycle,
        authorization: {
          ...candidate.lifecycle.authorization,
          blockNumber: "96",
        },
      },
    })],
    ["finalization before registration", (
      candidate: GenericLaunchSourceProjectionV2,
    ) => ({
      ...candidate,
      lifecycle: {
        ...candidate.lifecycle,
        finalization: {
          ...candidate.lifecycle.finalization,
          blockNumber: "94",
        },
      },
    })],
    ["finalization after common head", (
      candidate: GenericLaunchSourceProjectionV2,
    ) => ({
      ...candidate,
      lifecycle: {
        ...candidate.lifecycle,
        finalization: {
          ...candidate.lifecycle.finalization,
          blockNumber: "113",
        },
        latestCommonHead: "112",
      },
    })],
  ])("rejects invalid lifecycle order: %s", (_label, mutate) => {
    expect(() => record(
      mutate(projection()) as GenericLaunchSourceProjectionV2,
    )).toThrow(/lifecycle order/u);
  });

  it("requires the exact ordered same-receipt Registry registration logs", () => {
    const sourceProjection = projection();
    const [registered, descriptor, evidence] =
      sourceProjection.lifecycle.registration;
    expect(() => record({
      ...sourceProjection,
      lifecycle: {
        ...sourceProjection.lifecycle,
        registration: [registered, evidence, descriptor],
      },
    } as unknown as GenericLaunchSourceProjectionV2))
      .toThrow(/registration evidence/u);
    expect(() => record({
      ...sourceProjection,
      lifecycle: {
        ...sourceProjection.lifecycle,
        registration: [
          registered,
          { ...descriptor, transactionHash: hash("f") },
          evidence,
        ],
      },
    } as GenericLaunchSourceProjectionV2)).toThrow(/registration evidence/u);
  });

  it("treats descriptor market fields as exact authenticated data", () => {
    const sourceProjection = projection();
    expect(() => record({
      ...sourceProjection,
      descriptor: { ...sourceProjection.descriptor, protocolFeeBps: 0 },
    } as GenericLaunchSourceProjectionV2)).toThrow(/market identity/u);
    const noMarket = record({
      ...sourceProjection,
      descriptor: {
        ...sourceProjection.descriptor,
        marketMode: "NoMarket0",
        marketModeValue: 0,
        protocolFeeBps: 0,
      },
    });
    expect(noMarket.sourceProjection.descriptor).toMatchObject({
      marketMode: "NoMarket0",
      marketModeValue: 0,
      protocolFeeBps: 0,
    });
  });

  it.each([
    ["repository", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      sourceRevision: { ...candidate.sourceRevision, repositoryId: "01" },
    })],
    ["commit", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      sourceRevision: { ...candidate.sourceRevision, commitObjectId: "A".repeat(40) },
    })],
    ["wallet", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      descriptor: { ...candidate.descriptor, launchWallet: address("F") },
    })],
    ["approval id", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      approval: { ...candidate.approval, approvalId: hash("0") },
    })],
    ["transaction", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      lifecycle: {
        ...candidate.lifecycle,
        finalization: {
          ...candidate.lifecycle.finalization,
          transactionHash: "0x1234",
        },
      },
    })],
  ])("rejects invalid %s identity", (_label, mutate) => {
    expect(() => record(
      mutate(projection()) as GenericLaunchSourceProjectionV2,
    )).toThrow(/invalid/u);
  });

  it.each([
    ["approval revision", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      approval: { ...candidate.approval, approvalRevision: "1".repeat(79) },
    })],
    ["log index", (candidate: GenericLaunchSourceProjectionV2) => ({
      ...candidate,
      lifecycle: {
        ...candidate.lifecycle,
        finalization: {
          ...candidate.lifecycle.finalization,
          logIndex: "1".repeat(79),
        },
      },
    })],
  ])("rejects a decimal wider than uint256 for %s", (_label, mutate) => {
    expect(() => record(
      mutate(projection()) as GenericLaunchSourceProjectionV2,
    )).toThrow(/invalid/u);
  });

  it("rejects any added field and any hash mutation", () => {
    const value = record();
    expect(() => parseGenericLaunchRecordV2({ ...value, criteria: [] }))
      .toThrow(/keys/u);
    expect(() => parseGenericLaunchRecordV2({
      ...value,
      sourceProjectionHash: sha("f"),
    })).toThrow(/hash/u);
    expect(() => parseGenericLaunchRecordV2({
      ...value,
      recordHash: sha("f"),
    })).toThrow(/hash/u);
  });

  it("changes both hashes for every public identity class mutation", () => {
    const original = record();
    const mutations: GenericLaunchSourceProjectionV2[] = [
      {
        ...projection(),
        sourceRevision: { ...projection().sourceRevision, repositoryId: "987654321" },
      },
      {
        ...projection(),
        approval: { ...projection().approval, approvalRevision: "8" },
      },
      {
        ...projection(),
        descriptor: { ...projection().descriptor, descriptorHash: hash("f") },
      },
      {
        ...projection(),
        lifecycle: { ...projection().lifecycle, latestCommonHead: "113" },
      },
    ];
    for (const sourceProjection of mutations) {
      const mutated = record(sourceProjection);
      expect(mutated.sourceProjectionHash).not.toBe(original.sourceProjectionHash);
      expect(mutated.recordHash).not.toBe(original.recordHash);
    }
  });
});
