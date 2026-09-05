import type { Metadata } from "next";

import { DeveloperApiKeys } from "@/components/developer-api-keys";

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

export function developerApiKeysInitialSection(
  searchParams: Record<string, string | string[] | undefined>,
) {
  return searchParams.start === "custom"
    && searchParams.chainId === "4663"
    ? "launch" as const
    : "keys" as const;
}

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
