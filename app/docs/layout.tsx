import type { Metadata } from "next";
import { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Programmable",
  description:
    "Developer documentation for discovering and building with Programmable launches.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
