import {
  decodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import {
  classicV3LaunchAbi,
  encodeClassicV3Launch,
  type ClassicV3DeploymentManifest,
} from "./classic-v3";
import {
  getConfiguredClassicV3Release,
  isClassicV3ReleaseVerified,
  type ClassicV3ReleaseManifest,
} from "./classic-v3-release";
import { parseInitialBuyWei, type LaunchDraft } from "./launch";
import { buildPlanHash } from "./launch-transaction";
import {
  parsePreparedTransaction,
  type PreparedTransaction,
} from "./prepared-transaction";

export const MIN_CLASSIC_V3_LAUNCH_GAS_LIMIT = 1_500_000n;
export const MAX_CLASSIC_V3_LAUNCH_GAS_LIMIT = 13_500_000n;

type PreparedClassicV3LaunchInput = {
  transaction: unknown;
  draft: LaunchDraft;
  account: string;
  planHash: unknown;
};

type PreparedClassicV3LaunchTransaction = Extract<
  PreparedTransaction,
  { kind: "launch" }
>;

function connectedAccount(value: string) {
  try {
    return getAddress(value);
  } catch {
    throw new Error("Connect a valid Ethereum wallet before launching");
  }
}

function readParameters(data: Hex) {
  try {
    const decoded = decodeFunctionData({
      abi: classicV3LaunchAbi,
      data,
    });
    if (decoded.functionName !== "launch") throw new Error("selector");
    return decoded.args[0];
  } catch {
    throw new Error(
      "The prepared transaction does not call the Classic launch function",
    );
  }
}

function parametersMatch(
  received: ReturnType<typeof readParameters>,
  expected: ReturnType<typeof readParameters>,
) {
  return (
    received.name === expected.name &&
    received.symbol === expected.symbol &&
    received.buySwapFeeBps === expected.buySwapFeeBps &&
    received.sellSwapFeeBps === expected.sellSwapFeeBps &&
    received.creatorSalt.toLowerCase() === expected.creatorSalt.toLowerCase() &&
    received.metadata.description === expected.metadata.description &&
    received.metadata.website === expected.metadata.website &&
    received.metadata.image === expected.metadata.image &&
    received.metadata.extraData.toLowerCase() ===
      expected.metadata.extraData.toLowerCase() &&
    received.rewardBeneficiaries.length ===
      expected.rewardBeneficiaries.length &&
    received.rewardBeneficiaries.every(
      (beneficiary, index) =>
        beneficiary.toLowerCase() ===
        expected.rewardBeneficiaries[index].toLowerCase(),
    ) &&
    received.rewardSharesBps.length === expected.rewardSharesBps.length &&
    received.rewardSharesBps.every(
      (share, index) => share === expected.rewardSharesBps[index],
    ) &&
    received.initialBuyCustody.mode === expected.initialBuyCustody.mode &&
    received.initialBuyCustody.durationDays ===
      expected.initialBuyCustody.durationDays &&
    received.initialBuyCustody.cliffDays ===
      expected.initialBuyCustody.cliffDays
  );
}

export function validatePreparedClassicV3LaunchTransactionAgainstManifest(
  input: PreparedClassicV3LaunchInput,
  manifest: ClassicV3DeploymentManifest,
  releaseManifest: ClassicV3ReleaseManifest,
): PreparedClassicV3LaunchTransaction {
  const transaction = parsePreparedTransaction(input.transaction);
  if (transaction.kind !== "launch") {
    throw new Error("The prepared transaction is not a Classic launch");
  }
  if (
    !isClassicV3ReleaseVerified(
      manifest,
      releaseManifest,
      manifest.chainId,
    ) ||
    !manifest.memeLaunchV2 ||
    !isAddress(manifest.memeLaunchV2)
  ) {
    throw new Error(
      "Classic is not enabled by the release manifest",
    );
  }
  if (transaction.chainId !== manifest.chainId) {
    throw new Error(
      "The prepared launch network does not match the release manifest",
    );
  }
  const expectedLauncher = getAddress(manifest.memeLaunchV2);
  if (transaction.to.toLowerCase() !== expectedLauncher.toLowerCase()) {
    throw new Error(
      "The prepared launch destination does not match the release manifest",
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
    gasLimit < MIN_CLASSIC_V3_LAUNCH_GAS_LIMIT ||
    gasLimit > MAX_CLASSIC_V3_LAUNCH_GAS_LIMIT
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

  const account: Address = connectedAccount(input.account);
  const expectedData = encodeClassicV3Launch(
    input.draft,
    input.draft.launchSalt,
    account,
  );
  const receivedParameters = readParameters(transaction.data);
  const expectedParameters = readParameters(expectedData);
  if (
    !parametersMatch(receivedParameters, expectedParameters) ||
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

export function validatePreparedClassicV3LaunchTransaction(
  input: PreparedClassicV3LaunchInput,
) {
  const environment =
    process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
      ? "rehearsal"
      : "production";
  const configured = getConfiguredClassicV3Release(environment);
  return validatePreparedClassicV3LaunchTransactionAgainstManifest(
    input,
    configured.appManifest,
    configured.releaseManifest,
  );
}
