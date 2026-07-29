import { NextResponse } from "next/server";

import {
  isProgrammableTokenImageUrl,
  MAX_TOKEN_IMAGE_UPLOAD_BYTES,
  PROGRAMMABLE_TOKEN_IMAGE_HOST,
} from "@/lib/token-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

function errorResponse(status: number) {
  return NextResponse.json(
    { error: "Token image is unavailable" },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ asset: string }> },
) {
  const { asset } = await context.params;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}\.webp$/.test(asset)) {
    return errorResponse(400);
  }

  const source =
    `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/${asset}`;
  if (!isProgrammableTokenImageUrl(source)) return errorResponse(400);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(source, {
      cache: "force-cache",
      headers: { Accept: "image/webp" },
      redirect: "error",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const contentLength = Number(
      response.headers.get("content-length") ?? "0",
    );
    if (
      !response.ok ||
      !contentType.toLowerCase().startsWith("image/webp") ||
      !Number.isFinite(contentLength) ||
      contentLength <= 0 ||
      contentLength > MAX_TOKEN_IMAGE_UPLOAD_BYTES ||
      !response.body
    ) {
      return errorResponse(502);
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(contentLength),
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return errorResponse(502);
  } finally {
    clearTimeout(timeout);
  }
}
