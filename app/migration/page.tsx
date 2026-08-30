import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MainTokenMigration } from "@/components/main-token-migration";
import migrationActivationManifest from "@/config/main-token-migration-activation.v1.json";

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
  const publicReleaseEnabled =
    process.env.PROGRAMMABLE_MAIN_TOKEN_MIGRATION_PAGE_ENABLED === "true" &&
    migrationActivationManifest.enabled === true;
  if (!localPreview && !publicReleaseEnabled) {
    notFound();
  }
  return <MainTokenMigration />;
}
