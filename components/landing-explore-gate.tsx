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
}: Readonly<{
  failed?: boolean;
  onRetry?: () => void;
}>) {
  return (
    <div
      className={`${styles.exploreFallback} page-width`}
      aria-busy={failed ? undefined : true}
    >
      <header className={styles.exploreFallbackHeading}>
        <h2 data-explore-heading>Explore</h2>
      </header>
      {failed && onRetry ? (
        <p className={styles.exploreFallbackError} role="status">
          Unable to load launches.{" "}
          <button type="button" onClick={onRetry}>
            Try again
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
  const [loadAttempt, setLoadAttempt] = useState(0);

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
        if (!cancelled) setExploreComponent(() => module.ExploreView);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
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
          onRetry={() => {
            setLoadFailed(false);
            setLoadAttempt((current) => current + 1);
          }}
        />
      )}
    </div>
  );
}
