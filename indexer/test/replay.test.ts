import { readFileSync } from "node:fs";
import path from "node:path";

import { createTestIndexer } from "envio";
import { parse } from "yaml";
import { parseAbiItem } from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  canonicalPayloadJson,
  encodeEventPayload,
} from "../src/lib/payload-hash.js";
import {
  SOURCE_REGISTRY,
  staticReleaseForContract,
} from "../src/lib/release-map.js";

const POOL_ID =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SWAP_SENDER: `0x${string}` =
  "0x1111111111111111111111111111111111111111";
const TRANSACTION_HASH =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const FIRST_BLOCK_HASH =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const SECOND_BLOCK_HASH =
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const BLOCK_NUMBER = 25_650_030;

describe("replay and occurrence behavior", () => {
  it("accepts canonical zero-byte data for an indexed-only event", () => {
    const eventAbi = parseAbiItem(
      "event PayoutAddressUpdated(address indexed beneficiary, address indexed previousPayoutAddress, address indexed newPayoutAddress)",
    );
    const encoded = encodeEventPayload(eventAbi, {
      beneficiary: "0x1111111111111111111111111111111111111111",
      previousPayoutAddress: "0x2222222222222222222222222222222222222222",
      newPayoutAddress: "0x3333333333333333333333333333333333333333",
    });

    expect(encoded.data).toBe("0x");
    expect(encoded.topics).toHaveLength(4);
    expect(encoded.topics.every((topic) => /^0x[0-9a-f]{64}$/.test(topic)))
      .toBe(true);
    expect(encoded.payloadHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects malformed fixed-width fields and canonicalizes hex payloads", () => {
    const eventAbi = parseAbiItem(
      "event PayoutAddressUpdated(address indexed beneficiary, address indexed previousPayoutAddress, address indexed newPayoutAddress)",
    );

    expect(() =>
      encodeEventPayload(eventAbi, {
        beneficiary: "0x1234",
        previousPayoutAddress: "0x2222222222222222222222222222222222222222",
        newPayoutAddress: "0x3333333333333333333333333333333333333333",
      }),
    ).toThrow();
    expect(
      canonicalPayloadJson({
        z: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        a: 42n,
      }),
    ).toBe(
      '{"a":"42","z":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
    );
  });

  it("deduplicates the same candidate occurrence and keeps bigint totals exact", async () => {
    const indexer = createTestIndexer();
    const event = {
      contract: "ClassicV2Hook" as const,
      event: "NativeSwapFeesAccrued" as const,
      logIndex: 60,
      block: {
        number: BLOCK_NUMBER,
        timestamp: 1_800_000_030,
        hash: FIRST_BLOCK_HASH,
      },
      transaction: { hash: TRANSACTION_HASH, transactionIndex: 1 },
      params: {
        poolId: POOL_ID,
        swapSender: SWAP_SENDER,
        grossNativeAmount: 90_071_992_547_409_931n,
        creatorFee: 9_007_199_254_740_993n,
        launcherFee: 1_000_000_000_000_007n,
      },
    };

    await indexer.process({
      chains: {
        1: {
          simulate: [event, event],
        },
      },
    });

    expect(await indexer.FeeAccrual.getAll()).toHaveLength(1);
    expect(await indexer.PoolFeeTotals.getOrThrow(`1:${POOL_ID}`)).toMatchObject({
      grossAmount: 90_071_992_547_409_931n,
      creatorFees: 9_007_199_254_740_993n,
      launcherFees: 1_000_000_000_000_007n,
      swapCount: 1n,
    });
  });

  it("rejects a duplicate candidate occurrence with conflicting payload facts", async () => {
    const indexer = createTestIndexer();
    const event = {
      contract: "ClassicV2Hook" as const,
      event: "NativeSwapFeesAccrued" as const,
      logIndex: 59,
      block: {
        number: BLOCK_NUMBER,
        timestamp: 1_800_000_030,
        hash: FIRST_BLOCK_HASH,
      },
      transaction: { hash: TRANSACTION_HASH, transactionIndex: 1 },
      params: {
        poolId: POOL_ID,
        swapSender: SWAP_SENDER,
        grossNativeAmount: 10n,
        creatorFee: 1n,
        launcherFee: 1n,
      },
    };

    await expect(
      indexer.process({
        chains: {
          1: {
            simulate: [
              event,
              {
                ...event,
                params: {
                  ...event.params,
                  grossNativeAmount: 11n,
                },
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/worker exited with code 1/i);
  });

  it("retains two fork candidates when a transaction is re-mined at a new global log index", async () => {
    const indexer = createTestIndexer();
    const params = {
      poolId: POOL_ID,
      swapSender: SWAP_SENDER,
      grossNativeAmount: 10n,
      creatorFee: 1n,
      launcherFee: 1n,
    };

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "ClassicV2Hook",
              event: "NativeSwapFeesAccrued",
              logIndex: 60,
              block: {
                number: BLOCK_NUMBER,
                timestamp: 1_800_000_030,
                hash: FIRST_BLOCK_HASH,
              },
              transaction: { hash: TRANSACTION_HASH, transactionIndex: 1 },
              params,
            },
            {
              contract: "ClassicV2Hook",
              event: "NativeSwapFeesAccrued",
              logIndex: 8,
              block: {
                number: BLOCK_NUMBER + 1,
                timestamp: 1_800_000_042,
                hash: SECOND_BLOCK_HASH,
              },
              transaction: { hash: TRANSACTION_HASH, transactionIndex: 0 },
              params,
            },
          ],
        },
      },
    });

    const candidates = (await indexer.ChainEvent.getAll()).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    expect(candidates).toHaveLength(2);
    expect(
      candidates
        .map(({ blockGlobalLogIndex }) => blockGlobalLogIndex)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    )
      .toEqual([8n, 60n]);
    expect(candidates.every(({ downstreamLogicalId }) => downstreamLogicalId === undefined))
      .toBe(true);
    expect(candidates[0]?.id).not.toBe(candidates[1]?.id);
    expect(await indexer.FeeAccrual.getAll()).toHaveLength(2);
    expect(await indexer.PoolFeeTotals.getOrThrow(`1:${POOL_ID}`)).toMatchObject({
      grossAmount: 20n,
      creatorFees: 2n,
      launcherFees: 2n,
      swapCount: 2n,
    });
    expect(
      (await indexer.IndexerState.getOrThrow("ethereum-mainnet"))
        .progressOccurrenceId,
    ).toBe(`1:${SECOND_BLOCK_HASH}:${TRANSACTION_HASH}:8`);
  });

  it("tracks health progress by chain placement rather than transaction-hash sorting", async () => {
    const indexer = createTestIndexer();
    const earlierTransactionHash =
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const laterTransactionHash =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    const params = {
      poolId: POOL_ID,
      swapSender: SWAP_SENDER,
      grossNativeAmount: 10n,
      creatorFee: 1n,
      launcherFee: 1n,
    };

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "ClassicV2Hook",
              event: "NativeSwapFeesAccrued",
              logIndex: 60,
              block: {
                number: BLOCK_NUMBER,
                timestamp: 1_800_000_030,
                hash: FIRST_BLOCK_HASH,
              },
              transaction: {
                hash: earlierTransactionHash,
                transactionIndex: 1,
              },
              params,
            },
            {
              contract: "ClassicV2Hook",
              event: "NativeSwapFeesAccrued",
              logIndex: 61,
              block: {
                number: BLOCK_NUMBER,
                timestamp: 1_800_000_030,
                hash: FIRST_BLOCK_HASH,
              },
              transaction: {
                hash: laterTransactionHash,
                transactionIndex: 2,
              },
              params,
            },
            {
              contract: "ClassicV2Hook",
              event: "NativeSwapFeesAccrued",
              logIndex: 62,
              block: {
                number: BLOCK_NUMBER,
                timestamp: 1_800_000_030,
                hash: FIRST_BLOCK_HASH,
              },
              transaction: {
                hash: laterTransactionHash,
                transactionIndex: 2,
              },
              params,
            },
          ],
        },
      },
    });

    expect(
      (await indexer.IndexerState.getOrThrow("ethereum-mainnet"))
        .progressOccurrenceId,
    ).toBe(
      `1:${FIRST_BLOCK_HASH}:${laterTransactionHash}:62`,
    );
  });

  it("persists the complete reviewed deployment identity from the worker environment", async () => {
    const sourceCommit = "1".repeat(40);
    const configSha256 = `0x${"22".repeat(32)}`;
    const schemaSha256 = `0x${"33".repeat(32)}`;
    const handlerSha256 = `0x${"44".repeat(32)}`;
    const sourceRegistrySha256 = `0x${"55".repeat(32)}`;
    const eventSetSha256 = `0x${"66".repeat(32)}`;
    vi.stubEnv("ENVIO_DEPLOYMENT_LABEL", "production-reviewed-2026-07-31");
    vi.stubEnv("ENVIO_SOURCE_COMMIT", sourceCommit);
    vi.stubEnv("ENVIO_CONFIG_SHA256", configSha256);
    vi.stubEnv("ENVIO_SCHEMA_SHA256", schemaSha256);
    vi.stubEnv("ENVIO_HANDLER_SHA256", handlerSha256);
    vi.stubEnv("ENVIO_SOURCE_REGISTRY_SHA256", sourceRegistrySha256);
    vi.stubEnv("ENVIO_EVENT_SET_SHA256", eventSetSha256);
    vi.stubEnv("ENVIO_EVENT_COUNT", "51");

    try {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "ClassicV2Hook",
                event: "NativeSwapFeesAccrued",
                logIndex: 62,
                block: {
                  number: BLOCK_NUMBER,
                  timestamp: 1_800_000_030,
                  hash: FIRST_BLOCK_HASH,
                },
                transaction: {
                  hash: TRANSACTION_HASH,
                  transactionIndex: 1,
                },
                params: {
                  poolId: POOL_ID,
                  swapSender: SWAP_SENDER,
                  grossNativeAmount: 10n,
                  creatorFee: 1n,
                  launcherFee: 1n,
                },
              },
            ],
          },
        },
      });

      expect(
        await indexer.IndexerState.getOrThrow("ethereum-mainnet"),
      ).toMatchObject({
        deployment: "production-reviewed-2026-07-31",
        sourceCommit,
        configSha256,
        schemaSha256,
        handlerSha256,
        sourceRegistrySha256,
        eventSetSha256,
        eventCount: 51,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("checked-in manifest fixtures", () => {
  it("pins every configured address and inclusive source cutoff to its deployment manifest", () => {
    const projectRoot = path.resolve(process.cwd(), "..");
    const readJson = <T,>(relativePath: string) =>
      JSON.parse(
        readFileSync(path.join(projectRoot, relativePath), "utf8"),
      ) as T;
    const classicV2 = readJson<{
      addresses: { feeHook: string; memeLauncher: string };
      transactions: {
        feeHook: { blockNumber: number };
        memeLauncher: { blockNumber: number };
      };
    }>(
      "contracts/deployments/mainnet-classic-v2.json",
    );
    const classicV3 = readJson<{
      addresses: {
        rewardVaultFactory: string;
        initialBuyVestingWalletFactory: string;
        feeHook: string;
        launcher: string;
      };
      deploymentBlocks: {
        rewardVaultFactory: number;
        initialBuyVestingWalletFactory: number;
        feeHook: number;
        launcher: number;
      };
    }>(
      "contracts/deployments/mainnet-classic-v3.json",
    );
    const stockV1 = readJson<{
      addresses: {
        launcher: string;
        ethLaunchCoordinator: string;
        feeHook: string;
        feeSplitVaultFactory: string;
      };
      startBlock: number;
    }>(
      "contracts/deployments/mainnet-stock-paired-v1.json",
    );
    const stockV2 = readJson<{
      addresses: {
        launcher: string;
        ethLaunchCoordinator: string;
        feeHook: string;
        feeSplitVaultFactory: string;
      };
      startBlock: number;
    }>(
      "contracts/deployments/mainnet-stock-paired-v2.json",
    );
    const stockV3 = readJson<{
      addresses: { launcher: string; ethLaunchCoordinator: string };
      startBlock: number;
    }>(
      "contracts/deployments/mainnet-stock-paired-v3.json",
    );
    const expected = [
      ["ClassicV2Hook", classicV2.addresses.feeHook, classicV2.transactions.feeHook.blockNumber],
      ["ClassicV2Launcher", classicV2.addresses.memeLauncher, classicV2.transactions.memeLauncher.blockNumber],
      ["ClassicV3RewardVaultFactory", classicV3.addresses.rewardVaultFactory, classicV3.deploymentBlocks.rewardVaultFactory],
      ["ClassicV3VestingWalletFactory", classicV3.addresses.initialBuyVestingWalletFactory, classicV3.deploymentBlocks.initialBuyVestingWalletFactory],
      ["ClassicV3Hook", classicV3.addresses.feeHook, classicV3.deploymentBlocks.feeHook],
      ["ClassicV3Launcher", classicV3.addresses.launcher, classicV3.deploymentBlocks.launcher],
      ["StockV1Launcher", stockV1.addresses.launcher, stockV1.startBlock],
      ["StockV1EthCoordinator", stockV1.addresses.ethLaunchCoordinator, stockV1.startBlock],
      ["StockV1Hook", stockV1.addresses.feeHook, stockV1.startBlock],
      ["StockV1RewardVaultFactory", stockV1.addresses.feeSplitVaultFactory, stockV1.startBlock],
      ["StockV2Launcher", stockV2.addresses.launcher, stockV2.startBlock],
      ["StockV2EthCoordinator", stockV2.addresses.ethLaunchCoordinator, stockV2.startBlock],
      ["StockV2V3Hook", stockV2.addresses.feeHook, stockV2.startBlock],
      ["StockV2V3RewardVaultFactory", stockV2.addresses.feeSplitVaultFactory, stockV2.startBlock],
      ["StockV3Launcher", stockV3.addresses.launcher, stockV3.startBlock],
      ["StockV3EthCoordinator", stockV3.addresses.ethLaunchCoordinator, stockV3.startBlock],
      ["CustomRegistryV1", "0x17e18c88bda9bfb73924cdc989c07b0707e72671", 25_701_139],
      ["CustomPartnerFactoryRegistryV1", "0xf8aef69201621ad20fa256da595426b7e6192dba", 25_701_136],
      ["CustomAtomicRegistrarV1", "0xcc916e5200d2626edfd918dc219bc4296629e997", 25_701_142],
      ["ClassicV4Hook", "0xadf955a44fd7f009380240d56d71dfafb46020cc", 25_851_137],
      ["ClassicV4Launcher", "0x1af508f9af9f8f5cf7bf712b7d2974d4ee7a6681", 25_851_150],
    ].map(([contractName, address, startBlock]) => ({
      contractName: String(contractName),
      address: String(address).toLowerCase(),
      startBlock: Number(startBlock),
    }));

    expect([...SOURCE_REGISTRY]).toEqual(expected);
    for (const contractName of [
      "CustomRegistryV1",
      "CustomPartnerFactoryRegistryV1",
      "CustomAtomicRegistrarV1",
    ]) {
      expect(staticReleaseForContract(contractName)).toEqual({
        model: "custom",
        releaseVersion: "custom-registry-v1",
      });
    }

    const config = parse(
      readFileSync(path.join(process.cwd(), "config.yaml"), "utf8"),
    ) as {
      address_format: string;
      rollback_on_reorg: boolean;
      save_full_history: boolean;
      raw_events: boolean;
      chains: Array<{
        id: number;
        start_block: number;
        max_reorg_depth: number;
        block_lag: number;
        contracts: Array<{ name: string; address?: string | string[] }>;
      }>;
    };
    const chain = config.chains[0]!;
    const configuredAddresses = chain.contracts
      .flatMap(({ name, address }) =>
        address === undefined
          ? []
          : (Array.isArray(address) ? address : [address]).map((value) => ({
              contractName: name,
              address: value.toLowerCase(),
            })),
      );
    expect(configuredAddresses).toEqual(
      expected.map(({ contractName, address }) => ({
        contractName,
        address,
      })),
    );
    expect(config).toMatchObject({
      address_format: "lowercase",
      rollback_on_reorg: true,
      save_full_history: false,
      raw_events: false,
    });
    expect(chain).toMatchObject({
      id: 1,
      start_block: 25_624_130,
      max_reorg_depth: 200,
      block_lag: 12,
    });
  });

  it("pins HyperIndex to 3.2.1", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as {
      dependencies: { envio: string };
      packageManager: string;
    };
    expect(packageJson.dependencies.envio).toBe("3.2.1");
    expect(packageJson.packageManager).toBe("pnpm@10.32.0");
  });
});
