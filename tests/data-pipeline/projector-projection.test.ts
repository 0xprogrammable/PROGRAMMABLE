import { describe, expect, it, vi } from "vitest";
import { toEventSelector } from "viem";

vi.mock("server-only", () => ({}));

import type {
  CandidateRpcProvider,
  DualRpcCandidateBatchEvidence,
  verifyEnvioCandidateBatchWithDualRpc,
} from "../../lib/data-pipeline/dual-rpc";
import type { EnvioCandidate } from "../../lib/data-pipeline/envio";
import {
  commitVerifiedPreparedReleaseProjection,
  prepareReleaseProjectionRound,
  runReleaseProjectionCycle,
  verifyPreparedReleaseProjection,
  type PreparedReleaseProjectionRound,
  type ReleaseProjectionPlan,
  type ReleaseProjectionStore,
} from "../../lib/data-pipeline/projector-projection";
import type { VerifiedDynamicSourceLineage } from "../../lib/data-pipeline/projector-identities";

const hash = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const address = (digit: string) =>
  `0x${digit.repeat(40)}` as `0x${string}`;
const executionTrace = (candidateBatchSize = 0) => ({
  startedAtMs: 1,
  completedAtMs: 2,
  candidateBatchSize,
  hardDeadlineMs: 75_000,
  maxCallsPerProvider: 48,
  elapsedMs: 1,
  providerCallCounts: [0, 0] as const,
  calls: [],
});

function candidate(overrides: Partial<EnvioCandidate> = {}): EnvioCandidate {
  const blockHash = hash("1");
  const transactionHash = hash("2");
  return {
    candidateId: `1:${blockHash}:${transactionHash}:4`,
    chainId: 1,
    blockNumber: "100",
    blockHash,
    blockTimestamp: "1000",
    transactionHash,
    transactionIndex: 3,
    blockGlobalLogIndex: 4,
    sourceAddress: address("3"),
    contractName: "ClassicV2Hook",
    eventName: "LauncherFeesClaimed",
    releaseHint: { model: "classic", releaseVersion: "classic-v2" },
    orderedTopics: [hash("4")],
    rawData: "0x" as `0x${string}`,
    decodedPayload: {},
    payloadHash: hash("5"),
    ...overrides,
  };
}

function plan(
  entries: ReleaseProjectionPlan["entries"],
  dynamicSources: readonly VerifiedDynamicSourceLineage[] = [],
): ReleaseProjectionPlan {
  return {
    scope: {
      releaseId: "classic-v2",
      modelId: "classic",
      sourceGroup: "core",
    },
    entries,
    dynamicSources,
    knownPools: [],
    lease: { generation: "1", expiresAt: "2026-07-31T12:00:00.000Z" },
    checkpoint: {
      generation: "0",
      reorgGeneration: "0",
      blockNumber: "99",
      blockHash: hash("6"),
      blockGlobalLogIndex: 0xffff_ffff,
      candidateId: "",
    },
    rewardVerification: null,
  };
}

const providers = [
  {
    identity: "alchemy-test",
    vendorGroup: "alchemy",
    endpointCommitment: hash("7"),
    endpointOriginCommitment: hash("8"),
    client: {},
  },
  {
    identity: "quicknode-test",
    vendorGroup: "quicknode",
    endpointCommitment: hash("9"),
    endpointOriginCommitment: hash("a"),
    client: {},
  },
] as unknown as readonly [CandidateRpcProvider, CandidateRpcProvider];

function dynamicLineage(
  sourceAddress = "0x4cfe000000000000000000000000000000000001" as const,
): VerifiedDynamicSourceLineage {
  return {
    attestationId: "10000000-0000-4000-8000-000000000001",
    sourceAddress,
    contractName: "ClassicV3RewardVault",
    model: "classic",
    releaseVersion: "classic-v3",
    factoryAddress: "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a",
    factoryContractName: "ClassicV3RewardVaultFactory",
    factoryCandidateId: `1:${hash("5")}:${hash("6")}:3`,
    factoryBlockNumber: "25639596",
    factoryBlockGlobalLogIndex: "3",
    activationCandidateId: `1:${hash("1")}:${hash("7")}:3`,
    activationBlockNumber: "25639597",
    activationBlockHash: hash("1"),
    activationBlockGlobalLogIndex: "3",
    expectedExactRuntimeCodeHash: hash("c"),
    expectedNormalizedRuntimeCodeHash: hash("d"),
    expectedImmutableReferencesCommitment: hash("e"),
    expectedRuntimeByteLength: "6",
    immutableReferences: [{ start: 2, length: 2 }],
  };
}

