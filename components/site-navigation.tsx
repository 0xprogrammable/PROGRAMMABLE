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
import { useSyncExternalStore, type MouseEvent } from "react";
import {
  GitHubBrandIcon,
  XBrandIcon,
} from "@/components/brand-icons";
import { WalletButton } from "@/components/wallet-provider";

type ColorTheme = "light" | "dark";
type ThemeViewTransition = {
  finished: Promise<void>;
  skipTransition: () => void;
};
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ThemeViewTransition;
};
const themeChangeEvent = "programmable:theme-changed";
let themeTransitionSequence = 0;
let themeFallbackTimer: number | null = null;
let themeInstantCleanupFrame: number | null = null;
let activeThemeViewTransition: ThemeViewTransition | null = null;

function clearThemeReveal(root: HTMLElement) {
  if (themeFallbackTimer !== null) {
    window.clearTimeout(themeFallbackTimer);
    themeFallbackTimer = null;
  }
  delete root.dataset.themeTransition;
}

const desktopNavItems = [
  { href: "/", label: "Explore", icon: Compass },
  { href: "/launch", label: "Create", icon: Plus },
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/profile", label: "Profile", icon: UserRound },
];

const mobileNavItems = desktopNavItems;

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

  function commitTheme(nextTheme: ColorTheme) {
    const root = document.documentElement;
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme;

    try {
      window.localStorage.setItem("programmable-theme", nextTheme);
    } catch {
      // The theme still changes for the current page when storage is blocked.
    }

    window.dispatchEvent(new Event(themeChangeEvent));
  }

  function toggleTheme(event: MouseEvent<HTMLButtonElement>) {
    const nextTheme: ColorTheme = theme === "dark" ? "light" : "dark";
    const viewTransitionDocument = document as ViewTransitionDocument;
    const root = document.documentElement;
    const transitionSequence = ++themeTransitionSequence;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    activeThemeViewTransition?.skipTransition();
    activeThemeViewTransition = null;
    clearThemeReveal(root);

    if (event.detail === 0 || reduceMotion) {
      if (themeInstantCleanupFrame !== null) {
        window.cancelAnimationFrame(themeInstantCleanupFrame);
      }
      root.dataset.themeInput = "instant";
      commitTheme(nextTheme);
      themeInstantCleanupFrame = window.requestAnimationFrame(() => {
        themeInstantCleanupFrame = window.requestAnimationFrame(() => {
          delete root.dataset.themeInput;
          themeInstantCleanupFrame = null;
        });
      });
      return;
    }

    if (themeInstantCleanupFrame !== null) {
      window.cancelAnimationFrame(themeInstantCleanupFrame);
      themeInstantCleanupFrame = null;
    }
    delete root.dataset.themeInput;

    const runFallbackReveal = () => {
      root.dataset.themeTransition = `fallback-${nextTheme}`;
      root.getBoundingClientRect();
      commitTheme(nextTheme);
      themeFallbackTimer = window.setTimeout(() => {
        if (transitionSequence === themeTransitionSequence) {
          clearThemeReveal(root);
        }
      }, 420);
    };

    if (!viewTransitionDocument.startViewTransition) {
      runFallbackReveal();
      return;
    }

    root.dataset.themeTransition = "soft";

    try {
      const transition = viewTransitionDocument.startViewTransition(() => {
        commitTheme(nextTheme);
      });
      activeThemeViewTransition = transition;

      const finishReveal = () => {
        if (activeThemeViewTransition === transition) {
          activeThemeViewTransition = null;
        }
        if (transitionSequence === themeTransitionSequence) {
          clearThemeReveal(root);
        }
      };
      void transition.finished.then(finishReveal, finishReveal);
    } catch {
      clearThemeReveal(root);
      runFallbackReveal();
    }
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
      }
      data-theme={theme}
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
              sizes="28px"
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

        <div className="header-actions">
          <div className="header-socials">
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
      {mobileNavItems.map((item) => {
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
