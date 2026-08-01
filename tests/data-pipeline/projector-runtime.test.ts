import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runProjectorCycle } from "../../lib/data-pipeline/projector";
import { validationError } from "../../lib/data-pipeline/errors";
import type { EnvioCandidate } from "../../lib/data-pipeline/envio";
import type { ProjectorDynamicSourceTemplate } from "../../lib/data-pipeline/dual-rpc";

const CURSOR_HASH = `0x${"11".repeat(32)}` as const;
const SAFE_HASH = `0x${"22".repeat(32)}` as const;
const CANDIDATE_HASH = `0x${"44".repeat(32)}` as const;
const executionTrace = (candidateBatchSize = 0) => ({
  startedAtMs: 1,
  completedAtMs: 2,
  candidateBatchSize,
  hardDeadlineMs: 75_000,
  maxCallsPerProvider: 128,
  elapsedMs: 1,
  providerCallCounts: [0, 0] as const,
  calls: [],
});
const CLASSIC_V3_FACTORY =
  "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a" as const;

function dynamicTemplate(): ProjectorDynamicSourceTemplate {
  return {
    templateId: "10000000-0000-4000-8000-000000000001",
    contractName: "ClassicV3RewardVault" as const,
    model: "classic" as const,
    releaseVersion: "classic-v3" as const,
    parentFactoryAddress: CLASSIC_V3_FACTORY,
    parentFactoryContractName: "ClassicV3RewardVaultFactory" as const,
    parentFactoryBindingId: "10000000-0000-4000-8000-000000000002",
    parentFactoryBindingCommitment: SAFE_HASH,
    parentSourceRole: "vault_factory",
    factoryEventName: "ClassicRewardVaultDeployed" as const,
    deployedAddressField: "vault" as const,
    deployedSourceRole: "reward_vault" as const,
    deployedArtifactCreationCodeCommitment: CURSOR_HASH,
    expectedExactRuntimeCodeHash: null,
    expectedNormalizedRuntimeCodeHash: SAFE_HASH,
    expectedImmutableReferencesCommitment: CURSOR_HASH,
    expectedRuntimeByteLength: "2",
    immutableReferences: [{ start: 0, length: 1 }],
    immutableBindingSpec: {
      factoryConfigurationField: "configurationHash",
      bindings: [
        {
          ordinal: "0",
          offset: "0",
          length: "1",
          source: "constant",
          encoding: "bytes",
          value: "0x60",
        },
      ],
    },
    immutableBindingCommitment: SAFE_HASH,
    abiEventSetCommitment: CURSOR_HASH,
    templateCommitment: SAFE_HASH,
    database: {
      scope: {
        releaseId: "classic-v3",
        modelId: "classic",
        sourceGroup: "canonical-events",
      },
      epochId: "10000000-0000-4000-8000-000000000003",
      pointerGeneration: "1",
      reorgGeneration: "0",
      envioProviderDeploymentId:
        "10000000-0000-4000-8000-000000000004",
      rpcProviderDeploymentIds: [
        "10000000-0000-4000-8000-000000000005",
        "10000000-0000-4000-8000-000000000006",
      ] as const,
    },
  };
}

function candidate(
  input: {
    blockNumber?: number;
    logIndex?: number;
    sourceAddress?: `0x${string}`;
    contractName?: string;
    eventName?: string;
    decodedPayload?: Record<string, unknown>;
    releaseHint?: EnvioCandidate["releaseHint"];
  } = {},
): EnvioCandidate {
  const blockNumber = input.blockNumber ?? 101;
  const logIndex = input.logIndex ?? 7;
  const transactionHash = `0x${(blockNumber * 10_000 + logIndex + 1)
    .toString(16)
    .padStart(64, "0")}` as const;
  return {
    candidateId: `1:${CANDIDATE_HASH}:${transactionHash}:${logIndex}`,
    chainId: 1,
    blockNumber: String(blockNumber),
    blockHash: CANDIDATE_HASH,
    blockTimestamp: "1000",
    transactionHash,
    transactionIndex: 0,
    blockGlobalLogIndex: logIndex,
    sourceAddress:
      input.sourceAddress ?? "0xd240d06f8586eb799f20056054e5b527405e6bad",
    contractName: input.contractName ?? "ClassicV2Launcher",
    eventName: input.eventName ?? "MemeTokenLaunched",
    releaseHint: input.releaseHint ?? {
      model: "classic",
      releaseVersion:
        input.contractName === "ClassicV3RewardVaultFactory"
          ? "classic-v3"
          : "classic-v2",
    },
    orderedTopics: [`0x${"55".repeat(32)}`],
    rawData: "0x",
    decodedPayload: input.decodedPayload ?? {},
    payloadHash: `0x${"66".repeat(32)}`,
  };
}

