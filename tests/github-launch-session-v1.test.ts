import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify,
} from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createWebsiteGitHubAppAuthorizationCallbackHandlerV1,
  createWebsiteGitHubAppAuthorizationStartHandlerV1,
  createWebsiteGitHubLaunchSessionCredentialIssuerV1,
  isProductionWebsiteGitHubLaunchSessionConfiguredV1,
  productionWebsiteGitHubLaunchSessionBindingV1,
  type WebsiteGitHubLaunchSessionConfigurationV1,
} from "../lib/server/custom-launch/github-launch-session-v1";
import { canonicalSha256 } from "../lib/server/projection-target/hashing";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const GITHUB_USER_ID = "123456789";
const GITHUB_TOKEN = `ghu_${"a".repeat(40)}`;
const EXPIRES_AT = new Date(NOW.getTime() + 8 * 60 * 60 * 1_000).toISOString();

function fixture(): Readonly<{
  configuration: WebsiteGitHubLaunchSessionConfigurationV1;
  publicKey: ReturnType<typeof createPublicKey>;
  privateKeyPem: string;
}> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const signerPublicKeySpkiSha256 = `sha256:${createHashHex(
    publicKey.export({ type: "spki", format: "der" }),
  )}` as const;
  const websiteReleaseBindingHash = canonicalSha256(
    "programmable.website-github-launch-session-release-binding.v1",
    {
      approvalServiceOrigin: "https://approval.example",
      approvalServicePackageArtifactHash: `sha256:${"2".repeat(64)}`,
      audience: "programmable.website-github-launch-session-credential.v1",
      githubAppClientId: "Iv1.0123456789abcdef",
      issuer: "https://programmable.market",
      privyAppId: "privy-app",
      signerKeyId: "website-session-1",
      signerPublicKeySpkiSha256,
      sourceCommit: "1".repeat(40),
    },
  );
  return Object.freeze({
    publicKey,
    privateKeyPem,
    configuration: Object.freeze({
      sourceCommit: "1".repeat(40),
      privyAppId: "privy-app",
      approvalServiceOrigin: "https://approval.example",
      approvalServicePackageArtifactHash: `sha256:${"2".repeat(64)}`,
      githubAppClientId: "Iv1.0123456789abcdef",
      githubAppClientSecret: "github-client-secret-value",
      signerKeyId: "website-session-1",
      signerPrivateKey: privateKey,
      signerPublicKeySpkiSha256,
      cookieSealKey: Buffer.alloc(32, 7),
      websiteReleaseBindingHash,
    }),
  });
}

function createHashHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function principal(privySessionId = "privy-session-1") {
  return Object.freeze({
    privyUserId: "did:privy:user",
    privySessionId,
    githubUserId: GITHUB_USER_ID,
    githubUsername: "builder",
    githubPrincipalHash: `sha256:${"4".repeat(64)}` as const,
  });
}

function deterministicRandom() {
  let generation = 0;
  return (size: number): Buffer => Buffer.alloc(size, generation += 1);
}

function json(value: object): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function cookiePair(response: Response, name: string): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const source = headers.getSetCookie?.().join(", ") ?? headers.get("set-cookie") ?? "";
  const match = new RegExp(`(?:^|, )(${name}=[^;]+)`, "u").exec(source);
  if (match?.[1] === undefined) throw new TypeError(`${name} cookie is missing`);
  return match[1];
}

function inspectResponse() {
  return json({
    token: GITHUB_TOKEN,
    scopes: [],
    expires_at: EXPIRES_AT,
    app: { client_id: "Iv1.0123456789abcdef" },
    user: { id: Number(GITHUB_USER_ID) },
  });
}

