import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getDataPipelineReleaseBinding } from
  "../lib/data-pipeline/release-binding.server";
import {
  createEnvioClassicV3CatalogReaderV1,
  ENVIO_CLASSIC_V3_TOKEN_METADATA_BATCH_SIZE,
  ENVIO_CLASSIC_V3_TOKEN_METADATA_CONCURRENCY,
  envioClassicV3IdentityCommitmentV1,
} from "../lib/market-data/envio-classic-v3-catalog.server";

const release = getDataPipelineReleaseBinding();
const ANCHOR_BLOCK = 25_770_000;
const EVENT_BLOCK = 25_639_700;
const STATE_BLOCK_HASH = `0x${"ee".repeat(32)}` as const;
const STATE_TRANSACTION_HASH = `0x${"ff".repeat(32)}` as const;
const PROGRAMMABLE_MAIN_ASSET_ADDRESS =
  "0x7987f03462200b3d8a072e02c89a8a41dcb124ee" as const;
const OFFICIAL_LAUNCH_HASH =
  "0xf62bfccb2c0e3832607d8e6c48c00b0411d1d9bf12337fd039c4821d25e8cd20" as const;
const OFFICIAL_OCCURRENCE =
  "1:0x17e7e16d94fdf07c3d06586080c68264a39756b326ecf9d55d5170542d8b733d:0x47668b99d392ba82fc82d2a38413bd679e6ec8a04e5cf9535bff2c558259732a:976" as const;

function hex32(value: number) {
  return `0x${value.toString(16).padStart(64, "0")}` as const;
}

function address(value: number) {
  return `0x${value.toString(16).padStart(40, "0")}` as const;
}

function progressPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      _meta: [{
        chainId: 1,
        progressBlock: ANCHOR_BLOCK,
        bufferBlock: ANCHOR_BLOCK,
        sourceBlock: ANCHOR_BLOCK + release.confirmations,
        isReady: true,
        eventsProcessed: 82_840,
        ...overrides,
      }],
      IndexerState_by_pk: {
        id: "ethereum-mainnet",
        schemaVersion: "1",
        deployment: release.envio.deploymentLabel,
        sourceCommit: release.envio.sourceCommit,
        configSha256: release.envio.configSha256,
        schemaSha256: release.envio.schemaSha256,
        handlerSha256: release.envio.handlerSha256,
        sourceRegistrySha256: release.envio.sourceRegistrySha256,
        eventSetSha256: release.envio.eventSetSha256,
        eventCount: release.envio.eventCount,
        chainId: 1,
        progressBlock: String(ANCHOR_BLOCK - 5),
        progressBlockHash: STATE_BLOCK_HASH,
        progressTimestamp: "1785480000",
        progressTransactionHash: STATE_TRANSACTION_HASH,
        progressOccurrenceId:
          `1:${STATE_BLOCK_HASH}:${STATE_TRANSACTION_HASH}:0`,
      },
    },
  };
}

function launchFixture(index: number, overrides: Record<string, unknown> = {}) {
  const classicV3Hook = release.sources.find(
    (source) => source.contractName === "ClassicV3Hook",
  )!.address;
  const launchHash = hex32(1_000 + index);
  const blockHash = hex32(10_000 + index);
  const transactionHash = hex32(20_000 + index);
  const occurrenceId = `1:${blockHash}:${transactionHash}:${index}`;
  return {
    id: `1:classic-v3:${launchHash}`,
    chainId: 1,
    model: "classic",
    releaseVersion: "classic-v3",
    launchHash,
    token: address(100 + index),
    creator: address(1_000 + index),
    quoteAsset: null,
    poolId: hex32(30_000 + index),
    hook: classicV3Hook,
    rewardVault: address(2_000 + index),
    positionRecipient: address(3_000 + index),
    positionTokenId: String(4_000 + index),
    totalSwapFeeBps: null,
    buySwapFeeBps: 100 + index,
    sellSwapFeeBps: 200 + index,
    rewardConfigurationHash: hex32(40_000 + index),
    quoteConfigurationHash: null,
    totalSupply: "1000000000000000000000000000",
    tokenLiquidityAmount: "900000000000000000000000000",
    lockedTokenDust: "1",
    initialTick: -100,
    tickLower: -200,
    tickUpper: 200,
    lpFeePips: 10_000,
    launchOccurrenceId: occurrenceId,
    liquidityOccurrenceId: `${occurrenceId}:liquidity`,
    initialBuyOccurrenceId: `${occurrenceId}:buy`,
    custodyOccurrenceId: `${occurrenceId}:custody`,
    coordinatorOccurrenceId: null,
    hasLaunchEvent: true,
    hasLiquidityEvent: true,
    hasInitialBuyEvent: true,
    hasCustodyEvent: true,
    hasCoordinatorEvent: false,
    hasPoolRegistrationEvent: true,
    hasPoolFeeDisclosureEvent: true,
    hasRewardVaultFactoryEvent: true,
    provenanceValid: true,
    isComplete: true,
    updatedBlock: String(ANCHOR_BLOCK),
    ...overrides,
  };
}