function fixtures() {
  let databaseTransactionOpen = false;
  const store = {
    readPlan: vi.fn(async () => {
      databaseTransactionOpen = true;
      databaseTransactionOpen = false;
      return {
        cursor: {
          generation: "5",
          blockNumber: "100",
          blockHash: CURSOR_HASH,
          blockGlobalLogIndex: -1,
          candidateId: "",
          isBlockBoundary: false,
        },
        dynamicSources: [],
        provisionalSourceAddresses: [],
        dynamicSourceTemplates: [dynamicTemplate()],
        database: {
          epochId: "70000000-0000-0000-0000-000000000002",
          pointerGeneration: "1",
          reorgGeneration: "0",
          envioProviderDeploymentId:
            "70000000-0000-4000-8000-000000000003",
          rpcProviderDeploymentIds: [
            "70000000-0000-4000-8000-000000000004",
            "70000000-0000-4000-8000-000000000005",
          ] as const,
        },
      };
    }),
    readReorgRecoveryState: vi.fn(async () => ({
      ancestors: [],
      genesis: {
        kind: "genesis" as const,
        historyGeneration: "0" as const,
        genesisPointId: "70000000-0000-4000-8000-000000000006",
        blockNumber: "0",
        blockHash: CURSOR_HASH,
        blockGlobalLogIndex: null,
        candidateId: null,
      },
      currentReorgGeneration: "0",
    })),
    recoverCanonicalReorg: vi.fn(async () => ({
      generation: "6",
      reorgGeneration: "1",
      releaseCheckpointCount: 5,
    })),
    stageVerifiedDynamicParents: vi.fn(async () => {
      expect(databaseTransactionOpen).toBe(false);
    }),
    commitVerifiedPage: vi.fn(async () => {
      expect(databaseTransactionOpen).toBe(false);
      databaseTransactionOpen = true;
      databaseTransactionOpen = false;
      return { generation: "6" };
    }),
  };
  let candidatePage = 0;
  const envio = {
    readProgress: vi.fn(async () => {
      expect(databaseTransactionOpen).toBe(false);
      return { progressBlock: "200" };
    }),
    readCandidatesWindow: vi.fn(async (input: { limit: number }) => {
      void input;
      expect(databaseTransactionOpen).toBe(false);
      candidatePage += 1;
      return candidatePage === 1 ? [candidate()] : [];
    }),
  };
  const captureSafeHead = vi.fn(async () => {
    expect(databaseTransactionOpen).toBe(false);
    return {
      providerHeads: ["220", "221"] as const,
      safeBlockNumber: "208",
      safeBlockHash: SAFE_HASH,
      cursorBlockHash: CURSOR_HASH,
    };
  });
  const verifyWindow = vi.fn(async (request: {
    candidates: readonly EnvioCandidate[];
    through: { blockNumber: string; blockGlobalLogIndex: number };
  }) => {
    expect(databaseTransactionOpen).toBe(false);
    const throughCandidate = [...request.candidates]
      .reverse()
      .find((item) => item.blockNumber === request.through.blockNumber);
    return {
      chainId: 1 as const,
      providerIdentities: ["alchemy", "quicknode"] as const,
      providerVendorGroups: ["alchemy", "quicknode"] as const,
      providerEndpointCommitments: [SAFE_HASH, CURSOR_HASH] as const,
      providerOriginCommitments: [SAFE_HASH, CURSOR_HASH] as const,
      providerHeads: ["220", "221"] as const,
      safeBlockNumber: "208",
      safeBlockHash: SAFE_HASH,
      candidates: [],
      executionTrace: executionTrace(),
      coveredCandidateCount: 1,
      coverage: {
        fromBlockNumber: "100",
        throughBlockNumber: request.through.blockNumber,
        throughBlockHash: throughCandidate?.blockHash ?? SAFE_HASH,
        throughBlockGlobalLogIndex: String(
          request.through.blockGlobalLogIndex,
        ),
        filterCommitment: SAFE_HASH,
        providerLogCommitments: [SAFE_HASH, SAFE_HASH] as const,
      },
    };
  });
  const verifyDynamicRuntime = vi.fn(async (request: {
    parentCandidate: EnvioCandidate;
    sourceAddress: `0x${string}`;
    deploymentBlockNumber: string;
    deploymentBlockHash: `0x${string}`;
    template: ProjectorDynamicSourceTemplate;
  }) => ({
    chainId: 1 as const,
    parentCandidateId: request.parentCandidate.candidateId,
    sourceAddress: request.sourceAddress,
    deploymentBlockNumber: request.deploymentBlockNumber,
    deploymentBlockHash: request.deploymentBlockHash,
    providerIdentities: ["alchemy", "quicknode"] as const,
    providerVendorGroups: ["alchemy", "quicknode"] as const,
    providerEndpointCommitments: [SAFE_HASH, CURSOR_HASH] as const,
    providerOriginCommitments: [SAFE_HASH, CURSOR_HASH] as const,
    rawRuntimeCodeA: "0x6000" as const,
    rawRuntimeCodeB: "0x6000" as const,
    runtimeCodeHashA: SAFE_HASH,
    runtimeCodeHashB: SAFE_HASH,
    normalizedRuntimeCodeHashA: SAFE_HASH,
    normalizedRuntimeCodeHashB: SAFE_HASH,
    runtimeByteLengthA: "2",
    runtimeByteLengthB: "2",
    immutableReferences: request.template.immutableReferences,
    immutableReferencesCommitment: CURSOR_HASH,
    immutableValues: ["0x60" as const],
    immutableValuesCommitment: SAFE_HASH,
    reconstructedRuntimeCode: "0x6000" as const,
    reconstructedRuntimeCodeHash: SAFE_HASH,
    factoryConfigurationCommitment: CURSOR_HASH,
    deferredAllocationEvidenceCommitment: null,
    template: request.template,
    startedAtMs: 1,
    completedAtMs: 2,
    elapsedMs: 1,
    hardDeadlineMs: 1_000,
    providerCallCounts: [1, 1] as const,
  }));
  return {
    store,
    envio,
    captureSafeHead,
    verifyWindow,
    verifyDynamicRuntime,
  };
}