describe("Website GitHub launch session V1", () => {
  it("completes PKCE handoff and issues the exact release-bound Website assertion", async () => {
    const { configuration, publicKey } = fixture();
    const start = createWebsiteGitHubAppAuthorizationStartHandlerV1({
      authenticator: { authenticate: async () => principal() },
      configuration,
      now: () => NOW,
      random: deterministicRandom(),
    });
    const startResponse = await start(new Request(
      "https://programmable.market/api/custom-launch/github-app/authorization",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer privy-access-token-value",
          "x-privy-identity-token": "privy-identity-token-value",
        },
      },
    ));
    expect(startResponse.status).toBe(200);
    expect(startResponse.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(startResponse.headers.get("set-cookie")).toContain("HttpOnly");
    const startBody = await startResponse.json() as { authorizationUrl: string };
    const authorization = new URL(startBody.authorizationUrl);
    expect(authorization.origin).toBe("https://github.com");
    expect(authorization.searchParams.has("scope")).toBe(false);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");

    const stateCookie = cookiePair(
      startResponse,
      "__Host-programmable-github-launch-oauth",
    );
    const githubFetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      if (String(input) === "https://github.com/login/oauth/access_token") {
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("code_verifier=");
        return json({
          access_token: GITHUB_TOKEN,
          expires_in: 28_800,
          refresh_token: `ghr_${"b".repeat(40)}`,
          refresh_token_expires_in: 15_897_600,
          scope: "",
          token_type: "bearer",
        });
      }
      expect(String(input)).toBe(
        "https://api.github.com/applications/Iv1.0123456789abcdef/token",
      );
      return inspectResponse();
    });
    const callback = createWebsiteGitHubAppAuthorizationCallbackHandlerV1({
      configuration,
      githubFetch: githubFetch as typeof fetch,
      now: () => NOW,
      random: deterministicRandom(),
    });
    const callbackUrl = new URL(
      "https://programmable.market/api/custom-launch/github-app/callback",
    );
    callbackUrl.searchParams.set("code", `code_${"c".repeat(32)}`);
    callbackUrl.searchParams.set("state", authorization.searchParams.get("state")!);
    const callbackResponse = await callback(new Request(callbackUrl, {
      headers: { cookie: stateCookie },
    }));
    expect(callbackResponse.status).toBe(303);
    expect(callbackResponse.headers.get("location")).toBe(
      "https://programmable.market/launch",
    );
    const handoffCookie = cookiePair(
      callbackResponse,
      "__Host-programmable-github-launch-session",
    );
    expect(handoffCookie).not.toContain(GITHUB_TOKEN);

    const inspectFetch = vi.fn(async () => inspectResponse());
    const issuer = createWebsiteGitHubLaunchSessionCredentialIssuerV1({
      configuration,
      githubFetch: inspectFetch as typeof fetch,
      now: () => NOW,
      randomId: () => "123e4567-e89b-42d3-a456-426614174000",
    });
    const request = new Request(
      "https://programmable.market/api/custom-launch/v2/launch-sessions/challenges",
      { headers: { cookie: handoffCookie } },
    );
    const credential = await issuer.issueCredential({
      request,
      principal: principal(),
    });
    const segments = credential.split(".");
    expect(segments).toHaveLength(3);
    expect(verify(
      null,
      Buffer.from(`${segments[0]}.${segments[1]}`, "ascii"),
      publicKey,
      Buffer.from(segments[2]!, "base64url"),
    )).toBe(true);
    expect(JSON.parse(Buffer.from(segments[0]!, "base64url").toString("utf8"))).toEqual({
      alg: "EdDSA",
      kid: "website-session-1",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf8"))).toEqual({
      aud: "programmable.website-github-launch-session-credential.v1",
      exp: Math.floor(NOW.getTime() / 1_000) + 30,
      githubAppClientId: "Iv1.0123456789abcdef",
      githubAppUserToken: GITHUB_TOKEN,
      githubUserId: GITHUB_USER_ID,
      iat: Math.floor(NOW.getTime() / 1_000),
      iss: "https://programmable.market",
      jti: "123e4567-e89b-42d3-a456-426614174000",
      revocationCheckedAt: Math.floor(NOW.getTime() / 1_000),
      schemaVersion: "programmable.website-github-launch-session-credential.v1",
      sessionId: "privy-session-1",
      sessionState: "active",
      sub: "did:privy:user",
      websiteReleaseBindingHash: configuration.websiteReleaseBindingHash,
    });
    expect(inspectFetch).toHaveBeenCalledOnce();

    await expect(issuer.issueCredential({
      request,
      principal: principal("substituted-session"),
    })).rejects.toMatchObject({ code: "github_app_authorization_required" });
    expect(inspectFetch).toHaveBeenCalledOnce();
  });

  it("derives the release binding from exact source, Privy, backend and signer facts", () => {
    const { privateKeyPem } = fixture();
    const environment = {
      PROGRAMMABLE_RELEASE_COMMIT_SHA: "1".repeat(40),
      VERCEL_GIT_COMMIT_SHA: "1".repeat(40),
      NEXT_PUBLIC_PRIVY_APP_ID: "privy-app",
      PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN: "https://approval.example",
      PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH:
        `sha256:${"2".repeat(64)}`,
      PROGRAMMABLE_GITHUB_LAUNCH_APP_CLIENT_ID: "Iv1.0123456789abcdef",
      PROGRAMMABLE_GITHUB_LAUNCH_APP_CLIENT_SECRET: "github-client-secret-value",
      PROGRAMMABLE_WEBSITE_GITHUB_LAUNCH_SESSION_SIGNER_KEY_ID: "website-session-1",
      PROGRAMMABLE_WEBSITE_GITHUB_LAUNCH_SESSION_SIGNER_PRIVATE_KEY_PEM: privateKeyPem,
      PROGRAMMABLE_WEBSITE_GITHUB_LAUNCH_COOKIE_SEAL_KEY_BASE64URL:
        Buffer.alloc(32, 7).toString("base64url"),
    };
    expect(isProductionWebsiteGitHubLaunchSessionConfiguredV1(environment)).toBe(true);
    const binding = productionWebsiteGitHubLaunchSessionBindingV1(environment);
    const changed = productionWebsiteGitHubLaunchSessionBindingV1({
      ...environment,
      NEXT_PUBLIC_PRIVY_APP_ID: "privy-app-replacement",
    });
    expect(binding.websiteReleaseBindingHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(binding.signerPublicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(changed.websiteReleaseBindingHash).not.toBe(binding.websiteReleaseBindingHash);
    expect(isProductionWebsiteGitHubLaunchSessionConfiguredV1({
      ...environment,
      VERCEL_GIT_COMMIT_SHA: "9".repeat(40),
    })).toBe(false);
  });
});
