"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Plus, UserRound } from "lucide-react";
import { WalletButton } from "@/components/wallet-provider";

const navItems = [
  { href: "/", label: "Explore", icon: Compass },
  { href: "/launch", label: "Launch", icon: Plus },
  { href: "/profile", label: "Profile", icon: UserRound },
];

function isCurrent(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="wordmark" href="/" aria-label="Launcher home">
          <span className="wordmark-glyph" aria-hidden="true">
            L
          </span>
          <span>Launcher</span>
        </Link>

        <nav className="desktop-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <Link
              key={item.href}
              className={isCurrent(pathname, item.href) ? "active" : undefined}
              href={item.href}
              aria-current={
                isCurrent(pathname, item.href) ? "page" : undefined
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <WalletButton compact />
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
