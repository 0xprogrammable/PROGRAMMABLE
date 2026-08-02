import { after, NextRequest, NextResponse } from "next/server";

import {
  QuickNodeStreamWakeError,
  parseQuickNodeBlockHint,
  verifyQuickNodeStreamWake,
  type QuickNodeStreamBlockHintParser,
} from "../../../../lib/data-pipeline/quicknode-stream-wake.server";
import {
  enqueueConfiguredQuickNodeWake,
  acknowledgeConfiguredQuickNodeWake,
  consumeConfiguredRealBlockSlaProviderRetryOnce,
  processDurableWakeJob,
  processNextConfiguredQuickNodeWake,
  type DurableWakeJobPorts,
} from "../../../../lib/data-pipeline/quicknode-wake-queue.server";
import { loadVercelWakeDeploymentBinding } from "../../../../lib/data-pipeline/read-model-real-block-sla-capture.server";
import { createConfiguredOptimisticWakeFirstStage } from "../../../../lib/data-pipeline/optimistic-wake-runtime.server";
import { runConfiguredProjectorCycle } from "../../../../lib/data-pipeline/projector-runtime-config.server";
import {
  runConfiguredMarketProjectorFastLaneCycle,
  safeMarketProjectorError,
} from "../../../../lib/data-pipeline/market-projector-runtime.server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
export const runtime = "nodejs";

const NO_STORE_HEADERS = Object.freeze({ "Cache-Control": "no-store" });
const FORCE_PROVIDER_RETRY_ONCE_ENV =
  "PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE";

function shouldForceProviderRetryOnce(
  request: NextRequest,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (env[FORCE_PROVIDER_RETRY_ONCE_ENV] !== "true") return false;
  const deploymentHost = env.VERCEL_URL;
  if (
    typeof deploymentHost !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,62}\.)+vercel\.app$/u.test(deploymentHost)
  ) {
    return false;
  }
  const expectedOrigin = `https://${deploymentHost}`;
  return request.nextUrl.origin === expectedOrigin &&
    request.headers.get("host") === deploymentHost;
}

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
  loadDeployment?: typeof loadVercelWakeDeploymentBinding;
  enqueue?: typeof enqueueConfiguredQuickNodeWake;
  acknowledge?: typeof acknowledgeConfiguredQuickNodeWake;
  consumeProviderRetryOnce?:
    typeof consumeConfiguredRealBlockSlaProviderRetryOnce;
  env?: Readonly<Record<string, string | undefined>>;
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

    let receipt: Awaited<ReturnType<typeof enqueueConfiguredQuickNodeWake>>;
    try {
      receipt = await (input.enqueue ?? enqueueConfiguredQuickNodeWake)(
        wake,
        (input.loadDeployment ?? loadVercelWakeDeploymentBinding)(),
      );
      await (input.acknowledge ?? acknowledgeConfiguredQuickNodeWake)(receipt);
    } catch {
      console.error("Programmable stream wake could not be durably scheduled");
      return NextResponse.json(
        { error: "Wake trigger unavailable" },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    let forceProviderRetry = false;
    if (shouldForceProviderRetryOnce(request, input.env ?? process.env)) {
      try {
        const consumed = await (
          input.consumeProviderRetryOnce ??
            consumeConfiguredRealBlockSlaProviderRetryOnce
        )(receipt);
        forceProviderRetry = receipt.enqueued && consumed;
      } catch {
        console.error(
          "Programmable real-block provider retry probe could not be recorded",
        );
        after(() => runDurableWakeWorker(input.firstStage));
        return NextResponse.json(
          { accepted: true },
          { status: 202, headers: NO_STORE_HEADERS },
        );
      }
    }

    after(() => runDurableWakeWorker(input.firstStage));
    if (forceProviderRetry) {
      return NextResponse.json(
        { error: "Wake trigger unavailable" },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { accepted: true },
      { status: 202, headers: NO_STORE_HEADERS },
    );
  };
}

export const POST = createProjectorWakePost({
  parseBlockHint: parseQuickNodeBlockHint,
  firstStage: createConfiguredOptimisticWakeFirstStage(),
});
