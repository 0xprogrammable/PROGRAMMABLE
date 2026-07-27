"use client";

import Image from "next/image";
import {
  PrivyProvider,
  useLinkAccount,
  useLogin,
  usePrivy,
  useSendTransaction as usePrivySendTransaction,
  useWallets,
  type PrivyClientConfig,
} from "@privy-io/react-auth";
import {
  Check,
  ChevronDown,
  Copy,
  LogOut,
  Network,
  Wallet,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { mainnet, sepolia } from "viem/chains";
import type { Hex } from "viem";

import { parseLocalProfile } from "@/lib/profile/local-profile";
import {
  buildPrivyTransactionRequest,
  getPreparedTransactionReview,
  parsePreparedTransactionForAccount,
  type PreparedTransaction,
} from "../lib/prepared-transaction";

type WalletState = {
  account: `0x${string}`;
  chainId: string;
};

type WalletContextValue = {
  wallet: WalletState | null;
  username: string;
  avatarDataUrl: string;
  authenticated: boolean;
  hasSession: boolean;
  connecting: boolean;
  disconnecting: boolean;
  openWallet: () => void;
  disconnect: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  setUsername: (username: string) => void;
  sendTransaction: (
    transaction: PreparedTransaction,
  ) => Promise<Hex>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim();
const profileStoragePrefix = "programmable-profile";
const profileUpdatedEvent = "programmable:profile-updated";
const usernamePattern = /^[A-Za-z0-9]{3,12}$/;
const appChain =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? sepolia
    : mainnet;
const appChainHex = `0x${appChain.id.toString(16)}`;
const appNetworkName = appChain.id === sepolia.id ? "Sepolia" : "Ethereum";

export function getWalletSessionAction(
  ready: boolean,
  authenticated: boolean,
  connectedWalletCount: number,
) {
  if (!ready) return "wait" as const;
  if (authenticated || connectedWalletCount > 0) return "manage" as const;
  return "login" as const;
}

export function getWalletProfileStorageKey(account: string) {
  return `${profileStoragePrefix}:${account.toLowerCase()}`;
}

export function readUsernameFromProfileValue(value: string | null) {
  if (!value) return "";

  try {
    const profile = JSON.parse(value) as unknown;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return "";
    }

    const username = (profile as { username?: unknown }).username;
    return typeof username === "string" && usernamePattern.test(username)
      ? username
      : "";
  } catch {
    return "";
  }
}

export function getWalletLoginErrorMessage(errorCode: string) {
  if (
    errorCode === "exited_auth_flow" ||
    errorCode === "exited_link_flow"
  ) {
    return "";
  }

  return "Unable to connect wallet. Try again.";
}

function readProfileValue(account?: string) {
  if (!account || typeof window === "undefined") return "";

  try {
    return (
      window.localStorage.getItem(getWalletProfileStorageKey(account)) ?? ""
    );
  } catch {
    return "";
  }
}

function subscribeToProfiles(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(`${profileStoragePrefix}:`)) listener();
  };
  const onProfileUpdated = () => listener();

  window.addEventListener("storage", onStorage);
  window.addEventListener(profileUpdatedEvent, onProfileUpdated);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(profileUpdatedEvent, onProfileUpdated);
  };
}

