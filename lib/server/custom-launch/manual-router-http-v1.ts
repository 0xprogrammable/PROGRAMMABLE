import "server-only";

import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "@/lib/server/projection-target/canonical-json";
import { isManualRouterApplicantLaunchEnabledV1 } from
  "@/lib/server/custom-launch/manual-router-config-v1";
import { ManualRouterApplicantAuthenticationErrorV1 } from
  "@/lib/server/custom-launch/manual-router-auth-v1";
import { ManualRouterServiceErrorV1 } from
  "@/lib/server/custom-launch/manual-router-service-v1";
import { ManualRouterBlobCasConflictV1 } from
  "@/lib/server/custom-launch/manual-router-store-v1";

export const MAXIMUM_MANUAL_ROUTER_HTTP_BODY_BYTES_V1 = 1_048_576 as const;

export class ManualRouterHttpErrorV1 extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "ManualRouterHttpErrorV1";
  }
}

export async function readManualRouterStrictJsonRequestV1(
  request: Request,
): Promise<JsonValue> {
  if (request.method !== "POST") {
    throw new ManualRouterHttpErrorV1(405, "method_not_allowed", false);
  }
  const url = new URL(request.url);
  if (
    url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || request.headers.get("content-type")?.trim().toLowerCase()
      !== "application/json"
    || request.headers.get("accept")?.trim().toLowerCase()
      !== "application/json"
  ) throw new ManualRouterHttpErrorV1(400, "invalid_request", false);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isSafeInteger(declaredLength)
    || declaredLength < 0
    || declaredLength > MAXIMUM_MANUAL_ROUTER_HTTP_BODY_BYTES_V1
  ) throw new ManualRouterHttpErrorV1(413, "request_too_large", false);
  let source: string;
  try {
    source = await request.text();
  } catch {
    throw new ManualRouterHttpErrorV1(400, "invalid_request", false);
  }
  try {
    return parseStrictJson(source, {
      maximumBytes: MAXIMUM_MANUAL_ROUTER_HTTP_BODY_BYTES_V1,
      maximumDepth: 128,
    });
  } catch {
    throw new ManualRouterHttpErrorV1(400, "invalid_request", false);
  }
}

export function assertManualRouterLaneEnabledV1(): void {
  if (!isManualRouterApplicantLaunchEnabledV1()) {
    throw new ManualRouterHttpErrorV1(
      503,
      "manual_launch_not_enabled",
      false,
    );
  }
}

export function manualRouterJsonResponseV1(
  status: number,
  body: Readonly<Record<string, unknown>>,
  allow?: string,
): Response {
  const headers = new Headers({
    "cache-control": "no-store, max-age=0",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  if (allow !== undefined) headers.set("allow", allow);
  return new Response(canonicalizeJson(body), { status, headers });
}

export function manualRouterErrorResponseV1(error: unknown): Response {
  const normalized = normalizeManualRouterHttpErrorV1(error);
  return manualRouterJsonResponseV1(normalized.status, {
    schemaVersion: "programmable.manual-router-website-error.v1",
    code: normalized.code,
    message: normalized.code,
    retryable: normalized.retryable,
  }, normalized.status === 405 ? "POST" : undefined);
}

export function normalizeManualRouterHttpErrorV1(
  error: unknown,
): ManualRouterHttpErrorV1 {
  if (error instanceof ManualRouterHttpErrorV1) return error;
  if (
    error instanceof ManualRouterServiceErrorV1
    || error instanceof ManualRouterApplicantAuthenticationErrorV1
  ) return new ManualRouterHttpErrorV1(
    error.status,
    error.code,
    error instanceof ManualRouterServiceErrorV1 ? error.retryable : false,
  );
  if (error instanceof ManualRouterBlobCasConflictV1) {
    return new ManualRouterHttpErrorV1(409, "state_conflict", false);
  }
  return new ManualRouterHttpErrorV1(503, "storage_unavailable", true);
}

export function exactManualRouterObjectV1(
  raw: unknown,
  expected: readonly string[],
  label: string,
): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ManualRouterHttpErrorV1(400, "invalid_request", false);
  }
  const keys = Reflect.ownKeys(raw);
  const strings = keys.filter((key): key is string => typeof key === "string")
    .sort();
  const wanted = [...expected].sort();
  if (
    keys.length !== strings.length
    || strings.length !== wanted.length
    || strings.some((key, index) => key !== wanted[index])
  ) {
    void label;
    throw new ManualRouterHttpErrorV1(400, "invalid_request", false);
  }
  return raw as Record<string, unknown>;
}
