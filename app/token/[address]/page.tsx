import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAddress } from "viem";

import { TokenIndexResetView } from "@/components/token-index-reset-view";
import { RobinhoodTokenView } from "@/components/robinhood-token-view";
import { readRobinhoodToken } from "@/lib/server/robinhood-index/read";
import { genericTokenDetailMetadata } from "@/lib/token-detail-metadata";
import { tokenDetailPageChainId } from "@/lib/token-page-chain";

type TokenPageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

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
  if (chainId === 4663 && isAddress(address)) {
    const { token } = await readRobinhoodToken(address);
    if (token) return {
      title: `${token.name || address} · Programmable`,
      description: "Programmable Custom launch on Robinhood Chain. Token, hook and launch stamp details.",
      alternates: { canonical: `/token/${token.tokenAddress}?chain=4663` },
    };
  }
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
  if (tokenDetailPageChainId(resolvedSearchParams.chain) === 4663) {
    const { token, status } = await readRobinhoodToken(address);
    return <RobinhoodTokenView address={address} token={token} status={status} />;
  }
  return <TokenIndexResetView />;
}
