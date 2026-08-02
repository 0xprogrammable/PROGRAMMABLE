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
        sha256: "f2828a8e0e20ac005511ea9cce5c3e7b349696034a2dbf445268533fbc367b9c",
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
        sha256: "5ce3b98d0a373c45b309011b59cc6ec7eeaef54bc112f2b55d32dca433566da0",
      }),
      migrations: Object.freeze([
        Object.freeze({
          path: "supabase/migrations/20260731223000_market_projector_contract.sql",
          sha256: "ea73f4112a53b25e72aa697d3fc0679bf9c6e7f93a496edd167803d6a7f81a24",
        }),
        Object.freeze({
          path: "supabase/migrations/20260802092800_market_projector_fast_lane.sql",
          sha256: "70c2719af30e0d3438e3de306376c7fa62d0196be98f81d7bd6b327559c14dc7",
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
        sha256: "71549b17be233af2be052e1e4f948cbae37d804dc662354c6bfcd234bfdd266a",
      }),
      verifier: Object.freeze({
        path: "lib/data-pipeline/quicknode-stream-wake.server.ts",
        sha256: "b28af0bdd6860eb6f55b54ea4093a1ddbf9007667c3193f99061057e477c9153",
      }),
      canary: Object.freeze({
        path: "scripts/perf/read-model-projector-wake-canary.mjs",
        sha256: "5ea9c8704126fe17982515038ed75dd3eb850479a5dc8c7b092e2db076c14900",
      }),
      dependencies: Object.freeze([
        Object.freeze({
          path: "lib/data-pipeline/quicknode-wake-queue.server.ts",
          sha256: "a3743900032ff2c7b4f4636d5731d6de1d680e1f49bd0cce2365c448ea1243d0",
        }),
        Object.freeze({
          path: "lib/data-pipeline/optimistic-wake-runtime.server.ts",
          sha256: "306a06191e2d6849d8d85f6a1cf79ed027ff3ff482b8e374755935d738fa4307",
        }),
        Object.freeze({
          path: "lib/data-pipeline/optimistic-block-reader.server.ts",
          sha256: "983080e347dd9fb90daf5696f096a446f3c119a250669545dcb2208ba639b161",
        }),
        Object.freeze({
          path: "lib/data-pipeline/optimistic-market-state.server.ts",
          sha256: "1479af0cb925c87c86d7b30fa20a8cda6bcef326e33f32e04f3e58796a498e67",
        }),
        Object.freeze({
          path: "lib/data-pipeline/optimistic-live-runtime.server.ts",
          sha256: "817b4563eb503aa761efc922c264cf1699fd2264160adfd1a5294308750533f6",
        }),
        Object.freeze({
          path: "lib/data-pipeline/read-model-real-block-sla-capture.server.ts",
          sha256: "6e91e4a71f50fe0b0f512f44becac13b5326aa1567efbce883dad6ef592bb6f0",
        }),
        Object.freeze({
          path: "lib/data-pipeline/dual-rpc.ts",
          sha256: "12018866a1452d098d273e6e0f30274a4687f83a4fcba17764e2d88ca8093981",
        }),
        Object.freeze({
          path: "lib/data-pipeline/rpc-providers.server.ts",
          sha256: "d6694f99366226a64a07b28ef3646cc05556048bc1ce790f9fbac4929c3ce77c",
        }),
        Object.freeze({
          path: "app/api/ops/read-model-real-block-sla/route.ts",
          sha256: "5c975d526c9be984e55ac69df903c3328aa4edc75684b5ead6bab378c1992fd1",
        }),
        Object.freeze({
          path: "supabase/migrations/20260802104211_real_block_sla_runtime_receipts.sql",
          sha256: "f2abe7c14690f8e1bac43eba56ed88b73685e1ef2e4a70ecb8a633a121f5d838",
        }),
      ]),
    }),
  ]),
  releaseGates: Object.freeze({
    authOnlyWakeCanary: Object.freeze({
      purpose: "hmac-route-authentication-only",
      satisfiesRealBlockSla: false,
    }),
    realBlockSla: Object.freeze({
      requiredBeforeProductionPromotion: true,
      activity: "organic-stream-block-no-signing-or-spending",
      maximumDeliveryToFirstVisibleMs: 10_000,
      script: Object.freeze({
        path: "scripts/perf/read-model-real-block-sla-gate.mjs",
        sha256: "68cb5f77d3891070cba84f6b69f13eabb177016823f9baed6decdf62aa1a0c3a",
      }),
      schema: Object.freeze({
        path: "config/read-model-real-block-sla-db-attestation.schema.json",
        sha256: "73d78c27c6b8dc311dd50911bd4f1b4c2c44e967fd53aa5b415f566e264b69da",
      }),
    }),
  }),
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
    route.includes("await verifyQuickNodeStreamWake(request, {") &&
    route.includes("enqueueConfiguredQuickNodeWake") &&
    route.includes("acknowledgeConfiguredQuickNodeWake") &&
    route.includes("consumeConfiguredRealBlockSlaProviderRetryOnce") &&
    route.includes("PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE") &&
    route.includes("processDurableWakeJob") &&
    route.includes("processNextConfiguredQuickNodeWake") &&
    route.includes("createConfiguredOptimisticWakeFirstStage") &&
    route.includes("after(() => runDurableWakeWorker") &&
    route.includes("runConfiguredProjectorCycle()") &&
    route.includes("runConfiguredMarketProjectorFastLaneCycle()") &&
    route.includes("export const POST = createProjectorWakePost({") &&
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

