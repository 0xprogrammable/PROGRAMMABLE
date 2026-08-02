"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import { docsNavigation } from "@/components/docs-data";
import styles from "@/components/docs-experience.module.css";

type SectionPosition = {
  id: string;
  top: number;
};

const overviewHref = "/docs#overview";
const docsSectionHrefs = (() => {
  const hrefs: string[] = [];
  for (const group of docsNavigation) {
    for (const item of group.items) {
      if (item.href.startsWith("/docs#")) hrefs.push(item.href);
    }
  }
  return hrefs;
})();
const docsSectionIds = docsSectionHrefs.map((href) => href.slice(6));
const docsSectionHrefSet = new Set<string>(docsSectionHrefs);

export const docsNavigateEvent = "programmable:docs-navigate";

export function normalizeDocsHash(hash: string): string {
  const sectionId = hash.replace(/^#/, "").split("#", 1)[0];
  const href = `/docs#${sectionId}`;
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
    sectionId: href.slice(6),
    shouldScroll: hash.length > 0,
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
  if (itemHref.includes("#")) {
    return currentPath === "/docs" && activeHref === itemHref;
  }
  return itemPath !== "/docs";
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
    Math.max(
      safeHeight(stickyToolsHeight),
      safeHeight(mobileNavigationHeight),
    ) +
    20
  );
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

export function DocsNavigation({ currentPath }: { currentPath: string }) {
  const mobileNavigationRef = useRef<HTMLDetailsElement>(null);
  const [activeSectionHref, setActiveSectionHref] = useState(overviewHref);
  const activeHref =
    currentPath === "/docs" ? activeSectionHref : currentPath;
  let activeLabel = "Reference";
  for (const group of docsNavigation) {
    for (const item of group.items) {
      if (item.href === activeHref) activeLabel = item.label;
    }
  }

  const navigateToDocsTopic = useCallback(
    (itemHref: string) => {
      const [itemPath, itemHash] = itemHref.split("#");
      const isSamePageTopic =
        currentPath === "/docs" && itemPath === "/docs" && Boolean(itemHash);
      if (!isSamePageTopic) return false;

      const section = document.getElementById(itemHash);
      if (!section) return false;

      if (window.location.pathname + window.location.hash !== itemHref) {
        window.history.pushState(null, "", itemHref);
      }
      setActiveSectionHref(itemHref);

      const mobileNavigationWasOpen =
        mobileNavigationRef.current?.open === true;
      if (mobileNavigationRef.current) {
        mobileNavigationRef.current.open = false;
      }

      const scrollToSection = () => {
        section.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        });
        focusDocsSection(section);
      };

      if (mobileNavigationWasOpen) {
        window.requestAnimationFrame(scrollToSection);
      } else {
        scrollToSection();
      }
      return true;
    },
    [currentPath],
  );

  useEffect(() => {
    if (currentPath !== "/docs") return;

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
      const nextHref = `/docs#${activeId}`;
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
      sectionPositions = docsSectionIds.flatMap((id) => {
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
      readingMarkerOffset = calculateDocsReadingOffset({
        mobileNavigationHeight,
        scrollPaddingTop: Number.isFinite(measuredScrollPadding)
          ? measuredScrollPadding
          : siteHeaderHeight + 20,
        stickyToolsHeight,
      });
      scheduleScrollUpdate();
    };

    const scheduleLayoutMeasurement = () => {
      if (layoutFrame) return;
      layoutFrame = window.requestAnimationFrame(measureLayout);
    };

    const updateFromLocation = () => {
      const target = resolveDocsLocationTarget(window.location.hash);
      const currentHref = window.location.pathname + window.location.hash;
      if (window.location.hash && currentHref !== target.href) {
        window.history.replaceState(window.history.state, "", target.href);
      }
      setActiveSectionHref(target.href);
      const section = document.getElementById(target.sectionId);
      if (section && target.shouldScroll) {
        if (locationFrame) window.cancelAnimationFrame(locationFrame);
        locationFrame = window.requestAnimationFrame(() => {
          locationFrame = 0;
          section.scrollIntoView({ behavior: "auto", block: "start" });
          focusDocsSection(section);
          scheduleLayoutMeasurement();
        });
      } else {
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
  }, [currentPath]);

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
      currentPath === "/docs" && itemPath === "/docs" && Boolean(itemHash);

    if (isSamePageTopic) {
      event.preventDefault();
      navigateToDocsTopic(itemHref);
    } else if (mobileNavigationRef.current?.open) {
      mobileNavigationRef.current.open = false;
    }
  }

  function renderNavigation() {
    return docsNavigation.map((group) => (
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
    ));
  }

  return (
    <>
      <nav
        className={styles.desktopNav}
        aria-label="Documentation navigation"
      >
        {renderNavigation()}
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
          {renderNavigation()}
        </nav>
      </details>
    </>
  );
}
