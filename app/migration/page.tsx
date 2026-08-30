import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MainTokenMigration } from "@/components/main-token-migration";
import migrationActivationManifest from "@/config/main-token-migration-activation.v2.json";
import { isMainTokenMigrationActivationEnabled } from "@/lib/main-token-migration-activation";

export const metadata: Metadata = {
  title: "V4 migration | Programmable",
  description:
    "Send Ethereum V4 and receive the exact same V4 token amount at the same address on Robinhood.",
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
    isMainTokenMigrationActivationEnabled(migrationActivationManifest);
  if (!localPreview && !publicReleaseEnabled) {
    notFound();
  }
  return <MainTokenMigration />;
}
