import { isAddress } from "viem";
import { readRobinhoodLaunches, readRobinhoodToken } from "@/lib/server/robinhood-index/read";
import { readRobinhoodPresentations } from "@/lib/server/robinhood-presentation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const token = query.get("token");
  const page = query.get("page") ?? "1";
  const search = query.get("q") ?? "";
  const allowed = token === null ? ["page", "q"] : ["token"];
  if ([...query.keys()].some((key) => !allowed.includes(key) || query.getAll(key).length !== 1)
    || (token !== null && !isAddress(token)) || !/^[1-9]\d{0,5}$/.test(page) || search.length > 128) {
    return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const tokens = token === null
    ? (await readRobinhoodLaunches(Number(page), search)).items
    : [(await readRobinhoodToken(token)).token].filter((row) => row !== null);
  const items = await readRobinhoodPresentations(tokens);
  return Response.json({ items }, { headers: {
    "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60",
    "x-content-type-options": "nosniff",
  } });
}
