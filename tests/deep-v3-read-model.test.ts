import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import placeholderManifest from "../contracts/deployments/mainnet-deep-full-range-v3.json";
import {
  assertDeepV3LaunchProvenance,
  pairDeepV3LaunchEventRecords,
  resolveVerifiedDeepV3ReadRelease,
  type DeepV3EventSources,
  type DeepV3LaunchEventRecords,
} from "../lib/onchain/deep-v3-read-model";
import {
  DEEP_V3_TEST_ADDRESSES,
  DEEP_V3_TEST_BLOCK_HASH,
  DEEP_V3_TEST_CONFIGURATION_HASH,
  DEEP_V3_TEST_CREATOR,
  DEEP_V3_TEST_LAUNCH_HASH,
  DEEP_V3_TEST_POOL_ID,
  DEEP_V3_TEST_POSITION_RECIPIENT,
  DEEP_V3_TEST_TOKEN,
  DEEP_V3_TEST_TRANSACTION_HASH,
  DEEP_V3_TEST_VAULT,
  deepV3LiveManifestFixture,
  deepV3TestProvenance,
} from "./deep-v3-fixture";

const sources = {
  launcher: DEEP_V3_TEST_ADDRESSES.launcher,
  feeHook: DEEP_V3_TEST_ADDRESSES.feeHook,
  growthVaultFactory: DEEP_V3_TEST_ADDRESSES.growthVaultFactory,
  automation: DEEP_V3_TEST_ADDRESSES.automation,
} satisfies DeepV3EventSources;

function common(address: Address, logIndex: number) {
  return {
    address,
    blockNumber: 123n,
    blockHash: DEEP_V3_TEST_BLOCK_HASH,
    transactionHash: DEEP_V3_TEST_TRANSACTION_HASH,
    transactionIndex: 2,
    logIndex,
  };
}

function eventRecords(): DeepV3LaunchEventRecords {
  return {
    launches: [
      {
        ...common(sources.launcher, 50),
        args: {
          deployer: DEEP_V3_TEST_CREATOR,
          token: DEEP_V3_TEST_TOKEN,
          poolId: DEEP_V3_TEST_POOL_ID,
          feeHook: sources.feeHook,
          growthVault: DEEP_V3_TEST_VAULT,
          positionRecipient: DEEP_V3_TEST_POSITION_RECIPIENT,
          positionTokenId: 77n,
          vaultConfigurationHash: DEEP_V3_TEST_CONFIGURATION_HASH,
          launchHash: DEEP_V3_TEST_LAUNCH_HASH,
        },
      },
    ],
    configurations: [
      {
        ...common(sources.launcher, 51),
        args: {
          token: DEEP_V3_TEST_TOKEN,
          totalSupply: 1_000_000_000n * 10n ** 18n,
          initialLockedTokenDust: 1n,
          totalHookFeeBps: 100,
          growthFeeBps: 90,
          programmableFeeBps: 10,
          initialTick: 204_200,
          fullRangeTickLower: -887_200,
          fullRangeTickUpper: 887_200,
          launchHash: DEEP_V3_TEST_LAUNCH_HASH,
        },
      },
    ],
    initialBuys: [
      {
        ...common(sources.launcher, 52),
        args: {
          deployer: DEEP_V3_TEST_CREATOR,
          token: DEEP_V3_TEST_TOKEN,
          poolId: DEEP_V3_TEST_POOL_ID,
          nativeAmount: 600_000_000_000_000n,
          tokenAmount: 100n,
          sqrtPriceLimitX96: 1n,
          launchHash: DEEP_V3_TEST_LAUNCH_HASH,
        },
      },
    ],
    vaultDeployments: [
      {
        ...common(sources.growthVaultFactory, 2),
        args: {
          vault: DEEP_V3_TEST_VAULT,
          feeHook: sources.feeHook,
          poolId: DEEP_V3_TEST_POOL_ID,
          creatorSalt: `0x${"ab".repeat(32)}` as Hex,
          configurationHash: DEEP_V3_TEST_CONFIGURATION_HASH,
        },
      },
    ],
    poolRegistrations: [
      {
        ...common(sources.feeHook, 4),
        args: {
          poolId: DEEP_V3_TEST_POOL_ID,
          token: DEEP_V3_TEST_TOKEN,
          growthVault: DEEP_V3_TEST_VAULT,
          registrar: sources.launcher,
          totalHookFeeBps: 100,
          growthFeeBps: 90,
          programmableFeeBps: 10,
        },
      },
    ],
    feeDisclosures: [
      {
        ...common(sources.feeHook, 5),
        args: {
          poolId: DEEP_V3_TEST_POOL_ID,
          token: DEEP_V3_TEST_TOKEN,
          growthVault: DEEP_V3_TEST_VAULT,
          totalHookFeeBps: 100,
          growthFeeBps: 90,
          programmableFeeBps: 10,
          transferTaxBps: 0,
          lpFeePips: 0,
        },
      },
    ],
    vaultRegistrations: [
      {
        ...common(sources.automation, 40),
        args: {
          vault: DEEP_V3_TEST_VAULT,
          poolId: DEEP_V3_TEST_POOL_ID,
          registryIndex: 0n,
        },
      },
    ],
  };
}

