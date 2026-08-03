import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  unstable_cache: (callback: unknown) => callback,
}));

import { POST } from "../app/api/alchemy/webhook/route";
import { ALCHEMY_EXPLORE_CACHE_TAG } from "../lib/alchemy/explore.server";

const SIGNING_KEY = "alchemy-webhook-signing-key-at-least-32-bytes";

function request(
  body: string,
  input: Readonly<{
    signature?: string;
    contentType?: string;
    contentLength?: string;
  }> = {},
) {
  const signature = input.signature ??
    createHmac("sha256", SIGNING_KEY).update(body, "utf8").digest("hex");
  return new Request("https://programmable.family/api/alchemy/webhook", {
    method: "POST",
    headers: {
      "content-length": input.contentLength ?? String(Buffer.byteLength(body)),
      "content-type": input.contentType ?? "application/json",
      "x-alchemy-signature": signature,
    },
    body,
  });
}

describe("Alchemy webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ALCHEMY_WEBHOOK_SIGNING_KEY", SIGNING_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("authenticates the exact raw JSON body and revalidates Explore", async () => {
    const body = '{ "webhookId": "wh_1", "event": { "block": 123 } }\n';

    const response = await POST(request(body));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      ALCHEMY_EXPLORE_CACHE_TAG,
      "max",
    );
  });

  it("rejects a signature for a normalized body", async () => {
    const body = '{ "event": { "block": 123 } }';
    const normalizedSignature = createHmac("sha256", SIGNING_KEY)
      .update('{"event":{"block":123}}', "utf8")
      .digest("hex");

    const response = await POST(request(body, {
      signature: normalizedSignature,
    }));

    expect(response.status).toBe(401);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects signed malformed JSON", async () => {
    const response = await POST(request('{"event":'));

    expect(response.status).toBe(400);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies before revalidation", async () => {
    const response = await POST(request("{}", {
      contentLength: String(128 * 1024 + 1),
    }));

    expect(response.status).toBe(413);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("enforces the body limit even when content-length is understated", async () => {
    const body = JSON.stringify({ data: "x".repeat(128 * 1024) });

    const response = await POST(request(body, { contentLength: "0" }));

    expect(response.status).toBe(413);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("fails closed when the server-only signing key is missing", async () => {
    vi.stubEnv("ALCHEMY_WEBHOOK_SIGNING_KEY", "");

    const response = await POST(request("{}"));

    expect(response.status).toBe(503);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
