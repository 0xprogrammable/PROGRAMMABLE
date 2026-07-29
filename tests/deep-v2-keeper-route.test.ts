import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  handleDeepV2KeeperRequest,
  type DeepV2KeeperRouteDependencies,
} from "../app/api/ops/deep-v2-keeper/handler";

function request({
  authorization = "Bearer cron-secret",
  path = "/api/ops/deep-v2-keeper",
  headers = {},
  method = "GET",
}: {
  authorization?: string | null;
  path?: string;
  headers?: Record<string, string>;
  method?: string;
} = {}) {
  const requestHeaders = new Headers(headers);
  if (authorization !== null) {
    requestHeaders.set("authorization", authorization);
  }
  return new Request(`https://programmable.family${path}`, {
    method,
    headers: requestHeaders,
  });
}

function dependencies(
  overrides: Partial<DeepV2KeeperRouteDependencies> = {},
): DeepV2KeeperRouteDependencies {
  return {
    cronSecret: "cron-secret",
    loadRelease: vi.fn().mockResolvedValue({ schemaVersion: 2 }),
    parseConfig: vi.fn().mockReturnValue({ enabled: true }),
    evaluateReleaseGate: vi.fn().mockReturnValue({
      ready: true,
      reasons: [],
    }),
    executeEligibleCycle: vi.fn().mockResolvedValue({
      kind: "completed",
      result: {
        outcome: "idle",
        confirmedBlock: { number: 25_000_000n },
        registryCount: 0n,
        ready: [],
        transactionHash: null,
      },
    }),
    logFailure: vi.fn(),
    ...overrides,
  };
}

describe("Deep V2 keeper HTTP boundary", () => {
  it("rejects unauthenticated requests before release or signer work", async () => {
    const deps = dependencies();

    const response = await handleDeepV2KeeperRequest(
      request({ authorization: null }),
      deps,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.loadRelease).not.toHaveBeenCalled();
    expect(deps.executeEligibleCycle).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "query parameters",
      request: () =>
        request({ path: "/api/ops/deep-v2-keeper?force=true" }),
      status: 400,
    },
    {
      label: "a request body",
      request: () =>
        request({ headers: { "content-length": "1" } }),
      status: 413,
    },
    {
      label: "an unbounded streaming body",
      request: () =>
        request({ headers: { "transfer-encoding": "chunked" } }),
      status: 413,
    },
    {
      label: "a non-GET method",
      request: () => request({ method: "POST" }),
      status: 405,
    },
  ])("rejects $label before release work", async ({ request, status }) => {
    const deps = dependencies();

    const response = await handleDeepV2KeeperRequest(request(), deps);

    expect(response.status).toBe(status);
    expect(deps.loadRelease).not.toHaveBeenCalled();
    expect(deps.executeEligibleCycle).not.toHaveBeenCalled();
  });

  it("fails closed when the V2 manifest is absent", async () => {
    const deps = dependencies({
      loadRelease: vi.fn().mockResolvedValue(null),
    });

    const response = await handleDeepV2KeeperRequest(request(), deps);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Deep V2 keeper release is not ready",
      reasons: ["deployment manifest"],
    });
    expect(deps.parseConfig).not.toHaveBeenCalled();
    expect(deps.executeEligibleCycle).not.toHaveBeenCalled();
  });

  it("fails closed on an unreviewed release without creating a signer", async () => {
    const deps = dependencies({
      evaluateReleaseGate: vi.fn().mockReturnValue({
        ready: false,
        reasons: ["reviewed V2 release binding"],
      }),
    });

    const response = await handleDeepV2KeeperRequest(request(), deps);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Deep V2 keeper release is not ready",
      reasons: ["reviewed V2 release binding"],
    });
    expect(deps.executeEligibleCycle).not.toHaveBeenCalled();
  });

  it("delegates an eligible cycle through the fenced execution boundary", async () => {
    const executeEligibleCycle = vi.fn().mockResolvedValue({
      kind: "completed",
      result: {
        outcome: "submitted",
        confirmedBlock: { number: 25_000_123n },
        registryCount: 4n,
        ready: [{}, {}],
        transactionHash: `0x${"ab".repeat(32)}`,
      },
    });
    const deps = dependencies({ executeEligibleCycle });

    const response = await handleDeepV2KeeperRequest(request(), deps);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      outcome: "submitted",
      confirmedBlock: "25000123",
      registryCount: "4",
      readyVaults: 2,
      transactionHash: `0x${"ab".repeat(32)}`,
    });
    expect(executeEligibleCycle).toHaveBeenCalledTimes(1);
  });

  it("reports overlapping invocations without bypassing the lease", async () => {
    const deps = dependencies({
      executeEligibleCycle: vi.fn().mockResolvedValue({
        kind: "busy",
      }),
    });

    const response = await handleDeepV2KeeperRequest(request(), deps);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Deep V2 keeper cycle already in progress",
    });
  });

  it("returns a generic failure and logs only the error class", async () => {
    const logFailure = vi.fn();
    const deps = dependencies({
      executeEligibleCycle: vi
        .fn()
        .mockRejectedValue(new TypeError("provider secret leaked here")),
      logFailure,
    });

    const response = await handleDeepV2KeeperRequest(request(), deps);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Deep V2 keeper cycle failed",
    });
    expect(logFailure).toHaveBeenCalledWith("TypeError");
    expect(JSON.stringify(logFailure.mock.calls)).not.toContain(
      "provider secret leaked here",
    );
  });
});

describe("Deep V2 keeper deployment schedule", () => {
  it("retires legacy writers and schedules only index plus Deep V3 ops v2", () => {
    const vercel = JSON.parse(
      readFileSync(
        new URL("../vercel.json", import.meta.url),
        "utf8",
      ),
    ) as {
      crons: Array<{ path: string; schedule: string }>;
    };

    expect(vercel.crons).toEqual([
      {
        path: "/api/ops/index",
        schedule: "* * * * *",
      },
      {
        path: "/api/ops/deep-v3-keeper-v2",
        schedule: "*/5 * * * *",
      },
    ]);
  });

  it("keeps signer execution behind the V2 boundary and remote policy wallet", () => {
    const routeSource = readFileSync(
      new URL(
        "../app/api/ops/deep-v2-keeper/route.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(routeSource).toContain("runDeepV2KeeperBoundary");
    expect(routeSource).toContain("createDeepV2StateWriter");
    expect(routeSource).toContain("createPrivyKeeperWallet");
    expect(routeSource).not.toMatch(
      /DEEP_V2_KEEPER_(?:PRIVATE_KEY|MNEMONIC)/,
    );
  });
});
