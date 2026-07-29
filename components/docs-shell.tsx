import { ReactNode } from "react";

import styles from "@/components/docs-experience.module.css";
import { DocsNavigation } from "@/components/docs-navigation";
import { DocsSearch } from "@/components/docs-search";

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
          <DocsNavigation currentPath={currentPath} />
        </aside>

        <article className={styles.content} data-docs-content>
          {children}
        </article>
      </div>
    </div>
  );
}
