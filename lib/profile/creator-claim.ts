import {
  decodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  isHex,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

import type {
  CreatorClaimPreparationError,
  PreparedCreatorClaim,
} from "@/lib/onchain/types";
import type { PreparedTransaction } from "@/lib/prepared-transaction";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export type CreatorClaimPreparationInput = {
  account: Address;
  poolId: Hex;
  tokenAddress: Address;
  hookAddress: Address;
  chainId: 1 | 11_155_111;
};

export type ValidatedPreparedCreatorClaim = Omit<
  PreparedCreatorClaim,
  "transaction"
> & {
  transaction: Extract<
    PreparedTransaction,
    { kind: "claim-creator-fees" }
  >;
};

const claimCreatorFeesAbi = parseAbi([
  "function claimCreatorFees(bytes32 poolId) returns (uint256 amount)",
]);

export class CreatorClaimClientError extends Error {
  readonly code: string;
  readonly httpStatus?: number;

  constructor(code: string, message: string, httpStatus?: number) {
    super(message);
    this.name = "CreatorClaimClientError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function asRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreatorClaimClientError(
      "invalid-response",
      `Invalid ${label}`,
    );
  }

  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new CreatorClaimClientError(
      "invalid-response",
      `Invalid ${label}`,
    );
  }

  return value;
}

function readAddress(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = readString(record, key, label);
  if (!isAddress(value)) {
    throw new CreatorClaimClientError(
      "invalid-response",
      `Invalid ${label}`,
    );
  }

  return getAddress(value);
}

function readHex(
  record: Record<string, unknown>,
  key: string,
  label: string,
  bytes?: number,
) {
  const value = readString(record, key, label);
  if (
    !isHex(value, { strict: true }) ||
    (bytes && value.length !== bytes * 2 + 2)
  ) {
    throw new CreatorClaimClientError(
      "invalid-response",
      `Invalid ${label}`,
    );
  }

  return value as Hex;
}

function readIntegerString(
  record: Record<string, unknown>,
  key: string,
  label: string,
  allowZero = true,
) {
  const value = readString(record, key, label);
  if (
    !/^(0|[1-9]\d*)$/.test(value) ||
    (!allowZero && BigInt(value) === 0n)
  ) {
    throw new CreatorClaimClientError(
      "invalid-response",
      `Invalid ${label}`,
    );
  }

  return value;
}

function sameAddress(first: string, second: string) {
  return first.toLowerCase() === second.toLowerCase();
}

function sameHex(first: string, second: string) {
  return first.toLowerCase() === second.toLowerCase();
}

function parsePreparationError(
  body: unknown,
  httpStatus: number,
): CreatorClaimClientError {
  try {
    const response = asRecord(body, "claim preparation error");
    if (
      response.status !== "blocked" &&
      response.status !== "not-deployed"
    ) {
      throw new Error("invalid status");
    }
    const error = asRecord(response.error, "claim preparation error");
    const code = readString(error, "code", "claim error code");
    const message = readString(error, "message", "claim error message");
    return new CreatorClaimClientError(code, message, httpStatus);
  } catch {
    return new CreatorClaimClientError(
      "claim-preparation-failed",
      "The creator claim could not be prepared",
      httpStatus,
    );
  }
}

