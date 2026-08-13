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
  verifyDynamicRuntimeAtActivationWithDualRpc,
  verifyDynamicRuntimeAtBlockWithDualRpc,
  verifyDynamicRuntimesAtBlockWithDualRpc,
  verifyEnvioCandidateWindowWithDualRpc,
  type CandidateRpcClient,
  type CandidateRpcLog,
  type DualRpcCandidateBatchEvidence,
  type DualRpcCandidateWindowEvidence,
  type ProjectorDynamicSourceTemplate,
} from "../../lib/data-pipeline/dual-rpc";
import type { EnvioCandidate } from "../../lib/data-pipeline/envio";
import type { CanonicalDynamicSourceDeploymentEvidence } from "../../lib/data-pipeline/projector-dynamic-activation";
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
const DYNAMIC_POOL_ID = `0x${"98".repeat(32)}` as const;
const DYNAMIC_FEE_HOOK =
  "0x9999999999999999999999999999999999999999" as const;
const CLASSIC_V3_LAUNCHER =
  "0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770" as const;
const ACTIVATION_BLOCK_NUMBER = BLOCK_NUMBER + 20_000n;
const ACTIVATION_BLOCK_HASH = `0x${"a1".repeat(32)}` as const;
const ACTIVATION_TRANSACTION_HASH = `0x${"a2".repeat(32)}` as const;
const DYNAMIC_REFERENCES = [{ start: 0, length: 20 }] as const;
const DYNAMIC_NORMALIZED_HASH = keccak256(
  `0x${"00".repeat(20)}`,
);
const DYNAMIC_REFERENCES_COMMITMENT = immutableReferencesCommitment(
  DYNAMIC_REFERENCES,
  20,
);

const DYNAMIC_PARENT_EVENT = parseAbiItem(
  "event ClassicRewardVaultDeployed(address indexed vault, bytes32 indexed poolId, address indexed feeHook, bytes32 salt, bytes32 configurationHash)",
);
const DYNAMIC_LAUNCH_EVENT = parseAbiItem(
  "event MemeTokenLaunchedV2(address indexed deployer, address indexed token, bytes32 indexed poolId, address feeHook, address rewardVault, address positionRecipient, uint256 positionTokenId, uint16 buySwapFeeBps, uint16 sellSwapFeeBps, bytes32 rewardConfigurationHash, bytes32 launchHash)",
);

function encodedEventCandidate(input: {
  event: typeof DYNAMIC_PARENT_EVENT | typeof DYNAMIC_LAUNCH_EVENT;
  eventName: "ClassicRewardVaultDeployed" | "MemeTokenLaunchedV2";
  args: Record<string, unknown>;
  base: EnvioCandidate;
}): EnvioCandidate {
  const topics = encodeEventTopics({
    abi: [input.event],
    eventName: input.eventName,
    args: input.args,
  }) as readonly Hex[];
  const nonIndexed = input.event.inputs.filter(
    (parameter) => !("indexed" in parameter) || parameter.indexed !== true,
  ) as readonly AbiParameter[];
  const data = encodeAbiParameters(
    nonIndexed,
    nonIndexed.map(
      (parameter) => input.args[parameter.name as keyof typeof input.args],
    ),
  );
  return {
    ...input.base,
    orderedTopics: [...topics],
    rawData: data,
    decodedPayload: JSON.parse(canonicalPayloadJson(input.args)),
    payloadHash: keccak256(
      encodeAbiParameters(
        [{ type: "bytes32[]" }, { type: "bytes" }],
        [topics, data],
      ),
    ),
  };
}

function dynamicParentCandidate(): EnvioCandidate {
  const base = {
    ...candidate(),
    sourceAddress: DYNAMIC_FACTORY,
    contractName: "ClassicV3RewardVaultFactory",
    eventName: "ClassicRewardVaultDeployed",
    releaseHint: { model: "classic", releaseVersion: "classic-v3" },
  } as EnvioCandidate;
  return encodedEventCandidate({
    event: DYNAMIC_PARENT_EVENT,
    eventName: "ClassicRewardVaultDeployed",
    base,
    args: {
      vault: DYNAMIC_CHILD,
      poolId: DYNAMIC_POOL_ID,
      feeHook: DYNAMIC_FEE_HOOK,
      salt: `0x${"87".repeat(32)}`,
      configurationHash: DYNAMIC_CONFIGURATION,
    },
  });
}

