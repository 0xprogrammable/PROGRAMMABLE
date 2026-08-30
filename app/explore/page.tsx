import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { NextRequest } from "next/server";
import { Suspense } from "react";

import { GET as readExploreResponse } from "@/app/api/explore/route";
import { ExploreView } from "@/components/explore-view";
import type {
  ExploreInitialResponse,
  ExploreModelFilter,
} from "@/components/explore-view";
import { DEFAULT_EXPLORE_VIEW_SORT } from "@/lib/explore-defaults";
import {
  parseViewChainId,
  VIEW_CHAIN_COOKIE_NAME,
  type ViewChainId,
} from "@/lib/view-chain";

export const dynamic = "force-dynamic";

// The route owns an eight-second provider budget. Give it a small response
// margin so a valid slow read is not aborted and immediately repeated by the
// browser, while keeping the initial render strictly bounded.
export const INITIAL_EXPLORE_TIMEOUT_MS = 8_500;
export const INITIAL_EXPLORE_QUERY = new URLSearchParams({
  chain: "1",
  q: "",
  sort: DEFAULT_EXPLORE_VIEW_SORT,
  page: "1",
  limit: "9",
}).toString();

type ExplorePageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export function initialExploreModelFilter(
  value: string | string[] | undefined,
): ExploreModelFilter {
  if (value === "classic") return "classic";
  if (value === "custom") return "custom-hook";
  return "all";
}

export function initialExploreQuery(
  modelFilter: ExploreModelFilter,
  viewChainId: ViewChainId = 1,
) {
  const query = new URLSearchParams(INITIAL_EXPLORE_QUERY);
  query.set("chain", String(viewChainId));
  if (modelFilter !== "all") {
    query.set(
      "model",
      modelFilter === "custom-hook" ? "custom" : "classic",
    );
  }
  return query.toString();
}

function unavailableInitialExploreResponse(): ExploreInitialResponse {
  return {
    ok: false,
    body: { error: "Tokens are temporarily unavailable" },
  };
}

export async function readInitialExploreWithinDeadline(
  read: (signal: AbortSignal) => Promise<ExploreInitialResponse>,
  timeoutMs = INITIAL_EXPLORE_TIMEOUT_MS,
): Promise<ExploreInitialResponse> {
  const controller = new AbortController();
  const guardedRead = Promise.resolve()
    .then(() => read(controller.signal))
    .catch(() => unavailableInitialExploreResponse());
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ExploreInitialResponse>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(unavailableInitialExploreResponse());
    }, timeoutMs);
  });

  try {
    return await Promise.race([guardedRead, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    controller.abort();
  }
}

export const metadata: Metadata = {
  title: "Explore launches · Programmable",
  description:
    "Explore Classic tokens and custom Uniswap v4 hook projects launched through Programmable.",
  alternates: {
    canonical: "/explore",
  },
};

function isLocalPreviewHost(host: string | null) {
  const hostname = host?.replace(/^\[|\](?::\d+)?$|:\d+$/gu, "").toLowerCase();
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

async function InitialExploreView({
  searchParams,
}: Readonly<{ searchParams: ExplorePageSearchParams }>) {
  const [requestHeaders, requestCookies, resolvedSearchParams] =
    await Promise.all([
      headers(),
      cookies(),
      searchParams,
    ]);
  const viewChainId = parseViewChainId(
    requestCookies.get(VIEW_CHAIN_COOKIE_NAME)?.value,
  );
  const modelFilter = initialExploreModelFilter(resolvedSearchParams.model);
  if (isLocalPreviewHost(requestHeaders.get("host"))) {
    return <ExploreView initialModelFilter={modelFilter} />;
  }

  const initialResponse = await readInitialExploreWithinDeadline(
    async (signal) => {
      // prettier-ignore
      const response = await readExploreResponse(new NextRequest(
        `http://programmable.local/api/explore?${initialExploreQuery(modelFilter, viewChainId)}`,
        {
          headers: { Accept: "application/json" },
          signal,
        },
      ));
      const body: unknown = await response.json().catch(() => null);
      return { ok: response.ok, body };
    },
  );

  return (
    <ExploreView
      initialResponse={initialResponse}
      initialResponseChainId={viewChainId}
      initialModelFilter={modelFilter}
    />
  );
}

export default function ExplorePage({
  searchParams,
}: Readonly<{ searchParams: ExplorePageSearchParams }>) {
  return (
    <Suspense fallback={<ExploreView loadingOnly />}>
      <InitialExploreView searchParams={searchParams} />
    </Suspense>
  );
}
