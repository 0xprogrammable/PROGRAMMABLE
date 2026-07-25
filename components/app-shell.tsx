import type { ReactNode } from "react";
import {
  MobileNavigation,
  SiteHeader,
} from "@/components/site-navigation";
import { WalletProvider } from "@/components/wallet-provider";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <div className="app-frame">
        <SiteHeader />
        <main>{children}</main>
        <MobileNavigation />
      </div>
    </WalletProvider>
  );
}
