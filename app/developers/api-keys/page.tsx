import type { Metadata } from "next";

import { DeveloperApiKeys } from "@/components/developer-api-keys";

export const metadata: Metadata = {
  title: "API keys · Programmable",
  description:
    "Create scoped Programmable API keys for custom launch agents while your wallet keeps control of final transactions.",
  alternates: {
    canonical: "/developers/api-keys",
  },
};

export default function DeveloperApiKeysPage() {
  return <DeveloperApiKeys />;
}
