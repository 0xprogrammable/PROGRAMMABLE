import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  armConfiguredRealBlockSlaProviderRetryOnce,
  captureRealBlockSla,
} from "../../../../lib/data-pipeline/read-model-real-block-sla-capture.server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const runtime = "nodejs";

const MAXIMUM_BODY_BYTES = 1_024;
const PRIVATE_NO_STORE = Object.freeze({
  "Cache-Control": "private, no-store",
});

function authorized(request: NextRequest): boolean {
  const secret = process.env.PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN;
  const provided = request.headers.get("x-programmable-performance-probe-token");
  if (
    request.headers.get("x-programmable-performance-probe") !== "1" ||
    typeof secret !== "string" ||
    Buffer.byteLength(secret, "utf8") < 32 ||
    provided === null
  ) return false;
  const expected = Buffer.from(secret, "utf8");
  const actual = Buffer.from(provided, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function response(body: object, status: number) {
  return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE });
}

async function requestBody(request: NextRequest): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_BODY_BYTES) {
    throw new RangeError("request body is too large");
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAXIMUM_BODY_BYTES) {
    throw new RangeError("request body is too large");
  }
  return JSON.parse(rawBody) as unknown;
}

function exactUnaliasedDeploymentRequest(request: NextRequest): boolean {
  const deploymentHost = process.env.VERCEL_URL;
  if (
    process.env.PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE !== "true" ||
    typeof deploymentHost !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,62}\.)+vercel\.app$/u.test(deploymentHost)
  ) return false;
  return request.nextUrl.origin === `https://${deploymentHost}` &&
    request.headers.get("host") === deploymentHost;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return response({ error: "Unauthorized" }, 401);
  let body: unknown;
  try {
    body = await requestBody(request);
  } catch (error) {
    if (error instanceof RangeError) {
      return response({ error: "Capture request is too large" }, 413);
    }
    return response({ error: "Capture request is invalid" }, 400);
  }
  if (
    body === null || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "challenge,deliveryReceiptId" ||
    typeof Reflect.get(body, "deliveryReceiptId") !== "string" ||
    !/^[1-9][0-9]{0,18}$/u.test(Reflect.get(body, "deliveryReceiptId") as string) ||
    typeof Reflect.get(body, "challenge") !== "string" ||
    !/^0x(?!0{64}$)[0-9a-f]{64}$/u.test(Reflect.get(body, "challenge") as string)
  ) {
    return response({ error: "Capture request is invalid" }, 400);
  }
  try {
    const evidence = await captureRealBlockSla({
      deliveryReceiptId: Reflect.get(body, "deliveryReceiptId") as string,
      challenge: Reflect.get(body, "challenge") as string,
    });
    return response(evidence, 200);
  } catch {
    return response({ error: "Real-block SLA evidence is not ready" }, 409);
  }
}

export async function PUT(request: NextRequest) {
  if (!authorized(request)) return response({ error: "Unauthorized" }, 401);
  if (!exactUnaliasedDeploymentRequest(request)) {
    return response({ error: "Provider retry probe is unavailable" }, 409);
  }
  let body: unknown;
  try {
    body = await requestBody(request);
  } catch (error) {
    if (error instanceof RangeError) {
      return response({ error: "Arm request is too large" }, 413);
    }
    return response({ error: "Arm request is invalid" }, 400);
  }
  if (
    body === null || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "action,streamId" ||
    Reflect.get(body, "action") !== "arm-provider-retry" ||
    typeof Reflect.get(body, "streamId") !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(
      Reflect.get(body, "streamId") as string,
    )
  ) {
    return response({ error: "Arm request is invalid" }, 400);
  }
  try {
    const armId = await armConfiguredRealBlockSlaProviderRetryOnce({
      streamId: Reflect.get(body, "streamId") as string,
    });
    return response({ armed: true, armId }, 200);
  } catch {
    return response({ error: "Provider retry probe could not be armed" }, 409);
  }
}
