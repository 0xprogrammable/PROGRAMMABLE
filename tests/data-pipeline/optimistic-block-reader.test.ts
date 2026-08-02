import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  CandidateRpcBlock,
  CandidateRpcLog,
  CandidateRpcProvider,
} from "../../lib/data-pipeline/dual-rpc";
import { manifestEventSelectors } from "../../lib/data-pipeline/event-manifest";
import {
  parseQuickNodeBlockHint,
  readOptimisticBlockWithDualRpc,
} from "../../lib/data-pipeline/optimistic-block-reader.server";
import { getDataPipelineReleaseBinding } from "../../lib/data-pipeline/release-binding.server";

const BLOCK_NUMBER = 25_650_000n;
const BLOCK_HASH = `0x${"11".repeat(32)}` as const;
const PARENT_HASH = `0x${"22".repeat(32)}` as const;
const TRANSACTION_HASH = `0x${"33".repeat(32)}` as const;
const PAYLOAD_ONLY_HASH = `0x${"ff".repeat(32)}` as const;
const BINDING = getDataPipelineReleaseBinding();
const SOURCE = BINDING.sources.find(
  ({ contractName }) => contractName === "ClassicV2Launcher",
)!;
const TOPIC0 = manifestEventSelectors(SOURCE.contractName)[0]!;

type QuickNodeTestPayload = {
  data: Array<{
    number: string;
    hash: string;
    parentHash: string;
    timestamp: string;
    transactions: unknown[];
  }>;
  metadata: {
    stream_id: string;
    stream_name: string;
    stream_region: string;
    network: string;
    dataset: string;
    start_range: number;
    end_range: number;
    keep_distance_from_tip: number;
    batch_start_range: number;
    batch_end_range: number;
    data_size_bytes: number;
    reorgs: null | Array<{
      block_number: number;
      block_hash: string;
      block_timestamp: string;
    }>;
    blocks_reorged: null | number[];
  };
};

function quickNodePayload(): QuickNodeTestPayload {
  return {
    data: [
      {
        number: `0x${BLOCK_NUMBER.toString(16)}`,
        hash: PAYLOAD_ONLY_HASH,
        parentHash: `0x${"ee".repeat(32)}`,
        timestamp: "0x66ae0000",
        transactions: [],
      },
    ],
    metadata: {
      stream_id: "f6ad6459-b5ad-4183-b370-1c1388e47e83",
      stream_name: "programmable-mainnet-head",
      stream_region: "usa_east",
      network: "ethereum-mainnet",
      dataset: "block",
      start_range: Number(BLOCK_NUMBER),
      end_range: Number(BLOCK_NUMBER),
      keep_distance_from_tip: 0,
      batch_start_range: Number(BLOCK_NUMBER),
      batch_end_range: Number(BLOCK_NUMBER),
      data_size_bytes: 1_024,
      reorgs: null,
      blocks_reorged: null,
    },
  };
}

function candidateBlock(
  overrides: Partial<CandidateRpcBlock> = {},
): CandidateRpcBlock {
  return {
    number: BLOCK_NUMBER,
    hash: BLOCK_HASH,
    parentHash: PARENT_HASH,
    timestamp: 1_722_687_488n,
    ...overrides,
  };
}

function candidateLog(
  overrides: Partial<CandidateRpcLog> = {},
): CandidateRpcLog {
  return {
    address: SOURCE.address,
    blockNumber: BLOCK_NUMBER,
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 3,
    logIndex: 7,
    removed: false,
    topics: [TOPIC0],
    data: "0x1234",
    ...overrides,
  };
}

type ProviderFixture = Readonly<{
  provider: CandidateRpcProvider;
  getChainId: ReturnType<typeof vi.fn>;
  getBlock: ReturnType<typeof vi.fn>;
  getLogs: ReturnType<typeof vi.fn>;
}>;

