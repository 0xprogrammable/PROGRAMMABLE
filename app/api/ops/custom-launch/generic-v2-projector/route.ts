import { timingSafeEqual } from "node:crypto";

import { parseStrictJson } from
  "@/lib/server/projection-target/canonical-json";
import {
  parseGenericProjectorApprovalId,
  projectProductionGenericLaunchV2,
} from "@/lib/server/custom-launch/generic-launch-production-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

const MAXIMUM_BODY_BYTES = 4_096;

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request.headers)) return response(401, "unauthorized");
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAXIMUM_BODY_BYTES) {
      return response(400, "invalid_request");
    }
    const parsed = parseStrictJson(text, {
      maximumBytes: MAXIMUM_BODY_BYTES,
      maximumDepth: 2,
    });
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return response(400, "invalid_request");
    }
    const body = parsed as Readonly<Record<string, unknown>>;
    if (Object.keys(body).join(",") !== "approvalId") {
      return response(400, "invalid_request");
    }
    const result = await projectProductionGenericLaunchV2({
      approvalId: parseGenericProjectorApprovalId(body.approvalId),
      signal: request.signal,
    });
    return Response.json({
      schemaVersion: "programmable.generic-launch-projector-result.v2",
      status: "ok",
      ...result,
    }, { status: 200, headers: headers() });
  } catch {
    return response(503, "projection_unavailable");
  }
}

function authorized(headersValue: Headers): boolean {
  const expectedValue = process.env.PROGRAMMABLE_GENERIC_LAUNCH_PROJECTOR_TOKEN;
  const authorization = headersValue.get("authorization");
  if (!expectedValue || expectedValue.length < 32 || expectedValue.length > 4096
    || !authorization?.startsWith("Bearer ")) return false;
  const expected = Buffer.from(expectedValue, "utf8");
  const actual = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function response(status: number, code: string): Response {
  return Response.json({
    schemaVersion: "programmable.generic-launch-projector-error.v2",
    status: "error",
    code,
  }, { status, headers: headers() });
}

function headers(): HeadersInit {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  };
}
