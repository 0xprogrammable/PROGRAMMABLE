import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";

const DEPLOYER: `0x${string}` = "0x1111111111111111111111111111111111111111";
const TOKEN: `0x${string}` = "0x2222222222222222222222222222222222222222";
const QUOTE: `0x${string}` = "0x3333333333333333333333333333333333333333";
const VAULT: `0x${string}` = "0x4444444444444444444444444444444444444444";
const POSITION_RECIPIENT: `0x${string}` =
  "0x5555555555555555555555555555555555555555";
const SHARED_HOOK: `0x${string}` =
  "0x90c67c1e866f86526f0e338459cd435e1f23a0cc";
const POOL_ID =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LAUNCH_HASH =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REWARD_CONFIGURATION_HASH =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const QUOTE_CONFIGURATION_HASH =
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const BLOCK_HASH =
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const TRANSACTION_HASH =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const BLOCK_NUMBER = 25_650_020;

const block = { number: BLOCK_NUMBER, timestamp: 1_800_000_020, hash: BLOCK_HASH };
const transaction = { hash: TRANSACTION_HASH, transactionIndex: 3 };

const v3LaunchEvents = [
  {
    contract: "StockV2V3Hook" as const,
    event: "PoolRegistered" as const,
    logIndex: 50,
    block,
    transaction,
    params: {
      poolId: POOL_ID,
      token: TOKEN,
      quoteAsset: QUOTE,
      rewardVault: VAULT,
      registrar: DEPLOYER,
      quoteIsCurrency0: true,
      rewardConfigurationHash: REWARD_CONFIGURATION_HASH,
      quoteConfigurationHash: QUOTE_CONFIGURATION_HASH,
    },
  },
  {
    contract: "StockV2V3RewardVaultFactory" as const,
    event: "QuoteAssetFeeSplitVaultDeployed" as const,
    logIndex: 51,
    block,
    transaction,
    params: {
      vault: VAULT,
      feeHook: SHARED_HOOK,
      poolId: POOL_ID,
      quoteAsset: QUOTE,
    },
  },
  {
    contract: "StockV3Launcher" as const,
    event: "StockPairedLiquidityConfigured" as const,
    logIndex: 52,
    block,
    transaction,
    params: {
      token: TOKEN,
      quoteAsset: QUOTE,
      totalSupply: 1_000_000n,
      tokenLiquidityAmount: 900_000n,
      lockedTokenDust: 0n,
      initialTick: 0n,
      tickLower: -10n,
      tickUpper: 10n,
      lpFeePips: 3_000n,
      launchHash: LAUNCH_HASH,
    },
  },
  {
    contract: "StockV3Launcher" as const,
    event: "StockPairedCreatorInitialBuy" as const,
    logIndex: 53,
    block,
    transaction,
    params: {
      deployer: DEPLOYER,
      token: TOKEN,
      quoteAsset: QUOTE,
      poolId: POOL_ID,
      quoteAmount: 777n,
      tokenAmount: 888n,
      launchHash: LAUNCH_HASH,
    },
  },
  {
    contract: "StockV3Launcher" as const,
    event: "StockPairedTokenLaunched" as const,
    logIndex: 54,
    block,
    transaction,
    params: {
      deployer: DEPLOYER,
      token: TOKEN,
      quoteAsset: QUOTE,
      poolId: POOL_ID,
      rewardVault: VAULT,
      positionRecipient: POSITION_RECIPIENT,
      positionTokenId: 12n,
      launchHash: LAUNCH_HASH,
    },
  },
];

describe("Stock-Paired handlers", () => {
  it("resolves the shared hook and factory through poolId to Stock V3", async () => {
    const indexer = createTestIndexer();
    const result = await indexer.process({
      chains: {
        1: {
          startBlock: BLOCK_NUMBER,
          endBlock: BLOCK_NUMBER + 12,
          simulate: v3LaunchEvents,
        },
      },
    });

    expect(result.changes[0]?.addresses?.sets).toContainEqual({
      contract: "StockV2V3RewardVault",
      address: VAULT,
    });
    expect((await indexer.PoolFeeConfig.getOrThrow(`1:${POOL_ID}`))).toMatchObject({
      poolId: POOL_ID,
      releaseVersion: "stock-paired-v3",
      model: "stock-paired",
      provenanceValid: true,
    });
    expect(await indexer.RewardVault.getOrThrow(VAULT)).toMatchObject({
      releaseVersion: "stock-paired-v3",
      poolId: POOL_ID,
      hook: SHARED_HOOK,
      quoteAsset: QUOTE,
    });
  });

  it("keeps mismatched quote provenance incomplete", async () => {
    const indexer = createTestIndexer();
    const mismatchedQuote: `0x${string}` =
      "0x6666666666666666666666666666666666666666";
    const events = v3LaunchEvents.map((event) =>
      event.event === "StockPairedLiquidityConfigured"
        ? {
            ...event,
            params: { ...event.params, quoteAsset: mismatchedQuote },
          }
        : event,
    );

    await indexer.process({
      chains: {
        1: {
          startBlock: BLOCK_NUMBER,
          endBlock: BLOCK_NUMBER + 12,
          simulate: events,
        },
      },
    });

    const launch = await indexer.Launch.getOrThrow(
      `1:stock-paired-v3:${LAUNCH_HASH}`,
    );
    expect(launch.provenanceValid).toBe(false);
    expect(launch.isComplete).toBe(false);
    expect(launch.quoteAsset).toBe(QUOTE);
  });
});
