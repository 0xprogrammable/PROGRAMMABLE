import Image from "next/image";
import Link from "next/link";

import styles from "@/components/site-footer.module.css";

const productLinks = [
  { href: "/explore", label: "Explore" },
  { href: "/launch", label: "Create" },
  { href: "/profile", label: "Profile" },
  { href: "/docs", label: "Docs" },
];

const resourceLinks = [
  {
    href: "/analytics",
    label: "Analytics",
  },
  {
    href: "https://github.com/0xprogrammable",
    label: "GitHub",
    external: true,
  },
  {
    href: "https://dexscreener.com/ethereum/0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0",
    label: "Token",
    external: true,
  },
  {
    href: "https://dune.com/0xprogrammable6098/programmable-analytics",
    label: "Dune",
    external: true,
  },
  {
    href: "https://discord.com/invite/programmable",
    label: "Discord",
    external: true,
  },
  {
    href: "https://x.com/0xProgrammable",
    label: "X",
    external: true,
  },
  {
    href: "https://docs.uniswap.org/contracts/v4/overview",
    label: "Uniswap v4",
    external: true,
  },
];

export function SiteFooter() {
  return (
    <footer
      className={`${styles.footer} page-width`}
      aria-label="Site footer"
    >
      <div
        className={`${styles.surface} liquid-glass-surface`}
      >
        <section className={styles.brand}>
          <Link
            className={styles.brandLink}
            href="/"
            aria-label="Programmable home"
          >
            <Image
              className={styles.mark}
              src="/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png"
              alt=""
              width={1168}
              height={1536}
              sizes="38px"
            />
            <span>Programmable</span>
          </Link>
          <p className={styles.copyright}>© 2026 Programmable</p>
        </section>

        <nav className={styles.column} aria-label="Product">
          <h2 className={styles.label}>Product</h2>
          <ul>
            {productLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav className={styles.column} aria-label="Resources">
          <h2 className={styles.label}>Resources</h2>
          <ul>
            {resourceLinks.map((link) => (
              <li key={link.href}>
                {link.external ? (
                  <a href={link.href} target="_blank" rel="noreferrer">
                    {link.label}
                  </a>
                ) : (
                  <Link href={link.href}>{link.label}</Link>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <section className={styles.risk}>
          <h2 className={styles.label}>Risk notice</h2>
          <p>
            Transactions may be irreversible. Tokens can be volatile, illiquid
            or lose all value. Programmable does not provide financial advice
            or guarantee a token&apos;s quality.
          </p>
        </section>
      </div>
    </footer>
  );
}
