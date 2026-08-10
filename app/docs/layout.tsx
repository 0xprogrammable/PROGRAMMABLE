import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";

const docsSans = Manrope({
  subsets: ["latin"],
  variable: "--font-docs",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Documentation · Programmable",
  description:
    "Product, token, infrastructure and developer documentation for Programmable on Ethereum.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className={docsSans.variable} data-docs-font>
        {children}
      </div>
      <SiteFooter />
    </>
  );
}