describe("Deep V3 read model", () => {
  it("keeps the checked-in placeholder fail closed", () => {
    expect(
      resolveVerifiedDeepV3ReadRelease(placeholderManifest, 1),
    ).toBeNull();
  });

  it("accepts only the final source, lifecycle, keeper and activation gates", () => {
    const manifest = deepV3LiveManifestFixture();
    const release = resolveVerifiedDeepV3ReadRelease(manifest, 1);

    expect(release).toMatchObject({
      chainId: 1,
      releaseVersion: "deep-full-range-v3",
      startBlock: 100,
      addresses: {
        launcher: DEEP_V3_TEST_ADDRESSES.launcher,
        feeHook: DEEP_V3_TEST_ADDRESSES.feeHook,
      },
    });

    expect(
      resolveVerifiedDeepV3ReadRelease(
        {
          ...manifest,
          activation: {
            ...manifest.activation,
            appStatus: "blocked",
          },
        },
        1,
      ),
    ).toBeNull();
    expect(
      resolveVerifiedDeepV3ReadRelease(
        {
          ...manifest,
          keeperPolicy: {
            ...manifest.keeperPolicy,
            enabled: false,
            transactionSubmission: false,
          },
        },
        1,
      ),
    ).toBeNull();
    expect(
      resolveVerifiedDeepV3ReadRelease(
        {
          ...manifest,
          keeperPolicy: {
            ...manifest.keeperPolicy,
            signingBackend: "not-configured",
          },
        },
        1,
      ),
    ).toBeNull();
    expect(
      resolveVerifiedDeepV3ReadRelease(
        {
          ...manifest,
          sourceVerification: {
            ...manifest.sourceVerification,
            contracts: {
              ...manifest.sourceVerification.contracts,
              zapPlanner: {
                ...manifest.sourceVerification.contracts.zapPlanner,
                status: "exact-match",
              },
            },
          },
        },
        1,
      ),
    ).toBeNull();
    expect(
      resolveVerifiedDeepV3ReadRelease(
        {
          ...manifest,
          sourceVerification: {
            ...manifest.sourceVerification,
            contracts: {
              ...manifest.sourceVerification.contracts,
              zapPlanner: {
                ...manifest.sourceVerification.contracts.zapPlanner,
                sourcify: {
                  status: "exact-match",
                  url: `https://repo.sourcify.dev/contracts/full_match/1/${DEEP_V3_TEST_ADDRESSES.zapPlanner}/`,
                },
              },
            },
          },
        },
        1,
      ),
    ).toBeNull();
    expect(resolveVerifiedDeepV3ReadRelease(manifest, 11_155_111)).toBeNull();
  });

  it("pairs all atomic launcher, hook, factory and automation evidence", () => {
    const bundles = pairDeepV3LaunchEventRecords(
      sources,
      eventRecords(),
    );

    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({
      provenance: deepV3TestProvenance(),
      configuration: {
        totalHookFeeBps: 100,
        growthFeeBps: 90,
        programmableFeeBps: 10,
      },
      initialBuy: {
        nativeAmount: 600_000_000_000_000n,
        tokenAmount: 100n,
      },
      registryIndex: 0n,
    });
  });

  it.each([
    ["launcher", "launches"],
    ["launcher configuration", "configurations"],
    ["launcher initial buy", "initialBuys"],
    ["vault factory", "vaultDeployments"],
    ["hook registration", "poolRegistrations"],
    ["hook disclosure", "feeDisclosures"],
    ["automation", "vaultRegistrations"],
  ] as const)("rejects a lookalike %s event source", (_label, collection) => {
    const records = eventRecords();
    records[collection][0].address =
      "0xffffffffffffffffffffffffffffffffffffffff";

    expect(() =>
      pairDeepV3LaunchEventRecords(sources, records),
    ).toThrow(/verified release/);
  });

  it("rejects non-atomic, reordered or non-fixed launch evidence", () => {
    const nonAtomic = eventRecords();
    nonAtomic.vaultDeployments[0].transactionHash =
      `0x${"ff".repeat(32)}`;
    expect(() =>
      pairDeepV3LaunchEventRecords(sources, nonAtomic),
    ).toThrow(/atomic Deep V3 launch/);

    const reordered = eventRecords();
    reordered.vaultRegistrations[0].logIndex = 60;
    expect(() =>
      pairDeepV3LaunchEventRecords(sources, reordered),
    ).toThrow(/ordering/);

    const wrongFees = eventRecords();
    wrongFees.feeDisclosures[0].args.growthFeeBps = 89;
    expect(() =>
      pairDeepV3LaunchEventRecords(sources, wrongFees),
    ).toThrow(/policy/);
  });

  it("accepts only the canonical event-derived PoolId and release identities", () => {
    const release = resolveVerifiedDeepV3ReadRelease(
      deepV3LiveManifestFixture(),
      1,
    );
    if (!release) throw new Error("Expected verified fixture");

    expect(
      assertDeepV3LaunchProvenance(deepV3TestProvenance(), release),
    ).toMatchObject({
      tokenAddress: DEEP_V3_TEST_TOKEN,
      vaultAddress: DEEP_V3_TEST_VAULT,
      poolId: DEEP_V3_TEST_POOL_ID,
    });
    expect(() =>
      assertDeepV3LaunchProvenance(
        {
          ...deepV3TestProvenance(),
          poolId: `0x${"ff".repeat(32)}`,
        },
        release,
      ),
    ).toThrow(/PoolId/);
  });
});
