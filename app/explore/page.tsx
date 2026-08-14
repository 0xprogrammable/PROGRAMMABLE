import type { Metadata } from "next";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { Suspense } from "react";

import { GET as readExploreResponse } from "@/app/api/explore/route";
import { ExploreView } from "@/components/explore-view";
import type { ExploreInitialResponse } from "@/components/explore-view";
import { DEFAULT_EXPLORE_VIEW_SORT } from "@/lib/explore-defaults";

export const dynamic = "force-dynamic";

const INITIAL_EXPLORE_TIMEOUT_MS = 12_000;
export const INITIAL_EXPLORE_QUERY = new URLSearchParams({
  q: "",
  sort: DEFAULT_EXPLORE_VIEW_SORT,
  page: "1",
  limit: "9",
}).toString();

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
  title: "Programmable",
  description: "Explore tokens launched through Programmable.",
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

async function InitialExploreView() {
  const requestHeaders = await headers();
  if (isLocalPreviewHost(requestHeaders.get("host"))) {
    return <ExploreView />;
  }

  const initialResponse = await readInitialExploreWithinDeadline(
    async (signal) => {
      // prettier-ignore
      const response = await readExploreResponse(new NextRequest(
        `http://programmable.local/api/explore?${INITIAL_EXPLORE_QUERY}`,
        {
          headers: { Accept: "application/json" },
          signal,
        },
      ));
      const body: unknown = await response.json().catch(() => null);
      return { ok: response.ok, body };
    },
  );

  return <ExploreView initialResponse={initialResponse} />;
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<ExploreView loadingOnly />}>
      <InitialExploreView />
    </Suspense>
  );
}
