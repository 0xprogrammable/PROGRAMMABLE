import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExploreReadModel } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";
import { customGraphToken } from "./launch-stamp-surface-fixture";

const mocks = vi.hoisted(() => ({
  enrichTokensWithAlchemyPrices: vi.fn(),
  enrichTokensWithAlchemyPoolState: vi.fn(),
  getAlchemyOnchainDeployment: vi.fn(),
  readAlchemyExploreModel: vi.fn(),
  safeAlchemyError: vi.fn((error) => error),
}));

vi.mock("../lib/alchemy/explore.server", () => ({
  enrichTokensWithAlchemyPrices: mocks.enrichTokensWithAlchemyPrices,
  getAlchemyOnchainDeployment: mocks.getAlchemyOnchainDeployment,
  readAlchemyExploreModel: mocks.readAlchemyExploreModel,
  safeAlchemyError: mocks.safeAlchemyError,
}));

vi.mock("../lib/alchemy/live-market.server", () => ({
  enrichTokensWithAlchemyPoolState: mocks.enrichTokensWithAlchemyPoolState,
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
    mocks.getAlchemyOnchainDeployment.mockReturnValue({ status: "ready" });
    mocks.enrichTokensWithAlchemyPoolState.mockImplementation(
      async ({ tokens }: { tokens: readonly LauncherToken[] }) => [...tokens],
    );
  });

  it("price-enriches only the canonical token from the Alchemy read model", async () => {
    const canonical = token(TOKEN_ADDRESS, {
      totalSupplyRaw: "1000000000000000000000000",
      tokenDecimals: 18,
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
    mocks.enrichTokensWithAlchemyPrices.mockResolvedValue([
      {
        ...canonical,
        tokenPriceUsdWad: "1250000000000000000",
        fdvUsdWad: "1250000000000000000000000",
      },
    ]);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.readAlchemyExploreModel).toHaveBeenCalledTimes(1);
    expect(mocks.enrichTokensWithAlchemyPrices).toHaveBeenCalledWith([
      canonical,
    ]);
    expect(body.token).toMatchObject({
      id: canonical.id,
      name: canonical.name,
      symbol: canonical.symbol,
      tokenAddress: canonical.tokenAddress,
      tokenPriceUsdWad: "1250000000000000000",
      fdvUsdWad: "1250000000000000000000000",
    });
    expect(body.launchDiscoverySnapshot).toEqual(launchDiscoverySnapshot);
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "blob",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBe(
      "alchemy",
    );
    expect(response.headers.get("X-Programmable-Price-Source")).toBe(
      "alchemy",
    );
    expect(response.headers.get("X-Programmable-Launch-Source")).toBe(
      "alchemy",
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
    );
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
    mocks.enrichTokensWithAlchemyPrices.mockResolvedValue([customGraphToken]);

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
    expect(mocks.enrichTokensWithAlchemyPrices).not.toHaveBeenCalled();
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
    expect(mocks.enrichTokensWithAlchemyPrices).not.toHaveBeenCalled();
  });
});
