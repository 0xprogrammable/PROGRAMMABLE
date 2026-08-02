import Link from "next/link";
import { ReactNode } from "react";

import styles from "@/components/docs-experience.module.css";
import {
  DocsNavigation,
  type DocsPageSection,
} from "@/components/docs-navigation";
import { DocsSearch } from "@/components/docs-search";

const docsGuides = [
  { href: "/docs", label: "Platform" },
  { href: "/docs/models/classic", label: "Classic" },
  { href: "/docs/models/custom", label: "Custom" },
] as const;

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
      <div className={styles.heroTools} data-docs-tools>
        <nav className={styles.guideTabs} aria-label="Documentation guides">
          {docsGuides.map((guide) => {
            const isActive = currentPath === guide.href;
            return (
              <Link
                key={guide.href}
                className={styles.guideTab}
                data-active={isActive ? "true" : undefined}
                aria-current={isActive ? "page" : undefined}
                href={guide.href}
              >
                {guide.label}
              </Link>
            );
          })}
        </nav>
        <DocsSearch />
      </div>

      <header className={styles.hero} data-docs-hero>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>

      <aside className={styles.sidebar} data-docs-sidebar>
        <DocsNavigation currentPath={currentPath} sections={sections} />
      </aside>

      <div className={styles.layout} data-docs-layout>
        <article className={styles.content} data-docs-content>
          {children}
        </article>
      </div>
    </div>
  );
}
