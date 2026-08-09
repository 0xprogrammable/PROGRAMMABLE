import "server-only";

import { timingSafeEqual } from "node:crypto";

export function isManualRouterFinalityCronAuthorizedV1(
  request: Request,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const url = new URL(request.url);
  const secret = environment.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (
    request.method !== "GET"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || typeof secret !== "string"
    || Buffer.byteLength(secret, "utf8") < 32
    || Buffer.byteLength(secret, "utf8") > 1_024
    || !authorization?.startsWith("Bearer ")
  ) return false;
  const provided = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return provided.length === expected.length
    && timingSafeEqual(provided, expected);
}
