import { put } from "@vercel/blob";
import { PrivyClient } from "@privy-io/node";
import { NextResponse } from "next/server";

import {
  hasValidTokenImageSignature,
  MAX_TOKEN_IMAGE_UPLOAD_BYTES,
} from "@/lib/token-image";

export const runtime = "nodejs";
export const maxDuration = 10;

const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function errorResponse(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: responseHeaders },
  );
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

async function verifyPrivySession(request: Request) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  const accessToken = getBearerToken(request);
  if (!appId || !appSecret || !accessToken) return null;

  const privy = new PrivyClient({ appId, appSecret });
  try {
    return await privy.utils().auth().verifyAccessToken(accessToken);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const blobToken =
    process.env.TOKEN_IMAGE_BLOB_READ_WRITE_TOKEN?.trim();
  if (!blobToken) {
    return errorResponse("Image uploads are temporarily unavailable", 503);
  }

  const contentLength = Number(
    request.headers.get("content-length") ?? "0",
  );
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_TOKEN_IMAGE_UPLOAD_BYTES + 100_000
  ) {
    return errorResponse("Choose a smaller image", 413);
  }

  const session = await verifyPrivySession(request);
  if (!session) {
    return errorResponse("Connect your wallet and try again", 401);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("The image could not be read", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return errorResponse("Choose an image", 400);
  }
  if (
    file.type !== "image/webp" ||
    file.size === 0 ||
    file.size > MAX_TOKEN_IMAGE_UPLOAD_BYTES ||
    !(await hasValidTokenImageSignature(file))
  ) {
    return errorResponse("Choose a valid token image", 400);
  }

  try {
    const blob = await put(
      `token-images/${crypto.randomUUID()}.webp`,
      file,
      {
        access: "public",
        addRandomSuffix: true,
        cacheControlMaxAge: 31_536_000,
        contentType: "image/webp",
        token: blobToken,
      },
    );

    return NextResponse.json(
      { url: blob.url },
      { status: 201, headers: responseHeaders },
    );
  } catch {
    return errorResponse("The image could not be uploaded", 502);
  }
}
