import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCustomLaunchWebsiteClientV2 } from "../lib/custom-launch/client-v2";
import {
  createCustomLaunchBridgeHandlerV2,
  type CustomLaunchBridgeDependenciesV2,
} from "../lib/server/custom-launch/launch-bridge-v2";
import {
  GitHubPrincipalAuthenticationErrorV1,
} from "../lib/server/projection-target/github-entitlement";

const CHALLENGE_ID = "123e4567-e89b-42d3-a456-426614174000";
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174001";
const GRANT_ID = "123e4567-e89b-42d3-a456-426614174002";
const EXECUTION_RESERVATION_ID = "123e4567-e89b-42d3-a456-426614174003";
const APPLICATION_HANDLE = `github-${"a".repeat(64)}` as const;
const PACKAGE_ARTIFACT_HASH = `sha256:${"9".repeat(64)}` as const;

function serviceResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify({
    schemaVersion: "2.0.0",
    requestId: "service-request-1",
    data,
  }), { status, headers: { "content-type": "application/json" } });
}

function approvalServiceReadyResponse(
  packageArtifactHash: `sha256:${string}` = PACKAGE_ARTIFACT_HASH,
): Response {
  return serviceResponse({
    status: "ready",
    reviewAuthorityMode: "manual_review",
    release: { packageArtifactHash },
  });
}

function releaseAttestedServiceFetch(delegate: typeof fetch): typeof fetch {
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    if (String(input) === "https://approval.example/readyz") {
      expect(init?.method).toBe("GET");
      expect(init?.cache).toBe("no-store");
      expect(init?.redirect).toBe("error");
      return approvalServiceReadyResponse();
    }
    return delegate(input, init);
  }) as typeof fetch;
}

function createReleaseBoundBridge(
  dependencies: Omit<
    CustomLaunchBridgeDependenciesV2,
    "expectedPackageArtifactHash"
  >,
) {
  return createCustomLaunchBridgeHandlerV2({
    ...dependencies,
    serviceFetch: releaseAttestedServiceFetch(dependencies.serviceFetch),
    expectedPackageArtifactHash: PACKAGE_ARTIFACT_HASH,
  });
}

function authenticatedPrincipal() {
  return {
    privyUserId: "did:privy:user",
    githubUserId: "123456789",
    githubUsername: "builder",
    githubPrincipalHash: `sha256:${"1".repeat(64)}` as const,
  };
}

function challengeRequest(idempotencyKey: string): Request {
  return new Request(
    "https://website.example/api/custom-launch/v2/launch-sessions/challenges",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: "Bearer access-token-value",
        "x-privy-identity-token": "identity-token-value",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        schemaVersion: "programmable.launch-session-challenge-create-request.v2",
        idempotencyKey,
      }),
    },
  );
}

