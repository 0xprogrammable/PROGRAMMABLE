#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APPROVED_OPERATIONS = Object.freeze({
  legacyIndexer: Object.freeze({
    path: "/api/ops/index-v2",
    schedule: "*/5 * * * *",
    retainedUntil: "indexed-read-cutover",
    route: "app/api/ops/index-v2/route.ts",
    sha256: "9638ec482ff66c5f3b1377c60b946e6348fb895769b6f8596fca2dc8cfbac535",
    closedAlias: Object.freeze({
      path: "/api/ops/index",
      route: "app/api/ops/index/route.ts",
      status: 410,
      sha256: "bb498b00334df908029a588bec552516f281fdc0dfc3185bc5cd820984a9ee1f",
    }),
  }),
  workers: Object.freeze([
    Object.freeze({
      id: "source-projector",
      path: "/api/ops/projector",
      schedule: "* * * * *",
      activationEnvironment: "PROGRAMMABLE_PROJECTOR_ACTIVE",
      route: Object.freeze({
        path: "app/api/ops/projector/route.ts",
        sha256: "9b12168cbbadf0addac351c45f71931f3c04370bcd6cabe6174d21daeb00a94d",
      }),
      runtime: Object.freeze({
        path: "lib/data-pipeline/projector-runtime-config.server.ts",
        sha256: "f54859e55f35b99784eebd6cef58a40a5848904be21417249f3bff5bf1c88637",
      }),
      dependencies: Object.freeze([
        Object.freeze({
          path: "lib/data-pipeline/candidate-projector-runtime-binding.server.ts",
          sha256: "32efa13d740614f7e66fd20a0158edf3383f4f6643a7fe34268fabda6261931c",
        }),
      ]),
      migrations: Object.freeze([
        Object.freeze({
          path: "supabase/migrations/20260731203900_projector_runtime_singleton_lease.sql",
          sha256: "068f27a70ec6df57b84bf336fc2c46b316a7d10d40b9d489fc47e95acb6f74b0",
        }),
        Object.freeze({
          path: "supabase/migrations/20260731224000_projector_provider_evidence_binding.sql",
          sha256: "0404f7c610a34af23fe536f021927efec4e0aede235068b70be04331c58f03af",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801090000_bootstrap_dynamic_evidence_and_launch_requirements.sql",
          sha256: "e095d128feb12c8962c81be003e693dd67417cfed209144c998ab57d5e8786aa",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801091000_candidate_projector_unpromoted_gate.sql",
          sha256: "cd8b5a4aa4801ca773cb84047edbf05349288cada47d671bd47e7d997902c91f",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801092000_verify_candidate_database_promoted.sql",
          sha256: "ed5f54a374ad8178393e88a3948281ad9acba10aebbbd5209ea6793691b8c677",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801093000_bind_candidate_promotion_to_product.sql",
          sha256: "c6a032ef371b2211004c8d72c0a8c4eec4ba630776210aed48d2d054e642dbbe",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801125441_reuse_safe_head_observations.sql",
          sha256: "afbeea7bcf60e492e51bfd0c56517613f32a6f87a0182af00c48bdaef6569e74",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801144403_accept_uuid_v8_dynamic_source_lineage.sql",
          sha256: "85e0509d2a4fa49062a18d891e51cd0c64c1015926c3c3ef47a83ce16edb4170",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801155212_reuse_dual_rpc_block_evidence.sql",
          sha256: "51142370cf7fdf2bd60c2812978fe2cbbacf99f42b87c72f0ad1ac61b303cf51",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801204500_reuse_dual_rpc_block_evidence_constraint.sql",
          sha256: "92cc63189b41eda613ba9da21b7ef21bee650a93f1825f5ee063727ee6c06b11",
        }),
      ]),
    }),
    Object.freeze({
      id: "market-projector",
      path: "/api/ops/market-projector",
      schedule: "* * * * *",
      activationEnvironment: "PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE",
      route: Object.freeze({
        path: "app/api/ops/market-projector/route.ts",
        sha256: "73bf9299095cfdf75d5452513ee818e161297a83c6355760ab2f79a22a13edbd",
      }),
      runtime: Object.freeze({
        path: "lib/data-pipeline/market-projector-runtime.server.ts",
        sha256: "ed1c55148d05a47d747616a4bc8250996780be65d053b989d51db21b4519109b",
      }),
      migrations: Object.freeze([
        Object.freeze({
          path: "supabase/migrations/20260731223000_market_projector_contract.sql",
          sha256: "ea73f4112a53b25e72aa697d3fc0679bf9c6e7f93a496edd167803d6a7f81a24",
        }),
      ]),
    }),
  ]),
  eventTriggers: Object.freeze([
    Object.freeze({
      id: "quicknode-stream-projector-wake",
      path: "/api/ops/projector-wake",
      provider: "quicknode-streams",
      mode: "wake-only",
      secretEnvironment: "PROGRAMMABLE_QUICKNODE_STREAM_SECRET",
      route: Object.freeze({
        path: "app/api/ops/projector-wake/route.ts",
        sha256: "cdea2e18ebdb545e0f4de7bdd54da181c5cf6fa715e5abe1ac32c0bae66d138b",
      }),
      verifier: Object.freeze({
        path: "lib/data-pipeline/quicknode-stream-wake.server.ts",
        sha256: "9c452c2ae94b62d31ed2ffdaaf974b1acd4c7a856493ac02013e43f89eb4bc65",
      }),
      canary: Object.freeze({
        path: "scripts/perf/read-model-projector-wake-canary.mjs",
        sha256: "5ea9c8704126fe17982515038ed75dd3eb850479a5dc8c7b092e2db076c14900",
      }),
    }),
  ]),
});

