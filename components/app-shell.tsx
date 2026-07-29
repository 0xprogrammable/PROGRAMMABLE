import type { ReactNode } from "react";
import {
  MobileNavigation,
  SiteHeader,
} from "@/components/site-navigation";
import { RouteTransition } from "@/components/route-transition";
import { SiteAtmosphere } from "@/components/site-atmosphere";
import { WalletProvider } from "@/components/wallet-provider";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <div className="app-frame">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteAtmosphere />
        <SiteHeader />
        <main id="main-content" tabIndex={-1}>
          <RouteTransition>{children}</RouteTransition>
        </main>
        <MobileNavigation />
      </div>
    </WalletProvider>
  );
}
