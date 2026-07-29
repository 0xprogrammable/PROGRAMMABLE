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
import { isConfiguredDeepV3ReleaseReady } from "@/lib/deep-v3-release";
import { prepareAvatarImage } from "@/lib/profile/avatar";
import {
  EMPTY_CLASSIC_V3_PROFILE,
  fetchClassicV3ProfileRewards,
  prepareClassicV3RewardAction,
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
  isConfiguredDeepReleaseReady,
  prepareDeepRewardAction,
  type DeepProfileRewards,
  type DeepReward,
} from "@/lib/profile/deep-rewards";
import {
  EMPTY_STOCK_PAIRED_PROFILE,
  fetchStockPairedProfileRewards,
  isConfiguredStockPairedRewardsReady,
  prepareStockPairedRewardAction,
  type StockPairedProfileRewards,
  type StockPairedReward,
} from "@/lib/profile/stock-paired-rewards";
import { prepareCreatorClaim } from "@/lib/profile/creator-claim";
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
const deepReleaseAvailable = isConfiguredDeepReleaseReady();
const deepV3ReleaseAvailable =
  isConfiguredDeepV3ReleaseReady(profileEnvironment);
const stockPairedReleaseAvailable =
  isConfiguredStockPairedRewardsReady();

type ProfileClaimActionState = {
  account: string;
  status: "preparing" | "wallet" | "confirming" | "confirmed" | "error";
  message: string;
  transactionHash?: Hex;
};

type ClassicV3ActionState = {
  account: string;
  status: "preparing" | "wallet" | "confirming" | "confirmed" | "error";
  message: string;
  transactionHash?: Hex;
};

type DeepActionState = ClassicV3ActionState;
type StockPairedActionState = ClassicV3ActionState;

export type ProfileViewProps = {
  onchainData?: ProfileOnchainData;
};

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

