import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExploreReadModel } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";
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

describe("token detail Alchemy read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAlchemyOnchainDeployment.mockReturnValue({
      status: "ready",
      rpcUrlSecondary: "https://secondary.example",
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
  });

  it("refreshes only the canonical token from current StateView data", async () => {
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
    expect(mocks.readAlchemyExploreModel).toHaveBeenCalledTimes(1);
    expect(mocks.enrichTokensWithAlchemyPoolState).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: [canonical] }),
    );
    expect(body.token).toMatchObject({
      id: canonical.id,
      name: canonical.name,
      symbol: canonical.symbol,
      tokenAddress: canonical.tokenAddress,
      fdvUsdWad: "1250000000000000000000000",
      valuation: {
        status: "available",
        metric: "fdv",
        supplyBasis: "total",
        currency: "usd",
        valueWad: "1250000000000000000000000",
        freshness: "current",
        asOfBlock: launchDiscoverySnapshot.blockNumber,
        lagBlocks: "0",
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
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBe(
      "operational-dual",
    );
    expect(response.headers.get("X-Programmable-Price-Source")).toBe(
      "state-view+chainlink",
    );
    expect(response.headers.get("X-Programmable-Launch-Source")).toBe(
      "operational+durable+registry.custom-launched",
    );
    expect(response.headers.get("X-Programmable-Valuation-Metric")).toBe(
      "fdv",
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
    );
  });

  it("reports detail FDV at the verified operational block, not the stale launch snapshot", async () => {
    const canonical = token(TOKEN_ADDRESS, {
      totalSupplyRaw: "1000000000000000000000000",
      tokenDecimals: 18,
      activeLiquidity: "1",
      indexedMarketCapUsdWad: "1620000000000000000000000",
      indexedValuationBlockNumber: snapshot.blockNumber,
    });
    const operationalSnapshot = {
      ...launchDiscoverySnapshot,
      blockNumber: "25632000",
      blockHash: `0x${"99".repeat(32)}` as const,
    };
    mocks.readAlchemyExploreModel.mockResolvedValue({
      status: "ready",
      tokens: [canonical],
      snapshot,
      launchDiscoverySnapshot,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    } satisfies ExploreReadModel);
    mocks.readVerifiedOperationalMarketSnapshot.mockResolvedValue(
      operationalSnapshot,
    );
    mocks.readExploreReferenceHeadWithinRouteBudget.mockResolvedValue({
      blockNumber: operationalSnapshot.blockNumber,
      blockHash: operationalSnapshot.blockHash,
      indexedAt: "2026-08-10T18:00:00.000Z",
      finality: "confirmed",
    });
    mocks.enrichTokensWithAlchemyPoolState.mockImplementation(
      async ({ snapshot: readSnapshot }) => [{
        ...canonical,
        indexedMarketCapUsdWad: undefined,
        indexedValuationBlockNumber: readSnapshot.blockNumber,
        fdvUsdWad: "2334305942998987256153723",
      }],
    );

    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.withSameBlockEthUsdQuote).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: operationalSnapshot }),
    );
    expect(mocks.enrichTokensWithAlchemyPoolState).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: operationalSnapshot }),
    );
    expect(body.token).toMatchObject({
      fdvUsdWad: "2334305942998987256153723",
      valuation: {
        status: "available",
        freshness: "current",
        asOfBlock: operationalSnapshot.blockNumber,
        lagBlocks: "0",
      },
    });
    expect(body.dataQuality.valuation).toMatchObject({
      status: "current",
      asOfBlock: operationalSnapshot.blockNumber,
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

  it("retains canonical identity and reports unavailable FDV when enrichment fails", async () => {
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
    mocks.enrichTokensWithAlchemyPoolState.mockRejectedValue(
      new Error("pool unavailable"),
    );

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
        reason: "liquidity-unavailable",
      },
    });
    expect(body.token.valuation).not.toHaveProperty("valueWad", "0");
    expect(body.dataQuality).toMatchObject({
      status: "partial",
      valuation: { status: "unavailable", available: 0, unavailable: 1 },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
