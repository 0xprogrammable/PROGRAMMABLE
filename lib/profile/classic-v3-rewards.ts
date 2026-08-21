import {
  decodeFunctionData,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import { classicRewardVaultAbi } from "../classic-v3";
import { isConfiguredClassicV3ReleaseReady } from "../classic-v3-release";
import {
  parsePreparedTransaction,
  type PreparedTransaction,
} from "../prepared-transaction";

export type ClassicV3Beneficiary = {
  allocationIndex: number;
  beneficiary: Address;
  payoutAddress: Address;
  shareBps: number;
};

export type ClassicV3Reward = {
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  poolId: Hex;
  vaultAddress: Address;
  beneficiary: Address;
  payoutAddress: Address;
  shareBps: number;
  ownedAllocations: readonly ClassicV3Beneficiary[];
  claimableWei: string;
  claimableEth: string;
  claimedWei: string;
  claimedEth: string;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  platformFeeBps: 10;
  beneficiaries: readonly ClassicV3Beneficiary[];
  launchTransactionHash: Hex;
};

export type ClassicV3ProfileRewards =
  | {
      status: "not-deployed" | "loading" | "error";
      account?: Address;
      chainId?: number;
      rewards: readonly [];
      errorMessage?: string;
    }
  | {
      status: "ready";
      account: Address;
      chainId: 1 | 11_155_111;
      rewards: readonly ClassicV3Reward[];
    };

export const EMPTY_CLASSIC_V3_PROFILE: ClassicV3ProfileRewards = {
  status: "not-deployed",
  rewards: [],
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export type ClassicV3ProfileReadErrorKind = "temporary" | "integrity";

export type ClassicV3ProfileApiError =
  | Readonly<{
      status: "error";
      error: Readonly<{
        kind: "temporary";
        code: "classic_profile_temporarily_unavailable";
        message: "Classic rewards are temporarily unavailable";
      }>;
    }>
  | Readonly<{
      status: "error";
      error: Readonly<{
        kind: "integrity";
        code: "classic_profile_integrity_conflict";
        message: "Classic reward data could not be verified";
      }>;
    }>;

export function classicV3ProfileApiError(
  kind: ClassicV3ProfileReadErrorKind,
): ClassicV3ProfileApiError {
  return kind === "integrity"
    ? {
        status: "error",
        error: {
          kind,
          code: "classic_profile_integrity_conflict",
          message: "Classic reward data could not be verified",
        },
      }
    : {
        status: "error",
        error: {
          kind,
          code: "classic_profile_temporarily_unavailable",
          message: "Classic rewards are temporarily unavailable",
        },
      };
}

function parseClassicV3ProfileApiError(
  value: unknown,
): ClassicV3ProfileApiError | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (
    response.status !== "error" ||
    !response.error ||
    typeof response.error !== "object" ||
    Array.isArray(response.error)
  ) {
    return null;
  }
  const error = response.error as Record<string, unknown>;
  if (
    error.kind === "integrity" &&
    error.code === "classic_profile_integrity_conflict" &&
    error.message === "Classic reward data could not be verified"
  ) {
    return classicV3ProfileApiError("integrity");
  }
  if (
    error.kind === "temporary" &&
    error.code === "classic_profile_temporarily_unavailable" &&
    error.message === "Classic rewards are temporarily unavailable"
  ) {
    return classicV3ProfileApiError("temporary");
  }
  return null;
}

export class ClassicV3ProfileReadError extends Error {
  readonly kind: ClassicV3ProfileReadErrorKind;

  constructor(
    kind: ClassicV3ProfileReadErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ClassicV3ProfileReadError";
    this.kind = kind;
  }
}

type ClassicV3ProfileFetchOptions = Readonly<{
  attempts?: number;
  requestTimeoutMs?: number;
  retryDelayMs?: number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}>;

const DEFAULT_PROFILE_FETCH_ATTEMPTS = 2;
const MAX_PROFILE_FETCH_ATTEMPTS = 3;
const DEFAULT_PROFILE_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_PROFILE_RETRY_DELAY_MS = 350;

function waitForProfileRetry(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function temporaryReadError(cause?: unknown) {
  return new ClassicV3ProfileReadError(
    "temporary",
    "Classic rewards are temporarily unavailable",
    { cause },
  );
}

function integrityReadError(cause?: unknown) {
  return new ClassicV3ProfileReadError(
    "integrity",
    "Classic reward data could not be verified",
    { cause },
  );
}

function transientResponseStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchClassicV3ProfileRewardsOnce(
  account: string,
  signal: AbortSignal | undefined,
  fetcher: FetchLike,
  requestTimeoutMs: number,
) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    controller.abort(signal.reason);
  } else {
    signal?.addEventListener("abort", forwardAbort, { once: true });
  }
  const timeout = setTimeout(() => {
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, requestTimeoutMs);

  try {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetcher(
        `/api/profile/classic-v3?account=${encodeURIComponent(account)}`,
        {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
    } catch (caught) {
      if (signal?.aborted) throw caught;
      throw temporaryReadError(caught);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (caught) {
      throw !response.ok && transientResponseStatus(response.status)
        ? temporaryReadError(caught)
        : integrityReadError(caught);
    }
    if (!response.ok) {
      const apiError = parseClassicV3ProfileApiError(body);
      if (apiError?.error.kind === "integrity") {
        throw integrityReadError();
      }
      if (apiError?.error.kind === "temporary") {
        throw temporaryReadError();
      }
      throw transientResponseStatus(response.status)
        ? temporaryReadError()
        : integrityReadError();
    }
    try {
      return parseClassicV3ProfileRewards(body, account);
    } catch (caught) {
      throw integrityReadError(caught);
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

function configuredEnvironment() {
  return process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? ("rehearsal" as const)
    : ("production" as const);
}

function assertClassicV3ReleaseAvailable(expectedChainId?: number) {
  const environment = configuredEnvironment();
  const chainId = environment === "rehearsal" ? 11_155_111 : 1;
  if (
    (expectedChainId !== undefined && expectedChainId !== chainId) ||
    !isConfiguredClassicV3ReleaseReady(environment)
  ) {
    throw new Error("Classic rewards are not enabled by the verified release");
  }
}

function asRecord(value: unknown, label: string) {
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

function bytes32(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    value.length !== 66
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Hex;
}

function uintString(value: unknown, label: string) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function bps(value: unknown, label: string, allowZero = false) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > 10_000
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function allocationIndex(value: unknown, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= 5
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function parseClassicV3ProfileRewards(
  value: unknown,
  requestedAccount: string,
): ClassicV3ProfileRewards {
  if (!isAddress(requestedAccount)) {
    throw new Error("Connect a valid Ethereum wallet");
  }
  const account = getAddress(requestedAccount);
  const record = asRecord(value, "Classic profile response");
  if (record.status === "not-deployed") {
    return { status: "not-deployed", account, rewards: [] };
  }
  if (record.status !== "ready") {
    throw new Error("Classic rewards are temporarily unavailable");
  }
  const responseAccount = address(record.account, "profile account");
  if (responseAccount.toLowerCase() !== account.toLowerCase()) {
    throw new Error("Classic profile does not match the connected wallet");
  }
  if (record.chainId !== 1 && record.chainId !== 11_155_111) {
    throw new Error("Invalid Classic profile network");
  }
  if (!Array.isArray(record.rewards)) {
    throw new Error("Invalid Classic rewards");
  }

  const rewards = record.rewards.map((entry, rewardIndex) => {
    const reward = asRecord(entry, `Classic reward ${rewardIndex + 1}`);
    const beneficiary = address(reward.beneficiary, "reward beneficiary");
    if (beneficiary.toLowerCase() !== account.toLowerCase()) {
      throw new Error("Classic reward belongs to another beneficiary");
    }
    if (!Array.isArray(reward.beneficiaries)) {
      throw new Error("Invalid immutable reward split");
    }
    const beneficiaries = reward.beneficiaries.map((entry, index) => {
      const item = asRecord(entry, `reward recipient ${index + 1}`);
      const payoutAddress = address(item.payoutAddress, "payout address");
      const beneficiary = address(item.beneficiary, "reward beneficiary");
      if (beneficiary.toLowerCase() !== payoutAddress.toLowerCase()) {
        throw new Error("Invalid current reward allocation");
      }
      return {
        allocationIndex: allocationIndex(
          item.allocationIndex,
          "reward allocation index",
        ),
        beneficiary,
        payoutAddress,
        shareBps: bps(item.shareBps, "reward share"),
      };
    });
    const indexes = new Set(
      beneficiaries.map((item) => item.allocationIndex),
    );
    if (
      beneficiaries.length < 1 ||
      beneficiaries.length > 5 ||
      indexes.size !== beneficiaries.length ||
      beneficiaries.some((item, index) => item.allocationIndex !== index) ||
      beneficiaries.reduce((sum, item) => sum + item.shareBps, 0) !== 10_000
    ) {
      throw new Error("Invalid current reward allocation");
    }
    const ownedAllocations = beneficiaries.filter(
      (item) => item.payoutAddress.toLowerCase() === account.toLowerCase(),
    );
    const shareBps = bps(reward.shareBps, "beneficiary share", true);
    if (
      ownedAllocations.reduce((sum, item) => sum + item.shareBps, 0) !==
      shareBps
    ) {
      throw new Error("Classic beneficiary share does not match");
    }
    const claimableWei = uintString(reward.claimableWei, "claimable rewards");
    const claimedWei = uintString(reward.claimedWei, "claimed rewards");
    if (
      reward.claimableEth !== formatUnits(BigInt(claimableWei), 18) ||
      reward.claimedEth !== formatUnits(BigInt(claimedWei), 18)
    ) {
      throw new Error("Classic reward ETH values do not match");
    }
    return {
      tokenAddress: address(reward.tokenAddress, "reward token"),
      tokenName:
        typeof reward.tokenName === "string" && reward.tokenName.trim()
          ? reward.tokenName
          : (() => {
              throw new Error("Invalid reward token name");
            })(),
      tokenSymbol:
        typeof reward.tokenSymbol === "string" && reward.tokenSymbol.trim()
          ? reward.tokenSymbol
          : (() => {
              throw new Error("Invalid reward token symbol");
            })(),
      poolId: bytes32(reward.poolId, "reward pool"),
      vaultAddress: address(reward.vaultAddress, "reward vault"),
      beneficiary,
      payoutAddress: address(reward.payoutAddress, "reward payout address"),
      shareBps,
      ownedAllocations,
      claimableWei,
      claimableEth: reward.claimableEth as string,
      claimedWei,
      claimedEth: reward.claimedEth as string,
      buySwapFeeBps: bps(reward.buySwapFeeBps, "buy fee"),
      sellSwapFeeBps: bps(reward.sellSwapFeeBps, "sell fee"),
      platformFeeBps:
        bps(reward.platformFeeBps, "platform fee") === 10
          ? 10
          : (() => {
              throw new Error("Invalid platform fee");
            })(),
      beneficiaries,
      launchTransactionHash: bytes32(
        reward.launchTransactionHash,
        "launch transaction",
      ),
    } satisfies ClassicV3Reward;
  });

  return {
    status: "ready",
    account,
    chainId: record.chainId,
    rewards,
  };
}

export async function fetchClassicV3ProfileRewards(
  account: string,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
  options: ClassicV3ProfileFetchOptions = {},
) {
  assertClassicV3ReleaseAvailable();
  const requestedAttempts = options.attempts ?? DEFAULT_PROFILE_FETCH_ATTEMPTS;
  const attempts = Math.min(
    MAX_PROFILE_FETCH_ATTEMPTS,
    Math.max(1, Math.trunc(requestedAttempts)),
  );
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_PROFILE_REQUEST_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_PROFILE_RETRY_DELAY_MS;
  const wait = options.wait ?? waitForProfileRetry;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchClassicV3ProfileRewardsOnce(
        account,
        signal,
        fetcher,
        requestTimeoutMs,
      );
    } catch (caught) {
      if (signal?.aborted) throw caught;
      const error =
        caught instanceof ClassicV3ProfileReadError
          ? caught
          : integrityReadError(caught);
      if (error.kind !== "temporary" || attempt === attempts) throw error;
      await wait(retryDelayMs, signal);
    }
  }

  throw temporaryReadError();
}

type ClassicV3Action = "claim" | "update-payout";

export type PreparedClassicV3RewardAction = {
  action: ClassicV3Action;
  account: Address;
  vaultAddress: Address;
  transaction: Extract<
    PreparedTransaction,
    { kind: "claim-classic-v3-rewards" | "update-classic-v3-payout" }
  >;
};

export function validatePreparedClassicV3RewardAction(
  value: unknown,
  expected: {
    action: ClassicV3Action;
    account: string;
    vaultAddress: string;
    newPayoutAddress?: string;
    allocationIndex?: number;
    chainId: number;
  },
): PreparedClassicV3RewardAction {
  const response = asRecord(value, "Classic reward action");
  if (response.status !== "ready" || response.action !== expected.action) {
    throw new Error("Classic reward action is not ready");
  }
  const account = address(response.account, "reward action account");
  const vaultAddress = address(response.vaultAddress, "reward action vault");
  if (
    !isAddress(expected.account) ||
    account.toLowerCase() !== getAddress(expected.account).toLowerCase() ||
    !isAddress(expected.vaultAddress) ||
    vaultAddress.toLowerCase() !==
      getAddress(expected.vaultAddress).toLowerCase()
  ) {
    throw new Error("Classic reward action does not match the selection");
  }
  const transaction = parsePreparedTransaction(response.transaction);
  const expectedKind =
    expected.action === "claim"
      ? "claim-classic-v3-rewards"
      : "update-classic-v3-payout";
  if (
    transaction.kind !== expectedKind ||
    transaction.chainId !== expected.chainId ||
    transaction.from.toLowerCase() !== account.toLowerCase() ||
    transaction.to.toLowerCase() !== vaultAddress.toLowerCase() ||
    transaction.value !== "0"
  ) {
    throw new Error("Classic reward transaction is not canonical");
  }
  const decoded = decodeFunctionData({
    abi: classicRewardVaultAbi,
    data: transaction.data,
  });
  if (expected.action === "claim") {
    if (decoded.functionName !== "claim") {
      throw new Error("Classic reward transaction is not a claim");
    }
  } else {
    if (
      expected.allocationIndex === undefined ||
      !Number.isSafeInteger(expected.allocationIndex) ||
      expected.allocationIndex < 0 ||
      expected.allocationIndex >= 5 ||
      !expected.newPayoutAddress ||
      !isAddress(expected.newPayoutAddress) ||
      decoded.functionName !== "changePayoutWallet" ||
      decoded.args[0] !== BigInt(expected.allocationIndex) ||
      decoded.args[1].toLowerCase() !==
        getAddress(expected.newPayoutAddress).toLowerCase()
    ) {
      throw new Error("Classic payout update does not match the new address");
    }
  }
  return { action: expected.action, account, vaultAddress, transaction };
}

export async function prepareClassicV3RewardAction(
  input: {
    action: ClassicV3Action;
    account: string;
    vaultAddress: string;
    newPayoutAddress?: string;
    allocationIndex?: number;
    chainId: number;
  },
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
  options: Readonly<{
    retryDelayMs?: number;
    wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  }> = {},
) {
  assertClassicV3ReleaseAvailable(input.chainId);
  const wait = options.wait ?? waitForProfileRetry;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_PROFILE_RETRY_DELAY_MS;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await fetcher("/api/profile/classic-v3", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: input.action,
        account: input.account,
        vaultAddress: input.vaultAddress,
        ...(input.action === "update-payout"
          ? {
              allocationIndex: input.allocationIndex,
              newPayoutAddress: input.newPayoutAddress,
            }
          : {}),
        chainId: input.chainId,
      }),
      signal,
    });
    const body = await response.json();
    if (response.ok) {
      return validatePreparedClassicV3RewardAction(body, input);
    }
    if ((response.status === 502 || response.status === 503) && attempt === 1) {
      await wait(retryDelayMs, signal);
      continue;
    }
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    throw new Error(
      typeof record.error === "string"
        ? record.error
        : "Classic reward action could not be prepared",
    );
  }
  throw new Error("Classic reward action could not be prepared");
}

export function encodeClassicV3RewardAction(input: {
  action: ClassicV3Action;
  allocationIndex?: number;
  newPayoutAddress?: Address;
}) {
  return input.action === "claim"
    ? encodeFunctionData({
        abi: classicRewardVaultAbi,
        functionName: "claim",
      })
    : encodeFunctionData({
        abi: classicRewardVaultAbi,
        functionName: "changePayoutWallet",
        args: [
          BigInt(input.allocationIndex as number),
          input.newPayoutAddress as Address,
        ],
      });
}
