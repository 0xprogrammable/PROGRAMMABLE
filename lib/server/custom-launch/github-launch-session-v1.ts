import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";

import {
  createPrivyGitHubPrincipalAuthenticatorV1,
  type AuthenticatedGitHubPrincipalV1,
  type WebsiteEntitlementReadAuthenticatorV1,
} from "../projection-target/github-entitlement";
import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "../projection-target/canonical-json";
import { canonicalSha256, type Sha256Digest } from "../projection-target/hashing";

const WEBSITE_ISSUER = "https://programmable.market" as const;
const WEBSITE_SESSION_AUDIENCE =
  "programmable.website-github-launch-session-credential.v1" as const;
const OAUTH_START_PATH = "/api/custom-launch/github-app/authorization" as const;
const OAUTH_CALLBACK_PATH = "/api/custom-launch/github-app/callback" as const;
const OAUTH_STATE_COOKIE = "__Host-programmable-github-launch-oauth" as const;
const GITHUB_HANDOFF_COOKIE = "__Host-programmable-github-launch-session" as const;
const GITHUB_AUTHORIZE_ENDPOINT = "https://github.com/login/oauth/authorize" as const;
const GITHUB_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token" as const;
const GITHUB_API_VERSION = "2022-11-28" as const;
const WEBSITE_SESSION_LIFETIME_SECONDS = 30;
const OAUTH_STATE_LIFETIME_SECONDS = 10 * 60;
const GITHUB_USER_TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;
const GITHUB_TIMEOUT_MS = 8_000;
const MAXIMUM_GITHUB_RESPONSE_BYTES = 65_536;
const MAXIMUM_COOKIE_BYTES = 4_096;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const GITHUB_CLIENT_ID = /^(?:Iv1\.[0-9a-f]{16}|[A-Za-z0-9_-]{8,128})$/u;
const GITHUB_USER_ID = /^[1-9][0-9]{0,19}$/u;
const GITHUB_APP_USER_TOKEN = /^ghu_[A-Za-z0-9_]{20,16380}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const OAUTH_CODE = /^[A-Za-z0-9_-]{16,1024}$/u;

type Clock = () => Date;
type RandomBytes = (size: number) => Buffer;

export interface WebsiteGitHubLaunchSessionCredentialIssuerV1 {
  issueCredential(input: Readonly<{
    request: Request;
    principal: AuthenticatedGitHubPrincipalV1;
  }>): Promise<string>;
}

export class WebsiteGitHubLaunchSessionErrorV1 extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 503,
    readonly code: string,
  ) {
    super(code);
    this.name = "WebsiteGitHubLaunchSessionErrorV1";
  }
}

export interface WebsiteGitHubLaunchSessionConfigurationV1 {
  readonly sourceCommit: string;
  readonly privyAppId: string;
  readonly approvalServiceOrigin: string;
  readonly approvalServicePackageArtifactHash: Sha256Digest;
  readonly githubAppClientId: string;
  readonly githubAppClientSecret: string;
  readonly signerKeyId: string;
  readonly signerPrivateKey: KeyObject;
  readonly signerPublicKeySpkiSha256: Sha256Digest;
  readonly cookieSealKey: Buffer;
  readonly websiteReleaseBindingHash: Sha256Digest;
}

export function isProductionWebsiteGitHubLaunchSessionConfiguredV1(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  try {
    productionConfiguration(environment);
    return true;
  } catch {
    return false;
  }
}

