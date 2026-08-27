import type { Metadata } from "next";

import { PartnerAdminConsole } from "@/components/partner-admin-console";

export const metadata: Metadata = {
  title: "Partner access · Programmable",
  description: "Manage Programmable partner launch access.",
  robots: { index: false, follow: false },
};

export default function PartnerAdminPage() {
  return <PartnerAdminConsole />;
}
