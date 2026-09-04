import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAddress } from "viem";

import { TokenIndexResetView } from "@/components/token-index-reset-view";
import { genericTokenDetailMetadata } from "@/lib/token-detail-metadata";
import { tryParseViewChainId, type ViewChainId } from "@/lib/view-chain";

type TokenPageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export function tokenDetailPageChainId(
  value: string | string[] | undefined,
): ViewChainId | null {
  if (value === undefined) return 1;
  return typeof value === "string" ? tryParseViewChainId(value) : null;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: TokenPageSearchParams;
}): Promise<Metadata> {
  const [{ address }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const chainId = tokenDetailPageChainId(resolvedSearchParams.chain);
  return genericTokenDetailMetadata(address, true, chainId ?? 1);
}

export default async function TokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: TokenPageSearchParams;
}) {
  const [{ address }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  if (
    !isAddress(address) ||
    tokenDetailPageChainId(resolvedSearchParams.chain) === null
  ) {
    notFound();
  }
  return <TokenIndexResetView />;
}
