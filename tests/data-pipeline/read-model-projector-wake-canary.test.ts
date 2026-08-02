import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as wakeCanary from "../../scripts/perf/read-model-projector-wake-canary.mjs";

const {
  PROJECTOR_WAKE_ROUTE,
  projectorWakeCanaryArgumentsFrom,
  runProjectorWakeCanary,
} = wakeCanary;

const SECRET = "quicknode-stream-secret-at-least-32-bytes";
const NOW_MS = Date.parse("2026-08-02T12:00:00.000Z");
const TARGET = "https://programmable-stage-abc.vercel.app";

function jsonResponse(value: unknown, status: number) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

describe("read-model projector wake canary", () => {
  it("checks invalid, stale and valid signed deliveries without returning credentials", async () => {
    const observations: Array<{
      nonce: string;
      signatureValid: boolean;
      timestamp: number;
    }> = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe(`${TARGET}${PROJECTOR_WAKE_ROUTE}`);
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      const headers = new Headers(init?.headers);
      const nonce = headers.get("x-qn-nonce") ?? "";
      const timestamp = headers.get("x-qn-timestamp") ?? "";
      const signature = headers.get("x-qn-signature") ?? "";
      const body = String(init?.body);
      const expected = createHmac("sha256", SECRET)
        .update(nonce)
        .update(timestamp)
        .update(body)
        .digest("hex");
      const signatureValid = signature === expected;
      observations.push({
        nonce,
        signatureValid,
        timestamp: Number(timestamp),
      });
      if (!signatureValid || Number(timestamp) < Math.floor(NOW_MS / 1_000) - 300) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      return jsonResponse({ accepted: true }, 202);
    });

    const result = await runProjectorWakeCanary({
      targetUrl: TARGET,
      environment: { PROGRAMMABLE_QUICKNODE_STREAM_SECRET: SECRET },
      fetchImpl,
      nowMs: NOW_MS,
      nonceFactory: (id: string) => `nonce-${id}-0123456789abcdef`,
      probeIdFactory: () => "ab".repeat(16),
    });

    expect(result).toEqual({
      ok: true,
      targetOrigin: TARGET,
      route: PROJECTOR_WAKE_ROUTE,
      payloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      checks: [
        { id: "invalid-signature", status: 401 },
        { id: "stale-timestamp", status: 401 },
        { id: "valid-delivery", status: 202 },
      ],
    });
    expect(observations.map(({ signatureValid }) => signatureValid)).toEqual([
      false,
      true,
      true,
    ]);
    expect(observations[1]?.timestamp).toBe(
      Math.floor(NOW_MS / 1_000) - 360,
    );
    expect(new Set(observations.map(({ nonce }) => nonce)).size).toBe(3);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET);
    for (const observation of observations) {
      expect(serialized).not.toContain(observation.nonce);
    }
  });

  it("fails closed on a missing secret or a mutable production target", async () => {
    await expect(
      runProjectorWakeCanary({
        targetUrl: TARGET,
        environment: {},
      }),
    ).rejects.toThrow("secret is unavailable or invalid");
    await expect(
      runProjectorWakeCanary({
        targetUrl: "https://programmable.family",
        environment: { PROGRAMMABLE_QUICKNODE_STREAM_SECRET: SECRET },
      }),
    ).rejects.toThrow("deployment-specific Vercel HTTPS origin");
  });

  it("fails when any exact response contract drifts", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { error: "Unauthorized" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    );
    await expect(
      runProjectorWakeCanary({
        targetUrl: TARGET,
        environment: { PROGRAMMABLE_QUICKNODE_STREAM_SECRET: SECRET },
        fetchImpl,
        nowMs: NOW_MS,
        nonceFactory: () => "0123456789abcdef0123456789abcdef",
        probeIdFactory: () => "ab".repeat(16),
      }),
    ).rejects.toThrow("invalid-signature returned an unexpected status");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("redacts lower-level request failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`request failed with ${SECRET}`);
    });
    let thrown: unknown;
    try {
      await runProjectorWakeCanary({
        targetUrl: TARGET,
        environment: { PROGRAMMABLE_QUICKNODE_STREAM_SECRET: SECRET },
        fetchImpl,
        nowMs: NOW_MS,
        nonceFactory: () => "0123456789abcdef0123456789abcdef",
        probeIdFactory: () => "ab".repeat(16),
      });
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toContain("invalid-signature request failed");
    expect(String(thrown)).not.toContain(SECRET);
  });

  it("accepts only the target URL argument and never a CLI secret", () => {
    expect(
      projectorWakeCanaryArgumentsFrom(["--target-url", TARGET]),
    ).toEqual({ targetUrl: TARGET });
    expect(() =>
      projectorWakeCanaryArgumentsFrom([
        "--target-url",
        TARGET,
        "--secret",
        SECRET,
      ]),
    ).toThrow("usage:");
  });
});
