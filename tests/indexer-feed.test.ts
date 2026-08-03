import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const routeMocks = vi.hoisted(() => ({
  readAlchemyExploreModel: vi.fn(),
  getAlchemyOnchainDeployment: vi.fn(() => ({ chainId: 1 })),
  safeAlchemyError: vi.fn(() => ({
    name: "Error",
    message: "Alchemy request failed",
  })),
}));

vi.mock("../lib/alchemy/explore.server", () => ({
  readAlchemyExploreModel: routeMocks.readAlchemyExploreModel,
  getAlchemyOnchainDeployment: routeMocks.getAlchemyOnchainDeployment,
  safeAlchemyError: routeMocks.safeAlchemyError,
}));

import { GET as getTokenList } from "../app/api/indexers/v1/token-list/route";
import { GET as getIndexerTokens } from "../app/api/indexers/v1/tokens/route";
import {
  buildIndexerFeed,
  buildUniswapTokenList,
  findIndexerToken,
  serializeIndexerToken,
} from "../lib/onchain/indexer-feed";
import type { ExploreReadModel } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";

const token: LauncherToken = {
  id: "test",
  name: "Test",
  symbol: "TEST",
  description: "This is a test",
  imageUrl: "https://programmable.family/test.png",
  links: [
    { kind: "website", url: "https://programmable.family/" },
    { kind: "x", url: "https://x.com/0xProgrammable" },
  ],
  tokenAddress: "0x1111111111111111111111111111111111111111",
  hookAddress: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"33".repeat(32)}`,
  creatorAddress: "0x4444444444444444444444444444444444444444",
  positionRecipient:
    "0x7777777777777777777777777777777777777777",
  positionTokenId: "42",
  tokenLiquidityAmountRaw: "999999999999999999999999999",
  lockedTokenDustRaw: "1",
  launchBlockNumber: "123",
  launchTransactionHash: `0x${"55".repeat(32)}`,
  launchedAt: "2026-07-27T10:00:00.000Z",
  tokenDecimals: 18,
  lpFeePips: 0,
  buyHookFeeBps: 100,
  sellHookFeeBps: 100,
  creatorFeeBps: 90,
  launcherFeeBps: 10,
  transferTaxBps: 0,
  totalSwapFeeBps: 100,
  liquidityPath: "meme",
};

const readyModel: ExploreReadModel = {
  status: "ready",
  tokens: [token],
  snapshot: {
    chainId: 1,
    blockNumber: "130",
    blockHash: `0x${"66".repeat(32)}`,
    confirmations: 12,
  },
  creatorClaims: [],
  launcherFeesAccruedWei: "0",
  launcherFeesAccruedEth: "0",
};

beforeEach(() => {
  vi.clearAllMocks();
});

function expectAlchemyRpcHeaders(response: Response) {
  expect(response.headers.get("x-programmable-read-source")).toBe("rpc");
  expect(response.headers.get("x-programmable-rpc-provider")).toBe(
    "alchemy",
  );
  expect(response.headers.get("access-control-expose-headers")).toBe(
    "X-Programmable-Read-Source, X-Programmable-Rpc-Provider",
  );
}

describe("public indexer fee disclosure", () => {
  it("declares zero transfer tax and deducts the launcher share", () => {
    const result = serializeIndexerToken(token, 1);

    expect(result.fees).toEqual({
      model: "uniswap-v4-custom-accounting",
      currency: "ETH",
      currencyAddress: null,
      buyHookFeeBps: 100,
      sellHookFeeBps: 100,
      creatorFeeBps: 90,
      buyCreatorFeeBps: 90,
      sellCreatorFeeBps: 90,
      growthFeeBps: null,
      programmableFeeBps: 10,
      launcherFeeBps: 10,
      transferTaxBps: 0,
      lpFeePips: 0,
      launcherFeeIncludedInHookFee: true,
    });
    expect(result.links).toEqual({
      website: "https://programmable.family/",
      x: "https://x.com/0xProgrammable",
    });
  });

  it("keeps the launch and confirmed snapshot provenance", () => {
    expect(buildIndexerFeed(readyModel, 1)).toMatchObject({
      status: "ready",
      chainId: 1,
      snapshot: readyModel.snapshot,
      tokens: [
        {
          address: token.tokenAddress,
          canonicalPool: {
            protocol: "uniswap-v4",
            poolId: token.poolId,
            hookAddress: token.hookAddress,
            positionRecipient: token.positionRecipient,
            positionTokenId: "42",
          },
          launch: {
            transactionHash: token.launchTransactionHash,
            blockNumber: "123",
          },
        },
      ],
    });
  });

  it("publishes the complete verified Deep V2 launch provenance", () => {
    const deepToken: LauncherToken = {
      ...token,
      id: "deep",
      launchModel: "deep",
      deepReleaseVersion: "deep-full-range-v2",
      growthVaultAddress:
        "0x7777777777777777777777777777777777777777",
      deepV2Provenance: {
        deepReleaseVersion: "deep-full-range-v2",
        launcher: "0x8888888888888888888888888888888888888888",
        creator: token.creatorAddress!,
        tokenAddress: token.tokenAddress,
        vaultAddress:
          "0x7777777777777777777777777777777777777777",
        hookAddress: token.hookAddress,
        poolId: token.poolId,
        launchHash: `0x${"77".repeat(32)}`,
        vaultConfigurationHash: `0x${"88".repeat(32)}`,
        blockNumber: "123",
        blockHash: `0x${"99".repeat(32)}`,
        transactionHash: token.launchTransactionHash!,
        logIndex: 5,
      },
    };

    expect(serializeIndexerToken(deepToken, 1)).toMatchObject({
      launch: {
        model: "deep-v2",
        modelId: "deep",
        modelVersion: "deep-full-range-v2",
        deepV2Provenance: deepToken.deepV2Provenance,
      },
    });
  });

  it("publishes Deep V3 growth fees without inventing creator rewards", () => {
    const deepToken: LauncherToken = {
      ...token,
      id: "deep-v3",
      launchModel: "deep",
      deepReleaseVersion: "deep-full-range-v3",
      creatorFeeBps: undefined,
      buyCreatorFeeBps: undefined,
      sellCreatorFeeBps: undefined,
      growthFeeBps: 90,
      programmableFeeBps: 10,
      creatorFeesGeneratedWei: "0",
      creatorFeesAccruedWei: "0",
      growthFeesGeneratedWei: "900",
      growthFeesAccruedWei: "90",
      growthVaultAddress:
        "0x7777777777777777777777777777777777777777",
      totalNativeAddedToLiquidityWei: "700",
      totalTokenAddedToLiquidityRaw: "800",
      totalGrowthEthReceivedWei: "810",
      totalNativeSwappedWei: "100",
      totalTokenAcquiredRaw: "200",
      pendingGrowthNativeWei: "10",
      lockedLiquidity: "300",
      trustedNativeDepthWei: "400",
      rollingExposureWei: "50",
      compoundCount: "2",
      lastCompoundTimestamp: "1000",
      automationAction: 1,
      nextCompoundTimestamp: "1300",
      automationGuaranteed: false,
      launchTransactionIndex: 2,
      launchLogIndex: 5,
      deepV3Provenance: {
        deepReleaseVersion: "deep-full-range-v3",
        launchModel: "deep",
        launcher: "0x8888888888888888888888888888888888888888",
        creator: token.creatorAddress!,
        tokenAddress: token.tokenAddress,
        vaultAddress:
          "0x7777777777777777777777777777777777777777",
        hookAddress: token.hookAddress,
        positionRecipient: token.positionRecipient!,
        positionTokenId: token.positionTokenId!,
        poolId: token.poolId,
        launchHash: `0x${"77".repeat(32)}`,
        vaultConfigurationHash: `0x${"88".repeat(32)}`,
        blockNumber: "123",
        blockHash: `0x${"99".repeat(32)}`,
        transactionHash: token.launchTransactionHash!,
        transactionIndex: 2,
        logIndex: 5,
      },
    };

    expect(serializeIndexerToken(deepToken, 1)).toMatchObject({
      fees: {
        buyHookFeeBps: 100,
        sellHookFeeBps: 100,
        creatorFeeBps: null,
        buyCreatorFeeBps: null,
        sellCreatorFeeBps: null,
        growthFeeBps: 90,
        programmableFeeBps: 10,
        launcherFeeBps: 10,
      },
      launch: {
        model: "deep-v3",
        modelId: "deep",
        modelVersion: "deep-full-range-v3",
        deepReleaseVersion: "deep-full-range-v3",
        deepV2Provenance: null,
        deepV3Provenance: deepToken.deepV3Provenance,
      },
      liquidityGrowth: {
        growthVaultAddress: deepToken.growthVaultAddress,
        samePoolPermanentLiquidity: true,
        automationGuaranteed: false,
      },
    });
  });

  it("publishes the same explicit fees in the token list extensions", () => {
    const list = buildUniswapTokenList(
      readyModel,
      1,
      new Date("2026-07-27T12:00:00.000Z"),
    );

    expect(list.timestamp).toBe("2026-07-27T12:00:00.000Z");
    expect(list.version).toEqual({ major: 1, minor: 1, patch: 0 });
    expect(list.tokens[0]).toMatchObject({
      address: token.tokenAddress,
      logoURI: token.imageUrl,
      extensions: {
        programmable: {
          description: token.description,
          imageUrl: token.imageUrl,
          links: {
            website: "https://programmable.family/",
            x: "https://x.com/0xProgrammable",
          },
          hook: token.hookAddress,
          model: "v4-custom-accounting",
          launchModel: "classic",
          launchModelVersion: null,
          poolId: token.poolId,
          positionRecipient: token.positionRecipient,
          positionTokenId: token.positionTokenId,
          buyFeeBps: 100,
          sellFeeBps: 100,
          creatorFeeBps: 90,
          launcherFeeBps: 10,
          transferTaxBps: 0,
          feeIncluded: true,
        },
      },
    });
  });

  it("does not serve a schema-invalid empty token list", () => {
    const emptyModel: ExploreReadModel = {
      status: "not-deployed",
      tokens: [],
      snapshot: null,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    };

    expect(() =>
      buildUniswapTokenList(emptyModel, 1),
    ).toThrow("before the first verified launch");
  });

  it("rejects an impossible fee split", () => {
    expect(() =>
      serializeIndexerToken({ ...token, creatorFeeBps: 89 }, 1),
    ).toThrow("invalid fee disclosure");
  });

  it("discloses Stock-Paired identity, quote asset and pool ordering", () => {
    const stockToken: LauncherToken = {
      ...token,
      id: "stock-paired",
      tokenAddress:
        "0x65CBe55386e4bB35FCA4365dF64179B1e07bb6ab",
      launchModel: "stock-paired",
      launchModelVersion: "stock-paired-v2",
      quoteAssetAddress:
        "0x1F5fc5c3c8B0F15c7E21AF623936FF2b210b6415",
      quoteAssetSymbol: "USOon",
      quoteAssetName: "United States Oil Fund (Ondo Tokenized)",
      quoteIsCurrency0: true,
    };

    expect(serializeIndexerToken(stockToken, 1)).toMatchObject({
      canonicalPool: {
        tokenAddress: stockToken.tokenAddress,
        quoteAssetAddress: stockToken.quoteAssetAddress,
        quoteAssetSymbol: "USOon",
        quoteAssetName: "United States Oil Fund (Ondo Tokenized)",
        quoteIsCurrency0: true,
      },
      fees: {
        currency: "USOon",
        currencyAddress: stockToken.quoteAssetAddress,
      },
      launch: {
        model: "stock-paired",
        modelId: "stock-paired",
        modelVersion: "stock-paired-v2",
      },
    });
  });

  it("fails closed when Stock-Paired pool identity is incomplete", () => {
    expect(() =>
      serializeIndexerToken(
        {
          ...token,
          launchModel: "stock-paired",
          launchModelVersion: "stock-paired-v2",
        },
        1,
      ),
    ).toThrow("missing Stock-Paired pool identity");
  });

  it("supports direct lookup by contract address", () => {
    expect(
      findIndexerToken(
        readyModel,
        1,
        token.tokenAddress.toLowerCase(),
      ),
    ).toMatchObject({
      address: token.tokenAddress,
      name: token.name,
      symbol: token.symbol,
    });
    expect(
      findIndexerToken(
        readyModel,
        1,
        "0x9999999999999999999999999999999999999999",
      ),
    ).toBeNull();
  });

  it("never relabels an unversioned Deep token as Deep V1", () => {
    expect(() =>
      serializeIndexerToken(
        {
          ...token,
          launchModel: "deep",
        },
        1,
      ),
    ).toThrow("missing an exact Deep release");
  });

  it("refuses to infer fee fields that were not read onchain", () => {
    expect(() =>
      serializeIndexerToken(
        { ...token, transferTaxBps: undefined },
        1,
      ),
    ).toThrow("missing onchain fee disclosure");
  });

  it("serves the unchanged feed ABI from Alchemy", async () => {
    routeMocks.readAlchemyExploreModel.mockResolvedValueOnce(readyModel);
    const response = await getIndexerTokens(
      new Request(
        "https://programmable.family/api/indexers/v1/tokens",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "*",
    );
    expectAlchemyRpcHeaders(response);
    expect(routeMocks.getAlchemyOnchainDeployment).toHaveBeenCalledTimes(1);
    expect(routeMocks.readAlchemyExploreModel).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      schemaVersion: "programmable-indexer-v1",
      status: "ready",
      chainId: 1,
      snapshot: readyModel.snapshot,
      tokens: [
        {
          schemaVersion: "programmable-token-v1",
          address: token.tokenAddress,
        },
      ],
    });
  });

  it("fails closed with no-store when Alchemy is unavailable", async () => {
    routeMocks.readAlchemyExploreModel.mockRejectedValueOnce(
      new Error("Alchemy request failed"),
    );

    const response = await getIndexerTokens(
      new Request("https://programmable.family/api/indexers/v1/tokens"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectAlchemyRpcHeaders(response);
    expect(await response.json()).toEqual({
      error: "Indexer data is temporarily unavailable",
    });
  });

  it("serves direct token lookup from the same Alchemy model", async () => {
    routeMocks.readAlchemyExploreModel.mockResolvedValueOnce(readyModel);

    const response = await getIndexerTokens(
      new Request(
        `https://programmable.family/api/indexers/v1/tokens?address=${token.tokenAddress}`,
      ),
    );

    expect(response.status).toBe(200);
    expectAlchemyRpcHeaders(response);
    expect(await response.json()).toMatchObject({
      schemaVersion: "programmable-token-v1",
      address: token.tokenAddress,
      name: token.name,
      symbol: token.symbol,
    });
  });

  it("keeps the direct-token 404 cache contract after an Alchemy lookup", async () => {
    routeMocks.readAlchemyExploreModel.mockResolvedValueOnce(readyModel);

    const response = await getIndexerTokens(
      new Request(
        "https://programmable.family/api/indexers/v1/token?address=0x9999999999999999999999999999999999999999",
      ),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
    );
    expectAlchemyRpcHeaders(response);
    expect(await response.json()).toEqual({
      error: "Programmable token not found",
    });
  });

  it("rejects an invalid direct token lookup without reading chain state", async () => {
    const response = await getIndexerTokens(
      new Request(
        "https://programmable.family/api/indexers/v1/tokens?address=oil",
      ),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "*",
    );
    expectAlchemyRpcHeaders(response);
    expect(routeMocks.getAlchemyOnchainDeployment).not.toHaveBeenCalled();
    expect(routeMocks.readAlchemyExploreModel).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      error: "Invalid token address",
    });
  });

  it("does not expose a token list when Alchemy is unavailable", async () => {
    routeMocks.readAlchemyExploreModel.mockRejectedValueOnce(
      new Error("Alchemy request failed"),
    );
    const response = await getTokenList();

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "*",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectAlchemyRpcHeaders(response);
    expect(await response.json()).toEqual({
      error: "Token list is temporarily unavailable",
    });
  });

  it("keeps the exact cached first-launch response for an empty Alchemy model", async () => {
    routeMocks.readAlchemyExploreModel.mockResolvedValueOnce({
      ...readyModel,
      tokens: [],
    });

    const response = await getTokenList();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=60",
    );
    expect(response.headers.get("retry-after")).toBe("60");
    expectAlchemyRpcHeaders(response);
    expect(await response.json()).toEqual({
      status: "ready",
      error:
        "The token list will be available after the first verified launch",
    });
  });

  it("serves the token list from the Alchemy model", async () => {
    routeMocks.readAlchemyExploreModel.mockResolvedValueOnce(readyModel);

    const response = await getTokenList();
    const body = await response.json();

    expect(response.status).toBe(200);
    expectAlchemyRpcHeaders(response);
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).toMatchObject({
      address: token.tokenAddress,
      symbol: token.symbol,
    });
  });
});
