import "server-only";

import { canonicalizeJson } from "../projection-target/canonical-json";
import type { Sha256Digest } from "../projection-target/hashing";
import { getProductionWebsiteProjectionTargetV1 } from
  "../projection-target/website-target";
import { isCustomLaunchRegistryPublicReadEnabled } from "./public-readiness";
import type { RegistryCustomLaunchPublicReadStoreV1 } from
  "./registry-public-store-v1";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export function createRegistryCustomLaunchPublicReadHandlersV1(
  input: Readonly<{
    store: RegistryCustomLaunchPublicReadStoreV1;
  }>,
) {
  if (input.store === null || typeof input.store !== "object"
    || input.store.sourceLane !== "registry.custom-launched"
    || typeof input.store.findVerifiedRegistryCustomLaunchesPublic !== "function"
    || typeof input.store.findVerifiedRegistryCustomLaunchByProjectId !== "function") {
    throw new TypeError("registry custom public read dependencies are invalid");
  }
  return Object.freeze({
    async feed(request: Request): Promise<Response> {
      if (!validReadRequest(request)) {
        return errorResponse(400, "invalid_registry_custom_feed_request");
      }
      try {
        const records = await input.store.findVerifiedRegistryCustomLaunchesPublic({
          signal: request.signal,
        });
        return jsonResponse(200, {
          schemaVersion: "programmable.registry-custom-launch-public-feed.v1",
          records,
        });
      } catch {
        return errorResponse(503, "registry_custom_store_unavailable");
      }
    },
    async detail(request: Request, projectId: string): Promise<Response> {
      if (!validReadRequest(request) || !DIGEST.test(projectId)) {
        return errorResponse(400, "invalid_registry_custom_detail_request");
      }
      try {
        const record = await input.store.findVerifiedRegistryCustomLaunchByProjectId({
          projectId: projectId as Sha256Digest,
          signal: request.signal,
        });
        if (record === null) return errorResponse(404, "registry_custom_not_found");
        return jsonResponse(200, {
          schemaVersion: "programmable.registry-custom-launch-public-view.v1",
          record,
        });
      } catch {
        return errorResponse(503, "registry_custom_store_unavailable");
      }
    },
  });
}

let productionHandlers:
ReturnType<typeof createRegistryCustomLaunchPublicReadHandlersV1> | null = null;

async function production() {
  const target = getProductionWebsiteProjectionTargetV1();
  await target.assertProductionReadiness();
  productionHandlers ??= createRegistryCustomLaunchPublicReadHandlersV1({
    store: target.registryCustomPublicStore,
  });
  return productionHandlers;
}

export async function handleProductionRegistryCustomLaunchFeedV1(
  request: Request,
): Promise<Response> {
  if (!isCustomLaunchRegistryPublicReadEnabled()) {
    return errorResponse(503, "custom_launch_not_public");
  }
  try {
    return await (await production()).feed(request);
  } catch {
    return errorResponse(503, "registry_custom_service_unavailable");
  }
}

export async function handleProductionRegistryCustomLaunchDetailV1(
  request: Request,
  projectId: string,
): Promise<Response> {
  if (!isCustomLaunchRegistryPublicReadEnabled()) {
    return errorResponse(503, "custom_launch_not_public");
  }
  try {
    return await (await production()).detail(request, projectId);
  } catch {
    return errorResponse(503, "registry_custom_service_unavailable");
  }
}

function validReadRequest(request: Request): boolean {
  if (request.method !== "GET" || request.body !== null
    || request.headers.has("content-type")
    || request.headers.get("accept")?.trim().toLowerCase() !== "application/json") {
    return false;
  }
  const url = new URL(request.url);
  return url.username === "" && url.password === ""
    && url.search === "" && url.hash === "";
}

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>): Response {
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
    schemaVersion: "programmable.registry-custom-launch-public-error.v1",
    code,
    message: code,
  });
}
