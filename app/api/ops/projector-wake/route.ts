import { after, NextRequest, NextResponse } from "next/server";

import {
  QuickNodeStreamWakeError,
  verifyQuickNodeStreamWake,
  type QuickNodeStreamBlockHintParser,
} from "../../../../lib/data-pipeline/quicknode-stream-wake.server";
import {
  enqueueConfiguredQuickNodeWake,
  processDurableWakeJob,
  processNextConfiguredQuickNodeWake,
  type DurableWakeJobPorts,
} from "../../../../lib/data-pipeline/quicknode-wake-queue.server";
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
  let failed = false;
  try {
    const source = await runConfiguredProjectorCycle();
    console.info("Programmable stream-woken source projector completed", {
      status: resultStatus(source),
      durationMs: Date.now() - startedAt,
    });
  } catch {
    failed = true;
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
    failed = true;
    console.error("Programmable stream-woken market fast lane failed", {
      ...safeMarketProjectorError(error),
      durationMs: Date.now() - marketStartedAt,
    });
  }
  if (failed) throw new Error("stream-woken projector cycle failed");
}

async function runDurableWakeWorker(
  firstStage: DurableWakeJobPorts["firstStage"],
) {
  try {
    const status = await processNextConfiguredQuickNodeWake((job) =>
      processDurableWakeJob(job, {
        firstStage,
        canonicalCatchUp: runWakeCycle,
      })
    );
    console.info("Programmable durable stream wake worker completed", {
      status,
    });
  } catch {
    console.error("Programmable durable stream wake worker failed");
  }
}

export function createProjectorWakePost(input: Readonly<{
  parseBlockHint: QuickNodeStreamBlockHintParser;
  firstStage: DurableWakeJobPorts["firstStage"];
}>) {
  return async function projectorWakePost(request: NextRequest) {
    let wake: Awaited<ReturnType<typeof verifyQuickNodeStreamWake>>;
    try {
      wake = await verifyQuickNodeStreamWake(request, {
        parseBlockHint: input.parseBlockHint,
      });
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

    if (wake.kind === "auth-only-canary") {
      return NextResponse.json(
        { accepted: true },
        { status: 202, headers: NO_STORE_HEADERS },
      );
    }

    try {
      await enqueueConfiguredQuickNodeWake(wake);
    } catch {
      console.error("Programmable stream wake could not be durably scheduled");
      return NextResponse.json(
        { error: "Wake trigger unavailable" },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    after(() => runDurableWakeWorker(input.firstStage));
    return NextResponse.json(
      { accepted: true },
      { status: 202, headers: NO_STORE_HEADERS },
    );
  };
}

function unconfiguredFirstStage(): Promise<never> {
  return Promise.reject(new Error("optimistic wake first stage unavailable"));
}

function unconfiguredBlockHintParser(): never {
  throw new QuickNodeStreamWakeError(503);
}

// Integration replaces both fail-closed ports with the reviewed optimistic
// parser/bridge. The auth-only release canary remains usable before cutover.
export const POST = createProjectorWakePost({
  parseBlockHint: unconfiguredBlockHintParser,
  firstStage: unconfiguredFirstStage,
});