function eventFixture(launch: ReturnType<typeof launchFixture>) {
  const classicV3Launcher = release.sources.find(
    (source) => source.contractName === "ClassicV3Launcher",
  )!.address;
  const [, blockHash, transactionHash, logIndex] = String(
    launch.launchOccurrenceId,
  ).split(":");
  return {
    id: launch.launchOccurrenceId,
    downstreamLogicalId: null,
    receiptLogOrdinal: null,
    chainId: 1,
    blockNumber: String(EVENT_BLOCK),
    blockHash,
    blockTimestamp: "1785480000",
    transactionHash,
    transactionIndex: "1",
    blockGlobalLogIndex: logIndex,
    sourceAddress: classicV3Launcher,
    contractName: "ClassicV3Launcher",
    eventName: "MemeTokenLaunchedV2",
    model: "classic",
    releaseVersion: "classic-v3",
    decodedPayload: JSON.stringify({
      buySwapFeeBps: String(launch.buySwapFeeBps),
      deployer: launch.creator,
      feeHook: launch.hook,
      launchHash: launch.launchHash,
      poolId: launch.poolId,
      positionRecipient: launch.positionRecipient,
      positionTokenId: launch.positionTokenId,
      rewardConfigurationHash: launch.rewardConfigurationHash,
      rewardVault: launch.rewardVault,
      sellSwapFeeBps: String(launch.sellSwapFeeBps),
      token: launch.token,
    }),
    payloadHash: hex32(50_000 + Number(logIndex)),
  };
}

function officialLaunchFixture() {
  const hook = release.sources.find(
    (source) => source.contractName === "ClassicV2Hook",
  )!.address;
  return {
    id: `1:classic-v2:${OFFICIAL_LAUNCH_HASH}`,
    chainId: 1,
    model: "classic",
    releaseVersion: "classic-v2",
    launchHash: OFFICIAL_LAUNCH_HASH,
    token: PROGRAMMABLE_MAIN_ASSET_ADDRESS,
    creator: "0x2bb333d48dfaf1596d9036671d2e43168994249e",
    quoteAsset: null,
    poolId: "0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0",
    hook,
    rewardVault: null,
    positionRecipient: "0xe68da18043623c31a93426b084c0ad1ca494c566",
    positionTokenId: "352224",
    totalSwapFeeBps: 100,
    buySwapFeeBps: null,
    sellSwapFeeBps: null,
    rewardConfigurationHash: null,
    quoteConfigurationHash: null,
    totalSupply: "1000000000000000000000000000",
    tokenLiquidityAmount: "999999999999999999999987736",
    lockedTokenDust: "12264",
    initialTick: 204200,
    tickLower: -887200,
    tickUpper: 204200,
    lpFeePips: 0,
    launchOccurrenceId: OFFICIAL_OCCURRENCE,
    liquidityOccurrenceId: `${OFFICIAL_OCCURRENCE}:liquidity`,
    initialBuyOccurrenceId: `${OFFICIAL_OCCURRENCE}:buy`,
    custodyOccurrenceId: null,
    coordinatorOccurrenceId: null,
    hasLaunchEvent: true,
    hasLiquidityEvent: true,
    hasInitialBuyEvent: true,
    hasCustodyEvent: false,
    hasCoordinatorEvent: false,
    hasPoolRegistrationEvent: true,
    hasPoolFeeDisclosureEvent: true,
    hasRewardVaultFactoryEvent: false,
    provenanceValid: true,
    isComplete: true,
    updatedBlock: "25627056",
  };
}

