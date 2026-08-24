import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPredictionAssetAutoDiscoveryReaderV2,
  type PredictionAssetAutoDiscoveryReaderOptionsV2,
} from "../lib/market-data/prediction-asset-auto-discovery-v2.server";

const OBSERVED_AT = "2026-08-23T18:00:00.000Z";
const EVM_ADDRESS = `0x${"Ab".repeat(20)}`;
const CANONICAL_EVM_ADDRESS = EVM_ADDRESS.toLowerCase();
const OTHER_EVM_ADDRESS = `0x${"cd".repeat(20)}`;
const SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OTHER_SOLANA_MINT = "So11111111111111111111111111111111111111112";
const EVM_NETWORKS = ["ethereum", "base", "bnb", "robinhood"] as const;

function identityVerifier(
  verified: readonly (typeof EVM_NETWORKS)[number][] | readonly ["solana"] = [],
  failed: Partial<Record<
    (typeof EVM_NETWORKS)[number] | "solana",
    "identity-unconfigured" | "identity-unavailable" | "identity-invalid"
  >> = {},
) {
  const verifiedNetworks = new Set<string>(verified);
  return Object.freeze({
    verify: vi.fn(async (locator: string) => {
      const networks = locator.startsWith("0x") ? EVM_NETWORKS : ["solana"] as const;
      return networks.map((sourceNetwork) => {
        const reason = failed[sourceNetwork];
        if (reason) return { sourceNetwork, status: "failed" as const, reason };
        return verifiedNetworks.has(sourceNetwork)
          ? { sourceNetwork, status: "verified-token" as const }
          : { sourceNetwork, status: "not-token" as const };
      });
    }),
  });
}

function injectedIdentityVerifier(probes: unknown) {
  return {
    verify: vi.fn(async () => probes),
  } as unknown as NonNullable<
    PredictionAssetAutoDiscoveryReaderOptionsV2["identityVerifier"]
  >;
}

type PairInput = Readonly<{
  chainId: string;
  locator: string;
  namespace?: "evm" | "solana";
  matchedSide?: "base" | "quote";
  pairAddress?: string;
  dexId?: string;
  priceUsd?: string | null;
  priceNative?: string | null;
  liquidityUsd?: number | null;
  volume24hUsd?: number | null;
  marketCap?: number | null;
  fdv?: number | null;
  pairCreatedAt?: number | null;
  tokenName?: string;
  tokenSymbol?: string;
  info?: unknown;
}>;

