import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const values = vi.hoisted(() => {
  const headHash = `0x${"11".repeat(32)}` as const;
  const parentHash = `0x${"aa".repeat(32)}` as const;
  const poolId = `0x${"22".repeat(32)}` as const;
  const tokenAddress = "0x3333333333333333333333333333333333333333" as const;
  const evidenceCommitment = `0x${"44".repeat(32)}` as const;
  const row = {
    kind: "market" as const,
    evidenceCommitment,
    evidence: {
      blockHash: headHash,
    },
    poolId,
    tokenAddress,
  };
  return { headHash, parentHash, poolId, tokenAddress, evidenceCommitment, row };
});

vi.mock("../../lib/data-pipeline/optimistic-live-runtime.server", () => ({
  readConfiguredOptimisticLiveSnapshot: vi.fn(async () => ({
    head: {
      blockNumber: "101",
      blockHash: values.headHash,
      providerHeads: ["101", "101"],
      reorgGeneration: "7",
      observedAt: "2026-08-02T10:00:00.000Z",
      canonicalAt: "2026-08-02T10:00:00.000Z",
    },
    blocks: [{
      blockNumber: "101",
      blockHash: values.headHash,
      parentHash: values.parentHash,
      reorgGeneration: "7",
    }],
    events: [],
    marketStates: [{
      blockHash: values.headHash,
      poolId: values.poolId,
      providerHeads: ["102", "102"],
      optimisticMarketStateId: "20000000-0000-4000-8000-000000000001",
    }],
  })),
  optimisticOverlayRowsFromSnapshot: vi.fn(() => [values.row]),
}));

import { CONFIGURED_OPTIMISTIC_PUBLIC_API_READER } from
  "../../lib/data-pipeline/optimistic-public-api-reader.server";

describe("configured optimistic public API reader", () => {
  it("preserves the ancestry path and per-market provider heads", async () => {
    const source = await CONFIGURED_OPTIMISTIC_PUBLIC_API_READER.read(1);
    const snapshot = source?.materialize({
      canonicalTokens: [{
        poolId: values.poolId,
        launchModel: "classic",
      }] as never,
    });

    expect(snapshot?.blocks).toEqual([{
      blockNumber: "101",
      blockHash: values.headHash,
      parentHash: values.parentHash,
      reorgGeneration: "7",
    }]);
    expect(snapshot?.rows).toEqual([{
      reorgGeneration: "7",
      providerHeads: ["102", "102"],
      releaseVersion: "classic-v2",
      optimisticMarketStateId: "20000000-0000-4000-8000-000000000001",
      row: values.row,
    }]);
  });
});
