"use client";

import Link from "next/link";
import {
  ArrowRight,
  CircleDollarSign,
  Coins,
  FileText,
  Layers3,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { useWallet } from "@/components/wallet-provider";
import { useLocalDraft } from "@/components/local-draft";
import { getDraftAssetLabel } from "@/lib/launch";

type ProfileTab = "overview" | "tokens" | "positions" | "claims" | "activity";

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

export function ProfileView() {
  const { wallet, authenticated, openWallet } = useWallet();
  const localDraft = useLocalDraft();
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");

  return (
    <div className="profile-page page-width">
      <section className="profile-hero">
        <div className="profile-hero-copy">
          <p className="eyebrow">Profile</p>
          <h1>
            {wallet ? shortenAddress(wallet.account) : "Your launches in one place"}
          </h1>
          <p>
            {wallet
              ? `Connected with ${wallet.providerName}`
              : "Connect a wallet to manage tokens, locked positions and fee claims"}
          </p>
          <button
            className={wallet ? "secondary-button" : "primary-button"}
            type="button"
            onClick={openWallet}
          >
            <Wallet aria-hidden="true" size={17} />
            {wallet
              ? "Wallet settings"
              : authenticated
                ? "Add wallet"
                : "Connect wallet"}
          </button>
        </div>

        <div className="profile-pool-map" aria-hidden="true">
          <span>Token</span>
          <i />
          <span>Hook</span>
          <i />
          <span>Pool</span>
        </div>
      </section>

      <section className="profile-workspace">
        <nav className="profile-tabs" aria-label="Profile sections" role="tablist">
          {profileTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls="profile-panel"
              className={activeTab === tab.id ? "active" : undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div id="profile-panel" role="tabpanel">
          {activeTab === "overview" ? (
            <ProfileOverview
              connected={Boolean(wallet)}
              localDraft={localDraft}
              onConnect={openWallet}
            />
          ) : (
            <ProfileEmptyPanel tab={activeTab} connected={Boolean(wallet)} />
          )}
        </div>
      </section>
    </div>
  );
}

function ProfileOverview({
  connected,
  localDraft,
  onConnect,
}: {
  connected: boolean;
  localDraft: ReturnType<typeof useLocalDraft>;
  onConnect: () => void;
}) {
  return (
    <div className="profile-overview">
      <div className="profile-summary">
        <ProfileStat
          icon={Coins}
          label="Tokens"
          value={connected ? "0" : "Connect"}
          detail={connected ? "Launched from this wallet" : "Load your launches"}
        />
        <ProfileStat
          icon={Layers3}
          label="Locked positions"
          value={connected ? "0" : "Connect"}
          detail={connected ? "Positions managed by Launcher" : "Load your positions"}
        />
        <ProfileStat
          icon={CircleDollarSign}
          label="Claimable fees"
          value={connected ? "0 ETH" : "Connect"}
          detail={connected ? "Available to claim" : "Load your fee balance"}
        />
      </div>

      <div className="profile-ledger">
        <section className="profile-ledger-section">
          <header>
            <div>
              <p className="eyebrow">Saved launch</p>
              <h2>{localDraft ? "Continue your token" : "No saved token"}</h2>
            </div>
            <FileText aria-hidden="true" size={19} />
          </header>

          {localDraft ? (
            <div className="saved-token-row">
              <span className="token-monogram token-tone-rose" aria-hidden="true">
                {getDraftAssetLabel(localDraft).slice(0, 2).toUpperCase()}
              </span>
              <div>
                <strong>{getDraftAssetLabel(localDraft)}</strong>
                <span>
                  {localDraft.liquidityMode === "auction"
                    ? "Auction launch"
                    : "Direct liquidity"}
                </span>
              </div>
              <Link className="text-link" href="/launch">
                Open
                <ArrowRight aria-hidden="true" size={14} />
              </Link>
            </div>
          ) : (
            <div className="profile-ledger-empty">
              <p>A saved launch stays in this browser</p>
              <Link className="text-link" href="/launch">
                Launch a token
                <ArrowRight aria-hidden="true" size={14} />
              </Link>
            </div>
          )}
        </section>

        <section className="profile-ledger-section">
          <header>
            <div>
              <p className="eyebrow">Recent activity</p>
              <h2>No activity yet</h2>
            </div>
            <Layers3 aria-hidden="true" size={19} />
          </header>
          <div className="profile-ledger-empty">
            <p>Launches, position changes and claims appear here</p>
            {!connected ? (
              <button className="text-button" type="button" onClick={onConnect}>
                Connect wallet
                <ArrowRight aria-hidden="true" size={14} />
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function ProfileEmptyPanel({
  tab,
  connected,
}: {
  tab: Exclude<ProfileTab, "overview">;
  connected: boolean;
}) {
  const copy = {
    tokens: {
      title: connected ? "No tokens yet" : "Connect to view tokens",
      text: "Tokens launched from this wallet appear here",
    },
    positions: {
      title: connected ? "No positions yet" : "Connect to view positions",
      text: "Locked liquidity positions and their fee status appear here",
    },
    claims: {
      title: connected ? "No fees to claim" : "Connect to view claims",
      text: "Claimable creator fees appear here after a verified launch",
    },
    activity: {
      title: connected ? "No activity yet" : "Connect to view activity",
      text: "Launches, position changes and claims appear here",
    },
  }[tab];

  return (
    <div className="profile-tab-empty">
      <h2>{copy.title}</h2>
      <p>{copy.text}</p>
    </div>
  );
}

function ProfileStat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="profile-stat">
      <div>
        <span>{label}</span>
        <Icon aria-hidden="true" size={17} strokeWidth={1.7} />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </section>
  );
}
