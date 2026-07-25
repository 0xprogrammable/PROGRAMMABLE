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
import { useWallet } from "@/components/wallet-provider";
import { useLocalDraft } from "@/components/local-draft";
import { getDraftAssetLabel } from "@/lib/launch";

function shortenAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function ProfileView() {
  const { wallet, openWallet } = useWallet();
  const localDraft = useLocalDraft();

  return (
    <div className="profile-page page-width">
      <header className="profile-heading">
        <div>
          <p className="eyebrow">Profile</p>
          <h1>Your tokens</h1>
        </div>
        <p>Launches, liquidity and claims in one place</p>
      </header>

      <div className="profile-dashboard">
        <section className="profile-account-card">
          <div className="profile-account-copy">
            <span className="profile-connect-icon" aria-hidden="true">
              <Wallet size={22} strokeWidth={1.7} />
            </span>
            <div>
              <p>{wallet ? `Connected with ${wallet.providerName}` : "Wallet"}</p>
              <h2>
                {wallet
                  ? shortenAddress(wallet.account)
                  : "Connect to load your profile"}
              </h2>
              <span>
                {wallet
                  ? "Ethereum activity for this address"
                  : "Your wallet identifies tokens, positions and claims"}
              </span>
            </div>
          </div>
          <button
            className={wallet ? "secondary-button" : "primary-button"}
            type="button"
            onClick={openWallet}
          >
            {wallet ? "Wallet settings" : "Connect wallet"}
            <ArrowRight aria-hidden="true" size={16} />
          </button>
        </section>

        <div className="profile-stat-grid">
          <ProfileStat
            icon={Coins}
            label="Tokens"
            value={wallet ? "0" : "—"}
            detail={wallet ? "Launched with this wallet" : "Connect to view"}
          />
          <ProfileStat
            icon={Layers3}
            label="Positions"
            value={wallet ? "0" : "—"}
            detail={wallet ? "Active liquidity positions" : "Connect to view"}
          />
          <ProfileStat
            icon={CircleDollarSign}
            label="Claimable"
            value={wallet ? "0 ETH" : "—"}
            detail={wallet ? "Available from verified fees" : "Connect to view"}
          />
        </div>

        <div className="profile-lower-grid">
          <section className="profile-panel">
            <div className="profile-panel-heading">
              <div>
                <p className="eyebrow">Saved token</p>
                <h2>{localDraft ? "Continue your launch" : "No saved token"}</h2>
              </div>
              <FileText aria-hidden="true" size={18} />
            </div>

            {localDraft ? (
              <div className="saved-token-row">
                <span className="token-monogram token-tone-rose" aria-hidden="true">
                  {getDraftAssetLabel(localDraft).slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <strong>{getDraftAssetLabel(localDraft)}</strong>
                  <span>
                    {localDraft.liquidityMode === "auction"
                      ? "Auction funded"
                      : "Direct liquidity"}
                  </span>
                </div>
                <Link className="text-link" href="/launch">
                  Open
                  <ArrowRight aria-hidden="true" size={14} />
                </Link>
              </div>
            ) : (
              <div className="profile-panel-empty">
                <p>Saved launch details appear here</p>
                <Link className="text-link" href="/launch">
                  Launch a token
                  <ArrowRight aria-hidden="true" size={14} />
                </Link>
              </div>
            )}
          </section>

          <section className="profile-panel">
            <div className="profile-panel-heading">
              <div>
                <p className="eyebrow">Activity</p>
                <h2>No activity yet</h2>
              </div>
              <Layers3 aria-hidden="true" size={18} />
            </div>
            <div className="profile-panel-empty">
              <p>Launches, position changes and claims appear here</p>
              {!wallet ? (
                <button className="text-button" type="button" onClick={openWallet}>
                  Connect wallet
                  <ArrowRight aria-hidden="true" size={14} />
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </div>
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
