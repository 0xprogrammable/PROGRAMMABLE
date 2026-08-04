import { ReactNode } from "react";
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
  sections,
  title,
}: {
  children: ReactNode;
  currentPath: string;
  description: string;
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
          {docsCategories.map((category) =>
            category.status === "available" ? (
              <Link
                aria-current="page"
                className={`${styles.docsCategory} ${styles.docsCategoryActive}`}
                href={category.href}
                key={category.label}
              >
                <strong>{category.label}</strong>
                <span>Integrations</span>
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className={`${styles.docsCategory} ${styles.docsCategoryUnavailable}`}
                key={category.label}
              >
                <strong>{category.label}</strong>
                <span>Available soon</span>
              </span>
            ),
          )}
        </nav>

        <header className={styles.hero} data-docs-hero>
          <h1>{title}</h1>
          <p>{description}</p>
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
