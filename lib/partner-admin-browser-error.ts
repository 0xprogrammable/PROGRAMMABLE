const ERROR_CODE = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/u;
const RETRY_AFTER_SECONDS = /^[1-9][0-9]{0,4}$/u;

export class PartnerAdminBrowserErrorV1 extends Error {
  readonly accessDenied: boolean;

  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly requestId: string | null,
    readonly retryAfter: string | null,
    message: string,
  ) {
    super(message);
    this.name = "PartnerAdminBrowserErrorV1";
    this.accessDenied = status === 403 && code === "PARTNER_ADMIN_FORBIDDEN";
  }
}

export function partnerAdminBrowserErrorV1(
  response: Response,
  value: unknown,
  fallback: string,
) {
  const error = readError(value);
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfter = retryAfterHeader !== null
    && RETRY_AFTER_SECONDS.test(retryAfterHeader)
    && Number(retryAfterHeader) <= 86_400
    ? retryAfterHeader
    : null;
  const headerRequestId = response.headers.get("x-request-id");
  const requestId = error?.requestId
    ?? (headerRequestId !== null && REQUEST_ID.test(headerRequestId)
      ? headerRequestId
      : null);
  const code = error?.code ?? null;

  if (response.status === 403 && code === "PARTNER_ADMIN_FORBIDDEN") {
    return new PartnerAdminBrowserErrorV1(
      response.status,
      code,
      requestId,
      null,
      "This wallet is signed in but does not have partner administration access.",
    );
  }

  const message = error?.message ?? fallback;
  return new PartnerAdminBrowserErrorV1(
    response.status,
    code,
    requestId,
    retryAfter,
    `${message}${retryAfter ? ` Try again in ${retryAfter} seconds.` : ""}${
      requestId ? ` Request ID: ${requestId}.` : ""
    }`,
  );
}

function readError(value: unknown) {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const code = value.error.code;
  const message = value.error.message;
  const requestId = value.error.requestId;
  if (
    typeof code !== "string"
    || !ERROR_CODE.test(code)
    || typeof message !== "string"
    || message.length < 1
    || message.length > 512
    || /[\u0000-\u001f\u007f]/u.test(message)
    || (requestId !== undefined
      && (typeof requestId !== "string" || !REQUEST_ID.test(requestId)))
  ) return null;
  return Object.freeze({
    code,
    message,
    requestId: typeof requestId === "string" ? requestId : null,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
