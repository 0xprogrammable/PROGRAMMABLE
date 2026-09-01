import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  gmgnChartWindowV1,
  parseGmgnChartIdentityProofForCanonicalSetV1,
  parseGmgnChartIdentityProofV1,
  parseGmgnKlineMarketChartV1,
  readGmgnMarketChartV1,
} from "../lib/market-data/gmgn-chart.server";
import {
  isGmgnMarketChartV1,
  preferAdmittedGmgnTokenSeriesV1,
  type GmgnChartIdentityProofV1,
  type GmgnMarketChartV1,
} from "../lib/market-data/gmgn-chart-data-v1";
import type { GmgnAccountGateV1 } from
  "../lib/market-data/gmgn-account-gate.server";
import type {
  MarketChartIdentityV1,
  MarketChartV1,
} from "../lib/market-data/market-data-v1";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const QUOTE = "0x0000000000000000000000000000000000000000" as const;
const PROVIDER_POOL =
  "0x4444444444444444444444444444444444444444" as const;
const OTHER_PROVIDER_POOL =
  "0x5555555555555555555555555555555555555555" as const;

function token(index: number): Extract<ExploreEntry, { exploreKind: "token" }> {
  const tokenAddress = `0x${index.toString(16).padStart(40, "0")}` as const;
  const value = {
    id: `1:${tokenAddress}`,
    name: "SHARD",
    symbol: "SHARD",
    tokenAddress,
    hookAddress: "0x3333333333333333333333333333333333333333",
    poolId: `0x${index.toString(16).padStart(64, "0")}` as const,
    launchedAt: "2026-08-31T00:00:00.000Z",
    totalSupplyRaw: "10000000000000000000000",
    tokenDecimals: 18,
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    launchModel: "classic",
  } satisfies LauncherToken;
  return {
    ...value,
    exploreKind: "token",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: value.id,
      modelId: "classic",
      modelVersion: null,
    },
  };
}

function identity(entry: ReturnType<typeof token>): MarketChartIdentityV1 {
  return {
    chainId: "1",
    protocol: "uniswap_v4",
    tokenAddress: entry.tokenAddress,
    poolId: entry.poolId,
    quoteAddress: QUOTE,
  };
}

function customEntry(): Extract<ExploreEntry, { exploreKind: "custom-project" }> {
  const tokenAddress = "0x7777777777777777777777777777777777777777";
  const quoteTwo = "0x8888888888888888888888888888888888888888";
  return {
    exploreKind: "custom-project",
    id: `custom:sha256:${"77".repeat(32)}`,
    name: "Registry Custom",
    links: [],
    launchedAt: "2026-08-31T00:00:00.000Z",
    finalizedAt: "2026-08-31T00:01:00.000Z",
    chainId: "1",
    modelId: "custom-v4",
    customProjectId: `sha256:${"77".repeat(32)}`,
    customLaunchId: `sha256:${"78".repeat(32)}`,
    launchingWallet: {
      namespace: "eip155:1",
      value: "0x9999999999999999999999999999999999999999",
    },
    postLaunchAuthorityInventory: {} as never,
    postLaunchAuthorityInventoryHash: `sha256:${"79".repeat(32)}`,
    tokenAddress,
    tokenDecimals: 18,
    totalSupplyRaw: "10000000000000000000000",
    markets: [
      {
        marketId: "z-market",
        kind: "uniswap-v4",
        status: "active",
        poolId: `0x${"99".repeat(32)}`,
        baseAsset: {
          assetId: "token",
          identity: { namespace: "eip155:1:erc20", value: tokenAddress },
        },
        quoteAsset: {
          assetId: "quote-two",
          identity: { namespace: "eip155:1:erc20", value: quoteTwo },
        },
      },
      {
        marketId: "a-market",
        kind: "uniswap-v4",
        status: "active",
        poolId: `0x${"88".repeat(32)}`,
        baseAsset: {
          assetId: "token",
          identity: { namespace: "eip155:1:erc20", value: tokenAddress },
        },
        quoteAsset: {
          assetId: "eth",
          identity: { namespace: "eip155:1", value: QUOTE },
        },
      },
    ],
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "custom",
      source: "registry.custom-launched",
      projectId: `sha256:${"77".repeat(32)}`,
      launchId: `sha256:${"78".repeat(32)}`,
      sourceRecordBindingHash: `sha256:${"7a".repeat(32)}`,
      finalizedLaunchBindingHash: `sha256:${"7b".repeat(32)}`,
      registryAddress: "0x9999999999999999999999999999999999999999",
      registryStartBlock: "1",
      transactionHash: `0x${"7c".repeat(32)}`,
      blockHash: `0x${"7d".repeat(32)}`,
      blockNumber: "1",
      transactionIndex: 0,
      logIndex: 0,
      configurationHash: `0x${"7e".repeat(32)}`,
    },
  };
}