function pair(input: PairInput) {
  const namespace = input.namespace ?? "evm";
  const other = namespace === "evm" ? OTHER_EVM_ADDRESS : OTHER_SOLANA_MINT;
  const matchedToken = {
    address: input.locator,
    name: input.tokenName ?? "Example Token",
    symbol: input.tokenSymbol ?? "EXM",
  };
  const otherToken = { address: other, name: "USD Coin", symbol: "USDC" };
  return {
    chainId: input.chainId,
    dexId: input.dexId ?? "uniswap",
    pairAddress: input.pairAddress ?? `0x${"ef".repeat(20)}`,
    baseToken: input.matchedSide === "quote" ? otherToken : matchedToken,
    quoteToken: input.matchedSide === "quote" ? matchedToken : otherToken,
    priceUsd: input.priceUsd === undefined ? "1.25" : input.priceUsd,
    priceNative: input.priceNative === undefined ? "2.5" : input.priceNative,
    liquidity: input.liquidityUsd === undefined
      ? { usd: 75_000 }
      : input.liquidityUsd === null
        ? null
        : { usd: input.liquidityUsd },
    volume: input.volume24hUsd === undefined
      ? { h24: 50_000 }
      : input.volume24hUsd === null
        ? null
        : { h24: input.volume24hUsd },
    marketCap: input.marketCap === undefined ? 2_000_000 : input.marketCap,
    fdv: input.fdv === undefined ? 2_500_000 : input.fdv,
    pairCreatedAt: input.pairCreatedAt === undefined
      ? 1_700_000_000_000
      : input.pairCreatedAt,
    info: input.info,
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
    Parameters<typeof createPredictionAssetAutoDiscoveryReaderV2>[0]
  > = {},
) {
  return createPredictionAssetAutoDiscoveryReaderV2({
    fetchImpl,
    identityVerifier: identityVerifier(),
    now: () => new Date(OBSERVED_AT),
    timeoutMs: 100,
    maximumResponseBytes: 512_000,
    maximumRows: 256,
    ...overrides,
  });
}

function providerChainId(url: URL | RequestInfo) {
  const segments = new URL(String(url)).pathname.split("/");
  return segments.at(-2) ?? "";
}

describe("prediction asset auto-discovery V2", () => {
  beforeEach(() => vi.useRealTimers());

  it.each([
    "",
    "not-an-address",
    `0x${"ab".repeat(19)}`,
    `0x${"0".repeat(40)}`,
    "1111111111111111111111111111111",
    "1".repeat(32),
    `${SOLANA_MINT}0`,
  ])("rejects an invalid raw locator without a provider request: %s", async (
    locator,
  ) => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(reader(fetchImpl).read(locator)).resolves.toEqual({
      schemaVersion: 2,
      locator: null,
      status: "invalid",
      reason: "invalid-locator",
      source: null,
      observedAt: OBSERVED_AT,
      usage: "informational-only",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("auto-selects only after all chains verify exactly one token deployment", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(init).toMatchObject({
        method: "GET",
        cache: "no-store",
        redirect: "error",
      });
      const chainId = providerChainId(url);
      return jsonResponse(chainId === "base"
        ? [pair({ chainId, locator: CANONICAL_EVM_ADDRESS })]
        : []);
    });

    const result = await reader(fetchImpl, {
      identityVerifier: identityVerifier(["base"]),
    }).read(`  ${EVM_ADDRESS}  `);

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      `https://api.dexscreener.com/token-pairs/v1/ethereum/${CANONICAL_EVM_ADDRESS}`,
      `https://api.dexscreener.com/token-pairs/v1/base/${CANONICAL_EVM_ADDRESS}`,
      `https://api.dexscreener.com/token-pairs/v1/bsc/${CANONICAL_EVM_ADDRESS}`,
      `https://api.dexscreener.com/token-pairs/v1/robinhood/${CANONICAL_EVM_ADDRESS}`,
    ]);
    expect(result).toMatchObject({
      schemaVersion: 2,
      locator: CANONICAL_EVM_ADDRESS,
      status: "unique",
      source: "dexscreener",
      observedAt: OBSERVED_AT,
      usage: "informational-only",
      candidate: {
        selectionKey: `evm:8453:${CANONICAL_EVM_ADDRESS}`,
        selection: {
          mode: "custom",
          sourceNetwork: "base",
          assetLocator: CANONICAL_EVM_ADDRESS,
        },
        namespace: "evm",
        chainReference: "8453",
        providerChainId: "base",
        provenance: {
          identity: { source: "onchain-rpc" },
          enrichment: { source: "dexscreener" },
        },
        currentPriceUsd: 1.25,
        marketCapUsd: 2_000_000,
        fdvUsd: 2_500_000,
        matchingPairCount: 1,
      },
    });
    expect(result).not.toHaveProperty("settlementEligible");
    expect(result.status === "unique" && result.candidate)
      .not.toHaveProperty("settlementEligible");
  });

  it("returns inconclusive instead of a false unique result when any identity probe fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      if (chainId === "base") {
        return jsonResponse([pair({
          chainId,
          locator: CANONICAL_EVM_ADDRESS,
        })]);
      }
      return jsonResponse([]);
    });

    const result = await reader(fetchImpl, {
      identityVerifier: identityVerifier(["base"], {
        robinhood: "identity-unavailable",
      }),
    }).read(EVM_ADDRESS);

    expect(result).toMatchObject({
      status: "inconclusive",
      candidates: [{ selection: { sourceNetwork: "base" } }],
      failures: [{
        sourceNetwork: "robinhood",
        reason: "identity-unavailable",
      }],
    });
  });

  it("keeps a verified identity candidate when DEX enrichment is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 503));

    const result = await reader(fetchImpl, {
      identityVerifier: identityVerifier(["base"]),
    }).read(EVM_ADDRESS);

    expect(result).toMatchObject({
      status: "unique",
      source: null,
      candidate: {
        selectionKey: `evm:8453:${CANONICAL_EVM_ADDRESS}`,
        selection: { sourceNetwork: "base" },
        token: {
          address: CANONICAL_EVM_ADDRESS,
          name: null,
          symbol: null,
        },
        currentPriceUsd: null,
        marketCapUsd: null,
        fdvUsd: null,
        matchingPairCount: 0,
        pair: null,
        provenance: {
          identity: { source: "onchain-rpc" },
          enrichment: null,
        },
        links: { imageUrl: null, websites: [], socials: [] },
      },
    });
    expect(result).not.toHaveProperty("failures");
  });

  it("keeps a verified identity candidate but stays inconclusive for another unresolved chain", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 503));

    const result = await reader(fetchImpl, {
      identityVerifier: identityVerifier(["base"], {
        robinhood: "identity-unavailable",
      }),
    }).read(EVM_ADDRESS);

    expect(result).toMatchObject({
      status: "inconclusive",
      source: null,
      candidates: [{
        selection: { sourceNetwork: "base" },
        matchingPairCount: 0,
        pair: null,
        provenance: {
          identity: { source: "onchain-rpc" },
          enrichment: null,
        },
      }],
      failures: [{
        sourceNetwork: "robinhood",
        reason: "identity-unavailable",
      }],
    });
  });

  it("never mistakes one indexed EVM pool for chain identity", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      return jsonResponse(chainId === "base"
        ? [pair({ chainId, locator: CANONICAL_EVM_ADDRESS })]
        : []);
    });

    const result = await reader(fetchImpl, {
      identityVerifier: identityVerifier(["ethereum"]),
    }).read(EVM_ADDRESS);

    expect(result).toMatchObject({
      status: "inconclusive",
      candidates: [{
        selection: { sourceNetwork: "ethereum" },
        matchingPairCount: 0,
        pair: null,
      }],
      failures: [{ sourceNetwork: "base", reason: "identity-mismatch" }],
    });
  });

  it.each([
    ["non-array set", null],
    ["unknown status", [
      { sourceNetwork: "ethereum", status: "unknown" },
      { sourceNetwork: "base", status: "verified-token" },
      { sourceNetwork: "bnb", status: "not-token" },
      { sourceNetwork: "robinhood", status: "not-token" },
    ]],
    ["invalid failure reason", [
      { sourceNetwork: "ethereum", status: "failed", reason: "timeout" },
      { sourceNetwork: "base", status: "verified-token" },
      { sourceNetwork: "bnb", status: "not-token" },
      { sourceNetwork: "robinhood", status: "not-token" },
    ]],
    ["unknown network", [
      { sourceNetwork: "polygon", status: "not-token" },
      { sourceNetwork: "base", status: "verified-token" },
      { sourceNetwork: "bnb", status: "not-token" },
      { sourceNetwork: "robinhood", status: "not-token" },
    ]],
    ["null row", [
      null,
      { sourceNetwork: "base", status: "verified-token" },
      { sourceNetwork: "bnb", status: "not-token" },
      { sourceNetwork: "robinhood", status: "not-token" },
    ]],
    ["duplicate network", [
      { sourceNetwork: "ethereum", status: "not-token" },
      { sourceNetwork: "base", status: "verified-token" },
      { sourceNetwork: "bnb", status: "not-token" },
      { sourceNetwork: "ethereum", status: "not-token" },
    ]],
    ["missing row", [
      { sourceNetwork: "ethereum", status: "not-token" },
      { sourceNetwork: "base", status: "verified-token" },
      { sourceNetwork: "bnb", status: "not-token" },
    ]],
    ["extra key", [
      { sourceNetwork: "ethereum", status: "not-token", extra: true },
      { sourceNetwork: "base", status: "verified-token" },
      { sourceNetwork: "bnb", status: "not-token" },
      { sourceNetwork: "robinhood", status: "not-token" },
    ]],
    ["non-plain row", [
      Object.assign(Object.create(null), {
        sourceNetwork: "ethereum",
        status: "not-token",
      }),
      { sourceNetwork: "base", status: "verified-token" },
      { sourceNetwork: "bnb", status: "not-token" },
      { sourceNetwork: "robinhood", status: "not-token" },
    ]],
  ])("fails closed for a malformed injected identity set: %s", async (
    _label,
    probes,
  ) => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      return jsonResponse(chainId === "base"
        ? [pair({ chainId, locator: CANONICAL_EVM_ADDRESS })]
        : []);
    });

    const result = await reader(fetchImpl, {
      identityVerifier: injectedIdentityVerifier(probes),
    }).read(EVM_ADDRESS);

    expect(result).toMatchObject({
      status: "inconclusive",
      candidates: [],
      failures: EVM_NETWORKS.map((sourceNetwork) => ({
        sourceNetwork,
        reason: "identity-invalid",
      })),
    });
  });

  it("contains throwing verifier getters as an inconclusive result", async () => {
    const throwing = {
      sourceNetwork: "ethereum",
      get status(): never {
        throw new Error("malicious getter");
      },
    };
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      return jsonResponse(chainId === "base"
        ? [pair({ chainId, locator: CANONICAL_EVM_ADDRESS })]
        : []);
    });

    await expect(reader(fetchImpl, {
      identityVerifier: injectedIdentityVerifier([
        throwing,
        { sourceNetwork: "base", status: "verified-token" },
        { sourceNetwork: "bnb", status: "not-token" },
        { sourceNetwork: "robinhood", status: "not-token" },
      ]),
    }).read(EVM_ADDRESS)).resolves.toMatchObject({
      status: "inconclusive",
      candidates: [],
      failures: EVM_NETWORKS.map((sourceNetwork) => ({
        sourceNetwork,
        reason: "identity-invalid",
      })),
    });
  });

  it("contains a verifier array with a throwing length trap", async () => {
    const probes = new Proxy([
      { sourceNetwork: "ethereum", status: "not-token" },
      { sourceNetwork: "base", status: "verified-token" },
      { sourceNetwork: "bnb", status: "not-token" },
      { sourceNetwork: "robinhood", status: "not-token" },
    ], {
      get(target, property, receiver) {
        if (property === "length") throw new Error("malicious length trap");
        return Reflect.get(target, property, receiver);
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      return jsonResponse(chainId === "base"
        ? [pair({ chainId, locator: CANONICAL_EVM_ADDRESS })]
        : []);
    });

    await expect(reader(fetchImpl, {
      identityVerifier: injectedIdentityVerifier(probes),
    }).read(EVM_ADDRESS)).resolves.toMatchObject({
      status: "inconclusive",
      candidates: [],
      failures: EVM_NETWORKS.map((sourceNetwork) => ({
        sourceNetwork,
        reason: "identity-invalid",
      })),
    });
  });

  it("returns every verified deployment even when one has no DEX enrichment", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      return jsonResponse(chainId === "base"
        ? [pair({ chainId, locator: CANONICAL_EVM_ADDRESS })]
        : []);
    });

    const result = await reader(fetchImpl, {
      identityVerifier: identityVerifier(["ethereum", "base"]),
    }).read(EVM_ADDRESS);

    expect(result).toMatchObject({
      status: "ambiguous",
      source: "dexscreener",
      candidates: [
        {
          selection: { sourceNetwork: "ethereum" },
          matchingPairCount: 0,
          pair: null,
          provenance: { enrichment: null },
        },
        {
          selection: { sourceNetwork: "base" },
          matchingPairCount: 1,
          provenance: { enrichment: { source: "dexscreener" } },
        },
      ],
    });
  });

  it("ignores DEX outages on chains proven not to contain the token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      if (chainId === "base") {
        return jsonResponse([pair({
          chainId,
          locator: CANONICAL_EVM_ADDRESS,
        })]);
      }
      if (chainId === "robinhood") return jsonResponse({}, 500);
      return jsonResponse([]);
    });

    await expect(reader(fetchImpl, {
      identityVerifier: identityVerifier(["base"]),
    }).read(EVM_ADDRESS)).resolves.toMatchObject({
      status: "unique",
      candidate: { selection: { sourceNetwork: "base" } },
    });
  });

  it("returns deterministic ambiguity when the address has pairs on multiple EVM chains", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      return jsonResponse(chainId === "ethereum" || chainId === "bsc"
        ? [pair({ chainId, locator: CANONICAL_EVM_ADDRESS })]
        : []);
    });

    const result = await reader(fetchImpl, {
      identityVerifier: identityVerifier(["ethereum", "bnb"]),
    }).read(EVM_ADDRESS);

    expect(result).toMatchObject({
      status: "ambiguous",
      candidates: [
        { selection: { sourceNetwork: "ethereum" }, chainReference: "1" },
        { selection: { sourceNetwork: "bnb" }, chainReference: "56" },
      ],
    });
  });

  it("returns not-found only after every EVM provider probe definitively returns no exact pair", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse([]));

    await expect(reader(fetchImpl).read(EVM_ADDRESS)).resolves.toMatchObject({
      locator: CANONICAL_EVM_ADDRESS,
      status: "not-found",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("recognizes a 32-byte Solana address and probes only Solana", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      expect(String(url)).toBe(
        `https://api.dexscreener.com/token-pairs/v1/solana/${SOLANA_MINT}`,
      );
      return jsonResponse([pair({
        chainId: "solana",
        locator: SOLANA_MINT,
        namespace: "solana",
        pairAddress: OTHER_SOLANA_MINT,
      })]);
    });

    await expect(reader(fetchImpl, {
      identityVerifier: identityVerifier(["solana"]),
    }).read(SOLANA_MINT)).resolves.toMatchObject({
      locator: SOLANA_MINT,
      status: "unique",
      candidate: {
        namespace: "solana",
        selectionKey:
          `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:${SOLANA_MINT}`,
        selection: { sourceNetwork: "solana", assetLocator: SOLANA_MINT },
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("counts an exact quote-side match but derives the quote price instead of using the base price", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      return jsonResponse(chainId === "base"
        ? [pair({
          chainId,
          locator: CANONICAL_EVM_ADDRESS,
          matchedSide: "quote",
          priceUsd: "2",
          priceNative: "4",
          marketCap: 99_000_000,
          fdv: 100_000_000,
          info: {
            imageUrl: "https://cdn.example.com/wrong-base-token.png",
            websites: [{
              label: "Wrong base token",
              url: "https://wrong-base-token.example.org",
            }],
            socials: [{
              type: "twitter",
              url: "https://x.com/wrong_base_token",
            }],
          },
        })]
        : []);
    });

    const result = await reader(fetchImpl, {
      identityVerifier: identityVerifier(["base"]),
    }).read(EVM_ADDRESS);

    expect(result).toMatchObject({
      status: "unique",
      candidate: {
        currentPriceUsd: 0.5,
        marketCapUsd: null,
        fdvUsd: null,
        matchingPairCount: 1,
        pair: { matchedSide: "quote" },
        links: { imageUrl: null, websites: [], socials: [] },
      },
    });
  });

  it("never substitutes an unorientable quote-side price", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      return jsonResponse(chainId === "ethereum"
        ? [pair({
          chainId,
          locator: CANONICAL_EVM_ADDRESS,
          matchedSide: "quote",
          priceUsd: "2",
          priceNative: null,
        })]
        : []);
    });

    await expect(reader(fetchImpl, {
      identityVerifier: identityVerifier(["ethereum"]),
    }).read(EVM_ADDRESS)).resolves.toMatchObject({
      status: "unique",
      candidate: {
        currentPriceUsd: null,
        marketCapUsd: null,
        fdvUsd: null,
        pair: { matchedSide: "quote" },
      },
    });
  });

  it("selects the deepest priced pair deterministically and sanitizes provider metadata and links", async () => {
    const shallowPair = pair({
      chainId: "base",
      locator: CANONICAL_EVM_ADDRESS,
      pairAddress: `0x${"11".repeat(20)}`,
      liquidityUsd: 10,
      priceUsd: "9",
    });
    const deepPair = pair({
      chainId: "base",
      locator: CANONICAL_EVM_ADDRESS,
      pairAddress: `0x${"22".repeat(20)}`,
      liquidityUsd: 100_000,
      volume24hUsd: 25_000,
      pairCreatedAt: 1_650_000_000_000,
      priceUsd: "3",
      tokenName: "  Example\n Coin  ",
      tokenSymbol: " EXM ",
      info: {
        imageUrl: "https://cdn.example.com/token.png#fragment",
        websites: [
          { label: "Site", url: "https://example.com" },
          { label: "Duplicate", url: "https://example.com/" },
          { label: "Unsafe", url: "javascript:alert(1)" },
          { label: "Insecure", url: "http://unsafe.example.com" },
          { label: "Private", url: "https://127.0.0.1/token" },
        ],
        socials: [
          { type: "Twitter", url: "https://x.com/example" },
          { type: "Telegram", url: "https://t.me/example" },
          { type: "Bad", url: "https://user:secret@example.com" },
        ],
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      return jsonResponse(chainId === "base"
        ? [shallowPair, deepPair]
        : []);
    });

    const result = await reader(fetchImpl, {
      identityVerifier: identityVerifier(["base"]),
    }).read(EVM_ADDRESS);

    expect(result).toMatchObject({
      status: "unique",
      candidate: {
        token: { name: null, symbol: "EXM" },
        currentPriceUsd: 3,
        matchingPairCount: 2,
        pair: {
          pairAddress: `0x${"22".repeat(20)}`,
          liquidityUsd: 100_000,
          volume24hUsd: 25_000,
          pairCreatedAt: 1_650_000_000_000,
        },
        links: {
          imageUrl: "https://cdn.example.com/token.png",
          websites: [{ label: "Site", url: "https://example.com/" }],
          socials: [
            { type: "telegram", url: "https://t.me/example" },
            { type: "twitter", url: "https://x.com/example" },
          ],
        },
      },
    });
  });

  it("ignores malformed foreign rows and preserves a later valid exact match", async () => {
    const valid = pair({
      chainId: "base",
      locator: CANONICAL_EVM_ADDRESS,
      info: { websites: "malformed optional enrichment" },
    });
    const malformedExact = {
      ...pair({ chainId: "base", locator: CANONICAL_EVM_ADDRESS }),
      dexId: 7,
    };
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      return jsonResponse(chainId === "base"
        ? [
            null,
            {
              chainId: "base",
              baseToken: { address: OTHER_EVM_ADDRESS },
              quoteToken: null,
              dexId: null,
            },
            { chainId: 7, baseToken: null, quoteToken: null },
            malformedExact,
            valid,
          ]
        : []);
    });

    const result = await reader(fetchImpl, {
      identityVerifier: identityVerifier(["base"]),
    }).read(EVM_ADDRESS);

    expect(result).toMatchObject({
      status: "unique",
      candidate: {
        selection: { sourceNetwork: "base" },
        matchingPairCount: 1,
        pair: { dexId: "uniswap" },
        links: { imageUrl: null, websites: [], socials: [] },
      },
    });
  });

  it("drops HTML, bidi and control-bearing display text at the server boundary", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const chainId = providerChainId(url);
      return jsonResponse(chainId === "base"
        ? [pair({
          chainId,
          locator: CANONICAL_EVM_ADDRESS,
          tokenName: "<b>spoof</b>",
          tokenSymbol: "YES\u202eNO",
          info: {
            websites: [{
              label: "Site\u0000hidden",
              url: "https://example.com",
            }],
            socials: [{
              type: "x\u2066spoof",
              url: "https://x.com/example",
            }],
          },
        })]
        : []);
    });

    await expect(reader(fetchImpl, {
      identityVerifier: identityVerifier(["base"]),
    }).read(EVM_ADDRESS)).resolves.toMatchObject({
      status: "unique",
      candidate: {
        token: { name: null, symbol: null },
        links: {
          websites: [{ label: null, url: "https://example.com/" }],
          socials: [{ type: null, url: "https://x.com/example" }],
        },
      },
    });
  });

  it("keeps verified Solana identity through invalid or unavailable DEX responses", async () => {
    const malformedRows = Array.from({ length: 3 }, () => ({}));
    const scenarios = [
      vi.fn<typeof fetch>(async () => jsonResponse({}, 404)),
      vi.fn<typeof fetch>(async () => jsonResponse(malformedRows)),
      vi.fn<typeof fetch>(async () => jsonResponse([], 200, {
        "content-length": "999999",
      })),
    ];

    for (const fetchImpl of scenarios) {
      const result = await reader(fetchImpl, {
        identityVerifier: identityVerifier(["solana"]),
        maximumResponseBytes: 1_000,
        maximumRows: 2,
      }).read(SOLANA_MINT);
      expect(result).toMatchObject({
        status: "unique",
        candidate: {
          selection: { sourceNetwork: "solana" },
          matchingPairCount: 0,
          pair: null,
        },
      });
    }
  });

  it("bounds providers that ignore AbortSignal", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => undefined);
    });
    const pending = reader(fetchImpl, {
      identityVerifier: identityVerifier(EVM_NETWORKS),
      timeoutMs: 100,
    }).read(EVM_ADDRESS);

    await vi.advanceTimersByTimeAsync(101);

    await expect(pending).resolves.toMatchObject({
      status: "ambiguous",
      candidates: EVM_NETWORKS.map((sourceNetwork) => ({
        selection: { sourceNetwork },
        matchingPairCount: 0,
        pair: null,
      })),
    });
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("does not start provider reads when the caller is already aborted", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const controller = new AbortController();
    controller.abort();

    const result = await reader(fetchImpl, {
      identityVerifier: identityVerifier(EVM_NETWORKS),
    }).read(EVM_ADDRESS, {
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      status: "ambiguous",
      candidates: EVM_NETWORKS.map((sourceNetwork) => ({
        selection: { sourceNetwork },
        matchingPairCount: 0,
        pair: null,
      })),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
