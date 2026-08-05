"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Compass,
  Plus,
  UserRound,
} from "lucide-react";
import {
  GitHubBrandIcon,
  XBrandIcon,
} from "@/components/brand-icons";
import { WalletButton } from "@/components/wallet-provider";

const desktopNavItems = [
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/launch", label: "Create", icon: Plus },
  { href: "/docs/developers", label: "Docs", icon: BookOpen },
  { href: "/profile", label: "Profile", icon: UserRound },
];

const mobileNavItems = desktopNavItems;

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();

  if (pathname === "/") return null;

  return (
    <header className="site-header">
      <div className="header-inner liquid-glass-surface liquid-glass-distortion">
        <div className="header-brand">
          <Link className="wordmark" href="/" aria-label="Programmable home">
            <Image
              className="wordmark-logo"
              src="/brand/loop/programmable-loop-mark-header.png"
              alt=""
              width={146}
              height={192}
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
            <a
              className="header-social-link"
              href="https://dexscreener.com/ethereum/0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0"
              target="_blank"
              rel="noreferrer"
              aria-label="Programmable on Dexscreener"
            >
              <Image
                className="header-social-logo"
                src="/brand/platforms/dexscreener-mark-white.png"
                alt=""
                width={256}
                height={256}
                sizes="22px"
              />
            </a>
          </div>
          <WalletButton compact />
        </div>
      </div>
    </header>
  );
}

export function MobileNavigation() {
  const pathname = usePathname();

  if (pathname === "/") return null;

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
