import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";

const DEPLOYER = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const HOOK = "0x35fe236ea82f7cf525c9719d7df8f49f94d720cc";
const VAULT = "0x3333333333333333333333333333333333333333";
const CONFLICTING_VAULT =
  "0x6666666666666666666666666666666666666666";
const CUSTODY = "0x4444444444444444444444444444444444444444";
const POSITION_RECIPIENT = "0x5555555555555555555555555555555555555555";
const POOL_ID =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CONFIGURATION_HASH =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CUSTODY_CONFIGURATION_HASH =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const LAUNCH_HASH =
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const BLOCK_HASH =
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const TRANSACTION_HASH =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const BLOCK_NUMBER = 25_650_010;

const block = { number: BLOCK_NUMBER, timestamp: 1_800_000_010, hash: BLOCK_HASH };
const transaction = { hash: TRANSACTION_HASH, transactionIndex: 2 };

describe("Classic V3 handlers", () => {
  it("registers a vault in the factory block and preserves custody mode as uint8", async () => {
    const indexer = createTestIndexer();
    const result = await indexer.process({
      chains: {
        1: {
          startBlock: BLOCK_NUMBER,
          endBlock: BLOCK_NUMBER + 12,
          simulate: [
            {
              contract: "ClassicV3RewardVaultFactory",
              event: "ClassicRewardVaultDeployed",
              logIndex: 40,
              block,
              transaction,
              params: {
                vault: VAULT,
                poolId: POOL_ID,
                feeHook: HOOK,
                salt: CONFIGURATION_HASH,
                configurationHash: CONFIGURATION_HASH,
              },
            },
            {
              contract: "ClassicV3RewardVault",
              event: "CreatorFeesCheckpointed",
              srcAddress: VAULT,
              logIndex: 41,
              block,
              transaction,
              params: {
                poolId: POOL_ID,
                configurationEpoch: 1n,
                amount: 9_007_199_254_740_993n,
                totalCreatorFeesReceived: 90_071_992_547_409_931n,
              },
            },
            {
              contract: "ClassicV3Launcher",
              event: "MemeLiquidityConfiguredV2",
              logIndex: 42,
              block,
              transaction,
              params: {
                token: TOKEN,
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
              contract: "ClassicV3Launcher",
              event: "MemeCreatorInitialBuyV2",
              logIndex: 43,
              block,
              transaction,
              params: {
                deployer: DEPLOYER,
                token: TOKEN,
                poolId: POOL_ID,
                nativeAmount: 999n,
                tokenAmount: 888n,
                launchHash: LAUNCH_HASH,
              },
            },
            {
              contract: "ClassicV3Launcher",
              event: "MemeCreatorInitialBuyCustodyV2",
              logIndex: 44,
              block,
              transaction,
              params: {
                deployer: DEPLOYER,
                token: TOKEN,
                custody: CUSTODY,
                mode: 2n,
                durationDays: 365n,
                cliffDays: 30n,
                configurationHash: CUSTODY_CONFIGURATION_HASH,
                launchHash: LAUNCH_HASH,
              },
            },
            {
              contract: "ClassicV3Launcher",
              event: "MemeTokenLaunchedV2",
              logIndex: 45,
              block,
              transaction,
              params: {
                deployer: DEPLOYER,
                token: TOKEN,
                poolId: POOL_ID,
                feeHook: HOOK,
                rewardVault: VAULT,
                positionRecipient: POSITION_RECIPIENT,
                positionTokenId: 42n,
                buySwapFeeBps: 100n,
                sellSwapFeeBps: 200n,
                rewardConfigurationHash: CONFIGURATION_HASH,
                launchHash: LAUNCH_HASH,
              },
            },
            {
              contract: "ClassicV3Hook",
              event: "PoolRegistered",
              logIndex: 46,
              block,
              transaction,
              params: {
                poolId: POOL_ID,
                token: TOKEN,
                rewardVault: VAULT,
                registrar: DEPLOYER,
                buySwapFeeBps: 100n,
                sellSwapFeeBps: 200n,
                rewardConfigurationHash: CONFIGURATION_HASH,
              },
            },
            {
              contract: "ClassicV3Hook",
              event: "PoolFeeDisclosure",
              logIndex: 47,
              block,
              transaction,
              params: {
                poolId: POOL_ID,
                token: TOKEN,
                rewardVault: VAULT,
                buySwapFeeBps: 100n,
                sellSwapFeeBps: 200n,
                buyCreatorFeeBps: 90n,
                sellCreatorFeeBps: 90n,
                launcherFeeBps: 10n,
                transferTaxBps: 0n,
                lpFeePips: 3_000n,
              },
            },
          ],
        },
      },
    });

    expect(result.changes[0]?.addresses?.sets).toContainEqual({
      contract: "ClassicV3RewardVault",
      address: VAULT,
    });
    expect((await indexer.RewardVault.getOrThrow(VAULT)).releaseVersion).toBe(
      "classic-v3",
    );
    expect((await indexer.RewardCheckpoint.getAll())[0]).toMatchObject({
      vault: VAULT,
      poolId: POOL_ID,
      configurationEpoch: 1n,
      amount: 9_007_199_254_740_993n,
      totalCreatorFeesReceived: 90_071_992_547_409_931n,
      downstreamLogicalId: undefined,
      receiptLogOrdinal: undefined,
    });
    const custody = (await indexer.InitialBuyCustody.getAll())[0];
    expect(custody?.mode).toBe(2);
    expect(custody?.mode).not.toBe(2n);
    expect(
      (
        await indexer.Launch.getOrThrow(
          `1:classic-v3:${LAUNCH_HASH}`,
        )
      ).isComplete,
    ).toBe(true);
  });

  it("marks a vault configuration mismatch as invalid provenance", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          startBlock: BLOCK_NUMBER,
          endBlock: BLOCK_NUMBER + 12,
          simulate: [
            {
              contract: "ClassicV3Launcher",
              event: "MemeTokenLaunchedV2",
              logIndex: 60,
              block,
              transaction,
              params: {
                deployer: DEPLOYER,
                token: TOKEN,
                poolId: POOL_ID,
                feeHook: HOOK,
                rewardVault: VAULT,
                positionRecipient: POSITION_RECIPIENT,
                positionTokenId: 42n,
                buySwapFeeBps: 100n,
                sellSwapFeeBps: 200n,
                rewardConfigurationHash: CONFIGURATION_HASH,
                launchHash: LAUNCH_HASH,
              },
            },
            {
              contract: "ClassicV3RewardVaultFactory",
              event: "ClassicRewardVaultDeployed",
              logIndex: 61,
              block,
              transaction,
              params: {
                vault: VAULT,
                poolId: POOL_ID,
                feeHook: HOOK,
                salt: CONFIGURATION_HASH,
                configurationHash: CUSTODY_CONFIGURATION_HASH,
              },
            },
          ],
        },
      },
    });

    expect(
      (
        await indexer.Launch.getOrThrow(
          `1:classic-v3:${LAUNCH_HASH}`,
        )
      ).provenanceValid,
    ).toBe(false);
  });

  it("rejects a late hook configuration hash that differs from the launcher", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          startBlock: BLOCK_NUMBER,
          endBlock: BLOCK_NUMBER + 12,
          simulate: [
            {
              contract: "ClassicV3Launcher",
              event: "MemeTokenLaunchedV2",
              logIndex: 70,
              block,
              transaction,
              params: {
                deployer: DEPLOYER,
                token: TOKEN,
                poolId: POOL_ID,
                feeHook: HOOK,
                rewardVault: VAULT,
                positionRecipient: POSITION_RECIPIENT,
                positionTokenId: 42n,
                buySwapFeeBps: 100n,
                sellSwapFeeBps: 200n,
                rewardConfigurationHash: CONFIGURATION_HASH,
                launchHash: LAUNCH_HASH,
              },
            },
            {
              contract: "ClassicV3Hook",
              event: "PoolRegistered",
              logIndex: 71,
              block,
              transaction,
              params: {
                poolId: POOL_ID,
                token: TOKEN,
                rewardVault: VAULT,
                registrar: DEPLOYER,
                buySwapFeeBps: 100n,
                sellSwapFeeBps: 200n,
                rewardConfigurationHash: CUSTODY_CONFIGURATION_HASH,
              },
            },
          ],
        },
      },
    });

    expect(
      await indexer.Launch.getOrThrow(
        `1:classic-v3:${LAUNCH_HASH}`,
      ),
    ).toMatchObject({
      provenanceValid: false,
      isComplete: false,
    });
  });

  it.each([
    ["before", 79],
    ["after", 86],
  ])(
    "invalidates a conflicting same-pool factory vault emitted %s the launcher",
    async (_order, factoryLogIndex) => {
      const indexer = createTestIndexer();

      await indexer.process({
        chains: {
          1: {
            startBlock: BLOCK_NUMBER,
            endBlock: BLOCK_NUMBER + 12,
            simulate: [
              {
                contract: "ClassicV3Launcher",
                event: "MemeTokenLaunchedV2",
                logIndex: 85,
                block,
                transaction,
                params: {
                  deployer: DEPLOYER,
                  token: TOKEN,
                  poolId: POOL_ID,
                  feeHook: HOOK,
                  rewardVault: VAULT,
                  positionRecipient: POSITION_RECIPIENT,
                  positionTokenId: 42n,
                  buySwapFeeBps: 100n,
                  sellSwapFeeBps: 200n,
                  rewardConfigurationHash: CONFIGURATION_HASH,
                  launchHash: LAUNCH_HASH,
                },
              },
              {
                contract: "ClassicV3RewardVaultFactory",
                event: "ClassicRewardVaultDeployed",
                logIndex: factoryLogIndex,
                block,
                transaction,
                params: {
                  vault: CONFLICTING_VAULT,
                  poolId: POOL_ID,
                  feeHook: HOOK,
                  salt: CONFIGURATION_HASH,
                  configurationHash: CONFIGURATION_HASH,
                },
              },
              {
                contract: "ClassicV3Launcher",
                event: "MemeCreatorInitialBuyCustodyV2",
                logIndex: 84,
                block,
                transaction,
                params: {
                  deployer: DEPLOYER,
                  token: TOKEN,
                  custody: CUSTODY,
                  mode: 2n,
                  durationDays: 365n,
                  cliffDays: 30n,
                  configurationHash: CUSTODY_CONFIGURATION_HASH,
                  launchHash: LAUNCH_HASH,
                },
              },
              {
                contract: "ClassicV3Hook",
                event: "PoolFeeDisclosure",
                logIndex: 81,
                block,
                transaction,
                params: {
                  poolId: POOL_ID,
                  token: TOKEN,
                  rewardVault: VAULT,
                  buySwapFeeBps: 100n,
                  sellSwapFeeBps: 200n,
                  buyCreatorFeeBps: 90n,
                  sellCreatorFeeBps: 90n,
                  launcherFeeBps: 10n,
                  transferTaxBps: 0n,
                  lpFeePips: 3_000n,
                },
              },
              {
                contract: "ClassicV3Launcher",
                event: "MemeLiquidityConfiguredV2",
                logIndex: 82,
                block,
                transaction,
                params: {
                  token: TOKEN,
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
                contract: "ClassicV3Hook",
                event: "PoolRegistered",
                logIndex: 80,
                block,
                transaction,
                params: {
                  poolId: POOL_ID,
                  token: TOKEN,
                  rewardVault: VAULT,
                  registrar: DEPLOYER,
                  buySwapFeeBps: 100n,
                  sellSwapFeeBps: 200n,
                  rewardConfigurationHash: CONFIGURATION_HASH,
                },
              },
              {
                contract: "ClassicV3Launcher",
                event: "MemeCreatorInitialBuyV2",
                logIndex: 83,
                block,
                transaction,
                params: {
                  deployer: DEPLOYER,
                  token: TOKEN,
                  poolId: POOL_ID,
                  nativeAmount: 999n,
                  tokenAmount: 888n,
                  launchHash: LAUNCH_HASH,
                },
              },
            ],
          },
        },
      });

      expect(
        await indexer.RewardVault.getOrThrow(CONFLICTING_VAULT),
      ).toMatchObject({
        poolId: POOL_ID,
        hook: HOOK,
      });
      expect(
        await indexer.Launch.getOrThrow(
          `1:classic-v3:${LAUNCH_HASH}`,
        ),
      ).toMatchObject({
        provenanceValid: false,
        isComplete: false,
      });
    },
  );
});
