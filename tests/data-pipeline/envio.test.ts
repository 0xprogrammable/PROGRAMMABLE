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

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Envio candidate adapter", () => {
  it("returns a strictly validated upstream candidate without authority fields", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      expect(request.query).toContain("ChainEvent_by_pk");
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

describe("Envio progress adapter", () => {
  it("derives readiness and lag from strict indexer progress", async () => {
    const client = createEnvioClient({
      endpoint: "https://envio.example/graphql",
      token: "envio-secret",
      fetcher: async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          query: string;
          variables: Record<string, unknown>;
        };
        expect(request.query).toContain("IndexerState_by_pk");
        expect(request.variables).toEqual({ stateId: "ethereum-mainnet" });
        return json({
          data: {
            IndexerState_by_pk: {
              id: "ethereum-mainnet",
              schemaVersion: "1",
              deployment: "programmable-production",
              chainId: 1,
              progressBlock: "25650000",
              progressBlockHash: BLOCK_HASH,
              progressTimestamp: "1785480000",
              progressTransactionHash: TRANSACTION_HASH,
              progressOccurrenceId: CANDIDATE_ID,
            },
          },
        });
      },
    });

    await expect(
      client.readProgress({ requiredBlock: "25650002" }),
    ).resolves.toEqual({
      chainId: 1,
      deployment: "programmable-production",
      schemaVersion: "1",
      progressBlock: "25650000",
      progressBlockHash: BLOCK_HASH,
      progressTimestamp: "1785480000",
      progressTransactionHash: TRANSACTION_HASH,
      progressOccurrenceId: CANDIDATE_ID,
      requiredBlock: "25650002",
      lagBlocks: "2",
      isReady: false,
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
          json({
            data: {
              IndexerState_by_pk: {
                id: "ethereum-mainnet",
                schemaVersion: "1",
                deployment: "programmable-production",
                chainId: 1,
                progressBlock: "25650000",
                progressBlockHash: BLOCK_HASH,
                progressTimestamp: "1785480000",
                progressTransactionHash: TRANSACTION_HASH,
                progressOccurrenceId: CANDIDATE_ID,
                ...override,
              },
            },
          }),
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
          json({
            data: {
              IndexerState_by_pk: {
                id: "ethereum-mainnet",
                schemaVersion: "1",
                deployment: "programmable-production",
                chainId: 1,
                progressBlock: "25650000",
                progressBlockHash: BLOCK_HASH,
                progressTimestamp: "1785480000",
                progressTransactionHash: TRANSACTION_HASH,
                progressOccurrenceId: override.progressOccurrenceId,
              },
            },
          }),
      });

      await expect(
        client.readProgress({ requiredBlock: "25650002" }),
      ).rejects.toMatchObject({ code: "validation_failed" });
    },
  );
});
