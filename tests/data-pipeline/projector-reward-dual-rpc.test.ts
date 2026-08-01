import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getContractAddress,
  keccak256,
  parseAbiItem,
  toFunctionSelector,
  type AbiParameter,
  type Hex,
} from "viem";

vi.mock("server-only", () => ({}));

import { verifyClassicV3ActivationModel } from "../../lib/data-pipeline/classic-v3-activation-model";
import {
  readDualRpcInitialRewardConfiguration,
  readDualRpcRewardSnapshot,
  type CandidateRpcClient,
  type DualRpcCandidateWindowEvidence,
  type CandidateRpcProvider,
  type CandidateRpcRewardSnapshot,
} from "../../lib/data-pipeline/dual-rpc";
import type { EnvioCandidate } from "../../lib/data-pipeline/envio";
import type { CanonicalDynamicSourceDeploymentEvidence } from "../../lib/data-pipeline/projector-dynamic-activation";
import type { ProjectorRewardSnapshot } from "../../lib/data-pipeline/projector-reward-fold";
import {
  expectedRewardRpcCallCount,
  PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1,
} from "../../lib/data-pipeline/projector-reward-rpc-contract";
import { immutableReferencesCommitment } from "../../lib/data-pipeline/runtime-bytecode";
import { canonicalPayloadJson } from "../../indexer/src/lib/payload-hash";

const address = (digit: string) =>
  `0x${digit.repeat(40)}` as `0x${string}`;
const bytes32 = (digit: string) =>
  `0x${digit.repeat(64)}` as `0x${string}`;
const alice = address("1");
const bob = address("2");
const poolId = bytes32("3");
const configurationHash = bytes32("4");
const blockHash = bytes32("9");
const rewardVaultFactory = address("f");
const launchToken = address("a");
const launchDeployer = address("b");
const rewardVaultSalt = keccak256(
  encodeAbiParameters(
    [{ type: "string" }, { type: "address" }, { type: "address" }],
    [
      "programmable.classic-reward-vault.v1",
      launchToken,
      launchDeployer,
    ],
  ),
);
const rewardVaultInitCodeHash = bytes32("2");
const vault = getContractAddress({
  bytecodeHash: rewardVaultInitCodeHash,
  from: rewardVaultFactory,
  opcode: "CREATE2",
  salt: rewardVaultSalt,
}).toLowerCase() as `0x${string}`;
const factoryEvent = parseAbiItem(
  "event ClassicRewardVaultDeployed(address indexed vault, bytes32 indexed poolId, address indexed feeHook, bytes32 salt, bytes32 configurationHash)",
);
const classicV3Launcher =
  "0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770" as const;

function classicActiveHash(
  epoch: bigint,
  beneficiaries: readonly `0x${string}`[],
  shares: readonly number[],
  factoryConfigurationHash: `0x${string}`,
) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint64" },
        { type: "address[]" },
        { type: "uint16[]" },
      ],
      [1n, vault, factoryConfigurationHash, epoch, [...beneficiaries], [...shares]],
    ),
  );
}

function seedCandidate(input: {
  eventName: string;
  sourceAddress: `0x${string}`;
  logIndex: number;
  decodedPayload: Record<string, unknown>;
  contractName?: string;
}): EnvioCandidate {
  const transactionHash = `0x${input.logIndex.toString(16).padStart(64, "0")}` as const;
  const candidate: EnvioCandidate = {
    candidateId: `1:${blockHash}:${transactionHash}:${input.logIndex}`,
    chainId: 1,
    blockNumber: "100",
    blockHash,
    blockTimestamp: "1000",
    transactionHash,
    transactionIndex: 0,
    blockGlobalLogIndex: input.logIndex,
    sourceAddress: input.sourceAddress,
    contractName:
      input.contractName ?? "ClassicV3RewardVault",
    eventName: input.eventName,
    releaseHint: { model: "classic", releaseVersion: "classic-v3" },
    orderedTopics: [bytes32("a")],
    rawData: "0x",
    decodedPayload: input.decodedPayload,
    payloadHash: bytes32("b"),
  };
  if (input.eventName !== "ClassicRewardVaultDeployed") return candidate;
  const args = {
    vault: input.decodedPayload.vault,
    poolId: input.decodedPayload.poolId,
    feeHook: input.decodedPayload.feeHook,
    salt: input.decodedPayload.salt ?? rewardVaultSalt,
    configurationHash: input.decodedPayload.configurationHash,
  };
  const topics = encodeEventTopics({
    abi: [factoryEvent],
    eventName: factoryEvent.name,
    args: args as never,
  }) as readonly Hex[];
  const nonIndexed = factoryEvent.inputs.filter(
    (parameter) => !("indexed" in parameter) || parameter.indexed !== true,
  ) as readonly AbiParameter[];
  const data = encodeAbiParameters(
    nonIndexed,
    nonIndexed.map((parameter) => args[parameter.name as keyof typeof args]),
  );
  return {
    ...candidate,
    orderedTopics: [...topics],
    rawData: data,
    decodedPayload: JSON.parse(canonicalPayloadJson(args)),
    payloadHash: keccak256(
      encodeAbiParameters(
        [{ type: "bytes32[]" }, { type: "bytes" }],
        [topics, data],
      ),
    ),
  };
}

