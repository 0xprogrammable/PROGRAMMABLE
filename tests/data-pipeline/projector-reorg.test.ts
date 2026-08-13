import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildEnvioCursorRecoveryPlan,
  findCanonicalAncestorWithDualRpc,
  type ReorgHistoryAncestor,
} from "../../lib/data-pipeline/projector-reorg";
import type {
  CandidateRpcBlock,
  CandidateRpcClient,
  CandidateRpcProvider,
} from "../../lib/data-pipeline/dual-rpc";
import { rpcProviderCommitment } from "../../lib/data-pipeline/rpc-provider-commitments";

const HASH_100 = `0x${"10".repeat(32)}` as const;
const HASH_90 = `0x${"09".repeat(32)}` as const;
const HASH_80 = `0x${"08".repeat(32)}` as const;
const ORPHAN = `0x${"ff".repeat(32)}` as const;

function ancestor(
  generation: string,
  blockNumber: string,
  blockHash: `0x${string}`,
): ReorgHistoryAncestor {
  return {
    kind: "history",
    historyGeneration: generation,
    blockNumber,
    blockHash,
    blockGlobalLogIndex: 7,
    candidateId: `1:${blockHash}:0x${"aa".repeat(32)}:7`,
  };
}

function client(
  blocks: Readonly<Record<string, CandidateRpcBlock>>,
): CandidateRpcClient {
  return {
    getChainId: vi.fn(async () => 1),
    getBlockNumber: vi.fn(async () => 120n),
    getBlock: vi.fn(async ({ blockNumber }) =>
      blocks[blockNumber.toString()] ?? {
        number: blockNumber,
        hash: ORPHAN,
        timestamp: 1_785_480_000n + blockNumber,
      },
    ),
    getTransactionReceipt: vi.fn(),
    getBytecode: vi.fn(),
  };
}

function provider(
  identity: "drpc-mainnet" | "quicknode-mainnet",
  rpcClient: CandidateRpcClient,
): CandidateRpcProvider {
  const origin = `https://${identity}.example`;
  return {
    identity,
    vendorGroup: identity.split("-")[0]!,
    endpointCommitment: rpcProviderCommitment("endpoint", origin),
    endpointOriginCommitment: rpcProviderCommitment("origin", origin),
    client: rpcClient,
  };
}

function block(
  number: bigint,
  hash: `0x${string}` | null,
): CandidateRpcBlock {
  return { number, hash, timestamp: 1_785_480_000n + number };
}

function providers(
  first: Readonly<Record<string, CandidateRpcBlock>>,
  second = first,
) {
  return [
    provider("drpc-mainnet", client(first)),
    provider("quicknode-mainnet", client(second)),
  ] as const;
}

