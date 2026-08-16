import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { evaluateReadModelOperationsSourceContracts } from "../../scripts/perf/read-model-ops-source-contracts.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { resolveProductionBinding } from "../../scripts/perf/read-model-production-binding.mjs";

const ROOT = process.cwd();
const DEPLOYMENT_ID = "dpl_aaaaaaaaaaaaaaaaaaaaaaaa";
const GIT_HEAD = "b".repeat(40);
const PROJECT_ID = "prj_programmable_test";
const AUTHENTICATED_ROUTE = `
  import { timingSafeEqual } from "node:crypto";
  function matchesBearer(request, secret) {
    const authorization = request.headers.get("authorization");
    if (!secret || Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 1_024 || !authorization?.startsWith("Bearer ")) return false;
    const provided = Buffer.from(authorization.slice(7), "utf8");
    const expected = Buffer.from(secret, "utf8");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }
  function authorizationMode(request) {
    const requestedMode = request.headers.get("x-programmable-cutover-mode");
    if (requestedMode !== null) {
      return requestedMode === "raw-backfill-v1" &&
        process.env.PROGRAMMABLE_CUTOVER_BACKFILL_ACTIVE === "true" &&
        matchesBearer(request, process.env.PROGRAMMABLE_CUTOVER_OPERATOR_SECRET)
        ? "cutover" : null;
    }
    return matchesBearer(request, process.env.CRON_SECRET) ? "standard" : null;
  }
  export async function GET(request) {
    const mode = authorizationMode(request);
    if (mode === null) return { status: 401, headers: { "Cache-Control": "no-store" } };
    if (mode === "cutover") runCutover();
    try { return { status: 200, headers: { "Cache-Control": "no-store" } }; }
    catch { return { status: 503, headers: { "Cache-Control": "no-store" } }; }
  }
`;

const SAFE_SOURCE_ACTIVATION = `
  export function projectorRuntimeActivationState(env) {
    const value = env.PROGRAMMABLE_PROJECTOR_ACTIVE;
    if (value === "false" || value === undefined) return "disabled";
    if (value === "true") return "active";
    return invalidRuntimeConfig();
  }
  export async function runConfiguredProjectorCycle(env) {
    if (projectorRuntimeActivationState(env) === "disabled") return { status: "disabled" };
    const leaseController = createProjectorRuntimeLeaseController();
    const acquisition = await leaseController.tryAcquire();
    if (acquisition.status === "busy") return { status: "busy" };
  }
`;

const SAFE_MARKET_ACTIVATION = `
  export async function runConfiguredMarketProjectorCycle(env, store) {
    const value = env.PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE;
    if (value === "false" || value === undefined) return { status: "disabled" };
    if (value !== "true") throw invalidInput("config", "activation");
    const sourceCheckpointGeneration = "1";
    const lease = await store.tryAcquireLease();
    if (!lease) return { status: "busy" };
    try { return { sourceCheckpointGeneration }; }
    finally { await store.releaseLease(lease); }
  }
`;

function watchdogProgram() {
  const workflow = readFileSync(
    resolve(ROOT, ".github/workflows/refresh-production-read-model.yml"),
    "utf8",
  );
  const startMarker = "          node --input-type=module <<'NODE'\n";
  const endMarker = "\n          NODE\n";
  const start = workflow.indexOf(startMarker);
  const end = workflow.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const inlineProgram = workflow
    .slice(start + startMarker.length, end)
    .replace(
      '          import { appendFile } from "node:fs/promises";',
      "          const appendFile = async () => undefined;",
    );
  const AsyncFunction = Object.getPrototypeOf(async () => undefined)
    .constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<void>;
  return new AsyncFunction(
    "process",
    "fetch",
    "Buffer",
    "AbortSignal",
    "URL",
    "setTimeout",
    "console",
    inlineProgram,
  );
}

