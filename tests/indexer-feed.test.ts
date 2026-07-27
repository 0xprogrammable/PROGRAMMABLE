import { describe, expect, it } from "vitest";

import { GET as getTokenList } from "../app/api/indexers/v1/token-list/route";
import { GET as getIndexerTokens } from "../app/api/indexers/v1/tokens/route";
import {
  buildIndexerFeed,
  buildUniswapTokenList,
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

describe("public indexer fee disclosure", () => {
  it("declares zero transfer tax and deducts the launcher share", () => {
    const result = serializeIndexerToken(token, 1);

    expect(result.fees).toEqual({
      model: "uniswap-v4-custom-accounting",
      currency: "ETH",
      buyHookFeeBps: 100,
      sellHookFeeBps: 100,
      creatorFeeBps: 90,
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

  it("refuses to infer fee fields that were not read onchain", () => {
    expect(() =>
      serializeIndexerToken(
        { ...token, transferTaxBps: undefined },
        1,
      ),
    ).toThrow("missing onchain fee disclosure");
  });

  it("keeps the production feed fail-closed before V2 is ready", async () => {
    const response = await getIndexerTokens();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "*",
    );
    expect(await response.json()).toMatchObject({
      status: "not-deployed",
      chainId: 1,
      tokens: [],
    });
  });

  it("does not expose an invalid empty production token list", async () => {
    const response = await getTokenList();

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "*",
    );
    expect(await response.json()).toEqual({
      status: "not-deployed",
      error:
        "The token list will be available after the first verified launch",
    });
  });
});
