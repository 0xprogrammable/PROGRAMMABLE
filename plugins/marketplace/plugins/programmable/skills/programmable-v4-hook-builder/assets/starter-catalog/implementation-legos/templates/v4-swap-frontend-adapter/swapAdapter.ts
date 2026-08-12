// SPDX-License-Identifier: MIT

export interface SwapIntent {
  chainId: number;
  poolId: `0x${string}`;
  exactness: "exact-input" | "exact-output";
  amount: bigint;
  limitAmount: bigint;
  deadline: bigint;
  hookData: `0x${string}`;
  routeHash: `0x${string}`;
  quoteBlockNumber: bigint;
  quoteBlockHash: `0x${string}`;
}

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const BYTES_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;
const MAX_UINT256 = (1n << 256n) - 1n;

export function assertExecutableSwapIntent(
  intent: SwapIntent,
  now: bigint,
  confirmedIntent: SwapIntent
): void {
  validateSwapIntent(intent, "swap intent");
  validateSwapIntent(confirmedIntent, "confirmed swap intent");
  assertUint256(now, "current timestamp");
  if (intent.deadline < now) throw new Error("swap intent expired");
  for (const field of ["chainId", "exactness", "amount", "limitAmount", "deadline", "quoteBlockNumber"] as const) {
    if (intent[field] !== confirmedIntent[field]) throw new Error(`confirmed swap ${field} mismatch`);
  }
  for (const field of ["poolId", "hookData", "routeHash", "quoteBlockHash"] as const) {
    if (intent[field].toLowerCase() !== confirmedIntent[field].toLowerCase()) {
      throw new Error(`confirmed swap ${field} mismatch`);
    }
  }
}

function validateSwapIntent(intent: SwapIntent, label: string): void {
  if (!Number.isSafeInteger(intent.chainId) || intent.chainId <= 0) throw new Error(`${label} chainId is invalid`);
  if (intent.exactness !== "exact-input" && intent.exactness !== "exact-output") {
    throw new Error(`${label} exactness is invalid`);
  }
  if (!BYTES32_PATTERN.test(intent.poolId)) throw new Error(`${label} poolId is invalid`);
  if (!BYTES_PATTERN.test(intent.hookData)) throw new Error(`${label} hookData is invalid`);
  if (!BYTES32_PATTERN.test(intent.routeHash)) throw new Error(`${label} routeHash is invalid`);
  if (!BYTES32_PATTERN.test(intent.quoteBlockHash)) throw new Error(`${label} quoteBlockHash is invalid`);
  assertUint256(intent.amount, `${label} amount`);
  assertUint256(intent.limitAmount, `${label} limit amount`);
  assertUint256(intent.deadline, `${label} deadline`);
  assertUint256(intent.quoteBlockNumber, `${label} quote block number`);
  if (intent.amount === 0n || intent.limitAmount === 0n) throw new Error(`${label} amounts must be positive`);
}

function assertUint256(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value < 0n || value > MAX_UINT256) {
    throw new Error(`${label} must be an unsigned 256-bit integer`);
  }
}
