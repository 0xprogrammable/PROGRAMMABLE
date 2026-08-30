"use client";

import {
  type ComponentType,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import styles from "@/components/landing-page.module.css";

const EXPLORE_LOAD_MARGIN = "720px 0px";

type LandingExploreViewComponent = ComponentType<
  Readonly<{ embedded?: boolean }>
>;

function LandingExploreFallback({
  failed = false,
  onRetry,
  retrying = false,
}: Readonly<{
  failed?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
}>) {
  return (
    <div
      className={`${styles.exploreFallback} page-width`}
      aria-busy={!failed || retrying ? true : undefined}
    >
      <header className={styles.exploreFallbackHeading}>
        <h2 data-explore-heading>Explore</h2>
      </header>
      {failed && onRetry ? (
        <p className={styles.exploreFallbackError} role="status">
          {retrying ? "Loading launches…" : "Unable to load launches."}{" "}
          <button
            aria-disabled={retrying}
            type="button"
            onClick={() => {
              if (!retrying) onRetry();
            }}
          >
            {retrying ? "Loading…" : "Try again"}
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function LandingExploreGate() {
  const gateRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [ExploreComponent, setExploreComponent] =
    useState<LandingExploreViewComponent | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const retryRequestedRef = useRef(false);

  useLayoutEffect(() => {
    const loadForExploreHash = () => {
      if (window.location.hash === "#explore") setShouldLoad(true);
    };

    loadForExploreHash();
    window.addEventListener("hashchange", loadForExploreHash);
    return () => window.removeEventListener("hashchange", loadForExploreHash);
  }, []);

  useEffect(() => {
    if (shouldLoad) return;

    const gate = gateRef.current;
    if (!gate || !("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      {
        rootMargin: EXPLORE_LOAD_MARGIN,
        threshold: 0,
      },
    );

    observer.observe(gate);
    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    if (!shouldLoad || ExploreComponent) return;

    let cancelled = false;
    void import("@/components/explore-view")
      .then((module) => {
        if (cancelled) return;
        const restoreExploreFocus = retryRequestedRef.current;
        retryRequestedRef.current = false;
        setLoadFailed(false);
        setRetrying(false);
        setExploreComponent(() => module.ExploreView);
        if (restoreExploreFocus) {
          window.requestAnimationFrame(() => {
            const heading = gateRef.current?.querySelector<HTMLElement>(
              "[data-explore-heading]",
            );
            if (!heading) return;
            heading.tabIndex = -1;
            heading.focus({ preventScroll: true });
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
          setRetrying(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ExploreComponent, loadAttempt, shouldLoad]);

  return (
    <div ref={gateRef} className={styles.exploreGate}>
      {ExploreComponent ? (
        <ExploreComponent embedded />
      ) : (
        <LandingExploreFallback
          failed={loadFailed}
          retrying={retrying}
          onRetry={() => {
            retryRequestedRef.current = true;
            setRetrying(true);
            setLoadAttempt((current) => current + 1);
          }}
        />
      )}
    </div>
  );
}