const expected: ProjectorRewardSnapshot = Object.freeze({
  vault,
  poolId,
  configurationEpoch: "2",
  activeConfigurationHash: configurationHash,
  totalCreatorFeesReceived: "13",
  allocations: Object.freeze([
    Object.freeze({
      allocationIndex: 0,
      beneficiary: bob,
      payoutAddress: bob,
      shareBps: "4000",
    }),
    Object.freeze({
      allocationIndex: 1,
      beneficiary: bob,
      payoutAddress: bob,
      shareBps: "6000",
    }),
  ]),
  balances: Object.freeze([
    Object.freeze({
      account: alice,
      payoutAddress: alice,
      claimableAccrued: "0",
      claimedTotal: "4",
    }),
    Object.freeze({
      account: bob,
      payoutAddress: bob,
      claimableAccrued: "9",
      claimedTotal: "0",
    }),
  ]),
  snapshotSourceOccurrenceId: "80000000-0000-8000-8000-000000000001",
});

function result(
  overrides: Partial<CandidateRpcRewardSnapshot> = {},
): CandidateRpcRewardSnapshot {
  return {
    model: "classic-v3",
    vault,
    blockNumber: "100",
    blockHash,
    poolId,
    configurationEpoch: "2",
    configurationHash,
    totalCreatorFeesReceived: "13",
    totalCreatorFeesClaimed: "4",
    beneficiaryCount: "2",
    allocations: expected.allocations,
    balances: expected.balances,
    rpcCallCount: 14,
    ...overrides,
  };
}

function expectedWithAccountCount(count: number): ProjectorRewardSnapshot {
  if (!Number.isSafeInteger(count) || count < 2) throw new Error("account-count");
  const balances = [
    ...expected.balances,
    ...Array.from({ length: count - 2 }, (_value, index) => {
      const account = `0x${(index + 16).toString(16).padStart(40, "0")}` as const;
      return Object.freeze({
        account,
        payoutAddress: account,
        claimableAccrued: "0",
        claimedTotal: "0",
      });
    }),
  ].sort((left, right) => left.account.localeCompare(right.account));
  return Object.freeze({ ...expected, balances: Object.freeze(balances) });
}

function resultFor(
  snapshot: ProjectorRewardSnapshot,
  balanceAccounts: readonly `0x${string}`[],
  overrides: Partial<CandidateRpcRewardSnapshot> = {},
): CandidateRpcRewardSnapshot {
  const balancesByAccount = new Map(
    snapshot.balances.map((balance) => [balance.account, balance]),
  );
  return result({
    allocations: snapshot.allocations,
    balances: balanceAccounts.map((account) => {
      const balance = balancesByAccount.get(account);
      if (!balance) throw new Error("missing-test-balance");
      return balance;
    }),
    rpcCallCount: expectedRewardRpcCallCount(
      "classic-v3",
      snapshot.allocations.length,
      balanceAccounts.length,
    ),
    ...overrides,
  });
}

function provider(
  identity: string,
  vendorGroup: string,
  readRewardSnapshot: CandidateRpcClient["readRewardSnapshot"],
  factoryConfigurationHash: `0x${string}` = configurationHash,
  factoryOverrides: Record<string, unknown> = {},
): CandidateRpcProvider {
  return {
    identity,
    vendorGroup,
    endpointCommitment: bytes32(vendorGroup === "alchemy" ? "5" : "6"),
    endpointOriginCommitment: bytes32(vendorGroup === "alchemy" ? "7" : "8"),
    client: {
      readRewardSnapshot,
      readClassicRewardFactorySnapshot: async (
        request: Parameters<
          NonNullable<
            CandidateRpcClient["readClassicRewardFactorySnapshot"]
          >
        >[0],
      ) => ({
        factory: request.factory,
        vault: request.vault,
        blockNumber: request.blockNumber.toString(),
        blockHash: request.blockHash,
        configurationHash: factoryConfigurationHash,
        initCodeHash: rewardVaultInitCodeHash,
        predictedVault: vault,
        rpcCallCount: 3,
        ...factoryOverrides,
      }),
      getBytecode: async () => vault,
    } as unknown as CandidateRpcClient,
  };
}