function dynamicLaunchCandidate(
  overrides: Partial<EnvioCandidate["decodedPayload"]> = {},
): EnvioCandidate {
  const base = {
    ...candidate(),
    candidateId:
      `1:${ACTIVATION_BLOCK_HASH}:${ACTIVATION_TRANSACTION_HASH}:4`,
    blockNumber: ACTIVATION_BLOCK_NUMBER.toString(),
    blockHash: ACTIVATION_BLOCK_HASH,
    transactionHash: ACTIVATION_TRANSACTION_HASH,
    transactionIndex: 1,
    blockGlobalLogIndex: 4,
    sourceAddress: CLASSIC_V3_LAUNCHER,
    contractName: "ClassicV3Launcher",
    eventName: "MemeTokenLaunchedV2",
    releaseHint: { model: "classic", releaseVersion: "classic-v3" },
  } as EnvioCandidate;
  return encodedEventCandidate({
    event: DYNAMIC_LAUNCH_EVENT,
    eventName: "MemeTokenLaunchedV2",
    base,
    args: {
      deployer: "0x1111111111111111111111111111111111111111",
      token: "0x2222222222222222222222222222222222222222",
      poolId: DYNAMIC_POOL_ID,
      rewardVault: DYNAMIC_CHILD,
      feeHook: DYNAMIC_FEE_HOOK,
      positionRecipient: "0x3333333333333333333333333333333333333333",
      positionTokenId: 1n,
      buySwapFeeBps: 100n,
      sellSwapFeeBps: 100n,
      rewardConfigurationHash: DYNAMIC_CONFIGURATION,
      launchHash: `0x${"89".repeat(32)}`,
      ...overrides,
    },
  });
}

function dynamicActivationEvidence(
  providers: readonly [ReturnType<typeof provider>, ReturnType<typeof provider>],
  launch = dynamicLaunchCandidate(),
): DualRpcCandidateBatchEvidence {
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
      (ACTIVATION_BLOCK_NUMBER + 12n).toString(),
      (ACTIVATION_BLOCK_NUMBER + 12n).toString(),
    ],
    safeBlockNumber: ACTIVATION_BLOCK_NUMBER.toString(),
    safeBlockHash: ACTIVATION_BLOCK_HASH,
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
        candidateId: launch.candidateId,
        sourceAddress: launch.sourceAddress,
        contractName: launch.contractName,
        eventName: launch.eventName,
        sourceKind: "static",
        model: "classic",
        releaseVersion: "classic-v3",
        payloadHash: launch.payloadHash,
        rawLogCommitment: `0x${"a3".repeat(32)}`,
        providerIdentities,
        providerVendorGroups,
        providerEndpointCommitments,
        providerOriginCommitments,
        providerHeads: [
          (ACTIVATION_BLOCK_NUMBER + 12n).toString(),
          (ACTIVATION_BLOCK_NUMBER + 12n).toString(),
        ],
        safeBlockNumber: ACTIVATION_BLOCK_NUMBER.toString(),
        safeBlockHash: ACTIVATION_BLOCK_HASH,
        candidateBlockNumber: ACTIVATION_BLOCK_NUMBER.toString(),
        candidateBlockHash: ACTIVATION_BLOCK_HASH,
        candidateBlockTimestamp: launch.blockTimestamp,
        transactionHash: launch.transactionHash,
        transactionIndex: launch.transactionIndex,
        receiptCommitment: `0x${"a4".repeat(32)}`,
        sourceCodeHash: `0x${"a5".repeat(32)}`,
        receiptLogOrdinal: 0,
      },
    ],
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
      throughBlockGlobalLogIndex: String(0xffff_ffff),
      filterCommitment: `0x${"22".repeat(32)}`,
      providerLogCommitments: [
        `0x${"33".repeat(32)}`,
        `0x${"33".repeat(32)}`,
      ],
    },
  };
}

