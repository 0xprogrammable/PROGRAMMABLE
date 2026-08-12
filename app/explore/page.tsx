import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";

import { ExploreView } from "@/components/explore-view";

export const dynamic = "force-dynamic";

const INITIAL_EXPLORE_URL = "https://programmable.market/api/explore";
const INITIAL_EXPLORE_TIMEOUT_MS = 12_000;

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
    const response = await fetch(INITIAL_EXPLORE_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(INITIAL_EXPLORE_TIMEOUT_MS),
    });
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
