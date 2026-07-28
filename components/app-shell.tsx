import type { ReactNode } from "react";
import {
  MobileNavigation,
  SiteHeader,
} from "@/components/site-navigation";
import { RouteTransition } from "@/components/route-transition";
import { WalletProvider } from "@/components/wallet-provider";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <div className="app-frame">
        <SiteHeader />
        <main>
          <RouteTransition>{children}</RouteTransition>
        </main>
        <MobileNavigation />
      </div>
    </WalletProvider>
  );
}
