import Image from "next/image";
import Link from "next/link";

import {
  GitHubBrandIcon,
  XBrandIcon,
} from "@/components/brand-icons";
import styles from "@/components/site-footer.module.css";

const productLinks = [
  { href: "/", label: "Explore" },
  { href: "/launch", label: "Launch" },
  { href: "/profile", label: "Profile" },
  { href: "/docs", label: "Docs" },
];

const resourceLinks = [
  {
    href: "https://github.com/0xprogrammable",
    label: "GitHub",
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
      <div className={styles.surface}>
        <section className={styles.brand}>
          <Link href="/" aria-label="Programmable home">
            <Image
              className={styles.mark}
              src="/brand/loop/programmable-loop-mark-header.png"
              alt=""
              width={146}
              height={192}
            />
          </Link>
          <p>
            Launch and explore fixed-supply tokens whose behavior is defined by
            Uniswap v4 hooks. Your connected wallet submits every transaction.
          </p>
        </section>

        <nav className={styles.column} aria-label="Product">
          <p className={styles.label}>Product</p>
          <ul>
            {productLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav className={styles.column} aria-label="Resources">
          <p className={styles.label}>Resources</p>
          <ul>
            {resourceLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target={link.external ? "_blank" : undefined}
                  rel={link.external ? "noreferrer" : undefined}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <section className={styles.risk}>
          <p className={styles.label}>Risk notice</p>
          <p>
            Transactions may be irreversible. Tokens can be volatile, illiquid
            or lose all value. Programmable does not provide financial advice
            or guarantee a token&apos;s quality.
          </p>
        </section>

        <div className={styles.bottom}>
          <span>© 2026 Programmable</span>
          <div className={styles.socials}>
            <a
              href="https://x.com/0xProgrammable"
              target="_blank"
              rel="noreferrer"
              aria-label="Programmable on X"
            >
              <XBrandIcon />
            </a>
            <a
              href="https://github.com/0xprogrammable"
              target="_blank"
              rel="noreferrer"
              aria-label="Programmable on GitHub"
            >
              <GitHubBrandIcon />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
