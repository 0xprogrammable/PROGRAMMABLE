import "server-only";

import {
  createPrivyGitHubPrincipalAuthenticatorV1,
  GitHubPrincipalAuthenticationErrorV1,
  type WebsiteEntitlementReadAuthenticatorV1,
} from "../projection-target/github-entitlement";
import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "../projection-target/canonical-json";
import { isCustomLaunchPublicEnabled } from "./public-readiness";
import { assertApprovalServiceReadiness } from "./deployment-readiness";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{15,511}$/u;
const LIST_CURSOR = /^[A-Za-z0-9_-]{16,512}$/u;
const APPLICATION_HANDLE = /^github-[0-9a-f]{64}$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MAXIMUM_BODY_BYTES = 1_048_576;
const MAXIMUM_RESPONSE_BYTES = 1_048_576;
const UPSTREAM_TIMEOUT_MS = 12_000;

export type CustomLaunchBridgeOperationV2 =
  | Readonly<{ kind: "application-list" }>
  | Readonly<{ kind: "application-status"; applicationHandle: string }>
  | Readonly<{ kind: "launch-eligibility"; applicationHandle: string }>
  | Readonly<{ kind: "launch-authority-refresh"; applicationHandle: string }>
  | Readonly<{ kind: "launch-descriptor"; applicationHandle: string }>
  | Readonly<{ kind: "launch-presentation-read"; applicationHandle: string }>
  | Readonly<{ kind: "launch-presentation-commit"; applicationHandle: string }>
  | Readonly<{ kind: "launch-execution-status"; applicationHandle: string }>
  | Readonly<{ kind: "challenge-create" }>
  | Readonly<{ kind: "preparation-bind"; challengeId: string }>
  | Readonly<{ kind: "wallet-authenticate"; challengeId: string }>
  | Readonly<{ kind: "launch-authorize"; sessionId: string }>
  | Readonly<{ kind: "execution-prepare"; sessionId: string }>
  | Readonly<{ kind: "grant-reissue"; oldGrantId: string }>
  | Readonly<{ kind: "transaction-report"; executionReservationId: string }>;

export interface CustomLaunchBridgeDependenciesV2 {
  readonly authenticator: WebsiteEntitlementReadAuthenticatorV1;
  readonly serviceOrigin: URL;
  readonly serviceFetch: typeof fetch;
  readonly expectedPackageArtifactHash: `sha256:${string}`;
}

