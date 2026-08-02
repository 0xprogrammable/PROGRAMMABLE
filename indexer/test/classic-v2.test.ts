import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";

const CREATOR = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const HOOK = "0x025a386eaa79f6067d29848fd05ccc71beab20cc";
const POSITION_RECIPIENT = "0x3333333333333333333333333333333333333333";
const POOL_ID =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LAUNCH_HASH =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BLOCK_HASH =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const TRANSACTION_HASH =
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const LAUNCH_ID = `1:classic-v2:${LAUNCH_HASH}`;
const BLOCK_NUMBER = 25_650_000;

const block = { number: BLOCK_NUMBER, timestamp: 1_800_000_000, hash: BLOCK_HASH };
const transaction = { hash: TRANSACTION_HASH, transactionIndex: 8 };

describe("Classic V2 handlers", () => {
  it("assembles shuffled launch facts by release, launch hash, and token", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "ClassicV2Launcher",
              event: "MemeLiquidityConfigured",
              logIndex: 20,
              block,
              transaction,
              params: {
                token: TOKEN,
                totalSupply: 1_000_000_000_000_000_000_000_000n,
                tokenLiquidityAmount: 900_000_000_000_000_000_000_000n,
                lockedTokenDust: 7n,
                initialTick: 204_200n,
                tickLower: 200_000n,
                tickUpper: 210_000n,
                lpFeePips: 3_000n,
                launchHash: LAUNCH_HASH,
              },
            },
            {
              contract: "ClassicV2Launcher",
              event: "MemeCreatorInitialBuy",
              logIndex: 21,
              block,
              transaction,
              params: {
                creator: CREATOR,
                token: TOKEN,
                poolId: POOL_ID,
                nativeAmount: 600_000_000_000_000n,
                tokenAmount: 437_971_781_612_384_114_831_424n,
                launchHash: LAUNCH_HASH,
              },
            },
            {
              contract: "ClassicV2Launcher",
              event: "MemeTokenLaunched",
              logIndex: 22,
              block,
              transaction,
              params: {
                creator: CREATOR,
                token: TOKEN,
                poolId: POOL_ID,
                feeHook: HOOK,
                positionRecipient: POSITION_RECIPIENT,
                positionTokenId: 351_734n,
                totalSwapFeeBps: 100n,
                launchHash: LAUNCH_HASH,
              },
            },
            {
              contract: "ClassicV2Hook",
              event: "PoolRegistered",
              logIndex: 23,
              block,
              transaction,
              params: {
                poolId: POOL_ID,
                token: TOKEN,
                creator: CREATOR,
                registrar: CREATOR,
                totalSwapFeeBps: 100n,
              },
            },
            {
              contract: "ClassicV2Hook",
              event: "PoolFeeDisclosure",
              logIndex: 24,
              block,
              transaction,
              params: {
                poolId: POOL_ID,
                token: TOKEN,
                buySwapFeeBps: 100n,
                sellSwapFeeBps: 100n,
                launcherFeeBps: 10n,
                transferTaxBps: 0n,
                lpFeePips: 3_000n,
              },
            },
          ],
        },
      },
    });

    const launch = await indexer.Launch.getOrThrow(LAUNCH_ID);
    expect(launch).toMatchObject({
      releaseVersion: "classic-v2",
      model: "classic",
      token: TOKEN,
      creator: CREATOR,
      poolId: POOL_ID,
      hook: HOOK,
      totalSupply: 1_000_000_000_000_000_000_000_000n,
      initialBuyQuoteAmount: 600_000_000_000_000n,
      initialBuyTokenAmount: 437_971_781_612_384_114_831_424n,
      hasLaunchEvent: true,
      hasLiquidityEvent: true,
      hasInitialBuyEvent: true,
      provenanceValid: true,
      isComplete: true,
    });
  });

  it("does not manufacture a complete launch from a mismatched token", async () => {
    const indexer = createTestIndexer();
    const mismatchedToken = "0x4444444444444444444444444444444444444444";

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "ClassicV2Launcher",
              event: "MemeTokenLaunched",
              logIndex: 30,
              block,
              transaction,
              params: {
                creator: CREATOR,
                token: TOKEN,
                poolId: POOL_ID,
                feeHook: HOOK,
                positionRecipient: POSITION_RECIPIENT,
                positionTokenId: 1n,
                totalSwapFeeBps: 100n,
                launchHash: LAUNCH_HASH,
              },
            },
            {
              contract: "ClassicV2Launcher",
              event: "MemeLiquidityConfigured",
              logIndex: 31,
              block,
              transaction,
              params: {
                token: mismatchedToken,
                totalSupply: 1n,
                tokenLiquidityAmount: 1n,
                lockedTokenDust: 0n,
                initialTick: 0n,
                tickLower: -1n,
                tickUpper: 1n,
                lpFeePips: 3_000n,
                launchHash: LAUNCH_HASH,
              },
            },
            {
              contract: "ClassicV2Launcher",
              event: "MemeCreatorInitialBuy",
              logIndex: 32,
              block,
              transaction,
              params: {
                creator: CREATOR,
                token: TOKEN,
                poolId: POOL_ID,
                nativeAmount: 0n,
                tokenAmount: 0n,
                launchHash: LAUNCH_HASH,
              },
            },
          ],
        },
      },
    });

    const launch = await indexer.Launch.getOrThrow(LAUNCH_ID);
    expect(launch.provenanceValid).toBe(false);
    expect(launch.isComplete).toBe(false);
    expect(launch.token).toBe(TOKEN);
  });
});
