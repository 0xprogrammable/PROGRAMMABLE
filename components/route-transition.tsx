"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const contentRef = useRef<HTMLDivElement>(null);
  const previousPathname = useRef(pathname);
  const isDocsPath = pathname.startsWith("/docs");

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
      key={isDocsPath ? "docs" : pathname}
      ref={contentRef}
    >
      {children}
    </div>
  );
}
