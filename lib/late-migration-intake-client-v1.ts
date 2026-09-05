import { getAddress, type Address, type Hex } from "viem";

import {
  MAIN_TOKEN_ADDRESS,
  MAIN_TOKEN_MIGRATION_CHAIN_ID,
  MAIN_TOKEN_NAME,
  MAIN_TOKEN_PERMIT_VERSION,
} from "@/lib/main-token-migration";

export const LATE_MIGRATION_INTAKE_RESPONSE_SCHEMA_V1 =
  "programmable-late-migration-intake/v1" as const;

export const LATE_MIGRATION_UNTRACKED_DEPOSIT_MESSAGE =
  "An Ethereum deposit already exists for this wallet. Do not sign again. Contact support.";

const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const REQUEST_BINDING = /^sha256:[0-9a-f]{64}$/u;
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/u;

export const LATE_MIGRATION_INTAKE_PROGRESS_STATUSES_V1 = [
  "deposit_submitted",
  "deposit_confirmed",
] as const;

export type LateMigrationIntakeProgressStatusV1 =
  (typeof LATE_MIGRATION_INTAKE_PROGRESS_STATUSES_V1)[number];

export type LateMigrationIntakeExpectationV1 = Readonly<{
  walletAddress: Address;
  offerIndex: number;
  requiredGrossDepositRaw: string;
  targetPayout80Raw: string;
  sourceContractAddress: Address;
}>;

export type LateMigrationIntakePreparationV1 = Readonly<{
  status: "signature_required";
  walletAddress: Address;
  offerIndex: number;
  requiredGrossDepositRaw: string;
  targetPayout80Raw: string;
  permitNonce: string;
  permitDeadline: string;
  requestBindingHash: `sha256:${string}`;
  sourceContractAddress: Address;
}>;

export type LateMigrationIntakeNotStartedV1 = Readonly<{
  status: "not_started";
  walletAddress: Address;
  offerIndex: number;
  requiredGrossDepositRaw: string;
  targetPayout80Raw: string;
}>;

export type LateMigrationIntakeProgressV1 = Readonly<{
  status: LateMigrationIntakeProgressStatusV1;
  walletAddress: Address;
  offerIndex: number;
  requiredGrossDepositRaw: string;
  targetPayout80Raw: string;
  requestBindingHash: `sha256:${string}`;
  depositTransactionHash: Hex;
}>;

export type LateMigrationIntakeFinalizedV1 = Readonly<{
  status: "deposit_finalized";
  walletAddress: Address;
  offerIndex: number;
  requiredGrossDepositRaw: string;
  targetPayout80Raw: string;
  requestBindingHash: `sha256:${string}`;
  depositTransactionHash: Hex;
}>;

export type LateMigrationIntakeSupportRequiredV1 = Readonly<{
  status: "support_required";
  walletAddress: Address;
  offerIndex: number;
  requiredGrossDepositRaw: string;
  targetPayout80Raw: string;
  requestBindingHash: `sha256:${string}`;
  depositTransactionHash: Hex | null;
}>;

export type LateMigrationIntakeStatusV1 =
  | LateMigrationIntakeNotStartedV1
  | LateMigrationIntakeProgressV1
  | LateMigrationIntakeFinalizedV1
  | LateMigrationIntakeSupportRequiredV1;

export type LateMigrationIntakeResponseV1 =
  | LateMigrationIntakePreparationV1
  | LateMigrationIntakeStatusV1;

