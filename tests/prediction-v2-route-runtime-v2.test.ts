import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getPredictionV2RouteRuntimeV2,
} from "@/app/api/prediction/v2/_shared/runtime-v2.server";
import { createPredictionV2DirectoryRouteHandler } from
  "@/app/api/prediction/v2/_shared/http-v2";
import {
  PREDICTION_V2_DIRECTORY_ROUTE_MAX_RPC_LOGICAL_CALLS,
  PREDICTION_V2_REDEEM_PREPARE_ROUTE_MAX_RPC_LOGICAL_CALLS,
  PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS,
} from "@/app/api/prediction/v2/_shared/route-bounds-v2.server";
import type { PredictionV2EnabledPublicReleaseV2 } from
  "@/lib/prediction-v2/public-release-v2.server";

function lane(action: string, exactUnitsPerAction: number) {
  return Object.freeze({
    laneId: `robinhood-rpc-quorum:${action}`,
    provider: "robinhood-rpc-quorum",
    action,
    unit: "rpc-logical-call",
    exactUnitsPerAction,
    leaseTtlMs: 30_000,
    idempotencyTtlMs: 60_000,
    capacities: Object.freeze({
      provider: Object.freeze({
        capacityUnits: 10_000,
        windowMs: 60_000,
      }),
      action: Object.freeze({
        capacityUnits: 10_000,
        windowMs: 60_000,
      }),
      client: Object.freeze({
        capacityUnits: 10_000,
        windowMs: 60_000,
      }),
    }),
  });
}

const RELEASE = Object.freeze({
  status: "enabled",
  attestation: Object.freeze({ payloadSha256: `0x${"11".repeat(32)}` }),
  distributedBudgetPolicy: Object.freeze({
    schemaVersion: 2,
    backend: Object.freeze({
      scope: "shared-atomic",
      backendIdCommitment: `sha256:${"22".repeat(32)}`,
    }),
    policy: Object.freeze({
      version: "prediction-v2-distributed-budget/v2",
      backendTimeoutMs: 3_000,
    }),
    lanes: Object.freeze([
      lane("directory", PREDICTION_V2_DIRECTORY_ROUTE_MAX_RPC_LOGICAL_CALLS),
      lane(
        "redeem-prepare",
        PREDICTION_V2_REDEEM_PREPARE_ROUTE_MAX_RPC_LOGICAL_CALLS,
      ),
      lane(
        "resolution-decision",
        PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS,
      ),
    ]),
  }),
}) as unknown as PredictionV2EnabledPublicReleaseV2;

describe("Prediction V2 concrete route runtime", () => {
  it("binds the complete signed route policy to exact composed RPC bounds", () => {
    expect({
      directory: PREDICTION_V2_DIRECTORY_ROUTE_MAX_RPC_LOGICAL_CALLS,
      redeem: PREDICTION_V2_REDEEM_PREPARE_ROUTE_MAX_RPC_LOGICAL_CALLS,
      resolution:
        PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS,
    }).toEqual({ directory: 652, redeem: 144, resolution: 2_296 });
    expect(() => getPredictionV2RouteRuntimeV2(RELEASE)).not.toThrow();
  });

  it.each([
    ["missing", RELEASE.distributedBudgetPolicy.lanes.slice(0, 2)],
    [
      "wrong bound",
      RELEASE.distributedBudgetPolicy.lanes.map((entry) =>
        entry.action === "directory"
          ? lane("directory", entry.exactUnitsPerAction - 1)
          : entry
      ),
    ],
    [
      "extra",
      [...RELEASE.distributedBudgetPolicy.lanes, lane("other", 1)],
    ],
  ] as const)("rejects a %s signed route lane set", (_label, lanes) => {
    const invalidRelease = Object.freeze({
      ...RELEASE,
      distributedBudgetPolicy: Object.freeze({
        ...RELEASE.distributedBudgetPolicy,
        lanes: Object.freeze(lanes),
      }),
    }) as unknown as PredictionV2EnabledPublicReleaseV2;

    expect(() => getPredictionV2RouteRuntimeV2(invalidRelease))
      .toThrow("Invalid Prediction V2 route budget policy");
  });

  it("stays unavailable without a shared atomic backend before Request access", async () => {
    const runtime = getPredictionV2RouteRuntimeV2(RELEASE);
    const throwingRequest = new Proxy({} as Request, {
      get() {
        throw new Error("release-dark runtime must not inspect Request");
      },
    });
    const handler = createPredictionV2DirectoryRouteHandler({
      getRelease: () => RELEASE,
      loadRuntime: async () => runtime,
    });

    const response = await handler(throwingRequest);

    expect(runtime.readiness.productionReady).toBe(false);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: "runtime-unavailable",
      retryable: true,
    }));
  });

  it.each([
    "directory",
    "redeem-prepare",
    "resolution-decision",
  ] as const)(
    "does not reserve %s without a privacy-preserving client scope",
    async (action) => {
      const runtime = getPredictionV2RouteRuntimeV2(RELEASE);
      const throwingRequest = new Proxy({} as Request, {
        get() {
          throw new Error("blocked reservation must not inspect Request");
        },
      });

      const reservation = await runtime.reserve({
        action,
        request: throwingRequest,
        idempotencyKeyMaterial: `opaque-${action}`,
        requestFingerprintMaterial: `opaque-fingerprint-${action}`,
      });

      expect(reservation).toEqual(expect.objectContaining({
        status: "blocked",
        retryAfterSeconds: 30,
      }));
    },
  );

  it("uses no in-memory fallback and cannot authorize provider work", async () => {
    const runtime = getPredictionV2RouteRuntimeV2(RELEASE);
    await expect(runtime.readDirectory({
      release: RELEASE,
      intent: Object.freeze({ limit: 8, cursor: null }),
      lease: Object.freeze({ expiresAtMs: Date.now() + 1_000, opaque: null }),
      signal: new AbortController().signal,
    })).rejects.toThrow("not authorized");
  });
});
