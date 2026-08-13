import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExploreReadModel } from "../lib/onchain/types";
import type {
  MarketDataIdentityV1,
  TokenMarketDataV1,
} from "../lib/market-data/market-data-v1";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";
import { customGraphToken } from "./launch-stamp-surface-fixture";

const mocks = vi.hoisted(() => ({
  enrichTokensWithAlchemyPoolState: vi.fn(),
  readVerifiedOperationalMarketSnapshot: vi.fn(),
  withSameBlockEthUsdQuote: vi.fn(),
  getAlchemyOnchainDeployment: vi.fn(),
  readAlchemyExploreModel: vi.fn(),
  readProductionCustomExploreDirectoryV1: vi.fn(),
  readExploreReferenceHeadWithinRouteBudget: vi.fn(),
  getOnchainDeployment: vi.fn(),
  readDurableExploreModel: vi.fn(),
  readBitqueryTokenMarketDataV1: vi.fn(),
  currentMarketOnchainDeployment: vi.fn(),
  hydrateMissingCanonicalTokenSupplyV1: vi.fn(),
  valueExploreEntriesWithCurrentEvidence: vi.fn(),
  settleCurrentEvidenceSnapshot: vi.fn(),
  safeAlchemyError: vi.fn((error) => error),
}));

vi.mock("../lib/alchemy/explore.server", () => ({
  getAlchemyOnchainDeployment: mocks.getAlchemyOnchainDeployment,
  readAlchemyExploreModel: mocks.readAlchemyExploreModel,
  safeAlchemyError: mocks.safeAlchemyError,
}));

vi.mock("../lib/alchemy/live-market.server", () => ({
  enrichTokensWithAlchemyPoolState: mocks.enrichTokensWithAlchemyPoolState,
  readVerifiedOperationalMarketSnapshot:
    mocks.readVerifiedOperationalMarketSnapshot,
  withSameBlockEthUsdQuote: mocks.withSameBlockEthUsdQuote,
  withoutUnboundEthUsdQuote: (snapshot: {
    ethUsdQuote?: unknown;
    [key: string]: unknown;
  }) => {
    const withoutQuote = { ...snapshot };
    delete withoutQuote.ethUsdQuote;
    return withoutQuote;
  },
}));

vi.mock("../lib/server/custom-launch/explore-directory-v1", () => ({
  readProductionCustomExploreDirectoryV1:
    mocks.readProductionCustomExploreDirectoryV1,
}));

vi.mock("../lib/explore-reference-head.server", () => ({
  readExploreReferenceHeadWithinRouteBudget:
    mocks.readExploreReferenceHeadWithinRouteBudget,
}));

vi.mock("../lib/onchain/config", () => ({
  getOnchainDeployment: mocks.getOnchainDeployment,
}));

vi.mock("../lib/onchain/durable-model", () => ({
  readDurableExploreModel: mocks.readDurableExploreModel,
}));

vi.mock("../lib/market-data/bitquery.server", () => ({
  readBitqueryTokenMarketDataV1: mocks.readBitqueryTokenMarketDataV1,
}));

vi.mock("../lib/market-data/current-market-rpc.server", () => ({
  currentMarketOnchainDeployment:
    mocks.currentMarketOnchainDeployment,
}));

vi.mock("../lib/market-data/canonical-token-supply.server", () => ({
  hydrateMissingCanonicalTokenSupplyV1:
    mocks.hydrateMissingCanonicalTokenSupplyV1,
}));

vi.mock("../lib/market-data/current-valuation.server", () => ({
  CURRENT_EVIDENCE_ROUTE_DEADLINE_MS: 4_500,
  settleCurrentEvidenceSnapshot: mocks.settleCurrentEvidenceSnapshot,
  valueExploreEntriesWithCurrentEvidence:
    mocks.valueExploreEntriesWithCurrentEvidence,
}));

import { withBitqueryMarketData } from "../lib/explore-financial-data";

import { GET } from "../app/api/explore/token/route";

const TOKEN_ADDRESS =
  "0x1111111111111111111111111111111111111111" as const;
const OTHER_TOKEN_ADDRESS =
  "0x2222222222222222222222222222222222222222" as const;
const HOOK_ADDRESS =
  "0x3333333333333333333333333333333333333333" as const;
const POOL_ID = `0x${"44".repeat(32)}` as const;

function token(
  tokenAddress: `0x${string}`,
  overrides: Partial<LauncherToken> = {},
): LauncherToken {
  return {
    id: `1:${tokenAddress}`,
    name: "Canonical",
    symbol: "CAN",
    tokenAddress,
    hookAddress: HOOK_ADDRESS,
    poolId: POOL_ID,
    launchedAt: "2026-07-29T00:00:00.000Z",
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    ...overrides,
  };
}

