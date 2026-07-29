import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { ReactNode } from "react";

import { docsNavigation } from "@/components/docs-data";
import styles from "@/components/docs-experience.module.css";
import { DocsSearch } from "@/components/docs-search";

function DocsNavigation({
  currentPath,
}: {
  currentPath: string;
}) {
  return (
    <>
      {docsNavigation.map((group) => (
        <div className={styles.navGroup} key={group.label}>
          <p className={styles.navLabel}>{group.label}</p>
          <ul>
            {group.items.map((item) => {
              const itemPath = item.href.split("#")[0];
              const active =
                (currentPath === "/docs" &&
                  item.href === "/docs#overview") ||
                (itemPath !== "/docs" && currentPath === itemPath);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    data-active={active ? "true" : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

export function DocsShell({
  children,
  currentPath,
  description,
  kicker = "Programmable docs",
  title,
}: {
  children: ReactNode;
  currentPath: string;
  description: string;
  kicker?: string;
  title: string;
}) {
  return (
    <div className={`${styles.page} page-width`}>
      <header className={styles.hero}>
        <span className={styles.kicker}>{kicker}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        <DocsSearch />
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <nav
            className={styles.desktopNav}
            aria-label="Documentation navigation"
          >
            <DocsNavigation currentPath={currentPath} />
          </nav>

          <details className={styles.mobileNav}>
            <summary>
              Browse the docs
              <ChevronDown aria-hidden="true" size={17} />
            </summary>
            <nav
              className={styles.mobileNavBody}
              aria-label="Documentation navigation"
            >
              <DocsNavigation currentPath={currentPath} />
            </nav>
          </details>
        </aside>

        <article className={styles.content}>{children}</article>
      </div>
    </div>
  );
}
