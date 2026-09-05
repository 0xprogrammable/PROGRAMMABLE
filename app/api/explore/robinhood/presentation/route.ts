import { isAddress } from "viem";
import { readRobinhoodLaunches, readRobinhoodToken } from "@/lib/server/robinhood-index/read";
import { readRobinhoodPresentations } from "@/lib/server/robinhood-presentation";
import { parseRobinhoodExploreQuery } from "@/lib/robinhood-explore-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const token = query.get("token");
  const listQuery = token === null ? parseRobinhoodExploreQuery(query) : null;
  if (token === null ? !listQuery : !isAddress(token)
    || [...query.keys()].some((key) => key !== "token" || query.getAll(key).length !== 1)) {
    return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const tokens = listQuery
    ? (await readRobinhoodLaunches(listQuery.page, listQuery.q, listQuery.filters)).items
    : [(await readRobinhoodToken(token!)).token].filter((row) => row !== null);
  const items = await readRobinhoodPresentations(tokens);
  return Response.json({ items }, { headers: {
    "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60",
    "x-content-type-options": "nosniff",
  } });
}