export function productionWebsiteGitHubLaunchSessionBindingV1(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<{
  schemaVersion: "programmable.website-github-launch-session-binding.v1";
  issuer: typeof WEBSITE_ISSUER;
  audience: typeof WEBSITE_SESSION_AUDIENCE;
  githubAppClientId: string;
  signerKeyId: string;
  signerPublicKeyPem: string;
  signerPublicKeySpkiSha256: Sha256Digest;
  websiteReleaseBindingHash: Sha256Digest;
  sourceCommit: string;
}> {
  const configuration = productionConfiguration(environment);
  return Object.freeze({
    schemaVersion: "programmable.website-github-launch-session-binding.v1",
    issuer: WEBSITE_ISSUER,
    audience: WEBSITE_SESSION_AUDIENCE,
    githubAppClientId: configuration.githubAppClientId,
    signerKeyId: configuration.signerKeyId,
    signerPublicKeyPem: publicKeyFromPrivate(configuration.signerPrivateKey)
      .export({ type: "spki", format: "pem" }).toString(),
    signerPublicKeySpkiSha256: configuration.signerPublicKeySpkiSha256,
    websiteReleaseBindingHash: configuration.websiteReleaseBindingHash,
    sourceCommit: configuration.sourceCommit,
  });
}

export function createProductionWebsiteGitHubLaunchSessionCredentialIssuerV1():
WebsiteGitHubLaunchSessionCredentialIssuerV1 {
  return createWebsiteGitHubLaunchSessionCredentialIssuerV1({
    configuration: productionConfiguration(process.env),
    githubFetch: globalThis.fetch.bind(globalThis),
  });
}

export function createWebsiteGitHubLaunchSessionCredentialIssuerV1(input: Readonly<{
  configuration: WebsiteGitHubLaunchSessionConfigurationV1;
  githubFetch: typeof fetch;
  now?: Clock;
  randomId?: () => string;
}>): WebsiteGitHubLaunchSessionCredentialIssuerV1 {
  const configuration = exactConfiguration(input.configuration);
  if (typeof input.githubFetch !== "function") {
    throw new TypeError("GitHub launch-session fetch is invalid");
  }
  const now = input.now ?? (() => new Date());
  const randomId = input.randomId ?? randomUUID;
  return Object.freeze({
    async issueCredential({ request, principal }: Readonly<{
      request: Request;
      principal: AuthenticatedGitHubPrincipalV1;
    }>) {
      const handoff = openGitHubHandoff(request, configuration, now());
      assertPrincipalBinding(handoff, principal);
      const observation = await inspectGitHubToken({
        configuration,
        token: handoff.githubAppUserToken,
        githubFetch: input.githubFetch,
        signal: request.signal,
        now: now(),
      });
      if (
        observation.githubUserId !== principal.githubUserId
        || observation.expiresAtSeconds !== handoff.expiresAt
      ) {
        throw new WebsiteGitHubLaunchSessionErrorV1(
          401,
          "github_app_authorization_required",
        );
      }
      const issuedAt = seconds(now());
      const expiresAt = issuedAt + WEBSITE_SESSION_LIFETIME_SECONDS;
      if (observation.expiresAtSeconds <= expiresAt) {
        throw new WebsiteGitHubLaunchSessionErrorV1(
          401,
          "github_app_authorization_required",
        );
      }
      const jti = randomId().toLowerCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
        .test(jti)) {
        throw new TypeError("Website session identifier is invalid");
      }
      const header = canonicalizeJson({
        alg: "EdDSA",
        kid: configuration.signerKeyId,
        typ: "JWT",
      });
      const claims = canonicalizeJson({
        aud: WEBSITE_SESSION_AUDIENCE,
        exp: expiresAt,
        githubAppClientId: configuration.githubAppClientId,
        githubAppUserToken: handoff.githubAppUserToken,
        githubUserId: principal.githubUserId,
        iat: issuedAt,
        iss: WEBSITE_ISSUER,
        jti,
        revocationCheckedAt: issuedAt,
        schemaVersion: "programmable.website-github-launch-session-credential.v1",
        sessionId: principalSessionId(principal),
        sessionState: "active",
        sub: principal.privyUserId,
        websiteReleaseBindingHash: configuration.websiteReleaseBindingHash,
      });
      const signingInput = `${Buffer.from(header).toString("base64url")}.${
        Buffer.from(claims).toString("base64url")}`;
      const signature = sign(
        null,
        Buffer.from(signingInput, "ascii"),
        configuration.signerPrivateKey,
      );
      if (signature.byteLength !== 64) {
        throw new WebsiteGitHubLaunchSessionErrorV1(
          503,
          "github_launch_session_signer_unavailable",
        );
      }
      return `${signingInput}.${signature.toString("base64url")}`;
    },
  });
}

