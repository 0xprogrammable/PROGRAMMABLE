import {
  configuredLaunchPermitSignersV2,
  isCustomLaunchPublicEnabled,
} from "@/lib/server/custom-launch/public-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 5;
export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
} as const;
const SIGNER_QUERY_KEYS = [
  "keyId",
  "publicKeySpkiSha256",
  "signerComponentBindingHash",
  "signerEpoch",
] as const;

export function GET(request: Request): Response {
  const url = new URL(request.url);
  if (
    request.method !== "GET"
    || request.body !== null
    || request.headers.get("accept")?.trim().toLowerCase() !== "application/json"
    || request.headers.has("content-type")
    || url.username !== ""
    || url.password !== ""
    || url.hash !== ""
    || [...url.searchParams.keys()].sort().join("\0")
      !== [...SIGNER_QUERY_KEYS].sort().join("\0")
    || SIGNER_QUERY_KEYS.some((key) => url.searchParams.getAll(key).length !== 1)
  ) {
    return Response.json({
      schemaVersion: "programmable.custom-launch-website-error.v2",
      code: "invalid_trusted_time_request",
      message: "invalid_trusted_time_request",
    }, { status: 400, headers: RESPONSE_HEADERS });
  }
  if (!isCustomLaunchPublicEnabled()) {
    return Response.json({
      schemaVersion: "programmable.custom-launch-website-error.v2",
      code: "custom_launch_not_public",
      message: "custom_launch_not_public",
    }, { status: 503, headers: RESPONSE_HEADERS });
  }
  const currentSigner = configuredLaunchPermitSignersV2().find((signer) =>
    signer.keyId === url.searchParams.get("keyId")
    && signer.signerEpoch === url.searchParams.get("signerEpoch")
    && signer.signerComponentBindingHash
      === url.searchParams.get("signerComponentBindingHash")
    && signer.publicKeySpkiSha256 === url.searchParams.get("publicKeySpkiSha256"));
  if (!currentSigner) {
    return Response.json({
      schemaVersion: "programmable.custom-launch-website-error.v2",
      code: "launch_permit_signer_not_current",
      message: "launch_permit_signer_not_current",
    }, { status: 409, headers: RESPONSE_HEADERS });
  }
  return Response.json({
    schemaVersion: "programmable.trusted-time.v1",
    now: new Date().toISOString(),
  }, { status: 200, headers: RESPONSE_HEADERS });
}
