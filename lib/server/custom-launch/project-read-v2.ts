import "server-only";

import { canonicalizeJson } from "../projection-target/canonical-json";
import {
  createPrivyGitHubPrincipalAuthenticatorV1,
  GitHubPrincipalAuthenticationErrorV1,
  type WebsiteEntitlementReadAuthenticatorV1,
} from "../projection-target/github-entitlement";
import type {
  PostgresProjectionTargetAtomicStoreV1,
} from "../projection-target/postgres-store";
import { getProductionWebsiteProjectionTargetV1 } from "../projection-target/website-target";
import { isCustomLaunchPublicEnabled } from "./public-readiness";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export function createCustomLaunchProjectReadHandlersV2(input: Readonly<{
  authenticator: WebsiteEntitlementReadAuthenticatorV1;
  store: PostgresProjectionTargetAtomicStoreV1;
}>) {
  if (typeof input.authenticator?.authenticate !== "function"
    || input.store === null || typeof input.store !== "object") {
    throw new TypeError("custom launch project read dependencies are invalid");
  }
  return Object.freeze({
    async project(request: Request, projectId: string): Promise<Response> {
      if (!validReadRequest(request) || !DIGEST.test(projectId)) {
        return errorResponse(400, "invalid_project_request");
      }
      try {
        const project = await input.store.findFinalizedCustomLaunchByProjectId({
          projectId: projectId as `sha256:${string}`,
          signal: request.signal,
        });
        if (project === null) return errorResponse(404, "project_not_found");
        return jsonResponse(200, {
          schemaVersion: "programmable.custom-launch-project-view.v2",
          project,
        });
      } catch {
        return errorResponse(503, "project_store_unavailable");
      }
    },
    async profile(request: Request): Promise<Response> {
      if (!validReadRequest(request)) return errorResponse(400, "invalid_profile_request");
      let principal;
      try {
        principal = await input.authenticator.authenticate(request);
      } catch (error) {
        if (error instanceof GitHubPrincipalAuthenticationErrorV1) {
          return errorResponse(error.status, error.code);
        }
        return errorResponse(401, "privy_session_rejected");
      }
      try {
        const projects = await input.store.findFinalizedCustomLaunchesByPrincipal({
          githubPrincipalHash: principal.githubPrincipalHash,
          signal: request.signal,
        });
        return jsonResponse(200, {
          schemaVersion: "programmable.authenticated-custom-launch-profile.v2",
          subject: {
            provider: "github",
            githubUserId: principal.githubUserId,
            githubUsername: principal.githubUsername,
            githubPrincipalHash: principal.githubPrincipalHash,
          },
          projects,
        });
      } catch {
        return errorResponse(503, "project_store_unavailable");
      }
    },
  });
}

let productionHandlers: ReturnType<typeof createCustomLaunchProjectReadHandlersV2> | null = null;

async function production() {
  const target = getProductionWebsiteProjectionTargetV1();
  await target.assertProductionReadiness();
  productionHandlers ??= createCustomLaunchProjectReadHandlersV2({
    authenticator: createPrivyGitHubPrincipalAuthenticatorV1(),
    store: target.store,
  });
  return productionHandlers;
}

export async function handleProductionCustomLaunchProjectReadV2(
  request: Request,
  projectId: string,
): Promise<Response> {
  if (!isCustomLaunchPublicEnabled()) {
    return errorResponse(503, "custom_launch_not_public");
  }
  try {
    return await (await production()).project(request, projectId);
  } catch {
    return errorResponse(503, "project_service_unavailable");
  }
}

export async function handleProductionCustomLaunchProfileReadV2(
  request: Request,
): Promise<Response> {
  if (!isCustomLaunchPublicEnabled()) {
    return errorResponse(503, "custom_launch_not_public");
  }
  try {
    return await (await production()).profile(request);
  } catch {
    return errorResponse(503, "project_service_unavailable");
  }
}

function validReadRequest(request: Request): boolean {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  return url.username === ""
    && url.password === ""
    && url.search === ""
    && url.hash === ""
    && request.body === null
    && !request.headers.has("content-type")
    && request.headers.get("accept")?.trim().toLowerCase() === "application/json";
}

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(canonicalizeJson(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      vary: "authorization, x-privy-identity-token",
    },
  });
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, {
    schemaVersion: "programmable.custom-launch-website-error.v2",
    code,
    message: code,
  });
}
