import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";

import {
  parsePreparedTransaction,
  type PreparedTransaction,
} from "../prepared-transaction";

export const deepV2GrowthVaultProfileAbi = parseAbi([
  "function feeHook() view returns (address)",
  "function poolManager() view returns (address)",
  "function oracleGuard() view returns (address)",
  "function positionManager() view returns (address)",
  "function upstreamVault() view returns (address)",
  "function poolId() view returns (bytes32)",
  "function token() view returns (address)",
  "function growthTargetNative() view returns (uint256)",
  "function tokenReserveTarget() view returns (uint256)",
  "function completionToleranceNative() view returns (uint256)",
  "function minimumNativeLiquidityForCompletion() view returns (uint256)",
  "function beneficiaryCount() view returns (uint256)",
  "function beneficiaryAt(uint256 index) view returns (address)",
  "function creator() view returns (address)",
  "function configurationHash() view returns (bytes32)",
  "function initialized() view returns (bool)",
  "function shareBpsOf(address beneficiary) view returns (uint16)",
  "function payoutAddressOf(address beneficiary) view returns (address)",
  "function claimedBy(address beneficiary) view returns (uint256)",
  "function claimable(address beneficiary) view returns (uint256)",
  "function totalCreatorFeesReceived() view returns (uint256)",
  "function totalNativeAllocatedToGrowth() view returns (uint256)",
  "function totalRewardFeesReceived() view returns (uint256)",
  "function deferredRewardFees() view returns (uint256)",
  "function totalRewardFeesClaimed() view returns (uint256)",
  "function pendingGrowthNative() view returns (uint256)",
  "function totalNativeAddedToLiquidity() view returns (uint256)",
  "function totalTokenAddedToLiquidity() view returns (uint256)",
  "function growthTargetReached() view returns (bool)",
  "function oracleReady() view returns (bool)",
  "function workState() view returns (uint8 action,uint256 hookCreatorFees,uint256 pendingNative,uint256 nextCompoundTimestamp,uint256 trustedNativeDepth,uint256 depthCapNative)",
  "function claimRewards() returns (uint256 amount)",
  "function setPayoutAddress(address newPayoutAddress)",
]);

export const deepV2LaunchProfileAbi = parseAbi([
  "function launchHashOf(address token) view returns (bytes32)",
  "function growthVaultOf(address token) view returns (address)",
]);

export const deepV2GrowthVaultFactoryProfileAbi = parseAbi([
  "function configurationHashOf(address vault) view returns (bytes32)",
  "function isFactoryVault(address vault) view returns (bool)",
]);

export const deepV2FeeHookProfileAbi = parseAbi([
  "function poolFeeConfig(bytes32 poolId) view returns (address rewardVault,address registrar,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bool registered,uint256 creatorFeesAccrued)",
]);

export const deepV2AutomationProfileAbi = parseAbi([
  "function isRegisteredVault(address vault) view returns (bool)",
]);

export const deepV2TokenLaunchedEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeTokenLaunchedV2(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address growthVault,address oracleGuard,address upstreamRewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 vaultConfigurationHash,bytes32 launchHash)",
);

export type DeepV2ProfileRelease = {
  chainId: 1 | 11_155_111;
  releaseVersion: "deep-full-range-v2";
  launcher: Address;
  launcherRuntimeCodeHash: Hex;
  feeHook: Address;
  feeHookRuntimeCodeHash: Hex;
  growthVaultFactory: Address;
  growthVaultFactoryRuntimeCodeHash: Hex;
  growthVaultImplementation: Address;
  growthVaultImplementationRuntimeCodeHash: Hex;
  automation: Address;
  automationRuntimeCodeHash: Hex;
};

export type DeepV2LaunchCandidate = {
  deepReleaseVersion: "deep-full-range-v2";
  launcher: Address;
  creator: Address;
  tokenAddress: Address;
  vaultAddress: Address;
  hookAddress: Address;
  poolId: Hex;
  launchHash: Hex;
  vaultConfigurationHash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const RESPONSE_FIELDS = new Set([
  "status",
  "action",
  "account",
  "vaultAddress",
  "deepReleaseVersion",
  "transaction",
]);

function checkedAddress(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const address = getAddress(value);
  if (address.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`Invalid ${label}`);
  }
  return address;
}

