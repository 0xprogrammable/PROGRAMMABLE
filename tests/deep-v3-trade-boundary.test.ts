import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import {
  deepV3VaultBindingHash,
  DEEP_V3_OFFICIAL_DEPENDENCIES,
  DEEP_V3_RUNTIME_FIELDS,
  resolveVerifiedDeepV3ReadRelease,
  type VerifiedDeepV3ReadRelease,
} from "../lib/onchain/deep-v3-read-model";
import {
  assertDeepV3TradeRuntime,
  buildDeepV3ExactPoolRoute,
  resolveDeepV3TradeBoundary,
  resolveManifestGatedDeepV3TradeBoundary,
  type DeepV3TradeRuntimeClient,
} from "../lib/trade/deep-v3";
import {
  DEEP_V3_TEST_ADDRESSES,
  DEEP_V3_TEST_CONFIGURATION_HASH,
  DEEP_V3_TEST_LAUNCH_HASH,
  DEEP_V3_TEST_POOL_ID,
  DEEP_V3_TEST_RUNTIME,
  DEEP_V3_TEST_RUNTIME_HASH,
  DEEP_V3_TEST_TOKEN,
  DEEP_V3_TEST_VAULT,
  deepV3LiveManifestFixture,
  deepV3TestProvenance,
} from "./deep-v3-fixture";

function verifiedRelease() {
  const release = resolveVerifiedDeepV3ReadRelease(
    deepV3LiveManifestFixture(),
    1,
  );
  if (!release) throw new Error("Expected verified fixture");
  return release;
}

function syntheticRuntimeRelease() {
  const release = verifiedRelease();
  return {
    ...release,
    runtimeCodeHashes: {
      ...Object.fromEntries(
        DEEP_V3_RUNTIME_FIELDS.map((field) => [
          field,
          DEEP_V3_TEST_RUNTIME_HASH,
        ]),
      ),
      lockedPositionFactory: DEEP_V3_TEST_RUNTIME_HASH,
    },
    officialDependencies: Object.fromEntries(
      Object.entries(DEEP_V3_OFFICIAL_DEPENDENCIES).map(
        ([field, dependency]) => [
          field,
          {
            ...dependency,
            runtimeCodeHash: DEEP_V3_TEST_RUNTIME_HASH,
          },
        ],
      ),
    ),
  } as unknown as VerifiedDeepV3ReadRelease;
}

function runtimeClient(overrides?: {
  chainId?: number;
  wrongVault?: boolean;
  runtimeMismatch?: Address;
}) {
  const checked: Address[] = [];
  const release = syntheticRuntimeRelease();
  const bindingHash = deepV3VaultBindingHash({
    chainId: 1,
    factory: DEEP_V3_TEST_ADDRESSES.growthVaultFactory,
    vault: DEEP_V3_TEST_VAULT,
    hook: DEEP_V3_TEST_ADDRESSES.feeHook,
    poolId: DEEP_V3_TEST_POOL_ID,
    token: DEEP_V3_TEST_TOKEN,
  });
  const client: DeepV3TradeRuntimeClient = {
    async getChainId() {
      return overrides?.chainId ?? 1;
    },
    async getCode({ address }) {
      checked.push(address);
      return address === overrides?.runtimeMismatch
        ? ("0x6001" as Hex)
        : DEEP_V3_TEST_RUNTIME;
    },
    async readContract({ address, functionName }) {
      if (
        address === DEEP_V3_TEST_TOKEN &&
        functionName === "creator"
      ) {
        return DEEP_V3_TEST_ADDRESSES.launcher;
      }
      if (address === DEEP_V3_TEST_ADDRESSES.launcher) {
        if (functionName === "growthVaultOf") {
          return overrides?.wrongVault
            ? DEEP_V3_TEST_ADDRESSES.keeperExecutor
            : DEEP_V3_TEST_VAULT;
        }
        if (functionName === "launchHashOf") {
          return DEEP_V3_TEST_LAUNCH_HASH;
        }
      }
      if (address === DEEP_V3_TEST_ADDRESSES.growthVaultFactory) {
        if (functionName === "isFactoryVault") return true;
        if (functionName === "configurationHashOf") {
          return DEEP_V3_TEST_CONFIGURATION_HASH;
        }
        if (functionName === "vaultBindingHash") return bindingHash;
      }
      if (
        address === DEEP_V3_TEST_ADDRESSES.feeHook &&
        functionName === "poolFeeConfig"
      ) {
        return [
          DEEP_V3_TEST_VAULT,
          DEEP_V3_TEST_ADDRESSES.launcher,
          5,
          0n,
        ] as const;
      }
      if (address === DEEP_V3_TEST_VAULT) {
        const values: Record<string, unknown> = {
          FACTORY: DEEP_V3_TEST_ADDRESSES.growthVaultFactory,
          feeHook: DEEP_V3_TEST_ADDRESSES.feeHook,
          poolId: DEEP_V3_TEST_POOL_ID,
          token: DEEP_V3_TEST_TOKEN,
          configurationHash: DEEP_V3_TEST_CONFIGURATION_HASH,
        };
        if (functionName in values) return values[functionName];
      }
      if (
        address === DEEP_V3_TEST_ADDRESSES.automation &&
        functionName === "isRegisteredVault"
      ) {
        return true;
      }
      throw new Error(`Unexpected read ${address}:${functionName}`);
    },
  };
  return { client, checked, release };
}

