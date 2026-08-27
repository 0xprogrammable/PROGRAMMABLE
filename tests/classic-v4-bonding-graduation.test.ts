import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

vi.mock("server-only", () => ({}));

import {
  ClassicBondingInactiveError,
  parseClassicBondingGraduationRequest,
  prepareClassicBondingGraduation,
  type ClassicBondingGraduationRuntimeClient,
} from "../lib/trade/bonding-graduation.server";
import { classicV4LaunchAbi } from "../lib/classic-v4";
import type { ClassicV4PublicRelease } from "../lib/classic-v4-release";
import type { ExploreReadModel } from "../lib/onchain/types";

const OWNER = getAddress("0x1111111111111111111111111111111111111111");
const TOKEN = getAddress("0x2222222222222222222222222222222222222222");
const HOOK = getAddress("0x3333333333333333333333333333333333333333");
const LAUNCHER = getAddress("0x4444444444444444444444444444444444444444");
const FACTORY = getAddress("0x5555555555555555555555555555555555555555");
const VAULT = getAddress("0x6666666666666666666666666666666666666666");
const POOL_ID = `0x${"77".repeat(32)}` as Hex;
const FACTORY_CODE = "0x6001600055" as Hex;

function release(): ClassicV4PublicRelease {
  return {
    chainId: 1,
    model: "classic",
    internalContractRelease: "classic-v4",
    releaseStatus: "publicly-available",
    addresses: {
      launcher: LAUNCHER,
      feeHook: HOOK,
      graduationVaultFactory: FACTORY,
    },
    runtimeCodeHashes: {
      graduationVaultFactory: keccak256(FACTORY_CODE),
    },
    verification: { publicAvailable: true },
  } as unknown as ClassicV4PublicRelease;
}

