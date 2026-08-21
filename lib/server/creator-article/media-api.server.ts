import "server-only";

import { randomUUID } from "node:crypto";

import { put, type PutBlobResult } from "@vercel/blob";

import {
  CreatorArticleAuthorityErrorV1,
  createProductionCreatorArticleAuthorityReaderV1,
  requireCreatorArticleAuthorityV1,
  type CreatorArticleAuthorityReaderV1,
} from "./authority.server";
import {
  inspectCreatorArticleImageOutputV1,
  MAX_CREATOR_ARTICLE_IMAGE_INPUT_BYTES,
  MAX_CREATOR_ARTICLE_IMAGE_OUTPUT_BYTES,
  verifyAndTransformCreatorArticleImageV1,
  type CreatorArticleMediaKindV1,
} from "./image.server";
import { creatorArticleMediaPathnameV1 } from "../../creator-article/media";
import {
  createPrivyWalletPrincipalAuthenticatorV1,
  WalletPrincipalAuthenticationErrorV1,
  type WalletPrincipalAuthenticatorV1,
} from "./wallet-principal.server";

const READBACK_TIMEOUT_MS = 5_000;

export type CreatorArticleMediaBoundaryV1 = Readonly<{
  put(pathname: string, bytes: Uint8Array): Promise<PutBlobResult>;
  read(url: string, signal: AbortSignal): Promise<Uint8Array>;
}>;

export function createCreatorArticleMediaUploadHandlerV1(input: Readonly<{
  authenticator: WalletPrincipalAuthenticatorV1;
  authorityReader: CreatorArticleAuthorityReaderV1;
  media: CreatorArticleMediaBoundaryV1;
}>) {
  return async function uploadCreatorArticleMedia(
    request: Request,
    tokenAddress: string,
  ): Promise<Response> {
    if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "POST");
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength)
      && contentLength > MAX_CREATOR_ARTICLE_IMAGE_INPUT_BYTES + 100_000) {
      return errorResponse(413, "image_too_large");
    }
    try {
      const principal = await input.authenticator.authenticate(request);
      const authority = await requireCreatorArticleAuthorityV1({
        reader: input.authorityReader,
        principal,
        tokenAddress,
        signal: request.signal,
      });
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return errorResponse(400, "invalid_media_request");
      }
      const file = form.get("file");
      const kind = form.get("kind");
      if (!(file instanceof File) || (kind !== "banner" && kind !== "inline")) {
        return errorResponse(400, "invalid_media_request");
      }
      if (file.size === 0 || file.size > MAX_CREATOR_ARTICLE_IMAGE_INPUT_BYTES) {
        return errorResponse(413, "image_too_large");
      }
      let verified;
      try {
        verified = await verifyAndTransformCreatorArticleImageV1({
          bytes: new Uint8Array(await file.arrayBuffer()),
          kind: kind as CreatorArticleMediaKindV1,
        });
      } catch {
        return errorResponse(400, "invalid_image");
      }
      const pathname = creatorArticleMediaPathnameV1({
        tokenAddress: authority.tokenAddress,
        mediaId: randomUUID(),
        kind: verified.kind,
        width: verified.width,
        height: verified.height,
        contentSha256: verified.contentSha256,
      });
      const blob = await input.media.put(pathname, verified.bytes);
      if (
        blob.pathname !== pathname
        || blob.contentType !== "image/webp"
        || !blob.etag
        || new URL(blob.url).protocol !== "https:"
      ) throw new TypeError("Creator article media write is invalid");
      const timeout = AbortSignal.timeout(READBACK_TIMEOUT_MS);
      const readback = await input.media.read(
        blob.url,
        AbortSignal.any([request.signal, timeout]),
      );
      await inspectCreatorArticleImageOutputV1(readback, {
        contentSha256: verified.contentSha256,
        contentType: verified.contentType,
        width: verified.width,
        height: verified.height,
        kind: verified.kind,
      });
      return jsonResponse(201, {
        schemaVersion: "programmable.creator-article-media.v1",
        media: {
          url: blob.url,
          contentSha256: verified.contentSha256,
          contentType: verified.contentType,
          width: verified.width,
          height: verified.height,
          kind: verified.kind,
        },
      });
    } catch (error) {
      if (error instanceof WalletPrincipalAuthenticationErrorV1) {
        return errorResponse(error.status, error.code);
      }
      if (error instanceof CreatorArticleAuthorityErrorV1) {
        return errorResponse(error.status, error.code);
      }
      console.error("Creator article media upload failed", {
        name: error instanceof Error ? error.name : "CreatorArticleMediaError",
      });
      return errorResponse(502, "media_upload_failed");
    }
  };
}

let productionHandler: ReturnType<typeof createCreatorArticleMediaUploadHandlerV1> | null = null;

export function getProductionCreatorArticleMediaUploadHandlerV1() {
  if (productionHandler !== null) return productionHandler;
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new TypeError("BLOB_READ_WRITE_TOKEN is not configured");
  productionHandler = createCreatorArticleMediaUploadHandlerV1({
    authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    authorityReader: createProductionCreatorArticleAuthorityReaderV1(),
    media: Object.freeze({
      async put(pathname, bytes) {
        return put(pathname, bytes, {
          access: "public",
          token,
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: "image/webp",
          cacheControlMaxAge: 31_536_000,
        });
      },
      async read(url, signal) {
        const response = await fetch(url, { signal, cache: "no-store" });
        if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/webp") {
          throw new TypeError("Creator article media readback failed");
        }
        const length = Number(response.headers.get("content-length") ?? "0");
        if (Number.isFinite(length) && length > MAX_CREATOR_ARTICLE_IMAGE_OUTPUT_BYTES) {
          throw new TypeError("Creator article media readback is too large");
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_CREATOR_ARTICLE_IMAGE_OUTPUT_BYTES) {
          throw new TypeError("Creator article media readback is too large");
        }
        return bytes;
      },
    }),
  });
  return productionHandler;
}

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>, allow?: string) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    Vary: "Authorization, X-Privy-Identity-Token",
  });
  if (allow) headers.set("Allow", allow);
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(status: number, code: string, allow?: string) {
  return jsonResponse(status, {
    schemaVersion: "programmable.creator-article-error.v1",
    code,
  }, allow);
}