function watchdogProcessEnvironment() {
  return {
    env: {
      TARGET_ORIGIN: "https://programmable.market",
      CRON_SECRET: "test-production-cron-secret-32-characters",
      SCHEDULER_RUN_ID: "1234",
      SCHEDULER_RUN_ATTEMPT: "1",
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

const PROVIDER_EVIDENCE_MIGRATION = `
  create table programmable_private.projection_provider_execution_evidence();
  create table programmable_private.reward_snapshot_provider_evidence();
  create table programmable_private.projection_publication_provider_bindings();
  alter table programmable_private.projection_provider_execution_evidence force row level security;
`;

const MARKET_MIGRATION = `
  create table programmable_private.market_projector_cursor_history();
  create table programmable_private.market_snapshot_lineage_memberships();
  create table programmable_private.market_candle_lineage_memberships();
  create function programmable_private.try_acquire_market_projector_runtime_lease_v1();
  create function programmable_private.assert_market_projector_runtime_lease_v1();
  create function programmable_private.release_market_projector_runtime_lease_v1();
  select * from programmable_private.projector_checkpoint_current;
  if cursor_block_global_log_index <> 4294967295 then raise exception 'partial'; end if;
  if cursor_candidate_id <> 'empty-page' then raise exception 'partial'; end if;
  alter table programmable_private.market_projector_cursor_history force row level security;
`;

function integratedOverrides() {
  return {
    "app/api/ops/projector/route.ts": AUTHENTICATED_ROUTE,
    "lib/data-pipeline/projector-runtime-config.server.ts":
      SAFE_SOURCE_ACTIVATION,
    "supabase/migrations/20260731224000_projector_provider_evidence_binding.sql":
      PROVIDER_EVIDENCE_MIGRATION,
    "app/api/ops/market-projector/route.ts": AUTHENTICATED_ROUTE,
    "lib/data-pipeline/market-projector-runtime.server.ts":
      SAFE_MARKET_ACTIVATION,
    "supabase/migrations/20260731223000_market_projector_contract.sql":
      MARKET_MIGRATION,
  };
}

function fixtureDigests() {
  return Object.fromEntries(
    Object.entries(integratedOverrides()).map(([path, source]) => [
      path,
      createHash("sha256").update(source).digest("hex"),
    ]),
  );
}

describe("read-model operations source contract", () => {
  it("executes the exact watchdog program only after block-bound freshness and quorum proof", async () => {
    const requests: Array<{ authorization: string | null; url: string }> = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({
        authorization: headers.get("authorization"),
        url,
      });
      if (url.endsWith("/api/ops/index-v2")) {
        return jsonResponse({
          ok: true,
          blockNumber: "25740000",
          tokenCount: 343,
          updated: true,
          portfolioHistory: {
            status: "recorded",
            blockNumber: "25740000",
            tokenCount: 343,
            path: "portfolio-history/1/2026-08-13T05.json",
          },
        });
      }
      return jsonResponse({
        status: "healthy",
        chainId: 1,
        index: {
          ageSeconds: 2,
          blockNumber: "25740001",
          tokenCount: 343,
        },
        indexSource: "durable",
        indexedReadModel: { status: "disabled" },
        rpc: {
          status: "healthy",
          chainId: 1,
          read: { status: "available" },
          providers: {
            primary: {
              status: "available",
              head: "25740014",
              headAgeSeconds: 3,
            },
            secondary: {
              status: "available",
              head: "25740013",
              headAgeSeconds: 4,
            },
          },
          freshness: { maxHeadAgeSeconds: 300 },
          quorum: { status: "verified" },
          confirmedBlock: {
            number: "25740012",
            hash: `0x${"12".repeat(32)}`,
          },
        },
      });
    };
    const logged: string[] = [];
    await watchdogProgram()(
      watchdogProcessEnvironment(),
      fetch,
      Buffer,
      AbortSignal,
      URL,
      setTimeout,
      {
        log: (value: string) => logged.push(value),
      },
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe(
      "https://programmable.market/api/ops/index-v2",
    );
    expect(requests[0]?.authorization).toBe(
      "Bearer test-production-cron-secret-32-characters",
    );
    expect(requests[1]?.url).toContain(
      "https://programmable.market/api/ops/health?scheduler_proof=1234-1-1",
    );
    expect(requests[1]?.authorization).toBeNull();
    expect(JSON.parse(logged.at(-1) ?? "{}")).toMatchObject({
      refreshBlockNumber: "25740000",
      visibleBlockNumber: "25740001",
      confirmedBlockNumber: "25740012",
      confirmedBlockHash: `0x${"12".repeat(32)}`,
      ageSeconds: 2,
    });
  });

  it.each([
    [
      "missing confirmed block",
      (rpc: Record<string, unknown>) => {
        const remaining = { ...rpc };
        delete remaining.confirmedBlock;
        return remaining;
      },
    ],
    [
      "zero confirmed block hash",
      (rpc: Record<string, unknown>) => ({
        ...rpc,
        confirmedBlock: { number: "25740012", hash: `0x${"00".repeat(32)}` },
      }),
    ],
    [
      "confirmed block behind visible index",
      (rpc: Record<string, unknown>) => ({
        ...rpc,
        confirmedBlock: { number: "25740000", hash: `0x${"12".repeat(32)}` },
      }),
    ],
    [
      "secondary provider behind confirmed block",
      (rpc: Record<string, unknown>) => ({
        ...rpc,
        providers: {
          ...(rpc.providers as Record<string, unknown>),
          secondary: {
            status: "available",
            head: "25740011",
            headAgeSeconds: 4,
          },
        },
      }),
    ],
  ])("fails closed on %s", async (_label, mutateRpc) => {
    let attempts = 0;
    const validRpc = {
      status: "healthy",
      chainId: 1,
      read: { status: "available" },
      providers: {
        primary: {
          status: "available",
          head: "25740014",
          headAgeSeconds: 3,
        },
        secondary: {
          status: "available",
          head: "25740013",
          headAgeSeconds: 4,
        },
      },
      freshness: { maxHeadAgeSeconds: 300 },
      quorum: { status: "verified" },
      confirmedBlock: {
        number: "25740012",
        hash: `0x${"12".repeat(32)}`,
      },
    };
    const fetch = async (input: string | URL | Request) => {
      if (String(input).endsWith("/api/ops/index-v2")) {
        return jsonResponse({
          ok: true,
          blockNumber: "25740000",
          tokenCount: 343,
          updated: true,
          portfolioHistory: {
            status: "recorded",
            blockNumber: "25740000",
            tokenCount: 343,
            path: "portfolio-history/1/2026-08-13T05.json",
          },
        });
      }
      attempts += 1;
      return jsonResponse({
        status: "healthy",
        chainId: 1,
        index: {
          ageSeconds: 2,
          blockNumber: "25740001",
          tokenCount: 343,
        },
        indexSource: "durable",
        indexedReadModel: { status: "disabled" },
        rpc: mutateRpc(validRpc),
      });
    };
    await expect(
      watchdogProgram()(
        watchdogProcessEnvironment(),
        fetch,
        Buffer,
        AbortSignal,
        URL,
        (callback: () => void) => {
          callback();
          return 0;
        },
        { log: () => undefined },
      ),
    ).rejects.toThrow("production read-model freshness proof failed");
    expect(attempts).toBe(18);
  });

  it("executes the exact watchdog program fail-closed on stale public health", async () => {
    let attempts = 0;
    const fetch = async (input: string | URL | Request) => {
      if (String(input).endsWith("/api/ops/index-v2")) {
        return jsonResponse({
          ok: true,
          blockNumber: "25740000",
          tokenCount: 343,
          updated: false,
          portfolioHistory: {
            status: "already-recorded",
            blockNumber: "25740000",
            tokenCount: 343,
            path: "portfolio-history/1/2026-08-13T05.json",
          },
        });
      }
      attempts += 1;
      return jsonResponse({
        status: "healthy",
        chainId: 1,
        index: {
          ageSeconds: 601,
          blockNumber: "25740000",
          tokenCount: 343,
        },
        indexSource: "durable",
        indexedReadModel: { status: "disabled" },
        rpc: {
          status: "healthy",
          chainId: 1,
          read: { status: "available" },
          quorum: { status: "verified" },
        },
      });
    };
    await expect(
      watchdogProgram()(
        watchdogProcessEnvironment(),
        fetch,
        Buffer,
        AbortSignal,
        URL,
        (callback: () => void) => {
          callback();
          return 0;
        },
        { log: () => undefined },
      ),
    ).rejects.toThrow("production read-model freshness proof failed");
    expect(attempts).toBe(18);
  });

  it("executes the exact watchdog program fail-closed on unbound portfolio history", async () => {
    const fetch = async () =>
      jsonResponse({
        ok: true,
        blockNumber: "25740000",
        tokenCount: 343,
        updated: true,
        portfolioHistory: {
          status: "recorded",
          blockNumber: "25739999",
          tokenCount: 343,
          path: "portfolio-history/1/2026-08-13T05.json",
        },
      });
    await expect(
      watchdogProgram()(
        watchdogProcessEnvironment(),
        fetch,
        Buffer,
        AbortSignal,
        URL,
        setTimeout,
        {
          log: () => undefined,
        },
      ),
    ).rejects.toThrow("production read-model refresh failed (200)");
  });

  it("binds the per-minute schedulers, activation gates and release workflow", () => {
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: integratedOverrides(),
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects scheduler, authorization and activation drift", () => {
    const vercelPath = resolve(ROOT, "vercel.json");
    const drift = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        "app/api/ops/index/route.ts":
          'export { GET } from "../index-v2/route";',
        "vercel.json": readFileSync(vercelPath, "utf8")
          .replace('"* * * * *"', '"*/2 * * * *"')
          .replace(
            '"path": "/api/ops/market-projector"',
            '"path": "/api/ops/reconcile-preparity"',
          ),
        "app/api/ops/projector/route.ts": AUTHENTICATED_ROUTE.replace(
          "process.env.CRON_SECRET",
          "process.env.AUTOMATION_SECRET",
        ),
        "lib/data-pipeline/market-projector-runtime.server.ts":
          SAFE_MARKET_ACTIVATION.replace('value !== "true"', "false"),
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(drift.failures.map(({ id }: { id: string }) => id)).toEqual(
      expect.arrayContaining([
        "ops-cron-exact-set",
        "ops-legacy-alias-closed",
        "ops-source-projector-schedule",
        "ops-source-projector-route-auth",
        "ops-market-projector-activation",
        "ops-reconciler-unscheduled",
      ]),
    );
  });

  it.each([
    [
      "the pre-platform deadline",
      "app/api/ops/index-v2/route.ts",
      "const INDEX_REFRESH_DEADLINE_MS = 270_000;",
      "const INDEX_REFRESH_DEADLINE_MS = 300_000;",
    ],
    [
      "settled concurrent event filters",
      "lib/onchain/read-model.ts",
      "const readLogs = () =>\n      allSettledOrThrow([",
      "const readLogs = () =>\n      Promise.all([",
    ],
    [
      "serialized Classic V2 provider passes",
      "lib/onchain/read-model.ts",
      "const indexedEventSets = await mapInBatches(",
      "const indexedEventSets = await allSettledOrThrow(",
    ],
    [
      "parallel registry slices",
      "lib/onchain/read-model.ts",
      "await settleParallelReadsInOrder([",
      "await Promise.all([",
    ],
    [
      "settled registry orchestration",
      "lib/onchain/parallel-reads.ts",
      "Promise.allSettled(",
      "Promise.all(",
    ],
    [
      "timeout range bisection",
      "lib/onchain/read-model.ts",
      "error instanceof TimeoutError",
      "false",
    ],
    [
      "single-block adaptive floor",
      "lib/onchain/read-model.ts",
      "const MINIMUM_LOG_BLOCK_RANGE = 1n;",
      "const MINIMUM_LOG_BLOCK_RANGE = 100n;",
    ],
    [
      "bounded minimum-window retries",
      "lib/onchain/read-model.ts",
      "const MINIMUM_RANGE_TRANSIENT_RETRIES = 2;",
      "const MINIMUM_RANGE_TRANSIENT_RETRIES = 0;",
    ],
    [
      "post-success range recovery",
      "lib/onchain/read-model.ts",
      "logBlockRange * 2n",
      "logBlockRange",
    ],
    [
      "Classic V2 result-limit range bisection",
      "lib/onchain/read-model.ts",
      "error instanceof LimitExceededRpcError ||",
      "false ||",
    ],
    [
      "Classic V2 durable segment range bisection",
      "lib/onchain/read-model.ts",
      "isPersistentCacheRangeLimitError(error)",
      "false",
    ],
    [
      "Classic V3 complete-range settlement",
      "lib/onchain/classic-v3-read-model.ts",
      "allSettledOrThrow([",
      "Promise.all([",
    ],
    [
      "serialized Classic V3 provider passes",
      "lib/onchain/classic-v3-read-model.ts",
      "const sets = await mapInBatches(",
      "const sets = await allSettledOrThrow(",
    ],
    [
      "Classic V3 result-limit range bisection",
      "lib/onchain/classic-v3-read-model.ts",
      "error instanceof LimitExceededRpcError ||",
      "false ||",
    ],
    [
      "Classic V3 shared four-cursor checkpoint",
      "lib/onchain/classic-v3-read-model.ts",
      "expectedCursorBindings: clients.length * 2",
      "expectedCursorBindings: clients.length",
    ],
    [
      "Classic V3 symmetric provider streams",
      "lib/onchain/classic-v3-read-model.ts",
      "expectedStreamsPerProvider: 2",
      "expectedStreamsPerProvider: 1",
    ],
    [
      "Classic V3 bounded checkpoint window",
      "lib/onchain/classic-v3-read-model.ts",
      "bindPersistentRpcIntegrityCheckpointWindow({",
      "void ({",
    ],
    [
      "Classic V3 raw event provenance quorum",
      "lib/onchain/classic-v3-read-model.ts",
      "eventProvenance: value.eventProvenance",
      "eventProvenance: []",
    ],
    [
      "v4 cache namespace",
      "lib/onchain/persistent-rpc-cache.server.ts",
      'const CACHE_SCHEMA = "programmable-rpc-log-cursor-v4";',
      'const CACHE_SCHEMA = "programmable-rpc-log-cursor-v3";',
    ],
    [
      "bounded dense-stream cursor capacity",
      "lib/onchain/persistent-rpc-cache.server.ts",
      "maxCursorSegments: 16,",
      "maxCursorSegments: 8,",
    ],
    [
      "bounded dense-stream replay budget",
      "lib/onchain/persistent-rpc-cache.server.ts",
      "maxSegmentReadsPerOperation: 16,",
      "maxSegmentReadsPerOperation: 8,",
    ],
    [
      "single group-head CAS",
      "lib/onchain/persistent-rpc-cache.server.ts",
      "const published = checkpoint.etag === null",
      'const published = "created"',
    ],
    [
      "post-publish marker activation",
      "lib/onchain/persistent-rpc-cache.server.ts",
      'scope.commitId,\n          "committed",',
      'scope.commitId,\n          "pending",',
    ],
    [
      "previous whole-generation fallback",
      "lib/onchain/persistent-rpc-cache.server.ts",
      'pointedMarker.status !== "committed"',
      'pointedMarker.status === "committed"',
    ],
    [
      "retired namespace rejection",
      "lib/onchain/persistent-rpc-cache.server.ts",
      "Persistent RPC cache path uses a retired namespace",
      "Persistent RPC cache path is accepted",
    ],
    [
      "Stock launcher topic-OR filtering",
      "lib/onchain/stock-paired-read-model.ts",
      "events: STOCK_LAUNCHER_EVENTS",
      "event: launchedEvent",
    ],
    [
      "serialized Stock-Paired provider passes",
      "lib/onchain/stock-paired-read-model.ts",
      "const eventSets = await mapInBatches(",
      "const eventSets = await allSettledOrThrow(",
    ],
    [
      "Stock result-limit range bisection",
      "lib/onchain/stock-paired-read-model.ts",
      "error instanceof LimitExceededRpcError ||",
      "false ||",
    ],
    [
      "Stock durable segment range bisection",
      "lib/onchain/stock-paired-read-model.ts",
      "isPersistentCacheRangeLimitError(error)",
      "false",
    ],
    [
      "recovery-only 500-block log windows",
      "lib/onchain/historical-read-rpc.server.ts",
      "const RECOVERY_MAX_LOG_BLOCK_RANGE = 500n;",
      "const RECOVERY_MAX_LOG_BLOCK_RANGE = 5_000n;",
    ],
  ])(
    "rejects a legacy refresh missing %s",
    (_label, path, needle, replacement) => {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      expect(source).toContain(needle);
      const result = evaluateReadModelOperationsSourceContracts(ROOT, {
        sourceOverrides: {
          ...integratedOverrides(),
          [path]: source.replace(needle, replacement),
        },
        expectedSha256Overrides: fixtureDigests(),
      });
      expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
        "ops-legacy-bounded-refresh",
      );
    },
  );

  it("binds the public fast lane while preserving profile and action RPC boundaries", () => {
    const result = evaluateReadModelOperationsSourceContracts(ROOT);
    expect(result.failures).toEqual([]);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ops-public-provider-split-source-contract",
          status: "pass",
        }),
        expect.objectContaining({
          id: "ops-profile-claim-trade-provider-boundary",
          status: "pass",
        }),
        expect.objectContaining({
          id: "ops-protected-public-provider-stage-smoke",
          status: "pass",
        }),
        expect.objectContaining({
          id: "ops-obsolete-public-read-gates-absent",
          status: "pass",
        }),
      ]),
    );
  });

  it("pins the dRPC launch catalog cache to one fresh commitment-bound singleflight", () => {
    const result = evaluateReadModelOperationsSourceContracts(ROOT);
    expect(result.failures).toEqual([]);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ops-primary-rpc-launch-catalog-cache-contract",
          status: "pass",
        }),
      ]),
    );
  });

  it.each([
    [
      "a ten-minute TTL",
      "export const PRIMARY_RPC_LAUNCH_CATALOG_CACHE_TTL_MS = 60_000;",
      "export const PRIMARY_RPC_LAUNCH_CATALOG_CACHE_TTL_MS = 600_000;",
    ],
    [
      "no literal TTL",
      "export const PRIMARY_RPC_LAUNCH_CATALOG_CACHE_TTL_MS = 60_000;\n",
      "",
    ],
    [
      "an unbound cache hit",
      "cacheKeyHasCommitment(cached.key, binding.endpointCommitment)",
      "true",
    ],
    [
      "no shared in-flight refresh",
      "let refresh = refreshes.get(refreshKey) ?? null;",
      "let refresh = null;",
    ],
    [
      "a stale cache return",
      "cached = null;",
      "return cached.catalog;",
    ],
  ])("rejects the dRPC launch catalog cache with %s", (_label, needle, replacement) => {
    const path = "lib/market-data/primary-rpc-launches.server.ts";
    const source = readFileSync(resolve(ROOT, path), "utf8");
    expect(source).toContain(needle);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: source.replace(needle, replacement) },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-primary-rpc-launch-catalog-cache-contract",
    );
  });

  it("accepts the exact last-good identity and Dexscreener split", () => {
    const result = evaluateReadModelOperationsSourceContracts(ROOT);
    expect(result.failures.map(({ id }: { id: string }) => id)).not.toContain(
      "ops-public-provider-split-source-contract",
    );
  });

  it.each([
    [
      "an RPC identity read",
      "readLastGoodLaunchCatalogV1({",
      "readPrimaryRpcExploreEntriesV1({",
    ],
    [
      "Bitquery market enrichment",
      "readDexscreenerExploreEntriesV1(filtered, {",
      "readBitqueryTokenMarketDataStrictV1(filtered, {",
    ],
    [
      "a falsely current Custom lane",
      'let customStatus: "current" | "unavailable" = "unavailable"',
      'let customStatus: "current" | "unavailable" = "current"',
    ],
    [
      "a different market provider",
      '"X-Programmable-Market-Provider": "dexscreener"',
      '"X-Programmable-Market-Provider": "unknown"',
    ],
    [
      "FDV ordering for unavailable values",
      '"launch-order" as const',
      '"fdv" as const',
    ],
  ])("rejects the Explore fast-lane contract with %s", (_label, needle, replacement) => {
    const path = "app/api/explore/route.ts";
    const route = readFileSync(resolve(ROOT, path), "utf8");
    expect(route).toContain(needle);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: route.replaceAll(needle, replacement) },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-public-provider-split-source-contract",
    );
  });

  it("rejects a public route that restores a durable availability read", () => {
    const path = "app/api/explore/route.ts";
    const route = readFileSync(resolve(ROOT, path), "utf8");
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        [path]: route + "\nreadDurableExploreModel();\n",
      },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-public-provider-split-source-contract",
    );
  });

  it("rejects a public release manifest that requires a secondary RPC", () => {
    const path = "config/read-model-operations.v1.json";
    const manifest = JSON.parse(
      readFileSync(resolve(ROOT, path), "utf8"),
    ) as Record<string, unknown>;
    const postPromotion = manifest.postPromotion as Record<string, unknown>;
    const rpc = postPromotion.rpc as Record<string, unknown>;
    const drifted = JSON.stringify(
      {
        ...manifest,
        postPromotion: {
          ...postPromotion,
          rpc: { ...rpc, secondaryRequired: true },
        },
      },
      null,
      2,
    );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: drifted },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-config-schema",
    );
  });

  it("rejects a public launch route that restores Bitquery identity discovery", () => {
    const path = "app/api/explore/route.ts";
    const route = readFileSync(resolve(ROOT, path), "utf8");
    expect(route).toContain("readLastGoodLaunchCatalogV1");
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        [path]: route.replaceAll(
          "readLastGoodLaunchCatalogV1",
          "readBitqueryExploreEntriesV1",
        ),
      },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-public-provider-split-source-contract",
    );
  });

  it.each([
    [
      "token detail headers that claim Custom Registry identity",
      '"X-Programmable-Launch-Source": input.launchSource',
      '"X-Programmable-Launch-Source": "registry.custom-launched"',
    ],
    [
      "token detail that restores a runtime RPC catalog",
      "readLastGoodLaunchCatalogV1({",
      "readPrimaryRpcExploreEntriesV1({",
    ],
    [
      "token detail that restores Custom Registry as a hidden fallback",
      "const entry: ExploreEntry | null = canonicalEntry ?? customEntries.find(",
      "const entry: ExploreEntry | null = canonicalEntry ?? [/* hidden */].find(",
    ],
  ])("rejects %s", (_label, needle, replacement) => {
    const path = "app/api/explore/token/route.ts";
    const route = readFileSync(resolve(ROOT, path), "utf8");
    expect(route).toContain(needle);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: route.replaceAll(needle, replacement) },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-public-provider-split-source-contract",
    );
  });

  it("rejects a public action route that restores RPC quorum selection", () => {
    const path = "app/api/trade/prepare/route.ts";
    const route = readFileSync(resolve(ROOT, path), "utf8");
    expect(route).toContain("tradeActionRpcProvider");
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        [path]: route.replaceAll(
          "tradeActionRpcProvider",
          "tradeActionRpcProviders",
        ),
      },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-profile-claim-trade-provider-boundary",
    );
  });

  it.each([
    [
      "profile provider provenance",
      "app/api/explore/profile/route.ts",
      '"X-Programmable-Read-Source": "drpc"',
      '"X-Programmable-Read-Source": "unknown"',
    ],
    [
      "claim receipt binding",
      "app/api/explore/profile/claim/route.ts",
      'status: "not-submitted" as const',
      'status: "submitted" as const',
    ],
    [
      "action write authority",
      "app/api/explore/profile/claim/route.ts",
      'export async function POST',
      'writeContract();\nexport async function POST',
    ],
  ])("rejects a drifted %s", (_label, path, needle, replacement) => {
    const source = readFileSync(resolve(ROOT, path), "utf8");
    expect(source).toContain(needle);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: source.replace(needle, replacement) },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-profile-claim-trade-provider-boundary",
    );
  });

  it.each([
    [
      "an RPC endpoint variable",
      "const ADDRESS =",
      "const PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL = 'secret';\\nconst ADDRESS =",
    ],
    ["more than one 503 retry", "attempt < 2", "attempt < 3"],
    [
      "an unbounded retry status",
      "response.status === 503 && attempt === 0",
      "response.status >= 500 && attempt === 0",
    ],
    [
      "an unbounded response reader",
      "readBoundedResponseText(response",
      "response.text(",
    ],
    [
      "authoritative legacy health",
      'healthAuthority: "informational-only"',
      'healthAuthority: "authoritative"',
    ],
    [
      "current Dexscreener freshness",
      'valuation.freshness === "provider-recent"',
      'valuation.freshness === "current"',
    ],
    [
      "no composite launch-source binding",
      "catalog.launchSource === launchSource",
      "catalog.launchSource === source",
    ],
    [
      "no custom-project identity parser",
      'token.exploreKind !== "custom-project" ||\n    !/^sha256:[0-9a-f]{64}$/u.test(String(token.customProjectId ?? ""))',
      'token.exploreKind !== "unsupported" ||\n    !/^sha256:[0-9a-f]{64}$/u.test(String(token.customProjectId ?? ""))',
    ],
    [
      "a different market provider",
      'marketProvider: "dexscreener"',
      'marketProvider: "unknown"',
    ],
    [
      "no unavailable launch-order proof",
      "!exactSamePageOrder(highest, newest)",
      "false",
    ],
    [
      "no token detail probe",
      '"/api/explore/token?address="',
      '"/api/explore/other?address="',
    ],
    [
      "no profile response probe",
      '"/api/explore/profile?account="',
      '"/api/explore/other?account="',
    ],
  ])("rejects a staged static/Dex smoke with %s", (_label, needle, replacement) => {
    const path = "scripts/smoke-static-dexscreener-public-apis.mjs";
    const smoke = readFileSync(resolve(ROOT, path), "utf8");
    expect(smoke).toContain(needle);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: smoke.replace(needle, replacement) },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-public-provider-stage-smoke",
    );
  });

  it("wires the executable smoke into the Custom v2 CI verifier", () => {
    const path = "package.json";
    const packageSource = readFileSync(resolve(ROOT, path), "utf8");
    const packageJson = JSON.parse(packageSource) as {
      scripts: Record<string, string>;
    };
    const needle = "scripts/test/smoke-static-dexscreener-public-apis.test.mjs";
    expect(packageJson.scripts["verify:custom-v2:ci"]).toContain(needle);
    packageJson.scripts["verify:custom-v2:ci"] =
      packageJson.scripts["verify:custom-v2:ci"].replace(needle, "");
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: JSON.stringify(packageJson) },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-public-provider-stage-smoke",
    );
  });

  it.each([
    [
      "the active public smoke",
      "runProductionStaticDexscreenerSmokeV1({ fetchImpl })",
      "Promise.resolve()",
    ],
    [
      "the exact deployment binding",
      "verifyProductionDeploymentBinding({",
      "Promise.resolve([{ status: \"pass\" }]) && ({",
    ],
  ])("rejects a post-promotion verifier without %s", (_label, needle, replacement) => {
    const path = "scripts/perf/read-model-post-promotion.mjs";
    const source = readFileSync(resolve(ROOT, path), "utf8");
    expect(source).toContain(needle);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: source.replace(needle, replacement) },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-post-promotion-binding",
    );
  });

  it("rejects a deprecated post-promotion verifier alias", () => {
    const path = "scripts/perf/read-model-post-promotion.mjs";
    const source = readFileSync(resolve(ROOT, path), "utf8");
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        [path]: `${source}\nexport const verifyLegacyReadModelPostPromotion = () => null;\n`,
      },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-post-promotion-binding",
    );
  });

  it("rejects a deployment workflow that does not invoke the exact smoke", () => {
    const path = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, path), "utf8");
    const needle = "node scripts/smoke-static-dexscreener-public-apis.mjs";
    expect(workflow).toContain(needle);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: workflow.replace(needle, "true") },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-public-provider-stage-smoke",
    );
  });

  it.each([
    [
      "market-read status output",
      "MARKET_READ_STATUS: ${{ steps.public-provider-smoke.outputs.market_read_status }}",
      "MARKET_READ_STATUS: unavailable",
    ],
    [
      "detail status output",
      "DETAIL_SMOKE_STATUS: ${{ steps.public-provider-smoke.outputs.detail_status }}",
      "DETAIL_SMOKE_STATUS: unavailable",
    ],
    [
      "chart status output",
      "CHART_SMOKE_STATUS: ${{ steps.public-provider-smoke.outputs.chart_status }}",
      "CHART_SMOKE_STATUS: unavailable",
    ],
  ])("rejects a staged handoff without %s", (_label, needle, replacement) => {
    const path = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, path), "utf8");
    expect(workflow).toContain(needle);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: workflow.replace(needle, replacement) },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-public-provider-stage-smoke",
    );
  });

  it("rejects restored staged read-model availability gates", () => {
    const path = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, path), "utf8");
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        [path]: workflow + "\n# npm run perf:read-model:staged-health\n",
      },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-obsolete-public-read-gates-absent",
    );
  });

  it("keeps auth-only probes separate from real-block SLA evidence", () => {
    const gatePath = "scripts/perf/read-model-real-block-sla-gate.mjs";
    const driftedGate = readFileSync(resolve(ROOT, gatePath), "utf8").replace(
      "REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS = 10_000",
      "REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS = 60_000",
    );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [gatePath]: driftedGate,
      },
      expectedSha256Overrides: {
        ...fixtureDigests(),
        [gatePath]: createHash("sha256").update(driftedGate).digest("hex"),
      },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-real-block-sla-gate-binding",
    );
  });

  it("binds the bounded exclusive real-block SLA operator before promotion", () => {
    const operatorPath = "scripts/perf/read-model-real-block-sla-operator.mjs";
    const runbookPath = "docs/operations/read-model-scheduler-cutover.md";
    const unboundedOperator = readFileSync(
      resolve(ROOT, operatorPath),
      "utf8",
    ).replace(
      "REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS = 5 * 60 * 1_000",
      "REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS = 10 * 60 * 1_000",
    );
    const bypassedRunbook = readFileSync(
      resolve(ROOT, runbookPath),
      "utf8",
    ).replace(
      "npm run perf:read-model:real-block-sla-operator --",
      "npm run perf:read-model:real-block-sla-operator-skipped --",
    );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [operatorPath]: unboundedOperator,
        [runbookPath]: bypassedRunbook,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toEqual(
      expect.arrayContaining([
        "ops-real-block-sla-operator-binding",
        "ops-post-promotion-binding",
      ]),
    );
  });

  it("keeps the staging workflow unable to bypass the manual real-block SLA gate", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const runbookPath = "docs/operations/read-model-scheduler-cutover.md";
    const unsafeWorkflow = `${readFileSync(resolve(ROOT, workflowPath), "utf8")}
      - name: Unsafe direct promotion
        run: vercel promote "$DEPLOYMENT_ID"
    `;
    const missingSlaGate = readFileSync(
      resolve(ROOT, runbookPath),
      "utf8",
    ).replace(
      "npm run perf:read-model:real-block-sla --",
      "npm run perf:read-model:real-block-sla-skipped --",
    );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [workflowPath]: unsafeWorkflow,
        [runbookPath]: missingSlaGate,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toEqual([
      "ops-post-promotion-binding",
    ]);
  });

  it("fails when only the scheduler runbook real-block SLA command is missing", () => {
    const runbookPath = "docs/operations/read-model-scheduler-cutover.md";
    const missingSlaGate = readFileSync(
      resolve(ROOT, runbookPath),
      "utf8",
    ).replace(
      "npm run perf:read-model:real-block-sla --",
      "npm run perf:read-model:real-block-sla-skipped --",
    );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [runbookPath]: missingSlaGate,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toEqual([
      "ops-post-promotion-binding",
    ]);
  });

  it("keeps the historical candidate cutover retired and non-executable", () => {
    const runbookPath = "docs/data-pipeline/PRODUCTION-CUTOVER-OPERATOR.md";
    const bypass = `${readFileSync(resolve(ROOT, runbookPath), "utf8")}
\`\`\`sh
node scripts/data-pipeline/cutover-operator.mjs bootstrap-plan
vercel promote "$UNREVIEWED_DEPLOYMENT_ID"
\`\`\`
`;
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [runbookPath]: bypass,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toEqual(
      expect.arrayContaining([
        "ops-retired-candidate-cutover",
        "ops-post-promotion-binding",
      ]),
    );
  });

  it("rejects a restored candidate scheduler selector", () => {
    const bindingPath =
      "lib/data-pipeline/candidate-projector-runtime-binding.server.ts";
    const bypass = `${readFileSync(resolve(ROOT, bindingPath), "utf8")}
const restoredHistoricalMode = "candidate-backfill";
void restoredHistoricalMode;
`;
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [bindingPath]: bypass,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-retired-candidate-cutover",
    );
  });
});

