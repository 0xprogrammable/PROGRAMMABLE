import type { Metadata } from "next";

import { MainTokenMigration } from "@/components/main-token-migration";

export const metadata: Metadata = {
  title: "V4 migration | Programmable",
  description:
    "Move V4 token units from Ethereum to the same address on Robinhood Chain.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function MigrationPage() {
  return <MainTokenMigration />;
}
