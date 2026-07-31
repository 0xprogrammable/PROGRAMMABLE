import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const readModelMocks = vi.hoisted(() => ({
  getServerReadModel: vi.fn(),
  repeatableReadSnapshot: vi.fn(),
  transactionQuery: vi.fn(),
}));

vi.mock("../../lib/data-pipeline/read-model.server", () => ({
  getServerReadModel: readModelMocks.getServerReadModel,
}));

import { DataPipelineError } from "../../lib/data-pipeline/errors";
import {
  ALL_REVIEWED_ROUTE_SCOPES,
  canonicalizeRouteResponse,
  compareRouteResponses,
  coordinateRouteRead,
  hashCanonicalRouteResponse,
  validatedRecordScopeEvidence,
  type CoordinatedRouteRead,
  type IndexedRouteResult,
  type IndexedProjectionVersion,
  type ReviewedRouteScope,
  type RouteReadiness,
  type RouteScopeProjectionVersion,
} from "../../lib/data-pipeline/route-coordinator.server";

const BLOCK_HASH = `0x${"aB".repeat(32)}`;
const OTHER_BLOCK_HASH = `0x${"cd".repeat(32)}`;
const ADDRESS = `0x${"aB".repeat(20)}`;
const TRANSACTION_HASH = `0x${"Cd".repeat(32)}`;
const CLASSIC_SCOPE = [
  { model: "classic" as const, releaseVersion: "classic-v3" as const },
] as const;
const PROJECTION_VERSION = {
  checkpointId: "00000000-0000-4000-8000-000000000001",
  blockNumber: "100",
  blockHash: BLOCK_HASH.toLowerCase(),
  sourceGroup: "envio-primary",
  projectorVersion: "read-model-v1",
  epochId: "10000000-0000-4000-8000-000000000001",
  pointerGeneration: "3",
  checkpointGeneration: "7",
  reorgGeneration: "1",
} as const;

const ROUTE_FLAGS = [
  "INDEXED_EXPLORE_LIST_READS_ENABLED",
  "INDEXED_EXPLORE_TOKEN_READS_ENABLED",
  "INDEXED_EXPLORE_CHART_READS_ENABLED",
  "INDEXED_CREATOR_PROFILE_READS_ENABLED",
  "INDEXED_CLASSIC_V3_PROFILE_READS_ENABLED",
  "INDEXED_LAUNCH_LOOKUP_ENABLED",
] as const;