function customIdentities(
  entry = customEntry(),
): readonly MarketChartIdentityV1[] {
  return [
    {
      chainId: "1",
      protocol: "uniswap_v4",
      tokenAddress: entry.tokenAddress!,
      poolId: entry.markets[1]!.poolId!,
      quoteAddress: QUOTE,
    },
    {
      chainId: "1",
      protocol: "uniswap_v4",
      tokenAddress: entry.tokenAddress!,
      poolId: entry.markets[0]!.poolId!,
      quoteAddress: entry.markets[0]!.quoteAsset.identity.value as `0x${string}`,
    },
  ];
}

function tokenInfo(entry: ReturnType<typeof token>) {
  return {
    chain: "eth",
    address: entry.tokenAddress,
    total_supply: "10000",
    biggest_pool_address: PROVIDER_POOL as string,
    pool: {
      pool_address: PROVIDER_POOL as string,
      quote_address: QUOTE,
      exchange: "uniswap_v4",
      base_address: entry.tokenAddress,
      token_address: entry.tokenAddress,
      token0_address: QUOTE,
      token1_address: entry.tokenAddress,
    },
  };
}

function candle(time: number, overrides: Record<string, unknown> = {}) {
  return {
    time,
    open: "1.00",
    high: "1.25",
    low: "0.90",
    close: "1.20",
    volume: "10.5",
    amount: "8.75",
    source: "provider data only",
    ...overrides,
  };
}

function proof(entry: ReturnType<typeof token>): GmgnChartIdentityProofV1 {
  const parsed = parseGmgnChartIdentityProofV1(
    tokenInfo(entry),
    identity(entry),
    canonicalSupply(entry),
    new Date(NOW.getTime() - 1_000),
  );
  if (parsed === null) throw new Error("test proof is invalid");
  return parsed;
}

function canonicalSupply(entry: ReturnType<typeof token>) {
  if (
    typeof entry.totalSupplyRaw !== "string" ||
    typeof entry.tokenDecimals !== "number"
  ) throw new Error("test token must have a canonical supply");
  return {
    raw: BigInt(entry.totalSupplyRaw),
    decimals: entry.tokenDecimals,
  };
}

