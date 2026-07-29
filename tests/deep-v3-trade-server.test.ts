import { describe, expect, it } from "vitest";
import { CommandType } from "@uniswap/universal-router-sdk";
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Address,
  type Hex,
} from "viem";

import type { ExploreReadModel } from "../lib/onchain/types";
import {
  deepV3VaultBindingHash,
  DEEP_V3_OFFICIAL_DEPENDENCIES,
  DEEP_V3_RUNTIME_FIELDS,
  resolveVerifiedDeepV3ReadRelease,
  type VerifiedDeepV3ReadRelease,
} from "../lib/onchain/deep-v3-read-model";
import {
  classicPermit2Abi,
  classicQuoterAbi,
  classicTokenAbi,
  classicUniversalRouterAbi,
} from "../lib/trade/classic";
import {
  prepareClassicTrade,
  resolveTradeDeployment,
  type ClassicTradeRelease,
  type ClassicTradeRuntimeClient,
} from "../lib/trade/server";
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

const OWNER = deepV3TestProvenance().creator;

function verifiedRelease() {
  const release = resolveVerifiedDeepV3ReadRelease(
    deepV3LiveManifestFixture(),
    1,
  );
  if (!release) throw new Error("Expected verified Deep V3 fixture");
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

function deployment(
  overrides: Partial<ClassicTradeRelease> = {},
): ClassicTradeRelease {
  const release = syntheticRuntimeRelease();
  const dependencies = release.officialDependencies;
  return {
    chainId: 1,
    launchModel: "deep",
    poolManager: dependencies.poolManager.address,
    v4Quoter: dependencies.v4Quoter.address,
    universalRouter: dependencies.universalRouter.address,
    universalRouterVersion: "2.0",
    permit2: dependencies.permit2.address,
    hook: release.addresses.feeHook,
    poolManagerRuntimeCodeHash: DEEP_V3_TEST_RUNTIME_HASH,
    v4QuoterRuntimeCodeHash: DEEP_V3_TEST_RUNTIME_HASH,
    universalRouterRuntimeCodeHash: DEEP_V3_TEST_RUNTIME_HASH,
    permit2RuntimeCodeHash: DEEP_V3_TEST_RUNTIME_HASH,
    hookRuntimeCodeHash: DEEP_V3_TEST_RUNTIME_HASH,
    deepReleaseVersion: "deep-full-range-v3",
    deepV3Release: release,
    deepV3Candidate: deepV3TestProvenance(),
    ...overrides,
  };
}

function registry(
  provenance: Record<string, unknown> = deepV3TestProvenance(),
): ExploreReadModel {
  return {
    status: "ready",
    tokens: [
      {
        id: `1:${DEEP_V3_TEST_TOKEN}`,
        name: "Deep Test",
        symbol: "DEEP",
        tokenAddress: DEEP_V3_TEST_TOKEN,
        hookAddress: DEEP_V3_TEST_ADDRESSES.feeHook,
        poolId: DEEP_V3_TEST_POOL_ID,
        creatorAddress: OWNER,
        launchedAt: "2026-07-29T00:00:00.000Z",
        totalSwapFeeBps: 100,
        launchModel: "deep",
        deepReleaseVersion: "deep-full-range-v3",
        deepV3Provenance: provenance,
        liquidityPath: "meme",
      },
    ],
    snapshot: {
      chainId: 1,
      blockNumber: "200",
      blockHash: `0x${"ab".repeat(32)}`,
      confirmations: 12,
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  } as unknown as ExploreReadModel;
}

function request(side: "buy" | "sell") {
  return {
    chainId: 1,
    owner: OWNER,
    token: DEEP_V3_TEST_TOKEN,
    side,
    amountIn: 1_000n,
    slippageBps: 100,
    deadline: 10_900n,
  } as const;
}

function runtimeClient(input?: {
  tokenAllowance?: bigint;
  permit2Allowance?: bigint;
  permit2Expiration?: number;
  runtimeMismatch?: Address;
}) {
  const quotedPoolIds: Hex[] = [];
  const routerCalldata: Hex[] = [];
  const bindingHash = deepV3VaultBindingHash({
    chainId: 1,
    factory: DEEP_V3_TEST_ADDRESSES.growthVaultFactory,
    vault: DEEP_V3_TEST_VAULT,
    hook: DEEP_V3_TEST_ADDRESSES.feeHook,
    poolId: DEEP_V3_TEST_POOL_ID,
    token: DEEP_V3_TEST_TOKEN,
  });
  const release = syntheticRuntimeRelease();
  const client: ClassicTradeRuntimeClient = {
    async getChainId() {
      return 1;
    },
    async getBlock() {
      return { timestamp: 10_000n };
    },
    async getBalance() {
      return 10n ** 18n;
    },
    async getGasPrice() {
      return 1n;
    },
    async getCode({ address }) {
      return address.toLowerCase() ===
        input?.runtimeMismatch?.toLowerCase()
        ? ("0x6001" as Hex)
        : DEEP_V3_TEST_RUNTIME;
    },
    async estimateGas() {
      return 300_000n;
    },
    async call(args) {
      if (args.to.toLowerCase() === DEEP_V3_TEST_TOKEN.toLowerCase()) {
        if (args.data.startsWith("0x70a08231")) {
          return {
            data: encodeFunctionResult({
              abi: classicTokenAbi,
              functionName: "balanceOf",
              result: 100_000n,
            }),
          };
        }
        return {
          data: encodeFunctionResult({
            abi: classicTokenAbi,
            functionName: "allowance",
            result: input?.tokenAllowance ?? 100_000n,
          }),
        };
      }
      if (
        args.to.toLowerCase() ===
        release.officialDependencies.permit2.address.toLowerCase()
      ) {
        return {
          data: encodeFunctionResult({
            abi: classicPermit2Abi,
            functionName: "allowance",
            result: [
              input?.permit2Allowance ?? 100_000n,
              input?.permit2Expiration ?? 50_000,
              0,
            ],
          }),
        };
      }
      if (
        args.to.toLowerCase() ===
        release.officialDependencies.v4Quoter.address.toLowerCase()
      ) {
        const decoded = decodeFunctionData({
          abi: classicQuoterAbi,
          data: args.data,
        });
        const quote = decoded.args[0];
        quotedPoolIds.push(DEEP_V3_TEST_POOL_ID);
        expect(quote.poolKey).toEqual({
          currency0:
            "0x0000000000000000000000000000000000000000",
          currency1: DEEP_V3_TEST_TOKEN,
          fee: 0,
          tickSpacing: 200,
          hooks: DEEP_V3_TEST_ADDRESSES.feeHook,
        });
        return {
          data: encodeFunctionResult({
            abi: classicQuoterAbi,
            functionName: "quoteExactInputSingle",
            result: [10_000n, 222_000n],
          }),
        };
      }
      if (
        args.to.toLowerCase() ===
        release.officialDependencies.universalRouter.address.toLowerCase()
      ) {
        routerCalldata.push(args.data);
        return {};
      }
      throw new Error(`Unexpected call to ${args.to}`);
    },
    async readContract({ address, functionName }) {
      if (
        address === DEEP_V3_TEST_TOKEN &&
        functionName === "creator"
      ) {
        return DEEP_V3_TEST_ADDRESSES.launcher;
      }
      if (address === DEEP_V3_TEST_ADDRESSES.launcher) {
        if (functionName === "growthVaultOf") return DEEP_V3_TEST_VAULT;
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
  return { client, quotedPoolIds, routerCalldata };
}

describe("Deep V3 server trading", () => {
  it("prepares buy and sell only through the exact original v4 pool", async () => {
    const buyRuntime = runtimeClient();
    const buy = await prepareClassicTrade(
      buyRuntime.client,
      deployment(),
      request("buy"),
      registry(),
    );
    expect(buy).toMatchObject({
      status: "ready",
      side: "buy",
      poolKey: {
        hooks: DEEP_V3_TEST_ADDRESSES.feeHook,
      },
      transaction: {
        kind: "swap",
        to: DEEP_V3_OFFICIAL_DEPENDENCIES.universalRouter.address,
        value: "1000",
      },
    });
    expect(buyRuntime.quotedPoolIds).toEqual([DEEP_V3_TEST_POOL_ID]);
    const buySwap = decodeFunctionData({
      abi: classicUniversalRouterAbi,
      data: buyRuntime.routerCalldata[0],
    });
    expect(buySwap.functionName).toBe("execute");
    expect(buySwap.args[0]).toBe(
      `0x${Number(CommandType.V4_SWAP).toString(16).padStart(2, "0")}`,
    );
    expect(buySwap.args[1]).toHaveLength(1);

    const sellRuntime = runtimeClient();
    const sell = await prepareClassicTrade(
      sellRuntime.client,
      deployment(),
      request("sell"),
      registry(),
    );
    expect(sell).toMatchObject({
      status: "ready",
      side: "sell",
      approvalState: "ready",
      transaction: {
        kind: "swap",
        to: DEEP_V3_OFFICIAL_DEPENDENCIES.universalRouter.address,
        value: "0",
      },
    });
    expect(sellRuntime.quotedPoolIds).toEqual([DEEP_V3_TEST_POOL_ID]);
    const sellSwap = decodeFunctionData({
      abi: classicUniversalRouterAbi,
      data: sellRuntime.routerCalldata[0],
    });
    expect(sellSwap.args[0]).toBe(
      `0x${Number(CommandType.V4_SWAP).toString(16).padStart(2, "0")}`,
    );
    expect(sellSwap.args[1]).toHaveLength(1);
  });

  it("keeps both required sell approvals on the verified V3 route", async () => {
    const tokenApproval = await prepareClassicTrade(
      runtimeClient({ tokenAllowance: 999n }).client,
      deployment(),
      request("sell"),
      registry(),
    );
    expect(tokenApproval).toMatchObject({
      status: "approval-required",
      approvalState: "token-to-permit2",
      transaction: {
        kind: "token-to-permit2",
        to: DEEP_V3_TEST_TOKEN,
      },
    });

    const permit2Approval = await prepareClassicTrade(
      runtimeClient({
        tokenAllowance: 100_000n,
        permit2Allowance: 999n,
      }).client,
      deployment(),
      request("sell"),
      registry(),
    );
    expect(permit2Approval).toMatchObject({
      status: "approval-required",
      approvalState: "permit2-to-router",
      transaction: {
        kind: "permit2-to-router",
        to: DEEP_V3_OFFICIAL_DEPENDENCIES.permit2.address,
      },
    });
  });

  it("rejects malformed provenance, another PoolId and runtime drift", async () => {
    const mislabeled = registry();
    mislabeled.tokens[0].launchModel = "classic";
    expect(() =>
      resolveTradeDeployment(
        1,
        mislabeled,
        DEEP_V3_TEST_TOKEN,
        deepV3LiveManifestFixture(),
      ),
    ).toThrow(/cannot use a Classic/);
    await expect(
      prepareClassicTrade(
        runtimeClient().client,
        deployment({
          launchModel: "classic",
          deepReleaseVersion: undefined,
        }),
        request("buy"),
        mislabeled,
      ),
    ).rejects.toThrow(/cannot use another trade release/);

    expect(() =>
      resolveTradeDeployment(
        1,
        registry({
          ...deepV3TestProvenance(),
          vaultConfigurationHash: "0x1234",
        }),
        DEEP_V3_TEST_TOKEN,
        deepV3LiveManifestFixture(),
      ),
    ).toThrow(/Deep V3 provenance/);

    expect(() =>
      resolveTradeDeployment(
        1,
        registry({
          ...deepV3TestProvenance(),
          poolId: `0x${"ff".repeat(32)}`,
        }),
        DEEP_V3_TEST_TOKEN,
        deepV3LiveManifestFixture(),
      ),
    ).toThrow(/PoolId/);

    await expect(
      prepareClassicTrade(
        runtimeClient({
          runtimeMismatch: DEEP_V3_TEST_ADDRESSES.feeHook,
        }).client,
        deployment(),
        request("buy"),
        registry(),
      ),
    ).rejects.toThrow(/runtime/);
  });

  it("fails closed while the checked-in Deep V3 manifest is pending", () => {
    expect(() =>
      resolveTradeDeployment(
        1,
        registry(),
        DEEP_V3_TEST_TOKEN,
      ),
    ).toThrow(/verified live release/);
  });
});