function dynamicTemplate(
  parentFactoryAddress: `0x${string}`,
) {
  const hash = bytes32("6");
  const references = [{ start: 0, length: 20 }] as const;
  return {
    templateId: "30000000-0000-4000-8000-000000000001",
    contractName: "ClassicV3RewardVault" as const,
    model: "classic" as const,
    releaseVersion: "classic-v3" as const,
    parentFactoryAddress,
    parentFactoryContractName: "ClassicV3RewardVaultFactory" as const,
    parentFactoryBindingId: "30000000-0000-4000-8000-000000000002",
    parentFactoryBindingCommitment: hash,
    parentSourceRole: "vault_factory",
    factoryEventName: "ClassicRewardVaultDeployed" as const,
    deployedAddressField: "vault" as const,
    deployedSourceRole: "reward_vault" as const,
    deployedArtifactCreationCodeCommitment: hash,
    expectedExactRuntimeCodeHash: null,
    expectedNormalizedRuntimeCodeHash: keccak256(`0x${"00".repeat(20)}`),
    expectedImmutableReferencesCommitment:
      immutableReferencesCommitment(references, 20),
    expectedRuntimeByteLength: "20",
    immutableReferences: references,
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
      epochId: "30000000-0000-4000-8000-000000000003",
      pointerGeneration: "1",
      reorgGeneration: "0",
      envioProviderDeploymentId:
        "30000000-0000-4000-8000-000000000004",
      rpcProviderDeploymentIds: [
        "30000000-0000-4000-8000-000000000005",
        "30000000-0000-4000-8000-000000000006",
      ] as const,
    },
  };
}

function canonicalDeploymentEvidence(
  parent: EnvioCandidate,
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider],
  overrides: Partial<CanonicalDynamicSourceDeploymentEvidence> = {},
): CanonicalDynamicSourceDeploymentEvidence {
  const template = dynamicTemplate(parent.sourceAddress);
  return {
    provisionalPageId: "40000000-0000-4000-8000-000000000001",
    provisionalLineageId: "40000000-0000-4000-8000-000000000002",
    dynamicSourceAttestationId:
      "40000000-0000-4000-8000-000000000003",
    runtimeCodeEvidenceId: "40000000-0000-4000-8000-000000000004",
    dynamicSourceTemplateId: template.templateId,
    parentOccurrenceId: "40000000-0000-4000-8000-000000000005",
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
      "40000000-0000-4000-8000-000000000006",
    safeHeadObservationId: "40000000-0000-4000-8000-000000000007",
    blockEvidenceId: "40000000-0000-4000-8000-000000000008",
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

function candidateBatchEvidence(
  candidates: readonly EnvioCandidate[],
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider],
): DualRpcCandidateWindowEvidence {
  const providerIdentities = providers.map(({ identity }) => identity) as [string, string];
  const providerVendorGroups = providers.map(({ vendorGroup }) => vendorGroup) as [string, string];
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
    providerHeads: ["200", "200"],
    safeBlockNumber: "188",
    safeBlockHash: bytes32("e"),
    candidates: candidates.map((candidate) => ({
      chainId: 1,
      candidateId: candidate.candidateId,
      sourceAddress: candidate.sourceAddress,
      contractName: candidate.contractName,
      eventName: candidate.eventName,
      sourceKind: candidate.contractName === "ClassicV3RewardVault"
        ? "dynamic-attested"
        : "static",
      model: "classic",
      releaseVersion: "classic-v3",
      payloadHash: candidate.payloadHash,
      rawLogCommitment: bytes32("d"),
      providerIdentities,
      providerVendorGroups,
      providerEndpointCommitments,
      providerOriginCommitments,
      providerHeads: ["200", "200"],
      safeBlockNumber: "188",
      safeBlockHash: bytes32("e"),
      candidateBlockNumber: candidate.blockNumber,
      candidateBlockHash: candidate.blockHash,
      candidateBlockTimestamp: candidate.blockTimestamp,
      transactionHash: candidate.transactionHash,
      transactionIndex: candidate.transactionIndex,
      receiptCommitment: bytes32("c"),
      sourceCodeHash: bytes32("b"),
      receiptLogOrdinal: candidate.blockGlobalLogIndex,
    })),
    executionTrace: {
      startedAtMs: 1,
      completedAtMs: 2,
      candidateBatchSize: candidates.length,
      hardDeadlineMs: 100,
      maxCallsPerProvider: 128,
      elapsedMs: 1,
      providerCallCounts: [1, 1],
      calls: [],
    },
    coveredCandidateCount: candidates.length,
    coverage: {
      fromBlockNumber: "99",
      throughBlockNumber: "100",
      throughBlockHash: blockHash,
      throughBlockGlobalLogIndex: "4294967295",
      filterCommitment: bytes32("a"),
      providerLogCommitments: [bytes32("b"), bytes32("b")],
    },
  };
}

