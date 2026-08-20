import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getDataPipelineReleaseBinding } from
  "../lib/data-pipeline/release-binding.server";
import { createEnvioClassicV2CreatorClaimReaderV1 } from
  "../lib/market-data/envio-classic-v2-creator-claims.server";

const release = getDataPipelineReleaseBinding();
const creator = "0x2Bb333d48DFAF1596D9036671d2E43168994249E" as const;
const poolId =
  "0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0" as const;
const hook = release.sources.find(
  (source) => source.contractName === "ClassicV2Hook",
)!.address;

function hex32(value: number) {
  return `0x${value.toString(16).padStart(64, "0")}` as const;
}

function claimFixture(index: number, overrides: Record<string, unknown> = {}) {
  const blockHash = hex32(10_000 + index);
  const transactionHash = hex32(20_000 + index);
  const blockLogIndex = 1_000 + index;
  return {
    id: `1:${blockHash}:${transactionHash}:${blockLogIndex}`,
    receiptLogOrdinal: null,
    chainId: 1,
    blockNumber: String(25_624_200 + index),
    blockHash,
    blockTimestamp: String(1_787_250_000 + index),
    transactionHash,
    transactionIndex: String(200 + index),
    blockGlobalLogIndex: String(blockLogIndex),
    sourceAddress: hook,
    model: "classic",
    releaseVersion: "classic-v2",
    poolId,
    creator: creator.toLowerCase(),
    rewardVault: null,
    recipient: creator.toLowerCase(),
    quoteAsset: null,
    caller: creator.toLowerCase(),
    amount: String(1_000_000 + index),
    ...overrides,
  };
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Envio Classic V2 creator claim history", () => {
  it("paginates and binds exact creator, hook, pool, family and occurrence", async () => {
    const rows = Array.from({ length: 65 }, (_, index) => claimFixture(index));
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        variables: Record<string, unknown>;
      };
      requests.push(request.variables);
      const afterId = String(request.variables.afterId);
      const first = Number(request.variables.first);
      return json({
        data: {
          CreatorFeeClaim: rows
            .filter((row) => row.id > afterId)
            .slice(0, first),
        },
      });
    });
    const read = createEnvioClassicV2CreatorClaimReaderV1({ fetcher, release });

    const claims = await read({
      account: creator,
      poolIds: [poolId],
      throughBlock: "25799000",
      deadlineMs: Date.now() + 5_000,
    });

    expect(claims).toHaveLength(65);
    expect(claims[0]).toMatchObject({
      blockNumber: rows[64]!.blockNumber,
      poolId,
      creator,
      amountWei: rows[64]!.amount,
      logIndex: Number(rows[64]!.blockGlobalLogIndex),
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      afterId: "",
      creator: creator.toLowerCase(),
      hook,
      poolIds: [poolId],
      throughBlock: "25799000",
      first: 64,
    });
  });

  it("rejects a claim whose indexed source drifts from the release binding", async () => {
    const fetcher = vi.fn(async () => json({
      data: {
        CreatorFeeClaim: [claimFixture(1, {
          sourceAddress: "0x1111111111111111111111111111111111111111",
        })],
      },
    }));
    const read = createEnvioClassicV2CreatorClaimReaderV1({ fetcher, release });

    await expect(read({
      account: creator,
      poolIds: [poolId],
      throughBlock: "25799000",
    })).rejects.toThrow("identity drifted");
  });

  it("rejects duplicate pool bindings before transport", async () => {
    const fetcher = vi.fn();
    const read = createEnvioClassicV2CreatorClaimReaderV1({ fetcher, release });

    await expect(read({
      account: creator,
      poolIds: [poolId, poolId],
      throughBlock: "25799000",
    })).rejects.toThrow("request is invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
