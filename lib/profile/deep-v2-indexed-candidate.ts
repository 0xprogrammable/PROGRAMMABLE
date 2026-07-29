import {
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import type { LauncherToken } from "../tokens";
import type { DeepV2LaunchCandidate } from "./deep-v2-rewards";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PROVENANCE_FIELDS = new Set([
  "deepReleaseVersion",
  "launcher",
  "creator",
  "tokenAddress",
  "vaultAddress",
  "hookAddress",
  "poolId",
  "launchHash",
  "vaultConfigurationHash",
  "blockNumber",
  "blockHash",
  "transactionHash",
  "logIndex",
]);

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The token has no verified Deep V2 provenance");
  }
  const result = value as Record<string, unknown>;
  const unsupported = Object.keys(result).find(
    (field) => !PROVENANCE_FIELDS.has(field),
  );
  if (unsupported || Object.keys(result).length !== PROVENANCE_FIELDS.size) {
    throw new Error("The verified Deep V2 provenance schema is invalid");
  }
  return result;
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const normalized = getAddress(value);
  if (normalized.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function bytes32(value: unknown, label: string): Hex {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    value.length !== 66
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function blockNumber(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    value.length > 32
  ) {
    throw new Error("Invalid Deep V2 launch block");
  }
  return BigInt(value);
}

function logIndex(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error("Invalid Deep V2 launch log index");
  }
  return value;
}

function same(left: string | undefined, right: string) {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

export function requireDeepV2IndexedCandidate(
  token: LauncherToken,
): DeepV2LaunchCandidate {
  if (
    token.launchModel !== "deep" ||
    token.liquidityPath !== "meme" ||
    token.totalSwapFeeBps !== 100
  ) {
    throw new Error("The token is not a verified Deep V2 launch");
  }
  const provenance = record(
    (
      token as LauncherToken & {
        deepV2Provenance?: unknown;
      }
    ).deepV2Provenance,
  );
  if (provenance.deepReleaseVersion !== "deep-full-range-v2") {
    throw new Error("The token has no verified Deep V2 provenance");
  }

  const candidate: DeepV2LaunchCandidate = {
    deepReleaseVersion: "deep-full-range-v2",
    launcher: address(provenance.launcher, "Deep V2 launcher"),
    creator: address(provenance.creator, "Deep V2 creator"),
    tokenAddress: address(provenance.tokenAddress, "Deep V2 token"),
    vaultAddress: address(provenance.vaultAddress, "Deep V2 vault"),
    hookAddress: address(provenance.hookAddress, "Deep V2 hook"),
    poolId: bytes32(provenance.poolId, "Deep V2 PoolId"),
    launchHash: bytes32(provenance.launchHash, "Deep V2 launch hash"),
    vaultConfigurationHash: bytes32(
      provenance.vaultConfigurationHash,
      "Deep V2 vault configuration hash",
    ),
    blockNumber: blockNumber(provenance.blockNumber),
    blockHash: bytes32(provenance.blockHash, "Deep V2 launch block hash"),
    transactionHash: bytes32(
      provenance.transactionHash,
      "Deep V2 launch transaction",
    ),
    logIndex: logIndex(provenance.logIndex),
  };

  if (
    !same(token.tokenAddress, candidate.tokenAddress) ||
    !same(token.hookAddress, candidate.hookAddress) ||
    !same(token.poolId, candidate.poolId) ||
    !same(token.creatorAddress, candidate.creator) ||
    !same(token.growthVaultAddress, candidate.vaultAddress) ||
    !same(token.launchHash, candidate.launchHash) ||
    token.launchBlockNumber !== candidate.blockNumber.toString() ||
    !same(token.launchTransactionHash, candidate.transactionHash) ||
    token.launchLogIndex !== candidate.logIndex
  ) {
    throw new Error(
      "The indexed Deep V2 token does not match its launcher-event provenance",
    );
  }
  return candidate;
}