export function createWebsiteGitHubAppAuthorizationStartHandlerV1(input: Readonly<{
  authenticator: WebsiteEntitlementReadAuthenticatorV1;
  configuration: WebsiteGitHubLaunchSessionConfigurationV1;
  now?: Clock;
  random?: RandomBytes;
}>): (request: Request) => Promise<Response> {
  if (typeof input.authenticator?.authenticate !== "function") {
    throw new TypeError("GitHub App authorization authenticator is invalid");
  }
  const configuration = exactConfiguration(input.configuration);
  const now = input.now ?? (() => new Date());
  const random = input.random ?? randomBytes;
  return async function startGitHubAppAuthorization(request: Request): Promise<Response> {
    if (!exactStartRequest(request)) return oauthError(400, "invalid_request");
    let principal: AuthenticatedGitHubPrincipalV1;
    try {
      principal = await input.authenticator.authenticate(request);
    } catch {
      return oauthError(401, "privy_session_rejected");
    }
    const issuedAt = seconds(now());
    const state = exactRandom(random, 32);
    const codeVerifier = exactRandom(random, 32);
    const payload: OAuthStateV1 = Object.freeze({
      schemaVersion: "programmable.website-github-app-oauth-state.v1",
      codeVerifier,
      expiresAt: issuedAt + OAUTH_STATE_LIFETIME_SECONDS,
      githubAppClientId: configuration.githubAppClientId,
      githubUserId: principal.githubUserId,
      issuedAt,
      privySessionId: principalSessionId(principal),
      privyUserId: principal.privyUserId,
      state,
    });
    const authorization = new URL(GITHUB_AUTHORIZE_ENDPOINT);
    authorization.searchParams.set("client_id", configuration.githubAppClientId);
    authorization.searchParams.set("redirect_uri", callbackUrl());
    authorization.searchParams.set("state", state);
    authorization.searchParams.set(
      "code_challenge",
      createHash("sha256").update(codeVerifier, "ascii").digest("base64url"),
    );
    authorization.searchParams.set("code_challenge_method", "S256");
    const sealed = seal(payload, configuration.cookieSealKey, random);
    return jsonResponse(200, {
      schemaVersion: "programmable.website-github-app-authorization-start.v1",
      authorizationUrl: authorization.toString(),
    }, [cookie(OAUTH_STATE_COOKIE, sealed, OAUTH_STATE_LIFETIME_SECONDS, "Lax")]);
  };
}

export function createWebsiteGitHubAppAuthorizationCallbackHandlerV1(input: Readonly<{
  configuration: WebsiteGitHubLaunchSessionConfigurationV1;
  githubFetch: typeof fetch;
  now?: Clock;
  random?: RandomBytes;
}>): (request: Request) => Promise<Response> {
  const configuration = exactConfiguration(input.configuration);
  if (typeof input.githubFetch !== "function") {
    throw new TypeError("GitHub App callback fetch is invalid");
  }
  const now = input.now ?? (() => new Date());
  const random = input.random ?? randomBytes;
  return async function completeGitHubAppAuthorization(request: Request): Promise<Response> {
    const invalid = (): Response => oauthError(
      400,
      "github_app_authorization_rejected",
      [expiredCookie(OAUTH_STATE_COOKIE, "Lax")],
    );
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return invalid();
    }
    const entries = [...url.searchParams.entries()];
    if (
      request.method !== "GET"
      || url.origin !== WEBSITE_ISSUER
      || url.pathname !== OAUTH_CALLBACK_PATH
      || url.hash !== ""
      || entries.length !== 2
      || entries[0]?.[0] !== "code"
      || entries[1]?.[0] !== "state"
      || !OAUTH_CODE.test(entries[0][1])
      || !BASE64URL.test(entries[1][1])
    ) return invalid();
    let state: OAuthStateV1;
    try {
      state = oauthState(open(
        cookieValue(request, OAUTH_STATE_COOKIE),
        configuration.cookieSealKey,
        "programmable.website-github-app-oauth-state.v1",
      ), now());
      if (
        state.state !== entries[1][1]
        || state.githubAppClientId !== configuration.githubAppClientId
      ) throw new TypeError("GitHub App OAuth state differs");
    } catch {
      return invalid();
    }
    try {
      const token = await exchangeAuthorizationCode({
        code: entries[0][1],
        codeVerifier: state.codeVerifier,
        configuration,
        githubFetch: input.githubFetch,
        signal: request.signal,
      });
      const observation = await inspectGitHubToken({
        configuration,
        token,
        githubFetch: input.githubFetch,
        signal: request.signal,
        now: now(),
      });
      if (observation.githubUserId !== state.githubUserId) {
        return oauthError(403, "github_identity_mismatch", [
          expiredCookie(OAUTH_STATE_COOKIE, "Lax"),
        ]);
      }
      const issuedAt = seconds(now());
      const maximumAge = observation.expiresAtSeconds - issuedAt;
      if (maximumAge <= WEBSITE_SESSION_LIFETIME_SECONDS) return invalid();
      const handoff: GitHubHandoffV1 = Object.freeze({
        schemaVersion: "programmable.website-github-app-handoff.v1",
        expiresAt: observation.expiresAtSeconds,
        githubAppClientId: configuration.githubAppClientId,
        githubAppUserToken: token,
        githubUserId: state.githubUserId,
        issuedAt,
        privySessionId: state.privySessionId,
        privyUserId: state.privyUserId,
      });
      const sealed = seal(handoff, configuration.cookieSealKey, random);
      return new Response(null, {
        status: 303,
        headers: responseHeaders([
          expiredCookie(OAUTH_STATE_COOKIE, "Lax"),
          cookie(
            GITHUB_HANDOFF_COOKIE,
            sealed,
            Math.min(maximumAge, GITHUB_USER_TOKEN_LIFETIME_SECONDS),
            "Strict",
          ),
        ], { location: `${WEBSITE_ISSUER}/launch` }),
      });
    } catch {
      return oauthError(503, "github_app_authorization_unavailable", [
        expiredCookie(OAUTH_STATE_COOKIE, "Lax"),
      ]);
    }
  };
}