export function parseLateMigrationIntakeResponseV1(
  input: unknown,
  expected: LateMigrationIntakeExpectationV1,
): LateMigrationIntakeResponseV1 {
  const value = record(input, "Deposit response is invalid.");
  if (value.schema !== LATE_MIGRATION_INTAKE_RESPONSE_SCHEMA_V1) {
    throw new Error("Deposit response schema is invalid.");
  }

  const walletAddress = checksummedAddress(
    value.walletAddress,
    "Deposit response wallet is invalid.",
  );
  if (walletAddress.toLowerCase() !== expected.walletAddress.toLowerCase()) {
    throw new Error("Deposit response belongs to another wallet.");
  }

  if (value.status === "not_started") {
    exactKeys(value, [
      "offerIndex",
      "requiredGrossDepositRaw",
      "schema",
      "status",
      "targetPayout80Raw",
      "walletAddress",
    ]);
    assertExactAllocation(value, expected);
    return Object.freeze({
      status: value.status,
      walletAddress,
      offerIndex: expected.offerIndex,
      requiredGrossDepositRaw: expected.requiredGrossDepositRaw,
      targetPayout80Raw: expected.targetPayout80Raw,
    });
  }

  if (value.status === "signature_required") {
    exactKeys(value, [
      "offerIndex",
      "permitDeadline",
      "permitNonce",
      "requestBindingHash",
      "requiredGrossDepositRaw",
      "schema",
      "status",
      "targetPayout80Raw",
      "typedData",
      "walletAddress",
    ]);
    assertExactAllocation(value, expected);
    const permitNonce = decimal(value.permitNonce, false);
    const permitDeadline = decimal(value.permitDeadline, true);
    const requestBindingHash = requestBinding(value.requestBindingHash);
    assertExactPermitTypedData(value.typedData, expected, {
      permitNonce,
      permitDeadline,
    });
    return Object.freeze({
      status: value.status,
      walletAddress,
      offerIndex: expected.offerIndex,
      requiredGrossDepositRaw: expected.requiredGrossDepositRaw,
      targetPayout80Raw: expected.targetPayout80Raw,
      permitNonce,
      permitDeadline,
      requestBindingHash,
      sourceContractAddress: expected.sourceContractAddress,
    });
  }

  if (!isIntakeStatus(value.status)) {
    throw new Error("Deposit response status is invalid.");
  }
  exactKeys(value, [
    "depositTransactionHash",
    "offerIndex",
    "requestBindingHash",
    "requiredGrossDepositRaw",
    "schema",
    "status",
    "targetPayout80Raw",
    "walletAddress",
  ]);
  assertExactAllocation(value, expected);
  const requestBindingHash = requestBinding(value.requestBindingHash);
  const depositTransactionHash = nullableTransactionHash(
    value.depositTransactionHash,
  );

  if (value.status === "support_required") {
    return Object.freeze({
      status: value.status,
      walletAddress,
      offerIndex: expected.offerIndex,
      requiredGrossDepositRaw: expected.requiredGrossDepositRaw,
      targetPayout80Raw: expected.targetPayout80Raw,
      requestBindingHash,
      depositTransactionHash,
    });
  }
  if (depositTransactionHash === null) {
    throw new Error("Deposit response transaction state is invalid.");
  }
  if (value.status === "deposit_finalized") {
    return Object.freeze({
      status: value.status,
      walletAddress,
      offerIndex: expected.offerIndex,
      requiredGrossDepositRaw: expected.requiredGrossDepositRaw,
      targetPayout80Raw: expected.targetPayout80Raw,
      requestBindingHash,
      depositTransactionHash,
    });
  }
  return Object.freeze({
    status: value.status,
    walletAddress,
    offerIndex: expected.offerIndex,
    requiredGrossDepositRaw: expected.requiredGrossDepositRaw,
    targetPayout80Raw: expected.targetPayout80Raw,
    requestBindingHash,
    depositTransactionHash,
  });
}

export function lateMigrationIntakeFailureMessageV1(
  status: number,
  input: unknown,
): string {
  const code = intakeErrorCode(input);
  if (code === "deposit_already_recorded") {
    return LATE_MIGRATION_UNTRACKED_DEPOSIT_MESSAGE;
  }
  if (status === 401 || status === 403) {
    return "Reconnect this wallet and try again.";
  }
  if (status === 429) {
    return "Too many requests. Wait a minute, then check again.";
  }
  if (status === 409 && code === "permit_expired_resign_required") {
    return "Your previous permit expired safely. Sign a fresh permit to continue.";
  }
  if (status === 409) {
    return "The saved deposit state did not match. Check its status before signing again.";
  }
  if (code === "insufficient_old_token_balance") {
    return "This wallet does not hold its full eligible old V4 amount.";
  }
  if (status === 422 || code === "not_eligible") {
    return "This wallet or signature is not valid for this deposit. Nothing was moved.";
  }
  return "Deposits are temporarily unavailable. Nothing was moved.";
}

export function lateMigrationIntakeProgressCopyV1(
  status: LateMigrationIntakeProgressStatusV1,
): string {
  switch (status) {
    case "deposit_submitted":
      return "Deposit submitted. Waiting for confirmation.";
    case "deposit_confirmed":
      return "Deposit confirmed. Waiting for Ethereum finality.";
  }
}

