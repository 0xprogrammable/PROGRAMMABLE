import { describe, expect, it } from "vitest";

import {
  parsePredictionAssetAutoDiscoveryV2 as parseAutoDiscoveryResponse,
  predictionAutoDiscoveryCandidateKeyV2,
} from "../lib/prediction-v2/asset-auto-discovery-v2";

const OBSERVED_AT = "2026-08-23T18:00:00.000Z";
const EVM_ADDRESS = `0x${"ab".repeat(20)}`;
const OTHER_EVM_ADDRESS = `0x${"ef".repeat(20)}`;
const SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_PAIR = "So11111111111111111111111111111111111111112";
const IMAGE_ASSET_ID = "12".repeat(32);
const LOGO_CAPABILITY = `v2.preview-1.1800000600.${"a".repeat(43)}`;

const NETWORKS = {
  ethereum: {
    namespace: "evm",
    chainReference: "1",
    providerChainId: "ethereum",
    locator: EVM_ADDRESS,
    pairAddress: OTHER_EVM_ADDRESS,
  },
  base: {
    namespace: "evm",
    chainReference: "8453",
    providerChainId: "base",
    locator: EVM_ADDRESS,
    pairAddress: OTHER_EVM_ADDRESS,
  },
  bnb: {
    namespace: "evm",
    chainReference: "56",
    providerChainId: "bsc",
    locator: EVM_ADDRESS,
    pairAddress: OTHER_EVM_ADDRESS,
  },
  robinhood: {
    namespace: "evm",
    chainReference: "4663",
    providerChainId: "robinhood",
    locator: EVM_ADDRESS,
    pairAddress: OTHER_EVM_ADDRESS,
  },
  solana: {
    namespace: "solana",
    chainReference: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    providerChainId: "solana",
    locator: SOLANA_MINT,
    pairAddress: SOLANA_PAIR,
  },
} as const;

type Network = keyof typeof NETWORKS;

function candidate(
  sourceNetwork: Network = "base",
  overrides: Record<string, unknown> = {},
) {
  const binding = NETWORKS[sourceNetwork];
  const locator = binding.locator;
  return {
    selectionKey:
      `${binding.namespace}:${binding.chainReference}:${locator}`,
    selection: {
      mode: "custom",
      sourceNetwork,
      assetLocator: locator,
    },
    namespace: binding.namespace,
    chainReference: binding.chainReference,
    providerChainId: binding.providerChainId,
    provenance: {
      identity: { source: "onchain-rpc" },
      enrichment: { source: "dexscreener" },
    },
    token: {
      address: locator,
      name: "Example Token",
      symbol: "EXM",
    },
    currentPriceUsd: 0.0042,
    marketCapUsd: 4_200_000,
    fdvUsd: 5_000_000,
    matchingPairCount: 2,
    pair: {
      dexId: "uniswap",
      pairAddress: binding.pairAddress,
      matchedSide: "base",
      liquidityUsd: 120_000,
      volume24hUsd: 75_000,
      pairCreatedAt: Date.parse("2026-08-21T18:00:00.000Z"),
    },
    links: {
      websites: [{ label: "Website", url: "https://token.example.com" }],
      socials: [
        { type: "twitter", url: "https://twitter.com/example?s=20" },
        { type: "telegram", url: "https://telegram.me/example?ref=provider" },
      ],
    },
    ...overrides,
  };
}

function identityOnlyCandidate(sourceNetwork: Network = "base") {
  const binding = NETWORKS[sourceNetwork];
  return candidate(sourceNetwork, {
    token: {
      address: binding.locator,
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
    links: { websites: [], socials: [] },
  });
}

function base(status: string, locator: string | null = EVM_ADDRESS) {
  return {
    schemaVersion: 2,
    locator,
    source: "dexscreener",
    observedAt: OBSERVED_AT,
    usage: "informational-only",
    status,
  };
}

function unique(
  sourceNetwork: Network = "base",
  candidateOverrides: Record<string, unknown> = {},
) {
  const binding = NETWORKS[sourceNetwork];
  return {
    ...base("unique", binding.locator),
    candidate: candidate(sourceNetwork, candidateOverrides),
  };
}

/** Structural tests default to the same locator the caller submitted. */
function parsePredictionAssetAutoDiscoveryV2(
  value: unknown,
  expectedLocator = expectedLocatorForFixture(value),
) {
  return parseAutoDiscoveryResponse(value, expectedLocator);
}

function expectedLocatorForFixture(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { locator?: unknown }).locator === "string"
  ) return (value as { locator: string }).locator;
  return "not-a-token-address";
}

