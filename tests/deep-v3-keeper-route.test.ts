import { describe, expect, it, vi } from "vitest";

import { handleDeepV3KeeperRequest } from "../app/api/ops/deep-v3-keeper/handler";

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
    `https://programmable.family${options.path ?? "/api/ops/deep-v3-keeper"}`,
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
        outcome: "common-block-none",
        action: 0,
        transactionHash: null,
        commonBlock: { number: 100n },
      },
    }),
    logFailure: vi.fn(),
    ...overrides,
  };
}

describe("Deep V3 keeper route boundary", () => {
  it("authenticates with CRON_SECRET before loading release state", async () => {
    const deps = dependencies();
    const response = await handleDeepV3KeeperRequest(
      request({ authorization: null }),
      deps,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(deps.loadRelease).not.toHaveBeenCalled();
  });

  it.each([
    [request({ method: "POST" }), 405],
    [request({ path: "/api/ops/deep-v3-keeper?force=1" }), 400],
    [request({ headers: { "content-length": "1" } }), 400],
    [
      request({ headers: { "transfer-encoding": "chunked" } }),
      400,
    ],
  ])("rejects methods, query or body before keeper work", async (input, status) => {
    const deps = dependencies();
    const response = await handleDeepV3KeeperRequest(input, deps);
    expect(response.status).toBe(status);
    expect(deps.loadRelease).not.toHaveBeenCalled();
  });

  it("returns only a generic error for release-gate and runtime failures", async () => {
    const gated = dependencies({
      evaluateReleaseGate: vi.fn().mockReturnValue({
        ready: false,
        reasons: ["secret internal mismatch"],
      }),
    });
    const gatedResponse = await handleDeepV3KeeperRequest(
      request(),
      gated,
    );
    expect(gatedResponse.status).toBe(503);
    await expect(gatedResponse.json()).resolves.toEqual({
      error: "Keeper unavailable",
    });

    const failed = dependencies({
      executeEligibleCycle: vi
        .fn()
        .mockRejectedValue(new Error("provider secret")),
    });
    const failedResponse = await handleDeepV3KeeperRequest(
      request(),
      failed,
    );
    expect(failedResponse.status).toBe(503);
    await expect(failedResponse.json()).resolves.toEqual({
      error: "Keeper unavailable",
    });
    expect(failed.logFailure).toHaveBeenCalledWith("Error", null);
    expect(JSON.stringify(failed.logFailure.mock.calls)).not.toContain(
      "provider secret",
    );
  });

  it("returns a minimal successful cycle result", async () => {
    const response = await handleDeepV3KeeperRequest(
      request(),
      dependencies(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      outcome: "common-block-none",
      action: 0,
      transactionHash: null,
      commonBlock: "100",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("surfaces durable operator recovery as a generic non-success", async () => {
    const deps = dependencies({
      executeEligibleCycle: vi.fn().mockResolvedValue({
        kind: "completed",
        result: {
          outcome: "operator-action-required",
          action: 1,
          transactionHash: `0x${"ab".repeat(32)}`,
          commonBlock: null,
        },
      }),
    });
    const response = await handleDeepV3KeeperRequest(
      request(),
      deps,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Keeper unavailable",
    });
    expect(deps.logFailure).toHaveBeenCalledWith(
      "DeepV3KeeperOperatorActionRequired",
      "OPERATOR_ACTION_REQUIRED",
    );
  });
});
