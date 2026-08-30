import {
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import {
  DEEP_V3_FIXED_POLICY,
  DEEP_V3_RELEASE_VERSION,
} from "../deep-v3";
import type { ProfileToken } from "./onchain-profile";

export type DeepV3CreatorToken = {
  deepReleaseVersion: typeof DEEP_V3_RELEASE_VERSION;
  launchModel: "deep";
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  imageUrl?: string;
  creator: Address;
  hookAddress: Address;
  vaultAddress: Address;
  poolId: Hex;
  launchTransactionHash: Hex;
  launchedAt: string;
  marketCapNativeWad: string;
  pendingGrowthNativeWei: string;
  accruedGrowthFeesWei: string;
  totalGrowthEthReceivedWei: string;
  totalNativeSwappedWei: string;
  totalNativeAddedWei: string;
  totalTokenAddedRaw: string;
  lockedLiquidity: string;
  trustedNativeDepthWei: string;
  rollingExposureWei: string;
  compoundCount: string;
  lastCompoundTimestamp: string;
  automationAction: 0 | 1;
  nextEligibleTimestamp: string;
  rollingCapacityWei: string;
  blockedReason: Hex;
};

export type DeepV3CreatorProfile =
  | {
      status: "not-deployed" | "loading" | "error";
      account?: Address;
      chainId?: 1;
      tokens: readonly [];
      errorMessage?: string;
    }
  | {
      status: "ready";
      account: Address;
      chainId: 1;
      snapshot: {
        blockNumber: string;
        blockHash: Hex;
      };
      tokens: readonly DeepV3CreatorToken[];
    };

export const EMPTY_DEEP_V3_CREATOR_PROFILE: DeepV3CreatorProfile = {
  status: "not-deployed",
  tokens: [],
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function address(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return getAddress(value);
}

function fixedHex(value: unknown, bytes: number, label: string) {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    value.length !== 2 + bytes * 2
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Hex;
}

function bytes32(value: unknown, label: string) {
  return fixedHex(value, 32, label);
}

function uintString(value: unknown, label: string) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function tokenText(value: unknown, label: string, maximum: number) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    new TextEncoder().encode(value).byteLength > maximum
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value.trim();
}

function optionalHttpsUrl(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`Invalid ${label}`);
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function exactInteger(
  value: unknown,
  expected: number,
  label: string,
) {
  if (value !== expected) throw new Error(`Invalid ${label}`);
  return expected;
}

function automationAction(value: unknown) {
  if (value !== 0 && value !== 1) {
    throw new Error("Invalid Deep liquidity automation state");
  }
  return value;
}

function parseToken(value: unknown, account: Address): DeepV3CreatorToken {
  const token = record(value, "Deep V3 profile token");
  for (const forbidden of [
    "beneficiary",
    "payoutAddress",
    "claimableWei",
    "claimedWei",
    "rewards",
  ]) {
    if (forbidden in token) {
      throw new Error("Deep V3 profile contains an invalid reward field");
    }
  }
  if (
    token.deepReleaseVersion !== DEEP_V3_RELEASE_VERSION ||
    token.launchModel !== "deep"
  ) {
    throw new Error("Invalid Deep V3 profile release");
  }
  const creator = address(token.creator, "Deep V3 creator");
  if (creator.toLowerCase() !== account.toLowerCase()) {
    throw new Error("Deep V3 token belongs to another creator");
  }
  const launchedAt =
    typeof token.launchedAt === "string" &&
    Number.isFinite(Date.parse(token.launchedAt))
      ? token.launchedAt
      : (() => {
          throw new Error("Invalid Deep V3 launch date");
        })();
  const compoundCount = uintString(
    token.compoundCount,
    "Deep compound count",
  );
  const lastCompoundTimestamp = uintString(
    token.lastCompoundTimestamp,
    "Deep last compound timestamp",
  );
  if (
    (BigInt(compoundCount) === 0n) !==
    (BigInt(lastCompoundTimestamp) === 0n)
  ) {
    throw new Error("Invalid Deep compound history");
  }
  exactInteger(
    token.totalHookFeeBps,
    DEEP_V3_FIXED_POLICY.totalHookFeeBps,
    "Deep total hook fee",
  );
  exactInteger(
    token.growthFeeBps,
    DEEP_V3_FIXED_POLICY.growthFeeBps,
    "Deep growth fee",
  );
  exactInteger(
    token.programmableFeeBps,
    DEEP_V3_FIXED_POLICY.programmableFeeBps,
    "Deep Programmable fee",
  );
  exactInteger(token.transferTaxBps, 0, "Deep transfer tax");
  exactInteger(
    token.lpFeePips,
    DEEP_V3_FIXED_POLICY.lpFeePips,
    "Deep LP fee",
  );
  const pendingGrowthNativeWei = uintString(
    token.pendingGrowthNativeWei,
    "Deep pending growth",
  );
  const totalGrowthEthReceivedWei = uintString(
    token.totalGrowthEthReceivedWei,
    "Deep total growth received",
  );
  const totalNativeSwappedWei = uintString(
    token.totalNativeSwappedWei,
    "Deep total native swapped",
  );
  const totalNativeAddedWei = uintString(
    token.totalNativeAddedWei,
    "Deep native liquidity added",
  );
  if (
    BigInt(totalGrowthEthReceivedWei) !==
    BigInt(totalNativeSwappedWei) +
      BigInt(totalNativeAddedWei) +
      BigInt(pendingGrowthNativeWei)
  ) {
    throw new Error("Invalid Deep liquidity accounting");
  }

  return {
    deepReleaseVersion: DEEP_V3_RELEASE_VERSION,
    launchModel: "deep",
    tokenAddress: address(token.tokenAddress, "Deep V3 token"),
    tokenName: tokenText(token.tokenName, "Deep V3 token name", 48),
    tokenSymbol: tokenText(token.tokenSymbol, "Deep V3 token symbol", 12),
    ...(optionalHttpsUrl(token.imageUrl, "Deep V3 token image")
      ? { imageUrl: token.imageUrl as string }
      : {}),
    creator,
    hookAddress: address(token.hookAddress, "Deep V3 hook"),
    vaultAddress: address(token.vaultAddress, "Deep V3 growth vault"),
    poolId: bytes32(token.poolId, "Deep V3 PoolId"),
    launchTransactionHash: bytes32(
      token.launchTransactionHash,
      "Deep V3 launch transaction",
    ),
    launchedAt,
    marketCapNativeWad: uintString(
      token.marketCapNativeWad,
      "Deep market cap",
    ),
    pendingGrowthNativeWei,
    accruedGrowthFeesWei: uintString(
      token.accruedGrowthFeesWei,
      "Deep accrued growth fees",
    ),
    totalGrowthEthReceivedWei,
    totalNativeSwappedWei,
    totalNativeAddedWei,
    totalTokenAddedRaw: uintString(
      token.totalTokenAddedRaw,
      "Deep token liquidity added",
    ),
    lockedLiquidity: uintString(
      token.lockedLiquidity,
      "Deep locked liquidity",
    ),
    trustedNativeDepthWei: uintString(
      token.trustedNativeDepthWei,
      "Deep trusted native depth",
    ),
    rollingExposureWei: uintString(
      token.rollingExposureWei,
      "Deep rolling exposure",
    ),
    compoundCount,
    lastCompoundTimestamp,
    automationAction: automationAction(token.automationAction),
    nextEligibleTimestamp: uintString(
      token.nextEligibleTimestamp,
      "Deep next eligible timestamp",
    ),
    rollingCapacityWei: uintString(
      token.rollingCapacityWei,
      "Deep rolling capacity",
    ),
    blockedReason: fixedHex(
      token.blockedReason,
      4,
      "Deep automation reason",
    ),
  };
}

export function parseDeepV3CreatorProfile(
  value: unknown,
  requestedAccount: string,
): DeepV3CreatorProfile {
  if (!isAddress(requestedAccount)) {
    throw new Error("Connect a valid Ethereum wallet");
  }
  const account = getAddress(requestedAccount);
  const response = record(value, "Deep V3 profile response");
  if (response.status === "not-deployed") {
    return { status: "not-deployed", account, chainId: 1, tokens: [] };
  }
  if (
    response.status !== "ready" ||
    response.chainId !== 1 ||
    !Array.isArray(response.tokens)
  ) {
    throw new Error("Deep liquidity state is temporarily unavailable");
  }
  const responseAccount = address(response.account, "Deep V3 profile account");
  if (responseAccount.toLowerCase() !== account.toLowerCase()) {
    throw new Error("Deep V3 profile does not match the connected wallet");
  }
  const snapshot = record(response.snapshot, "Deep V3 profile snapshot");
  const tokens = response.tokens.map((token) => parseToken(token, account));
  const uniqueTokens = new Set(
    tokens.map((token) => token.tokenAddress.toLowerCase()),
  );
  const uniqueVaults = new Set(
    tokens.map((token) => token.vaultAddress.toLowerCase()),
  );
  if (
    uniqueTokens.size !== tokens.length ||
    uniqueVaults.size !== tokens.length
  ) {
    throw new Error("Deep V3 profile contains duplicate tokens");
  }

  return {
    status: "ready",
    account,
    chainId: 1,
    snapshot: {
      blockNumber: uintString(
        snapshot.blockNumber,
        "Deep V3 snapshot block",
      ),
      blockHash: bytes32(snapshot.blockHash, "Deep V3 snapshot block hash"),
    },
    tokens,
  };
}

export async function fetchDeepV3CreatorProfile(
  account: string,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
) {
  const response = await fetcher(
    `/api/profile/deep?account=${encodeURIComponent(
      account,
    )}&deepReleaseVersion=${DEEP_V3_RELEASE_VERSION}`,
    {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error("Deep liquidity state could not be loaded");
  }
  return parseDeepV3CreatorProfile(body, account);
}

export function deepV3CreatorTokenToProfileToken(
  token: DeepV3CreatorToken,
): ProfileToken {
  return {
    address: token.tokenAddress,
    name: token.tokenName,
    symbol: token.tokenSymbol,
    launchedAt: token.launchedAt,
    href: `/token/${token.tokenAddress}?chain=1`,
    ...(token.imageUrl ? { imageUrl: token.imageUrl } : {}),
    marketCapEthWei: token.marketCapNativeWad,
    launchModel: "deep",
  };
}

export const DEEP_V3_PROFILE_POLICY = Object.freeze({
  totalHookFeeBps: DEEP_V3_FIXED_POLICY.totalHookFeeBps,
  growthFeeBps: DEEP_V3_FIXED_POLICY.growthFeeBps,
  programmableFeeBps: DEEP_V3_FIXED_POLICY.programmableFeeBps,
  transferTaxBps: 0,
  lpFeePips: DEEP_V3_FIXED_POLICY.lpFeePips,
});