function providerFetch(entry: ReturnType<typeof token>, list: unknown[]) {
  return vi.fn(async (
    input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    void _init;
    const url = new URL(String(input));
    const data = url.pathname === "/v1/token/info"
      ? tokenInfo(entry)
      : { list };
    return new Response(JSON.stringify({ code: 0, data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function bitqueryChart(
  expectedIdentity: MarketChartIdentityV1,
  status: "ready" | "partial" = "ready",
): MarketChartV1 {
  const firstStart = new Date(NOW.getTime() - 120_000).toISOString();
  const firstEnd = new Date(NOW.getTime() - 60_000).toISOString();
  const secondStart = firstEnd;
  const secondEnd = NOW.toISOString();
  return {
    schemaVersion: "programmable.market-chart.v1",
    source: "bitquery",
    readStatus: "live",
    status,
    generatedAt: NOW.toISOString(),
    identity: expectedIdentity,
    range: "1h",
    points: [
      {
        blockNumber: "1",
        time: firstEnd,
        bucketStart: firstStart,
        bucketEnd: firstEnd,
        observedAt: firstEnd,
        valueSemantics: "period-median",
        priceUsd: "1",
        tradeCount: 1,
      },
      {
        blockNumber: "2",
        time: secondEnd,
        bucketStart: secondStart,
        bucketEnd: secondEnd,
        observedAt: secondEnd,
        valueSemantics: "period-median",
        priceUsd: "2",
        tradeCount: 1,
      },
    ],
    swapCount: 2,
    valuation: { status: "unavailable", reason: "source-unavailable" },
    asOfTime: secondEnd,
    truncated: status === "partial",
  };
}

describe("GMGN admitted Ethereum token-address kline adapter", () => {
  beforeEach(() => {
    vi.stubEnv("GMGN_API_KEY", "");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("chooses bounded resolutions that stay within the observed 100-candle window", () => {
    expect(gmgnChartWindowV1("1h", "2026-08-01T00:00:00.000Z", NOW))
      .toMatchObject({ resolution: "1m" });
    expect(gmgnChartWindowV1("1d", "2026-08-01T00:00:00.000Z", NOW))
      .toMatchObject({ resolution: "15m" });
    expect(gmgnChartWindowV1("1w", "2026-08-01T00:00:00.000Z", NOW))
      .toMatchObject({ resolution: "4h" });
  });

  it("accepts the live token-info shape and binds every explicit pair field", () => {
    const entry = token(201);
    const documentedShape = tokenInfo(entry);
    expect(documentedShape.pool.pool_address).toHaveLength(42);
    expect(documentedShape.pool.pool_address).not.toBe(entry.poolId);
    expect(parseGmgnChartIdentityProofV1(
      documentedShape,
      identity(entry),
      canonicalSupply(entry),
      NOW,
    )).toEqual({
      schemaVersion: "programmable.gmgn-chart-identity-proof.v1",
      source: "gmgn-token-info",
      verifiedAt: NOW.toISOString(),
      identity: identity(entry),
      poolAttribution: "unavailable",
      canonicalSupply: {
        totalSupplyRaw: entry.totalSupplyRaw,
        tokenDecimals: entry.tokenDecimals,
      },
    });
  });

  it("accepts the documented minimal token-info shape when optional pair fields are omitted", () => {
    const entry = token(220);
    const value = tokenInfo(entry) as unknown as Record<string, unknown> & {
      pool: Record<string, unknown>;
    };
    delete value.pool.base_address;
    delete value.pool.token_address;
    delete value.pool.token0_address;
    delete value.pool.token1_address;
    expect(parseGmgnChartIdentityProofV1(
      value,
      identity(entry),
      canonicalSupply(entry),
      NOW,
    )).toMatchObject({ poolAttribution: "unavailable" });
  });

  it("accepts coherent canonical bytes32 v4 PoolId locators as exact current attribution", () => {
    const entry = token(219);
    const value = tokenInfo(entry);
    value.pool.pool_address = entry.poolId;
    value.biggest_pool_address = entry.poolId;
    const exactProof = parseGmgnChartIdentityProofV1(
      value,
      identity(entry),
      canonicalSupply(entry),
      NOW,
    );
    expect(exactProof).toMatchObject({
      identity: identity(entry),
      poolAttribution: "exact",
    });

    const from = new Date(NOW.getTime() - 120_000);
    const chart = parseGmgnKlineMarketChartV1({
      list: [candle(from.getTime()), candle(from.getTime() + 60_000)],
    }, {
      identityProof: exactProof!,
      range: "1h",
      resolution: "1m",
      requestedFrom: from,
      requestedTo: NOW,
      fetchedAt: NOW,
    });
    expect(chart).toMatchObject({
      seriesScope: "token",
      poolAttribution: "exact",
    });
    expect(isGmgnMarketChartV1(chart)).toBe(true);
  });

  it("binds multi-market token info only to a matching canonical identity", () => {
    const entry = customEntry();
    const identities = customIdentities(entry);
    const selected = identities[1]!;
    const value = {
      ...tokenInfo(token(221)),
      address: entry.tokenAddress,
      total_supply: "10000",
      pool: {
        ...tokenInfo(token(221)).pool,
        quote_address: selected.quoteAddress,
        base_address: entry.tokenAddress,
        token_address: entry.tokenAddress,
        token0_address: entry.tokenAddress,
        token1_address: selected.quoteAddress,
      },
    };

    const proof = parseGmgnChartIdentityProofForCanonicalSetV1(
      value,
      [...identities].reverse(),
      { raw: BigInt(entry.totalSupplyRaw!), decimals: entry.tokenDecimals! },
      NOW,
    );

    expect(proof).toMatchObject({
      identity: selected,
      poolAttribution: "unavailable",
    });
    expect(parseGmgnChartIdentityProofForCanonicalSetV1(
      {
        ...value,
        pool: {
          ...value.pool,
          quote_address: "0x6666666666666666666666666666666666666666",
        },
      },
      identities,
      { raw: BigInt(entry.totalSupplyRaw!), decimals: entry.tokenDecimals! },
      NOW,
    )).toBeNull();
  });

  it("requires a bytes32 locator to match the same canonical multi-market identity", () => {
    const entry = customEntry();
    const identities = customIdentities(entry);
    const selected = identities[1]!;
    const value = {
      ...tokenInfo(token(222)),
      address: entry.tokenAddress,
      total_supply: "10000",
      biggest_pool_address: identities[0]!.poolId,
      pool: {
        ...tokenInfo(token(222)).pool,
        pool_address: identities[0]!.poolId,
        quote_address: selected.quoteAddress,
        base_address: entry.tokenAddress,
        token_address: entry.tokenAddress,
        token0_address: entry.tokenAddress,
        token1_address: selected.quoteAddress,
      },
    };

    expect(parseGmgnChartIdentityProofForCanonicalSetV1(
      value,
      identities,
      { raw: BigInt(entry.totalSupplyRaw!), decimals: entry.tokenDecimals! },
      NOW,
    )).toBeNull();
  });

  it("rejects every documented identity mismatch despite plausible undocumented decoys", () => {
    const entry = token(201);
    const mismatches: Array<(value: ReturnType<typeof tokenInfo>) => void> = [
      (value) => {
        value.address = "0x9999999999999999999999999999999999999999";
      },
      (value) => {
        value.biggest_pool_address = OTHER_PROVIDER_POOL;
      },
      (value) => {
        value.pool.pool_address = OTHER_PROVIDER_POOL;
      },
      (value) => {
        Reflect.set(
          value.pool,
          "quote_address",
          "0x9999999999999999999999999999999999999999",
        );
      },
      (value) => {
        value.pool.exchange = "uniswap_v3";
      },
      (value) => {
        value.pool.base_address =
          "0x9999999999999999999999999999999999999999";
      },
      (value) => {
        Reflect.set(
          value.pool,
          "token0_address",
          "0x9999999999999999999999999999999999999999",
        );
      },
    ];
    for (const mutate of mismatches) {
      const mismatched = tokenInfo(entry);
      Object.assign(mismatched.pool, {
        base_address: entry.tokenAddress,
        token_address: entry.tokenAddress,
        token0_address: QUOTE,
        token1_address: entry.tokenAddress,
      });
      mutate(mismatched);
      expect(parseGmgnChartIdentityProofV1(
        mismatched,
        identity(entry),
        canonicalSupply(entry),
        NOW,
      )).toBeNull();
    }
  });

  it.each([
    [
      "zero provider pool",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
    ],
    ["inconsistent provider pools", PROVIDER_POOL, OTHER_PROVIDER_POOL],
    [
      "foreign bytes32 locators",
      `0x${"44".repeat(32)}`,
      `0x${"44".repeat(32)}`,
    ],
  ])("rejects %s", (_label, poolAddress, biggestPoolAddress) => {
    const entry = token(218);
    const value = tokenInfo(entry) as unknown as Record<string, unknown> & {
      pool: Record<string, unknown>;
    };
    value.pool.pool_address = poolAddress;
    value.biggest_pool_address = biggestPoolAddress;
    expect(parseGmgnChartIdentityProofV1(
      value,
      identity(entry),
      canonicalSupply(entry),
      NOW,
    )).toBeNull();
  });

  it("rejects a GMGN token-info proof with the wrong total supply", () => {
    const entry = token(213);
    const mismatched = tokenInfo(entry);
    mismatched.total_supply = "10001";
    expect(parseGmgnChartIdentityProofV1(
      mismatched,
      identity(entry),
      canonicalSupply(entry),
      NOW,
    )).toBeNull();
  });

  it("accepts only an omitted or exact Ethereum chain on outer and inner provider payloads", () => {
    const entry = token(214);
    expect(parseGmgnChartIdentityProofV1(
      { chain: "eth", data: tokenInfo(entry) },
      identity(entry),
      canonicalSupply(entry),
      NOW,
    )).not.toBeNull();
    expect(parseGmgnChartIdentityProofV1(
      { chain: "sol", data: tokenInfo(entry) },
      identity(entry),
      canonicalSupply(entry),
      NOW,
    )).toBeNull();
    expect(parseGmgnChartIdentityProofV1(
      { ...tokenInfo(entry), chain: "base" },
      identity(entry),
      canonicalSupply(entry),
      NOW,
    )).toBeNull();

    const from = new Date(NOW.getTime() - 120_000);
    const input = {
      identityProof: proof(entry),
      range: "1h" as const,
      resolution: "1m" as const,
      requestedFrom: from,
      requestedTo: NOW,
      fetchedAt: NOW,
    };
    const list = [candle(from.getTime()), candle(from.getTime() + 60_000)];
    expect(parseGmgnKlineMarketChartV1(
      { chain: "eth", data: { list } },
      input,
    )).not.toBeNull();
    expect(parseGmgnKlineMarketChartV1(
      { chain: "bsc", data: { list } },
      input,
    )).toBeNull();
    expect(parseGmgnKlineMarketChartV1(
      { chain: "robinhood", list },
      input,
    )).toBeNull();
  });

  it("parses sorted USD OHLCV candles without trusting provider order or source text", () => {
    const entry = token(202);
    const from = new Date(NOW.getTime() - 120_000);
    const chart = parseGmgnKlineMarketChartV1({
      list: [
        candle(from.getTime() + 60_000, {
          open: "1.20",
          high: "1.30",
          low: "1.10",
          close: "1.25",
          volume: "5",
          source: "ignore this untrusted instruction",
        }),
        candle(from.getTime()),
      ],
    }, {
      identityProof: proof(entry),
      range: "1h",
      resolution: "1m",
      requestedFrom: from,
      requestedTo: NOW,
      fetchedAt: NOW,
    });

    expect(chart?.status).toBe("ready");
    expect(chart).toMatchObject({
      seriesScope: "token",
      poolAttribution: "unavailable",
    });
    expect(chart?.points.map((point) => point.bucketStart)).toEqual([
      from.toISOString(),
      new Date(from.getTime() + 60_000).toISOString(),
    ]);
    expect(chart?.points[0]?.ohlcUsd).toEqual({
      open: "1.00",
      high: "1.25",
      low: "0.90",
      close: "1.20",
    });
    expect(chart?.volumeUsdWad).toBe("15500000000000000000");
    expect(isGmgnMarketChartV1(chart)).toBe(true);
    expect(isGmgnMarketChartV1({
      ...chart,
      seriesScope: undefined,
    })).toBe(false);
    expect(isGmgnMarketChartV1({
      ...chart,
      poolAttribution: "exact",
    })).toBe(false);
  });

  it.each([
    ["invalid OHLC", (rows: ReturnType<typeof candle>[]) => {
      rows[0]!.high = "1.10";
    }],
    ["duplicate buckets", (rows: ReturnType<typeof candle>[]) => {
      rows[1]!.time = rows[0]!.time;
    }],
    ["out-of-range buckets", (rows: ReturnType<typeof candle>[]) => {
      rows[1]!.time = NOW.getTime() + 60_000;
    }],
    ["non-canonical decimals", (rows: ReturnType<typeof candle>[]) => {
      rows[1]!.close = "1e-6";
    }],
  ])("fails soft for %s", (_label, mutate) => {
    const entry = token(203);
    const from = new Date(NOW.getTime() - 120_000);
    const rows = [candle(from.getTime()), candle(from.getTime() + 60_000)];
    mutate(rows);
    expect(parseGmgnKlineMarketChartV1({ list: rows }, {
      identityProof: proof(entry),
      range: "1h",
      resolution: "1m",
      requestedFrom: from,
      requestedTo: NOW,
      fetchedAt: NOW,
    })).toBeNull();
  });

  it("does not contact GMGN without the server-only API key", async () => {
    const entry = token(204);
    const fetchImpl = vi.fn();
    await expect(readGmgnMarketChartV1({
      entry,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not contact GMGN without a provable canonical supply", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const canonicalEntry = token(214);
    const entry = {
      ...canonicalEntry,
      totalSupplyRaw: undefined,
    } as unknown as ExploreEntry;
    const fetchImpl = vi.fn();
    await expect(readGmgnMarketChartV1({
      entry,
      identity: identity(canonicalEntry),
      range: "1h",
    }, {
      fetchImpl,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never enriches a non-production preview identity", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(212);
    const preview = {
      ...entry,
      exploreKind: "custom-project",
      launchCategoryProvenance: {
        schemaVersion: "programmable.explore-launch-category-provenance.v1",
        category: "custom",
        source: "interface-preview",
      },
    } as unknown as ExploreEntry;
    const fetchImpl = vi.fn();
    await expect(readGmgnMarketChartV1({
      entry: preview,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads a hydrated Registry Custom multi-market token with canonical admission", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = customEntry();
    const identities = customIdentities(entry);
    const selected = identities[1]!;
    const from = NOW.getTime() - 60 * 60_000;
    const info = {
      ...tokenInfo(token(223)),
      address: entry.tokenAddress,
      total_supply: "10000",
      pool: {
        ...tokenInfo(token(223)).pool,
        quote_address: selected.quoteAddress,
        base_address: entry.tokenAddress,
        token_address: entry.tokenAddress,
        token0_address: entry.tokenAddress,
        token1_address: selected.quoteAddress,
      },
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify({
        code: 0,
        data: url.pathname === "/v1/token/info"
          ? info
          : { list: [candle(from), candle(from + 60_000)] },
      }), { status: 200 });
    });

    const result = await readGmgnMarketChartV1({
      entry,
      identity: identities[0]!,
      range: "1h",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });

    expect(result).toMatchObject({
      source: "gmgn",
      seriesScope: "token",
      poolAttribution: "unavailable",
      identity: selected,
      identityProof: { identity: selected },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses only the official read-only endpoints and 13-digit direct-API millisecond bounds", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(205);
    const from = NOW.getTime() - 60 * 60_000;
    const fetchImpl = providerFetch(entry, [
      candle(from),
      candle(from + 60_000),
    ]);
    const chart = await readGmgnMarketChartV1({
      entry,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });

    expect(chart?.source).toBe("gmgn");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [infoRequest, infoInit] = fetchImpl.mock.calls[0]!;
    const [klineRequest, klineInit] = fetchImpl.mock.calls[1]!;
    const infoUrl = new URL(String(infoRequest));
    const klineUrl = new URL(String(klineRequest));
    expect(infoUrl.origin).toBe("https://openapi.gmgn.ai");
    expect(infoUrl.pathname).toBe("/v1/token/info");
    expect(klineUrl.pathname).toBe("/v1/market/token_kline");
    expect(klineUrl.searchParams.get("chain")).toBe("eth");
    expect(klineUrl.searchParams.get("address")).toBe(entry.tokenAddress);
    expect(klineUrl.searchParams.get("resolution")).toBe("1m");
    expect(klineUrl.searchParams.get("from")).toBe(String(from));
    expect(klineUrl.searchParams.get("to")).toBe(String(NOW.getTime()));
    expect(klineUrl.searchParams.get("from")).toMatch(/^[0-9]{13}$/u);
    expect(klineUrl.searchParams.get("to")).toMatch(/^[0-9]{13}$/u);
    expect(klineUrl.searchParams.get("from")).not.toBe(
      String(Math.floor(from / 1_000)),
    );
    expect(klineUrl.searchParams.get("to")).not.toBe(
      String(Math.floor(NOW.getTime() / 1_000)),
    );
    expect(klineUrl.searchParams.get("timestamp")).toBe("1788264000");
    expect(klineUrl.searchParams.get("client_id"))
      .toMatch(/^[0-9a-f-]{36}$/u);
    for (const init of [infoInit, klineInit]) {
      const headers = new Headers(init?.headers);
      expect(headers.get("X-APIKEY")).toBe("test-server-key");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
    }
  });

  it("fails soft before kline when token info declares a foreign outer chain", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(217);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      chain: "sol",
      data: tokenInfo(entry),
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(readGmgnMarketChartV1({
      entry,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["20", 20, 215],
    ["21", 1, 216],
  ] as const)(
    "maps configured RPS %s to the shared chart gate as %i",
    async (configured, expected, index) => {
      vi.stubEnv("GMGN_API_KEY", "test-server-key");
      vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", configured);
      const entry = token(index);
      const reservation = {
        kind: "reserved" as const,
        reservedAtMs: NOW.getTime(),
        generation: 1,
        holder: "00000000-0000-4000-8000-000000000001",
      };
      const accountGate: GmgnAccountGateV1 = {
        reserveSlot: vi.fn(async () => reservation),
        blockUntil: vi.fn(),
        complete: vi.fn(async () => undefined),
      };
      const from = NOW.getTime() - 60 * 60_000;
      const fetchImpl = providerFetch(entry, [
        candle(from),
        candle(from + 60_000),
      ]);

      await expect(readGmgnMarketChartV1({
        entry,
        identity: identity(entry),
        range: "1h",
      }, {
        fetchImpl: fetchImpl as typeof fetch,
        accountGate,
        now: () => NOW,
      })).resolves.not.toBeNull();
      expect(accountGate.reserveSlot).toHaveBeenNthCalledWith(1, {
        requestsPerSecond: expected,
        cost: 1,
        deadlineMs: NOW.getTime() + 2_500,
        signal: expect.any(AbortSignal),
      });
      expect(accountGate.reserveSlot).toHaveBeenNthCalledWith(2, {
        requestsPerSecond: expected,
        cost: 2,
        deadlineMs: NOW.getTime() + 2_500,
        signal: expect.any(AbortSignal),
      });
      const gateCalls = vi.mocked(accountGate.reserveSlot).mock.calls;
      const firstSignal = gateCalls[0]?.[0].signal;
      const secondSignal = gateCalls[1]?.[0].signal;
      expect(firstSignal).toBe(secondSignal);
    },
  );

  it("awaits exact lease release after the outer provider timer wins", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(221);
    const reservation = {
      kind: "reserved" as const,
      reservedAtMs: NOW.getTime(),
      generation: 1,
      holder: "00000000-0000-4000-8000-000000000021",
    };
    let resolveComplete!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveComplete = resolve;
    });
    const complete = vi.fn((_reservation: typeof reservation) => {
      void _reservation;
      return completion;
    });
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => reservation),
      blockUntil: vi.fn(),
      complete,
    };
    const fetchImpl = vi.fn(() => new Promise<Response>((_resolve, reject) => {
      setTimeout(() => {
        reject(new DOMException("provider timed out", "AbortError"));
      }, 2_501);
    }));
    let readSettled = false;

    const read = readGmgnMarketChartV1({
      entry,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
      now: () => new Date(),
    }).finally(() => {
      readSettled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2_500);
    expect(complete).not.toHaveBeenCalled();
    expect(readSettled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(reservation);
    expect(readSettled).toBe(false);

    resolveComplete();
    await expect(read).resolves.toBeNull();
  });

  it("awaits a deferred kline 429 block beyond the request deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(224);
    const firstReservation = {
      kind: "reserved" as const,
      reservedAtMs: NOW.getTime(),
      generation: 1,
      holder: "00000000-0000-4000-8000-000000000024",
    };
    const secondReservation = {
      ...firstReservation,
      generation: 2,
      holder: "00000000-0000-4000-8000-000000000025",
    };
    const blockedUntilMs = NOW.getTime() + 2_499 + 2_000;
    const blockedResult = {
      blockedUntilMs,
      retryAfterMs: 2_000,
    };
    let resolveBlockUntil!: (value: typeof blockedResult) => void;
    const blockOutcome = new Promise<typeof blockedResult>((resolve) => {
      resolveBlockUntil = resolve;
    });
    const blockUntil = vi.fn(() => blockOutcome);
    const complete = vi.fn(async () => undefined);
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn()
        .mockResolvedValueOnce(firstReservation)
        .mockResolvedValueOnce(secondReservation),
      blockUntil,
      complete,
    };
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/token/info") {
        return Promise.resolve(new Response(JSON.stringify({
          code: 0,
          data: tokenInfo(entry),
        }), { status: 200 }));
      }
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(new Response(JSON.stringify({
            code: 429,
            error: "RATE_LIMIT_EXCEEDED",
            data: {},
          }), { status: 429 }));
        }, 2_499);
      });
    });
    let readSettled = false;

    const read = readGmgnMarketChartV1({
      entry,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
      now: () => new Date(),
    }).finally(() => {
      readSettled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_499);
    expect(blockUntil).toHaveBeenCalledOnce();
    expect(blockUntil).toHaveBeenCalledWith({
      reservation: secondReservation,
      blockedUntilMs,
      providerSignal: "http-429",
    });
    expect(readSettled).toBe(false);

    await vi.advanceTimersByTimeAsync(2_999);
    expect(Date.now()).toBe(NOW.getTime() + 5_498);
    expect(readSettled).toBe(false);

    resolveBlockUntil(blockedResult);
    await expect(read).resolves.toBeNull();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(firstReservation);
  });

  it("stops before kline when GMGN returns a non-address pool locator", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(206);
    const mismatched = tokenInfo(entry);
    mismatched.pool.pool_address = `0x${"98".repeat(32)}`;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: mismatched,
    }), { status: 200 }));

    await expect(readGmgnMarketChartV1({
      entry,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent reads and serves the admitted token-series cache", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(207);
    const from = NOW.getTime() - 60 * 60_000;
    const fetchImpl = providerFetch(entry, [
      candle(from),
      candle(from + 60_000),
    ]);
    const input = {
      entry,
      identity: identity(entry),
      range: "1h" as const,
    };
    const wait = {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    };
    const [first, second] = await Promise.all([
      readGmgnMarketChartV1(input, wait),
      readGmgnMarketChartV1(input, wait),
    ]);
    const third = await readGmgnMarketChartV1(input, wait);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps shared chart work alive when the first caller aborts", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(217);
    const from = NOW.getTime() - 60 * 60_000;
    let resolveInfo: ((response: Response) => void) | undefined;
    let providerSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/token/info") {
        providerSignal = init?.signal;
        return new Promise<Response>((resolve) => {
          resolveInfo = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify({
        code: 0,
        data: { list: [candle(from), candle(from + 60_000)] },
      }), { status: 200 }));
    });
    const input = {
      entry,
      identity: identity(entry),
      range: "1h" as const,
    };
    const wait = {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    };
    const firstController = new AbortController();

    const first = readGmgnMarketChartV1(input, {
      ...wait,
      signal: firstController.signal,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const second = readGmgnMarketChartV1(input, wait);
    firstController.abort();
    await expect(first).resolves.toBeNull();
    expect(providerSignal).not.toBe(firstController.signal);
    expect(providerSignal?.aborted).toBe(false);

    resolveInfo?.(new Response(JSON.stringify({
      code: 0,
      data: tokenInfo(entry),
    }), { status: 200 }));
    const admitted = await second;
    expect(admitted?.identity).toEqual(identity(entry));
    await expect(readGmgnMarketChartV1(input, wait)).resolves.toEqual(admitted);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("publishes a kline 429 cooldown and never retries in the same read", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(208);
    const firstReservation = {
      kind: "reserved" as const,
      reservedAtMs: NOW.getTime(),
      generation: 1,
      holder: "00000000-0000-4000-8000-000000000001",
    };
    const secondReservation = {
      ...firstReservation,
      holder: "00000000-0000-4000-8000-000000000002",
    };
    const blockUntil = vi.fn(async () => ({
      blockedUntilMs: NOW.getTime() + 2_000,
      retryAfterMs: 2_000,
    }));
    const complete = vi.fn(async () => undefined);
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn()
        .mockResolvedValueOnce(firstReservation)
        .mockResolvedValueOnce(secondReservation),
      blockUntil,
      complete,
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/token/info") {
        return new Response(JSON.stringify({
          code: 0,
          data: tokenInfo(entry),
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        code: 429,
        error: "RATE_LIMIT_EXCEEDED",
        data: {},
      }), { status: 429 });
    });

    await expect(readGmgnMarketChartV1({
      entry,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(accountGate.reserveSlot).toHaveBeenNthCalledWith(1, {
      requestsPerSecond: 1,
      cost: 1,
      deadlineMs: NOW.getTime() + 2_500,
      signal: expect.any(AbortSignal),
    });
    expect(accountGate.reserveSlot).toHaveBeenNthCalledWith(2, {
      requestsPerSecond: 1,
      cost: 2,
      deadlineMs: NOW.getTime() + 2_500,
      signal: expect.any(AbortSignal),
    });
    expect(complete).toHaveBeenCalledWith(firstReservation);
    expect(blockUntil).toHaveBeenCalledWith({
      reservation: secondReservation,
      blockedUntilMs: NOW.getTime() + 2_000,
      providerSignal: "http-429",
    });
  });

  it("prefers only a fresh, admitted, higher-quality GMGN token series", () => {
    const entry = token(209);
    const expectedIdentity = identity(entry);
    const from = new Date(NOW.getTime() - 120_000);
    const gmgn = parseGmgnKlineMarketChartV1({
      list: [candle(from.getTime()), candle(from.getTime() + 60_000)],
    }, {
      identityProof: proof(entry),
      range: "1h",
      resolution: "1m",
      requestedFrom: from,
      requestedTo: NOW,
      fetchedAt: NOW,
    }) as GmgnMarketChartV1;
    const fallback = bitqueryChart(expectedIdentity);
    expect(preferAdmittedGmgnTokenSeriesV1({
      candidate: gmgn,
      fallback,
      identity: expectedIdentity,
      range: "1h",
      now: NOW,
    })).toBe(gmgn);

    expect(preferAdmittedGmgnTokenSeriesV1({
      candidate: { ...gmgn, identity: identity(token(210)) },
      fallback,
      identity: expectedIdentity,
      range: "1h",
      now: NOW,
    })).toBe(fallback);

    expect(preferAdmittedGmgnTokenSeriesV1({
      candidate: { ...gmgn, status: "partial", truncated: true },
      fallback,
      identity: expectedIdentity,
      range: "1h",
      now: NOW,
    })).toBe(fallback);

    expect(preferAdmittedGmgnTokenSeriesV1({
      candidate: gmgn,
      fallback,
      identity: expectedIdentity,
      range: "1h",
      now: new Date(NOW.getTime() + 60_001),
    })).toBe(fallback);
  });

  it("lets a complete GMGN token series replace a partial Bitquery result", () => {
    const entry = token(211);
    const expectedIdentity = identity(entry);
    const from = new Date(NOW.getTime() - 120_000);
    const gmgn = parseGmgnKlineMarketChartV1({
      list: [candle(from.getTime()), candle(from.getTime() + 60_000)],
    }, {
      identityProof: proof(entry),
      range: "1h",
      resolution: "1m",
      requestedFrom: from,
      requestedTo: NOW,
      fetchedAt: NOW,
    });
    const fallback = bitqueryChart(expectedIdentity, "partial");
    expect(preferAdmittedGmgnTokenSeriesV1({
      candidate: gmgn,
      fallback,
      identity: expectedIdentity,
      range: "1h",
      now: NOW,
    })).toBe(gmgn);
  });
});
