import { describe, expect, it, vi } from "vitest";
import { toEventSelector } from "viem";

vi.mock("server-only", () => ({}));

import type {
  CandidateRpcProvider,
  DualRpcCandidateBatchEvidence,
} from "../../lib/data-pipeline/dual-rpc";
import type { EnvioCandidate } from "../../lib/data-pipeline/envio";
import {
  runReleaseProjectionCycle,
  type ReleaseProjectionPlan,
  type ReleaseProjectionStore,
} from "../../lib/data-pipeline/projector-projection";

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

function plan(entries: ReleaseProjectionPlan["entries"]): ReleaseProjectionPlan {
  return {
    scope: {
      releaseId: "classic-v2",
      modelId: "classic",
      sourceGroup: "core",
    },
    entries,
    dynamicSources: [],
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
        return emptyEvidence();
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