let productionStartHandler:
ReturnType<typeof createWebsiteGitHubAppAuthorizationStartHandlerV1> | null = null;
let productionCallbackHandler:
ReturnType<typeof createWebsiteGitHubAppAuthorizationCallbackHandlerV1> | null = null;

export function handleProductionWebsiteGitHubAppAuthorizationStartV1(
  request: Request,
): Promise<Response> {
  try {
    assertLaunchPublic(process.env);
    productionStartHandler ??= createWebsiteGitHubAppAuthorizationStartHandlerV1({
      authenticator: createPrivyGitHubPrincipalAuthenticatorV1(),
      configuration: productionConfiguration(process.env),
    });
    return productionStartHandler(request);
  } catch {
    return Promise.resolve(oauthError(503, "github_app_authorization_not_configured"));
  }
}

export function handleProductionWebsiteGitHubAppAuthorizationCallbackV1(
  request: Request,
): Promise<Response> {
  try {
    assertLaunchPublic(process.env);
    productionCallbackHandler ??= createWebsiteGitHubAppAuthorizationCallbackHandlerV1({
      configuration: productionConfiguration(process.env),
      githubFetch: globalThis.fetch.bind(globalThis),
    });
    return productionCallbackHandler(request);
  } catch {
    return Promise.resolve(oauthError(503, "github_app_authorization_not_configured"));
  }
}

function productionConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): WebsiteGitHubLaunchSessionConfigurationV1 {
  const releaseCommit = required(environment, "PROGRAMMABLE_RELEASE_COMMIT_SHA").toLowerCase();
  const vercelCommit = required(environment, "VERCEL_GIT_COMMIT_SHA").toLowerCase();
  if (!GIT_OBJECT.test(releaseCommit) || vercelCommit !== releaseCommit) {
    throw new TypeError("Website release commit is not exact");
  }
  const privyAppId = required(environment, "NEXT_PUBLIC_PRIVY_APP_ID");
  const approvalServiceOrigin = exactOrigin(required(
    environment,
    "PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN",
  ));
  const approvalServicePackageArtifactHash = required(
    environment,
    "PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH",
  );
  const githubAppClientId = required(environment, "PROGRAMMABLE_GITHUB_LAUNCH_APP_CLIENT_ID");
  const githubAppClientSecret = required(
    environment,
    "PROGRAMMABLE_GITHUB_LAUNCH_APP_CLIENT_SECRET",
  );
  const signerKeyId = required(
    environment,
    "PROGRAMMABLE_WEBSITE_GITHUB_LAUNCH_SESSION_SIGNER_KEY_ID",
  );
  const privateKeySource = required(
    environment,
    "PROGRAMMABLE_WEBSITE_GITHUB_LAUNCH_SESSION_SIGNER_PRIVATE_KEY_PEM",
  ).replaceAll("\\n", "\n");
  const signerPrivateKey = createPrivateKey(privateKeySource);
  if (signerPrivateKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("Website session signer must be Ed25519");
  }
  const signerPublicKeySpkiSha256 = rawSha256(publicKeyFromPrivate(signerPrivateKey)
    .export({ type: "spki", format: "der" }));
  const sealKeySource = required(
    environment,
    "PROGRAMMABLE_WEBSITE_GITHUB_LAUNCH_COOKIE_SEAL_KEY_BASE64URL",
  );
  if (!BASE64URL.test(sealKeySource)) throw new TypeError("Cookie seal key is invalid");
  const cookieSealKey = Buffer.from(sealKeySource, "base64url");
  if (cookieSealKey.byteLength !== 32 || cookieSealKey.toString("base64url") !== sealKeySource) {
    throw new TypeError("Cookie seal key is invalid");
  }
  if (
    !safeOpaque(privyAppId, 256)
    || !DIGEST.test(approvalServicePackageArtifactHash)
    || !GITHUB_CLIENT_ID.test(githubAppClientId)
    || !safeOpaque(githubAppClientSecret, 512)
    || !SAFE_ID.test(signerKeyId)
  ) throw new TypeError("Website GitHub launch-session configuration is invalid");
  const websiteReleaseBindingHash = derivedWebsiteReleaseBindingHash({
    approvalServiceOrigin,
    approvalServicePackageArtifactHash:
      approvalServicePackageArtifactHash as Sha256Digest,
    githubAppClientId,
    privyAppId,
    signerKeyId,
    signerPublicKeySpkiSha256,
    sourceCommit: releaseCommit,
  });
  return exactConfiguration(Object.freeze({
    sourceCommit: releaseCommit,
    privyAppId,
    approvalServiceOrigin,
    approvalServicePackageArtifactHash:
      approvalServicePackageArtifactHash as Sha256Digest,
    githubAppClientId,
    githubAppClientSecret,
    signerKeyId,
    signerPrivateKey,
    signerPublicKeySpkiSha256,
    cookieSealKey,
    websiteReleaseBindingHash,
  }));
}