function registry(): ExploreReadModel {
  return {
    status: "ready",
    tokens: [
      {
        id: `1:${TOKEN}`,
        name: "Bonding Token",
        symbol: "BOND",
        tokenAddress: TOKEN,
        hookAddress: HOOK,
        poolId: POOL_ID,
        creatorAddress: OWNER,
        launchedAt: new Date(0).toISOString(),
        totalSwapFeeBps: 100,
        launchModel: "classic",
        launchModelVersion: "classic-v4",
        liquidityPath: "meme",
      },
    ],
    snapshot: {
      chainId: 1,
      blockNumber: "100",
      blockHash: `0x${"88".repeat(32)}`,
      confirmations: 0,
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

function runtime(
  overrides: {
    state?: number;
    vault?: Address;
    factoryCode?: Hex;
    netQuote?: bigint;
    nativeBalance?: bigint;
    graduated?: boolean;
    progressThrows?: boolean;
  } = {},
) {
  const readContract = vi.fn(async (input: Record<string, unknown>) => {
    switch (input.functionName) {
      case "graduationVaultFactory":
        return FACTORY;
      case "graduationVaultOf":
        return overrides.vault ?? VAULT;
      case "bondingProgress":
        if (overrides.progressThrows) throw new Error("progress unavailable");
        if (overrides.state === 3 || overrides.state === 5) {
          return [overrides.state, 10_000, 0n, 0n] as const;
        }
        return [overrides.state ?? 2, 4200, 2_000n, 990n] as const;
      case "isFactoryVault":
        return true;
      case "poolId":
        return POOL_ID;
      case "graduated":
        return overrides.graduated ?? false;
      case "bondingMaxBuyQuote":
        return [1_000n, overrides.netQuote ?? 990n] as const;
      default:
        throw new Error(`Unexpected read ${String(input.functionName)}`);
    }
  });
  const client: ClassicBondingGraduationRuntimeClient = {
    getBalance: vi
      .fn()
      .mockResolvedValue(overrides.nativeBalance ?? 10n ** 18n),
    getGasPrice: vi.fn().mockResolvedValue(1n),
    getCode: vi.fn().mockResolvedValue(overrides.factoryCode ?? FACTORY_CODE),
    getBlock: vi.fn().mockResolvedValue({ timestamp: 10_000n }),
    readContract,
    call: vi.fn(async ({ data }: { data: Hex }) => ({
      data:
        data.slice(0, 10) ===
        encodeFunctionData({
          abi: classicV4LaunchAbi,
          functionName: "graduate",
          args: [TOKEN],
        }).slice(0, 10)
          ? encodeFunctionResult({
              abi: classicV4LaunchAbi,
              functionName: "graduate",
              result: 42n,
            })
          : encodeFunctionResult({
              abi: classicV4LaunchAbi,
              functionName: "maxBuyAndGraduate",
              result: [1_999n, 42n],
            }),
    })),
    estimateGas: vi.fn().mockResolvedValue(500_000n),
  };
  return { client, readContract };
}

describe("Classic V4 Bonding graduation preparation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses only the fixed mainnet owner and token request", () => {
    expect(
      parseClassicBondingGraduationRequest({
        chainId: 1,
        owner: OWNER,
        token: TOKEN,
      }),
    ).toEqual({ chainId: 1, owner: OWNER, token: TOKEN });
    expect(() =>
      parseClassicBondingGraduationRequest({
        chainId: 1,
        owner: OWNER,
        token: TOKEN,
        value: "1000",
      }),
    ).toThrow("unsupported field value");
  });

  it("simulates and returns one fixed-launcher Max Buy plus graduation", async () => {
    const { client } = runtime();
    const prepared = await prepareClassicBondingGraduation(
      client,
      release(),
      registry(),
      { chainId: 1, owner: OWNER, token: TOKEN },
      100n,
    );

    expect(prepared).toMatchObject({
      vault: VAULT,
      bonding: {
        state: "bonding",
        progressBps: 4200,
        samePool: true,
        finalLiquidityLocked: true,
      },
      quote: {
        amountIn: "1000",
        amountOut: "1999",
        amountOutMinimum: "1999",
        gasEstimate: "500000",
        deadline: "10300",
      },
      transaction: {
        kind: "bonding-max-buy",
        to: LAUNCHER,
        value: "1000",
        gasLimit: "600000",
      },
    });
  });

  it("prepares a zero-value permissionless graduation after the curve endpoint", async () => {
    const { client, readContract } = runtime({ state: 3 });
    const prepared = await prepareClassicBondingGraduation(
      client,
      release(),
      registry(),
      { chainId: 1, owner: OWNER, token: TOKEN },
      100n,
    );

    expect(prepared).toMatchObject({
      bonding: { state: "ready", progressBps: 10_000 },
      quote: { amountIn: "0", amountOut: "0", amountOutMinimum: "0" },
      transaction: {
        kind: "bonding-graduate",
        to: LAUNCHER,
        value: "0",
        gasLimit: "600000",
      },
    });
    expect(
      readContract.mock.calls.some(
        ([input]) => input.functionName === "bondingMaxBuyQuote",
      ),
    ).toBe(false);
  });

  it("treats Standard, completed or missing-vault launches as inactive", async () => {
    for (const candidate of [
      runtime({
        vault: getAddress("0x0000000000000000000000000000000000000000"),
        progressThrows: true,
      }).client,
      runtime({ state: 5, graduated: true }).client,
    ]) {
      await expect(
        prepareClassicBondingGraduation(
          candidate,
          release(),
          registry(),
          { chainId: 1, owner: OWNER, token: TOKEN },
          100n,
        ),
      ).rejects.toBeInstanceOf(ClassicBondingInactiveError);
    }
  });

  it("fails closed on runtime, quote or wallet-balance drift", async () => {
    for (const candidate of [
      runtime({ factoryCode: "0x6000" }).client,
      runtime({ netQuote: 989n }).client,
      runtime({ nativeBalance: 1_000n }).client,
    ]) {
      await expect(
        prepareClassicBondingGraduation(
          candidate,
          release(),
          registry(),
          { chainId: 1, owner: OWNER, token: TOKEN },
          100n,
        ),
      ).rejects.toThrow();
    }
  });
});
