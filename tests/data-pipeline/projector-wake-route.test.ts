import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  source: vi.fn(),
  market: vi.fn(),
  safeMarketError: vi.fn(() => ({
    dependency: "market-projector",
    code: "internal_error",
    retryable: false,
  })),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return { ...actual, after: mocks.after };
});

vi.mock("../../lib/data-pipeline/projector-runtime-config.server", () => ({
  runConfiguredProjectorCycle: mocks.source,
}));

vi.mock("../../lib/data-pipeline/market-projector-runtime.server", () => ({
  runConfiguredMarketProjectorFastLaneCycle: mocks.market,
  safeMarketProjectorError: mocks.safeMarketError,
}));

import { POST } from "../../app/api/ops/projector-wake/route";

const SECRET = "quicknode-stream-secret-at-least-32-bytes";

function request(input: Readonly<{ signature?: string }> = {}) {
  const payload = JSON.stringify({ block: { number: "0x123" } });
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const nonce = "0123456789abcdef0123456789abcdef";
  const signature =
    input.signature ??
    createHmac("sha256", SECRET)
      .update(nonce)
      .update(timestamp)
      .update(payload)
      .digest("hex");
  return new NextRequest(
    "https://programmable.family/api/ops/projector-wake",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qn-nonce": nonce,
        "x-qn-timestamp": timestamp,
        "x-qn-signature": signature,
      },
      body: payload,
    },
  );
}

describe("projector stream wake route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PROGRAMMABLE_QUICKNODE_STREAM_SECRET", SECRET);
    mocks.source.mockResolvedValue({ status: "caught-up" });
    mocks.market.mockResolvedValue({ status: "caught-up" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("acknowledges a valid webhook before scheduling source then the head fast lane", async () => {
    let backgroundTask: (() => Promise<void>) | undefined;
    mocks.after.mockImplementation((task: () => Promise<void>) => {
      backgroundTask = task;
    });

    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.market).not.toHaveBeenCalled();

    await backgroundTask?.();
    expect(mocks.source).toHaveBeenCalledTimes(1);
    expect(mocks.market).toHaveBeenCalledTimes(1);
    expect(mocks.source.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.market.mock.invocationCallOrder[0]!,
    );
  });

  it("does not schedule work for an invalid signature", async () => {
    const response = await POST(request({ signature: "00".repeat(32) }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("fails closed when the webhook secret is not configured", async () => {
    vi.stubEnv("PROGRAMMABLE_QUICKNODE_STREAM_SECRET", "");
    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Wake trigger unavailable" });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("still runs the market fast lane when the source cycle fails", async () => {
    let backgroundTask: (() => Promise<void>) | undefined;
    mocks.after.mockImplementation((task: () => Promise<void>) => {
      backgroundTask = task;
    });
    mocks.source.mockRejectedValue(new Error("source unavailable"));

    const response = await POST(request());
    expect(response.status).toBe(202);
    await backgroundTask?.();

    expect(mocks.market).toHaveBeenCalledTimes(1);
  });
});
