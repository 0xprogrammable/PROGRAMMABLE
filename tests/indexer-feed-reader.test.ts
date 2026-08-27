import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readIndexedFeedSnapshotWithModel } from "../app/api/indexers/v1/read-indexed-feed.server";
import type { PostgresTransaction } from "../lib/data-pipeline/postgres";

const NOW = Date.parse("2026-07-31T12:00:00.000Z");
const BASE_RELEASES = [
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
] as const;
const EXPANDED_RELEASES = [...BASE_RELEASES, "classic-v4"] as const;
type ReleaseVersion = (typeof EXPANDED_RELEASES)[number];
const BLOCK_HASH = `0x${"11".repeat(32)}`;
const BLOCK_HASH_BYTEA = `\\x${"11".repeat(32)}`;
const PUBLICATION = `0x${"22".repeat(32)}`;
const PARITY_EVIDENCE = `0x${"33".repeat(32)}`;
const PARITY_BINDING = `0x${"44".repeat(32)}`;

function uuid(index: number) {
  return `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function modelFor(release: ReleaseVersion) {
  return release.startsWith("classic-") ? "classic" : "stock-paired";
}

function releasePointer(
  release: ReleaseVersion,
  index: number,
) {
  return {
    routeKey: "explore-list",
    chainId: 1,
    releaseVersion: release,
    modelVersion: modelFor(release),
    sourceGroup: "core",
    projectorVersion: "projector-v1",
    epochId: uuid(index + 1),
    pointerGeneration: "1",
    checkpointId: uuid(index + 20),
    checkpointGeneration: "2",
    reorgGeneration: "0",
    checkpointBlockNumber: "100",
    checkpointBlockHash: BLOCK_HASH,
  };
}

function routeEvidence(
  release: ReleaseVersion,
  index: number,
) {
  return {
    releaseVersion: release,
    modelVersion: modelFor(release),
    parityRecordId: uuid(index + 40),
    reconciliationId: uuid(index + 50),
    parityEvidenceCommitment: PARITY_EVIDENCE,
    parityBindingId: uuid(index + 60),
    parityBindingCommitment: PARITY_BINDING,
    parityBoundAt: "2026-07-31T11:59:30.000Z",
  };
}

function tokenSource(release: ReleaseVersion = "classic-v2") {
  const index = EXPANDED_RELEASES.indexOf(release);
  return {
    ...releasePointer(release, index),
    snapshotCommitment: BLOCK_HASH,
    projectionRunId: uuid(70),
    publicationCommitment: PUBLICATION,
    promotedBlockNumber: "100",
    promotedBlockHash: BLOCK_HASH,
  };
}

function rawToken(release: ReleaseVersion = "classic-v2") {
  return {
    source: tokenSource(release),
    tokenAddress: "0x1111111111111111111111111111111111111111",
    hookAddress: "0x2222222222222222222222222222222222222222",
    poolId: `0x${"55".repeat(32)}`,
    creatorAddress: "0x4444444444444444444444444444444444444444",
    positionRecipient: "0x7777777777777777777777777777777777777777",
    positionTokenId: "42",
    rewardVaultAddress: null,
    launchHash: `0x${"66".repeat(32)}`,
    launchBlockNumber: "98",
    launchTransactionHash: `0x${"77".repeat(32)}`,
    launchTransactionIndex: 3,
    launchLogIndex: 4,
    launchedAt: "2026-07-31T11:55:00.000Z",
    name: "Test",
    symbol: "TEST",
    decimals: 18,
    totalSupplyRaw: "1000000000000000000000000000",
    metadata: {
      revision: "1",
      createdAt: "2026-07-31T11:55:00.000Z",
      description: "This is a test",
      imageUrl: "https://programmable.family/test.png",
      links: [
        { kind: "website", url: "https://programmable.family/" },
        { kind: "x", url: "https://x.com/0xProgrammable" },
      ],
      extraData: "0x",
    },
    liquidity: {
      tokenLiquidityAmountRaw: "999999999999999999999999999",
      lockedTokenDustRaw: "1",
      currentTick: -10,
      initialTick: 0,
      tickLower: -887200,
      tickUpper: 887200,
      activeLiquidity: "999999999999999999999999",
    },
    fees: {
      totalSwapFeeBps: 100,
      buySwapFeeBps: 100,
      sellSwapFeeBps: 100,
      buyCreatorFeeBps: 90,
      sellCreatorFeeBps: 90,
      launcherFeeBps: 10,
      transferTaxBps: 0,
      lpFeePips: 0,
      protocolFeePips: 0,
    },
    market: {},
    quote: null,
    initialBuy: null,
    uniswapV4Pool: null,
  };
}

function feedRow(input: Readonly<{
  releases?: readonly ReleaseVersion[];
  tokenRelease?: ReleaseVersion;
}> = {}) {
  const releases = input.releases ?? BASE_RELEASES;
  const tokenRelease = input.tokenRelease ?? "classic-v2";
  if (!releases.includes(tokenRelease)) {
    throw new Error("Test token release must be present in the feed scope");
  }
  const pointers = releases.map(releasePointer);
  const evidence = releases.map(routeEvidence);
  const token = rawToken(tokenRelease);
  const parity = evidence[releases.indexOf(tokenRelease)]!;
  const source = {
    tokenAddress: token.tokenAddress,
    source: token.source,
    parity,
  };
  const snapshot = {
    adapterVersion: "indexed-route-adapters-v2",
    snapshotCommitment: BLOCK_HASH,
    chainId: 1,
    blockNumber: "100",
    blockHash: BLOCK_HASH,
    confirmations: 12,
    capturedAt: "2026-07-31T11:59:00.000Z",
    releasePointers: pointers,
    safeBlockNumber: "102",
    reconciledAt: "2026-07-31T11:59:30.000Z",
    ethUsdQuote: {
      feedAddress: "0x5555555555555555555555555555555555555555",
      roundId: "42",
      answer: "350000000000",
      decimals: 8,
      updatedAt: "2026-07-31T11:58:50.000Z",
    },
  };
  const tokens = [token];
  const recordSources = [source];
  return {
    http_status: 200,
    payload_complete: true,
    record_count: "1",
    record_scopes: [
      { model: modelFor(tokenRelease), releaseVersion: tokenRelease },
    ],
    comparison_checkpoint_block_number: "100",
    comparison_checkpoint_block_hash: BLOCK_HASH_BYTEA,
    route_evidence: evidence,
    snapshot,
    tokens,
    record_sources: recordSources,
    captured_at: "2026-07-31T11:59:00.000Z",
    reconciled_at: "2026-07-31T11:59:30.000Z",
    snapshot_commitment: BLOCK_HASH_BYTEA,
    payload: {
      status: "ready",
      snapshot,
      data: { tokens, recordSources },
    },
  };
}

function readModel(rows: readonly Record<string, unknown>[] = [feedRow()]) {
  const queryMock = vi.fn(async () => rows);
  const transaction: PostgresTransaction = {
    async query<Row extends Record<string, unknown>>() {
      return (await queryMock()) as readonly Row[];
    },
  };
  const repeatableReadSnapshot = vi.fn();
  return {
    model: {
      async repeatableReadSnapshot<T>(
        work: (value: PostgresTransaction) => Promise<T>,
      ): Promise<T> {
        repeatableReadSnapshot();
        return work(transaction);
      },
    },
    queryMock,
    repeatableReadSnapshot,
  };
}

describe("indexed GMGN feed reader", () => {
  it("keeps the frozen Base-5 PG feed ready independently of Envio catalog promotion", async () => {
    const fixture = readModel();

    const result = await readIndexedFeedSnapshotWithModel(fixture.model, NOW);

    expect(fixture.repeatableReadSnapshot).toHaveBeenCalledTimes(1);
    expect(fixture.queryMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      chainId: 1,
      capturedAt: "2026-07-31T11:59:00.000Z",
      reconciledAt: "2026-07-31T11:59:30.000Z",
      projectionLag: 2,
      releaseVersions: BASE_RELEASES,
      snapshotCommitment: BLOCK_HASH,
      model: {
        status: "ready",
        snapshot: {
          blockNumber: "100",
          blockHash: BLOCK_HASH,
          ethUsdQuote: {
            answer: "350000000000",
            decimals: 8,
            roundId: "42",
          },
        },
        tokens: [
          {
            tokenAddress: "0x1111111111111111111111111111111111111111",
            launchModel: "classic",
          },
        ],
      },
    });
    expect(result.sourceCommitment).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("admits Classic V4 only with the explicit expanded readiness scope", async () => {
    const row = feedRow({
      releases: EXPANDED_RELEASES,
      tokenRelease: "classic-v4",
    });

    const result = await readIndexedFeedSnapshotWithModel(
      readModel([row]).model,
      NOW,
      { includeClassicV4: true },
    );

    expect(result.releaseVersions).toEqual(EXPANDED_RELEASES);
    expect(result.model.tokens[0]).toMatchObject({
      launchModel: "classic",
      launchModelVersion: "classic-v4",
    });
  });

  it("fails closed when the V4 catalog gate and PG readiness scope disagree", async () => {
    await expect(readIndexedFeedSnapshotWithModel(
      readModel([feedRow()]).model,
      NOW,
      { includeClassicV4: true },
    )).rejects.toThrow("Indexed feed is not ready");

    await expect(readIndexedFeedSnapshotWithModel(
      readModel([feedRow({
        releases: EXPANDED_RELEASES,
        tokenRelease: "classic-v4",
      })]).model,
      NOW,
    )).rejects.toThrow("Indexed feed is not ready");
  });

  it("retains canonical market fields needed for full-corpus sorting", async () => {
    const row = feedRow();
    row.tokens[0]!.market = {
      tokenPriceNativeWei: "2000000000000000",
      marketCapNativeWei: "2000000000000000000",
      indexedMarketCapNativeWei: "2100000000000000000",
      indexedMarketCapUsdWad: "7350000000000000000000",
      indexedValuationBlockNumber: "100",
      fdvUsdWad: "7350000000000000000000",
      grossVolumeNativeWei: "3000000000000000000",
      creatorFeesGeneratedNativeWei: "30000000000000000",
      launcherFeesGeneratedNativeWei: "3000000000000000",
      creatorFeesAccruedNativeWei: "20000000000000000",
      swapCount: 9,
    };
    row.payload.data.tokens = row.tokens;

    const result = await readIndexedFeedSnapshotWithModel(
      readModel([row]).model,
      NOW,
    );

    expect(result.model.tokens[0]).toMatchObject({
      tokenPriceEth: "0.002",
      tokenPriceEthWei: "2000000000000000",
      marketCapEth: "2",
      marketCapEthWei: "2000000000000000000",
      indexedMarketCapEth: "2.1",
      indexedMarketCapEthWei: "2100000000000000000",
      indexedMarketCapUsdWad: "7350000000000000000000",
      indexedValuationBlockNumber: "100",
      grossVolumeEth: "3",
      grossVolumeWei: "3000000000000000000",
      swapCount: 9,
    });
  });

  it("rejects a full-feed market valuation beyond its checkpoint", async () => {
    const row = feedRow();
    row.tokens[0]!.market = {
      indexedValuationBlockNumber: "101",
    };
    row.payload.data.tokens = row.tokens;

    await expect(
      readIndexedFeedSnapshotWithModel(readModel([row]).model, NOW),
    ).rejects.toThrow("Indexed feed is not ready");
  });

  it("fails closed when the aggregate function returns no row", async () => {
    await expect(
      readIndexedFeedSnapshotWithModel(readModel([]).model, NOW),
    ).rejects.toThrow("Indexed feed is not ready");
  });

  it("fails closed on a stale snapshot", async () => {
    const row = feedRow();
    row.snapshot.capturedAt = "2026-07-31T11:40:00.000Z";
    row.captured_at = row.snapshot.capturedAt;
    row.payload.snapshot = row.snapshot;

    await expect(
      readIndexedFeedSnapshotWithModel(readModel([row]).model, NOW),
    ).rejects.toThrow("Indexed feed is not ready");
  });

  it("fails closed on incomplete materialization", async () => {
    const row = feedRow();
    row.payload_complete = false;

    await expect(
      readIndexedFeedSnapshotWithModel(readModel([row]).model, NOW),
    ).rejects.toThrow("Indexed feed is not ready");
  });

  it("fails closed on a reorg checkpoint mismatch", async () => {
    const row = feedRow();
    row.comparison_checkpoint_block_hash = `\\x${"99".repeat(32)}`;

    await expect(
      readIndexedFeedSnapshotWithModel(readModel([row]).model, NOW),
    ).rejects.toThrow("Indexed feed is not ready");
  });

  it("fails closed on feed-count drift", async () => {
    const row = feedRow();
    row.record_count = "2";

    await expect(
      readIndexedFeedSnapshotWithModel(readModel([row]).model, NOW),
    ).rejects.toThrow("Indexed feed is not ready");
  });

  it("fails closed when publication evidence is missing", async () => {
    const row = feedRow();
    delete (row.tokens[0]!.source as Record<string, unknown>)
      .publicationCommitment;
    row.record_sources[0]!.source = row.tokens[0]!.source;
    row.payload.data.tokens = row.tokens;
    row.payload.data.recordSources = row.record_sources;

    await expect(
      readIndexedFeedSnapshotWithModel(readModel([row]).model, NOW),
    ).rejects.toThrow("Indexed feed is not ready");
  });

  it("fails closed on duplicate token identities", async () => {
    const row = feedRow();
    row.tokens = [row.tokens[0]!, structuredClone(row.tokens[0]!)];
    row.record_sources = [
      row.record_sources[0]!,
      structuredClone(row.record_sources[0]!),
    ];
    row.record_count = "2";
    row.payload.data.tokens = row.tokens;
    row.payload.data.recordSources = row.record_sources;

    await expect(
      readIndexedFeedSnapshotWithModel(readModel([row]).model, NOW),
    ).rejects.toThrow("Indexed feed is not ready");
  });

  it("does not admit an unsupported Deep source", async () => {
    const row = feedRow();
    row.tokens[0]!.source.modelVersion = "deep";
    row.record_sources[0]!.source = row.tokens[0]!.source;
    row.payload.data.tokens = row.tokens;
    row.payload.data.recordSources = row.record_sources;

    await expect(
      readIndexedFeedSnapshotWithModel(readModel([row]).model, NOW),
    ).rejects.toThrow("Indexed feed is not ready");
  });
});
