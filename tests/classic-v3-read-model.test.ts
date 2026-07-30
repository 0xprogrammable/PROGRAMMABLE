import { describe, expect, it } from "vitest";

import { mergeClassicV3ExploreModel } from "../lib/onchain/classic-v3-read-model";
import type { ExploreReadModel } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";

const token: LauncherToken = {
  id: "1:0x0000000000000000000000000000000000000001",
  name: "Classic V3",
  symbol: "CV3",
  tokenAddress: "0x0000000000000000000000000000000000000001",
  hookAddress: "0x0000000000000000000000000000000000000002",
  poolId: `0x${"11".repeat(32)}`,
  launchTransactionHash: `0x${"22".repeat(32)}`,
  launchedAt: "2026-07-30T00:00:00.000Z",
  totalSwapFeeBps: 100,
  launchModel: "classic",
  launchModelVersion: "classic-v3",
  liquidityPath: "meme",
};

const model: ExploreReadModel = {
  status: "ready",
  tokens: [],
  snapshot: {
    chainId: 1,
    blockNumber: "1",
    blockHash: `0x${"33".repeat(32)}`,
    confirmations: 12,
  },
  creatorClaims: [],
  launcherFeesAccruedWei: "5",
  launcherFeesAccruedEth: "0.000000000000000005",
};

describe("Classic V3 Explore merge", () => {
  it("adds the release once and remains idempotent", () => {
    const merged = mergeClassicV3ExploreModel(model, {
      tokens: [token],
      launcherFeesAccrued: 7n,
    });
    expect(merged.tokens).toEqual([token]);
    expect(merged.launcherFeesAccruedWei).toBe("12");

    const repeated = mergeClassicV3ExploreModel(merged, {
      tokens: [token],
      launcherFeesAccrued: 7n,
    });
    expect(repeated.launcherFeesAccruedWei).toBe("12");
  });

  it("rejects a conflicting launch identity", () => {
    expect(() =>
      mergeClassicV3ExploreModel(
        { ...model, tokens: [token] },
        {
          tokens: [
            {
              ...token,
              launchTransactionHash: `0x${"44".repeat(32)}`,
            },
          ],
          launcherFeesAccrued: 0n,
        },
      ),
    ).toThrow("Duplicate token across launch releases");
  });
});