function assertExactAllocation(
  value: Readonly<Record<string, unknown>>,
  expected: LateMigrationIntakeExpectationV1,
) {
  if (
    value.offerIndex !== expected.offerIndex ||
    value.requiredGrossDepositRaw !== expected.requiredGrossDepositRaw ||
    value.targetPayout80Raw !== expected.targetPayout80Raw
  ) {
    throw new Error("Deposit response allocation does not match this wallet.");
  }
}

function assertExactPermitTypedData(
  input: unknown,
  expected: LateMigrationIntakeExpectationV1,
  permit: Readonly<{ permitNonce: string; permitDeadline: string }>,
) {
  const typedData = record(input, "Deposit permit data is invalid.");
  exactKeys(typedData, ["domain", "message", "primaryType", "types"]);
  if (typedData.primaryType !== "Permit") {
    throw new Error("Deposit permit type is invalid.");
  }

  const domain = record(typedData.domain, "Deposit permit domain is invalid.");
  exactKeys(domain, ["chainId", "name", "verifyingContract", "version"]);
  if (
    domain.chainId !== MAIN_TOKEN_MIGRATION_CHAIN_ID ||
    domain.name !== MAIN_TOKEN_NAME ||
    domain.version !== MAIN_TOKEN_PERMIT_VERSION ||
    checksummedAddress(
      domain.verifyingContract,
      "Deposit permit token is invalid.",
    ) !== MAIN_TOKEN_ADDRESS
  ) {
    throw new Error("Deposit permit domain does not match old V4.");
  }

  const types = record(typedData.types, "Deposit permit fields are invalid.");
  exactKeys(types, ["Permit"]);
  if (!Array.isArray(types.Permit) || types.Permit.length !== 5) {
    throw new Error("Deposit permit fields are invalid.");
  }
  const expectedFields = [
    ["owner", "address"],
    ["spender", "address"],
    ["value", "uint256"],
    ["nonce", "uint256"],
    ["deadline", "uint256"],
  ] as const;
  for (const [index, [name, type]] of expectedFields.entries()) {
    const field = record(
      types.Permit[index],
      "Deposit permit fields are invalid.",
    );
    exactKeys(field, ["name", "type"]);
    if (field.name !== name || field.type !== type) {
      throw new Error("Deposit permit fields are invalid.");
    }
  }

  const message = record(typedData.message, "Deposit permit message is invalid.");
  exactKeys(message, ["deadline", "nonce", "owner", "spender", "value"]);
  if (
    checksummedAddress(message.owner, "Deposit permit owner is invalid.") !==
      expected.walletAddress ||
    checksummedAddress(message.spender, "Deposit permit spender is invalid.") !==
      expected.sourceContractAddress ||
    message.value !== expected.requiredGrossDepositRaw ||
    message.nonce !== permit.permitNonce ||
    message.deadline !== permit.permitDeadline
  ) {
    throw new Error("Deposit permit message does not match this migration.");
  }
}

function isIntakeStatus(
  value: unknown,
): value is LateMigrationIntakeProgressStatusV1 |
  "deposit_finalized" | "support_required" {
  return (
    value === "deposit_finalized" ||
    value === "support_required" ||
    LATE_MIGRATION_INTAKE_PROGRESS_STATUSES_V1.some(
      (candidate) => candidate === value,
    )
  );
}

function nullableTransactionHash(value: unknown): Hex | null {
  if (value === null) return null;
  if (typeof value !== "string" || !TRANSACTION_HASH.test(value)) {
    throw new Error("Deposit response transaction hash is invalid.");
  }
  return value as Hex;
}

function requestBinding(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !REQUEST_BINDING.test(value)) {
    throw new Error("Deposit response request binding is invalid.");
  }
  return value as `sha256:${string}`;
}

function decimal(value: unknown, positive: boolean): string {
  const pattern = positive ? POSITIVE_DECIMAL : DECIMAL;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error("Deposit permit number is invalid.");
  }
  return value;
}

function checksummedAddress(value: unknown, message: string): Address {
  if (typeof value !== "string") throw new Error(message);
  let address: Address;
  try {
    address = getAddress(value);
  } catch {
    throw new Error(message);
  }
  if (address !== value) throw new Error(message);
  return address;
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error("Deposit response fields are invalid.");
  }
}

function intakeErrorCode(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const error = (input as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return null;
  }
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}
