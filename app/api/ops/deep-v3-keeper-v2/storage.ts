import "server-only";

import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get,
  put,
} from "@vercel/blob";

import type { DeepV3KeeperV2ControlStore } from "../../../../ops/deep-keeper-v3/control-v2.mjs";

const MAX_CONTROL_BLOB_BYTES = 2 * 1024 * 1024;

export function createDeepV3KeeperV2ControlStore(
  token = process.env.OPS_BLOB_READ_WRITE_TOKEN,
): DeepV3KeeperV2ControlStore {
  if (!token) throw new Error("Keeper storage is unavailable");
  return {
    async read(path) {
      try {
        const result = await get(path, {
          access: "private",
          token,
          useCache: false,
        });
        if (!result) return null;
        if (
          result.statusCode !== 200 ||
          !result.stream ||
          !Number.isSafeInteger(result.blob.size) ||
          result.blob.size < 1 ||
          result.blob.size > MAX_CONTROL_BLOB_BYTES
        ) {
          throw new Error("Keeper storage read failed");
        }
        return {
          value: await new Response(result.stream).text(),
          etag: result.blob.etag,
        };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },
    async putIfAbsent(path, value) {
      try {
        const result = await put(path, value, {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 0,
          token,
        });
        return { etag: result.etag };
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return null;
        throw error;
      }
    },
    async putIfMatch(path, value, etag) {
      try {
        const result = await put(path, value, {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true,
          ifMatch: etag,
          cacheControlMaxAge: 0,
          token,
        });
        return { etag: result.etag };
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return null;
        throw error;
      }
    },
  };
}