function officialEventFixture() {
  const launch = officialLaunchFixture();
  const launcher = release.sources.find(
    (source) => source.contractName === "ClassicV2Launcher",
  )!.address;
  const [, blockHash, transactionHash, logIndex] = OFFICIAL_OCCURRENCE.split(":");
  return {
    id: OFFICIAL_OCCURRENCE,
    downstreamLogicalId: null,
    receiptLogOrdinal: null,
    chainId: 1,
    blockNumber: "25627056",
    blockHash,
    blockTimestamp: "1785190343",
    transactionHash,
    transactionIndex: "279",
    blockGlobalLogIndex: logIndex,
    sourceAddress: launcher,
    contractName: "ClassicV2Launcher",
    eventName: "MemeTokenLaunched",
    model: "classic",
    releaseVersion: "classic-v2",
    decodedPayload: JSON.stringify({
      creator: launch.creator,
      feeHook: launch.hook,
      launchHash: launch.launchHash,
      poolId: launch.poolId,
      positionRecipient: launch.positionRecipient,
      positionTokenId: launch.positionTokenId,
      token: launch.token,
      totalSwapFeeBps: String(launch.totalSwapFeeBps),
    }),
    payloadHash: hex32(70_000),
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function harness(input: {
  launches?: ReturnType<typeof launchFixture>[];
  mutateEvents?: (
    events: ReturnType<typeof eventFixture>[],
  ) => ReturnType<typeof eventFixture>[];
} = {}) {
  const launches = [...(input.launches ?? [launchFixture(1)])]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const requests: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    requests.push(request);
    if (request.query.includes("ProgrammableIndexerProgress")) {
      return json(progressPayload());
    }
    if (request.query.includes("ProgrammableClassicV3Catalog")) {
      const afterId = String(request.variables.afterId);
      const first = Number(request.variables.first);
      return json({
        data: { Launch: launches.filter((row) => row.id > afterId).slice(0, first) },
      });
    }
    if (request.query.includes("ProgrammableClassicV3LaunchEvents")) {
      const ids = request.variables.ids as string[];
      let events = launches.filter((row) => ids.includes(String(row.launchOccurrenceId)))
        .map(eventFixture);
      events = input.mutateEvents?.(events) ?? events;
      return json({ data: { ChainEvent: events } });
    }
    if (request.query.includes("ProgrammableOfficialMainToken")) {
      return json({
        data: {
          OfficialLaunch: [officialLaunchFixture()],
          OfficialEvent: [officialEventFixture()],
        },
      });
    }
    throw new Error("Unexpected Envio query");
  });
  const readRpcSnapshot = vi.fn(async ({
    anchorBlock,
    tokens,
  }: {
    anchorBlock: string;
    tokens: readonly `0x${string}`[];
  }) => ({
    headBlock: String(ANCHOR_BLOCK + release.confirmations),
    anchorBlockHash: hex32(60_000),
    anchorBlockTimestamp: "1785480010",
    metadata: new Map(tokens.map((token, index) => [token.toLowerCase(), {
      tokenAddress: token,
      name: `Token ${index + 1}`,
      symbol: `T${index + 1}`,
      decimals: 18,
      ...(token.toLowerCase() === PROGRAMMABLE_MAIN_ASSET_ADDRESS
        ? {
            description: "The official Programmable token",
            imageUrl: "https://assets.example/programmble.webp",
            links: [
              { kind: "website" as const, url: "https://programmable.family/" },
              { kind: "x" as const, url: "https://x.com/programmable" },
            ],
          }
        : {}),
    }])),
    observedAnchorBlock: anchorBlock,
  }));
  return { fetcher, launches, readRpcSnapshot, requests };
}

