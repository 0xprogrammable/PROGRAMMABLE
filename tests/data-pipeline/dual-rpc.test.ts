import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256 } from "viem";

vi.mock("server-only", () => ({}));

const { TEST_SOURCE_CODE_HASH } = vi.hoisted(() => ({
  TEST_SOURCE_CODE_HASH:
    "0xcf61a6eb3b9b89e75f1dadf3dcd16509616896cb50eac765a68fa27bbbc6de82" as const,
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
          source.contractName === "ClassicV2Launcher" ||
          source.contractName === "StockV2V3Hook" ||
          source.contractName === "StockV2V3RewardVaultFactory"
            ? { ...source, runtimeCodeHash: TEST_SOURCE_CODE_HASH }
            : source,
        ),
      }),
    };
  },
);

import {
  readDualRpcSafeHead,
  readDualRpcTokenMetadata,
  verifyEnvioCandidateBatchWithDualRpc,
  verifyEnvioCandidateWithDualRpc,
  type CandidateRpcClient,
  type CandidateRpcReceipt,
} from "../../lib/data-pipeline/dual-rpc";
import type { EnvioCandidate } from "../../lib/data-pipeline/envio";
import { rpcProviderCommitment } from "../../lib/data-pipeline/rpc-provider-commitments";

const BLOCK_HASH = `0x${"11".repeat(32)}` as const;
const SAFE_BLOCK_HASH = `0x${"22".repeat(32)}` as const;
const TRANSACTION_HASH = `0x${"33".repeat(32)}` as const;
const SOURCE = "0xd240d06f8586eb799f20056054e5b527405e6bad" as const;
const TOPIC = `0x${"55".repeat(32)}` as const;
const RAW_DATA = "0x1234" as const;
const CANDIDATE_BLOCK = 25_624_131n;
const SAFE_BLOCK = CANDIDATE_BLOCK + 3n;
const PROVIDER_HEAD = SAFE_BLOCK + 12n;
const PAYLOAD_HASH = keccak256(
  encodeAbiParameters(
    [{ type: "bytes32[]" }, { type: "bytes" }],
    [[TOPIC], RAW_DATA],
  ),
);
const DYNAMIC_BLOCK_HASH = `0x${"66".repeat(32)}` as const;
const DYNAMIC_SAFE_BLOCK_HASH = `0x${"77".repeat(32)}` as const;
const DYNAMIC_TRANSACTION_HASH = `0x${"99".repeat(32)}` as const;
const DYNAMIC_SOURCE =
  "0x4cfe000000000000000000000000000000000001" as const;
const DYNAMIC_BLOCK = 25_639_597n;
const DYNAMIC_SAFE_BLOCK = DYNAMIC_BLOCK + 3n;
const DYNAMIC_PROVIDER_HEAD = DYNAMIC_SAFE_BLOCK + 12n;
const DYNAMIC_CODE = "0x6001600055" as const;
const SHARED_BLOCK_HASH = `0x${"aa".repeat(32)}` as const;
const SHARED_SAFE_BLOCK_HASH = `0x${"bb".repeat(32)}` as const;
const SHARED_TRANSACTION_HASH = `0x${"cc".repeat(32)}` as const;
const SHARED_BLOCK = 25_640_338n;

function candidate(): EnvioCandidate {
  return {
    candidateId: `1:${BLOCK_HASH}:${TRANSACTION_HASH}:7`,
    chainId: 1,
    blockNumber: CANDIDATE_BLOCK.toString(),
    blockHash: BLOCK_HASH,
    blockTimestamp: "1785480000",
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 2,
    blockGlobalLogIndex: 7,
    sourceAddress: SOURCE,
    contractName: "ClassicV2Launcher",
    eventName: "MemeTokenLaunched",
    releaseHint: { model: "classic", releaseVersion: "classic-v2" },
    orderedTopics: [TOPIC],
    rawData: RAW_DATA,
    decodedPayload: {},
    payloadHash: PAYLOAD_HASH,
  };
}

