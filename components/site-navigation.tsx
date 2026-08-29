"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
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
import { useWallet } from "@/components/wallet-provider";
import styles from "@/components/site-navigation.module.css";

const desktopNavItems = [
  { href: "/explore", label: "Explore" },
  { href: "/launch", label: "Create" },
  { href: "/profile", label: "Profile" },
  { href: "/docs", label: "Docs" },
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
        aria-label="Programmable on Dexscreener"
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
  onNavigate,
}: Readonly<{
  menuOpen: boolean;
  onNavigate: () => void;
}>) {
  const {
    wallet,
    username,
    avatarDataUrl,
    authReady,
    connecting,
    hasSession,
    openWallet,
    preloadWallet,
  } = useWallet();

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
        <Link
          className={styles.apiKeysLink}
          href="/developers/api-keys"
          prefetch={false}
          tabIndex={menuOpen ? undefined : -1}
          onClick={onNavigate}
        >
          API keys
        </Link>
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
      className={styles.connectWallet}
      type="button"
      disabled={!authReady || connecting}
      tabIndex={menuOpen ? undefined : -1}
      aria-busy={connecting || undefined}
      onFocus={preloadWallet}
      onPointerEnter={preloadWallet}
      onClick={openWallet}
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

export function SiteHeader() {
  const pathname = usePathname();
  const menuId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuSurfaceRef = useRef<HTMLDivElement>(null);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;

  function restartHome(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    window.location.assign("/");
  }

  useEffect(() => {
    if (!menuOpen) return;

    window.requestAnimationFrame(() => {
      menuSurfaceRef.current
        ?.querySelector<HTMLElement>("a, button:not(:disabled)")
        ?.focus({ preventScroll: true });
    });

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !headerRef.current?.contains(event.target)
      ) {
        setMenuPath(null);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuPath(null);
      menuButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <header ref={headerRef} className={`site-header ${styles.siteHeader}`}>
      <div className={`header-inner ${styles.headerInner}`}>
        <div className="header-brand">
          <Link
            className="wordmark"
            href="/"
            prefetch={false}
            aria-label="Programmable home"
            onClick={restartHome}
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

        <div className={`header-actions ${styles.headerActions}`}>
          <button
            ref={menuButtonRef}
            className={styles.menuButton}
            type="button"
            aria-controls={menuId}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuPath(menuOpen ? null : pathname)}
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
          ref={menuSurfaceRef}
          className={styles.mobileSheetSurface}
          id={menuId}
        >
          <HeaderAccountAction
            menuOpen={menuOpen}
            onNavigate={() => setMenuPath(null)}
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
