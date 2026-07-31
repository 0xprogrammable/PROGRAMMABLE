import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureReadModelPerformance: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock(
  "../../lib/data-pipeline/read-model-performance-capture.server",
  () => ({
    captureReadModelPerformance: mocks.captureReadModelPerformance,
  }),
);

import {
  POST,
  dynamic,
  maxDuration,
  runtime,
} from "../../app/api/ops/read-model-performance-capture/route";

const TOKEN = "performance-probe-token-at-least-32-bytes";
const requestBody = {
  schemaVersion: 1,
  profileId: "read-model-smoke-v1",
  gitHead: "a".repeat(40),
  targetUrl: "https://programmable-git-codex.vercel.app/",
  vercelDeploymentId: `dpl_${"A".repeat(24)}`,
  captureNonce: `0x${"12".repeat(32)}`,
};

function request(input: {
  token?: string;
  probe?: string;
  body?: string;
  contentType?: string;
} = {}) {
  const headers = new Headers();
  if (input.token !== undefined) {
    headers.set("x-programmable-performance-probe-token", input.token);
  }
  if (input.probe !== undefined) {
    headers.set("x-programmable-performance-probe", input.probe);
  }
  if (input.contentType !== undefined) {
    headers.set("content-type", input.contentType);
  }
  return new NextRequest(
    "https://programmable-git-codex.vercel.app/api/ops/read-model-performance-capture",
    {
      method: "POST",
      headers,
      body: input.body ?? JSON.stringify(requestBody),
    },
  );
}

describe("read-model performance capture route", () => {
  beforeEach(() => {
    vi.stubEnv("PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN", TOKEN);
    mocks.captureReadModelPerformance.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("pins the protected capture route to Node and disables caching", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(90);
    expect(runtime).toBe("nodejs");
  });

  it.each([
    {},
    { probe: "1", token: "wrong" },
    { probe: "0", token: TOKEN },
  ])("rejects unauthorized probes before reading the body", async (headers) => {
    const response = await POST(request(headers));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.captureReadModelPerformance).not.toHaveBeenCalled();
  });

  it("rejects non-JSON and oversized bodies before capture", async () => {
    const authenticated = { probe: "1", token: TOKEN };
    const wrongType = await POST(
      request({ ...authenticated, contentType: "text/plain" }),
    );
    expect(wrongType.status).toBe(415);

    const oversized = await POST(
      request({
        ...authenticated,
        contentType: "application/json",
        body: JSON.stringify({ value: "x".repeat(5_000) }),
      }),
    );
    expect(oversized.status).toBe(413);
    expect(mocks.captureReadModelPerformance).not.toHaveBeenCalled();
  });

  it("returns only the exact private capture payload", async () => {
    const payload = {
      schemaVersion: 1,
      captureNonce: requestBody.captureNonce,
      datasetManifest: { schemaVersion: 1 },
      rpcTrace: { schemaVersion: 1 },
    };
    mocks.captureReadModelPerformance.mockResolvedValue(payload);

    const response = await POST(
      request({
        probe: "1",
        token: TOKEN,
        contentType: "application/json",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(payload);
    expect(mocks.captureReadModelPerformance).toHaveBeenCalledWith(requestBody);
  });

  it("fails closed without reflecting database, Envio or RPC details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.captureReadModelPerformance.mockRejectedValue(
      new Error("postgres://secret and https://rpc.example/key"),
    );

    const response = await POST(
      request({
        probe: "1",
        token: TOKEN,
        contentType: "application/json",
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('{"error":"Performance capture unavailable"}');
    expect(body).not.toContain("secret");
    expect(body).not.toContain("rpc.example");
  });
});
