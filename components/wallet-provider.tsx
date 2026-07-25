"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronRight, Copy, LogOut, Wallet, X } from "lucide-react";

export type Eip1193Provider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
  isMetaMask?: boolean;
  isPhantom?: boolean;
};

type ProviderInfo = {
  uuid: string;
  name: string;
  rdns: string;
};

type ProviderDetail = {
  info: ProviderInfo;
  provider: Eip1193Provider;
};

type WalletState = {
  account: `0x${string}`;
  chainId: string;
  providerName: string;
};

type WalletContextValue = {
  wallet: WalletState | null;
  providers: ProviderDetail[];
  connecting: boolean;
  openWallet: () => void;
  disconnect: () => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }

  interface WindowEventMap {
    "eip6963:announceProvider": CustomEvent<ProviderDetail>;
  }
}

const WalletContext = createContext<WalletContextValue | null>(null);

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function getFallbackName(provider: Eip1193Provider) {
  if (provider.isPhantom) return "Phantom";
  if (provider.isMetaMask) return "MetaMask";
  return "Browser wallet";
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<ProviderDetail[]>([]);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const registerProvider = (event: CustomEvent<ProviderDetail>) => {
      const detail = event.detail;
      setProviders((current) => {
        const exists = current.some(
          (item) =>
            item.info.uuid === detail.info.uuid ||
            (item.info.rdns === detail.info.rdns &&
              item.provider === detail.provider),
        );
        return exists ? current : [...current, detail];
      });
    };

    window.addEventListener("eip6963:announceProvider", registerProvider);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const fallbackTimer = window.setTimeout(() => {
      if (!window.ethereum) return;
      const fallback = window.ethereum;
      setProviders((current) => {
        if (current.some((item) => item.provider === fallback)) return current;
        return [
          ...current,
          {
            info: {
              uuid: "window.ethereum",
              name: getFallbackName(fallback),
              rdns: "injected.wallet",
            },
            provider: fallback,
          },
        ];
      });
    }, 250);

    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("eip6963:announceProvider", registerProvider);
    };
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [dialogOpen]);

  const connect = useCallback(async (detail: ProviderDetail) => {
    setConnectingId(detail.info.uuid);
    setError("");

    try {
      const accounts = (await detail.provider.request({
        method: "eth_requestAccounts",
      })) as string[];
      const chainId = (await detail.provider.request({
        method: "eth_chainId",
      })) as string;
      const account = accounts[0];

      if (!account?.startsWith("0x")) {
        throw new Error("The wallet did not return an Ethereum account");
      }

      setWallet({
        account: account as `0x${string}`,
        chainId,
        providerName: detail.info.name,
      });
      setDialogOpen(false);

      const handleAccounts = (...args: unknown[]) => {
        const nextAccounts = args[0] as string[];
        const nextAccount = nextAccounts?.[0];
        if (!nextAccount) {
          setWallet(null);
          return;
        }
        setWallet((current) =>
          current
            ? { ...current, account: nextAccount as `0x${string}` }
            : current,
        );
      };

      const handleChain = (...args: unknown[]) => {
        const nextChain = args[0] as string;
        setWallet((current) =>
          current ? { ...current, chainId: nextChain } : current,
        );
      };

      detail.provider.on?.("accountsChanged", handleAccounts);
      detail.provider.on?.("chainChanged", handleChain);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The wallet request could not be completed";
      setError(message);
    } finally {
      setConnectingId(null);
    }
  }, []);

  const copyAddress = useCallback(async () => {
    if (!wallet) return;
    await navigator.clipboard.writeText(wallet.account);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [wallet]);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      providers,
      connecting: connectingId !== null,
      openWallet: () => {
        setError("");
        setDialogOpen(true);
      },
      disconnect: () => {
        setWallet(null);
        setDialogOpen(false);
      },
    }),
    [connectingId, providers, wallet],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {dialogOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialogOpen(false);
          }}
        >
          <section
            className="wallet-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-dialog-title"
          >
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">Wallet</p>
                <h2 id="wallet-dialog-title">
                  {wallet ? "Connected account" : "Connect an Ethereum wallet"}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close wallet dialog"
                onClick={() => setDialogOpen(false)}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            {wallet ? (
              <div className="connected-wallet">
                <div className="wallet-account-row">
                  <span className="wallet-mark" aria-hidden="true">
                    <Wallet size={19} />
                  </span>
                  <div>
                    <strong>{wallet.providerName}</strong>
                    <span>{shortenAddress(wallet.account)}</span>
                  </div>
                </div>

                {wallet.chainId !== "0x1" ? (
                  <p className="inline-notice warning-notice">
                    Launcher uses Ethereum · Change networks in your wallet
                    before continuing
                  </p>
                ) : null}

                <div className="dialog-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={copyAddress}
                  >
                    {copied ? (
                      <Check aria-hidden="true" size={16} />
                    ) : (
                      <Copy aria-hidden="true" size={16} />
                    )}
                    {copied ? "Copied" : "Copy address"}
                  </button>
                  <button
                    className="text-button danger-text"
                    type="button"
                    onClick={() => {
                      setWallet(null);
                      setDialogOpen(false);
                    }}
                  >
                    <LogOut aria-hidden="true" size={16} />
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="dialog-copy">
                  Choose an installed wallet · Launcher only requests your
                  public account
                </p>
                <div className="wallet-list">
                  {providers.length > 0 ? (
                    providers.map((detail) => (
                      <button
                        className="wallet-option"
                        type="button"
                        key={detail.info.uuid}
                        disabled={connectingId !== null}
                        onClick={() => connect(detail)}
                      >
                        <span className="wallet-mark" aria-hidden="true">
                          <Wallet size={19} />
                        </span>
                        <span>
                          <strong>{detail.info.name}</strong>
                          <small>Injected browser wallet</small>
                        </span>
                        <span className="wallet-option-end">
                          {connectingId === detail.info.uuid
                            ? "Waiting"
                            : "Connect"}
                          <ChevronRight aria-hidden="true" size={16} />
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="wallet-empty">
                      <Wallet aria-hidden="true" size={21} />
                      <p>
                        No compatible wallet detected · Open MetaMask or Phantom
                        and refresh
                      </p>
                    </div>
                  )}
                </div>
                {error ? (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <p className="dialog-footnote">
                  Connecting never sends a transaction
                </p>
              </>
            )}
          </section>
        </div>
      ) : null}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used inside WalletProvider");
  }
  return context;
}

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { wallet, openWallet } = useWallet();

  return (
    <button
      className={compact ? "wallet-button wallet-button-compact" : "wallet-button"}
      type="button"
      onClick={openWallet}
    >
      <Wallet aria-hidden="true" size={16} />
      <span>{wallet ? shortenAddress(wallet.account) : "Connect wallet"}</span>
    </button>
  );
}