function dynamicCandidate(): EnvioCandidate {
  return {
    candidateId: `1:${DYNAMIC_BLOCK_HASH}:${DYNAMIC_TRANSACTION_HASH}:4`,
    chainId: 1,
    blockNumber: DYNAMIC_BLOCK.toString(),
    blockHash: DYNAMIC_BLOCK_HASH,
    blockTimestamp: "1785481000",
    transactionHash: DYNAMIC_TRANSACTION_HASH,
    transactionIndex: 1,
    blockGlobalLogIndex: 4,
    sourceAddress: DYNAMIC_SOURCE,
    contractName: "ClassicV3RewardVault",
    eventName: "Claimed",
    releaseHint: { model: "unresolved", releaseVersion: "unresolved" },
    orderedTopics: [TOPIC],
    rawData: RAW_DATA,
    decodedPayload: {},
    payloadHash: PAYLOAD_HASH,
  };
}

function dynamicReceipt(): CandidateRpcReceipt {
  return {
    status: "success",
    blockNumber: DYNAMIC_BLOCK,
    blockHash: DYNAMIC_BLOCK_HASH,
    transactionHash: DYNAMIC_TRANSACTION_HASH,
    transactionIndex: 1,
    logs: [
      {
        address: DYNAMIC_SOURCE,
        blockNumber: DYNAMIC_BLOCK,
        blockHash: DYNAMIC_BLOCK_HASH,
        transactionHash: DYNAMIC_TRANSACTION_HASH,
        transactionIndex: 1,
        logIndex: 4,
        removed: false,
        topics: [TOPIC],
        data: RAW_DATA,
      },
    ],
  };
}

function dynamicClient(
  bytecode: `0x${string}` = DYNAMIC_CODE,
): CandidateRpcClient {
  return {
    getChainId: async () => 1,
    getBlockNumber: async () => DYNAMIC_PROVIDER_HEAD,
    getBlock: async ({ blockNumber }) =>
      blockNumber === DYNAMIC_SAFE_BLOCK
        ? {
            number: DYNAMIC_SAFE_BLOCK,
            hash: DYNAMIC_SAFE_BLOCK_HASH,
            timestamp: 1785481100n,
          }
        : {
            number: DYNAMIC_BLOCK,
            hash: DYNAMIC_BLOCK_HASH,
            timestamp: 1785481000n,
          },
    getTransactionReceipt: async () => dynamicReceipt(),
    getBytecode: async () => bytecode,
  };
}

function sharedStaticCandidate(input: {
  sourceAddress: `0x${string}`;
  contractName: string;
  eventName: string;
}): EnvioCandidate {
  return {
    candidateId:
      `1:${SHARED_BLOCK_HASH}:${SHARED_TRANSACTION_HASH}:9`,
    chainId: 1,
    blockNumber: SHARED_BLOCK.toString(),
    blockHash: SHARED_BLOCK_HASH,
    blockTimestamp: "1785482000",
    transactionHash: SHARED_TRANSACTION_HASH,
    transactionIndex: 5,
    blockGlobalLogIndex: 9,
    sourceAddress: input.sourceAddress,
    contractName: input.contractName,
    eventName: input.eventName,
    releaseHint: { model: "unresolved", releaseVersion: "unresolved" },
    orderedTopics: [TOPIC],
    rawData: RAW_DATA,
    decodedPayload: {},
    payloadHash: PAYLOAD_HASH,
  };
}

function sharedStaticClient(
  candidate: EnvioCandidate,
): CandidateRpcClient {
  const safeBlock = SHARED_BLOCK + 3n;
  return {
    getChainId: async () => 1,
    getBlockNumber: async () => safeBlock + 12n,
    getBlock: async ({ blockNumber }) =>
      blockNumber === safeBlock
        ? {
            number: safeBlock,
            hash: SHARED_SAFE_BLOCK_HASH,
            timestamp: 1785482100n,
          }
        : {
            number: SHARED_BLOCK,
            hash: SHARED_BLOCK_HASH,
            timestamp: 1785482000n,
          },
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: SHARED_BLOCK,
      blockHash: SHARED_BLOCK_HASH,
      transactionHash: SHARED_TRANSACTION_HASH,
      transactionIndex: 5,
      logs: [
        {
          address: candidate.sourceAddress,
          blockNumber: SHARED_BLOCK,
          blockHash: SHARED_BLOCK_HASH,
          transactionHash: SHARED_TRANSACTION_HASH,
          transactionIndex: 5,
          logIndex: 9,
          removed: false,
          topics: [TOPIC],
          data: RAW_DATA,
        },
      ],
    }),
    getBytecode: async () => "0x60016000",
  };
}

