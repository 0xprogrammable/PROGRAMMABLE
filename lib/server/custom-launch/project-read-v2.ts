import "server-only";

import { canonicalizeJson } from "../projection-target/canonical-json";
import type {
  RegistryCustomLaunchPublicReadStoreV1,
} from "./registry-public-store-v1";
import { getProductionWebsiteRegistryCustomPublicReadTargetV1 } from
  "../projection-target/website-target";
import { isCustomLaunchRegistryPublicReadEnabled } from "./public-readiness";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export function createCustomLaunchProjectReadHandlersV2(input: Readonly<{
  store: RegistryCustomLaunchPublicReadStoreV1;
}>) {
  if (input.store === null || typeof input.store !== "object"
    || input.store.sourceLane !== "registry.custom-launched"
    || typeof input.store.findFinalizedCustomLaunchesPublic !== "function"
    || typeof input.store.findFinalizedCustomLaunchByProjectId !== "function"
    || typeof input.store.findFinalizedCustomLaunchesByWallet !== "function"
    || typeof input.store.findVerifiedRegistryCustomLaunchesPublic !== "function"
    || typeof input.store.findVerifiedRegistryCustomLaunchByProjectId !== "function") {
    throw new TypeError("custom launch project read dependencies are invalid");
  }
  return Object.freeze({
    async directory(request: Request): Promise<Response> {
      if (!validReadRequest(request)) return errorResponse(400, "invalid_directory_request");
      try {
        const projects = await input.store.findFinalizedCustomLaunchesPublic({
          signal: request.signal,
        });
        return publicJsonResponse(200, {
          schemaVersion: "programmable.public-custom-launch-directory.v1",
          projects,
        });
      } catch {
        return errorResponse(503, "project_store_unavailable");
      }
    },
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
      const subject = validWalletProfileRequest(request);
      if (subject === null) return errorResponse(400, "invalid_profile_request");
      try {
        const projects = await input.store.findFinalizedCustomLaunchesByWallet({
          namespace: subject.namespace,
          value: subject.value,
          signal: request.signal,
        });
        return publicJsonResponse(200, {
          schemaVersion: "programmable.custom-launch-wallet-profile.v2",
          subject,
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
  const target = getProductionWebsiteRegistryCustomPublicReadTargetV1();
  await target.assertProductionReadiness();
  productionHandlers ??= createCustomLaunchProjectReadHandlersV2({
    store: target.store,
  });
  return productionHandlers;
}

export async function handleProductionCustomLaunchProjectReadV2(
  request: Request,
  projectId: string,
): Promise<Response> {
  if (!isCustomLaunchRegistryPublicReadEnabled()) {
    return errorResponse(503, "custom_launch_not_public");
  }
  try {
    return await (await production()).project(request, projectId);
  } catch {
    return errorResponse(503, "project_service_unavailable");
  }
}

export async function handleProductionCustomLaunchDirectoryReadV1(
  request: Request,
): Promise<Response> {
  if (!isCustomLaunchRegistryPublicReadEnabled()) {
    return errorResponse(503, "custom_launch_not_public");
  }
  try {
    return await (await production()).directory(request);
  } catch {
    return errorResponse(503, "project_service_unavailable");
  }
}

export async function handleProductionCustomLaunchProfileReadV2(
  request: Request,
): Promise<Response> {
  if (!isCustomLaunchRegistryPublicReadEnabled()) {
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

function validWalletProfileRequest(
  request: Request,
): Readonly<{ namespace: string; value: string }> | null {
  if (request.method !== "GET" || request.body !== null
    || request.headers.has("content-type")
    || request.headers.get("accept")?.trim().toLowerCase()
      !== "application/json") return null;
  const url = new URL(request.url);
  if (url.username !== "" || url.password !== "" || url.hash !== ""
    || [...url.searchParams.keys()].some((key) =>
      key !== "namespace" && key !== "wallet")
    || url.searchParams.getAll("namespace").length !== 1
    || url.searchParams.getAll("wallet").length !== 1) return null;
  const namespace = url.searchParams.get("namespace") ?? "";
  const value = url.searchParams.get("wallet") ?? "";
  if (!/^eip155:[1-9][0-9]*$/u.test(namespace)
    || !/^0x[0-9a-f]{40}$/u.test(value)) return null;
  return Object.freeze({ namespace, value });
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

function publicJsonResponse(
  status: number,
  body: Readonly<Record<string, unknown>>,
): Response {
  return new Response(canonicalizeJson(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
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
