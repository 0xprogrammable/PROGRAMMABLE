import "server-only";

import descriptorSource from
  "@/config/generic-launch-foundation.prelaunch.v1.json";
import { canonicalizeJson } from "../projection-target/canonical-json";
import type { Sha256Digest } from "../projection-target/hashing";
import {
  parseGenericLaunchFoundationDescriptorV1,
  parseGenericLaunchRecordV1,
  type GenericLaunchFoundationDescriptorV1,
  type GenericLaunchRecordV1,
} from "./generic-launch-contract-v1";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export interface GenericLaunchReadStoreV1 {
  readonly sourceLane: "generic.finalized-launch";
  readonly bindingHash: Sha256Digest;
  findFinalizedLaunches(input: Readonly<{
    limit: number;
    signal: AbortSignal;
  }>): Promise<readonly GenericLaunchRecordV1[]>;
  findFinalizedLaunchByRecordHash(input: Readonly<{
    recordHash: Sha256Digest;
    signal: AbortSignal;
  }>): Promise<GenericLaunchRecordV1 | null>;
}

export function createGenericLaunchReadHandlersV1(
  input: Readonly<{
    descriptor: GenericLaunchFoundationDescriptorV1;
    store: GenericLaunchReadStoreV1 | null;
  }>,
) {
  const descriptor = parseGenericLaunchFoundationDescriptorV1(input.descriptor);
  if (descriptor.activation === true) {
    assertStore(input.store);
    if (input.store.bindingHash !== descriptor.readModelBindingHash) {
      throw new TypeError("generic launch read store binding is invalid");
    }
  } else if (input.store !== null) {
    throw new TypeError("disabled generic launch foundation cannot bind a read store");
  }

  return Object.freeze({
    async feed(request: Request): Promise<Response> {
      if (!validReadRequest(request)) {
        return errorResponse(400, "invalid_generic_launch_feed_request");
      }
      if (descriptor.activation === false || input.store === null) {
        return errorResponse(503, "generic_launch_foundation_not_active");
      }
      try {
        const records = await input.store.findFinalizedLaunches({
          limit: 100,
          signal: request.signal,
        });
        if (!Array.isArray(records) || records.length > 100) {
          throw new TypeError("generic launch feed exceeds its bound");
        }
        const parsed = records.map((record) =>
          assertDescriptorBoundRecord(descriptor, record));
        if (new Set(parsed.map(({ recordHash }) => recordHash)).size
          !== parsed.length) {
          throw new TypeError("generic launch feed contains duplicate records");
        }
        const verified = Object.freeze(parsed.sort((left, right) =>
          right.executionResult.finality.observedAt.localeCompare(
            left.executionResult.finality.observedAt,
          ) || left.recordHash.localeCompare(right.recordHash)));
        return jsonResponse(200, {
          schemaVersion: "programmable.generic-launch-feed.v1",
          records: verified,
        });
      } catch {
        return errorResponse(503, "generic_launch_read_model_unavailable");
      }
    },

    async detail(request: Request, recordHash: string): Promise<Response> {
      if (!validReadRequest(request) || !DIGEST.test(recordHash)) {
        return errorResponse(400, "invalid_generic_launch_detail_request");
      }
      if (descriptor.activation === false || input.store === null) {
        return errorResponse(503, "generic_launch_foundation_not_active");
      }
      try {
        const record = await input.store.findFinalizedLaunchByRecordHash({
          recordHash: recordHash as Sha256Digest,
          signal: request.signal,
        });
        if (record === null) {
          return errorResponse(404, "generic_launch_not_found");
        }
        const verified = assertDescriptorBoundRecord(descriptor, record);
        if (verified.recordHash !== recordHash) {
          throw new TypeError("generic launch read-model key does not match record");
        }
        return jsonResponse(200, {
          schemaVersion: "programmable.generic-launch-view.v1",
          record: verified,
        });
      } catch {
        return errorResponse(503, "generic_launch_read_model_unavailable");
      }
    },
  });
}

export const PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1 =
  parseGenericLaunchFoundationDescriptorV1(descriptorSource);

const prelaunchHandlers = createGenericLaunchReadHandlersV1({
  descriptor: PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1,
  store: null,
});

export function handleProductionGenericLaunchFeedV1(
  request: Request,
): Promise<Response> {
  return prelaunchHandlers.feed(request);
}

export function handleProductionGenericLaunchDetailV1(
  request: Request,
  recordHash: string,
): Promise<Response> {
  return prelaunchHandlers.detail(request, recordHash);
}

function assertDescriptorBoundRecord(
  descriptor: Extract<GenericLaunchFoundationDescriptorV1, { activation: true }> |
    GenericLaunchFoundationDescriptorV1,
  raw: unknown,
): GenericLaunchRecordV1 {
  if (descriptor.activation !== true || descriptor.routeAdapterReleases === null) {
    throw new TypeError("generic launch foundation is not active");
  }
  const record = parseGenericLaunchRecordV1(raw);
  if (!descriptor.routeAdapterReleases.some(
    ({ releaseHash }) => releaseHash === record.routeAdapterRelease.releaseHash,
  )) {
    throw new TypeError("generic launch record uses an unbound adapter release");
  }
  return record;
}

function assertStore(
  store: GenericLaunchReadStoreV1 | null,
): asserts store is GenericLaunchReadStoreV1 {
  if (store === null || typeof store !== "object"
    || store.sourceLane !== "generic.finalized-launch"
    || !DIGEST.test(store.bindingHash)
    || typeof store.findFinalizedLaunches !== "function"
    || typeof store.findFinalizedLaunchByRecordHash !== "function") {
    throw new TypeError("active generic launch read store is invalid");
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
    schemaVersion: "programmable.generic-launch-error.v1",
    code,
    message: code,
  });
}
