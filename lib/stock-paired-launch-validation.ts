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
  encodeStockPairedEthLaunch,
  stockPairedEthLaunchCoordinatorAbi,
  validateStockPairedLaunchDraft,
} from "./stock-paired";
import {
  getConfiguredStockPairedLaunchRelease,
  type VerifiedStockPairedRelease,
} from "./stock-paired-release";

const MIN_LAUNCH_GAS_LIMIT = 1_500_000n;
const MAX_LAUNCH_GAS_LIMIT = 15_000_000n;
const MAX_DEADLINE_AHEAD_SECONDS = 3_600n;
const DEADLINE_CLOCK_SKEW_SECONDS = 60n;

type PreparedLaunch = Extract<PreparedTransaction, { kind: "launch" }>;

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
  transaction: PreparedLaunch,
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
  const release = getConfiguredStockPairedLaunchRelease();
  if (!release) {
    throw new Error(
      "Stock-Paired is not enabled by a verified release manifest",
    );
  }
  return release;
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
  const configuration = validateStockPairedLaunchDraft(
    input.draft,
    account,
  );
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
      release.addresses.ethLaunchCoordinator.toLowerCase() ||
    BigInt(transaction.value) !== configuration.initialBuyEthAmount
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

  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: stockPairedEthLaunchCoordinatorAbi,
      data: transaction.data,
    });
  } catch {
    throw new Error("The prepared transaction is not a Stock-Paired launch");
  }
  if (decoded.functionName !== "launch") {
    throw new Error("The prepared transaction is not a Stock-Paired launch");
  }
  const parameters = decoded.args[0];
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (
    parameters.minimumQuoteAmountOut <= 0n ||
    parameters.minimumInitialTokenOut <= 0n ||
    parameters.deadline + DEADLINE_CLOCK_SKEW_SECONDS < now ||
    parameters.deadline > now + MAX_DEADLINE_AHEAD_SECONDS
  ) {
    throw new Error("The Stock-Paired launch protection is invalid");
  }
  const expectedData = encodeStockPairedEthLaunch(
    input.draft,
    input.draft.launchSalt,
    account,
    {
      minimumQuoteAmountOut: parameters.minimumQuoteAmountOut,
      minimumInitialTokenOut: parameters.minimumInitialTokenOut,
      deadline: parameters.deadline,
    },
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