function clearCoordinatorEnvironment() {
  for (const name of ROUTE_FLAGS) vi.stubEnv(name, "false");
  vi.stubEnv("INDEXED_READ_SHADOW_COMPARE_ENABLED", "false");
  vi.stubEnv("INDEXED_READ_REQUIRE_PARITY_ENABLED", "true");
  vi.stubEnv("INDEXED_READ_LIVE_FALLBACK_ENABLED", "true");
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function legacyResult(response: Response, source: "rpc" | "blob" = "rpc") {
  return {
    response,
    source,
    checkpoint: { blockNumber: "100", blockHash: BLOCK_HASH },
  } as const;
}

function projectionVersion(
  index: number,
  overrides: Partial<IndexedProjectionVersion> = {},
): IndexedProjectionVersion {
  const suffix = String(index + 1).padStart(12, "0");
  const byte = (index + 1).toString(16).padStart(2, "0");
  return {
    ...PROJECTION_VERSION,
    checkpointId: `00000000-0000-4000-8000-${suffix}`,
    epochId: `10000000-0000-4000-8000-${suffix}`,
    blockNumber: String(100 + index),
    blockHash: `0x${byte.repeat(32)}`,
    sourceGroup: `envio-primary-${index + 1}`,
    projectorVersion: `read-model-v${index + 1}`,
    pointerGeneration: String(3 + index),
    checkpointGeneration: String(7 + index),
    reorgGeneration: String(index),
    ...overrides,
  };
}

function scopedVersions(
  scope: readonly ReviewedRouteScope[],
  versions: readonly IndexedProjectionVersion[] = scope.map((_, index) =>
    projectionVersion(index),
  ),
): readonly RouteScopeProjectionVersion[] {
  return scope.map((member, index) => ({
    ...member,
    version: versions[index]!,
  }));
}

function scopeEvidence(scopes: readonly ReviewedRouteScope[]) {
  return validatedRecordScopeEvidence(
    scopes.map((scope) => ({ scope })),
    (record) => record.scope,
  );
}

function indexedResult(
  response: Response,
  options: {
    scope?: readonly ReviewedRouteScope[];
    recordScopes?: readonly ReviewedRouteScope[];
    versions?: readonly RouteScopeProjectionVersion[];
    comparisonCheckpoint?: { blockNumber: string; blockHash: string };
  } = {},
) {
  const scope = options.scope ?? CLASSIC_SCOPE;
  const versions =
    options.versions ?? scopedVersions(scope, [PROJECTION_VERSION]);
  return {
    response,
    source: "indexed" as const,
    scope,
    scopeEvidence: scopeEvidence(options.recordScopes ?? [scope[0]!]),
    versions,
    comparisonCheckpoint: options.comparisonCheckpoint ?? versions[0]!.version,
    projectionLag: 0,
    reconciledAt: "2026-07-31T08:00:00.000Z",
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  const input = {
    route: "explore-token" as const,
    scope: CLASSIC_SCOPE,
    legacy: vi.fn(async () => legacyResult(jsonResponse({ ok: true }))),
    readiness: vi.fn(async () => [
      {
        ...CLASSIC_SCOPE[0],
        eligibility: "eligible" as const,
        parity: "current" as const,
        version: PROJECTION_VERSION,
      },
    ]),
    comparisonSchema: {
      addressFields: ["address"],
      hashFields: ["transactionHash"],
      integerFields: ["amount"],
    },
    indexed: vi.fn(async () => indexedResult(jsonResponse({ ok: true }))),
    ...overrides,
  };
  const readiness = input.readiness as (
    readModel: Parameters<CoordinatedRouteRead["indexedSnapshot"]>[0],
  ) => Promise<RouteReadiness>;
  const indexed = input.indexed as (
    readModel: Parameters<CoordinatedRouteRead["indexedSnapshot"]>[0],
  ) => Promise<IndexedRouteResult>;
  const snapshotOverride = overrides.indexedSnapshot;
  const indexedSnapshot =
    typeof snapshotOverride === "function"
      ? (snapshotOverride as CoordinatedRouteRead["indexedSnapshot"])
      : vi.fn(async (readModel) => {
          const snapshotReadiness = await readiness(readModel);
          const scopeLength = Array.isArray(input.scope)
            ? input.scope.length
            : 0;
          const mayServe =
            snapshotReadiness.length === scopeLength &&
            snapshotReadiness.every(
              (member) =>
                member.eligibility === "eligible" &&
                member.parity === "current" &&
                member.version !== undefined,
            );
          return {
            readiness: snapshotReadiness,
            ...(mayServe ? { indexed: await indexed(readModel) } : {}),
          };
        });
  return { ...input, indexedSnapshot };
}

describe("canonical route response comparison", () => {
  it("sorts keys, omits undefined object fields, canonicalizes integer strings, and normalizes only addresses and hashes", () => {
    const canonical = canonicalizeRouteResponse(
      {
        z: undefined,
        words: "AbC",
        nested: {
          transactionHash: TRANSACTION_HASH,
          amount: "00042",
          address: ADDRESS,
        },
        array: ["02", "01"],
      },
      {
        addressFields: ["address"],
        hashFields: ["transactionHash"],
        integerFields: ["amount", "array"],
      },
    );

    expect(canonical).toBe(
      `{"array":["2","1"],"nested":{"address":"${ADDRESS.toLowerCase()}","amount":"42","transactionHash":"${TRANSACTION_HASH.toLowerCase()}"},"words":"AbC"}`,
    );
    expect(hashCanonicalRouteResponse({ a: 1, b: 2 })).toMatch(
      /^0x[0-9a-f]{64}$/,
    );
    expect(hashCanonicalRouteResponse({ a: 1, b: 2 })).toBe(
      hashCanonicalRouteResponse({ b: 2, a: 1 }),
    );
  });

  it("preserves array order and caps sanitized mismatch paths", () => {
    const left: Record<string, unknown> = {
      array: ["first", "second"],
      "password=do-not-leak": "left-secret",
    };
    const right: Record<string, unknown> = {
      array: ["second", "first"],
      "password=do-not-leak": "right-secret",
    };
    for (let index = 0; index < 20; index += 1) {
      left[`field${index}`] = index;
      right[`field${index}`] = index + 100;
    }

    const outcome = compareRouteResponses(left, right);
    expect(outcome.kind).toBe("mismatch");
    if (outcome.kind !== "mismatch") throw new Error("expected mismatch");
    expect(outcome.mismatchPaths).toHaveLength(8);
    expect(outcome.mismatchPaths).toContain("$.array[0]");
    expect(JSON.stringify(outcome)).not.toContain("do-not-leak");
    expect(JSON.stringify(outcome)).not.toContain("left-secret");
    expect(JSON.stringify(outcome)).not.toContain("right-secret");
  });

  it("preserves user strings by default and retains hostile object keys", () => {
    expect(compareRouteResponses({ ticker: "01" }, { ticker: "1" }).kind).toBe(
      "mismatch",
    );
    expect(
      compareRouteResponses(
        { amount: "01" },
        { amount: "1" },
        { integerFields: ["amount"] },
      ).kind,
    ).toBe("match");

    const hostile = JSON.parse('{"__proto__":{"different":true}}');
    expect(canonicalizeRouteResponse(hostile)).toBe(
      '{"__proto__":{"different":true}}',
    );
    expect(compareRouteResponses(hostile, {}).kind).toBe("mismatch");
  });
});

describe("route shadow and fallback coordinator", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    clearCoordinatorEnvironment();
    readModelMocks.getServerReadModel.mockReset();
    readModelMocks.repeatableReadSnapshot.mockReset();
    readModelMocks.transactionQuery.mockReset();
    readModelMocks.repeatableReadSnapshot.mockImplementation(
      async (
        work: (transaction: {
          query: typeof readModelMocks.transactionQuery;
        }) => Promise<unknown>,
      ) => work({ query: readModelMocks.transactionQuery }),
    );
    readModelMocks.getServerReadModel.mockResolvedValue({
      health: vi.fn(),
      repeatableReadSnapshot: readModelMocks.repeatableReadSnapshot,
    });
  });

  it("returns the exact legacy Response and does no database work while the route flag is off", async () => {
    const legacyResponse = jsonResponse(
      { exact: "legacy" },
      { status: 206, headers: { "X-Legacy": "exact" } },
    );
    const input = baseInput({
      legacy: vi.fn(async () => legacyResult(legacyResponse)),
    });

    const result = await coordinateRouteRead(input);
    expect(result).toBe(legacyResponse);
    expect(result.status).toBe(206);
    expect(result.headers.get("X-Legacy")).toBe("exact");
    await expect(result.text()).resolves.toBe('{"exact":"legacy"}');
    expect(readModelMocks.getServerReadModel).not.toHaveBeenCalled();
    expect(readModelMocks.repeatableReadSnapshot).not.toHaveBeenCalled();
    expect(input.readiness).not.toHaveBeenCalled();
    expect(input.indexed).not.toHaveBeenCalled();
  });

  it("runs both paths in shadow mode, records a normalized match, and returns legacy byte-for-byte", async () => {
    vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
    vi.stubEnv("INDEXED_READ_SHADOW_COMPARE_ENABLED", "true");
    const legacyResponse = jsonResponse(
      { address: ADDRESS, amount: "0009", word: "KeepCase" },
      { status: 202, headers: { "X-Legacy": "untouched" } },
    );
    const recordComparison = vi.fn(async () => undefined);
    const backgroundTasks: Array<() => Promise<void>> = [];
    const input = baseInput({
      legacy: vi.fn(async () => legacyResult(legacyResponse)),
      indexed: vi.fn(async () =>
        indexedResult(
          jsonResponse(
            {
              word: "KeepCase",
              amount: "9",
              address: ADDRESS.toLowerCase(),
            },
            { status: 202 },
          ),
        ),
      ),
      recordComparison,
      scheduleShadowComparison: vi.fn((task: () => Promise<void>) => {
        backgroundTasks.push(task);
      }),
    });

    const result = await coordinateRouteRead(input);
    expect(result).toBe(legacyResponse);
    expect(result.headers.get("X-Legacy")).toBe("untouched");
    expect(result.headers.get("X-Programmable-Read-Source")).toBeNull();
    expect(input.readiness).not.toHaveBeenCalled();
    expect(input.indexed).not.toHaveBeenCalled();
    expect(recordComparison).not.toHaveBeenCalled();
    expect(backgroundTasks).toHaveLength(1);

    await backgroundTasks[0]!();
    expect(recordComparison).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "match",
        route: "explore-token",
        scope: CLASSIC_SCOPE,
        legacyHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
        indexedHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      }),
    );
  });

  it("marks different checkpoints incomparable without exposing response bodies", async () => {
    vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
    vi.stubEnv("INDEXED_READ_SHADOW_COMPARE_ENABLED", "true");
    const secret = "never-log-this-body";
    const recordComparison = vi.fn(async () => undefined);
    const backgroundTasks: Array<() => Promise<void>> = [];
    const input = baseInput({
      legacy: vi.fn(async () => legacyResult(jsonResponse({ secret }))),
      indexed: vi.fn(async () => ({
        ...indexedResult(jsonResponse({ secret: "different" })),
        versions: scopedVersions(CLASSIC_SCOPE, [
          {
            ...PROJECTION_VERSION,
            blockHash: OTHER_BLOCK_HASH,
          },
        ]),
        comparisonCheckpoint: {
          blockNumber: PROJECTION_VERSION.blockNumber,
          blockHash: OTHER_BLOCK_HASH,
        },
      })),
      recordComparison,
      scheduleShadowComparison: vi.fn((task: () => Promise<void>) => {
        backgroundTasks.push(task);
      }),
    });

    const result = await coordinateRouteRead(input);
    expect(result.status).toBe(200);
    expect(input.readiness).not.toHaveBeenCalled();
    expect(input.indexed).not.toHaveBeenCalled();

    await backgroundTasks[0]!();
    const event = (recordComparison.mock.calls as unknown[][])[0]?.[0];
    expect(event).toMatchObject({
      kind: "incomparable",
      reason: "checkpoint-mismatch",
    });
    expect(JSON.stringify(event)).not.toContain(secret);
    expect(JSON.stringify(event)).not.toContain("different");
  });

  it("contains synchronous recorder failures inside the background task", async () => {
    vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
    vi.stubEnv("INDEXED_READ_SHADOW_COMPARE_ENABLED", "true");
    const legacyResponse = jsonResponse({ ok: true });
    const backgroundTasks: Array<() => Promise<void>> = [];
    const input = baseInput({
      legacy: vi.fn(async () => legacyResult(legacyResponse)),
      recordComparison: vi.fn(() => {
        throw new Error("telemetry unavailable");
      }),
      scheduleShadowComparison: vi.fn((task: () => Promise<void>) => {
        backgroundTasks.push(task);
      }),
    });

    const result = await coordinateRouteRead(input);
    expect(result).toBe(legacyResponse);
    await expect(backgroundTasks[0]!()).resolves.toBeUndefined();
  });

  it("rejects shadow activation without a platform background scheduler", async () => {
    vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
    vi.stubEnv("INDEXED_READ_SHADOW_COMPARE_ENABLED", "true");
    const input = baseInput();

    await expect(coordinateRouteRead(input)).rejects.toBeInstanceOf(
      DataPipelineError,
    );
    expect(input.legacy).not.toHaveBeenCalled();
    expect(input.readiness).not.toHaveBeenCalled();
    expect(input.indexed).not.toHaveBeenCalled();
  });

  it("serves indexed data only after explicit model eligibility and current parity", async () => {
    vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
    const input = baseInput();

    const result = await coordinateRouteRead(input);
    expect(readModelMocks.repeatableReadSnapshot).toHaveBeenCalledTimes(1);
    expect(input.readiness).toHaveBeenCalledTimes(1);
    expect(input.indexed).toHaveBeenCalledTimes(1);
    expect(result.headers.get("X-Programmable-Read-Source")).toBe("indexed");
    expect(result.headers.get("X-Programmable-Projection-Block")).toBe("100");
    expect(result.headers.get("X-Programmable-Projection-Hash")).toBe(
      BLOCK_HASH.toLowerCase(),
    );
    expect(result.headers.get("X-Programmable-Release-Version")).toBe(
      "classic-v3",
    );
  });

  it("does not serve when the atomic snapshot observes a same-checkpoint parity flip", async () => {
    vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
    const stalePreflight = vi.fn(async () => [
      {
        ...CLASSIC_SCOPE[0],
        eligibility: "eligible" as const,
        parity: "current" as const,
        version: PROJECTION_VERSION,
      },
    ]);
    const indexedSnapshot = vi.fn(async () => ({
      readiness: [
        {
          ...CLASSIC_SCOPE[0],
          eligibility: "eligible" as const,
          parity: "mismatch" as const,
          version: PROJECTION_VERSION,
        },
      ],
      indexed: indexedResult(jsonResponse({ ok: true })),
    }));
    const input = baseInput({
      readiness: stalePreflight,
      indexedSnapshot,
    });

    const result = await coordinateRouteRead(input);
    expect(indexedSnapshot).toHaveBeenCalledTimes(1);
    expect(stalePreflight).not.toHaveBeenCalled();
    expect(input.indexed).not.toHaveBeenCalled();
    expect(result.headers.get("X-Programmable-Read-Source")).toBe("rpc");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each([
    { eligibility: "ineligible", parity: "current" },
    { eligibility: "eligible", parity: "pending" },
    { eligibility: "eligible", parity: "stale" },
    { eligibility: "eligible", parity: "mismatch" },
    { eligibility: "eligible", parity: "missing" },
  ] as const)(
    "falls back with no-store when readiness is $eligibility/$parity",
    async (readiness) => {
      vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
      const legacyResponse = jsonResponse(
        { legacy: true },
        {
          headers: {
            "X-Programmable-Read-Source": "indexed",
            "X-Programmable-Projection-Block": "999",
            "X-Programmable-Projection-Hash": OTHER_BLOCK_HASH,
            "Vercel-CDN-Cache-Control": "public, max-age=3600",
            "CDN-Cache-Control": "public, max-age=3600",
            "Surrogate-Control": "max-age=3600",
          },
        },
      );
      const input = baseInput({
        readiness: vi.fn(async () => [
          {
            ...CLASSIC_SCOPE[0],
            ...readiness,
            ...(readiness.parity === "current"
              ? {
                  version: PROJECTION_VERSION,
                }
              : {}),
          },
        ]),
        legacy: vi.fn(async () => legacyResult(legacyResponse, "rpc")),
      });

      const result = await coordinateRouteRead(input);
      expect(input.indexed).not.toHaveBeenCalled();
      expect(result.headers.get("Cache-Control")).toBe("private, no-store");
      expect(result.headers.get("X-Programmable-Read-Source")).toBe("rpc");
      expect(result.headers.get("X-Programmable-Projection-Block")).toBeNull();
      expect(result.headers.get("X-Programmable-Projection-Hash")).toBeNull();
      expect(result.headers.get("Vercel-CDN-Cache-Control")).toBeNull();
      expect(result.headers.get("CDN-Cache-Control")).toBeNull();
      expect(result.headers.get("Surrogate-Control")).toBeNull();
      await expect(result.json()).resolves.toEqual({ legacy: true });
    },
  );

  it("returns a generic no-store 503 without calling legacy when fallback is disabled", async () => {
    vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
    vi.stubEnv("INDEXED_READ_LIVE_FALLBACK_ENABLED", "false");
    const input = baseInput({
      readiness: vi.fn(async () => [
        {
          ...CLASSIC_SCOPE[0],
          eligibility: "eligible" as const,
          parity: "stale" as const,
        },
      ]),
    });

    const result = await coordinateRouteRead(input);
    expect(result.status).toBe(503);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(input.legacy).not.toHaveBeenCalled();
    expect(await result.json()).toEqual({
      error: "read_temporarily_unavailable",
    });
  });

  it("falls back after an indexed dependency failure and returns 503 if fallback also fails", async () => {
    vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
    const first = baseInput({
      indexed: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });
    const fallback = await coordinateRouteRead(first);
    expect(fallback.headers.get("Cache-Control")).toBe("private, no-store");
    expect(fallback.headers.get("X-Programmable-Read-Source")).toBe("rpc");

    const second = baseInput({
      indexed: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
      legacy: vi.fn(async () => {
        throw new Error("rpc unavailable");
      }),
    });
    const unavailable = await coordinateRouteRead(second);
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("never promotes Deep, unknown models, or an incompatible release", async () => {
    vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
    const cases = [
      baseInput({
        scope: [{ model: "deep", releaseVersion: "deep-v3" }],
      }),
      baseInput({
        scope: [{ model: "unknown", releaseVersion: "unknown-v1" }],
      }),
      baseInput({
        route: "classic-v3-profile",
        scope: [{ model: "classic", releaseVersion: "classic-v2" }],
      }),
    ];

    for (const input of cases) {
      await expect(
        coordinateRouteRead(input as Parameters<typeof coordinateRouteRead>[0]),
      ).rejects.toBeInstanceOf(DataPipelineError);
      expect(input.legacy).not.toHaveBeenCalled();
      expect(input.indexed).not.toHaveBeenCalled();
    }
  });

  it("requires every member of an aggregate allowlisted scope to be current", async () => {
    vi.stubEnv("INDEXED_EXPLORE_LIST_READS_ENABLED", "true");
    const scope = ALL_REVIEWED_ROUTE_SCOPES;
    const versions = scopedVersions(scope);
    const currentReadiness = scope.map((member, index) => ({
      ...member,
      eligibility: "eligible" as const,
      parity: "current" as const,
      version: versions[index]!.version,
    }));
    const indexed = vi.fn(async () =>
      indexedResult(jsonResponse({ aggregate: true }), {
        scope,
        recordScopes: scope,
        versions,
      }),
    );
    const current = baseInput({
      route: "explore-list",
      scope,
      readiness: vi.fn(async () => currentReadiness),
      indexed,
    });

    const result = await coordinateRouteRead(current);
    expect(result.headers.get("X-Programmable-Read-Source")).toBe("indexed");
    expect(indexed).toHaveBeenCalledTimes(1);

    const missing = baseInput({
      route: "explore-list",
      scope,
      readiness: vi.fn(async () => currentReadiness.slice(0, -1)),
    });
    const fallback = await coordinateRouteRead(missing);
    expect(fallback.headers.get("X-Programmable-Read-Source")).toBe("rpc");
    expect(missing.indexed).not.toHaveBeenCalled();

    const staleReadiness = currentReadiness.map((member, index) =>
      index === 2
        ? {
            ...member,
            parity: "stale" as const,
            version: undefined,
          }
        : member,
    );
    const stale = baseInput({
      route: "explore-list",
      scope,
      readiness: vi.fn(async () => staleReadiness),
    });
    const staleFallback = await coordinateRouteRead(stale);
    expect(staleFallback.headers.get("X-Programmable-Read-Source")).toBe("rpc");
    expect(stale.indexed).not.toHaveBeenCalled();
  });

  it("discovers a token across reviewed releases and permits zero or one returned scope", async () => {
    vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
    const scope = ALL_REVIEWED_ROUTE_SCOPES;
    const versions = scopedVersions(scope);
    const readiness = scope.map((member, index) => ({
      ...member,
      eligibility: "eligible" as const,
      parity: "current" as const,
      version: versions[index]!.version,
    }));

    const found = baseInput({
      route: "explore-token",
      scope,
      readiness: vi.fn(async () => readiness),
      indexed: vi.fn(async () =>
        indexedResult(jsonResponse({ token: { address: ADDRESS } }), {
          scope,
          recordScopes: [scope[3]!],
          versions,
        }),
      ),
    });
    const foundResponse = await coordinateRouteRead(found);
    expect(foundResponse.headers.get("X-Programmable-Read-Source")).toBe(
      "indexed",
    );
    expect(
      foundResponse.headers.get("X-Programmable-Projection-Block"),
    ).toBeNull();

    const missing = baseInput({
      route: "explore-token",
      scope,
      readiness: vi.fn(async () => readiness),
      indexed: vi.fn(async () =>
        indexedResult(jsonResponse({ token: null }), {
          scope,
          recordScopes: [],
          versions,
        }),
      ),
    });
    const missingResponse = await coordinateRouteRead(missing);
    expect(missingResponse.headers.get("X-Programmable-Read-Source")).toBe(
      "indexed",
    );

    const ambiguous = baseInput({
      route: "explore-token",
      scope,
      readiness: vi.fn(async () => readiness),
      indexed: vi.fn(async () =>
        indexedResult(jsonResponse({ token: { address: ADDRESS } }), {
          scope,
          recordScopes: [scope[0]!, scope[1]!],
          versions,
        }),
      ),
    });
    const ambiguousResponse = await coordinateRouteRead(ambiguous);
    expect(ambiguousResponse.headers.get("X-Programmable-Read-Source")).toBe(
      "rpc",
    );
    expect(ambiguousResponse.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
  });

  it("requires branded scope evidence and rejects Deep before response construction", async () => {
    vi.stubEnv("INDEXED_EXPLORE_LIST_READS_ENABLED", "true");
    const scope = ALL_REVIEWED_ROUTE_SCOPES;
    const versions = scopedVersions(scope);
    const readiness = scope.map((member, index) => ({
      ...member,
      eligibility: "eligible" as const,
      parity: "current" as const,
      version: versions[index]!.version,
    }));
    expect(() =>
      scopeEvidence([
        { model: "deep", releaseVersion: "deep-v3" },
      ] as unknown as readonly ReviewedRouteScope[]),
    ).toThrow(DataPipelineError);

    const input = baseInput({
      route: "explore-list",
      scope,
      readiness: vi.fn(async () => readiness),
      indexed: vi.fn(async () => ({
        ...indexedResult(jsonResponse({ tokens: [] }), {
          scope,
          recordScopes: scope,
          versions,
        }),
        scopeEvidence: Object.freeze({
          recordCount: 1,
          recordScopes: Object.freeze([scope[0]!]),
        }),
      })),
    });

    const result = await coordinateRouteRead(input);
    expect(result.headers.get("X-Programmable-Read-Source")).toBe("rpc");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("refuses an indexed response that advanced beyond its parity checkpoint", async () => {
    vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
    const input = baseInput({
      readiness: vi.fn(async () => [
        {
          ...CLASSIC_SCOPE[0],
          eligibility: "eligible" as const,
          parity: "current" as const,
          version: {
            ...PROJECTION_VERSION,
            blockNumber: "99",
            blockHash: OTHER_BLOCK_HASH,
          },
        },
      ]),
    });

    const result = await coordinateRouteRead(input);
    expect(result.headers.get("X-Programmable-Read-Source")).toBe("rpc");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("refuses a generation change even when block number and hash are unchanged", async () => {
    vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
    const input = baseInput({
      indexed: vi.fn(async () => ({
        ...indexedResult(jsonResponse({ ok: true })),
        versions: scopedVersions(CLASSIC_SCOPE, [
          {
            ...PROJECTION_VERSION,
            reorgGeneration: "2",
          },
        ]),
      })),
    });

    const result = await coordinateRouteRead(input);
    expect(result.headers.get("X-Programmable-Read-Source")).toBe("rpc");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each([
    {
      field: "checkpointId",
      value: "00000000-0000-4000-8000-000000000099",
    },
    { field: "projectorVersion", value: "read-model-v2" },
    { field: "sourceGroup", value: "envio-secondary" },
  ] as const)(
    "refuses a $field change at the same block and generation",
    async ({ field, value }) => {
      vi.stubEnv("INDEXED_EXPLORE_TOKEN_READS_ENABLED", "true");
      const input = baseInput({
        indexed: vi.fn(async () => ({
          ...indexedResult(jsonResponse({ ok: true })),
          versions: scopedVersions(CLASSIC_SCOPE, [
            {
              ...PROJECTION_VERSION,
              [field]: value,
            },
          ]),
        })),
      });

      const result = await coordinateRouteRead(input);
      expect(result.headers.get("X-Programmable-Read-Source")).toBe("rpc");
      expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    },
  );
});
