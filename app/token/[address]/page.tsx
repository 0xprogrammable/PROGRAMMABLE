import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextRequest } from "next/server";
import { cache, Suspense } from "react";

import { GET as readTokenDetailResponse } from
  "@/app/api/explore/token/route";
import {
  TokenDetailView,
  type TokenDetailInitialResponse,
} from "@/components/token-detail-view";
import { TokenDetailShell } from "@/components/token-detail-shell";
import { tokenDetailMetadataFromProjection } from
  "@/lib/token-detail-metadata";
import {
  tryParseViewChainId,
  type ViewChainId,
} from "@/lib/view-chain";

export const dynamic = "force-dynamic";

// The route owns an eight-second provider budget. Give it a small response
// margin so a valid slow read is not aborted and immediately repeated by the
// browser, while keeping the initial render strictly bounded.
export const INITIAL_TOKEN_DETAIL_TIMEOUT_MS = 8_500;

type TokenPageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export function tokenDetailPageChainId(
  value: string | string[] | undefined,
): ViewChainId | null {
  if (value === undefined) return 1;
  return typeof value === "string" ? tryParseViewChainId(value) : null;
}

function unavailableInitialTokenDetailResponse(): TokenDetailInitialResponse {
  return {
    status: 503,
    body: { error: "Token data is temporarily unavailable" },
  };
}

export async function readInitialTokenDetailWithinDeadline(
  read: (signal: AbortSignal) => Promise<TokenDetailInitialResponse>,
  timeoutMs = INITIAL_TOKEN_DETAIL_TIMEOUT_MS,
): Promise<TokenDetailInitialResponse> {
  const controller = new AbortController();
  const guardedRead = Promise.resolve()
    .then(() => read(controller.signal))
    .catch(() => unavailableInitialTokenDetailResponse());
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<TokenDetailInitialResponse>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(unavailableInitialTokenDetailResponse());
    }, timeoutMs);
  });

  try {
    return await Promise.race([guardedRead, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    controller.abort();
  }
}

const readInitialTokenDetail = cache(async (
  address: string,
  chainId: ViewChainId,
) => {
  const search = new URLSearchParams({
    address,
    chain: String(chainId),
  });
  return await readInitialTokenDetailWithinDeadline(async (signal) => {
    const response = await readTokenDetailResponse(new NextRequest(
      `http://programmable.local/api/explore/token?${search.toString()}`,
      {
        headers: { Accept: "application/json" },
        signal,
      },
    ));
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  });
});

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
  if (chainId === null) {
    return tokenDetailMetadataFromProjection(address, {
      status: 400,
      body: { error: "Unsupported chain" },
    });
  }
  return tokenDetailMetadataFromProjection(
    address,
    await readInitialTokenDetail(address, chainId),
    chainId,
  );
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
  const chainId = tokenDetailPageChainId(resolvedSearchParams.chain);
  if (chainId === null) notFound();
  return (
    <Suspense fallback={<TokenDetailShell />}>
      <InitialTokenDetail address={address} chainId={chainId} />
    </Suspense>
  );
}

async function InitialTokenDetail({
  address,
  chainId,
}: {
  address: string;
  chainId: ViewChainId;
}) {
  const initialResponse = await readInitialTokenDetail(address, chainId);

  return (
    <TokenDetailView
      key={`${chainId}:${address.toLowerCase()}`}
      address={address}
      chainId={chainId}
      initialResponse={initialResponse}
    />
  );
}
