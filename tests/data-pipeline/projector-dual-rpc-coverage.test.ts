import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseAbiItem,
  type AbiParameter,
  type Hex,
} from "viem";

vi.mock("server-only", () => ({}));

const { TEST_SOURCE_CODE_HASH } = vi.hoisted(() => ({
  TEST_SOURCE_CODE_HASH:
    "0x7efcce47028dabcb0d42f3a7eda8820bf6f7f4e618398c2547d52f703cafb073" as const,
}));

vi.mock(
  "../../lib/data-pipeline/release-binding.server",
  async (importOriginal) => {
    const original = await importOriginal<
      typeof import("../../lib/data-pipeline/release-binding.server")
    >();
    const binding = original.getDataPipelineReleaseBinding();
    return {
      ...original,
      getDataPipelineReleaseBinding: () => ({
        ...binding,
        sources: binding.sources.map((source) =>
          source.contractName === "ClassicV2Launcher"
            ? { ...source, runtimeCodeHash: TEST_SOURCE_CODE_HASH }
            : source,
        ),
      }),
    };
  },
);

import {
  verifyDynamicRuntimeAtBlockWithDualRpc,
  verifyEnvioCandidateWindowWithDualRpc,
  type CandidateRpcClient,
  type CandidateRpcLog,
  type DualRpcCandidateWindowEvidence,
  type ProjectorDynamicSourceTemplate,
} from "../../lib/data-pipeline/dual-rpc";
import type { EnvioCandidate } from "../../lib/data-pipeline/envio";
import { immutableReferencesCommitment } from "../../lib/data-pipeline/runtime-bytecode";
import { canonicalPayloadJson } from "../../indexer/src/lib/payload-hash";
import { rpcProviderCommitment } from "../../lib/data-pipeline/rpc-provider-commitments";

