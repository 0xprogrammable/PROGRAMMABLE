import {
  decodeEventLog,
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import {
  DEEP_V3_RELEASE_VERSION,
  deepV3TokenLaunchedEvent,
} from "./deep-v3";
import type { DeepV3LaunchProvenance } from "./onchain/deep-v3-read-model";

export type DeepV3LaunchReceipt = {
  status: "success" | "reverted";
  from: Address;
  to: Address | null;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logs: readonly {
    address: Address;
    topics: readonly Hex[];
    data: Hex;
    logIndex: number;
  }[];
};

export type DeepV3LaunchConfirmationRelease = {
  startBlock: number;
  launcher: Address;
  feeHook: Address;
};

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function validHash(value: unknown): value is Hex {
  return (
    typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66
  );
}

function canonicalReceipt(
  receipt: DeepV3LaunchReceipt,
  release: DeepV3LaunchConfirmationRelease,
  transactionHash: Hex,
) {
  if (
    receipt.status !== "success" ||
    !receipt.to ||
    !sameHex(receipt.to, release.launcher) ||
    !sameHex(receipt.transactionHash, transactionHash) ||
    receipt.blockNumber < BigInt(release.startBlock) ||
    !validHash(receipt.blockHash) ||
    !Number.isSafeInteger(receipt.transactionIndex) ||
    receipt.transactionIndex < 0
  ) {
    throw new Error("The Deep V3 launch receipt is invalid");
  }

  const launchLogs = receipt.logs.flatMap((log) => {
    if (!sameHex(log.address, release.launcher)) return [];
    try {
      const decoded = decodeEventLog({
        abi: [deepV3TokenLaunchedEvent],
        eventName: "LiquidityGrowthFullRangeTokenLaunchedV3",
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
        strict: true,
      });
      return [{ log, args: decoded.args }];
    } catch {
      return [];
    }
  });
  if (launchLogs.length !== 1) {
    throw new Error(
      "The transaction does not contain one canonical Deep V3 launch",
    );
  }
  const [{ log, args }] = launchLogs;
  if (
    !sameHex(args.feeHook, release.feeHook) ||
    !Number.isSafeInteger(log.logIndex) ||
    log.logIndex < 0
  ) {
    throw new Error("The Deep V3 launch event is invalid");
  }

  return {
    creator: getAddress(args.deployer),
    tokenAddress: getAddress(args.token),
    vaultAddress: getAddress(args.growthVault),
    hookAddress: getAddress(args.feeHook),
    positionRecipient: getAddress(args.positionRecipient),
    positionTokenId: args.positionTokenId,
    poolId: args.poolId,
    launchHash: args.launchHash,
    vaultConfigurationHash: args.vaultConfigurationHash,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    transactionHash: receipt.transactionHash,
    transactionIndex: receipt.transactionIndex,
    logIndex: log.logIndex,
    from: getAddress(receipt.from),
  };
}

function sameLaunch(
  left: ReturnType<typeof canonicalReceipt>,
  right: ReturnType<typeof canonicalReceipt>,
) {
  return (
    left.creator === right.creator &&
    left.tokenAddress === right.tokenAddress &&
    left.vaultAddress === right.vaultAddress &&
    left.hookAddress === right.hookAddress &&
    left.positionRecipient === right.positionRecipient &&
    left.positionTokenId === right.positionTokenId &&
    sameHex(left.poolId, right.poolId) &&
    sameHex(left.launchHash, right.launchHash) &&
    sameHex(
      left.vaultConfigurationHash,
      right.vaultConfigurationHash,
    ) &&
    left.blockNumber === right.blockNumber &&
    sameHex(left.blockHash, right.blockHash) &&
    sameHex(left.transactionHash, right.transactionHash) &&
    left.transactionIndex === right.transactionIndex &&
    left.logIndex === right.logIndex &&
    left.from === right.from
  );
}

export function parseDeepV3LaunchReceipts(input: {
  receipts: readonly DeepV3LaunchReceipt[];
  release: DeepV3LaunchConfirmationRelease;
  account: Address;
  transactionHash: Hex;
}): DeepV3LaunchProvenance {
  if (
    input.receipts.length !== 2 ||
    !Number.isSafeInteger(input.release.startBlock) ||
    input.release.startBlock <= 0 ||
    !isAddress(input.release.launcher) ||
    !isAddress(input.release.feeHook) ||
    !isAddress(input.account) ||
    !validHash(input.transactionHash)
  ) {
    throw new Error("Deep V3 launch confirmation is invalid");
  }

  const launches = input.receipts.map((receipt) =>
    canonicalReceipt(receipt, input.release, input.transactionHash),
  );
  if (!sameLaunch(launches[0], launches[1])) {
    throw new Error(
      "Independent RPCs disagree on the Deep V3 launch receipt",
    );
  }
  const launch = launches[0];
  if (
    launch.creator !== getAddress(input.account) ||
    launch.from !== getAddress(input.account)
  ) {
    throw new Error(
      "The confirmed Deep V3 launch does not belong to this wallet",
    );
  }

  return {
    deepReleaseVersion: DEEP_V3_RELEASE_VERSION,
    launchModel: "deep",
    launcher: getAddress(input.release.launcher),
    creator: launch.creator,
    tokenAddress: launch.tokenAddress,
    vaultAddress: launch.vaultAddress,
    hookAddress: launch.hookAddress,
    positionRecipient: launch.positionRecipient,
    positionTokenId: launch.positionTokenId.toString(),
    poolId: launch.poolId,
    launchHash: launch.launchHash,
    vaultConfigurationHash: launch.vaultConfigurationHash,
    blockNumber: launch.blockNumber.toString(),
    blockHash: launch.blockHash,
    transactionHash: launch.transactionHash,
    transactionIndex: launch.transactionIndex,
    logIndex: launch.logIndex,
  };
}
