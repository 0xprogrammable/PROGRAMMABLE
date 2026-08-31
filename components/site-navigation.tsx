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
import { isRobinhoodUnavailableRoute } from "@/components/view-chain-unavailable";
import { useWallet } from "@/components/wallet-provider";
import styles from "@/components/site-navigation.module.css";

const desktopNavItems = [
  { href: "/explore", label: "Explore" },
  { href: "/launch", label: "Create" },
  { href: "/migration", label: "Migrate" },
];

const menuNavItems = [
  { href: "/developers/api-keys", label: "API keys" },
  { href: "/profile", label: "Profile" },
  { href: "/docs", label: "Docs" },
];

const mobileNavItems = [...desktopNavItems, ...menuNavItems];
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
        mobile ? styles.mobileSocials : `header-socials ${styles.headerSocials}`
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

function HeaderWalletButton({ onOpen }: Readonly<{ onOpen: () => void }>) {
  const {
    wallet,
    hasSession,
    connecting,
    disconnecting,
    openWallet,
    preloadWallet,
  } = useWallet();
  const label = disconnecting
    ? "Disconnecting"
    : connecting
      ? "Opening wallet"
      : wallet
        ? shortenAddress(wallet.account)
        : hasSession
          ? "Reconnect wallet"
          : "Connect wallet";

  return (
    <button
      className={styles.headerWalletButton}
      type="button"
      disabled={connecting || disconnecting}
      aria-busy={connecting || disconnecting || undefined}
      aria-haspopup="dialog"
      aria-label={wallet ? `Manage wallet ${shortenAddress(wallet.account)}` : label}
      onFocus={preloadWallet}
      onPointerEnter={preloadWallet}
      onClick={() => {
        onOpen();
        openWallet();
      }}
    >
      {label}
    </button>
  );
}

function isCurrent(pathname: string, item: (typeof desktopNavItems)[number]) {
  const activePath = "activePath" in item ? item.activePath : item.href;

  if (activePath === "/explore") {
    return pathname === "/explore" || pathname.startsWith("/explore/");
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
      <span className={styles.robinhoodChainMark} aria-hidden="true" />
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
      />
      <path
        d="m12 9.25-6.5 2.95L12 15.9l6.5-3.7L12 9.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

function viewChainLabel(viewChainId: ViewChainId) {
  return viewChainId === 1 ? "Ethereum" : "Robinhood";
}

function HeaderChainToggle({
  triggerRef,
  onSelect,
}: Readonly<{
  triggerRef: RefObject<HTMLButtonElement | null>;
  onSelect: (viewChainId: ViewChainId) => void;
}>) {
  const { hydrated, viewChainId, setViewChainId } = useViewChain();
  const alternateViewChainId: ViewChainId = viewChainId === 1 ? 4663 : 1;
  const currentLabel = viewChainLabel(viewChainId);
  const alternateLabel = viewChainLabel(alternateViewChainId);

  return (
    <button
      ref={triggerRef}
      className={styles.chainTrigger}
      type="button"
      aria-busy={!hydrated || undefined}
      aria-label={`Viewing ${currentLabel}. Switch to ${alternateLabel}`}
      disabled={!hydrated}
      title={`Switch to ${alternateLabel}`}
      onClick={() => {
        setViewChainId(alternateViewChainId);
        onSelect(alternateViewChainId);
      }}
    >
      <ViewChainMark viewChainId={viewChainId} />
    </button>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const menuId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const chainButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuOpen && !headerRef.current?.contains(event.target)) {
        setMenuPath(null);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
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
  }, [menuOpen]);

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
          <HeaderChainToggle
            triggerRef={chainButtonRef}
            onSelect={(selectedViewChainId) => {
              setMenuPath(null);
              if (pathname.startsWith("/token/")) {
                const url = new URL(window.location.href);
                url.searchParams.set("chain", String(selectedViewChainId));
                const search = url.searchParams.toString();
                router.replace(`${pathname}${search ? `?${search}` : ""}`);
                window.requestAnimationFrame(() => {
                  chainButtonRef.current?.focus({ preventScroll: true });
                });
                return;
              }
              if (isRobinhoodUnavailableRoute(pathname)) return;
              window.requestAnimationFrame(() => {
                chainButtonRef.current?.focus({ preventScroll: true });
              });
            }}
          />
          <HeaderWalletButton onOpen={() => setMenuPath(null)} />
          <button
            ref={menuButtonRef}
            className={styles.menuButton}
            type="button"
            aria-controls={menuId}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => {
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
        <div className={styles.mobileSheetSurface} id={menuId}>
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
    <nav className="mobile-nav" aria-label="Menu navigation">
      {mobileNavItems.map((item) => {
        const current = isCurrent(pathname, item);
        return (
          <Link
            key={item.href}
            className={[
              current ? "active" : "",
              desktopNavItems.includes(item) ? styles.mobilePrimaryLink : "",
            ].filter(Boolean).join(" ") || undefined}
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