function receipt(): CandidateRpcReceipt {
  return {
    status: "success" as const,
    blockNumber: CANDIDATE_BLOCK,
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 2,
    logs: [
      {
        address: SOURCE,
        blockNumber: CANDIDATE_BLOCK,
        blockHash: BLOCK_HASH,
        transactionHash: TRANSACTION_HASH,
        transactionIndex: 2,
        logIndex: 6,
        removed: false,
        topics: [`0x${"88".repeat(32)}` as const],
        data: "0x" as const,
      },
      {
        address: SOURCE,
        blockNumber: CANDIDATE_BLOCK,
        blockHash: BLOCK_HASH,
        transactionHash: TRANSACTION_HASH,
        transactionIndex: 2,
        logIndex: 7,
        removed: false,
        topics: [TOPIC],
        data: "0x1234" as const,
      },
    ],
  };
}

function client(
  overrides: Partial<CandidateRpcClient> = {},
): CandidateRpcClient {
  return {
    getChainId: async () => 1,
    getBlockNumber: async () => PROVIDER_HEAD,
    getBlock: async ({ blockNumber }) =>
      blockNumber === SAFE_BLOCK
        ? {
            number: SAFE_BLOCK,
            hash: SAFE_BLOCK_HASH,
            timestamp: 1785480003n,
          }
        : {
            number: CANDIDATE_BLOCK,
            hash: BLOCK_HASH,
            timestamp: 1785480000n,
          },
    getTransactionReceipt: async () => receipt(),
    getBytecode: async () => "0x60016000",
    ...overrides,
  };
}

function provider(identity: string, rpcClient: CandidateRpcClient) {
  const endpointOrigin = `https://${identity}.example`;
  return {
    identity,
    vendorGroup: identity.split("-")[0]!,
    endpointCommitment: rpcProviderCommitment("endpoint", endpointOrigin),
    endpointOriginCommitment: rpcProviderCommitment(
      "origin",
      endpointOrigin,
    ),
    client: rpcClient,
  };
}

