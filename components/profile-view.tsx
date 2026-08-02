"use client";

import Image from "next/image";
import Link from "next/link";
import { formatUnits, type Hex } from "viem";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { useWallet } from "@/components/wallet-provider";
import { isConfiguredClassicV3ReleaseReady } from "@/lib/classic-v3-release";
import { prepareAvatarImage } from "@/lib/profile/avatar";
import {
  EMPTY_CLASSIC_V3_PROFILE,
  fetchClassicV3ProfileRewards,
  prepareClassicV3RewardAction,
  type ClassicV3Beneficiary,
  type ClassicV3ProfileRewards,
  type ClassicV3Reward,
} from "@/lib/profile/classic-v3-rewards";
import {
  deepV3CreatorTokenToProfileToken,
  EMPTY_DEEP_V3_CREATOR_PROFILE,
  fetchDeepV3CreatorProfile,
  type DeepV3CreatorProfile,
  type DeepV3CreatorToken,
} from "@/lib/profile/deep-v3-profile";
import {
  EMPTY_DEEP_PROFILE,
  fetchDeepProfileRewards,
  prepareDeepRewardAction,
  type DeepProfileRewards,
  type DeepReward,
} from "@/lib/profile/deep-rewards";
import {
  EMPTY_STOCK_PAIRED_PROFILE,
  fetchStockPairedProfileRewards,
  isConfiguredStockPairedRewardsReady,
  prepareStockPairedRewardAction,
  prepareStockPairedRewardConversion,
  type StockPairedProfileRewards,
  type StockPairedReward,
} from "@/lib/profile/stock-paired-rewards";
import { prepareCreatorClaim } from "@/lib/profile/creator-claim";
import {
  canOptimizeTokenImage,
  getTokenCardImageSource,
} from "@/lib/token-image";
import {
  getProfileStorageKey,
  getProfileUsernameError,
  normalizeProfileUsername,
  parseLocalProfile,
  PROFILE_UPDATED_EVENT,
  writeLocalProfile,
} from "@/lib/profile/local-profile";
import {
  errorProfileData,
  fetchCreatorProfile,
  isProfileDataForAccount,
  loadingProfileData,
  UNAVAILABLE_PROFILE_DATA,
  type ProfileClaim,
  type ProfileOnchainData,
  type ProfileToken,
} from "@/lib/profile/onchain-profile";
import styles from "./profile-experience.module.css";

const fallbackTokenImages = [
  "/brand/programmable-token-fallback-01-dawn.webp",
  "/brand/programmable-token-fallback-02-moon.webp",
  "/brand/programmable-token-fallback-03-sun.webp",
  "/brand/programmable-token-fallback-04-mint.webp",
  "/brand/programmable-token-fallback-05-lavender.webp",
  "/brand/programmable-token-fallback-06-dusk.webp",
] as const;
const profileEnvironment =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const classicV3ReleaseAvailable =
  isConfiguredClassicV3ReleaseReady(profileEnvironment);
const deepReleaseAvailable = false;
const deepV3ReleaseAvailable = false;
const stockPairedReleaseAvailable =
  isConfiguredStockPairedRewardsReady();

type ProfileClaimActionState = {
  account: string;
  status:
    | "preparing"
    | "wallet"
    | "confirming"
    | "pending"
    | "confirmed"
    | "error";
  message: string;
  transactionHash?: Hex;
};

type ClassicV3ActionState = {
  account: string;
  status:
    | "preparing"
    | "wallet"
    | "confirming"
    | "pending"
    | "confirmed"
    | "error";
  message: string;
  transactionHash?: Hex;
};

type DeepActionState = ClassicV3ActionState;
type StockPairedActionState = ClassicV3ActionState;

export type PendingProfileTransactionSource =
  | "classic"
  | "classic-v3"
  | "deep"
  | "stock-paired";

export type PendingProfileTransactionRecord = {
  version: 1;
  account: string;
  chainId: 1 | 11_155_111;
  source: PendingProfileTransactionSource;
  stateKey: string;
  action: "claim" | "update-payout";
  transactionHash: Hex;
  submittedAt: number;
};

export type ProfileViewProps = {
  onchainData?: ProfileOnchainData;
};

const pendingProfileTransactionStoragePrefix =
  "programmable:profile-pending-transactions:v1:";
const maximumPersistedProfileTransactions = 32;
const ethereumAddressPattern = /^0x[0-9a-f]{40}$/;
const ethereumBytes32Pattern = /^0x[0-9a-f]{64}$/;

function shortenAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function getFallbackTokenImage(address: string) {
  const suffix = Number.parseInt(address.slice(-8), 16);
  const index = Number.isFinite(suffix)
    ? suffix % fallbackTokenImages.length
    : 0;
  return fallbackTokenImages[index];
}

function formatEth(value?: string) {
  if (!value?.trim()) return "—";
  const normalized = value.trim().replace(/\s*ETH$/i, "");
  const [whole = "0", fraction = ""] = normalized.split(".");
  const compactFraction = fraction.replace(/0+$/, "").slice(0, 6);
  return `${whole}${compactFraction ? `.${compactFraction}` : ""} ETH`;
}

function formatWei(value: bigint) {
  return formatEth(formatUnits(value, 18));
}

function formatStockRewardEstimate(reward: StockPairedReward) {
  if (!reward.estimatedEth || !reward.estimatedUsd) return "";
  const usd = Number(reward.estimatedUsd);
  if (!Number.isFinite(usd) || usd <= 0) return "";
  const formattedUsd = new Intl.NumberFormat("en-US", {
    notation: usd >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: usd < 1 ? 3 : 2,
  }).format(usd);
  return `≈ $${formattedUsd} · ${formatEth(reward.estimatedEth)}`;
}

