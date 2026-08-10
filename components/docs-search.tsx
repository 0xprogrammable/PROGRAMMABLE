"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { docsSearchItems } from "@/components/docs-data";
import styles from "@/components/docs-experience.module.css";
import { docsNavigateEvent } from "@/components/docs-navigation";

function normalizeDocsSearchText(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, " ");
}

export function getDocsSearchResults(query: string) {
  const normalizedQuery = normalizeDocsSearchText(query);
  if (!normalizedQuery) return [];

  return docsSearchItems
    .map((item, index) => {
      const title = normalizeDocsSearchText(item.title);
      const description = normalizeDocsSearchText(item.description);
      const titleWords = title.split(" ");
      const rank =
        title === normalizedQuery
          ? 0
          : title.startsWith(normalizedQuery)
            ? 1
            : titleWords.some((word) => word.startsWith(normalizedQuery))
              ? 2
              : title.includes(normalizedQuery)
                ? 3
                : description.startsWith(normalizedQuery)
                  ? 4
                  : description.includes(normalizedQuery)
                    ? 5
                    : null;
      return { index, item, rank };
    })
    .filter(
      (
        result,
      ): result is {
        index: number;
        item: (typeof docsSearchItems)[number];
        rank: number;
      } => result.rank !== null,
    )
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ item }) => item)
    .slice(0, 6);
}

export function nextDocsSearchIndex(
  current: number,
  resultCount: number,
  direction: "next" | "previous",
) {
  if (resultCount <= 0) return -1;
  if (current < 0 || current >= resultCount) {
    return direction === "next" ? 0 : resultCount - 1;
  }
  return direction === "next"
    ? (current + 1) % resultCount
    : (current - 1 + resultCount) % resultCount;
}

export function shouldFocusDocsSearch({
  defaultPrevented,
  hasModifier,
  isContentEditable,
  key,
  targetTagName,
}: {
  defaultPrevented: boolean;
  hasModifier: boolean;
  isContentEditable: boolean;
  key: string;
  targetTagName: string;
}) {
  return (
    key === "/" &&
    !defaultPrevented &&
    !hasModifier &&
    !isContentEditable &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(targetTagName)
  );
}

export function DocsSearch({ id = "docs-search" }: { id?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const normalizedQuery = normalizeDocsSearchText(query);
  const results = getDocsSearchResults(normalizedQuery);

  const listboxId = `${id}-results`;
  const resolvedActiveIndex =
    isOpen && results.length > 0
      ? Math.min(Math.max(activeIndex, 0), results.length - 1)
      : -1;

  useEffect(() => {
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (!formRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", dismissOnOutsidePointer);
  }, []);

  useEffect(() => {
    const focusWithShortcut = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      const element = target instanceof HTMLElement ? target : null;
      if (
        !shouldFocusDocsSearch({
          defaultPrevented: event.defaultPrevented,
          hasModifier:
            event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
          isContentEditable: element?.isContentEditable ?? false,
          key: event.key,
          targetTagName: element?.tagName ?? "",
        })
      ) {
        return;
      }

      event.preventDefault();
      const input = inputRef.current;
      if (!input || input.getClientRects().length === 0) return;
      input.focus();
      input.select();
    };

    document.addEventListener("keydown", focusWithShortcut);
    return () => document.removeEventListener("keydown", focusWithShortcut);
  }, []);

  function dismissResults() {
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function openResults() {
    if (!query.trim()) return;
    setIsOpen(true);
    setActiveIndex((current) => (current >= 0 ? current : 0));
  }

  function navigateToResult(href: string) {
    setQuery("");
    dismissResults();

    if (href.startsWith(`${pathname}#`)) {
      window.dispatchEvent(
        new CustomEvent(docsNavigateEvent, { detail: { href } }),
      );
      return;
    }
    router.push(href);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result =
      results[resolvedActiveIndex >= 0 ? resolvedActiveIndex : 0] ?? results[0];
    if (result) navigateToResult(result.href);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      if (!isOpen) return;
      event.preventDefault();
      event.stopPropagation();
      dismissResults();
      return;
    }

    if (!(event.target instanceof HTMLInputElement)) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) =>
        nextDocsSearchIndex(
          current,
          results.length,
          event.key === "ArrowDown" ? "next" : "previous",
        ),
      );
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      if (!isOpen || results.length === 0) return;
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : results.length - 1);
      return;
    }

    if (event.key === "Enter" && isOpen && resolvedActiveIndex >= 0) {
      event.preventDefault();
      const result = results[resolvedActiveIndex];
      if (result) navigateToResult(result.href);
    }
  }

  function handleBlur(event: FocusEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    window.requestAnimationFrame(() => {
      if (!form.contains(document.activeElement)) dismissResults();
    });
  }

  function handleResultClick(
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
  ) {
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    navigateToResult(href);
  }

  return (
    <form
      className={`${styles.search} liquid-glass-control`}
      ref={formRef}
      role="search"
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onSubmit={submit}
    >
      <Search aria-hidden="true" size={18} strokeWidth={1.8} />
      <label className="sr-only" htmlFor={id}>
        Search Programmable docs
      </label>
      <input
        id={id}
        ref={inputRef}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-activedescendant={
          isOpen && resolvedActiveIndex >= 0
            ? `${id}-result-${resolvedActiveIndex}`
            : undefined
        }
        value={query}
        autoComplete="off"
        placeholder="Search the docs"
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setIsOpen(Boolean(nextQuery.trim()));
          setActiveIndex(0);
        }}
        onFocus={openResults}
      />
      {query ? (
        <button
          className={styles.searchClear}
          type="button"
          aria-label="Clear documentation search"
          onClick={() => {
            setQuery("");
            dismissResults();
            window.requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <X aria-hidden="true" size={15} strokeWidth={1.9} />
        </button>
      ) : (
        <kbd className={styles.searchShortcut} aria-hidden="true">
          /
        </kbd>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {normalizedQuery
          ? `${results.length} ${
              results.length === 1 ? "result" : "results"
            }`
          : ""}
      </span>
      {isOpen && normalizedQuery ? (
        <div
          className={`${styles.searchResults} liquid-glass-surface liquid-glass-popover`}
          id={listboxId}
          role="listbox"
          aria-label="Documentation search results"
        >
          {results.length > 0 ? (
            results.map((item, index) => (
              <Link
                id={`${id}-result-${index}`}
                key={`${item.href}:${item.title}`}
                href={item.href}
                role="option"
                aria-selected={resolvedActiveIndex === index}
                tabIndex={-1}
                onClick={(event) => handleResultClick(event, item.href)}
                onMouseEnter={() => setActiveIndex(index)}
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
