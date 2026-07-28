"use client";

import Image from "next/image";
import Link from "next/link";
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
import { prepareAvatarImage } from "@/lib/profile/avatar";
import {
  EMPTY_CLASSIC_V3_PROFILE,
  fetchClassicV3ProfileRewards,
  prepareClassicV3RewardAction,
  type ClassicV3ProfileRewards,
  type ClassicV3Reward,
} from "@/lib/profile/classic-v3-rewards";
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

type ProfileClaimActionState = {
  account: string;
  status: "preparing" | "wallet" | "submitted" | "error";
  message: string;
  transactionHash?: `0x${string}`;
};

type ClassicV3ActionState = {
  account: string;
  status: "preparing" | "wallet" | "submitted" | "error";
  message: string;
};

export type ProfileViewProps = {
  onchainData?: ProfileOnchainData;
};

function shortenAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function formatEth(value?: string) {
  if (!value?.trim()) return "—";
  return value.trim().toUpperCase().endsWith("ETH")
    ? value.trim()
    : `${value.trim()} ETH`;
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
  const [claimActionStates, setClaimActionStates] = useState<
    Record<string, ProfileClaimActionState>
  >({});
  const [classicV3ActionStates, setClassicV3ActionStates] = useState<
    Record<string, ClassicV3ActionState>
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
        if (!controller.signal.aborted) setRemoteOnchainData(data);
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
    if (!account) return;
    const controller = new AbortController();
    void fetchClassicV3ProfileRewards(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setClassicV3Rewards(data);
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
            status: "submitted",
            message: `Transaction submitted ${shortenAddress(transactionHash)}`,
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
        await sendTransaction(prepared.transaction);
        if (
          activeAccountRef.current?.toLowerCase() ===
          actionAccount.toLowerCase()
        ) {
          setActionState({
            status: "submitted",
            message: "Transaction submitted",
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
  const displayName = account
    ? savedProfile.username || shortenAddress(account)
    : "Your profile";
  const avatarImage = editingProfile ? avatarDraft : savedProfile.avatarDataUrl;
  const avatarFallback = account
    ? (savedProfile.username || account.slice(2, 4)).slice(0, 2).toUpperCase()
    : "P";

  return (
    <div className="profile-page page-width">
      <section
        className={`profile-hero${editingProfile ? " profile-hero-editing" : ""}`}
      >
        <div className="profile-avatar">
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

        <div className="profile-hero-copy">
          <div className="profile-name-row">
            <h1>{displayName}</h1>
            {account && !editingProfile ? (
              <button
                className="secondary-button profile-edit-button"
                type="button"
                onClick={beginEditingProfile}
              >
                Edit
              </button>
            ) : null}
          </div>
          <p>
            {account
              ? shortenAddress(account)
              : "Connect a wallet to manage your tokens and creator fee claims"}
          </p>

          {account ? (
            editingProfile ? (
              <form className="profile-edit-form" onSubmit={saveProfile}>
                <div className="profile-image-control">
                  <span>Profile image</span>
                  <input
                    ref={fileInputRef}
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={selectAvatar}
                  />
                  <div>
                    <button
                      className="profile-image-action"
                      type="button"
                      disabled={preparingImage}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {preparingImage ? "Preparing…" : "Choose image"}
                    </button>
                    {avatarDraft ? (
                      <button
                        className="profile-image-action"
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
                  <small
                    className={avatarError ? "form-error" : undefined}
                    role={avatarError ? "alert" : undefined}
                  >
                    {avatarError ||
                      "Square crop · JPG, PNG or WebP · up to 8 MB"}
                  </small>
                </div>

                <label htmlFor="profile-username">
                  Username <span>Optional</span>
                </label>
                <div className="profile-edit-row">
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
                    className="profile-edit-action profile-edit-save"
                    type="submit"
                    disabled={preparingImage}
                  >
                    Save
                  </button>
                  <button
                    className="profile-edit-action"
                    type="button"
                    disabled={preparingImage}
                    onClick={cancelEditingProfile}
                  >
                    Cancel
                  </button>
                </div>
                <p
                  id="profile-username-help"
                  className={
                    usernameError || saveError ? "form-error" : undefined
                  }
                  role={usernameError || saveError ? "alert" : undefined}
                >
                  {usernameError || saveError || "3–12 letters or numbers"}
                </p>
              </form>
            ) : null
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
        onClaim={submitCreatorClaim}
        onClassicV3Action={submitClassicV3Action}
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
  return [...tokens].sort((first, second) => {
    const firstCap = first.fdvUsdWad ?? first.marketCapEthWei;
    const secondCap = second.fdvUsdWad ?? second.marketCapEthWei;

    if (firstCap && secondCap && firstCap !== secondCap) {
      return BigInt(firstCap) > BigInt(secondCap) ? -1 : 1;
    }
    if (firstCap && !secondCap) return -1;
    if (!firstCap && secondCap) return 1;
    return first.name.localeCompare(second.name);
  });
}

function ProfileAccountWorkspace({
  connected,
  data,
  account,
  claimActionStates,
  classicV3Rewards,
  classicV3ActionStates,
  onClaim,
  onClassicV3Action,
  onConnect,
  onRetry,
}: {
  connected: boolean;
  data: ProfileOnchainData;
  account?: string;
  claimActionStates: Record<string, ProfileClaimActionState>;
  classicV3Rewards: ClassicV3ProfileRewards;
  classicV3ActionStates: Record<string, ClassicV3ActionState>;
  onClaim: (claim: ProfileClaim) => void;
  onClassicV3Action: (
    reward: ClassicV3Reward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
  onConnect: () => void;
  onRetry: () => void;
}) {
  if (!connected) {
    return (
      <section className="profile-account-state">
        <h2>Connect your wallet</h2>
        <p>Your tokens and rewards will appear here</p>
        <button className="primary-button" type="button" onClick={onConnect}>
          Connect wallet
        </button>
      </section>
    );
  }

  if (data.status !== "ready") {
    const copy =
      data.status === "loading"
        ? {
            title: "Loading your profile",
            detail: "Reading your tokens and rewards",
          }
        : {
            title: "Your profile could not be loaded",
            detail:
              data.status === "error" && data.errorMessage
                ? data.errorMessage
                : "Try again in a moment",
          };

    return (
      <section className="profile-account-state" aria-live="polite">
        <h2>{copy.title}</h2>
        <p>{copy.detail}</p>
        {data.status !== "loading" ? (
          <button className="secondary-button" type="button" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </section>
    );
  }

  const sortedTokens = sortProfileTokensByMarketCap(data.tokens);
  const rewards = groupProfileRewards(sortedTokens, data.claims);

  return (
    <div className="profile-account-workspace">
      <section
        className="profile-account-section"
        aria-labelledby="profile-tokens-title"
      >
        <header className="profile-account-heading">
          <h2 id="profile-tokens-title">Your tokens</h2>
          <span>{data.tokens.length}</span>
        </header>

        {data.tokens.length ? (
          <div className="profile-account-list">
            {sortedTokens.map((token) => (
              <article className="profile-token-item" key={token.address}>
                <span
                  className={`token-monogram token-tone-rose profile-token-art${
                    token.imageUrl ? " has-image" : ""
                  }`}
                  aria-hidden="true"
                  style={
                    token.imageUrl
                      ? { backgroundImage: `url("${token.imageUrl}")` }
                      : undefined
                  }
                >
                  {token.symbol.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <strong>{token.name}</strong>
                  <span>
                    ${token.symbol} ·{" "}
                    {token.launchModel === "adaptive" ? "Adaptive" : "Classic"} ·{" "}
                    {shortenAddress(token.address)}
                  </span>
                </div>
                <Link className="text-link" href={token.href}>
                  View
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <ProfileSectionEmpty
            title="No tokens yet"
            detail="Tokens launched from this wallet will appear here"
          />
        )}
      </section>

      <section
        className="profile-account-section"
        aria-labelledby="profile-rewards-title"
      >
        <header className="profile-account-heading">
          <h2 id="profile-rewards-title">Creator rewards</h2>
          <strong>{formatEth(data.claimableEth ?? "0")}</strong>
        </header>

        {rewards.length ? (
          <div className="profile-account-list">
            {rewards.map(({ token, claim }) => {
              const state = claim
                ? claimActionStates[claim.poolId.toLowerCase()]
                : undefined;
              const activeState =
                state?.account.toLowerCase() === account?.toLowerCase()
                  ? state
                  : undefined;

              return (
                <ProfileRewardItem
                  key={token.address}
                  token={token}
                  claim={claim}
                  state={activeState}
                  onClaim={onClaim}
                />
              );
            })}
          </div>
        ) : (
          <ProfileSectionEmpty
            title="No rewards yet"
            detail="Creator rewards are grouped by token"
          />
        )}
      </section>

      {classicV3Rewards.status === "ready" &&
      classicV3Rewards.rewards.length ? (
        <section
          className="profile-account-section profile-v3-section"
          aria-labelledby="profile-v3-rewards-title"
        >
          <header className="profile-account-heading">
            <h2 id="profile-v3-rewards-title">Classic rewards</h2>
            <span>{classicV3Rewards.rewards.length}</span>
          </header>
          <div className="profile-v3-list">
            {classicV3Rewards.rewards.map((reward) => (
              <ClassicV3RewardItem
                key={reward.vaultAddress}
                reward={reward}
                account={account}
                actionStates={classicV3ActionStates}
                onAction={onClassicV3Action}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ClassicV3RewardItem({
  reward,
  account,
  actionStates,
  onAction,
}: {
  reward: ClassicV3Reward;
  account?: string;
  actionStates: Record<string, ClassicV3ActionState>;
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
  const claimState =
    actionStates[`${reward.vaultAddress.toLowerCase()}:claim`];
  const payoutState =
    actionStates[`${reward.vaultAddress.toLowerCase()}:update-payout`];
  const ownsReward =
    Boolean(account) &&
    reward.beneficiary.toLowerCase() === account?.toLowerCase();
  const claimPending =
    claimState?.status === "preparing" ||
    claimState?.status === "wallet" ||
    claimState?.status === "submitted";
  const payoutPending =
    payoutState?.status === "preparing" ||
    payoutState?.status === "wallet" ||
    payoutState?.status === "submitted";

  return (
    <article className="profile-v3-reward">
      <header>
        <div>
          <strong>{reward.tokenName}</strong>
          <span>
            ${reward.tokenSymbol} · {shortenAddress(reward.tokenAddress)}
          </span>
        </div>
        <strong>{formatEth(reward.claimableEth)}</strong>
      </header>

      <dl className="profile-v3-economics">
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
        <div>
          <dt>Programmable</dt>
          <dd>0.10%</dd>
        </div>
      </dl>

      <details className="profile-v3-split">
        <summary>Immutable reward split</summary>
        <div>
          {reward.beneficiaries.map((item) => (
            <p key={item.beneficiary}>
              <span>{shortenAddress(item.beneficiary)}</span>
              <strong>{(item.shareBps / 100).toFixed(2)}%</strong>
              <small>to {shortenAddress(item.payoutAddress)}</small>
            </p>
          ))}
        </div>
      </details>

      <div className="profile-v3-payout">
        <span>Payout address</span>
        {editingPayout ? (
          <div>
            <input
              value={payoutDraft}
              spellCheck={false}
              autoComplete="off"
              aria-label="New payout address"
              onChange={(event) => setPayoutDraft(event.target.value)}
            />
            <button
              className="secondary-button"
              type="button"
              disabled={!ownsReward || payoutPending}
              onClick={() =>
                onAction(reward, "update-payout", payoutDraft.trim())
              }
            >
              {payoutPending ? "Preparing" : "Save"}
            </button>
            <button
              className="text-link"
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
          <div>
            <code>{shortenAddress(reward.payoutAddress)}</code>
            <button
              className="text-link"
              type="button"
              disabled={!ownsReward}
              onClick={() => setEditingPayout(true)}
            >
              Change
            </button>
          </div>
        )}
        <small>
          Claim authority stays with {shortenAddress(reward.beneficiary)}
        </small>
      </div>

      <footer>
        <Link className="text-link" href={`/token/${reward.tokenAddress}`}>
          View token
        </Link>
        <button
          className="secondary-button profile-claim-button"
          type="button"
          disabled={
            !ownsReward ||
            claimPending ||
            BigInt(reward.claimableWei) === 0n
          }
          onClick={() => onAction(reward, "claim")}
        >
          {claimPending ? "Preparing" : "Claim"}
        </button>
      </footer>
      {claimState?.status === "error" ||
      payoutState?.status === "error" ? (
        <p className="form-error" role="alert">
          {claimState?.status === "error"
            ? claimState.message
            : payoutState?.message}
        </p>
      ) : null}
    </article>
  );
}

function ProfileRewardItem({
  token,
  claim,
  state,
  onClaim,
}: {
  token: ProfileToken;
  claim?: ProfileClaim;
  state?: ProfileClaimActionState;
  onClaim: (claim: ProfileClaim) => void;
}) {
  const pending =
    state?.status === "preparing" ||
    state?.status === "wallet" ||
    state?.status === "submitted";
  const buttonLabel =
    state?.status === "preparing"
      ? "Preparing"
      : state?.status === "wallet"
        ? "Confirm in wallet"
        : state?.status === "submitted"
          ? "Submitted"
          : state?.status === "error"
            ? "Try again"
            : "Claim";

  return (
    <article className="profile-reward-item">
      <span
        className={`token-monogram token-tone-rose profile-token-art${
          token.imageUrl ? " has-image" : ""
        }`}
        aria-hidden="true"
        style={
          token.imageUrl
            ? { backgroundImage: `url("${token.imageUrl}")` }
            : undefined
        }
      >
        {token.symbol.slice(0, 2).toUpperCase()}
      </span>
      <div>
        <Link href={token.href}>{token.name}</Link>
        <span>
          ${token.symbol} ·{" "}
          {token.launchModel === "adaptive" ? "Adaptive" : "Classic"}
        </span>
      </div>
      <strong>{formatEth(claim?.claimableEth ?? "0")}</strong>
      {claim ? (
        <button
          className="secondary-button profile-claim-button"
          type="button"
          disabled={pending}
          onClick={() => onClaim(claim)}
        >
          {buttonLabel}
        </button>
      ) : (
        <span className="profile-reward-empty">Nothing to claim</span>
      )}
      {state?.status === "error" ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </article>
  );
}

function ProfileSectionEmpty({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="profile-section-empty">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
