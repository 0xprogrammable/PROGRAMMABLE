import type { Metadata } from "next";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { Suspense } from "react";

import { GET as readExploreResponse } from "@/app/api/explore/route";
import { ExploreView } from "@/components/explore-view";

export const dynamic = "force-dynamic";

const INITIAL_EXPLORE_TIMEOUT_MS = 12_000;
const INITIAL_EXPLORE_QUERY = new URLSearchParams({
  q: "",
  sort: "newest",
  page: "1",
  limit: "9",
}).toString();

export const metadata: Metadata = {
  title: "Programmable",
  description: "Explore tokens launched through Programmable.",
  alternates: {
    canonical: "/explore",
  },
};

function isLocalPreviewHost(host: string | null) {
  const hostname = host
    ?.replace(/^\[|\](?::\d+)?$|:\d+$/gu, "")
    .toLowerCase();
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

async function InitialExploreView() {
  const requestHeaders = await headers();
  if (isLocalPreviewHost(requestHeaders.get("host"))) {
    return <ExploreView />;
  }

  let initialResponse: Readonly<{ ok: boolean; body: unknown }>;
  try {
    const response = await readExploreResponse(new NextRequest(
      `http://programmable.local/api/explore?${INITIAL_EXPLORE_QUERY}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(INITIAL_EXPLORE_TIMEOUT_MS),
      },
    ));
    const body: unknown = await response.json().catch(() => null);
    initialResponse = { ok: response.ok, body };
  } catch {
    initialResponse = {
      ok: false,
      body: { error: "Tokens are temporarily unavailable" },
    };
  }

  return <ExploreView initialResponse={initialResponse} />;
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<ExploreView loadingOnly />}>
      <InitialExploreView />
    </Suspense>
  );
}
