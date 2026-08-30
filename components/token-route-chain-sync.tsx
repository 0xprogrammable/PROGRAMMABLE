"use client";

import { useEffect, useRef, type ReactNode } from "react";

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
  const { hydrated, setViewChainId, viewChainId } = useViewChain();
  const synchronized = useRef(false);

  useEffect(() => {
    if (!hydrated || synchronized.current) return;
    synchronized.current = true;
    if (viewChainId !== chainId) setViewChainId(chainId);
  }, [chainId, hydrated, setViewChainId, viewChainId]);

  return children;
}