function readStoredProfile(account: string) {
  try {
    const value = window.localStorage.getItem(
      getWalletProfileStorageKey(account),
    );
    if (!value) return {};

    const profile = JSON.parse(value) as unknown;
    return profile && typeof profile === "object" && !Array.isArray(profile)
      ? (profile as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function emitProfileChange(account: string) {
  window.dispatchEvent(
    new CustomEvent(profileUpdatedEvent, {
      detail: { account: account.toLowerCase() },
    }),
  );
}

function getEmptyProfileValue() {
  return "";
}

const privyConfig = {
  loginMethods: ["wallet", "email"],
  appearance: {
    theme: "light",
    accentColor: "#e879be",
    logo: "/icon-512.png",
    landingHeader: "Connect to Programmable",
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
  supportedChains: [appChain],
  defaultChain: appChain,
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
  const { authenticated, getAccessToken, logout, ready, user } = usePrivy();
  const { sendTransaction: sendPrivyTransaction } =
    usePrivySendTransaction();
  const { ready: walletsReady, wallets } = useWallets();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [error, setError] = useState("");
  const [providerTimedOut, setProviderTimedOut] = useState(false);
  const { login } = useLogin({
    onComplete: () => {
      setError("");
      setDialogOpen(false);
    },
    onError: (errorCode) => {
      const message = getWalletLoginErrorMessage(errorCode);
      if (!message) return;

      setError(message);
      setDialogOpen(true);
    },
  });
  const { linkWallet } = useLinkAccount({
    onSuccess: () => {
      setError("");
      setDialogOpen(false);
    },
    onError: (errorCode) => {
      const message = getWalletLoginErrorMessage(errorCode);
      if (!message) return;

      setError(message);
      setDialogOpen(true);
    },
  });

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
    };
  }, [authenticated, connectedWallet]);
  const sessionReady = ready && walletsReady;
  const hasSession = authenticated || wallets.length > 0;
  const sessionAction = getWalletSessionAction(
    sessionReady,
    authenticated,
    wallets.length,
  );

  const profileValue = useSyncExternalStore(
    subscribeToProfiles,
    () => readProfileValue(wallet?.account),
    getEmptyProfileValue,
  );
  const localProfile = useMemo(
    () => parseLocalProfile(profileValue),
    [profileValue],
  );
  const username = localProfile.username;
  const avatarDataUrl = localProfile.avatarDataUrl;

  useEffect(() => {
    if (sessionReady) return;

    const timeout = window.setTimeout(() => {
      setProviderTimedOut(true);
    }, 8_000);

    return () => window.clearTimeout(timeout);
  }, [sessionReady]);

  const setUsername = useCallback(
    (nextUsername: string) => {
      if (
        !wallet ||
        (nextUsername !== "" && !usernamePattern.test(nextUsername))
      ) {
        return;
      }

      try {
        const storageKey = getWalletProfileStorageKey(wallet.account);
        const profile = readStoredProfile(wallet.account);
        if (nextUsername) {
          profile.username = nextUsername;
        } else {
          delete profile.username;
        }

        if (Object.keys(profile).length > 0) {
          window.localStorage.setItem(storageKey, JSON.stringify(profile));
        } else {
          window.localStorage.removeItem(storageKey);
        }
        emitProfileChange(wallet.account);
      } catch {
        return;
      }
    },
    [wallet],
  );

  const startLogin = useCallback(() => {
    setError("");
    setDialogOpen(false);

    if (!sessionReady) {
      setError(
        "Wallet access is taking longer than expected. Reload the page and try again.",
      );
      setDialogOpen(true);
      return;
    }

    login({
      loginMethods: ["wallet", "email"],
      walletChainType: "ethereum-only",
    });
  }, [login, sessionReady]);

  const openWallet = useCallback(() => {
    setError("");

    if (sessionAction === "wait") {
      if (providerTimedOut) {
        setError(
          "Wallet access is taking longer than expected. Reload the page and try again.",
        );
        setDialogOpen(true);
      }
      return;
    }
    if (sessionAction === "manage") {
      setDialogOpen(true);
      return;
    }

    startLogin();
  }, [providerTimedOut, sessionAction, startLogin]);

  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    setError("");

    try {
      const operations = wallets.map(async (candidate) => {
        candidate.disconnect();
      });
      if (authenticated) {
        operations.push(Promise.resolve().then(logout));
      }

      const results = await Promise.allSettled(operations);
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("disconnect_failed");
      }

      setDialogOpen(false);
    } catch {
      setError("Unable to disconnect wallet. Try again.");
    } finally {
      setDisconnecting(false);
    }
  }, [authenticated, logout, wallets]);

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
      await connectedWallet.switchChain(appChain.id);
    } catch {
      setError(`Unable to switch to ${appNetworkName}. Try again.`);
    } finally {
      setSwitchingNetwork(false);
    }
  }, [connectedWallet]);

  const addWallet = useCallback(() => {
    setDialogOpen(false);
    linkWallet({
      description: "Add an Ethereum wallet to Programmable",
      walletChainType: "ethereum-only",
    });
  }, [linkWallet]);

  const sendTransaction = useCallback(
    async (transaction: PreparedTransaction) => {
      if (!connectedWallet || !wallet) {
        throw new Error("Connect an Ethereum wallet before continuing");
      }
      const prepared = parsePreparedTransactionForAccount(
        transaction,
        wallet.account,
      );
      if (prepared.chainId !== appChain.id) {
        throw new Error(
          `The prepared transaction is not for ${appNetworkName}`,
        );
      }
      if (wallet.chainId !== appChainHex) {
        await connectedWallet.switchChain(appChain.id);
      }
      const review = getPreparedTransactionReview(prepared.kind);

      const result = await sendPrivyTransaction(
        buildPrivyTransactionRequest(prepared),
        {
          address: wallet.account,
          uiOptions: {
            description: review.description,
            buttonText: review.buttonText,
            successHeader: review.successHeader,
          },
        },
      );
      return result.hash;
    },
    [
      connectedWallet,
      sendPrivyTransaction,
      wallet,
    ],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      username,
      avatarDataUrl,
      authenticated,
      hasSession,
      connecting: !sessionReady && !providerTimedOut,
      disconnecting,
      openWallet,
      disconnect,
      getAccessToken,
      setUsername,
      sendTransaction,
    }),
    [
      authenticated,
      avatarDataUrl,
      disconnect,
      disconnecting,
      getAccessToken,
      hasSession,
      openWallet,
      providerTimedOut,
      sendTransaction,
      sessionReady,
      setUsername,
      username,
      wallet,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {dialogOpen ? (
        <WalletDialog
          wallet={wallet}
          authenticated={authenticated}
          hasSession={hasSession}
          copied={copied}
          disconnecting={disconnecting}
          error={error}
          switchingNetwork={switchingNetwork}
          onAddWallet={addWallet}
          onClose={() => setDialogOpen(false)}
          onCopyAddress={copyAddress}
          onLogout={disconnect}
          onRetryLogin={startLogin}
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
      username: "",
      avatarDataUrl: "",
      authenticated: false,
      hasSession: false,
      connecting: false,
      disconnecting: false,
      openWallet: () => setDialogOpen(true),
      disconnect: async () => undefined,
      getAccessToken: async () => null,
      setUsername: () => undefined,
      sendTransaction: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
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
            Programmable uses Privy for wallet access. Please try again shortly
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
  authenticated,
  hasSession,
  copied,
  disconnecting,
  error,
  switchingNetwork,
  onAddWallet,
  onClose,
  onCopyAddress,
  onLogout,
  onRetryLogin,
  onSwitchNetwork,
}: {
  wallet: WalletState | null;
  authenticated: boolean;
  hasSession: boolean;
  copied: boolean;
  disconnecting: boolean;
  error: string;
  switchingNetwork: boolean;
  onAddWallet: () => void;
  onClose: () => void;
  onCopyAddress: () => void;
  onLogout: () => void;
  onRetryLogin: () => void;
  onSwitchNetwork: () => void;
}) {
  const title = wallet
    ? "Connected account"
    : authenticated
      ? "Complete wallet setup"
      : error
        ? "Wallet connection failed"
        : "Finish wallet connection";

  return (
    <DialogFrame
      eyebrow="Wallet"
      title={title}
      onClose={onClose}
    >
      {wallet ? (
        <div className="connected-wallet">
          <div className="wallet-account-row">
            <strong>{shortenAddress(wallet.account)}</strong>
          </div>

          {wallet.chainId !== appChainHex ? (
            <div className="wallet-network-warning">
              <p className="inline-notice warning-notice">
                Programmable uses {appNetworkName} for this release
              </p>
              <button
                className="secondary-button"
                type="button"
                disabled={switchingNetwork}
                onClick={onSwitchNetwork}
              >
                <Network aria-hidden="true" size={16} />
                {switchingNetwork
                  ? "Switching"
                  : `Switch to ${appNetworkName}`}
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
              disabled={disconnecting}
              onClick={onLogout}
            >
              <LogOut aria-hidden="true" size={16} />
              {disconnecting ? "Disconnecting" : "Disconnect wallet"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="dialog-copy">
            {authenticated
              ? "Add an Ethereum wallet before launching or managing a token"
              : hasSession
                ? "The wallet connected, but sign-in was not completed"
                : "Connect an Ethereum wallet to continue"}
          </p>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="primary-button dialog-full-button"
            type="button"
            onClick={authenticated ? onAddWallet : onRetryLogin}
          >
            <Wallet aria-hidden="true" size={16} />
            {authenticated ? "Add wallet" : "Try again"}
          </button>
          {hasSession ? (
            <button
              className="text-button dialog-logout-button danger-text"
              type="button"
              disabled={disconnecting}
              onClick={onLogout}
            >
              {disconnecting ? "Disconnecting" : "Disconnect wallet"}
            </button>
          ) : null}
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
  const {
    wallet,
    username,
    avatarDataUrl,
    authenticated,
    hasSession,
    connecting,
    disconnecting,
    openWallet,
  } = useWallet();

  const label = disconnecting
    ? "Disconnecting"
    : connecting
    ? compact
      ? "Connect"
      : "Connect wallet"
    : wallet
      ? username || shortenAddress(wallet.account)
      : authenticated
        ? "Set up wallet"
        : hasSession
          ? "Reconnect"
        : compact
          ? "Connect"
          : "Connect wallet";

  return (
    <button
      className={compact ? "wallet-button wallet-button-compact" : "wallet-button"}
      type="button"
      disabled={connecting || disconnecting}
      aria-haspopup="dialog"
      aria-label={
        wallet
          ? `Manage wallet ${username || shortenAddress(wallet.account)}`
          : label
      }
      onClick={openWallet}
    >
      {avatarDataUrl ? (
        <Image
          className="wallet-button-avatar"
          src={avatarDataUrl}
          alt=""
          width={24}
          height={24}
          unoptimized
        />
      ) : (
        <Wallet aria-hidden="true" size={16} />
      )}
      <span>{label}</span>
      {wallet ? (
        <ChevronDown
          className="wallet-button-chevron"
          aria-hidden="true"
          size={14}
        />
      ) : null}
    </button>
  );
}
