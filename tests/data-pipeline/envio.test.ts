import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createEnvioClient } from "../../lib/data-pipeline/envio";
import { DataPipelineError } from "../../lib/data-pipeline/errors";

const BLOCK_HASH = `0x${"11".repeat(32)}`;
const TRANSACTION_HASH = `0x${"22".repeat(32)}`;
const PAYLOAD_HASH =
  "0x52d16f216ed7eab8a1dea17d1d4161c787bab4f503e44936be5b62c7af2ea5e1";
const EVENT_SIGNATURE = `0x${"44".repeat(32)}`;
const SOURCE = "0xd240d06f8586eb799f20056054e5b527405e6bad";
const CANDIDATE_ID = `1:${BLOCK_HASH}:${TRANSACTION_HASH}:7`;

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
    topics: [EVENT_SIGNATURE],
    data: "0x",
    decodedPayload: '{"creator":"0x1111111111111111111111111111111111111111"}',
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
      orderedTopics: [EVENT_SIGNATURE],
      rawData: "0x",
      decodedPayload: {
        creator: "0x1111111111111111111111111111111111111111",
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
    ["raw data", { data: "0x0" }],
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
});
