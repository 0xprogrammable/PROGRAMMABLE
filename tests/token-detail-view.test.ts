import { describe, expect, it } from "vitest";
import { parseEther } from "viem";

import {
  buildTokenDetailMetrics,
  parseDetailPayload,
} from "../components/token-detail-view";
import type { LauncherToken } from "../lib/tokens";

const token = {
  id: "programmable",
  name: "Programmable",
  symbol: "V4",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  hookAddress: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"33".repeat(32)}`,
  launchedAt: "Jul 28, 2026",
  tokenPriceEth: "0.002",
  tokenPriceUsdWad: parseEther("6").toString(),
  fdvUsdWad: parseEther("168560").toString(),
  grossVolumeEth: "300",
  creatorFeesGeneratedEth: "3",
  launcherFeesGeneratedEth: "0.3",
  totalSwapFeeBps: 100,
  liquidityPath: "meme",
} satisfies LauncherToken;

describe("token detail metrics", () => {
  it("shows only user-facing market stats and converts volume to USD", () => {
    expect(buildTokenDetailMetrics(token)).toEqual([
      { label: "Market cap", value: "$168.56K" },
      { label: "Volume", value: "$900K" },
      { label: "Swap fee", value: "1%" },
    ]);
  });

  it("never exposes internal fee accounting in the detail metrics", () => {
    const labels = buildTokenDetailMetrics(token).map(
      (metric) => metric.label,
    );

    expect(labels).not.toContain("Creator fees");
    expect(labels).not.toContain("Launcher fees");
    expect(labels).not.toContain("Network fee");
  });

  it("uses the chart-point market cap while the chart is inspected", () => {
    expect(buildTokenDetailMetrics(token, "$212.4K")[0]).toEqual({
      label: "Market cap",
      value: "$212.4K",
    });
  });

  it("labels the fixed Deep V3 hook charge without implying it includes protocol fees", () => {
    expect(
      buildTokenDetailMetrics({
        ...token,
        launchModel: "deep",
        deepReleaseVersion: "deep-full-range-v3",
      }).at(-1),
    ).toEqual({ label: "Deep fee", value: "1%" });
  });

  it("prefers official Uniswap v4 USD volume and shows pool liquidity", () => {
    const enriched = {
      ...token,
      uniswapV4Pool: {
        source: "official-uniswap-v4-subgraph",
        indexedBlockNumber: "25630000",
        indexedBlockHash: `0x${"44".repeat(32)}`,
        volumeUsdWad: parseEther("1234567").toString(),
        tvlUsdWad: parseEther("98765").toString(),
        transactionCount: "42",
        liquidity: "123456789",
        sqrtPriceX96: "79228162514264337593543950336",
        tick: -120,
        feeTierPips: "0",
      },
    } satisfies LauncherToken;

    expect(buildTokenDetailMetrics(enriched)).toEqual([
      { label: "Market cap", value: "$168.56K" },
      { label: "Volume", value: "$1.2M" },
      { label: "Liquidity", value: "$98.8K" },
      { label: "Swap fee", value: "1%" },
    ]);
  });

  it("strictly validates optional official Uniswap v4 pool analytics", () => {
    const validPool = {
      source: "official-uniswap-v4-subgraph",
      indexedBlockNumber: "25630000",
      indexedBlockHash: `0x${"44".repeat(32)}`,
      volumeUsdWad: parseEther("1234").toString(),
      tvlUsdWad: parseEther("98.7").toString(),
      transactionCount: "42",
      liquidity: "123456789",
      sqrtPriceX96: "79228162514264337593543950336",
      tick: -120,
      feeTierPips: "0",
    };
    const payload = {
      status: "ready",
      token: { ...token, uniswapV4Pool: validPool },
      snapshot: { chainId: 1 },
    };

    expect(
      parseDetailPayload(payload).token?.uniswapV4Pool,
    ).toEqual(validPool);
    expect(() =>
      parseDetailPayload({
        ...payload,
        token: {
          ...token,
          uniswapV4Pool: {
            ...validPool,
            volumeUsdWad: "1234.5",
          },
        },
      }),
    ).toThrow("invalid token record");
    expect(() =>
      parseDetailPayload({
        ...payload,
        token: {
          ...token,
          uniswapV4Pool: {
            ...validPool,
            unexpected: "not trusted",
          },
        },
      }),
    ).toThrow("invalid token record");
  });
});
