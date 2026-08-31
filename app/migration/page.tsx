import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MainTokenMigration } from "@/components/main-token-migration";

export const metadata: Metadata = {
  title: "V4 migration | Programmable",
  description:
    "Prepare an Ethereum V4 transfer for an equal token-unit allocation to the same address on Robinhood Chain.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function MigrationPage() {
  const localPreview =
    process.env.NODE_ENV !== "production" &&
    process.env.PROGRAMMABLE_MAIN_TOKEN_MIGRATION_LOCAL_PREVIEW === "true";
  const publicPageEnabled =
    process.env.PROGRAMMABLE_MAIN_TOKEN_MIGRATION_PAGE_ENABLED === "true";
  if (!localPreview && !publicPageEnabled) {
    notFound();
  }
  return <MainTokenMigration />;
}