describe("dual-RPC exact-block reward snapshots", () => {
  it("freezes every selector and keeps the worst case under the provider cap", () => {
    const signatures = Object.values(
      PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1.models,
    ).flatMap((model) => [
      ...model.fixed,
      ...model.perAllocation,
      ...model.perBalanceAccount,
    ]);
    expect(
      signatures.map(({ signature, selector, blockTag }) => ({
        signature,
        selector,
        blockTag,
      })),
    ).toEqual(
      signatures.map(({ signature }) => ({
        signature,
        selector: toFunctionSelector(signature),
        blockTag: "eip-1898-canonical-block-hash",
      })),
    );
    expect([...new Set(signatures.map(({ signature }) => signature))].sort())
      .toEqual([
        "activeConfigurationHash()",
        "beneficiaryAt(uint256)",
        "beneficiaryCount()",
        "claimable(address)",
        "claimedBy(address)",
        "configurationEpoch()",
        "configurationHash()",
        "payoutAddressOf(address)",
        "poolId()",
        "shareBpsAt(uint256)",
        "shareBpsOf(address)",
        "totalCreatorFeesClaimed()",
        "totalCreatorFeesReceived()",
      ]);
    expect(expectedRewardRpcCallCount("classic-v3", 5, 48)).toBe(112);
    expect(expectedRewardRpcCallCount("stock-paired", 8, 8)).toBe(45);
  });

  it("accepts duplicate Classic allocation wallets and verifies historical balances", async () => {
    const left = vi.fn(async () => result());
    const right = vi.fn(async () => result());

    const snapshot = await readDualRpcRewardSnapshot({
      model: "classic-v3",
      expected,
      blockNumber: "100",
      blockHash,
      providers: [
        provider("alchemy-reward", "alchemy", left),
        provider("quicknode-reward", "quicknode", right),
      ],
      rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
    });

    expect(snapshot.allocations.map(({ beneficiary }) => beneficiary)).toEqual([
      bob,
      bob,
    ]);
    expect(snapshot.balances.map(({ account }) => account)).toEqual([
      alice,
      bob,
    ]);
    expect(left).toHaveBeenCalledWith({
      model: "classic-v3",
      vault,
      blockNumber: 100n,
      blockHash,
      balanceAccounts: [alice, bob],
    });
    expect(right).toHaveBeenCalledOnce();
  });

  it("fails closed on provider disagreement or an uncommitted hidden call", async () => {
    const baseProviders = (right: CandidateRpcRewardSnapshot) => [
      provider("alchemy-reward", "alchemy", async () => result()),
      provider("quicknode-reward", "quicknode", async () => right),
    ] as const;

    await expect(
      readDualRpcRewardSnapshot({
        model: "classic-v3",
        expected,
        blockNumber: "100",
        blockHash,
        providers: baseProviders(result({ totalCreatorFeesClaimed: "5" })),
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      }),
    ).rejects.toThrow();

    await expect(
      readDualRpcRewardSnapshot({
        model: "classic-v3",
        expected,
        blockNumber: "100",
        blockHash,
        providers: baseProviders(result({ rpcCallCount: 15 })),
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      }),
    ).rejects.toThrow();
  });

  it("binds every call to the canonical block hash and rejects a replacement block", async () => {
    const replacementHash = bytes32("a");
    const left = vi.fn(async (request) => {
      expect(request.blockHash).toBe(blockHash);
      return result();
    });
    const right = vi.fn(async () => result({ blockHash: replacementHash }));

    await expect(
      readDualRpcRewardSnapshot({
        model: "classic-v3",
        expected,
        blockNumber: "100",
        blockHash,
        providers: [
          provider("alchemy-reward", "alchemy", left),
          provider("quicknode-reward", "quicknode", right),
        ],
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      }),
    ).rejects.toThrow();
    expect(left).toHaveBeenCalledOnce();
    expect(right).toHaveBeenCalledOnce();
  });

  it("verifies a vault with more than 48 historical accounts without rereading unchanged history", async () => {
    const historical = Array.from({ length: 58 }, (_value, index) => {
      const account = `0x${(index + 16).toString(16).padStart(40, "0")}` as const;
      return Object.freeze({
        account,
        payoutAddress: account,
        claimableAccrued: "0",
        claimedTotal: "0",
      });
    });
    const fullBalances = Object.freeze([
      ...expected.balances,
      ...historical,
    ].sort((left, right) => left.account.localeCompare(right.account)));
    const fullExpected = Object.freeze({ ...expected, balances: fullBalances });
    const baseline = Object.freeze({
      vault,
      poolId,
      configurationEpoch: "2",
      activeConfigurationHash: configurationHash,
      allocations: expected.allocations,
      balances: fullBalances,
    });
    const read = vi.fn(async ({ balanceAccounts }) => {
      expect(balanceAccounts).toEqual([bob]);
      return result({
        balances: expected.balances.filter(({ account }) => account === bob),
        rpcCallCount: 12,
      });
    });

    const snapshot = await readDualRpcRewardSnapshot({
      model: "classic-v3",
      baseline,
      expected: fullExpected,
      blockNumber: "100",
      blockHash,
      providers: [
        provider("alchemy-reward", "alchemy", read),
        provider("quicknode-reward", "quicknode", read),
      ],
      rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
    });

    expect(snapshot.balances).toHaveLength(60);
    expect(snapshot.verificationAccounts).toEqual([bob]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each([48, 49, 127, 128, 129])(
    "verifies %i freshly changed accounts as one ordered exact-block chunk set",
    async (accountCount) => {
      const fullExpected = expectedWithAccountCount(accountCount);
      const read = vi.fn(async ({ balanceAccounts, blockHash: requestedHash }) => {
        expect(requestedHash).toBe(blockHash);
        return resultFor(fullExpected, balanceAccounts);
      });

      const snapshot = await readDualRpcRewardSnapshot({
        model: "classic-v3",
        expected: fullExpected,
        blockNumber: "100",
        blockHash,
        providers: [
          provider("alchemy-reward", "alchemy", read),
          provider("quicknode-reward", "quicknode", read),
        ],
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      });

      const expectedChunkSizes = Array.from(
        { length: Math.ceil(accountCount / 48) },
        (_value, index) => Math.min(48, accountCount - index * 48),
      );
      expect(snapshot.verificationAccounts).toEqual(
        fullExpected.balances.map(({ account }) => account),
      );
      expect(snapshot.chunks.map((chunk) => chunk.chunkIndex)).toEqual(
        expectedChunkSizes.map((_size, index) => index),
      );
      expect(snapshot.chunks.map((chunk) => chunk.verificationAccounts.length))
        .toEqual(expectedChunkSizes);
      expect(snapshot.chunks.flatMap((chunk) => chunk.verificationAccounts))
        .toEqual(snapshot.verificationAccounts);
      expect(read).toHaveBeenCalledTimes(expectedChunkSizes.length * 2);
    },
  );

  it("fails closed when a later chunk disagrees across providers", async () => {
    const fullExpected = expectedWithAccountCount(49);
    const left = vi.fn(async ({ balanceAccounts }) =>
      resultFor(fullExpected, balanceAccounts));
    let rightChunk = 0;
    const right = vi.fn(async ({ balanceAccounts }) => {
      const currentChunk = rightChunk;
      rightChunk += 1;
      return resultFor(
        fullExpected,
        balanceAccounts,
        currentChunk === 1 ? { totalCreatorFeesClaimed: "5" } : {},
      );
    });

    await expect(readDualRpcRewardSnapshot({
      model: "classic-v3",
      expected: fullExpected,
      blockNumber: "100",
      blockHash,
      providers: [
        provider("alchemy-reward", "alchemy", left),
        provider("quicknode-reward", "quicknode", right),
      ],
      rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
    })).rejects.toThrow();
    expect(left).toHaveBeenCalledTimes(2);
    expect(right).toHaveBeenCalledTimes(2);
  });

  it.each(["missing", "duplicate", "reordered"] as const)(
    "fails closed on a %s account response inside a chunk",
    async (mutation) => {
      const fullExpected = expectedWithAccountCount(50);
      let chunkIndex = 0;
      const malformed = vi.fn(async ({ balanceAccounts }) => {
        const canonical = resultFor(fullExpected, balanceAccounts);
        const currentChunk = chunkIndex;
        chunkIndex += 1;
        if (currentChunk !== 1) return canonical;
        const balances = [...(canonical.balances as readonly Record<string, unknown>[])];
        if (mutation === "missing") balances.pop();
        if (mutation === "duplicate") balances[0] = balances[1]!;
        if (mutation === "reordered") balances.reverse();
        return { ...canonical, balances };
      });
      const sound = vi.fn(async ({ balanceAccounts }) =>
        resultFor(fullExpected, balanceAccounts));

      await expect(readDualRpcRewardSnapshot({
        model: "classic-v3",
        expected: fullExpected,
        blockNumber: "100",
        blockHash,
        providers: [
          provider("alchemy-reward", "alchemy", malformed),
          provider("quicknode-reward", "quicknode", sound),
        ],
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      })).rejects.toThrow();
    },
  );

  it("reconstructs the immutable seed across a same-block payout change", async () => {
    const carol = address("3");
    const factoryConfigurationHash = bytes32("c");
    const initialActiveHash = classicActiveHash(
      1n,
      [alice, bob],
      [4000, 6000],
      factoryConfigurationHash,
    );
    const currentActiveHash = classicActiveHash(
      2n,
      [carol, bob],
      [4000, 6000],
      factoryConfigurationHash,
    );
    const parent = seedCandidate({
      eventName: "ClassicRewardVaultDeployed",
      sourceAddress: address("f"),
      contractName: "ClassicV3RewardVaultFactory",
      logIndex: 4,
      decodedPayload: {
        vault,
        poolId,
        feeHook: address("e"),
        configurationHash: factoryConfigurationHash,
      },
    });
    const launch = seedCandidate({
      eventName: "MemeTokenLaunchedV2",
      sourceAddress: classicV3Launcher,
      contractName: "ClassicV3Launcher",
      logIndex: 5,
      decodedPayload: {
        deployer: launchDeployer,
        token: launchToken,
        rewardVault: vault,
        poolId,
        feeHook: address("e"),
        rewardConfigurationHash: factoryConfigurationHash,
      },
    });
    const payout = seedCandidate({
      eventName: "PayoutWalletChanged",
      sourceAddress: vault,
      logIndex: 6,
      decodedPayload: {
        poolId,
        allocationIndex: "0",
        previousPayoutWallet: alice,
        newPayoutWallet: carol,
        shareBps: "4000",
        configurationEpoch: "2",
        activeConfigurationHash: currentActiveHash,
        effectiveTotalCreatorFeesReceived: "0",
      },
    });
    const raw = result({
      configurationEpoch: "2",
      configurationHash: currentActiveHash,
      totalCreatorFeesReceived: "0",
      totalCreatorFeesClaimed: "0",
      allocations: [
        { allocationIndex: 0, beneficiary: carol, payoutAddress: carol, shareBps: "4000" },
        { allocationIndex: 1, beneficiary: bob, payoutAddress: bob, shareBps: "6000" },
      ],
      balances: [
        { account: vault, payoutAddress: vault, claimableAccrued: "0", claimedTotal: "0" },
      ],
      rpcCallCount: expectedRewardRpcCallCount("classic-v3", 2, 1),
    });
    const left = vi.fn(async () => raw);
    const right = vi.fn(async () => raw);
    const providers = [
      provider("alchemy-seed", "alchemy", left, factoryConfigurationHash),
      provider(
        "quicknode-seed",
        "quicknode",
        right,
        factoryConfigurationHash,
      ),
    ] as const;

    const verified = await readDualRpcInitialRewardConfiguration({
      parentCandidate: parent,
      launchCandidate: launch,
      sameBlockVaultEvents: [payout],
      candidateEvidence: candidateBatchEvidence([launch, payout], providers),
      canonicalDeployment: canonicalDeploymentEvidence(parent, providers),
      template: dynamicTemplate(parent.sourceAddress),
      providers,
      rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 32 },
    });
    expect(verified).toMatchObject({
      vault,
      poolId,
      deploymentBlockNumber: "100",
      deploymentBlockHash: blockHash,
      activationBlockNumber: "100",
      activationBlockHash: blockHash,
      activationBlockGlobalLogIndex: 5,
      coveredRewardCandidateIds: [payout.candidateId],
      factory: rewardVaultFactory,
      salt: rewardVaultSalt,
      factoryConfigurationHash,
      providerFactoryConfigurationHashes: [
        factoryConfigurationHash,
        factoryConfigurationHash,
      ],
      providerInitCodeHashes: [
        rewardVaultInitCodeHash,
        rewardVaultInitCodeHash,
      ],
      providerPredictedVaults: [vault, vault],
      locallyPredictedVault: vault,
      factoryProviderCallCounts: [3, 3],
      initialActiveConfigurationHash: initialActiveHash,
      allocations: [
        { allocationIndex: 0, beneficiary: alice, shareBps: "4000" },
        { allocationIndex: 1, beneficiary: bob, shareBps: "6000" },
      ],
      endConfigurationSnapshot: {
        configurationEpoch: "2",
        configurationHash: currentActiveHash,
        providerCallCounts: [12, 12],
      },
    });
    expect(left).toHaveBeenCalledWith(
      expect.objectContaining({ blockHash, blockNumber: 100n, vault }),
    );
    expect(right).toHaveBeenCalledWith(
      expect.objectContaining({ blockHash, blockNumber: 100n, vault }),
    );

    const disagreeingProviders = [
      provider("alchemy-seed", "alchemy", left, factoryConfigurationHash),
      provider(
        "quicknode-seed",
        "quicknode",
        right,
        factoryConfigurationHash,
        { initCodeHash: bytes32("6") },
      ),
    ] as const;
    await expect(readDualRpcInitialRewardConfiguration({
      parentCandidate: parent,
      launchCandidate: launch,
      sameBlockVaultEvents: [payout],
      candidateEvidence: candidateBatchEvidence(
        [launch, payout],
        disagreeingProviders,
      ),
      canonicalDeployment: canonicalDeploymentEvidence(
        parent,
        disagreeingProviders,
      ),
      template: dynamicTemplate(parent.sourceAddress),
      providers: disagreeingProviders,
      rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 32 },
    })).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
    });
  });

  it("separately proves checkpoint, claim and payout state after activation", async () => {
    const carol = address("3");
    const factoryConfigurationHash = bytes32("c");
    const initialActiveHash = classicActiveHash(
      1n,
      [alice, bob],
      [4000, 6000],
      factoryConfigurationHash,
    );
    const currentActiveHash = classicActiveHash(
      2n,
      [carol, bob],
      [4000, 6000],
      factoryConfigurationHash,
    );
    const parent = seedCandidate({
      eventName: "ClassicRewardVaultDeployed",
      sourceAddress: address("f"),
      contractName: "ClassicV3RewardVaultFactory",
      logIndex: 4,
      decodedPayload: {
        vault,
        poolId,
        feeHook: address("e"),
        configurationHash: factoryConfigurationHash,
      },
    });
    const launch = seedCandidate({
      eventName: "MemeTokenLaunchedV2",
      sourceAddress: classicV3Launcher,
      contractName: "ClassicV3Launcher",
      logIndex: 5,
      decodedPayload: {
        deployer: launchDeployer,
        token: launchToken,
        rewardVault: vault,
        poolId,
        feeHook: address("e"),
        rewardConfigurationHash: factoryConfigurationHash,
      },
    });
    const checkpoint = seedCandidate({
      eventName: "CreatorFeesCheckpointed",
      sourceAddress: vault,
      logIndex: 6,
      decodedPayload: {
        poolId,
        configurationEpoch: "1",
        amount: "10",
        totalCreatorFeesReceived: "10",
      },
    });
    const claim = seedCandidate({
      eventName: "BeneficiaryFeesClaimed",
      sourceAddress: vault,
      logIndex: 7,
      decodedPayload: {
        beneficiary: alice,
        amount: "4",
        beneficiaryTotalClaimed: "4",
        vaultTotalReceived: "10",
      },
    });
    const payout = seedCandidate({
      eventName: "PayoutWalletChanged",
      sourceAddress: vault,
      logIndex: 8,
      decodedPayload: {
        poolId,
        allocationIndex: "0",
        previousPayoutWallet: alice,
        newPayoutWallet: carol,
        shareBps: "4000",
        configurationEpoch: "2",
        activeConfigurationHash: currentActiveHash,
        effectiveTotalCreatorFeesReceived: "10",
      },
    });
    const allocations = [
      {
        allocationIndex: 0,
        beneficiary: carol,
        payoutAddress: carol,
        shareBps: "4000",
      },
      {
        allocationIndex: 1,
        beneficiary: bob,
        payoutAddress: bob,
        shareBps: "6000",
      },
    ];
    const balances = [
      {
        account: alice,
        payoutAddress: alice,
        claimableAccrued: "0",
        claimedTotal: "4",
      },
      {
        account: bob,
        payoutAddress: bob,
        claimableAccrued: "6",
        claimedTotal: "0",
      },
      {
        account: carol,
        payoutAddress: carol,
        claimableAccrued: "0",
        claimedTotal: "0",
      },
    ];
    const read = vi.fn(async ({
      balanceAccounts,
    }: {
      balanceAccounts: readonly `0x${string}`[];
    }) => ({
      model: "classic-v3",
      vault,
      blockNumber: "100",
      blockHash,
      poolId,
      configurationEpoch: "2",
      configurationHash: currentActiveHash,
      totalCreatorFeesReceived: "10",
      totalCreatorFeesClaimed: "4",
      beneficiaryCount: "2",
      allocations,
      balances: balanceAccounts.map((account) =>
        account === vault
          ? {
              account: vault,
              payoutAddress: vault,
              claimableAccrued: "0",
              claimedTotal: "0",
            }
          : balances.find((balance) => balance.account === account)!),
      rpcCallCount: expectedRewardRpcCallCount(
        "classic-v3",
        2,
        balanceAccounts.length,
      ),
    }));
    const providers = [
      provider("alchemy-seed", "alchemy", read, factoryConfigurationHash),
      provider(
        "quicknode-seed",
        "quicknode",
        read,
        factoryConfigurationHash,
      ),
    ] as const;
    const candidateEvidence = candidateBatchEvidence(
      [launch, checkpoint, claim, payout],
      providers,
    );

    const verified = await verifyClassicV3ActivationModel({
      activationId: "70000000-0000-4000-8000-000000000001",
      parentCandidate: parent,
      launchCandidate: launch,
      sameBlockVaultEvents: [checkpoint, claim, payout],
      candidateEvidence,
      sourceAddress: vault,
      template: dynamicTemplate(parent.sourceAddress),
      canonicalDeployment: canonicalDeploymentEvidence(parent, providers),
      providers,
      deadlineMs: 1_000,
    });

    expect(
      verified.initialConfiguration.initialActiveConfigurationHash,
    ).toBe(
      initialActiveHash,
    );
    expect(verified.projectedSnapshot).toMatchObject({
      configurationEpoch: "2",
      activeConfigurationHash: currentActiveHash,
      totalCreatorFeesReceived: "10",
      allocations,
      balances,
    });
    expect(verified.rewardEvidence.verificationAccounts).toEqual([
      alice,
      bob,
      carol,
    ]);
    expect(
      verified.modelVerificationEvidence.map(({ evidenceKind }) =>
        evidenceKind),
    ).toEqual([
      "classic-v3-runtime-activation-v1",
      "classic-v3-initial-reward-configuration-v1",
      "classic-v3-launch-reward-conservation-v1",
    ]);
    const replayed = await verifyClassicV3ActivationModel({
      activationId: "70000000-0000-4000-8000-000000000001",
      parentCandidate: parent,
      launchCandidate: launch,
      sameBlockVaultEvents: [checkpoint, claim, payout],
      candidateEvidence,
      sourceAddress: vault,
      template: dynamicTemplate(parent.sourceAddress),
      canonicalDeployment: canonicalDeploymentEvidence(parent, providers),
      providers,
      deadlineMs: 1_000,
    });
    expect(
      replayed.modelVerificationEvidence.map(
        ({ evidenceCommitment }) => evidenceCommitment,
      ),
    ).toEqual(
      verified.modelVerificationEvidence.map(
        ({ evidenceCommitment }) => evidenceCommitment,
      ),
    );
    expect(read).toHaveBeenCalledTimes(8);
  });

  it("fails closed when epoch one cannot be reconstructed", async () => {
    const carol = address("3");
    const factoryConfigurationHash = bytes32("c");
    const currentActiveHash = classicActiveHash(
      2n,
      [carol, bob],
      [4000, 6000],
      factoryConfigurationHash,
    );
    const parent = seedCandidate({
      eventName: "ClassicRewardVaultDeployed",
      sourceAddress: address("f"),
      contractName: "ClassicV3RewardVaultFactory",
      logIndex: 4,
      decodedPayload: {
        vault,
        poolId,
        feeHook: address("e"),
        configurationHash: factoryConfigurationHash,
      },
    });
    const launch = seedCandidate({
      eventName: "MemeTokenLaunchedV2",
      sourceAddress: classicV3Launcher,
      contractName: "ClassicV3Launcher",
      logIndex: 5,
      decodedPayload: {
        deployer: launchDeployer,
        token: launchToken,
        rewardVault: vault,
        poolId,
        feeHook: address("e"),
        rewardConfigurationHash: factoryConfigurationHash,
      },
    });
    const raw = result({
      configurationEpoch: "2",
      configurationHash: currentActiveHash,
      totalCreatorFeesReceived: "0",
      totalCreatorFeesClaimed: "0",
      allocations: [
        { allocationIndex: 0, beneficiary: carol, payoutAddress: carol, shareBps: "4000" },
        { allocationIndex: 1, beneficiary: bob, payoutAddress: bob, shareBps: "6000" },
      ],
      balances: [
        { account: vault, payoutAddress: vault, claimableAccrued: "0", claimedTotal: "0" },
      ],
      rpcCallCount: expectedRewardRpcCallCount("classic-v3", 2, 1),
    });

    const providers = [
      provider("alchemy-seed", "alchemy", async () => raw),
      provider("quicknode-seed", "quicknode", async () => raw),
    ] as const;
    await expect(readDualRpcInitialRewardConfiguration({
      parentCandidate: parent,
      launchCandidate: launch,
      sameBlockVaultEvents: [],
      candidateEvidence: candidateBatchEvidence([launch], providers),
      canonicalDeployment: canonicalDeploymentEvidence(parent, providers),
      template: dynamicTemplate(parent.sourceAddress),
      providers,
      rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 32 },
    })).rejects.toThrow();
  });
});