function emptyEvidence(): DualRpcCandidateBatchEvidence {
  return {
    chainId: 1,
    providerIdentities: ["alchemy-test", "quicknode-test"],
    providerVendorGroups: ["alchemy", "quicknode"],
    providerEndpointCommitments: [hash("7"), hash("9")],
    providerOriginCommitments: [hash("8"), hash("a")],
    providerHeads: ["120", "121"],
    safeBlockNumber: "108",
    safeBlockHash: hash("b"),
    candidates: [],
    executionTrace: executionTrace(),
  };
}

function evidenceFor(
  candidates: readonly EnvioCandidate[],
): DualRpcCandidateBatchEvidence {
  return {
    ...emptyEvidence(),
    candidates: candidates.map((value) => ({
      chainId: 1,
      candidateId: value.candidateId,
      sourceAddress: value.sourceAddress,
      contractName: value.contractName,
      eventName: value.eventName,
      sourceKind: "static",
      model: value.releaseHint.model,
      releaseVersion: value.releaseHint.releaseVersion,
      payloadHash: value.payloadHash,
      rawLogCommitment: hash("c"),
      providerIdentities: ["alchemy-test", "quicknode-test"],
      providerVendorGroups: ["alchemy", "quicknode"],
      providerEndpointCommitments: [hash("7"), hash("9")],
      providerOriginCommitments: [hash("8"), hash("a")],
      providerHeads: ["120", "121"],
      safeBlockNumber: "108",
      safeBlockHash: hash("b"),
      candidateBlockNumber: value.blockNumber,
      candidateBlockHash: value.blockHash,
      candidateBlockTimestamp: value.blockTimestamp,
      transactionHash: value.transactionHash,
      transactionIndex: value.transactionIndex,
      receiptCommitment: hash("d"),
      sourceCodeHash: hash("e"),
      receiptLogOrdinal: value.blockGlobalLogIndex,
    })),
    executionTrace: executionTrace(candidates.length),
  };
}

function readyProjection(
  round: PreparedReleaseProjectionRound,
  index: number,
) {
  const entry = round.entries[index];
  if (!entry || entry.status !== "ready") {
    throw new Error("Expected prepared release projection");
  }
  return entry.projection;
}