export function createCustomLaunchBridgeHandlerV2(
  dependencies: CustomLaunchBridgeDependenciesV2,
): (request: Request, operation: CustomLaunchBridgeOperationV2) => Promise<Response> {
  const origin = exactServiceOrigin(dependencies.serviceOrigin);
  if (
    typeof dependencies.authenticator?.authenticate !== "function"
    || typeof dependencies.serviceFetch !== "function"
    || !SHA256_DIGEST.test(dependencies.expectedPackageArtifactHash)
  ) throw new TypeError("custom launch bridge dependencies are invalid");

  return async function customLaunchBridge(
    request: Request,
    operation: CustomLaunchBridgeOperationV2,
  ): Promise<Response> {
    let resolved: ReturnType<typeof resolveOperation>;
    try {
      resolved = resolveOperation(operation);
    } catch {
      return errorResponse(400, "invalid_route_parameter");
    }
    const url = new URL(request.url);
    if (operation.kind === "application-list") {
      try {
        resolved = {
          ...resolved,
          servicePath: `/v3/applications${canonicalApplicationListQuery(url)}`,
        };
      } catch {
        return errorResponse(400, "invalid_application_list_query");
      }
    }
    if (operation.kind === "launch-execution-status") {
      try {
        resolved = {
          ...resolved,
          servicePath: `${resolved.servicePath}${canonicalLaunchExecutionStatusQuery(url)}`,
        };
      } catch {
        return errorResponse(400, "invalid_launch_execution_status_query");
      }
    }
    if (
      request.method !== resolved.method
      || url.username !== ""
      || url.password !== ""
      || (operation.kind !== "application-list"
        && operation.kind !== "launch-execution-status"
        && url.search !== "")
      || url.hash !== ""
      || request.headers.get("accept")?.trim().toLowerCase() !== "application/json"
    ) return errorResponse(400, "invalid_request");

    try {
      await dependencies.authenticator.authenticate(request);
    } catch (error) {
      if (error instanceof GitHubPrincipalAuthenticationErrorV1) {
        return errorResponse(error.status, error.code);
      }
      return errorResponse(401, "privy_session_rejected");
    }

    const authorization = request.headers.get("authorization");
    if (authorization === null) return errorResponse(401, "session_required");

    let body: Uint8Array | undefined;
    let idempotencyKey: string | undefined;
    if (resolved.method === "POST" || resolved.method === "PUT") {
      const contentType = request.headers.get("content-type")
        ?.split(";", 1)[0]?.trim().toLowerCase();
      idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
      const declaredLength = request.headers.get("content-length");
      if (
        contentType !== "application/json"
        || idempotencyKey === undefined
        || !IDEMPOTENCY_KEY.test(idempotencyKey)
        || (declaredLength !== null && (!/^\d+$/u.test(declaredLength)
          || Number(declaredLength) > MAXIMUM_BODY_BYTES))
      ) return errorResponse(400, "invalid_write_request");
      try {
        body = await readBoundedBody(request, MAXIMUM_BODY_BYTES);
      } catch {
        return errorResponse(413, "request_too_large");
      }
      if (body.byteLength < 2) return errorResponse(400, "invalid_write_request");
    } else if (
      request.headers.has("idempotency-key")
      || request.headers.has("content-type")
      || request.headers.has("content-length")
    ) return errorResponse(400, "invalid_read_request");

    try {
      await assertApprovalServiceReadiness(origin, {
        packageArtifactHash: dependencies.expectedPackageArtifactHash,
        reviewAuthorityMode: "manual_review",
      }, dependencies.serviceFetch);
    } catch {
      return errorResponse(503, "launch_service_release_unverified");
    }

    const controller = new AbortController();
    const abortRequest = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", abortRequest, { once: true });
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const endpoint = new URL(resolved.servicePath, origin);
      const upstream = await dependencies.serviceFetch(endpoint, {
        method: resolved.method,
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization,
          ...(body === undefined ? {} : {
            "content-type": "application/json",
            "content-length": String(body.byteLength),
            "idempotency-key": idempotencyKey!,
          }),
        },
        ...(body === undefined ? {} : {
          body: Uint8Array.from(body).buffer as ArrayBuffer,
        }),
      });
      const contentType = upstream.headers.get("content-type")
        ?.split(";", 1)[0]?.trim().toLowerCase();
      const declaredLength = upstream.headers.get("content-length");
      if (
        contentType !== "application/json"
        || (declaredLength !== null && (!/^\d+$/u.test(declaredLength)
          || Number(declaredLength) > MAXIMUM_RESPONSE_BYTES))
      ) {
        await upstream.body?.cancel();
        return errorResponse(502, "launch_service_response_invalid");
      }
      let bytes: Uint8Array;
      try {
        bytes = await readBoundedBody(upstream, MAXIMUM_RESPONSE_BYTES);
      } catch {
        return errorResponse(502, "launch_service_response_invalid");
      }
      if (bytes.byteLength < 2) {
        return errorResponse(502, "launch_service_response_invalid");
      }
      let envelope: ReturnType<typeof serviceEnvelope>;
      try {
        envelope = serviceEnvelope(bytes, upstream.ok);
      } catch {
        return errorResponse(502, "launch_service_response_invalid");
      }
      if (!envelope.ok) {
        return errorResponse(
          upstream.status,
          envelope.code,
          envelope.message,
          upstream.headers,
        );
      }
      return new Response(canonicalizeJson(envelope.data), {
        status: upstream.status,
        headers: responseHeaders(upstream.headers),
      });
    } catch {
      return errorResponse(503, "launch_service_unavailable");
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abortRequest);
    }
  };
}

