import "server-only";

import { parseStrictJson } from "../projection-target/canonical-json";

const MAXIMUM_ERROR_BODY_BYTES = 16_384;
const PRESERVED_STATUSES = new Set([400, 409, 429]);
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/u;
const ERROR_CODE = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const RETRY_AFTER_SECONDS = /^[1-9][0-9]{0,4}$/u;

export class PreservedBackendPublicErrorV1 extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
    readonly requestId: string | null,
    readonly retryAfter: string | null,
  ) {
    super(code);
    this.name = "PreservedBackendPublicErrorV1";
  }
}

export async function readPreservedBackendPublicErrorV1(
  response: Response,
): Promise<PreservedBackendPublicErrorV1 | null> {
  if (!PRESERVED_STATUSES.has(response.status)) return null;

  try {
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (
      Number.isFinite(declaredLength)
      && declaredLength > MAXIMUM_ERROR_BODY_BYTES
    ) return null;
    const text = await response.text();
    if (!text || Buffer.byteLength(text, "utf8") > MAXIMUM_ERROR_BODY_BYTES) {
      return null;
    }
    const value = parseStrictJson(text, {
      maximumBytes: MAXIMUM_ERROR_BODY_BYTES,
      maximumDepth: 8,
    });
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      return null;
    }
    if (
      value.schemaVersion !== "programmable.api-error.v1"
      && value.schemaVersion !== "programmable.custom-launch-api.v1"
      && value.schemaVersion !== "programmable.custom-launch-list.v1"
    ) return null;
    const error = value.error;
    if (error === null || Array.isArray(error) || typeof error !== "object") {
      return null;
    }
    if (
      typeof error.code !== "string"
      || !ERROR_CODE.test(error.code)
      || typeof error.message !== "string"
      || error.message.length < 1
      || error.message.length > 512
      || /[\u0000-\u001f\u007f]/u.test(error.message)
    ) return null;

    const bodyRequestId = error.requestId;
    const headerRequestId = response.headers.get("x-request-id");
    const requestId = typeof bodyRequestId === "string"
      ? bodyRequestId
      : headerRequestId;
    if (requestId !== null && !REQUEST_ID.test(requestId)) return null;

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfter = response.status === 429 && retryAfterHeader !== null
      && RETRY_AFTER_SECONDS.test(retryAfterHeader)
      && Number(retryAfterHeader) <= 86_400
      ? retryAfterHeader
      : null;

    return new PreservedBackendPublicErrorV1(
      response.status,
      error.code,
      error.message,
      requestId,
      retryAfter,
    );
  } catch {
    return null;
  }
}
