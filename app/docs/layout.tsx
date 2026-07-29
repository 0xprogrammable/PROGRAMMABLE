import type { Metadata } from "next";
import { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: {
    default: "Docs · Programmable",
    template: "%s · Programmable Docs",
  },
  description:
    "How Programmable launch models create tokens, route fees and use Uniswap v4 on Ethereum.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
