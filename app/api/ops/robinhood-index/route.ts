import { timingSafeEqual } from "node:crypto";
import { robinhoodSource } from "@/lib/server/robinhood-index/source";
import { indexStore } from "@/lib/server/robinhood-index/store";
import { syncRobinhoodIndex } from "@/lib/server/robinhood-index/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const actual = request.headers.get("authorization");
  const authorized = expected && expected.length >= 32 && expected.length <= 1024 && actual
    && Buffer.byteLength(actual) === Buffer.byteLength(`Bearer ${expected}`)
    && timingSafeEqual(Buffer.from(actual), Buffer.from(`Bearer ${expected}`));
  const reply = (body: unknown, status: number) => Response.json(body, { status, headers: {
    "cache-control": "no-store", "x-content-type-options": "nosniff",
  } });
  if (!authorized) return reply({ error: "unauthorized" }, 401);
  if (new URL(request.url).search || request.body) return reply({ error: "invalid_request" }, 400);
  try {
    const store = indexStore();
    const source = await robinhoodSource();
    const result = await syncRobinhoodIndex(source, store);
    return reply(result, result.status === "partial" ? 503 : 200);
  } catch { return reply({ error: "index_update_unavailable" }, 503); }
}