const SOURCE = "0xd240d06f8586eb799f20056054e5b527405e6bad" as const;
const BLOCK_NUMBER = 25_624_131n;
const BLOCK_HASH = `0x${"11".repeat(32)}` as const;
const SAFE_BLOCK_NUMBER = BLOCK_NUMBER + 12n;
const SAFE_BLOCK_HASH = `0x${"22".repeat(32)}` as const;
const TRANSACTION_HASH = `0x${"33".repeat(32)}` as const;
const EVENT = parseAbiItem(
  "event MemeTokenLaunched(address indexed creator, address indexed token, bytes32 indexed poolId, address feeHook, address positionRecipient, uint256 positionTokenId, uint16 totalSwapFeeBps, bytes32 launchHash)",
);
const ARGS = {
  creator: "0x1111111111111111111111111111111111111111",
  token: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"44".repeat(32)}`,
  feeHook: "0x5555555555555555555555555555555555555555",
  positionRecipient: "0x6666666666666666666666666666666666666666",
  positionTokenId: 42n,
  totalSwapFeeBps: 100n,
  launchHash: `0x${"77".repeat(32)}`,
} as const;
const TOPICS = encodeEventTopics({
  abi: [EVENT],
  eventName: EVENT.name,
  args: ARGS,
}) as readonly Hex[];
const NON_INDEXED = EVENT.inputs.filter(
  (input) => !("indexed" in input) || input.indexed !== true,
) as readonly AbiParameter[];
const DATA = encodeAbiParameters(
  NON_INDEXED,
  NON_INDEXED.map((input) => ARGS[input.name as keyof typeof ARGS]),
);
const PAYLOAD_HASH = keccak256(
  encodeAbiParameters(
    [{ type: "bytes32[]" }, { type: "bytes" }],
    [TOPICS, DATA],
  ),
);
const DYNAMIC_FACTORY =
  "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a" as const;
const DYNAMIC_CHILD =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const DYNAMIC_CONFIGURATION = `0x${"88".repeat(32)}` as const;
const DYNAMIC_REFERENCES = [{ start: 0, length: 20 }] as const;
const DYNAMIC_NORMALIZED_HASH = keccak256(
  `0x${"00".repeat(20)}`,
);
const DYNAMIC_REFERENCES_COMMITMENT = immutableReferencesCommitment(
  DYNAMIC_REFERENCES,
  20,
);

function dynamicParentCandidate(): EnvioCandidate {
  return {
    ...candidate(),
    sourceAddress: DYNAMIC_FACTORY,
    contractName: "ClassicV3RewardVaultFactory",
    eventName: "ClassicRewardVaultDeployed",
    releaseHint: { model: "classic", releaseVersion: "classic-v3" },
    decodedPayload: {
      vault: DYNAMIC_CHILD,
      configurationHash: DYNAMIC_CONFIGURATION,
    },
  };
}

function dynamicTemplate(): ProjectorDynamicSourceTemplate {
  const hash = `0x${"77".repeat(32)}` as const;
  return {
    templateId: "10000000-0000-4000-8000-000000000001",
    contractName: "ClassicV3RewardVault",
    model: "classic",
    releaseVersion: "classic-v3",
    parentFactoryAddress: DYNAMIC_FACTORY,
    parentFactoryContractName: "ClassicV3RewardVaultFactory",
    parentFactoryBindingId: "10000000-0000-4000-8000-000000000002",
    parentFactoryBindingCommitment: hash,
    parentSourceRole: "vault_factory",
    factoryEventName: "ClassicRewardVaultDeployed",
    deployedAddressField: "vault",
    deployedSourceRole: "reward_vault",
    deployedArtifactCreationCodeCommitment: hash,
    expectedExactRuntimeCodeHash: null,
    expectedNormalizedRuntimeCodeHash: DYNAMIC_NORMALIZED_HASH,
    expectedImmutableReferencesCommitment:
      DYNAMIC_REFERENCES_COMMITMENT,
    expectedRuntimeByteLength: "20",
    immutableReferences: DYNAMIC_REFERENCES,
    immutableBindingSpec: {
      factoryConfigurationField: "configurationHash",
      bindings: [
        {
          ordinal: "0",
          offset: "0",
          length: "20",
          source: "deployed_address",
          encoding: "address",
        },
      ],
    },
    immutableBindingCommitment: hash,
    abiEventSetCommitment: hash,
    templateCommitment: hash,
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
      ],
    },
  };
}

function dynamicParentEvidence(
  providers: readonly [ReturnType<typeof provider>, ReturnType<typeof provider>],
): DualRpcCandidateWindowEvidence {
  const parent = dynamicParentCandidate();
  const providerIdentities = providers.map(({ identity }) => identity) as [
    string,
    string,
  ];
  const providerVendorGroups = providers.map(({ vendorGroup }) => vendorGroup) as [
    string,
    string,
  ];
  const providerEndpointCommitments = providers.map(
    ({ endpointCommitment }) => endpointCommitment,
  ) as [`0x${string}`, `0x${string}`];
  const providerOriginCommitments = providers.map(
    ({ endpointOriginCommitment }) => endpointOriginCommitment,
  ) as [`0x${string}`, `0x${string}`];
  return {
    chainId: 1,
    providerIdentities,
    providerVendorGroups,
    providerEndpointCommitments,
    providerOriginCommitments,
    providerHeads: [
      (SAFE_BLOCK_NUMBER + 12n).toString(),
      (SAFE_BLOCK_NUMBER + 12n).toString(),
    ],
    safeBlockNumber: SAFE_BLOCK_NUMBER.toString(),
    safeBlockHash: SAFE_BLOCK_HASH,
    executionTrace: {
      startedAtMs: 1,
      completedAtMs: 2,
      candidateBatchSize: 1,
      hardDeadlineMs: 1_000,
      maxCallsPerProvider: 128,
      elapsedMs: 1,
      providerCallCounts: [0, 0],
      calls: [],
    },
    candidates: [
      {
        chainId: 1,
        candidateId: parent.candidateId,
        sourceAddress: DYNAMIC_FACTORY,
        contractName: parent.contractName,
        eventName: parent.eventName,
        sourceKind: "static",
        model: "classic",
        releaseVersion: "classic-v3",
        payloadHash: parent.payloadHash,
        rawLogCommitment: `0x${"66".repeat(32)}`,
        providerIdentities,
        providerVendorGroups,
        providerEndpointCommitments,
        providerOriginCommitments,
        providerHeads: [
          (SAFE_BLOCK_NUMBER + 12n).toString(),
          (SAFE_BLOCK_NUMBER + 12n).toString(),
        ],
        safeBlockNumber: SAFE_BLOCK_NUMBER.toString(),
        safeBlockHash: SAFE_BLOCK_HASH,
        candidateBlockNumber: BLOCK_NUMBER.toString(),
        candidateBlockHash: BLOCK_HASH,
        candidateBlockTimestamp: parent.blockTimestamp,
        transactionHash: parent.transactionHash,
        transactionIndex: parent.transactionIndex,
        receiptCommitment: `0x${"55".repeat(32)}`,
        sourceCodeHash: `0x${"44".repeat(32)}`,
        receiptLogOrdinal: 0,
      },
    ],
    coveredCandidateCount: 1,
    coverage: {
      fromBlockNumber: (BLOCK_NUMBER - 1n).toString(),
      throughBlockNumber: BLOCK_NUMBER.toString(),
      throughBlockHash: BLOCK_HASH,
      throughBlockGlobalLogIndex: String(parent.blockGlobalLogIndex),
      filterCommitment: `0x${"22".repeat(32)}`,
      providerLogCommitments: [
        `0x${"33".repeat(32)}`,
        `0x${"33".repeat(32)}`,
      ],
    },
  };
}

function candidate(): EnvioCandidate {
  return {
    candidateId: `1:${BLOCK_HASH}:${TRANSACTION_HASH}:7`,
    chainId: 1,
    blockNumber: BLOCK_NUMBER.toString(),
    blockHash: BLOCK_HASH,
    blockTimestamp: "1785480000",
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 2,
    blockGlobalLogIndex: 7,
    sourceAddress: SOURCE,
    contractName: "ClassicV2Launcher",
    eventName: "MemeTokenLaunched",
    releaseHint: { model: "classic", releaseVersion: "classic-v2" },
    orderedTopics: [...TOPICS] as `0x${string}`[],
    rawData: DATA,
    decodedPayload: JSON.parse(canonicalPayloadJson(ARGS)),
    payloadHash: PAYLOAD_HASH,
  };
}

function canonicalLog(overrides: Partial<CandidateRpcLog> = {}): CandidateRpcLog {
  return {
    address: SOURCE,
    blockNumber: BLOCK_NUMBER,
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 2,
    logIndex: 7,
    removed: false,
    topics: TOPICS,
    data: DATA,
    ...overrides,
  };
}

function client(logs: readonly CandidateRpcLog[]): CandidateRpcClient {
  return {
    getChainId: async () => 1,
    getBlockNumber: async () => SAFE_BLOCK_NUMBER + 12n,
    getBlock: async ({ blockNumber }) =>
      blockNumber === SAFE_BLOCK_NUMBER
        ? {
            number: SAFE_BLOCK_NUMBER,
            hash: SAFE_BLOCK_HASH,
            timestamp: 1785480100n,
          }
        : {
            number: BLOCK_NUMBER,
            hash: BLOCK_HASH,
            timestamp: 1785480000n,
          },
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: BLOCK_NUMBER,
      blockHash: BLOCK_HASH,
      transactionHash: TRANSACTION_HASH,
      transactionIndex: 2,
      logs: [canonicalLog()],
    }),
    getBytecode: async () => "0x6001600055",
    getLogs: vi.fn(async ({ fromBlock, toBlock }) =>
      logs.filter(
        (log) =>
          log.blockNumber !== null &&
          log.blockNumber >= fromBlock &&
          log.blockNumber <= toBlock,
      ),
    ),
  };
}

function provider(identity: string, rpcClient: CandidateRpcClient) {
  const endpointOrigin = `https://${identity}.example`;
  return {
    identity,
    vendorGroup: identity.split("-")[0]!,
    endpointCommitment: rpcProviderCommitment("endpoint", endpointOrigin),
    endpointOriginCommitment: rpcProviderCommitment("origin", endpointOrigin),
    client: rpcClient,
  };
}

