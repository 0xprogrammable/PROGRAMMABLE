import { timingSafeEqual } from "node:crypto";
import { robinhoodSource } from "@/lib/server/robinhood-index/source";
import { indexStore } from "@/lib/server/robinhood-index/store";
import { configuredModuleModeSource } from "@/lib/server/robinhood-index/module-source";
import { syncRobinhoodIndex, syncModuleModeIndex } from "@/lib/server/robinhood-index/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

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
  const startedAt = Date.now();
  try {
    const store = indexStore();
    const source = await robinhoodSource();
    const result = await syncRobinhoodIndex(source, store);
    // Keep a genuine rollup proof inside the job's wall-clock budget. A deadline is an error,
    // never permission to publish a partial proof or skip the final canonical checkpoint read.
    const remaining = 165_000 - (Date.now() - startedAt);
    if (remaining <= 0) throw new Error("Index deadline exceeded");
    const moduleSource = await configuredModuleModeSource(undefined, AbortSignal.timeout(remaining));
    if (!moduleSource) return reply(result, result.status === "partial" ? 503 : 200);
    const moduleMode = await syncModuleModeIndex(moduleSource, store, {
      budgetMs: Math.max(0, Math.min(90_000, 165_000 - (Date.now() - startedAt))),
    });
    return reply({ ...result, moduleMode }, result.status === "partial" || moduleMode.status === "partial" ? 503 : 200);
  } catch { return reply({ error: "index_update_unavailable" }, 503); }
}
