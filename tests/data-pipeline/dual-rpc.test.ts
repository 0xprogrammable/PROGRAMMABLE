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
          source.contractName === "ClassicV2Launcher"
            ? { ...source, runtimeCodeHash: TEST_SOURCE_CODE_HASH }
            : source,
        ),
      }),
    };
  },
);

import {
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