function assertLaunchPublic(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (
    environment.PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED !== "true"
    || environment.PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED !== "true"
  ) throw new TypeError("Custom Launch is not public");
}

function exactConfiguration(
  configuration: WebsiteGitHubLaunchSessionConfigurationV1,
): WebsiteGitHubLaunchSessionConfigurationV1 {
  if (
    !GIT_OBJECT.test(configuration.sourceCommit)
    || !safeOpaque(configuration.privyAppId, 256)
    || exactOrigin(configuration.approvalServiceOrigin) !== configuration.approvalServiceOrigin
    || !DIGEST.test(configuration.approvalServicePackageArtifactHash)
    || !GITHUB_CLIENT_ID.test(configuration.githubAppClientId)
    || !safeOpaque(configuration.githubAppClientSecret, 512)
    || !SAFE_ID.test(configuration.signerKeyId)
    || configuration.signerPrivateKey?.asymmetricKeyType !== "ed25519"
    || !DIGEST.test(configuration.signerPublicKeySpkiSha256)
    || rawSha256(publicKeyFromPrivate(configuration.signerPrivateKey)
      .export({ type: "spki", format: "der" }))
      !== configuration.signerPublicKeySpkiSha256
    || !(configuration.cookieSealKey instanceof Buffer)
    || configuration.cookieSealKey.byteLength !== 32
    || !DIGEST.test(configuration.websiteReleaseBindingHash)
    || configuration.websiteReleaseBindingHash
      !== derivedWebsiteReleaseBindingHash(configuration)
  ) throw new TypeError("Website GitHub launch-session configuration is invalid");
  return configuration;
}

function derivedWebsiteReleaseBindingHash(input: Readonly<{
  sourceCommit: string;
  privyAppId: string;
  approvalServiceOrigin: string;
  approvalServicePackageArtifactHash: Sha256Digest;
  githubAppClientId: string;
  signerKeyId: string;
  signerPublicKeySpkiSha256: Sha256Digest;
}>): Sha256Digest {
  return canonicalSha256(
    "programmable.website-github-launch-session-release-binding.v1",
    {
      approvalServiceOrigin: input.approvalServiceOrigin,
      approvalServicePackageArtifactHash: input.approvalServicePackageArtifactHash,
      audience: WEBSITE_SESSION_AUDIENCE,
      githubAppClientId: input.githubAppClientId,
      issuer: WEBSITE_ISSUER,
      privyAppId: input.privyAppId,
      signerKeyId: input.signerKeyId,
      signerPublicKeySpkiSha256: input.signerPublicKeySpkiSha256,
      sourceCommit: input.sourceCommit,
    },
  );
}

type OAuthStateV1 = Readonly<{
  schemaVersion: "programmable.website-github-app-oauth-state.v1";
  codeVerifier: string;
  expiresAt: number;
  githubAppClientId: string;
  githubUserId: string;
  issuedAt: number;
  privySessionId: string;
  privyUserId: string;
  state: string;
}>;

type GitHubHandoffV1 = Readonly<{
  schemaVersion: "programmable.website-github-app-handoff.v1";
  expiresAt: number;
  githubAppClientId: string;
  githubAppUserToken: string;
  githubUserId: string;
  issuedAt: number;
  privySessionId: string;
  privyUserId: string;
}>;

