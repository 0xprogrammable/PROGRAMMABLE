"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type RefObject,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  DiscordBrandIcon,
  DuneBrandIcon,
  GitHubBrandIcon,
  XBrandIcon,
} from "@/components/brand-icons";
import {
  NavigationCloseIcon,
  NavigationMenuIcon,
} from "@/components/navigation-icons";
import { useViewChain, type ViewChainId } from "@/components/view-chain";
import { isRobinhoodUnavailableRoute } from
  "@/components/view-chain-unavailable";
import { useWallet } from "@/components/wallet-provider";
import styles from "@/components/site-navigation.module.css";

const desktopNavItems = [
  { href: "/explore", label: "Explore" },
  { href: "/launch", label: "Create" },
  { href: "/docs", label: "Docs" },
  { href: "/developers/api-keys", label: "API keys" },
  { href: "/profile", label: "Profile" },
];

const mobileNavItems = desktopNavItems;
const warmedNavigationRoutes = new Set<string>();

function warmNavigationRoute(
  router: ReturnType<typeof useRouter>,
  href: string,
) {
  if (warmedNavigationRoutes.has(href)) return;
  warmedNavigationRoutes.add(href);
  router.prefetch(href);
}

function HeaderSocialLinks({ mobile = false }: { mobile?: boolean }) {
  return (
    <div
      className={
        mobile
          ? styles.mobileSocials
          : `header-socials ${styles.headerSocials}`
      }
      role="group"
      aria-label="Programmable social links"
    >
      <a
        className="header-social-link"
        href="https://x.com/ProgrammableHQ"
        target="_blank"
        rel="noreferrer"
        aria-label="Programmable on X"
      >
        <XBrandIcon />
      </a>
      <a
        className="header-social-link"
        href="https://github.com/programmablehq"
        target="_blank"
        rel="noreferrer"
        aria-label="Programmable on GitHub"
      >
        <GitHubBrandIcon />
      </a>
      <a
        className="header-social-link"
        href="https://dexscreener.com/ethereum/0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0"
        target="_blank"
        rel="noreferrer"
        aria-label="Programmable on DEX Screener"
      >
        <Image
          className="header-social-logo"
          src="/brand/platforms/dexscreener-mark-warm-ivory-v1.png"
          alt=""
          width={256}
          height={256}
          sizes="22px"
        />
      </a>
      <a
        className="header-social-link"
        href="https://dune.com/0xprogrammable6098/programmable-analytics"
        target="_blank"
        rel="noreferrer"
        aria-label="Programmable analytics on Dune"
      >
        <DuneBrandIcon />
      </a>
      <a
        className="header-social-link"
        href="https://discord.com/invite/programmable"
        target="_blank"
        rel="noreferrer"
        aria-label="Programmable on Discord"
      >
        <DiscordBrandIcon />
      </a>
    </div>
  );
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function ProgrammableAccountMark() {
  return (
    <span className={styles.accountMark} aria-hidden="true">
      <Image
        className={styles.accountMarkImage}
        src="/brand/loop/programmable-loop-mark-header-white-v1-1536.png"
        alt=""
        width={1168}
        height={1536}
        sizes="18px"
      />
    </span>
  );
}

function HeaderAccountAction({
  menuOpen,
  onConnect,
}: Readonly<{
  menuOpen: boolean;
  onConnect: () => void;
}>) {
  const {
    wallet,
    username,
    avatarDataUrl,
    authReady,
    connecting,
    disconnecting,
    hasSession,
    disconnect,
    openWallet,
    preloadWallet,
  } = useWallet();
  const [disconnectError, setDisconnectError] = useState("");
  const focusConnectAfterDisconnectRef = useRef(false);

  if (wallet) {
    return (
      <div className={styles.accountGroup}>
        <div className={styles.accountAction}>
          {avatarDataUrl ? (
            <Image
              className={styles.accountAvatar}
              src={avatarDataUrl}
              alt=""
              width={36}
              height={36}
              unoptimized
            />
          ) : (
            <ProgrammableAccountMark />
          )}
          <span className={styles.accountCopy}>
            <strong>Connected wallet</strong>
            <small>{username || shortenAddress(wallet.account)}</small>
          </span>
        </div>
        <button
          className={styles.disconnectWallet}
          type="button"
          disabled={disconnecting}
          tabIndex={menuOpen ? undefined : -1}
          onClick={async () => {
            setDisconnectError("");
            focusConnectAfterDisconnectRef.current = true;
            const disconnected = await disconnect({
              showDialogOnFailure: false,
            });
            if (disconnected) {
              return;
            }
            focusConnectAfterDisconnectRef.current = false;
            setDisconnectError("Wallet could not be disconnected. Try again.");
          }}
        >
          {disconnecting ? "Disconnecting" : "Disconnect"}
        </button>
        {disconnectError ? (
          <p className={styles.accountError} role="alert">
            {disconnectError}
          </p>
        ) : null}
      </div>
    );
  }

  const label = !authReady
    ? "Loading wallet"
    : connecting
      ? "Opening wallet"
      : hasSession
        ? "Reconnect wallet"
        : "Connect wallet";

  return (
    <button
      ref={(node) => {
        if (!node || !focusConnectAfterDisconnectRef.current) return;
        focusConnectAfterDisconnectRef.current = false;
        if (menuOpen) node.focus({ preventScroll: true });
      }}
      className={styles.connectWallet}
      type="button"
      disabled={!authReady || connecting}
      tabIndex={menuOpen ? undefined : -1}
      aria-busy={connecting || undefined}
      onFocus={preloadWallet}
      onPointerEnter={preloadWallet}
      onClick={() => {
        onConnect();
        openWallet();
      }}
    >
      <ProgrammableAccountMark />
      <span>{label}</span>
    </button>
  );
}

function isCurrent(pathname: string, item: (typeof desktopNavItems)[number]) {
  const activePath = "activePath" in item ? item.activePath : item.href;

  if (activePath === "/explore") {
    return (
      pathname === "/explore" ||
      pathname.startsWith("/explore/")
    );
  }
  if (activePath === "/docs") {
    return pathname === "/docs" || pathname.startsWith("/docs/");
  }
  return pathname === activePath || pathname.startsWith(`${activePath}/`);
}

function DesktopNavigation() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="desktop-nav" aria-label="Primary navigation">
      {desktopNavItems.map((item) => {
        const current = isCurrent(pathname, item);
        return (
          <Link
            key={item.href}
            className={current ? "active" : undefined}
            href={item.href}
            prefetch={false}
            aria-current={current ? "page" : undefined}
            onFocus={() => warmNavigationRoute(router, item.href)}
            onPointerEnter={() => warmNavigationRoute(router, item.href)}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ViewChainMark({ viewChainId }: { viewChainId: ViewChainId }) {
  if (viewChainId === 4663) {
    return (
      <span className={styles.robinhoodChainMark} aria-hidden="true">
        R
      </span>
    );
  }

  return (
    <svg
      className={styles.ethereumChainMark}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2 5.5 12.2 12 9.25l6.5 2.95L12 2Z" fill="currentColor" />
      <path
        d="m5.5 13.35 6.5 3.7 6.5-3.7L12 22 5.5 13.35Z"
        fill="currentColor"
        opacity="0.72"
      />
      <path d="m12 9.25-6.5 2.95L12 15.9l6.5-3.7L12 9.25Z" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

function viewChainLabel(viewChainId: ViewChainId) {
  return viewChainId === 1 ? "Ethereum" : "Robinhood";
}

function HeaderChainSelector({
  open,
  panelId,
  rootRef,
  triggerRef,
  onDismiss,
  onToggle,
  onSelect,
}: Readonly<{
  open: boolean;
  panelId: string;
  rootRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onDismiss: () => void;
  onToggle: () => void;
  onSelect: () => void;
}>) {
  const { hydrated, viewChainId, setViewChainId } = useViewChain();
  const alternateViewChainId: ViewChainId = viewChainId === 1 ? 4663 : 1;
  const currentLabel = viewChainLabel(viewChainId);
  const alternateLabel = viewChainLabel(alternateViewChainId);
  const alternateStatus =
    alternateViewChainId === 4663
      ? "Public index coming soon"
      : "View Ethereum Chain";

  function closeOnFocusLeave(event: FocusEvent<HTMLDivElement>) {
    if (!open) return;
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    const root = event.currentTarget;
    window.requestAnimationFrame(() => {
      if (!root.contains(document.activeElement)) onDismiss();
    });
  }

  return (
    <div
      ref={rootRef}
      className={styles.chainSelector}
      onBlur={closeOnFocusLeave}
    >
      <button
        ref={triggerRef}
        className={styles.chainTrigger}
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        aria-busy={!hydrated || undefined}
        aria-label={
          hydrated ? `Viewing ${currentLabel}. Change network` : "Loading network"
        }
        disabled={!hydrated}
        title={hydrated ? currentLabel : undefined}
        onClick={onToggle}
      >
        {hydrated ? (
          <ViewChainMark viewChainId={viewChainId} />
        ) : (
          <span className={styles.chainMarkPlaceholder} aria-hidden="true" />
        )}
      </button>

      <div
        className={`${styles.chainPopover} ${
          open ? styles.chainPopoverOpen : ""
        }`}
        aria-hidden={!open}
        inert={open ? undefined : true}
      >
        <div
          className={styles.chainPopoverSurface}
          id={panelId}
          role="group"
          aria-label="Choose network"
        >
          <button
            className={styles.chainOption}
            type="button"
            tabIndex={open ? undefined : -1}
            data-view-chain-id={alternateViewChainId}
            onClick={() => {
              setViewChainId(alternateViewChainId);
              onSelect();
            }}
          >
            <span className={styles.chainOptionMark} aria-hidden="true">
              <ViewChainMark viewChainId={alternateViewChainId} />
            </span>
            <span className={styles.chainOptionCopy}>
              <strong>{alternateLabel}</strong>
              <small>{alternateStatus}</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const { preloadWallet } = useWallet();
  const menuId = useId();
  const chainPanelId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const chainSelectorRef = useRef<HTMLDivElement>(null);
  const chainButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [chainSelectorOpen, setChainSelectorOpen] = useState(false);
  const menuOpen = menuPath === pathname;

  useEffect(() => {
    if (!menuOpen && !chainSelectorOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuOpen && !headerRef.current?.contains(event.target)) {
        setMenuPath(null);
      }
      if (
        chainSelectorOpen &&
        !chainSelectorRef.current?.contains(event.target)
      ) {
        setChainSelectorOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (chainSelectorOpen) {
        setChainSelectorOpen(false);
        chainButtonRef.current?.focus();
        return;
      }
      if (menuOpen) {
        setMenuPath(null);
        menuButtonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [chainSelectorOpen, menuOpen]);

  function closeOnFocusLeave(event: FocusEvent<HTMLElement>) {
    if (!menuOpen) return;
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    const header = event.currentTarget;
    window.requestAnimationFrame(() => {
      if (!header.contains(document.activeElement)) setMenuPath(null);
    });
  }

  return (
    <header
      ref={headerRef}
      className={`site-header ${styles.siteHeader}`}
      onBlur={closeOnFocusLeave}
    >
      <div className={`header-inner ${styles.headerInner}`}>
        <div className="header-brand">
          <Link
            className="wordmark"
            href="/"
            prefetch={false}
            aria-label="Programmable home"
          >
            <Image
              className="wordmark-logo"
              src="/brand/loop/programmable-loop-mark-header-white-v1-1536.png"
              alt=""
              width={1168}
              height={1536}
              sizes="32px"
              priority
            />
          </Link>
        </div>

        <DesktopNavigation />

        <div className={`header-actions ${styles.headerActions}`}>
          <HeaderChainSelector
            open={chainSelectorOpen}
            panelId={chainPanelId}
            rootRef={chainSelectorRef}
            triggerRef={chainButtonRef}
            onDismiss={() => setChainSelectorOpen(false)}
            onToggle={() => {
              setMenuPath(null);
              setChainSelectorOpen((open) => !open);
            }}
            onSelect={() => {
              setChainSelectorOpen(false);
              if (isRobinhoodUnavailableRoute(pathname)) return;
              window.requestAnimationFrame(() => {
                chainButtonRef.current?.focus({ preventScroll: true });
              });
            }}
          />
          <button
            ref={menuButtonRef}
            className={styles.menuButton}
            type="button"
            aria-controls={menuId}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onFocus={preloadWallet}
            onPointerEnter={preloadWallet}
            onClick={() => {
              preloadWallet();
              setChainSelectorOpen(false);
              setMenuPath(menuOpen ? null : pathname);
            }}
          >
            <span className={styles.menuIcon} aria-hidden="true">
              <NavigationMenuIcon
                className={menuOpen ? styles.iconHidden : styles.iconVisible}
              />
              <NavigationCloseIcon
                className={menuOpen ? styles.iconVisible : styles.iconHidden}
              />
            </span>
          </button>
        </div>
      </div>

      <div
        className={`${styles.mobileSheet} ${
          menuOpen ? styles.mobileSheetOpen : ""
        }`}
        aria-hidden={!menuOpen}
        inert={menuOpen ? undefined : true}
      >
        <div
          className={styles.mobileSheetSurface}
          id={menuId}
        >
          <HeaderAccountAction
            menuOpen={menuOpen}
            onConnect={() => setMenuPath(null)}
          />
          <MobileNavigation
            id={menuId}
            open={menuOpen}
            onNavigate={() => setMenuPath(null)}
          />
          <HeaderSocialLinks mobile />
        </div>
      </div>
    </header>
  );
}

type MobileNavigationProps = {
  id?: string;
  open?: boolean;
  onNavigate?: () => void;
};

export function MobileNavigation({
  id,
  open = false,
  onNavigate,
}: MobileNavigationProps = {}) {
  const pathname = usePathname();
  const router = useRouter();

  // AppShell retains this export for compatibility. The responsive navigation
  // is rendered inside SiteHeader so its visual and keyboard order stay at the
  // top of the page.
  if (!id) return null;

  return (
    <nav className="mobile-nav" aria-label="Primary navigation">
      {mobileNavItems.map((item) => {
        const current = isCurrent(pathname, item);
        return (
          <Link
            key={item.href}
            className={current ? "active" : undefined}
            href={item.href}
            prefetch={false}
            aria-current={current ? "page" : undefined}
            tabIndex={open ? undefined : -1}
            onFocus={() => warmNavigationRoute(router, item.href)}
            onPointerEnter={() => warmNavigationRoute(router, item.href)}
            onClick={onNavigate}
          >
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
