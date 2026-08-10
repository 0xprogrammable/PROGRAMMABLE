import type { Metadata } from "next";
import { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Documentation · Programmable",
  description:
    "Product, token, infrastructure and developer documentation for Programmable on Ethereum.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div data-docs-font>{children}</div>
      <SiteFooter />
    </>
  );
}
