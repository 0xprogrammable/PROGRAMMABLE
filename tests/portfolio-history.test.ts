import { describe, expect, it } from "vitest";

import { keccak256, toBytes } from "viem";

import {
  buildPortfolioHistoryEnvelope,
  portfolioHistoryBucketStart,
  portfolioHistoryPath,
  validatePortfolioHistoryEnvelope,
} from "../lib/profile/portfolio-history";
import type { ExploreReadModel } from "../lib/onchain/types";

const creator = "0x1111111111111111111111111111111111111111";
const firstToken =
  "0x2222222222222222222222222222222222222222";
const secondToken =
  "0x3333333333333333333333333333333333333333";

function readyModel(): Extract<ExploreReadModel, { status: "ready" }> {
  return {
    status: "ready",
    tokens: [
      {
        id: "second",
        name: "Second",
        symbol: "TWO",
        tokenAddress: secondToken,
        hookAddress: "0x4444444444444444444444444444444444444444",
        poolId: `0x${"44".repeat(32)}`,
        creatorAddress: creator,
        launchedAt: "2026-07-29T00:00:00.000Z",
        marketCapEthWei: "2500000000000000000",
        fdvUsdWad: "9000000000000000000000",
        grossVolumeWei: "500000000000000000",
        creatorFeesGeneratedWei: "4500000000000000",
        creatorFeesAccruedWei: "2500000000000000",
        totalSwapFeeBps: 100,
        launchModel: "deep",
        liquidityPath: "meme",
      },
      {
        id: "first",
        name: "First",
        symbol: "ONE",
        tokenAddress: firstToken,
        hookAddress: "0x5555555555555555555555555555555555555555",
        poolId: `0x${"55".repeat(32)}`,
        creatorAddress: creator,
        launchedAt: "2026-07-29T00:00:00.000Z",
        marketCapQuoteWad: "120000000000000000000",
        quoteAssetSymbol: "USDC",
        totalSwapFeeBps: 100,
        launchModel: "stock-paired",
        liquidityPath: "meme",
      },
      {
        id: "without-creator",
        name: "Unattributed",
        symbol: "NONE",
        tokenAddress:
          "0x6666666666666666666666666666666666666666",
        hookAddress:
          "0x7777777777777777777777777777777777777777",
        poolId: `0x${"66".repeat(32)}`,
        launchedAt: "2026-07-29T00:00:00.000Z",
        totalSwapFeeBps: 100,
        liquidityPath: "meme",
      },
    ],
    snapshot: {
      chainId: 1,
      blockNumber: "23000000",
      blockHash: `0x${"88".repeat(32)}`,
      confirmations: 12,
      ethUsdQuote: {
        feedAddress:
          "0x9999999999999999999999999999999999999999",
        roundId: "12",
        answer: "360000000000",
        decimals: 8,
        updatedAt: "2026-07-29T05:30:00.000Z",
      },
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

describe("portfolio history", () => {
  it("uses deterministic five-minute UTC buckets and paths", () => {
    const capturedAt = new Date("2026-07-29T05:37:42.900Z");
    const bucket = portfolioHistoryBucketStart(capturedAt);

    expect(bucket).toBe("2026-07-29T05:35:00.000Z");
    expect(portfolioHistoryPath(1, bucket)).toBe(
      "history/portfolio/v1/1/2026/07/29/05-35-00.json",
    );
  });

  it("archives confirmed creator metrics in stable token order", () => {
    const envelope = buildPortfolioHistoryEnvelope(
      readyModel(),
      new Date("2026-07-29T05:37:42.900Z"),
    );

    expect(envelope.payload.tokens).toHaveLength(2);
    expect(envelope.payload.tokens.map((token) => token.tokenAddress)).toEqual([
      firstToken,
      secondToken,
    ]);
    expect(envelope.payload.tokens[0]).toMatchObject({
      creatorAddress: creator,
      launchModel: "stock-paired",
      marketCapQuoteWad: "120000000000000000000",
      quoteAssetSymbol: "USDC",
    });
    expect(envelope.payload.tokens[1]).toMatchObject({
      launchModel: "deep",
      marketCapUsdWad: "9000000000000000000000",
      marketCapNativeWei: "2500000000000000000",
      grossVolumeNativeWei: "500000000000000000",
      creatorRewardsGeneratedWei: "4500000000000000",
      creatorRewardsClaimableWei: "2500000000000000",
    });
    expect(envelope.payload.snapshot.blockNumber).toBe("23000000");
    expect(envelope.contentHash).toBe(
      keccak256(toBytes(JSON.stringify(envelope.payload))),
    );
    expect(validatePortfolioHistoryEnvelope(envelope)).toBe(true);
  });

  it("rejects unconfirmed models and malformed integer metrics", () => {
    expect(() =>
      buildPortfolioHistoryEnvelope({
        status: "not-deployed",
        tokens: [],
        snapshot: null,
        creatorClaims: [],
        launcherFeesAccruedWei: "0",
        launcherFeesAccruedEth: "0",
      }),
    ).toThrow("confirmed ready Explore model");

    const invalid = readyModel();
    invalid.tokens[0].fdvUsdWad = "9.5";
    expect(() => buildPortfolioHistoryEnvelope(invalid)).toThrow(
      "Token USD market cap is not an unsigned integer",
    );
  });

  it("detects modified history payloads", () => {
    const envelope = buildPortfolioHistoryEnvelope(
      readyModel(),
      new Date("2026-07-29T05:37:42.900Z"),
    );
    const modified = {
      ...envelope,
      payload: {
        ...envelope.payload,
        capturedAt: "2026-07-29T05:38:00.000Z",
      },
    };

    expect(validatePortfolioHistoryEnvelope(modified)).toBe(false);
  });
});