describe("custom launch Website bridge V2", () => {
  it("authenticates the current principal and forwards only the user credential", async () => {
    const authenticate = vi.fn(async () => ({
      privyUserId: "did:privy:user",
      githubUserId: "123456789",
      githubUsername: "builder",
      githubPrincipalHash: `sha256:${"1".repeat(64)}` as const,
    }));
    const serviceFetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe("https://approval.example/v2/launch-sessions/challenges");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer access-token-value");
      expect(headers.get("x-privy-identity-token")).toBeNull();
      expect(headers.get("idempotency-key")).toBe("challenge-request-1");
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
      return serviceResponse({
        schemaVersion: "programmable.launch-session-challenge-view.v2",
        grantId: "grant-1",
        challengeId: CHALLENGE_ID,
        challengeBindingHash: `sha256:${"2".repeat(64)}`,
        sessionId: SESSION_ID,
        state: "ready_for_wallet",
        createdAt: "2026-08-05T12:00:00.000Z",
        expiresAt: "2026-08-05T12:05:00.000Z",
      }, 201);
    });
    const handler = createReleaseBoundBridge({
      authenticator: { authenticate },
      serviceOrigin: new URL("https://approval.example"),
      serviceFetch: serviceFetch as typeof fetch,
    });
    const body = JSON.stringify({
      schemaVersion: "programmable.launch-session-challenge-create-request.v2",
      idempotencyKey: "challenge-request-1",
    });
    const response = await handler(new Request(
      "https://website.example/api/custom-launch/v2/launch-sessions/challenges",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer access-token-value",
          "x-privy-identity-token": "identity-token-value",
          "content-type": "application/json",
          "idempotency-key": "challenge-request-1",
        },
        body,
      },
    ), { kind: "challenge-create" });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authenticate).toHaveBeenCalledOnce();
    expect(serviceFetch).toHaveBeenCalledOnce();
  });

  it("blocks a mutation before forwarding when the live package hash mismatches", async () => {
    const serviceFetch = vi.fn(async (input: URL | RequestInfo) => {
      expect(String(input)).toBe("https://approval.example/readyz");
      return approvalServiceReadyResponse(`sha256:${"8".repeat(64)}`);
    });
    const handler = createCustomLaunchBridgeHandlerV2({
      authenticator: { authenticate: async () => authenticatedPrincipal() },
      serviceOrigin: new URL("https://approval.example"),
      expectedPackageArtifactHash: PACKAGE_ARTIFACT_HASH,
      serviceFetch: serviceFetch as typeof fetch,
    });

    const response = await handler(
      challengeRequest("challenge-mismatch-request-1"),
      { kind: "challenge-create" },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "launch_service_release_unverified",
    });
    expect(serviceFetch).toHaveBeenCalledOnce();
  });

  it("blocks a mutation when live release attestation is unavailable", async () => {
    const serviceFetch = vi.fn(async () => {
      throw new Error("approval service unavailable");
    });
    const handler = createCustomLaunchBridgeHandlerV2({
      authenticator: { authenticate: async () => authenticatedPrincipal() },
      serviceOrigin: new URL("https://approval.example"),
      expectedPackageArtifactHash: PACKAGE_ARTIFACT_HASH,
      serviceFetch: serviceFetch as typeof fetch,
    });

    const response = await handler(
      challengeRequest("challenge-unavailable-request-1"),
      { kind: "challenge-create" },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "launch_service_release_unverified",
    });
    expect(serviceFetch).toHaveBeenCalledOnce();
  });

  it("re-attests every mutation and blocks package drift between requests", async () => {
    const calls: string[] = [];
    let attestationCount = 0;
    const mutationFetch = vi.fn(async (
      input: URL | RequestInfo,
      init?: RequestInit,
    ) => {
      void input;
      void init;
      return serviceResponse({
        schemaVersion: "programmable.launch-session-challenge-view.v2",
        grantId: "grant-1",
        challengeId: CHALLENGE_ID,
        challengeBindingHash: `sha256:${"2".repeat(64)}`,
        sessionId: SESSION_ID,
        state: "ready_for_wallet",
        createdAt: "2026-08-05T12:00:00.000Z",
        expiresAt: "2026-08-05T12:05:00.000Z",
      }, 201);
    });
    const handler = createCustomLaunchBridgeHandlerV2({
      authenticator: { authenticate: async () => authenticatedPrincipal() },
      serviceOrigin: new URL("https://approval.example"),
      expectedPackageArtifactHash: PACKAGE_ARTIFACT_HASH,
      serviceFetch: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (url === "https://approval.example/readyz") {
          attestationCount += 1;
          return approvalServiceReadyResponse(attestationCount === 1
            ? PACKAGE_ARTIFACT_HASH
            : `sha256:${"8".repeat(64)}`);
        }
        return mutationFetch(input, init);
      }) as typeof fetch,
    });

    const first = await handler(
      challengeRequest("challenge-drift-request-0001"),
      { kind: "challenge-create" },
    );
    const second = await handler(
      challengeRequest("challenge-drift-request-0002"),
      { kind: "challenge-create" },
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(503);
    expect(mutationFetch).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      "https://approval.example/readyz",
      "https://approval.example/v2/launch-sessions/challenges",
      "https://approval.example/readyz",
    ]);
  });

  it("fails closed before service access when Privy or GitHub authority is absent", async () => {
    const serviceFetch = vi.fn();
    const handler = createReleaseBoundBridge({
      authenticator: {
        async authenticate() {
          throw new GitHubPrincipalAuthenticationErrorV1(403, "github_account_required");
        },
      },
      serviceOrigin: new URL("https://approval.example"),
      serviceFetch: serviceFetch as typeof fetch,
    });
    const response = await handler(new Request(
      `https://website.example/api/custom-launch/v3/applications/${APPLICATION_HANDLE}`,
      {
        headers: {
          accept: "application/json",
          authorization: "Bearer access-token-value",
          "x-privy-identity-token": "identity-token-value",
        },
      },
    ), { kind: "application-status", applicationHandle: APPLICATION_HANDLE });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "github_account_required",
    });
    expect(serviceFetch).not.toHaveBeenCalled();
  });

  it("unwraps only the exact service V2 envelope and preserves bounded public errors", async () => {
    const authenticate = async () => ({
      privyUserId: "did:privy:user",
      githubUserId: "123456789",
      githubUsername: null,
      githubPrincipalHash: `sha256:${"1".repeat(64)}` as const,
    });
    const headers = {
      accept: "application/json",
      authorization: "Bearer access-token-value",
      "x-privy-identity-token": "identity-token-value",
    };
    const errorHandler = createReleaseBoundBridge({
      authenticator: { authenticate },
      serviceOrigin: new URL("https://approval.example"),
      serviceFetch: vi.fn(async () => new Response(JSON.stringify({
        schemaVersion: "2.0.0",
        requestId: "private-service-request-id",
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "Launch application was not found",
        },
      }), { status: 404, headers: { "content-type": "application/json" } })) as typeof fetch,
    });
    const errorResponse = await errorHandler(new Request(
      `https://website.example/api/custom-launch/v3/applications/${APPLICATION_HANDLE}`,
      { headers },
    ), { kind: "application-status", applicationHandle: APPLICATION_HANDLE });
    expect(errorResponse.status).toBe(404);
    expect(errorResponse.headers.get("x-request-id")).toBeNull();
    await expect(errorResponse.json()).resolves.toEqual({
      schemaVersion: "programmable.custom-launch-website-error.v2",
      code: "RESOURCE_NOT_FOUND",
      message: "Launch application was not found",
    });

    const malformedHandler = createReleaseBoundBridge({
      authenticator: { authenticate },
      serviceOrigin: new URL("https://approval.example"),
      serviceFetch: vi.fn(async () => new Response(JSON.stringify({
        schemaVersion: "2.0.0",
        requestId: "service-request-1",
        data: { schemaVersion: "1.0.0" },
        internalAuthority: "must-not-cross",
      }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
    });
    const malformed = await malformedHandler(new Request(
      `https://website.example/api/custom-launch/v3/applications/${APPLICATION_HANDLE}`,
      { headers },
    ), { kind: "application-status", applicationHandle: APPLICATION_HANDLE });
    expect(malformed.status).toBe(502);
    await expect(malformed.json()).resolves.toMatchObject({
      code: "launch_service_response_invalid",
    });
  });

  it("rejects unsafe service origins, route parameters, and oversized writes", async () => {
    expect(() => createReleaseBoundBridge({
      authenticator: { async authenticate() { throw new Error("unused"); } },
      serviceOrigin: new URL("http://approval.example"),
      serviceFetch: fetch,
    })).toThrow("origin is invalid");

    const serviceFetch = vi.fn();
    const handler = createReleaseBoundBridge({
      authenticator: {
        async authenticate() {
          return {
            privyUserId: "did:privy:user",
            githubUserId: "123456789",
            githubUsername: null,
            githubPrincipalHash: `sha256:${"1".repeat(64)}` as const,
          };
        },
      },
      serviceOrigin: new URL("https://approval.example"),
      serviceFetch: serviceFetch as typeof fetch,
    });
    const invalidRoute = await handler(new Request(
      "https://website.example/api/custom-launch/v3/applications/bad",
      {
        headers: {
          accept: "application/json",
          authorization: "Bearer access-token-value",
          "x-privy-identity-token": "identity-token-value",
        },
      },
    ), { kind: "application-status", applicationHandle: "application-1" });
    expect(invalidRoute.status).toBe(400);

    const oversized = await handler(new Request(
      "https://website.example/api/custom-launch/v2/launch-sessions/challenges",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer access-token-value",
          "x-privy-identity-token": "identity-token-value",
          "content-type": "application/json",
          "content-length": "1048577",
          "idempotency-key": "large-request",
        },
        body: "{}",
      },
    ), { kind: "challenge-create" });
    expect(oversized.status).toBe(400);
    expect(serviceFetch).not.toHaveBeenCalled();
  });

  it("forwards only the canonical principal-scoped execution status query", async () => {
    const serviceFetch = vi.fn(async (input: URL | RequestInfo) => {
      expect(String(input)).toBe(
        `https://approval.example/v3/applications/${APPLICATION_HANDLE}/launch-execution-status`
        + `?grantId=${GRANT_ID}&sessionId=${SESSION_ID}`,
      );
      return serviceResponse({
        schemaVersion: "programmable.launch-execution-status-view.v3",
        applicationId: "application-1",
        applicationHandle: APPLICATION_HANDLE,
        grantId: GRANT_ID,
        grantBindingHash: `sha256:${"1".repeat(64)}`,
        state: "not_started",
      });
    });
    const handler = createReleaseBoundBridge({
      authenticator: {
        async authenticate() {
          return {
            privyUserId: "did:privy:user",
            githubUserId: "123456789",
            githubUsername: null,
            githubPrincipalHash: `sha256:${"1".repeat(64)}` as const,
          };
        },
      },
      serviceOrigin: new URL("https://approval.example"),
      serviceFetch: serviceFetch as typeof fetch,
    });
    const headers = {
      accept: "application/json",
      authorization: "Bearer access-token-value",
      "x-privy-identity-token": "identity-token-value",
    };
    const response = await handler(new Request(
      `https://website.example/api/custom-launch/v3/applications/${APPLICATION_HANDLE}`
      + `/launch-execution-status?grantId=${GRANT_ID}&sessionId=${SESSION_ID}`,
      { headers },
    ), { kind: "launch-execution-status", applicationHandle: APPLICATION_HANDLE });
    expect(response.status).toBe(200);
    expect(serviceFetch).toHaveBeenCalledOnce();

    const wrongOrder = await handler(new Request(
      `https://website.example/api/custom-launch/v3/applications/${APPLICATION_HANDLE}`
      + `/launch-execution-status?sessionId=${SESSION_ID}&grantId=${GRANT_ID}`,
      { headers },
    ), { kind: "launch-execution-status", applicationHandle: APPLICATION_HANDLE });
    expect(wrongOrder.status).toBe(400);
    expect(serviceFetch).toHaveBeenCalledOnce();
  });

  it("gives UI code stable Website-only routes and typed response gates", async () => {
    const fetchV2 = vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
      expect(String(path)).toBe(
        `/api/custom-launch/v3/applications/${APPLICATION_HANDLE}/launch-execution-status`
        + `?grantId=${GRANT_ID}&sessionId=${SESSION_ID}`,
      );
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer access-token-value");
      expect(headers.get("x-privy-identity-token")).toBe("identity-token-value");
      return new Response(JSON.stringify({
        schemaVersion: "programmable.launch-execution-status-view.v3",
        applicationId: "application-1",
        applicationHandle: APPLICATION_HANDLE,
        grantId: GRANT_ID,
        grantBindingHash: `sha256:${"1".repeat(64)}`,
        state: "submission_pending",
        permitId: `sha256:${"3".repeat(64)}`,
        executionReservationId: "123e4567-e89b-42d3-a456-426614174003",
        reasonCode: "EXECUTION_READBACK_PENDING",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = createCustomLaunchWebsiteClientV2({
      session: {
        accessToken: "access-token-value",
        identityToken: "identity-token-value",
      },
      fetch: fetchV2 as typeof fetch,
    });
    await expect(client.launchExecutionStatus({
      applicationHandle: APPLICATION_HANDLE,
      grantId: GRANT_ID,
      sessionId: SESSION_ID,
    })).resolves.toMatchObject({ state: "submission_pending" });
  });

  it("derives application pagination state without a redundant wire field", async () => {
    const client = createCustomLaunchWebsiteClientV2({
      session: {
        accessToken: "access-token-value",
        identityToken: "identity-token-value",
      },
      fetch: vi.fn(async (path: string | URL | Request) => {
        expect(String(path)).toBe("/api/custom-launch/v3/applications?limit=50");
        return new Response(JSON.stringify({
          schemaVersion: "programmable.principal-custom-launch-application-list.v3",
          subject: {
            provider: "github",
            githubUserId: "123456789",
            githubPrincipalHash: `sha256:${"1".repeat(64)}`,
          },
          applications: [{
            applicationId: "wild-game",
            applicationHandle: APPLICATION_HANDLE,
            revisionId: "1",
            repositoryId: "2",
            repositoryFullName: "builder/wild-game",
            pullRequestNumber: 7,
            commitOid: "a".repeat(40),
            state: "changes_required",
            reasonCodes: ["CORRECTION_REQUIRED"],
            actionCodes: ["UPDATE_SOURCE"],
            correctionCount: 1,
            correctionPreview: [{
              correctionId: "sender-binding",
              summary: "Bind the deployment to the authenticated sender",
            }],
            receiptDigest: null,
            launchEntitlementBindingHash: null,
            updatedAt: "2026-08-05T12:00:00.000Z",
          }],
          nextCursor: "abcdefghijklmnop",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });

    const page = await client.applications();

    expect(page.nextCursor).toBe("abcdefghijklmnop");
    expect(page.hasMore).toBe(true);
    expect(page.applications[0]?.correctionPreview[0]).toEqual({
      correctionId: "sender-binding",
      summary: "Bind the deployment to the authenticated sender",
    });
  });

  it("forwards the principal presentation read and CAS commit without identity-token leakage", async () => {
    const responseData = {
      schemaVersion: "programmable.principal-launch-presentation-response.v2",
      applicationId: "application-1",
      applicationHandle: APPLICATION_HANDLE,
      grantId: GRANT_ID,
      grantBindingHash: `sha256:${"1".repeat(64)}`,
      version: 1,
      outcome: "current",
      presentationBindingHash: `sha256:${"2".repeat(64)}`,
      record: {
        schemaVersion: "programmable.launch-presentation-record.v1",
        applicationId: "application-1",
        grantId: GRANT_ID,
        grantBindingHash: `sha256:${"1".repeat(64)}`,
        approvedModelIdentity: {
          schemaVersion: "programmable.approved-launch-model-identity.v1",
          platformId: "programmable",
          category: "custom",
          launchFamily: "custom",
          modelId: "wild-game",
        },
        approvedModelIdentityHash: `sha256:${"3".repeat(64)}`,
        presentation: {
          schemaVersion: "programmable.launch-presentation-draft.v1",
          description: "Wild game",
          image: null,
          links: [],
        },
        provenance: {
          kind: "presentation-only",
          source: "current-grant-bound-builder-input",
          mutableFields: ["description", "image", "links"],
          protectedFields: ["source"],
          statement: "Presentation fields cannot change approved code.",
        },
        presentationBindingHash: `sha256:${"2".repeat(64)}`,
      },
      committedAt: "2026-08-05T12:00:00.000Z",
    };
    const serviceFetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe(
        `https://approval.example/v3/applications/${APPLICATION_HANDLE}/launch-presentation`,
      );
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer access-token-value");
      expect(headers.get("x-privy-identity-token")).toBeNull();
      if (init?.method === "PUT") {
        expect(headers.get("idempotency-key")).toBe("presentation-request-1");
        expect(JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer))).toMatchObject({
          schemaVersion: "programmable.principal-launch-presentation-commit-request.v1",
          applicationId: "application-1",
          expectedVersion: 0,
        });
      } else {
        expect(init?.method).toBe("GET");
      }
      return serviceResponse({
        ...responseData,
        outcome: init?.method === "PUT" ? "committed" : "current",
      });
    });
    const handler = createReleaseBoundBridge({
      authenticator: {
        async authenticate() {
          return {
            privyUserId: "did:privy:user",
            githubUserId: "123456789",
            githubUsername: "builder",
            githubPrincipalHash: `sha256:${"4".repeat(64)}` as const,
          };
        },
      },
      serviceOrigin: new URL("https://approval.example"),
      serviceFetch: serviceFetch as typeof fetch,
    });
    const headers = {
      accept: "application/json",
      authorization: "Bearer access-token-value",
      "x-privy-identity-token": "identity-token-value",
    };
    const read = await handler(new Request(
      `https://website.example/api/custom-launch/v3/applications/${APPLICATION_HANDLE}/launch-presentation`,
      { headers },
    ), { kind: "launch-presentation-read", applicationHandle: APPLICATION_HANDLE });
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ outcome: "current" });

    const commitBody = JSON.stringify({
      schemaVersion: "programmable.principal-launch-presentation-commit-request.v1",
      applicationId: "application-1",
      grantId: GRANT_ID,
      grantBindingHash: `sha256:${"1".repeat(64)}`,
      expectedVersion: 0,
      presentation: {
        schemaVersion: "programmable.launch-presentation-draft.v1",
        description: "Wild game",
        image: null,
        links: [],
      },
    });
    const commit = await handler(new Request(
      `https://website.example/api/custom-launch/v3/applications/${APPLICATION_HANDLE}/launch-presentation`,
      {
        method: "PUT",
        headers: {
          ...headers,
          "content-type": "application/json",
          "idempotency-key": "presentation-request-1",
        },
        body: commitBody,
      },
    ), { kind: "launch-presentation-commit", applicationHandle: APPLICATION_HANDLE });
    expect(commit.status).toBe(200);
    await expect(commit.json()).resolves.toMatchObject({ outcome: "committed" });
    expect(serviceFetch).toHaveBeenCalledTimes(2);
  });

  it("forwards the principal-bound launch authority refresh as one exact idempotent POST", async () => {
    const serviceFetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe(
        `https://approval.example/v3/applications/${APPLICATION_HANDLE}/launch-authority-refresh`,
      );
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer access-token-value");
      expect(headers.get("x-privy-identity-token")).toBeNull();
      expect(headers.get("idempotency-key")).toBe("launch-authority-refresh-request-1");
      expect(JSON.parse(new TextDecoder().decode(init?.body as ArrayBuffer))).toEqual({
        schemaVersion: "programmable.principal-launch-authority-refresh-request.v1",
      });
      return serviceResponse({
        schemaVersion: "programmable.principal-launch-authority-refresh.v1",
        state: "pending",
        requestId: `sha256:${"2".repeat(64)}`,
        requestDigest: `sha256:${"2".repeat(64)}`,
        applicationId: "application-1",
        applicationHandle: APPLICATION_HANDLE,
        grantId: GRANT_ID,
        grantBindingHash: `sha256:${"1".repeat(64)}`,
        requestedAt: "2026-08-05T12:00:00.000Z",
        observationHash: null,
        validUntil: null,
      }, 202);
    });
    const handler = createReleaseBoundBridge({
      authenticator: {
        async authenticate() {
          return {
            privyUserId: "did:privy:user",
            githubUserId: "123456789",
            githubUsername: "builder",
            githubPrincipalHash: `sha256:${"4".repeat(64)}` as const,
          };
        },
      },
      serviceOrigin: new URL("https://approval.example"),
      serviceFetch: serviceFetch as typeof fetch,
    });
    const body = JSON.stringify({
      schemaVersion: "programmable.principal-launch-authority-refresh-request.v1",
    });
    const response = await handler(new Request(
      `https://website.example/api/custom-launch/v3/applications/${APPLICATION_HANDLE}/launch-authority-refresh`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer access-token-value",
          "x-privy-identity-token": "identity-token-value",
          "content-type": "application/json",
          "idempotency-key": "launch-authority-refresh-request-1",
        },
        body,
      },
    ), { kind: "launch-authority-refresh", applicationHandle: APPLICATION_HANDLE });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ state: "pending" });
    expect(serviceFetch).toHaveBeenCalledOnce();
  });

  it("exposes the frozen descriptor and browser-wallet report routes without service authority", async () => {
    const serviceFetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer access-token-value");
      expect(headers.get("x-privy-identity-token")).toBeNull();
      if (url.endsWith(`/v3/applications/${APPLICATION_HANDLE}/launch-descriptor`)) {
        expect(init?.method).toBe("GET");
        return serviceResponse({
          schemaVersion: "programmable.launch-route-discovery.v3",
          applicationId: "application-1",
          applicationHandle: APPLICATION_HANDLE,
          grantId: GRANT_ID,
          grantBindingHash: `sha256:${"1".repeat(64)}`,
          descriptorHash: `sha256:${"2".repeat(64)}`,
          validUntil: "2026-08-05T12:05:00.000Z",
          configurationSchema: {
            schemaVersion: "programmable.launch-configuration-schema.v2",
            schemaHash: `sha256:${"3".repeat(64)}`,
            fields: [],
          },
          routes: [],
          defaultChoiceId: "route-1",
        });
      }
      if (url.endsWith(`/v2/launch-sessions/${SESSION_ID}/execution-preparation`)) {
        expect(init?.method).toBe("POST");
        expect(headers.get("idempotency-key")).toBe("execution-preparation-1");
        const body = JSON.parse(new TextDecoder().decode(init?.body as ArrayBuffer));
        expect(body).toMatchObject({
          schemaVersion: "programmable.browser-wallet-launch-preparation-request.v2",
          request: {
            schemaVersion: "programmable.launch-session-launch-authorize-request.v2",
            idempotencyKey: "execution-preparation-1",
            sessionId: SESSION_ID,
          },
          authorizationArtifactBase64Url: "YXV0aG9yaXphdGlvbg",
        });
        return serviceResponse({
          schemaVersion: "programmable.browser-wallet-launch-preparation.v2",
          transport: "browser-wallet-self-submit",
          walletExecutionKind: "eoa-direct",
          executionReservationId: EXECUTION_RESERVATION_ID,
          grantId: GRANT_ID,
          chainId: "1",
          browserWalletAction: {
            schemaVersion: "programmable.browser-wallet-action.v2",
            walletExecutionKind: "eoa-direct",
            method: "eth_sendTransaction",
            chainId: "1",
            params: [{
              from: `0x${"1".repeat(40)}`,
              to: `0x${"2".repeat(40)}`,
              data: "0x1234",
              value: "0x0",
            }],
          },
          browserWalletActionHash: `sha256:${"6".repeat(64)}`,
          senderBindingPolicyHash: `sha256:${"7".repeat(64)}`,
          expiresAt: "2026-08-05T12:05:00.000Z",
          authorityBindingHash: `sha256:${"8".repeat(64)}`,
        }, 201);
      }
      expect(url).toBe(
        `https://approval.example/v2/launch-preparations/${EXECUTION_RESERVATION_ID}/report`,
      );
      expect(init?.method).toBe("POST");
      expect(headers.get("idempotency-key")).toBe("report-request-1");
      expect(JSON.parse(new TextDecoder().decode(init?.body as ArrayBuffer))).toEqual({
        schemaVersion: "programmable.browser-wallet-launch-report-request.v2",
        transactionHash: `0x${"4".repeat(64)}`,
      });
      return serviceResponse({
        schemaVersion: "programmable.browser-wallet-launch-report-ack.v2",
        state: "verification_pending",
        disposition: "reported",
        reportId: "report-1",
        reportSequence: "1",
        executionReservationId: EXECUTION_RESERVATION_ID,
        transactionHash: `0x${"4".repeat(64)}`,
        reportBindingHash: `sha256:${"5".repeat(64)}`,
        reportedAt: "2026-08-05T12:00:00.000Z",
      }, 202);
    });
    const handler = createReleaseBoundBridge({
      authenticator: {
        async authenticate() {
          return {
            privyUserId: "did:privy:user",
            githubUserId: "123456789",
            githubUsername: null,
            githubPrincipalHash: `sha256:${"1".repeat(64)}` as const,
          };
        },
      },
      serviceOrigin: new URL("https://approval.example"),
      serviceFetch: serviceFetch as typeof fetch,
    });
    const readHeaders = {
      accept: "application/json",
      authorization: "Bearer access-token-value",
      "x-privy-identity-token": "identity-token-value",
    };
    const descriptor = await handler(new Request(
      `https://website.example/api/custom-launch/v3/applications/${APPLICATION_HANDLE}/launch-descriptor`,
      { headers: readHeaders },
    ), { kind: "launch-descriptor", applicationHandle: APPLICATION_HANDLE });
    expect(descriptor.status).toBe(200);

    const digest = (digit: string) => `sha256:${digit.repeat(64)}`;
    const executionPreparationBody = JSON.stringify({
      schemaVersion: "programmable.browser-wallet-launch-preparation-request.v2",
      request: {
        schemaVersion: "programmable.launch-session-launch-authorize-request.v2",
        audience: "programmable.launch-session.v2",
        idempotencyKey: "execution-preparation-1",
        grantId: GRANT_ID,
        grantBindingHash: digest("1"),
        selection: {
          schemaVersion: "programmable.untrusted-launch-wallet-selection.v2",
          launcherWallet: { namespace: "eip155:1", value: `0x${"1".repeat(40)}` },
          chainProfileId: "ethereum-mainnet-v1",
          requestedExecutionMode: "browser-wallet-self-submit",
          requestedRouteAdapterId: "canonical-create2-graph-v1",
          transactionValueWei: "0",
        },
        challengeId: CHALLENGE_ID,
        challengeBindingHash: digest("2"),
        sessionId: SESSION_ID,
        sessionBindingHash: digest("3"),
        preparationBindingHash: digest("4"),
        launchArtifactCommitmentHash: digest("5"),
        launchArtifactManifestHash: digest("6"),
        launchArtifactOutputSetHash: digest("7"),
        deploymentCalldataHash: digest("8"),
        permitRequestHash: digest("9"),
      },
      authorizationArtifactBase64Url: "YXV0aG9yaXphdGlvbg",
    });
    const executionPreparation = await handler(new Request(
      `https://website.example/api/custom-launch/v2/launch-sessions/${SESSION_ID}/execution-preparation`,
      {
        method: "POST",
        headers: {
          ...readHeaders,
          "content-type": "application/json",
          "idempotency-key": "execution-preparation-1",
        },
        body: executionPreparationBody,
      },
    ), { kind: "execution-prepare", sessionId: SESSION_ID });
    expect(executionPreparation.status).toBe(201);
    await expect(executionPreparation.json()).resolves.toMatchObject({
      schemaVersion: "programmable.browser-wallet-launch-preparation.v2",
      walletExecutionKind: "eoa-direct",
      browserWalletAction: {
        method: "eth_sendTransaction",
        params: [{ value: "0x0" }],
      },
    });

    const reportBody = JSON.stringify({
      schemaVersion: "programmable.browser-wallet-launch-report-request.v2",
      transactionHash: `0x${"4".repeat(64)}`,
    });
    const report = await handler(new Request(
      `https://website.example/api/custom-launch/v2/launch-preparations/${EXECUTION_RESERVATION_ID}/report`,
      {
        method: "POST",
        headers: {
          ...readHeaders,
          "content-type": "application/json",
          "idempotency-key": "report-request-1",
        },
        body: reportBody,
      },
    ), { kind: "transaction-report", executionReservationId: EXECUTION_RESERVATION_ID });
    expect(report.status).toBe(202);
    expect(serviceFetch).toHaveBeenCalledTimes(3);
  });

  it("proxies authenticated grant reissue by old grant id with one exact request", async () => {
    const serviceFetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe(
        `https://approval.example/v2/launch-grants/${GRANT_ID}/reissue`,
      );
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer access-token-value");
      expect(headers.get("x-privy-identity-token")).toBeNull();
      expect(headers.get("idempotency-key")).toBe("grant-reissue-request-1");
      expect(JSON.parse(new TextDecoder().decode(init?.body as ArrayBuffer))).toEqual({
        schemaVersion: "programmable.browser-wallet-grant-reissue-request.v1",
      });
      return serviceResponse({
        schemaVersion: "programmable.browser-wallet-grant-reissue.v2",
        state: "pending",
        requestId: "123e4567-e89b-42d3-a456-426614174010",
        requestDigest: `sha256:${"1".repeat(64)}`,
        analysisTaskId: "123e4567-e89b-42d3-a456-426614174011",
        applicationId: "application-1",
        applicationHandle: APPLICATION_HANDLE,
        oldGrantId: GRANT_ID,
        newGrantId: null,
        newGrantBindingHash: null,
        requestedAt: "2026-08-05T12:00:00.000Z",
      }, 202);
    });
    const handler = createReleaseBoundBridge({
      authenticator: {
        async authenticate() {
          return {
            privyUserId: "did:privy:user",
            githubUserId: "123456789",
            githubUsername: "builder",
            githubPrincipalHash: `sha256:${"4".repeat(64)}` as const,
          };
        },
      },
      serviceOrigin: new URL("https://approval.example"),
      serviceFetch: serviceFetch as typeof fetch,
    });
    const response = await handler(new Request(
      `https://website.example/api/custom-launch/v2/launch-grants/${GRANT_ID}/reissue`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer access-token-value",
          "x-privy-identity-token": "identity-token-value",
          "content-type": "application/json",
          "idempotency-key": "grant-reissue-request-1",
        },
        body: JSON.stringify({
          schemaVersion: "programmable.browser-wallet-grant-reissue-request.v1",
        }),
      },
    ), { kind: "grant-reissue", oldGrantId: GRANT_ID });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "programmable.browser-wallet-grant-reissue.v2",
      state: "pending",
      oldGrantId: GRANT_ID,
    });
    expect(serviceFetch).toHaveBeenCalledOnce();
  });
});
