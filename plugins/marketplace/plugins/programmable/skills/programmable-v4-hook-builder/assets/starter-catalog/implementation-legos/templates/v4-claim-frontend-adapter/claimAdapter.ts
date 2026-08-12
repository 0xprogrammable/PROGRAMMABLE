// SPDX-License-Identifier: MIT

export type ClaimAddress = `0x${string}`;

export interface ClaimAllowanceSnapshot {
  spender: ClaimAddress;
  currencyId: bigint;
  amount: bigint;
}

export interface ClaimSnapshot {
  owner: ClaimAddress;
  operator: ClaimAddress | null;
  mintAuthority: ClaimAddress | null;
  currencyId: bigint;
  balance: bigint;
  blockNumber: bigint;
  allowance: ClaimAllowanceSnapshot | null;
}

export interface ClaimAction {
  kind: "mint" | "burn";
  owner: ClaimAddress;
  currencyId: bigint;
  amount: bigint;
}

export type ClaimAuthorizationMode = "owner" | "operator" | "per-id-allowance" | "mint-authority";

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_CURRENCY_ID = (1n << 160n) - 1n;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function assertClaimAction(
  snapshot: ClaimSnapshot,
  action: ClaimAction,
  caller: ClaimAddress,
  confirmedAction: ClaimAction
): ClaimAuthorizationMode {
  if (typeof snapshot !== "object" || snapshot === null) throw new Error("claim snapshot must be an object");
  assertAddress(snapshot.owner, "claim owner");
  assertNullableAddress(snapshot.operator, "claim operator");
  assertNullableAddress(snapshot.mintAuthority, "claim mint authority");
  assertAddress(caller, "claim caller");
  validateClaimAction(action, "claim action");
  validateClaimAction(confirmedAction, "confirmed claim action");
  assertCurrencyId(snapshot.currencyId, "snapshot currency id");
  assertUint256(snapshot.balance, "claim balance");
  assertUint256(snapshot.blockNumber, "claim read block");
  if (action.kind !== confirmedAction.kind) throw new Error("confirmed claim kind mismatch");
  if (action.owner.toLowerCase() !== confirmedAction.owner.toLowerCase()) {
    throw new Error("confirmed claim owner mismatch");
  }
  if (action.currencyId !== confirmedAction.currencyId) throw new Error("confirmed claim currency id mismatch");
  if (action.amount !== confirmedAction.amount) throw new Error("confirmed claim amount mismatch");
  if (snapshot.owner.toLowerCase() !== action.owner.toLowerCase()) throw new Error("claim owner mismatch");
  if (snapshot.currencyId !== action.currencyId) throw new Error("claim currency id mismatch");

  if (snapshot.allowance !== null) {
    if (typeof snapshot.allowance !== "object") throw new Error("claim allowance must be an object or null");
    assertAddress(snapshot.allowance.spender, "claim allowance spender");
    assertCurrencyId(snapshot.allowance.currencyId, "claim allowance currency id");
    assertUint256(snapshot.allowance.amount, "claim allowance amount");
    if (snapshot.allowance.currencyId !== snapshot.currencyId) {
      throw new Error("claim allowance is bound to another currency id");
    }
  }

  if (action.kind === "mint") {
    if (snapshot.mintAuthority === null || caller.toLowerCase() !== snapshot.mintAuthority.toLowerCase()) {
      throw new Error("claim caller is not the bound mint authority");
    }
    return "mint-authority";
  }

  if (action.amount > snapshot.balance) throw new Error("claim burn exceeds balance");
  if (caller.toLowerCase() === snapshot.owner.toLowerCase()) return "owner";
  if (snapshot.operator !== null && caller.toLowerCase() === snapshot.operator.toLowerCase()) return "operator";
  if (
    snapshot.allowance !== null
    && caller.toLowerCase() === snapshot.allowance.spender.toLowerCase()
    && snapshot.allowance.currencyId === action.currencyId
    && snapshot.allowance.amount >= action.amount
  ) return "per-id-allowance";
  throw new Error("claim caller lacks owner, operator or sufficient per-id allowance authority");
}

function validateClaimAction(action: ClaimAction, label: string): void {
  if (typeof action !== "object" || action === null) throw new Error(`${label} must be an object`);
  if (action.kind !== "mint" && action.kind !== "burn") throw new Error("unsupported claim action");
  assertAddress(action.owner, `${label} owner`);
  assertCurrencyId(action.currencyId, `${label} currency id`);
  assertUint256(action.amount, `${label} amount`);
  if (action.amount === 0n) throw new Error("claim amount must be positive");
}

function assertAddress(value: string, label: string): void {
  if (!ADDRESS_PATTERN.test(value)) throw new Error(`${label} must be a 20-byte address`);
}

function assertNullableAddress(value: string | null, label: string): void {
  if (value !== null) assertAddress(value, label);
}

function assertCurrencyId(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value < 0n || value > MAX_CURRENCY_ID) {
    throw new Error(`${label} must be an unsigned 160-bit currency id`);
  }
}

function assertUint256(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value < 0n || value > MAX_UINT256) {
    throw new Error(`${label} must be an unsigned 256-bit integer`);
  }
}