describe("Deep V3 trade boundary", () => {
  it("resolves only the exact native ETH Deep pool through the v4 router", () => {
    const boundary = resolveDeepV3TradeBoundary(
      deepV3TestProvenance(),
      verifiedRelease(),
    );
    const buy = buildDeepV3ExactPoolRoute(boundary, "buy");
    const sell = buildDeepV3ExactPoolRoute(boundary, "sell");

    expect(boundary.poolKey).toEqual({
      currency0: "0x0000000000000000000000000000000000000000",
      currency1: DEEP_V3_TEST_TOKEN,
      fee: 0,
      tickSpacing: 200,
      hooks: DEEP_V3_TEST_ADDRESSES.feeHook,
    });
    expect(boundary.poolId).toBe(DEEP_V3_TEST_POOL_ID);
    expect(buy).toMatchObject({
      kind: "uniswap-v4-single-pool",
      zeroForOne: true,
      requiresPermit2: false,
    });
    expect(sell).toMatchObject({
      kind: "uniswap-v4-single-pool",
      zeroForOne: false,
      requiresPermit2: true,
    });
  });

  it("does not open a routing boundary for an ineligible manifest", () => {
    expect(() =>
      resolveManifestGatedDeepV3TradeBoundary({
        manifest: {
          ...deepV3LiveManifestFixture(),
          releaseEligible: false,
        },
        chainId: 1,
        candidate: deepV3TestProvenance(),
      }),
    ).toThrow(/verified live release/);
  });

  it("rejects another hook, PoolId or release generation", () => {
    const release = verifiedRelease();
    expect(() =>
      resolveDeepV3TradeBoundary(
        {
          ...deepV3TestProvenance(),
          deepReleaseVersion:
            "deep-full-range-v2" as "deep-full-range-v3",
        },
        release,
      ),
    ).toThrow(/Deep V3/);
    expect(() =>
      resolveDeepV3TradeBoundary(
        {
          ...deepV3TestProvenance(),
          hookAddress: DEEP_V3_TEST_ADDRESSES.hookFactory,
        },
        release,
      ),
    ).toThrow(/release/);
    expect(() =>
      resolveDeepV3TradeBoundary(
        {
          ...deepV3TestProvenance(),
          poolId: `0x${"ff".repeat(32)}`,
        },
        release,
      ),
    ).toThrow(/PoolId/);
  });

  it("checks every release runtime and the complete onchain topology", async () => {
    const { client, checked, release } = runtimeClient();

    await expect(
      assertDeepV3TradeRuntime(
        client,
        release,
        deepV3TestProvenance(),
        188n,
      ),
    ).resolves.toBeUndefined();

    expect(new Set(checked)).toEqual(
      new Set([
        ...DEEP_V3_RUNTIME_FIELDS.map(
          (field) => release.addresses[field],
        ),
        release.addresses.lockedPositionFactory,
        ...Object.values(release.officialDependencies).map(
          (dependency) => dependency.address,
        ),
        DEEP_V3_TEST_TOKEN,
        DEEP_V3_TEST_VAULT,
      ]),
    );
  });

  it("rejects runtime drift and launcher-to-vault drift", async () => {
    const drifted = runtimeClient({
      runtimeMismatch: DEEP_V3_TEST_ADDRESSES.feeHook,
    });
    await expect(
      assertDeepV3TradeRuntime(
        drifted.client,
        drifted.release,
        deepV3TestProvenance(),
      ),
    ).rejects.toThrow(/runtime/);

    const wrongVault = runtimeClient({ wrongVault: true });
    await expect(
      assertDeepV3TradeRuntime(
        wrongVault.client,
        wrongVault.release,
        deepV3TestProvenance(),
      ),
    ).rejects.toThrow(/topology/);
  });
});
