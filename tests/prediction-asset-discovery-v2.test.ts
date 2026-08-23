import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPredictionAssetDiscoveryReaderV2,
} from "../lib/market-data/prediction-asset-discovery-v2.server";
import type {
  PredictionCustomAssetSelectionV2,
  PredictionSourceNetworkIdV2,
} from "../lib/prediction-market-assets-v2";

const OBSERVED_AT = "2026-08-23T16:30:00.000Z";
const EVM_ADDRESS = `0x${"Ab".repeat(20)}`;
const OTHER_EVM_ADDRESS = `0x${"cd".repeat(20)}`;
const SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function selection(
  sourceNetwork: PredictionSourceNetworkIdV2,
  assetLocator = sourceNetwork === "solana" ? SOLANA_MINT : EVM_ADDRESS,
): PredictionCustomAssetSelectionV2 {
  return { mode: "custom", sourceNetwork, assetLocator };
}

function pair(input: Readonly<{
  chainId: string;
  tokenAddress: string;
  pairAddress?: string;
  dexId?: string;
  priceUsd?: string | null;
  liquidityUsd?: number | null;
  marketCap?: number | null;
  fdv?: number | null;
  quoteAddress?: string;
}>) {
  return {
    chainId: input.chainId,
    dexId: input.dexId ?? "uniswap",
    pairAddress: input.pairAddress ?? "pair-1",
    baseToken: { address: input.tokenAddress },
    quoteToken: { address: input.quoteAddress ?? OTHER_EVM_ADDRESS },
    priceUsd: input.priceUsd === undefined ? "1.25" : input.priceUsd,
    liquidity: {
      usd: input.liquidityUsd === undefined ? 10_000 : input.liquidityUsd,
    },
    marketCap: input.marketCap === undefined ? 1_000_000 : input.marketCap,
    fdv: input.fdv === undefined ? 1_200_000 : input.fdv,
  };
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function reader(
  fetchImpl: typeof fetch,
  overrides: Partial<
    Parameters<typeof createPredictionAssetDiscoveryReaderV2>[0]
  > = {},
) {
  return createPredictionAssetDiscoveryReaderV2({
    fetchImpl,
    now: () => new Date(OBSERVED_AT),
    timeoutMs: 100,
    maximumResponseBytes: 512_000,
    maximumRows: 256,
    ...overrides,
  });
}

describe("prediction asset discovery V2", () => {
  beforeEach(() => vi.useRealTimers());

  it.each([
    ["ethereum", "ethereum", "1"],
    ["base", "base", "8453"],
    ["bnb", "bsc", "56"],
    ["robinhood", "robinhood", "4663"],
    [
      "solana",
      "solana",
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    ],
  ] as const)(
    "binds explicit %s selection to the %s provider chain",
    async (sourceNetwork, providerChainId, chainReference) => {
      const input = selection(sourceNetwork);
      const expectedLocator = sourceNetwork === "solana"
        ? SOLANA_MINT
        : EVM_ADDRESS.toLowerCase();
      const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
        expect(String(url)).toBe(
          `https://api.dexscreener.com/token-pairs/v1/${providerChainId}/${expectedLocator}`,
        );
        expect(init).toMatchObject({
          method: "GET",
          cache: "no-store",
          redirect: "error",
        });
        return jsonResponse([
          pair({
            chainId: providerChainId,
            tokenAddress: expectedLocator,
            pairAddress: `pair-${providerChainId}`,
          }),
        ]);
      });

      const result = await reader(fetchImpl).read(input);

      expect(result).toMatchObject({
        schemaVersion: 2,
        selectionKey: sourceNetwork === "solana"
          ? `solana:${chainReference}:${SOLANA_MINT}`
          : `evm:${chainReference}:${EVM_ADDRESS.toLowerCase()}`,
        status: "available",
        source: "dexscreener",
        observedAt: OBSERVED_AT,
        usage: "informational-only",
        currentPriceUsd: 1.25,
        marketCapUsd: 1_000_000,
        pair: { providerChainId },
      });
      expect(result).not.toHaveProperty("assetKey");
      expect(result).not.toHaveProperty("oracleStatus");
      expect(result).not.toHaveProperty("releaseId");
      expect(result).not.toHaveProperty("settlementEligible");
    },
  );

  it("selects the deepest exact pair with deterministic lexical tie-breaking", async () => {
    const exact = EVM_ADDRESS.toLowerCase();
    const rows = [
      pair({
        chainId: "ethereum",
        tokenAddress: exact,
        pairAddress: "0xbbb",
        dexId: "zeta",
        priceUsd: "2.50",
        liquidityUsd: 50_000,
        marketCap: 2_500_000,
      }),
      pair({
        chainId: "ethereum",
        tokenAddress: exact,
        pairAddress: "0xaaa",
        dexId: "alpha",
        priceUsd: "2.25",
        liquidityUsd: 50_000,
        marketCap: 2_250_000,
      }),
      pair({
        chainId: "ethereum",
        tokenAddress: exact,
        pairAddress: "0xccc",
        priceUsd: "9.99",
        liquidityUsd: 49_999,
        marketCap: 9_990_000,
      }),
    ];
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(rows))
      .mockResolvedValueOnce(jsonResponse([...rows].reverse()));
    const discovery = reader(fetchImpl);

    const first = await discovery.read(selection("ethereum"));
    const reversed = await discovery.read(selection("ethereum"));

    expect(first).toMatchObject({
      status: "available",
      currentPriceUsd: 2.25,
      marketCapUsd: 2_250_000,
      pair: {
        dexId: "alpha",
        pairAddress: "0xaaa",
        liquidityUsd: 50_000,
      },
    });
    expect(reversed).toEqual(first);
  });

  it("ignores foreign chains, wrong base tokens and quote-side-only matches", async () => {
    const exact = EVM_ADDRESS.toLowerCase();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse([
      pair({
        chainId: "base",
        tokenAddress: exact,
        liquidityUsd: 1_000_000,
      }),
      pair({
        chainId: "ethereum",
        tokenAddress: OTHER_EVM_ADDRESS,
        quoteAddress: exact,
        liquidityUsd: 900_000,
      }),
      pair({
        chainId: "ethereum",
        tokenAddress: OTHER_EVM_ADDRESS,
        liquidityUsd: 800_000,
      }),
      pair({
        chainId: "ethereum",
        tokenAddress: EVM_ADDRESS,
        pairAddress: "0xexact",
        liquidityUsd: 100,
      }),
    ]));

    await expect(reader(fetchImpl).read(selection("ethereum"))).resolves
      .toMatchObject({
        status: "available",
        pair: { pairAddress: "0xexact", liquidityUsd: 100 },
      });
  });

  it("does not substitute FDV when provider market cap is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse([
      pair({
        chainId: "bsc",
        tokenAddress: EVM_ADDRESS.toLowerCase(),
        marketCap: null,
        fdv: 99_000_000,
      }),
    ]));

    const result = await reader(fetchImpl).read(selection("bnb"));

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "market-data-unavailable",
      source: "dexscreener",
      observedAt: OBSERVED_AT,
      usage: "informational-only",
    });
    expect(result).not.toHaveProperty("currentPriceUsd");
    expect(result).not.toHaveProperty("marketCapUsd");
  });

  it("fails closed before fetch for incomplete or cross-namespace locators", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const discovery = reader(fetchImpl);

    await expect(discovery.read({
      mode: "custom",
      sourceNetwork: "",
      assetLocator: EVM_ADDRESS,
    })).resolves.toMatchObject({
      selectionKey: null,
      status: "unavailable",
      reason: "invalid-selection",
    });
    await expect(discovery.read({
      mode: "custom",
      sourceNetwork: "solana",
      assetLocator: EVM_ADDRESS,
    })).resolves.toMatchObject({
      selectionKey: null,
      status: "unavailable",
      reason: "invalid-selection",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [jsonResponse({ pairs: [] }), "response-invalid"],
    [jsonResponse([pair({
      chainId: "ethereum",
      tokenAddress: EVM_ADDRESS.toLowerCase(),
      marketCap: null,
    }), "not-a-row"]), "response-invalid"],
    [jsonResponse([pair({
      chainId: "ethereum",
      tokenAddress: EVM_ADDRESS.toLowerCase(),
    })], 200, { "content-length": "999999" }), "response-too-large"],
  ] as const)("fails closed on invalid or oversized responses", async (
    response,
    reason,
  ) => {
    const result = await reader(vi.fn(async () => response), {
      maximumResponseBytes: 1_000,
    }).read(selection("ethereum"));
    expect(result).toMatchObject({ status: "unavailable", reason });
  });

  it("enforces the byte cap even when the body has no declared length", async () => {
    const oversized = jsonResponse([
      pair({
        chainId: "ethereum",
        tokenAddress: EVM_ADDRESS.toLowerCase(),
      }),
    ]);
    oversized.headers.delete("content-length");

    const result = await reader(vi.fn(async () => oversized), {
      maximumResponseBytes: 64,
    }).read(selection("ethereum"));

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "response-too-large",
    });
  });

  it("bounds a provider that ignores AbortSignal", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const pending = reader(fetchImpl, { timeoutMs: 100 })
      .read(selection("ethereum"));

    await vi.advanceTimersByTimeAsync(101);

    await expect(pending).resolves.toMatchObject({
      status: "unavailable",
      reason: "timeout",
    });
    expect(signal?.aborted).toBe(true);
  });

  it("propagates caller cancellation as an unavailable informational read", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const controller = new AbortController();
    const pending = reader(fetchImpl).read(selection("ethereum"), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    controller.abort();

    await expect(pending).resolves.toMatchObject({
      status: "unavailable",
      reason: "aborted",
    });
    expect(signal?.aborted).toBe(true);
  });

  it.each([
    [429, "rate-limited"],
    [500, "provider-unavailable"],
  ] as const)("classifies provider HTTP %s without exposing its body", async (
    status,
    reason,
  ) => {
    const result = await reader(vi.fn(async () => jsonResponse(
      { secret: "provider detail" },
      status,
    ))).read(selection("robinhood"));
    expect(result).toMatchObject({ status: "unavailable", reason });
    expect(JSON.stringify(result)).not.toContain("provider detail");
  });
});
