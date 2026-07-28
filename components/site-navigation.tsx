"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Moon, Plus, Sun, UserRound } from "lucide-react";
import { useSyncExternalStore } from "react";
import { WalletButton } from "@/components/wallet-provider";

type ColorTheme = "light" | "dark";
const themeChangeEvent = "programmable:theme-changed";

const navItems = [
  { href: "/", label: "Explore", icon: Compass },
  { href: "/launch", label: "Launch", icon: Plus },
  { href: "/profile", label: "Profile", icon: UserRound },
];

function XBrandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"
      />
    </svg>
  );
}

function GitHubBrandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M12 1C5.923 1 1 5.923 1 12c0 4.867 3.149 8.979 7.521 10.436.55.096.756-.233.756-.522 0-.262-.013-1.128-.013-2.049-3.06.56-3.703-.741-3.703-.741-.5-1.273-1.221-1.612-1.221-1.612-.998-.682.075-.668.075-.668 1.105.078 1.686 1.133 1.686 1.133.984 1.68 2.58 1.195 3.208.914.1-.713.385-1.195.699-1.47-2.442-.278-5.01-1.221-5.01-5.436 0-1.202.428-2.183 1.132-2.952-.113-.278-.491-1.398.108-2.912 0 0 .923-.295 3.025 1.127A10.5 10.5 0 0 1 12 6.699c.936.004 1.876.127 2.753.371 2.1-1.422 3.022-1.127 3.022-1.127.6 1.514.223 2.634.11 2.912.705.77 1.13 1.75 1.13 2.952 0 4.225-2.572 5.155-5.02 5.428.394.34.744 1.01.744 2.038 0 1.47-.014 2.657-.014 3.018 0 .292.198.623.762.516C19.853 20.973 23 16.865 23 12c0-6.077-4.922-11-11-11Z"
      />
    </svg>
  );
}

function isCurrent(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname.startsWith(href);
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
      aria-pressed={theme === "dark"}
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
              src="/brand/loop/programmable-loop-mark-transparent-v1.png"
              alt=""
              width={38}
              height={38}
              priority
            />
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
            href="https://github.com/0xprogrammable/programmable"
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
