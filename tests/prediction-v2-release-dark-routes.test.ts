import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PREDICTION_V2_REDEEM_PREPARE_REQUEST_SCHEMA,
  PREDICTION_V2_RESOLUTION_DECISION_REQUEST_SCHEMA,
  PredictionV2RouteRuntimeErrorV2,
  createPredictionV2DirectoryRouteHandler,
  createPredictionV2RedeemPrepareRouteHandler,
  createPredictionV2ResolutionDecisionRouteHandler,
  type PredictionV2RouteBudgetLeaseV2,
  type PredictionV2RouteDependenciesV2,
  type PredictionV2RouteJsonObjectV2,
  type PredictionV2RouteRuntimeV2,
} from "@/app/api/prediction/v2/_shared/http-v2";
import type { PredictionV2PublicReleaseV2 } from
  "@/lib/prediction-v2/public-release-v2.server";

const FACTORY = `0x${"11".repeat(20)}`;
const ECONOMIC_KEY = `0x${"22".repeat(32)}`;
const MARKET_ID = `0x${"33".repeat(32)}`;
const ACTION_ID = `0x${"44".repeat(32)}`;
const ACCOUNT = `0x${"55".repeat(20)}`;
const MARKET_KEY = `eip155:4663:${FACTORY}:${ECONOMIC_KEY}`;

const DISABLED_RELEASE = Object.freeze({
  schemaVersion: "programmable.prediction-v2-public-release.v2",
  releaseVersion: "prediction-v2",
  status: "disabled",
}) as PredictionV2PublicReleaseV2;
const ENABLED_RELEASE = Object.freeze({
  status: "enabled",
  components: Object.freeze([
    Object.freeze({
      component: "GenericPredictionMarketFactoryV2",
      address: FACTORY,
    }),
  ]),
}) as unknown as PredictionV2PublicReleaseV2;

const REDEEM_INTENT = Object.freeze({
  schemaVersion: PREDICTION_V2_REDEEM_PREPARE_REQUEST_SCHEMA,
  action: "redeem",
  actionId: ACTION_ID,
  marketKey: MARKET_KEY,
  economicKey: ECONOMIC_KEY,
  marketId: MARKET_ID,
  account: ACCOUNT,
  minimumConfirmedBlockNumber: "100",
  minimumConfirmedBlockHash: `0x${"66".repeat(32)}`,
  yesAtoms: "1",
  noAtoms: "0",
});

const RESOLUTION_INTENT = Object.freeze({
  schemaVersion: PREDICTION_V2_RESOLUTION_DECISION_REQUEST_SCHEMA,
  action: "decide-resolution",
  actionId: ACTION_ID,
  marketKey: MARKET_KEY,
  economicKey: ECONOMIC_KEY,
  marketId: MARKET_ID,
  account: ACCOUNT,
});

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://programmable.market/api/prediction/v2/test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": ACTION_ID,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function lease(expiresAtMs = 2_000): PredictionV2RouteBudgetLeaseV2 {
  return Object.freeze({ expiresAtMs, opaque: Object.freeze({ id: "lease" }) });
}

function runtime(overrides: Partial<PredictionV2RouteRuntimeV2> = {}) {
  const base: PredictionV2RouteRuntimeV2 = {
    readiness: Object.freeze({ productionReady: true }),
    nowMs: () => 1_000,
    reserve: vi.fn(async () => ({ status: "reserved" as const, lease: lease() })),
    start: vi.fn(async () => "started" as const),
    commit: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => Object.freeze({
      schemaVersion: "programmable.prediction-v2.directory-response.v2",
      markets: Object.freeze([]),
    })),
    prepareRedeem: vi.fn(async () => Object.freeze({
      schemaVersion: "programmable.prediction-v2.prepared-transaction.v2",
      transaction: Object.freeze({ to: ACCOUNT, data: "0x049104e5", value: "0" }),
    })),
    decideResolution: vi.fn(async () => Object.freeze({
      schemaVersion: 2,
      decision: "wait",
    })),
  };
  return Object.assign(base, overrides) as PredictionV2RouteRuntimeV2;
}

