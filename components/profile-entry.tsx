"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useSearchParams } from "next/navigation";

import { useWallet } from "@/components/wallet-provider";
import { useViewChain, type ViewChainId } from "@/components/view-chain";
import { ProfileChainSelector } from "@/components/profile-chain-selector";

import styles from "./profile-entry.module.css";

const ethereumAddressPattern = /^0x[0-9a-f]{40}$/;
const loadProfileView = () =>
  import("@/components/profile-view").then((module) => module.ProfileView);
const ProfileView = dynamic(loadProfileView, {
  loading: () => <ProfileEntryLoadingState />,
});

function preloadProfileView() {
  void loadProfileView().catch(() => undefined);
}

export function profileEntryHasPublicAccount(
  queryAccounts: readonly string[],
) {
  if (queryAccounts.length !== 1) return false;
  return ethereumAddressPattern.test(
    (queryAccounts[0] ?? "").trim().toLowerCase(),
  );
}

export function shouldLoadProfileEntryView({
  account,
  publicProfileRequested,
}: Readonly<{
  account?: string;
  publicProfileRequested: boolean;
}>) {
  return Boolean(account) || publicProfileRequested;
}

function ProfileEntryFrame({
  loading,
  onConnect,
  onPrepareProfile,
  viewChainId = 1,
  onChangeChain,
}: Readonly<{
  loading: boolean;
  onConnect?: () => void;
  onPrepareProfile?: () => void;
  viewChainId?: ViewChainId;
  onChangeChain?: (chain: ViewChainId) => void;
}>) {
  const titleId = loading
    ? "profile-entry-loading-title"
    : "profile-entry-connect-title";
  const descriptionId = loading
    ? "profile-entry-loading-description"
    : "profile-entry-connect-description";

  return (
    <div className={`${styles.page} page-width`}>
      <section
        className={styles.card}
        aria-busy={loading ? "true" : undefined}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
      >
        <Image
          className={styles.mark}
          src="/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"
          alt=""
          width={512}
          height={512}
          sizes="(max-width: 700px) 72px, 188px"
          priority
        />
        <h1 id={titleId}>Profile</h1>
        {onChangeChain ? <ProfileChainSelector value={viewChainId} onChange={onChangeChain} /> : null}
        {loading ? (
          <>
            <span
              className={styles.visuallyHidden}
              id={descriptionId}
              role="status"
            >
              Loading profile…
            </span>
            <button className={styles.button} type="button" disabled>
              Loading
            </button>
          </>
        ) : (
          <>
            <span className={styles.visuallyHidden} id={descriptionId}>
              Connect to manage your profile, launches and rewards.
            </span>
            <button
              className={styles.button}
              type="button"
              onClick={onConnect}
              onFocus={onPrepareProfile}
              onPointerEnter={onPrepareProfile}
            >
              Connect wallet
            </button>
          </>
        )}
      </section>
    </div>
  );
}

export function ProfileEntryLoadingState() {
  return <ProfileEntryFrame loading />;
}

export function ProfileEntry() {
  const searchParams = useSearchParams();
  const { connecting, openWallet, wallet } = useWallet();
  const { viewChainId, setViewChainId } = useViewChain();
  const publicProfileRequested = profileEntryHasPublicAccount(
    searchParams?.getAll("account") ?? [],
  );

  if (shouldLoadProfileEntryView({
    account: wallet?.account,
    publicProfileRequested,
  })) {
    return <ProfileView viewChainId={viewChainId} onChangeChain={setViewChainId} />;
  }

  if (connecting) return <ProfileEntryFrame loading viewChainId={viewChainId} onChangeChain={setViewChainId} />;

  function connectWallet() {
    preloadProfileView();
    openWallet();
  }

  return (
    <ProfileEntryFrame
      loading={false}
      onConnect={connectWallet}
      onPrepareProfile={preloadProfileView}
      viewChainId={viewChainId}
      onChangeChain={setViewChainId}
    />
  );
}