function realBlockSlaGateIsFailClosed(source, schema, gate) {
  const schemaValue = parseJson(schema);
  return (
    typeof source === "string" &&
    gate?.requiredBeforeProductionPromotion === true &&
    gate?.activity === "organic-stream-block-no-signing-or-spending" &&
    gate?.maximumDeliveryToFirstVisibleMs === 10_000 &&
    source.includes("REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS = 10_000") &&
    source.includes("verifyRealBlockSlaDatabaseAttestation") &&
    source.includes("DB-authored promotion attestation required") &&
    source.includes("attestationHmacSha256") &&
    source.includes("dynamic provider call count") &&
    source.includes("same-market public surfaces") &&
    source.includes("API body digest") &&
    source.includes("real-block SLA latency") &&
    source.includes("maximumEvidenceAgeMs") &&
    source.includes('evidence.kind !== "programmable-real-block-sla-db-attestation"') &&
    source.includes("evidence.schemaVersion !== 2") &&
    source.includes("initialNonceDigest") &&
    source.includes("duplicateNonceDigest") &&
    source.includes("runtime.initialResponseStatus !== 503") &&
    source.includes("runtime.duplicateResponseStatus !== 202") &&
    source.includes("metadataProviderCallCountA") &&
    source.includes("metadataProviderCallCountB") &&
    schemaValue?.properties?.kind?.const ===
      "programmable-real-block-sla-db-attestation" &&
    schemaValue?.properties?.schemaVersion?.const === 2 &&
    schemaValue?.properties?.runtimeReceipt?.type === "object" &&
    schemaValue?.properties?.runtimeReceipt?.properties?.initialResponseStatus
      ?.const === 503 &&
    schemaValue?.properties?.runtimeReceipt?.properties?.duplicateResponseStatus
      ?.const === 202 &&
    schemaValue?.properties?.runtimeReceipt?.properties?.markets?.items
      ?.properties?.releaseVersion?.enum?.length === 3 &&
    schemaValue?.properties?.apiObservations?.minItems === 2 &&
    schemaValue?.properties?.apiObservations?.maxItems === 2 &&
    schemaValue?.properties?.attestationHmacSha256?.$ref === "#/$defs/bytes32"
  );
}

function exactEmptyEnvironmentKey(source, name) {
  if (typeof source !== "string") return false;
  const matches = source.match(new RegExp(`^${name}=$`, "gmu")) ?? [];
  return matches.length === 1 && !source.includes(`NEXT_PUBLIC_${name}`);
}

function exactFalseEnvironmentKey(source, name) {
  if (typeof source !== "string") return false;
  const matches = source.match(new RegExp(`^${name}=false$`, "gmu")) ?? [];
  return matches.length === 1 && !source.includes(`NEXT_PUBLIC_${name}`);
}

const EXACT_MANUAL_VERCEL_PROMOTION =
  'vercel promote "$STAGED_DEPLOYMENT_ID" --yes --token="$VERCEL_TOKEN"';
const MANUAL_PROMOTION_SEQUENCE = Object.freeze([
  "npm run perf:read-model:real-block-sla --",
  "npm run perf:read-model:staged-deployment --",
  EXACT_MANUAL_VERCEL_PROMOTION,
  "npm run perf:read-model:post-promotion --",
]);

