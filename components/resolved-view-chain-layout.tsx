import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { ViewChainRouteBoundary } from
  "@/components/view-chain-route-boundary";
import {
  parseViewChainId,
  VIEW_CHAIN_COOKIE_NAME,
} from "@/lib/view-chain";

export async function ResolvedViewChainLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const requestCookies = await cookies();
  const initialViewChainId = parseViewChainId(
    requestCookies.get(VIEW_CHAIN_COOKIE_NAME)?.value,
  );

  return (
    <ViewChainRouteBoundary initialViewChainId={initialViewChainId}>
      {children}
    </ViewChainRouteBoundary>
  );
}