describe("projector reorg recovery", () => {
  it("selects the newest history generation both providers prove canonical", async () => {
    const pair = providers({
      "100": block(100n, ORPHAN),
      "90": block(90n, HASH_90),
    });
    await expect(
      findCanonicalAncestorWithDualRpc({
        providers: pair,
        ancestors: [
          ancestor("5", "100", HASH_100),
          ancestor("4", "90", HASH_90),
        ],
        genesis: {
          kind: "genesis",
          historyGeneration: "0",
          genesisPointId: "70000000-0000-0000-0000-000000000008",
          blockNumber: "80",
          blockHash: HASH_80,
          blockGlobalLogIndex: null,
          candidateId: null,
        },
        policy: { maxAttempts: 1 },
      }),
    ).resolves.toMatchObject({
      kind: "history",
      historyGeneration: "4",
      blockNumber: "90",
      blockHash: HASH_90,
      checkedDepth: 2,
      providerBlockHashes: [HASH_90, HASH_90],
    });
    expect(pair[0].client.getBlock).toHaveBeenCalledTimes(4);
    expect(pair[1].client.getBlock).toHaveBeenCalledTimes(4);
  });

  it("rejects an ancestor proof when the agreed safe head changes during the search", async () => {
    const changedSafeHash = `0x${"77".repeat(32)}` as const;
    const driftingClient = () => {
      const value = client({});
      let safeReads = 0;
      value.getBlock = vi.fn(async ({ blockNumber }) => {
        if (blockNumber === 108n) {
          safeReads += 1;
          return block(
            108n,
            safeReads === 1 ? ORPHAN : changedSafeHash,
          );
        }
        if (blockNumber === 90n) return block(90n, HASH_90);
        return block(blockNumber, ORPHAN);
      });
      return value;
    };

    await expect(
      findCanonicalAncestorWithDualRpc({
        providers: [
          provider("drpc-mainnet", driftingClient()),
          provider("quicknode-mainnet", driftingClient()),
        ],
        ancestors: [ancestor("4", "90", HASH_90)],
        policy: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
      safeMetadata: { operation: "reorg-safe-head-changed" },
    });
  });

  it("fails closed immediately when providers disagree", async () => {
    const pair = providers(
      { "100": block(100n, HASH_100) },
      { "100": block(100n, ORPHAN) },
    );
    await expect(
      findCanonicalAncestorWithDualRpc({
        providers: pair,
        ancestors: [ancestor("5", "100", HASH_100)],
        policy: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "validation_failed" });
  });

  it("rejects a null provider block hash instead of treating it as an orphan", async () => {
    const pair = providers({ "100": block(100n, null) });
    await expect(
      findCanonicalAncestorWithDualRpc({
        providers: pair,
        ancestors: [ancestor("5", "100", HASH_100)],
        policy: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "validation_failed" });
  });

  it("uses the registered generation-zero genesis only after history is exhausted", async () => {
    const pair = providers({
      "100": block(100n, ORPHAN),
      "80": block(80n, HASH_80),
    });
    const target = await findCanonicalAncestorWithDualRpc({
      providers: pair,
      ancestors: [ancestor("5", "100", HASH_100)],
      genesis: {
        kind: "genesis",
        historyGeneration: "0",
        genesisPointId: "70000000-0000-0000-0000-000000000008",
        blockNumber: "80",
        blockHash: HASH_80,
        blockGlobalLogIndex: null,
        candidateId: null,
      },
      policy: { maxAttempts: 1 },
    });
    expect(target).toMatchObject({
      kind: "genesis",
      historyGeneration: "0",
      blockNumber: "80",
      blockGlobalLogIndex: null,
      candidateId: null,
      checkedDepth: 2,
    });

    expect(
      buildEnvioCursorRecoveryPlan({
        expectedGeneration: "5",
        currentReorgGeneration: "2",
        target,
      }),
    ).toEqual({
      action: "rewind-and-replay",
      expectedGeneration: "5",
      nextGeneration: "6",
      targetHistoryGeneration: "0",
      targetBlockNumber: "80",
      targetBlockHash: HASH_80,
      targetBlockGlobalLogIndex: null,
      targetCandidateId: null,
      genesisPointId: "70000000-0000-0000-0000-000000000008",
      expectedReorgGeneration: "2",
      nextReorgGeneration: "3",
      providerIdentities: ["drpc-mainnet", "quicknode-mainnet"],
      providerEndpointCommitments: [
        pair[0].endpointCommitment,
        pair[1].endpointCommitment,
      ],
      providerOriginCommitments: [
        pair[0].endpointOriginCommitment,
        pair[1].endpointOriginCommitment,
      ],
      providerBlockHashes: [HASH_80, HASH_80],
      providerBlockTimestamps: ["1785480080", "1785480080"],
      providerChainIds: [1, 1],
      providerHeads: ["120", "120"],
      finalityDepth: "12",
      safeBlockNumber: "108",
      safeBlockHash: ORPHAN,
      providerSafeBlockHashes: [ORPHAN, ORPHAN],
      checkedDepth: 2,
    });
  });

  it("supports a prior generation that already rewound to genesis", async () => {
    const pair = providers({ "80": block(80n, HASH_80) });
    const target = await findCanonicalAncestorWithDualRpc({
      providers: pair,
      ancestors: [
        {
          kind: "history",
          historyGeneration: "4",
          blockNumber: "80",
          blockHash: HASH_80,
          blockGlobalLogIndex: null,
          candidateId: null,
        },
      ],
      policy: { maxAttempts: 1 },
    });
    expect(
      buildEnvioCursorRecoveryPlan({
        expectedGeneration: "5",
        currentReorgGeneration: "2",
        target,
      }),
    ).toMatchObject({
      targetHistoryGeneration: "4",
      targetBlockGlobalLogIndex: null,
      targetCandidateId: null,
      genesisPointId: null,
    });
  });

  it("fails when neither history nor genesis is canonical", async () => {
    await expect(
      findCanonicalAncestorWithDualRpc({
        providers: providers({
          "100": block(100n, ORPHAN),
          "80": block(80n, ORPHAN),
        }),
        ancestors: [ancestor("5", "100", HASH_100)],
        genesis: {
          kind: "genesis",
          historyGeneration: "0",
          genesisPointId: "70000000-0000-0000-0000-000000000008",
          blockNumber: "80",
          blockHash: HASH_80,
          blockGlobalLogIndex: null,
          candidateId: null,
        },
        policy: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "validation_failed" });
  });

  it("never selects an agreed block above the shared 12-block safe head", async () => {
    const pair = providers({
      "109": block(109n, HASH_100),
      "80": block(80n, HASH_80),
    });
    await expect(
      findCanonicalAncestorWithDualRpc({
        providers: pair,
        ancestors: [ancestor("5", "109", HASH_100)],
        genesis: {
          kind: "genesis",
          historyGeneration: "0",
          genesisPointId: "70000000-0000-0000-0000-000000000008",
          blockNumber: "80",
          blockHash: HASH_80,
          blockGlobalLogIndex: null,
          candidateId: null,
        },
        policy: { maxAttempts: 1 },
      }),
    ).resolves.toMatchObject({
      kind: "genesis",
      safeBlockNumber: "108",
      checkedDepth: 2,
    });
    expect(pair[0].client.getBlock).not.toHaveBeenCalledWith({
      blockNumber: 109n,
    });
  });

  it("enforces depth and provider-call budgets before an unbounded scan", async () => {
    const pair = providers({});
    await expect(
      findCanonicalAncestorWithDualRpc({
        providers: pair,
        ancestors: [
          ancestor("5", "100", HASH_100),
          ancestor("4", "90", HASH_90),
        ],
        policy: { maximumDepth: 1, maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "invalid_input" });

    await expect(
      findCanonicalAncestorWithDualRpc({
        providers: pair,
        ancestors: [
          ancestor("5", "100", HASH_100),
          ancestor("4", "90", HASH_90),
        ],
        policy: { maxProviderCalls: 2, maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "validation_failed" });
  });

  it("applies one hard deadline to the complete search", async () => {
    const hanging = client({});
    hanging.getChainId = vi.fn(
      () => new Promise<number>(() => undefined),
    );
    await expect(
      findCanonicalAncestorWithDualRpc({
        providers: [
          provider("drpc-mainnet", hanging),
          provider("quicknode-mainnet", client({})),
        ],
        ancestors: [ancestor("5", "100", HASH_100)],
        policy: { deadlineMs: 20, maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "timeout" });
  });

  it("rejects stale or non-descending data before making network calls", async () => {
    const pair = providers({});
    await expect(
      findCanonicalAncestorWithDualRpc({
        providers: pair,
        ancestors: [
          ancestor("4", "90", HASH_90),
          ancestor("5", "100", HASH_100),
        ],
      }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "invalid_input" });
    expect(pair[0].client.getChainId).not.toHaveBeenCalled();
  });

  it("keeps the recovery plan pure, immutable and CAS-bound", async () => {
    const pair = providers({ "90": block(90n, HASH_90) });
    const target = await findCanonicalAncestorWithDualRpc({
      providers: pair,
      ancestors: [ancestor("4", "90", HASH_90)],
      policy: { maxAttempts: 1 },
    });
    const plan = buildEnvioCursorRecoveryPlan({
      expectedGeneration: "5",
      currentReorgGeneration: "8",
      target,
    });
    expect(plan).toMatchObject({
      expectedGeneration: "5",
      nextGeneration: "6",
      targetHistoryGeneration: "4",
      expectedReorgGeneration: "8",
      nextReorgGeneration: "9",
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(() =>
      buildEnvioCursorRecoveryPlan({
        expectedGeneration: "4",
        currentReorgGeneration: "8",
        target,
      }),
    ).toThrow();
    expect(() =>
      buildEnvioCursorRecoveryPlan({
        expectedGeneration: "5",
        currentReorgGeneration: "8",
        target: {
          ...target,
          providerBlockHashes: [ORPHAN, ORPHAN],
        },
      }),
    ).toThrow();
  });
});
