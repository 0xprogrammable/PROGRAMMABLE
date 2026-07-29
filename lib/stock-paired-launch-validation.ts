import {
  decodeFunctionData,
  getAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import type { LaunchDraft } from "./launch";
import { buildPlanHash } from "./launch-transaction";
import {
  parsePreparedTransaction,
  type PreparedTransaction,
} from "./prepared-transaction";
import {
  encodeStockPairedLaunch,
  parseStockInitialBuyAmount,
  stockQuoteTokenAbi,
  validateStockPairedLaunchDraft,
} from "./stock-paired";
import {
  getConfiguredStockPairedRelease,
  type VerifiedStockPairedRelease,
} from "./stock-paired-release";

const MIN_APPROVAL_GAS_LIMIT = 25_000n;
const MAX_APPROVAL_GAS_LIMIT = 250_000n;
const MIN_LAUNCH_GAS_LIMIT = 1_500_000n;
const MAX_LAUNCH_GAS_LIMIT = 15_000_000n;

type PreparedLaunch = Extract<PreparedTransaction, { kind: "launch" }>;
type PreparedApproval = Extract<
  PreparedTransaction,
  { kind: "stock-quote-approval" }
>;

type ValidationInput = {
  transaction: unknown;
  draft: LaunchDraft;
  account: string;
  planHash: unknown;
};

function connectedAccount(value: string) {
  try {
    return getAddress(value);
  } catch {
    throw new Error("Connect a valid Ethereum wallet before launching");
  }
}

function validPlanHash(value: unknown): value is Hex {
  return (
    typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66
  );
}

function assertPlanHash(
  account: Address,
  transaction: PreparedLaunch | PreparedApproval,
  received: unknown,
) {
  if (!validPlanHash(received)) {
    throw new Error("The prepared transaction proof is invalid");
  }
  const expected = buildPlanHash(account, {
    kind: transaction.kind,
    chainId: transaction.chainId,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  });
  if (expected.toLowerCase() !== received.toLowerCase()) {
    throw new Error(
      "The prepared transaction does not match the connected wallet",
    );
  }
}

function releaseOrThrow() {
  const release = getConfiguredStockPairedRelease();
  if (!release) {
    throw new Error(
      "Stock-Paired is not enabled by a verified release manifest",
    );
  }
  return release;
}

export function validatePreparedStockQuoteApprovalTransactionAgainstVerifiedRelease(
  input: ValidationInput,
  release: VerifiedStockPairedRelease,
): PreparedApproval {
  const transaction = parsePreparedTransaction(input.transaction);
  if (transaction.kind !== "stock-quote-approval") {
    throw new Error("The prepared transaction is not a quote-token approval");
  }
  const account = connectedAccount(input.account);
  const configuration = validateStockPairedLaunchDraft(input.draft, account);
  const amount = parseStockInitialBuyAmount(input.draft.initialBuyQuoteAmount);
  if (amount === null) {
    throw new Error("The Initial Buy amount is invalid");
  }
  if (
    transaction.chainId !== release.chainId ||
    transaction.to.toLowerCase() !==
      configuration.quoteAsset.address.toLowerCase() ||
    transaction.value !== "0"
  ) {
    throw new Error(
      "The quote-token approval does not match the Stock-Paired release",
    );
  }
  const gasLimit = transaction.gasLimit
    ? BigInt(transaction.gasLimit)
    : 0n;
  if (
    gasLimit < MIN_APPROVAL_GAS_LIMIT ||
    gasLimit > MAX_APPROVAL_GAS_LIMIT
  ) {
    throw new Error("The quote-token approval gas limit is outside the reviewed range");
  }

  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: stockQuoteTokenAbi,
      data: transaction.data,
    });
  } catch {
    throw new Error("The prepared transaction is not a quote-token approval");
  }
  if (
    decoded.functionName !== "approve" ||
    decoded.args[0].toLowerCase() !==
      release.addresses.launcher.toLowerCase() ||
    decoded.args[1] !== amount
  ) {
    throw new Error(
      "The approval must be limited to the exact Initial Buy amount",
    );
  }
  assertPlanHash(account, transaction, input.planHash);
  return transaction;
}

export function validatePreparedStockQuoteApprovalTransaction(
  input: ValidationInput,
): PreparedApproval {
  return validatePreparedStockQuoteApprovalTransactionAgainstVerifiedRelease(
    input,
    releaseOrThrow(),
  );
}

export function validatePreparedStockPairedLaunchTransactionAgainstVerifiedRelease(
  input: ValidationInput,
  release: VerifiedStockPairedRelease,
): PreparedLaunch {
  const transaction = parsePreparedTransaction(input.transaction);
  if (transaction.kind !== "launch") {
    throw new Error("The prepared transaction is not a Stock-Paired launch");
  }
  const account = connectedAccount(input.account);
  validateStockPairedLaunchDraft(input.draft, account);
  if (
    !isHex(input.draft.launchSalt, { strict: true }) ||
    input.draft.launchSalt.length !== 66
  ) {
    throw new Error(
      "Create a fresh launch identifier before opening the wallet",
    );
  }
  if (
    transaction.chainId !== release.chainId ||
    transaction.to.toLowerCase() !==
      release.addresses.launcher.toLowerCase() ||
    transaction.value !== "0"
  ) {
    throw new Error(
      "The launch destination does not match the Stock-Paired release",
    );
  }
  const gasLimit = BigInt(transaction.gasLimit);
  if (
    gasLimit < MIN_LAUNCH_GAS_LIMIT ||
    gasLimit > MAX_LAUNCH_GAS_LIMIT
  ) {
    throw new Error("The launch gas limit is outside the reviewed range");
  }

  const expectedData = encodeStockPairedLaunch(
    input.draft,
    input.draft.launchSalt,
    account,
  );
  if (transaction.data.toLowerCase() !== expectedData.toLowerCase()) {
    throw new Error(
      "The prepared launch does not match the current token setup",
    );
  }
  assertPlanHash(account, transaction, input.planHash);
  return transaction;
}

export function validatePreparedStockPairedLaunchTransaction(
  input: ValidationInput,
): PreparedLaunch {
  return validatePreparedStockPairedLaunchTransactionAgainstVerifiedRelease(
    input,
    releaseOrThrow(),
  );
}
