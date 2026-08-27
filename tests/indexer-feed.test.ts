import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as getTokenList } from "../app/api/indexers/v1/token-list/route";
import { GET as getIndexerTokens } from "../app/api/indexers/v1/tokens/route";
import {
  buildIndexerFeed,
  buildUniswapTokenList,
  buildUniswapTokenListResult,
  findIndexerToken,
  serializeIndexerToken,
} from "../lib/onchain/indexer-feed";
import type { ExploreReadModel } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";
import {
  customGraphToken,
  stampedClassicToken,
} from "./launch-stamp-surface-fixture";

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
  launchDiscoverySnapshot: {
    chainId: 1,
    blockNumber: "140",
    blockHash: `0x${"77".repeat(32)}`,
    confirmations: 0,
  },
  creatorClaims: [],
  launcherFeesAccruedWei: "0",
  launcherFeesAccruedEth: "0",
};

describe("public indexer fee disclosure", () => {
  it("declares zero transfer tax and deducts the launcher share", () => {
    const result = serializeIndexerToken(token, 1);

    expect(result.fees).toEqual({
      status: "verified",
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
      launchDiscoverySnapshot: readyModel.launchDiscoverySnapshot,
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
    const feed = buildIndexerFeed(readyModel, 1);
    expect(
      feed.tokens.every(
        (candidate) =>
          candidate.launch.blockNumber == null ||
          BigInt(candidate.launch.blockNumber) <=
            BigInt(feed.launchDiscoverySnapshot!.blockNumber),
      ),
    ).toBe(true);
  });

  it("preserves the exact Classic V4 release in feeds and token lists", () => {
    const classicV4Token: LauncherToken = {
      ...token,
      id: "classic-v4",
      launchModel: "classic",
      launchModelVersion: "classic-v4",
    };
    const serialized = serializeIndexerToken(classicV4Token, 1);
    const model = {
      ...readyModel,
      tokens: [classicV4Token],
    } satisfies ExploreReadModel;

    expect(serialized.launch).toMatchObject({
      model: "classic",
      modelId: "classic",
      modelVersion: "classic-v4",
      category: "classic",
    });
    expect(buildIndexerFeed(model, 1).tokens[0]?.launch.modelVersion)
      .toBe("classic-v4");
    expect(
      buildUniswapTokenList(model, 1).tokens[0]?.extensions.programmable
        .launchModelVersion,
    ).toBe("classic-v4");
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
          feeStatus: "verified",
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
    ).toThrow("before the first finalized launch");
  });

  it("rejects an impossible fee split", () => {
    expect(() =>
      serializeIndexerToken({ ...token, creatorFeeBps: 89 }, 1),
    ).toThrow("invalid fee disclosure");
  });

  it.each([
    ["Custom", customGraphToken, "custom"],
    ["stamped Classic", stampedClassicToken, "classic"],
  ] as const)(
    "publishes %s Router provenance without inventing unknown fees",
    (_, stampedToken, category) => {
      const withLegacyPositionIdentity = {
        ...stampedToken,
        positionRecipient:
          "0x7777777777777777777777777777777777777777",
        positionTokenId: "42",
      } satisfies LauncherToken;
      const result = serializeIndexerToken(withLegacyPositionIdentity, 1);

      expect(result.fees).toEqual({
        status: "unknown",
        model: "unknown",
        currency: null,
        currencyAddress: null,
        buyHookFeeBps: null,
        sellHookFeeBps: null,
        creatorFeeBps: null,
        buyCreatorFeeBps: null,
        sellCreatorFeeBps: null,
        growthFeeBps: null,
        programmableFeeBps: null,
        launcherFeeBps: null,
        transferTaxBps: null,
        lpFeePips: null,
        launcherFeeIncludedInHookFee: null,
      });
      expect(result.canonicalPool).toMatchObject({
        poolId: stampedToken.poolId,
        hookAddress: stampedToken.hookAddress,
        poolManagerAddress:
          stampedToken.launchStampProvenance.poolManagerAddress,
        poolKey: stampedToken.launchStampProvenance.poolKey,
        positionRecipient: null,
        positionTokenId: null,
      });
      expect(result.launch).toMatchObject({
        modelId: stampedToken.launchModel,
        modelVersion: "programmable-launch-stamp-router-v1",
        category,
      });
      expect(result.launch.launchStampProvenance).toEqual(
        stampedToken.launchStampProvenance,
      );
    },
  );

  it.each([
    ["Custom", customGraphToken],
    ["stamped Classic", stampedClassicToken],
  ] as const)("rejects invented %s Router fee fields", (_, stampedToken) => {
    expect(() =>
      serializeIndexerToken({
        ...stampedToken,
        buyHookFeeBps: 0,
      }, 1),
    ).toThrow("invented Router fee disclosure");
    expect(() =>
      serializeIndexerToken({
        ...stampedToken,
        totalSwapFeeBps: 100,
      }, 1),
    ).toThrow("mismatched launch stamp disclosure");
  });

  it("preserves a stamped token with unknown decimals outside the standard token list", () => {
    const withoutDecimals: LauncherToken = { ...customGraphToken };
    delete withoutDecimals.tokenDecimals;
    const poisonedModel = {
      ...readyModel,
      tokens: [withoutDecimals, token],
    } satisfies ExploreReadModel;

    expect(serializeIndexerToken(withoutDecimals, 1)).toMatchObject({
      address: withoutDecimals.tokenAddress,
      decimals: null,
      launch: {
        launchStampProvenance: withoutDecimals.launchStampProvenance,
      },
    });
    expect(buildIndexerFeed(poisonedModel, 1).tokens[0]).toMatchObject({
      address: withoutDecimals.tokenAddress,
      decimals: null,
      launch: {
        launchStampProvenance: withoutDecimals.launchStampProvenance,
      },
    });
    expect(findIndexerToken(
      poisonedModel,
      1,
      withoutDecimals.tokenAddress,
    )).toMatchObject({
      decimals: null,
      launch: {
        launchStampProvenance: withoutDecimals.launchStampProvenance,
      },
    });
    const result = buildUniswapTokenListResult(poisonedModel, 1);
    expect(result.omissions).toEqual({
      count: 1,
      reason: "missing-valid-decimals",
    });
    expect(result.tokenList).not.toHaveProperty("omissions");
    expect(result.tokenList?.tokens.map(
      (candidate) => candidate.address,
    )).toEqual([token.tokenAddress]);
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

  it.each([
    ["tokens", () => getIndexerTokens()],
    ["token list", () => getTokenList()],
  ])("retires the public %s route without reading another provider", async (
    _label,
    request,
  ) => {
    const response = await request();

    expect(response.status).toBe(410);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-programmable-read-source")).toBe("retired");
    expect(await response.json()).toEqual({
      error: "This indexer feed has been retired. Use /api/explore.",
    });
  });
});