function canonicalApplicationListQuery(url: URL): string {
  const entries = [...url.searchParams.entries()];
  if (
    entries.length < 1
    || entries.length > 2
    || entries[0]?.[0] !== "limit"
    || (entries.length === 2 && entries[1]?.[0] !== "cursor")
  ) throw new TypeError("application list query is invalid");
  const limitValue = entries[0]![1];
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(limitValue)) {
    throw new TypeError("application list limit is invalid");
  }
  const cursor = entries[1]?.[1];
  if (cursor !== undefined && !LIST_CURSOR.test(cursor)) {
    throw new TypeError("application list cursor is invalid");
  }
  const canonical = `?limit=${limitValue}${cursor === undefined
    ? ""
    : `&cursor=${encodeURIComponent(cursor)}`}`;
  if (url.search !== canonical) throw new TypeError("application list query is not canonical");
  return canonical;
}

function canonicalLaunchExecutionStatusQuery(url: URL): string {
  const entries = [...url.searchParams.entries()];
  if (
    entries.length !== 2
    || entries[0]?.[0] !== "grantId"
    || entries[1]?.[0] !== "sessionId"
  ) throw new TypeError("launch execution status query is invalid");
  const grantId = uuid(entries[0][1]);
  const sessionId = uuid(entries[1][1]);
  const canonical = `?grantId=${grantId}&sessionId=${sessionId}`;
  if (url.search !== canonical) {
    throw new TypeError("launch execution status query is not canonical");
  }
  return canonical;
}

async function readBoundedBody(
  message: Request | Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (message.body === null) throw new TypeError("body is required");
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) throw new TypeError("body is too large");
      chunks.push(Uint8Array.from(result.value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

let productionHandler: ReturnType<typeof createCustomLaunchBridgeHandlerV2> | null = null;

export function handleProductionCustomLaunchBridgeV2(
  request: Request,
  operation: CustomLaunchBridgeOperationV2,
): Promise<Response> {
  if (!isCustomLaunchPublicEnabled()) {
    return Promise.resolve(errorResponse(503, "custom_launch_not_public"));
  }
  try {
    productionHandler ??= createCustomLaunchBridgeHandlerV2({
      authenticator: createPrivyGitHubPrincipalAuthenticatorV1(),
      serviceOrigin: new URL(requiredEnvironment("PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN")),
      serviceFetch: globalThis.fetch.bind(globalThis),
      expectedPackageArtifactHash: requiredEnvironment(
        "PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH",
      ) as `sha256:${string}`,
    });
    return productionHandler(request, operation);
  } catch {
    return Promise.resolve(errorResponse(503, "launch_bridge_not_configured"));
  }
}

function resolveOperation(operation: CustomLaunchBridgeOperationV2): Readonly<{
  method: "GET" | "POST" | "PUT";
  servicePath: string;
}> {
  if (operation.kind === "challenge-create") {
    return { method: "POST", servicePath: "/v2/launch-sessions/challenges" };
  }
  if (operation.kind === "application-list") {
    return { method: "GET", servicePath: "/v3/applications" };
  }
  if (operation.kind === "application-status") {
    return {
      method: "GET",
      servicePath: `/v3/applications/${applicationHandle(operation.applicationHandle)}`,
    };
  }
  if (operation.kind === "launch-eligibility") {
    return {
      method: "GET",
      servicePath: `/v3/applications/${applicationHandle(operation.applicationHandle)}/launch-eligibility`,
    };
  }
  if (operation.kind === "launch-authority-refresh") {
    return {
      method: "POST",
      servicePath: `/v3/applications/${applicationHandle(operation.applicationHandle)}/launch-authority-refresh`,
    };
  }
  if (operation.kind === "launch-descriptor") {
    return {
      method: "GET",
      servicePath: `/v3/applications/${applicationHandle(operation.applicationHandle)}/launch-descriptor`,
    };
  }
  if (
    operation.kind === "launch-presentation-read"
    || operation.kind === "launch-presentation-commit"
  ) {
    return {
      method: operation.kind === "launch-presentation-read" ? "GET" : "PUT",
      servicePath: `/v3/applications/${applicationHandle(
        operation.applicationHandle,
      )}/launch-presentation`,
    };
  }
  if (operation.kind === "launch-execution-status") {
    return {
      method: "GET",
      servicePath: `/v3/applications/${applicationHandle(
        operation.applicationHandle,
      )}/launch-execution-status`,
    };
  }
  if (operation.kind === "preparation-bind") {
    return {
      method: "POST",
      servicePath: `/v2/launch-sessions/challenges/${uuid(operation.challengeId)}/preparation`,
    };
  }
  if (operation.kind === "wallet-authenticate") {
    return {
      method: "POST",
      servicePath: `/v2/launch-sessions/challenges/${uuid(operation.challengeId)}/wallet-authentication`,
    };
  }
  if (operation.kind === "launch-authorize") {
    return {
      method: "POST",
      servicePath: `/v2/launch-sessions/${uuid(operation.sessionId)}/authorization`,
    };
  }
  if (operation.kind === "execution-prepare") {
    return {
      method: "POST",
      servicePath: `/v2/launch-sessions/${uuid(operation.sessionId)}/execution-preparation`,
    };
  }
  if (operation.kind === "grant-reissue") {
    return {
      method: "POST",
      servicePath: `/v2/launch-grants/${uuid(operation.oldGrantId)}/reissue`,
    };
  }
  if (operation.kind === "transaction-report") {
    return {
      method: "POST",
      servicePath: `/v2/launch-preparations/${uuid(
        operation.executionReservationId,
      )}/report`,
    };
  }
  throw new TypeError("custom launch bridge operation is invalid");
}

function exactServiceOrigin(value: URL): URL {
  const origin = new URL(value.toString());
  if (
    origin.protocol !== "https:"
    || origin.username !== ""
    || origin.password !== ""
    || origin.pathname !== "/"
    || origin.search !== ""
    || origin.hash !== ""
  ) throw new TypeError("approval service V2 origin is invalid");
  return origin;
}

function applicationHandle(value: string): string {
  if (!APPLICATION_HANDLE.test(value)) throw new TypeError("application handle is invalid");
  return value;
}

function uuid(value: string): string {
  const normalized = value.toLowerCase();
  if (!UUID.test(normalized)) throw new TypeError("launch session id is invalid");
  return normalized;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

function responseHeaders(upstream: Headers): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    vary: "authorization, x-privy-identity-token",
  });
  const retryAfter = upstream.get("retry-after");
  if (retryAfter !== null && /^\d{1,5}$/u.test(retryAfter)) {
    headers.set("retry-after", retryAfter);
  }
  return headers;
}