function verify(firstLogs: readonly CandidateRpcLog[], secondLogs = firstLogs) {
  return verifyEnvioCandidateWindowWithDualRpc({
    candidates: [candidate()],
    cursor: {
      blockNumber: (BLOCK_NUMBER - 1n).toString(),
      blockGlobalLogIndex: -1,
      candidateId: "",
    },
    through: {
      blockNumber: BLOCK_NUMBER.toString(),
      blockGlobalLogIndex: 7,
      candidateId: candidate().candidateId,
    },
    providers: [
      provider("alchemy-mainnet", client(firstLogs)),
      provider("quicknode-mainnet", client(secondLogs)),
    ],
    rpcPolicy: { maxAttempts: 1 },
  });
}

describe("dual-RPC exact Envio window coverage", () => {
  it("accepts only an exact independent getLogs match", async () => {
    await expect(verify([canonicalLog()])).resolves.toMatchObject({
      coveredCandidateCount: 1,
      coverage: {
        fromBlockNumber: (BLOCK_NUMBER - 1n).toString(),
        throughBlockNumber: BLOCK_NUMBER.toString(),
        throughBlockHash: BLOCK_HASH,
      },
    });
  });

  it("rejects a provider omission", async () => {
    await expect(verify([], [canonicalLog()])).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
    });
  });

  it("rejects an authorized RPC log when Envio returns an empty window", async () => {
    await expect(
      verifyEnvioCandidateWindowWithDualRpc({
        candidates: [],
        cursor: {
          blockNumber: (BLOCK_NUMBER - 1n).toString(),
          blockGlobalLogIndex: -1,
          candidateId: "",
        },
        through: {
          blockNumber: BLOCK_NUMBER.toString(),
          blockGlobalLogIndex: 4_294_967_295,
          candidateId: "empty-page",
        },
        providers: [
          provider("alchemy-mainnet", client([canonicalLog()])),
          provider("quicknode-mainnet", client([canonicalLog()])),
        ],
        rpcPolicy: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "validation_failed" });
  });

  it("rejects a terminal watermark when providers disagree on its block hash", async () => {
    const first = client([]);
    const second = client([]);
    second.getBlock = async ({ blockNumber }) =>
      blockNumber === SAFE_BLOCK_NUMBER
        ? {
            number: SAFE_BLOCK_NUMBER,
            hash: SAFE_BLOCK_HASH,
            timestamp: 1785480100n,
          }
        : {
            number: BLOCK_NUMBER,
            hash: `0x${"99".repeat(32)}`,
            timestamp: 1785480000n,
          };

    await expect(
      verifyEnvioCandidateWindowWithDualRpc({
        candidates: [],
        cursor: {
          blockNumber: (BLOCK_NUMBER - 1n).toString(),
          blockGlobalLogIndex: -1,
          candidateId: "",
        },
        through: {
          blockNumber: BLOCK_NUMBER.toString(),
          blockGlobalLogIndex: 4_294_967_295,
          candidateId: "empty-page",
        },
        providers: [
          provider("alchemy-mainnet", first),
          provider("quicknode-mainnet", second),
        ],
        rpcPolicy: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "validation_failed" });
  });

  it("binds a same-block dynamic child to one exact bytecode read per provider", async () => {
    const first = client([canonicalLog()]);
    const second = client([canonicalLog()]);
    const providers = [
      provider("alchemy-mainnet", first),
      provider("quicknode-mainnet", second),
    ] as const;
    const parentCandidate = dynamicParentCandidate();
    const parentEvidence = dynamicParentEvidence(providers);
    first.getBytecode = vi.fn(async () => DYNAMIC_CHILD);
    second.getBytecode = vi.fn(async () => DYNAMIC_CHILD);

    await expect(
      verifyDynamicRuntimeAtBlockWithDualRpc({
        parentCandidate,
        sourceAddress: DYNAMIC_CHILD,
        deploymentBlockNumber: BLOCK_NUMBER.toString(),
        deploymentBlockHash: BLOCK_HASH,
        template: dynamicTemplate(),
        parentEvidence,
        providers,
        deadlineMs: 1_000,
      }),
    ).resolves.toMatchObject({
      parentCandidateId: parentCandidate.candidateId,
      sourceAddress: DYNAMIC_CHILD,
      deploymentBlockNumber: BLOCK_NUMBER.toString(),
      deploymentBlockHash: BLOCK_HASH,
      rawRuntimeCodeA: DYNAMIC_CHILD,
      rawRuntimeCodeB: DYNAMIC_CHILD,
      normalizedRuntimeCodeHashA: DYNAMIC_NORMALIZED_HASH,
      normalizedRuntimeCodeHashB: DYNAMIC_NORMALIZED_HASH,
      runtimeByteLengthA: "20",
      runtimeByteLengthB: "20",
      immutableReferencesCommitment: DYNAMIC_REFERENCES_COMMITMENT,
      immutableValues: [DYNAMIC_CHILD],
      reconstructedRuntimeCode: DYNAMIC_CHILD,
      factoryConfigurationCommitment: DYNAMIC_CONFIGURATION,
      providerCallCounts: [1, 1],
    });
    expect(first.getBytecode).toHaveBeenCalledTimes(1);
    expect(second.getBytecode).toHaveBeenCalledTimes(1);
    expect(first.getBytecode).toHaveBeenCalledWith({
      address: DYNAMIC_CHILD,
      blockNumber: BLOCK_NUMBER,
    });
  });

  it("fails closed when providers disagree on the dynamic child bytecode", async () => {
    const first = client([canonicalLog()]);
    const second = client([canonicalLog()]);
    const providers = [
      provider("alchemy-mainnet", first),
      provider("quicknode-mainnet", second),
    ] as const;
    const parentCandidate = dynamicParentCandidate();
    const parentEvidence = dynamicParentEvidence(providers);
    first.getBytecode = vi.fn(async () => DYNAMIC_CHILD);
    second.getBytecode = vi.fn(
      async () => "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
    );

    await expect(
      verifyDynamicRuntimeAtBlockWithDualRpc({
        parentCandidate,
        sourceAddress: DYNAMIC_CHILD,
        deploymentBlockNumber: BLOCK_NUMBER.toString(),
        deploymentBlockHash: BLOCK_HASH,
        template: dynamicTemplate(),
        parentEvidence,
        providers,
        deadlineMs: 1_000,
      }),
    ).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
    });
    expect(first.getBytecode).toHaveBeenCalledTimes(1);
    expect(second.getBytecode).toHaveBeenCalledTimes(1);
  });

  it("rejects an extra manifest event omitted by Envio", async () => {
    const extra = canonicalLog({
      transactionHash: `0x${"88".repeat(32)}`,
      transactionIndex: 3,
      logIndex: 6,
    });
    await expect(
      verify([extra, canonicalLog()], [extra, canonicalLog()]),
    ).rejects.toMatchObject({ dependency: "rpc", code: "validation_failed" });
  });

  it("rejects provider disagreement even when one side matches Envio", async () => {
    await expect(
      verify(
        [canonicalLog()],
        [canonicalLog({ blockHash: `0x${"99".repeat(32)}` })],
      ),
    ).rejects.toMatchObject({ dependency: "rpc", code: "validation_failed" });
  });

  it("bounds getLogs block ranges and request count", async () => {
    const first = client([canonicalLog()]);
    const second = client([canonicalLog()]);
    await verifyEnvioCandidateWindowWithDualRpc({
      candidates: [candidate()],
      cursor: {
        blockNumber: (BLOCK_NUMBER - 1_200n).toString(),
        blockGlobalLogIndex: -1,
        candidateId: "",
      },
      through: {
        blockNumber: BLOCK_NUMBER.toString(),
        blockGlobalLogIndex: 7,
        candidateId: candidate().candidateId,
      },
      providers: [
        provider("alchemy-mainnet", first),
        provider("quicknode-mainnet", second),
      ],
      coveragePolicy: { maximumBlockSpan: 500, maximumRequests: 8 },
      rpcPolicy: { maxAttempts: 1 },
    });
    for (const rpcClient of [first, second]) {
      const getLogs = vi.mocked(rpcClient.getLogs!);
      expect(getLogs).toHaveBeenCalledTimes(3);
      for (const [request] of getLogs.mock.calls) {
        expect(request.toBlock - request.fromBlock + 1n).toBeLessThanOrEqual(500n);
      }
    }
  });

  it("fails closed when the provider call budget is insufficient", async () => {
    const first = client([canonicalLog()]);
    const second = client([canonicalLog()]);
    await expect(
      verifyEnvioCandidateWindowWithDualRpc({
        candidates: [candidate()],
        cursor: {
          blockNumber: (BLOCK_NUMBER - 1n).toString(),
          blockGlobalLogIndex: -1,
          candidateId: "",
        },
        through: {
          blockNumber: BLOCK_NUMBER.toString(),
          blockGlobalLogIndex: 7,
          candidateId: candidate().candidateId,
        },
        providers: [
          provider("alchemy-mainnet", first),
          provider("quicknode-mainnet", second),
        ],
        rpcPolicy: { maxAttempts: 1, maxProviderCalls: 5 },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("does not let getLogs retries amplify past the physical call cap", async () => {
    const first = client([canonicalLog()]);
    const second = client([canonicalLog()]);
    first.getLogs = vi
      .fn<NonNullable<CandidateRpcClient["getLogs"]>>()
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValue([canonicalLog()]);
    second.getLogs = vi
      .fn<NonNullable<CandidateRpcClient["getLogs"]>>()
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValue([canonicalLog()]);

    await expect(
      verifyEnvioCandidateWindowWithDualRpc({
        candidates: [candidate()],
        cursor: {
          blockNumber: (BLOCK_NUMBER - 1n).toString(),
          blockGlobalLogIndex: -1,
          candidateId: "",
        },
        through: {
          blockNumber: BLOCK_NUMBER.toString(),
          blockGlobalLogIndex: 7,
          candidateId: candidate().candidateId,
        },
        providers: [
          provider("alchemy-mainnet", first),
          provider("quicknode-mainnet", second),
        ],
        rpcPolicy: {
          maxAttempts: 2,
          baseBackoffMs: 0,
          maxCallsPerProvider: 8,
          sleep: async () => undefined,
        },
      }),
    ).rejects.toMatchObject({
      code: "dependency_unavailable",
    });
    expect(first.getLogs).toHaveBeenCalledTimes(1);
    expect(second.getLogs).toHaveBeenCalledTimes(1);
  });

  it("enforces one hard deadline across batch and coverage", async () => {
    const hanging = client([canonicalLog()]);
    hanging.getBlockNumber = () => new Promise(() => undefined);
    const startedAt = Date.now();
    await expect(
      verifyEnvioCandidateWindowWithDualRpc({
        candidates: [candidate()],
        cursor: {
          blockNumber: (BLOCK_NUMBER - 1n).toString(),
          blockGlobalLogIndex: -1,
          candidateId: "",
        },
        through: {
          blockNumber: BLOCK_NUMBER.toString(),
          blockGlobalLogIndex: 7,
          candidateId: candidate().candidateId,
        },
        providers: [
          provider("alchemy-mainnet", hanging),
          provider("quicknode-mainnet", client([canonicalLog()])),
        ],
        rpcPolicy: {
          maxAttempts: 1,
          deadlineMs: 20,
        },
      }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "timeout" });
    expect(Date.now() - startedAt).toBeLessThan(250);
  });
});
