"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useViewChain } from "@/components/view-chain";
import { isRobinhoodUnavailableRoute } from
  "@/components/view-chain-unavailable";

export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { hydrated, viewChainId } = useViewChain();
  const contentRef = useRef<HTMLDivElement>(null);
  const routeUsesChainBoundary = isRobinhoodUnavailableRoute(pathname);
  const focusContext = `${pathname}\u0000${
    routeUsesChainBoundary ? (hydrated ? viewChainId : "pending") : "route"
  }`;
  const previousFocusContext = useRef(focusContext);
  const previousHydrated = useRef(hydrated);
  const previousMotionPathname = useRef(pathname);
  const routeAnimationRef = useRef<Animation | null>(null);
  const isDocsPath = pathname.startsWith("/docs");

  useLayoutEffect(() => {
    const previousPath = previousMotionPathname.current;
    previousMotionPathname.current = pathname;
    routeAnimationRef.current?.cancel();
    routeAnimationRef.current = null;

    if (previousPath === pathname) return;
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      (previousPath.startsWith("/docs") && pathname.startsWith("/docs"))
    ) {
      return;
    }

    const content = contentRef.current;
    if (!content) return;

    const enteringDocs = pathname.startsWith("/docs");
    const animation = content.animate(
      enteringDocs
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            {
              opacity: 0,
              transform: "translate3d(0, 6px, 0)",
            },
            {
              opacity: 1,
              transform: "translate3d(0, 0, 0)",
            },
          ],
      {
        duration: enteringDocs ? 180 : 220,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      },
    );
    routeAnimationRef.current = animation;

    return () => {
      animation.cancel();
      if (routeAnimationRef.current === animation) {
        routeAnimationRef.current = null;
      }
    };
  }, [pathname]);

  useEffect(() => {
    const resolvedInitialChain = !previousHydrated.current && hydrated;
    previousHydrated.current = hydrated;
    if (resolvedInitialChain) {
      previousFocusContext.current = focusContext;
      return;
    }
    if (previousFocusContext.current === focusContext) return;
    previousFocusContext.current = focusContext;
    if (pathname.startsWith("/docs") && window.location.hash) return;
    const heading = contentRef.current?.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.dataset.routeAnnouncementFocus = "true";
      heading.addEventListener(
        "blur",
        () => delete heading.dataset.routeAnnouncementFocus,
        { once: true },
      );
      heading.focus({ preventScroll: true });
      return;
    }
    document.querySelector<HTMLElement>("#main-content")?.focus({
      preventScroll: true,
    });
  }, [focusContext, hydrated, pathname]);

  return (
    <div
      className={`route-transition${isDocsPath ? " route-transition-docs" : ""}`}
      ref={contentRef}
    >
      {children}
    </div>
  );
}
