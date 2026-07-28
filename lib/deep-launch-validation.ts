import {
  decodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  type Address,
} from "viem";

import appDeployments from "../contracts/config/app-deployments.v1.json";
import { deepLaunchAbi, encodeDeepLaunch } from "./deep-v1";
import {
  isFutureLaunchModelManifestEligible,
  type LaunchModelReleaseManifest,
} from "./launch-model-gating";
import { parseInitialBuyWei, type LaunchDraft } from "./launch";
import { buildPlanHash } from "./launch-transaction";
import {
  parsePreparedTransaction,
  type PreparedTransaction,
} from "./prepared-transaction";

export const MIN_DEEP_LAUNCH_GAS_LIMIT = 6_000_000n;
export const MAX_DEEP_LAUNCH_GAS_LIMIT = 16_000_000n;

type PreparedDeepLaunchInput = {
  transaction: unknown;
  draft: LaunchDraft;
  account: string;
  planHash: unknown;
};

type PreparedDeepLaunchTransaction = Extract<
  PreparedTransaction,
  { kind: "launch" }
>;

export function validatePreparedDeepLaunchTransactionAgainstManifest(
  input: PreparedDeepLaunchInput,
  manifest: LaunchModelReleaseManifest,
  expectedChainId: number,
): PreparedDeepLaunchTransaction {
  const transaction = parsePreparedTransaction(input.transaction);
  const release = manifest.launchModelReleases?.deep;
  if (transaction.kind !== "launch") {
    throw new Error("The prepared transaction is not a Deep launch");
  }
  if (
    !isFutureLaunchModelManifestEligible(
      "deep",
      manifest,
      expectedChainId,
    ) ||
    typeof release?.launcher !== "string" ||
    !isAddress(release.launcher)
  ) {
    throw new Error("Deep is not enabled by the verified release manifest");
  }
  if (transaction.chainId !== expectedChainId) {
    throw new Error(
      "The prepared launch network does not match the release manifest",
    );
  }
  if (
    transaction.to.toLowerCase() !==
    getAddress(release.launcher).toLowerCase()
  ) {
    throw new Error(
      "The prepared launch destination does not match the release manifest",
    );
  }

  const initialBuy = parseInitialBuyWei(input.draft.initialBuyEth);
  if (initialBuy === null || transaction.value !== initialBuy.toString()) {
    throw new Error(
      "The prepared Dev Buy does not match the current token setup",
    );
  }
  const gasLimit = BigInt(transaction.gasLimit);
  if (
    gasLimit < MIN_DEEP_LAUNCH_GAS_LIMIT ||
    gasLimit > MAX_DEEP_LAUNCH_GAS_LIMIT
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
  if (!isAddress(input.account)) {
    throw new Error("Connect a valid Ethereum wallet before launching");
  }

  const account: Address = getAddress(input.account);
  const expectedData = encodeDeepLaunch(
    input.draft,
    input.draft.launchSalt,
    account,
  );
  try {
    const decoded = decodeFunctionData({
      abi: deepLaunchAbi,
      data: transaction.data,
    });
    if (
      decoded.functionName !== "launch" ||
      transaction.data.toLowerCase() !== expectedData.toLowerCase()
    ) {
      throw new Error("mismatch");
    }
  } catch {
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

export function validatePreparedDeepLaunchTransaction(
  input: PreparedDeepLaunchInput,
) {
  const environment =
    process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
      ? "rehearsal"
      : "production";
  const expectedChainId = environment === "rehearsal" ? 11_155_111 : 1;
  return validatePreparedDeepLaunchTransactionAgainstManifest(
    input,
    appDeployments[
      environment
    ] as unknown as LaunchModelReleaseManifest,
    expectedChainId,
  );
}