function providerFixture(
  vendor: "alchemy" | "quicknode",
  overrides: Readonly<{
    chainId?: number;
    block?: CandidateRpcBlock;
    logs?: readonly CandidateRpcLog[];
    identity?: string;
    vendorGroup?: string;
  }> = {},
): ProviderFixture {
  const marker = vendor === "alchemy" ? "a" : "b";
  const getChainId = vi.fn(async () => overrides.chainId ?? 1);
  const getBlock = vi.fn(async () => overrides.block ?? candidateBlock());
  const getLogs = vi.fn(async () => overrides.logs ?? [candidateLog()]);
  const client = {
    getChainId,
    getBlock,
    getLogs,
  } as unknown as CandidateRpcProvider["client"];
  return {
    provider: {
      identity: overrides.identity ?? `${vendor}-mainnet`,
      vendorGroup: overrides.vendorGroup ?? vendor,
      endpointCommitment: `0x${marker.repeat(64)}`,
      endpointOriginCommitment: `0x${marker.repeat(62)}01`,
      client,
    },
    getChainId,
    getBlock,
    getLogs,
  };
}

function providerPair(
  secondOverrides: Parameters<typeof providerFixture>[1] = {},
) {
  const first = providerFixture("alchemy");
  const second = providerFixture("quicknode", secondOverrides);
  return { first, second, providers: [first.provider, second.provider] as const };
}

function validationError(operation: string) {
  return expect.objectContaining({
    name: "DataPipelineError",
    dependency: "rpc",
    code: "validation_failed",
    safeMetadata: { operation },
  });
}

describe("QuickNode block hint parser", () => {
  it("accepts one canonical mainnet block batch and returns only hint data", () => {
    const hint = parseQuickNodeBlockHint(quickNodePayload());

    expect(hint).toEqual({
      chainId: 1,
      blockNumber: BLOCK_NUMBER.toString(),
      streamId: "f6ad6459-b5ad-4183-b370-1c1388e47e83",
      reorgedBlockNumbers: [],
    });
    expect(hint).not.toHaveProperty("hash");
    expect(hint).not.toHaveProperty("parentHash");
  });

  it("validates and bounds aligned reorg metadata", () => {
    const payload = quickNodePayload();
    payload.metadata.blocks_reorged = [Number(BLOCK_NUMBER)];
    payload.metadata.reorgs = [
      {
        block_number: Number(BLOCK_NUMBER),
        block_hash: `0x${"44".repeat(32)}`,
        block_timestamp: "1722687488",
      },
    ];

    expect(parseQuickNodeBlockHint(payload).reorgedBlockNumbers).toEqual([
      BLOCK_NUMBER.toString(),
    ]);
  });

  it("rejects non-mainnet, non-block, distant, batched or malformed hints", () => {
    const invalidPayloads: unknown[] = [];
    for (const mutate of [
      (payload: ReturnType<typeof quickNodePayload>) => {
        payload.metadata.network = "base-mainnet";
      },
      (payload: ReturnType<typeof quickNodePayload>) => {
        payload.metadata.dataset = "logs";
      },
      (payload: ReturnType<typeof quickNodePayload>) => {
        payload.metadata.keep_distance_from_tip = 1;
      },
      (payload: ReturnType<typeof quickNodePayload>) => {
        payload.metadata.batch_end_range += 1;
      },
      (payload: ReturnType<typeof quickNodePayload>) => {
        payload.data.push({ ...payload.data[0]! });
      },
      (payload: ReturnType<typeof quickNodePayload>) => {
        payload.data[0]!.number = "0x01";
      },
      (payload: ReturnType<typeof quickNodePayload>) => {
        payload.data[0]!.parentHash = "0x1234";
      },
      (payload: ReturnType<typeof quickNodePayload>) => {
        payload.metadata.blocks_reorged = [Number(BLOCK_NUMBER)];
      },
    ]) {
      const payload = quickNodePayload();
      mutate(payload);
      invalidPayloads.push(payload);
    }

    for (const payload of invalidPayloads) {
      expect(() => parseQuickNodeBlockHint(payload)).toThrow(
        expect.objectContaining({ code: "invalid_input" }),
      );
    }
  });
});

