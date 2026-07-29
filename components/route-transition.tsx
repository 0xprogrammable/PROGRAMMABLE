"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const contentRef = useRef<HTMLDivElement>(null);
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
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
      className="route-transition"
      key={pathname}
      ref={contentRef}
    >
      {children}
    </div>
  );
}