function checkedBytes32(value: unknown, label: string): Hex {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    value.length !== 66
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

export function assertDeepV2LaunchCandidate(
  candidate: DeepV2LaunchCandidate,
  release: DeepV2ProfileRelease,
) {
  if (
    candidate.deepReleaseVersion !== "deep-full-range-v2" ||
    release.releaseVersion !== "deep-full-range-v2"
  ) {
    throw new Error("The launch does not belong to the verified Deep V2 release");
  }
  if (release.chainId !== 1 && release.chainId !== 11_155_111) {
    throw new Error("Invalid Deep V2 release chain");
  }

  const launcher = checkedAddress(candidate.launcher, "Deep V2 launcher");
  const releaseLauncher = checkedAddress(
    release.launcher,
    "Deep V2 release launcher",
  );
  if (!sameAddress(launcher, releaseLauncher)) {
    throw new Error("The Deep V2 launcher does not match the verified release");
  }
  const hook = checkedAddress(candidate.hookAddress, "Deep V2 hook");
  const releaseHook = checkedAddress(release.feeHook, "Deep V2 release hook");
  if (!sameAddress(hook, releaseHook)) {
    throw new Error("The Deep V2 hook does not match the verified release");
  }
  checkedAddress(release.growthVaultFactory, "Deep V2 vault factory");
  checkedBytes32(
    release.launcherRuntimeCodeHash,
    "Deep V2 launcher runtime hash",
  );
  checkedBytes32(
    release.feeHookRuntimeCodeHash,
    "Deep V2 hook runtime hash",
  );
  checkedBytes32(
    release.growthVaultFactoryRuntimeCodeHash,
    "Deep V2 vault factory runtime hash",
  );
  checkedAddress(
    release.growthVaultImplementation,
    "Deep V2 vault implementation",
  );
  checkedBytes32(
    release.growthVaultImplementationRuntimeCodeHash,
    "Deep V2 vault implementation runtime hash",
  );
  checkedAddress(release.automation, "Deep V2 automation");
  checkedBytes32(
    release.automationRuntimeCodeHash,
    "Deep V2 automation runtime hash",
  );
  const creator = checkedAddress(candidate.creator, "Deep V2 creator");
  const token = checkedAddress(candidate.tokenAddress, "Deep V2 token");
  const vault = checkedAddress(candidate.vaultAddress, "Deep V2 vault");
  if (
    sameAddress(creator, token) ||
    sameAddress(creator, vault) ||
    sameAddress(token, vault)
  ) {
    throw new Error("Deep V2 launch identities must be distinct");
  }
  checkedBytes32(candidate.poolId, "Deep V2 PoolId");
  checkedBytes32(candidate.launchHash, "Deep V2 launch hash");
  checkedBytes32(
    candidate.vaultConfigurationHash,
    "Deep V2 vault configuration hash",
  );
  checkedBytes32(candidate.blockHash, "Deep V2 block hash");
  checkedBytes32(candidate.transactionHash, "Deep V2 transaction hash");
  if (candidate.blockNumber <= 0n) {
    throw new Error("Invalid Deep V2 launch block");
  }
  if (
    !Number.isSafeInteger(candidate.logIndex) ||
    candidate.logIndex < 0
  ) {
    throw new Error("Invalid Deep V2 launch log index");
  }
  return {
    ...candidate,
    launcher,
    creator,
    tokenAddress: token,
    vaultAddress: vault,
    hookAddress: hook,
  };
}

export function encodeDeepV2RewardAction(input: {
  action: "claim" | "update-payout";
  newPayoutAddress?: Address;
}): Hex {
  if (input.action === "claim") {
    return encodeFunctionData({
      abi: deepV2GrowthVaultProfileAbi,
      functionName: "claimRewards",
    });
  }
  if (input.action !== "update-payout") {
    throw new Error("Unsupported Deep V2 reward action");
  }
  const payout = checkedAddress(
    input.newPayoutAddress,
    "Deep V2 payout address",
  );
  return encodeFunctionData({
    abi: deepV2GrowthVaultProfileAbi,
    functionName: "setPayoutAddress",
    args: [payout],
  });
}

export function validatePreparedDeepV2RewardAction(
  value: unknown,
  expected: {
    action: "claim" | "update-payout";
    account: string;
    chainId: number;
    candidate: DeepV2LaunchCandidate;
    release: DeepV2ProfileRelease;
    newPayoutAddress?: string;
  },
): {
  action: "claim" | "update-payout";
  account: Address;
  vaultAddress: Address;
  transaction: Extract<
    PreparedTransaction,
    { kind: "claim-deep-rewards" | "update-deep-payout" }
  >;
} {
  const candidate = assertDeepV2LaunchCandidate(
    expected.candidate,
    expected.release,
  );
  if (expected.chainId !== expected.release.chainId) {
    throw new Error("Deep V2 reward chain does not match the release");
  }
  const account = checkedAddress(expected.account, "Deep V2 reward account");
  if (!sameAddress(account, candidate.creator)) {
    throw new Error("Only the Deep V2 creator can prepare this reward action");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Deep V2 reward action");
  }
  const response = value as Record<string, unknown>;
  const unsupported = Object.keys(response).find(
    (field) => !RESPONSE_FIELDS.has(field),
  );
  if (unsupported) {
    throw new Error(
      `Deep V2 reward action contains unsupported field ${unsupported}`,
    );
  }
  if (
    response.status !== "ready" ||
    response.action !== expected.action ||
    response.deepReleaseVersion !== "deep-full-range-v2"
  ) {
    throw new Error("Deep V2 reward action is not ready");
  }
  const responseAccount = checkedAddress(
    response.account,
    "Deep V2 response account",
  );
  const responseVault = checkedAddress(
    response.vaultAddress,
    "Deep V2 response vault",
  );
  if (
    !sameAddress(responseAccount, account) ||
    !sameAddress(responseVault, candidate.vaultAddress)
  ) {
    throw new Error("Deep V2 reward action is not canonical");
  }

  const transaction = parsePreparedTransaction(response.transaction);
  const expectedKind =
    expected.action === "claim"
      ? "claim-deep-rewards"
      : "update-deep-payout";
  if (
    transaction.kind !== expectedKind ||
    transaction.chainId !== expected.chainId ||
    !sameAddress(transaction.from, account) ||
    !sameAddress(transaction.to, candidate.vaultAddress) ||
    transaction.value !== "0"
  ) {
    throw new Error("Deep V2 reward transaction is not canonical");
  }
  const decoded = decodeFunctionData({
    abi: deepV2GrowthVaultProfileAbi,
    data: transaction.data,
  });
  if (expected.action === "claim") {
    if (decoded.functionName !== "claimRewards") {
      throw new Error("Deep V2 reward transaction is not a claim");
    }
  } else {
    const payout = checkedAddress(
      expected.newPayoutAddress,
      "Deep V2 new payout address",
    );
    if (
      decoded.functionName !== "setPayoutAddress" ||
      !sameAddress(decoded.args[0], payout)
    ) {
      throw new Error(
        "Deep V2 payout transaction does not match the new payout address",
      );
    }
  }
  return {
    action: expected.action,
    account,
    vaultAddress: candidate.vaultAddress,
    transaction,
  };
}
