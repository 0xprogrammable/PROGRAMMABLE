import { readRobinhoodLaunches } from "@/lib/server/robinhood-index/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const page = query.get("page") ?? "1";
  const search = query.get("q") ?? "";
  if ([...query.keys()].some((key) => !["page", "q"].includes(key) || query.getAll(key).length !== 1)
    || !/^[1-9]\d{0,5}$/.test(page) || search.length > 128) {
    return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  return Response.json(await readRobinhoodLaunches(Number(page), search), { headers: {
    "cache-control": "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
    "x-content-type-options": "nosniff",
  } });
}
