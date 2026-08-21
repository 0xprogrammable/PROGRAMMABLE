import { NextRequest } from "next/server";
import { Suspense } from "react";

import { GET as readTokenDetailResponse } from
  "@/app/api/explore/token/route";
import {
  TokenDetailView,
  type TokenDetailInitialResponse,
} from "@/components/token-detail-view";
import { TokenDetailShell } from "@/components/token-detail-shell";

export const dynamic = "force-dynamic";

const INITIAL_TOKEN_DETAIL_TIMEOUT_MS = 4_000;

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

export default async function TokenPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return (
    <Suspense fallback={<TokenDetailShell />}>
      <InitialTokenDetail address={address} />
    </Suspense>
  );
}

async function InitialTokenDetail({ address }: { address: string }) {
  const search = new URLSearchParams({ address });
  const initialResponse = await readInitialTokenDetailWithinDeadline(
    async (signal) => {
      const response = await readTokenDetailResponse(new NextRequest(
        `http://programmable.local/api/explore/token?${search.toString()}`,
        {
          headers: { Accept: "application/json" },
          signal,
        },
      ));
      const body: unknown = await response.json().catch(() => null);
      return { status: response.status, body };
    },
  );

  return (
    <TokenDetailView
      key={address.toLowerCase()}
      address={address}
      initialResponse={initialResponse}
    />
  );
}
