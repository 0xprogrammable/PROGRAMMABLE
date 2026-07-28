import {
  decodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  type Address,
} from "viem";

import appDeployments from "../contracts/config/app-deployments.v1.json";
import {
  parseOptionalInitialBuyWei,
  type LaunchDraft,
} from "./launch";
import {
  adaptiveCurveLaunchAbi,
  buildPlanHash,
  encodeAdaptiveLaunch,
} from "./launch-transaction";
import {
  parsePreparedTransaction,
  type PreparedTransaction,
} from "./prepared-transaction";

export const MIN_ADAPTIVE_LAUNCH_GAS_LIMIT = 4_000_000n;
export const MAX_ADAPTIVE_LAUNCH_GAS_LIMIT = 16_000_000n;

export type AdaptiveLaunchManifest = {
  chainId: number;
  adaptiveLaunchStatus: string;
  adaptiveCurveFeeHookFactory?: string | null;
  adaptiveCurveLaunch: string | null;
  lockedPositionFeeForwarderFactory?: string | null;
  runtimeCodeHashes?: {
    adaptiveCurveFeeHookFactory?: string | null;
    adaptiveCurveLaunch?: string | null;
    lockedPositionFeeForwarderFactory?: string | null;
  };
};

type PreparedAdaptiveLaunchInput = {
  transaction: unknown;
  draft: LaunchDraft;
  account: string;
  planHash: unknown;
};

type PreparedAdaptiveLaunchTransaction = Extract<
  PreparedTransaction,
  { kind: "launch" }
>;

function readConnectedAccount(value: string) {
  try {
    return getAddress(value);
  } catch {
    throw new Error("Connect a valid Ethereum wallet before launching");
  }
}

function validAddress(value: string | null | undefined) {
  return Boolean(value && isAddress(value));
}

function validHash(value: string | null | undefined) {
  return Boolean(value && isHex(value, { strict: true }) && value.length === 66);
}

export function isAdaptiveDeploymentReady(
  manifest: AdaptiveLaunchManifest,
  expectedChainId: number,
) {
  return (
    manifest.chainId === expectedChainId &&
    manifest.adaptiveLaunchStatus === "ready" &&
    validAddress(manifest.adaptiveCurveFeeHookFactory) &&
    validAddress(manifest.adaptiveCurveLaunch) &&
    validAddress(manifest.lockedPositionFeeForwarderFactory) &&
    validHash(manifest.runtimeCodeHashes?.adaptiveCurveFeeHookFactory) &&
    validHash(manifest.runtimeCodeHashes?.adaptiveCurveLaunch) &&
    validHash(manifest.runtimeCodeHashes?.lockedPositionFeeForwarderFactory)
  );
}

export function validatePreparedAdaptiveLaunchTransactionAgainstManifest(
  input: PreparedAdaptiveLaunchInput,
  manifest: AdaptiveLaunchManifest,
): PreparedAdaptiveLaunchTransaction {
  const transaction = parsePreparedTransaction(input.transaction);
  if (transaction.kind !== "launch") {
    throw new Error("The prepared transaction is not an Adaptive launch");
  }
  if (
    !isAdaptiveDeploymentReady(manifest, manifest.chainId) ||
    !manifest.adaptiveCurveLaunch ||
    !isAddress(manifest.adaptiveCurveLaunch)
  ) {
    throw new Error(
      "Adaptive is not enabled by the production release manifest",
    );
  }
  if (transaction.chainId !== manifest.chainId) {
    throw new Error(
      "The prepared launch network does not match the release manifest",
    );
  }
  const expectedLauncher = getAddress(manifest.adaptiveCurveLaunch);
  if (transaction.to.toLowerCase() !== expectedLauncher.toLowerCase()) {
    throw new Error(
      "The prepared launch destination does not match the release manifest",
    );
  }

  const initialBuy = parseOptionalInitialBuyWei(input.draft.initialBuyEth);
  if (initialBuy === null || transaction.value !== initialBuy.toString()) {
    throw new Error(
      "The prepared Dev Buy does not match the current token setup",
    );
  }
  const gasLimit = BigInt(transaction.gasLimit);
  if (
    gasLimit < MIN_ADAPTIVE_LAUNCH_GAS_LIMIT ||
    gasLimit > MAX_ADAPTIVE_LAUNCH_GAS_LIMIT
  ) {
    throw new Error(
      "The prepared launch gas limit is outside the reviewed range",
    );
  }
  if (
    !isHex(input.draft.launchSalt, { strict: true }) ||
    input.draft.launchSalt.length !== 66 ||
    !isHex(input.draft.hookSaltNonce, { strict: true }) ||
    input.draft.hookSaltNonce.length !== 66
  ) {
    throw new Error(
      "Prepare fresh deterministic launch addresses before opening the wallet",
    );
  }

  const expectedData = encodeAdaptiveLaunch(
    input.draft,
    input.draft.launchSalt,
  );
  try {
    const decoded = decodeFunctionData({
      abi: adaptiveCurveLaunchAbi,
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
      "The prepared launch does not match the current Adaptive setup",
    );
  }

  if (
    typeof input.planHash !== "string" ||
    !isHex(input.planHash, { strict: true }) ||
    input.planHash.length !== 66
  ) {
    throw new Error("The prepared launch proof is invalid");
  }
  const account: Address = readConnectedAccount(input.account);
  const expectedPlanHash = buildPlanHash(account, {
    kind: "launch",
    chainId: manifest.chainId,
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

export function validatePreparedAdaptiveLaunchTransaction(
  input: PreparedAdaptiveLaunchInput,
) {
  const environment =
    process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
      ? "rehearsal"
      : "production";
  return validatePreparedAdaptiveLaunchTransactionAgainstManifest(
    input,
    appDeployments[environment] as AdaptiveLaunchManifest,
  );
}
