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
import { canonicalPayloadJson } from "../../indexer/src/lib/payload-hash";

const EVENT = parseAbiItem(
  "event MemeTokenLaunched(address indexed creator, address indexed token, bytes32 indexed poolId, address feeHook, address positionRecipient, uint256 positionTokenId, uint16 totalSwapFeeBps, bytes32 launchHash)",
);
const ARGS = {
  creator: "0x1111111111111111111111111111111111111111",
  token: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"33".repeat(32)}`,
  feeHook: "0x4444444444444444444444444444444444444444",
  positionRecipient: "0x5555555555555555555555555555555555555555",
  positionTokenId: 42n,
  totalSwapFeeBps: 100n,
  launchHash: `0x${"66".repeat(32)}`,
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

function row(blockNumber: string, logIndex: number) {
  const blockHash = `0x${BigInt(blockNumber).toString(16).padStart(64, "0")}`;
  const transactionHash = `0x${BigInt(logIndex + 1).toString(16).padStart(64, "0")}`;
  return {
    id: `1:${blockHash}:${transactionHash}:${logIndex}`,
    downstreamLogicalId: null,
    receiptLogOrdinal: null,
    chainId: 1,
    blockNumber,
    blockHash,
    blockTimestamp: "1785480000",
    transactionHash,
    transactionIndex: 0,
    blockGlobalLogIndex: logIndex,
    sourceAddress: "0xd240d06f8586eb799f20056054e5b527405e6bad",
    contractName: "ClassicV2Launcher",
    eventName: "MemeTokenLaunched",
    model: "classic",
    releaseVersion: "classic-v2",
    topics: TOPICS,
    data: DATA,
    decodedPayload: canonicalPayloadJson(ARGS),
    payloadHash: PAYLOAD_HASH,
  };
}

describe("Envio frozen projector windows", () => {
  it("pins an inclusive upper block bound into the GraphQL request", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      expect(body.query).toContain("blockNumber: { _lte: $throughBlock }");
      expect(body.variables).toEqual({
        afterBlock: "25650000",
        afterLogIndex: 3,
        afterCandidateId: `1:0x${"11".repeat(32)}:0x${"22".repeat(32)}:3`,
        throughBlock: "25650100",
        first: 25,
      });
      return new Response(
        JSON.stringify({ data: { ChainEvent: [row("25650001", 4)] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const client = createEnvioClient({
      endpoint: "https://indexer.example/graphql",
      fetcher,
    });

    await expect(
      client.readCandidatesWindow({
        cursor: {
          blockNumber: "25650000",
          blockGlobalLogIndex: 3,
          candidateId: `1:0x${"11".repeat(32)}:0x${"22".repeat(32)}:3`,
        },
        throughBlock: "25650100",
      }),
    ).resolves.toHaveLength(1);
  });

  it("rejects an upstream row beyond the frozen upper bound", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { ChainEvent: [row("25650101", 4)] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createEnvioClient({
      endpoint: "https://indexer.example/graphql",
      fetcher,
    });

    await expect(
      client.readCandidatesWindow({
        cursor: {
          blockNumber: "25650000",
          blockGlobalLogIndex: -1,
          candidateId: "",
        },
        throughBlock: "25650100",
      }),
    ).rejects.toMatchObject({
      dependency: "envio",
      code: "validation_failed",
    });
  });

  it("rejects a window behind its cursor before making a request", async () => {
    const fetcher = vi.fn();
    const client = createEnvioClient({
      endpoint: "https://indexer.example/graphql",
      fetcher,
    });

    await expect(
      client.readCandidatesWindow({
        cursor: {
          blockNumber: "25650101",
          blockGlobalLogIndex: -1,
          candidateId: "",
        },
        throughBlock: "25650100",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves the full uint32 log-index range through numeric GraphQL scalars", async () => {
    const maximum = 4_294_967_295;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      expect(body.query).toContain("$afterLogIndex: numeric!");
      expect(body.variables.afterLogIndex).toBe("4294967294");
      const fixture = row("25650100", maximum);
      return new Response(
        JSON.stringify({
          data: {
            ChainEvent: [
              { ...fixture, blockGlobalLogIndex: "4294967295" },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const client = createEnvioClient({
      endpoint: "https://indexer.example/graphql",
      fetcher,
    });
    await expect(
      client.readCandidatesWindow({
        cursor: {
          blockNumber: "25650100",
          blockGlobalLogIndex: maximum - 1,
          candidateId:
            `1:0x${"11".repeat(32)}:0x${"22".repeat(32)}:${maximum - 1}`,
        },
        throughBlock: "25650100",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ blockGlobalLogIndex: maximum }),
    ]);
  });
});
