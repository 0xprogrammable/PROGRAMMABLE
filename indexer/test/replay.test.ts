import { readFileSync } from "node:fs";
import path from "node:path";

import { createTestIndexer } from "envio";
import { parse } from "yaml";
import { parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";

import {
  canonicalPayloadJson,
  encodeEventPayload,
} from "../src/lib/payload-hash.js";
import { SOURCE_REGISTRY } from "../src/lib/release-map.js";

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
        .sort((left, right) => left - right),
    )
      .toEqual([8, 60]);
    expect(candidates.every(({ downstreamLogicalId }) => downstreamLogicalId === undefined))
      .toBe(true);
    expect(candidates[0]?.id).not.toBe(candidates[1]?.id);
  });
});

describe("checked-in manifest fixtures", () => {
  it("pins every configured address and inclusive source cutoff to its deployment manifest", () => {
    const projectRoot = path.resolve(process.cwd(), "..");
    const readJson = (relativePath: string) =>
      JSON.parse(
        readFileSync(path.join(projectRoot, relativePath), "utf8"),
      ) as Record<string, any>;
    const classicV2 = readJson(
      "contracts/deployments/mainnet-classic-v2.json",
    );
    const classicV3 = readJson(
      "contracts/deployments/mainnet-classic-v3.json",
    );
    const stockV1 = readJson(
      "contracts/deployments/mainnet-stock-paired-v1.json",
    );
    const stockV2 = readJson(
      "contracts/deployments/mainnet-stock-paired-v2.json",
    );
    const stockV3 = readJson(
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
    ].map(([contractName, address, startBlock]) => ({
      contractName: String(contractName),
      address: String(address).toLowerCase(),
      startBlock: Number(startBlock),
    }));

    expect([...SOURCE_REGISTRY]).toEqual(expected);

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
      expected.map(({ contractName, address }) => ({ contractName, address })),
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
    ) as { dependencies: { envio: string } };
    expect(packageJson.dependencies.envio).toBe("3.2.1");
  });
});
