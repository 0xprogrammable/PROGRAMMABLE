import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runConfiguredManualRouterFinalityWorkerV1: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock(
  "@/lib/server/custom-launch/manual-router-finality-worker-v1",
  () => ({
    runConfiguredManualRouterFinalityWorkerV1:
      mocks.runConfiguredManualRouterFinalityWorkerV1,
  }),
);

import {
  GET,
  dynamic,
  maxDuration,
  runtime,
} from "../app/api/ops/manual-router-finality/route";

const SECRET = "manual-router-cron-secret-at-least-32-bytes";

function request(url: string, method = "GET") {
  return new Request(url, {
    method,
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

describe("manual Router finality cron route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    mocks.runConfiguredManualRouterFinalityWorkerV1.mockReset();
    mocks.runConfiguredManualRouterFinalityWorkerV1.mockResolvedValue({
      status: "complete",
      processed: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("pins the private worker route to the Node runtime without caching", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(90);
    expect(runtime).toBe("nodejs");
  });

  it("rejects a valid bearer with query input before starting the worker", async () => {
    const response = await GET(request(
      "https://programmable.market/api/ops/manual-router-finality?cursor=attacker",
    ));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.runConfiguredManualRouterFinalityWorkerV1).not.toHaveBeenCalled();
  });

  it("rejects a non-GET request before starting the worker", async () => {
    const response = await GET(request(
      "https://programmable.market/api/ops/manual-router-finality",
      "POST",
    ));

    expect(response.status).toBe(401);
    expect(mocks.runConfiguredManualRouterFinalityWorkerV1).not.toHaveBeenCalled();
  });

  it("runs one worker cycle for the exact authorized request", async () => {
    const response = await GET(request(
      "https://programmable.market/api/ops/manual-router-finality",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "complete",
      processed: 0,
    });
    expect(mocks.runConfiguredManualRouterFinalityWorkerV1).toHaveBeenCalledTimes(1);
  });
});