function serviceEnvelope(
  bytes: Uint8Array,
  success: boolean,
): Readonly<
  | { ok: true; data: Readonly<Record<string, JsonValue>> }
  | { ok: false; code: string; message: string }
> {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = record(
    parseStrictJson(source, {
      maximumBytes: MAXIMUM_RESPONSE_BYTES,
      maximumDepth: 64,
    }),
    "service envelope",
  );
  const expected = success
    ? ["data", "requestId", "schemaVersion"]
    : ["error", "requestId", "schemaVersion"];
  exactKeys(value, expected, "service envelope");
  if (
    value.schemaVersion !== "2.0.0"
    || typeof value.requestId !== "string"
    || !/^[A-Za-z0-9._:@+-]{1,128}$/u.test(value.requestId)
  ) throw new TypeError("service envelope authority is invalid");
  if (success) {
    const data = record(value.data, "service response data");
    return Object.freeze({ ok: true as const, data });
  }
  const error = record(value.error, "service response error");
  exactKeys(error, ["code", "message"], "service response error");
  if (
    typeof error.code !== "string"
    || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(error.code)
    || typeof error.message !== "string"
    || error.message.length < 1
    || error.message.length > 512
    || /[\u0000-\u001f\u007f]/u.test(error.message)
  ) throw new TypeError("service response error is invalid");
  return Object.freeze({
    ok: false as const,
    code: error.code,
    message: error.message,
  });
}

function record(value: JsonValue | undefined, label: string): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function exactKeys(
  value: Readonly<Record<string, JsonValue>>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (keys.length !== canonical.length || keys.some((key, index) => key !== canonical[index])) {
    throw new TypeError(`${label} is invalid`);
  }
}

function errorResponse(
  status: number,
  code: string,
  message = "Request could not be completed",
  upstream = new Headers(),
): Response {
  return new Response(canonicalizeJson({
    schemaVersion: "programmable.custom-launch-website-error.v2",
    code,
    message,
  }), {
    status,
    headers: responseHeaders(upstream),
  });
}
