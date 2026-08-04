import { ReactNode } from "react";

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
