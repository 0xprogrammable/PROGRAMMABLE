import type { ReactNode } from "react";
import { AtmosphereBackdrop } from "@/components/atmosphere-backdrop";
import { LiquidGlassFilter } from "@/components/liquid-glass-filter";
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
        <LiquidGlassFilter />
        <AtmosphereBackdrop />
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main-content" tabIndex={-1}>
          <RouteTransition>{children}</RouteTransition>
        </main>
        <MobileNavigation />
      </div>
    </WalletProvider>
  );
}
