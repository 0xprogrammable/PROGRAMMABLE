import type { Metadata } from "next";

import { DeveloperApiKeys } from "@/components/developer-api-keys";
import { developerApiKeysInitialSection } from "@/lib/developer-api-key-route";

export const metadata: Metadata = {
  title: "API keys · Programmable",
  description:
    "Manage Programmable API keys for launch agents on Ethereum and Robinhood.",
  alternates: {
    canonical: "/developers/api-keys",
  },
};

type DeveloperApiKeysSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function DeveloperApiKeysPage({
  searchParams,
}: Readonly<{ searchParams: DeveloperApiKeysSearchParams }>) {
  const resolvedSearchParams = await searchParams;
  return (
    <DeveloperApiKeys
      initialSection={developerApiKeysInitialSection(resolvedSearchParams)}
    />
  );
}
