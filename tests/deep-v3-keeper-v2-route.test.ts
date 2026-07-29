import { describe, expect, it, vi } from "vitest";

import { handleDeepV3KeeperV2Request } from "../app/api/ops/deep-v3-keeper-v2/handler";

function request(
  options: {
    method?: string;
    path?: string;
    authorization?: string | null;
    headers?: Record<string, string>;
  } = {},
) {
  const headers = new Headers(options.headers);
  if (options.authorization !== null) {
    headers.set(
      "authorization",
      options.authorization ?? "Bearer cron-secret",
    );
  }
  return new Request(
    `https://programmable.family${
      options.path ?? "/api/ops/deep-v3-keeper-v2"
    }`,
    { method: options.method ?? "GET", headers },
  );
}

function dependencies(overrides = {}) {
  return {
    cronSecret: "cron-secret",
    loadRelease: vi.fn().mockResolvedValue({ schemaVersion: 3 }),
    parseConfig: vi.fn().mockReturnValue({ enabled: true }),
    evaluateReleaseGate: vi
      .fn()
      .mockReturnValue({ ready: true, reasons: [] }),
    executeEligibleCycle: vi.fn().mockResolvedValue({
      kind: "completed",
      result: {
        outcome: "submitted",
        transactionHash: `0x${"a".repeat(64)}`,
        commonBlock: { number: 100n },
        scanned: 32,
        confirmedBatchIds: [],
        submittedBatchIds: ["batch-1"],
      },
    }),
    logFailure: vi.fn(),
    ...overrides,
  };
}

describe("Deep V3 keeper ops v2 route boundary", () => {
  it("authenticates before reading release or keeper state", async () => {
    const deps = dependencies();
    const response = await handleDeepV3KeeperV2Request(
      request({ authorization: null }),
      deps,
    );
    expect(response.status).toBe(401);
    expect(deps.loadRelease).not.toHaveBeenCalled();
  });

  it.each([
    [request({ method: "POST" }), 405],
    [request({ path: "/api/ops/deep-v3-keeper-v2?force=1" }), 400],
    [request({ headers: { "content-length": "1" } }), 400],
  ])("rejects unsupported request shapes", async (input, status) => {
    const deps = dependencies();
    const response = await handleDeepV3KeeperV2Request(input, deps);
    expect(response.status).toBe(status);
    expect(deps.loadRelease).not.toHaveBeenCalled();
  });

  it("returns only bounded, secret-safe cycle fields", async () => {
    const response = await handleDeepV3KeeperV2Request(
      request(),
      dependencies(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      outcome: "submitted",
      transactionHash: `0x${"a".repeat(64)}`,
      commonBlock: "100",
      scanned: 32,
      confirmedBatches: 0,
      submittedBatches: 1,
    });
  });

  it("keeps release, provider and operator failures generic", async () => {
    const gated = dependencies({
      evaluateReleaseGate: vi.fn().mockReturnValue({
        ready: false,
        reasons: ["internal secret path"],
      }),
    });
    const response = await handleDeepV3KeeperV2Request(
      request(),
      gated,
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Keeper unavailable",
    });

    const failed = dependencies({
      executeEligibleCycle: vi
        .fn()
        .mockRejectedValue(new Error("https://secret-rpc.example")),
    });
    const failedResponse = await handleDeepV3KeeperV2Request(
      request(),
      failed,
    );
    expect(failedResponse.status).toBe(503);
    expect(JSON.stringify(failed.logFailure.mock.calls)).not.toContain(
      "secret-rpc",
    );
  });

  it("reports durable operator state as unavailable instead of a healthy cycle", async () => {
    const deps = dependencies({
      executeEligibleCycle: vi.fn().mockResolvedValue({
        kind: "completed",
        result: {
          outcome: "operator-action-required",
          transactionHash: null,
          commonBlock: { number: 100n },
          scanned: 0,
          confirmedBatchIds: [],
          submittedBatchIds: [],
        },
      }),
    });
    const response = await handleDeepV3KeeperV2Request(
      request(),
      deps,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Keeper unavailable",
    });
    expect(deps.logFailure).toHaveBeenCalledWith(
      "DeepV3KeeperV2OperatorActionRequired",
      "OPERATOR_ACTION_REQUIRED",
    );
  });
});
