"use client";

import Link from "next/link";
import {
  ArrowRight,
  CircleDollarSign,
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
      <header className="page-heading">
        <p className="eyebrow">Profile</p>
        <h1>Your launches and positions.</h1>
        <p>
          Review records associated with the connected address and manage
          claims when the onchain registry is connected.
        </p>
      </header>

      {!wallet ? (
        <section className="profile-connect">
          <span className="profile-connect-icon" aria-hidden="true">
            <Wallet size={24} strokeWidth={1.6} />
          </span>
          <h2>Connect a wallet to view this profile.</h2>
          <p>
            Launcher reads the public address you choose. Connecting does not
            prepare a transaction.
          </p>
          <button className="primary-button" type="button" onClick={openWallet}>
            Connect wallet
            <ArrowRight aria-hidden="true" size={16} />
          </button>
        </section>
      ) : (
        <>
          <section className="profile-account">
            <div>
              <span className="wallet-mark" aria-hidden="true">
                <Wallet size={19} />
              </span>
              <div>
                <p>Connected with {wallet.providerName}</p>
                <h2>{shortenAddress(wallet.account)}</h2>
              </div>
            </div>
            <p>
              This build has no deployed launch registry, so it cannot show
              onchain Launcher records yet.
            </p>
          </section>

          {localDraft ? (
            <section className="profile-section">
              <div className="profile-section-heading">
                <div>
                  <p className="eyebrow">Local draft</p>
                  <h2>Saved in this browser</h2>
                </div>
                <Link className="text-link" href="/launch">
                  Open draft
                  <ArrowRight aria-hidden="true" size={15} />
                </Link>
              </div>
              <div className="draft-row">
                <span className="section-row-icon" aria-hidden="true">
                  <FileText size={18} />
                </span>
                <div>
                  <strong>{getDraftAssetLabel(localDraft)}</strong>
                  <span>
                    {localDraft.liquidityMode === "auction"
                      ? "Auction-funded liquidity"
                      : "Direct v4 pool"}
                  </span>
                </div>
                <small>
                  {new Intl.DateTimeFormat("en", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  }).format(new Date(localDraft.updatedAt))}
                </small>
              </div>
            </section>
          ) : null}

          <div className="profile-grid">
            <EmptyProfileSection
              icon={Layers3}
              eyebrow="Launches"
              title="No Launcher launches"
              copy="No verified launch record is associated with this address."
            />
            <EmptyProfileSection
              icon={CircleDollarSign}
              eyebrow="Positions"
              title="No managed positions"
              copy="Liquidity positions created through Launcher will be grouped here."
            />
            <EmptyProfileSection
              icon={Wallet}
              eyebrow="Claims"
              title="No claims available"
              copy="Claimable fees or distributions will appear only after their source is verified."
            />
          </div>
        </>
      )}
    </div>
  );
}

function EmptyProfileSection({
  icon: Icon,
  eyebrow,
  title,
  copy,
}: {
  icon: typeof Wallet;
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <section className="profile-empty-section">
      <div className="profile-empty-heading">
        <p className="eyebrow">{eyebrow}</p>
        <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
    </section>
  );
}
