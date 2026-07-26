"use client";

import {
  PrivyProvider,
  usePrivy,
  useWallets,
  type ConnectedWallet,
  type PrivyClientConfig,
} from "@privy-io/react-auth";
import { Check, Copy, LogOut, Network, Wallet, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { mainnet } from "viem/chains";

type WalletState = {
  account: `0x${string}`;
  chainId: string;
  providerName: string;
};

type WalletContextValue = {
  wallet: WalletState | null;
  authenticated: boolean;
  connecting: boolean;
  openWallet: () => void;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim();

const privyConfig = {
  loginMethods: ["wallet", "email"],
  appearance: {
    theme: "#0b0b0f",
    accentColor: "#ff5ca8",
    landingHeader: "Connect to Launcher",
    loginMessage: "Use a wallet or email to continue",
    showWalletLoginFirst: true,
    walletChainType: "ethereum-only",
    walletList: [
      "metamask",
      "phantom",
      "coinbase_wallet",
      "rainbow",
      "uniswap",
      "detected_ethereum_wallets",
      "wallet_connect",
    ],
  },
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets",
    },
  },
  supportedChains: [mainnet],
  defaultChain: mainnet,
} satisfies PrivyClientConfig;

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function normalizeChainId(chainId: string) {
  if (chainId.startsWith("eip155:")) {
    const decimalId = Number(chainId.slice("eip155:".length));
    return Number.isSafeInteger(decimalId) ? `0x${decimalId.toString(16)}` : chainId;
  }

  return chainId.toLowerCase();
}

function getWalletLabel(wallet: ConnectedWallet) {
  if (wallet.walletClientType === "privy") return "Privy wallet";
  return wallet.meta.name || "Ethereum wallet";
}

function isEthereumAddress(address: string): address is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!privyAppId) {
    return <UnconfiguredWalletProvider>{children}</UnconfiguredWalletProvider>;
  }

  return (
    <PrivyProvider
      appId={privyAppId}
      clientId={privyClientId}
      config={privyConfig}
    >
      <PrivyWalletBridge>{children}</PrivyWalletBridge>
    </PrivyProvider>
  );
}

function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const {
    authenticated,
    linkWallet,
    login,
    logout,
    ready,
    user,
  } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [error, setError] = useState("");

  const connectedWallet = useMemo(() => {
    const primaryAddress = user?.wallet?.address.toLowerCase();
    return (
      wallets.find(
        (candidate) =>
          primaryAddress && candidate.address.toLowerCase() === primaryAddress,
      ) ??
      wallets.find((candidate) => candidate.linked) ??
      wallets[0]
    );
  }, [user?.wallet?.address, wallets]);

  const wallet = useMemo<WalletState | null>(() => {
    if (
      !authenticated ||
      !connectedWallet ||
      !isEthereumAddress(connectedWallet.address)
    ) {
      return null;
    }

    return {
      account: connectedWallet.address,
      chainId: normalizeChainId(connectedWallet.chainId),
      providerName: getWalletLabel(connectedWallet),
    };
  }, [authenticated, connectedWallet]);

  const openWallet = useCallback(() => {
    setError("");

    if (!ready) return;

    if (!authenticated) {
      login({
        loginMethods: ["wallet", "email"],
        walletChainType: "ethereum-only",
      });
      return;
    }

    setDialogOpen(true);
  }, [authenticated, login, ready]);

  const disconnect = useCallback(() => {
    setDialogOpen(false);
    void logout();
  }, [logout]);

  const copyAddress = useCallback(async () => {
    if (!wallet) return;

    try {
      await navigator.clipboard.writeText(wallet.account);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("The address could not be copied");
    }
  }, [wallet]);

  const switchToEthereum = useCallback(async () => {
    if (!connectedWallet) return;

    setSwitchingNetwork(true);
    setError("");

    try {
      await connectedWallet.switchChain(mainnet.id);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The network could not be changed",
      );
    } finally {
      setSwitchingNetwork(false);
    }
  }, [connectedWallet]);

  const addWallet = useCallback(() => {
    setDialogOpen(false);
    linkWallet({
      description: "Add an Ethereum wallet to Launcher",
      walletChainType: "ethereum-only",
    });
  }, [linkWallet]);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      authenticated,
      connecting: !ready || (authenticated && !walletsReady),
      openWallet,
      disconnect,
    }),
    [
      authenticated,
      disconnect,
      openWallet,
      ready,
      wallet,
      walletsReady,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {dialogOpen ? (
        <WalletDialog
          wallet={wallet}
          copied={copied}
          error={error}
          switchingNetwork={switchingNetwork}
          onAddWallet={addWallet}
          onClose={() => setDialogOpen(false)}
          onCopyAddress={copyAddress}
          onLogout={disconnect}
          onSwitchNetwork={switchToEthereum}
        />
      ) : null}
    </WalletContext.Provider>
  );
}