function readSource(rootDirectory, path, overrides) {
  if (Object.hasOwn(overrides, path)) return overrides[path];
  try {
    return readFileSync(resolve(rootDirectory, path), "utf8");
  } catch {
    return null;
  }
}

function parseJson(source) {
  if (typeof source !== "string") return null;
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function sha256(source) {
  return typeof source === "string"
    ? createHash("sha256").update(source, "utf8").digest("hex")
    : null;
}

function exactCronMap(vercel) {
  if (!vercel || !Array.isArray(vercel.crons)) return null;
  const entries = new Map();
  for (const cron of vercel.crons) {
    if (
      !cron ||
      typeof cron.path !== "string" ||
      typeof cron.schedule !== "string" ||
      entries.has(cron.path)
    ) {
      return null;
    }
    entries.set(cron.path, cron.schedule);
  }
  return entries;
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedDigest(path, approved, overrides) {
  return overrides?.[path] ?? approved;
}

function sourceBindingMatches(source, binding, expectedSha256Overrides) {
  return (
    binding &&
    typeof binding.path === "string" &&
    typeof binding.sha256 === "string" &&
    sha256(source(binding.path)) ===
      expectedDigest(binding.path, binding.sha256, expectedSha256Overrides)
  );
}

function routeIsAuthenticatedAndFailClosed(source, requireCutover = false) {
  const directSecretBounds =
    /Buffer\.byteLength\(secret,\s*["']utf8["']\)\s*<\s*32/u.test(source) &&
    /Buffer\.byteLength\(secret,\s*["']utf8["']\)\s*>\s*1_024/u.test(source);
  const namedSecretBounds =
    /const\s+secretLength\s*=\s*secret\s*\?\s*Buffer\.byteLength\(secret,\s*["']utf8["']\)\s*:\s*0/u.test(source) &&
    /secretLength\s*<\s*32/u.test(source) &&
    /secretLength\s*>\s*1_024/u.test(source);
  const standardAuthorization =
    /matchesBearer\(request,\s*process\.env\.CRON_SECRET\)/u.test(source) ||
    /const\s+secret\s*=\s*process\.env\.CRON_SECRET/u.test(source);
  const cutoverAuthorization =
    /PROGRAMMABLE_CUTOVER_BACKFILL_ACTIVE\s*===\s*["']true["']/u.test(source) &&
    /process\.env\.PROGRAMMABLE_CUTOVER_OPERATOR_SECRET/u.test(source) &&
    /x-programmable-cutover-mode/u.test(source) &&
    /raw-backfill-v1/u.test(source);
  return (
    typeof source === "string" &&
    /request\.headers\.get\(["']authorization["']\)/u.test(source) &&
    (directSecretBounds || namedSecretBounds) &&
    /authorization(?:\?\.|\.)startsWith\(["']Bearer ["']\)/u.test(source) &&
    /provided\.length\s*===\s*expected\.length/u.test(source) &&
    /timingSafeEqual\(provided,\s*expected\)/u.test(source) &&
    standardAuthorization &&
    (!requireCutover ||
      (cutoverAuthorization &&
        /mode\s*===\s*["']cutover["']/u.test(source))) &&
    (/if\s*\(\s*!isAuthorized\(request\)\s*\)/u.test(source) ||
      /if\s*\(\s*mode\s*===\s*null\s*\)/u.test(source)) &&
    /status\s*:\s*401\b/u.test(source) &&
    /status\s*:\s*503\b/u.test(source) &&
    /["']Cache-Control["']\s*:\s*["']no-store["']/u.test(source)
  );
}

function routeIsPermanentlyClosed(source, binding) {
  return (
    typeof source === "string" &&
    binding?.status === 410 &&
    source.includes('code: "legacy_index_route_closed"') &&
    /status\s*:\s*410\b/u.test(source) &&
    /["']Cache-Control["']\s*:\s*["']no-store["']/u.test(source)
  );
}

function activationIsExplicitAndSafe(source, environmentName) {
  return (
    typeof source === "string" &&
    source.includes(`env.${environmentName}`) &&
    /===\s*["']false["']/u.test(source) &&
    /(?:===|!==)\s*["']true["']/u.test(source) &&
    /===\s*undefined/u.test(source) &&
    /status\s*:\s*["']disabled["']|return\s+["']disabled["']/u.test(source) &&
    /invalidRuntimeConfig|invalidInput|throw\s+/u.test(source)
  );
}

function eventTriggerIsAuthenticatedAndBound(route, verifier, trigger) {
  return (
    typeof route === "string" &&
    typeof verifier === "string" &&
    trigger?.provider === "quicknode-streams" &&
    trigger?.mode === "wake-only" &&
    trigger?.secretEnvironment === "PROGRAMMABLE_QUICKNODE_STREAM_SECRET" &&
    route.includes("verifyQuickNodeStreamWake(request)") &&
    route.includes("after(runWakeCycle)") &&
    route.includes("runConfiguredProjectorCycle()") &&
    route.includes("runConfiguredMarketProjectorCycle()") &&
    /export\s+async\s+function\s+POST\s*\(/u.test(route) &&
    /status\s*:\s*202\b/u.test(route) &&
    /["']Cache-Control["']\s*:\s*["']no-store["']/u.test(route) &&
    verifier.includes("PROGRAMMABLE_QUICKNODE_STREAM_SECRET") &&
    verifier.includes('exactHeader(request, "x-qn-nonce"') &&
    verifier.includes('exactHeader(request, "x-qn-timestamp"') &&
    verifier.includes('exactHeader(request, "x-qn-signature"') &&
    verifier.includes('createHmac("sha256", secret)') &&
    verifier.includes("timingSafeEqual(provided, expected)") &&
    verifier.includes("MAXIMUM_TIMESTAMP_AGE_SECONDS") &&
    verifier.includes("MAXIMUM_ENCODED_BODY_BYTES") &&
    verifier.includes("maxOutputLength: MAXIMUM_DECODED_BODY_BYTES")
  );
}

function eventTriggerCanaryIsFailClosed(source, trigger) {
  return (
    typeof source === "string" &&
    trigger?.canary?.path ===
      "scripts/perf/read-model-projector-wake-canary.mjs" &&
    source.includes(
      'export const PROJECTOR_WAKE_ROUTE = "/api/ops/projector-wake"',
    ) &&
    source.includes('"PROGRAMMABLE_QUICKNODE_STREAM_SECRET"') &&
    source.includes('createHmac("sha256", secret)') &&
    source.includes('id: "invalid-signature"') &&
    source.includes('id: "stale-timestamp"') &&
    source.includes('id: "valid-delivery"') &&
    source.includes("status: 401") &&
    source.includes("status: 202") &&
    source.includes('"cache-control"') &&
    source.includes('hostname.endsWith(".vercel.app")') &&
    !source.includes("NEXT_PUBLIC_PROGRAMMABLE_QUICKNODE_STREAM_SECRET")
  );
}

function exactEmptyEnvironmentKey(source, name) {
  if (typeof source !== "string") return false;
  const matches = source.match(new RegExp(`^${name}=$`, "gmu")) ?? [];
  return matches.length === 1 && !source.includes(`NEXT_PUBLIC_${name}`);
}

function migrationContract(id, source) {
  if (typeof source !== "string") return false;
  if (id === "source-projector-lease") {
    return (
      source.includes("try_acquire_projector_runtime_lease_v1") &&
      source.includes("release_projector_runtime_lease_v1") &&
      /force row level security/iu.test(source)
    );
  }
  if (id === "source-projector-provider-evidence") {
    return (
      source.includes("projection_provider_execution_evidence") &&
      source.includes("reward_snapshot_provider_evidence") &&
      source.includes("projection_publication_provider_bindings") &&
      /force row level security/iu.test(source)
    );
  }
  if (id === "source-projector-safe-head-reuse") {
    return (
      source.includes("append_or_reuse_safe_head_observation_v1") &&
      source.includes(
        "safe_head_observations_epoch_id_content_fingerprint_key",
      ) &&
      source.includes("for key share") &&
      source.includes("safe-head fingerprint replay conflicts with stored evidence") &&
      /security definer/iu.test(source)
    );
  }
  if (id === "source-projector-dynamic-lineage") {
    return (
      source.includes("accept_uuid_v8_dynamic_source_lineage") ||
      (source.includes("dynamic_source") &&
        source.includes("uuid") &&
        /security definer/iu.test(source))
    );
  }
  if (id === "source-projector-block-evidence-reuse") {
    return (
      source.includes("append_or_reuse_dual_rpc_block_evidence_v1") &&
      source.includes(
        "dual_rpc_block_evidence_epoch_id_content_fingerprint_key",
      ) &&
      source.includes("block-evidence fingerprint replay conflicts with stored evidence") &&
      /security definer/iu.test(source)
    );
  }
  if (id === "source-projector-block-evidence-conflict-fence") {
    return (
      source.includes("append_or_reuse_dual_rpc_block_evidence_v1") &&
      source.includes(
        "dual_rpc_block_evidence_epoch_id_content_fingerprint_key",
      ) &&
      source.includes(
        "dual_rpc_block_evidence_observation_id_block_number_key",
      ) &&
      source.includes("for key share") &&
      /security definer/iu.test(source)
    );
  }
  if (id === "candidate-control-bootstrap") {
    return (
      source.includes("candidate_database_control") &&
      source.includes("initialize_candidate_database") &&
      source.includes("attest_candidate_database_promotion") &&
      source.includes("enforce_candidate_database_promotion") &&
      /force row level security/iu.test(source)
    );
  }
  if (id === "candidate-unpromoted-gate") {
    return (
      source.includes("verify_candidate_database_unpromoted_v1") &&
      source.includes("envio:production-7f24e63") &&
      source.includes("programmable_private.assert_caller('programmable_projector')") &&
      /grant execute[\s\S]*to programmable_projector/iu.test(source)
    );
  }
  if (id === "candidate-promoted-gate") {
    return (
      source.includes("verify_candidate_database_promoted_v1") &&
      source.includes("envio:production-7f24e63") &&
      source.includes("programmable_private.assert_caller('programmable_projector')") &&
      /grant execute[\s\S]*to programmable_projector/iu.test(source)
    );
  }
  if (id === "candidate-product-binding") {
    return (
      source.includes("candidate_database_control_product_binding") &&
      source.includes("product_commit") &&
      source.includes("staged_deployment_id") &&
      source.includes("verify_candidate_database_promoted_v2") &&
      source.includes("candidate product-bound promotion CAS lost") &&
      /validate constraint candidate_database_control_product_binding/iu.test(source)
    );
  }
  if (id === "market-projector") {
    return (
      source.includes("market_projector_cursor_history") &&
      source.includes("market_snapshot_lineage_memberships") &&
      source.includes("market_candle_lineage_memberships") &&
      source.includes("try_acquire_market_projector_runtime_lease_v1") &&
      source.includes("assert_market_projector_runtime_lease_v1") &&
      source.includes("release_market_projector_runtime_lease_v1") &&
      source.includes("projector_checkpoint_current") &&
      /cursor_block_global_log_index\s*<>\s*4294967295/iu.test(source) &&
      /cursor_candidate_id\s*<>\s*'empty-page'/iu.test(source) &&
      /force row level security/iu.test(source)
    );
  }
  return false;
}

export function evaluateReadModelOperationsSourceContracts(
  rootDirectory,
  options = {},
) {
  const overrides = options.sourceOverrides ?? {};
  const expectedSha256Overrides = options.expectedSha256Overrides ?? {};
  const source = (path) => readSource(rootDirectory, path, overrides);
  const checks = [];
  const failures = [];
  const check = (id, condition, detail) => {
    const status = condition ? "pass" : "fail";
    checks.push({ id, status, detail });
    if (!condition) failures.push({ id, detail });
  };

  const operations = parseJson(source("config/read-model-operations.v1.json"));
  const vercel = parseJson(source("vercel.json"));
  const crons = exactCronMap(vercel);
  const workers = Array.isArray(operations?.workers) ? operations.workers : [];
  const eventTriggers = Array.isArray(operations?.eventTriggers)
    ? operations.eventTriggers
    : [];
  const unscheduled = Array.isArray(operations?.unscheduled)
    ? operations.unscheduled
    : [];
  const approvedCrons = new Map([
    [APPROVED_OPERATIONS.legacyIndexer.path, APPROVED_OPERATIONS.legacyIndexer.schedule],
    ...APPROVED_OPERATIONS.workers.map((worker) => [worker.path, worker.schedule]),
  ]);

  check(
    "ops-config-schema",
    operations?.schemaVersion === 1 &&
      exactJson(operations?.legacyIndexer, APPROVED_OPERATIONS.legacyIndexer) &&
      exactJson(workers, APPROVED_OPERATIONS.workers) &&
      exactJson(eventTriggers, APPROVED_OPERATIONS.eventTriggers),
    "the manifest exactly binds the reviewed legacy indexer, workers and event trigger",
  );
  check(
    "ops-cron-exact-set",
    crons !== null &&
      crons.size === approvedCrons.size &&
      [...approvedCrons].every(
        ([path, schedule]) => crons.get(path) === schedule,
      ),
    "Vercel has only the independently approved schedules",
  );
  check(
    "ops-legacy-cron-preserved",
    crons?.get(APPROVED_OPERATIONS.legacyIndexer.path) ===
      APPROVED_OPERATIONS.legacyIndexer.schedule &&
      sha256(source(APPROVED_OPERATIONS.legacyIndexer.route)) ===
        expectedDigest(
          APPROVED_OPERATIONS.legacyIndexer.route,
          APPROVED_OPERATIONS.legacyIndexer.sha256,
          expectedSha256Overrides,
        ),
    "the five-minute legacy route remains byte-bound until indexed-read cutover",
  );
  const closedLegacyAlias = APPROVED_OPERATIONS.legacyIndexer.closedAlias;
  check(
    "ops-legacy-alias-closed",
    !crons?.has(closedLegacyAlias.path) &&
      exactJson(
        operations?.legacyIndexer?.closedAlias,
        closedLegacyAlias,
      ) &&
      sha256(source(closedLegacyAlias.route)) === closedLegacyAlias.sha256 &&
      routeIsPermanentlyClosed(
        source(closedLegacyAlias.route),
        closedLegacyAlias,
      ),
    "the former legacy writer alias is byte-bound to a permanent 410 response",
  );

  for (const approvedWorker of APPROVED_OPERATIONS.workers) {
    const worker = workers.find(({ id }) => id === approvedWorker.id);
    const route = source(approvedWorker.route.path);
    const runtime = source(approvedWorker.runtime.path);
    check(
      `ops-${approvedWorker.id}-schedule`,
      worker?.path === approvedWorker.path &&
        worker?.schedule === approvedWorker.schedule &&
        crons?.get(approvedWorker.path) === approvedWorker.schedule,
      `${approvedWorker.id} has its independently fixed production schedule`,
    );
    check(
      `ops-${approvedWorker.id}-source-digests`,
      sourceBindingMatches(source, worker?.route, expectedSha256Overrides) &&
      sourceBindingMatches(source, worker?.runtime, expectedSha256Overrides) &&
        (approvedWorker.dependencies ?? []).every((binding, index) =>
          sourceBindingMatches(
            source,
            worker?.dependencies?.[index],
            expectedSha256Overrides,
          ),
        ) &&
        approvedWorker.migrations.every((binding, index) =>
          sourceBindingMatches(
            source,
            worker?.migrations?.[index],
            expectedSha256Overrides,
          ),
        ),
      `${approvedWorker.id} route, runtime and migrations match reviewed bytes`,
    );
    check(
      `ops-${approvedWorker.id}-route-auth`,
      routeIsAuthenticatedAndFailClosed(
        route,
        approvedWorker.id === "source-projector",
      ),
      `${approvedWorker.id} reads Authorization, compares CRON_SECRET safely and fails closed`,
    );
    check(
      `ops-${approvedWorker.id}-activation`,
      worker?.activationEnvironment === approvedWorker.activationEnvironment &&
        activationIsExplicitAndSafe(runtime, approvedWorker.activationEnvironment),
      `${approvedWorker.id} is false by default and only exact true activates work`,
    );
    const runtimeBinding = approvedWorker.id === "source-projector"
      ? typeof runtime === "string" &&
        runtime.includes("createProjectorRuntimeLeaseController") &&
        /leaseController\.tryAcquire\(\)/u.test(runtime) &&
        /acquisition\.status\s*===\s*["']busy["']/u.test(runtime)
      : typeof runtime === "string" &&
        /store\.tryAcquireLease\(\)/u.test(runtime) &&
        /store\.releaseLease\(lease\)/u.test(runtime) &&
        /status\s*:\s*["']busy["']/u.test(runtime) &&
        runtime.includes("sourceCheckpointGeneration");
    check(
      `ops-${approvedWorker.id}-runtime-binding`,
      runtimeBinding,
      `${approvedWorker.id} executes through its singleton lease and checkpoint binding`,
    );
  }

  const approvedTrigger = APPROVED_OPERATIONS.eventTriggers[0];
  const eventTrigger = eventTriggers.find(({ id }) => id === approvedTrigger.id);
  check(
    "ops-quicknode-stream-wake-binding",
    eventTriggers.length === 1 &&
      eventTrigger?.path === approvedTrigger.path &&
      !crons?.has(approvedTrigger.path) &&
      sourceBindingMatches(source, eventTrigger?.route, expectedSha256Overrides) &&
      sourceBindingMatches(source, eventTrigger?.verifier, expectedSha256Overrides) &&
      sourceBindingMatches(source, eventTrigger?.canary, expectedSha256Overrides) &&
      eventTriggerIsAuthenticatedAndBound(
        source(approvedTrigger.route.path),
        source(approvedTrigger.verifier.path),
        eventTrigger,
      ) &&
      eventTriggerCanaryIsFailClosed(
        source(approvedTrigger.canary.path),
        eventTrigger,
      ),
    "the unscheduled QuickNode webhook is HMAC-authenticated and only wakes the fenced projectors",
  );

  check(
    "ops-reconciler-unscheduled",
    unscheduled.length === 1 &&
      unscheduled[0]?.path === "/api/ops/reconcile-preparity" &&
      !crons?.has(unscheduled[0].path) &&
      ![...(crons?.keys() ?? [])].some((path) => /reconcil/iu.test(path)),
    "the reconciler stays unscheduled until every active release family is supported",
  );

  const sourceWorker = workers.find(({ id }) => id === "source-projector");
  const marketWorker = workers.find(({ id }) => id === "market-projector");
  check(
    "ops-source-projector-migrations",
    sourceWorker?.dependencies?.length === 1 &&
      source(sourceWorker.dependencies[0]?.path)?.includes(
        "verify_candidate_database_promoted_v2",
      ) &&
      sourceWorker?.migrations?.length === 10 &&
      migrationContract(
        "source-projector-lease",
        source(sourceWorker.migrations[0]?.path),
      ) &&
      migrationContract(
        "source-projector-provider-evidence",
        source(sourceWorker.migrations[1]?.path),
      ) &&
      migrationContract(
        "candidate-control-bootstrap",
        source(sourceWorker.migrations[2]?.path),
      ) &&
      migrationContract(
        "candidate-unpromoted-gate",
        source(sourceWorker.migrations[3]?.path),
      ) &&
      migrationContract(
        "candidate-promoted-gate",
        source(sourceWorker.migrations[4]?.path),
      ) &&
      migrationContract(
        "candidate-product-binding",
        source(sourceWorker.migrations[5]?.path),
      ) &&
      migrationContract(
        "source-projector-safe-head-reuse",
        source(sourceWorker.migrations[6]?.path),
      ) &&
      migrationContract(
        "source-projector-dynamic-lineage",
        source(sourceWorker.migrations[7]?.path),
      ) &&
      migrationContract(
        "source-projector-block-evidence-reuse",
        source(sourceWorker.migrations[8]?.path),
      ) &&
      migrationContract(
        "source-projector-block-evidence-conflict-fence",
        source(sourceWorker.migrations[9]?.path),
      ),
    "the source worker is byte-bound to its runtime selector, database fence and provider evidence",
  );
  check(
    "ops-market-projector-migration",
    marketWorker?.migrations?.length === 1 &&
      migrationContract(
        "market-projector",
        source(marketWorker.migrations[0]?.path),
      ),
    "the market worker is bound to exact lineage, terminal checkpoint and lease SQL",
  );

  const deployWorkflow = source(".github/workflows/deploy-production.yml") ?? "";
  const verifyWorkflow = source(".github/workflows/verify.yml") ?? "";
  const packageJson = parseJson(source("package.json"));
  const deployPolicy = source("scripts/perf/read-model-deploy-policy.mjs") ?? "";
  const wakeCanary = source(approvedTrigger.canary.path) ?? "";
  const environmentExample = source(".env.example") ?? "";
  const postPromotion = source("scripts/perf/read-model-post-promotion.mjs") ?? "";
  const productionBinding = source(
    "scripts/perf/read-model-production-binding.mjs",
  ) ?? "";
  const operationsRunbook = source(
    "docs/operations/read-model-scheduler-cutover.md",
  ) ?? "";
  check(
    "ops-package-verify-binding",
    packageJson?.scripts?.verify?.includes("npm run perf:read-model:ops-gate") === true,
    "the canonical local verification command runs the operations source contract",
  );
  check(
    "ops-quicknode-stream-env-contract",
    exactEmptyEnvironmentKey(
      environmentExample,
      approvedTrigger.secretEnvironment,
    ) &&
      deployPolicy.includes("PROJECTOR_WAKE_ROUTE") &&
      deployPolicy.includes("QUICKNODE_STREAM_SECRET_ENV_NAME") &&
      deployPolicy.includes('from "./read-model-projector-wake-canary.mjs"') &&
      deployPolicy.includes("wake_route=${result.wakeRoute}") &&
      deployPolicy.includes("wake_canary_required=${result.wakeCanaryRequired}") &&
      deployPolicy.includes("invalidServerSecretEnvironmentNames"),
    "the stream secret name is documented without a value and is fail-closed in deploy policy",
  );
  const stagedWakeGate = deployWorkflow.indexOf(
    "Gate exact staged QuickNode wake route",
  );
  check(
    "ops-quicknode-stream-stage-gate",
    packageJson?.scripts?.["perf:read-model:wake-canary"] ===
      `node ${approvedTrigger.canary.path}` &&
      wakeCanary.includes("projectorWakeCanaryArgumentsFrom") &&
      stagedWakeGate > deployWorkflow.indexOf("Resolve exact staged deployment") &&
      stagedWakeGate < deployWorkflow.indexOf("Attest exact staged release policy") &&
      deployWorkflow.includes(
        "if: steps.read-model-policy.outputs.wake_canary_required == 'true'",
      ) &&
      deployWorkflow.includes(
        "PROGRAMMABLE_QUICKNODE_STREAM_SECRET: ${{ secrets.PROGRAMMABLE_QUICKNODE_STREAM_SECRET }}",
      ) &&
      deployWorkflow.includes(
        "STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}",
      ) &&
      deployWorkflow.includes("npm run perf:read-model:wake-canary --") &&
      deployWorkflow.includes('--target-url "$STAGED_TARGET_URL"'),
    "an active fast lane must pass the exact unaliased staged wake canary before attestation",
  );
  check(
    "ops-exact-release-dependency",
    deployWorkflow.includes("needs: release-gate") &&
      deployWorkflow.includes("needs.release-gate.outputs.verified_sha") &&
      deployWorkflow.includes("pnpm --dir indexer audit --prod --audit-level high") &&
      deployWorkflow.includes("npm run contracts:verify:ci") &&
      deployWorkflow.includes("npm run contracts:official-deployments") &&
      deployWorkflow.includes("npm run contracts:slither") &&
      deployWorkflow.includes("npm run audit:prod") &&
      deployWorkflow.indexOf("npm run perf:read-model:ops-gate") <
        deployWorkflow.indexOf("vercel build --prod"),
    "production staging reproduces the complete exact-commit release gate",
  );
  check(
    "ops-verify-workflow-binding",
    verifyWorkflow.includes("npm run perf:read-model:ops-gate"),
    "pull requests and production pushes run the same operations contract",
  );
  check(
    "ops-post-promotion-binding",
    deployWorkflow.includes('id: production-before') &&
      deployWorkflow.includes('--reject-git-head "$GITHUB_SHA"') &&
      deployWorkflow.indexOf("id: production-before") <
        deployWorkflow.indexOf("id: deploy") &&
      deployWorkflow.includes(
        "DEPLOYMENT_ID: ${{ steps.staged-deployment.outputs.deployment_id }}",
      ) &&
      deployWorkflow.includes('vercel promote "$DEPLOYMENT_ID"') &&
      deployWorkflow.includes('--deployment-id "$DEPLOYMENT_ID"') &&
      deployWorkflow.includes("npm run perf:read-model:post-promotion") &&
      deployWorkflow.includes("vercel rollback") &&
      deployWorkflow.indexOf("vercel promote") <
        deployWorkflow.indexOf("npm run perf:read-model:post-promotion") &&
      postPromotion.includes("verifyProductionDeploymentBinding") &&
      productionBinding.includes("resolveProductionBinding") &&
      postPromotion.includes('"/api/ops/health"') &&
      postPromotion.includes('"/api/explore?limit=6&page=1&sort=market-cap"') &&
      postPromotion.includes("verifyLiveCacheAndKeyContracts"),
    "promotion, production alias verification and rollback bind to the staged deployment",
  );
  check(
    "ops-vercel-project-prerequisite",
    /Auto-assign Custom Production\s+Domains/u.test(operationsRunbook) &&
      operationsRunbook.includes("only the reviewed workflow") &&
      productionBinding.includes("rejectGitHead") &&
      productionBinding.includes("automatic production-domain assignment"),
    "the external Vercel auto-assignment prerequisite is documented and detected fail-closed",
  );

  return { ok: failures.length === 0, checks, failures };
}

function main() {
  const result = evaluateReadModelOperationsSourceContracts(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
