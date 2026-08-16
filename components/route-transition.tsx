"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const contentRef = useRef<HTMLDivElement>(null);
  const previousPathname = useRef(pathname);
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
              transform: "translate3d(0, 12px, 0)",
            },
            {
              opacity: 1,
              transform: "translate3d(0, 0, 0)",
            },
          ],
      {
        duration: enteringDocs ? 420 : 720,
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
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    if (pathname.startsWith("/docs") && window.location.hash) return;
    const heading = contentRef.current?.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      return;
    }
    document.querySelector<HTMLElement>("#main-content")?.focus({
      preventScroll: true,
    });
  }, [pathname]);

  return (
    <div
      className={`route-transition${isDocsPath ? " route-transition-docs" : ""}`}
      ref={contentRef}
    >
      {children}
    </div>
  );
}
