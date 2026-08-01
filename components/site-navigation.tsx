"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Compass,
  Moon,
  Plus,
  Sun,
  UserRound,
} from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  GitHubBrandIcon,
  XBrandIcon,
} from "@/components/brand-icons";
import { WalletButton } from "@/components/wallet-provider";

type ColorTheme = "light" | "dark";
const themeChangeEvent = "programmable:theme-changed";

const navItems = [
  { href: "/", label: "Explore", icon: Compass },
  { href: "/launch", label: "Launch", icon: Plus },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

function isCurrent(pathname: string, href: string) {
  if (href === "/") {
    return (
      pathname === href ||
      pathname.startsWith("/projects/") ||
      pathname.startsWith("/token/")
    );
  }

  return pathname.startsWith(href);
}

function subscribeToTheme(callback: () => void) {
  window.addEventListener(themeChangeEvent, callback);
  return () => window.removeEventListener(themeChangeEvent, callback);
}

function getThemeSnapshot(): ColorTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerThemeSnapshot(): ColorTheme {
  return "light";
}

function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  function toggleTheme() {
    const nextTheme: ColorTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;

    try {
      window.localStorage.setItem("programmable-theme", nextTheme);
    } catch {
      // The theme still changes for the current page when storage is blocked.
    }

    window.dispatchEvent(new Event(themeChangeEvent));
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
      }
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      onClick={toggleTheme}
    >
      <span className="theme-toggle-icons" aria-hidden="true">
        <Moon className="theme-toggle-moon" size={20} strokeWidth={1.9} />
        <Sun className="theme-toggle-sun" size={20} strokeWidth={1.9} />
      </span>
    </button>
  );
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="header-inner">
        <div className="header-brand">
          <Link className="wordmark" href="/" aria-label="Programmable home">
            <Image
              className="wordmark-logo"
              src="/brand/loop/programmable-loop-mark-header.png"
              alt=""
              width={146}
              height={192}
              priority
            />
            <span className="wordmark-copy">
              <strong>Programmable</strong>
            </span>
          </Link>
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
        </div>

        <nav className="desktop-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
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

        <div className="header-actions">
          <ThemeToggle />
          <WalletButton compact />
        </div>
      </div>
    </header>
  );
}

export function MobileNavigation() {
  const pathname = usePathname();

  return (
    <nav className="mobile-nav" aria-label="Primary navigation">
      {navItems.map((item) => {
        const Icon = item.icon;
        const current = isCurrent(pathname, item.href);
        return (
          <Link
            key={item.href}
            className={current ? "active" : undefined}
            href={item.href}
            aria-current={current ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
