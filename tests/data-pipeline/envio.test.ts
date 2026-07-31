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
      expect(request.query).toContain("blockGlobalLogIndex: asc");
      expect(request.variables).toEqual({
        afterBlock: "25624130",
        afterLogIndex: -1,
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
      cursor: { blockNumber: "25624130", blockGlobalLogIndex: -1 },
      limit: 2,
    });

    expect(page.map((row) => row.candidateId)).toEqual([
      CANDIDATE_ID,
      `1:${SECOND_BLOCK_HASH}:${SECOND_TRANSACTION_HASH}:0`,
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ blockNumber: "-1", blockGlobalLogIndex: -1 }, 10],
    [{ blockNumber: "25624130", blockGlobalLogIndex: -2 }, 10],
    [{ blockNumber: "25624130", blockGlobalLogIndex: 1.5 }, 10],
    [{ blockNumber: "25624130", blockGlobalLogIndex: 2_147_483_648 }, 10],
    [{ blockNumber: "25624130", blockGlobalLogIndex: -1 }, 0],
    [{ blockNumber: "25624130", blockGlobalLogIndex: -1 }, 33],
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
        cursor: { blockNumber: "25624131", blockGlobalLogIndex: 7 },
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
          cursor: { blockNumber: "25624130", blockGlobalLogIndex: -1 },
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
          cursor: { blockNumber: "25624130", blockGlobalLogIndex: -1 },
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
