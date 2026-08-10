"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import { docsCategories, docsNavigation } from "@/components/docs-data";
import styles from "@/components/docs-experience.module.css";

type SectionPosition = {
  id: string;
  top: number;
};

export type DocsPageSection = {
  id: string;
  label: string;
};

const docsRootPath = "/docs/developers";
const docsSectionIds = [
  "paths",
  "trust-root",
  "identity",
  "indexing",
  "resources",
  "boundary",
  "checklist",
  "agents",
] as const;
const docsSectionHrefs = docsSectionIds.map(
  (sectionId) => `${docsRootPath}#${sectionId}`,
);
const overviewHref = docsSectionHrefs[0] ?? `${docsRootPath}#paths`;
const docsSectionHrefSet = new Set<string>(docsSectionHrefs);
const emptyDocsPageSections: readonly DocsPageSection[] = [];

export const docsNavigateEvent = "programmable:docs-navigate";

export function normalizeDocsHash(hash: string): string {
  const sectionId = hash.replace(/^#/, "").split("#", 1)[0];
  const href = `${docsRootPath}#${sectionId}`;
  return docsSectionHrefSet.has(href) ? href : overviewHref;
}

export function resolveDocsLocationTarget(hash: string): {
  href: string;
  sectionId: string;
  shouldScroll: boolean;
} {
  const href = normalizeDocsHash(hash);
  return {
    href,
    sectionId: href.slice(docsRootPath.length + 1),
    shouldScroll: hash.length > 0,
  };
}

export function resolveDocsPageLocationTarget({
  currentPath,
  hash,
  sectionIds,
}: {
  currentPath: string;
  hash: string;
  sectionIds: readonly string[];
}): {
  href: string;
  sectionId: string;
  shouldScroll: boolean;
} {
  if (currentPath === docsRootPath) return resolveDocsLocationTarget(hash);

  const requestedId = hash.replace(/^#/, "").split("#", 1)[0];
  const sectionId = sectionIds.includes(requestedId)
    ? requestedId
    : (sectionIds[0] ?? "");
  return {
    href: sectionId ? `${currentPath}#${sectionId}` : currentPath,
    sectionId,
    shouldScroll: hash.length > 0 && sectionId.length > 0,
  };
}

export function isDocsNavigationItemActive({
  activeHref,
  currentPath,
  itemHref,
}: {
  activeHref: string;
  currentPath: string;
  itemHref: string;
}): boolean {
  const itemPath = itemHref.split("#")[0];
  if (itemPath !== currentPath) return false;
  if (itemHref.includes("#")) return activeHref === itemHref;
  return itemPath === currentPath;
}

export function pickActiveDocsSection({
  atPageEnd,
  marker,
  positions,
}: {
  atPageEnd: boolean;
  marker: number;
  positions: SectionPosition[];
}): string {
  const orderedPositions = [...positions].sort((a, b) => a.top - b.top);
  if (orderedPositions.length === 0) return "overview";
  if (atPageEnd) return orderedPositions[orderedPositions.length - 1].id;

  let activeId = orderedPositions[0].id;
  for (const position of orderedPositions) {
    if (position.top > marker) break;
    activeId = position.id;
  }
  return activeId;
}

export function calculateDocsReadingOffset({
  mobileNavigationHeight,
  scrollPaddingTop,
  stickyToolsHeight,
}: {
  mobileNavigationHeight: number;
  scrollPaddingTop: number;
  stickyToolsHeight: number;
}): number {
  const safeHeight = (value: number) =>
    Number.isFinite(value) && value > 0 ? value : 0;
  return (
    safeHeight(scrollPaddingTop) +
    safeHeight(stickyToolsHeight) +
    safeHeight(mobileNavigationHeight) +
    20
  );
}

export function easeDocsScroll(progress: number): number {
  const value = Math.min(1, Math.max(0, progress));
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export function getDocsScrollDuration(distance: number): number {
  const safeDistance = Number.isFinite(distance) ? Math.abs(distance) : 0;
  return Math.round(180 + (Math.min(safeDistance, 1600) / 1600) * 100);
}

function hasModifiedClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  );
}

function focusDocsSection(section: HTMLElement) {
  const heading = section.querySelector<HTMLElement>("h2, h3");
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

function shouldAnimateDocsScroll() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function shouldCancelDocsScrollForKey({
  defaultPrevented,
  key,
}: {
  defaultPrevented: boolean;
  key: string;
}) {
  return (
    !defaultPrevented &&
    [" ", "ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp"].includes(
      key,
    )
  );
}

function getDocsScrollOffset(
  mobileNavigation: HTMLDetailsElement | null,
): number {
  const documentStyles = window.getComputedStyle(document.documentElement);
  const measuredScrollPadding = Number.parseFloat(
    documentStyles.scrollPaddingTop,
  );
  const siteHeaderHeight =
    document.querySelector<HTMLElement>(".site-header")?.offsetHeight ?? 68;
  const docsTools = document.querySelector<HTMLElement>("[data-docs-tools]");
  const stickyToolsHeight =
    docsTools && window.getComputedStyle(docsTools).position === "sticky"
      ? docsTools.offsetHeight
      : 0;
  const mobileNavigationSummary =
    mobileNavigation?.querySelector<HTMLElement>("summary");
  const mobileNavigationHeight =
    mobileNavigation &&
    window.getComputedStyle(mobileNavigation).display !== "none"
      ? (mobileNavigationSummary?.offsetHeight ?? 0)
      : 0;

  return calculateDocsReadingOffset({
    mobileNavigationHeight,
    scrollPaddingTop: Number.isFinite(measuredScrollPadding)
      ? measuredScrollPadding
      : siteHeaderHeight + 20,
    stickyToolsHeight,
  });
}

function getDocsSectionTop(
  section: HTMLElement,
  mobileNavigation: HTMLDetailsElement | null,
) {
  return Math.max(
    0,
    section.getBoundingClientRect().top +
      window.scrollY -
      getDocsScrollOffset(mobileNavigation),
  );
}

export function DocsNavigation({
  currentPath,
  sections = emptyDocsPageSections,
}: {
  currentPath: string;
  sections?: readonly DocsPageSection[];
}) {
  const mobileNavigationRef = useRef<HTMLDetailsElement>(null);
  const locationInitializedRef = useRef(false);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const trackedSectionIds = useMemo(
    () => sections.map((section) => section.id),
    [sections],
  );
  const trackedSectionIdSet = useMemo(
    () => new Set(trackedSectionIds),
    [trackedSectionIds],
  );
  const initialSectionHref =
    currentPath === docsRootPath
      ? overviewHref
      : trackedSectionIds[0]
        ? `${currentPath}#${trackedSectionIds[0]}`
        : currentPath;
  const [activeSectionHref, setActiveSectionHref] =
    useState(initialSectionHref);
  const activeHref =
    trackedSectionIds.length > 0 ? activeSectionHref : currentPath;
  let activeLabel = "Reference";
  for (const group of docsNavigation) {
    for (const item of group.items) {
      if (item.href === activeHref || item.href === currentPath) {
        activeLabel = item.label;
      }
    }
  }

  const cancelDocsScroll = useCallback(() => {
    if (scrollAnimationFrameRef.current === null) return;
    window.cancelAnimationFrame(scrollAnimationFrameRef.current);
    scrollAnimationFrameRef.current = null;
  }, []);

  const scrollToDocsSection = useCallback(
    (section: HTMLElement, animate: boolean, onComplete?: () => void) => {
      cancelDocsScroll();
      const targetY = getDocsSectionTop(section, mobileNavigationRef.current);
      const startY = window.scrollY;
      const distance = targetY - startY;

      const complete = () => {
        scrollAnimationFrameRef.current = null;
        focusDocsSection(section);
        onComplete?.();
      };

      if (!animate || Math.abs(distance) < 2) {
        window.scrollTo({ behavior: "auto", top: targetY });
        complete();
        return;
      }

      const duration = getDocsScrollDuration(distance);
      const startedAt = window.performance.now();
      const update = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        window.scrollTo({
          behavior: "auto",
          top: startY + distance * easeDocsScroll(progress),
        });

        if (progress < 1) {
          scrollAnimationFrameRef.current =
            window.requestAnimationFrame(update);
          return;
        }
        complete();
      };

      scrollAnimationFrameRef.current = window.requestAnimationFrame(update);
    },
    [cancelDocsScroll],
  );

  useEffect(() => {
    const cancelOnUserIntent = () => cancelDocsScroll();
    const cancelOnKeyboardScroll = (event: globalThis.KeyboardEvent) => {
      if (
        shouldCancelDocsScrollForKey({
          defaultPrevented: event.defaultPrevented,
          key: event.key,
        })
      ) {
        cancelDocsScroll();
      }
    };
    window.addEventListener("wheel", cancelOnUserIntent, { passive: true });
    window.addEventListener("touchstart", cancelOnUserIntent, {
      passive: true,
    });
    window.addEventListener("pointerdown", cancelOnUserIntent, {
      passive: true,
    });
    window.addEventListener("keydown", cancelOnKeyboardScroll);

    return () => {
      cancelDocsScroll();
      window.removeEventListener("wheel", cancelOnUserIntent);
      window.removeEventListener("touchstart", cancelOnUserIntent);
      window.removeEventListener("pointerdown", cancelOnUserIntent);
      window.removeEventListener("keydown", cancelOnKeyboardScroll);
    };
  }, [cancelDocsScroll]);

  const navigateToDocsTopic = useCallback(
    (itemHref: string, animate = true) => {
      const [itemPath, itemHash] = itemHref.split("#");
      const isSamePageTopic =
        itemPath === currentPath &&
        Boolean(itemHash) &&
        trackedSectionIdSet.has(itemHash);
      if (!isSamePageTopic) return false;

      const section = document.getElementById(itemHash);
      if (!section) return false;

      if (window.location.pathname + window.location.hash !== itemHref) {
        window.history.pushState(null, "", itemHref);
      }
      const mobileNavigationWasOpen =
        mobileNavigationRef.current?.open === true;
      if (mobileNavigationRef.current) {
        mobileNavigationRef.current.open = false;
      }

      const scrollToSection = () => {
        scrollToDocsSection(section, animate && shouldAnimateDocsScroll(), () =>
          setActiveSectionHref(itemHref),
        );
      };

      if (mobileNavigationWasOpen) {
        window.requestAnimationFrame(scrollToSection);
      } else {
        scrollToSection();
      }
      return true;
    },
    [currentPath, scrollToDocsSection, trackedSectionIdSet],
  );

  useEffect(() => {
    if (trackedSectionIds.length === 0) return;

    let scrollFrame = 0;
    let layoutFrame = 0;
    let locationFrame = 0;
    let readingMarkerOffset = 108;
    let sectionPositions: SectionPosition[] = [];

    const updateFromScroll = () => {
      scrollFrame = 0;
      const scrollY = window.scrollY;
      const activeId = pickActiveDocsSection({
        atPageEnd:
          Math.ceil(scrollY + window.innerHeight) >=
          document.documentElement.scrollHeight - 2,
        marker: scrollY + readingMarkerOffset,
        positions: sectionPositions,
      });
      const nextHref = `${currentPath}#${activeId}`;
      setActiveSectionHref((currentHref) =>
        currentHref === nextHref ? currentHref : nextHref,
      );
    };

    const scheduleScrollUpdate = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(updateFromScroll);
    };

    const measureLayout = () => {
      layoutFrame = 0;
      const scrollY = window.scrollY;
      sectionPositions = trackedSectionIds.flatMap((id) => {
        const section = document.getElementById(id);
        return section
          ? [{ id, top: section.getBoundingClientRect().top + scrollY }]
          : [];
      });
      const documentStyles = window.getComputedStyle(document.documentElement);
      const measuredScrollPadding = Number.parseFloat(
        documentStyles.scrollPaddingTop,
      );
      const siteHeaderHeight =
        document.querySelector<HTMLElement>(".site-header")?.offsetHeight ?? 68;
      const docsTools =
        document.querySelector<HTMLElement>("[data-docs-tools]");
      const stickyToolsHeight =
        docsTools && window.getComputedStyle(docsTools).position === "sticky"
          ? docsTools.offsetHeight
          : 0;
      const mobileNavigationSummary =
        mobileNavigationRef.current?.querySelector<HTMLElement>("summary");
      const mobileNavigationHeight =
        mobileNavigationRef.current &&
        window.getComputedStyle(mobileNavigationRef.current).display !== "none"
          ? (mobileNavigationSummary?.offsetHeight ?? 0)
          : 0;
      readingMarkerOffset =
        calculateDocsReadingOffset({
          mobileNavigationHeight,
          scrollPaddingTop: Number.isFinite(measuredScrollPadding)
            ? measuredScrollPadding
            : siteHeaderHeight + 20,
          stickyToolsHeight,
        }) + 2;
      scheduleScrollUpdate();
    };

    const scheduleLayoutMeasurement = () => {
      if (layoutFrame) return;
      layoutFrame = window.requestAnimationFrame(measureLayout);
    };

    const updateFromLocation = () => {
      const target = resolveDocsPageLocationTarget({
        currentPath,
        hash: window.location.hash,
        sectionIds: trackedSectionIds,
      });
      const currentHref = window.location.pathname + window.location.hash;
      if (window.location.hash && currentHref !== target.href) {
        window.history.replaceState(window.history.state, "", target.href);
      }
      const section = document.getElementById(target.sectionId);
      if (section && target.shouldScroll) {
        const animate =
          locationInitializedRef.current && shouldAnimateDocsScroll();
        locationInitializedRef.current = true;
        if (locationFrame) window.cancelAnimationFrame(locationFrame);
        locationFrame = window.requestAnimationFrame(() => {
          locationFrame = 0;
          scrollToDocsSection(section, animate, () =>
            setActiveSectionHref(target.href),
          );
          scheduleLayoutMeasurement();
        });
      } else {
        setActiveSectionHref(target.href);
        locationInitializedRef.current = true;
        scheduleLayoutMeasurement();
      }
    };

    updateFromLocation();
    window.addEventListener("hashchange", updateFromLocation);
    window.addEventListener("popstate", updateFromLocation);
    window.addEventListener("resize", scheduleLayoutMeasurement);
    window.addEventListener("scroll", scheduleScrollUpdate, { passive: true });

    return () => {
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
      if (locationFrame) window.cancelAnimationFrame(locationFrame);
      window.removeEventListener("hashchange", updateFromLocation);
      window.removeEventListener("popstate", updateFromLocation);
      window.removeEventListener("resize", scheduleLayoutMeasurement);
      window.removeEventListener("scroll", scheduleScrollUpdate);
    };
  }, [currentPath, scrollToDocsSection, trackedSectionIds]);

  useEffect(() => {
    const handleDocsNavigationRequest = (event: Event) => {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href;
      if (href) navigateToDocsTopic(href);
    };

    window.addEventListener(docsNavigateEvent, handleDocsNavigationRequest);
    return () =>
      window.removeEventListener(
        docsNavigateEvent,
        handleDocsNavigationRequest,
      );
  }, [navigateToDocsTopic]);

  function handleNavigation(
    event: MouseEvent<HTMLAnchorElement>,
    itemHref: string,
  ) {
    if (hasModifiedClick(event)) return;
    const [itemPath, itemHash] = itemHref.split("#");
    const isSamePageTopic =
      itemPath === currentPath &&
      Boolean(itemHash) &&
      trackedSectionIdSet.has(itemHash);

    if (isSamePageTopic) {
      event.preventDefault();
      navigateToDocsTopic(itemHref, event.detail > 0);
    } else if (mobileNavigationRef.current?.open) {
      mobileNavigationRef.current.open = false;
    }
  }

  function renderGlobalNavigation() {
    return (
      <>
        {docsNavigation.map((group) => (
          <div className={styles.navGroup} key={group.label}>
            <p className={styles.navLabel}>{group.label}</p>
            <ul>
              {group.items.map((item) => {
                const active = isDocsNavigationItemActive({
                  activeHref,
                  currentPath,
                  itemHref: item.href,
                });

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      data-active={active ? "true" : undefined}
                      aria-current={
                        active
                          ? item.href.includes("#")
                            ? "location"
                            : "page"
                          : undefined
                      }
                      onClick={(event) => handleNavigation(event, item.href)}
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

  function renderLocalNavigation() {
    if (sections.length === 0) return null;

    return (
      <div className={`${styles.navGroup} ${styles.contextNavGroup}`}>
        <p className={styles.navLabel}>On this page</p>
        <ul>
          {sections.map((section) => {
            const href = `${currentPath}#${section.id}`;
            const active = href === activeHref;
            return (
              <li key={href}>
                <Link
                  href={href}
                  data-active={active ? "true" : undefined}
                  aria-current={active ? "location" : undefined}
                  onClick={(event) => handleNavigation(event, href)}
                >
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  function renderMobileNavigation() {
    const activeCategory = docsCategories.find(
      (category) =>
        category.href === currentPath ||
        category.relatedPaths.some((path) => path === currentPath),
    );
    const activeGroup = activeCategory
      ? docsNavigation.find((group) =>
          group.items.some((item) => {
            const itemPath = item.href.split("#")[0];
            return (
              itemPath === activeCategory.href ||
              activeCategory.relatedPaths.some((path) => path === itemPath)
            );
          }),
        )
      : undefined;
    const relatedItems =
      activeGroup?.items.filter(
        (item) => item.href.split("#")[0] !== currentPath,
      ) ?? [];

    return (
      <>
        {relatedItems.length > 0 ? (
          <div className={styles.navGroup}>
            <p className={styles.navLabel}>{activeGroup?.label}</p>
            <ul>
              {relatedItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={(event) => handleNavigation(event, item.href)}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {renderLocalNavigation()}

        <div className={styles.navGroup}>
          <p className={styles.navLabel}>Documentation</p>
          <ul>
            {docsCategories.map((category) => {
              const active = category === activeCategory;
              return (
                <li key={category.href}>
                  <Link
                    href={category.href}
                    data-active={active ? "true" : undefined}
                    aria-current={
                      active
                        ? category.href === currentPath
                          ? "page"
                          : "location"
                        : undefined
                    }
                    onClick={(event) =>
                      handleNavigation(event, category.href)
                    }
                  >
                    {category.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </>
    );
  }

  return (
    <>
      <nav
        className={styles.desktopNav}
        aria-label="Documentation navigation"
      >
        {renderGlobalNavigation()}
      </nav>

      <details className={styles.mobileNav} ref={mobileNavigationRef}>
        <summary>
          <span className={styles.mobileNavCurrent}>
            <span>Docs</span>
            <strong>{activeLabel}</strong>
          </span>
          <ChevronDown aria-hidden="true" size={17} />
        </summary>
        <nav
          className={styles.mobileNavBody}
          aria-label="Documentation navigation"
        >
          {renderMobileNavigation()}
        </nav>
      </details>
    </>
  );
}

export function DocsPageNavigation({
  currentPath,
  sections = emptyDocsPageSections,
}: {
  currentPath: string;
  sections?: readonly DocsPageSection[];
}) {
  const [activeSectionId, setActiveSectionId] = useState(
    sections[0]?.id ?? "",
  );

  useEffect(() => {
    if (sections.length === 0) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const positions = sections.flatMap((section) => {
        const element = document.getElementById(section.id);
        return element
          ? [
              {
                id: section.id,
                top: element.getBoundingClientRect().top + window.scrollY,
              },
            ]
          : [];
      });
      const activeId = pickActiveDocsSection({
        atPageEnd:
          Math.ceil(window.scrollY + window.innerHeight) >=
          document.documentElement.scrollHeight - 2,
        marker: window.scrollY + 164,
        positions,
      });
      setActiveSectionId(activeId);
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate);
    };
  }, [sections]);

  if (sections.length < 2) return null;

  return (
    <aside className={styles.pageNavigation} aria-label="On this page">
      <p>On this page</p>
      <ul>
        {sections.map((section) => {
          const href = `${currentPath}#${section.id}`;
          const active = activeSectionId === section.id;
          return (
            <li key={href}>
              <Link
                aria-current={active ? "location" : undefined}
                data-active={active ? "true" : undefined}
                href={href}
                onClick={(event) => {
                  if (hasModifiedClick(event)) return;
                  event.preventDefault();
                  window.dispatchEvent(
                    new CustomEvent(docsNavigateEvent, {
                      detail: { href },
                    }),
                  );
                }}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
