"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";

import { useLocalDraft } from "@/components/local-draft";
import { useWallet } from "@/components/wallet-provider";
import { getDraftAssetLabel } from "@/lib/launch";
import { prepareAvatarImage } from "@/lib/profile/avatar";
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
  type ProfileActivity,
  type ProfileClaim,
  type ProfileOnchainData,
  type ProfilePosition,
  type ProfileToken,
} from "@/lib/profile/onchain-profile";

type ProfileTab = "overview" | "tokens" | "positions" | "claims" | "activity";

type ProfileClaimActionState = {
  account: string;
  status: "preparing" | "wallet" | "submitted" | "error";
  message: string;
  transactionHash?: `0x${string}`;
};

export type ProfileViewProps = {
  onchainData?: ProfileOnchainData;
};

const profileTabs: { id: ProfileTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tokens", label: "Tokens" },
  { id: "positions", label: "Positions" },
  { id: "claims", label: "Claims" },
  { id: "activity", label: "Activity" },
];

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
      return (
        window.localStorage.getItem(getProfileStorageKey(address)) ?? ""
      );
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

export function ProfileView({
  onchainData,
}: ProfileViewProps = {}) {
  const { wallet, openWallet, sendTransaction } = useWallet();
  const localDraft = useLocalDraft();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const account = wallet?.account;
  const activeAccountRef = useRef(account);
  const savedProfile = useWalletLocalProfile(account);
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
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
  const [claimActionStates, setClaimActionStates] = useState<
    Record<string, ProfileClaimActionState>
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
  const submitCreatorClaim = useCallback(
    async (claim: ProfileClaim) => {
      const claimAccount = account;
      const chainId = scopedOnchainData.chainId;
      if (
        !claimAccount ||
        scopedOnchainData.status !== "ready" ||
        !chainId
      ) {
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
          activeAccountRef.current?.toLowerCase() !==
          claimAccount.toLowerCase()
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
          activeAccountRef.current?.toLowerCase() ===
          claimAccount.toLowerCase()
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
          activeAccountRef.current?.toLowerCase() !==
          claimAccount.toLowerCase()
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
  const displayName = account
    ? savedProfile.username || shortenAddress(account)
    : "Your profile";
  const avatarImage = editingProfile
    ? avatarDraft
    : savedProfile.avatarDataUrl;
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
          <h1>{displayName}</h1>
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
                  className={usernameError || saveError ? "form-error" : undefined}
                  role={usernameError || saveError ? "alert" : undefined}
                >
                  {usernameError ||
                    saveError ||
                    "3–12 letters or numbers"}
                </p>
              </form>
            ) : (
              <button
                className="secondary-button profile-edit-button"
                type="button"
                onClick={beginEditingProfile}
              >
                Edit
              </button>
            )
          ) : null}
        </div>
      </section>

      <section className="profile-workspace">
        <nav className="profile-tabs" aria-label="Profile sections" role="tablist">
          {profileTabs.map((tab) => (
            <button
              key={tab.id}
              id={`profile-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls="profile-panel"
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={activeTab === tab.id ? "active" : undefined}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => {
                if (
                  event.key !== "ArrowLeft" &&
                  event.key !== "ArrowRight" &&
                  event.key !== "Home" &&
                  event.key !== "End"
                ) {
                  return;
                }
                event.preventDefault();
                const current = profileTabs.findIndex(
                  (candidate) => candidate.id === tab.id,
                );
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? profileTabs.length - 1
                      : (current +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          profileTabs.length) %
                        profileTabs.length;
                setActiveTab(profileTabs[next].id);
                document
                  .getElementById(`profile-tab-${profileTabs[next].id}`)
                  ?.focus();
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div
          id="profile-panel"
          role="tabpanel"
          aria-labelledby={`profile-tab-${activeTab}`}
        >
          {activeTab === "overview" ? (
            <ProfileOverview
              connected={Boolean(account)}
              data={scopedOnchainData}
              localDraft={localDraft}
              onConnect={openWallet}
            />
          ) : (
            <ProfileDataPanel
              tab={activeTab}
              connected={Boolean(account)}
              data={scopedOnchainData}
              account={account}
              claimActionStates={claimActionStates}
              onClaim={submitCreatorClaim}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function ProfileOverview({
  connected,
  data,
  localDraft,
  onConnect,
}: {
  connected: boolean;
  data: ProfileOnchainData;
  localDraft: ReturnType<typeof useLocalDraft>;
  onConnect: () => void;
}) {
  const metrics = getProfileMetrics(connected, data);

  return (
    <div className="profile-overview">
      <div className="profile-summary">
        {metrics.map((metric) => (
          <ProfileStat key={metric.label} {...metric} />
        ))}
      </div>

      <div className="profile-ledger">
        <section className="profile-ledger-section">
          <header>
            <div>
              <p className="eyebrow">Saved launch</p>
              <h2>{localDraft ? "Continue your token" : "No saved token"}</h2>
            </div>
          </header>

          {localDraft ? (
            <div className="saved-token-row">
              <span className="token-monogram token-tone-rose" aria-hidden="true">
                {getDraftAssetLabel(localDraft).slice(0, 2).toUpperCase()}
              </span>
              <div>
                <strong>{getDraftAssetLabel(localDraft)}</strong>
              </div>
              <Link className="text-link" href="/launch">
                Open
              </Link>
            </div>
          ) : (
            <div className="profile-ledger-empty">
              <Link className="text-link" href="/launch">
                Launch a token
              </Link>
            </div>
          )}
        </section>

        <section className="profile-ledger-section">
          <header>
            <div>
              <p className="eyebrow">Recent activity</p>
              <h2>{getActivityHeading(connected, data)}</h2>
            </div>
          </header>
          {connected && data.status === "ready" && data.activity.length ? (
            <ProfileActivityRows items={data.activity.slice(0, 2)} />
          ) : (
            <div className="profile-ledger-empty">
              <p>{getActivityDetail(connected, data)}</p>
              {!connected ? (
                <button className="text-button" type="button" onClick={onConnect}>
                  Connect wallet
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function getProfileMetrics(
  connected: boolean,
  data: ProfileOnchainData,
): {
  label: string;
  value: string;
  detail: string;
}[] {
  if (!connected) {
    return [
      {
        label: "Tokens",
        value: "Connect",
        detail: "Load verified launches",
      },
      {
        label: "Claimable creator fees",
        value: "Connect",
        detail: "Load the onchain fee balance",
      },
      {
        label: "Claimed in ETH",
        value: "Connect",
        detail: "Load the claim history",
      },
    ];
  }

  if (data.status === "loading") {
    return [
      { label: "Tokens", value: "Loading", detail: "Reading launch records" },
      {
        label: "Claimable creator fees",
        value: "Loading",
        detail: "Reading the onchain fee balance",
      },
      {
        label: "Claimed in ETH",
        value: "Loading",
        detail: "Reading the claim history",
      },
    ];
  }

  if (data.status !== "ready") {
    if (data.status === "error") {
      const detail =
        data.errorMessage || "Onchain profile data could not be loaded";

      return [
        { label: "Tokens", value: "—", detail },
        { label: "Claimable creator fees", value: "—", detail },
        { label: "Claimed in ETH", value: "—", detail },
      ];
    }

    if (data.status === "not-deployed") {
      return [
        {
          label: "Tokens",
          value: "0",
          detail: "Launcher contracts are not deployed on Ethereum",
        },
        {
          label: "Claimable creator fees",
          value: "0 ETH",
          detail: "No deployed fee hook to read",
        },
        {
          label: "Claimed in ETH",
          value: "0 ETH",
          detail: "No confirmed claim history",
        },
      ];
    }

    return [
      {
        label: "Tokens",
        value: "—",
        detail: "Launch records are not available yet",
      },
      {
        label: "Claimable creator fees",
        value: "—",
        detail: "Creator fee balances are not available yet",
      },
      {
        label: "Claimed in ETH",
        value: "—",
        detail: "Claim history is not available yet",
      },
    ];
  }

  return [
    {
      label: "Tokens",
      value: String(data.tokens.length),
      detail:
        data.tokens.length === 1
          ? "Verified launch from this wallet"
          : "Verified launches from this wallet",
    },
    {
      label: "Claimable creator fees",
      value: formatEth(data.claimableEth),
      detail:
        data.claimableWei && BigInt(data.claimableWei) > 0n
          ? "Available to claim"
          : "No creator fees are claimable",
    },
    {
      label: "Claimed in ETH",
      value: formatEth(data.claimedEth),
      detail:
        data.claimedWei && BigInt(data.claimedWei) > 0n
          ? "Verified creator fee claims"
          : "No confirmed creator fee claims",
    },
  ];
}

function getActivityHeading(connected: boolean, data: ProfileOnchainData) {
  if (!connected) return "Connect to load activity";
  if (data.status === "loading") return "Loading activity";
  if (data.status === "error") return "Activity could not be loaded";
  if (data.status === "not-deployed") return "Launcher not deployed";
  if (data.status === "unavailable") return "Activity unavailable";
  return data.activity.length ? "Latest wallet activity" : "No activity yet";
}

function getActivityDetail(connected: boolean, data: ProfileOnchainData) {
  if (!connected) return "Verified launches and creator fee claims appear here";
  if (data.status === "loading") return "Reading verified launch and claim events";
  if (data.status === "error") {
    return data.errorMessage || "Try loading the onchain profile again";
  }
  if (data.status === "not-deployed") {
    return "Launcher contracts are not deployed on Ethereum";
  }
  if (data.status === "unavailable") {
    return "Verified activity is not available yet";
  }
  return "This wallet has no verified launches or creator fee claims";
}

function ProfileDataPanel({
  tab,
  connected,
  data,
  account,
  claimActionStates,
  onClaim,
}: {
  tab: Exclude<ProfileTab, "overview">;
  connected: boolean;
  data: ProfileOnchainData;
  account?: string;
  claimActionStates: Record<string, ProfileClaimActionState>;
  onClaim: (claim: ProfileClaim) => void;
}) {
  const unavailableCopy = getUnavailablePanelCopy(tab, connected, data);
  if (unavailableCopy) {
    return (
      <div className="profile-tab-empty">
        <h2>{unavailableCopy.title}</h2>
        <p>{unavailableCopy.text}</p>
      </div>
    );
  }

  if (tab === "tokens") {
    return (
      <ProfileList
        emptyTitle="No tokens yet"
        emptyText="This wallet has no verified launches"
        items={data.tokens}
        getKey={(token) => token.address}
        renderItem={(token) => <ProfileTokenRow token={token} />}
      />
    );
  }

  if (tab === "positions") {
    return (
      <ProfileList
        emptyTitle="No positions found"
        emptyText="This wallet has no verified liquidity positions"
        items={data.positions}
        getKey={(position) => position.id}
        renderItem={(position) => (
          <ProfilePositionRow position={position} />
        )}
      />
    );
  }

  if (tab === "claims") {
    return (
      <ProfileList
        emptyTitle="No fees to claim"
        emptyText="This wallet has no claimable creator fees"
        items={data.claims}
        getKey={(claim) => claim.id}
        renderItem={(claim) => {
          const state = claimActionStates[claim.poolId.toLowerCase()];
          return (
            <ProfileClaimRow
              claim={claim}
              state={
                state?.account.toLowerCase() === account?.toLowerCase()
                  ? state
                  : undefined
              }
              onClaim={onClaim}
            />
          );
        }}
      />
    );
  }

  return (
    <ProfileList
      emptyTitle="No activity yet"
      emptyText="This wallet has no verified launches or creator fee claims"
      items={data.activity}
      getKey={(activity) => activity.id}
      renderItem={(activity) => <ProfileActivityRow activity={activity} />}
    />
  );
}

function getUnavailablePanelCopy(
  tab: Exclude<ProfileTab, "overview">,
  connected: boolean,
  data: ProfileOnchainData,
) {
  const copy = {
    tokens: {
      label: "tokens",
      disconnected: "Connect a wallet to load verified launches",
      unavailable: "Launch records are not available yet",
    },
    positions: {
      label: "positions",
      disconnected: "Connect a wallet to load verified liquidity positions",
      unavailable: "Liquidity position data is not available yet",
    },
    claims: {
      label: "claims",
      disconnected: "Connect a wallet to load claimable creator fees",
      unavailable: "Creator fee data is not available yet",
    },
    activity: {
      label: "activity",
      disconnected: "Connect a wallet to load verified launch and claim activity",
      unavailable: "Verified activity is not available yet",
    },
  } as const;
  const tabCopy = copy[tab];
  const label = tabCopy.label;

  if (!connected) {
    return {
      title: `Connect to view ${label}`,
      text: tabCopy.disconnected,
    };
  }

  if (data.status === "loading") {
    return {
      title: `Loading ${label}`,
      text: "Reading verified onchain records",
    };
  }

  if (data.status === "error") {
    return {
      title: `${label[0].toUpperCase()}${label.slice(1)} could not be loaded`,
      text: data.errorMessage || "Try loading the onchain profile again",
    };
  }

  if (data.status === "not-deployed") {
    return {
      title: "Launcher not deployed",
      text: "Launcher contracts are not deployed on Ethereum",
    };
  }

  if (data.status === "unavailable") {
    return {
      title: `${label[0].toUpperCase()}${label.slice(1)} unavailable`,
      text: tabCopy.unavailable,
    };
  }

  return null;
}

function ProfileList<T>({
  emptyTitle,
  emptyText,
  items,
  getKey,
  renderItem,
}: {
  emptyTitle: string;
  emptyText: string;
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}) {
  if (!items.length) {
    return (
      <div className="profile-tab-empty">
        <h2>{emptyTitle}</h2>
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="profile-overview">
      {items.map((item) => (
        <Fragment key={getKey(item)}>{renderItem(item)}</Fragment>
      ))}
    </div>
  );
}

function ProfileTokenRow({ token }: { token: ProfileToken }) {
  return (
    <ProfileDataRow
      monogram={token.symbol}
      title={token.name}
      detail={`${token.symbol} · ${shortenAddress(token.address)}${token.launchedAt ? ` · ${token.launchedAt}` : ""}`}
      href={token.href}
    />
  );
}

function ProfilePositionRow({ position }: { position: ProfilePosition }) {
  const lockStatus = {
    "permanently-locked": "Permanently locked",
    unlocked: "Unlocked",
    unknown: "Lock status unavailable",
  }[position.lockStatus];

  return (
    <ProfileDataRow
      monogram={position.tokenSymbol}
      title={position.tokenName}
      detail={`${position.tokenSymbol} · ${lockStatus}`}
      href={position.href}
    />
  );
}

function ProfileClaimRow({
  claim,
  state,
  onClaim,
}: {
  claim: ProfileClaim;
  state?: ProfileClaimActionState;
  onClaim: (claim: ProfileClaim) => void;
}) {
  const pending =
    state?.status === "preparing" ||
    state?.status === "wallet" ||
    state?.status === "submitted";
  const label = {
    preparing: "Preparing…",
    wallet: "Reviewing…",
    submitted: "Submitted",
    error: "Try again",
  }[state?.status ?? "error"];

  return (
    <ProfileDataRow
      monogram={claim.tokenSymbol}
      title={claim.tokenName}
      detail={`${claim.tokenSymbol} · ${formatEth(claim.claimableEth)} claimable${state ? ` · ${state.message}` : ""}`}
      href={claim.href}
      titleHref={claim.href}
      action={
        <button
          className="text-button"
          type="button"
          disabled={pending}
          onClick={() => onClaim(claim)}
        >
          {state ? label : "Claim"}
        </button>
      }
    />
  );
}

function ProfileActivityRows({ items }: { items: readonly ProfileActivity[] }) {
  return (
    <>
      {items.map((activity) => (
        <ProfileActivityRow key={activity.id} activity={activity} />
      ))}
    </>
  );
}

function ProfileActivityRow({ activity }: { activity: ProfileActivity }) {
  return (
    <ProfileDataRow
      monogram={activity.label}
      title={activity.label}
      detail={`${activity.detail}${activity.occurredAt ? ` · ${activity.occurredAt}` : ""}`}
      href={activity.href}
    />
  );
}

function ProfileDataRow({
  monogram,
  title,
  detail,
  href,
  titleHref,
  action,
}: {
  monogram: string;
  title: string;
  detail: string;
  href?: string;
  titleHref?: string;
  action?: ReactNode;
}) {
  return (
    <div className="saved-token-row">
      <span className="token-monogram token-tone-rose" aria-hidden="true">
        {monogram.slice(0, 2).toUpperCase()}
      </span>
      <div>
        <strong>
          {titleHref ? <Link href={titleHref}>{title}</Link> : title}
        </strong>
        <span>{detail}</span>
      </div>
      {action ?? (href ? (
        <Link className="text-link" href={href}>
          View
        </Link>
      ) : null)}
    </div>
  );
}

function ProfileStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="profile-stat">
      <div>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </section>
  );
}