const snapshot = {
  chainId: 1,
  blockNumber: "25630000",
  blockHash: `0x${"55".repeat(32)}` as const,
  confirmations: 12,
};
const launchDiscoverySnapshot = {
  ...snapshot,
  blockNumber: "25630100",
  blockHash: `0x${"66".repeat(32)}` as const,
};

function bitqueryMarketData(
  identities: readonly MarketDataIdentityV1[],
  valueUsdWad = "1250000000000000000000000",
): ReadonlyMap<string, TokenMarketDataV1> {
  return new Map(identities.map((identity) => [identity.tokenAddress, {
    schemaVersion: "programmable.market-data.v1",
    source: "bitquery",
    generatedAt: "2026-08-11T14:00:00.000Z",
    status: "current",
    primaryPoolId: identity.poolId,
    pools: [{
      identity,
      source: "bitquery",
      status: "current",
      quality: "complete",
      asOfTime: "2026-08-11T14:00:00.000Z",
      latestTrade: {
        transactionHash: `0x${"aa".repeat(32)}`,
        logIndex: 1,
        blockNumber: "25740000",
        time: "2026-08-11T14:00:00.000Z",
        tokenSide: "buy",
        priceUsdWad: (BigInt(valueUsdWad) / 1_000_000n).toString(),
        priceUsdAsOfTime: "2026-08-11T14:00:00.000Z",
        priceUsdSource: "bitquery-token-price-index-v1",
        rawPriceUsdWad: (BigInt(valueUsdWad) / 1_000_000n).toString(),
      },
      liquidity: {
        asOfTime: "2026-08-11T14:00:00.000Z",
        asOfBlock: "25740000",
        valueUsdWad: "100000000000000000000000",
        freshness: "current",
      },
      valuation: {
        status: "available",
        metric: "fdv",
        supplyBasis: "total",
        valueUsdWad,
        fdvUsdWad: valueUsdWad,
        totalSupply: "1000000",
        asOfTime: "2026-08-11T14:00:00.000Z",
        freshness: "current",
      },
    }],
  } satisfies TokenMarketDataV1]));
}