function formatMarketCap(token: ProfileToken) {
  if (token.fdvUsdWad) {
    const dollars = Number(BigInt(token.fdvUsdWad) / 10n ** 18n);
    if (Number.isFinite(dollars)) {
      if (dollars >= 1_000_000_000) {
        return `$${(dollars / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B MC`;
      }
      if (dollars >= 1_000_000) {
        return `$${(dollars / 1_000_000).toFixed(1).replace(/\.0$/, "")}M MC`;
      }
      if (dollars >= 1_000) {
        return `$${(dollars / 1_000).toFixed(1).replace(/\.0$/, "")}K MC`;
      }
      return `$${dollars.toLocaleString("en-US")} MC`;
    }
  }
  if (token.marketCapEthWei) {
    return `${formatEth(formatUnits(BigInt(token.marketCapEthWei), 18))} MC`;
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
      }).format(value)} ${token.quoteAssetSymbol} MC`;
    }
  }
  return null;
}

async function waitForTransaction(
  transactionHash: Hex,
  chainId: number,
): Promise<"confirmed" | "reverted"> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(
      `/api/transaction-status?hash=${encodeURIComponent(
        transactionHash,
      )}&chainId=${chainId}`,
      {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );
    const body = (await response.json()) as {
      status?: "pending" | "confirmed" | "reverted";
    };
    if (!response.ok) {
      throw new Error("The transaction status could not be checked");
    }
    if (body.status === "confirmed" || body.status === "reverted") {
      return body.status;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  throw new Error("The transaction is still pending");
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

export function ProfileView({ onchainData }: ProfileViewProps = {}) {
  const { wallet, openWallet, sendTransaction } = useWallet();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const account = wallet?.account;
  const activeAccountRef = useRef(account);
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

  useEffect(() => {
    activeAccountRef.current = account;
  }, [account]);

  useEffect(() => {
    if (onchainData) return;
    if (!account) return;

    const controller = new AbortController();

    void fetchCreatorProfile(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setRemoteOnchainData(data);
          if (profileRefresh > 0) setClaimActionStates({});
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
    void fetchClassicV3ProfileRewards(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setClassicV3Rewards(data);
          if (profileRefresh > 0) setClassicV3ActionStates({});
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
    void fetchDeepProfileRewards(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDeepRewards(data);
          if (profileRefresh > 0) setDeepActionStates({});
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
    void fetchStockPairedProfileRewards(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setStockPairedRewards(data);
          if (profileRefresh > 0) setStockPairedActionStates({});
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

  const requestedOnchainData = onchainData ?? remoteOnchainData;
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

        if (
          activeAccountRef.current?.toLowerCase() === claimAccount.toLowerCase()
        ) {
          setClaimState({
            status: "confirming",
            message: "Confirming on Ethereum",
            transactionHash,
          });
          const receiptStatus = await waitForTransaction(
            transactionHash,
            chainId,
          );
          if (receiptStatus === "reverted") {
            throw new Error("The claim reverted onchain");
          }
          if (
            activeAccountRef.current?.toLowerCase() !==
            claimAccount.toLowerCase()
          ) {
            return;
          }
          setClaimState({
            status: "confirmed",
            message: "Claim confirmed",
            transactionHash,
          });
          setProfileRefresh((current) => current + 1);
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
      scopedOnchainData.chainId,
      scopedOnchainData.status,
      sendTransaction,
    ],
  );
  const submitClassicV3Action = useCallback(
    async (
      reward: ClassicV3Reward,
      action: "claim" | "update-payout",
      newPayoutAddress?: string,
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
      const stateKey = `${reward.vaultAddress.toLowerCase()}:${action}`;
      const setActionState = (
        state: Omit<ClassicV3ActionState, "account">,
      ) => {
        setClassicV3ActionStates((current) => ({
          ...current,
          [stateKey]: { account: actionAccount, ...state },
        }));
      };
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
        if (
          activeAccountRef.current?.toLowerCase() ===
          actionAccount.toLowerCase()
        ) {
          setActionState({
            status: "confirming",
            message: "Confirming on Ethereum",
            transactionHash,
          });
          const receiptStatus = await waitForTransaction(
            transactionHash,
            scopedClassicV3Rewards.chainId,
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
          message:
            caught instanceof Error
              ? caught.message
              : "The reward action could not be submitted",
        });
      }
    },
    [account, scopedClassicV3Rewards, sendTransaction],
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
        if (
          activeAccountRef.current?.toLowerCase() ===
          actionAccount.toLowerCase()
        ) {
          setActionState({
            status: "confirming",
            message: "Confirming on Ethereum",
            transactionHash,
          });
          const receiptStatus = await waitForTransaction(
            transactionHash,
            scopedDeepRewards.chainId,
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
          message:
            caught instanceof Error
              ? caught.message
              : "The reward action could not be submitted",
        });
      }
    },
    [account, scopedDeepRewards, sendTransaction],
  );
  const submitStockPairedAction = useCallback(
    async (
      reward: StockPairedReward,
      action: "claim" | "update-payout",
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
      setActionState({
        status: "preparing",
        message: "Checking the current onchain state",
      });
      try {
        const prepared = await prepareStockPairedRewardAction({
          action,
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
          message: "Review the transaction in your wallet",
        });
        const transactionHash = await sendTransaction(prepared.transaction);
        if (
          activeAccountRef.current?.toLowerCase() ===
          actionAccount.toLowerCase()
        ) {
          setActionState({
            status: "confirming",
            message: "Confirming on Ethereum",
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
          message:
            caught instanceof Error
              ? caught.message
              : "The reward action could not be submitted",
        });
      }
    },
    [account, scopedStockPairedRewards, sendTransaction],
  );
  const displayName = account
    ? savedProfile.username || "Your profile"
    : "Your profile";
  const avatarImage = editingProfile ? avatarDraft : savedProfile.avatarDataUrl;
  const avatarFallback = account
    ? (savedProfile.username || account.slice(2, 4)).slice(0, 2).toUpperCase()
    : "P";

  if (!account) {
    return (
      <div className={`${styles.page} page-width`}>
        <section className={styles.connectCard}>
          <h1>Connect your wallet</h1>
          <p>Connect to view your tokens and claim creator rewards</p>
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
                    className="sr-only"
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
  return [...tokens].sort(compareProfileTokensByMarketCap);
}

function compareProfileTokensByMarketCap(
  first: ProfileToken,
  second: ProfileToken,
) {
  const firstCap = first.fdvUsdWad ?? first.marketCapEthWei;
  const secondCap = second.fdvUsdWad ?? second.marketCapEthWei;

  if (firstCap && secondCap && firstCap !== secondCap) {
    return BigInt(firstCap) > BigInt(secondCap) ? -1 : 1;
  }
  if (firstCap && !secondCap) return -1;
  if (!firstCap && secondCap) return 1;

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

  return [...entries.values()].sort((first, second) =>
    compareProfileTokensByMarketCap(first.token, second.token),
  );
}

export function profileClaimableWei(
  entries: readonly ProfilePortfolioEntry[],
  account?: string,
) {
  const normalizedAccount = account?.toLowerCase();

  return entries.reduce(
    (total, entry) =>
      total +
      BigInt(entry.claim?.claimableWei ?? "0") +
      entry.classicRewards.reduce(
        (rewardTotal, reward) =>
          rewardTotal +
          (!normalizedAccount ||
          reward.beneficiary.toLowerCase() === normalizedAccount
            ? BigInt(reward.claimableWei)
            : 0n),
        0n,
      ) +
      entry.deepRewards.reduce(
        (rewardTotal, reward) =>
          rewardTotal +
          (!normalizedAccount ||
          reward.beneficiary.toLowerCase() === normalizedAccount
            ? BigInt(reward.claimableWei)
            : 0n),
        0n,
      ),
    0n,
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
  ) => void;
  onDeepAction: (
    reward: DeepReward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
  onStockPairedAction: (
    reward: StockPairedReward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
  onConnect: () => void;
  onRetry: () => void;
}) {
  if (!connected) {
    return (
      <section className={styles.accountState}>
        <h2>Connect your wallet</h2>
        <p>Your tokens and creator rewards will appear here</p>
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
      <section className={styles.accountState} aria-live="polite">
        <h2>{loading ? "Loading your profile" : "Your profile could not be loaded"}</h2>
        <p>
          {loading
            ? "Reading your tokens and rewards"
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
                  : "Try again in a moment"}
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
          <h2 id="profile-portfolio-title">Your tokens</h2>
          <p>
            {entries.length} {entries.length === 1 ? "token" : "tokens"}
          </p>
        </div>
        {hasRewardSurface ? (
          <div className={styles.portfolioTotal}>
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
          </div>
        ) : null}
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
      ) : (
        <ProfileSectionEmpty
          title="No tokens yet"
          detail="Tokens and creator rewards connected to this wallet will appear here"
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

function actionPending(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  return (
    state?.status === "preparing" ||
    state?.status === "wallet" ||
    state?.status === "confirming"
  );
}

function actionLabel(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  if (state?.status === "preparing") return "Preparing";
  if (state?.status === "wallet") return "Confirm in wallet";
  if (state?.status === "confirming") return "Confirming";
  if (state?.status === "confirmed") return "Confirmed";
  if (state?.status === "error") return "Try again";
  return "Claim";
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
  ) => void;
  onDeepAction: (
    reward: DeepReward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
  onStockPairedAction: (
    reward: StockPairedReward,
    action: "claim" | "update-payout",
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
    const state =
      stockPairedActionStates[
        `${reward.vaultAddress.toLowerCase()}:claim`
      ];
    return {
      reward,
      claimable: BigInt(reward.claimableRaw),
      state:
        state?.account.toLowerCase() === account?.toLowerCase()
          ? state
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

  return (
    <article className={styles.tokenRow}>
      <div className={styles.tokenMain}>
        <Link className={styles.tokenIdentity} href={token.href}>
          <span className={styles.tokenArt}>
            <Image
              src={tokenImage}
              alt={`${token.name} token image`}
              fill
              sizes="52px"
              unoptimized={!tokenImage.startsWith("/")}
            />
          </span>
          <span className={styles.tokenCopy}>
            <strong>{token.name}</strong>
            <span className={styles.tokenSymbol}>${token.symbol}</span>
            <span className={styles.tokenAddress}>
              {shortenAddress(token.address)}
            </span>
          </span>
        </Link>

        <div className={`${styles.metric} ${styles.marketMetric}`}>
          <span>Market cap</span>
          <strong>{marketCap ?? "—"}</strong>
        </div>

        <div className={`${styles.metric} ${styles.rewardMetric}`}>
          <span>
            {deepV3Token && !hasRewardSurface
              ? "Liquidity added"
              : "Rewards"}
          </span>
          <strong>
            {deepV3Token && !hasRewardSurface
              ? formatWei(BigInt(deepV3Token.totalNativeAddedWei))
              : stockPairedClaimable > 0n && stockQuoteSymbol
                ? `${new Intl.NumberFormat("en-US", {
                    maximumSignificantDigits: 7,
                  }).format(
                    Number(formatUnits(stockPairedClaimable, 18)),
                  )} ${stockQuoteSymbol}`
              : formatWei(totalClaimable)}
          </strong>
        </div>

        <div className={styles.actions}>
          {claim && (currentClaimable > 0n || activeClaimState) ? (
            <button
              className={styles.claimButton}
              type="button"
              aria-label={`${actionLabel(activeClaimState)} ${token.name} position rewards`}
              disabled={
                actionPending(activeClaimState) ||
                activeClaimState?.status === "confirmed" ||
                currentClaimable === 0n
              }
              onClick={() => onClaim(claim)}
            >
              {activeClaimState
                ? actionLabel(activeClaimState)
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
                  claimable === 0n
                }
                onClick={() => onClassicV3Action(reward, "claim")}
                key={reward.vaultAddress}
              >
                {state
                  ? actionLabel(state)
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
                  claimable === 0n
                }
                onClick={() => onDeepAction(reward, "claim")}
                key={reward.vaultAddress}
              >
                {state
                  ? actionLabel(state)
                  : "Claim"}
              </button>
            ) : null,
          )}
          {stockPairedClaims.map(({ reward, claimable, state }) =>
            claimable > 0n || state ? (
              <button
                className={styles.claimButton}
                type="button"
                aria-label={`${actionLabel(state)} ${token.name} Stock-Paired rewards`}
                disabled={
                  actionPending(state) ||
                  state?.status === "confirmed" ||
                  claimable === 0n
                }
                onClick={() => onStockPairedAction(reward, "claim")}
                key={reward.vaultAddress}
              >
                {state ? actionLabel(state) : "Claim"}
              </button>
            ) : null,
          )}
          <Link className={styles.openToken} href={token.href}>
            View
          </Link>
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
      {stockPairedClaims.map(({ reward, state }) => (
        <ProfileActionState
          key={`${reward.vaultAddress}:stock-state`}
          state={state}
          chainId={chainId}
        />
      ))}

      {deepV3Token ? (
        <DeepV3GrowthState token={deepV3Token} />
      ) : null}

      {ownedClassicRewards.map((reward) => (
        <ClassicRewardSettings
          key={`${reward.vaultAddress}:${reward.payoutAddress}`}
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
    </article>
  );
}

function DeepV3GrowthState({ token }: { token: DeepV3CreatorToken }) {
  const compoundCount = BigInt(token.compoundCount);
  return (
    <details className={styles.rewardSettings}>
      <summary>
        <span>Liquidity growth</span>
        <small>
          {compoundCount === 0n
            ? "No compounds yet"
            : `${compoundCount.toString()} ${
                compoundCount === 1n ? "compound" : "compounds"
              }`}
        </small>
      </summary>
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
    </details>
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
    <details className={styles.rewardSettings}>
      <summary>
        <span>
          Reward payout · {(reward.shareBps / 100).toFixed(2)}%
        </span>
        <small>{shortenAddress(reward.payoutAddress)}</small>
      </summary>
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

        <div className={styles.payout}>
          <span className={styles.payoutLabel}>Payout address</span>
          {editingPayout ? (
            <div className={styles.payoutEdit}>
              <input
                value={payoutDraft}
                spellCheck={false}
                autoComplete="off"
                aria-label="New payout address"
                onChange={(event) => setPayoutDraft(event.target.value)}
              />
              <button
                className={styles.secondaryAction}
                type="button"
                disabled={!ownsReward || payoutPending}
                onClick={() =>
                  onAction(reward, "update-payout", payoutDraft.trim())
                }
              >
                {payoutState?.status === "wallet"
                  ? "Confirm in wallet"
                  : payoutState?.status === "confirming"
                    ? "Confirming"
                    : "Save"}
              </button>
              <button
                className={styles.textAction}
                type="button"
                disabled={payoutPending}
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
                disabled={!ownsReward}
                onClick={() => setEditingPayout(true)}
              >
                Change
              </button>
            </div>
          )}
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

        <ProfileActionState state={payoutState} chainId={chainId} />
      </div>
    </details>
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

  return (
    <details className={styles.rewardSettings}>
      <summary>
        <span>
          Stock-Paired rewards · {reward.quoteAssetSymbol}
        </span>
        <small>{shortenAddress(reward.payoutAddress)}</small>
      </summary>
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
                onChange={(event) => setPayoutDraft(event.target.value)}
              />
              <button
                className={styles.secondaryAction}
                type="button"
                disabled={!ownsReward || payoutPending}
                onClick={() =>
                  onAction(reward, "update-payout", payoutDraft.trim())
                }
              >
                {payoutState?.status === "wallet"
                  ? "Confirm in wallet"
                  : payoutState?.status === "confirming"
                    ? "Confirming"
                    : "Save"}
              </button>
              <button
                className={styles.textAction}
                type="button"
                disabled={payoutPending}
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
                href={`https://etherscan.io/address/${reward.payoutAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortenAddress(reward.payoutAddress)}
              </a>
              <button
                className={styles.textAction}
                type="button"
                disabled={!ownsReward}
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
    </details>
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
    <details className={styles.rewardSettings}>
      <summary>
        <span>
          Deep liquidity ·{" "}
          {reward.growthTargetReached
            ? "Target reached"
            : `${(progressBps / 100).toFixed(2)}% added`}
        </span>
        <small>{shortenAddress(reward.payoutAddress)}</small>
      </summary>
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
                onChange={(event) => setPayoutDraft(event.target.value)}
              />
              <button
                className={styles.secondaryAction}
                type="button"
                disabled={!ownsReward || payoutPending}
                onClick={() =>
                  onAction(reward, "update-payout", payoutDraft.trim())
                }
              >
                {payoutState?.status === "wallet"
                  ? "Confirm in wallet"
                  : payoutState?.status === "confirming"
                    ? "Confirming"
                    : "Save"}
              </button>
              <button
                className={styles.textAction}
                type="button"
                disabled={payoutPending}
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
                disabled={!ownsReward}
                onClick={() => setEditingPayout(true)}
              >
                Change
              </button>
            </div>
          )}
          <ProfileActionState state={payoutState} chainId={chainId} />
        </div>
      </div>
    </details>
  );
}

function minimumBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
}

function ProfileSectionEmpty({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className={styles.emptySection}>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
