import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { ViewChainRouteBoundary } from
  "@/components/view-chain-route-boundary";
import {
  VIEW_CHAIN_COOKIE_NAME,
} from "@/lib/view-chain";

export async function ResolvedViewChainLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const requestCookies = await cookies();
  const storedViewChainId = requestCookies.get(VIEW_CHAIN_COOKIE_NAME)?.value;
  const initialViewChainId = storedViewChainId === "1"
    ? 1
    : storedViewChainId === "4663"
    ? 4663
    : null;

  return (
    <ViewChainRouteBoundary initialViewChainId={initialViewChainId}>
      {children}
    </ViewChainRouteBoundary>
  );
}