describe("Envio Classic V3 public catalog", () => {
  it("bounds RPC metadata work to 96 calls and two concurrent batches", () => {
    expect(ENVIO_CLASSIC_V3_TOKEN_METADATA_BATCH_SIZE).toBe(24);
    expect(ENVIO_CLASSIC_V3_TOKEN_METADATA_CONCURRENCY).toBe(2);
  });

  it("paginates, exactly binds occurrences, and exposes only Classic V3 scope", async () => {
    const test = harness({
      launches: Array.from({ length: 65 }, (_, index) => launchFixture(index + 1)),
    });
    const read = createEnvioClassicV3CatalogReaderV1(test);

    const catalog = await read({ deadlineMs: Date.now() + 5_000 });

    expect(catalog).toMatchObject({
      source: "envio-classic-v3",
      status: "current",
      asOfBlock: String(ANCHOR_BLOCK),
      completeness: { classic: "current", stock: "excluded", custom: "unavailable" },
      scope: {
        included: [
          "classic-v3",
          "official-main-token",
          "registry.custom-launched",
        ],
        excluded: [
          "classic-v1",
          "classic-v2",
          "stock-paired-v1",
          "stock-paired-v2",
          "stock-paired-v3",
        ],
        publicCategories: ["classic", "custom"],
      },
      evidence: {
        kind: "envio-indexer-state",
        deployment: release.envio.deploymentLabel,
        sourceCommit: release.envio.sourceCommit,
        progressBlock: String(ANCHOR_BLOCK),
      },
    });
    expect(catalog.entries).toHaveLength(66);
    const classicV3Entries = catalog.entries.filter((entry) =>
      entry.exploreKind === "token" &&
      entry.launchModelVersion === "classic-v3"
    );
    expect(classicV3Entries).toHaveLength(65);
    expect(classicV3Entries.every((entry) =>
      entry.exploreKind === "token" &&
      entry.launchModel === "classic" &&
      entry.launchModelVersion === "classic-v3" &&
      entry.totalSwapFeeBps === Math.max(
        entry.buyHookFeeBps ?? 0,
        entry.sellHookFeeBps ?? 0,
      )
    )).toBe(true);
    expect(catalog.entries.find((entry) =>
      entry.exploreKind === "token" &&
      entry.tokenAddress.toLowerCase() === PROGRAMMABLE_MAIN_ASSET_ADDRESS
    )).toMatchObject({
      launchModel: "classic",
      launchModelVersion: "classic-v2",
      totalSwapFeeBps: 100,
      description: "The official Programmable token",
      imageUrl: "https://assets.example/programmble.webp",
      links: [
        { kind: "website", url: "https://programmable.family/" },
        { kind: "x", url: "https://x.com/programmable" },
      ],
    });
    expect(catalog.entries.filter((entry) =>
      entry.exploreKind === "token" &&
      entry.launchModelVersion === "classic-v2"
    )).toHaveLength(1);
    expect(test.requests.filter((request) =>
      request.query.includes("ProgrammableClassicV3Catalog")
    )).toHaveLength(2);
    expect(test.readRpcSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      anchorBlock: String(ANCHOR_BLOCK),
    }));
    const identityCommitment = envioClassicV3IdentityCommitmentV1(
      catalog,
      catalog.entries,
    );
    expect(envioClassicV3IdentityCommitmentV1({
      ...catalog,
      generatedAt: "2026-08-16T12:00:12.000Z",
      asOfBlock: String(ANCHOR_BLOCK + 12),
      asOfBlockHash: hex32(60_012),
      evidence: {
        ...catalog.evidence,
        progressBlock: String(ANCHOR_BLOCK + 12),
        commitment: `sha256:${"ab".repeat(32)}`,
      },
    }, catalog.entries)).toBe(identityCommitment);
    expect(envioClassicV3IdentityCommitmentV1(
      catalog,
      catalog.entries.slice(1),
    )).not.toBe(identityCommitment);
  });

  it("fails closed for an empty catalog, family drift, and payload mismatch", async () => {
    const empty = harness({ launches: [] });
    await expect(createEnvioClassicV3CatalogReaderV1(empty)({
      deadlineMs: Date.now() + 5_000,
    })).rejects.toThrow(/catalog is empty/u);

    const legacy = harness({
      launches: [launchFixture(1, { releaseVersion: "classic-v2" })],
    });
    await expect(createEnvioClassicV3CatalogReaderV1(legacy)({
      deadlineMs: Date.now() + 5_000,
    })).rejects.toThrow(/failed release validation/u);

    const mismatched = harness({
      mutateEvents: (events) => events.map((event) => ({
        ...event,
        decodedPayload: JSON.stringify({
          ...JSON.parse(event.decodedPayload),
          token: address(9_999),
        }),
      })),
    });
    await expect(createEnvioClassicV3CatalogReaderV1(mismatched)({
      deadlineMs: Date.now() + 5_000,
    })).rejects.toThrow(/payload binding failed/u);
  });

  it("rejects duplicate token identities and incomplete occurrence coverage", async () => {
    const duplicate = harness({
      launches: [
        launchFixture(1),
        launchFixture(2, { token: launchFixture(1).token }),
      ],
    });
    await expect(createEnvioClassicV3CatalogReaderV1(duplicate)({
      deadlineMs: Date.now() + 5_000,
    })).rejects.toThrow(/duplicate identities/u);

    const missingEvent = harness({ mutateEvents: () => [] });
    await expect(createEnvioClassicV3CatalogReaderV1(missingEvent)({
      deadlineMs: Date.now() + 5_000,
    })).rejects.toThrow(/occurrence coverage is incomplete/u);
  });

  it("singleflights refreshes and retains only a complete validated Envio snapshot", async () => {
    let now = Date.now();
    let fail = false;
    const test = harness();
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (fail) return json({ error: "offline" }, 503);
      return await test.fetcher(url, init);
    });
    const read = createEnvioClassicV3CatalogReaderV1({
      fetcher,
      readRpcSnapshot: test.readRpcSnapshot,
      now: () => now,
    });

    const [first, concurrent] = await Promise.all([
      read({ deadlineMs: now + 5_000 }),
      read({ deadlineMs: now + 5_000 }),
    ]);
    expect(first).toBe(concurrent);
    expect(test.readRpcSnapshot).toHaveBeenCalledTimes(1);

    now += 20_000;
    fail = true;
    const retained = await read({ deadlineMs: now + 5_000 });
    expect(retained).toMatchObject({
      source: "envio-classic-v3",
      status: "last-known-good",
      completeness: { classic: "last-known-good", stock: "excluded" },
    });
    expect(retained.entries).toEqual(first.entries);
  });
});