function dependencies(
  runtimeValue: PredictionV2RouteRuntimeV2,
  release: PredictionV2PublicReleaseV2 = ENABLED_RELEASE,
): PredictionV2RouteDependenciesV2 {
  return {
    getRelease: () => release,
    loadRuntime: vi.fn(async () => runtimeValue),
  };
}

async function json(response: Response) {
  return await response.json() as Record<string, unknown>;
}

describe("Prediction V2 release-dark route boundary", () => {
  it("keeps all concrete app routes dark under the checked-in public release", async () => {
    const [directory, redeem, resolution, discovery, logo] = await Promise.all([
      import("@/app/api/prediction/v2/directory/route"),
      import("@/app/api/prediction/v2/actions/redeem/prepare/route"),
      import("@/app/api/prediction/v2/resolution/decision/route"),
      import("@/app/api/prediction/asset-auto-discovery/route"),
      import("@/app/api/prediction/asset-logo/[asset]/route"),
    ]);
    const throwingRequest = new Proxy({} as Request, {
      get() {
        throw new Error("checked-in dark routes must not inspect Request");
      },
    });
    const throwingContext = new Proxy(
      {} as { params: Promise<{ asset: string }> },
      {
        get() {
          throw new Error("checked-in dark routes must not inspect params");
        },
      },
    );

    const responses = await Promise.all([
      directory.GET(throwingRequest),
      redeem.POST(throwingRequest),
      resolution.POST(throwingRequest),
      discovery.GET(throwingRequest as never),
      logo.GET(throwingRequest, throwingContext),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([
      404,
      404,
      404,
      404,
      404,
    ]);
    expect(responses.every((response) =>
      response.headers.get("cache-control") === "no-store"
    )).toBe(true);
    expect(await Promise.all(responses.map((response) => response.text())))
      .toEqual([
        '{"schemaVersion":"programmable.prediction-v2.client-error.v2","code":"not_found","message":"Not found","retryable":false}',
        '{"schemaVersion":"programmable.prediction-v2.client-error.v2","code":"not_found","message":"Not found","retryable":false}',
        '{"schemaVersion":"programmable.prediction-v2.client-error.v2","code":"not_found","message":"Not found","retryable":false}',
        '{"error":"Not found"}',
        '{"error":"Asset image is unavailable"}',
      ]);
  });

  it.each([
    ["directory", createPredictionV2DirectoryRouteHandler],
    ["redeem prepare", createPredictionV2RedeemPrepareRouteHandler],
    ["resolution decision", createPredictionV2ResolutionDecisionRouteHandler],
  ] as const)(
    "keeps the %s route identically dark before reading Request or runtime",
    async (_label, createHandler) => {
      const throwingRequest = new Proxy({} as Request, {
        get() {
          throw new Error("request must stay opaque");
        },
      });
      const darkLoader = vi.fn(async () => runtime());
      const dark = createHandler({
        getRelease: () => DISABLED_RELEASE,
        loadRuntime: darkLoader,
      });
      const malformedLoader = vi.fn(async () => runtime());
      const malformed = createHandler({
        getRelease() {
          throw new Error("invalid signature");
        },
        loadRuntime: malformedLoader,
      });

      const [darkResponse, malformedResponse] = await Promise.all([
        dark(throwingRequest),
        malformed(throwingRequest),
      ]);

      expect(darkResponse.status).toBe(404);
      expect(malformedResponse.status).toBe(404);
      expect(await darkResponse.text()).toBe(await malformedResponse.text());
      expect(darkResponse.headers.get("cache-control")).toBe("no-store");
      expect(darkResponse.headers.get("x-content-type-options")).toBe("nosniff");
      expect(darkLoader).not.toHaveBeenCalled();
      expect(malformedLoader).not.toHaveBeenCalled();
    },
  );

  it("checks production readiness before reading URL, headers or body", async () => {
    const throwingRequest = new Proxy({} as Request, {
      get() {
        throw new Error("request must stay opaque");
      },
    });
    const unavailable = runtime({
      readiness: Object.freeze({ productionReady: false }),
    });
    const handler = createPredictionV2DirectoryRouteHandler(
      dependencies(unavailable),
    );

    const response = await handler(throwingRequest);

    expect(response.status).toBe(503);
    expect((await json(response)).code).toBe("runtime-unavailable");
    expect(unavailable.reserve).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong media type", post(REDEEM_INTENT, { "content-type": "text/plain" }), 415],
    ["encoded body", post(REDEEM_INTENT, { "content-encoding": "gzip" }), 415],
    ["oversized declaration", post(REDEEM_INTENT, { "content-length": "8193" }), 413],
    ["unknown field", post({ ...REDEEM_INTENT, target: ACCOUNT }), 400],
    [
      "invalid displayed block number",
      post({ ...REDEEM_INTENT, minimumConfirmedBlockNumber: "0" }),
      400,
    ],
    [
      "zero displayed block hash",
      post({
        ...REDEEM_INTENT,
        minimumConfirmedBlockHash: `0x${"0".repeat(64)}`,
      }),
      400,
    ],
    ["mismatched idempotency", post(REDEEM_INTENT, { "idempotency-key": MARKET_ID }), 400],
    [
      "declared length mismatch",
      post(REDEEM_INTENT, {
        "content-length": String(JSON.stringify(REDEEM_INTENT).length - 1),
      }),
      400,
    ],
    [
      "zero action identity",
      post({ ...REDEEM_INTENT, actionId: `0x${"0".repeat(64)}` }, {
        "idempotency-key": `0x${"0".repeat(64)}`,
      }),
      400,
    ],
    [
      "wrong release factory",
      post({
        ...REDEEM_INTENT,
        marketKey: `eip155:4663:0x${"77".repeat(20)}:${ECONOMIC_KEY}`,
      }),
      400,
    ],
  ])("rejects %s before reserving budget", async (_label, request, status) => {
    const runtimeValue = runtime();
    const handler = createPredictionV2RedeemPrepareRouteHandler(
      dependencies(runtimeValue),
    );

    const response = await handler(request as Request);

    expect(response.status).toBe(status);
    expect(runtimeValue.reserve).not.toHaveBeenCalled();
    expect(runtimeValue.prepareRedeem).not.toHaveBeenCalled();
  });

  it("rejects escaped duplicate decoded keys before budget work", async () => {
    const runtimeValue = runtime();
    const handler = createPredictionV2RedeemPrepareRouteHandler(
      dependencies(runtimeValue),
    );
    const duplicate = JSON.stringify(REDEEM_INTENT).replace(
      `"action":"redeem"`,
      `"action":"redeem","\\u0061ction":"redeem"`,
    );

    const response = await handler(post(duplicate));

    expect(response.status).toBe(400);
    expect(runtimeValue.reserve).not.toHaveBeenCalled();
  });

  it("cancels an expired lease and performs zero provider work", async () => {
    const expired = lease(1_000);
    const runtimeValue = runtime({
      reserve: vi.fn(async () => ({ status: "reserved" as const, lease: expired })),
      nowMs: () => 1_000,
    });
    const handler = createPredictionV2RedeemPrepareRouteHandler(
      dependencies(runtimeValue),
    );

    const response = await handler(post(REDEEM_INTENT));

    expect(response.status).toBe(503);
    expect(runtimeValue.cancel).toHaveBeenCalledWith(expired);
    expect(runtimeValue.prepareRedeem).not.toHaveBeenCalled();
    expect(runtimeValue.commit).not.toHaveBeenCalled();
  });

  it.each(["blocked", "in-progress", "replay"] as const)(
    "never treats a %s reservation as provider authority",
    async (status) => {
      const runtimeValue = runtime({
        reserve: vi.fn(async () => ({ status, retryAfterSeconds: 2 })),
      });
      const handler = createPredictionV2ResolutionDecisionRouteHandler(
        dependencies(runtimeValue),
      );

      const response = await handler(post(RESOLUTION_INTENT));

      expect([409, 503]).toContain(response.status);
      expect(runtimeValue.start).not.toHaveBeenCalled();
      expect(runtimeValue.decideResolution).not.toHaveBeenCalled();
    },
  );

  it("keeps POST idempotency stable while fingerprinting the full intent", async () => {
    const reserve = vi.fn<PredictionV2RouteRuntimeV2["reserve"]>(
      async () => Object.freeze({
        status: "blocked" as const,
        retryAfterSeconds: 30,
      }),
    );
    const runtimeValue = runtime({ reserve });
    const handler = createPredictionV2RedeemPrepareRouteHandler(
      dependencies(runtimeValue),
    );

    await handler(post(REDEEM_INTENT));
    await handler(post({ ...REDEEM_INTENT, yesAtoms: "2" }));

    expect(reserve).toHaveBeenCalledTimes(2);
    expect(reserve.mock.calls[0]?.[0].idempotencyKeyMaterial).toBe(ACTION_ID);
    expect(reserve.mock.calls[1]?.[0].idempotencyKeyMaterial).toBe(ACTION_ID);
    expect(reserve.mock.calls[0]?.[0].requestFingerprintMaterial).not.toBe(
      reserve.mock.calls[1]?.[0].requestFingerprintMaterial,
    );
    expect(runtimeValue.start).not.toHaveBeenCalled();
    expect(runtimeValue.prepareRedeem).not.toHaveBeenCalled();
  });

  it("hands a fresh lease directly to directory work and commits the result", async () => {
    const calls: string[] = [];
    const activeLease = lease();
    const output = Object.freeze({
      schemaVersion: "programmable.prediction-v2.directory-response.v2",
      releaseId: "protocol-v2",
      markets: Object.freeze([]),
    });
    const runtimeValue = runtime({
      reserve: vi.fn(async () => {
        calls.push("reserve");
        return { status: "reserved" as const, lease: activeLease };
      }),
      nowMs: () => {
        calls.push("expiry-check");
        return 1_000;
      },
      start: vi.fn(async () => {
        calls.push("start");
        return "started" as const;
      }),
      readDirectory: vi.fn(async ({ lease: supplied }) => {
        expect(supplied).toBe(activeLease);
        calls.push("provider");
        return output;
      }),
      commit: vi.fn(async ({ result }) => {
        expect(result).toEqual(output);
        calls.push("commit");
      }),
    });
    const handler = createPredictionV2DirectoryRouteHandler(
      dependencies(runtimeValue),
    );

    const response = await handler(new Request(
      "https://programmable.market/api/prediction/v2/directory?limit=8",
    ));

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      "reserve",
      "expiry-check",
      "start",
      "provider",
      "commit",
    ]);
    expect(await json(response)).toEqual(output);
  });

  it("rejects BigInt or signing/broadcast fields from action runtimes", async () => {
    const cases: readonly PredictionV2RouteJsonObjectV2[] = [
      { value: 1n } as unknown as PredictionV2RouteJsonObjectV2,
      { signature: `0x${"66".repeat(65)}` },
      { transactionHash: MARKET_ID },
      { signedTx: "0x01" },
      { raw_tx: "0x01" },
      { txHash: MARKET_ID },
    ];
    for (const output of cases) {
      const runtimeValue = runtime({
        prepareRedeem: vi.fn(async () => output),
      });
      const handler = createPredictionV2RedeemPrepareRouteHandler(
        dependencies(runtimeValue),
      );

      const response = await handler(post(REDEEM_INTENT));

      expect(response.status).toBe(503);
      expect(runtimeValue.cancel).not.toHaveBeenCalled();
      expect(runtimeValue.commit).not.toHaveBeenCalled();
    }
  });

  it("rejects response accessors and toJSON substitution before commit", async () => {
    const getterOutput: Record<string, unknown> = {};
    Object.defineProperty(getterOutput, "transaction", {
      enumerable: true,
      get() {
        return { signature: `0x${"66".repeat(65)}` };
      },
    });
    const toJsonOutput: Record<string, unknown> = { value: "safe" };
    Object.defineProperty(toJsonOutput, "toJSON", {
      enumerable: false,
      value() {
        return { signature: `0x${"66".repeat(65)}` };
      },
    });

    for (const output of [getterOutput, toJsonOutput]) {
      const runtimeValue = runtime({
        prepareRedeem: vi.fn(async () =>
          output as PredictionV2RouteJsonObjectV2
        ),
      });
      const response = await createPredictionV2RedeemPrepareRouteHandler(
        dependencies(runtimeValue),
      )(post(REDEEM_INTENT));

      expect(response.status).toBe(503);
      expect(runtimeValue.commit).not.toHaveBeenCalled();
      expect(runtimeValue.cancel).not.toHaveBeenCalled();
    }
  });

  it("maps exact market misses to a closed 404 without refunding started work", async () => {
    const runtimeValue = runtime({
      prepareRedeem: vi.fn(async () => {
        throw new PredictionV2RouteRuntimeErrorV2(
          404,
          "market-not-found",
          false,
        );
      }),
    });
    const handler = createPredictionV2RedeemPrepareRouteHandler(
      dependencies(runtimeValue),
    );

    const response = await handler(post(REDEEM_INTENT));

    expect(response.status).toBe(404);
    expect((await json(response)).code).toBe("market-not-found");
    expect(runtimeValue.cancel).not.toHaveBeenCalled();
  });

  it("never refunds after provider failure or commit failure", async () => {
    const executeFailure = runtime({
      prepareRedeem: vi.fn(async () => {
        throw new Error("provider failed");
      }),
    });
    const commitFailure = runtime({
      commit: vi.fn(async () => {
        throw new Error("commit failed");
      }),
    });
    const executeResponse = await createPredictionV2RedeemPrepareRouteHandler(
      dependencies(executeFailure),
    )(post(REDEEM_INTENT));
    const commitResponse = await createPredictionV2RedeemPrepareRouteHandler(
      dependencies(commitFailure),
    )(post(REDEEM_INTENT));

    expect(executeResponse.status).toBe(503);
    expect(commitResponse.status).toBe(503);
    expect(executeFailure.start).toHaveBeenCalledOnce();
    expect(commitFailure.start).toHaveBeenCalledOnce();
    expect(executeFailure.cancel).not.toHaveBeenCalled();
    expect(commitFailure.cancel).not.toHaveBeenCalled();
  });

  it("never cancels after any start transition was attempted", async () => {
    const runtimeValue = runtime({
      start: vi.fn(async () => "not-started" as const),
    });
    const handler = createPredictionV2RedeemPrepareRouteHandler(
      dependencies(runtimeValue),
    );

    const response = await handler(post(REDEEM_INTENT));

    expect(response.status).toBe(503);
    expect(runtimeValue.prepareRedeem).not.toHaveBeenCalled();
    expect(runtimeValue.cancel).not.toHaveBeenCalled();
  });

  it("does not cancel an ambiguous start transition", async () => {
    const runtimeValue = runtime({
      start: vi.fn(async () => {
        throw new Error("lost start acknowledgement");
      }),
    });
    const handler = createPredictionV2RedeemPrepareRouteHandler(
      dependencies(runtimeValue),
    );

    const response = await handler(post(REDEEM_INTENT));

    expect(response.status).toBe(503);
    expect(runtimeValue.prepareRedeem).not.toHaveBeenCalled();
    expect(runtimeValue.cancel).not.toHaveBeenCalled();
  });

  it("cancels an unstarted lease when the client aborts before start", async () => {
    const controller = new AbortController();
    const runtimeValue = runtime();
    const handler = createPredictionV2RedeemPrepareRouteHandler(
      dependencies(runtimeValue),
    );
    const request = new Request(
      "https://programmable.market/api/prediction/v2/test",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": ACTION_ID,
        },
        body: JSON.stringify(REDEEM_INTENT),
        signal: controller.signal,
      },
    );
    controller.abort();

    const response = await handler(request);

    expect(response.status).toBe(503);
    expect(runtimeValue.start).not.toHaveBeenCalled();
    expect(runtimeValue.prepareRedeem).not.toHaveBeenCalled();
    expect(runtimeValue.cancel).toHaveBeenCalledOnce();
  });

  it("does no provider work and no refund when the client aborts during start", async () => {
    const controller = new AbortController();
    const runtimeValue = runtime({
      start: vi.fn(async () => {
        controller.abort();
        return "started" as const;
      }),
    });
    const handler = createPredictionV2RedeemPrepareRouteHandler(
      dependencies(runtimeValue),
    );
    const request = new Request(
      "https://programmable.market/api/prediction/v2/test",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": ACTION_ID,
        },
        body: JSON.stringify(REDEEM_INTENT),
        signal: controller.signal,
      },
    );

    const response = await handler(request);

    expect(response.status).toBe(503);
    expect(runtimeValue.prepareRedeem).not.toHaveBeenCalled();
    expect(runtimeValue.cancel).not.toHaveBeenCalled();
    expect(runtimeValue.commit).not.toHaveBeenCalled();
  });

  it("never refunds consumed capacity when the client aborts after execute", async () => {
    const controller = new AbortController();
    const runtimeValue = runtime({
      prepareRedeem: vi.fn(async () => {
        controller.abort();
        return Object.freeze({
          schemaVersion: "programmable.prediction-v2.prepared-transaction.v2",
          transaction: Object.freeze({
            to: ACCOUNT,
            data: "0x049104e5",
            value: "0",
          }),
        });
      }),
    });
    const handler = createPredictionV2RedeemPrepareRouteHandler(
      dependencies(runtimeValue),
    );
    const request = new Request(
      "https://programmable.market/api/prediction/v2/test",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": ACTION_ID,
        },
        body: JSON.stringify(REDEEM_INTENT),
        signal: controller.signal,
      },
    );

    const response = await handler(request);

    expect(response.status).toBe(503);
    expect(runtimeValue.prepareRedeem).toHaveBeenCalledOnce();
    expect(runtimeValue.commit).not.toHaveBeenCalled();
    expect(runtimeValue.cancel).not.toHaveBeenCalled();
  });

  it("rejects unknown directory query fields before budget work", async () => {
    const runtimeValue = runtime();
    const handler = createPredictionV2DirectoryRouteHandler(
      dependencies(runtimeValue),
    );

    const response = await handler(new Request(
      "https://programmable.market/api/prediction/v2/directory?limit=8&debug=1",
    ));

    expect(response.status).toBe(400);
    expect(runtimeValue.reserve).not.toHaveBeenCalled();
  });

  it("enforces the read-model directory page maximum before budget work", async () => {
    const runtimeValue = runtime();
    const handler = createPredictionV2DirectoryRouteHandler(
      dependencies(runtimeValue),
    );

    const response = await handler(new Request(
      "https://programmable.market/api/prediction/v2/directory?limit=9",
    ));

    expect(response.status).toBe(400);
    expect(runtimeValue.reserve).not.toHaveBeenCalled();
  });
});
