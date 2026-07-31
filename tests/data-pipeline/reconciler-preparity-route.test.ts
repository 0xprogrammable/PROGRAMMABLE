import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { runConfigured } = vi.hoisted(() => ({
  runConfigured: vi.fn(),
}));

vi.mock(
  "../../lib/data-pipeline/reconciler-preparity.server",
  () => ({ runConfiguredReconcilerPreParity: runConfigured }),
);

import { NextRequest } from "next/server";

import { POST } from "../../app/api/ops/reconcile-preparity/route";

const SECRET = "reconciler-test-secret-32-characters";
const BODY = {
  chainId: "1",
  releaseId: "classic-v3",
  modelId: "classic",
  sourceGroup: "ethereum-mainnet",
  epochId: "10000000-0000-4000-8000-000000000001",
  pointerGeneration: "7",
  checkpointId: "10000000-0000-4000-8000-000000000002",
  checkpointBlockNumber: "25700000",
  checkpointBlockHash: `0x${"11".repeat(32)}`,
  maximumEntityCount: 10_000,
} as const;

function request(body: unknown = BODY, secret = SECRET) {
  return new NextRequest("https://programmable.family/api/ops/reconcile-preparity", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("reconciler pre-parity ops route", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    runConfigured.mockReset();
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it("rejects missing or wrong credentials before parsing or executing", async () => {
    const missing = new NextRequest(
      "https://programmable.family/api/ops/reconcile-preparity",
      { method: "POST", body: "not-json" },
    );
    const missingResponse = await POST(missing);
    expect(missingResponse.status).toBe(401);
    expect(missingResponse.headers.get("cache-control")).toBe("no-store");

    const wrongResponse = await POST(request(BODY, `${SECRET}-wrong`));
    expect(wrongResponse.status).toBe(401);

    process.env.CRON_SECRET = "too-short";
    const weakSecretResponse = await POST(request(BODY, "too-short"));
    expect(weakSecretResponse.status).toBe(401);

    expect(runConfigured).not.toHaveBeenCalled();
  });

  it("rejects unknown fields and incomplete checkpoint identities", async () => {
    const response = await POST(request({ ...BODY, latest: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid checkpoint request",
    });
    expect(runConfigured).not.toHaveBeenCalled();
  });

  it("returns only bounded reconciliation evidence on success", async () => {
    runConfigured.mockResolvedValue({
      runId: "20000000-0000-4000-8000-000000000001",
      reconciliationId: "20000000-0000-4000-8000-000000000002",
      checkpointId: BODY.checkpointId,
      checkpointBlockNumber: BODY.checkpointBlockNumber,
      checkpointBlockHash: BODY.checkpointBlockHash,
      routeCount: 6,
      mismatchCount: 0,
      status: "succeeded",
    });
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: "succeeded",
      routeCount: 6,
      mismatchCount: 0,
      checkpointId: BODY.checkpointId,
      checkpointBlockNumber: BODY.checkpointBlockNumber,
      checkpointBlockHash: BODY.checkpointBlockHash,
    });
    expect(runConfigured).toHaveBeenCalledWith({ request: BODY });
  });

  it("surfaces a recorded mismatch as a conflict rather than success", async () => {
    runConfigured.mockResolvedValue({
      runId: "20000000-0000-4000-8000-000000000001",
      reconciliationId: "20000000-0000-4000-8000-000000000002",
      checkpointId: BODY.checkpointId,
      checkpointBlockNumber: BODY.checkpointBlockNumber,
      checkpointBlockHash: BODY.checkpointBlockHash,
      routeCount: 6,
      mismatchCount: 1,
      status: "failed",
    });
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "failed",
      mismatchCount: 1,
    });
  });

  it("fails closed without leaking an upstream error or secret", async () => {
    const upstream = `https://rpc.invalid/${SECRET}`;
    runConfigured.mockRejectedValue(new Error(upstream));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain(upstream);
    expect(text).not.toContain(SECRET);
    expect(errorLog).toHaveBeenCalledWith(
      "Programmable reconciliation failed",
      expect.not.objectContaining({ message: expect.anything() }),
    );
  });
});
