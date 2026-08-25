import {
  readFinalizedRouterCustomIdentitySnapshotCoreV1,
  ROUTER_CUSTOM_SNAPSHOT_MAX_IDENTITIES,
  ROUTER_CUSTOM_SNAPSHOT_MAXIMUM_BYTES,
} from "../../../../../lib/alchemy/router-custom-public.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUCCESS_CACHE_CONTROL =
  "public, max-age=0, s-maxage=15, stale-while-revalidate=45";

const PUBLIC_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
});

function unavailableResponse() {
  return new Response(
    JSON.stringify({
      error: "Router Custom identities are temporarily unavailable",
    }),
    {
      status: 503,
      headers: {
        ...PUBLIC_HEADERS,
        "Cache-Control": "no-store",
        "Retry-After": "5",
      },
    },
  );
}

export async function GET() {
  try {
    const snapshot =
      await readFinalizedRouterCustomIdentitySnapshotCoreV1();
    const body = JSON.stringify(snapshot);
    if (
      !Array.isArray(snapshot.entries) ||
      snapshot.entries.length > ROUTER_CUSTOM_SNAPSHOT_MAX_IDENTITIES ||
      Buffer.byteLength(body, "utf8") > ROUTER_CUSTOM_SNAPSHOT_MAXIMUM_BYTES
    ) {
      return unavailableResponse();
    }
    return new Response(body, {
      status: 200,
      headers: {
        ...PUBLIC_HEADERS,
        "Cache-Control": SUCCESS_CACHE_CONTROL,
        "X-Programmable-Status": snapshot.status,
      },
    });
  } catch {
    console.error("Router Custom public snapshot unavailable", {
      name: "RouterCustomSnapshotReadError",
    });
    return unavailableResponse();
  }
}
