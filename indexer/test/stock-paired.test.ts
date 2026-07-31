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
const MISMATCHED_VAULT: `0x${string}` =
  "0x6666666666666666666666666666666666666666";

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
    contract: "StockV2V3Hook" as const,
    event: "PoolFeeDisclosure" as const,
    logIndex: 51,
    block,
    transaction,
    params: {
      poolId: POOL_ID,
      token: TOKEN,
      quoteAsset: QUOTE,
      rewardVault: VAULT,
      buySwapFeeBps: 100n,
      sellSwapFeeBps: 200n,
      creatorFeeBps: 90n,
      launcherFeeBps: 10n,
      transferTaxBps: 0n,
      lpFeePips: 3_000n,
    },
  },
  {
    contract: "StockV2V3RewardVaultFactory" as const,
    event: "QuoteAssetFeeSplitVaultDeployed" as const,
    logIndex: 52,
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
    contract: "StockV2V3Hook" as const,
    event: "QuoteSwapFeesAccrued" as const,
    logIndex: 53,
    block,
    transaction,
    params: {
      poolId: POOL_ID,
      swapSender: DEPLOYER,
      quoteAsset: QUOTE,
      isBuy: true,
      grossQuoteAmount: 10_000n,
      creatorFee: 900n,
      launcherFee: 100n,
    },
  },
  {
    contract: "StockV3Launcher" as const,
    event: "StockPairedLiquidityConfigured" as const,
    logIndex: 54,
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
    logIndex: 55,
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
    logIndex: 56,
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
  {
    contract: "StockV2V3RewardVault" as const,
    event: "BeneficiaryFeesClaimed" as const,
    srcAddress: VAULT,
    logIndex: 57,
    block,
    transaction,
    params: {
      beneficiary: DEPLOYER,
      payoutAddress: POSITION_RECIPIENT,
      quoteAsset: QUOTE,
      amount: 9_007_199_254_740_993n,
      beneficiaryTotalClaimed: 90_071_992_547_409_931n,
      vaultTotalReceived: 900_719_925_474_099_311n,
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
    expect(
      await indexer.Launch.getOrThrow(
        `1:stock-paired-v3:${LAUNCH_HASH}`,
      ),
    ).toMatchObject({
      rewardConfigurationHash: REWARD_CONFIGURATION_HASH,
      quoteConfigurationHash: QUOTE_CONFIGURATION_HASH,
      provenanceValid: true,
      isComplete: true,
    });
    expect(await indexer.RewardVault.getOrThrow(VAULT)).toMatchObject({
      releaseVersion: "stock-paired-v3",
      poolId: POOL_ID,
      hook: SHARED_HOOK,
      quoteAsset: QUOTE,
    });
    expect((await indexer.BeneficiaryClaim.getAll())[0]).toMatchObject({
      vault: VAULT,
      beneficiary: DEPLOYER,
      payoutAddress: POSITION_RECIPIENT,
      quoteAsset: QUOTE,
      amount: 9_007_199_254_740_993n,
      beneficiaryTotalClaimed: 90_071_992_547_409_931n,
      vaultTotalReceived: 900_719_925_474_099_311n,
      releaseVersion: "stock-paired-v3",
      downstreamLogicalId: undefined,
      receiptLogOrdinal: undefined,
    });
    const accrual = (await indexer.FeeAccrual.getAll())[0];
    expect(accrual).toMatchObject({
      releaseVersion: "stock-paired-v3",
      model: "stock-paired",
      poolId: POOL_ID,
      quoteAsset: QUOTE,
      grossAmount: 10_000n,
      creatorFee: 900n,
      launcherFee: 100n,
    });
    expect(
      await indexer.ChainEvent.getOrThrow(accrual!.id),
    ).toMatchObject({
      releaseVersion: "unresolved",
      model: "unresolved",
    });
    expect(await indexer.PoolFeeTotals.getOrThrow(`1:${POOL_ID}`)).toMatchObject({
      releaseVersion: "stock-paired-v3",
      model: "stock-paired",
      grossAmount: 10_000n,
      creatorFees: 900n,
      launcherFees: 100n,
      swapCount: 1n,
    });
  });

  it("resolves the same shared hook and factory through poolId to Stock V2", async () => {
    const indexer = createTestIndexer();
    const v2LaunchEvents = v3LaunchEvents.map((event) =>
      event.contract === "StockV3Launcher"
        ? { ...event, contract: "StockV2Launcher" as const }
        : event,
    );

    await indexer.process({
      chains: {
        1: {
          startBlock: BLOCK_NUMBER,
          endBlock: BLOCK_NUMBER + 12,
          simulate: v2LaunchEvents,
        },
      },
    });

    expect((await indexer.PoolFeeConfig.getOrThrow(`1:${POOL_ID}`))).toMatchObject({
      releaseVersion: "stock-paired-v2",
      model: "stock-paired",
      provenanceValid: true,
    });
    expect(await indexer.RewardVault.getOrThrow(VAULT)).toMatchObject({
      releaseVersion: "stock-paired-v2",
      poolId: POOL_ID,
      hook: SHARED_HOOK,
      quoteAsset: QUOTE,
    });
    expect((await indexer.BeneficiaryClaim.getAll())[0]).toMatchObject({
      releaseVersion: "stock-paired-v2",
      amount: 9_007_199_254_740_993n,
    });
    expect((await indexer.FeeAccrual.getAll())[0]).toMatchObject({
      releaseVersion: "stock-paired-v2",
      model: "stock-paired",
      grossAmount: 10_000n,
    });
  });

  it("invalidates a complete launch when a mismatched shared hook event arrives later", async () => {
    const indexer = createTestIndexer();
    const events = v3LaunchEvents.map((event) =>
      event.contract === "StockV2V3Hook" &&
      event.event === "PoolRegistered"
        ? {
            ...event,
            logIndex: 58,
            params: {
              ...event.params,
              rewardVault: MISMATCHED_VAULT,
            },
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

    expect(
      await indexer.Launch.getOrThrow(
        `1:stock-paired-v3:${LAUNCH_HASH}`,
      ),
    ).toMatchObject({
      provenanceValid: false,
      isComplete: false,
    });
  });

  it.each([
    ["before", 52],
    ["after", 58],
  ])(
    "invalidates a conflicting same-pool factory vault emitted %s the launcher",
    async (_order, factoryLogIndex) => {
      const indexer = createTestIndexer();
      const events = v3LaunchEvents
        .filter((event) => event.contract !== "StockV2V3RewardVault")
        .map((event) =>
          event.contract === "StockV2V3RewardVaultFactory"
            ? {
                ...event,
                logIndex: factoryLogIndex,
                params: {
                  ...event.params,
                  vault: MISMATCHED_VAULT,
                },
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

      expect(
        await indexer.RewardVault.getOrThrow(MISMATCHED_VAULT),
      ).toMatchObject({
        poolId: POOL_ID,
        hook: SHARED_HOOK,
        quoteAsset: QUOTE,
      });
      expect(
        await indexer.Launch.getOrThrow(
          `1:stock-paired-v3:${LAUNCH_HASH}`,
        ),
      ).toMatchObject({
        provenanceValid: false,
        isComplete: false,
      });
    },
  );

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
