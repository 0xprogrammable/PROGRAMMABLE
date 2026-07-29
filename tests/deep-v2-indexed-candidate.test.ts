import { describe, expect, it } from "vitest";
import { getAddress, type Hex } from "viem";

import {
  requireDeepV2IndexedCandidate,
} from "../lib/profile/deep-v2-indexed-candidate";
import type { LauncherToken } from "../lib/tokens";

const CREATOR = getAddress("0x1111111111111111111111111111111111111111");
const TOKEN = getAddress("0x2222222222222222222222222222222222222222");
const VAULT = getAddress("0x3333333333333333333333333333333333333333");
const HOOK = getAddress("0x4444444444444444444444444444444444444444");
const LAUNCHER = getAddress("0x5555555555555555555555555555555555555555");
const POOL_ID = `0x${"66".repeat(32)}` as Hex;
const LAUNCH_HASH = `0x${"77".repeat(32)}` as Hex;
const CONFIGURATION_HASH = `0x${"88".repeat(32)}` as Hex;
const BLOCK_HASH = `0x${"99".repeat(32)}` as Hex;
const TRANSACTION_HASH = `0x${"aa".repeat(32)}` as Hex;

function indexedToken(): LauncherToken {
  return {
    id: `1:${TOKEN}`,
    name: "Deep V2",
    symbol: "DV2",
    tokenAddress: TOKEN,
    hookAddress: HOOK,
    poolId: POOL_ID,
    creatorAddress: CREATOR,
    growthVaultAddress: VAULT,
    launchHash: LAUNCH_HASH,
    launchBlockNumber: "123",
    launchTransactionHash: TRANSACTION_HASH,
    launchLogIndex: 4,
    launchedAt: "2026-07-29T00:00:00.000Z",
    totalSwapFeeBps: 100,
    launchModel: "deep",
    liquidityPath: "meme",
    deepV2Provenance: {
      deepReleaseVersion: "deep-full-range-v2",
      launcher: LAUNCHER,
      creator: CREATOR,
      tokenAddress: TOKEN,
      vaultAddress: VAULT,
      hookAddress: HOOK,
      poolId: POOL_ID,
      launchHash: LAUNCH_HASH,
      vaultConfigurationHash: CONFIGURATION_HASH,
      blockNumber: "123",
      blockHash: BLOCK_HASH,
      transactionHash: TRANSACTION_HASH,
      logIndex: 4,
    },
  };
}

describe("Deep V2 indexed candidate boundary", () => {
  it("accepts only the exact durable V2 launcher-event provenance", () => {
    expect(requireDeepV2IndexedCandidate(indexedToken())).toEqual({
      deepReleaseVersion: "deep-full-range-v2",
      launcher: LAUNCHER,
      creator: CREATOR,
      tokenAddress: TOKEN,
      vaultAddress: VAULT,
      hookAddress: HOOK,
      poolId: POOL_ID,
      launchHash: LAUNCH_HASH,
      vaultConfigurationHash: CONFIGURATION_HASH,
      blockNumber: 123n,
      blockHash: BLOCK_HASH,
      transactionHash: TRANSACTION_HASH,
      logIndex: 4,
    });
  });

  it("rejects an ambiguous Deep record without V2 provenance", () => {
    const token = indexedToken();
    delete token.deepV2Provenance;
    expect(() => requireDeepV2IndexedCandidate(token)).toThrow(
      "verified Deep V2 provenance",
    );
  });

  it("rejects any mismatch between the indexed token and its event provenance", () => {
    const token = indexedToken();
    if (!token.deepV2Provenance) throw new Error("Expected provenance");
    token.deepV2Provenance = {
      ...token.deepV2Provenance,
      hookAddress: LAUNCHER,
    };
    expect(() => requireDeepV2IndexedCandidate(token)).toThrow(
      "does not match",
    );
  });
});
