"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { FormEvent, useDeferredValue, useState } from "react";

import { docsSearchItems } from "@/components/docs-data";
import styles from "@/components/docs-experience.module.css";

export function DocsSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const results = deferredQuery
    ? docsSearchItems
        .filter((item) =>
          `${item.title} ${item.description}`
            .toLowerCase()
            .includes(deferredQuery),
        )
        .slice(0, 6)
    : [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const firstResult = results[0];
    if (firstResult) {
      setQuery("");
      router.push(firstResult.href);
    }
  }

  return (
    <form className={styles.search} role="search" onSubmit={submit}>
      <Search aria-hidden="true" size={18} strokeWidth={1.8} />
      <label className="sr-only" htmlFor="docs-search">
        Search Programmable docs
      </label>
      <input
        id="docs-search"
        value={query}
        autoComplete="off"
        placeholder="Search the docs"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setQuery("");
            event.currentTarget.blur();
          }
        }}
      />
      {deferredQuery ? (
        <div className={styles.searchResults}>
          {results.length > 0 ? (
            results.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setQuery("")}
              >
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </Link>
            ))
          ) : (
            <p>No matching documentation</p>
          )}
        </div>
      ) : null}
    </form>
  );
}