describe("release projection orchestrator", () => {
  it("keeps provider work between the two database phases and commits ignored pages", async () => {
    const expected = candidate();
    const order: string[] = [];
    const commitVerifiedProjection = vi.fn(async (
      projection: Parameters<
        ReleaseProjectionStore["commitVerifiedProjection"]
      >[0],
    ) => {
      order.push("commit");
      expect(projection.ignoredCandidateIds).toEqual([expected.candidateId]);
      expect(projection.fold.occurrences).toEqual([]);
      return { checkpointGeneration: "1" };
    });
    const store: ReleaseProjectionStore = {
      async readProjectionPlan() {
        order.push("read-plan");
        return plan([
          { candidate: expected, action: "ignore", attemptCount: "0" },
        ]);
      },
      commitVerifiedProjection,
    };
    const result = await runReleaseProjectionCycle({
      store,
      envio: {
        async readCandidate() {
          order.push("envio");
          return structuredClone(expected);
        },
      },
      providers,
      verifyBatch: async (input) => {
        order.push("rpc");
        expect(input.candidates).toEqual([expected]);
        return evidenceFor(input.candidates);
      },
      readMetadata: async (input) => {
        order.push("metadata");
        expect(input.tokens).toEqual([]);
        return [];
      },
    });

    expect(order).toEqual([
      "read-plan",
      "envio",
      "rpc",
      "metadata",
      "commit",
    ]);
    expect(result).toEqual({
      status: "committed",
      releaseId: "classic-v2",
      projectedCandidateCount: 0,
      ignoredCandidateCount: 1,
      checkpointGeneration: "1",
      batchKind: "normal",
    });
  });

  it("shares fresh Envio and dual-RPC reads across aligned release pages", async () => {
    const expected = candidate();
    const order: string[] = [];
    const readCandidate = vi.fn(async () => structuredClone(expected));
    const envio = { readCandidate };
    const verifyBatch = vi.fn<typeof verifyEnvioCandidateBatchWithDualRpc>(
      async ({ candidates }) => {
        order.push("rpc");
        return evidenceFor(candidates);
      },
    );
    const readMetadata = vi.fn(async () => []);
    const firstCommit = vi.fn(async () => {
      order.push("commit-1");
      return { checkpointGeneration: "1" };
    });
    const secondCommit = vi.fn(async () => {
      order.push("commit-2");
      return { checkpointGeneration: "1" };
    });
    const firstStore: ReleaseProjectionStore = {
      readProjectionPlan: async () => {
        order.push("read-plan-1-start");
        await Promise.resolve();
        order.push("read-plan-1-closed");
        return plan([
          { candidate: expected, action: "ignore", attemptCount: "0" },
        ]);
      },
      commitVerifiedProjection: firstCommit,
    };
    const secondStore: ReleaseProjectionStore = {
      // A valid lineage for another address cannot affect this static page and
      // therefore must not force a second provider verification.
      readProjectionPlan: async () => {
        order.push("read-plan-2-start");
        await Promise.resolve();
        order.push("read-plan-2-closed");
        return plan(
          [{ candidate: expected, action: "ignore", attemptCount: "0" }],
          [dynamicLineage()],
        );
      },
      commitVerifiedProjection: secondCommit,
    };
    const preparedRound = await prepareReleaseProjectionRound({
      stores: [firstStore, secondStore],
      envio,
      providers,
    });

    const first = await verifyPreparedReleaseProjection({
      store: firstStore,
      envio,
      providers,
      prepared: readyProjection(preparedRound, 0),
      sharedVerification: preparedRound.sharedVerification,
      verifyBatch,
      readMetadata,
    });
    const second = await verifyPreparedReleaseProjection({
      store: secondStore,
      envio,
      providers,
      prepared: readyProjection(preparedRound, 1),
      sharedVerification: preparedRound.sharedVerification,
      verifyBatch,
      readMetadata,
    });
    if (first.status !== "verified" || second.status !== "verified") {
      throw new Error("Expected verified release projections");
    }
    await commitVerifiedPreparedReleaseProjection({
      store: firstStore,
      verification: first.verification,
    });
    await commitVerifiedPreparedReleaseProjection({
      store: secondStore,
      verification: second.verification,
    });

    expect(readCandidate).toHaveBeenCalledTimes(1);
    expect(verifyBatch).toHaveBeenCalledTimes(1);
    expect(firstCommit).toHaveBeenCalledTimes(1);
    expect(secondCommit).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "read-plan-1-start",
      "read-plan-2-start",
      "read-plan-1-closed",
      "read-plan-2-closed",
      "rpc",
      "commit-1",
      "commit-2",
    ]);
  });

  it("keeps relevant dynamic-source verification contexts separate", async () => {
    const order: string[] = [];
    const sourceAddress =
      "0x4cfe000000000000000000000000000000000001" as const;
    const expected = candidate({
      candidateId: `1:${hash("1")}:${hash("2")}:4`,
      blockNumber: "25639597",
      sourceAddress,
      contractName: "ClassicV3RewardVault",
      eventName: "CreatorFeesCheckpointed",
      releaseHint: { model: "unresolved", releaseVersion: "unresolved" },
    });
    const readCandidate = vi.fn(async () => structuredClone(expected));
    const envio = { readCandidate };
    const verifyBatch = vi.fn<typeof verifyEnvioCandidateBatchWithDualRpc>(
      async ({ candidates }) => {
        order.push(`rpc-${verifyBatch.mock.calls.length}`);
        return evidenceFor(candidates);
      },
    );
    const store = (
      dynamicSources: readonly VerifiedDynamicSourceLineage[],
      index: number,
    ): ReleaseProjectionStore => ({
      readProjectionPlan: async () => {
        order.push(`read-plan-${index}-start`);
        await Promise.resolve();
        order.push(`read-plan-${index}-closed`);
        return plan(
          [{ candidate: expected, action: "ignore", attemptCount: "0" }],
          dynamicSources,
        );
      },
      commitVerifiedProjection: async () => {
        order.push(`commit-${index}`);
        return { checkpointGeneration: "1" };
      },
    });
    const stores = [
      store([], 1),
      store([dynamicLineage(sourceAddress)], 2),
    ];
    const preparedRound = await prepareReleaseProjectionRound({
      stores,
      envio,
      providers,
    });
    const verify = (index: number) =>
      verifyPreparedReleaseProjection({
        store: stores[index]!,
        envio,
        providers,
        prepared: readyProjection(preparedRound, index),
        sharedVerification: preparedRound.sharedVerification,
        verifyBatch,
        readMetadata: async () => [],
      });

    const first = await verify(0);
    const second = await verify(1);
    if (first.status !== "verified" || second.status !== "verified") {
      throw new Error("Expected verified release projections");
    }
    await commitVerifiedPreparedReleaseProjection({
      store: stores[0]!,
      verification: first.verification,
    });
    await commitVerifiedPreparedReleaseProjection({
      store: stores[1]!,
      verification: second.verification,
    });

    expect(readCandidate).toHaveBeenCalledTimes(1);
    expect(verifyBatch).toHaveBeenCalledTimes(2);
    expect(verifyBatch.mock.calls[0]![0].dynamicSources).toEqual([]);
    expect(verifyBatch.mock.calls[1]![0].dynamicSources).toEqual([
      dynamicLineage(sourceAddress),
    ]);
    expect(order).toEqual([
      "read-plan-1-start",
      "read-plan-2-start",
      "read-plan-1-closed",
      "read-plan-2-closed",
      "rpc-1",
      "rpc-2",
      "commit-1",
      "commit-2",
    ]);
  });

  it("fails closed when the fresh Envio object differs from the stored candidate", async () => {
    const expected = candidate();
    const commitVerifiedProjection = vi.fn();
    await expect(
      runReleaseProjectionCycle({
        store: {
          readProjectionPlan: async () =>
            plan([
              { candidate: expected, action: "ignore", attemptCount: "0" },
            ]),
          commitVerifiedProjection,
        },
        envio: {
          readCandidate: async () => ({
            ...expected,
            decodedPayload: { changed: true },
          }),
        },
        providers,
        verifyBatch: async () => emptyEvidence(),
        readMetadata: async () => [],
      }),
    ).rejects.toMatchObject({ name: "DataPipelineError" });
    expect(commitVerifiedProjection).not.toHaveBeenCalled();
  });

  it("rejects mixed actions inside one transaction before any provider call", async () => {
    const first = candidate();
    const second = candidate({
      candidateId: `1:${first.blockHash}:${first.transactionHash}:5`,
      blockGlobalLogIndex: 5,
    });
    const envio = { readCandidate: vi.fn() };
    await expect(
      runReleaseProjectionCycle({
        store: {
          readProjectionPlan: async () =>
            plan([
              { candidate: first, action: "project", attemptCount: "0" },
              { candidate: second, action: "ignore", attemptCount: "0" },
            ]),
          commitVerifiedProjection: vi.fn(),
        },
        envio,
        providers,
        verifyBatch: async () => emptyEvidence(),
        readMetadata: async () => [],
      }),
    ).rejects.toMatchObject({ name: "DataPipelineError" });
    expect(envio.readCandidate).not.toHaveBeenCalled();
  });

  it("requires an exact-block reward snapshot before committing a reward delta", async () => {
    const rewardVault = address("7");
    const alice = address("1");
    const bob = address("2");
    const poolId = hash("3");
    const configurationHash = hash("4");
    const eventSignature = toEventSelector(
      "CreatorFeesCheckpointed(bytes32,uint64,uint256,uint256)",
    );
    const reward = candidate({
      blockNumber: "25639601",
      sourceAddress: rewardVault,
      contractName: "ClassicV3RewardVault",
      eventName: "CreatorFeesCheckpointed",
      releaseHint: { model: "classic", releaseVersion: "classic-v3" },
      orderedTopics: [eventSignature],
      decodedPayload: {
        poolId,
        configurationEpoch: "1",
        amount: "10",
        totalCreatorFeesReceived: "10",
      },
    });
    const rewardEvidence = {
      chainId: 1 as const,
      candidateId: reward.candidateId,
      sourceAddress: reward.sourceAddress,
      contractName: reward.contractName,
      eventName: reward.eventName,
      sourceKind: "dynamic-attested" as const,
      model: "classic" as const,
      releaseVersion: "classic-v3",
      payloadHash: reward.payloadHash,
      rawLogCommitment: hash("5"),
      providerIdentities: ["alchemy-test", "quicknode-test"] as const,
      providerVendorGroups: ["alchemy", "quicknode"] as const,
      providerEndpointCommitments: [hash("7"), hash("9")] as const,
      providerOriginCommitments: [hash("8"), hash("a")] as const,
      providerHeads: ["120", "121"] as const,
      safeBlockNumber: "108",
      safeBlockHash: hash("b"),
      candidateBlockNumber: reward.blockNumber,
      candidateBlockHash: reward.blockHash,
      candidateBlockTimestamp: reward.blockTimestamp,
      transactionHash: reward.transactionHash,
      transactionIndex: reward.transactionIndex,
      receiptCommitment: hash("c"),
      sourceCodeHash: hash("d"),
      receiptLogOrdinal: 0,
      dynamicSourceAttestationId: "80000000-0000-8000-8000-000000000001",
      normalizedRuntimeCodeHash: hash("e"),
      immutableReferencesCommitment: hash("f"),
      runtimeByteLength: "1",
    } as const;
    const rewardPlan: ReleaseProjectionPlan = {
      ...plan([{ candidate: reward, action: "project", attemptCount: "0" }]),
      scope: {
        releaseId: "classic-v3",
        modelId: "classic",
        sourceGroup: "core",
      },
      knownPools: [{
        releaseVersion: "classic-v3",
        poolId,
        token: address("5"),
        quoteAsset: null,
        rewardVault,
      }],
      rewardVerification: {
        model: "classic-v3",
        baseline: {
          vault: rewardVault,
          poolId,
          configurationEpoch: "1",
          activeConfigurationHash: configurationHash,
          allocations: [
            {
              allocationIndex: 0,
              beneficiary: alice,
              payoutAddress: alice,
              shareBps: "4000",
            },
            {
              allocationIndex: 1,
              beneficiary: bob,
              payoutAddress: bob,
              shareBps: "6000",
            },
          ],
          balances: [
            {
              account: alice,
              payoutAddress: alice,
              claimableAccrued: "0",
              claimedTotal: "0",
            },
            {
              account: bob,
              payoutAddress: bob,
              claimableAccrued: "0",
              claimedTotal: "0",
            },
          ],
        },
      },
    };
    const readRewardSnapshot = vi.fn(async ({ expected }) => ({
      ...expected,
      model: "classic-v3" as const,
      blockNumber: "25639601",
      configurationHash,
      totalCreatorFeesClaimed: "0",
      rpcCallCount: 14,
    }));
    const commitVerifiedProjection = vi.fn(async (projection) => {
      expect(projection.rewardSnapshot).toMatchObject({
        vault: rewardVault,
        totalCreatorFeesReceived: "10",
        balances: [
          { account: alice, claimableAccrued: "4" },
          { account: bob, claimableAccrued: "6" },
        ],
      });
      return { checkpointGeneration: "1" };
    });

    await runReleaseProjectionCycle({
      store: {
        readProjectionPlan: async () => rewardPlan,
        commitVerifiedProjection,
      },
      envio: { readCandidate: async () => reward },
      providers,
      verifyBatch: async () => ({
        ...emptyEvidence(),
        candidates: [rewardEvidence],
        executionTrace: executionTrace(1),
      }),
      readMetadata: async () => [],
      readRewardSnapshot: readRewardSnapshot as never,
    });

    expect(readRewardSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "classic-v3",
        blockNumber: "25639601",
        rpcPolicy: expect.objectContaining({ maxAttempts: 1 }),
      }),
    );
    expect(commitVerifiedProjection).toHaveBeenCalledOnce();
  });

  it("verifies every vault touched in one reward block before one atomic commit", async () => {
    const blockHash = hash("1");
    const eventSignature = toEventSelector(
      "CreatorFeesCheckpointed(bytes32,uint64,uint256,uint256)",
    );
    const vaults = [address("7"), address("8")] as const;
    const poolIds = [hash("3"), hash("4")] as const;
    const amounts = ["10", "20"] as const;
    const transactions = [hash("2"), hash("c")] as const;
    const rewards = vaults.map((vault, index) =>
      candidate({
        candidateId:
          `1:${blockHash}:${transactions[index]}:${4 + index}`,
        blockNumber: "25639601",
        blockHash,
        transactionHash: transactions[index],
        transactionIndex: 3 + index,
        blockGlobalLogIndex: 4 + index,
        sourceAddress: vault,
        contractName: "ClassicV3RewardVault",
        eventName: "CreatorFeesCheckpointed",
        releaseHint: { model: "classic", releaseVersion: "classic-v3" },
        orderedTopics: [eventSignature],
        decodedPayload: {
          poolId: poolIds[index],
          configurationEpoch: "1",
          amount: amounts[index],
          totalCreatorFeesReceived: amounts[index],
        },
      }),
    );
    const rewardEvidence = rewards.map((reward, index) => ({
      chainId: 1 as const,
      candidateId: reward.candidateId,
      sourceAddress: reward.sourceAddress,
      contractName: reward.contractName,
      eventName: reward.eventName,
      sourceKind: "dynamic-attested" as const,
      model: "classic" as const,
      releaseVersion: "classic-v3",
      payloadHash: reward.payloadHash,
      rawLogCommitment: hash("5"),
      providerIdentities: ["alchemy-test", "quicknode-test"] as const,
      providerVendorGroups: ["alchemy", "quicknode"] as const,
      providerEndpointCommitments: [hash("7"), hash("9")] as const,
      providerOriginCommitments: [hash("8"), hash("a")] as const,
      providerHeads: ["120", "121"] as const,
      safeBlockNumber: "108",
      safeBlockHash: hash("b"),
      candidateBlockNumber: reward.blockNumber,
      candidateBlockHash: reward.blockHash,
      candidateBlockTimestamp: reward.blockTimestamp,
      transactionHash: reward.transactionHash,
      transactionIndex: reward.transactionIndex,
      receiptCommitment: hash(index === 0 ? "c" : "d"),
      sourceCodeHash: hash("d"),
      receiptLogOrdinal: 0,
      dynamicSourceAttestationId:
        `80000000-0000-8000-8000-00000000000${index + 1}`,
      normalizedRuntimeCodeHash: hash("e"),
      immutableReferencesCommitment: hash("f"),
      runtimeByteLength: "1",
    }));
    const alice = address("1");
    const rewardPlan: ReleaseProjectionPlan = {
      ...plan(rewards.map((reward) => ({
        candidate: reward,
        action: "project" as const,
        attemptCount: "0",
      }))),
      scope: {
        releaseId: "classic-v3",
        modelId: "classic",
        sourceGroup: "core",
      },
      knownPools: vaults.map((rewardVault, index) => ({
        releaseVersion: "classic-v3",
        poolId: poolIds[index],
        token: address(index === 0 ? "5" : "6"),
        quoteAsset: null,
        rewardVault,
      })),
      rewardVerification: null,
      rewardVerifications: vaults.map((vault, index) => ({
        model: "classic-v3" as const,
        baseline: {
          vault,
          poolId: poolIds[index],
          configurationEpoch: "1",
          activeConfigurationHash: hash(index === 0 ? "4" : "5"),
          allocations: [{
            allocationIndex: 0,
            beneficiary: alice,
            payoutAddress: alice,
            shareBps: "10000",
          }],
          balances: [{
            account: alice,
            payoutAddress: alice,
            claimableAccrued: "0",
            claimedTotal: "0",
          }],
        },
      })),
      batchKind: "reward-block",
    };
    const readRewardSnapshot = vi.fn(async (input: {
      expected: { vault: string; totalCreatorFeesReceived: string };
      blockNumber: string;
      blockHash: string;
    }) => ({
      ...input.expected,
      model: "classic-v3" as const,
      blockNumber: input.blockNumber,
      blockHash: input.blockHash,
      configurationHash: hash("4"),
      totalCreatorFeesClaimed: "0",
      rpcCallCount: 10,
    }));
    const commitVerifiedProjection = vi.fn(async (
      projection: Parameters<
        ReleaseProjectionStore["commitVerifiedProjection"]
      >[0],
    ) => {
      expect(projection.rewardSnapshots).toHaveLength(2);
      expect(
        projection.rewardSnapshots?.map((snapshot) => [
          snapshot.vault,
          snapshot.totalCreatorFeesReceived,
        ]),
      ).toEqual([
        [vaults[0], "10"],
        [vaults[1], "20"],
      ]);
      expect(projection.rewardEvidence).toHaveLength(2);
      return { checkpointGeneration: "1" };
    });

    await expect(
      runReleaseProjectionCycle({
        store: {
          readProjectionPlan: async () => rewardPlan,
          commitVerifiedProjection,
        },
        envio: {
          readCandidate: async (candidateId) =>
            rewards.find((reward) => reward.candidateId === candidateId) ?? null,
        },
        providers,
        verifyBatch: async () => ({
          ...emptyEvidence(),
          candidates: rewardEvidence,
          executionTrace: executionTrace(2),
        }),
        readMetadata: async () => [],
        readRewardSnapshot: readRewardSnapshot as never,
      }),
    ).resolves.toMatchObject({
      status: "committed",
      batchKind: "reward-block",
      projectedCandidateCount: 2,
    });
    expect(readRewardSnapshot).toHaveBeenCalledTimes(2);
    expect(commitVerifiedProjection).toHaveBeenCalledOnce();
  });
});
