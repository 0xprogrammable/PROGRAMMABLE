import { describe, expect, it } from "vitest";

import {
  assertValidEthUsdSnapshot,
  enrichTokenWithUsd,
  usdValueFromWei,
} from "../lib/onchain/usd";
import type { LauncherToken } from "../lib/tokens";

const token: LauncherToken = {
  id: "test",
  name: "Test",
  symbol: "TEST",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  hookAddress: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"33".repeat(32)}`,
  launchedAt: "2026-07-27T00:00:00.000Z",
  tokenPriceEthWei: "1000000000",
  marketCapEthWei: "1500000000000000000",
  grossVolumeWei: "250000000000000000",
  totalSwapFeeBps: 100,
  liquidityPath: "meme",
};

describe("ETH/USD display enrichment", () => {
  it("converts wei values with the feed's fixed-point precision", () => {
    expect(usdValueFromWei("1000000000000000000", 3_500_00000000n, 8)).toBe(
      "3500000000000000000000",
    );
    expect(usdValueFromWei("0", 3_500_00000000n, 8)).toBe("0");
  });

  it("enriches price and market cap without replacing ETH truth", () => {
    const enriched = enrichTokenWithUsd(token, {
      answer: 3_500_00000000n,
      decimals: 8,
    });

    expect(enriched.tokenPriceUsdWad).toBe("3500000000000");
    expect(enriched.fdvUsdWad).toBe("5250000000000000000000");
    expect(enriched.marketCapEthWei).toBe(token.marketCapEthWei);
    expect(enriched.grossVolumeWei).toBe(token.grossVolumeWei);
  });

  it("omits malformed values instead of fabricating a USD number", () => {
    expect(usdValueFromWei("not-a-number", 3_500_00000000n, 8)).toBeUndefined();
    expect(usdValueFromWei("1", 0n, 8)).toBeUndefined();
  });

  it("rejects stale, future and reorged oracle observations", () => {
    const valid = {
      expectedBlockHash: `0x${"11".repeat(32)}` as `0x${string}`,
      actualBlockHash: `0x${"11".repeat(32)}` as `0x${string}`,
      blockTimestamp: 10_000n,
      roundId: 2n,
      answeredInRound: 2n,
      answer: 3_500_00000000n,
      updatedAt: 9_000n,
    };
    expect(() => assertValidEthUsdSnapshot(valid)).not.toThrow();
    expect(() =>
      assertValidEthUsdSnapshot({ ...valid, answeredInRound: 1n }),
    ).toThrow("invalid or stale");
    expect(() =>
      assertValidEthUsdSnapshot({ ...valid, updatedAt: 10_001n }),
    ).toThrow("invalid or stale");
    expect(() =>
      assertValidEthUsdSnapshot({ ...valid, blockTimestamp: 20_000n }),
    ).toThrow("invalid or stale");
    expect(() =>
      assertValidEthUsdSnapshot({
        ...valid,
        actualBlockHash: `0x${"22".repeat(32)}`,
      }),
    ).toThrow("invalid or stale");
  });
});
