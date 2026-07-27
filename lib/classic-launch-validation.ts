import {
  decodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import appDeployments from "../contracts/config/app-deployments.v1.json";
import {
  parseInitialBuyWei,
  type LaunchDraft,
} from "./launch";
import {
  isClassicDeploymentReady,
  type ClassicProductionDeploymentStatus,
} from "./launch-deployment";
import {
  buildPlanHash,
  encodeMemeLaunch,
  memeLaunchAbi,
} from "./launch-transaction";
import {
  parsePreparedTransaction,
  type PreparedTransaction,
} from "./prepared-transaction";

export const MIN_CLASSIC_LAUNCH_GAS_LIMIT = 1_500_000n;
// The contract boundary fixture uses about 9.3m gas at every metadata cap.
// This ceiling includes the server's 20% estimation buffer without allowing a
// prepared launch to consume an arbitrary share of the mainnet block.
export const MAX_CLASSIC_LAUNCH_GAS_LIMIT = 12_000_000n;

export type ClassicLaunchManifest =
  ClassicProductionDeploymentStatus & {
    memeLaunch: string | null;
  };

type PreparedClassicLaunchInput = {
  transaction: unknown;
  draft: LaunchDraft;
  account: string;
  planHash: unknown;
};

type PreparedClassicLaunchTransaction = Extract<
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

function readLaunchParameters(data: Hex) {
  try {
    const decoded = decodeFunctionData({
      abi: memeLaunchAbi,
      data,
    });
    if (decoded.functionName !== "launch") {
      throw new Error("selector");
    }
    return decoded.args[0];
  } catch {
    throw new Error(
      "The prepared transaction does not call the Classic launch function",
    );
  }
}

function launchParametersMatch(
  received: ReturnType<typeof readLaunchParameters>,
  expected: ReturnType<typeof readLaunchParameters>,
) {
  return (
    received.name === expected.name &&
    received.symbol === expected.symbol &&
    received.totalSwapFeeBps === expected.totalSwapFeeBps &&
    received.creatorSalt.toLowerCase() ===
      expected.creatorSalt.toLowerCase() &&
    received.metadata.description === expected.metadata.description &&
    received.metadata.website === expected.metadata.website &&
    received.metadata.image === expected.metadata.image &&
    received.metadata.extraData.toLowerCase() ===
      expected.metadata.extraData.toLowerCase()
  );
}

export function validatePreparedClassicLaunchTransactionAgainstManifest(
  input: PreparedClassicLaunchInput,
  manifest: ClassicLaunchManifest,
): PreparedClassicLaunchTransaction {
  const transaction = parsePreparedTransaction(input.transaction);
  if (transaction.kind !== "launch") {
    throw new Error("The prepared transaction is not a Classic launch");
  }

  if (
    !isClassicDeploymentReady(manifest, manifest.chainId) ||
    !manifest.memeLaunch ||
    !isAddress(manifest.memeLaunch)
  ) {
    throw new Error(
      "Classic is not enabled by the production release manifest",
    );
  }
  if (transaction.chainId !== manifest.chainId) {
    throw new Error(
      "The prepared launch network does not match the release manifest",
    );
  }
  const expectedLauncher = getAddress(manifest.memeLaunch);
  if (
    transaction.to.toLowerCase() !== expectedLauncher.toLowerCase()
  ) {
    throw new Error(
      "The prepared launch destination does not match the release manifest",
    );
  }
  const expectedInitialBuy = parseInitialBuyWei(input.draft.initialBuyEth);
  if (
    expectedInitialBuy === null ||
    transaction.value !== expectedInitialBuy.toString()
  ) {
    throw new Error(
      "The prepared Dev Buy does not match the current token setup",
    );
  }

  const gasLimit = BigInt(transaction.gasLimit);
  if (
    gasLimit < MIN_CLASSIC_LAUNCH_GAS_LIMIT ||
    gasLimit > MAX_CLASSIC_LAUNCH_GAS_LIMIT
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
  const expectedData = encodeMemeLaunch(
    input.draft,
    input.draft.launchSalt,
  );
  const receivedParameters = readLaunchParameters(transaction.data);
  const expectedParameters = readLaunchParameters(expectedData);
  if (
    !launchParametersMatch(receivedParameters, expectedParameters) ||
    transaction.data.toLowerCase() !== expectedData.toLowerCase()
  ) {
    throw new Error(
      "The prepared launch does not match the current token setup",
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

export function validatePreparedClassicLaunchTransaction(
  input: PreparedClassicLaunchInput,
) {
  const environment =
    process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
      ? "rehearsal"
      : "production";
  return validatePreparedClassicLaunchTransactionAgainstManifest(
    input,
    appDeployments[environment] as ClassicLaunchManifest,
  );
}