describe("token detail Bitquery market read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAlchemyOnchainDeployment.mockReturnValue({
      status: "ready",
      rpcUrlSecondary: "https://secondary.example",
    });
    mocks.currentMarketOnchainDeployment.mockReturnValue({
      status: "ready",
      rpcUrl: "https://current-primary.example",
      rpcUrlSecondary: "https://current-secondary.example",
    });
    mocks.getOnchainDeployment.mockReturnValue({ status: "ready" });
    mocks.readProductionCustomExploreDirectoryV1.mockResolvedValue([]);
    mocks.readExploreReferenceHeadWithinRouteBudget.mockResolvedValue({
      blockNumber: launchDiscoverySnapshot.blockNumber,
      blockHash: launchDiscoverySnapshot.blockHash,
      indexedAt: "2026-08-10T17:55:45.000Z",
      finality: "confirmed",
    });
    mocks.readVerifiedOperationalMarketSnapshot.mockResolvedValue(
      launchDiscoverySnapshot,
    );
    mocks.settleCurrentEvidenceSnapshot.mockImplementation(
      async ({
        read,
        signal,
      }: {
        read: (signal: AbortSignal) => Promise<unknown>;
        signal?: AbortSignal;
      }) => await read(signal ?? new AbortController().signal),
    );
    mocks.withSameBlockEthUsdQuote.mockImplementation(
      async ({ snapshot: value }) => value,
    );
    mocks.enrichTokensWithAlchemyPoolState.mockImplementation(
      async ({ tokens }: { tokens: readonly LauncherToken[] }) =>
        tokens.map((candidate) => ({
          ...candidate,
          activeLiquidity: candidate.activeLiquidity ?? "1",
          indexedValuationBlockNumber:
            launchDiscoverySnapshot.blockNumber,
        })),
    );
    mocks.readBitqueryTokenMarketDataV1.mockImplementation(
      async (identities: readonly MarketDataIdentityV1[]) =>
        bitqueryMarketData(identities),
    );
    mocks.hydrateMissingCanonicalTokenSupplyV1.mockImplementation(
      async (entries: readonly unknown[]) => [...entries],
    );
    mocks.valueExploreEntriesWithCurrentEvidence.mockImplementation(
      async ({ entries, marketByToken }: {
        entries: readonly ExploreEntry[];
        marketByToken: Promise<ReadonlyMap<string, TokenMarketDataV1>>;
      }) => {
        const markets = await marketByToken;
        return entries.map((entry) => {
          const market = entry.tokenAddress
            ? markets.get(entry.tokenAddress.toLowerCase())
            : undefined;
          return market
            ? withBitqueryMarketData(entry, market)
            : {
                ...entry,
                valuation: {
                  status: "unavailable" as const,
                  reason: "source-unavailable" as const,
                },
              };
        });
      },
    );
  });

  it("reads Bitquery market data only for the canonical token PoolId", async () => {
    const canonical = token(TOKEN_ADDRESS, {
      totalSupplyRaw: "1000000000000000000000000",
      tokenDecimals: 18,
      activeLiquidity: "1",
      indexedMarketCapEth: "357.14",
      indexedMarketCapEthWei: "357140000000000000000",
      indexedMarketCapUsdWad: "1250000000000000000000000",
      marketCapEth: "350",
      marketCapEthWei: "350000000000000000000",
    });
    const model = {
      status: "ready",
      tokens: [canonical, token(OTHER_TOKEN_ADDRESS)],
      snapshot,
      launchDiscoverySnapshot,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    } satisfies ExploreReadModel;
    mocks.readAlchemyExploreModel.mockResolvedValue(model);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.currentMarketOnchainDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
      }),
    );
    expect(mocks.getAlchemyOnchainDeployment).not.toHaveBeenCalled();
    expect(mocks.readVerifiedOperationalMarketSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        rpcUrl: "https://current-primary.example",
        rpcUrlSecondary: "https://current-secondary.example",
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.valueExploreEntriesWithCurrentEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        deployment: expect.objectContaining({
          rpcUrl: "https://current-primary.example",
          rpcUrlSecondary: "https://current-secondary.example",
        }),
      }),
    );
    expect(mocks.readAlchemyExploreModel).toHaveBeenCalledTimes(1);
    expect(mocks.enrichTokensWithAlchemyPoolState).not.toHaveBeenCalled();
    expect(mocks.readBitqueryTokenMarketDataV1).toHaveBeenCalledWith(
      [
        {
          chainId: "1",
          tokenAddress: TOKEN_ADDRESS,
          poolId: POOL_ID,
          quoteAddress: "0x0000000000000000000000000000000000000000",
          protocol: "uniswap_v4",
        },
      ],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(body.token).toMatchObject({
      id: canonical.id,
      name: canonical.name,
      symbol: canonical.symbol,
      tokenAddress: canonical.tokenAddress,
      valuation: {
        status: "available",
        metric: "fdv",
        supplyBasis: "total",
        currency: "usd",
        valueWad: "1250000000000000000000000",
        freshness: "current",
        source: "bitquery",
        asOfTime: "2026-08-11T14:00:00.000Z",
      },
    });
    expect(body.dataQuality).toMatchObject({
      status: "complete",
      valuation: {
        status: "current",
        metric: "fdv",
        available: 1,
        unavailable: 0,
      },
    });
    for (const field of [
      "marketCapEth",
      "marketCapEthWei",
      "indexedMarketCapEth",
      "indexedMarketCapEthWei",
      "indexedMarketCapUsdWad",
      "marketCapQuote",
      "marketCapQuoteWad",
    ]) {
      expect(body.token).not.toHaveProperty(field);
    }
    expect(body.launchDiscoverySnapshot).toEqual(launchDiscoverySnapshot);
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "operational+durable+postgres",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBeNull();
    expect(response.headers.get("X-Programmable-Price-Source")).toBe(
      "bitquery",
    );
    expect(response.headers.get("X-Programmable-Market-As-Of")).toBe(
      "2026-08-11T14:00:00.000Z",
    );
    expect(response.headers.get("X-Programmable-Launch-Source")).toBe(
      "operational+durable+registry.custom-launched",
    );
    expect(response.headers.get("X-Programmable-Market-Source")).toBe(
      "bitquery",
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
    );
  });

  it("starts the independent market read while supply hydration is pending", async () => {
    const canonical = token(TOKEN_ADDRESS);
    mocks.readAlchemyExploreModel.mockResolvedValue({
      status: "ready",
      tokens: [canonical],
      snapshot,
      launchDiscoverySnapshot,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    } satisfies ExploreReadModel);
    let releaseHydration: ((entries: readonly LauncherToken[]) => void)
      | undefined;
    mocks.hydrateMissingCanonicalTokenSupplyV1.mockReturnValue(
      new Promise((resolve) => {
        releaseHydration = resolve;
      }),
    );

    const responseRead = GET(
      new NextRequest(
        `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
      ),
    );
    try {
      await vi.waitFor(() => {
        expect(mocks.readBitqueryTokenMarketDataV1).toHaveBeenCalledTimes(1);
      });
    } finally {
      releaseHydration?.([canonical]);
    }

    const response = await responseRead;
    expect(response.status).toBe(200);
  });

  it("reports detail FDV at the verified Bitquery time, not the stale launch snapshot", async () => {
    const canonical = token(TOKEN_ADDRESS, {
      totalSupplyRaw: "1000000000000000000000000",
      tokenDecimals: 18,
      activeLiquidity: "1",
      indexedMarketCapUsdWad: "1620000000000000000000000",
      indexedValuationBlockNumber: snapshot.blockNumber,
    });
    mocks.readAlchemyExploreModel.mockResolvedValue({
      status: "ready",
      tokens: [canonical],
      snapshot,
      launchDiscoverySnapshot,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    } satisfies ExploreReadModel);
    mocks.readBitqueryTokenMarketDataV1.mockImplementation(
      async (identities: readonly MarketDataIdentityV1[]) =>
        bitqueryMarketData(identities, "2334305942998987256153723"),
    );

    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.withSameBlockEthUsdQuote).not.toHaveBeenCalled();
    expect(mocks.enrichTokensWithAlchemyPoolState).not.toHaveBeenCalled();
    expect(body.token).toMatchObject({
      valuation: {
        status: "available",
        freshness: "current",
        source: "bitquery",
        asOfTime: "2026-08-11T14:00:00.000Z",
      },
    });
    expect(body.dataQuality.valuation).toMatchObject({
      status: "current",
      asOfBlock: null,
      asOfTime: "2026-08-11T14:00:00.000Z",
    });
    expect(body.launchDiscoverySnapshot).toEqual(launchDiscoverySnapshot);
  });

  it("serves Router provenance for a finalized Custom Graph without Classic fields", async () => {
    const model = {
      status: "ready",
      tokens: [customGraphToken],
      snapshot,
      launchDiscoverySnapshot,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    } satisfies ExploreReadModel;
    mocks.readAlchemyExploreModel.mockResolvedValue(model);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/token?address=${customGraphToken.tokenAddress}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.customProject).toBeNull();
    expect(body.token).toMatchObject({
      tokenAddress: customGraphToken.tokenAddress,
      launchModel: "custom-graph",
      totalSwapFeeBps: null,
      launchCategoryProvenance: {
        category: "custom",
        source: "canonical-launch-stamp-router",
        launchId: customGraphToken.launchStampProvenance.launchId,
        stampHash: customGraphToken.launchStampProvenance.stampHash,
      },
      launchStampProvenance: customGraphToken.launchStampProvenance,
    });
    expect(body.token.positionRecipient).toBeUndefined();
    expect(body.token.positionTokenId).toBeUndefined();
  });

  it.each([
    `address=${TOKEN_ADDRESS}&unused=random`,
    `address=${TOKEN_ADDRESS}&address=${OTHER_TOKEN_ADDRESS}`,
  ])("rejects non-canonical query shapes before reading or enriching: %s", async (query) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/explore/token?${query}`),
    );

    expect(response.status).toBe(400);
    expect(mocks.readAlchemyExploreModel).not.toHaveBeenCalled();
  });

  it("returns a canonical 404 without price enrichment", async () => {
    mocks.readAlchemyExploreModel.mockResolvedValue({
      status: "ready",
      tokens: [],
      snapshot,
      launchDiscoverySnapshot,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    } satisfies ExploreReadModel);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      launchDiscoverySnapshot,
    });
    expect(response.headers.get("X-Programmable-Launch-Source")).toBe(
      "operational+durable+registry.custom-launched",
    );
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "operational+durable+postgres",
    );
  });

  it("retains canonical identity and reports unavailable FDV when Bitquery has no data", async () => {
    const canonical = token(TOKEN_ADDRESS, {
      totalSupplyRaw: "1000000000000000000000000",
      tokenDecimals: 18,
    });
    mocks.readAlchemyExploreModel.mockResolvedValue({
      status: "ready",
      tokens: [canonical],
      snapshot,
      launchDiscoverySnapshot,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    } satisfies ExploreReadModel);
    mocks.readBitqueryTokenMarketDataV1.mockResolvedValue(new Map());

    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.token).toMatchObject({
      tokenAddress: TOKEN_ADDRESS,
      valuation: {
        status: "unavailable",
        reason: "source-unavailable",
      },
    });
    expect(body.token.valuation).not.toHaveProperty("valueWad", "0");
    expect(body.dataQuality).toMatchObject({
      status: "partial",
      valuation: { status: "unavailable", available: 0, unavailable: 1 },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Programmable-Price-Source")).toBeNull();
  });
});
