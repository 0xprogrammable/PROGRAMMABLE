import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ capture: vi.fn(), arm: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/data-pipeline/read-model-real-block-sla-capture.server", () => ({
  captureRealBlockSla: mocks.capture,
  armConfiguredRealBlockSlaProviderRetryOnce: mocks.arm,
}));

import { POST, PUT } from "../../app/api/ops/read-model-real-block-sla/route";

const SECRET = "performance-probe-secret-at-least-32-bytes";
const body = JSON.stringify({
  deliveryReceiptId: "19",
  challenge: `0x${"55".repeat(32)}`,
});

function request(secret = SECRET) {
  return new NextRequest("https://programmable.family/api/ops/read-model-real-block-sla", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-programmable-performance-probe": "1",
      "x-programmable-performance-probe-token": secret,
    },
    body,
  });
}

function armRequest(
  origin = "https://programmable-candidate-abc.vercel.app",
  secret = SECRET,
) {
  return new NextRequest(`${origin}/api/ops/read-model-real-block-sla`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      host: new URL(origin).host,
      "x-programmable-performance-probe": "1",
      "x-programmable-performance-probe-token": secret,
    },
    body: JSON.stringify({
      action: "arm-provider-retry",
      streamId: "programmable-mainnet-head",
    }),
  });
}

describe("real-block SLA private capture route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN", SECRET);
    mocks.capture.mockResolvedValue({ exportId: "receipt" });
    mocks.arm.mockResolvedValue("00000000-0000-4000-8000-000000000019");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns only private no-store evidence to the authenticated operator", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ exportId: "receipt" });
    expect(mocks.capture).toHaveBeenCalledWith({
      deliveryReceiptId: "19",
      challenge: `0x${"55".repeat(32)}`,
    });
  });

  it("rejects unauthenticated calls before capture", async () => {
    const response = await POST(request("wrong"));
    expect(response.status).toBe(401);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("arms one provider retry only on the exact unaliased staged deployment", async () => {
    vi.stubEnv("PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE", "true");
    vi.stubEnv("VERCEL_URL", "programmable-candidate-abc.vercel.app");

    const response = await PUT(armRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      armed: true,
      armId: "00000000-0000-4000-8000-000000000019",
    });
    expect(mocks.arm).toHaveBeenCalledWith({
      streamId: "programmable-mainnet-head",
    });
  });

  it("cannot arm while disabled or through a production alias", async () => {
    vi.stubEnv("VERCEL_URL", "programmable-candidate-abc.vercel.app");
    expect((await PUT(armRequest())).status).toBe(409);

    vi.stubEnv("PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE", "true");
    expect((await PUT(armRequest("https://programmable.family"))).status).toBe(409);
    expect(mocks.arm).not.toHaveBeenCalled();
  });
});
