import type { CustomLaunchWebsiteSessionV2 } from "./contract-v2";

const START_PATH = "/api/custom-launch/github-app/authorization" as const;
const CALLBACK_URL =
  "https://programmable.market/api/custom-launch/github-app/callback" as const;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const GITHUB_CLIENT_ID = /^(?:Iv1\.[0-9a-f]{16}|[A-Za-z0-9_-]{8,128})$/u;

export async function requestGitHubLaunchAppAuthorizationV1(input: Readonly<{
  session: CustomLaunchWebsiteSessionV2;
  fetch?: typeof fetch;
}>): Promise<URL> {
  const fetchV1 = input.fetch ?? globalThis.fetch.bind(globalThis);
  if (!input.session.accessToken.trim() || !input.session.identityToken.trim()) {
    throw new TypeError("Current GitHub session is unavailable");
  }
  const response = await fetchV1(START_PATH, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.session.accessToken}`,
      "x-privy-identity-token": input.session.identityToken,
    },
  });
  if (
    response.status !== 200
    || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
      !== "application/json"
  ) throw new TypeError("GitHub launch authorization is unavailable");
  const value = await response.json() as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("GitHub launch authorization response is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("\0") !== ["authorizationUrl", "schemaVersion"].sort().join("\0")
    || record.schemaVersion !== "programmable.website-github-app-authorization-start.v1"
    || typeof record.authorizationUrl !== "string"
  ) throw new TypeError("GitHub launch authorization response is invalid");
  const authorization = new URL(record.authorizationUrl);
  const entries = [...authorization.searchParams.entries()];
  if (
    authorization.origin !== "https://github.com"
    || authorization.pathname !== "/login/oauth/authorize"
    || authorization.hash !== ""
    || entries.length !== 5
    || entries[0]?.[0] !== "client_id"
    || !GITHUB_CLIENT_ID.test(entries[0][1])
    || entries[1]?.[0] !== "redirect_uri"
    || entries[1][1] !== CALLBACK_URL
    || entries[2]?.[0] !== "state"
    || !BASE64URL.test(entries[2][1])
    || entries[3]?.[0] !== "code_challenge"
    || !BASE64URL.test(entries[3][1])
    || entries[4]?.[0] !== "code_challenge_method"
    || entries[4][1] !== "S256"
  ) throw new TypeError("GitHub launch authorization URL is invalid");
  return authorization;
}