describe("prediction V2 asset auto-discovery client contract", () => {
  it("parses a unique result and exposes only a sanitized token profile", () => {
    const raw = unique("base", {
      token: {
        address: EVM_ADDRESS,
        name: "<img src=x onerror=alert(1)>",
        symbol: "BAD SYMBOL",
      },
      links: {
        websites: [
          { label: "bad", url: "javascript:alert(1)" },
          { label: "site", url: "https://token.example.com/docs#top" },
        ],
        socials: [
          { type: "twitter", url: "https://www.x.com/example?s=20#profile" },
          { type: "telegram", url: "https://t.me/example?ref=provider" },
          { type: "website", url: "https://127.0.0.1/internal" },
        ],
      },
    });

    const parsed = parsePredictionAssetAutoDiscoveryV2(raw);

    expect(parsed).toMatchObject({
      schemaVersion: 2,
      locator: EVM_ADDRESS,
      source: "dexscreener",
      observedAt: OBSERVED_AT,
      usage: "informational-only",
      status: "unique",
      candidate: {
        selectionKey: `evm:8453:${EVM_ADDRESS}`,
        selection: {
          mode: "custom",
          sourceNetwork: "base",
          assetLocator: EVM_ADDRESS,
        },
        namespace: "evm",
        chainReference: "8453",
        providerChainId: "base",
        provenance: {
          identity: { source: "onchain-rpc" },
          enrichment: { source: "dexscreener" },
        },
        currentPriceUsd: 0.0042,
        marketCapUsd: 4_200_000,
        fdvUsd: 5_000_000,
        matchingPairCount: 2,
        logoProxy: null,
        profile: {
          schemaVersion: 2,
          chain: { id: "base", reference: "8453", label: "Base" },
          address: EVM_ADDRESS,
          explorerUrl: `https://basescan.org/token/${EVM_ADDRESS}`,
          links: [
            { kind: "website", url: "https://token.example.com/docs" },
            { kind: "x", url: "https://x.com/example" },
            { kind: "telegram", url: "https://t.me/example" },
          ],
          priceUsd: 0.0042,
          marketCapUsd: 4_200_000,
          fdvUsd: 5_000_000,
          liquidityUsd: 120_000,
          age: {
            pairCreatedAt: "2026-08-21T18:00:00.000Z",
            seconds: 172_800,
          },
        },
      },
    });
    expect(parsed && parsed.status === "unique" && parsed.candidate.profile)
      .not.toHaveProperty("name");
    expect(parsed && parsed.status === "unique" && parsed.candidate.profile)
      .not.toHaveProperty("symbol");
    expect(parsed && parsed.status === "unique" && parsed.candidate.profile)
      .not.toHaveProperty("logoUrl");
    expect(parsed && parsed.status === "unique" && parsed.candidate)
      .not.toHaveProperty("token");
    expect(parsed && parsed.status === "unique" && parsed.candidate)
      .not.toHaveProperty("links");
    expect(parsed && parsed.status === "unique" && parsed.candidate)
      .not.toHaveProperty("settlementEligible");
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("accepts a server-derived projection without exposing a provider URL", () => {
    const parsed = parsePredictionAssetAutoDiscoveryV2(unique("base", {
      links: {
        websites: [],
        socials: [],
      },
      logoProxy: {
        assetId: IMAGE_ASSET_ID,
        capability: LOGO_CAPABILITY,
      },
    }));

    expect(parsed).toMatchObject({
      status: "unique",
      candidate: {
        logoProxy: {
          assetId: IMAGE_ASSET_ID,
          capability: LOGO_CAPABILITY,
        },
      },
    });
    if (!parsed || parsed.status !== "unique") throw new Error("unreachable");
    expect(parsed.candidate.profile).not.toHaveProperty("logoUrl");

    expect(parsePredictionAssetAutoDiscoveryV2(unique("base", {
      links: { websites: [], socials: [] },
      logoProxy: {
        assetId: IMAGE_ASSET_ID,
        capability: `v1.preview-1.${"a".repeat(43)}`,
      },
    }))).toMatchObject({
      status: "unique",
      candidate: { logoProxy: null },
    });
    expect(parsePredictionAssetAutoDiscoveryV2(unique("base", {
      links: { websites: [], socials: [] },
      logoProxy: { unexpected: true },
    }))).toMatchObject({
      status: "unique",
      candidate: { logoProxy: null },
    });
  });

  it("binds the response to the exact submitted locator", () => {
    expect(parseAutoDiscoveryResponse(unique("base"), OTHER_EVM_ADDRESS))
      .toBeNull();
    expect(parseAutoDiscoveryResponse(
      unique("base"),
      `  0x${"AB".repeat(20)}  `,
    )).toMatchObject({ status: "unique", locator: EVM_ADDRESS });
    expect(parseAutoDiscoveryResponse(unique("solana"), SOLANA_PAIR)).toBeNull();
  });

  it("parses an exact verified identity without DEX enrichment", () => {
    const parsed = parsePredictionAssetAutoDiscoveryV2({
      ...base("unique"),
      source: null,
      candidate: identityOnlyCandidate(),
    });

    expect(parsed).toMatchObject({
      status: "unique",
      candidate: {
        selection: { sourceNetwork: "base" },
        currentPriceUsd: null,
        marketCapUsd: null,
        fdvUsd: null,
        matchingPairCount: 0,
        pair: null,
        provenance: {
          identity: { source: "onchain-rpc" },
          enrichment: null,
        },
        profile: {
          schemaVersion: 2,
          chain: { id: "base", reference: "8453", label: "Base" },
          address: EVM_ADDRESS,
          explorerUrl: `https://basescan.org/token/${EVM_ADDRESS}`,
        },
      },
    });
    if (!parsed || parsed.status !== "unique") throw new Error("unreachable");
    expect(parsed.candidate.profile).not.toHaveProperty("name");
    expect(parsed.candidate.profile).not.toHaveProperty("symbol");
    expect(parsed.candidate.profile).not.toHaveProperty("priceUsd");
    expect(parsed.candidate.profile).not.toHaveProperty("liquidityUsd");
  });

  it.each([
    { currentPriceUsd: 1 },
    { marketCapUsd: 1 },
    { fdvUsd: 1 },
    { matchingPairCount: 1 },
    {
      token: {
        address: EVM_ADDRESS,
        name: "Provider name",
        symbol: null,
      },
    },
    {
      links: {
        imageUrl: "https://cdn.example.com/token.png",
        websites: [],
        socials: [],
      },
    },
  ])("rejects identity-only candidates carrying orphaned enrichment: %#", (
    override,
  ) => {
    expect(parsePredictionAssetAutoDiscoveryV2({
      ...base("unique"),
      source: null,
      candidate: {
        ...identityOnlyCandidate(),
        ...override,
      },
    })).toBeNull();
  });

  it("rejects an enriched pair with a zero matching-pair count", () => {
    expect(parsePredictionAssetAutoDiscoveryV2(unique("base", {
      matchingPairCount: 0,
    }))).toBeNull();
  });

  it.each([
    { provenance: undefined },
    {
      provenance: {
        identity: { source: "dexscreener" },
        enrichment: { source: "dexscreener" },
      },
    },
    {
      provenance: {
        identity: { source: "onchain-rpc", extra: true },
        enrichment: { source: "dexscreener" },
      },
    },
    {
      provenance: {
        identity: { source: "onchain-rpc" },
        enrichment: null,
      },
    },
  ])("rejects missing or conflicting enriched provenance: %#", (override) => {
    expect(parsePredictionAssetAutoDiscoveryV2(unique("base", override)))
      .toBeNull();
  });

  it("rejects identity-only data attributed to DEX enrichment", () => {
    expect(parsePredictionAssetAutoDiscoveryV2({
      ...base("unique"),
      candidate: {
        ...identityOnlyCandidate(),
        provenance: {
          identity: { source: "onchain-rpc" },
          enrichment: { source: "dexscreener" },
        },
      },
    })).toBeNull();
  });

  it("accepts an invalid response only for an invalid submitted locator", () => {
    const invalid = {
      ...base("invalid", null),
      source: null,
      reason: "invalid-locator",
    };
    expect(parseAutoDiscoveryResponse(invalid, "not-a-token-address"))
      .toMatchObject({ status: "invalid", locator: null });
    expect(parseAutoDiscoveryResponse(invalid, EVM_ADDRESS)).toBeNull();
  });

  it.each(Object.keys(NETWORKS) as Network[])(
    "binds the exact supported mapping for %s",
    (sourceNetwork) => {
      const parsed = parsePredictionAssetAutoDiscoveryV2(unique(sourceNetwork));
      const binding = NETWORKS[sourceNetwork];
      expect(parsed).toMatchObject({
        locator: binding.locator,
        status: "unique",
        candidate: {
          selectionKey:
            `${binding.namespace}:${binding.chainReference}:${binding.locator}`,
          selection: { sourceNetwork, assetLocator: binding.locator },
          namespace: binding.namespace,
          chainReference: binding.chainReference,
          providerChainId: binding.providerChainId,
          profile: { chain: { id: sourceNetwork }, address: binding.locator },
        },
      });
    },
  );

  it("parses ambiguous candidates and provides a stable client candidate key", () => {
    const raw = {
      ...base("ambiguous"),
      candidates: [candidate("ethereum"), candidate("base")],
    };
    const parsed = parsePredictionAssetAutoDiscoveryV2(raw);

    expect(parsed).toMatchObject({
      status: "ambiguous",
      candidates: [
        { selection: { sourceNetwork: "ethereum" } },
        { selection: { sourceNetwork: "base" } },
      ],
    });
    if (!parsed || parsed.status !== "ambiguous") throw new Error("unreachable");
    expect(parsed.candidates.map(predictionAutoDiscoveryCandidateKeyV2)).toEqual([
      `ethereum:${EVM_ADDRESS}`,
      `base:${EVM_ADDRESS}`,
    ]);
    expect(Object.isFrozen(parsed.candidates)).toBe(true);
  });

  it("rejects duplicate candidates in an ambiguous response", () => {
    const duplicate = candidate("base");
    expect(parsePredictionAssetAutoDiscoveryV2({
      ...base("ambiguous"),
      candidates: [duplicate, { ...duplicate }],
    })).toBeNull();
  });

  it("parses an inconclusive result without treating discovery as eligibility", () => {
    const parsed = parsePredictionAssetAutoDiscoveryV2({
      ...base("inconclusive"),
      candidates: [candidate("base")],
      failures: [
        { sourceNetwork: "ethereum", reason: "timeout" },
        { sourceNetwork: "robinhood", reason: "rate-limited" },
      ],
    });

    expect(parsed).toMatchObject({
      status: "inconclusive",
      candidates: [{ selection: { sourceNetwork: "base" } }],
      failures: [
        { sourceNetwork: "ethereum", reason: "timeout" },
        { sourceNetwork: "robinhood", reason: "rate-limited" },
      ],
    });
    expect(parsed).not.toHaveProperty("settlementEligible");
  });

  it.each([
    "identity-unconfigured",
    "identity-unavailable",
    "identity-invalid",
    "identity-mismatch",
    "market-data-missing",
  ] as const)("accepts the fail-closed discovery reason %s", (reason) => {
    expect(parsePredictionAssetAutoDiscoveryV2({
      ...base("inconclusive"),
      source: null,
      candidates: [],
      failures: [{ sourceNetwork: "base", reason }],
    })).toMatchObject({
      status: "inconclusive",
      failures: [{ sourceNetwork: "base", reason }],
    });
  });

  it.each([
    { failures: [] },
    { failures: [{ sourceNetwork: "ethereum", reason: "not-a-reason" }] },
    { failures: [
      { sourceNetwork: "ethereum", reason: "timeout" },
      { sourceNetwork: "ethereum", reason: "rate-limited" },
    ] },
    { failures: [{ sourceNetwork: "solana", reason: "timeout" }] },
    { failures: [{ sourceNetwork: "base", reason: "timeout", extra: true }] },
  ])("rejects an invalid failure set: %#", ({ failures }) => {
    expect(parsePredictionAssetAutoDiscoveryV2({
      ...base("inconclusive"),
      candidates: [candidate("base")],
      failures,
    })).toBeNull();
  });

  it("rejects a failure that overlaps a returned candidate network", () => {
    expect(parsePredictionAssetAutoDiscoveryV2({
      ...base("inconclusive"),
      candidates: [candidate("base")],
      failures: [{ sourceNetwork: "base", reason: "timeout" }],
    })).toBeNull();
  });

  it("parses exact not-found and invalid states", () => {
    expect(parsePredictionAssetAutoDiscoveryV2({
      ...base("not-found"),
      source: null,
    })).toEqual({
      schemaVersion: 2,
      locator: EVM_ADDRESS,
      source: null,
      observedAt: OBSERVED_AT,
      usage: "informational-only",
      status: "not-found",
    });
    expect(parsePredictionAssetAutoDiscoveryV2({
      ...base("invalid", null),
      source: null,
      reason: "invalid-locator",
    })).toEqual({
      schemaVersion: 2,
      locator: null,
      source: null,
      observedAt: OBSERVED_AT,
      usage: "informational-only",
      status: "invalid",
      reason: "invalid-locator",
    });
  });

  it("preserves a quote-side price without inventing market cap or FDV", () => {
    const rawCandidate = candidate("base", {
      marketCapUsd: null,
      fdvUsd: null,
      pair: {
        ...candidate("base").pair,
        matchedSide: "quote",
      },
    });
    const parsed = parsePredictionAssetAutoDiscoveryV2({
      ...base("unique"),
      candidate: rawCandidate,
    });

    expect(parsed).toMatchObject({
      status: "unique",
      candidate: {
        currentPriceUsd: 0.0042,
        marketCapUsd: null,
        fdvUsd: null,
        pair: { matchedSide: "quote" },
      },
    });
    if (!parsed || parsed.status !== "unique") throw new Error("unreachable");
    expect(parsed.candidate.profile).not.toHaveProperty("marketCapUsd");
    expect(parsed.candidate.profile).not.toHaveProperty("fdvUsd");

    expect(parsePredictionAssetAutoDiscoveryV2({
      ...base("unique"),
      candidate: {
        ...rawCandidate,
        marketCapUsd: 4_200_000,
      },
    })).toBeNull();
  });

  it.each([
    { selectionKey: `evm:1:${EVM_ADDRESS}` },
    { chainReference: "1" },
    { providerChainId: "bsc" },
    { namespace: "solana" },
    {
      selection: {
        mode: "custom",
        sourceNetwork: "bnb",
        assetLocator: EVM_ADDRESS,
      },
    },
    {
      selection: {
        mode: "custom",
        sourceNetwork: "base",
        assetLocator: OTHER_EVM_ADDRESS,
      },
    },
    {
      token: {
        address: OTHER_EVM_ADDRESS,
        name: "Example Token",
        symbol: "EXM",
      },
    },
  ])("rejects a conflicting identity binding: %#", (override) => {
    expect(parsePredictionAssetAutoDiscoveryV2(unique("base", override)))
      .toBeNull();
  });

  it.each([
    { schemaVersion: 3 },
    { source: "other" },
    { usage: "settlement" },
    { observedAt: "2026-08-23T18:00:00Z" },
    { locator: `0x${"AB".repeat(20)}` },
  ])("rejects a malformed or widened envelope: %#", (override) => {
    expect(parsePredictionAssetAutoDiscoveryV2({
      ...unique("base"),
      ...override,
    })).toBeNull();
  });

  it("rejects unknown fields at every security-relevant boundary", () => {
    expect(parsePredictionAssetAutoDiscoveryV2({
      ...unique("base"),
      settlementEligible: true,
    })).toBeNull();
    expect(parsePredictionAssetAutoDiscoveryV2(unique("base", {
      settlementEligible: true,
    }))).toBeNull();
    expect(parsePredictionAssetAutoDiscoveryV2(unique("base", {
      pair: { ...candidate("base").pair, extra: true },
    }))).toBeNull();
  });

  it("bounds link arrays and rejects zero token or pair identities", () => {
    expect(parsePredictionAssetAutoDiscoveryV2(unique("base", {
      links: {
        websites: Array.from({ length: 9 }, (_, index) => ({
          label: null,
          url: `https://site-${index}.example.com`,
        })),
        socials: [],
      },
    }))).toBeNull();
    expect(parsePredictionAssetAutoDiscoveryV2({
      ...base("not-found", `0x${"0".repeat(40)}`),
    })).toBeNull();
    expect(parsePredictionAssetAutoDiscoveryV2({
      ...base("not-found", "11111111111111111111111111111111"),
    })).toBeNull();
    expect(parsePredictionAssetAutoDiscoveryV2(unique("base", {
      pair: {
        ...candidate("base").pair,
        pairAddress: `0x${"0".repeat(40)}`,
      },
    }))).toBeNull();
  });
});