export function validatePreparedCreatorClaim(
  value: unknown,
  expected: CreatorClaimPreparationInput,
): ValidatedPreparedCreatorClaim {
  const response = asRecord(value, "creator claim preparation");
  if (response.status !== "ready") {
    throw new CreatorClaimClientError(
      "invalid-response",
      "Creator claim preparation was not ready",
    );
  }

  const claim = asRecord(response.claim, "prepared claim");
  const account = readAddress(claim, "account", "prepared claim account");
  const poolId = readHex(claim, "poolId", "prepared claim pool id", 32);
  const tokenAddress = readAddress(
    claim,
    "tokenAddress",
    "prepared claim token",
  );
  const hookAddress = readAddress(
    claim,
    "hookAddress",
    "prepared claim hook",
  );
  const snapshotClaimableWei = readIntegerString(
    claim,
    "snapshotClaimableWei",
    "prepared claim amount",
    false,
  );
  const snapshotClaimableEth = readString(
    claim,
    "snapshotClaimableEth",
    "prepared claim ETH amount",
  );

  if (
    !sameAddress(account, expected.account) ||
    !sameHex(poolId, expected.poolId) ||
    !sameAddress(tokenAddress, expected.tokenAddress) ||
    !sameAddress(hookAddress, expected.hookAddress)
  ) {
    throw new CreatorClaimClientError(
      "response-mismatch",
      "Prepared claim does not match the selected creator fee balance",
    );
  }
  if (
    snapshotClaimableEth !==
    formatUnits(BigInt(snapshotClaimableWei), 18)
  ) {
    throw new CreatorClaimClientError(
      "response-mismatch",
      "Prepared claim amount does not match its onchain snapshot",
    );
  }

  const snapshot = asRecord(response.snapshot, "claim snapshot");
  if (
    snapshot.chainId !== expected.chainId ||
    typeof snapshot.chainId !== "number" ||
    !Number.isSafeInteger(snapshot.chainId)
  ) {
    throw new CreatorClaimClientError(
      "response-mismatch",
      "Prepared claim is for a different chain",
    );
  }
  readIntegerString(snapshot, "blockNumber", "claim snapshot block");
  readHex(snapshot, "blockHash", "claim snapshot block hash", 32);
  if (
    typeof snapshot.confirmations !== "number" ||
    !Number.isSafeInteger(snapshot.confirmations) ||
    snapshot.confirmations < 0
  ) {
    throw new CreatorClaimClientError(
      "invalid-response",
      "Invalid claim snapshot confirmations",
    );
  }

  const transaction = asRecord(
    response.transaction,
    "prepared claim transaction",
  );
  if (
    transaction.kind !== "claim-creator-fees" ||
    transaction.chainId !== expected.chainId
  ) {
    throw new CreatorClaimClientError(
      "response-mismatch",
      "Prepared transaction is not the selected creator claim",
    );
  }
  const from = readAddress(
    transaction,
    "from",
    "prepared transaction sender",
  );
  const to = readAddress(transaction, "to", "prepared transaction target");
  const data = readHex(transaction, "data", "prepared transaction data");
  const valueString = readIntegerString(
    transaction,
    "value",
    "prepared transaction value",
  );
  const gasLimit = readIntegerString(
    transaction,
    "gasLimit",
    "prepared transaction gas limit",
    false,
  );
  if (
    !sameAddress(from, expected.account) ||
    !sameAddress(to, hookAddress) ||
    valueString !== "0"
  ) {
    throw new CreatorClaimClientError(
      "response-mismatch",
      "Prepared transaction does not match the canonical creator claim",
    );
  }

  try {
    const decoded = decodeFunctionData({
      abi: claimCreatorFeesAbi,
      data,
    });
    if (
      decoded.functionName !== "claimCreatorFees" ||
      !sameHex(decoded.args[0], expected.poolId)
    ) {
      throw new Error("wrong claim call");
    }
  } catch {
    throw new CreatorClaimClientError(
      "response-mismatch",
      "Prepared transaction is not claimCreatorFees for the selected pool",
    );
  }

  const gas = asRecord(response.gas, "creator claim gas");
  const estimatedGas = readIntegerString(
    gas,
    "estimatedGas",
    "claim gas estimate",
    false,
  );
  const responseGasLimit = readIntegerString(
    gas,
    "gasLimit",
    "claim gas limit",
    false,
  );
  const gasPriceWei = readIntegerString(
    gas,
    "gasPriceWei",
    "claim gas price",
    false,
  );
  const estimatedMaxCostWei = readIntegerString(
    gas,
    "estimatedMaxCostWei",
    "claim maximum gas cost",
  );
  const accountBalanceWei = readIntegerString(
    gas,
    "accountBalanceWei",
    "claim account balance",
  );
  const expectedMaximumCost = BigInt(gasLimit) * BigInt(gasPriceWei);
  const expectedBalanceSufficient =
    BigInt(accountBalanceWei) >= expectedMaximumCost;
  if (
    responseGasLimit !== gasLimit ||
    BigInt(gasLimit) < BigInt(estimatedGas) ||
    BigInt(estimatedMaxCostWei) !== expectedMaximumCost ||
    gas.balanceSufficient !== expectedBalanceSufficient
  ) {
    throw new CreatorClaimClientError(
      "response-mismatch",
      "Prepared claim gas data is inconsistent",
    );
  }

  const submission = asRecord(
    response.submission,
    "claim submission state",
  );
  if (
    submission.status !== "not-submitted" ||
    submission.transactionHash !== null ||
    submission.receipt !== null
  ) {
    throw new CreatorClaimClientError(
      "response-mismatch",
      "Claim preparation cannot report a submitted transaction",
    );
  }

  return value as ValidatedPreparedCreatorClaim;
}

export async function prepareCreatorClaim(
  input: CreatorClaimPreparationInput,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
) {
  const response = await fetcher("/api/explore/profile/claim", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      account: input.account,
      poolId: input.poolId,
      chainId: input.chainId,
    }),
    signal,
  });
  let body: PreparedCreatorClaim | CreatorClaimPreparationError | unknown;
  try {
    body = (await response.json()) as
      | PreparedCreatorClaim
      | CreatorClaimPreparationError
      | unknown;
  } catch {
    throw new CreatorClaimClientError(
      "invalid-response",
      "The creator claim endpoint returned an invalid response",
      response.status,
    );
  }

  if (!response.ok) {
    throw parsePreparationError(body, response.status);
  }

  return validatePreparedCreatorClaim(body, input);
}