function canonicalDeploymentEvidence(
  providers: readonly [ReturnType<typeof provider>, ReturnType<typeof provider>],
  parent = dynamicParentCandidate(),
  overrides: Partial<CanonicalDynamicSourceDeploymentEvidence> = {},
): CanonicalDynamicSourceDeploymentEvidence {
  const template = dynamicTemplate();
  return {
    provisionalPageId: "20000000-0000-8000-8000-000000000001",
    provisionalLineageId: "20000000-0000-8000-8000-000000000002",
    dynamicSourceAttestationId:
      "20000000-0000-8000-8000-000000000003",
    runtimeCodeEvidenceId: "20000000-0000-8000-8000-000000000004",
    dynamicSourceTemplateId: template.templateId,
    parentOccurrenceId: "20000000-0000-8000-8000-000000000005",
    parentCandidateId: parent.candidateId,
    parentBlockNumber: parent.blockNumber,
    parentBlockHash: parent.blockHash,
    parentBlockGlobalLogIndex: parent.blockGlobalLogIndex,
    parentTransactionHash: parent.transactionHash,
    parentTransactionIndex: parent.transactionIndex,
    parentSourceAddress: parent.sourceAddress,
    parentContractName: parent.contractName,
    parentEventName: parent.eventName,
    parentPayloadHash: parent.payloadHash,
    parentRawLogCommitment: keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "bytes32[]" }, { type: "bytes" }],
        [parent.sourceAddress, parent.orderedTopics, parent.rawData],
      ),
    ),
    canonicalStatusHistoryId:
      "20000000-0000-8000-8000-000000000006",
    safeHeadObservationId: "20000000-0000-8000-8000-000000000007",
    blockEvidenceId: "20000000-0000-8000-8000-000000000008",
    reorgGeneration: template.database.reorgGeneration,
    envioProviderDeploymentId: template.database.envioProviderDeploymentId,
    rpcProviderDeploymentIds: template.database.rpcProviderDeploymentIds,
    providerIdentities: providers.map(({ identity }) => identity) as [
      string,
      string,
    ],
    providerVendorGroups: providers.map(({ vendorGroup }) => vendorGroup) as [
      string,
      string,
    ],
    providerEndpointCommitments: providers.map(
      ({ endpointCommitment }) => endpointCommitment,
    ) as [`0x${string}`, `0x${string}`],
    providerOriginCommitments: providers.map(
      ({ endpointOriginCommitment }) => endpointOriginCommitment,
    ) as [`0x${string}`, `0x${string}`],
    ...overrides,
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
  const filteredLogs = ({
    addresses,
    topic0,
    fromBlock,
    toBlock,
  }: Parameters<NonNullable<CandidateRpcClient["getLogs"]>>[0]) =>
    logs.filter(
      (log) =>
        log.blockNumber !== null &&
        log.blockNumber >= fromBlock &&
        log.blockNumber <= toBlock &&
        addresses.includes(log.address as `0x${string}`) &&
        log.topics[0] !== undefined &&
        topic0.includes(log.topics[0] as `0x${string}`),
    );
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
    getLogs: vi.fn(async (filter) => filteredLogs(filter)),
    getLogsBatch: vi.fn(async ({ requests }) =>
      requests.map(filteredLogs),
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
      provider("drpc-mainnet", client(firstLogs)),
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
          provider("drpc-mainnet", client([canonicalLog()])),
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
          provider("drpc-mainnet", first),
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
      provider("drpc-mainnet", first),
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
      blockHash: BLOCK_HASH,
      requireCanonical: true,
    });
  });

  it("batches more than 100 dynamic runtimes while preserving exact provider binding", async () => {
    const first = client([canonicalLog()]);
    const second = client([canonicalLog()]);
    const providers = [
      provider("drpc-mainnet", first),
      provider("quicknode-mainnet", second),
    ] as const;
    const items = Array.from({ length: 101 }, (_, index) => {
      const sourceAddress = `0x${(index + 1_000)
        .toString(16)
        .padStart(40, "0")}` as const;
      const transactionHash = `0x${(index + 1)
        .toString(16)
        .padStart(64, "0")}` as const;
      const parentCandidate = {
        ...dynamicParentCandidate(),
        candidateId: `1:${BLOCK_HASH}:${transactionHash}:${index}`,
        transactionHash,
        transactionIndex: index,
        blockGlobalLogIndex: index,
        decodedPayload: {
          ...dynamicParentCandidate().decodedPayload,
          vault: sourceAddress,
        },
      } satisfies EnvioCandidate;
      return {
        parentCandidate,
        sourceAddress,
        deploymentBlockNumber: BLOCK_NUMBER.toString(),
        deploymentBlockHash: BLOCK_HASH,
        template: dynamicTemplate(),
      } as const;
    });
    const baseParentEvidence = dynamicParentEvidence(providers);
    const baseCandidateEvidence = baseParentEvidence.candidates[0]!;
    const parentEvidence: DualRpcCandidateWindowEvidence = {
      ...baseParentEvidence,
      executionTrace: {
        ...baseParentEvidence.executionTrace,
        candidateBatchSize: items.length,
      },
      candidates: items.map(({ parentCandidate }) => ({
        ...baseCandidateEvidence,
        candidateId: parentCandidate.candidateId,
        payloadHash: parentCandidate.payloadHash,
        transactionHash: parentCandidate.transactionHash,
        transactionIndex: parentCandidate.transactionIndex,
        receiptLogOrdinal: parentCandidate.blockGlobalLogIndex,
      })),
      coveredCandidateCount: items.length,
    };
    const installBatchReader = (rpcClient: CandidateRpcClient) => {
      rpcClient.getBytecode = vi.fn(rpcClient.getBytecode);
      rpcClient.getBytecodes = vi.fn(async (
        { requests }:
          Parameters<NonNullable<CandidateRpcClient["getBytecodes"]>>[0],
      ) => requests.map(({ address }) => address));
    };
    installBatchReader(first);
    installBatchReader(second);

    const observations = await verifyDynamicRuntimesAtBlockWithDualRpc({
      items,
      parentEvidence,
      providers,
      deadlineMs: 2_000,
    });

    expect(observations).toHaveLength(101);
    expect(observations.map(({ sourceAddress }) => sourceAddress)).toEqual(
      items.map(({ sourceAddress }) => sourceAddress),
    );
    for (const rpcClient of [first, second]) {
      expect(rpcClient.getBytecodes).toHaveBeenCalledTimes(6);
      expect(rpcClient.getBytecode).not.toHaveBeenCalled();
      const requests = vi.mocked(rpcClient.getBytecodes!).mock.calls.flatMap(
        ([input]) => input.requests,
      );
      expect(requests).toHaveLength(101);
      expect(
        vi.mocked(rpcClient.getBytecodes!).mock.calls.map(
          ([input]) => input.requests.length,
        ),
      ).toEqual([20, 20, 20, 20, 20, 1]);
      expect(requests).toEqual(
        items.map(({ sourceAddress }) => ({
          address: sourceAddress,
          blockHash: BLOCK_HASH,
          requireCanonical: true,
        })),
      );
    }

    const divergentRuntime =
      "0xffffffffffffffffffffffffffffffffffffffff" as const;
    second.getBytecodes = vi.fn(async (
      { requests }:
        Parameters<NonNullable<CandidateRpcClient["getBytecodes"]>>[0],
    ) => requests.map(({ address }) =>
      address === items[0]!.sourceAddress ? divergentRuntime : address,
    ));
    await expect(
      verifyDynamicRuntimesAtBlockWithDualRpc({
        items,
        parentEvidence,
        providers,
        deadlineMs: 2_000,
      }),
    ).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
      safeMetadata: { operation: "dynamic-runtime-code-agreement" },
    });
    expect(second.getBytecodes).toHaveBeenCalledTimes(6);
  });

  it("fails closed when providers disagree on the dynamic child bytecode", async () => {
    const first = client([canonicalLog()]);
    const second = client([canonicalLog()]);
    const providers = [
      provider("drpc-mainnet", first),
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

  it("re-verifies a staged reward vault at the exact canonical launch block", async () => {
    const first = client([]);
    const second = client([]);
    const providers = [
      provider("drpc-mainnet", first),
      provider("quicknode-mainnet", second),
    ] as const;
    const parentCandidate = dynamicParentCandidate();
    const launchCandidate = dynamicLaunchCandidate();
    first.getBytecode = vi.fn(async () => DYNAMIC_CHILD);
    second.getBytecode = vi.fn(async () => DYNAMIC_CHILD);

    await expect(
      verifyDynamicRuntimeAtActivationWithDualRpc({
        parentCandidate,
        launchCandidate,
        sourceAddress: DYNAMIC_CHILD,
        template: dynamicTemplate(),
        canonicalDeployment: canonicalDeploymentEvidence(
          providers,
          parentCandidate,
        ),
        activationEvidence: dynamicActivationEvidence(
          providers,
          launchCandidate,
        ),
        providers,
        deadlineMs: 1_000,
      }),
    ).resolves.toMatchObject({
      parentCandidateId: parentCandidate.candidateId,
      launchCandidateId: launchCandidate.candidateId,
      sourceAddress: DYNAMIC_CHILD,
      deploymentBlockNumber: BLOCK_NUMBER.toString(),
      deploymentBlockHash: BLOCK_HASH,
      activationBlockNumber: ACTIVATION_BLOCK_NUMBER.toString(),
      activationBlockHash: ACTIVATION_BLOCK_HASH,
      activationBlockGlobalLogIndex: 4,
      rawRuntimeCodeA: DYNAMIC_CHILD,
      rawRuntimeCodeB: DYNAMIC_CHILD,
      factoryConfigurationCommitment: DYNAMIC_CONFIGURATION,
      providerCallCounts: [1, 1],
    });
    expect(first.getBytecode).toHaveBeenCalledTimes(1);
    expect(second.getBytecode).toHaveBeenCalledTimes(1);
    expect(first.getBytecode).toHaveBeenCalledWith({
      address: DYNAMIC_CHILD,
      blockHash: ACTIVATION_BLOCK_HASH,
      requireCanonical: true,
    });
  });

  it("rejects a launch whose reward configuration does not bind the staged parent", async () => {
    const first = client([]);
    const second = client([]);
    const providers = [
      provider("drpc-mainnet", first),
      provider("quicknode-mainnet", second),
    ] as const;
    const launchCandidate = dynamicLaunchCandidate({
      rewardConfigurationHash: `0x${"b1".repeat(32)}`,
    });
    first.getBytecode = vi.fn(async () => DYNAMIC_CHILD);
    second.getBytecode = vi.fn(async () => DYNAMIC_CHILD);

    await expect(
      verifyDynamicRuntimeAtActivationWithDualRpc({
        parentCandidate: dynamicParentCandidate(),
        launchCandidate,
        sourceAddress: DYNAMIC_CHILD,
        template: dynamicTemplate(),
        canonicalDeployment: canonicalDeploymentEvidence(
          providers,
          dynamicParentCandidate(),
        ),
        activationEvidence: dynamicActivationEvidence(
          providers,
          launchCandidate,
        ),
        providers,
        deadlineMs: 1_000,
      }),
    ).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
    });
    expect(first.getBytecode).not.toHaveBeenCalled();
    expect(second.getBytecode).not.toHaveBeenCalled();
  });

  it("rejects a canonical parent whose raw log no longer decodes to its payload", async () => {
    const first = client([]);
    const second = client([]);
    const providers = [
      provider("drpc-mainnet", first),
      provider("quicknode-mainnet", second),
    ] as const;
    const originalParent = dynamicParentCandidate();
    const maliciousParent = {
      ...originalParent,
      rawData: "0x00" as const,
    };
    const launchCandidate = dynamicLaunchCandidate();
    first.getBytecode = vi.fn(async () => DYNAMIC_CHILD);
    second.getBytecode = vi.fn(async () => DYNAMIC_CHILD);

    await expect(
      verifyDynamicRuntimeAtActivationWithDualRpc({
        parentCandidate: maliciousParent,
        launchCandidate,
        sourceAddress: DYNAMIC_CHILD,
        template: dynamicTemplate(),
        canonicalDeployment: canonicalDeploymentEvidence(
          providers,
          maliciousParent,
        ),
        activationEvidence: dynamicActivationEvidence(
          providers,
          launchCandidate,
        ),
        providers,
        deadlineMs: 1_000,
      }),
    ).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
    });
    expect(first.getBytecode).not.toHaveBeenCalled();
    expect(second.getBytecode).not.toHaveBeenCalled();
  });

  it("rejects a same-height parent from a replacement fork", async () => {
    const first = client([]);
    const second = client([]);
    const providers = [
      provider("drpc-mainnet", first),
      provider("quicknode-mainnet", second),
    ] as const;
    const originalParent = dynamicParentCandidate();
    const parentCandidate = {
      ...originalParent,
      candidateId:
        `1:${BLOCK_HASH}:${originalParent.transactionHash}:3` as const,
      blockNumber: ACTIVATION_BLOCK_NUMBER.toString(),
      blockGlobalLogIndex: 3,
    };
    const launchCandidate = dynamicLaunchCandidate();

    await expect(
      verifyDynamicRuntimeAtActivationWithDualRpc({
        parentCandidate,
        launchCandidate,
        sourceAddress: DYNAMIC_CHILD,
        template: dynamicTemplate(),
        canonicalDeployment: canonicalDeploymentEvidence(
          providers,
          parentCandidate,
        ),
        activationEvidence: dynamicActivationEvidence(
          providers,
          launchCandidate,
        ),
        providers,
        deadlineMs: 1_000,
      }),
    ).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
    });
  });

  it("rejects a parent that appears after the launch in the same block", async () => {
    const first = client([]);
    const second = client([]);
    const providers = [
      provider("drpc-mainnet", first),
      provider("quicknode-mainnet", second),
    ] as const;
    const originalParent = dynamicParentCandidate();
    const parentCandidate = {
      ...originalParent,
      candidateId:
        `1:${ACTIVATION_BLOCK_HASH}:${originalParent.transactionHash}:5` as const,
      blockNumber: ACTIVATION_BLOCK_NUMBER.toString(),
      blockHash: ACTIVATION_BLOCK_HASH,
      blockGlobalLogIndex: 5,
    };
    const launchCandidate = dynamicLaunchCandidate();

    await expect(
      verifyDynamicRuntimeAtActivationWithDualRpc({
        parentCandidate,
        launchCandidate,
        sourceAddress: DYNAMIC_CHILD,
        template: dynamicTemplate(),
        canonicalDeployment: canonicalDeploymentEvidence(
          providers,
          parentCandidate,
        ),
        activationEvidence: dynamicActivationEvidence(
          providers,
          launchCandidate,
        ),
        providers,
        deadlineMs: 1_000,
      }),
    ).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
    });
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

  it("fails closed on a provider page above the exact 10,000-log cap", async () => {
    const oversizedPage = Array.from(
      { length: 10_001 },
      () => canonicalLog(),
    );
    const first = client([canonicalLog()]);
    const second = client([canonicalLog()]);
    first.getLogsBatch = vi.fn(async ({ requests }) =>
      requests.map(() => oversizedPage),
    );

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
          provider("drpc-mainnet", first),
          provider("quicknode-mainnet", second),
        ],
        rpcPolicy: { maxAttempts: 1 },
      }),
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
        provider("drpc-mainnet", first),
        provider("quicknode-mainnet", second),
      ],
      coveragePolicy: { maximumBlockSpan: 500, maximumRequests: 8 },
      rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
    });
    for (const rpcClient of [first, second]) {
      const getLogsBatch = vi.mocked(rpcClient.getLogsBatch!);
      expect(getLogsBatch).toHaveBeenCalledTimes(61);
      for (const [batch] of getLogsBatch.mock.calls) {
        expect(batch.requests.length).toBeLessThanOrEqual(20);
        for (const request of batch.requests) {
          expect(request.toBlock - request.fromBlock + 1n).toBe(1n);
          expect(request.addresses.length).toBeLessThanOrEqual(512);
          expect(request.topic0.length).toBeGreaterThan(0);
          expect(request.topic0.length).toBeLessThanOrEqual(64);
        }
      }
    }
  });

  it("fails closed when the provider call budget is insufficient", async () => {
    const first = client([canonicalLog()]);
    const second = client([canonicalLog()]);
    first.getLogsBatch = undefined;
    second.getLogsBatch = undefined;
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
          provider("drpc-mainnet", first),
          provider("quicknode-mainnet", second),
        ],
        rpcPolicy: { maxAttempts: 1, maxProviderCalls: 5 },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("does not let getLogs retries amplify past the physical call cap", async () => {
    const first = client([canonicalLog()]);
    const second = client([canonicalLog()]);
    first.getLogsBatch = undefined;
    second.getLogsBatch = undefined;
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
          provider("drpc-mainnet", first),
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
      code: "invalid_input",
    });
    // Preflight accounts for the whole physical shape and rejects before a
    // retryable provider call can amplify beyond the configured budget.
    expect(first.getLogs).not.toHaveBeenCalled();
    expect(second.getLogs).not.toHaveBeenCalled();
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
          provider("drpc-mainnet", hanging),
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
