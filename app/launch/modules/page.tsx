import type { Metadata } from "next";
import { ModuleModeBuilder } from "@/components/module-mode-builder";

export const metadata: Metadata = {
  title: "Module Mode · Programmable",
  description: "Create a meme coin draft, choose creator fees and configure optional modules. Explore the Module Mode preview.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/launch/modules" },
};

export default function ModuleModePage() {
  return <ModuleModeBuilder />;
}
