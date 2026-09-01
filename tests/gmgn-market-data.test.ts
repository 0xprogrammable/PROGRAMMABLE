import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

vi.mock("server-only", () => ({}));

import {
  gmgnChainSlugV1,
  gmgnVisibleMarketConcurrencyV1,
  gmgnVisibleMarketEntryEligibleV1,
  parseGmgnMarketSnapshotV1,
  readGmgnExploreSnapshotsV1,
  readGmgnMarketSnapshotV1,
} from "../lib/market-data/gmgn.server";
import { gmgnEffectiveRequestsPerSecondV1 } from
  "../lib/market-data/gmgn-runtime-config.server";
import { exploreEntryMarketIdentitiesV1 } from
  "../lib/market-data/explore-market-identities";
import {
  isGmgnMarketSnapshotForExploreEntryV1,
  isGmgnMarketSnapshotV1,
} from "../lib/market-data/gmgn-market-data-v1";
import type { MarketChartIdentityV1 } from
  "../lib/market-data/market-data-v1";
import type { GmgnAccountGateV1 } from
  "../lib/market-data/gmgn-account-gate.server";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const NOW = new Date("2026-08-30T12:00:00.000Z");
const QUOTE = "0x0000000000000000000000000000000000000000" as const;
const PROVIDER_POOL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const OTHER_PROVIDER_POOL =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const GATE_RESERVATION = Object.freeze({
  kind: "reserved" as const,
  reservedAtMs: NOW.getTime(),
  generation: 1,
  holder: "00000000-0000-4000-8000-000000000001",
});

