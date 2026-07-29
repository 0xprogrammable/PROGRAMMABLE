import {
  decodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import {
  DEEP_V3_FIXED_POLICY,
  deepV3LaunchAbi,
  encodeDeepV3Launch,
} from "./deep-v3";
import { getConfiguredDeepV3Release } from "./deep-v3-release";
import { parseInitialBuyWei, type LaunchDraft } from "./launch";
import { buildPlanHash } from "./launch-transaction";
import {
  parsePreparedTransaction,
  type PreparedTransaction,
} from "./prepared-transaction";

export const MIN_DEEP_V3_LAUNCH_GAS_LIMIT = 5_000_000n;
export const MAX_DEEP_V3_LAUNCH_GAS_LIMIT = 20_000_000n;
const MAX_DEADLINE_LEAD_SECONDS = 1_800n;

export type VerifiedDeepV3LaunchRelease = {
  chainId: 1;
  launcher: Address;
};

type PreparedDeepV3LaunchInput = {
  transaction: unknown;
  draft: LaunchDraft;
  account: string;
  planHash: unknown;
};

type PreparedDeepV3LaunchTransaction = Extract<
  PreparedTransaction,
  { kind: "launch" }
>;

function readLaunchParameters(data: Hex) {
  try {
    const decoded = decodeFunctionData({
      abi: deepV3LaunchAbi,
      data,
    });
    if (decoded.functionName !== "launch") throw new Error("selector");
    return decoded.args[0];
  } catch {
    throw new Error(
      "The prepared transaction does not call the Deep launch function",
    );
  }
}

function connectedAccount(value: string) {
  try {
    return getAddress(value);
  } catch {
    throw new Error("Connect a valid Ethereum wallet before launching");
  }
}

export async function validatePreparedDeepV3LaunchTransactionAgainstVerifiedRelease(
  input: PreparedDeepV3LaunchInput,
  release: VerifiedDeepV3LaunchRelease,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<PreparedDeepV3LaunchTransaction> {
  const transaction = parsePreparedTransaction(input.transaction);
  if (transaction.kind !== "launch") {
    throw new Error("The prepared transaction is not a Deep launch");
  }
  if (
    release.chainId !== 1 ||
    !isAddress(release.launcher) ||
    transaction.chainId !== release.chainId
  ) {
    throw new Error(
      "The prepared launch network does not match the verified Deep release",
    );
  }
  if (
    transaction.to.toLowerCase() !==
    getAddress(release.launcher).toLowerCase()
  ) {
    throw new Error(
      "The prepared launch destination does not match the verified Deep release",
    );
  }

  const initialBuy = parseInitialBuyWei(input.draft.initialBuyEth);
  if (initialBuy === null || transaction.value !== initialBuy.toString()) {
    throw new Error(
      "The prepared Initial Buy does not match the current token setup",
    );
  }
  const gasLimit = BigInt(transaction.gasLimit);
  if (
    gasLimit < MIN_DEEP_V3_LAUNCH_GAS_LIMIT ||
    gasLimit > MAX_DEEP_V3_LAUNCH_GAS_LIMIT
  ) {
    throw new Error(
      "The prepared launch gas limit is outside the reviewed range",
    );
  }
  if (
    !isHex(input.draft.launchSalt, { strict: true }) ||
    input.draft.launchSalt.length !== 66
  ) {
    throw new Error(
      "Create a fresh launch identifier before opening the wallet",
    );
  }

  const account = connectedAccount(input.account);
  const parameters = readLaunchParameters(transaction.data);
  const now = BigInt(nowSeconds);
  if (
    parameters.deadline <= now ||
    parameters.deadline > now + MAX_DEADLINE_LEAD_SECONDS
  ) {
    throw new Error("The prepared Deep launch deadline is invalid");
  }
  if (
    parameters.initialBuySqrtPriceLimitX96 !==
    DEEP_V3_FIXED_POLICY.minimumInitialBuySqrtPriceLimitX96
  ) {
    throw new Error(
      "The prepared Deep launch price protection is invalid",
    );
  }

  const { quoteDeepV3InitialBuy } = await import("./deep-v3-quote");
  const quote = await quoteDeepV3InitialBuy(initialBuy);
  if (
    parameters.minimumInitialTokenOut !==
    quote.minimumInitialTokenOut
  ) {
    throw new Error(
      "The prepared Deep launch output protection is invalid",
    );
  }
  const expectedData = encodeDeepV3Launch(
    input.draft,
    input.draft.launchSalt,
    account,
    {
      minimumInitialTokenOut: quote.minimumInitialTokenOut,
      initialBuySqrtPriceLimitX96:
        quote.initialBuySqrtPriceLimitX96,
      deadline: parameters.deadline,
    },
  );
  if (transaction.data.toLowerCase() !== expectedData.toLowerCase()) {
    throw new Error(
      "The prepared launch does not match the current Deep setup",
    );
  }

  if (
    typeof input.planHash !== "string" ||
    !isHex(input.planHash, { strict: true }) ||
    input.planHash.length !== 66
  ) {
    throw new Error("The prepared launch proof is invalid");
  }
  const expectedPlanHash = buildPlanHash(account, {
    kind: "launch",
    chainId: transaction.chainId,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  });
  if (expectedPlanHash.toLowerCase() !== input.planHash.toLowerCase()) {
    throw new Error(
      "The prepared launch does not match the connected wallet",
    );
  }

  return transaction;
}

export async function validatePreparedDeepV3LaunchTransaction(
  input: PreparedDeepV3LaunchInput,
) {
  const environment =
    process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
      ? "rehearsal"
      : "production";
  const release = getConfiguredDeepV3Release(environment);
  const launcher = release?.addresses?.launcher;
  if (
    !release ||
    release.chainId !== 1 ||
    typeof launcher !== "string" ||
    !isAddress(launcher)
  ) {
    throw new Error(
      "Deep is not enabled by the verified release manifest",
    );
  }
  return validatePreparedDeepV3LaunchTransactionAgainstVerifiedRelease(
    input,
    {
      chainId: 1,
      launcher: getAddress(launcher),
    },
  );
}