describe("projector runtime boundary", () => {
  it("finishes all provider work before opening the atomic commit", async () => {
    const input = fixtures();
    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 1_000,
      }),
    ).resolves.toEqual({
      status: "committed",
      candidateCount: 1,
      generation: "6",
      snapshotBlock: "101",
    });
    expect(input.store.commitVerifiedPage).toHaveBeenCalledTimes(1);
    expect(input.verifyWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [expect.objectContaining({ candidateId: candidate().candidateId })],
        through: {
          blockNumber: "101",
          blockGlobalLogIndex: 0xffff_ffff,
          candidateId: "empty-page",
        },
        dynamicSources: [],
        rpcPolicy: expect.objectContaining({
          maxCallsPerProvider: 128,
          hardDeadlineMs: expect.any(Number),
        }),
      }),
    );
    expect(input.store.commitVerifiedPage).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotBlock: "101",
        blockComplete: true,
        evidence: expect.objectContaining({
          coverage: expect.objectContaining({
            throughBlockNumber: "101",
            throughBlockHash: CANDIDATE_HASH,
            throughBlockGlobalLogIndex: "4294967295",
          }),
        }),
      }),
    );
  });

  it("commits a trailing candidate block before advancing later empty blocks", async () => {
    const input = fixtures();
    const onlyCandidate = candidate();
    await expect(runProjectorCycle({
      ...input,
      providers: [] as never,
      deadlineMs: 1_000,
    })).resolves.toMatchObject({
      status: "committed",
      candidateCount: 1,
      snapshotBlock: "101",
    });
    input.store.readPlan.mockResolvedValue({
      ...(await input.store.readPlan()),
      cursor: {
        generation: "6",
        blockNumber: "101",
        blockHash: onlyCandidate.blockHash,
        blockGlobalLogIndex: onlyCandidate.blockGlobalLogIndex,
        candidateId: onlyCandidate.candidateId,
        isBlockBoundary: false,
      },
    });
    input.envio.readCandidatesWindow.mockReset().mockResolvedValue([]);
    input.store.commitVerifiedPage.mockClear();
    await expect(runProjectorCycle({
      ...input,
      providers: [] as never,
      deadlineMs: 1_000,
    })).resolves.toMatchObject({
      status: "committed-empty",
      candidateCount: 0,
      snapshotBlock: "200",
    });
    expect(input.store.commitVerifiedPage).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [],
        snapshotBlock: "200",
        blockComplete: true,
      }),
    );
  });

  it("shrinks a long quiet window to a provider-safe prefix for 10,000 sources", async () => {
    const input = fixtures();
    input.store.readPlan.mockResolvedValue({
      ...(await input.store.readPlan()),
      dynamicSources: Array.from({ length: 10_000 }, (_value, index) => ({
        sourceAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
        contractName: "ClassicV3RewardVault",
      })) as never,
      provisionalSourceAddresses: [],
    });
    input.captureSafeHead.mockResolvedValue({
      providerHeads: ["10012", "10013"],
      safeBlockNumber: "10000",
      safeBlockHash: SAFE_HASH,
      cursorBlockHash: CURSOR_HASH,
    } as never);
    input.envio.readProgress.mockResolvedValue({ progressBlock: "10000" });
    input.envio.readCandidatesWindow.mockReset().mockResolvedValue([]);
    const batchingClient = {
      getBlocks: vi.fn(),
      getTransactionReceipts: vi.fn(),
      getBytecodes: vi.fn(),
      getLogsBatch: vi.fn(),
    };

    await runProjectorCycle({
      ...input,
      providers: [
        { client: batchingClient } as never,
        { client: { ...batchingClient } } as never,
      ],
      deadlineMs: 1_000,
    });

    const request = input.verifyWindow.mock.calls.at(-1)?.[0];
    const throughBlock = BigInt(request?.through.blockNumber ?? "0");
    expect(throughBlock).toBeGreaterThanOrEqual(100n);
    expect(throughBlock).toBeLessThan(4_599n);
    expect(throughBlock - 100n + 1n).toBeLessThanOrEqual(620n);
    expect(input.store.commitVerifiedPage).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotBlock: throughBlock.toString() }),
    );
  });

  it("never commits or advances after coverage failure", async () => {
    const input = fixtures();
    input.verifyWindow.mockRejectedValue(
      validationError("rpc", "coverage-omission"),
    );
    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(input.store.commitVerifiedPage).not.toHaveBeenCalled();
  });

  it("enters bounded recovery only for a cursor orphan agreed by both providers", async () => {
    const input = fixtures();
    input.captureSafeHead.mockRejectedValue(
      validationError("rpc", "safe-head-cursor-orphaned"),
    );
    const target = {
      kind: "genesis" as const,
      historyGeneration: "0" as const,
      genesisPointId: "70000000-0000-4000-8000-000000000006",
      blockNumber: "0",
      blockHash: CURSOR_HASH,
      blockGlobalLogIndex: null,
      candidateId: null,
      providerIdentities: ["alchemy-mainnet", "quicknode-mainnet"] as const,
      providerEndpointCommitments: [SAFE_HASH, CURSOR_HASH] as const,
      providerOriginCommitments: [SAFE_HASH, CURSOR_HASH] as const,
      providerBlockHashes: [CURSOR_HASH, CURSOR_HASH] as const,
      providerBlockTimestamps: ["1000", "1000"] as const,
      providerChainIds: [1, 1] as const,
      providerHeads: ["220", "221"] as const,
      finalityDepth: "12",
      safeBlockNumber: "208",
      safeBlockHash: SAFE_HASH,
      providerSafeBlockHashes: [SAFE_HASH, SAFE_HASH] as const,
      checkedDepth: 1,
    };
    const findCanonicalAncestor = vi.fn(async () => target);

    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        findCanonicalAncestor: findCanonicalAncestor as never,
        deadlineMs: 1_000,
      }),
    ).resolves.toEqual({
      status: "recovered-reorg",
      candidateCount: 0,
      generation: "6",
      reorgGeneration: "1",
      releaseCheckpointCount: 5,
      snapshotBlock: "0",
    });
    expect(input.store.readReorgRecoveryState).toHaveBeenCalledTimes(1);
    expect(findCanonicalAncestor).toHaveBeenCalledWith(
      expect.objectContaining({
        ancestors: [],
        genesis: expect.objectContaining({ historyGeneration: "0" }),
        policy: expect.objectContaining({
          maximumDepth: 128,
          maxProviderCalls: 128,
        }),
      }),
    );
    expect(input.store.recoverCanonicalReorg).toHaveBeenCalledWith(
      expect.objectContaining({
        recovery: expect.objectContaining({
          expectedGeneration: "5",
          nextGeneration: "6",
          expectedReorgGeneration: "0",
          nextReorgGeneration: "1",
          targetHistoryGeneration: "0",
          targetBlockNumber: "0",
        }),
      }),
    );
    expect(input.envio.readProgress).not.toHaveBeenCalled();
    expect(input.store.commitVerifiedPage).not.toHaveBeenCalled();
  });

  it("never enters recovery on provider disagreement", async () => {
    const input = fixtures();
    input.captureSafeHead.mockRejectedValue(
      validationError("rpc", "safe-head-provider-disagreement"),
    );

    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 1_000,
      }),
    ).rejects.toMatchObject({
      code: "validation_failed",
      safeMetadata: { operation: "safe-head-provider-disagreement" },
    });
    expect(input.store.readReorgRecoveryState).not.toHaveBeenCalled();
    expect(input.store.recoverCanonicalReorg).not.toHaveBeenCalled();
    expect(input.store.commitVerifiedPage).not.toHaveBeenCalled();
  });

  it("fails closed when the recovery generation changes after the plan read", async () => {
    const input = fixtures();
    input.captureSafeHead.mockRejectedValue(
      validationError("rpc", "safe-head-cursor-orphaned"),
    );
    input.store.readReorgRecoveryState.mockResolvedValue({
      ...(await input.store.readReorgRecoveryState()),
      currentReorgGeneration: "1",
    });
    const findCanonicalAncestor = vi.fn();

    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        findCanonicalAncestor: findCanonicalAncestor as never,
        deadlineMs: 1_000,
      }),
    ).rejects.toMatchObject({
      dependency: "postgres",
      code: "invalid_input",
    });
    expect(findCanonicalAncestor).not.toHaveBeenCalled();
    expect(input.store.recoverCanonicalReorg).not.toHaveBeenCalled();
    expect(input.store.commitVerifiedPage).not.toHaveBeenCalled();
  });

  it("stages a same-block factory parent without advancing public state", async () => {
    const input = fixtures();
    const vault = "0x4cfe000000000000000000000000000000000001" as const;
    const parent = candidate({
      blockNumber: 101,
      logIndex: 7,
      sourceAddress: CLASSIC_V3_FACTORY,
      contractName: "ClassicV3RewardVaultFactory",
      eventName: "ClassicRewardVaultDeployed",
      decodedPayload: { vault },
    });
    const child = candidate({
      blockNumber: 101,
      logIndex: 8,
      sourceAddress: vault,
      contractName: "ClassicV3RewardVault",
      eventName: "CreatorFeesCheckpointed",
    });
    input.envio.readCandidatesWindow
      .mockReset()
      .mockResolvedValueOnce([parent, child])
      .mockResolvedValueOnce([]);

    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 1_000,
      }),
    ).resolves.toEqual({
      status: "staged-dynamic-parent",
      candidateCount: 1,
      snapshotBlock: "101",
    });

    expect(input.store.stageVerifiedDynamicParents).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotBlock: "101",
        candidates: [parent],
        runtimeObservations: [
          expect.objectContaining({
            parentCandidateId: parent.candidateId,
            sourceAddress: vault,
            deploymentBlockNumber: "101",
            deploymentBlockHash: parent.blockHash,
            providerCallCounts: [1, 1],
          }),
        ],
        blockComplete: false,
      }),
    );
    expect(input.store.commitVerifiedPage).not.toHaveBeenCalled();
    expect(input.verifyWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [parent],
        cursor: {
          blockNumber: "100",
          blockGlobalLogIndex: 0xffff_ffff,
          candidateId: "",
        },
        through: {
          blockNumber: "101",
          blockGlobalLogIndex: 0xffff_ffff,
          candidateId: "empty-page",
        },
        coverageSourceAddresses: [CLASSIC_V3_FACTORY],
        maximumCandidateCount: 4096,
      }),
    );
    expect(input.verifyDynamicRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        parentCandidate: parent,
        sourceAddress: vault,
        deploymentBlockNumber: "101",
        deploymentBlockHash: parent.blockHash,
        template: expect.objectContaining({
          templateId: dynamicTemplate().templateId,
        }),
        parentEvidence: expect.any(Object),
        deadlineMs: expect.any(Number),
      }),
    );
  });

  it.each([2, 32, 33])(
    "stages all %i previously unknown parents from one block as one page",
    async (count) => {
      const input = fixtures();
      const parents = Array.from({ length: count }, (_, index) =>
        candidate({
          blockNumber: 101,
          logIndex: index,
          sourceAddress: CLASSIC_V3_FACTORY,
          contractName: "ClassicV3RewardVaultFactory",
          eventName: "ClassicRewardVaultDeployed",
          decodedPayload: {
            vault: `0x${(index + 1).toString(16).padStart(40, "0")}`,
            configurationHash: CURSOR_HASH,
          },
        }),
      );
      let offset = 0;
      input.envio.readCandidatesWindow.mockReset().mockImplementation(
        async ({ limit }: { limit: number }) => {
          const page = parents.slice(offset, offset + limit);
          offset += page.length;
          return page;
        },
      );

      await expect(
        runProjectorCycle({
          ...input,
          providers: [] as never,
          deadlineMs: 75_000,
        }),
      ).resolves.toEqual({
        status: "staged-dynamic-parent",
        candidateCount: count,
        snapshotBlock: "101",
      });

      expect(input.store.stageVerifiedDynamicParents).toHaveBeenCalledTimes(1);
      expect(input.store.stageVerifiedDynamicParents).toHaveBeenCalledWith(
        expect.objectContaining({
          candidates: parents,
          runtimeObservations: expect.arrayContaining(
            parents.map((parent) =>
              expect.objectContaining({
                parentCandidateId: parent.candidateId,
              }),
            ),
          ),
          blockComplete: false,
        }),
      );
      expect(input.verifyDynamicRuntime).toHaveBeenCalledTimes(count);
      expect(input.store.commitVerifiedPage).not.toHaveBeenCalled();
    },
  );

  it("does not stage or advance when the child runtime cannot be proved", async () => {
    const input = fixtures();
    const vault = "0x4cfe000000000000000000000000000000000001" as const;
    const parent = candidate({
      blockNumber: 101,
      logIndex: 7,
      sourceAddress: CLASSIC_V3_FACTORY,
      contractName: "ClassicV3RewardVaultFactory",
      eventName: "ClassicRewardVaultDeployed",
      decodedPayload: { vault },
    });
    const child = candidate({
      blockNumber: 101,
      logIndex: 8,
      sourceAddress: vault,
      contractName: "ClassicV3RewardVault",
      eventName: "CreatorFeesCheckpointed",
    });
    input.envio.readCandidatesWindow
      .mockReset()
      .mockResolvedValueOnce([parent, child])
      .mockResolvedValueOnce([]);
    input.verifyDynamicRuntime.mockRejectedValue(
      validationError("rpc", "dynamic-runtime-code-agreement"),
    );

    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(input.store.stageVerifiedDynamicParents).not.toHaveBeenCalled();
    expect(input.store.commitVerifiedPage).not.toHaveBeenCalled();
  });

  it("does not stage a child emitted before its claimed factory parent", async () => {
    const input = fixtures();
    const vault = "0x4cfe000000000000000000000000000000000001" as const;
    const child = candidate({
      blockNumber: 101,
      logIndex: 7,
      sourceAddress: vault,
      contractName: "ClassicV3RewardVault",
      eventName: "CreatorFeesCheckpointed",
    });
    const parent = candidate({
      blockNumber: 101,
      logIndex: 8,
      sourceAddress: CLASSIC_V3_FACTORY,
      contractName: "ClassicV3RewardVaultFactory",
      eventName: "ClassicRewardVaultDeployed",
      decodedPayload: { vault },
    });
    input.envio.readCandidatesWindow
      .mockReset()
      .mockResolvedValueOnce([child, parent])
      .mockResolvedValueOnce([]);
    input.verifyWindow.mockRejectedValue(
      validationError("rpc", "dynamic-source-lineage"),
    );

    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(input.store.stageVerifiedDynamicParents).not.toHaveBeenCalled();
    expect(input.store.commitVerifiedPage).not.toHaveBeenCalled();
  });

  it("replays the complete block after staged lineage becomes current", async () => {
    const input = fixtures();
    const vault = "0x4cfe000000000000000000000000000000000001" as const;
    const parent = candidate({
      blockNumber: 101,
      logIndex: 7,
      sourceAddress: "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a",
      contractName: "ClassicV3RewardVaultFactory",
      eventName: "ClassicRewardVaultDeployed",
      decodedPayload: { vault },
    });
    const child = candidate({
      blockNumber: 101,
      logIndex: 8,
      sourceAddress: vault,
      contractName: "ClassicV3RewardVault",
      eventName: "CreatorFeesCheckpointed",
    });
    const basePlan = {
      cursor: {
        generation: "5",
        blockNumber: "100",
        blockHash: CURSOR_HASH,
        blockGlobalLogIndex: -1,
        candidateId: "",
        isBlockBoundary: false,
      },
      dynamicSources: [],
      provisionalSourceAddresses: [],
      dynamicSourceTemplates: [dynamicTemplate()],
      database: {
        epochId: "70000000-0000-4000-8000-000000000002",
        pointerGeneration: "1",
        reorgGeneration: "0",
        envioProviderDeploymentId:
          "70000000-0000-4000-8000-000000000003",
        rpcProviderDeploymentIds: [
          "70000000-0000-4000-8000-000000000004",
          "70000000-0000-4000-8000-000000000005",
        ] as const,
      },
    };
    input.store.readPlan
      .mockResolvedValueOnce(basePlan)
      .mockResolvedValueOnce({
        ...basePlan,
        dynamicSources: [{ sourceAddress: vault } as never],
        provisionalSourceAddresses: [],
      });
    input.envio.readCandidatesWindow
      .mockReset()
      .mockResolvedValueOnce([parent, child])
      .mockResolvedValueOnce([parent, child]);

    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 1_000,
      }),
    ).resolves.toMatchObject({ status: "staged-dynamic-parent" });
    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 1_000,
      }),
    ).resolves.toMatchObject({
      status: "committed",
      candidateCount: 2,
      snapshotBlock: "101",
    });

    expect(input.store.stageVerifiedDynamicParents).toHaveBeenCalledTimes(1);
    expect(input.store.commitVerifiedPage).toHaveBeenCalledTimes(1);
    expect(input.store.commitVerifiedPage).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [parent, child],
        blockComplete: true,
      }),
    );
  });

  it("collects split Envio pages but publishes only one verified block boundary", async () => {
    const input = fixtures();
    const values = [
      ...Array.from({ length: 32 }, (_, index) =>
        candidate({ blockNumber: 101, logIndex: index }),
      ),
      ...Array.from({ length: 7 }, (_, index) =>
        candidate({ blockNumber: 102, logIndex: index }),
      ),
    ];
    input.envio.readCandidatesWindow
      .mockReset()
      .mockResolvedValueOnce(values.slice(0, 32))
      .mockResolvedValueOnce(values.slice(32))
      .mockResolvedValueOnce([]);

    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 1_000,
      }),
    ).resolves.toMatchObject({
      status: "committed",
      candidateCount: 39,
      snapshotBlock: "102",
    });

    expect(input.verifyWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: values,
        through: {
          blockNumber: "102",
          blockGlobalLogIndex: 0xffff_ffff,
          candidateId: "empty-page",
        },
      }),
    );
  });

  it("does not infer that an exact-size final candidate page ends its block", async () => {
    const input = fixtures();
    const values = Array.from({ length: 32 }, (_, index) =>
      candidate({ blockNumber: 101, logIndex: index }),
    );
    input.envio.readCandidatesWindow
      .mockReset()
      .mockResolvedValueOnce(values)
      .mockResolvedValueOnce([]);

    await runProjectorCycle({
      ...input,
      providers: [] as never,
      deadlineMs: 1_000,
    });

    expect(input.envio.readCandidatesWindow).toHaveBeenCalledTimes(2);
    expect(input.store.commitVerifiedPage).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: values,
        snapshotBlock: "101",
        blockComplete: true,
      }),
    );
  });

  it("cuts a capped Envio window back to the last complete block", async () => {
    const input = fixtures();
    const firstBlock = Array.from({ length: 20 }, (_, index) =>
      candidate({ blockNumber: 101, logIndex: index }),
    );
    const nextBlock = Array.from({ length: 4077 }, (_, index) =>
      candidate({ blockNumber: 102, logIndex: index }),
    );
    const values = [...firstBlock, ...nextBlock];
    let offset = 0;
    input.envio.readCandidatesWindow.mockReset().mockImplementation(
      async ({ limit }: { limit: number }) => {
        const page = values.slice(offset, offset + limit);
        offset += page.length;
        return page;
      },
    );

    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 75_000,
      }),
    ).resolves.toMatchObject({
      candidateCount: 20,
      snapshotBlock: "101",
    });
    expect(input.store.commitVerifiedPage).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: firstBlock,
        snapshotBlock: "101",
        blockComplete: true,
      }),
    );
  });

  it.each([32, 33, 4096])(
    "commits an exactly complete %i-candidate block",
    async (count) => {
      const input = fixtures();
      const values = Array.from({ length: count }, (_, index) =>
        candidate({ blockNumber: 101, logIndex: index }),
      );
      let offset = 0;
      input.envio.readCandidatesWindow.mockReset().mockImplementation(
        async ({ limit }: { limit: number }) => {
          const page = values.slice(offset, offset + limit);
          offset += page.length;
          return page;
        },
      );

      await expect(
        runProjectorCycle({
          ...input,
          providers: [] as never,
          deadlineMs: 75_000,
        }),
      ).resolves.toMatchObject({
        status: "committed",
        candidateCount: count,
        snapshotBlock: "101",
      });
      expect(input.store.commitVerifiedPage).toHaveBeenCalledWith(
        expect.objectContaining({
          candidates: values,
          blockComplete: true,
        }),
      );
      if (count === 4096) {
        expect(input.envio.readCandidatesWindow).toHaveBeenCalledTimes(129);
      }
    },
  );

  it("fails closed when one block contains 4097 candidates", async () => {
    const input = fixtures();
    const values = Array.from({ length: 4097 }, (_, index) =>
      candidate({ blockNumber: 101, logIndex: index }),
    );
    let offset = 0;
    input.envio.readCandidatesWindow.mockReset().mockImplementation(
      async ({ limit }: { limit: number }) => {
        const page = values.slice(offset, offset + limit);
        offset += page.length;
        return page;
      },
    );

    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 75_000,
      }),
    ).rejects.toMatchObject({
      dependency: "envio",
      code: "response_oversize",
      retryable: false,
    });
    expect(input.verifyWindow).not.toHaveBeenCalled();
    expect(input.store.commitVerifiedPage).not.toHaveBeenCalled();
  });

  it("caps each Envio query below the atomic commit ceiling", async () => {
    const input = fixtures();
    await runProjectorCycle({
      ...input,
      providers: [] as never,
      deadlineMs: 1_000,
    });
    expect(input.envio.readCandidatesWindow).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 32 }),
    );
  });

  it("fails closed on the overall deadline before database commit", async () => {
    const input = fixtures();
    input.captureSafeHead.mockImplementation(
      () => new Promise(() => undefined),
    );
    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 20,
      }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "timeout" });
    expect(input.store.commitVerifiedPage).not.toHaveBeenCalled();
  });
});
