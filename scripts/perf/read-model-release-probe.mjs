import { createHmac } from "node:crypto";

const LOGICAL_TO_INDEXED_ROUTE = Object.freeze({
  exploreList: "explore-list",
  tokenDetail: "explore-token",
  tokenChart: "explore-chart",
  creatorProfile: "creator-profile",
  classicProfile: "classic-v3-profile",
  stockProfile: "creator-profile",
  classicLaunchLookup: "launch-lookup",
  stockLaunchLookup: "launch-lookup",
});

const RELEASE_PROBE_SIGNATURE_VERSION = "programmable-release-probe-v1";
const RELEASE_PROBE_NONCE =
  /^(?<issuedAt>[1-9]\d{12})-(?<capture>[0-9a-f]{64})-(?<sequence>0|[1-9]\d{0,9})$/u;
const RELEASE_PROBE_SECRET = /^[A-Za-z0-9._~+/=-]{32,512}$/u;

export function indexedRouteForPerformanceRoute(route) {
  const indexedRoute = LOGICAL_TO_INDEXED_ROUTE[route];
  if (!indexedRoute) {
    throw new Error(`route ${String(route)} has no indexed release-probe binding`);
  }
  return indexedRoute;
}

export function signReadModelReleaseProbe(input) {
  const route = indexedRouteForPerformanceRoute(input.route);
  if (!RELEASE_PROBE_NONCE.test(input.nonce)) {
    throw new Error("release probe nonce is invalid");
  }
  if (
    typeof input.secret !== "string" ||
    !RELEASE_PROBE_SECRET.test(input.secret)
  ) {
    throw new Error("release probe secret is invalid");
  }
  return createHmac("sha256", input.secret)
    .update(`${RELEASE_PROBE_SIGNATURE_VERSION}\n${route}\n${input.nonce}`, "utf8")
    .digest("hex");
}

export function buildReadModelReleaseProbe(input) {
  if (
    !Number.isSafeInteger(input.issuedAtMs) ||
    input.issuedAtMs < 1_000_000_000_000 ||
    input.issuedAtMs > 9_999_999_999_999 ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 0 ||
    input.sequence > 9_999_999_999 ||
    typeof input.captureNonce !== "string" ||
    !/^0x[0-9a-f]{64}$/u.test(input.captureNonce)
  ) {
    throw new Error("release probe identity is invalid");
  }
  const nonce = `${input.issuedAtMs}-${input.captureNonce.slice(2)}-${input.sequence}`;
  return Object.freeze({
    nonce,
    signature: signReadModelReleaseProbe({
      route: input.route,
      nonce,
      secret: input.secret,
    }),
  });
}
