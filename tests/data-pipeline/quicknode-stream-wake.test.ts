import { createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { verifyQuickNodeStreamWake } from "../../lib/data-pipeline/quicknode-stream-wake.server";

const SECRET = "quicknode-stream-secret-at-least-32-bytes";
const NOW_MS = Date.parse("2026-08-02T12:00:00.000Z");
const TIMESTAMP = String(Math.floor(NOW_MS / 1_000));
const NONCE = "0123456789abcdef0123456789abcdef";

function signedRequest(
  payload: string,
  input: Readonly<{
    secret?: string;
    timestamp?: string;
    gzip?: boolean;
    signature?: string;
  }> = {},
) {
  const timestamp = input.timestamp ?? TIMESTAMP;
  const signature =
    input.signature ??
    createHmac("sha256", input.secret ?? SECRET)
      .update(NONCE)
      .update(timestamp)
      .update(payload)
      .digest("hex");
  const body = input.gzip ? gzipSync(payload) : payload;
  return new Request("https://programmable.family/api/ops/projector-wake", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.gzip ? { "content-encoding": "gzip" } : {}),
      "x-qn-nonce": NONCE,
      "x-qn-timestamp": timestamp,
      "x-qn-signature": signature,
    },
    body,
  });
}

function expectWakeError(status: number) {
  return expect.objectContaining({
    name: "QuickNodeStreamWakeError",
    status,
  });
}

describe("QuickNode stream wake verification", () => {
  it("accepts a fresh signed JSON payload", async () => {
    const payload = JSON.stringify({ block: { number: "0x123" } });
    await expect(
      verifyQuickNodeStreamWake(signedRequest(payload), {
        env: { PROGRAMMABLE_QUICKNODE_STREAM_SECRET: SECRET },
        nowMs: NOW_MS,
      }),
    ).resolves.toEqual({
      timestamp: TIMESTAMP,
      payloadBytes: Buffer.byteLength(payload),
    });
  });

  it("verifies signatures over the decoded gzip payload", async () => {
    const payload = JSON.stringify([{ number: "0x123" }]);
    await expect(
      verifyQuickNodeStreamWake(signedRequest(payload, { gzip: true }), {
        env: { PROGRAMMABLE_QUICKNODE_STREAM_SECRET: SECRET },
        nowMs: NOW_MS,
      }),
    ).resolves.toMatchObject({ payloadBytes: Buffer.byteLength(payload) });
  });

  it("rejects invalid signatures and stale timestamps", async () => {
    await expect(
      verifyQuickNodeStreamWake(
        signedRequest("{}", { signature: "00".repeat(32) }),
        {
          env: { PROGRAMMABLE_QUICKNODE_STREAM_SECRET: SECRET },
          nowMs: NOW_MS,
        },
      ),
    ).rejects.toEqual(expectWakeError(401));

    const staleTimestamp = String(Number(TIMESTAMP) - 301);
    await expect(
      verifyQuickNodeStreamWake(
        signedRequest("{}", { timestamp: staleTimestamp }),
        {
          env: { PROGRAMMABLE_QUICKNODE_STREAM_SECRET: SECRET },
          nowMs: NOW_MS,
        },
      ),
    ).rejects.toEqual(expectWakeError(401));
  });

  it("fails closed when the stream secret is absent or too short", async () => {
    for (const secret of [undefined, "too-short"]) {
      await expect(
        verifyQuickNodeStreamWake(signedRequest("{}"), {
          env: { PROGRAMMABLE_QUICKNODE_STREAM_SECRET: secret },
          nowMs: NOW_MS,
        }),
      ).rejects.toEqual(expectWakeError(503));
    }
  });

  it("rejects malformed JSON and oversized bodies", async () => {
    await expect(
      verifyQuickNodeStreamWake(signedRequest("not-json"), {
        env: { PROGRAMMABLE_QUICKNODE_STREAM_SECRET: SECRET },
        nowMs: NOW_MS,
      }),
    ).rejects.toEqual(expectWakeError(400));

    const oversized = JSON.stringify({ value: "x".repeat(64 * 1024) });
    await expect(
      verifyQuickNodeStreamWake(signedRequest(oversized), {
        env: { PROGRAMMABLE_QUICKNODE_STREAM_SECRET: SECRET },
        nowMs: NOW_MS,
      }),
    ).rejects.toEqual(expectWakeError(413));
  });
});
