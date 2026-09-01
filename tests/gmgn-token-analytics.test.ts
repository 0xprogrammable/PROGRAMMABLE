import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseGmgnTokenPoolInfoV1,
  parseGmgnTokenSecurityV1,
  parseGmgnTokenWalletRankingV1,
  readGmgnTokenPoolInfoV1,
  readGmgnTokenSecurityV1,
  readGmgnTokenTopHoldersV1,
  readGmgnTokenTopTradersV1,
} from "../lib/market-data/gmgn-token-analytics.server";
import type { GmgnAccountGateV1 } from
  "../lib/market-data/gmgn-account-gate.server";
import type {
  GmgnTokenRankingQueryV1,
} from "../lib/market-data/gmgn-token-analytics-v1";
import type { MarketChartIdentityV1 } from
  "../lib/market-data/market-data-v1";

const NOW = new Date("2026-09-01T04:00:00.000Z");
const QUOTE = "0x0000000000000000000000000000000000000000" as const;

function identity(index: number): MarketChartIdentityV1 {
  return {
    chainId: "1",
    protocol: "uniswap_v4",
    tokenAddress: `0x${index.toString(16).padStart(40, "0")}`,
    poolId: `0x${index.toString(16).padStart(64, "0")}`,
    quoteAddress: QUOTE,
  };
}

function securityData(value: MarketChartIdentityV1) {
  return {
    address: value.tokenAddress,
    is_show_alert: false,
    top_10_holder_rate: "0.12",
    burn_ratio: "0.95",
    burn_status: "burn",
    dev_token_burn_amount: "1250000",
    dev_token_burn_ratio: "0.05",
    is_open_source: true,
    open_source: 1,
    is_blacklist: false,
    blacklist: 0,
    is_honeypot: false,
    honeypot: 0,
    is_renounced: true,
    renounced: 1,
    renounced_freeze_account: false,
    renounced_mint: false,
    can_sell: 15,
    can_not_sell: 0,
    buy_tax: "0",
    sell_tax: "0.01",
    average_tax: "0.005",
    high_tax: "0.01",
    flags: ["verified"],
    lock_summary: {
      is_locked: true,
      lock_detail: [{
        percent: "0.95",
        pool: "0x0000000000000000000000000000000000000001",
        is_blackhole: true,
      }],
      lock_percent: "0.95",
      left_lock_percent: "0.05",
    },
    hide_risk: false,
  };
}

function poolData(value: MarketChartIdentityV1) {
  return {
    address: value.tokenAddress,
    pool_address: value.poolId,
    base_address: value.tokenAddress,
    quote_address: value.quoteAddress,
    token0_address: value.quoteAddress,
    token1_address: value.tokenAddress,
    quote_symbol: "ETH",
    exchange: "uniswap_v4",
    liquidity: "114067973.55976297",
    base_reserve: "23422.229804907490379478",
    quote_reserve: "56069613.894553",
    base_reserve_value: "57749445.57512948717786546729032134",
    quote_reserve_value: "56058760.49939143137579",
    initial_liquidity: "100000",
    initial_base_reserve: "10000",
    initial_quote_reserve: "10",
    price: "2465.59",
    fee_ratio: "0.003",
    creation_timestamp: 1_788_235_000,
  };
}

