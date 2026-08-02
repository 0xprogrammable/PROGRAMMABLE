import { after, NextRequest, NextResponse } from "next/server";

import {
  QuickNodeStreamWakeError,
  verifyQuickNodeStreamWake,
} from "../../../../lib/data-pipeline/quicknode-stream-wake.server";
import { runConfiguredProjectorCycle } from "../../../../lib/data-pipeline/projector-runtime-config.server";
import {
  runConfiguredMarketProjectorFastLaneCycle,
  safeMarketProjectorError,
} from "../../../../lib/data-pipeline/market-projector-runtime.server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
export const runtime = "nodejs";

const NO_STORE_HEADERS = Object.freeze({ "Cache-Control": "no-store" });

function resultStatus(value: unknown): string {
  return value !== null &&
    typeof value === "object" &&
    "status" in value &&
    typeof value.status === "string"
    ? value.status
    : "unknown";
}

async function runWakeCycle() {
  const startedAt = Date.now();
  try {
    const source = await runConfiguredProjectorCycle();
    console.info("Programmable stream-woken source projector completed", {
      status: resultStatus(source),
      durationMs: Date.now() - startedAt,
    });
  } catch {
    console.error("Programmable stream-woken source projector failed", {
      durationMs: Date.now() - startedAt,
    });
  }

  const marketStartedAt = Date.now();
  try {
    const market = await runConfiguredMarketProjectorFastLaneCycle();
    console.info("Programmable stream-woken market fast lane completed", {
      status: resultStatus(market),
      durationMs: Date.now() - marketStartedAt,
    });
  } catch (error) {
    console.error("Programmable stream-woken market fast lane failed", {
      ...safeMarketProjectorError(error),
      durationMs: Date.now() - marketStartedAt,
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    await verifyQuickNodeStreamWake(request);
  } catch (error) {
    const status =
      error instanceof QuickNodeStreamWakeError ? error.status : 400;
    console.warn("Programmable stream wake rejected", { status });
    return NextResponse.json(
      {
        error:
          status === 503
            ? "Wake trigger unavailable"
            : status === 401
              ? "Unauthorized"
              : "Wake trigger rejected",
      },
      { status, headers: NO_STORE_HEADERS },
    );
  }

  after(runWakeCycle);
  return NextResponse.json(
    { accepted: true },
    { status: 202, headers: NO_STORE_HEADERS },
  );
}
