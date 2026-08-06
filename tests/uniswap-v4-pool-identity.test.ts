import { Token } from "@uniswap/sdk-core";
import { Pool } from "@uniswap/v4-sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertFinalizedUniswapV4PoolIdentityV1,
} from "../lib/server/projection-target/uniswap-v4-pool-identity";

const CURRENCY0 = "0x1111111111111111111111111111111111111111";
const CURRENCY1 = "0x2222222222222222222222222222222222222222";
const POOL_MANAGER = "0x5555555555555555555555555555555555555555";
const ZERO_HOOK = "0x0000000000000000000000000000000000000000";

describe("finalized Uniswap v4 PoolId ingress", () => {
  it("matches the official v4 SDK PoolId vector", () => {
    const currency0 = new Token(1, CURRENCY0, 18, "T0", "Token 0");
    const currency1 = new Token(1, CURRENCY1, 18, "T1", "Token 1");
    const poolId = Pool.getPoolId(currency0, currency1, 3_000, 60, ZERO_HOOK);

    expect(assertFinalizedUniswapV4PoolIdentityV1({
      chainId: "1",
      poolId,
      pool: {
        namespace: "eip155:1:uniswap-v4-pool-id",
        value: poolId,
      },
      poolManager: { namespace: "eip155:1", value: POOL_MANAGER },
      currency0: { namespace: "eip155:1", value: CURRENCY0 },
      currency1: { namespace: "eip155:1", value: CURRENCY1 },
      feeRaw: "3000",
      dynamicFee: false,
      tickSpacing: "60",
      hooks: null,
    })).toBe(poolId);
  });

  it("rejects cross-chain identities and reversed finalized currency order", () => {
    const currency0 = new Token(1, CURRENCY0, 18, "T0", "Token 0");
    const currency1 = new Token(1, CURRENCY1, 18, "T1", "Token 1");
    const poolId = Pool.getPoolId(currency0, currency1, 3_000, 60, ZERO_HOOK);
    const valid = {
      chainId: "1",
      poolId,
      pool: {
        namespace: "eip155:1:uniswap-v4-pool-id",
        value: poolId,
      },
      poolManager: { namespace: "eip155:1", value: POOL_MANAGER },
      currency0: { namespace: "eip155:1", value: CURRENCY0 },
      currency1: { namespace: "eip155:1", value: CURRENCY1 },
      feeRaw: "3000",
      dynamicFee: false,
      tickSpacing: "60",
      hooks: null,
    } as const;

    expect(() => assertFinalizedUniswapV4PoolIdentityV1({
      ...valid,
      poolManager: { ...valid.poolManager, namespace: "eip155:8453" },
    })).toThrow("PoolManager identity");
    expect(() => assertFinalizedUniswapV4PoolIdentityV1({
      ...valid,
      currency0: valid.currency1,
      currency1: valid.currency0,
    })).toThrow("canonically ordered");
  });

  it("accepts the official inclusive static limits and a valid dynamic-fee hook", () => {
    const currency0 = new Token(1, CURRENCY0, 18, "T0", "Token 0");
    const currency1 = new Token(1, CURRENCY1, 18, "T1", "Token 1");
    const common = {
      chainId: "1",
      poolManager: { namespace: "eip155:1", value: POOL_MANAGER },
      currency0: { namespace: "eip155:1", value: CURRENCY0 },
      currency1: { namespace: "eip155:1", value: CURRENCY1 },
    } as const;
    const maximumStaticPoolId = Pool.getPoolId(
      currency0,
      currency1,
      1_000_000,
      32_767,
      ZERO_HOOK,
    );
    expect(assertFinalizedUniswapV4PoolIdentityV1({
      ...common,
      poolId: maximumStaticPoolId,
      pool: {
        namespace: "eip155:1:uniswap-v4-pool-id",
        value: maximumStaticPoolId,
      },
      feeRaw: "1000000",
      dynamicFee: false,
      tickSpacing: "32767",
      hooks: null,
    })).toBe(maximumStaticPoolId);

    const dynamicHook = "0x1000000000000000000000000000000000000000";
    const dynamicPoolId = Pool.getPoolId(
      currency0,
      currency1,
      0x800000,
      60,
      dynamicHook,
    );
    expect(assertFinalizedUniswapV4PoolIdentityV1({
      ...common,
      poolId: dynamicPoolId,
      pool: {
        namespace: "eip155:1:uniswap-v4-pool-id",
        value: dynamicPoolId,
      },
      feeRaw: "8388608",
      dynamicFee: true,
      tickSpacing: "60",
      hooks: { namespace: "eip155:1", value: dynamicHook },
    })).toBe(dynamicPoolId);
  });
});