function rankedWallet(addressIndex = 91) {
  return {
    address: `0x${addressIndex.toString(16).padStart(40, "0")}`,
    account_address: "",
    addr_type: 0,
    exchange: "",
    native_balance: "6670855275339409439764",
    balance: 38_644_747_524_459.96,
    amount_cur: 38_644_747_524_459.96,
    usd_value: 136_712_298.27878547,
    amount_percentage: 0.0918604120446466,
    accu_amount: 21_619_851_762_099.164,
    accu_cost: 70_716_112.87681729,
    cost: 70_716_112.87681729,
    cost_cur: 70_716_112.87681729,
    sell_amount_cur: 0,
    sell_amount_percentage: 0,
    sell_volume_cur: 0,
    buy_volume_cur: 0,
    buy_amount_cur: 0,
    netflow_usd: 0,
    netflow_amount: 0,
    buy_tx_count_cur: 0,
    sell_tx_count_cur: 0,
    current_buy_amount: 0,
    current_sell_amount: 0,
    current_transfer_in_amount: 26_753_718_686_286.164,
    current_transfer_out_amount: 5_192_040_314_846,
    history_bought_cost: 0,
    history_bought_fee: 0,
    history_sold_income: 0,
    history_sold_fee: 0,
    history_transfer_in_amount: 26_753_718_686_286.164,
    history_transfer_in_cost: 84_812_216.46858647,
    history_transfer_out_amount: 5_192_040_314_846,
    history_transfer_out_income: 16_715_917.598629706,
    history_transfer_out_fee: 0.7097853483392665,
    transfer_in_count: 3,
    transfer_out_count: 7,
    wallet_tag_v2: "TOP1",
    profit: 8_150_930.766995631,
    total_cost: 84_812_217.17837182,
    profit_change: 0.09610562060714788,
    realized_profit: 2_383_179.4143355717,
    realized_pnl: 0.16627523531735675,
    unrealized_profit: 5_767_751.35266006,
    unrealized_pnl: 0.08156205308834064,
    avg_cost: null,
    avg_sold: null,
    transfer_in: true,
    is_new: false,
    is_suspicious: false,
    is_on_curve: true,
    start_holding_at: null,
    end_holding_at: null,
    last_block: 25_845_147,
    last_active_timestamp: 1_787_816_699,
    native_transfer: {
      name: null,
      from_address: "0x0000000000000000000000000000000000000099",
      amount: "5491",
      timestamp: 1_740_470_663,
      tx_hash: "",
    },
    token_transfer: {
      name: null,
      address: "",
      timestamp: 0,
      tx_hash: "",
      type: "transfer_in",
    },
    token_transfer_in: {
      name: null,
      address: "",
      timestamp: 0,
      tx_hash: "",
      type: "transfer_in",
    },
    token_transfer_out: {
      name: null,
      address: "",
      timestamp: 0,
      tx_hash: "",
      type: "holding",
    },
    tags: ["bluechip_owner"],
    maker_token_tags: ["top_holder", "transfer_in"],
    name: "Known exchange",
    avatar: null,
    twitter_username: null,
    twitter_name: null,
    created_at: 1_740_470_663,
  };
}

