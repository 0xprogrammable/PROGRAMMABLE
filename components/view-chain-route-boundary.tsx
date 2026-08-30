"use client";

import type { ReactNode } from "react";

import { useViewChain, type ViewChainId } from "@/components/view-chain";
import { ViewChainPending, ViewChainUnavailable } from
  "@/components/view-chain-unavailable";

export function ViewChainRouteBoundary({
  children,
  initialViewChainId,
}: Readonly<{
  children: ReactNode;
  initialViewChainId: ViewChainId | null;
}>) {
  const { hydrated, viewChainId } = useViewChain();
  if (!hydrated && initialViewChainId === null) {
    return <ViewChainPending />;
  }
  const resolvedViewChainId = hydrated ? viewChainId : initialViewChainId;

  return resolvedViewChainId === 4663
    ? <ViewChainUnavailable />
    : children;
}