describe("dual-RPC optimistic block reader", () => {
  it("uses the stream only for the number and requires equal dual-RPC evidence", async () => {
    const pair = providerPair();
    const hint = parseQuickNodeBlockHint(quickNodePayload());

    const result = await readOptimisticBlockWithDualRpc({
      providers: pair.providers,
      hint,
    });

    expect(result).toMatchObject({
      finality: "optimistic",
      chainId: 1,
      block: {
        number: BLOCK_NUMBER.toString(),
        hash: BLOCK_HASH,
        parentHash: PARENT_HASH,
        timestamp: "1722687488",
      },
      providerIdentities: ["alchemy-mainnet", "quicknode-mainnet"],
      providerVendorGroups: ["alchemy", "quicknode"],
      providerCallCounts: [3, 3],
    });
    expect(result.block.hash).not.toBe(PAYLOAD_ONLY_HASH);
    expect(result.logs).toEqual([
      expect.objectContaining({
        sourceContractName: SOURCE.contractName,
        address: SOURCE.address,
        blockHash: BLOCK_HASH,
        transactionHash: TRANSACTION_HASH,
        logIndex: 7,
        data: "0x1234",
      }),
    ]);
    expect(result.filter.addresses).toEqual(
      [...BINDING.sources.map(({ address }) => address)].sort(),
    );
    expect(result.filter.topic0).toContain(TOPIC0);
    for (const fixture of [pair.first, pair.second]) {
      expect(fixture.getChainId).toHaveBeenCalledTimes(1);
      expect(fixture.getBlock).toHaveBeenCalledWith({
        blockNumber: BLOCK_NUMBER,
      });
      expect(fixture.getLogs).toHaveBeenCalledWith({
        addresses: result.filter.addresses,
        topic0: result.filter.topic0,
        fromBlock: BLOCK_NUMBER,
        toBlock: BLOCK_NUMBER,
      });
    }
  });

  it("uses only sources active at the hinted block", async () => {
    const blockNumber = BigInt(BINDING.startBlock);
    const onlySource = BINDING.sources.filter(
      ({ startBlock }) => BigInt(startBlock) <= blockNumber,
    );
    const source = onlySource[0]!;
    const topic0 = manifestEventSelectors(source.contractName)[0]!;
    const hash = `0x${"55".repeat(32)}` as const;
    const log = candidateLog({
      address: source.address,
      blockNumber,
      blockHash: hash,
      topics: [topic0],
    });
    const first = providerFixture("alchemy", {
      block: candidateBlock({ number: blockNumber, hash }),
      logs: [log],
    });
    const second = providerFixture("quicknode", {
      block: candidateBlock({ number: blockNumber, hash }),
      logs: [log],
    });

    const result = await readOptimisticBlockWithDualRpc({
      providers: [first.provider, second.provider],
      hint: {
        chainId: 1,
        blockNumber: blockNumber.toString(),
        streamId: "stream",
        reorgedBlockNumbers: [],
      },
    });

    expect(result.filter.addresses).toEqual(
      onlySource.map(({ address }) => address),
    );
  });

  it.each([
    ["hash", { hash: `0x${"66".repeat(32)}` }],
    ["parent hash", { parentHash: `0x${"77".repeat(32)}` }],
    ["timestamp", { timestamp: 1_722_687_489n }],
  ])("rejects a mismatched %s", async (_label, blockOverride) => {
    const block = candidateBlock(
      blockOverride as Partial<CandidateRpcBlock>,
    );
    const pair = providerPair({
      block,
      ...(block.hash !== BLOCK_HASH && block.hash !== null
        ? { logs: [candidateLog({ blockHash: block.hash })] }
        : {}),
    });

    await expect(
      readOptimisticBlockWithDualRpc({
        providers: pair.providers,
        hint: parseQuickNodeBlockHint(quickNodePayload()),
      }),
    ).rejects.toEqual(validationError("optimistic-provider-mismatch"));
  });

  it("rejects a non-mainnet provider", async () => {
    const pair = providerPair({ chainId: 8_453 });

    await expect(
      readOptimisticBlockWithDualRpc({
        providers: pair.providers,
        hint: parseQuickNodeBlockHint(quickNodePayload()),
      }),
    ).rejects.toEqual(validationError("optimistic-chain-id"));
  });

  it("rejects unequal provider log sets", async () => {
    const pair = providerPair({ logs: [candidateLog({ data: "0xabcd" })] });

    await expect(
      readOptimisticBlockWithDualRpc({
        providers: pair.providers,
        hint: parseQuickNodeBlockHint(quickNodePayload()),
      }),
    ).rejects.toEqual(validationError("optimistic-provider-mismatch"));
  });

  it.each([
    ["removed", candidateLog({ removed: true })],
    ["missing parent", candidateLog()],
    ["malformed topic", candidateLog({ topics: ["0x1234"] })],
    [
      "unknown source",
      candidateLog({ address: `0x${"99".repeat(20)}` }),
    ],
    [
      "wrong source selector",
      candidateLog({
        topics: [manifestEventSelectors("ClassicV3Hook")[0]!],
      }),
    ],
  ])("rejects a %s provider boundary violation", async (label, log) => {
    const block =
      label === "missing parent"
        ? candidateBlock({ parentHash: undefined })
        : candidateBlock();
    const logs = label === "missing parent" ? [candidateLog()] : [log];
    const pair = providerPair({ block, logs });

    await expect(
      readOptimisticBlockWithDualRpc({
        providers: pair.providers,
        hint: parseQuickNodeBlockHint(quickNodePayload()),
      }),
    ).rejects.toEqual(
      validationError(
        label === "missing parent"
          ? "optimistic-block-header"
          : label === "removed"
            ? "optimistic-log"
            : "optimistic-log-boundary",
      ),
    );
  });

  it("rejects duplicate log placement and over-limit log responses", async () => {
    for (const logs of [
      [candidateLog(), candidateLog()],
      Array.from({ length: 4_097 }, (_value, index) =>
        candidateLog({ logIndex: index }),
      ),
    ]) {
      const pair = providerPair({ logs });
      await expect(
        readOptimisticBlockWithDualRpc({
          providers: pair.providers,
          hint: parseQuickNodeBlockHint(quickNodePayload()),
        }),
      ).rejects.toEqual(
        validationError(
          logs.length > 4_096
            ? "optimistic-logs-count"
            : "optimistic-log-order",
        ),
      );
    }
  });

  it("fails closed at the bounded hard deadline", async () => {
    const pair = providerPair();
    pair.second.getBlock.mockImplementation(
      () => new Promise<CandidateRpcBlock>(() => undefined),
    );

    await expect(
      readOptimisticBlockWithDualRpc({
        providers: pair.providers,
        hint: parseQuickNodeBlockHint(quickNodePayload()),
        hardDeadlineMs: 5,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "timeout",
        safeMetadata: { operation: "optimistic-block" },
      }),
    );
  });

  it("rejects provider identity reuse and pre-release hints", async () => {
    const sameVendor = providerPair({ vendorGroup: "alchemy" });
    await expect(
      readOptimisticBlockWithDualRpc({
        providers: sameVendor.providers,
        hint: parseQuickNodeBlockHint(quickNodePayload()),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "invalid_input",
        safeMetadata: { operation: "optimistic-provider-independence" },
      }),
    );

    const pair = providerPair();
    await expect(
      readOptimisticBlockWithDualRpc({
        providers: pair.providers,
        hint: {
          chainId: 1,
          blockNumber: String(BINDING.startBlock - 1),
          streamId: "stream",
          reorgedBlockNumbers: [],
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "invalid_input",
        safeMetadata: { operation: "optimistic-block-before-release" },
      }),
    );
  });
});
