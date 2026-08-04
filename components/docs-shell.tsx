import type { ReactNode } from "react";
import Link from "next/link";

import { docsCategories } from "@/components/docs-data";
import styles from "@/components/docs-experience.module.css";
import {
  DocsNavigation,
  type DocsPageSection,
} from "@/components/docs-navigation";
import { DocsSearch } from "@/components/docs-search";

export function DocsShell({
  children,
  currentPath,
  description,
  heroAside,
  heroMeta,
  kicker,
  sections,
  title,
}: {
  children: ReactNode;
  currentPath: string;
  description: string;
  heroAside?: ReactNode;
  heroMeta?: ReactNode;
  kicker?: string;
  sections?: readonly DocsPageSection[];
  title: string;
}) {
  return (
    <div className={`${styles.page} page-width`} data-docs-shell>
      <aside className={styles.sidebar} data-docs-sidebar>
        <DocsNavigation currentPath={currentPath} sections={sections} />
      </aside>

      <div className={styles.mainColumn}>
        <div className={styles.heroTools} data-docs-tools>
          <DocsSearch />
        </div>

        <nav
          aria-label="Documentation categories"
          className={styles.docsCategories}
        >
          {docsCategories.map((category) => {
            if (category.status === "available") {
              const active = currentPath === category.href;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`${styles.docsCategory} ${
                    active ? styles.docsCategoryActive : ""
                  }`}
                  href={category.href}
                  key={category.label}
                >
                  <strong>{category.label}</strong>
                  <span>Integrations</span>
                </Link>
              );
            }

            return (
              <span
                aria-disabled="true"
                className={`${styles.docsCategory} ${styles.docsCategoryUnavailable}`}
                key={category.label}
              >
                <strong>{category.label}</strong>
                <span>Available soon</span>
              </span>
            );
          })}
        </nav>

        <header
          className={styles.hero}
          data-docs-hero
          data-has-aside={heroAside ? "true" : undefined}
          id={heroAside ? "quickstart" : undefined}
        >
          <div className={styles.heroCopy}>
            {kicker ? <p className={styles.heroKicker}>{kicker}</p> : null}
            <h1>{title}</h1>
            <p>{description}</p>
            {heroMeta ? (
              <div className={styles.heroMeta}>{heroMeta}</div>
            ) : null}
          </div>
          {heroAside ? (
            <div className={styles.heroAside}>{heroAside}</div>
          ) : null}
        </header>

        <div className={styles.layout} data-docs-layout>
          <article className={styles.content} data-docs-content>
            {children}
          </article>
        </div>
      </div>
    </div>
  );
}
