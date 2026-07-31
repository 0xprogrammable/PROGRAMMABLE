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

import { createEnvioClient } from "../../lib/data-pipeline/envio";
import { DataPipelineError } from "../../lib/data-pipeline/errors";
import { canonicalPayloadJson } from "../../indexer/src/lib/payload-hash";
import releaseBinding from "../../config/data-pipeline-release.v1.json";

const BLOCK_HASH = `0x${"11".repeat(32)}`;
const TRANSACTION_HASH = `0x${"22".repeat(32)}`;
const SOURCE = "0xd240d06f8586eb799f20056054e5b527405e6bad";
const CANDIDATE_ID = `1:${BLOCK_HASH}:${TRANSACTION_HASH}:7`;

const EVENT_ABI = parseAbiItem(
  "event MemeTokenLaunched(address indexed creator, address indexed token, bytes32 indexed poolId, address feeHook, address positionRecipient, uint256 positionTokenId, uint16 totalSwapFeeBps, bytes32 launchHash)",
);
const EVENT_ARGS = {
  creator: "0x1111111111111111111111111111111111111111",
  token: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"33".repeat(32)}`,
  feeHook: "0x4444444444444444444444444444444444444444",
  positionRecipient: "0x5555555555555555555555555555555555555555",
  positionTokenId: 42n,
  totalSwapFeeBps: 100n,
  launchHash: `0x${"66".repeat(32)}`,
} as const;
const EVENT_TOPICS = encodeEventTopics({
  abi: [EVENT_ABI],
  eventName: EVENT_ABI.name,
  args: EVENT_ARGS,
}) as readonly Hex[];
const NON_INDEXED_INPUTS = EVENT_ABI.inputs.filter(
  (input) => !("indexed" in input) || input.indexed !== true,
) as readonly AbiParameter[];
const EVENT_DATA = encodeAbiParameters(
  NON_INDEXED_INPUTS,
  NON_INDEXED_INPUTS.map(
    (input) => EVENT_ARGS[input.name as keyof typeof EVENT_ARGS],
  ),
);
const PAYLOAD_HASH = keccak256(
  encodeAbiParameters(
    [{ type: "bytes32[]" }, { type: "bytes" }],
    [EVENT_TOPICS, EVENT_DATA],
  ),
);
const DECODED_PAYLOAD = canonicalPayloadJson(EVENT_ARGS);
const DYNAMIC_SOURCE = "0x4cfe000000000000000000000000000000000001";
const DYNAMIC_CANDIDATE_ID =
  `1:${BLOCK_HASH}:${TRANSACTION_HASH}:8`;
const DYNAMIC_EVENT_ABI = parseAbiItem(
  "event CreatorFeesCheckpointed(bytes32 indexed poolId, uint64 indexed configurationEpoch, uint256 amount, uint256 totalCreatorFeesReceived)",
);
const DYNAMIC_EVENT_ARGS = {
  poolId: `0x${"77".repeat(32)}`,
  configurationEpoch: 1n,
  amount: 900n,
  totalCreatorFeesReceived: 900n,
} as const;
const DYNAMIC_EVENT_TOPICS = encodeEventTopics({
  abi: [DYNAMIC_EVENT_ABI],
  eventName: DYNAMIC_EVENT_ABI.name,
  args: DYNAMIC_EVENT_ARGS,
}) as readonly Hex[];
const DYNAMIC_NON_INDEXED_INPUTS = DYNAMIC_EVENT_ABI.inputs.filter(
  (input) => !("indexed" in input) || input.indexed !== true,
) as readonly AbiParameter[];
const DYNAMIC_EVENT_DATA = encodeAbiParameters(
  DYNAMIC_NON_INDEXED_INPUTS,
  DYNAMIC_NON_INDEXED_INPUTS.map(
    (input) =>
      DYNAMIC_EVENT_ARGS[input.name as keyof typeof DYNAMIC_EVENT_ARGS],
  ),
);
const DYNAMIC_PAYLOAD_HASH = keccak256(
  encodeAbiParameters(
    [{ type: "bytes32[]" }, { type: "bytes" }],
    [DYNAMIC_EVENT_TOPICS, DYNAMIC_EVENT_DATA],
  ),
);
const SHARED_HOOK_SOURCE =
  "0x90c67c1e866f86526f0e338459cd435e1f23a0cc";
const SHARED_FACTORY_SOURCE =
  "0x52d70971d6653a754c29385a2a6f241a481952d4";
const SHARED_HOOK_ID = `1:${BLOCK_HASH}:${TRANSACTION_HASH}:9`;
const SHARED_FACTORY_ID = `1:${BLOCK_HASH}:${TRANSACTION_HASH}:10`;
const SHARED_HOOK_EVENT_ABI = parseAbiItem(
  "event PoolRegistered(bytes32 indexed poolId, address indexed token, address indexed quoteAsset, address rewardVault, address registrar, bool quoteIsCurrency0, bytes32 rewardConfigurationHash, bytes32 quoteConfigurationHash)",
);
const SHARED_HOOK_EVENT_ARGS = {
  poolId: `0x${"88".repeat(32)}`,
  token: "0x8888888888888888888888888888888888888888",
  quoteAsset: "0x9999999999999999999999999999999999999999",
  rewardVault: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  registrar: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  quoteIsCurrency0: true,
  rewardConfigurationHash: `0x${"aa".repeat(32)}`,
  quoteConfigurationHash: `0x${"bb".repeat(32)}`,
} as const;
const SHARED_FACTORY_EVENT_ABI = parseAbiItem(
  "event QuoteAssetFeeSplitVaultDeployed(address indexed vault, address indexed feeHook, bytes32 indexed poolId, address quoteAsset)",
);
const SHARED_FACTORY_EVENT_ARGS = {
  vault: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  feeHook: SHARED_HOOK_SOURCE,
  poolId: `0x${"88".repeat(32)}`,
  quoteAsset: "0x9999999999999999999999999999999999999999",
} as const;

function encodedEventFixture(
  abi: typeof SHARED_HOOK_EVENT_ABI | typeof SHARED_FACTORY_EVENT_ABI,
  args: Readonly<Record<string, unknown>>,
) {
  const topics = encodeEventTopics({
    abi: [abi],
    eventName: abi.name,
    args,
  }) as readonly Hex[];
  const nonIndexedInputs = abi.inputs.filter(
    (input) => !("indexed" in input) || input.indexed !== true,
  ) as readonly AbiParameter[];
  const data = encodeAbiParameters(
    nonIndexedInputs,
    nonIndexedInputs.map((input) => {
      if (!input.name) throw new Error("Shared event input must be named");
      return args[input.name];
    }),
  );
  return {
    topics,
    data,
    decodedPayload: canonicalPayloadJson(args),
    payloadHash: keccak256(
      encodeAbiParameters(
        [{ type: "bytes32[]" }, { type: "bytes" }],
        [topics, data],
      ),
    ),
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: CANDIDATE_ID,
    downstreamLogicalId: null,
    receiptLogOrdinal: null,
    chainId: 1,
    blockNumber: "25624131",
    blockHash: BLOCK_HASH,
    blockTimestamp: "1785480000",
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 3,
    blockGlobalLogIndex: 7,
    sourceAddress: SOURCE,
    contractName: "ClassicV2Launcher",
    eventName: "MemeTokenLaunched",
    model: "classic",
    releaseVersion: "classic-v2",
    topics: EVENT_TOPICS,
    data: EVENT_DATA,
    decodedPayload: DECODED_PAYLOAD,
    payloadHash: PAYLOAD_HASH,
    ...overrides,
  };
}

function dynamicCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: DYNAMIC_CANDIDATE_ID,
    downstreamLogicalId: null,
    receiptLogOrdinal: null,
    chainId: 1,
    blockNumber: "25639597",
    blockHash: BLOCK_HASH,
    blockTimestamp: "1785481000",
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 4,
    blockGlobalLogIndex: 8,
    sourceAddress: DYNAMIC_SOURCE,
    contractName: "ClassicV3RewardVault",
    eventName: "CreatorFeesCheckpointed",
    model: "unresolved",
    releaseVersion: "unresolved",
    topics: DYNAMIC_EVENT_TOPICS,
    data: DYNAMIC_EVENT_DATA,
    decodedPayload: canonicalPayloadJson(DYNAMIC_EVENT_ARGS),
    payloadHash: DYNAMIC_PAYLOAD_HASH,
    ...overrides,
  };
}

function sharedStaticCandidates() {
  const hook = encodedEventFixture(
    SHARED_HOOK_EVENT_ABI,
    SHARED_HOOK_EVENT_ARGS,
  );
  const factory = encodedEventFixture(
    SHARED_FACTORY_EVENT_ABI,
    SHARED_FACTORY_EVENT_ARGS,
  );
  return [
    {
      id: SHARED_HOOK_ID,
      downstreamLogicalId: null,
      receiptLogOrdinal: null,
      chainId: 1,
      blockNumber: "25640338",
      blockHash: BLOCK_HASH,
      blockTimestamp: "1785482000",
      transactionHash: TRANSACTION_HASH,
      transactionIndex: 5,
      blockGlobalLogIndex: 9,
      sourceAddress: SHARED_HOOK_SOURCE,
      contractName: "StockV2V3Hook",
      eventName: "PoolRegistered",
      model: "unresolved",
      releaseVersion: "unresolved",
      ...hook,
    },
    {
      id: SHARED_FACTORY_ID,
      downstreamLogicalId: null,
      receiptLogOrdinal: null,
      chainId: 1,
      blockNumber: "25640338",
      blockHash: BLOCK_HASH,
      blockTimestamp: "1785482000",
      transactionHash: TRANSACTION_HASH,
      transactionIndex: 5,
      blockGlobalLogIndex: 10,
      sourceAddress: SHARED_FACTORY_SOURCE,
      contractName: "StockV2V3RewardVaultFactory",
      eventName: "QuoteAssetFeeSplitVaultDeployed",
      model: "unresolved",
      releaseVersion: "unresolved",
      ...factory,
    },
  ];
}

function placedCandidate(input: {
  blockNumber: string;
  blockGlobalLogIndex: number;
  blockHash: Hex;
  transactionHash: Hex;
}) {
  return candidate({
    id: `1:${input.blockHash}:${input.transactionHash}:${input.blockGlobalLogIndex}`,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    transactionHash: input.transactionHash,
    blockGlobalLogIndex: input.blockGlobalLogIndex,
  });
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function progressPayload(input: {
  meta?: Record<string, unknown>;
  state?: Record<string, unknown>;
} = {}) {
  return {
    data: {
      _meta: [
        {
          chainId: 1,
          progressBlock: 25_650_010,
          bufferBlock: 25_650_010,
          sourceBlock: 25_650_022,
          isReady: true,
          eventsProcessed: 51_234,
          ...input.meta,
        },
      ],
      IndexerState_by_pk: {
        id: "ethereum-mainnet",
        schemaVersion: "1",
        deployment: "production-1e7c381",
        sourceCommit: releaseBinding.envio.sourceCommit,
        configSha256: releaseBinding.envio.configSha256,
        schemaSha256: releaseBinding.envio.schemaSha256,
        handlerSha256: releaseBinding.envio.handlerSha256,
        sourceRegistrySha256: releaseBinding.envio.sourceRegistrySha256,
        eventSetSha256: releaseBinding.envio.eventSetSha256,
        eventCount: releaseBinding.envio.eventCount,
        chainId: 1,
        progressBlock: "25650000",
        progressBlockHash: BLOCK_HASH,
        progressTimestamp: "1785480000",
        progressTransactionHash: TRANSACTION_HASH,
        progressOccurrenceId: CANDIDATE_ID,
        ...input.state,
      },
    },
  };
}

describe("Envio candidate adapter", () => {
  it("returns a strictly validated upstream candidate without authority fields", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      expect(request.query).toContain("ChainEvent_by_pk");
      expect(request.query).toContain("$candidateId: String!");
      expect(request.query).not.toContain("$candidateId: ID!");
      expect(request.variables).toEqual({ candidateId: CANDIDATE_ID });
      expect(init?.headers).toMatchObject({
        authorization: "Bearer envio-secret",
        "content-type": "application/json",
      });
      return json({ data: { ChainEvent_by_pk: candidate() } });
    });
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      token: "envio-secret",
      fetcher,
    });

    const result = await client.readCandidate(CANDIDATE_ID);

    expect(result).toMatchObject({
      candidateId: CANDIDATE_ID,
      chainId: 1,
      blockNumber: "25624131",
      blockHash: BLOCK_HASH,
      transactionHash: TRANSACTION_HASH,
      transactionIndex: 3,
      blockGlobalLogIndex: 7,
      sourceAddress: SOURCE,
      releaseHint: {
        model: "classic",
        releaseVersion: "classic-v2",
      },
      orderedTopics: EVENT_TOPICS,
      rawData: EVENT_DATA,
      decodedPayload: {
        creator: "0x1111111111111111111111111111111111111111",
        feeHook: "0x4444444444444444444444444444444444444444",
        launchHash: `0x${"66".repeat(32)}`,
        poolId: `0x${"33".repeat(32)}`,
        positionRecipient:
          "0x5555555555555555555555555555555555555555",
        positionTokenId: "42",
        token: "0x2222222222222222222222222222222222222222",
        totalSwapFeeBps: "100",
      },
      payloadHash: PAYLOAD_HASH,
    });
    expect(result).not.toHaveProperty("canonical");
    expect(result).not.toHaveProperty("verified");
    expect(result).not.toHaveProperty("rewardAuthority");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("supports an Envio public endpoint without sending an Authorization header", async () => {
    let authorization: string | null = "not-read";
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      fetcher: async (_url, init) => {
        authorization = new Headers(init?.headers).get("authorization");
        return json({ data: { ChainEvent_by_pk: candidate() } });
      },
    });

    await expect(client.readCandidate(CANDIDATE_ID)).resolves.toMatchObject({
      candidateId: CANDIDATE_ID,
    });
    expect(authorization).toBeNull();
  });

  it("returns null only when the exact candidate id is absent", async () => {
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      token: "envio-secret",
      fetcher: async () => json({ data: { ChainEvent_by_pk: null } }),
    });

    await expect(client.readCandidate(CANDIDATE_ID)).resolves.toBeNull();
  });

  it("accepts known dynamic vault events only as release-neutral candidates", async () => {
    const accepted = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      fetcher: async () =>
        json({ data: { ChainEvent_by_pk: dynamicCandidate() } }),
    });

    await expect(
      accepted.readCandidate(DYNAMIC_CANDIDATE_ID),
    ).resolves.toMatchObject({
      sourceAddress: DYNAMIC_SOURCE,
      contractName: "ClassicV3RewardVault",
      releaseHint: { model: "unresolved", releaseVersion: "unresolved" },
    });

    for (const override of [
      { model: "classic", releaseVersion: "classic-v3" },
      { contractName: "ClassicV3UnknownVault" },
      { blockNumber: "25639595" },
    ]) {
      const rejected = createEnvioClient({
        endpoint: "https://envio.example/graphql",
        fetcher: async () =>
          json({
            data: { ChainEvent_by_pk: dynamicCandidate(override) },
          }),
      });
      await expect(
        rejected.readCandidate(DYNAMIC_CANDIDATE_ID),
      ).rejects.toMatchObject({
        dependency: "envio",
        code: "validation_failed",
      });
    }
  });

  it("accepts shared static hook and factory events only as release-neutral candidates", async () => {
    for (const fixture of sharedStaticCandidates()) {
      const accepted = createEnvioClient({
        endpoint: "https://envio.example/graphql",
        fetcher: async () =>
          json({ data: { ChainEvent_by_pk: fixture } }),
      });
      await expect(accepted.readCandidate(fixture.id)).resolves.toMatchObject({
        contractName: fixture.contractName,
        releaseHint: { model: "unresolved", releaseVersion: "unresolved" },
      });

      for (const override of [
        {
          model: "stock-paired",
          releaseVersion: "stock-paired-v2",
        },
        { blockNumber: "25640337" },
      ]) {
        const rejected = createEnvioClient({
          endpoint: "https://envio.example/graphql",
          fetcher: async () =>
            json({
              data: {
                ChainEvent_by_pk: { ...fixture, ...override },
              },
            }),
        });
        await expect(rejected.readCandidate(fixture.id)).rejects.toMatchObject({
          dependency: "envio",
          code: "validation_failed",
        });
      }
    }
  });

  it.each([
    ["fork identity", { id: `1:${"0x" + "99".repeat(32)}:${TRANSACTION_HASH}:7` }],
    ["block hash", { blockHash: `0x${"99".repeat(32)}` }],
    ["global log index", { blockGlobalLogIndex: 8 }],
    ["source cutoff", { blockNumber: "25624130" }],
    ["source contract", { contractName: "ClassicV2Hook" }],
    ["release hint", { releaseVersion: "classic-v3" }],
    ["model hint", { model: "stock-paired" }],
    ["downstream identity", { downstreamLogicalId: "1:trusted:0" }],
    ["receipt ordinal", { receiptLogOrdinal: 0 }],
    ["topic width", { topics: ["0x12"] }],
    ["event signature", { topics: [`0x${"44".repeat(32)}`, ...EVENT_TOPICS.slice(1)] }],
    ["indexed topic count", { topics: EVENT_TOPICS.slice(0, -1) }],
    ["raw data", { data: "0x0" }],
    ["strict ABI data", { data: "0x" }],
    ["event name", { eventName: "MemeLiquidityConfigured" }],
    [
      "decoded payload mismatch",
      {
        decodedPayload: JSON.stringify({
          ...JSON.parse(DECODED_PAYLOAD),
          positionTokenId: "43",
        }),
      },
    ],
    ["payload hash", { payloadHash: `0x${"33".repeat(32)}` }],
    ["payload JSON", { decodedPayload: "{" }],
  ])("rejects malformed %s provenance", async (_name, override) => {
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      token: "envio-secret",
      fetcher: async () =>
        json({ data: { ChainEvent_by_pk: candidate(override) } }),
    });

    await expect(client.readCandidate(CANDIDATE_ID)).rejects.toMatchObject({
      dependency: "envio",
      code: "validation_failed",
    });
  });

  it("rejects configuration failures as caller errors without opening the circuit", () => {
    expect(() =>
      createEnvioClient({
        endpoint: "https://secret:password@envio.example/graphql",
        token: "envio-secret",
      }),
    ).toThrowError(DataPipelineError);
  });
});

describe("Envio candidate cursor adapter", () => {
  const SECOND_BLOCK_HASH = `0x${"77".repeat(32)}` as const;
  const SECOND_TRANSACTION_HASH = `0x${"88".repeat(32)}` as const;

  it("reads a bounded, strictly ordered page after an exclusive cursor", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      expect(request.query).toContain("query ProgrammableCandidatesAfter");
      expect(request.query).toContain("$afterBlock: numeric!");
      expect(request.query).toContain("$afterCandidateId: String!");
      expect(request.query).toContain("blockGlobalLogIndex: asc");
      expect(request.query).toContain("{ id: { _gt: $afterCandidateId } }");
      expect(request.query).toContain("id: asc");
      expect(request.variables).toEqual({
        afterBlock: "25624130",
        afterLogIndex: -1,
        afterCandidateId: "",
        first: 2,
      });
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer envio-secret",
      );
      return json({
        data: {
          ChainEvent: [
            candidate(),
            placedCandidate({
              blockNumber: "25624132",
              blockGlobalLogIndex: 0,
              blockHash: SECOND_BLOCK_HASH,
              transactionHash: SECOND_TRANSACTION_HASH,
            }),
          ],
        },
      });
    });
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      token: "envio-secret",
      fetcher,
    });

    const page = await client.readCandidatesAfter({
      cursor: {
        blockNumber: "25624130",
        blockGlobalLogIndex: -1,
        candidateId: "",
      },
      limit: 2,
    });

    expect(page.map((row) => row.candidateId)).toEqual([
      CANDIDATE_ID,
      `1:${SECOND_BLOCK_HASH}:${SECOND_TRANSACTION_HASH}:0`,
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ blockNumber: "-1", blockGlobalLogIndex: -1, candidateId: "" }, 10],
    [{ blockNumber: "25624130", blockGlobalLogIndex: -2, candidateId: "" }, 10],
    [{ blockNumber: "25624130", blockGlobalLogIndex: 1.5, candidateId: "" }, 10],
    [
      {
        blockNumber: "25624130",
        blockGlobalLogIndex: 2_147_483_648,
        candidateId: "",
      },
      10,
    ],
    [{ blockNumber: "25624130", blockGlobalLogIndex: 0, candidateId: "" }, 10],
    [
      {
        blockNumber: "25624130",
        blockGlobalLogIndex: 0,
        candidateId: "not-a-candidate-id",
      },
      10,
    ],
    [{ blockNumber: "25624130", blockGlobalLogIndex: -1, candidateId: "" }, 0],
    [{ blockNumber: "25624130", blockGlobalLogIndex: -1, candidateId: "" }, 33],
  ])("rejects an invalid cursor or limit before fetching", async (cursor, limit) => {
    const fetcher = vi.fn();
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      fetcher,
    });

    await expect(
      client.readCandidatesAfter({ cursor, limit }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a row at or before the exclusive cursor", async () => {
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      fetcher: async () =>
        json({ data: { ChainEvent: [candidate()] } }),
    });

    await expect(
      client.readCandidatesAfter({
        cursor: {
          blockNumber: "25624131",
          blockGlobalLogIndex: 7,
          candidateId: CANDIDATE_ID,
        },
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("uses candidate identity as a stable-snapshot tie breaker", async () => {
    const forkReplacement = placedCandidate({
      blockNumber: "25624131",
      blockGlobalLogIndex: 7,
      blockHash: SECOND_BLOCK_HASH,
      transactionHash: SECOND_TRANSACTION_HASH,
    });
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      fetcher: async () =>
        json({ data: { ChainEvent: [forkReplacement] } }),
    });

    await expect(
      client.readCandidatesAfter({
        cursor: {
          blockNumber: "25624131",
          blockGlobalLogIndex: 7,
          candidateId: CANDIDATE_ID,
        },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        candidateId:
          `1:${SECOND_BLOCK_HASH}:${SECOND_TRANSACTION_HASH}:7`,
      }),
    ]);
  });

  it("snapshots cursor fields before validating and requesting a page", async () => {
    let ordinalReads = 0;
    const cursor = {
      blockNumber: "25624130",
      get blockGlobalLogIndex() {
        ordinalReads += 1;
        return ordinalReads === 1 ? -1 : 0;
      },
      candidateId: "",
    };
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      fetcher: async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          variables: Record<string, unknown>;
        };
        expect(request.variables).toMatchObject({
          afterBlock: "25624130",
          afterLogIndex: -1,
          afterCandidateId: "",
        });
        return json({ data: { ChainEvent: [] } });
      },
    });

    await expect(client.readCandidatesAfter({ cursor })).resolves.toEqual([]);
    expect(ordinalReads).toBe(1);
  });

  it("rejects a lexical predecessor at the same block and log position", async () => {
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      fetcher: async () => json({ data: { ChainEvent: [candidate()] } }),
    });

    await expect(
      client.readCandidatesAfter({
        cursor: {
          blockNumber: "25624131",
          blockGlobalLogIndex: 7,
          candidateId:
            `1:${SECOND_BLOCK_HASH}:${SECOND_TRANSACTION_HASH}:7`,
        },
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects duplicate or non-ascending candidate placement", async () => {
    const second = placedCandidate({
      blockNumber: "25624132",
      blockGlobalLogIndex: 0,
      blockHash: SECOND_BLOCK_HASH,
      transactionHash: SECOND_TRANSACTION_HASH,
    });
    for (const rows of [[second, second], [second, candidate()]]) {
      const client = createEnvioClient({
        endpoint: "https://envio.example/graphql",
        fetcher: async () => json({ data: { ChainEvent: rows } }),
      });

      await expect(
        client.readCandidatesAfter({
          cursor: {
            blockNumber: "25624130",
            blockGlobalLogIndex: -1,
            candidateId: "",
          },
        }),
      ).rejects.toMatchObject({ code: "validation_failed" });
    }
  });

  it("rejects malformed page envelopes and oversized responses", async () => {
    for (const response of [
      { data: { ChainEvent: null } },
      { data: { ChainEvent: [candidate(), candidate()] } },
      { data: { ChainEvent: [], unexpected: true } },
    ]) {
      const client = createEnvioClient({
        endpoint: "https://envio.example/graphql",
        fetcher: async () => json(response),
      });

      await expect(
        client.readCandidatesAfter({
          cursor: {
            blockNumber: "25624130",
            blockGlobalLogIndex: -1,
            candidateId: "",
          },
          limit: 1,
        }),
      ).rejects.toMatchObject({ code: "validation_failed" });
    }
  });
});

describe("Envio progress adapter", () => {
  it("derives readiness from official _meta while retaining the last handled event identity", async () => {
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      token: "envio-secret",
      fetcher: async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          query: string;
          variables: Record<string, unknown>;
        };
        expect(request.query).toContain("_meta");
        expect(request.query).toContain("sourceBlock");
        expect(request.query).toContain("IndexerState_by_pk");
        expect(request.query).toContain("$stateId: String!");
        expect(request.variables).toEqual({ stateId: "ethereum-mainnet" });
        return json(progressPayload());
      },
    });

    await expect(
      client.readProgress({ requiredBlock: "25650002" }),
    ).resolves.toEqual({
      chainId: 1,
      deployment: "production-1e7c381",
      schemaVersion: "1",
      progressBlock: "25650010",
      bufferBlock: "25650010",
      sourceBlock: "25650022",
      eventsProcessed: "51234",
      lastHandledEventBlock: "25650000",
      lastHandledEventBlockHash: BLOCK_HASH,
      lastHandledEventTimestamp: "1785480000",
      lastHandledEventTransactionHash: TRANSACTION_HASH,
      lastHandledEventOccurrenceId: CANDIDATE_ID,
      requiredBlock: "25650002",
      lagBlocks: "0",
      isReady: true,
    });
  });

  it("rejects malformed chain, schema, hash, occurrence, and future arithmetic", async () => {
    for (const override of [
      { chainId: 10 },
      { schemaVersion: "2" },
      { progressBlockHash: "0x12" },
      { progressOccurrenceId: "not-an-occurrence" },
      { progressBlock: "-1" },
    ]) {
      const client = createEnvioClient({
        endpoint: "https://envio.example/graphql",
        token: "envio-secret",
        fetcher: async () =>
          json(progressPayload({ state: override })),
      });
      await expect(
        client.readProgress({ requiredBlock: "25650002" }),
      ).rejects.toMatchObject({ code: "validation_failed" });
    }
  });

  it.each([
    {
      progressOccurrenceId: `1:${`0x${"77".repeat(32)}`}:${TRANSACTION_HASH}:7`,
    },
    {
      progressOccurrenceId: `1:${BLOCK_HASH}:${`0x${"88".repeat(32)}`}:7`,
    },
  ])(
    "rejects a well-formed progress occurrence with inconsistent embedded identity",
    async (override) => {
      const client = createEnvioClient({
        endpoint: "https://envio.example/graphql",
        token: "envio-secret",
        fetcher: async () =>
          json(progressPayload({ state: override })),
      });

      await expect(
        client.readProgress({ requiredBlock: "25650002" }),
      ).rejects.toMatchObject({ code: "validation_failed" });
    },
  );

  it.each([
    ["chain", { chainId: 10 }],
    ["progress after buffer", { progressBlock: 25_650_011 }],
    ["buffer after source", { bufferBlock: 25_650_023 }],
    ["negative progress", { progressBlock: -1 }],
    ["negative event count", { eventsProcessed: -1 }],
  ])("rejects invalid official _meta %s", async (_name, meta) => {
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      fetcher: async () => json(progressPayload({ meta })),
    });

    await expect(
      client.readProgress({ requiredBlock: "25650002" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects a last handled event beyond official Envio progress", async () => {
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      fetcher: async () =>
        json(progressPayload({ state: { progressBlock: "25650011" } })),
    });

    await expect(
      client.readProgress({ requiredBlock: "25650002" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("fails closed on an unexpected deployment label", async () => {
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      fetcher: async () =>
        json(progressPayload({ state: { deployment: "production-other" } })),
    });

    await expect(
      client.readProgress({ requiredBlock: "25650002" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it.each([
    ["source commit", { sourceCommit: "f".repeat(40) }],
    ["config hash", { configSha256: `0x${"ff".repeat(32)}` }],
    ["schema hash", { schemaSha256: `0x${"ff".repeat(32)}` }],
    ["handler hash", { handlerSha256: `0x${"ff".repeat(32)}` }],
    [
      "source registry hash",
      { sourceRegistrySha256: `0x${"ff".repeat(32)}` },
    ],
    ["event set hash", { eventSetSha256: `0x${"ff".repeat(32)}` }],
    ["event count", { eventCount: 50 }],
  ])("fails closed on an unexpected deployment %s", async (_name, state) => {
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      fetcher: async () => json(progressPayload({ state })),
    });

    await expect(
      client.readProgress({ requiredBlock: "25650002" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("reports official lag and readiness without treating a syncing indexer as malformed", async () => {
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      fetcher: async () =>
        json(progressPayload({ meta: { isReady: false } })),
    });

    await expect(
      client.readProgress({ requiredBlock: "25650015" }),
    ).resolves.toMatchObject({
      progressBlock: "25650010",
      requiredBlock: "25650015",
      lagBlocks: "5",
      isReady: false,
    });
  });
});
