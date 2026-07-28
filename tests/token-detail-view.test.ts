import { describe, expect, it } from "vitest";
import { parseEther } from "viem";

import { buildTokenDetailMetrics } from "../components/token-detail-view";
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
      { label: "Price", value: "$6.00" },
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
});