function productionBindingFetch(
  metadata: Readonly<{
    githubCommitSha?: string;
    gitCommitSha?: string;
  }> = { githubCommitSha: GIT_HEAD },
) {
  return async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname !== "api.vercel.com") {
      throw new Error(`unexpected production binding request ${url}`);
    }
    return Response.json({
      id: DEPLOYMENT_ID,
      url: "programmable-tested.vercel.app",
      readyState: "READY",
      projectId: PROJECT_ID,
      meta: metadata,
    });
  };
}

describe("production rollback binding", () => {
  it("captures the exact current deployment and rejects prior auto-promotion", async () => {
    const fetchImpl = productionBindingFetch();
    await expect(
      resolveProductionBinding({
        targetUrl: "https://programmable.market",
        token: "vercel-test-token",
        teamId: "team_programmable_test",
        projectId: PROJECT_ID,
        fetchImpl,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        deploymentId: DEPLOYMENT_ID,
        gitHead: GIT_HEAD,
      }),
    );
    await expect(
      resolveProductionBinding({
        targetUrl: "https://programmable.market",
        rejectGitHead: GIT_HEAD,
        token: "vercel-test-token",
        teamId: "team_programmable_test",
        projectId: PROJECT_ID,
        fetchImpl,
      }),
    ).rejects.toThrow("automatic production-domain assignment");
  });

  it("accepts Vercel built-in Git commit metadata", async () => {
    await expect(
      resolveProductionBinding({
        targetUrl: "https://programmable.market",
        token: "vercel-test-token",
        teamId: "team_programmable_test",
        projectId: PROJECT_ID,
        fetchImpl: productionBindingFetch({ gitCommitSha: GIT_HEAD }),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        deploymentId: DEPLOYMENT_ID,
        gitHead: GIT_HEAD,
      }),
    );
  });
});
