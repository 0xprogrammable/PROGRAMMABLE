"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useSearchParams } from "next/navigation";

import { useWallet } from "@/components/wallet-provider";

import styles from "./profile-entry.module.css";

const ethereumAddressPattern = /^0x[0-9a-f]{40}$/;
const loadProfileView = () =>
  import("@/components/profile-view").then((module) => module.ProfileView);
const ProfileView = dynamic(loadProfileView, {
  loading: () => <ProfileEntryLoadingState />,
  ssr: false,
});

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
}: Readonly<{
  loading: boolean;
  onConnect?: () => void;
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
            <button className={styles.button} type="button" onClick={onConnect}>
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
  const publicProfileRequested = profileEntryHasPublicAccount(
    searchParams?.getAll("account") ?? [],
  );

  if (shouldLoadProfileEntryView({
    account: wallet?.account,
    publicProfileRequested,
  })) {
    return <ProfileView />;
  }

  if (connecting) return <ProfileEntryLoadingState />;

  return <ProfileEntryFrame loading={false} onConnect={openWallet} />;
}
