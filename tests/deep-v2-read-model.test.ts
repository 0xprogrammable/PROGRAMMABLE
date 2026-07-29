import { describe, expect, it } from "vitest";

import {
  findDeepV2LaunchByTransaction,
  pairDeepV2LaunchEventRecords,
  readDeepV2ExploreModel,
  type DeepV2LaunchEventRecords,
  type DeepV2EventSources,
} from "../lib/onchain/deep-v2-read-model";
import type {
  ExploreReadModel,
  OnchainDeployment,
} from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";

const launcher = "0x1111111111111111111111111111111111111111";
const hook = "0x2222222222222222222222222222222222222222";
const vaultFactory = "0x3333333333333333333333333333333333333333";
const automation = "0x4444444444444444444444444444444444444444";
const token = "0x5555555555555555555555555555555555555555";
const vault = "0x6666666666666666666666666666666666666666";
const oracle = "0x7777777777777777777777777777777777777777";
const upstream = "0x8888888888888888888888888888888888888888";
const positionRecipient =
  "0x9999999999999999999999999999999999999999";
const creator = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const poolId = `0x${"11".repeat(32)}` as const;
const launchHash = `0x${"22".repeat(32)}` as const;
const vaultConfigurationHash = `0x${"33".repeat(32)}` as const;
const transactionHash = `0x${"44".repeat(32)}` as const;
const blockHash = `0x${"55".repeat(32)}` as const;

const sources = {
  launcher,
  feeHook: hook,
  growthVaultFactory: vaultFactory,
  automation,
} satisfies DeepV2EventSources;

function common(address: `0x${string}`, logIndex: number) {
  return {
    address,
    blockNumber: 123n,
    blockHash,
    transactionHash,
    transactionIndex: 2,
    logIndex,
  };
}

function eventRecords(): DeepV2LaunchEventRecords {
  return {
    launches: [
      {
        ...common(launcher, 5),
        args: {
          deployer: creator,
          token,
          poolId,
          feeHook: hook,
          growthVault: vault,
          oracleGuard: oracle,
          upstreamRewardVault: upstream,
          positionRecipient,
          positionTokenId: 42n,
          buySwapFeeBps: 100,
          sellSwapFeeBps: 100,
          vaultConfigurationHash,
          launchHash,
        },
      },
    ],
    configurations: [
      {
        ...common(launcher, 6),
        args: {
          token,
          totalSupply: 1_000_000_000n * 10n ** 18n,
          tokenReserve: 150_000_000n * 10n ** 18n,
          tokenLiquidityAmount: 850_000_000n * 10n ** 18n,
          lockedTokenDust: 0n,
          nativeTarget: 50_000_000_000_000_000n,
          tickLower: -887_200,
          tickUpper: 887_200,
          twapWindow: 1_800,
          maxSpotTwapDeviationTicks: 600,
          launchHash,
        },
      },
    ],
    initialBuys: [
      {
        ...common(launcher, 7),
        args: {
          deployer: creator,
          token,
          poolId,
          nativeAmount: 600_000_000_000_000n,
          tokenAmount: 1n,
          launchHash,
        },
      },
    ],
    vaultDeployments: [
      {
        ...common(vaultFactory, 3),
        args: {
          vault,
          feeHook: hook,
          poolId,
          upstreamVault: upstream,
          salt: `0x${"66".repeat(32)}` as const,
          configurationHash: vaultConfigurationHash,
        },
      },
    ],
    registrations: [
      {
        ...common(automation, 4),
        args: {
          vault,
          poolId,
          registryIndex: 0n,
        },
      },
    ],
  };
}

function deepToken(): LauncherToken {
  return {
    id: `1:${token.toLowerCase()}`,
    name: "Deep",
    symbol: "DEEP",
    tokenAddress: token,
    hookAddress: hook,
    poolId,
    creatorAddress: creator,
    launchTransactionHash: transactionHash,
    launchedAt: "2026-07-29T00:00:00.000Z",
    totalSwapFeeBps: 100,
    launchModel: "deep",
    deepReleaseVersion: "deep-full-range-v2",
    growthVaultAddress: vault,
    liquidityPath: "meme",
    deepV2Provenance: {
      deepReleaseVersion: "deep-full-range-v2",
      launcher,
      creator,
      tokenAddress: token,
      vaultAddress: vault,
      hookAddress: hook,
      poolId,
      launchHash,
      vaultConfigurationHash,
      blockNumber: "123",
      blockHash,
      transactionHash,
      logIndex: 5,
    },
  };
}

describe("Deep V2 Explore read model", () => {
  it("pairs only the atomic launcher, factory and automation event record", () => {
    const bundles = pairDeepV2LaunchEventRecords(sources, eventRecords());

    expect(bundles).toHaveLength(1);
    expect(bundles[0].provenance).toEqual(
      deepToken().deepV2Provenance,
    );
    expect(bundles[0].configuration.tokenReserve).toBe(
      150_000_000n * 10n ** 18n,
    );
    expect(bundles[0].initialBuy.nativeAmount).toBe(
      600_000_000_000_000n,
    );
  });

  it.each([
    ["launcher", "launches"],
    ["launcher", "configurations"],
    ["launcher", "initialBuys"],
    ["growth vault factory", "vaultDeployments"],
    ["automation", "registrations"],
  ] as const)(
    "rejects a lookalike %s event source",
    (_label, collection) => {
      const records = eventRecords();
      records[collection][0].address =
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      expect(() =>
        pairDeepV2LaunchEventRecords(sources, records),
      ).toThrow(/verified Deep V2 release/);
    },
  );

  it("rejects records that do not share one transaction and launch identity", () => {
    const records = eventRecords();
    records.vaultDeployments[0].transactionHash =
      `0x${"99".repeat(32)}`;

    expect(() =>
      pairDeepV2LaunchEventRecords(sources, records),
    ).toThrow(/atomic Deep V2 launch/);
  });

  it("does not touch RPC before an exact eligible V2 manifest exists", async () => {
    const config: OnchainDeployment = {
      environment: "production",
      releaseVersion: "classic-v2",
      chainId: 1,
      status: "ready",
      launcher: "0x1111111111111111111111111111111111111111",
      feeHook: "0x2222222222222222222222222222222222222222",
      launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
      feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
      deploymentBlock: 1n,
      stateView: "0x3333333333333333333333333333333333333333",
      stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
      rpcUrl: "https://this-must-not-be-called.invalid",
      rpcUrlSecondary: null,
      confirmations: 12n,
      logBlockRange: 10_000n,
    };

    await expect(readDeepV2ExploreModel(config)).resolves.toBeNull();
  });

  it("finds a launch only through complete V2 provenance", () => {
    const model: ExploreReadModel = {
      status: "ready",
      tokens: [deepToken()],
      snapshot: {
        chainId: 1,
        blockNumber: "140",
        blockHash: `0x${"77".repeat(32)}`,
        confirmations: 12,
      },
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    };

    expect(
      findDeepV2LaunchByTransaction(model, transactionHash.toUpperCase()),
    ).toMatchObject({
      tokenAddress: token,
      name: "Deep",
      symbol: "DEEP",
      deepV2Provenance: {
        launcher,
        transactionHash,
      },
    });
    expect(
      findDeepV2LaunchByTransaction(
        {
          ...model,
          tokens: [
            {
              ...deepToken(),
              deepV2Provenance: undefined,
            },
          ],
        },
        transactionHash,
      ),
    ).toBeNull();
  });
});