function oauthState(value: JsonValue, now: Date): OAuthStateV1 {
  const state = record(value, "GitHub App OAuth state");
  exactKeys(state, [
    "codeVerifier", "expiresAt", "githubAppClientId", "githubUserId", "issuedAt",
    "privySessionId", "privyUserId", "schemaVersion", "state",
  ], "GitHub App OAuth state");
  const current = seconds(now);
  if (
    state.schemaVersion !== "programmable.website-github-app-oauth-state.v1"
    || typeof state.codeVerifier !== "string"
    || !BASE64URL.test(state.codeVerifier)
    || typeof state.state !== "string"
    || !BASE64URL.test(state.state)
    || typeof state.githubAppClientId !== "string"
    || !GITHUB_CLIENT_ID.test(state.githubAppClientId)
    || typeof state.githubUserId !== "string"
    || !GITHUB_USER_ID.test(state.githubUserId)
    || typeof state.privyUserId !== "string"
    || !SAFE_ID.test(state.privyUserId)
    || typeof state.privySessionId !== "string"
    || !SAFE_ID.test(state.privySessionId)
    || typeof state.issuedAt !== "number"
    || !Number.isSafeInteger(state.issuedAt)
    || typeof state.expiresAt !== "number"
    || !Number.isSafeInteger(state.expiresAt)
    || state.issuedAt > current
    || state.expiresAt <= current
    || state.expiresAt - state.issuedAt !== OAUTH_STATE_LIFETIME_SECONDS
  ) throw new TypeError("GitHub App OAuth state is invalid");
  return state as OAuthStateV1;
}

function openGitHubHandoff(
  request: Request,
  configuration: WebsiteGitHubLaunchSessionConfigurationV1,
  now: Date,
): GitHubHandoffV1 {
  try {
    const value = record(open(
      cookieValue(request, GITHUB_HANDOFF_COOKIE),
      configuration.cookieSealKey,
      "programmable.website-github-app-handoff.v1",
    ), "GitHub App handoff");
    exactKeys(value, [
      "expiresAt", "githubAppClientId", "githubAppUserToken", "githubUserId",
      "issuedAt", "privySessionId", "privyUserId", "schemaVersion",
    ], "GitHub App handoff");
    const current = seconds(now);
    if (
      value.schemaVersion !== "programmable.website-github-app-handoff.v1"
      || value.githubAppClientId !== configuration.githubAppClientId
      || typeof value.githubAppUserToken !== "string"
      || !GITHUB_APP_USER_TOKEN.test(value.githubAppUserToken)
      || typeof value.githubUserId !== "string"
      || !GITHUB_USER_ID.test(value.githubUserId)
      || typeof value.privyUserId !== "string"
      || !SAFE_ID.test(value.privyUserId)
      || typeof value.privySessionId !== "string"
      || !SAFE_ID.test(value.privySessionId)
      || typeof value.issuedAt !== "number"
      || !Number.isSafeInteger(value.issuedAt)
      || typeof value.expiresAt !== "number"
      || !Number.isSafeInteger(value.expiresAt)
      || value.issuedAt > current
      || value.expiresAt <= current + WEBSITE_SESSION_LIFETIME_SECONDS
      || value.expiresAt - value.issuedAt > GITHUB_USER_TOKEN_LIFETIME_SECONDS
    ) throw new TypeError("GitHub App handoff is invalid");
    return value as GitHubHandoffV1;
  } catch {
    throw new WebsiteGitHubLaunchSessionErrorV1(
      401,
      "github_app_authorization_required",
    );
  }
}

function assertPrincipalBinding(
  handoff: GitHubHandoffV1,
  principal: AuthenticatedGitHubPrincipalV1,
): void {
  if (
    handoff.githubUserId !== principal.githubUserId
    || handoff.privyUserId !== principal.privyUserId
    || handoff.privySessionId !== principal.privySessionId
  ) throw new WebsiteGitHubLaunchSessionErrorV1(401, "github_app_authorization_required");
}

function principalSessionId(principal: AuthenticatedGitHubPrincipalV1): string {
  if (typeof principal.privySessionId !== "string" || !SAFE_ID.test(principal.privySessionId)) {
    throw new WebsiteGitHubLaunchSessionErrorV1(401, "privy_session_rejected");
  }
  return principal.privySessionId;
}

