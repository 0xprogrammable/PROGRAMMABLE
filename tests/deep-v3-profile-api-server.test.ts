import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";

import type { ExploreReadModel } from "../lib/onchain/types";
import { deepV3IndexedTokensForAccount } from "../lib/profile/deep-v3-api.server";
import type { LauncherToken } from "../lib/tokens";
import {
  DEEP_V3_TEST_ADDRESSES,
  DEEP_V3_TEST_CREATOR,
  DEEP_V3_TEST_TOKEN,
  DEEP_V3_TEST_VAULT,
  deepV3LiveManifestFixture,
  deepV3TestProvenance,
} from "./deep-v3-fixture";

vi.mock("server-only", () => ({}));

function indexedToken(): LauncherToken {
  const provenance = deepV3TestProvenance();
  return {
    id: DEEP_V3_TEST_TOKEN.toLowerCase(),
    name: "Deep Test",
    symbol: "DEEP",
    tokenAddress: DEEP_V3_TEST_TOKEN,
    hookAddress: DEEP_V3_TEST_ADDRESSES.feeHook,
    poolId: provenance.poolId,
    creatorAddress: DEEP_V3_TEST_CREATOR,
    positionRecipient: provenance.positionRecipient,
    positionTokenId: provenance.positionTokenId,
    launchHash: provenance.launchHash,
    launchBlockNumber: provenance.blockNumber,
    launchTransactionHash: provenance.transactionHash,
    launchTransactionIndex: provenance.transactionIndex,
    launchLogIndex: provenance.logIndex,
    launchedAt: "2026-07-29T12:00:00.000Z",
    totalSwapFeeBps: 100,
    launchModel: "deep",
    deepReleaseVersion: "deep-full-range-v3",
    growthVaultAddress: DEEP_V3_TEST_VAULT,
    deepV3Provenance: provenance,
    liquidityPath: "meme",
  };
}

function readyModel(tokens: LauncherToken[]): ExploreReadModel {
  return {
    status: "ready",
    tokens,
    snapshot: {
      chainId: 1,
      blockNumber: "200",
      blockHash: `0x${"90".repeat(32)}`,
      confirmations: 12,
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

describe("Deep V3 creator profile discovery", () => {
  it("accepts only release-bound indexed launches for the creator", () => {
    const candidates = deepV3IndexedTokensForAccount(
      readyModel([indexedToken()]),
      1,
      DEEP_V3_TEST_CREATOR,
      deepV3LiveManifestFixture(),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidate).toMatchObject({
      creator: DEEP_V3_TEST_CREATOR,
      tokenAddress: DEEP_V3_TEST_TOKEN,
      vaultAddress: DEEP_V3_TEST_VAULT,
    });
    expect(
      deepV3IndexedTokensForAccount(
        readyModel([indexedToken()]),
        1,
        getAddress("0xffffffffffffffffffffffffffffffffffffffff"),
        deepV3LiveManifestFixture(),
      ),
    ).toEqual([]);
  });

  it("fails closed on a mismatched top-level launch identity", () => {
    expect(() =>
      deepV3IndexedTokensForAccount(
        readyModel([
          {
            ...indexedToken(),
            growthVaultAddress:
              "0x1234567890123456789012345678901234567890",
          },
        ]),
        1,
        DEEP_V3_TEST_CREATOR,
        deepV3LiveManifestFixture(),
      ),
    ).toThrow(/verified provenance/);
  });
});