function manualPromotionSequenceIsFailClosed(source) {
  if (typeof source !== "string") return false;
  let inShellFence = false;
  const shellCommands = [];
  for (const sourceLine of source.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (line === "```sh" || line === "```bash") {
      inShellFence = true;
      continue;
    }
    if (line.startsWith("```")) {
      inShellFence = false;
      continue;
    }
    if (inShellFence && line.length > 0) shellCommands.push(line);
  }
  let previousIndex = -1;
  for (const command of MANUAL_PROMOTION_SEQUENCE) {
    const commandIndex = shellCommands.findIndex(
      (line, index) => index > previousIndex && line.startsWith(command),
    );
    if (commandIndex < 0) return false;
    previousIndex = commandIndex;
  }
  const activePromotionCommands = shellCommands.filter((line) =>
    /\bvercel\s+promote(?:\s|$)/u.test(line)
  );
  return activePromotionCommands.length === 1 &&
    activePromotionCommands[0] === EXACT_MANUAL_VERCEL_PROMOTION;
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
  if (id === "market-projector-fast-lane") {
    return (
      source.includes("list_market_projector_fast_lane_v1") &&
      source.includes("assert_market_projector_fast_lane_v1") &&
      source.includes("try_lock_market_projector_pool_v1") &&
      source.includes("projector_checkpoint_current") &&
      source.includes("market_projector_cursor_current") &&
      source.includes("chain_event_current_canonical") &&
      source.includes("market_block_closes") &&
      source.includes("source_checkpoint_block_hash") &&
      /security definer/iu.test(source) &&
      /grant execute[\s\S]*to programmable_reconciler/iu.test(source)
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
  const releaseGates = operations?.releaseGates;
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
      exactJson(eventTriggers, APPROVED_OPERATIONS.eventTriggers) &&
      exactJson(releaseGates, APPROVED_OPERATIONS.releaseGates),
    "the manifest exactly binds the reviewed indexers, workers, event trigger and release gates",
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
      (eventTrigger?.dependencies ?? []).length ===
        (approvedTrigger.dependencies ?? []).length &&
      (approvedTrigger.dependencies ?? []).every((binding, index) =>
        sourceBindingMatches(
          source,
          eventTrigger?.dependencies?.[index],
          expectedSha256Overrides,
        ) && exactJson(binding, eventTrigger?.dependencies?.[index])
      ) &&
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

  const approvedRealBlockSla = APPROVED_OPERATIONS.releaseGates.realBlockSla;
  const realBlockSla = releaseGates?.realBlockSla;
  check(
    "ops-real-block-sla-gate-binding",
    releaseGates?.authOnlyWakeCanary?.satisfiesRealBlockSla === false &&
      sourceBindingMatches(
        source,
        realBlockSla?.script,
        expectedSha256Overrides,
      ) &&
      sourceBindingMatches(
        source,
        realBlockSla?.schema,
        expectedSha256Overrides,
      ) &&
      realBlockSlaGateIsFailClosed(
        source(approvedRealBlockSla.script.path),
        source(approvedRealBlockSla.schema.path),
        realBlockSla,
      ),
    "auth-only probes stay separate and production promotion requires exact real-block SLA evidence",
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
    marketWorker?.migrations?.length === 2 &&
      migrationContract(
        "market-projector",
        source(marketWorker.migrations[0]?.path),
      ) &&
      migrationContract(
        "market-projector-fast-lane",
        source(marketWorker.migrations[1]?.path),
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
  const productionCutoverRunbook = source(
    "docs/data-pipeline/PRODUCTION-CUTOVER-OPERATOR.md",
  ) ?? "";
  check(
    "ops-package-verify-binding",
    packageJson?.scripts?.verify?.includes("npm run perf:read-model:ops-gate") === true,
    "the canonical local verification command runs the operations source contract",
  );
  check(
    "ops-real-block-sla-package-binding",
    packageJson?.scripts?.["perf:read-model:real-block-sla"] ===
      `node ${approvedRealBlockSla.script.path}`,
    "the immutable real-block SLA verifier has one reviewed operator command",
  );
  check(
    "ops-quicknode-stream-env-contract",
    exactEmptyEnvironmentKey(
      environmentExample,
      approvedTrigger.secretEnvironment,
    ) &&
      exactFalseEnvironmentKey(
        environmentExample,
        "PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE",
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
      deployWorkflow.includes("Stage-only: no production promotion was attempted.") &&
      !deployWorkflow.includes("vercel promote") &&
      !deployWorkflow.includes("vercel rollback") &&
      operationsRunbook.includes("stage-only and must never call `vercel promote`") &&
      manualPromotionSequenceIsFailClosed(operationsRunbook) &&
      manualPromotionSequenceIsFailClosed(productionCutoverRunbook) &&
      postPromotion.includes("verifyProductionDeploymentBinding") &&
      productionBinding.includes("resolveProductionBinding") &&
      postPromotion.includes('"/api/ops/health"') &&
      postPromotion.includes('"/api/explore?limit=6&page=1&sort=market-cap"') &&
      postPromotion.includes("verifyLiveCacheAndKeyContracts"),
    "the workflow is stage-only and both operator runbooks require the exact SLA-gated deployment promotion sequence",
  );
  check(
    "ops-vercel-project-prerequisite",
    /Auto-assign Custom Production\s+Domains/u.test(operationsRunbook) &&
      operationsRunbook.includes("only the reviewed manual") &&
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