async function exchangeAuthorizationCode(input: Readonly<{
  code: string;
  codeVerifier: string;
  configuration: WebsiteGitHubLaunchSessionConfigurationV1;
  githubFetch: typeof fetch;
  signal: AbortSignal;
}>): Promise<string> {
  const body = new URLSearchParams({
    client_id: input.configuration.githubAppClientId,
    client_secret: input.configuration.githubAppClientSecret,
    code: input.code,
    redirect_uri: callbackUrl(),
    code_verifier: input.codeVerifier,
  }).toString();
  const response = await boundedGitHubJson(
    input.githubFetch,
    new URL(GITHUB_TOKEN_ENDPOINT),
    {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal: input.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(Buffer.byteLength(body)),
        "user-agent": "programmable-website-github-app-oauth-v1",
      },
      body,
    },
  );
  if (
    typeof response.access_token !== "string"
    || !GITHUB_APP_USER_TOKEN.test(response.access_token)
    || response.expires_in !== GITHUB_USER_TOKEN_LIFETIME_SECONDS
    || response.scope !== ""
    || response.token_type !== "bearer"
  ) throw new TypeError("GitHub App token exchange response is invalid");
  return response.access_token;
}

async function inspectGitHubToken(input: Readonly<{
  configuration: WebsiteGitHubLaunchSessionConfigurationV1;
  token: string;
  githubFetch: typeof fetch;
  signal: AbortSignal;
  now: Date;
}>): Promise<Readonly<{ githubUserId: string; expiresAtSeconds: number }>> {
  if (!GITHUB_APP_USER_TOKEN.test(input.token)) {
    throw new WebsiteGitHubLaunchSessionErrorV1(401, "github_app_authorization_required");
  }
  const body = canonicalizeJson({ access_token: input.token });
  const response = await boundedGitHubJson(
    input.githubFetch,
    new URL(
      `https://api.github.com/applications/${input.configuration.githubAppClientId}/token`,
    ),
    {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal: input.signal,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Basic ${Buffer.from(
          `${input.configuration.githubAppClientId}:${
            input.configuration.githubAppClientSecret}`,
          "utf8",
        ).toString("base64")}`,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        "user-agent": "programmable-website-github-launch-session-v1",
        "x-github-api-version": GITHUB_API_VERSION,
      },
      body,
    },
  );
  const app = record(response.app, "GitHub token app");
  const user = record(response.user, "GitHub token user");
  const expiresAt = typeof response.expires_at === "string"
    ? new Date(response.expires_at)
    : new Date(Number.NaN);
  const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1_000);
  const current = seconds(input.now);
  if (
    response.token !== input.token
    || !Array.isArray(response.scopes)
    || response.scopes.length !== 0
    || app.client_id !== input.configuration.githubAppClientId
    || !Number.isSafeInteger(user.id)
    || !GITHUB_USER_ID.test(String(user.id))
    || !Number.isFinite(expiresAt.getTime())
    || expiresAt.toISOString() !== response.expires_at
    || expiresAtSeconds <= current
    || expiresAtSeconds - current > GITHUB_USER_TOKEN_LIFETIME_SECONDS
  ) throw new WebsiteGitHubLaunchSessionErrorV1(401, "github_app_authorization_required");
  return Object.freeze({
    githubUserId: String(user.id),
    expiresAtSeconds,
  });
}

async function boundedGitHubJson(
  githubFetch: typeof fetch,
  endpoint: URL,
  init: RequestInit,
): Promise<Readonly<Record<string, JsonValue>>> {
  const parent = init.signal;
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const response = await githubFetch(endpoint, { ...init, signal: controller.signal });
    if (
      response.status !== 200
      || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
        !== "application/json"
    ) {
      await response.body?.cancel();
      throw new TypeError("GitHub response is unavailable");
    }
    const bytes = await readBounded(response, MAXIMUM_GITHUB_RESPONSE_BYTES);
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return record(parseStrictJson(source, {
      maximumBytes: MAXIMUM_GITHUB_RESPONSE_BYTES,
      maximumDepth: 16,
    }), "GitHub response");
  } finally {
    clearTimeout(timeout);
    parent?.removeEventListener("abort", abort);
  }
}

async function readBounded(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (response.body === null) throw new TypeError("GitHub response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) throw new TypeError("GitHub response is too large");
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

function seal(value: JsonValue, key: Buffer, random: RandomBytes): string {
  const iv = random(12);
  if (!(iv instanceof Buffer) || iv.byteLength !== 12) {
    throw new TypeError("Cookie nonce source is invalid");
  }
  const plaintext = Buffer.from(canonicalizeJson(value), "utf8");
  const schema = record(value, "sealed cookie").schemaVersion;
  if (typeof schema !== "string") throw new TypeError("Sealed cookie schema is invalid");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(schema, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const result = `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${
    cipher.getAuthTag().toString("base64url")}`;
  if (Buffer.byteLength(result) > MAXIMUM_COOKIE_BYTES) {
    throw new TypeError("Sealed cookie is too large");
  }
  return result;
}

function open(value: string, key: Buffer, schema: string): JsonValue {
  const segments = value.split(".");
  if (
    segments.length !== 4
    || segments[0] !== "v1"
    || segments.slice(1).some((segment) => !BASE64URL.test(segment))
  ) throw new TypeError("Sealed cookie is invalid");
  const iv = Buffer.from(segments[1]!, "base64url");
  const ciphertext = Buffer.from(segments[2]!, "base64url");
  const tag = Buffer.from(segments[3]!, "base64url");
  if (
    iv.byteLength !== 12
    || tag.byteLength !== 16
    || iv.toString("base64url") !== segments[1]
    || ciphertext.toString("base64url") !== segments[2]
    || tag.toString("base64url") !== segments[3]
  ) throw new TypeError("Sealed cookie is invalid");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(schema, "utf8"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plaintext.byteLength > MAXIMUM_COOKIE_BYTES) throw new TypeError("Cookie is too large");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  const parsed = parseStrictJson(source, {
    maximumBytes: MAXIMUM_COOKIE_BYTES,
    maximumDepth: 8,
  });
  if (canonicalizeJson(parsed) !== source) throw new TypeError("Cookie is not canonical");
  return parsed;
}

function exactStartRequest(request: Request): boolean {
  try {
    const url = new URL(request.url);
    return request.method === "POST"
      && url.origin === WEBSITE_ISSUER
      && url.pathname === OAUTH_START_PATH
      && url.search === ""
      && url.hash === ""
      && request.headers.get("accept")?.trim().toLowerCase() === "application/json"
      && !request.headers.has("content-type")
      && !request.headers.has("content-length")
      && request.body === null;
  } catch {
    return false;
  }
}

function cookieValue(request: Request, name: string): string {
  const source = request.headers.get("cookie");
  if (source === null || Buffer.byteLength(source) > 16_384) {
    throw new TypeError("Cookie is missing");
  }
  const matches = source.split(";").map((part) => part.trim()).filter((part) =>
    part.startsWith(`${name}=`));
  if (matches.length !== 1) throw new TypeError("Cookie is ambiguous");
  const value = matches[0]!.slice(name.length + 1);
  if (!value || Buffer.byteLength(value) > MAXIMUM_COOKIE_BYTES) {
    throw new TypeError("Cookie is invalid");
  }
  return value;
}

function cookie(
  name: string,
  value: string,
  maximumAge: number,
  sameSite: "Lax" | "Strict",
): string {
  if (!Number.isSafeInteger(maximumAge) || maximumAge < 1) {
    throw new TypeError("Cookie lifetime is invalid");
  }
  return `${name}=${value}; Max-Age=${maximumAge}; Path=/; Secure; HttpOnly; SameSite=${sameSite}`;
}

function expiredCookie(name: string, sameSite: "Lax" | "Strict"): string {
  return `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=${sameSite}`;
}

function jsonResponse(
  status: number,
  body: Readonly<Record<string, JsonValue>>,
  cookies: readonly string[] = [],
): Response {
  return new Response(canonicalizeJson(body), {
    status,
    headers: responseHeaders(cookies),
  });
}

function oauthError(status: number, code: string, cookies: readonly string[] = []): Response {
  return jsonResponse(status, {
    schemaVersion: "programmable.website-github-app-authorization-error.v1",
    code,
  }, cookies);
}

function responseHeaders(
  cookies: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): Headers {
  const headers = new Headers({
    "cache-control": "no-store, max-age=0",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    vary: "authorization, cookie, x-privy-identity-token",
    ...extra,
  });
  for (const value of cookies) headers.append("set-cookie", value);
  return headers;
}

function exactRandom(random: RandomBytes, size: number): string {
  const value = random(size);
  if (!(value instanceof Buffer) || value.byteLength !== size) {
    throw new TypeError("Random source is invalid");
  }
  return value.toString("base64url");
}

function callbackUrl(): string {
  return `${WEBSITE_ISSUER}${OAUTH_CALLBACK_PATH}`;
}

function seconds(value: Date): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("Clock is invalid");
  }
  return Math.floor(value.getTime() / 1_000);
}

function exactOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) throw new TypeError("Approval service origin is invalid");
  return url.origin;
}

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

function safeOpaque(value: string, maximum: number): boolean {
  return value.length >= 8
    && value.length <= maximum
    && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

function rawSha256(value: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function publicKeyFromPrivate(privateKey: KeyObject): KeyObject {
  return createPublicKey(privateKey.export({ type: "pkcs8", format: "pem" }));
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
