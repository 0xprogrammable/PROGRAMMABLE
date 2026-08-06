import "server-only";

import {
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
} from "viem";

const CHAIN_ID = /^[1-9][0-9]*$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const POOL_ID = /^0x[0-9a-f]{64}$/u;
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SIGNED_DECIMAL = /^(?:0|-?[1-9][0-9]*)$/u;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DYNAMIC_FEE_FLAG = 0x800000n;
const MAX_STATIC_LP_FEE = 1_000_000n;
const MIN_TICK_SPACING = 1n;
const MAX_TICK_SPACING = 32_767n;

const ALL_HOOK_MASK = (1n << 14n) - 1n;
const AFTER_ADD_LIQUIDITY_FLAG = 1n << 10n;
const AFTER_REMOVE_LIQUIDITY_FLAG = 1n << 8n;
const BEFORE_SWAP_FLAG = 1n << 7n;
const AFTER_SWAP_FLAG = 1n << 6n;
const BEFORE_SWAP_RETURNS_DELTA_FLAG = 1n << 3n;
const AFTER_SWAP_RETURNS_DELTA_FLAG = 1n << 2n;
const AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG = 1n << 1n;
const AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG = 1n;

export interface FinalizedUniswapV4IdentityV1 {
  readonly namespace: string;
  readonly value: string;
}

/**
 * Website-owned final ingress check for one finalized Uniswap v4 market.
 *
 * PoolManager is part of the exact finalized market authority, but v4's
 * canonical PoolId itself is keccak256(abi.encode(PoolKey)) and therefore
 * hashes only currency0, currency1, fee, tickSpacing and hooks.
 */
export function assertFinalizedUniswapV4PoolIdentityV1(input: Readonly<{
  chainId: string;
  poolId: string;
  pool: FinalizedUniswapV4IdentityV1;
  poolManager: FinalizedUniswapV4IdentityV1;
  currency0: FinalizedUniswapV4IdentityV1;
  currency1: FinalizedUniswapV4IdentityV1;
  feeRaw: string;
  dynamicFee: boolean;
  tickSpacing: string;
  hooks: FinalizedUniswapV4IdentityV1 | null;
}>): Hex {
  if (!CHAIN_ID.test(input.chainId)) {
    throw new TypeError("custom launch v4 chain id is invalid");
  }
  const chainNamespace = `eip155:${input.chainId}`;
  const poolNamespace = `${chainNamespace}:uniswap-v4-pool-id`;
  const poolManager = exactEvmIdentity(
    input.poolManager,
    chainNamespace,
    "PoolManager",
  );
  if (poolManager === ZERO_ADDRESS) {
    throw new TypeError("custom launch v4 PoolManager is zero");
  }
  const currency0 = exactEvmIdentity(
    input.currency0,
    chainNamespace,
    "currency0",
  );
  const currency1 = exactEvmIdentity(
    input.currency1,
    chainNamespace,
    "currency1",
  );
  if (BigInt(currency0) >= BigInt(currency1)) {
    throw new TypeError("custom launch v4 currencies are not canonically ordered");
  }

  if (!UNSIGNED_DECIMAL.test(input.feeRaw)) {
    throw new TypeError("custom launch v4 fee is invalid");
  }
  const fee = BigInt(input.feeRaw);
  if (
    (input.dynamicFee && fee !== DYNAMIC_FEE_FLAG)
    || (!input.dynamicFee && fee > MAX_STATIC_LP_FEE)
  ) {
    throw new TypeError("custom launch v4 fee semantics are invalid");
  }

  if (!SIGNED_DECIMAL.test(input.tickSpacing)) {
    throw new TypeError("custom launch v4 tick spacing is invalid");
  }
  const tickSpacing = BigInt(input.tickSpacing);
  if (tickSpacing < MIN_TICK_SPACING || tickSpacing > MAX_TICK_SPACING) {
    throw new TypeError("custom launch v4 tick spacing is outside official bounds");
  }

  const hooks = input.hooks === null
    ? ZERO_ADDRESS
    : exactEvmIdentity(input.hooks, chainNamespace, "hooks");
  if (input.hooks !== null && hooks === ZERO_ADDRESS) {
    throw new TypeError("custom launch v4 zero hooks must use the null sentinel");
  }
  if (!validHookAddress(BigInt(hooks), input.dynamicFee)) {
    throw new TypeError("custom launch v4 hook and fee semantics are invalid");
  }

  const derivedPoolId = keccak256(encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint24" },
      { type: "int24" },
      { type: "address" },
    ],
    [
      currency0 as Address,
      currency1 as Address,
      Number(fee),
      Number(tickSpacing),
      hooks as Address,
    ],
  ));
  if (
    !POOL_ID.test(input.poolId)
    || input.pool.namespace !== poolNamespace
    || input.pool.value !== input.poolId
    || input.poolId !== derivedPoolId
  ) {
    throw new TypeError("custom launch v4 PoolId is not derived from the finalized PoolKey");
  }
  return derivedPoolId;
}

function exactEvmIdentity(
  identity: FinalizedUniswapV4IdentityV1,
  expectedNamespace: string,
  label: string,
): Address {
  if (
    identity === null
    || typeof identity !== "object"
    || identity.namespace !== expectedNamespace
    || !ADDRESS.test(identity.value)
  ) {
    throw new TypeError(`custom launch v4 ${label} identity is invalid`);
  }
  return identity.value as Address;
}

/** Exact mirror of v4-core Hooks.isValidHookAddress for finalized PoolKeys. */
function validHookAddress(hooks: bigint, dynamicFee: boolean): boolean {
  const has = (flag: bigint) => (hooks & flag) !== 0n;
  if (!has(BEFORE_SWAP_FLAG) && has(BEFORE_SWAP_RETURNS_DELTA_FLAG)) return false;
  if (!has(AFTER_SWAP_FLAG) && has(AFTER_SWAP_RETURNS_DELTA_FLAG)) return false;
  if (
    !has(AFTER_ADD_LIQUIDITY_FLAG)
    && has(AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG)
  ) return false;
  if (
    !has(AFTER_REMOVE_LIQUIDITY_FLAG)
    && has(AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG)
  ) return false;
  return hooks === 0n
    ? !dynamicFee
    : (hooks & ALL_HOOK_MASK) > 0n || dynamicFee;
}
