"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { WalletButton } from "@/components/wallet-provider";
import styles from "@/components/site-navigation.module.css";

const desktopNavItems = [
  { href: "/explore", label: "Explore" },
  { href: "/launch", label: "Create" },
  { href: "/profile", label: "Profile" },
  { href: "/docs", label: "Docs" },
];

const mobileNavItems = desktopNavItems;

function isCurrent(pathname: string, href: string) {
  if (href === "/docs") {
    return pathname === "/docs" || pathname.startsWith("/docs/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();
  const menuId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;

  useEffect(() => {
    if (!menuOpen) return;

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
    <header
      ref={headerRef}
      className={`site-header ${styles.siteHeader}`}
    >
      <div className={`header-inner ${styles.headerInner}`}>
        <div className="header-brand">
          <Link
            className="wordmark"
            href="/#intro"
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

        <nav className="desktop-nav" aria-label="Primary navigation">
          {desktopNavItems.map((item) => (
            <Link
              key={item.href}
              className={isCurrent(pathname, item.href) ? "active" : undefined}
              href={item.href}
              aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={`header-actions ${styles.headerActions}`}>
          <div className={`header-socials ${styles.headerSocials}`}>
            <a
              className="header-social-link"
              href="https://x.com/0xProgrammable"
              target="_blank"
              rel="noreferrer"
              aria-label="Programmable on X"
            >
              <XBrandIcon />
            </a>
            <a
              className="header-social-link"
              href="https://github.com/0xprogrammable"
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
          <WalletButton compact />
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
            <span>Menu</span>
          </button>
        </div>
      </div>

      <div
        className={`${styles.mobileSheet} ${
          menuOpen ? styles.mobileSheetOpen : ""
        }`}
      >
        <div className={styles.mobileSheetSurface} id={menuId}>
          <MobileNavigation
            id={menuId}
            open={menuOpen}
            onNavigate={() => setMenuPath(null)}
          />
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

  // AppShell retains this export for compatibility. The responsive navigation
  // is rendered inside SiteHeader so its visual and keyboard order stay at the
  // top of the page.
  if (!id) return null;

  return (
    <nav className="mobile-nav" aria-label="Primary navigation">
      {mobileNavItems.map((item) => {
        const current = isCurrent(pathname, item.href);
        return (
          <Link
            key={item.href}
            className={current ? "active" : undefined}
            href={item.href}
            aria-current={current ? "page" : undefined}
            tabIndex={open ? undefined : -1}
            onClick={onNavigate}
          >
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