function token(index = 1): Extract<ExploreEntry, { exploreKind: "token" }> {
  const tokenAddress = `0x${index.toString(16).padStart(40, "0")}` as const;
  const value = {
    id: `1:${tokenAddress}`,
    name: "SHARD",
    symbol: "SHARD",
    tokenAddress,
    hookAddress: "0x3333333333333333333333333333333333333333",
    poolId: `0x${index.toString(16).padStart(64, "0")}` as const,
    launchedAt: NOW.toISOString(),
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

function providerData(entry: ReturnType<typeof token>) {
  return {
    address: entry.tokenAddress,
    biggest_pool_address: PROVIDER_POOL,
    total_supply: "10000",
    price: {
      price: "3.3111698",
      volume_24h: "123.45",
      swaps_24h: "17",
    },
    pool: {
      pool_address: PROVIDER_POOL,
      quote_address: QUOTE,
      exchange: "uniswap_v4",
      liquidity: "12000.5",
    },
  };
}

function registryCustom(index = 200): Extract<
  ExploreEntry,
  { exploreKind: "custom-project" }
> {
  const tokenAddress = `0x${index.toString(16).padStart(40, "0")}` as const;
  return {
    exploreKind: "custom-project",
    id: `custom:sha256:${index.toString(16).padStart(64, "0")}`,
    name: `Registry Custom ${index}`,
    symbol: `RC${index}`,
    links: [],
    launchedAt: NOW.toISOString(),
    finalizedAt: NOW.toISOString(),
    chainId: "1",
    modelId: "registry-custom",
    customProjectId: `sha256:${index.toString(16).padStart(64, "0")}`,
    customLaunchId: `sha256:${(index + 1).toString(16).padStart(64, "0")}`,
    launchingWallet: {
      namespace: "eip155:1",
      value: "0x6666666666666666666666666666666666666666",
    },
    postLaunchAuthorityInventory: {} as never,
    postLaunchAuthorityInventoryHash: `sha256:${"99".repeat(32)}`,
    tokenAddress,
    tokenDecimals: 18,
    totalSupplyRaw: "10000000000000000000000",
    markets: [
      {
        marketId: "market-b",
        kind: "uniswap-v4",
        status: "active",
        poolId: `0x${"bb".repeat(32)}`,
        baseAsset: {
          assetId: "token",
          identity: { namespace: "eip155:1", value: tokenAddress },
        },
        quoteAsset: {
          assetId: "quote-b",
          identity: {
            namespace: "eip155:1",
            value: "0x7777777777777777777777777777777777777777",
          },
        },
      },
      {
        marketId: "market-a",
        kind: "uniswap-v4",
        status: "active",
        poolId: `0x${"aa".repeat(32)}`,
        baseAsset: {
          assetId: "token",
          identity: { namespace: "eip155:1", value: tokenAddress },
        },
        quoteAsset: {
          assetId: "native-eth",
          identity: { namespace: "eip155:1", value: QUOTE },
        },
      },
    ],
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "custom",
      source: "registry.custom-launched",
      projectId: `sha256:${index.toString(16).padStart(64, "0")}`,
      launchId: `sha256:${(index + 1).toString(16).padStart(64, "0")}`,
      sourceRecordBindingHash: `sha256:${"ab".repeat(32)}`,
      finalizedLaunchBindingHash: `sha256:${"cd".repeat(32)}`,
    },
  } as unknown as Extract<ExploreEntry, { exploreKind: "custom-project" }>;
}

function providerDataForIdentity(identity: MarketChartIdentityV1) {
  return {
    address: identity.tokenAddress,
    biggest_pool_address: PROVIDER_POOL,
    total_supply: "10000",
    price: {
      price: "3.3111698",
      volume_24h: "123.45",
      swaps_24h: "17",
    },
    pool: {
      pool_address: PROVIDER_POOL,
      quote_address: identity.quoteAddress,
      exchange: "uniswap_v4",
      liquidity: "12000.5",
    },
  };
}

describe("GMGN canonical market enrichment", () => {
  beforeEach(() => {
    vi.stubEnv("GMGN_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("maps only Ethereum mainnet", () => {
    expect(gmgnChainSlugV1(1)).toBe("eth");
    expect(gmgnChainSlugV1("4663")).toBeNull();
    expect(gmgnChainSlugV1(8453)).toBeNull();
  });

  it.each([
    [undefined, 1],
    ["", 1],
    ["0", 1],
    ["1.5", 1],
    [" 20 ", 1],
    ["020", 1],
    ["2e1", 1],
    ["20.0", 1],
    ["20", 20],
    ["21", 1],
  ] as const)(
    "parses the effective server-only RPS value %s as %i",
    (configured, expected) => {
      if (configured === undefined) {
        vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", undefined);
      } else {
        vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", configured);
      }
      expect(gmgnEffectiveRequestsPerSecondV1()).toBe(expected);
    },
  );

  it("derives visible token-info concurrency from effective RPS and batch size", () => {
    vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", "20");
    expect(gmgnVisibleMarketConcurrencyV1(0)).toBe(0);
    expect(gmgnVisibleMarketConcurrencyV1(1)).toBe(1);
    expect(gmgnVisibleMarketConcurrencyV1(7)).toBe(7);
    expect(gmgnVisibleMarketConcurrencyV1(20)).toBe(20);
    expect(gmgnVisibleMarketConcurrencyV1(100)).toBe(20);

    vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", "3");
    expect(gmgnVisibleMarketConcurrencyV1(20)).toBe(3);

    vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", "20.0");
    expect(gmgnVisibleMarketConcurrencyV1(20)).toBe(1);
    expect(gmgnVisibleMarketConcurrencyV1(Number.NaN)).toBe(0);
  });

  it("admits only supply-backed verified Registry Custom market identities", () => {
    const custom = registryCustom();
    expect(exploreEntryMarketIdentitiesV1(custom)).toHaveLength(2);
    expect(gmgnVisibleMarketEntryEligibleV1(custom)).toBe(true);
    expect(gmgnVisibleMarketEntryEligibleV1({
      ...custom,
      totalSupplyRaw: undefined,
    })).toBe(false);
    expect(gmgnVisibleMarketEntryEligibleV1({
      ...custom,
      launchCategoryProvenance: {
        ...custom.launchCategoryProvenance,
        source: "interface-preview",
      } as typeof custom.launchCategoryProvenance,
    })).toBe(false);
    expect(gmgnVisibleMarketEntryEligibleV1({
      ...custom,
      chainId: "4663",
    })).toBe(false);
  });

  it("binds a multi-market token response to its exact canonical quote identity", () => {
    const custom = registryCustom(201);
    const identities = exploreEntryMarketIdentitiesV1(custom);
    expect(identities.map((value) => value.poolId)).toEqual([
      `0x${"aa".repeat(32)}`,
      `0x${"bb".repeat(32)}`,
    ]);
    const admission = identities[0]!;
    const accepted = parseGmgnMarketSnapshotV1(
      providerDataForIdentity(admission),
      [...identities].reverse(),
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    );
    expect(accepted?.identity).toEqual(admission);
    expect(parseGmgnMarketSnapshotV1(
      providerDataForIdentity(identities[1]!),
      identities,
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    )?.identity).toEqual(identities[1]);

    const assetAsPool = providerDataForIdentity(
      identities[0]!,
    ) as unknown as Record<string, unknown> & { pool: Record<string, unknown> };
    assetAsPool.pool.pool_address = identities[1]!.quoteAddress;
    assetAsPool.biggest_pool_address = identities[1]!.quoteAddress;
    expect(parseGmgnMarketSnapshotV1(
      assetAsPool,
      identities,
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    )).toBeNull();
  });

  it("selects deterministically among token-scoped same-quote markets and honors an exact PoolId", () => {
    const entry = token(202);
    const lower = {
      ...identity(entry),
      poolId: `0x${"aa".repeat(32)}` as const,
    };
    const upper = {
      ...identity(entry),
      poolId: `0x${"bb".repeat(32)}` as const,
    };
    const tokenScoped = providerDataForIdentity(lower);
    const parse = (
      response: unknown,
      identities: readonly MarketChartIdentityV1[],
    ) => parseGmgnMarketSnapshotV1(
      response,
      identities,
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    );
    expect(parse(tokenScoped, [upper, lower])?.identity).toEqual(lower);
    expect(parse(tokenScoped, [lower, upper])?.identity).toEqual(lower);

    const exact = structuredClone(tokenScoped) as unknown as Record<string, unknown> & {
      pool: Record<string, unknown>;
    };
    exact.pool.pool_address = upper.poolId;
    exact.biggest_pool_address = upper.poolId;
    expect(parse(exact, [lower, upper])).toMatchObject({
      identity: upper,
      poolAttribution: "exact",
    });
  });

  it("accepts the documented token-info pool shape without treating its contract address as a v4 PoolId", () => {
    const entry = token();
    const provider = providerData(entry);
    expect(provider.pool).not.toHaveProperty("base_address");
    expect(provider.pool).not.toHaveProperty("token_address");
    expect(provider.pool).not.toHaveProperty("token0_address");
    expect(provider.pool).not.toHaveProperty("token1_address");
    expect(provider.pool.pool_address).toHaveLength(42);
    expect(provider.pool.pool_address).not.toBe(entry.poolId);
    const snapshot = parseGmgnMarketSnapshotV1(
      provider,
      [identity(entry)],
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    );
    expect(snapshot).toEqual({
      schemaVersion: "programmable.gmgn-market-snapshot.v1",
      source: "gmgn",
      marketScope: "token",
      poolAttribution: "unavailable",
      currency: "USD",
      fetchedAt: NOW.toISOString(),
      identity: identity(entry),
      priceUsdWad: "3311169800000000000",
      fdvUsdWad: "33111698000000000000000",
      liquidityUsdWad: "12000500000000000000000",
      volume24hUsdWad: "123450000000000000000",
      swapCount24h: 17,
    });
    expect(isGmgnMarketSnapshotV1(snapshot)).toBe(true);
    expect(isGmgnMarketSnapshotV1({
      ...snapshot!,
      marketScope: "pool",
    })).toBe(false);
    expect(isGmgnMarketSnapshotV1({
      ...snapshot!,
      poolAttribution: "exact",
    })).toBe(true);
  });

  it("accepts coherent canonical bytes32 v4 PoolId locators with exact attribution", () => {
    const entry = token(116);
    const data = providerData(entry) as unknown as Record<string, unknown> & {
      pool: Record<string, unknown>;
    };
    data.pool.pool_address = entry.poolId;
    data.biggest_pool_address = entry.poolId;
    expect(parseGmgnMarketSnapshotV1(
      data,
      [identity(entry)],
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    )).toMatchObject({
      marketScope: "token",
      poolAttribution: "exact",
      identity: identity(entry),
    });
  });

  it("rejects a formally valid snapshot attached to another Explore identity", () => {
    const entry = token(101);
    const snapshot = parseGmgnMarketSnapshotV1(
      providerData(entry),
      [identity(entry)],
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    );
    expect(snapshot).not.toBeNull();
    expect(isGmgnMarketSnapshotForExploreEntryV1(snapshot, entry)).toBe(true);
    expect(isGmgnMarketSnapshotForExploreEntryV1({
      ...snapshot!,
      identity: {
        ...snapshot!.identity,
        tokenAddress: token(102).tokenAddress,
      },
    }, entry)).toBe(false);
  });

  it.each([
    ["token", (data: ReturnType<typeof providerData>) => {
      data.address = "0x9999999999999999999999999999999999999999";
    }],
    ["pool", (data: ReturnType<typeof providerData>) => {
      Reflect.set(data.pool, "pool_address", OTHER_PROVIDER_POOL);
    }],
    ["biggest pool", (data: ReturnType<typeof providerData>) => {
      Reflect.set(data, "biggest_pool_address", OTHER_PROVIDER_POOL);
    }],
    ["quote", (data: ReturnType<typeof providerData>) => {
      Reflect.set(
        data.pool,
        "quote_address",
        "0x9999999999999999999999999999999999999999",
      );
    }],
    ["exchange", (data: ReturnType<typeof providerData>) => {
      data.pool.exchange = "uniswap_v3";
    }],
    ["base", (data: ReturnType<typeof providerData>) => {
      Reflect.set(
        data.pool,
        "base_address",
        "0x9999999999999999999999999999999999999999",
      );
    }],
    ["token pair", (data: ReturnType<typeof providerData>) => {
      Reflect.set(data.pool, "token0_address", QUOTE);
      Reflect.set(
        data.pool,
        "token1_address",
        "0x9999999999999999999999999999999999999999",
      );
    }],
    ["supply", (data: ReturnType<typeof providerData>) => {
      data.total_supply = "10001";
    }],
  ])("rejects a mismatched %s identity binding", (_label, mutate) => {
    const entry = token();
    const data = providerData(entry);
    mutate(data);
    expect(parseGmgnMarketSnapshotV1(
      data,
      [identity(entry)],
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    )).toBeNull();
  });

  it.each([
    ["zero", "0x0000000000000000000000000000000000000000"],
    ["token contract", token(117).tokenAddress],
    ["foreign bytes32 PoolId", `0x${"44".repeat(32)}`],
    ["malformed", "0x1234"],
  ])("rejects a %s token-info pool locator", (_label, poolAddress) => {
    const entry = token(117);
    const data = providerData(entry) as unknown as Record<string, unknown> & {
      pool: Record<string, unknown>;
    };
    data.pool.pool_address = poolAddress;
    data.biggest_pool_address = poolAddress;
    expect(parseGmgnMarketSnapshotV1(
      data,
      [identity(entry)],
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    )).toBeNull();
  });

  it("accepts only an exact optional Ethereum chain on the envelope and token", () => {
    const entry = token(119);
    const parse = (response: unknown) => parseGmgnMarketSnapshotV1(
      response,
      [identity(entry)],
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    );
    expect(parse({
      chain: "eth",
      data: { ...providerData(entry), chain: "eth" },
    })).not.toBeNull();
    expect(parse({ ...providerData(entry), chain: "bsc" })).toBeNull();
    expect(parse({ chain: "bsc", data: providerData(entry) })).toBeNull();
    expect(parse({ ...providerData(entry), chain: "ETH" })).toBeNull();
    expect(parse({ ...providerData(entry), chain: undefined })).toBeNull();
  });

  it("does not call GMGN without a server-side API key", async () => {
    const fetchImpl = vi.fn();
    await expect(readGmgnMarketSnapshotV1(token(2), {
      fetchImpl,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires the official numeric-zero envelope and binds auth server-side", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(3);
    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      void input;
      void init;
      return new Response(JSON.stringify({
        code: 0,
        data: providerData(entry),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const snapshot = await readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchMock as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 2_000,
    });
    expect(snapshot?.source).toBe("gmgn");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [request, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(request));
    expect(url.origin).toBe("https://openapi.gmgn.ai");
    expect(url.pathname).toBe("/v1/token/info");
    expect(url.searchParams.get("chain")).toBe("eth");
    expect(url.searchParams.get("address")).toBe(entry.tokenAddress);
    expect(url.searchParams.get("timestamp")).toBe("1788091200");
    expect(url.searchParams.get("client_id")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(new Headers(init?.headers).get("X-APIKEY")).toBe("test-server-key");
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
  });

  it("processes the 100-entry API maximum in bounded 20-request chunks", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", "20");
    const entries = Array.from({ length: 100 }, (_, index) => token(index + 300));
    const byAddress = new Map(entries.map((entry) => [entry.tokenAddress, entry]));
    let active = 0;
    let maximumActive = 0;
    let generation = 0;
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => ({
        ...GATE_RESERVATION,
        generation: ++generation,
      })),
      blockUntil: vi.fn(),
      complete: vi.fn(async () => {}),
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      const address = new URL(String(input)).searchParams.get("address") ?? "";
      const matched = byAddress.get(address as `0x${string}`);
      return new Response(JSON.stringify({
        code: 0,
        data: matched ? providerData(matched) : {},
      }), { status: 200 });
    });

    const snapshots = await readGmgnExploreSnapshotsV1(entries, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 8_000,
    });

    expect(snapshots.size).toBe(100);
    expect(fetchImpl).toHaveBeenCalledTimes(100);
    expect(maximumActive).toBe(20);
    expect(accountGate.reserveSlot).toHaveBeenCalledTimes(100);
    expect(accountGate.complete).toHaveBeenCalledTimes(100);
  });

  it("rejects a foreign chain on the raw provider envelope", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(129);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      chain: "bsc",
      data: providerData(entry),
    }), { status: 200 }));

    await expect(readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["20", 20, 130],
    ["21", 1, 131],
  ] as const)(
    "maps configured RPS %s to the shared gate as %i",
    async (configured, expected, index) => {
      vi.stubEnv("GMGN_API_KEY", "test-server-key");
      vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", configured);
      const entry = token(index);
      const reserveSlot = vi.fn(async () => GATE_RESERVATION);
      const accountGate: GmgnAccountGateV1 = {
        reserveSlot,
        blockUntil: vi.fn(),
        complete: vi.fn(async () => {}),
      };
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
        code: 0,
        data: providerData(entry),
      }), { status: 200 }));

      await expect(readGmgnMarketSnapshotV1(entry, {
        fetchImpl: fetchImpl as typeof fetch,
        accountGate,
        now: () => NOW,
      })).resolves.not.toBeNull();
      expect(reserveSlot).toHaveBeenCalledWith({
        requestsPerSecond: expected,
        deadlineMs: NOW.getTime() + 2_500,
        signal: expect.any(AbortSignal),
      });
    },
  );

  it("keeps shared provider work alive when the first caller aborts", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(132);
    let resolveProvider: ((response: Response) => void) | undefined;
    let providerSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      providerSignal = init?.signal;
      return new Promise<Response>((resolve) => {
        resolveProvider = resolve;
      });
    });
    const firstController = new AbortController();
    const inputWait = {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    };

    const first = readGmgnMarketSnapshotV1(entry, {
      ...inputWait,
      signal: firstController.signal,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const second = readGmgnMarketSnapshotV1(entry, inputWait);
    firstController.abort();
    await expect(first).resolves.toBeNull();
    expect(providerSignal).not.toBe(firstController.signal);
    expect(providerSignal?.aborted).toBe(false);

    resolveProvider?.(new Response(JSON.stringify({
      code: 0,
      data: providerData(entry),
    }), { status: 200 }));
    const exact = await second;
    expect(exact?.identity).toEqual(identity(entry));
    await expect(readGmgnMarketSnapshotV1(entry, inputWait)).resolves.toEqual(exact);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never forwards X-APIKEY to a redirect target origin", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const redirectKeys: Array<string | string[] | undefined> = [];
    const targetKeys: Array<string | string[] | undefined> = [];
    const target = createServer((request, response) => {
      targetKeys.push(request.headers["x-apikey"]);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ code: 0, data: providerData(token(120)) }));
    });
    const redirector = createServer((request, response) => {
      redirectKeys.push(request.headers["x-apikey"]);
      const targetAddress = target.address();
      if (targetAddress === null || typeof targetAddress === "string") {
        response.writeHead(500).end();
        return;
      }
      response.writeHead(302, {
        Location: `http://127.0.0.1:${targetAddress.port}/redirect-target`,
      });
      response.end();
    });
    const listen = (server: typeof target) => new Promise<void>(
      (resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      },
    );
    const close = (server: typeof target) => new Promise<void>(
      (resolve, reject) => server.close((error) =>
        error ? reject(error) : resolve()
      ),
    );
    await listen(target);
    await listen(redirector);
    const redirectAddress = redirector.address();
    if (redirectAddress === null || typeof redirectAddress === "string") {
      await Promise.all([close(redirector), close(target)]);
      throw new Error("Redirect test server did not bind a TCP address");
    }
    const nativeFetch = globalThis.fetch;
    const fetchImpl = vi.fn((
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => nativeFetch(
      `http://127.0.0.1:${redirectAddress.port}/gmgn`,
      init,
    ));

    try {
      await expect(readGmgnMarketSnapshotV1(token(120), {
        fetchImpl: fetchImpl as typeof fetch,
        now: () => NOW,
        deadlineMs: NOW.getTime() + 2_000,
      })).resolves.toBeNull();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe("error");
      expect(fetchImpl.mock.calls[0]?.[1]?.credentials).toBe("omit");
      expect(redirectKeys).toEqual(["test-server-key"]);
      expect(targetKeys).toEqual([]);
    } finally {
      await Promise.all([close(redirector), close(target)]);
    }
  });

  it("fails closed on an unsealed provider response", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(4);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: providerData(entry),
    }), { status: 200 }));
    await expect(readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 2_000,
    })).resolves.toBeNull();
  });

  it("fails soft without a same-request retry after a 429", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(5);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 429,
        error: "RATE_LIMIT_EXCEEDED",
        data: {},
      }), { status: 429, headers: { "Retry-After": "1" } }));
    await expect(readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 2_000,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("publishes provider cooldown to the shared account gate", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 429,
      error: "RATE_LIMIT_EXCEEDED",
      data: {},
    }), { status: 429 }));
    const blockUntil = vi.fn(async () => ({
      blockedUntilMs: NOW.getTime() + 2_000,
      retryAfterMs: 2_000,
    }));
    const complete = vi.fn();
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => ({
        ...GATE_RESERVATION,
      })),
      blockUntil,
      complete,
    };

    await expect(readGmgnMarketSnapshotV1(token(6), {
      fetchImpl: fetchMock as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(blockUntil).toHaveBeenCalledWith({
      reservation: GATE_RESERVATION,
      blockedUntilMs: NOW.getTime() + 2_000,
      providerSignal: "http-429",
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("bounds provider reset_at before publishing it to the gate", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const resetAt = Math.floor(NOW.getTime() / 1_000) + 3_600;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: "RATE_LIMIT_BANNED",
      error: "RATE_LIMIT_BANNED",
      reset_at: resetAt,
      data: {},
    }), { status: 200 }));
    const blockUntil = vi.fn(async () => ({
      blockedUntilMs: NOW.getTime() + 300_000,
      retryAfterMs: 300_000,
    }));
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => ({
        ...GATE_RESERVATION,
      })),
      blockUntil,
      complete: vi.fn(),
    };

    await expect(readGmgnMarketSnapshotV1(token(8), {
      fetchImpl: fetchMock as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 310_000,
    })).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(blockUntil).toHaveBeenCalledWith({
      reservation: GATE_RESERVATION,
      blockedUntilMs: NOW.getTime() + 300_000,
      providerSignal: "provider-envelope",
    });
  });

  it("fails closed before fetch when the shared gate is unavailable", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const fetchMock = vi.fn();
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
      blockUntil: vi.fn(),
      complete: vi.fn(),
    };
    await expect(readGmgnMarketSnapshotV1(token(105), {
      fetchImpl: fetchMock as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_500,
    })).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cannot bypass the production gate with an injected fetch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    vi.stubEnv("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL", "");
    const fetchMock = vi.fn();

    await expect(readGmgnMarketSnapshotV1(token(106), {
      fetchImpl: fetchMock as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_500,
    })).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases only the matching lease after a normal provider response", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(107);
    const complete = vi.fn(async () => {});
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => GATE_RESERVATION),
      blockUntil: vi.fn(),
      complete,
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: providerData(entry),
    }), { status: 200 }));

    await expect(readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_500,
    })).resolves.not.toBeNull();
    expect(complete).toHaveBeenCalledWith(GATE_RESERVATION);
  });

  it("discards a normal response when its lease release fails", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(108);
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => GATE_RESERVATION),
      blockUntil: vi.fn(),
      complete: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: providerData(entry),
    }), { status: 200 }));

    await expect(readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_500,
    })).resolves.toBeNull();
  });

  it("releases the exact lease when the provider fetch fails", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const complete = vi.fn(async () => {});
    const blockUntil = vi.fn();
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => GATE_RESERVATION),
      blockUntil,
      complete,
    };
    const fetchImpl = vi.fn(async () => {
      throw new Error("provider unavailable");
    });

    await expect(readGmgnMarketSnapshotV1(token(109), {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_500,
    })).resolves.toBeNull();
    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(GATE_RESERVATION);
    expect(blockUntil).not.toHaveBeenCalled();
  });

  it("awaits exact lease cleanup after the real provider timer expires", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let resolveComplete!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveComplete = resolve;
    });
    const complete = vi.fn((_reservation: typeof GATE_RESERVATION) => {
      void _reservation;
      return completion;
    });
    const reserveSlot = vi.fn(async () => GATE_RESERVATION);
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot,
      blockUntil: vi.fn(),
      complete,
    };
    const fetchImpl = vi.fn(() => new Promise<Response>((_resolve, reject) => {
      setTimeout(
        () => reject(new DOMException("timed out", "AbortError")),
        2_501,
      );
    }));

    let readSettled = false;
    const read = readGmgnMarketSnapshotV1(token(111), {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
    });
    void read.then(
      () => {
        readSettled = true;
      },
      () => {
        readSettled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_499);
    expect(complete).not.toHaveBeenCalled();
    expect(readSettled).toBe(false);

    // The public request times out at 2.500 ms. The provider notices one
    // millisecond later and begins exact lease cleanup inside lifecycle grace.
    await vi.advanceTimersByTimeAsync(2);
    expect(complete).toHaveBeenCalledOnce();
    expect(readSettled).toBe(false);

    resolveComplete();
    await expect(read).resolves.toBeNull();
    expect(reserveSlot).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(GATE_RESERVATION);
    expect(complete.mock.calls[0]?.[0]).toBe(GATE_RESERVATION);
    expect(accountGate.blockUntil).not.toHaveBeenCalled();
  });

  it("bounds a provider that ignores its timeout by lifecycle grace", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => GATE_RESERVATION),
      blockUntil: vi.fn(),
      complete: vi.fn(),
    };
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    let readSettled = false;
    const read = readGmgnMarketSnapshotV1(token(112), {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
    });
    void read.then(
      () => {
        readSettled = true;
      },
      () => {
        readSettled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(2_500);
    expect(readSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(3_499);
    expect(readSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(read).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(accountGate.complete).not.toHaveBeenCalled();
  });

  it("uses a fresh outcome deadline to publish a late provider 429", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const blockedUntilMs = NOW.getTime() + 2_499 + 1_250;
    let releaseBlock!: () => void;
    const blockOutcome = {
      blockedUntilMs,
      retryAfterMs: 1_250,
    };
    const deferredBlock = new Promise<typeof blockOutcome>((resolve) => {
      releaseBlock = () => resolve(blockOutcome);
    });
    const blockUntil = vi.fn(() => deferredBlock);
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => GATE_RESERVATION),
      blockUntil,
      complete: vi.fn(),
    };
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      setTimeout(() => resolve(new Response(JSON.stringify({
        code: 429,
        error: "RATE_LIMIT_EXCEEDED",
        data: {},
      }), { status: 429, headers: { "Retry-After": "1" } })), 2_499);
    }));
    let readSettled = false;
    const read = readGmgnMarketSnapshotV1(token(113), {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
    });
    void read.then(
      () => {
        readSettled = true;
      },
      () => {
        readSettled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(2_499);
    expect(blockUntil).toHaveBeenCalledOnce();
    expect(readSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(readSettled).toBe(false);

    releaseBlock();
    await expect(read).resolves.toBeNull();
    expect(blockUntil).toHaveBeenCalledWith({
      reservation: GATE_RESERVATION,
      blockedUntilMs,
      providerSignal: "http-429",
    });
    expect(accountGate.complete).not.toHaveBeenCalled();
  });

  it("fails soft when an errored fetch races a stale exact lease", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const complete = vi.fn(async () => {
      throw new Error("lease is stale or unavailable");
    });
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => GATE_RESERVATION),
      blockUntil: vi.fn(),
      complete,
    };
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("timed out", "AbortError");
    });

    await expect(readGmgnMarketSnapshotV1(token(110), {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_500,
    })).resolves.toBeNull();
    expect(complete).toHaveBeenCalledWith(GATE_RESERVATION);
    expect(accountGate.blockUntil).not.toHaveBeenCalled();
  });

  it.each([
    ["provider 500", 500, JSON.stringify({ code: 0, data: {} })],
    ["oversized UTF-8 body", 200, "é".repeat(500_001)],
  ])("fails soft for a bounded %s response", async (_label, status, body) => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(status + 10);
    const fetchImpl = vi.fn(async () => new Response(body, { status }));
    await expect(readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 2_000,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