function rankingQuery(
  overrides: Partial<GmgnTokenRankingQueryV1> = {},
): GmgnTokenRankingQueryV1 {
  return {
    limit: 20,
    orderBy: "amount_percentage",
    direction: "desc",
    tag: null,
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(
    status === 200
      ? { code: 0, data }
      : data,
  ), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function accountGate(): GmgnAccountGateV1 & Readonly<{
  reserveSlot: ReturnType<typeof vi.fn>;
  blockUntil: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
}> {
  const reservation = {
    kind: "reserved" as const,
    reservedAtMs: NOW.getTime(),
    generation: 1,
    holder: "00000000-0000-4000-8000-000000000001",
  };
  return {
    reserveSlot: vi.fn(async () => reservation),
    blockUntil: vi.fn(async () => ({
      blockedUntilMs: NOW.getTime() + 5_000,
      retryAfterMs: 5_000,
    })),
    complete: vi.fn(async () => {}),
  };
}

describe("GMGN Ethereum token analytics", () => {
  beforeEach(() => {
    vi.stubEnv("GMGN_API_KEY", "gmgn-test-server-only");
    vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", "20");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("normalizes the current official Ethereum security response", () => {
    const market = identity(1);
    const result = parseGmgnTokenSecurityV1(
      securityData(market),
      market,
      NOW,
    );

    expect(result).toMatchObject({
      schemaVersion: "programmable.gmgn-token-security.v1",
      source: "gmgn",
      fetchedAt: NOW.toISOString(),
      identity: market,
      tokenAddress: market.tokenAddress,
      isOpenSource: true,
      isBlacklisted: false,
      isHoneypot: false,
      isOwnerRenounced: true,
      top10HolderRatio: "0.12",
      sellTaxRatio: "0.01",
      flags: ["verified"],
      lockSummary: {
        isLocked: true,
        lockRatio: "0.95",
        remainingLockRatio: "0.05",
      },
    });
    expect(result?.lockSummary?.details).toEqual([{
      ratio: "0.95",
      poolAddress: "0x0000000000000000000000000000000000000001",
      isBlackhole: true,
    }]);
  });

  it("rejects security data for another token or a non-Ethereum identity", () => {
    const market = identity(2);
    expect(parseGmgnTokenSecurityV1(
      { ...securityData(market), address: identity(3).tokenAddress },
      market,
      NOW,
    )).toBeNull();
    expect(parseGmgnTokenSecurityV1(
      securityData(market),
      { ...market, chainId: "8453" } as unknown as MarketChartIdentityV1,
      NOW,
    )).toBeNull();
  });

  it("accepts only the exact canonical Uniswap v4 pool binding", () => {
    const market = identity(4);
    expect(parseGmgnTokenPoolInfoV1(poolData(market), market, NOW))
      .toMatchObject({
        schemaVersion: "programmable.gmgn-token-pool-info.v1",
        identity: market,
        tokenAddress: market.tokenAddress,
        poolAddress: market.poolId,
        quoteAddress: market.quoteAddress,
        exchange: "uniswap_v4",
        liquidityUsd: "114067973.55976297",
        feeRatio: "0.003",
      });

    expect(parseGmgnTokenPoolInfoV1(
      { ...poolData(market), pool_address: identity(5).poolId },
      market,
      NOW,
    )).toBeNull();
    expect(parseGmgnTokenPoolInfoV1(
      { ...poolData(market), exchange: "uniswap_v3" },
      market,
      NOW,
    )).toBeNull();
    expect(parseGmgnTokenPoolInfoV1(
      { ...poolData(market), token0_address: market.tokenAddress },
      market,
      NOW,
    )).toBeNull();
  });

  it("accepts an omitted or exact eth chain and rejects foreign provider chains", () => {
    const market = identity(41);
    expect(parseGmgnTokenSecurityV1(
      { ...securityData(market), chain: "eth" },
      market,
      NOW,
    )).not.toBeNull();
    expect(parseGmgnTokenSecurityV1(
      { ...securityData(market), chain: "sol" },
      market,
      NOW,
    )).toBeNull();
    expect(parseGmgnTokenPoolInfoV1(
      { ...poolData(market), chain: "base" },
      market,
      NOW,
    )).toBeNull();
    expect(parseGmgnTokenWalletRankingV1(
      { chain: "bsc", list: [rankedWallet()] },
      "holders",
      market,
      rankingQuery(),
      NOW,
    )).toBeNull();
    expect(parseGmgnTokenWalletRankingV1(
      { list: [{ ...rankedWallet(), chain: "robinhood" }] },
      "holders",
      market,
      rankingQuery(),
      NOW,
    )).toBeNull();
    expect(parseGmgnTokenSecurityV1(
      { chain: "eth", data: securityData(market) },
      market,
      NOW,
    )).not.toBeNull();
    expect(parseGmgnTokenSecurityV1(
      { chain: "sol", data: securityData(market) },
      market,
      NOW,
    )).toBeNull();
    expect(parseGmgnTokenPoolInfoV1(
      { chain: "base", data: poolData(market) },
      market,
      NOW,
    )).toBeNull();
    expect(parseGmgnTokenWalletRankingV1(
      { chain: "bsc", data: { list: [rankedWallet()] } },
      "holders",
      market,
      rankingQuery(),
      NOW,
    )).toBeNull();
  });

  it.each(["holders", "traders"] as const)(
    "parses the official shared %s row schema without settlement precision claims",
    (kind) => {
      const market = identity(kind === "holders" ? 6 : 7);
      const result = parseGmgnTokenWalletRankingV1(
        { list: [rankedWallet()] },
        kind,
        market,
        rankingQuery({ tag: "bluechip_owner" }),
        NOW,
      );

      expect(result).toMatchObject({
        schemaVersion: "programmable.gmgn-token-wallet-ranking.v1",
        source: "gmgn",
        kind,
        tokenAddress: market.tokenAddress,
        query: {
          limit: 20,
          orderBy: "amount_percentage",
          direction: "desc",
          tag: "bluechip_owner",
        },
      });
      expect(result?.wallets[0]).toMatchObject({
        address: "0x000000000000000000000000000000000000005b",
        nativeBalanceRaw: "6670855275339409439764",
        amountRatio: 0.0918604120446466,
        profitUsd: 8_150_930.766995631,
        tags: ["bluechip_owner"],
        makerTokenTags: ["top_holder", "transfer_in"],
        nativeTransfer: {
          fromAddress: "0x0000000000000000000000000000000000000099",
          amount: "5491",
        },
      });
    },
  );

  it("fails closed when a ranking exceeds its limit or repeats a wallet", () => {
    const market = identity(8);
    expect(parseGmgnTokenWalletRankingV1(
      { list: [rankedWallet(), rankedWallet(92)] },
      "holders",
      market,
      rankingQuery({ limit: 1 }),
      NOW,
    )).toBeNull();
    expect(parseGmgnTokenWalletRankingV1(
      { list: [rankedWallet(), rankedWallet()] },
      "holders",
      market,
      rankingQuery(),
      NOW,
    )).toBeNull();
  });

  it("uses only exist auth and sends canonical Ethereum endpoint queries", async () => {
    const market = identity(9);
    const gate = accountGate();
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://openapi.gmgn.ai");
      expect(url.pathname).toBe("/v1/market/token_top_holders");
      expect(url.searchParams.get("chain")).toBe("eth");
      expect(url.searchParams.get("address")).toBe(market.tokenAddress);
      expect(url.searchParams.get("limit")).toBe("50");
      expect(url.searchParams.get("order_by")).toBe("profit");
      expect(url.searchParams.get("direction")).toBe("desc");
      expect(url.searchParams.get("tag")).toBe("smart_degen");
      expect(url.searchParams.has("private_key")).toBe(false);
      expect(url.searchParams.has("signature")).toBe(false);
      expect(init).toMatchObject({
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      expect(init?.headers).toEqual({
        Accept: "application/json",
        "X-APIKEY": "gmgn-test-server-only",
      });
      return jsonResponse({ list: [rankedWallet()] });
    });

    const reads = await Promise.all([
      readGmgnTokenTopHoldersV1(
        market,
        { limit: 50, orderBy: "profit", tag: "smart_degen" },
        { fetchImpl, accountGate: gate, now: () => NOW },
      ),
      readGmgnTokenTopHoldersV1(
        market,
        { limit: 50, orderBy: "profit", tag: "smart_degen" },
        { fetchImpl, accountGate: gate, now: () => NOW },
      ),
    ]);

    expect(reads.every((value) => value?.wallets.length === 1)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(gate.reserveSlot).toHaveBeenCalledWith(expect.objectContaining({
      requestsPerSecond: 20,
      cost: 5,
    }));
    expect(gate.complete).toHaveBeenCalledTimes(1);
  });

  it("falls back to one RPS when the override exceeds the official ceiling", async () => {
    vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", "21");
    const market = identity(90);
    const gate = accountGate();
    const fetchImpl = vi.fn(async () => jsonResponse(securityData(market)));

    await expect(readGmgnTokenSecurityV1(market, {
      fetchImpl,
      accountGate: gate,
      now: () => NOW,
    })).resolves.not.toBeNull();
    expect(gate.reserveSlot).toHaveBeenCalledWith(expect.objectContaining({
      requestsPerSecond: 1,
      cost: 1,
    }));
  });

  it.each(["security", "pool", "holders"] as const)(
    "fails soft when the %s endpoint declares a foreign outer chain",
    async (kind) => {
      const market = identity(kind === "security" ? 93 : kind === "pool" ? 94 : 95);
      const data = kind === "security"
        ? securityData(market)
        : kind === "pool"
          ? poolData(market)
          : { list: [rankedWallet()] };
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
        code: 0,
        chain: "sol",
        data,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

      const result = kind === "security"
        ? await readGmgnTokenSecurityV1(market, { fetchImpl, now: () => NOW })
        : kind === "pool"
          ? await readGmgnTokenPoolInfoV1(market, { fetchImpl, now: () => NOW })
          : await readGmgnTokenTopHoldersV1(
              market,
              {},
              { fetchImpl, now: () => NOW },
            );
      expect(result).toBeNull();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("caches successful security and pool reads independently", async () => {
    const securityMarket = identity(10);
    const poolMarket = identity(11);
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/token/security") {
        return jsonResponse(securityData(securityMarket));
      }
      return jsonResponse(poolData(poolMarket));
    });

    const firstSecurity = await readGmgnTokenSecurityV1(
      securityMarket,
      { fetchImpl, now: () => NOW },
    );
    const secondSecurity = await readGmgnTokenSecurityV1(
      securityMarket,
      { fetchImpl, now: () => NOW },
    );
    const firstPool = await readGmgnTokenPoolInfoV1(
      poolMarket,
      { fetchImpl, now: () => NOW },
    );
    const secondPool = await readGmgnTokenPoolInfoV1(
      poolMarket,
      { fetchImpl, now: () => NOW },
    );

    expect(firstSecurity).toEqual(secondSecurity);
    expect(firstPool).toEqual(secondPool);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not let an aborted first caller cancel or poison shared analytics", async () => {
    const market = identity(91);
    let resolveProvider: ((response: Response) => void) | undefined;
    let providerSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
      providerSignal = init?.signal;
      return new Promise<Response>((resolve) => {
        resolveProvider = resolve;
      });
    });
    const firstController = new AbortController();
    const wait = {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    };

    const first = readGmgnTokenSecurityV1(market, {
      ...wait,
      signal: firstController.signal,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const second = readGmgnTokenSecurityV1(market, wait);
    firstController.abort();
    await expect(first).resolves.toBeNull();
    expect(providerSignal).not.toBe(firstController.signal);
    expect(providerSignal?.aborted).toBe(false);

    resolveProvider?.(jsonResponse(securityData(market)));
    const exact = await second;
    expect(exact?.tokenAddress).toBe(market.tokenAddress);
    await expect(readGmgnTokenSecurityV1(market, wait)).resolves.toEqual(exact);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects unbounded or unknown ranking controls before any request", async () => {
    const fetchImpl = vi.fn();
    const market = identity(12);
    expect(await readGmgnTokenTopHoldersV1(
      market,
      { limit: 101 },
      { fetchImpl, now: () => NOW },
    )).toBeNull();
    expect(await readGmgnTokenTopTradersV1(
      market,
      { orderBy: "volume" as "profit" },
      { fetchImpl, now: () => NOW },
    )).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails soft and publishes one shared cooldown on provider rate limits", async () => {
    const market = identity(13);
    const gate = accountGate();
    const resetAt = Math.floor(NOW.getTime() / 1_000) + 30;
    const fetchImpl = vi.fn(async () => jsonResponse({
      code: 429,
      error: "RATE_LIMIT_EXCEEDED",
      reset_at: resetAt,
    }, 429, { "X-RateLimit-Reset": String(resetAt) }));

    await expect(readGmgnTokenTopTradersV1(
      market,
      {},
      { fetchImpl, accountGate: gate, now: () => NOW },
    )).resolves.toBeNull();
    expect(gate.blockUntil).toHaveBeenCalledWith({
      reservation: expect.objectContaining({ kind: "reserved" }),
      blockedUntilMs: NOW.getTime() + 30_250,
      providerSignal: "http-429",
    });
    expect(gate.complete).not.toHaveBeenCalled();

    const secondFetch = vi.fn();
    await expect(readGmgnTokenTopTradersV1(
      identity(14),
      {},
      { fetchImpl: secondFetch, now: () => new Date(NOW.getTime() + 1_000) },
    )).resolves.toBeNull();
    expect(secondFetch).not.toHaveBeenCalled();
  });
});
