"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Plus, UserRound } from "lucide-react";
import { WalletButton } from "@/components/wallet-provider";

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

function isCurrent(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname.startsWith(href);
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
              src="/icon-512.png"
              alt=""
              width={34}
              height={34}
              priority
            />
            <span>Programmable</span>
          </Link>
          <a
            className="header-x-link"
            href="https://x.com/0xProgrammable"
            target="_blank"
            rel="noreferrer"
            aria-label="Programmable on X"
          >
            <XBrandIcon />
          </a>
        </div>

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
