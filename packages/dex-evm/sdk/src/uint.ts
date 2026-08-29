import { UINT128_MAX, UINT64_MAX } from "./constants.js";
import { ProgrammableSdkError } from "./errors.js";

const CANONICAL_DECIMAL = /^(0|[1-9][0-9]*)$/;
const UINT128_MAX_DECIMAL = UINT128_MAX.toString();

export function assertUint(value: bigint, maximum: bigint, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > maximum) {
    throw new ProgrammableSdkError(
      "INTEGER_OUT_OF_RANGE",
      `${label} must be between 0 and ${maximum.toString()}`,
    );
  }
  return value;
}

export function assertUint128(value: bigint, label: string): bigint {
  return assertUint(value, UINT128_MAX, label);
}

export function assertUint64(value: bigint, label: string): bigint {
  return assertUint(value, UINT64_MAX, label);
}

export function parseUint128Decimal(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !CANONICAL_DECIMAL.test(value)) {
    throw new ProgrammableSdkError(
      "INVALID_CANONICAL_DECIMAL",
      `${label} must be a canonical non-negative decimal string`,
    );
  }
  if (
    value.length > UINT128_MAX_DECIMAL.length ||
    (value.length === UINT128_MAX_DECIMAL.length && value > UINT128_MAX_DECIMAL)
  ) {
    throw new ProgrammableSdkError(
      "INTEGER_OUT_OF_RANGE",
      `${label} must be between 0 and ${UINT128_MAX_DECIMAL}`,
    );
  }
  return BigInt(value);
}

export function checkedAddUint128(left: bigint, right: bigint, label: string): bigint {
  assertUint128(left, `${label}.left`);
  assertUint128(right, `${label}.right`);
  const result = left + right;
  if (result > UINT128_MAX) {
    throw new ProgrammableSdkError("UINT128_OVERFLOW", `${label} exceeds uint128`);
  }
  return result;
}

export function isCanonicalDecimal(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_DECIMAL.test(value);
}
