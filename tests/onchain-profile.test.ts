import { describe, expect, it } from "vitest";

import { buildCreatorProfile } from "../lib/onchain/profile";
import type { ExploreReadModel } from "../lib/onchain/types";

const creator = "0x1111111111111111111111111111111111111111";
const tokenAddress = "0x2222222222222222222222222222222222222222";
const poolId = `0x${"33".repeat(32)}` as `0x${string}`;

describe("creator profile projection", () => {
  it("returns only the creator's verified pools and claim history", () => {
    const model: ExploreReadModel = {
      status: "ready",
      tokens: [
        {
          id: "1:token",
          name: "Programmable",
          symbol: "PRG",
          tokenAddress,
          hookAddress:
            "0x4444444444444444444444444444444444444444",
          poolId,
          creatorAddress: creator,
          launchedAt: "2026-07-27T00:00:00.000Z",
          creatorFeesAccruedWei: "200000000000000000",
          creatorFeesAccruedEth: "0.2",
          creatorFeesGeneratedWei: "500000000000000000",
          creatorFeesGeneratedEth: "0.5",
          totalSwapFeeBps: 100,
          liquidityPath: "meme",
        },
      ],
      creatorClaims: [
        {
          poolId,
          tokenAddress,
          creatorAddress: creator,
          recipientAddress: creator,
          callerAddress: creator,
          amountWei: "300000000000000000",
          amountEth: "0.3",
          blockNumber: "10",
          transactionHash: `0x${"55".repeat(32)}`,
          transactionIndex: 0,
          logIndex: 1,
          claimedAt: "2026-07-27T00:00:01.000Z",
        },
      ],
      snapshot: {
        chainId: 1,
        blockNumber: "20",
        blockHash: `0x${"66".repeat(32)}`,
        confirmations: 12,
      },
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    };

    const profile = buildCreatorProfile(model, creator);
    expect(profile.tokens).toHaveLength(1);
    expect(profile.claims).toHaveLength(1);
    expect(profile.totals).toEqual({
      claimableWei: "200000000000000000",
      claimableEth: "0.2",
      generatedWei: "500000000000000000",
      generatedEth: "0.5",
      claimedWei: "300000000000000000",
      claimedEth: "0.3",
    });
  });
});