function formatMarketCap(token: ProfileToken) {
  if (token.fdvUsdWad) {
    const dollars = Number(BigInt(token.fdvUsdWad) / 10n ** 18n);
    if (Number.isFinite(dollars)) {
      if (dollars >= 1_000_000_000) {
        return `$${(dollars / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
      }
      if (dollars >= 1_000_000) {
        return `$${(dollars / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
      }
      if (dollars >= 1_000) {
        return `$${(dollars / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
      }
      return `$${dollars.toLocaleString("en-US")}`;
    }
  }
  if (token.marketCapEthWei) {
    return formatEth(formatUnits(BigInt(token.marketCapEthWei), 18));
  }
  if (token.marketCapQuoteWad && token.quoteAssetSymbol) {
    const value = Number(
      formatUnits(BigInt(token.marketCapQuoteWad), 18),
    );
    if (Number.isFinite(value)) {
      return `${new Intl.NumberFormat("en-US", {
        notation: value >= 1_000 ? "compact" : "standard",
        maximumFractionDigits: 2,
        maximumSignificantDigits: 6,
      }).format(value)} ${token.quoteAssetSymbol}`;
    }
  }
  return null;
}

type WaitForTransactionOptions = {
  maxAttempts?: number;
  intervalMs?: number;
  fetcher?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
};

function throwIfTransactionPollAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Transaction polling aborted", "AbortError");
}

function waitForTransactionInterval(
  milliseconds: number,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    try {
      throwIfTransactionPollAborted(signal);
    } catch (caught) {
      reject(caught);
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("Transaction polling aborted", "AbortError"),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function waitForTransaction(
  transactionHash: Hex,
  chainId: number,
  options: WaitForTransactionOptions = {},
): Promise<"pending" | "confirmed" | "reverted"> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 40));
  const intervalMs = options.intervalMs ?? 1_500;
  const fetcher = options.fetcher ?? fetch;
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      waitForTransactionInterval(milliseconds, options.signal));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfTransactionPollAborted(options.signal);
    const response = await fetcher(
      `/api/transaction-status?hash=${encodeURIComponent(
        transactionHash,
      )}&chainId=${chainId}`,
      {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: options.signal,
      },
    );
    throwIfTransactionPollAborted(options.signal);
    const body = (await response.json()) as {
      status?: "pending" | "confirmed" | "reverted";
    };
    throwIfTransactionPollAborted(options.signal);
    if (!response.ok) {
      throw new Error("The transaction status could not be checked");
    }
    if (body.status === "confirmed" || body.status === "reverted") {
      return body.status;
    }
    if (attempt < maxAttempts - 1) {
      await wait(intervalMs);
      throwIfTransactionPollAborted(options.signal);
    }
  }
  return "pending";
}

type RecoverableTransactionActionState = {
  status: string;
  message: string;
  transactionHash?: Hex;
};

export function preserveInterruptedTransactionStates<
  T extends RecoverableTransactionActionState,
>(states: Record<string, T>): Record<string, T> {
  let changed = false;
  const next = { ...states };

  for (const [key, state] of Object.entries(states)) {
    if (state.status !== "confirming" || !state.transactionHash) continue;
    next[key] = {
      ...state,
      status: "pending",
      message: "Status check paused. Check the same transaction again",
    };
    changed = true;
  }

  return changed ? next : states;
}

export function profileTransactionPollAttempts(manualCheck: boolean) {
  return manualCheck ? 1 : 40;
}

function normalizeEthereumAddress(value: string) {
  const normalized = value.trim().toLowerCase();
  return ethereumAddressPattern.test(normalized) ? normalized : null;
}

function isPendingProfileTransactionRecord(
  value: unknown,
  expectedAccount: string,
): value is PendingProfileTransactionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const record = value as Partial<PendingProfileTransactionRecord>;
  const account =
    typeof record.account === "string"
      ? normalizeEthereumAddress(record.account)
      : null;
  const transactionHash =
    typeof record.transactionHash === "string"
      ? record.transactionHash.toLowerCase()
      : "";
  const stateKey =
    typeof record.stateKey === "string" ? record.stateKey.toLowerCase() : "";
  const validSource =
    record.source === "classic" ||
    record.source === "classic-v3" ||
    record.source === "deep" ||
    record.source === "stock-paired";
  const validAction =
    record.action === "claim" || record.action === "update-payout";
  const validNetwork = record.chainId === 1 || record.chainId === 11_155_111;
  const validSubmittedAt =
    typeof record.submittedAt === "number" &&
    Number.isSafeInteger(record.submittedAt) &&
    record.submittedAt > 0;

  if (
    record.version !== 1 ||
    account !== expectedAccount ||
    !ethereumBytes32Pattern.test(transactionHash) ||
    !validSource ||
    !validAction ||
    !validNetwork ||
    !validSubmittedAt
  ) {
    return false;
  }

  if (record.source === "classic") {
    return record.action === "claim" && ethereumBytes32Pattern.test(stateKey);
  }

  const [vaultAddress, stateAction, extra] = stateKey.split(":");
  return (
    extra === undefined &&
    ethereumAddressPattern.test(vaultAddress ?? "") &&
    stateAction === record.action
  );
}

export function parsePendingProfileTransactions(
  serialized: string | null | undefined,
  account: string,
): PendingProfileTransactionRecord[] {
  const normalizedAccount = normalizeEthereumAddress(account);
  if (!normalizedAccount || !serialized) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

  const envelope = parsed as { version?: unknown; transactions?: unknown };
  if (envelope.version !== 1 || !Array.isArray(envelope.transactions)) return [];

  const uniqueRecords = new Map<string, PendingProfileTransactionRecord>();
  for (const value of envelope.transactions.slice(
    -maximumPersistedProfileTransactions,
  )) {
    if (!isPendingProfileTransactionRecord(value, normalizedAccount)) continue;
    const record = value as PendingProfileTransactionRecord;
    const normalizedRecord: PendingProfileTransactionRecord = {
      ...record,
      account: normalizedAccount,
      stateKey: record.stateKey.toLowerCase(),
      transactionHash: record.transactionHash.toLowerCase() as Hex,
    };
    uniqueRecords.set(
      `${normalizedRecord.source}:${normalizedRecord.stateKey}`,
      normalizedRecord,
    );
  }
  return [...uniqueRecords.values()];
}

export function upsertPendingProfileTransactionRecords(
  records: readonly PendingProfileTransactionRecord[],
  record: PendingProfileTransactionRecord,
): PendingProfileTransactionRecord[] {
  const normalized = parsePendingProfileTransactions(
    JSON.stringify({ version: 1, transactions: [record] }),
    record.account,
  )[0];
  if (!normalized) return [...records];

  const matchingRecord = records.find(
    (candidate) =>
      candidate.source === normalized.source &&
      candidate.stateKey === normalized.stateKey &&
      candidate.transactionHash.toLowerCase() ===
        normalized.transactionHash.toLowerCase(),
  );
  const nextRecord = matchingRecord
    ? { ...normalized, submittedAt: matchingRecord.submittedAt }
    : normalized;

  return [
    ...records.filter(
      (candidate) =>
        candidate.source !== nextRecord.source ||
        candidate.stateKey !== nextRecord.stateKey,
    ),
    nextRecord,
  ].slice(-maximumPersistedProfileTransactions);
}

export function removePendingProfileTransactionRecord(
  records: readonly PendingProfileTransactionRecord[],
  target: Pick<
    PendingProfileTransactionRecord,
    "source" | "stateKey" | "transactionHash"
  >,
): PendingProfileTransactionRecord[] {
  return records.filter(
    (record) =>
      record.source !== target.source ||
      record.stateKey !== target.stateKey.toLowerCase() ||
      record.transactionHash.toLowerCase() !==
        target.transactionHash.toLowerCase(),
  );
}

export function clearConfirmedProfileActionStates<
  T extends RecoverableTransactionActionState,
>(
  states: Record<string, T>,
  confirmed: ReadonlyMap<string, Hex>,
): Record<string, T> {
  let changed = false;
  const next = { ...states };

  for (const [stateKey, transactionHash] of confirmed) {
    const state = states[stateKey];
    if (
      state?.status !== "confirmed" ||
      state.transactionHash?.toLowerCase() !== transactionHash.toLowerCase()
    ) {
      continue;
    }
    delete next[stateKey];
    changed = true;
  }

  return changed ? next : states;
}

function pendingProfileTransactionStorageKey(account: string) {
  const normalizedAccount = normalizeEthereumAddress(account);
  return normalizedAccount
    ? `${pendingProfileTransactionStoragePrefix}${normalizedAccount}`
    : null;
}

function readPendingProfileTransactions(
  storage: Storage,
  account: string,
): PendingProfileTransactionRecord[] {
  const storageKey = pendingProfileTransactionStorageKey(account);
  if (!storageKey) return [];
  return parsePendingProfileTransactions(storage.getItem(storageKey), account);
}

function writePendingProfileTransactions(
  storage: Storage,
  account: string,
  records: readonly PendingProfileTransactionRecord[],
) {
  const storageKey = pendingProfileTransactionStorageKey(account);
  if (!storageKey) return;
  if (records.length === 0) {
    storage.removeItem(storageKey);
    return;
  }
  storage.setItem(
    storageKey,
    JSON.stringify({ version: 1, transactions: records }),
  );
}

function persistPendingProfileTransaction(
  record: PendingProfileTransactionRecord,
) {
  if (typeof window === "undefined") return;
  try {
    const records = readPendingProfileTransactions(
      window.localStorage,
      record.account,
    );
    writePendingProfileTransactions(
      window.localStorage,
      record.account,
      upsertPendingProfileTransactionRecords(records, record),
    );
  } catch {
    // A blocked storage layer must not interrupt an already-submitted transaction.
  }
}

function forgetPendingProfileTransaction(
  target: Pick<
    PendingProfileTransactionRecord,
    "account" | "source" | "stateKey" | "transactionHash"
  >,
) {
  if (typeof window === "undefined") return;
  try {
    const records = readPendingProfileTransactions(
      window.localStorage,
      target.account,
    );
    writePendingProfileTransactions(
      window.localStorage,
      target.account,
      removePendingProfileTransactionRecord(records, target),
    );
  } catch {
    // The confirmed receipt remains authoritative if browser storage is blocked.
  }
}

function restoredPendingProfileActionState(
  record: PendingProfileTransactionRecord,
): ProfileClaimActionState {
  return {
    account: record.account,
    status: "pending",
    message: "Transaction submitted. Check its current status",
    transactionHash: record.transactionHash,
  };
}

export function groupPendingProfileTransactionStates(
  records: readonly PendingProfileTransactionRecord[],
) {
  const grouped: Record<
    PendingProfileTransactionSource,
    Record<string, ProfileClaimActionState>
  > = {
    classic: {},
    "classic-v3": {},
    deep: {},
    "stock-paired": {},
  };
  for (const record of records) {
    grouped[record.source][record.stateKey] =
      restoredPendingProfileActionState(record);
  }
  return grouped;
}

function consumeConfirmedProfileTransactions(
  active: Map<string, Hex>,
  consumed: ReadonlyMap<string, Hex>,
) {
  for (const [stateKey, transactionHash] of consumed) {
    if (
      active.get(stateKey)?.toLowerCase() === transactionHash.toLowerCase()
    ) {
      active.delete(stateKey);
    }
  }
}

function useWalletLocalProfile(address?: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!address) return () => undefined;

      const storageKey = getProfileStorageKey(address);
      const handleStorage = (event: StorageEvent) => {
        if (event.key === storageKey) listener();
      };
      const handleProfileUpdated = (event: Event) => {
        const detail = (
          event as CustomEvent<{
            address?: string;
          }>
        ).detail;

        if (detail?.address?.toLowerCase() === address.toLowerCase()) {
          listener();
        }
      };

      window.addEventListener("storage", handleStorage);
      window.addEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdated);

      return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdated);
      };
    },
    [address],
  );
  const getSnapshot = useCallback(() => {
    if (!address || typeof window === "undefined") return "";

    try {
      return window.localStorage.getItem(getProfileStorageKey(address)) ?? "";
    } catch {
      return "";
    }
  }, [address]);
  const storedProfile = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getEmptyProfileSnapshot,
  );

  return useMemo(() => parseLocalProfile(storedProfile), [storedProfile]);
}

function getEmptyProfileSnapshot() {
  return "";
}

export function withoutClosedDeepProfileData(
  data: ProfileOnchainData,
): ProfileOnchainData {
  const closedTokenAddresses = new Set(
    data.tokens
      .filter((token) => token.launchModel === "deep")
      .map((token) => token.address.toLowerCase()),
  );
  if (closedTokenAddresses.size === 0) return data;

  const referencesClosedToken = (value: string) => {
    const normalized = value.toLowerCase();
    return [...closedTokenAddresses].some((address) =>
      normalized.includes(address),
    );
  };

  return {
    ...data,
    tokens: data.tokens.filter((token) => token.launchModel !== "deep"),
    positions: data.positions.filter(
      (position) =>
        !closedTokenAddresses.has(position.tokenAddress.toLowerCase()),
    ),
    claims: data.claims.filter(
      (claim) => !closedTokenAddresses.has(claim.tokenAddress.toLowerCase()),
    ),
    activity: data.activity.filter(
      (activity) =>
        !referencesClosedToken(activity.href) &&
        !/\bdeep\b/iu.test(`${activity.label} ${activity.detail}`),
    ),
  };
}

export function ProfileView({ onchainData }: ProfileViewProps = {}) {
  const { wallet, openWallet, sendTransaction } = useWallet();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const account = wallet?.account;
  const activeAccountRef = useRef(account);
  const transactionPollControllersRef = useRef<Set<AbortController>>(
    new Set(),
  );
  const hydratedPendingAccountRef = useRef<string | undefined>(undefined);
  const confirmedProfileTransactionsRef = useRef<
    Record<PendingProfileTransactionSource, Map<string, Hex>>
  >({
    classic: new Map(),
    "classic-v3": new Map(),
    deep: new Map(),
    "stock-paired": new Map(),
  });
  const savedProfile = useWalletLocalProfile(account);
  const [editingAccount, setEditingAccount] = useState("");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [avatarDraft, setAvatarDraft] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [preparingImage, setPreparingImage] = useState(false);
  const [remoteOnchainData, setRemoteOnchainData] =
    useState<ProfileOnchainData>(UNAVAILABLE_PROFILE_DATA);
  const [profileRefresh, setProfileRefresh] = useState(0);
  const [classicV3Rewards, setClassicV3Rewards] =
    useState<ClassicV3ProfileRewards>(EMPTY_CLASSIC_V3_PROFILE);
  const [deepRewards, setDeepRewards] =
    useState<DeepProfileRewards>(EMPTY_DEEP_PROFILE);
  const [deepV3Profile, setDeepV3Profile] =
    useState<DeepV3CreatorProfile>(EMPTY_DEEP_V3_CREATOR_PROFILE);
  const [stockPairedRewards, setStockPairedRewards] =
    useState<StockPairedProfileRewards>(EMPTY_STOCK_PAIRED_PROFILE);
  const [claimActionStates, setClaimActionStates] = useState<
    Record<string, ProfileClaimActionState>
  >({});
  const [classicV3ActionStates, setClassicV3ActionStates] = useState<
    Record<string, ClassicV3ActionState>
  >({});
  const [deepActionStates, setDeepActionStates] = useState<
    Record<string, DeepActionState>
  >({});
  const [stockPairedActionStates, setStockPairedActionStates] = useState<
    Record<string, StockPairedActionState>
  >({});
  const editingProfile =
    Boolean(account) && editingAccount === account?.toLowerCase();
  const abortTransactionPolls = useCallback(() => {
    for (const controller of transactionPollControllersRef.current) {
      controller.abort();
    }
    transactionPollControllersRef.current.clear();
  }, []);

  useEffect(() => {
    const previousAccount = activeAccountRef.current?.toLowerCase();
    activeAccountRef.current = account;
    const normalizedAccount = account?.toLowerCase();

    if (previousAccount !== normalizedAccount) {
      abortTransactionPolls();
      hydratedPendingAccountRef.current = undefined;
      for (const targets of Object.values(
        confirmedProfileTransactionsRef.current,
      )) {
        targets.clear();
      }
    }
    if (hydratedPendingAccountRef.current === normalizedAccount) return;

    let cancelled = false;
    if (!account || !normalizedAccount) {
      queueMicrotask(() => {
        if (cancelled) return;
        setClaimActionStates({});
        setClassicV3ActionStates({});
        setDeepActionStates({});
        setStockPairedActionStates({});
      });
      return () => {
        cancelled = true;
      };
    }

    let persisted: PendingProfileTransactionRecord[] = [];
    try {
      persisted = readPendingProfileTransactions(window.localStorage, account);
    } catch {
      persisted = [];
    }
    const restored = groupPendingProfileTransactionStates(persisted);
    hydratedPendingAccountRef.current = normalizedAccount;
    queueMicrotask(() => {
      if (cancelled) return;
      setClaimActionStates(restored.classic);
      setClassicV3ActionStates(restored["classic-v3"]);
      setDeepActionStates(restored.deep);
      setStockPairedActionStates(restored["stock-paired"]);
    });
    return () => {
      cancelled = true;
    };
  }, [abortTransactionPolls, account]);

  useEffect(
    () => () => {
      abortTransactionPolls();
    },
    [abortTransactionPolls],
  );

  useEffect(() => {
    if (onchainData) return;
    if (!account) return;

    const controller = new AbortController();
    const confirmedTransactions = new Map(
      confirmedProfileTransactionsRef.current.classic,
    );

    void fetchCreatorProfile(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setRemoteOnchainData(data);
          setClaimActionStates((current) =>
            clearConfirmedProfileActionStates(current, confirmedTransactions),
          );
          consumeConfirmedProfileTransactions(
            confirmedProfileTransactionsRef.current.classic,
            confirmedTransactions,
          );
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setRemoteOnchainData(
          errorProfileData(
            account,
            caught instanceof Error
              ? caught.message
              : "Onchain profile data could not be loaded",
          ),
        );
      });

    return () => controller.abort();
  }, [account, onchainData, profileRefresh]);

  useEffect(() => {
    if (!account || !classicV3ReleaseAvailable) return;
    const controller = new AbortController();
    const confirmedTransactions = new Map(
      confirmedProfileTransactionsRef.current["classic-v3"],
    );
    void fetchClassicV3ProfileRewards(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setClassicV3Rewards(data);
          setClassicV3ActionStates((current) =>
            clearConfirmedProfileActionStates(current, confirmedTransactions),
          );
          consumeConfirmedProfileTransactions(
            confirmedProfileTransactionsRef.current["classic-v3"],
            confirmedTransactions,
          );
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setClassicV3Rewards({
          status: "error",
          account,
          rewards: [],
          errorMessage:
            caught instanceof Error
              ? caught.message
              : "Classic rewards could not be loaded",
        });
      });
    return () => controller.abort();
  }, [account, profileRefresh]);

  useEffect(() => {
    if (!account || !deepReleaseAvailable) return;
    const controller = new AbortController();
    const confirmedTransactions = new Map(
      confirmedProfileTransactionsRef.current.deep,
    );
    void fetchDeepProfileRewards(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDeepRewards(data);
          setDeepActionStates((current) =>
            clearConfirmedProfileActionStates(current, confirmedTransactions),
          );
          consumeConfirmedProfileTransactions(
            confirmedProfileTransactionsRef.current.deep,
            confirmedTransactions,
          );
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setDeepRewards({
          status: "error",
          account,
          rewards: [],
          errorMessage:
            caught instanceof Error
              ? caught.message
              : "Deep rewards could not be loaded",
        });
      });
    return () => controller.abort();
  }, [account, profileRefresh]);

  useEffect(() => {
    if (!account || !deepV3ReleaseAvailable) return;
    const controller = new AbortController();
    void fetchDeepV3CreatorProfile(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDeepV3Profile(data);
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setDeepV3Profile({
          status: "error",
          account,
          chainId: 1,
          tokens: [],
          errorMessage:
            caught instanceof Error
              ? caught.message
              : "Deep liquidity state could not be loaded",
        });
      });
    return () => controller.abort();
  }, [account, profileRefresh]);

  useEffect(() => {
    if (!account || !stockPairedReleaseAvailable) return;
    const controller = new AbortController();
    const confirmedTransactions = new Map(
      confirmedProfileTransactionsRef.current["stock-paired"],
    );
    void fetchStockPairedProfileRewards(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setStockPairedRewards(data);
          setStockPairedActionStates((current) =>
            clearConfirmedProfileActionStates(current, confirmedTransactions),
          );
          consumeConfirmedProfileTransactions(
            confirmedProfileTransactionsRef.current["stock-paired"],
            confirmedTransactions,
          );
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setStockPairedRewards({
          status: "error",
          account,
          chainId: 1,
          rewards: [],
          errorMessage:
            caught instanceof Error
              ? caught.message
              : "Stock-Paired rewards could not be loaded",
        });
      });
    return () => controller.abort();
  }, [account, profileRefresh]);

  function beginEditingProfile() {
    setUsernameDraft(savedProfile.username);
    setAvatarDraft(savedProfile.avatarDataUrl);
    setUsernameError("");
    setAvatarError("");
    setSaveError("");
    setEditingAccount(account?.toLowerCase() ?? "");
  }

  function cancelEditingProfile() {
    setUsernameDraft(savedProfile.username);
    setAvatarDraft(savedProfile.avatarDataUrl);
    setUsernameError("");
    setAvatarError("");
    setSaveError("");
    setEditingAccount("");
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || preparingImage) return;

    const nextUsername = normalizeProfileUsername(usernameDraft);
    const nextUsernameError = getProfileUsernameError(nextUsername);

    if (nextUsernameError) {
      setUsernameError(nextUsernameError);
      return;
    }

    const nextProfile = {
      username: nextUsername,
      avatarDataUrl: avatarDraft,
    };

    try {
      writeLocalProfile(window.localStorage, account, nextProfile);
    } catch {
      setSaveError("The profile could not be saved");
      return;
    }

    setUsernameDraft(nextUsername);
    setUsernameError("");
    setAvatarError("");
    setSaveError("");
    setEditingAccount("");
    window.dispatchEvent(
      new CustomEvent(PROFILE_UPDATED_EVENT, {
        detail: {
          address: account.toLowerCase(),
          profile: nextProfile,
        },
      }),
    );
  }

  async function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setPreparingImage(true);
    setAvatarError("");
    setSaveError("");

    try {
      setAvatarDraft(await prepareAvatarImage(file));
    } catch (caught) {
      setAvatarError(
        caught instanceof Error
          ? caught.message
          : "The image could not be prepared",
      );
    } finally {
      setPreparingImage(false);
    }
  }

  const requestedOnchainData = withoutClosedDeepProfileData(
    onchainData ?? remoteOnchainData,
  );
  const scopedOnchainData = account
    ? isProfileDataForAccount(requestedOnchainData, account)
      ? requestedOnchainData
      : loadingProfileData(account)
    : UNAVAILABLE_PROFILE_DATA;
  const scopedClassicV3Rewards =
    account &&
    classicV3Rewards.account?.toLowerCase() === account.toLowerCase()
      ? classicV3Rewards
      : EMPTY_CLASSIC_V3_PROFILE;
  const scopedDeepRewards =
    account && deepRewards.account?.toLowerCase() === account.toLowerCase()
      ? deepRewards
      : EMPTY_DEEP_PROFILE;
  const scopedDeepV3Profile =
    account && deepV3Profile.account?.toLowerCase() === account.toLowerCase()
      ? deepV3Profile
      : EMPTY_DEEP_V3_CREATOR_PROFILE;
  const scopedStockPairedRewards =
    account &&
    stockPairedRewards.account?.toLowerCase() === account.toLowerCase()
      ? stockPairedRewards
      : EMPTY_STOCK_PAIRED_PROFILE;
  const settleSubmittedTransaction = useCallback(
    async ({
      transactionHash,
      chainId,
      actionAccount,
      source,
      stateKey,
      action,
      confirmedMessage,
      revertedMessage,
      setActionState,
      manualCheck = false,
    }: {
      transactionHash: Hex;
      chainId: 1 | 11_155_111;
      actionAccount: string;
      source: PendingProfileTransactionSource;
      stateKey: string;
      action: "claim" | "update-payout";
      confirmedMessage: string;
      revertedMessage: string;
      setActionState: (
        state: Omit<ProfileClaimActionState, "account">,
      ) => void;
      manualCheck?: boolean;
    }) => {
      const pendingTransaction: PendingProfileTransactionRecord = {
        version: 1,
        account: actionAccount.toLowerCase(),
        chainId,
        source,
        stateKey,
        action,
        transactionHash,
        submittedAt: Date.now(),
      };
      persistPendingProfileTransaction(pendingTransaction);
      if (
        activeAccountRef.current?.toLowerCase() !==
        actionAccount.toLowerCase()
      ) {
        return;
      }

      const controller = new AbortController();
      transactionPollControllersRef.current.add(controller);
      setActionState({
        status: "confirming",
        message: manualCheck
          ? "Checking transaction status"
          : "Confirming on Ethereum",
        transactionHash,
      });

      try {
        const receiptStatus = await waitForTransaction(
          transactionHash,
          chainId,
          {
            maxAttempts: profileTransactionPollAttempts(manualCheck),
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          return;
        }
        if (receiptStatus === "pending") {
          setActionState({
            status: "pending",
            message: "Still pending on Ethereum. Check the status again",
            transactionHash,
          });
          return;
        }
        if (receiptStatus === "reverted") {
          forgetPendingProfileTransaction(pendingTransaction);
          setActionState({
            status: "error",
            message: revertedMessage,
            transactionHash,
          });
          return;
        }
        forgetPendingProfileTransaction(pendingTransaction);
        confirmedProfileTransactionsRef.current[source].set(
          stateKey,
          transactionHash,
        );
        setActionState({
          status: "confirmed",
          message: confirmedMessage,
          transactionHash,
        });
        setProfileRefresh((current) => current + 1);
      } catch {
        if (controller.signal.aborted) return;
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          return;
        }
        setActionState({
          status: "pending",
          message: "Status unavailable. Check the transaction again",
          transactionHash,
        });
      } finally {
        transactionPollControllersRef.current.delete(controller);
      }
    },
    [],
  );
  const submitCreatorClaim = useCallback(
    async (claim: ProfileClaim) => {
      const claimAccount = account;
      const chainId = scopedOnchainData.chainId;
      if (!claimAccount || scopedOnchainData.status !== "ready" || !chainId) {
        return;
      }

      const stateKey = claim.poolId.toLowerCase();
      const setClaimState = (
        state: Omit<ProfileClaimActionState, "account">,
      ) => {
        setClaimActionStates((current) => ({
          ...current,
          [stateKey]: { account: claimAccount, ...state },
        }));
      };

      if (chainId !== 1 && chainId !== 11_155_111) {
        setClaimState({
          status: "error",
          message: "Creator claims are not supported on this network",
        });
        return;
      }

      const existingState = claimActionStates[stateKey];
      if (
        existingState?.account.toLowerCase() === claimAccount.toLowerCase()
      ) {
        if (
          existingState.status === "pending" &&
          existingState.transactionHash
        ) {
          await settleSubmittedTransaction({
            transactionHash: existingState.transactionHash,
            chainId,
            actionAccount: claimAccount,
            source: "classic",
            stateKey,
            action: "claim",
            confirmedMessage: "Claim confirmed",
            revertedMessage: "The claim reverted onchain",
            setActionState: setClaimState,
            manualCheck: true,
          });
          return;
        }
        if (actionPending(existingState)) return;
      }

      setClaimState({
        status: "preparing",
        message: "Checking the current onchain balance",
      });

      try {
        const prepared = await prepareCreatorClaim({
          account: claimAccount,
          poolId: claim.poolId,
          tokenAddress: claim.tokenAddress,
          hookAddress: claim.hookAddress,
          chainId,
        });
        if (
          activeAccountRef.current?.toLowerCase() !== claimAccount.toLowerCase()
        ) {
          throw new Error("The connected wallet changed before submission");
        }
        if (!prepared.gas.balanceSufficient) {
          throw new Error(
            "This wallet needs more ETH to cover the network fee",
          );
        }

        setClaimState({
          status: "wallet",
          message: "Review the transaction in your wallet",
        });
        const transactionHash = await sendTransaction(prepared.transaction);
        persistPendingProfileTransaction({
          version: 1,
          account: claimAccount.toLowerCase(),
          chainId,
          source: "classic",
          stateKey,
          action: "claim",
          transactionHash,
          submittedAt: Date.now(),
        });

        if (
          activeAccountRef.current?.toLowerCase() === claimAccount.toLowerCase()
        ) {
          await settleSubmittedTransaction({
            transactionHash,
            chainId,
            actionAccount: claimAccount,
            source: "classic",
            stateKey,
            action: "claim",
            confirmedMessage: "Claim confirmed",
            revertedMessage: "The claim reverted onchain",
            setActionState: setClaimState,
          });
        }
      } catch (caught) {
        if (
          activeAccountRef.current?.toLowerCase() !== claimAccount.toLowerCase()
        ) {
          return;
        }
        setClaimState({
          status: "error",
          message:
            caught instanceof Error
              ? caught.message
              : "The creator claim could not be submitted",
        });
      }
    },
    [
      account,
      claimActionStates,
      scopedOnchainData.chainId,
      scopedOnchainData.status,
      sendTransaction,
      settleSubmittedTransaction,
    ],
  );
  const submitClassicV3Action = useCallback(
    async (
      reward: ClassicV3Reward,
      action: "claim" | "update-payout",
      newPayoutAddress?: string,
      allocationIndex?: number,
    ) => {
      const actionAccount = account;
      if (
        !classicV3ReleaseAvailable ||
        !actionAccount ||
        scopedClassicV3Rewards.status !== "ready" ||
        reward.beneficiary.toLowerCase() !== actionAccount.toLowerCase()
      ) {
        return;
      }
      const stateKey =
        action === "claim"
          ? `${reward.vaultAddress.toLowerCase()}:claim`
          : `${reward.vaultAddress.toLowerCase()}:update-payout:${allocationIndex}`;
      const setActionState = (
        state: Omit<ClassicV3ActionState, "account">,
      ) => {
        setClassicV3ActionStates((current) => ({
          ...current,
          [stateKey]: { account: actionAccount, ...state },
        }));
      };
      const existingState = classicV3ActionStates[stateKey];
      if (
        existingState?.account.toLowerCase() === actionAccount.toLowerCase()
      ) {
        if (
          existingState.status === "pending" &&
          existingState.transactionHash
        ) {
          await settleSubmittedTransaction({
            transactionHash: existingState.transactionHash,
            chainId: scopedClassicV3Rewards.chainId,
            actionAccount,
            source: "classic-v3",
            stateKey,
            action,
            confirmedMessage:
              action === "claim"
                ? "Claim confirmed"
                : "Payout address updated",
            revertedMessage: "The reward transaction reverted onchain",
            setActionState,
            manualCheck: true,
          });
          return;
        }
        if (actionPending(existingState)) return;
      }
      setActionState({
        status: "preparing",
        message: "Checking the current onchain state",
      });
      try {
        const prepared = await prepareClassicV3RewardAction({
          action,
          account: actionAccount,
          vaultAddress: reward.vaultAddress,
          newPayoutAddress,
          allocationIndex,
          chainId: scopedClassicV3Rewards.chainId,
        });
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          throw new Error("The connected wallet changed before submission");
        }
        setActionState({
          status: "wallet",
          message: "Review the transaction in your wallet",
        });
        const transactionHash = await sendTransaction(prepared.transaction);
        persistPendingProfileTransaction({
          version: 1,
          account: actionAccount.toLowerCase(),
          chainId: scopedClassicV3Rewards.chainId,
          source: "classic-v3",
          stateKey,
          action,
          transactionHash,
          submittedAt: Date.now(),
        });
        if (
          activeAccountRef.current?.toLowerCase() ===
          actionAccount.toLowerCase()
        ) {
          await settleSubmittedTransaction({
            transactionHash,
            chainId: scopedClassicV3Rewards.chainId,
            actionAccount,
            source: "classic-v3",
            stateKey,
            action,
            confirmedMessage:
              action === "claim"
                ? "Claim confirmed"
                : "Payout address updated",
            revertedMessage: "The reward transaction reverted onchain",
            setActionState,
          });
        }
      } catch (caught) {
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          return;
        }
        setActionState({
          status: "error",
          message:
            caught instanceof Error
              ? caught.message
              : "The reward action could not be submitted",
        });
      }
    },
    [
      account,
      classicV3ActionStates,
      scopedClassicV3Rewards,
      sendTransaction,
      settleSubmittedTransaction,
    ],
  );
  const submitDeepAction = useCallback(
    async (
      reward: DeepReward,
      action: "claim" | "update-payout",
      newPayoutAddress?: string,
    ) => {
      const actionAccount = account;
      if (
        !deepReleaseAvailable ||
        !actionAccount ||
        scopedDeepRewards.status !== "ready" ||
        reward.beneficiary.toLowerCase() !== actionAccount.toLowerCase()
      ) {
        return;
      }
      const stateKey = `${reward.vaultAddress.toLowerCase()}:${action}`;
      const setActionState = (
        state: Omit<DeepActionState, "account">,
      ) => {
        setDeepActionStates((current) => ({
          ...current,
          [stateKey]: { account: actionAccount, ...state },
        }));
      };
      const existingState = deepActionStates[stateKey];
      if (
        existingState?.account.toLowerCase() === actionAccount.toLowerCase()
      ) {
        if (
          existingState.status === "pending" &&
          existingState.transactionHash
        ) {
          await settleSubmittedTransaction({
            transactionHash: existingState.transactionHash,
            chainId: scopedDeepRewards.chainId,
            actionAccount,
            source: "deep",
            stateKey,
            action,
            confirmedMessage:
              action === "claim"
                ? "Claim confirmed"
                : "Payout address updated",
            revertedMessage: "The reward transaction reverted onchain",
            setActionState,
            manualCheck: true,
          });
          return;
        }
        if (actionPending(existingState)) return;
      }
      setActionState({
        status: "preparing",
        message: "Checking the current onchain state",
      });
      try {
        const prepared = await prepareDeepRewardAction({
          action,
          deepReleaseVersion: reward.deepReleaseVersion,
          account: actionAccount,
          vaultAddress: reward.vaultAddress,
          newPayoutAddress,
          chainId: scopedDeepRewards.chainId,
        });
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          throw new Error("The connected wallet changed before submission");
        }
        setActionState({
          status: "wallet",
          message: "Review the transaction in your wallet",
        });
        const transactionHash = await sendTransaction(prepared.transaction);
        persistPendingProfileTransaction({
          version: 1,
          account: actionAccount.toLowerCase(),
          chainId: scopedDeepRewards.chainId,
          source: "deep",
          stateKey,
          action,
          transactionHash,
          submittedAt: Date.now(),
        });
        if (
          activeAccountRef.current?.toLowerCase() ===
          actionAccount.toLowerCase()
        ) {
          await settleSubmittedTransaction({
            transactionHash,
            chainId: scopedDeepRewards.chainId,
            actionAccount,
            source: "deep",
            stateKey,
            action,
            confirmedMessage:
              action === "claim"
                ? "Claim confirmed"
                : "Payout address updated",
            revertedMessage: "The reward transaction reverted onchain",
            setActionState,
          });
        }
      } catch (caught) {
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          return;
        }
        setActionState({
          status: "error",
          message:
            caught instanceof Error
              ? caught.message
              : "The reward action could not be submitted",
        });
      }
    },
    [
      account,
      deepActionStates,
      scopedDeepRewards,
      sendTransaction,
      settleSubmittedTransaction,
    ],
  );
  const submitStockPairedAction = useCallback(
    async (
      reward: StockPairedReward,
      action: "claim" | "claim-as-eth" | "update-payout",
      newPayoutAddress?: string,
    ) => {
      const actionAccount = account;
      if (
        !stockPairedReleaseAvailable ||
        !actionAccount ||
        scopedStockPairedRewards.status !== "ready" ||
        reward.beneficiary.toLowerCase() !== actionAccount.toLowerCase()
      ) {
        return;
      }
      const stateKey = `${reward.vaultAddress.toLowerCase()}:${action}`;
      const setActionState = (
        state: Omit<StockPairedActionState, "account">,
      ) => {
        setStockPairedActionStates((current) => ({
          ...current,
          [stateKey]: { account: actionAccount, ...state },
        }));
      };
      const existingState = stockPairedActionStates[stateKey];
      if (
        existingState?.account.toLowerCase() === actionAccount.toLowerCase()
      ) {
        if (
          existingState.status === "pending" &&
          existingState.transactionHash
        ) {
          await settleSubmittedTransaction({
            transactionHash: existingState.transactionHash,
            chainId: scopedStockPairedRewards.chainId,
            actionAccount,
            source: "stock-paired",
            stateKey,
            action: action === "claim-as-eth" ? "claim" : action,
            confirmedMessage:
              action === "claim" || action === "claim-as-eth"
                ? "Claim confirmed"
                : "Payout address updated",
            revertedMessage: "The reward transaction reverted onchain",
            setActionState,
            manualCheck: true,
          });
          return;
        }
        if (actionPending(existingState)) return;
      }
      setActionState({
        status: "preparing",
        message: "Checking the current onchain state",
      });
      let stockClaimConfirmed = false;
      try {
        if (
          action === "claim-as-eth" &&
          reward.payoutAddress.toLowerCase() !== actionAccount.toLowerCase()
        ) {
          throw new Error(
            "Claim as ETH requires this wallet as the payout address",
          );
        }
        const rewardAmount = reward.claimableRaw;
        const prepared = await prepareStockPairedRewardAction({
          action: action === "claim-as-eth" ? "claim" : action,
          account: actionAccount,
          vaultAddress: reward.vaultAddress,
          newPayoutAddress,
          chainId: scopedStockPairedRewards.chainId,
        });
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          throw new Error("The connected wallet changed before submission");
        }
        setActionState({
          status: "wallet",
          message:
            action === "claim-as-eth"
              ? `Confirm the ${reward.quoteAssetSymbol} claim in your wallet`
              : "Review the transaction in your wallet",
        });
        let transactionHash = await sendTransaction(prepared.transaction);
        if (
          activeAccountRef.current?.toLowerCase() ===
          actionAccount.toLowerCase()
        ) {
          setActionState({
            status: "confirming",
            message:
              action === "claim-as-eth"
                ? `Claiming ${reward.quoteAssetSymbol}`
                : "Confirming on Ethereum",
            transactionHash,
          });
          const receiptStatus = await waitForTransaction(
            transactionHash,
            scopedStockPairedRewards.chainId,
          );
          if (receiptStatus === "reverted") {
            throw new Error("The reward transaction reverted onchain");
          }
          if (
            activeAccountRef.current?.toLowerCase() !==
            actionAccount.toLowerCase()
          ) {
            return;
          }
          if (action === "claim-as-eth") {
            stockClaimConfirmed = true;
            const claimTransactionHash = transactionHash;
            for (let step = 0; step < 3; step += 1) {
              setActionState({
                status: "preparing",
                message: "Preparing the ETH conversion",
                transactionHash,
              });
              let conversion:
                | Awaited<
                    ReturnType<
                      typeof prepareStockPairedRewardConversion
                    >
                  >
                | undefined;
              for (let attempt = 0; attempt < 6; attempt += 1) {
                try {
                  const deadline = (
                    BigInt(Math.floor(Date.now() / 1_000)) + 1_200n
                  ).toString();
                  conversion =
                    await prepareStockPairedRewardConversion({
                      account: actionAccount,
                      reward,
                      claimTransactionHash,
                      amountIn: rewardAmount,
                      deadline,
                      chainId: scopedStockPairedRewards.chainId,
                    });
                  break;
                } catch (conversionError) {
                  const message =
                    conversionError instanceof Error
                      ? conversionError.message
                      : "";
                  const mayBeRpcLag =
                    message.includes("not visible on both") ||
                    message.includes(
                      "could not be verified across both",
                    );
                  if (!mayBeRpcLag || attempt === 5) {
                    throw conversionError;
                  }
                  await new Promise((resolve) =>
                    window.setTimeout(resolve, 1_000),
                  );
                }
              }
              if (!conversion) {
                throw new Error("The ETH conversion could not be prepared");
              }
              if (
                activeAccountRef.current?.toLowerCase() !==
                actionAccount.toLowerCase()
              ) {
                throw new Error(
                  "The connected wallet changed during conversion",
                );
              }
              const transactionKind = conversion.transaction.kind;
              setActionState({
                status: "wallet",
                message:
                  transactionKind === "token-to-permit2"
                    ? `Approve ${reward.quoteAssetSymbol} for conversion`
                    : transactionKind === "permit2-to-router"
                      ? "Approve the Uniswap route"
                      : "Confirm the ETH conversion",
                transactionHash,
              });
              transactionHash = await sendTransaction(
                conversion.transaction,
              );
              setActionState({
                status: "confirming",
                message:
                  transactionKind === "swap"
                    ? "Converting to ETH"
                    : "Confirming approval",
                transactionHash,
              });
              const conversionStatus = await waitForTransaction(
                transactionHash,
                scopedStockPairedRewards.chainId,
              );
              if (conversionStatus === "reverted") {
                throw new Error(
                  transactionKind === "swap"
                    ? "The ETH conversion reverted onchain"
                    : "The conversion approval reverted onchain",
                );
              }
              if (transactionKind === "swap") {
                setActionState({
                  status: "confirmed",
                  message: "Claimed as ETH",
                  transactionHash,
                });
                setProfileRefresh((current) => current + 1);
                return;
              }
            }
            throw new Error(
              "The conversion needs more approval steps than expected",
            );
          }
          setActionState({
            status: "confirmed",
            message:
              action === "claim"
                ? "Claim confirmed"
                : "Payout address updated",
            transactionHash,
          });
          setProfileRefresh((current) => current + 1);
        }
      } catch (caught) {
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          return;
        }
        setActionState({
          status: "error",
          message: stockClaimConfirmed
            ? "The stock is safely in your wallet. The ETH conversion was not completed."
            : caught instanceof Error
              ? caught.message
              : "The reward action could not be submitted",
        });
        if (stockClaimConfirmed) {
          setProfileRefresh((current) => current + 1);
        }
      }
    },
    [
      account,
      scopedStockPairedRewards,
      sendTransaction,
      settleSubmittedTransaction,
      stockPairedActionStates,
    ],
  );
  const displayName = account
    ? savedProfile.username || "Profile"
    : "Profile";
  const avatarImage = editingProfile ? avatarDraft : savedProfile.avatarDataUrl;
  const avatarFallback = account
    ? (savedProfile.username || account.slice(2, 4)).slice(0, 2).toUpperCase()
    : "P";

  if (!account) {
    return (
      <div className={`${styles.page} page-width`}>
        <section className={styles.connectCard}>
          <Image
            className={styles.connectMark}
            src="/brand/loop/programmable-loop-mark-512.png"
            alt=""
            width={512}
            height={512}
            sizes="(max-width: 700px) 72px, 188px"
            priority
          />
          <h1>Profile</h1>
          <p>Connect to view your tokens, rewards and project settings.</p>
          <button
            className={styles.connectButton}
            type="button"
            onClick={openWallet}
          >
            Connect wallet
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className={`${styles.page} page-width`}>
      <section
        className={`${styles.hero} ${
          editingProfile ? styles.heroEditing : ""
        }`}
      >
        <div className={styles.avatar}>
          {avatarImage ? (
            <Image
              src={avatarImage}
              alt={`${displayName} profile image`}
              fill
              sizes="96px"
              unoptimized
            />
          ) : (
            <span aria-hidden="true">{avatarFallback}</span>
          )}
        </div>

        <div className={styles.heroCopy}>
          <div className={styles.nameRow}>
            <h1>{displayName}</h1>
            {!editingProfile ? (
              <button
                className={styles.editButton}
                type="button"
                onClick={beginEditingProfile}
              >
                Edit
              </button>
            ) : null}
          </div>
          <p className={styles.address}>{shortenAddress(account)}</p>

          {editingProfile ? (
            <form className={styles.editForm} onSubmit={saveProfile}>
              <div className={styles.editGrid}>
                <div className={styles.imageControl}>
                  <span className={styles.fieldLabel}>Profile image</span>
                  <input
                    ref={fileInputRef}
                    hidden
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={selectAvatar}
                  />
                  <div className={styles.imageActions}>
                    <button
                      className={styles.imageAction}
                      type="button"
                      disabled={preparingImage}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {preparingImage ? "Preparing…" : "Choose image"}
                    </button>
                    {avatarDraft ? (
                      <button
                        className={styles.imageAction}
                        type="button"
                        disabled={preparingImage}
                        onClick={() => {
                          setAvatarDraft("");
                          setAvatarError("");
                          setSaveError("");
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className={styles.usernameControl}>
                  <label
                    className={styles.fieldLabel}
                    htmlFor="profile-username"
                  >
                    Username
                  </label>
                  <div className={styles.usernameRow}>
                    <input
                      id="profile-username"
                      value={usernameDraft}
                      autoComplete="nickname"
                      maxLength={12}
                      pattern="[A-Za-z0-9]{3,12}"
                      aria-invalid={Boolean(usernameError)}
                      aria-describedby="profile-username-help"
                      onChange={(event) => {
                        setUsernameDraft(event.target.value);
                        setUsernameError("");
                        setSaveError("");
                      }}
                      autoFocus
                    />
                    <button
                      className={`${styles.editAction} ${styles.saveAction}`}
                      type="submit"
                      disabled={preparingImage}
                    >
                      Save
                    </button>
                    <button
                      className={styles.editAction}
                      type="button"
                      disabled={preparingImage}
                      onClick={cancelEditingProfile}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
              <p
                id="profile-username-help"
                className={`${styles.formHelp} ${
                  usernameError || avatarError || saveError
                    ? styles.formError
                    : ""
                }`}
                role={
                  usernameError || avatarError || saveError
                    ? "alert"
                    : undefined
                }
              >
                {usernameError ||
                  avatarError ||
                  saveError ||
                  "3–12 letters or numbers · square JPG, PNG or WebP"}
              </p>
            </form>
          ) : null}
        </div>
      </section>

      <ProfileAccountWorkspace
        connected={Boolean(account)}
        data={scopedOnchainData}
        account={account}
        claimActionStates={claimActionStates}
        classicV3Rewards={scopedClassicV3Rewards}
        classicV3ActionStates={classicV3ActionStates}
        deepRewards={scopedDeepRewards}
        deepActionStates={deepActionStates}
        deepV3Profile={scopedDeepV3Profile}
        stockPairedRewards={scopedStockPairedRewards}
        stockPairedActionStates={stockPairedActionStates}
        onClaim={submitCreatorClaim}
        onClassicV3Action={submitClassicV3Action}
        onDeepAction={submitDeepAction}
        onStockPairedAction={submitStockPairedAction}
        onConnect={openWallet}
        onRetry={() => setProfileRefresh((current) => current + 1)}
      />
    </div>
  );
}

export type ProfileTokenReward = {
  token: ProfileToken;
  claim?: ProfileClaim;
};

export type ProfilePortfolioEntry = ProfileTokenReward & {
  classicRewards: readonly ClassicV3Reward[];
  deepRewards: readonly DeepReward[];
  stockPairedRewards: readonly StockPairedReward[];
  deepV3Token?: DeepV3CreatorToken;
  launchedByWallet: boolean;
};

export function groupProfileRewards(
  tokens: readonly ProfileToken[],
  claims: readonly ProfileClaim[],
): ProfileTokenReward[] {
  const claimByToken = new Map(
    claims.map((claim) => [claim.tokenAddress.toLowerCase(), claim]),
  );

  return tokens.map((token) => ({
    token,
    claim: claimByToken.get(token.address.toLowerCase()),
  }));
}

export function sortProfileTokensByMarketCap(tokens: readonly ProfileToken[]) {
  const marketCapSource = profileMarketCapSource(tokens);

  return [...tokens].sort((first, second) =>
    compareProfileTokensByMarketCap(first, second, marketCapSource),
  );
}

function unsignedProfileMarketCap(value: string | undefined) {
  return value && /^(0|[1-9]\d*)$/.test(value) && value.length <= 78
    ? BigInt(value)
    : null;
}

function profileMarketCapSource(tokens: readonly ProfileToken[]) {
  return tokens.some(
    (token) => unsignedProfileMarketCap(token.fdvUsdWad) !== null,
  )
    ? ("usd" as const)
    : ("eth" as const);
}

function profileMarketCap(
  token: ProfileToken,
  source: "usd" | "eth",
) {
  return unsignedProfileMarketCap(
    source === "usd" ? token.fdvUsdWad : token.marketCapEthWei,
  );
}

function compareProfileTokensByMarketCap(
  first: ProfileToken,
  second: ProfileToken,
  source: "usd" | "eth",
) {
  const firstCap = profileMarketCap(first, source);
  const secondCap = profileMarketCap(second, source);

  if (firstCap !== null && secondCap !== null && firstCap !== secondCap) {
    return firstCap > secondCap ? -1 : 1;
  }
  if (firstCap !== null && secondCap === null) return -1;
  if (firstCap === null && secondCap !== null) return 1;

  const nameOrder = first.name.localeCompare(second.name);
  if (nameOrder !== 0) return nameOrder;
  return first.address
    .toLowerCase()
    .localeCompare(second.address.toLowerCase());
}

export function buildProfilePortfolio(
  tokens: readonly ProfileToken[],
  claims: readonly ProfileClaim[],
  classicRewards: readonly ClassicV3Reward[],
  deepRewards: readonly DeepReward[] = [],
  deepV3Tokens: readonly DeepV3CreatorToken[] = [],
  stockPairedRewards: readonly StockPairedReward[] = [],
) {
  const entries = new Map<string, ProfilePortfolioEntry>();

  for (const { token, claim } of groupProfileRewards(tokens, claims)) {
    entries.set(token.address.toLowerCase(), {
      token,
      claim,
      classicRewards: [],
      deepRewards: [],
      stockPairedRewards: [],
      deepV3Token: undefined,
      launchedByWallet: true,
    });
  }

  for (const claim of claims) {
    const key = claim.tokenAddress.toLowerCase();
    if (entries.has(key)) continue;
    entries.set(key, {
      token: {
        address: claim.tokenAddress,
        name: claim.tokenName,
        symbol: claim.tokenSymbol,
        launchedAt: "",
        href: claim.href,
        launchModel: "classic",
      },
      claim,
      classicRewards: [],
      deepRewards: [],
      stockPairedRewards: [],
      deepV3Token: undefined,
      launchedByWallet: false,
    });
  }

  for (const reward of classicRewards) {
    const key = reward.tokenAddress.toLowerCase();
    const current = entries.get(key);
    const currentRewards = current?.classicRewards ?? [];
    if (
      currentRewards.some(
        (item) =>
          item.vaultAddress.toLowerCase() ===
          reward.vaultAddress.toLowerCase(),
      )
    ) {
      continue;
    }
    entries.set(key, {
      token:
        current?.token ??
        ({
          address: reward.tokenAddress,
          name: reward.tokenName,
          symbol: reward.tokenSymbol,
          launchedAt: "",
          href: `/token/${reward.tokenAddress}`,
          launchModel: "classic",
        } satisfies ProfileToken),
      claim: current?.claim,
      classicRewards: [...currentRewards, reward],
      deepRewards: current?.deepRewards ?? [],
      stockPairedRewards: current?.stockPairedRewards ?? [],
      deepV3Token: current?.deepV3Token,
      launchedByWallet: current?.launchedByWallet ?? false,
    });
  }

  for (const reward of deepRewards) {
    const key = reward.tokenAddress.toLowerCase();
    const current = entries.get(key);
    const currentRewards = current?.deepRewards ?? [];
    if (
      currentRewards.some(
        (item) =>
          item.vaultAddress.toLowerCase() ===
          reward.vaultAddress.toLowerCase(),
      )
    ) {
      continue;
    }
    entries.set(key, {
      token:
        current?.token ??
        ({
          address: reward.tokenAddress,
          name: reward.tokenName,
          symbol: reward.tokenSymbol,
          launchedAt: "",
          href: `/token/${reward.tokenAddress}`,
          ...(reward.imageUrl ? { imageUrl: reward.imageUrl } : {}),
          launchModel: "deep",
        } satisfies ProfileToken),
      claim: current?.claim,
      classicRewards: current?.classicRewards ?? [],
      deepRewards: [...currentRewards, reward],
      stockPairedRewards: current?.stockPairedRewards ?? [],
      deepV3Token: current?.deepV3Token,
      launchedByWallet: current?.launchedByWallet ?? false,
    });
  }

  for (const reward of stockPairedRewards) {
    const key = reward.tokenAddress.toLowerCase();
    const current = entries.get(key);
    const currentRewards = current?.stockPairedRewards ?? [];
    if (
      currentRewards.some(
        (item) =>
          item.vaultAddress.toLowerCase() ===
          reward.vaultAddress.toLowerCase(),
      )
    ) {
      continue;
    }
    entries.set(key, {
      token:
        current?.token ??
        ({
          address: reward.tokenAddress,
          name: reward.tokenName,
          symbol: reward.tokenSymbol,
          launchedAt: "",
          href: `/token/${reward.tokenAddress}`,
          ...(reward.imageUrl ? { imageUrl: reward.imageUrl } : {}),
          launchModel: "stock-paired",
        } satisfies ProfileToken),
      claim: current?.claim,
      classicRewards: current?.classicRewards ?? [],
      deepRewards: current?.deepRewards ?? [],
      stockPairedRewards: [...currentRewards, reward],
      deepV3Token: current?.deepV3Token,
      launchedByWallet: current?.launchedByWallet ?? false,
    });
  }

  for (const deepV3Token of deepV3Tokens) {
    const key = deepV3Token.tokenAddress.toLowerCase();
    const current = entries.get(key);
    if (
      current?.deepV3Token &&
      current.deepV3Token.vaultAddress.toLowerCase() !==
        deepV3Token.vaultAddress.toLowerCase()
    ) {
      throw new Error("Deep V3 token has conflicting liquidity state");
    }
    entries.set(key, {
      token: deepV3CreatorTokenToProfileToken(deepV3Token),
      claim: current?.claim,
      classicRewards: current?.classicRewards ?? [],
      deepRewards: current?.deepRewards ?? [],
      stockPairedRewards: current?.stockPairedRewards ?? [],
      deepV3Token,
      launchedByWallet: true,
    });
  }

  const portfolio = [...entries.values()];
  const marketCapSource = profileMarketCapSource(
    portfolio.map((entry) => entry.token),
  );
  return portfolio.sort((first, second) =>
    compareProfileTokensByMarketCap(
      first.token,
      second.token,
      marketCapSource,
    ),
  );
}

export function profileClaimableWei(
  entries: readonly ProfilePortfolioEntry[],
  account?: string,
) {
  return entries.reduce(
    (total, entry) => total + profileEntryClaimableWei(entry, account),
    0n,
  );
}

function profileEntryClaimableWei(
  entry: ProfilePortfolioEntry,
  account?: string,
) {
  const normalizedAccount = account?.toLowerCase();

  return (
    BigInt(entry.claim?.claimableWei ?? "0") +
    entry.classicRewards.reduce(
      (total, reward) =>
        total +
        (!normalizedAccount ||
        reward.beneficiary.toLowerCase() === normalizedAccount
          ? BigInt(reward.claimableWei)
          : 0n),
      0n,
    ) +
    entry.deepRewards.reduce(
      (total, reward) =>
        total +
        (!normalizedAccount ||
        reward.beneficiary.toLowerCase() === normalizedAccount
          ? BigInt(reward.claimableWei)
          : 0n),
      0n,
    )
  );
}

export function profileHasRewardSurface(
  entries: readonly ProfilePortfolioEntry[],
) {
  return entries.some(
    (entry) =>
      Boolean(entry.claim) ||
      entry.classicRewards.length > 0 ||
      entry.deepRewards.length > 0 ||
      entry.stockPairedRewards.length > 0,
  );
}

export function profileRewardsForAccount<
  Reward extends { beneficiary: string },
>(
  rewards: readonly Reward[],
  account?: string,
) {
  if (!account) return [];
  const normalizedAccount = account.toLowerCase();
  return rewards.filter(
    (reward) =>
      reward.beneficiary.toLowerCase() === normalizedAccount,
  );
}

function ProfileAccountWorkspace({
  connected,
  data,
  account,
  claimActionStates,
  classicV3Rewards,
  classicV3ActionStates,
  deepRewards,
  deepActionStates,
  deepV3Profile,
  stockPairedRewards,
  stockPairedActionStates,
  onClaim,
  onClassicV3Action,
  onDeepAction,
  onStockPairedAction,
  onConnect,
  onRetry,
}: {
  connected: boolean;
  data: ProfileOnchainData;
  account?: string;
  claimActionStates: Record<string, ProfileClaimActionState>;
  classicV3Rewards: ClassicV3ProfileRewards;
  classicV3ActionStates: Record<string, ClassicV3ActionState>;
  deepRewards: DeepProfileRewards;
  deepActionStates: Record<string, DeepActionState>;
  deepV3Profile: DeepV3CreatorProfile;
  stockPairedRewards: StockPairedProfileRewards;
  stockPairedActionStates: Record<string, StockPairedActionState>;
  onClaim: (claim: ProfileClaim) => void;
  onClassicV3Action: (
    reward: ClassicV3Reward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
    allocationIndex?: number,
  ) => void;
  onDeepAction: (
    reward: DeepReward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
  onStockPairedAction: (
    reward: StockPairedReward,
    action: "claim" | "claim-as-eth" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
  onConnect: () => void;
  onRetry: () => void;
}) {
  if (!connected) {
    return (
      <section className={styles.accountState}>
        <h2>Connect your wallet</h2>
        <p>Connect to see your launches and claimable rewards.</p>
        <button
          className={styles.connectButton}
          type="button"
          onClick={onConnect}
        >
          Connect wallet
        </button>
      </section>
    );
  }

  const currentReady = data.status === "ready";
  const classicReady = classicV3Rewards.status === "ready";
  const deepReady = deepRewards.status === "ready";
  const deepV3Ready = deepV3Profile.status === "ready";
  const stockPairedReady = stockPairedRewards.status === "ready";
  const loading =
    data.status === "loading" ||
    classicV3Rewards.status === "loading" ||
    deepRewards.status === "loading" ||
    deepV3Profile.status === "loading" ||
    stockPairedRewards.status === "loading";

  if (
    !currentReady &&
    !classicReady &&
    !deepReady &&
    !deepV3Ready &&
    !stockPairedReady
  ) {
    return (
      <section
        className={styles.accountState}
        aria-busy={loading}
        aria-live="polite"
      >
        <h2>{loading ? "Loading profile" : "Unable to load profile"}</h2>
        <p>
          {loading
            ? "Reading your launches and rewards."
            : data.status === "error" && data.errorMessage
              ? data.errorMessage
              : classicV3Rewards.status === "error" &&
                  classicV3Rewards.errorMessage
                ? classicV3Rewards.errorMessage
                : deepRewards.status === "error" &&
                    deepRewards.errorMessage
                  ? deepRewards.errorMessage
                  : deepV3Profile.status === "error" &&
                      deepV3Profile.errorMessage
                    ? deepV3Profile.errorMessage
                  : stockPairedRewards.status === "error" &&
                      stockPairedRewards.errorMessage
                    ? stockPairedRewards.errorMessage
                  : "Check your connection and try again."}
        </p>
        {!loading ? (
          <button
            className={styles.retryButton}
            type="button"
            onClick={onRetry}
          >
            Try again
          </button>
        ) : null}
      </section>
    );
  }

  const entries = buildProfilePortfolio(
    currentReady ? data.tokens : [],
    currentReady ? data.claims : [],
    classicReady ? classicV3Rewards.rewards : [],
    deepReady ? deepRewards.rewards : [],
    deepV3Ready ? deepV3Profile.tokens : [],
    stockPairedReady ? stockPairedRewards.rewards : [],
  );
  const hasRewardSurface = profileHasRewardSurface(entries);
  const nativeClaimable = profileClaimableWei(entries, account);
  const stockRewardCount = entries.reduce(
    (total, entry) =>
      total +
      profileRewardsForAccount(entry.stockPairedRewards, account).filter(
        (reward) => BigInt(reward.claimableRaw) > 0n,
      ).length,
    0,
  );
  const sourceWarning =
    data.status === "error"
      ? data.errorMessage || "Some token rewards could not be refreshed"
      : classicV3Rewards.status === "error"
        ? classicV3Rewards.errorMessage ||
          "Some Classic rewards could not be refreshed"
        : deepRewards.status === "error"
          ? deepRewards.errorMessage ||
            "Some Deep rewards could not be refreshed"
          : deepV3Profile.status === "error"
            ? deepV3Profile.errorMessage ||
              "Some Deep liquidity state could not be refreshed"
          : stockPairedRewards.status === "error"
            ? stockPairedRewards.errorMessage ||
              "Some Stock-Paired rewards could not be refreshed"
        : "";

  return (
    <section
      className={styles.portfolio}
      aria-labelledby="profile-portfolio-title"
    >
      <header className={styles.portfolioHeader}>
        <div className={styles.portfolioTitle}>
          <h2 id="profile-portfolio-title">Tokens</h2>
        </div>

        <div className={styles.portfolioStats}>
          <div className={styles.portfolioStat}>
            <span>Tokens</span>
            <strong>{entries.length}</strong>
          </div>
          {hasRewardSurface ? (
            <div className={`${styles.portfolioStat} ${styles.portfolioTotal}`}>
              <span>Claimable</span>
              <strong>
                {nativeClaimable > 0n
                  ? formatWei(nativeClaimable)
                  : stockRewardCount > 0
                    ? `${stockRewardCount} ${
                        stockRewardCount === 1 ? "reward" : "rewards"
                      }`
                    : formatWei(0n)}
              </strong>
              {nativeClaimable > 0n && stockRewardCount > 0 ? (
                <small>
                  + {stockRewardCount} quote{" "}
                  {stockRewardCount === 1 ? "reward" : "rewards"}
                </small>
              ) : null}
            </div>
          ) : null}
        </div>

      </header>

      {sourceWarning ? (
        <div className={styles.sourceWarning} role="status">
          <span>{sourceWarning}</span>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}

      {entries.length ? (
        <div className={styles.ledger}>
          <div className={styles.ledgerHeader} aria-hidden="true">
            <span>Token</span>
            <span>Market cap</span>
            <span>Creator rewards</span>
            <span />
          </div>
          <div className={styles.list}>
            {entries.map((entry) => (
              <ProfilePortfolioRow
                key={entry.token.address}
                entry={entry}
                account={account}
                chainId={
                  currentReady
                    ? data.chainId
                    : classicReady
                      ? classicV3Rewards.chainId
                      : deepReady
                        ? deepRewards.chainId
                        : deepV3Ready
                          ? deepV3Profile.chainId
                          : stockPairedReady
                            ? stockPairedRewards.chainId
                            : undefined
                }
                claimActionStates={claimActionStates}
                classicV3ActionStates={classicV3ActionStates}
                deepActionStates={deepActionStates}
                stockPairedActionStates={stockPairedActionStates}
                onClaim={onClaim}
                onClassicV3Action={onClassicV3Action}
                onDeepAction={onDeepAction}
                onStockPairedAction={onStockPairedAction}
              />
            ))}
          </div>
        </div>
      ) : (
        <ProfileSectionEmpty
          title="No tokens"
          detail="Tokens created by this wallet will appear here."
          actionHref="/launch"
          actionLabel="Create token"
        />
      )}
    </section>
  );
}

function transactionHref(chainId: number | undefined, hash: Hex) {
  return `${
    chainId === 11_155_111
      ? "https://sepolia.etherscan.io"
      : "https://etherscan.io"
  }/tx/${hash}`;
}

export function actionPending(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  return (
    state?.status === "preparing" ||
    state?.status === "wallet" ||
    state?.status === "confirming"
  );
}

export function actionCanCheckStatus(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  return state?.status === "pending" && Boolean(state.transactionHash);
}

export function actionLabel(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  if (state?.status === "preparing") return "Preparing";
  if (state?.status === "wallet") return "Confirm in wallet";
  if (state?.status === "confirming") return "Confirming";
  if (actionCanCheckStatus(state)) return "Check status";
  if (state?.status === "confirmed") return "Confirmed";
  if (state?.status === "error") return "Try again";
  return "Claim";
}

function payoutActionLabel(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  if (state?.status === "preparing") return "Preparing";
  if (state?.status === "wallet") return "Confirm in wallet";
  if (state?.status === "confirming") return "Confirming";
  if (actionCanCheckStatus(state)) return "Check status";
  if (state?.status === "confirmed") return "Updated";
  if (state?.status === "error") return "Try again";
  return "Save";
}

function ProfilePortfolioRow({
  entry,
  account,
  chainId,
  claimActionStates,
  classicV3ActionStates,
  deepActionStates,
  stockPairedActionStates,
  onClaim,
  onClassicV3Action,
  onDeepAction,
  onStockPairedAction,
}: {
  entry: ProfilePortfolioEntry;
  account?: string;
  chainId?: number;
  claimActionStates: Record<string, ProfileClaimActionState>;
  classicV3ActionStates: Record<string, ClassicV3ActionState>;
  deepActionStates: Record<string, DeepActionState>;
  stockPairedActionStates: Record<string, StockPairedActionState>;
  onClaim: (claim: ProfileClaim) => void;
  onClassicV3Action: (
    reward: ClassicV3Reward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
    allocationIndex?: number,
  ) => void;
  onDeepAction: (
    reward: DeepReward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
  onStockPairedAction: (
    reward: StockPairedReward,
    action: "claim" | "claim-as-eth" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
}) {
  const {
    token,
    claim,
    classicRewards,
    deepRewards,
    stockPairedRewards,
    deepV3Token,
  } = entry;
  const claimState = claim
    ? claimActionStates[claim.poolId.toLowerCase()]
    : undefined;
  const activeClaimState =
    claimState?.account.toLowerCase() === account?.toLowerCase()
      ? claimState
      : undefined;
  const ownedClassicRewards = profileRewardsForAccount(
    classicRewards,
    account,
  );
  const classicClaims = ownedClassicRewards.map((reward) => {
    const state =
      classicV3ActionStates[
        `${reward.vaultAddress.toLowerCase()}:claim`
      ];
    return {
      reward,
      claimable: BigInt(reward.claimableWei),
      state:
        state?.account.toLowerCase() === account?.toLowerCase()
          ? state
          : undefined,
    };
  });
  const ownedDeepRewards = profileRewardsForAccount(deepRewards, account);
  const deepClaims = ownedDeepRewards.map((reward) => {
    const state =
      deepActionStates[
        `${reward.vaultAddress.toLowerCase()}:claim`
      ];
    return {
      reward,
      claimable: BigInt(reward.claimableWei),
      state:
        state?.account.toLowerCase() === account?.toLowerCase()
          ? state
          : undefined,
    };
  });
  const ownedStockPairedRewards = profileRewardsForAccount(
    stockPairedRewards,
    account,
  );
  const stockPairedClaims = ownedStockPairedRewards.map((reward) => {
    const claimState =
      stockPairedActionStates[
        `${reward.vaultAddress.toLowerCase()}:claim`
      ];
    const ethState =
      stockPairedActionStates[
        `${reward.vaultAddress.toLowerCase()}:claim-as-eth`
      ];
    return {
      reward,
      claimable: BigInt(reward.claimableRaw),
      claimState:
        claimState?.account.toLowerCase() === account?.toLowerCase()
          ? claimState
          : undefined,
      ethState:
        ethState?.account.toLowerCase() === account?.toLowerCase()
          ? ethState
          : undefined,
    };
  });
  const currentClaimable = BigInt(claim?.claimableWei ?? "0");
  const classicClaimable = classicClaims.reduce(
    (total, item) => total + item.claimable,
    0n,
  );
  const deepClaimable = deepClaims.reduce(
    (total, item) => total + item.claimable,
    0n,
  );
  const totalClaimable =
    currentClaimable + classicClaimable + deepClaimable;
  const hasRewardSurface =
    Boolean(claim) ||
    ownedClassicRewards.length > 0 ||
    ownedDeepRewards.length > 0 ||
    ownedStockPairedRewards.length > 0;
  const stockPairedClaimable = stockPairedClaims.reduce(
    (total, item) => total + item.claimable,
    0n,
  );
  const stockQuoteSymbol =
    ownedStockPairedRewards[0]?.quoteAssetSymbol;
  const marketCap = formatMarketCap(token);
  const tokenImage =
    token.imageUrl?.trim() || getFallbackTokenImage(token.address);
  const tokenImageSource = getTokenCardImageSource(tokenImage);
  const currentClaimAvailable =
    Boolean(claim) && (currentClaimable > 0n || Boolean(activeClaimState));
  const classicClaimCount = classicClaims.filter(
    ({ claimable, state }) => claimable > 0n || Boolean(state),
  ).length;
  const deepClaimCount = deepClaims.filter(
    ({ claimable, state }) => claimable > 0n || Boolean(state),
  ).length;
  const stockClaimCount = stockPairedClaims.filter(
    ({ claimable, claimState, ethState }) =>
      claimable > 0n || Boolean(claimState) || Boolean(ethState),
  ).length;
  const claimSourceCount =
    Number(currentClaimAvailable) +
    classicClaimCount +
    deepClaimCount +
    stockClaimCount;
  const formattedStockReward =
    stockPairedClaimable > 0n && stockQuoteSymbol
      ? `${new Intl.NumberFormat("en-US", {
        maximumSignificantDigits: 5,
        }).format(Number(formatUnits(stockPairedClaimable, 18)))} ${
          stockQuoteSymbol
        }`
      : "";
  const hasClaimableReward =
    totalClaimable > 0n || stockPairedClaimable > 0n;
  const advancedSettingsCount =
    ownedClassicRewards.length +
    ownedDeepRewards.length +
    ownedStockPairedRewards.length +
    Number(Boolean(deepV3Token));

  return (
    <article
      className={`${styles.tokenRow} ${
        hasClaimableReward ? styles.tokenRowClaimable : ""
      }`}
    >
      <div className={styles.tokenMain}>
        <Link className={styles.tokenIdentity} href={token.href}>
          <span className={styles.tokenArt}>
            <Image
              src={tokenImageSource}
              alt={`${token.name} project artwork`}
              fill
              sizes="58px"
              unoptimized={!canOptimizeTokenImage(tokenImageSource)}
            />
          </span>
          <span className={styles.tokenCopy}>
            <span className={styles.tokenNameRow}>
              <strong>{token.name}</strong>
              <span className={styles.tokenSymbol}>${token.symbol}</span>
            </span>
          </span>
        </Link>

        <div className={`${styles.metric} ${styles.marketMetric}`}>
          <span>Market cap</span>
          <strong>{marketCap ?? "—"}</strong>
        </div>

        <div
          className={`${styles.metric} ${styles.rewardMetric} ${
            hasClaimableReward ? styles.rewardMetricReady : ""
          }`}
        >
          <span>
            {deepV3Token && !hasRewardSurface
              ? "Liquidity added"
              : hasClaimableReward
                ? "Ready to claim"
                : "Creator rewards"}
          </span>
          <strong>
            {deepV3Token && !hasRewardSurface
              ? formatWei(BigInt(deepV3Token.totalNativeAddedWei))
              : totalClaimable > 0n
                ? formatWei(totalClaimable)
                : formattedStockReward || formatWei(0n)}
          </strong>
          {totalClaimable > 0n && formattedStockReward ? (
            <small>+ {formattedStockReward}</small>
          ) : null}
        </div>

        <div className={styles.actions}>
          {claim && currentClaimAvailable ? (
            <button
              className={styles.claimButton}
              type="button"
              aria-label={`${actionLabel(activeClaimState)} ${token.name} position rewards`}
              disabled={
                actionPending(activeClaimState) ||
                activeClaimState?.status === "confirmed" ||
                (currentClaimable === 0n &&
                  !actionCanCheckStatus(activeClaimState))
              }
              onClick={() => onClaim(claim)}
            >
              {activeClaimState
                ? actionLabel(activeClaimState)
                : claimSourceCount > 1
                  ? "Claim position"
                  : "Claim"}
            </button>
          ) : null}
          {classicClaims.map(({ reward, claimable, state }) =>
            claimable > 0n || state ? (
              <button
                className={styles.claimButton}
                type="button"
                aria-label={`${actionLabel(state)} ${token.name} rewards from ${shortenAddress(reward.vaultAddress)}`}
                disabled={
                  actionPending(state) ||
                  state?.status === "confirmed" ||
                  (claimable === 0n && !actionCanCheckStatus(state))
                }
                onClick={() => onClassicV3Action(reward, "claim")}
              key={reward.vaultAddress}
            >
                {state
                  ? actionLabel(state)
                  : claimSourceCount > 1
                    ? "Claim Classic"
                    : "Claim"}
              </button>
            ) : null,
          )}
          {deepClaims.map(({ reward, claimable, state }) =>
            claimable > 0n || state ? (
              <button
                className={styles.claimButton}
                type="button"
                aria-label={`${actionLabel(state)} ${token.name} Deep rewards from ${shortenAddress(reward.vaultAddress)}`}
                disabled={
                  actionPending(state) ||
                  state?.status === "confirmed" ||
                  (claimable === 0n && !actionCanCheckStatus(state))
                }
                onClick={() => onDeepAction(reward, "claim")}
              key={reward.vaultAddress}
            >
                {state
                  ? actionLabel(state)
                  : claimSourceCount > 1
                    ? "Claim Deep"
                    : "Claim"}
              </button>
            ) : null,
          )}
          {stockPairedClaims.map(
            ({ reward, claimable, claimState, ethState }) => {
              if (
                claimable === 0n &&
                !claimState &&
                !ethState
              ) {
                return null;
              }
              const pending =
                actionPending(claimState) || actionPending(ethState);
              const completed =
                claimState?.status === "confirmed" ||
                ethState?.status === "confirmed";
              const estimate = formatStockRewardEstimate(reward);
              const canClaimAsEth =
                Boolean(estimate) &&
                reward.payoutAddress.toLowerCase() ===
                  account?.toLowerCase();
              return (
                <div
                  className={styles.stockClaimActions}
                  key={reward.vaultAddress}
                >
                  {estimate ? (
                    <span className={styles.stockClaimEstimate}>
                      {estimate}
                    </span>
                  ) : null}
                  <div className={styles.stockClaimButtons}>
                    <button
                      className={styles.secondaryAction}
                      type="button"
                      aria-label={`Claim ${token.name} rewards as ${reward.quoteAssetSymbol}`}
                      disabled={
                        pending || completed || claimable === 0n
                      }
                      onClick={() =>
                        onStockPairedAction(reward, "claim")
                      }
                    >
                      {claimState
                        ? actionLabel(claimState)
                        : "Claim stock"}
                    </button>
                    <button
                      className={styles.claimButton}
                      type="button"
                      aria-label={`Claim ${token.name} rewards as ETH`}
                      title={
                        canClaimAsEth
                          ? undefined
                          : reward.payoutAddress.toLowerCase() !==
                              account?.toLowerCase()
                            ? "Use this wallet as the payout address to claim as ETH"
                            : "The ETH estimate is temporarily unavailable"
                      }
                      disabled={
                        pending ||
                        completed ||
                        claimable === 0n ||
                        !canClaimAsEth
                      }
                      onClick={() =>
                        onStockPairedAction(
                          reward,
                          "claim-as-eth",
                        )
                      }
                    >
                      {ethState
                        ? actionLabel(ethState)
                        : "Claim as ETH"}
                    </button>
                  </div>
                </div>
              );
            },
          )}
        </div>
      </div>

      <ProfileActionState
        state={activeClaimState}
        chainId={chainId}
      />
      {classicClaims.map(({ reward, state }) => (
        <ProfileActionState
          key={`${reward.vaultAddress}:state`}
          state={state}
          chainId={chainId}
        />
      ))}
      {deepClaims.map(({ reward, state }) => (
        <ProfileActionState
          key={`${reward.vaultAddress}:deep-state`}
          state={state}
          chainId={chainId}
        />
      ))}
      {stockPairedClaims.map(({ reward, claimState, ethState }) => {
        const visibleState =
          [claimState, ethState].find((state) => actionPending(state)) ??
          [claimState, ethState].find(
            (state) => state?.status === "confirmed",
          ) ??
          claimState ??
          ethState;
        return (
          <ProfileActionState
            key={`${reward.vaultAddress}:stock-paired-state`}
            state={visibleState}
            chainId={chainId}
          />
        );
      })}

      {advancedSettingsCount > 0 ? (
        <details className={styles.advancedSettings}>
          <summary>
            <span>Reward settings</span>
            <small>Payouts, fee terms and splits</small>
          </summary>
          <div className={styles.advancedSettingsBody}>
            {deepV3Token ? (
              <DeepV3GrowthState token={deepV3Token} />
            ) : null}

            {ownedClassicRewards.map((reward) => (
              <ClassicRewardSettings
                key={reward.vaultAddress}
                reward={reward}
                account={account}
                actionStates={classicV3ActionStates}
                chainId={chainId}
                onAction={onClassicV3Action}
              />
            ))}
            {ownedDeepRewards.map((reward) => (
              <DeepRewardSettings
                key={`${reward.vaultAddress}:${reward.payoutAddress}`}
                reward={reward}
                account={account}
                actionStates={deepActionStates}
                chainId={chainId}
                onAction={onDeepAction}
              />
            ))}
            {ownedStockPairedRewards.map((reward) => (
              <StockPairedRewardSettings
                key={`${reward.vaultAddress}:${reward.payoutAddress}`}
                reward={reward}
                account={account}
                actionStates={stockPairedActionStates}
                chainId={chainId}
                onAction={onStockPairedAction}
              />
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function DeepV3GrowthState({ token }: { token: DeepV3CreatorToken }) {
  const compoundCount = BigInt(token.compoundCount);
  return (
    <section
      className={styles.rewardSettingGroup}
      aria-labelledby={`liquidity-growth-${token.vaultAddress}`}
    >
      <header className={styles.rewardSettingHeader}>
        <h3 id={`liquidity-growth-${token.vaultAddress}`}>
          Liquidity growth
        </h3>
        <p>
          {compoundCount === 0n
            ? "No compounds yet"
            : `${compoundCount.toString()} ${
                compoundCount === 1n ? "compound" : "compounds"
              }`}
        </p>
      </header>
      <div className={styles.settingsBody}>
        <dl className={styles.rewardTerms}>
          <div>
            <dt>Added</dt>
            <dd>{formatWei(BigInt(token.totalNativeAddedWei))}</dd>
          </div>
          <div>
            <dt>Pending</dt>
            <dd>{formatWei(BigInt(token.pendingGrowthNativeWei))}</dd>
          </div>
          <div>
            <dt>Received</dt>
            <dd>{formatWei(BigInt(token.totalGrowthEthReceivedWei))}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function ProfileActionState({
  state,
  chainId,
}: {
  state?: ProfileClaimActionState | ClassicV3ActionState;
  chainId?: number;
}) {
  if (!state) return null;
  return (
    <p
      className={
        state.status === "error" ? styles.rowError : styles.actionState
      }
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
      {state.transactionHash ? (
        <a
          href={transactionHref(chainId, state.transactionHash)}
          target="_blank"
          rel="noreferrer"
        >
          View transaction
        </a>
      ) : null}
    </p>
  );
}

function ClassicRewardSettings({
  reward,
  account,
  actionStates,
  chainId,
  onAction,
}: {
  reward: ClassicV3Reward;
  account?: string;
  actionStates: Record<string, ClassicV3ActionState>;
  chainId?: number;
  onAction: (
    reward: ClassicV3Reward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
    allocationIndex?: number,
  ) => void;
}) {
  return (
    <section className={styles.rewardSettingGroup}>
      <header className={styles.rewardSettingHeader}>
        <h3>Classic rewards</h3>
        <p>
          {reward.shareBps > 0
            ? `${(reward.shareBps / 100).toFixed(2)}% current share`
            : "Historic rewards"}
        </p>
      </header>
      <div className={styles.settingsBody}>
        <dl className={styles.rewardTerms}>
          <div>
            <dt>Buy fee</dt>
            <dd>{(reward.buySwapFeeBps / 100).toFixed(2)}%</dd>
          </div>
          <div>
            <dt>Sell fee</dt>
            <dd>{(reward.sellSwapFeeBps / 100).toFixed(2)}%</dd>
          </div>
          <div>
            <dt>Your share</dt>
            <dd>{(reward.shareBps / 100).toFixed(2)}%</dd>
          </div>
        </dl>

        {reward.ownedAllocations.map((allocation) => (
          <ClassicAllocationSettings
            key={`${allocation.allocationIndex}:${allocation.payoutAddress}`}
            reward={reward}
            allocation={allocation}
            account={account}
            actionStates={actionStates}
            chainId={chainId}
            onAction={onAction}
          />
        ))}

        {reward.beneficiaries.length > 1 ? (
          <div className={styles.split}>
            <span className={styles.splitLabel}>Current reward split</span>
            <div className={styles.splitList}>
              {reward.beneficiaries.map((item) => (
                <div
                  className={styles.splitItem}
                  key={item.allocationIndex}
                >
                  <span>{shortenAddress(item.payoutAddress)}</span>
                  <strong>{(item.shareBps / 100).toFixed(2)}%</strong>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ClassicAllocationSettings({
  reward,
  allocation,
  account,
  actionStates,
  chainId,
  onAction,
}: {
  reward: ClassicV3Reward;
  allocation: ClassicV3Beneficiary;
  account?: string;
  actionStates: Record<string, ClassicV3ActionState>;
  chainId?: number;
  onAction: (
    reward: ClassicV3Reward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
    allocationIndex?: number,
  ) => void;
}) {
  const [editingPayout, setEditingPayout] = useState(false);
  const [payoutDraft, setPayoutDraft] = useState<string>(
    allocation.payoutAddress,
  );
  const rawPayoutState =
    actionStates[
      `${reward.vaultAddress.toLowerCase()}:update-payout:${allocation.allocationIndex}`
    ];
  const payoutState =
    rawPayoutState?.account.toLowerCase() === account?.toLowerCase()
      ? rawPayoutState
      : undefined;
  const ownsAllocation =
    Boolean(account) &&
    allocation.payoutAddress.toLowerCase() === account?.toLowerCase();
  const payoutPending = actionPending(payoutState);

  return (
    <div className={styles.payout}>
      <span className={styles.payoutLabel}>
        Payout · {(allocation.shareBps / 100).toFixed(2)}%
      </span>
      {editingPayout ? (
        <div className={styles.payoutEdit}>
          <input
            value={payoutDraft}
            spellCheck={false}
            autoComplete="off"
            aria-label={`New payout address for allocation ${allocation.allocationIndex + 1}`}
            disabled={payoutPending || actionCanCheckStatus(payoutState)}
            onChange={(event) => setPayoutDraft(event.target.value)}
          />
          <button
            className={styles.secondaryAction}
            type="button"
            disabled={
              !ownsAllocation ||
              payoutPending ||
              payoutState?.status === "confirmed"
            }
            onClick={() =>
              onAction(
                reward,
                "update-payout",
                payoutDraft.trim(),
                allocation.allocationIndex,
              )
            }
          >
            {payoutActionLabel(payoutState)}
          </button>
          <button
            className={styles.textAction}
            type="button"
            disabled={payoutPending || actionCanCheckStatus(payoutState)}
            onClick={() => {
              setPayoutDraft(allocation.payoutAddress);
              setEditingPayout(false);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className={styles.payoutRow}>
          <a
            href={`${
              chainId === 11_155_111
                ? "https://sepolia.etherscan.io"
                : "https://etherscan.io"
            }/address/${allocation.payoutAddress}`}
            target="_blank"
            rel="noreferrer"
          >
            {shortenAddress(allocation.payoutAddress)}
          </a>
          <button
            className={styles.textAction}
            type="button"
            disabled={!ownsAllocation}
            onClick={() => setEditingPayout(true)}
          >
            Change
          </button>
        </div>
      )}
      <ProfileActionState state={payoutState} chainId={chainId} />
    </div>
  );
}

function StockPairedRewardSettings({
  reward,
  account,
  actionStates,
  chainId,
  onAction,
}: {
  reward: StockPairedReward;
  account?: string;
  actionStates: Record<string, StockPairedActionState>;
  chainId?: number;
  onAction: (
    reward: StockPairedReward,
    action: "claim" | "claim-as-eth" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
}) {
  const [editingPayout, setEditingPayout] = useState(false);
  const [payoutDraft, setPayoutDraft] = useState<string>(
    reward.payoutAddress,
  );
  const rawPayoutState =
    actionStates[`${reward.vaultAddress.toLowerCase()}:update-payout`];
  const payoutState =
    rawPayoutState?.account.toLowerCase() === account?.toLowerCase()
      ? rawPayoutState
      : undefined;
  const ownsReward =
    Boolean(account) &&
    reward.beneficiary.toLowerCase() === account?.toLowerCase();
  const payoutPending = actionPending(payoutState);

  return (
    <section className={styles.rewardSettingGroup}>
      <header className={styles.rewardSettingHeader}>
        <h3>
          Stock-Paired rewards · {reward.quoteAssetSymbol}
        </h3>
        <p>{shortenAddress(reward.payoutAddress)}</p>
      </header>
      <div className={styles.settingsBody}>
        <dl className={styles.rewardTerms}>
          <div>
            <dt>Swap fee</dt>
            <dd>1.00%</dd>
          </div>
          <div>
            <dt>Your share</dt>
            <dd>{(reward.shareBps / 100).toFixed(2)}%</dd>
          </div>
          <div>
            <dt>Paid in</dt>
            <dd>{reward.quoteAssetSymbol}</dd>
          </div>
        </dl>

        <div className={styles.payout}>
          <span className={styles.payoutLabel}>Payout address</span>
          {editingPayout ? (
            <div className={styles.payoutEdit}>
              <input
                value={payoutDraft}
                spellCheck={false}
                autoComplete="off"
                aria-label="New Stock-Paired payout address"
                disabled={
                  payoutPending || actionCanCheckStatus(payoutState)
                }
                onChange={(event) => setPayoutDraft(event.target.value)}
              />
              <button
                className={styles.secondaryAction}
                type="button"
                disabled={
                  !ownsReward ||
                  payoutPending ||
                  payoutState?.status === "confirmed"
                }
                onClick={() =>
                  onAction(reward, "update-payout", payoutDraft.trim())
                }
              >
                {payoutActionLabel(payoutState)}
              </button>
              <button
                className={styles.textAction}
                type="button"
                disabled={
                  payoutPending || actionCanCheckStatus(payoutState)
                }
                onClick={() => {
                  setPayoutDraft(reward.payoutAddress);
                  setEditingPayout(false);
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className={styles.payoutRow}>
              <a
                href={`${
                  chainId === 11_155_111
                    ? "https://sepolia.etherscan.io"
                    : "https://etherscan.io"
                }/address/${reward.payoutAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortenAddress(reward.payoutAddress)}
              </a>
              <button
                className={styles.textAction}
                type="button"
                disabled={
                  !ownsReward ||
                  actionPending(payoutState) ||
                  actionCanCheckStatus(payoutState)
                }
                onClick={() => setEditingPayout(true)}
              >
                Change
              </button>
            </div>
          )}
          <ProfileActionState state={payoutState} chainId={chainId} />
        </div>

        {reward.beneficiaries.length > 1 ? (
          <div className={styles.split}>
            <span className={styles.splitLabel}>Fixed reward split</span>
            <div className={styles.splitList}>
              {reward.beneficiaries.map((item) => (
                <div className={styles.splitItem} key={item.beneficiary}>
                  <span>{shortenAddress(item.beneficiary)}</span>
                  <strong>{(item.shareBps / 100).toFixed(2)}%</strong>
                  <small>to {shortenAddress(item.payoutAddress)}</small>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DeepRewardSettings({
  reward,
  account,
  actionStates,
  chainId,
  onAction,
}: {
  reward: DeepReward;
  account?: string;
  actionStates: Record<string, DeepActionState>;
  chainId?: number;
  onAction: (
    reward: DeepReward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
}) {
  const [editingPayout, setEditingPayout] = useState(false);
  const [payoutDraft, setPayoutDraft] = useState<string>(
    reward.payoutAddress,
  );
  const rawPayoutState =
    actionStates[`${reward.vaultAddress.toLowerCase()}:update-payout`];
  const payoutState =
    rawPayoutState?.account.toLowerCase() === account?.toLowerCase()
      ? rawPayoutState
      : undefined;
  const ownsReward =
    Boolean(account) &&
    reward.beneficiary.toLowerCase() === account?.toLowerCase();
  const payoutPending = actionPending(payoutState);
  const growthTarget = BigInt(reward.growthTargetWei);
  const growthAdded = BigInt(reward.nativeAddedToLiquidityWei);
  const progressBps =
    reward.growthTargetReached
      ? 10_000
      : growthTarget === 0n
      ? 0
      : Number(
          (minimumBigInt(growthAdded, growthTarget) * 10_000n) /
            growthTarget,
        );
  const deferredRewards = BigInt(reward.deferredRewardFeesWei);
  const automationLabels = [
    "No work ready",
    "Creator fees ready",
    "Liquidity update ready",
    "Oracle update ready",
  ] as const;
  const cooldownEnds = BigInt(reward.nextCompoundTimestamp);
  const cooldownDate =
    cooldownEnds > 0n && cooldownEnds <= 253_402_300_799n
      ? new Date(Number(cooldownEnds) * 1_000).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        })
      : null;

  return (
    <section className={styles.rewardSettingGroup}>
      <header className={styles.rewardSettingHeader}>
        <h3>
          Deep liquidity ·{" "}
          {reward.growthTargetReached
            ? "Target reached"
            : `${(progressBps / 100).toFixed(2)}% added`}
        </h3>
        <p>{shortenAddress(reward.payoutAddress)}</p>
      </header>
      <div className={styles.settingsBody}>
        <div>
          <dl className={styles.rewardTerms}>
            <div>
              <dt>Liquidity added</dt>
              <dd>{formatEth(reward.nativeAddedToLiquidityEth)}</dd>
            </div>
            <div>
              <dt>Growth target</dt>
              <dd>{formatEth(reward.growthTargetEth)}</dd>
            </div>
            <div>
              <dt>Your reward share</dt>
              <dd>{(reward.shareBps / 100).toFixed(2)}%</dd>
            </div>
            {deferredRewards > 0n ? (
              <div>
                <dt>Rewards deferred</dt>
                <dd>{formatEth(reward.deferredRewardFeesEth)}</dd>
              </div>
            ) : null}
            {reward.automationAction > 0 ? (
              <div>
                <dt>Permissionless work</dt>
                <dd>{automationLabels[reward.automationAction]}</dd>
              </div>
            ) : null}
            {cooldownDate ? (
              <div>
                <dt>Cooldown ends</dt>
                <dd>{cooldownDate} UTC</dd>
              </div>
            ) : null}
          </dl>
          <p className={styles.formHelp}>
            Creator fees deepen the locked pool before rewards begin. The
            150M reserve stays locked, and unused reserve is not active
            liquidity. Automation is not guaranteed.
          </p>
        </div>

        <div className={styles.payout}>
          <span className={styles.payoutLabel}>Payout address</span>
          {editingPayout ? (
            <div className={styles.payoutEdit}>
              <input
                value={payoutDraft}
                spellCheck={false}
                autoComplete="off"
                aria-label="New Deep payout address"
                disabled={
                  payoutPending || actionCanCheckStatus(payoutState)
                }
                onChange={(event) => setPayoutDraft(event.target.value)}
              />
              <button
                className={styles.secondaryAction}
                type="button"
                disabled={
                  !ownsReward ||
                  payoutPending ||
                  payoutState?.status === "confirmed"
                }
                onClick={() =>
                  onAction(reward, "update-payout", payoutDraft.trim())
                }
              >
                {payoutActionLabel(payoutState)}
              </button>
              <button
                className={styles.textAction}
                type="button"
                disabled={
                  payoutPending || actionCanCheckStatus(payoutState)
                }
                onClick={() => {
                  setPayoutDraft(reward.payoutAddress);
                  setEditingPayout(false);
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className={styles.payoutRow}>
              <a
                href={`${
                  chainId === 11_155_111
                    ? "https://sepolia.etherscan.io"
                    : "https://etherscan.io"
                }/address/${reward.payoutAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortenAddress(reward.payoutAddress)}
              </a>
              <button
                className={styles.textAction}
                type="button"
                disabled={
                  !ownsReward ||
                  actionPending(payoutState) ||
                  actionCanCheckStatus(payoutState)
                }
                onClick={() => setEditingPayout(true)}
              >
                Change
              </button>
            </div>
          )}
          <ProfileActionState state={payoutState} chainId={chainId} />
        </div>
      </div>
    </section>
  );
}

function minimumBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
}

function ProfileSectionEmpty({
  title,
  detail,
  actionHref,
  actionLabel,
}: {
  title: string;
  detail: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className={styles.emptySection}>
      <strong>{title}</strong>
      <p>{detail}</p>
      {actionHref && actionLabel ? (
        <Link className={styles.emptyAction} href={actionHref}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
