"use client";

import { useEffect, type ReactNode } from "react";

import {
  useViewChain,
  type ViewChainId,
} from "@/components/view-chain";

export function TokenRouteChainSync({
  chainId,
  children,
}: Readonly<{
  chainId: ViewChainId;
  children: ReactNode;
}>) {
  const { hydrated, setViewChainId } = useViewChain();

  useEffect(() => {
    if (!hydrated) return;
    // Wait for the provider to finish restoring its saved preference first.
    const timer = window.setTimeout(() => setViewChainId(chainId), 0);
    return () => window.clearTimeout(timer);
  }, [chainId, hydrated, setViewChainId]);

  return children;
}