describe("dual-RPC Envio candidate verification", () => {
  it("batches shared head, block, and receipt reads across candidates", async () => {
    const firstClient = client();
    const secondClient = client();
    for (const rpcClient of [firstClient, secondClient]) {
      rpcClient.getChainId = vi.fn(rpcClient.getChainId);
      rpcClient.getBlockNumber = vi.fn(rpcClient.getBlockNumber);
      rpcClient.getBlock = vi.fn(rpcClient.getBlock);
      rpcClient.getTransactionReceipt = vi.fn(
        rpcClient.getTransactionReceipt,
      );
      rpcClient.getBytecode = vi.fn(rpcClient.getBytecode);
    }
    const earlier: EnvioCandidate = {
      ...candidate(),
      candidateId: `1:${BLOCK_HASH}:${TRANSACTION_HASH}:6`,
      blockGlobalLogIndex: 6,
      orderedTopics: [`0x${"88".repeat(32)}`],
      rawData: "0x",
      payloadHash: keccak256(
        encodeAbiParameters(
          [{ type: "bytes32[]" }, { type: "bytes" }],
          [[`0x${"88".repeat(32)}`], "0x"],
        ),
      ),
    };

    const batch = await verifyEnvioCandidateBatchWithDualRpc({
      candidates: [earlier, candidate()],
      providers: [
        provider("alchemy-mainnet", firstClient),
        provider("quicknode-mainnet", secondClient),
      ],
    });

    expect(batch.candidates.map(({ receiptLogOrdinal }) => receiptLogOrdinal)).toEqual([
      0,
      1,
    ]);
    for (const rpcClient of [firstClient, secondClient]) {
      expect(rpcClient.getChainId).toHaveBeenCalledTimes(1);
      expect(rpcClient.getBlockNumber).toHaveBeenCalledTimes(1);
      expect(rpcClient.getBlock).toHaveBeenCalledTimes(2);
      expect(rpcClient.getTransactionReceipt).toHaveBeenCalledTimes(1);
      expect(rpcClient.getBytecode).toHaveBeenCalledTimes(1);
    }
  });

  it("verifies an explicitly bounded transaction with more than 32 events", async () => {
    const candidates = Array.from({ length: 40 }, (_, index) => ({
      ...candidate(),
      candidateId: `1:${BLOCK_HASH}:${TRANSACTION_HASH}:${index}`,
      blockGlobalLogIndex: index,
    } satisfies EnvioCandidate));
    const oversizedReceipt = (): CandidateRpcReceipt => ({
      status: "success",
      blockNumber: CANDIDATE_BLOCK,
      blockHash: BLOCK_HASH,
      transactionHash: TRANSACTION_HASH,
      transactionIndex: 2,
      logs: candidates.map((entry) => ({
        address: SOURCE,
        blockNumber: CANDIDATE_BLOCK,
        blockHash: BLOCK_HASH,
        transactionHash: TRANSACTION_HASH,
        transactionIndex: 2,
        logIndex: entry.blockGlobalLogIndex,
        removed: false,
        topics: [TOPIC],
        data: RAW_DATA,
      })),
    });

    const batch = await verifyEnvioCandidateBatchWithDualRpc({
      candidates,
      maximumCandidateCount: 4_096,
      providers: [
        provider("alchemy-mainnet", client({
          getTransactionReceipt: async () => oversizedReceipt(),
        })),
        provider("quicknode-mainnet", client({
          getTransactionReceipt: async () => oversizedReceipt(),
        })),
      ],
    });

    expect(batch.candidates).toHaveLength(40);
    expect(batch.executionTrace.candidateBatchSize).toBe(40);
    expect(batch.executionTrace.providerCallCounts).toEqual([6, 6]);
  });

  it("proves a finalized candidate against matching blocks, receipts, logs, and code", async () => {
    const result = await verifyEnvioCandidateWithDualRpc({
      candidate: candidate(),
      providers: [
        provider("alchemy-mainnet", client()),
        provider("quicknode-mainnet", client()),
      ],
    });

    expect(result).toMatchObject({
      chainId: 1,
      providerIdentities: ["alchemy-mainnet", "quicknode-mainnet"],
      providerVendorGroups: ["alchemy", "quicknode"],
      providerHeads: [PROVIDER_HEAD.toString(), PROVIDER_HEAD.toString()],
      safeBlockNumber: SAFE_BLOCK.toString(),
      safeBlockHash: SAFE_BLOCK_HASH,
      candidateBlockNumber: CANDIDATE_BLOCK.toString(),
      candidateBlockHash: BLOCK_HASH,
      candidateBlockTimestamp: "1785480000",
      transactionHash: TRANSACTION_HASH,
      transactionIndex: 2,
      receiptLogOrdinal: 1,
      candidateId: candidate().candidateId,
      sourceAddress: SOURCE,
      contractName: "ClassicV2Launcher",
      eventName: "MemeTokenLaunched",
      sourceKind: "static",
      model: "classic",
      releaseVersion: "classic-v2",
      payloadHash: PAYLOAD_HASH,
    });
    expect(result.receiptCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.rawLogCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.sourceCodeHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.providerEndpointCommitments).toEqual([
      rpcProviderCommitment(
        "endpoint",
        "https://alchemy-mainnet.example",
      ),
      rpcProviderCommitment(
        "endpoint",
        "https://quicknode-mainnet.example",
      ),
    ]);
    expect(result.providerOriginCommitments).toEqual([
      rpcProviderCommitment("origin", "https://alchemy-mainnet.example"),
      rpcProviderCommitment("origin", "https://quicknode-mainnet.example"),
    ]);
    expect(JSON.stringify(result)).not.toContain(".example");
  });

  it("keeps a known dynamic vault release-neutral until factory proof", async () => {
    const result = await verifyEnvioCandidateWithDualRpc({
      candidate: dynamicCandidate(),
      providers: [
        provider("alchemy-mainnet", dynamicClient()),
        provider("quicknode-mainnet", dynamicClient()),
      ],
    });

    expect(result).toMatchObject({
      sourceAddress: DYNAMIC_SOURCE,
      contractName: "ClassicV3RewardVault",
      sourceKind: "dynamic-unresolved",
      model: "unresolved",
      releaseVersion: "unresolved",
      sourceCodeHash: keccak256(DYNAMIC_CODE),
    });
    expect(result).not.toHaveProperty("factoryOccurrenceFingerprint");
  });

  it("keeps shared static hook and factory events release-neutral", async () => {
    const fixtures = [
      sharedStaticCandidate({
        sourceAddress: "0x90c67c1e866f86526f0e338459cd435e1f23a0cc",
        contractName: "StockV2V3Hook",
        eventName: "PoolRegistered",
      }),
      sharedStaticCandidate({
        sourceAddress: "0x52d70971d6653a754c29385a2a6f241a481952d4",
        contractName: "StockV2V3RewardVaultFactory",
        eventName: "QuoteAssetFeeSplitVaultDeployed",
      }),
    ];

    for (const fixture of fixtures) {
      const result = await verifyEnvioCandidateWithDualRpc({
        candidate: fixture,
        providers: [
          provider("alchemy-mainnet", sharedStaticClient(fixture)),
          provider("quicknode-mainnet", sharedStaticClient(fixture)),
        ],
      });
      expect(result).toMatchObject({
        contractName: fixture.contractName,
        sourceKind: "static",
        model: "unresolved",
        releaseVersion: "unresolved",
      });

      for (const forged of [
        {
          ...fixture,
          releaseHint: {
            model: "stock-paired" as const,
            releaseVersion: "stock-paired-v2",
          },
        },
        { ...fixture, blockNumber: "25640337" },
      ]) {
        await expect(
          verifyEnvioCandidateWithDualRpc({
            candidate: forged,
            providers: [
              provider("alchemy-mainnet", sharedStaticClient(forged)),
              provider("quicknode-mainnet", sharedStaticClient(forged)),
            ],
          }),
        ).rejects.toMatchObject({ code: "validation_failed" });
      }
    }
  });

  it("rejects caller-asserted, unknown, premature, or RPC-divergent dynamic vaults", async () => {
    const trustedProviders = () => [
      provider("alchemy-mainnet", dynamicClient()),
      provider("quicknode-mainnet", dynamicClient()),
    ] as const;
    for (const forged of [
      {
        ...dynamicCandidate(),
        releaseHint: {
          model: "classic" as const,
          releaseVersion: "classic-v3",
        },
      },
      {
        ...dynamicCandidate(),
        contractName: "ClassicV3UnknownVault",
      },
      {
        ...dynamicCandidate(),
        blockNumber: "25639595",
      },
    ]) {
      await expect(
        verifyEnvioCandidateWithDualRpc({
          candidate: forged,
          providers: trustedProviders(),
        }),
      ).rejects.toMatchObject({ code: "validation_failed" });
    }

    await expect(
      verifyEnvioCandidateWithDualRpc({
        candidate: dynamicCandidate(),
        providers: [
          provider("alchemy-mainnet", dynamicClient()),
          provider("quicknode-mainnet", dynamicClient("0x6002600055")),
        ],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects duplicate providers, wrong chains, and candidates above the shared safe head", async () => {
    await expect(
      verifyEnvioCandidateWithDualRpc({
        candidate: candidate(),
        providers: [
          provider("same", client()),
          provider("same", client()),
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    const committedEndpoint = provider("alchemy-primary", client());
    await expect(
      verifyEnvioCandidateWithDualRpc({
        candidate: candidate(),
        providers: [
          committedEndpoint,
          {
            ...provider("quicknode-secondary", client()),
            endpointCommitment: committedEndpoint.endpointCommitment,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await expect(
      verifyEnvioCandidateWithDualRpc({
        candidate: candidate(),
        providers: [
          provider("a", client()),
          provider("b", client({ getChainId: async () => 10 })),
        ],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });

    await expect(
      verifyEnvioCandidateWithDualRpc({
        candidate: candidate(),
        providers: [
          provider(
            "a",
            client({ getBlockNumber: async () => CANDIDATE_BLOCK + 11n }),
          ),
          provider(
            "b",
            client({ getBlockNumber: async () => CANDIDATE_BLOCK + 12n }),
          ),
        ],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects the same client, endpoint origin commitment, or vendor group under different labels", async () => {
    const sharedClient = client();
    const first = provider("alchemy-primary", sharedClient);
    const second = provider("quicknode-secondary", sharedClient);
    await expect(
      verifyEnvioCandidateWithDualRpc({
        candidate: candidate(),
        providers: [first, second],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await expect(
      verifyEnvioCandidateWithDualRpc({
        candidate: candidate(),
        providers: [
          first,
          {
            ...provider("quicknode-secondary", client()),
            endpointOriginCommitment: first.endpointOriginCommitment,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await expect(
      verifyEnvioCandidateWithDualRpc({
        candidate: candidate(),
        providers: [
          provider("alchemy-primary", client()),
          {
            ...provider("quicknode-secondary", client()),
            vendorGroup: "alchemy",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects divergent safe or candidate block evidence", async () => {
    await expect(
      verifyEnvioCandidateWithDualRpc({
        candidate: candidate(),
        providers: [
          provider("a", client()),
          {
            ...provider("b", client({
              getBlock: async ({ blockNumber }) =>
                blockNumber === SAFE_BLOCK
                  ? {
                      number: SAFE_BLOCK,
                      hash: `0x${"99".repeat(32)}`,
                      timestamp: 1785480003n,
                    }
                  : {
                      number: CANDIDATE_BLOCK,
                      hash: BLOCK_HASH,
                      timestamp: 1785480000n,
                    },
            })),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });

    await expect(
      verifyEnvioCandidateWithDualRpc({
        candidate: candidate(),
        providers: [
          provider("a", client()),
          {
            ...provider("b", client({
              getBlock: async ({ blockNumber }) =>
                blockNumber === SAFE_BLOCK
                  ? {
                      number: SAFE_BLOCK,
                      hash: SAFE_BLOCK_HASH,
                      timestamp: 1785480003n,
                    }
                  : {
                      number: CANDIDATE_BLOCK,
                      hash: `0x${"99".repeat(32)}`,
                      timestamp: 1785480000n,
                    },
            })),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects receipt, selected log, or bytecode disagreements", async () => {
    const receiptWithDifferentUnselectedLog = receipt();
    const badReceipt: CandidateRpcReceipt = {
      ...receiptWithDifferentUnselectedLog,
      logs: receiptWithDifferentUnselectedLog.logs.map((log, index) =>
        index === 0 ? { ...log, data: "0x12" } : log,
      ),
    };
    const receiptWithDifferentSelectedLog = receipt();
    const badLog: CandidateRpcReceipt = {
      ...receiptWithDifferentSelectedLog,
      logs: receiptWithDifferentSelectedLog.logs.map((log, index) =>
        index === 1 ? { ...log, data: "0x99" } : log,
      ),
    };

    for (const second of [
      client({ getTransactionReceipt: async () => badReceipt }),
      client({ getTransactionReceipt: async () => badLog }),
      client({
        getTransactionReceipt: async () => ({
          ...receipt(),
          blockHash: "0x12",
        }),
      }),
      client({ getBytecode: async () => "0x6002" }),
      client({ getBytecode: async () => "0x1" }),
      client({ getBytecode: async () => undefined }),
    ]) {
      await expect(
        verifyEnvioCandidateWithDualRpc({
          candidate: candidate(),
          providers: [
            provider("a", client()),
            provider("b", second),
          ],
        }),
      ).rejects.toMatchObject({ code: "validation_failed" });
    }
  });

  it("bounds provider fan-out and retries transient RPC failures", async () => {
    const candidates = Array.from({ length: 8 }, (_, index) => {
      const byte = (index + 16).toString(16).padStart(2, "0");
      const transactionHash = `0x${byte.repeat(32)}` as const;
      const blockGlobalLogIndex = 20 + index;
      return {
        ...candidate(),
        candidateId: `1:${BLOCK_HASH}:${transactionHash}:${blockGlobalLogIndex}`,
        transactionHash,
        transactionIndex: index,
        blockGlobalLogIndex,
      } satisfies EnvioCandidate;
    });

    function measuredClient() {
      let inFlight = 0;
      let maximumInFlight = 0;
      let transientBlockFailure = true;
      const rpcClient = client({
        getBlock: async ({ blockNumber }) => {
          if (transientBlockFailure) {
            transientBlockFailure = false;
            throw new Error("429");
          }
          return blockNumber === SAFE_BLOCK
            ? {
                number: SAFE_BLOCK,
                hash: SAFE_BLOCK_HASH,
                timestamp: 1785480003n,
              }
            : {
                number: CANDIDATE_BLOCK,
                hash: BLOCK_HASH,
                timestamp: 1785480000n,
              };
        },
        getTransactionReceipt: async ({ hash }) => {
          const current = candidates.find(
            (entry) => entry.transactionHash === hash,
          )!;
          inFlight += 1;
          maximumInFlight = Math.max(maximumInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 2));
          inFlight -= 1;
          return {
            status: "success",
            blockNumber: CANDIDATE_BLOCK,
            blockHash: BLOCK_HASH,
            transactionHash: current.transactionHash,
            transactionIndex: current.transactionIndex,
            logs: [
              {
                address: SOURCE,
                blockNumber: CANDIDATE_BLOCK,
                blockHash: BLOCK_HASH,
                transactionHash: current.transactionHash,
                transactionIndex: current.transactionIndex,
                logIndex: current.blockGlobalLogIndex,
                removed: false,
                topics: [TOPIC],
                data: RAW_DATA,
              },
            ],
          };
        },
      });
      return {
        rpcClient,
        maximumInFlight: () => maximumInFlight,
      };
    }

    const first = measuredClient();
    const second = measuredClient();
    const sleep = vi.fn(async () => undefined);
    const result = await verifyEnvioCandidateBatchWithDualRpc({
      candidates,
      providers: [
        provider("alchemy-mainnet", first.rpcClient),
        provider("quicknode-mainnet", second.rpcClient),
      ],
      rpcPolicy: {
        maxConcurrency: 2,
        maxAttempts: 2,
        baseBackoffMs: 0,
        sleep,
      },
    });

    expect(result.candidates).toHaveLength(8);
    expect(first.maximumInFlight()).toBeLessThanOrEqual(2);
    expect(second.maximumInFlight()).toBeLessThanOrEqual(2);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("charges every safe-head retry against the physical provider budget", async () => {
    const first = client();
    const second = client();
    first.getChainId = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValue(1);
    second.getChainId = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValue(1);

    await expect(
      readDualRpcSafeHead({
        cursor: {
          blockNumber: CANDIDATE_BLOCK.toString(),
          blockHash: BLOCK_HASH,
        },
        providers: [
          provider("alchemy-mainnet", first),
          provider("quicknode-mainnet", second),
        ],
        rpcPolicy: {
          maxAttempts: 2,
          baseBackoffMs: 0,
          maxCallsPerProvider: 4,
          sleep: async () => undefined,
        },
      }),
    ).rejects.toMatchObject({
      code: "dependency_unavailable",
    });
    expect(first.getChainId).toHaveBeenCalledTimes(2);
    expect(second.getChainId).toHaveBeenCalledTimes(2);
  });

  it("charges both metadata eth_calls on every physical retry", async () => {
    const first = client();
    const second = client();
    first.readErc20Metadata = vi
      .fn<() => Promise<{ name: string; symbol: string }>>()
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValue({ name: "Token", symbol: "TKN" });
    second.readErc20Metadata = vi
      .fn<() => Promise<{ name: string; symbol: string }>>()
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValue({ name: "Token", symbol: "TKN" });

    await expect(
      readDualRpcTokenMetadata({
        tokens: [{ token: SOURCE, blockNumber: CANDIDATE_BLOCK.toString() }],
        providers: [
          provider("alchemy-mainnet", first),
          provider("quicknode-mainnet", second),
        ],
        rpcPolicy: {
          maxAttempts: 2,
          baseBackoffMs: 0,
          maxCallsPerProvider: 2,
          sleep: async () => undefined,
        },
      }),
    ).rejects.toMatchObject({
      code: "dependency_unavailable",
    });
    expect(first.readErc20Metadata).toHaveBeenCalledTimes(1);
    expect(second.readErc20Metadata).toHaveBeenCalledTimes(1);
  });

  it("rejects a forged candidate envelope or an unpinned runtime", async () => {
    for (const forged of [
      {
        ...candidate(),
        sourceAddress: "0x7777777777777777777777777777777777777777" as const,
      },
      {
        ...candidate(),
        payloadHash: `0x${"99".repeat(32)}` as const,
      },
      {
        ...candidate(),
        releaseHint: {
          model: "stock-paired" as const,
          releaseVersion: "classic-v2",
        },
      },
    ]) {
      await expect(
        verifyEnvioCandidateWithDualRpc({
          candidate: forged,
          providers: [
            provider("alchemy-mainnet", client()),
            provider("quicknode-mainnet", client()),
          ],
        }),
      ).rejects.toMatchObject({ code: "validation_failed" });
    }

    await expect(
      verifyEnvioCandidateWithDualRpc({
        candidate: candidate(),
        providers: [
          provider(
            "alchemy-mainnet",
            client({ getBytecode: async () => "0x6002" }),
          ),
          provider(
            "quicknode-mainnet",
            client({ getBytecode: async () => "0x6002" }),
          ),
        ],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