function UnconfiguredWalletProvider({ children }: { children: ReactNode }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet: null,
      authenticated: false,
      connecting: false,
      openWallet: () => setDialogOpen(true),
      disconnect: () => undefined,
    }),
    [],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {dialogOpen ? (
        <DialogFrame
          eyebrow="Wallet"
          title="Wallet sign-in is unavailable"
          onClose={() => setDialogOpen(false)}
        >
          <p className="dialog-copy">
            Launcher uses Privy for wallet access. Please try again shortly
          </p>
          <button
            className="primary-button dialog-full-button"
            type="button"
            onClick={() => setDialogOpen(false)}
          >
            Close
          </button>
        </DialogFrame>
      ) : null}
    </WalletContext.Provider>
  );
}

function WalletDialog({
  wallet,
  copied,
  error,
  switchingNetwork,
  onAddWallet,
  onClose,
  onCopyAddress,
  onLogout,
  onSwitchNetwork,
}: {
  wallet: WalletState | null;
  copied: boolean;
  error: string;
  switchingNetwork: boolean;
  onAddWallet: () => void;
  onClose: () => void;
  onCopyAddress: () => void;
  onLogout: () => void;
  onSwitchNetwork: () => void;
}) {
  return (
    <DialogFrame
      eyebrow="Wallet"
      title={wallet ? "Connected account" : "Complete wallet setup"}
      onClose={onClose}
    >
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
            <div className="wallet-network-warning">
              <p className="inline-notice warning-notice">
                Launcher uses Ethereum for launches and liquidity
              </p>
              <button
                className="secondary-button"
                type="button"
                disabled={switchingNetwork}
                onClick={onSwitchNetwork}
              >
                <Network aria-hidden="true" size={16} />
                {switchingNetwork ? "Switching" : "Switch to Ethereum"}
              </button>
            </div>
          ) : null}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="dialog-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={onCopyAddress}
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
              onClick={onLogout}
            >
              <LogOut aria-hidden="true" size={16} />
              Log out
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="dialog-copy">
            Add an Ethereum wallet before launching or managing a token
          </p>
          <button
            className="primary-button dialog-full-button"
            type="button"
            onClick={onAddWallet}
          >
            <Wallet aria-hidden="true" size={16} />
            Add wallet
          </button>
          <button
            className="text-button dialog-logout-button"
            type="button"
            onClick={onLogout}
          >
            Log out
          </button>
        </>
      )}
    </DialogFrame>
  );
}

function DialogFrame({
  eyebrow,
  title,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="wallet-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-dialog-title"
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id="wallet-dialog-title">{title}</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            aria-label="Close wallet dialog"
            onClick={onClose}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
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
  const { wallet, authenticated, connecting, openWallet } = useWallet();

  const label = connecting
    ? compact
      ? "Connect"
      : "Connect wallet"
    : wallet
      ? shortenAddress(wallet.account)
      : authenticated
        ? "Set up wallet"
        : compact
          ? "Connect"
          : "Connect wallet";

  return (
    <button
      className={compact ? "wallet-button wallet-button-compact" : "wallet-button"}
      type="button"
      disabled={connecting}
      onClick={openWallet}
    >
      <Wallet aria-hidden="true" size={16} />
      <span>{label}</span>
    </button>
  );
}
