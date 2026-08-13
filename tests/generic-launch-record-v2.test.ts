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
      primaryLaunchTransactionHash: hash("9"),
      authorizationTransactionHash: hash("a"),
      registrationTransactionHash: hash("b"),
      finalizationTransactionHash: hash("c"),
      finalizedAtBlock: "100",
      finalizedBlockHash: hash("d"),
      finalizationLogIndex: "4",
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
      lifecycle: { ...candidate.lifecycle, registrationTransactionHash: "0x1234" },
    })],
  ])("rejects invalid %s identity", (_label, mutate) => {
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
