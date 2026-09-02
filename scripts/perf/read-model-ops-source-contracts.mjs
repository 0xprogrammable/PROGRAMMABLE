#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";

const APPROVED_OPERATIONS = Object.freeze({
  legacyIndexer: Object.freeze({
    path: "/api/ops/index-v2",
    schedule: "*/5 * * * *",
    retainedUntil: "indexed-read-cutover",
    route: "app/api/ops/index-v2/route.ts",
    sha256: "ff3968534ca2360d6a6ab7d22605c3b1eeb3d014f7d65eb40f00fcc3b3792bfa",
    boundedRefresh: Object.freeze({
      runtime: Object.freeze({
        path: "lib/onchain/read-model.ts",
        sha256:
          "a31450f6444e4d495ab2adb964bc713c2191723a5f62cc94d151c71e8627c6e4",
      }),
      dependencies: Object.freeze([
        Object.freeze({
          path: "lib/onchain/parallel-reads.ts",
          sha256:
            "ef2bf54f390dca210dfdb3b5ba29c4cf8f6eaea2574c9be219a5410dbf8fb64e",
        }),
        Object.freeze({
          path: "lib/onchain/historical-read-rpc.server.ts",
          sha256:
            "98ffdd09e07f7fd38ef412d27ece0aed69df6120d1ca910002d882aca1782ca6",
        }),
        Object.freeze({
          path: "lib/onchain/persistent-rpc-cache.server.ts",
          sha256:
            "5faaaeafffb837668c5759ff85f879721c6ac4fd41e0a49bf3ee6b615fbb3af4",
        }),
      ]),
      releaseRuntimes: Object.freeze([
        Object.freeze({
          release: "classic-v3",
          path: "lib/onchain/classic-v3-read-model.ts",
          sha256:
            "da6b9cb5e938435010e7a2c0f6ea9a597e7f04257570bd243e368f68c2d28188",
          eventFiltersPerRange: 2,
        }),
        Object.freeze({
          release: "stock-paired-v1-v3",
          path: "lib/onchain/stock-paired-read-model.ts",
          sha256:
            "0f1a0713aa02b617f1ae9df6463140640d1217cdbb38964b56fc9d2b59e1d054",
          eventFiltersPerRange: 3,
        }),
      ]),
      eventFiltersPerRange: 2,
      historicalRecoveryMaximumLogBlockRange: 500,
      providerPasses: 2,
      requestDeadlineMs: 270_000,
      classicPrewarmStepCount: 32,
      prewarmProviderConcurrency: 1,
      prewarmRequestDeadlineMs: 250_000,
    }),
    schedulerWatchdog: Object.freeze({
      provider: "github-actions",
      workflow: Object.freeze({
        path: ".github/workflows/refresh-production-read-model.yml",
        sha256:
          "6eb33f2cd54447b7ada4adc02341feb0d82f874e79358ceae166584a72ef836f",
      }),
      nodeRuntime: Object.freeze({
        setupAction: "actions/setup-node",
        setupActionSha: "820762786026740c76f36085b0efc47a31fe5020",
        setupActionRelease: "v7.0.0",
        version: "24.14.0",
        packageManagerCache: false,
      }),
      schedule: "2-57/5 * * * *",
      targetOrigin: "https://programmable.market",
      environment: "production",
      secretEnvironment: "CRON_SECRET",
      concurrencyGroup: "production-read-model-refresh",
      freshnessMaximumAgeSeconds: 600,
      rpcProof: Object.freeze({
        confirmedBlockRequired: true,
        providerPairRequired: true,
        maximumHeadAgeSeconds: 300,
        healthRoute: Object.freeze({
          path: "app/api/ops/health/route.ts",
          sha256:
            "2dd1539b39761c0416991af20dcc7ab27b5855ba0dc456244bd218b157386f59",
        }),
        rpcRuntime: Object.freeze({
          path: "lib/onchain/rpc-health.ts",
          sha256:
            "7315f82e8d0904941c9cdd6840a79b6720e6a73a99edeb44ce71bb0486d8596e",
        }),
        deploymentConfig: Object.freeze({
          path: "lib/onchain/config.ts",
          sha256:
            "0e75c3d55b54933504c702977c0d7972a788fe89d63cc3c2a7d19138ae7fbcb7",
        }),
        providerConfig: Object.freeze({
          path: "lib/onchain/website-rpc-providers.server.ts",
          sha256:
            "cb0115ba5f594d892e56e407f1a59a52d4c236d7924b78cce4ed727bede21400",
        }),
        currentMarketRpc: Object.freeze({
          path: "lib/market-data/current-market-rpc.server.ts",
          sha256:
            "ef2e01d5a184839ce8c5bebe4ec8d05b374930be13ff16d65bccee12c7e96085",
        }),
      }),
    }),
    closedAlias: Object.freeze({
      path: "/api/ops/index",
      route: "app/api/ops/index/route.ts",
      status: 410,
      sha256:
        "bb498b00334df908029a588bec552516f281fdc0dfc3185bc5cd820984a9ee1f",
    }),
  }),
  customLaunchReconciler: Object.freeze({
    path: "/api/ops/custom-launch/generic-v2-projector",
    schedule: "* * * * *",
    authEnvironment: "CRON_SECRET",
    maximumLifecycleAgeMs: 300_000,
    refreshAfterMs: 60_000,
    leaseMs: 55_000,
    maximumApprovalInventory: 48,
    batchLimit: 16,
    concurrency: 8,
    maximumInitialLogBlocks: 20_000,
    maximumConcurrentLogRequests: 24,
    route: Object.freeze({
      path: "app/api/ops/custom-launch/generic-v2-projector/route.ts",
      sha256:
        "d2f6509eba91dd5690e58d121daf4802aa1367b3807da31ed7ec060ba84b1f14",
    }),
    runtime: Object.freeze({
      path: "lib/server/custom-launch/generic-launch-production-v2.ts",
      sha256:
        "b70e8d1a904ed09b1161269b182af7b4e18c93d552acb6e94a5cc66d9d76a19b",
    }),
    store: Object.freeze({
      path: "lib/server/custom-launch/generic-launch-postgres-v2.ts",
      sha256:
        "d542726f80bd816387240f1707e5934946b5dcf1cc9d69a015e08f3bb2d904be",
    }),
    registryReader: Object.freeze({
      path: "lib/server/custom-launch/generic-launch-registry-reader-v2.ts",
      sha256:
        "a8b6607c641949ad384def4cb9b808233fecea37aadcd9517da69c9845a3dafd",
    }),
    migration: Object.freeze({
      path: "ops/website-projection-target/migrations/0005_generic_launch_materializations_v2.sql",
      sha256:
        "695328763c639b7d11562c394183864998e532eb6cc38d341020e8843de213b8",
    }),
  }),
  routerLaunchRefresher: Object.freeze({
    path: "/api/ops/alchemy-launch-refresh",
    schedule: "* * * * *",
    authEnvironment: "CRON_SECRET",
    maxDurationSeconds: 60,
    forcePersist: true,
    includeLatest: false,
    requirePersistence: true,
    finalityConfirmations: 64,
    maximumCatchUpBlocks: 50_000,
    route: Object.freeze({
      path: "app/api/ops/alchemy-launch-refresh/route.ts",
      sha256:
        "71a783691e226120836f3f26c603d1aa793159af5afbc35d2fb03909ee4add03",
    }),
    runtime: Object.freeze({
      path: "lib/alchemy/explore.server.ts",
      sha256:
        "e7e7c0431c53532e54a969821b4b2fe63ff936c6ff91f018c2db4a98af89cc5a",
    }),
    store: Object.freeze({
      path: "lib/alchemy/launch-registry.server.ts",
      sha256:
        "8010bdbce557cbb9999e26d6c6ca036b537abfe723d57aadd1535399152316a7",
    }),
    routerReader: Object.freeze({
      path: "lib/alchemy/launch-stamp.server.ts",
      sha256:
        "694991e411ee416b7fb03b25bf9b4ed3aab574b4c8e39963eb3f1551df97a7e9",
    }),
    publicSnapshot: Object.freeze({
      path: "lib/alchemy/router-custom-public.server.ts",
      sha256:
        "a2fdc5c675e31f062908038499586fd958e990c8add4d031d518f83c7df0331a",
    }),
  }),
  independentCrons: Object.freeze([
    Object.freeze({
      id: "protocol-revenue",
      path: "/api/ops/protocol-revenue",
      schedule: "* * * * *",
      activationEnvironment: "PROTOCOL_REVENUE_AUTOMATION_ENABLED",
      route: Object.freeze({
        path: "app/api/ops/protocol-revenue/route.ts",
        sha256:
          "9a7012e88ec958c61db08295401cd1b9a932dce9bec14b85075f090782485726",
      }),
      runtime: Object.freeze({
        path: "lib/protocol-revenue/keeper-v2.server.ts",
        sha256:
          "8a0b48fcc3cf3034c4be422cc6e9f35f5c7c224c2c45589b34b5798a3fd5a0d8",
      }),
      dependencies: Object.freeze([
        Object.freeze({
          path: "lib/server/action-rpc-quorum.server.ts",
          sha256:
            "83b57151b7e456a2856230b81588b4b3558026af075939a2dba13250af599ae9",
        }),
      ]),
      policy: Object.freeze({
        path: "lib/protocol-revenue/keeper-policy.ts",
        sha256:
          "bb39f651c11e49173e5b07e42edd2bfa4a1c0e78e5b0345a47b338751e451787",
      }),
    }),
  ]),
  workers: Object.freeze([
    Object.freeze({
      id: "source-projector",
      path: "/api/ops/projector",
      schedule: "* * * * *",
      activationEnvironment: "PROGRAMMABLE_PROJECTOR_ACTIVE",
      route: Object.freeze({
        path: "app/api/ops/projector/route.ts",
        sha256:
          "9b12168cbbadf0addac351c45f71931f3c04370bcd6cabe6174d21daeb00a94d",
      }),
      runtime: Object.freeze({
        path: "lib/data-pipeline/projector-runtime-config.server.ts",
        sha256:
          "25c5427bd24714262e04d3eb14b6b31c71820e9b4070817d4146fe1309bb7fb5",
      }),
      dependencies: Object.freeze([
        Object.freeze({
          path: "lib/data-pipeline/candidate-projector-runtime-binding.server.ts",
          sha256:
            "014476a4f7b344b1d8a7c92aafab95d3e9efda1da4d2e323b83e838e8a068228",
        }),
      ]),
      migrations: Object.freeze([
        Object.freeze({
          path: "supabase/migrations/20260731203900_projector_runtime_singleton_lease.sql",
          sha256:
            "068f27a70ec6df57b84bf336fc2c46b316a7d10d40b9d489fc47e95acb6f74b0",
        }),
        Object.freeze({
          path: "supabase/migrations/20260731224000_projector_provider_evidence_binding.sql",
          sha256:
            "0404f7c610a34af23fe536f021927efec4e0aede235068b70be04331c58f03af",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801090000_bootstrap_dynamic_evidence_and_launch_requirements.sql",
          sha256:
            "e095d128feb12c8962c81be003e693dd67417cfed209144c998ab57d5e8786aa",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801091000_candidate_projector_unpromoted_gate.sql",
          sha256:
            "cd8b5a4aa4801ca773cb84047edbf05349288cada47d671bd47e7d997902c91f",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801092000_verify_candidate_database_promoted.sql",
          sha256:
            "ed5f54a374ad8178393e88a3948281ad9acba10aebbbd5209ea6793691b8c677",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801093000_bind_candidate_promotion_to_product.sql",
          sha256:
            "c6a032ef371b2211004c8d72c0a8c4eec4ba630776210aed48d2d054e642dbbe",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801125441_reuse_safe_head_observations.sql",
          sha256:
            "afbeea7bcf60e492e51bfd0c56517613f32a6f87a0182af00c48bdaef6569e74",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801144403_accept_uuid_v8_dynamic_source_lineage.sql",
          sha256:
            "85e0509d2a4fa49062a18d891e51cd0c64c1015926c3c3ef47a83ce16edb4170",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801155212_reuse_dual_rpc_block_evidence.sql",
          sha256:
            "51142370cf7fdf2bd60c2812978fe2cbbacf99f42b87c72f0ad1ac61b303cf51",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801204500_reuse_dual_rpc_block_evidence_constraint.sql",
          sha256:
            "92cc63189b41eda613ba9da21b7ef21bee650a93f1825f5ee063727ee6c06b11",
        }),
        Object.freeze({
          path: "supabase/migrations/20260813083835_provider_neutral_drpc_quicknode.sql",
          sha256:
            "ee6ae24120ad633509a1341f8995905dff19b66052a083588075517f1acbc9f0",
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
        sha256:
          "73bf9299095cfdf75d5452513ee818e161297a83c6355760ab2f79a22a13edbd",
      }),
      runtime: Object.freeze({
        path: "lib/data-pipeline/market-projector-runtime.server.ts",
        sha256:
          "170138d1d3cc8de5cacb0b2b7a8f587d83e75d6e4031c314b226b673cc9dac6b",
      }),
      migrations: Object.freeze([
        Object.freeze({
          path: "supabase/migrations/20260731223000_market_projector_contract.sql",
          sha256:
            "ea73f4112a53b25e72aa697d3fc0679bf9c6e7f93a496edd167803d6a7f81a24",
        }),
        Object.freeze({
          path: "supabase/migrations/20260802092800_market_projector_fast_lane.sql",
          sha256:
            "70c2719af30e0d3438e3de306376c7fa62d0196be98f81d7bd6b327559c14dc7",
        }),
        Object.freeze({
          path: "supabase/migrations/20260803000100_market_projector_health_view.sql",
          sha256:
            "946000d60600f8b144fb535579f6808b0acfd6da3331f17511f712e7bb24b2fd",
        }),
        Object.freeze({
          path: "supabase/migrations/20260813083835_provider_neutral_drpc_quicknode.sql",
          sha256:
            "ee6ae24120ad633509a1341f8995905dff19b66052a083588075517f1acbc9f0",
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
        sha256:
          "71549b17be233af2be052e1e4f948cbae37d804dc662354c6bfcd234bfdd266a",
      }),
      verifier: Object.freeze({
        path: "lib/data-pipeline/quicknode-stream-wake.server.ts",
        sha256:
          "b28af0bdd6860eb6f55b54ea4093a1ddbf9007667c3193f99061057e477c9153",
      }),
      canary: Object.freeze({
        path: "scripts/perf/read-model-projector-wake-canary.mjs",
        sha256:
          "6820b5bf29cdbf34ae7c5f1bfab55c7bccafb53a7989e09b87aad81cfa111db7",
      }),
      dependencies: Object.freeze([
        Object.freeze({
          path: "lib/data-pipeline/quicknode-wake-queue.server.ts",
          sha256:
            "a3743900032ff2c7b4f4636d5731d6de1d680e1f49bd0cce2365c448ea1243d0",
        }),
        Object.freeze({
          path: "lib/data-pipeline/optimistic-wake-runtime.server.ts",
          sha256:
            "306a06191e2d6849d8d85f6a1cf79ed027ff3ff482b8e374755935d738fa4307",
        }),
        Object.freeze({
          path: "lib/data-pipeline/optimistic-block-reader.server.ts",
          sha256:
            "983080e347dd9fb90daf5696f096a446f3c119a250669545dcb2208ba639b161",
        }),
        Object.freeze({
          path: "lib/data-pipeline/optimistic-market-state.server.ts",
          sha256:
            "e608497bc890bf2fbaf8f6af056fe91a5a4c84bae04c1a4fd80dccd04b779d9e",
        }),
        Object.freeze({
          path: "lib/data-pipeline/optimistic-live-runtime.server.ts",
          sha256:
            "9cfc38593e10acdbb4206c93f7eea403ae32b944fd875cd2da8b330f6929bcd4",
        }),
        Object.freeze({
          path: "lib/data-pipeline/read-model-real-block-sla-capture.server.ts",
          sha256:
            "1cadb53abb9783204fc1a2cecc83abdfb1541225d46cea3e52ebc9411769dd32",
        }),
        Object.freeze({
          path: "lib/data-pipeline/dual-rpc.ts",
          sha256:
            "12018866a1452d098d273e6e0f30274a4687f83a4fcba17764e2d88ca8093981",
        }),
        Object.freeze({
          path: "lib/data-pipeline/rpc-providers.server.ts",
          sha256:
            "8901014d3f4beab60ff324efc90d2d57a3e034399942e9b42c2f01a0d7ef9b5d",
        }),
        Object.freeze({
          path: "app/api/ops/read-model-real-block-sla/route.ts",
          sha256:
            "367140b12a27068c55f2a5881e27729fbab4d1d9a6187c2148fd29bc4f075946",
        }),
        Object.freeze({
          path: "supabase/migrations/20260802104211_real_block_sla_runtime_receipts.sql",
          sha256:
            "0b9331f2b452084c4544b751ce1fbd41bba7e927ef81d6cddcb258c36f8729dc",
        }),
        Object.freeze({
          path: "supabase/migrations/20260813083835_provider_neutral_drpc_quicknode.sql",
          sha256:
            "ee6ae24120ad633509a1341f8995905dff19b66052a083588075517f1acbc9f0",
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
        sha256:
          "c6fa20ec8f4bbc18dc15da91328329f1822db31df66d6bd02e403f06e93fc28f",
      }),
      schema: Object.freeze({
        path: "config/read-model-real-block-sla-db-attestation.schema.json",
        sha256:
          "73d78c27c6b8dc311dd50911bd4f1b4c2c44e967fd53aa5b415f566e264b69da",
      }),
    }),
  }),
  postPromotion: Object.freeze({
    publicRoutes: Object.freeze([
      "/",
      "/api/ops/health",
      "/api/explore?limit=9&page=1&sort=market-cap",
      "/api/explore?limit=100&page=1&sort=newest",
      "/api/explore?limit=100&page=1&sort=newest&q={canonicalTokenAddress}",
      "/api/explore?limit=100&page=1&sort=trending",
      "/api/explore/token",
      "/api/explore/token/analytics?chain=1&address={canonicalTokenAddress}&section=summary",
      "/api/explore/token/analytics?chain=1&address={canonicalTokenAddress}&section=holders&limit=20",
      "/api/explore/token/analytics?chain=1&address={canonicalTokenAddress}&section=traders&limit=20",
      "/api/explore/token/chart",
      "/api/explore/profile",
      "/api/profile/classic-v3",
      "/api/profile/stock-paired",
      "/api/explore/profile/claim",
      "/api/trade/prepare",
    ]),
    sources: Object.freeze({
      launchIdentity:
        "envio-classic-v3-or-bounded-last-good+registry.custom-launched+canonical-launch-stamp-router",
      creatorIdentity:
        "envio-classic-v3+envio-classic-v2-claims+canonical-launch-stamp-router+commitment-bound-rpc-profile-state",
      actionState:
        "canonical-launch-stamp-router+bitquery-stock-identity+commitment-bound-rpc-current-state",
      market:
        "gmgn-visible-and-market-cap-ranking-primary+gmgn-token-info-unobserved-ranking-primary+dexscreener-visible-and-unqualified-ranking-fallback",
      fdv: "gmgn-visible-and-unobserved-ranking-primary+dexscreener-visible-and-unqualified-ranking-fallback",
      discovery:
        "gmgn-canonical-intersection-with-launch-order-fallback+gmgn-search-canonical-intersection-with-local-match-fallback",
      analytics: "gmgn-token-level+gmgn-token-level-pool-info",
      chart: "gmgn-token-level-primary+bitquery-exact-pool-fallback",
    }),
    rpc: Object.freeze({
      provider: "drpc",
      role: "primary",
      endpointCommitmentRequired: true,
      secondaryProvider: "quicknode",
      secondaryRole: "eligible-transport-capacity-failover",
      secondaryEndpointCommitmentRequired: true,
      secondaryRequired: true,
    }),
    fallbacks: true,
    providerUrlExposure: false,
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

function includesEverySourceFragment(source, fragments) {
  if (typeof source !== "string") return false;
  const compactSource = source.replace(/\s+/gu, "");
  return fragments.every((fragment) =>
    compactSource.includes(fragment.replace(/\s+/gu, "")),
  );
}

function includesExactLineSequence(source, lines) {
  if (typeof source !== "string") return false;
  const sourceLines = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return sourceLines.some((line, start) =>
    lines.every((expected, offset) => sourceLines[start + offset] === expected),
  );
}

const GMGN_READ_ONLY_ENDPOINT_CONTRACT = Object.freeze([
  Object.freeze({
    path: "lib/market-data/gmgn.server.ts",
    fetchImplReferences: 8,
    pathReferences: 2,
    allowed: Object.freeze(["/v1/token/info"]),
    calls: Object.freeze([Object.freeze(["/v1/token/info"])]),
  }),
  Object.freeze({
    path: "lib/market-data/gmgn-chart.server.ts",
    fetchImplReferences: 8,
    pathReferences: 3,
    allowed: Object.freeze(["/v1/market/token_kline", "/v1/token/info"]),
    calls: Object.freeze([
      Object.freeze(["/v1/market/token_kline"]),
      Object.freeze(["/v1/token/info"]),
    ]),
  }),
  Object.freeze({
    path: "lib/market-data/gmgn-token-analytics.server.ts",
    fetchImplReferences: 8,
    pathReferences: 7,
    allowed: Object.freeze([
      "/v1/market/token_top_holders",
      "/v1/market/token_top_traders",
      "/v1/token/pool_info",
      "/v1/token/security",
    ]),
    calls: Object.freeze([
      Object.freeze(["/v1/token/security"]),
      Object.freeze(["/v1/token/pool_info"]),
      Object.freeze([
        "/v1/market/token_top_holders",
        "/v1/market/token_top_traders",
      ]),
    ]),
  }),
  Object.freeze({
    path: "lib/market-data/gmgn-discovery.server.ts",
    fetchImplReferences: 8,
    pathReferences: 18,
    allowed: Object.freeze([
      "/v1/market/hot_searches",
      "/v1/market/rank",
      "/v1/market/search",
      "/v1/token/info",
    ]),
    calls: Object.freeze([
      Object.freeze(["/v1/market/hot_searches", "/v1/market/rank"]),
      Object.freeze(["/v1/market/search", "/v1/token/info"]),
    ]),
  }),
]);

const GMGN_PROVIDER_LIFECYCLE_CONTRACT = Object.freeze([
  Object.freeze({
    path: "lib/market-data/gmgn.server.ts",
    lifecycleWaits: Object.freeze(["providerWait"]),
    normalCompletionCount: 6,
    providerBlockCount: 4,
  }),
  Object.freeze({
    path: "lib/market-data/gmgn-chart.server.ts",
    lifecycleWaits: Object.freeze(["providerWait", "wait"]),
    normalCompletionCount: 6,
    providerBlockCount: 4,
  }),
  Object.freeze({
    path: "lib/market-data/gmgn-token-analytics.server.ts",
    lifecycleWaits: Object.freeze(["providerWait"]),
    normalCompletionCount: 4,
    providerBlockCount: 2,
  }),
  Object.freeze({
    path: "lib/market-data/gmgn-discovery.server.ts",
    lifecycleWaits: Object.freeze(["operation"]),
    normalCompletionCount: 4,
    providerBlockCount: 2,
  }),
]);

const PUBLIC_WALLET_FIELDS = Object.freeze([
  "address",
  "usdValue",
  "amountRatio",
  "buyVolumeUsd",
  "sellVolumeUsd",
  "profitUsd",
  "profitRatio",
]);

const ANALYTICS_PROVIDER_READS = Object.freeze([
  "readGmgnTokenSecurityV1",
  "readGmgnTokenPoolInfoV1",
  "readGmgnTokenTopHoldersV1",
  "readGmgnTokenTopTradersV1",
]);

function reviewedTypeScriptSource(path, source) {
  if (typeof source !== "string") return null;
  const parsed = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return parsed.parseDiagnostics.length === 0 ? parsed : null;
}

function collectTypeScriptNodes(root, predicate) {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function unwrapReviewedExpression(value) {
  let expression = value;
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  )
    expression = expression.expression;
  return expression;
}

function exactIdentifier(value, expected) {
  const expression = unwrapReviewedExpression(value);
  return ts.isIdentifier(expression) && expression.text === expected;
}

function constVariableDeclarations(sourceFile) {
  const declarations = new Map();
  for (const declaration of collectTypeScriptNodes(sourceFile, (node) =>
    ts.isVariableDeclaration(node),
  )) {
    if (
      !ts.isIdentifier(declaration.name) ||
      declaration.initializer === undefined ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      (declaration.parent.flags & ts.NodeFlags.Const) === 0
    )
      continue;
    const existing = declarations.get(declaration.name.text) ?? [];
    existing.push(declaration);
    declarations.set(declaration.name.text, existing);
  }
  return declarations;
}

function staticEndpointValues(expression, declarations, seen = new Set()) {
  const value = unwrapReviewedExpression(expression);
  if (ts.isStringLiteral(value)) return [value.text];
  if (ts.isNoSubstitutionTemplateLiteral(value)) return [value.text];
  if (ts.isConditionalExpression(value)) {
    const whenTrue = staticEndpointValues(value.whenTrue, declarations, seen);
    const whenFalse = staticEndpointValues(value.whenFalse, declarations, seen);
    return whenTrue === null || whenFalse === null
      ? null
      : [...new Set([...whenTrue, ...whenFalse])].sort();
  }
  if (!ts.isIdentifier(value) || seen.has(value.text)) return null;
  const candidates = declarations.get(value.text) ?? [];
  if (candidates.length !== 1) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(value.text);
  return staticEndpointValues(
    candidates[0].initializer,
    declarations,
    nextSeen,
  );
}

function typeAliasDeclarations(sourceFile) {
  const aliases = new Map();
  for (const declaration of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(declaration)) continue;
    const existing = aliases.get(declaration.name.text) ?? [];
    existing.push(declaration);
    aliases.set(declaration.name.text, existing);
  }
  return aliases;
}

function staticEndpointTypeValues(typeNode, aliases, seen = new Set()) {
  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
    return [typeNode.literal.text];
  }
  if (ts.isUnionTypeNode(typeNode)) {
    const values = typeNode.types.map((member) =>
      staticEndpointTypeValues(member, aliases, seen),
    );
    return values.some((value) => value === null)
      ? null
      : [...new Set(values.flat())].sort();
  }
  if (
    !ts.isTypeReferenceNode(typeNode) ||
    !ts.isIdentifier(typeNode.typeName) ||
    seen.has(typeNode.typeName.text)
  )
    return null;
  const candidates = aliases.get(typeNode.typeName.text) ?? [];
  if (candidates.length !== 1) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(typeNode.typeName.text);
  return staticEndpointTypeValues(candidates[0].type, aliases, nextSeen);
}

function gmgnEndpointFragments(sourceFile) {
  return collectTypeScriptNodes(
    sourceFile,
    (node) =>
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node),
  )
    .map((node) => node.text)
    .filter((value) => value.includes("/v1/"));
}

function identifierCount(sourceFile, name) {
  return collectTypeScriptNodes(
    sourceFile,
    (node) => ts.isIdentifier(node) && node.text === name,
  ).length;
}

function exactReviewedUrlUsage(sourceFile, constructor, fetchCall) {
  const references = collectTypeScriptNodes(
    sourceFile,
    (node) => ts.isIdentifier(node) && node.text === "url",
  );
  let declarationCount = 0;
  let searchParameterCount = 0;
  let fetchArgumentCount = 0;
  for (const reference of references) {
    const parent = reference.parent;
    if (
      ts.isVariableDeclaration(parent) &&
      parent.name === reference &&
      parent.initializer !== undefined &&
      unwrapReviewedExpression(parent.initializer) === constructor
    ) {
      declarationCount += 1;
      continue;
    }
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === reference &&
      parent.name.text === "searchParams" &&
      ts.isPropertyAccessExpression(parent.parent) &&
      parent.parent.expression === parent &&
      parent.parent.name.text === "set" &&
      ts.isCallExpression(parent.parent.parent) &&
      parent.parent.parent.expression === parent.parent
    ) {
      searchParameterCount += 1;
      continue;
    }
    if (
      ts.isCallExpression(parent) &&
      parent === fetchCall &&
      parent.arguments[0] === reference
    ) {
      fetchArgumentCount += 1;
      continue;
    }
    return false;
  }
  return (
    references.length === 5 &&
    declarationCount === 1 &&
    searchParameterCount === 3 &&
    fetchArgumentCount === 1
  );
}

function exactGmgnEndpointClientContract(sourceFile, contract) {
  const declarations = constVariableDeclarations(sourceFile);
  const aliases = typeAliasDeclarations(sourceFile);
  const requestFunctions = collectTypeScriptNodes(
    sourceFile,
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "gmgnJsonRequest",
  );
  if (requestFunctions.length !== 1) return false;
  const pathType = requestFunctions[0].parameters[0]?.type;
  if (pathType === undefined) return false;
  const allowed = [...contract.allowed].sort();
  if (!exactJson(staticEndpointTypeValues(pathType, aliases), allowed)) {
    return false;
  }

  const requestCalls = collectTypeScriptNodes(
    sourceFile,
    (node) =>
      ts.isCallExpression(node) &&
      exactIdentifier(node.expression, "gmgnJsonRequest"),
  ).sort(
    (left, right) => left.getStart(sourceFile) - right.getStart(sourceFile),
  );
  const callEndpoints = requestCalls.map((call) =>
    call.arguments[0] === undefined
      ? null
      : staticEndpointValues(call.arguments[0], declarations),
  );
  if (!exactJson(callEndpoints, contract.calls)) return false;

  if (
    identifierCount(sourceFile, "gmgnJsonRequest") !==
      contract.calls.length + 1 ||
    identifierCount(sourceFile, "fetchImpl") !== contract.fetchImplReferences ||
    identifierCount(sourceFile, "fetch") !== 3 ||
    identifierCount(sourceFile, "URL") !== 1 ||
    identifierCount(sourceFile, "GMGN_API_ORIGIN") !== 2 ||
    identifierCount(sourceFile, "path") !== contract.pathReferences
  )
    return false;

  const endpointFragments = gmgnEndpointFragments(sourceFile);
  if (endpointFragments.some((value) => !allowed.includes(value))) return false;

  const urlConstructors = collectTypeScriptNodes(
    sourceFile,
    (node) =>
      ts.isNewExpression(node) && exactIdentifier(node.expression, "URL"),
  );
  if (
    urlConstructors.length !== 1 ||
    urlConstructors[0].arguments?.length !== 2 ||
    !exactIdentifier(urlConstructors[0].arguments[0], "path") ||
    !exactIdentifier(urlConstructors[0].arguments[1], "GMGN_API_ORIGIN")
  )
    return false;

  const networkCalls = collectTypeScriptNodes(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return false;
    const callee = unwrapReviewedExpression(node.expression);
    return (
      (ts.isIdentifier(callee) &&
        ["fetch", "fetchImpl"].includes(callee.text)) ||
      (ts.isPropertyAccessExpression(callee) && callee.name.text === "fetch")
    );
  });
  return (
    networkCalls.length === 1 &&
    exactIdentifier(networkCalls[0].expression, "fetchImpl") &&
    networkCalls[0].arguments.length >= 1 &&
    exactIdentifier(networkCalls[0].arguments[0], "url") &&
    exactReviewedUrlUsage(sourceFile, urlConstructors[0], networkCalls[0])
  );
}

function exactGmgnReadOnlyEndpointContract(sourceByPath) {
  return GMGN_READ_ONLY_ENDPOINT_CONTRACT.every((contract) => {
    const sourceFile = reviewedTypeScriptSource(
      contract.path,
      sourceByPath.get(contract.path),
    );
    return (
      sourceFile !== null &&
      exactGmgnEndpointClientContract(sourceFile, contract)
    );
  });
}

function directCallName(value) {
  const expression = unwrapReviewedExpression(value);
  return ts.isIdentifier(expression) ? expression.text : null;
}

function compactReviewedNode(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/gu, "");
}

function directNamedCalls(sourceFile, name) {
  return collectTypeScriptNodes(
    sourceFile,
    (node) =>
      ts.isCallExpression(node) && directCallName(node.expression) === name,
  ).sort(
    (left, right) => left.getStart(sourceFile) - right.getStart(sourceFile),
  );
}

function exactGmgnProviderLifecycleAdapterContract(sourceFile, contract) {
  const lifecycleCalls = directNamedCalls(
    sourceFile,
    "settleProviderReadLifecycle",
  );
  const lifecycleShapes = lifecycleCalls.map((call) =>
    call.arguments.map((argument) => compactReviewedNode(argument, sourceFile)),
  );
  const expectedLifecycleShapes = contract.lifecycleWaits.map((wait) => [
    "providerRead",
    wait,
  ]);
  if (!exactJson(lifecycleShapes, expectedLifecycleShapes)) return false;

  const settleCalls = directNamedCalls(sourceFile, "settleProviderOperation");
  const settleShapes = settleCalls.map((call) =>
    call.arguments.map((argument) => compactReviewedNode(argument, sourceFile)),
  );
  if (
    !exactJson(settleShapes, [
      ["pending", "requestOperation"],
      ["pending", "providerLifecycleOperation()"],
      ["pending", "operation"],
      ["pending", "lateOutcome"],
      ["pending", "providerOutcomeOperation()"],
      ["accountGate.complete(reservation)", "outcomeOperation"],
    ]) ||
    settleShapes.some(([pending]) => pending === "providerRead")
  ) return false;

  const completionShapes = directNamedCalls(
    sourceFile,
    "completeProviderRequest",
  ).map((call) =>
    JSON.stringify(
      call.arguments.map((argument) =>
        compactReviewedNode(argument, sourceFile)
      ),
    )
  ).sort();
  const expectedCompletionShapes = [
    ...Array.from(
      { length: contract.normalCompletionCount },
      () => JSON.stringify(["accountGate", "reservation"]),
    ),
    JSON.stringify(["accountGate", "lateDecision", "lateOutcome"]),
    JSON.stringify(["accountGate", "decision"]),
  ].sort();
  if (!exactJson(completionShapes, expectedCompletionShapes)) return false;

  const providerBlockCalls = directNamedCalls(
    sourceFile,
    "publishProviderBlock",
  );
  return providerBlockCalls.length === contract.providerBlockCount &&
    providerBlockCalls.every((call) =>
      call.arguments.length === 5 &&
      exactIdentifier(call.arguments[0], "accountGate") &&
      exactIdentifier(call.arguments[1], "reservation")
    );
}

function exactGmgnProviderLifecycleContract(sourceByPath) {
  return GMGN_PROVIDER_LIFECYCLE_CONTRACT.every((contract) => {
    const sourceFile = reviewedTypeScriptSource(
      contract.path,
      sourceByPath.get(contract.path),
    );
    return sourceFile !== null &&
      exactGmgnProviderLifecycleAdapterContract(sourceFile, contract);
  });
}

function exactExploreGmgnMarketCapRetryContract(source) {
  const sourceFile = reviewedTypeScriptSource(
    "app/api/explore/route.ts",
    source,
  );
  if (sourceFile === null) return false;
  const declarations = constVariableDeclarations(sourceFile);
  const directionDeclarations = declarations.get("direction") ?? [];
  const rankOptionsDeclarations = declarations.get("rankOptions") ?? [];
  if (
    directionDeclarations.length !== 1 ||
    rankOptionsDeclarations.length !== 1 ||
    directionDeclarations[0].initializer === undefined ||
    compactReviewedNode(directionDeclarations[0].initializer, sourceFile) !==
      'options.sort==="market-cap"?"desc":"asc"'
  ) return false;

  const rankOptions = unwrapReviewedExpression(
    rankOptionsDeclarations[0].initializer,
  );
  if (!ts.isObjectLiteralExpression(rankOptions)) return false;
  const directionProperties = rankOptions.properties.filter((property) =>
    ts.isShorthandPropertyAssignment(property) &&
    property.name.text === "direction"
  );
  if (directionProperties.length !== 1) return false;

  const authorityRankCalls = directNamedCalls(
    sourceFile,
    "readGmgnEthereumMarketCapAuthorityRankV1",
  );
  const rankCalls = authorityRankCalls.filter((call) =>
    call.arguments.length === 2 &&
    exactIdentifier(call.arguments[0], "rankOptions")
  );
  if (
    rankCalls.length !== 2 ||
    rankCalls.some((call) => !exactIdentifier(call.arguments[1], "rankWait"))
  ) return false;
  const retryFunction = nearestFunctionLike(rankCalls[0]);
  return retryFunction !== null &&
    retryFunction === nearestFunctionLike(rankCalls[1]) &&
    authorityRankCalls.filter((call) =>
      nearestFunctionLike(call) === retryFunction
    )
      .length === 2;
}

function nearestFunctionLike(node) {
  let current = node.parent;
  while (current !== undefined) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
}

function exactAnalyticsProofReadBoundary(source) {
  const sourceFile = reviewedTypeScriptSource(
    "app/api/explore/token/analytics/route.ts",
    source,
  );
  if (sourceFile === null) return false;
  const getFunctions = collectTypeScriptNodes(
    sourceFile,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "GET",
  );
  if (getFunctions.length !== 1 || getFunctions[0].body === undefined) {
    return false;
  }
  const getFunction = getFunctions[0];
  const allCalls = collectTypeScriptNodes(sourceFile, (node) =>
    ts.isCallExpression(node),
  );
  const proofCalls = allCalls.filter(
    (call) => directCallName(call.expression) === "readGmgnMarketSnapshotV1",
  );
  const providerCalls = Object.fromEntries(
    ANALYTICS_PROVIDER_READS.map((name) => [
      name,
      allCalls.filter((call) => directCallName(call.expression) === name),
    ]),
  );
  if (
    proofCalls.length !== 1 ||
    ANALYTICS_PROVIDER_READS.some((name) => providerCalls[name].length !== 1)
  )
    return false;
  for (const name of [
    "readGmgnMarketSnapshotV1",
    ...ANALYTICS_PROVIDER_READS,
  ]) {
    const identifiers = collectTypeScriptNodes(
      sourceFile,
      (node) => ts.isIdentifier(node) && node.text === name,
    );
    if (identifiers.length !== 2) return false;
  }

  const verificationGuards = collectTypeScriptNodes(
    getFunction.body,
    (node) =>
      ts.isIfStatement(node) &&
      node.expression.getText(sourceFile).replace(/\s+/gu, "") ===
        "verification===null",
  );
  if (verificationGuards.length !== 1) return false;
  const guard = verificationGuards[0];
  if (
    proofCalls[0].getStart(sourceFile) >= guard.getStart(sourceFile) ||
    proofCalls[0].getStart(sourceFile) <
      getFunction.body.getStart(sourceFile) ||
    nearestFunctionLike(proofCalls[0]) !== getFunction
  )
    return false;
  return ANALYTICS_PROVIDER_READS.every((name) => {
    const call = providerCalls[name][0];
    return (
      call.getStart(sourceFile) > guard.end &&
      call.end < getFunction.body.end &&
      nearestFunctionLike(call) === getFunction
    );
  });
}

function directPropertyName(property) {
  return ts.isIdentifier(property.name) ? property.name.text : null;
}

function exactPublicWalletProjection(source) {
  const sourceFile = reviewedTypeScriptSource(
    "app/api/explore/token/analytics/route.ts",
    source,
  );
  if (sourceFile === null) return false;
  const functions = collectTypeScriptNodes(
    sourceFile,
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "publicWalletRankingV1",
  );
  if (functions.length !== 1 || functions[0].body === undefined) return false;
  const returns = collectTypeScriptNodes(functions[0].body, (node) =>
    ts.isReturnStatement(node),
  );
  if (returns.length !== 1 || returns[0].expression === undefined) return false;
  const outer = unwrapReviewedExpression(returns[0].expression);
  if (!ts.isObjectLiteralExpression(outer) || outer.properties.length !== 2) {
    return false;
  }
  const outerProperties = outer.properties;
  if (
    outerProperties.some((property) => !ts.isPropertyAssignment(property)) ||
    !exactJson(outerProperties.map(directPropertyName), [
      "fetchedAt",
      "wallets",
    ])
  )
    return false;
  const fetchedAt = unwrapReviewedExpression(outerProperties[0].initializer);
  const wallets = unwrapReviewedExpression(outerProperties[1].initializer);
  if (
    !ts.isPropertyAccessExpression(fetchedAt) ||
    !exactIdentifier(fetchedAt.expression, "value") ||
    fetchedAt.name.text !== "fetchedAt" ||
    !ts.isCallExpression(wallets) ||
    !ts.isPropertyAccessExpression(wallets.expression) ||
    wallets.expression.name.text !== "map" ||
    !ts.isPropertyAccessExpression(wallets.expression.expression) ||
    !exactIdentifier(wallets.expression.expression.expression, "value") ||
    wallets.expression.expression.name.text !== "wallets" ||
    wallets.arguments.length !== 1
  )
    return false;
  const mapper = unwrapReviewedExpression(wallets.arguments[0]);
  if (
    !ts.isArrowFunction(mapper) ||
    mapper.parameters.length !== 1 ||
    !ts.isIdentifier(mapper.parameters[0].name) ||
    mapper.parameters[0].name.text !== "wallet"
  )
    return false;
  const projection = unwrapReviewedExpression(mapper.body);
  if (
    !ts.isObjectLiteralExpression(projection) ||
    projection.properties.length !== PUBLIC_WALLET_FIELDS.length ||
    projection.properties.some(
      (property) => !ts.isPropertyAssignment(property),
    ) ||
    !exactJson(
      projection.properties.map(directPropertyName),
      PUBLIC_WALLET_FIELDS,
    )
  )
    return false;
  return projection.properties.every((property, index) => {
    const value = unwrapReviewedExpression(property.initializer);
    return (
      ts.isPropertyAccessExpression(value) &&
      exactIdentifier(value.expression, "wallet") &&
      value.name.text === PUBLIC_WALLET_FIELDS[index]
    );
  });
}

export const STAGED_MARKET_EVIDENCE_SOURCE_GUARDS = Object.freeze([
  "const hasUnevidencedBitqueryFdv = (",
  "if (depth > 12) return true",
  "if (seen.has(value)) return true",
  "value.fdvUsdWad !== undefined",
  "value.marketCapUsdWad !== undefined",
  'value.metric === "fdv"',
  'value.status === "available" ||',
  "const exactCanonicalClassicNativeToken = (",
  'token?.exploreKind !== "token"',
  'token.launchModel !== "classic"',
  'token.liquidityPath === "meme"',
  "token.launchStampProvenance === undefined",
  'token.liquidityPath === "programmable-v4"',
  '"programmable.launch-stamp-provenance.v1"',
  'stamp.kind === "classic"',
  "stamp.chainId === 1",
  "sameBytes32(stamp.poolId, poolId)",
  "sameAddress(stamp.poolKey?.currency0, nativeCurrency)",
  "sameAddress(stamp.poolKey?.currency1, tokenAddress)",
  "sameAddress(stamp.poolKey?.hooks, token?.hookAddress)",
  'valuation.source !== "stateview-chainlink"',
  'valuation.freshness !== "current"',
  "token.fdvUsdWad !== valuation.valueWad",
  "!positiveInteger(valuation.asOfBlock)",
  "!exactBytes32(valuation.asOfBlockHash)",
  "!currentMarketEvidenceTime(valuation.asOfTime)",
  'valuation.lagBlocks !== "0"',
  '"programmable.stateview-chainlink-price-evidence.v1"',
  'price?.source !== "uniswap-v4-stateview-chainlink-v1"',
  "!sameAddress(price.tokenAddress, tokenAddress)",
  "!sameAddress(price.quoteAddress, nativeCurrency)",
  "!sameBytes32(price.poolId, market?.primaryPoolId)",
  "price.stateViewAddress?.toLowerCase() !== mainnetStateView",
  "mainnetStateViewRuntimeCodeHash",
  "price.blockNumber !== valuation.asOfBlock",
  "!sameBytes32(price.blockHash, valuation.asOfBlockHash)",
  "!exactUnixTimestamp(price.blockTimestamp)",
  "price.blockTime !== valuation.asOfTime",
  "!positiveInteger(price.sqrtPriceX96)",
  "!positiveInteger(price.activeLiquidity)",
  "!positiveInteger(price.activeVirtualToken0Wei)",
  "!positiveInteger(price.activeVirtualLiquidityUsdWad)",
  '"stateview-active-liquidity-virtual-depth-usd"',
  "!positiveInteger(price.tokenPriceEthWei)",
  "!positiveInteger(price.tokenPriceUsdWad)",
  "price.totalSupplyRaw !== token.totalSupplyRaw",
  "price.tokenDecimals !== token.tokenDecimals",
  "price.fdvUsdWad !== valuation.valueWad",
  "quote?.feedAddress?.toLowerCase() !== mainnetEthUsdFeed",
  "!positiveInteger(quote.roundId)",
  "!positiveInteger(quote.answeredInRound)",
  "BigInt(quote.answeredInRound) < BigInt(quote.roundId)",
  "!positiveInteger(quote.answer)",
  "quote.decimals !== 8",
  "quote.updatedAtTime !==",
  "!exactCanonicalClassicNativeToken(",
  'market.source !== "bitquery"',
  'market.status !== "current"',
  "!currentMarketTime(market.generatedAt)",
  "!sameBytes32(token.poolId, market.primaryPoolId)",
  "!sameAddress(primary.identity.tokenAddress, tokenAddress)",
  "!sameBytes32(primary.identity.poolId, market.primaryPoolId)",
  'primary.identity.protocol !== "uniswap_v4"',
  'primary.source !== "bitquery"',
  'primary.status !== "current"',
  "hasUnevidencedBitqueryFdv(market)",
  'liquidity?.source !== "official-uniswap-v4-subgraph"',
  'liquidity.identity.protocol !== "uniswap_v4"',
  "!sameBytes32(liquidity.identity.poolId, market.primaryPoolId)",
  "!sameAddress(liquidity.identity.tokenAddress, tokenAddress)",
  'liquidity.valueBasis !== "official-subgraph-pool-tvl-usd"',
  "liquidity.reportedPoolBalances?.token0?.address",
  "liquidity.reportedPoolBalances?.token1?.address",
  "BigInt(liquidity.tvlUsdWad) <",
  'liquidity.freshness !== "current"',
  "provenance?.subgraphId !== officialV4SubgraphId",
  "provenance?.deployment !== officialV4SubgraphDeployment",
  "!currentMarketEvidenceTime(provenance.indexedBlockTime)",
  "valuation.asOfBlock === provenance.referenceHeadBlockNumber",
  "valuation.asOfBlockHash,",
  "lagBlocks === referenceBlock - indexedBlock",
  "lagBlocks <= 64n",
  "indexedTimestamp <= valuationTimeSeconds",
  "feedUpdatedAt <= valuationTimeSeconds",
  "valuationTimeSeconds - feedUpdatedAt <= 7_200n",
  "expectedFdvUsdWad.toString() === valuation.valueWad",
  "expectedTokenPriceEthWei.toString() ===",
  "expectedTokenPriceUsdWad.toString() ===",
  "activeVirtualToken0Wei.toString() ===",
  "expectedActiveVirtualLiquidityUsdWad >=",
  "marketCapTotal > maximumMarketCapTokens",
  "marketCapTotalPages !==",
  "marketCapPages.push(await requestJson(",
  "page.total !== marketCapTotal",
  "page.totalPages !== marketCapTotalPages",
  "page.tokens.length !== expectedPageLength",
  "valuationQuality.available + valuationQuality.unavailable !==",
  "valuationQuality.unknown !== 0",
  "page.__marketHeaders?.marketSource !==",
  "page.__marketHeaders?.valuationBlock !== null",
  "seenMarketCapIds.has(token.id)",
  "seenMarketCapAddresses.has(address)",
  "marketCapTokens.length !== marketCapTotal",
  "hasUnevidencedBitqueryFdv(token?.marketData)",
  'valuation.source === "bitquery"',
  "sawNonCurrentFdv",
  "value > previousCurrentFdv",
  "if (currentFdvCount < 1) {",
  "!sameAddress(",
  "currentFdvDetail.token?.hookAddress",
  "currentFdvDetail.token?.launchModel !==",
  "currentFdvDetail.token?.liquidityPath !==",
  "currentFdvDetail.token?.marketData?.primaryPoolId",
  "currentFdvDetail.token?.valuation?.priceEvidence?.quoteAddress",
  "detailValuationBlock < exploreValuationBlock",
  "Date.parse(currentFdvDetail.token.valuation.asOfTime) <",
  "sameValuationSnapshot",
  "JSON.stringify(currentFdvDetail.token.valuation)",
  "JSON.stringify(currentFdvDetail.token.liquidityEvidence)",
  'for (const range of ["1h", "1d", "1w", "all"])',
  "verifyCurrentPublicOnchainEvidenceV1({",
  "runtimeProductionProviderEndpoints",
  "rpcUrls: independentRpcUrls",
  '"programmable.current-market-independent-proof.v1"',
  "independentCurrentProof.providerCount !== 2",
  'currentChart.readStatus !== "live"',
  '["ready", "insufficient-history"].includes(',
  "currentChart.truncated !== false",
  "currentChart.identity.quoteAddress",
  "currentFdvToken.valuation.priceEvidence.quoteAddress",
  'currentChart.valuation?.status !== "unavailable"',
  'currentChart.valuation?.reason !== "source-unavailable"',
  '"fdvUsdWad" in currentChart',
  '"valuationMetric" in currentChart',
  "chartPoints.at(-1)?.observedAt",
  "!currentMarketTime(currentChart.asOfTime)",
  'point?.valueSemantics !== "period-median"',
  "pointTime !== bucketEnd",
  "observedAt < bucketStart",
  "observedAt > bucketEnd",
  "!positiveDecimal(point?.priceQuote)",
  'typeof point?.quoteSymbol !== "string"',
  "point?.priceUsd !== undefined",
  "point?.ohlcUsd !== undefined",
  "point?.ohlcQuote !== undefined",
  "bucketStart < previousBucketEnd",
  "observedTrades !== currentChart.swapCount",
]);

export const STAGED_HEALTH_HANDOFF_SOURCE_GUARDS = Object.freeze([
  'const HEALTH_PATH = "/api/ops/health";',
  '!target.hostname.endsWith(".vercel.app")',
  "fetchVercelDeployment({",
  "idOrUrl: target.hostname",
  "deployment.id === input.expectedDeploymentId",
  "deploymentHost === target.hostname",
  "deployment.projectId === input.projectId ||",
  'deployment.readyState === "READY"',
  "deploymentCommit(deployment) === input.expectedGitHead",
  "if (deploymentFailures.length > 0) {",
  "const response = await requestHealth(",
  '"x-vercel-protection-bypass": automationBypassSecret',
  'redirect: "error"',
  'response.ok && response.body?.status === "healthy"',
]);
export const STAGED_DURABLE_REFRESH_SOURCE_GUARDS = Object.freeze([
  'const REFRESH_PATH = "/api/ops/index-v2";',
  '!target.hostname.endsWith(".vercel.app")',
  "fetchVercelDeployment({",
  "idOrUrl: target.hostname",
  "deployment.id === input.expectedDeploymentId",
  "deploymentHost === target.hostname",
  "deployment.projectId === input.projectId ||",
  'deployment.readyState === "READY"',
  "deploymentCommit(deployment) === input.expectedGitHead",
  "if (!deploymentMatches) {",
  "Authorization: `Bearer ${input.cronSecret}`",
  '"x-vercel-protection-bypass": input.automationBypassSecret',
  'redirect: "error"',
  "const REQUEST_ATTEMPTS = 3;",
  "const REQUEST_RETRY_DELAY_MS = 5_000;",
  "const MAXIMUM_REQUEST_RETRY_DELAY_MS = 30_000;",
  "const PREWARM_PHASE_DELAY_MS = 1_000;",
  "requestAttempts > 3",
  "requestRetryDelayMs > 15_000",
  "prewarmPhaseDelayMs > 10_000",
  "requestJsonWithRetry(",
  "return status === 429 || status >= 500;",
  "retryDelayMs * (2 ** (attempt - 1))",
  "const PREWARM_STEP_COUNT = 32;",
  "const PREWARM_STEPS = Object.freeze([",
  '"01", "02", "03", "04", "05", "06", "07", "08"',
  '"25", "26", "27", "28", "29", "30", "31", "32"',
  "const PREWARM_PHASES = Object.freeze(PREWARM_STEPS.flatMap((step) => [",
  "`classic-primary-${step}`",
  "`classic-secondary-${step}`",
  "for (let index = 0; index < PREWARM_PHASES.length; index += 1) {",
  "prewarm = await requestJsonWithRetry(",
  "await sleepImpl(prewarmPhaseDelayMs);",
  "value.body.stepCount === PREWARM_STEP_COUNT",
  "blockNumber === expectedBlock",
  "blockNumber === confirmedBlock",
  'prewarmUrl.searchParams.set("phase", phase)',
  "if (!exactPrewarmResponse(prewarm, phase)) {",
  "if (!exactRefreshResponse(refresh)) {",
  "value.body.tokenCount > 0",
  'value.body.portfolioHistory.status !== "empty"',
  "portfolioHistoryPath: refresh.body.portfolioHistory.path",
]);
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
    /const\s+secretLength\s*=\s*secret\s*\?\s*Buffer\.byteLength\(secret,\s*["']utf8["']\)\s*:\s*0/u.test(
      source,
    ) &&
    /secretLength\s*<\s*32/u.test(source) &&
    /secretLength\s*>\s*1_024/u.test(source);
  const standardAuthorization =
    /matchesBearer\(request,\s*process\.env\.CRON_SECRET\)/u.test(source) ||
    /const\s+secret\s*=\s*process\.env\.CRON_SECRET/u.test(source) ||
    /const\s+secret\s*=\s*environment\.CRON_SECRET/u.test(source);
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
      (cutoverAuthorization && /mode\s*===\s*["']cutover["']/u.test(source))) &&
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
    source.includes('"VERCEL_AUTOMATION_BYPASS_SECRET"') &&
    source.includes('"x-vercel-protection-bypass"') &&
    source.includes('createHmac("sha256", secret)') &&
    source.includes('id: "invalid-signature"') &&
    source.includes('id: "stale-timestamp"') &&
    source.includes('id: "valid-delivery"') &&
    source.includes("status: 401") &&
    source.includes("status: 202") &&
    source.includes('"cache-control"') &&
    source.includes('hostname.endsWith(".vercel.app")') &&
    !source.includes("NEXT_PUBLIC_PROGRAMMABLE_QUICKNODE_STREAM_SECRET") &&
    !source.includes("NEXT_PUBLIC_VERCEL_AUTOMATION_BYPASS_SECRET")
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
    source.includes(
      'evidence.kind !== "programmable-real-block-sla-db-attestation"',
    ) &&
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
const EXACT_MANUAL_VERCEL_PRODUCTION_METADATA =
  'vercel env ls production --format json --token="$VERCEL_TOKEN" |';
const EXACT_MANUAL_GMGN_REQUIREMENT_EQUALITY =
  'test "$REQUIRE_GMGN_MARKET" = "$STAGED_REQUIRE_GMGN_MARKET"';
const EXACT_REAL_BLOCK_SLA_OUTPUT =
  "/secure/cutover/real-block-sla-db-attestation.json";
const MANUAL_PROMOTION_SEQUENCE = Object.freeze([
  "npm run perf:read-model:real-block-sla-operator --",
  "npm run perf:read-model:real-block-sla --",
  EXACT_MANUAL_VERCEL_PRODUCTION_METADATA,
  "node scripts/bind-vercel-sensitive-production-metadata.mjs",
  "node scripts/resolve-gmgn-production-requirement.mjs",
  EXACT_MANUAL_GMGN_REQUIREMENT_EQUALITY,
  "npm run perf:read-model:staged-deployment --",
  EXACT_MANUAL_VERCEL_PROMOTION,
  "npm run perf:read-model:post-promotion --",
  '--require-gmgn-market "$REQUIRE_GMGN_MARKET"',
]);

function manualPromotionSequenceIsFailClosed(source) {
  if (typeof source !== "string") return false;
  let inShellFence = false;
  let currentShellFence = [];
  const shellFences = [];
  const shellCommands = [];
  for (const sourceLine of source.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (line === "```sh" || line === "```bash") {
      inShellFence = true;
      currentShellFence = [];
      continue;
    }
    if (line.startsWith("```")) {
      if (inShellFence) shellFences.push(currentShellFence);
      inShellFence = false;
      continue;
    }
    if (inShellFence && line.length > 0) {
      currentShellFence.push(line);
      shellCommands.push(line);
    }
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
    /\bvercel\s+promote(?:\s|$)/u.test(line),
  );
  const activeProductionMetadataListings = shellCommands.filter((line) =>
    /\bvercel\s+env\s+ls\s+production(?:\s|$)/u.test(line),
  );
  const activeRequirementEqualities = shellCommands.filter((line) =>
    line.startsWith(EXACT_MANUAL_GMGN_REQUIREMENT_EQUALITY),
  );
  const promotionFence = shellFences.find((lines) =>
    lines.includes(EXACT_MANUAL_VERCEL_PROMOTION),
  );
  const strictShellIndex = promotionFence?.indexOf("set -euo pipefail") ?? -1;
  const metadataIndex =
    promotionFence?.indexOf(EXACT_MANUAL_VERCEL_PRODUCTION_METADATA) ?? -1;
  return (
    activePromotionCommands.length === 1 &&
    activePromotionCommands[0] === EXACT_MANUAL_VERCEL_PROMOTION &&
    activeProductionMetadataListings.length === 1 &&
    activeProductionMetadataListings[0] ===
      EXACT_MANUAL_VERCEL_PRODUCTION_METADATA &&
    activeRequirementEqualities.length === 1 &&
    activeRequirementEqualities[0] === EXACT_MANUAL_GMGN_REQUIREMENT_EQUALITY &&
    strictShellIndex >= 0 &&
    strictShellIndex < metadataIndex &&
    includesExactLineSequence(promotionFence?.join("\n") ?? "", [
      EXACT_MANUAL_VERCEL_PRODUCTION_METADATA,
      "node scripts/bind-vercel-sensitive-production-metadata.mjs \\",
      '--metadata-file "$PRE_PROMOTE_GMGN_METADATA_OUTPUT" \\',
      '--vercel-project-id "$VERCEL_PROJECT_ID"',
    ]) &&
    includesExactLineSequence(promotionFence?.join("\n") ?? "", [
      'case "${STAGED_REQUIRE_GMGN_MARKET:-}" in',
      "true|false) ;;",
      '*) echo "The staged GMGN market requirement is missing or invalid" >&2; exit 1 ;;',
      "esac",
      "readonly STAGED_REQUIRE_GMGN_MARKET",
    ]) &&
    includesExactLineSequence(promotionFence?.join("\n") ?? "", [
      'REQUIRE_GMGN_MARKET="$(',
      "node scripts/resolve-gmgn-production-requirement.mjs \\",
      '--metadata-file "$PRE_PROMOTE_GMGN_METADATA_OUTPUT" \\',
      '--vercel-project-id "$VERCEL_PROJECT_ID"',
      ')"',
      "readonly REQUIRE_GMGN_MARKET",
    ]) &&
    !shellCommands.some((line) => /\bvercel\s+pull(?:\s|$)/u.test(line))
  );
}

const EXACT_MANUAL_VERCEL_ROLLBACK =
  'vercel rollback "$PREVIOUS_DEPLOYMENT_ID" --yes --token="$VERCEL_TOKEN"';

function manualRollbackSequenceIsFailClosed(source) {
  if (typeof source !== "string") return false;
  const start = source.indexOf("Use fresh owner-only output paths.");
  const end = source.indexOf("\nThe metadata binder", start);
  if (start < 0 || end <= start) return false;
  const block = source.slice(start, end);
  const bindingCommand = "npm run perf:read-model:production-binding --";
  const firstBinding = block.indexOf(bindingCommand);
  const rollback = block.indexOf(EXACT_MANUAL_VERCEL_ROLLBACK);
  const secondBinding = block.indexOf(bindingCommand, firstBinding + 1);
  const activeRollbackCommands = block
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^vercel rollback(?:\s|$)/u.test(line));
  return (
    firstBinding >= 0 &&
    rollback > firstBinding &&
    secondBinding > rollback &&
    (block.match(/npm run perf:read-model:production-binding --/gu)?.length ??
      0) === 2 &&
    activeRollbackCommands.length === 1 &&
    activeRollbackCommands[0] === EXACT_MANUAL_VERCEL_ROLLBACK &&
    includesEverySourceFragment(block, [
      "set -euo pipefail",
      "umask 077",
      'test ! -e "$UNCERTAIN_PRODUCTION_BINDING_OUTPUT"',
      '--expected-deployment-id "$STAGED_DEPLOYMENT_ID"',
      '--expected-git-head "$GITHUB_SHA"',
      '--github-output "$UNCERTAIN_PRODUCTION_BINDING_OUTPUT"',
      'grep -Fx "deployment_id=$STAGED_DEPLOYMENT_ID"',
      'grep -Fx "git_head=$GITHUB_SHA"',
      EXACT_MANUAL_VERCEL_ROLLBACK,
      'test ! -e "$ROLLBACK_PRODUCTION_BINDING_OUTPUT"',
      '--expected-deployment-id "$PREVIOUS_DEPLOYMENT_ID"',
      '--expected-git-head "$PREVIOUS_GIT_HEAD"',
      '--github-output "$ROLLBACK_PRODUCTION_BINDING_OUTPUT"',
      'grep -Fx "deployment_id=$PREVIOUS_DEPLOYMENT_ID"',
      'grep -Fx "deployment_url=$PREVIOUS_DEPLOYMENT_URL"',
      'grep -Fx "git_head=$PREVIOUS_GIT_HEAD"',
      "do not run `vercel rollback`",
    ])
  );
}

function retiredCandidateCutoverIsFailClosed(input) {
  return (
    input.productionRunbook.includes(
      "# Historical candidate cutover retired",
    ) &&
    input.productionRunbook.includes(
      "This document no longer authorizes a production cutover.",
    ) &&
    input.productionRunbook.includes("historical evidence, not current") &&
    !input.productionRunbook.includes("```sh") &&
    !input.productionRunbook.includes("vercel promote") &&
    !input.productionRunbook.includes("bootstrap-plan") &&
    input.envioRunbook.includes("# Historical Envio candidate record") &&
    input.envioRunbook.includes("not a current deployment, promotion") &&
    input.envioRunbook.includes("must not be rebound") &&
    !input.envioRunbook.includes("```") &&
    !input.envioRunbook.includes("envio-cloud") &&
    input.runtimeBinding.includes('mode: "release"') &&
    input.runtimeBinding.includes("production-92f6373") &&
    input.runtimeBinding.includes("f6714ef") &&
    input.runtimeBinding.includes(
      "retired-candidate-projector-runtime-binding",
    ) &&
    !input.runtimeBinding.includes("candidate-backfill") &&
    !input.runtimeBinding.includes("production-7f24e63") &&
    !input.runtimeBinding.includes("d7a39a2") &&
    input.cutoverOperator.includes("No mutation command is available") &&
    input.cutoverOperator.includes("historical candidate cutover is retired") &&
    input.cutoverRuntime.includes("historical candidate cutover is retired") &&
    !input.cutoverRuntime.includes("PROGRAMMABLE_") &&
    input.bootstrapRuntime.includes(
      "historical candidate bootstrap is retired",
    ) &&
    !input.bootstrapRuntime.includes("PROGRAMMABLE_") &&
    input.packageJson?.scripts?.["test:retired-read-model-cutover"] ===
      "node --test scripts/data-pipeline/cutover-operator.test.mjs scripts/data-pipeline/cutover-runtime.test.mjs scripts/data-pipeline/hosted-db-bootstrap.test.mjs" &&
    input.packageJson?.scripts?.test?.includes(
      "npm run test:retired-read-model-cutover",
    ) === true &&
    input.packageJson?.scripts?.["test:interface:ci"]?.includes(
      "npm run test:retired-read-model-cutover",
    ) === true
  );
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
      source.includes(
        "safe-head fingerprint replay conflicts with stored evidence",
      ) &&
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
      source.includes(
        "block-evidence fingerprint replay conflicts with stored evidence",
      ) &&
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
      source.includes(
        "programmable_private.assert_caller('programmable_projector')",
      ) &&
      /grant execute[\s\S]*to programmable_projector/iu.test(source)
    );
  }
  if (id === "candidate-promoted-gate") {
    return (
      source.includes("verify_candidate_database_promoted_v1") &&
      source.includes("envio:production-7f24e63") &&
      source.includes(
        "programmable_private.assert_caller('programmable_projector')",
      ) &&
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
      /validate constraint candidate_database_control_product_binding/iu.test(
        source,
      )
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
  const postPromotionContract = operations?.postPromotion;
  const customLaunchReconciler = operations?.customLaunchReconciler;
  const routerLaunchRefresher = operations?.routerLaunchRefresher;
  const unscheduled = Array.isArray(operations?.unscheduled)
    ? operations.unscheduled
    : [];
  const approvedCrons = new Map([
    [
      APPROVED_OPERATIONS.customLaunchReconciler.path,
      APPROVED_OPERATIONS.customLaunchReconciler.schedule,
    ],
    [
      APPROVED_OPERATIONS.routerLaunchRefresher.path,
      APPROVED_OPERATIONS.routerLaunchRefresher.schedule,
    ],
    ...APPROVED_OPERATIONS.workers.map((worker) => [
      worker.path,
      worker.schedule,
    ]),
    ...APPROVED_OPERATIONS.independentCrons.map((cron) => [
      cron.path,
      cron.schedule,
    ]),
  ]);

  check(
    "ops-config-schema",
    operations?.schemaVersion === 1 &&
      exactJson(operations?.legacyIndexer, APPROVED_OPERATIONS.legacyIndexer) &&
      exactJson(
        customLaunchReconciler,
        APPROVED_OPERATIONS.customLaunchReconciler,
      ) &&
      exactJson(
        routerLaunchRefresher,
        APPROVED_OPERATIONS.routerLaunchRefresher,
      ) &&
      exactJson(workers, APPROVED_OPERATIONS.workers) &&
      exactJson(eventTriggers, APPROVED_OPERATIONS.eventTriggers) &&
      exactJson(releaseGates, APPROVED_OPERATIONS.releaseGates) &&
      exactJson(postPromotionContract, APPROVED_OPERATIONS.postPromotion),
    "the manifest exactly binds the reviewed operations and the public Website provider split",
  );
  const customReconciler = APPROVED_OPERATIONS.customLaunchReconciler;
  const customReconcilerRoute = source(customReconciler.route.path);
  const customReconcilerRuntime = source(customReconciler.runtime.path);
  check(
    "ops-custom-launch-reconciler-schedule",
    crons?.get(customReconciler.path) === customReconciler.schedule,
    "Custom Launch V2 reconciliation has its fixed production schedule",
  );
  check(
    "ops-custom-launch-reconciler-source-digests",
    [
      customReconciler.route,
      customReconciler.runtime,
      customReconciler.store,
      customReconciler.registryReader,
      customReconciler.migration,
    ].every((binding) =>
      sourceBindingMatches(source, binding, expectedSha256Overrides),
    ),
    "Custom Launch V2 reconciler is byte-bound to route, runtime, store, Registry reader and migration",
  );
  check(
    "ops-custom-launch-reconciler-route-auth",
    customReconcilerRoute.includes(
      `authorized(request.headers, process.env.${customReconciler.authEnvironment})`,
    ) &&
      /Buffer\.byteLength\(expectedValue,\s*["']utf8["']\)\s*<\s*32/u.test(
        customReconcilerRoute,
      ) &&
      /Buffer\.byteLength\(expectedValue,\s*["']utf8["']\)\s*>\s*1_024/u.test(
        customReconcilerRoute,
      ) &&
      /timingSafeEqual\(expected,\s*actual\)/u.test(customReconcilerRoute) &&
      /response\(401,\s*["']unauthorized["']\)/u.test(customReconcilerRoute) &&
      /response\(503,\s*["']reconciliation_unavailable["']\)/u.test(
        customReconcilerRoute,
      ) &&
      /["']cache-control["']:\s*["']no-store["']/u.test(customReconcilerRoute),
    "Custom Launch V2 cron requires the bounded timing-safe cron secret",
  );
  check(
    "ops-custom-launch-reconciler-freshness",
    /GENERIC_LAUNCH_LIFECYCLE_MAXIMUM_AGE_MS\s*=\s*300_000/u.test(
      customReconcilerRuntime,
    ) &&
      /GENERIC_LAUNCH_LIFECYCLE_REFRESH_AFTER_MS\s*=\s*60_000/u.test(
        customReconcilerRuntime,
      ) &&
      /GENERIC_LAUNCH_RECONCILIATION_LEASE_MS\s*=\s*55_000/u.test(
        customReconcilerRuntime,
      ) &&
      /GENERIC_LAUNCH_RECONCILIATION_CONCURRENCY\s*=\s*8/u.test(
        customReconcilerRuntime,
      ) &&
      customReconciler.maximumLifecycleAgeMs === 300_000 &&
      customReconciler.refreshAfterMs === 60_000 &&
      customReconciler.leaseMs === 55_000 &&
      customReconciler.maximumApprovalInventory === 48 &&
      customReconciler.concurrency === 8 &&
      customReconciler.maximumInitialLogBlocks === 20_000 &&
      customReconciler.maximumConcurrentLogRequests === 24 &&
      /MAXIMUM_INITIAL_LOG_BLOCKS\s*=\s*20_000n/u.test(
        source(customReconciler.registryReader.path),
      ) &&
      /MAXIMUM_CONCURRENT_LOG_REQUESTS\s*=\s*24/u.test(
        source(customReconciler.registryReader.path),
      ) &&
      customReconcilerRoute.includes(`limit: ${customReconciler.batchLimit}`),
    "Custom Launch V2 public reads fail closed on the reviewed lifecycle age and bounded sweep",
  );
  const routerRefresher = APPROVED_OPERATIONS.routerLaunchRefresher;
  const routerRefresherRoute = source(routerRefresher.route.path);
  const routerRefresherRuntime = source(routerRefresher.runtime.path);
  const routerRefresherReader = source(routerRefresher.routerReader.path);
  check(
    "ops-router-launch-refresher-schedule",
    crons?.get(routerRefresher.path) === routerRefresher.schedule,
    "the confirmed Launch Stamp Router registry refreshes every minute",
  );
  check(
    "ops-router-launch-refresher-source-digests",
    [
      routerRefresher.route,
      routerRefresher.runtime,
      routerRefresher.store,
      routerRefresher.routerReader,
      routerRefresher.publicSnapshot,
    ].every((binding) =>
      sourceBindingMatches(source, binding, expectedSha256Overrides),
    ),
    "the Router refresh is byte-bound to its route, runtime, durable store, canonical reader and public snapshot",
  );
  check(
    "ops-router-launch-refresher-route-auth",
    routeIsAuthenticatedAndFailClosed(routerRefresherRoute),
    "the Router refresh requires the bounded timing-safe cron secret and fails closed",
  );
  check(
    "ops-router-launch-refresher-execution",
    routerRefresherRoute.includes(
      `export const maxDuration = ${routerRefresher.maxDurationSeconds};`,
    ) &&
      routerRefresherRoute.includes("forcePersist: true") &&
      routerRefresherRoute.includes("includeLatest: false") &&
      routerRefresherRoute.includes("requirePersistence: true") &&
      routerRefresherRoute.includes(
        "persistRouterCustomIdentitySnapshotFromSourceV1",
      ) &&
      routerRefresherRoute.includes(
        "revalidateTag(ALCHEMY_EXPLORE_CACHE_TAG, { expire: 0 })",
      ) &&
      routerRefresherRuntime.includes(
        'const confirmed = hasDurableClassicBase\n    ? await advanceExploreLaunchDiscovery(\n      deployment,\n      cursorModel,\n      "confirmed",\n    )\n    : cursorModel;',
      ) &&
      routerRefresherRuntime.includes("await writeAlchemyLaunchRegistry(") &&
      routerRefresherRuntime.includes(
        "if (options.requirePersistence) throw error",
      ) &&
      routerRefresherReader.includes(
        `LAUNCH_STAMP_FINALITY_CONFIRMATIONS = ${routerRefresher.finalityConfirmations}n`,
      ) &&
      routerRefresher.maximumCatchUpBlocks === 50_000 &&
      routerRefresherReader.includes("MAXIMUM_CATCH_UP_BLOCKS = 50_000n"),
    "the Router refresh persists only confirmed canonical evidence before invalidating Explore",
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
  for (const approvedCron of APPROVED_OPERATIONS.independentCrons) {
    const route = source(approvedCron.route.path);
    const auth = approvedCron.auth ? source(approvedCron.auth.path) : "";
    const runtime = source(approvedCron.runtime.path);
    check(
      `ops-${approvedCron.id}-schedule`,
      crons?.get(approvedCron.path) === approvedCron.schedule,
      `${approvedCron.id} has its independently fixed production schedule`,
    );
    check(
      `ops-${approvedCron.id}-source-digests`,
      sourceBindingMatches(
        source,
        approvedCron.route,
        expectedSha256Overrides,
      ) &&
        (!approvedCron.auth ||
          sourceBindingMatches(
            source,
            approvedCron.auth,
            expectedSha256Overrides,
          )) &&
        sourceBindingMatches(
          source,
          approvedCron.runtime,
          expectedSha256Overrides,
        ) &&
        (approvedCron.dependencies ?? []).every((binding) =>
          sourceBindingMatches(source, binding, expectedSha256Overrides),
        ) &&
        sourceBindingMatches(
          source,
          approvedCron.policy,
          expectedSha256Overrides,
        ),
      `${approvedCron.id} route, runtime and policy match reviewed bytes`,
    );
    check(
      `ops-${approvedCron.id}-route-auth`,
      routeIsAuthenticatedAndFailClosed(`${route}\n${auth}`),
      `${approvedCron.id} requires the bounded timing-safe cron secret and fails closed`,
    );
    check(
      `ops-${approvedCron.id}-activation`,
      runtime.includes(`env.${approvedCron.activationEnvironment}`) &&
        runtime.includes(
          `env.${approvedCron.activationEnvironment} !== "true"`,
        ) &&
        exactFalseEnvironmentKey(
          source(".env.example"),
          approvedCron.activationEnvironment,
        ),
      `${approvedCron.id} is disabled by default behind one server-only activation flag`,
    );
  }
  check(
    "ops-legacy-cron-disabled",
    !crons?.has(APPROVED_OPERATIONS.legacyIndexer.path) &&
      sha256(source(APPROVED_OPERATIONS.legacyIndexer.route)) ===
        expectedDigest(
          APPROVED_OPERATIONS.legacyIndexer.route,
          APPROVED_OPERATIONS.legacyIndexer.sha256,
          expectedSha256Overrides,
        ),
    "the legacy durable route remains byte-bound but has no production schedule",
  );
  const boundedRefresh = operations?.legacyIndexer?.boundedRefresh;
  const legacyRouteSource = source(APPROVED_OPERATIONS.legacyIndexer.route);
  const refreshRuntimeSource = source(boundedRefresh?.runtime?.path);
  const parallelReadsSource = source(boundedRefresh?.dependencies?.[0]?.path);
  const historicalRpcSource = source(boundedRefresh?.dependencies?.[1]?.path);
  const persistentCacheSource = source(boundedRefresh?.dependencies?.[2]?.path);
  const releaseRuntimes = boundedRefresh?.releaseRuntimes;
  const classicV3RefreshSource = source(releaseRuntimes?.[0]?.path);
  const stockPairedRefreshSource = source(releaseRuntimes?.[1]?.path);
  const hasAdaptiveCompleteRangeScan = (runtimeSource) =>
    runtimeSource?.includes("allSettledOrThrow([") &&
    runtimeSource?.includes("const MINIMUM_LOG_BLOCK_RANGE = 1n;") &&
    runtimeSource?.includes("const MINIMUM_RANGE_TRANSIENT_RETRIES = 2;") &&
    runtimeSource?.includes("transientRetries < transientRetryLimit") &&
    runtimeSource?.includes("error instanceof TimeoutError") &&
    runtimeSource?.includes("error instanceof LimitExceededRpcError") &&
    runtimeSource?.includes("error instanceof HttpRequestError") &&
    runtimeSource?.includes("error instanceof ResponseBodyTooLargeError") &&
    runtimeSource?.includes("isPersistentCacheRangeLimitError(error)") &&
    runtimeSource?.includes(
      "Persistent RPC cache log segment exceeds \\d+ bytes",
    ) &&
    runtimeSource?.includes("logBlockRange > MINIMUM_LOG_BLOCK_RANGE") &&
    runtimeSource?.includes("logBlockRange * 2n") &&
    runtimeSource?.includes("continue;");
  check(
    "ops-legacy-bounded-refresh",
    exactJson(
      boundedRefresh,
      APPROVED_OPERATIONS.legacyIndexer.boundedRefresh,
    ) &&
      sourceBindingMatches(
        source,
        boundedRefresh?.runtime,
        expectedSha256Overrides,
      ) &&
      boundedRefresh?.dependencies?.length === 3 &&
      sourceBindingMatches(
        source,
        boundedRefresh.dependencies[0],
        expectedSha256Overrides,
      ) &&
      sourceBindingMatches(
        source,
        boundedRefresh.dependencies[1],
        expectedSha256Overrides,
      ) &&
      sourceBindingMatches(
        source,
        boundedRefresh.dependencies[2],
        expectedSha256Overrides,
      ) &&
      refreshRuntimeSource?.includes(
        'import { settleParallelReadsInOrder } from "./parallel-reads";',
      ) &&
      refreshRuntimeSource?.includes("await settleParallelReadsInOrder([") &&
      parallelReadsSource?.includes("Promise.allSettled(") &&
      parallelReadsSource?.includes("for (const result of results)") &&
      legacyRouteSource?.includes(
        "historicalReadOnchainDeployment(deployment)",
      ) &&
      historicalRpcSource?.includes(
        "productionRecoveryMainnetRpcPair(environment)",
      ) &&
      historicalRpcSource?.includes("primary: binding.primary.url") &&
      historicalRpcSource?.includes("secondary: binding.secondary.url") &&
      historicalRpcSource?.includes('primary?.vendorGroup !== "tenderly"') &&
      historicalRpcSource?.includes('secondary?.vendorGroup !== "quicknode"') &&
      historicalRpcSource?.includes(
        "const RECOVERY_MAX_LOG_BLOCK_RANGE = 500n;",
      ) &&
      historicalRpcSource?.includes(
        "baseDeployment.logBlockRange < RECOVERY_MAX_LOG_BLOCK_RANGE",
      ) &&
      historicalRpcSource?.includes(
        "primary.endpointCommitment !== binding.primary.endpointCommitment",
      ) &&
      persistentCacheSource?.includes(
        'const CACHE_SCHEMA = "programmable-rpc-log-cursor-v4";',
      ) &&
      persistentCacheSource?.includes("maxCursorSegments: 16,") &&
      persistentCacheSource?.includes("maxSegmentReadsPerOperation: 16,") &&
      !persistentCacheSource?.includes(
        'const CACHE_SCHEMA = "programmable-rpc-log-cursor-v3";',
      ) &&
      persistentCacheSource?.includes(
        "Persistent RPC cache path uses a retired namespace",
      ) &&
      persistentCacheSource?.includes("previousIntegrityCommitId") &&
      persistentCacheSource?.includes('pointedMarker.status !== "committed"') &&
      persistentCacheSource?.includes(
        "Persistent RPC providers do not cover the same event streams",
      ) &&
      persistentCacheSource?.includes(
        "Persistent RPC checkpoint cursors do not share its boundary",
      ) &&
      persistentCacheSource?.includes("expectedProviderCount") &&
      persistentCacheSource?.includes("expectedStreamsPerProvider") &&
      persistentCacheSource?.includes("requireCheckpointWindow") &&
      persistentCacheSource?.includes("requiredInitialFromBlock") &&
      persistentCacheSource?.includes("requireContiguousCheckpointWindow") &&
      persistentCacheSource?.includes("allowCheckpointWindowExtension") &&
      persistentCacheSource?.includes("signal?: AbortSignal") &&
      persistentCacheSource?.includes("input.signal?.throwIfAborted()") &&
      persistentCacheSource?.includes(
        "bindPersistentRpcIntegrityCheckpointWindow",
      ) &&
      persistentCacheSource?.indexOf('scope.commitId,\n          "pending",') <
        persistentCacheSource?.indexOf("const published =") &&
      persistentCacheSource?.indexOf("const published =") <
        persistentCacheSource?.indexOf(
          'scope.commitId,\n          "committed",',
        ) &&
      Array.isArray(releaseRuntimes) &&
      releaseRuntimes.length === 2 &&
      releaseRuntimes[0]?.release === "classic-v3" &&
      releaseRuntimes[0]?.eventFiltersPerRange === 2 &&
      sourceBindingMatches(
        source,
        releaseRuntimes[0],
        expectedSha256Overrides,
      ) &&
      releaseRuntimes[1]?.release === "stock-paired-v1-v3" &&
      releaseRuntimes[1]?.eventFiltersPerRange === 3 &&
      sourceBindingMatches(
        source,
        releaseRuntimes[1],
        expectedSha256Overrides,
      ) &&
      boundedRefresh?.eventFiltersPerRange === 2 &&
      boundedRefresh?.providerPasses === 2 &&
      boundedRefresh?.classicPrewarmStepCount === 32 &&
      boundedRefresh?.prewarmProviderConcurrency === 1 &&
      boundedRefresh?.prewarmRequestDeadlineMs === 250_000 &&
      legacyRouteSource?.includes(
        "const INDEX_REFRESH_DEADLINE_MS = 270_000;",
      ) &&
      legacyRouteSource?.includes(
        "const INDEX_PREWARM_DEADLINE_MS = 250_000;",
      ) &&
      legacyRouteSource?.includes("const CLASSIC_PREWARM_STEP_COUNT = 32;") &&
      legacyRouteSource?.includes("withIndexPrewarmDeadline((signal) =>") &&
      legacyRouteSource?.includes(
        "controller.abort(new IndexRefreshDeadlineError())",
      ) &&
      legacyRouteSource?.includes(
        "const output = await read(controller.signal)",
      ) &&
      legacyRouteSource?.indexOf("if (!isAuthorized(request))") <
        legacyRouteSource?.indexOf("const phaseValues =") &&
      legacyRouteSource?.includes("withIndexRefreshDeadline(() =>") &&
      !legacyRouteSource?.includes("INDEX_READ_ATTEMPTS") &&
      hasAdaptiveCompleteRangeScan(refreshRuntimeSource) &&
      refreshRuntimeSource?.includes("events: CLASSIC_LAUNCHER_EVENTS") &&
      refreshRuntimeSource?.includes("events: CLASSIC_FEE_HOOK_EVENTS") &&
      refreshRuntimeSource?.includes("assertCanonicalClassicEventSource(") &&
      refreshRuntimeSource?.includes(
        "const indexedEventSets = await mapInBatches(",
      ) &&
      refreshRuntimeSource?.includes(
        "clients.map((candidate, providerIndex) =>",
      ) &&
      refreshRuntimeSource?.includes(
        "persistentRpcProviderId(providerEndpoints[providerIndex])",
      ) &&
      refreshRuntimeSource?.includes("fetchOptions: { signal }") &&
      refreshRuntimeSource?.includes("coverage * BigInt(step)") &&
      refreshRuntimeSource?.includes("stepCount: number") &&
      refreshRuntimeSource?.includes("expectedCursorBindings: 2") &&
      hasAdaptiveCompleteRangeScan(classicV3RefreshSource) &&
      classicV3RefreshSource?.includes(
        "assertCanonicalClassicV3EventSource(",
      ) &&
      classicV3RefreshSource?.includes("const sets = await mapInBatches(") &&
      classicV3RefreshSource?.includes("readClassicV3EventsQuorum(") &&
      classicV3RefreshSource?.includes('"classic-v3-events-v2"') &&
      classicV3RefreshSource?.includes("clients.length !== 2") &&
      classicV3RefreshSource?.includes(
        "createEnvironmentPersistentRpcCacheStore()",
      ) &&
      classicV3RefreshSource?.includes(
        "bindPersistentRpcIntegrityCheckpointWindow({",
      ) &&
      classicV3RefreshSource?.includes(
        "expectedCursorBindings: clients.length * 2",
      ) &&
      classicV3RefreshSource?.includes(
        "expectedProviderCount: clients.length",
      ) &&
      classicV3RefreshSource?.includes("expectedStreamsPerProvider: 2") &&
      classicV3RefreshSource?.includes("requireCheckpointWindow: true") &&
      classicV3RefreshSource?.includes(
        "requiredInitialFromBlock: release.startBlock",
      ) &&
      classicV3RefreshSource?.includes(
        "requireContiguousCheckpointWindow: true",
      ) &&
      classicV3RefreshSource?.includes(
        "allowCheckpointWindowExtension: true",
      ) &&
      classicV3RefreshSource?.includes(
        "const MAXIMUM_CHECKPOINT_BLOCK_RANGE = 1_000n",
      ) &&
      classicV3RefreshSource?.includes(
        "config.logBlockRange,\n      MAXIMUM_CHECKPOINT_BLOCK_RANGE",
      ) &&
      classicV3RefreshSource?.includes("eventProvenance") &&
      classicV3RefreshSource?.includes("toEventSelector(launchedEvent)") &&
      classicV3RefreshSource?.includes("toEventSelector(feeEvent)") &&
      classicV3RefreshSource?.includes(
        ".map(persistentRpcProviderId).sort()",
      ) &&
      classicV3RefreshSource?.includes(
        "Independent RPCs disagree on the Classic V3 checkpoint window",
      ) &&
      hasAdaptiveCompleteRangeScan(stockPairedRefreshSource) &&
      stockPairedRefreshSource?.includes("events: STOCK_LAUNCHER_EVENTS") &&
      stockPairedRefreshSource?.includes("assertCanonicalStockEventSource(") &&
      stockPairedRefreshSource?.includes(
        "const eventSets = await mapInBatches(",
      ) &&
      stockPairedRefreshSource?.includes(
        "clients.map((candidate, providerIndex) =>",
      ) &&
      stockPairedRefreshSource?.includes(
        "persistentRpcProviderId(providerEndpoints[providerIndex])",
      ) &&
      stockPairedRefreshSource?.includes("expectedCursorBindings: 3"),
    "all active release scanners use minimal canonical filters, settle complete ranges, adapt exact RPC rejections, compare two serialized provider passes, atomically publish Classic V3 provider-stream checkpoints in a fail-closed v4 namespace and settle registry slices in parallel before deterministic merging and the platform deadline",
  );
  const schedulerWatchdog = operations?.legacyIndexer?.schedulerWatchdog;
  check(
    "ops-legacy-scheduler-watchdog",
    exactJson(
      schedulerWatchdog?.workflow,
      APPROVED_OPERATIONS.legacyIndexer.schedulerWatchdog.workflow,
    ) &&
      sourceBindingMatches(
        source,
        schedulerWatchdog?.workflow,
        expectedSha256Overrides,
      ),
    "the recurring durable refresh remains bound to its reviewed production workflow",
  );
  const closedLegacyAlias = APPROVED_OPERATIONS.legacyIndexer.closedAlias;
  check(
    "ops-legacy-alias-closed",
    !crons?.has(closedLegacyAlias.path) &&
      exactJson(operations?.legacyIndexer?.closedAlias, closedLegacyAlias) &&
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
        sourceBindingMatches(
          source,
          worker?.runtime,
          expectedSha256Overrides,
        ) &&
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
        activationIsExplicitAndSafe(
          runtime,
          approvedWorker.activationEnvironment,
        ),
      `${approvedWorker.id} is false by default and only exact true activates work`,
    );
    const runtimeBinding =
      approvedWorker.id === "source-projector"
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
  const eventTrigger = eventTriggers.find(
    ({ id }) => id === approvedTrigger.id,
  );
  check(
    "ops-quicknode-stream-wake-binding",
    eventTriggers.length === 1 &&
      eventTrigger?.path === approvedTrigger.path &&
      !crons?.has(approvedTrigger.path) &&
      sourceBindingMatches(
        source,
        eventTrigger?.route,
        expectedSha256Overrides,
      ) &&
      sourceBindingMatches(
        source,
        eventTrigger?.verifier,
        expectedSha256Overrides,
      ) &&
      sourceBindingMatches(
        source,
        eventTrigger?.canary,
        expectedSha256Overrides,
      ) &&
      (eventTrigger?.dependencies ?? []).length ===
        (approvedTrigger.dependencies ?? []).length &&
      (approvedTrigger.dependencies ?? []).every(
        (binding, index) =>
          sourceBindingMatches(
            source,
            eventTrigger?.dependencies?.[index],
            expectedSha256Overrides,
          ) && exactJson(binding, eventTrigger?.dependencies?.[index]),
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
        "retired-candidate-projector-runtime-binding",
      ) &&
      source(sourceWorker.dependencies[0]?.path)?.includes('mode: "release"') &&
      !source(sourceWorker.dependencies[0]?.path)?.includes(
        "candidate-backfill",
      ) &&
      sourceWorker?.migrations?.length === 11 &&
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
      ) &&
      source(sourceWorker.migrations[10]?.path)?.includes(
        "rpc_provider_deployment_metadata_production_vendor_v2_check",
      ),
    "the source worker is byte-bound to the current-only runtime selector, historical database fences and provider evidence",
  );
  check(
    "ops-market-projector-migration",
    marketWorker?.migrations?.length === 4 &&
      migrationContract(
        "market-projector",
        source(marketWorker.migrations[0]?.path),
      ) &&
      migrationContract(
        "market-projector-fast-lane",
        source(marketWorker.migrations[1]?.path),
      ) &&
      source(marketWorker.migrations[2]?.path)?.includes(
        "market_projector_health_v1",
      ) &&
      source(marketWorker.migrations[3]?.path)?.includes(
        "rpc_provider_deployment_metadata_production_vendor_v2_check",
      ),
    "the market worker is bound to exact lineage, terminal checkpoint and lease SQL",
  );

  const deployWorkflow =
    source(".github/workflows/deploy-production.yml") ?? "";
  const stagedDeployJobStart = deployWorkflow.indexOf("\n  deploy:\n");
  const stagedDeployJobEnd = deployWorkflow.indexOf(
    "\n  generic-signer-probe-reconcile:\n",
    stagedDeployJobStart,
  );
  const stagedDeployJobBlock =
    stagedDeployJobStart >= 0 && stagedDeployJobEnd > stagedDeployJobStart
      ? deployWorkflow.slice(stagedDeployJobStart, stagedDeployJobEnd)
      : "";
  const verifyWorkflow = source(".github/workflows/verify.yml") ?? "";
  const packageJson = parseJson(source("package.json"));
  const deployPolicy =
    source("scripts/perf/read-model-deploy-policy.mjs") ?? "";
  const vercelSensitiveMetadataBinder =
    source("scripts/bind-vercel-sensitive-production-metadata.mjs") ?? "";
  const gmgnProductionRequirement =
    source("scripts/resolve-gmgn-production-requirement.mjs") ?? "";
  const environmentExample = source(".env.example") ?? "";
  const realBlockSlaOperator =
    source("scripts/perf/read-model-real-block-sla-operator.mjs") ?? "";
  const postPromotion =
    source("scripts/perf/read-model-post-promotion.mjs") ?? "";
  const postPromotionVerifierStart = postPromotion.indexOf(
    "export async function verifyPostPromotion(input) {",
  );
  const postPromotionVerifierEnd = postPromotion.indexOf(
    "async function main()",
    postPromotionVerifierStart,
  );
  const postPromotionVerifierBlock =
    postPromotionVerifierStart >= 0 &&
    postPromotionVerifierEnd > postPromotionVerifierStart
      ? postPromotion.slice(
          postPromotionVerifierStart,
          postPromotionVerifierEnd,
        )
      : "";
  const productionBinding =
    source("scripts/perf/read-model-production-binding.mjs") ?? "";
  const operationsRunbook =
    source("docs/operations/read-model-scheduler-cutover.md") ?? "";
  const productionCutoverRunbook =
    source("docs/data-pipeline/PRODUCTION-CUTOVER-OPERATOR.md") ?? "";
  const envioCandidateRunbook =
    source("docs/data-pipeline/ENVIO-CANDIDATE-RUNBOOK.md") ?? "";
  const candidateRuntimeBinding =
    source("lib/data-pipeline/candidate-projector-runtime-binding.server.ts") ??
    "";
  const cutoverOperator =
    source("scripts/data-pipeline/cutover-operator.mjs") ?? "";
  const cutoverRuntime =
    source("scripts/data-pipeline/cutover-runtime.mjs") ?? "";
  const bootstrapRuntime =
    source("scripts/data-pipeline/hosted-db-bootstrap-runtime.mjs") ?? "";
  const publicExplore = source("app/api/explore/route.ts") ?? "";
  const publicExploreView = source("components/explore-view.tsx") ?? "";
  const publicToken = source("app/api/explore/token/route.ts") ?? "";
  const publicChart = source("app/api/explore/token/chart/route.ts") ?? "";
  const publicTokenAnalytics =
    source("app/api/explore/token/analytics/route.ts") ?? "";
  const routerCustomPublic =
    source("lib/alchemy/router-custom-public.server.ts") ?? "";
  const envioClassicV3Catalog =
    source("lib/market-data/envio-classic-v3-catalog.server.ts") ?? "";
  const envioClassicV4CatalogBinding =
    source("lib/data-pipeline/envio-classic-v4-catalog-binding.server.ts") ??
    "";
  const dexscreenerExplore =
    source("lib/market-data/dexscreener-explore.server.ts") ?? "";
  const dexscreenerShadow =
    source("lib/market-data/dexscreener-shadow.server.ts") ?? "";
  const exploreMarket =
    source("lib/market-data/explore-market.server.ts") ?? "";
  const gmgnMarket = source("lib/market-data/gmgn.server.ts") ?? "";
  const canonicalTokenSupply =
    source("lib/market-data/canonical-token-supply.server.ts") ?? "";
  const gmgnChart = source("lib/market-data/gmgn-chart.server.ts") ?? "";
  const gmgnRuntimeConfig =
    source("lib/market-data/gmgn-runtime-config.server.ts") ?? "";
  const gmgnChartSnapshot =
    source("lib/market-data/gmgn-chart-data-v1.ts") ?? "";
  const marketChartSnapshot = source("lib/market-data/market-data-v1.ts") ?? "";
  const publicOpenApi = source("lib/public-openapi.ts") ?? "";
  const marketChartErrorOpenApiStart = publicOpenApi.indexOf(
    "      MarketChartError: {",
  );
  const marketChartErrorOpenApiEnd = publicOpenApi.indexOf(
    "      TokenChartResponse: {",
    marketChartErrorOpenApiStart,
  );
  const marketChartErrorOpenApi =
    marketChartErrorOpenApiStart >= 0 &&
    marketChartErrorOpenApiEnd > marketChartErrorOpenApiStart
      ? publicOpenApi.slice(
          marketChartErrorOpenApiStart,
          marketChartErrorOpenApiEnd,
        )
      : "";
  const gmgnTokenAnalytics =
    source("lib/market-data/gmgn-token-analytics.server.ts") ?? "";
  const gmgnTokenAnalyticsSnapshot =
    source("lib/market-data/gmgn-token-analytics-v1.ts") ?? "";
  const gmgnDiscovery =
    source("lib/market-data/gmgn-discovery.server.ts") ?? "";
  const gmgnDiscoverySnapshot =
    source("lib/market-data/gmgn-discovery-v1.ts") ?? "";
  const gmgnCanonicalRanking =
    source("lib/market-data/gmgn-canonical-ranking.ts") ?? "";
  const gmgnAdapterSources = new Map([
    ["lib/market-data/gmgn.server.ts", gmgnMarket],
    ["lib/market-data/gmgn-chart.server.ts", gmgnChart],
    ["lib/market-data/gmgn-token-analytics.server.ts", gmgnTokenAnalytics],
    ["lib/market-data/gmgn-discovery.server.ts", gmgnDiscovery],
  ]);
  const gmgnReadOnlyEndpointBoundary =
    exactGmgnReadOnlyEndpointContract(gmgnAdapterSources);
  const gmgnAccountGate =
    source("lib/market-data/gmgn-account-gate.server.ts") ?? "";
  const gmgnMultiflightMigration =
    source(
      "ops/website-projection-target/migrations/0007_gmgn_account_gate_multiflight_v1.sql",
    ) ?? "";
  const exploreMarketCapAuthorityMigration =
    source(
      "ops/website-projection-target/migrations/0008_explore_market_cap_authority_v1.sql",
    ) ?? "";
  const exploreMarketCapAuthorityStore =
    source("lib/market-data/explore-market-cap-authority.server.ts") ?? "";
  const websiteProjectionOperatorCore =
    source("scripts/website-projection-db-operator-core.mjs") ?? "";
  const websiteProjectionPostgres =
    source("scripts/website-projection-db-postgres.mjs") ?? "";
  const websiteProjectionTarget =
    source("lib/server/projection-target/website-target.ts") ?? "";
  const websiteProjectionTargetRunbook =
    source("docs/operations/WEBSITE-PROJECTION-TARGET-V1.md") ?? "";
  const websiteProjectionOperatorRunbook =
    source("docs/operations/WEBSITE-PROJECTION-DATABASE-OPERATOR-V1.md") ?? "";
  const gmgnSnapshot = source("lib/market-data/gmgn-market-data-v1.ts") ?? "";
  const stagedPublicSmokeScript =
    source("scripts/smoke-static-dexscreener-public-apis.mjs") ?? "";
  const operationsHealth = source("app/api/ops/health/route.ts") ?? "";
  const publicCreatorProfile = source("app/api/explore/profile/route.ts") ?? "";
  const publicClassicProfile =
    source("app/api/profile/classic-v3/route.ts") ?? "";
  const publicStockProfile =
    source("app/api/profile/stock-paired/route.ts") ?? "";
  const creatorClaimPrepare =
    source("app/api/explore/profile/claim/route.ts") ?? "";
  const tradePrepare = source("app/api/trade/prepare/route.ts") ?? "";
  const websiteRpcProviders =
    source("lib/onchain/website-rpc-providers.server.ts") ?? "";
  const actionRpcProviders =
    source("lib/server/action-rpc-quorum.server.ts") ?? "";
  const actionRpcIdentity =
    source("lib/server/action-rpc-identity.server.ts") ?? "";
  const primaryRpcLaunchCatalog =
    source("lib/market-data/primary-rpc-launches.server.ts") ?? "";
  const publicWalletRankingStart = publicTokenAnalytics.indexOf(
    "function publicWalletRankingV1(",
  );
  const publicWalletRankingEnd = publicTokenAnalytics.indexOf(
    "\nfunction analyticsResponse(",
    publicWalletRankingStart,
  );
  const publicWalletRankingBlock =
    publicWalletRankingStart >= 0 &&
    publicWalletRankingEnd > publicWalletRankingStart
      ? publicTokenAnalytics.slice(
          publicWalletRankingStart,
          publicWalletRankingEnd,
        )
      : "";
  const analyticsProofReadBoundary =
    exactAnalyticsProofReadBoundary(publicTokenAnalytics);
  const publicWalletProjectionBoundary =
    exactPublicWalletProjection(publicTokenAnalytics);
  const gmgnChartReadStart = publicChart.indexOf(
    "gmgnChart = await readGmgnMarketChartV1({",
  );
  const gmgnChartAcceptanceStart = publicChart.indexOf(
    "isFreshReadyGmgnTokenSeries(",
    gmgnChartReadStart,
  );
  const bitqueryChartFallbackStart = publicChart.indexOf(
    "const bitqueryChart = await readBitqueryMarketChartV1({",
    gmgnChartAcceptanceStart,
  );
  const chartPreferenceStart = publicChart.indexOf(
    "const chart = preferAdmittedGmgnTokenSeriesV1({",
    bitqueryChartFallbackStart,
  );
  const primaryResolverStart = websiteRpcProviders.indexOf(
    "export function productionMainnetRpcPrimary(",
  );
  const primaryResolverEnd = websiteRpcProviders.indexOf(
    "\nexport function ",
    primaryResolverStart + 1,
  );
  const primaryResolver =
    primaryResolverStart >= 0
      ? websiteRpcProviders.slice(
          primaryResolverStart,
          primaryResolverEnd >= 0 ? primaryResolverEnd : undefined,
        )
      : "";
  const classicProfileGetEnd = publicClassicProfile.indexOf(
    "export async function POST",
  );
  const publicClassicProfileGet =
    classicProfileGetEnd >= 0
      ? publicClassicProfile.slice(0, classicProfileGetEnd)
      : "";
  const stockProfileGetEnd = publicStockProfile.indexOf(
    "export async function POST",
  );
  const publicStockProfileGet =
    stockProfileGetEnd >= 0
      ? publicStockProfile.slice(0, stockProfileGetEnd)
      : "";
  const retiredCandidateCutover = Object.freeze({
    productionRunbook: productionCutoverRunbook,
    envioRunbook: envioCandidateRunbook,
    runtimeBinding: candidateRuntimeBinding,
    cutoverOperator,
    cutoverRuntime,
    bootstrapRuntime,
    packageJson,
  });
  check(
    "ops-package-verify-binding",
    packageJson?.scripts?.verify?.includes(
      "npm run perf:read-model:ops-gate",
    ) === true,
    "the canonical local verification command runs the operations source contract",
  );
  check(
    "ops-real-block-sla-package-binding",
    packageJson?.scripts?.["perf:read-model:real-block-sla"] ===
      `node ${approvedRealBlockSla.script.path}`,
    "the immutable real-block SLA verifier has one reviewed operator command",
  );
  check(
    "ops-real-block-sla-operator-binding",
    packageJson?.scripts?.["perf:read-model:real-block-sla-operator"] ===
      "node scripts/perf/read-model-real-block-sla-operator.mjs" &&
      realBlockSlaOperator.includes(
        "REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS = 5 * 60 * 1_000",
      ) &&
      realBlockSlaOperator.includes("body: { armId, challenge }") &&
      realBlockSlaOperator.includes('open(absolutePath, "wx", 0o600)') &&
      realBlockSlaOperator.includes("verifyRealBlockSlaDatabaseAttestation") &&
      realBlockSlaOperator.includes(
        "runtime.repositoryCommit !== input.expectedRepositoryCommit",
      ) &&
      realBlockSlaOperator.includes(
        "runtime.deploymentId !== input.deploymentId",
      ) &&
      realBlockSlaOperator.includes(
        "runtime.deploymentOrigin !== input.targetUrl",
      ) &&
      realBlockSlaOperator.includes("runtime.projectId !== input.projectId") &&
      realBlockSlaOperator.includes("runtime.streamId !== input.streamId") &&
      realBlockSlaOperator.includes("![0, 409, 503].includes(result.status)") &&
      !realBlockSlaOperator.includes('"--probe-token"') &&
      !realBlockSlaOperator.includes('"--automation-bypass-secret"') &&
      operationsRunbook.includes(
        "npm run perf:read-model:real-block-sla-operator --",
      ) &&
      operationsRunbook.includes(`--output ${EXACT_REAL_BLOCK_SLA_OUTPUT}`) &&
      operationsRunbook.includes(`--evidence ${EXACT_REAL_BLOCK_SLA_OUTPUT}`),
    "the operator arms and polls the exact staged deployment before writing one private evidence file",
  );
  check(
    "ops-retired-candidate-cutover",
    retiredCandidateCutoverIsFailClosed(retiredCandidateCutover),
    "the obsolete candidate cutover has no executable production authority",
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
      deployPolicy.includes(
        "wake_canary_required=${result.wakeCanaryRequired}",
      ) &&
      deployPolicy.includes("invalidServerSecretEnvironmentNames"),
    "the stream secret name is documented without a value and is fail-closed in deploy policy",
  );
  const stagedBitquerySmoke = deployWorkflow.indexOf(
    "Smoke staged static identity and Dex public APIs",
  );
  const stagedGmgnRequirement = deployWorkflow.indexOf(
    "Resolve staged GMGN market requirement",
  );
  const stagedGmgnRequirementEnd = deployWorkflow.indexOf(
    "Validate staged read-model release policy",
    stagedGmgnRequirement,
  );
  const stagedGmgnRequirementBlock =
    stagedGmgnRequirement >= 0 &&
    stagedGmgnRequirementEnd > stagedGmgnRequirement
      ? deployWorkflow.slice(stagedGmgnRequirement, stagedGmgnRequirementEnd)
      : "";
  const stagedReadModelPolicy = deployWorkflow.indexOf(
    "Validate staged read-model release policy",
  );
  const stagedReadModelPolicyEnd = deployWorkflow.indexOf(
    "Reject mixed legacy and V3 Custom Launch release authority",
    stagedReadModelPolicy,
  );
  const stagedReadModelPolicyBlock =
    stagedReadModelPolicy >= 0 &&
    stagedReadModelPolicyEnd > stagedReadModelPolicy
      ? deployWorkflow.slice(stagedReadModelPolicy, stagedReadModelPolicyEnd)
      : "";
  const stagedCatalogProbe = deployWorkflow.indexOf(
    "Probe exact staged Envio Classic V3 catalog",
  );
  const stagedCatalogProbeEnd = deployWorkflow.indexOf(
    "Prove clean candidate carries no Generic signer probe authority",
    stagedCatalogProbe,
  );
  const stagedCatalogProbeBlock =
    stagedCatalogProbe >= 0 && stagedCatalogProbeEnd > stagedCatalogProbe
      ? deployWorkflow.slice(stagedCatalogProbe, stagedCatalogProbeEnd)
      : "";
  const stagedTokenImageProbe = deployWorkflow.indexOf(
    "      - name: Probe staged token image runtime without writes",
  );
  const stagedTokenImageProbeEnd = deployWorkflow.indexOf(
    "      - name: Probe exact staged Custom Launch V3 release",
  );
  const stagedTokenImageProbeBlock =
    stagedTokenImageProbe >= 0 &&
    stagedTokenImageProbeEnd > stagedTokenImageProbe
      ? deployWorkflow.slice(stagedTokenImageProbe, stagedTokenImageProbeEnd)
      : "";
  const stagedCandidateDeploy = deployWorkflow.indexOf(
    "Stage production source build without assigning domains",
  );
  const stagedCandidateDeployEnd = deployWorkflow.indexOf(
    "Resolve exact staged deployment",
    stagedCandidateDeploy,
  );
  const stagedCandidateDeployBlock =
    stagedCandidateDeploy >= 0 &&
    stagedCandidateDeployEnd > stagedCandidateDeploy
      ? deployWorkflow.slice(stagedCandidateDeploy, stagedCandidateDeployEnd)
      : "";
  const stagedWakeCanary = deployWorkflow.indexOf(
    "Verify staged QuickNode wake authentication",
  );
  const stagedWakeCanaryEnd = deployWorkflow.indexOf(
    "Probe staged token image runtime without writes",
    stagedWakeCanary,
  );
  const stagedWakeCanaryBlock =
    stagedWakeCanary >= 0 && stagedWakeCanaryEnd > stagedWakeCanary
      ? deployWorkflow.slice(stagedWakeCanary, stagedWakeCanaryEnd)
      : "";
  const stagedBitquerySmokeEnd = deployWorkflow.indexOf(
    "Reverify staged candidate binding",
    stagedBitquerySmoke,
  );
  const stagedBitquerySmokeBlock =
    stagedBitquerySmoke >= 0 && stagedBitquerySmokeEnd > stagedBitquerySmoke
      ? deployWorkflow.slice(stagedBitquerySmoke, stagedBitquerySmokeEnd)
      : "";
  const stagedProviderHandoff = includesEverySourceFragment(deployWorkflow, [
    "GMGN_MARKET_REQUIRED: $\{{ steps.gmgn-market-requirement.outputs.require_gmgn_market }}",
    "gmgn_account_gate_mode: $\{{ steps.public-provider-smoke.outputs.gmgn_account_gate_mode }}",
    "GMGN_ACCOUNT_GATE_MODE: $\{{ steps.public-provider-smoke.outputs.gmgn_account_gate_mode }}",
    "gmgn_requests_per_second: $\{{ steps.public-provider-smoke.outputs.gmgn_requests_per_second }}",
    "GMGN_REQUESTS_PER_SECOND: $\{{ steps.public-provider-smoke.outputs.gmgn_requests_per_second }}",
    "market_cap_desc_source: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_source }}",
    "market_cap_desc_gmgn_status: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_gmgn_status }}",
    "market_cap_desc_matched_count: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_matched_count }}",
    "market_cap_desc_ranking_commitment: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_ranking_commitment }}",
    "market_cap_asc_source: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_source }}",
    "market_cap_asc_gmgn_status: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_gmgn_status }}",
    "market_cap_asc_matched_count: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_matched_count }}",
    "market_cap_asc_ranking_commitment: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_ranking_commitment }}",
    "GMGN account gate mode:",
    "MARKET_PROVIDER: $\{{ steps.public-provider-smoke.outputs.market_provider }}",
    "discovery_status: $\{{ steps.public-provider-smoke.outputs.discovery_status }}",
    "discovery_matched_count: $\{{ steps.public-provider-smoke.outputs.discovery_matched_count }}",
    "discovery_ranking_commitment: $\{{ steps.public-provider-smoke.outputs.discovery_ranking_commitment }}",
    "discovery_consistency: $\{{ steps.public-provider-smoke.outputs.discovery_consistency }}",
    "search_status: $\{{ steps.public-provider-smoke.outputs.search_status }}",
    "search_matched_count: $\{{ steps.public-provider-smoke.outputs.search_matched_count }}",
    "search_ranking_commitment: $\{{ steps.public-provider-smoke.outputs.search_ranking_commitment }}",
    "analytics_summary_status: $\{{ steps.public-provider-smoke.outputs.analytics_summary_status }}",
    "analytics_holders_status: $\{{ steps.public-provider-smoke.outputs.analytics_holders_status }}",
    "analytics_traders_status: $\{{ steps.public-provider-smoke.outputs.analytics_traders_status }}",
    "market_cap_desc_source: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_source }}",
    "market_cap_desc_status: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_status }}",
    "market_cap_desc_gmgn_status: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_gmgn_status }}",
    "market_cap_desc_matched_count: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_matched_count }}",
    "market_cap_desc_ranking_commitment: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_ranking_commitment }}",
    "market_cap_asc_source: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_source }}",
    "market_cap_asc_status: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_status }}",
    "market_cap_asc_gmgn_status: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_gmgn_status }}",
    "market_cap_asc_matched_count: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_matched_count }}",
    "market_cap_asc_ranking_commitment: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_ranking_commitment }}",
    "MARKET_READ_STATUS: $\{{ steps.public-provider-smoke.outputs.market_read_status }}",
    "DETAIL_MARKET_PROVIDER: $\{{ steps.public-provider-smoke.outputs.detail_market_provider }}",
    "DETAIL_SMOKE_STATUS: $\{{ steps.public-provider-smoke.outputs.detail_status }}",
    "DISCOVERY_STATUS: $\{{ steps.public-provider-smoke.outputs.discovery_status }}",
    "DISCOVERY_MATCHED_COUNT: $\{{ steps.public-provider-smoke.outputs.discovery_matched_count }}",
    "DISCOVERY_RANKING_COMMITMENT: $\{{ steps.public-provider-smoke.outputs.discovery_ranking_commitment }}",
    "DISCOVERY_CONSISTENCY: $\{{ steps.public-provider-smoke.outputs.discovery_consistency }}",
    "SEARCH_STATUS: $\{{ steps.public-provider-smoke.outputs.search_status }}",
    "SEARCH_MATCHED_COUNT: $\{{ steps.public-provider-smoke.outputs.search_matched_count }}",
    "SEARCH_RANKING_COMMITMENT: $\{{ steps.public-provider-smoke.outputs.search_ranking_commitment }}",
    "ANALYTICS_SUMMARY_STATUS: $\{{ steps.public-provider-smoke.outputs.analytics_summary_status }}",
    "ANALYTICS_HOLDERS_STATUS: $\{{ steps.public-provider-smoke.outputs.analytics_holders_status }}",
    "ANALYTICS_TRADERS_STATUS: $\{{ steps.public-provider-smoke.outputs.analytics_traders_status }}",
    "MARKET_CAP_DESC_SOURCE: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_source }}",
    "MARKET_CAP_DESC_STATUS: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_status }}",
    "MARKET_CAP_DESC_GMGN_STATUS: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_gmgn_status }}",
    "MARKET_CAP_DESC_MATCHED_COUNT: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_matched_count }}",
    "MARKET_CAP_DESC_GMGN_HYDRATION_QUALIFIED_COUNT: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_gmgn_hydration_qualified_count }}",
    "market_cap_desc_gmgn_hydration_qualified_count: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_gmgn_hydration_qualified_count }}",
    "MARKET_CAP_DESC_RANKING_COMMITMENT: $\{{ steps.public-provider-smoke.outputs.market_cap_desc_ranking_commitment }}",
    "MARKET_CAP_ASC_SOURCE: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_source }}",
    "MARKET_CAP_ASC_STATUS: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_status }}",
    "MARKET_CAP_ASC_GMGN_STATUS: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_gmgn_status }}",
    "MARKET_CAP_ASC_MATCHED_COUNT: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_matched_count }}",
    "MARKET_CAP_ASC_GMGN_HYDRATION_QUALIFIED_COUNT: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_gmgn_hydration_qualified_count }}",
    "market_cap_asc_gmgn_hydration_qualified_count: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_gmgn_hydration_qualified_count }}",
    "MARKET_CAP_ASC_RANKING_COMMITMENT: $\{{ steps.public-provider-smoke.outputs.market_cap_asc_ranking_commitment }}",
    "CHART_PROVIDER: $\{{ steps.public-provider-smoke.outputs.chart_provider }}",
    "CHART_SCOPE: $\{{ steps.public-provider-smoke.outputs.chart_scope }}",
    "CHART_POOL_ATTRIBUTION: $\{{ steps.public-provider-smoke.outputs.chart_pool_attribution }}",
    "CHART_SMOKE_STATUS: $\{{ steps.public-provider-smoke.outputs.chart_status }}",
    'echo "- Visible market provider: \\`${MARKET_PROVIDER:-not-run}\\`"',
    'echo "- Explore market read status: \\`${MARKET_READ_STATUS:-not-run}\\`"',
    'echo "- Token detail market provider: \\`${DETAIL_MARKET_PROVIDER:-not-run}\\`"',
    'echo "- GMGN discovery ranking commitment: \\`${DISCOVERY_RANKING_COMMITMENT:-not-run}\\`"',
    'echo "- GMGN discovery consistency: \\`${DISCOVERY_CONSISTENCY:-not-run}\\`"',
    'echo "- GMGN search ranking commitment: \\`${SEARCH_RANKING_COMMITMENT:-not-run}\\`"',
    'echo "- Descending market-cap ranking: source \\`${MARKET_CAP_DESC_SOURCE:-not-run}\\`',
    'echo "- Ascending market-cap ranking: source \\`${MARKET_CAP_ASC_SOURCE:-not-run}\\`',
    'echo "- GMGN analytics summary: \\`${ANALYTICS_SUMMARY_STATUS:-not-run}\\`"',
    'echo "- Token detail smoke: \\`${DETAIL_SMOKE_STATUS:-not-run}\\`"',
    'echo "- Descending market-cap ranking: source \\`${MARKET_CAP_DESC_SOURCE:-not-run}\\`',
    'echo "- Ascending market-cap ranking: source \\`${MARKET_CAP_ASC_SOURCE:-not-run}\\`',
    'echo "- GMGN market required by staged public smoke: \\`$GMGN_MARKET_REQUIRED\\`"',
    'echo "- Effective GMGN requests per second: \\`${GMGN_REQUESTS_PER_SECOND:-not-run}\\`"',
    'echo "- Market chart provider: \\`${CHART_PROVIDER:-not-run}\\`"',
    'echo "- Market chart series scope: \\`${CHART_SCOPE:-not-run}\\`"',
    'echo "- Market chart pool attribution: \\`${CHART_POOL_ATTRIBUTION:-not-run}\\`"',
    'echo "- Market chart smoke: \\`${CHART_SMOKE_STATUS:-not-run}\\`"',
  ]);
  const publicActionRoutes = [creatorClaimPrepare, tradePrepare];
  const primaryRpcLaunchCatalogCacheStart = primaryRpcLaunchCatalog.indexOf(
    "export function createPrimaryRpcLaunchCatalogCacheV1",
  );
  const primaryRpcLaunchCatalogCacheEnd = primaryRpcLaunchCatalog.indexOf(
    "function catalogCacheKey(",
    primaryRpcLaunchCatalogCacheStart,
  );
  const primaryRpcLaunchCatalogCacheBlock =
    primaryRpcLaunchCatalogCacheStart >= 0 &&
    primaryRpcLaunchCatalogCacheEnd > primaryRpcLaunchCatalogCacheStart
      ? primaryRpcLaunchCatalog.slice(
          primaryRpcLaunchCatalogCacheStart,
          primaryRpcLaunchCatalogCacheEnd,
        )
      : "";
  const primaryRpcLaunchCatalogCacheContract =
    primaryRpcLaunchCatalog.includes(
      "export const PRIMARY_RPC_LAUNCH_CATALOG_CACHE_TTL_MS = 60_000;",
    ) &&
    includesEverySourceFragment(primaryRpcLaunchCatalogCacheBlock, [
      "const refreshes = new Map<string, PrimaryRpcLaunchCatalogCacheRefresh>();",
      "const binding = resolveBinding();",
      "const generatedAtMs = Date.parse(cached.catalog.generatedAt);",
      "cacheKeyHasCommitment(cached.key, binding.endpointCommitment)",
      "Number.isFinite(generatedAtMs)",
      "ageMs >= 0",
      "ageMs < PRIMARY_RPC_LAUNCH_CATALOG_CACHE_TTL_MS",
      "cached = null;",
      "const refreshKey = binding.endpointCommitment;",
      "let refresh = refreshes.get(refreshKey) ?? null;",
      "refreshes.set(refreshKey, current);",
      "const catalog = await reader(",
      "const completedAtMs = clock();",
      "const generatedAtMs = Date.parse(catalog.generatedAt);",
      'throw new PrimaryRpcLaunchCatalogError("integrity", "entries");',
      "key: catalogCacheKey(",
      "binding.endpointCommitment,",
      "return await waitForCatalogRefresh(refresh, options.signal);",
    ]) &&
    (primaryRpcLaunchCatalogCacheBlock.match(
      /ageMs < PRIMARY_RPC_LAUNCH_CATALOG_CACHE_TTL_MS/gu,
    )?.length ?? 0) === 1 &&
    (primaryRpcLaunchCatalogCacheBlock.match(
      /ageMs >= PRIMARY_RPC_LAUNCH_CATALOG_CACHE_TTL_MS/gu,
    )?.length ?? 0) === 1 &&
    !primaryRpcLaunchCatalogCacheBlock.includes("catch (");
  check(
    "ops-primary-rpc-launch-catalog-cache-contract",
    primaryRpcLaunchCatalogCacheContract,
    "the dRPC launch catalog cache is commitment-bound, singleflight, fresh for less than 60 seconds, and never serves stale data",
  );
  const gmgnProviderLifecycleContract =
    exactGmgnProviderLifecycleContract(gmgnAdapterSources) && [
    gmgnMarket,
    gmgnChart,
    gmgnTokenAnalytics,
    gmgnDiscovery,
  ].every((adapter) =>
    includesEverySourceFragment(adapter, [
      "const GMGN_REQUEST_TIMEOUT_MS = 2_500",
      "const GMGN_ACCOUNT_GATE_OUTCOME_TIMEOUT_MS = 3_000",
      "const GMGN_PROVIDER_LIFECYCLE_GRACE_MS =",
      "settleProviderReadLifecycle(",
      "providerLifecycleOperation()",
      "providerOutcomeOperation()",
      "const lateOutcome = providerOutcomeOperation();",
      "await completeProviderRequest(accountGate, lateDecision, lateOutcome);",
      "await completeProviderRequest(accountGate, decision);",
      "await settleProviderOperation(pending, providerOutcomeOperation());",
      "accountGate.complete(reservation),",
      "outcomeOperation: ProviderOperationV1 = providerOutcomeOperation()",
    ]) && !adapter.includes("await accountGate.complete(decision);")
  );
  const fastLanePublicProviderContract =
    gmgnProviderLifecycleContract &&
    exactExploreGmgnMarketCapRetryContract(publicExplore) &&
    includesEverySourceFragment(envioClassicV3Catalog, [
      "getEnvioClassicCatalogBinding()",
      "catalogBinding.releaseBinding",
      "catalogBinding.classicV4 !== null",
      "classicV4IsBound !== hasClassicV4ReleaseBinding(release)",
      "createEnvioClient({",
      '{ model: { _eq: "classic" } }',
      '{ releaseVersion: { _in: ["classic-v3", "classic-v4"] } }',
      "{ isComplete: { _eq: true } }",
      "{ provenanceValid: { _eq: true } }",
      "assertLaunchEventBinding(launch, event, release)",
      "rpcLag < BigInt(release.confirmations)",
      'source: "envio-classic-v3" as const',
      'stock: "excluded" as const',
      'kind: "envio-indexer-state" as const',
      "mergeEnvioClassicV3CatalogEntriesV1",
      'entry.exploreKind === "custom-project"',
      "entry.tokenAddress !== undefined || entry.markets.length > 0",
      "envioClassicV3IdentityCommitmentV1",
      'canonicalSha256("programmable.envio-classic-v3-identity.v1"',
    ]) &&
    includesEverySourceFragment(envioClassicV4CatalogBinding, [
      "parseEnvioClassicV4CatalogBinding",
      'input.status !== "inactive"',
      "if (options.publicReleaseBinding || options.publicRelease) return fail();",
      'value.status !== "indexer-activated"',
      "exactSharedBase(releaseBinding, options.baseBinding)",
      "exactV4Sources(releaseBinding, options.baseBinding, options.publicRelease)",
      "exactV4Release(releaseBinding, options.baseBinding)",
      "classicV4IndexerBindingDigest(releaseBinding)",
      "options.publicRelease.indexerHandoff.indexerBindingDigest",
      "getDataPipelineReleaseBinding()",
    ]) &&
    !/readDurableExploreModel|productionMainnetRpcPrimary|readPrimaryRpcExploreEntriesV1|readBitquery/iu.test(
      envioClassicV3Catalog,
    ) &&
    includesEverySourceFragment(dexscreenerExplore, [
      "exploreEntriesMarketIdentitiesV1(entries)",
      "exploreEntryMarketIdentitiesV1(entry)",
      "readDexscreenerMarketShadowV1(identities, wait)",
      'provider: "dexscreener"',
      'currency: "USD"',
      'source: "dexscreener"',
      ': "source-unavailable"',
      'result.status === "available" &&\n' +
        "      dexscreenerExploreObservationCurrentV1(\n" +
        "        result.observation.fetchedAt,\n" +
        "        observedAtMs,\n" +
        "      )",
      "observedCount: observedIdentityKeys.size",
      "oldestFetchedAt: sourceTimes[0] ?? null",
      "newestFetchedAt: sourceTimes.at(-1) ?? null",
    ]) &&
    includesEverySourceFragment(dexscreenerShadow, [
      "DEFAULT_TIMEOUT_MS = 3_000",
      "DEFAULT_CACHE_TTL_MS = 3 * 60 * 1_000 + 30_000",
      "DEFAULT_FAILURE_CACHE_TTL_MS = 15_000",
      "DEFAULT_MAXIMUM_CONCURRENT_BATCHES = 2",
      "DEFAULT_MINIMUM_REQUEST_INTERVAL_MS = 1_000",
      "DEFAULT_MAXIMUM_READ_DURATION_MS = 7_000",
      "const cache = new Map<string, CachedSnapshot>()",
      "const inFlight = new Map<string, Promise<DexscreenerShadowSnapshotV1>>()",
    ]) &&
    includesEverySourceFragment(exploreMarket, [
      "hydrateVisibleCanonicalSupplyV1(entries, wait)",
      "const CANONICAL_SUPPLY_PHASE_BUDGET_MS = 1_800",
      "const CANONICAL_SUPPLY_HYDRATION_LIMIT = 20",
      "canonicalTokenSupplyHydrationRequiredV1(entry)",
      "exploreEntryMarketIdentitiesV1(entry).length > 0",
      ").slice(0, CANONICAL_SUPPLY_HYDRATION_LIMIT)",
      "hydrateMissingCanonicalTokenSupplyV1(\n    hydrationCandidates,",
      "{ deadlineMs, now: wait.now }",
      "hydrationCandidateIndexes.entries()",
      "const supply = canonicalHydratedSupplyV1(hydrated)",
      "...original,",
      "totalSupplyRaw: supply.totalSupplyRaw",
      "tokenDecimals: supply.tokenDecimals",
      "entry.totalSupplyRaw.length > 78",
      "BigInt(entry.totalSupplyRaw) <= UINT256_MAX",
      "nowMs + CANONICAL_SUPPLY_PHASE_BUDGET_MS",
      "if (!gmgnMarketDataConfiguredV1())",
      "const gmgnCandidates = hydratedEntries.filter(",
      "gmgnVisibleMarketEntryEligibleV1",
      "const requestedIdentities = exploreEntriesMarketIdentitiesV1(",
      "const requestedIdentityKeys = new Set(",
      "requestedIdentities.map(exploreMarketIdentityKeyV1)",
      "identities.length === 1",
      "requestedIdentityKeys.has(exploreMarketIdentityKeyV1(identities[0]!))",
      "if (gmgnCandidates.length === 0)",
      "return readDexscreenerExploreEntriesV1(hydratedEntries, wait);",
      "const GMGN_VISIBLE_PHASE_BUDGET_MS = 1_800",
      "snapshots = await readGmgnExploreSnapshotsV1(gmgnCandidates, {",
      "phaseStartedAtMs + GMGN_VISIBLE_PHASE_BUDGET_MS",
      "const fallback = fallbackEntries.length === 0",
      ": await readDexscreenerExploreEntriesV1(fallbackEntries, wait);",
      "const requestedCount = requestedIdentities.length",
      "const fallbackRequestedCount = fallback.marketRead.requestedCount",
      "Math.min(fallback.marketRead.observedCount, fallbackRequestedCount)",
      "const fallbackQualifiedCount = fallbackEntries.filter((entry) =>",
      "fallbackObservedEntryIds.has(entry.id) &&",
      "const gmgnObservedIds = new Set(gmgnEntries.keys())",
      "const gmgnObservedCount = gmgnObservedIds.size",
      "gmgnSnapshotQualified(entry.gmgnMarketData, fallbackObservedAtMs)",
      "GMGN_VISIBLE_FALLBACK_FRESHNESS_RESERVE_MS = 10_000",
      "DEXSCREENER_EXPLORE_OBSERVATION_MAXIMUM_AGE_MS -",
      "unavailableCount: requestedCount - qualifiedCount",
      "const valuedEntries = hydratedEntries.map((entry): ValuedExploreEntry => {",
      "const dexscreener = fallbackObservedEntryIds.has(entry.id)",
      'provider: "gmgn"',
      'fallbackProvider: "dexscreener"',
      'if (marketRead.gmgnObservedCount > 0) sources.push("gmgn");',
      'if (marketRead.fallbackObservedCount > 0) sources.push("dexscreener");',
      'if (marketRead.gmgnQualifiedCount > 0) sources.push("gmgn");',
      'if (marketRead.fallbackQualifiedCount > 0) sources.push("dexscreener");',
    ]) &&
    !exploreMarket.includes("entries.length > 9") &&
    !exploreMarket.includes("exploreEntryMarketIdentitiesV1(entry).length !== 1") &&
    includesEverySourceFragment(gmgnMarket, [
      'const GMGN_API_ORIGIN = "https://openapi.gmgn.ai" as const',
      "const GMGN_REQUEST_TIMEOUT_MS = 2_500",
      "const GMGN_RESPONSE_MAXIMUM_BYTES = 1_000_000",
      "const GMGN_VISIBLE_MAXIMUM_ENTRY_COUNT = 100",
      "const GMGN_VISIBLE_CHUNK_SIZE = 20",
      "const GMGN_VISIBLE_MAXIMUM_CONCURRENT_LEASES = 12",
      "entries.slice(0, GMGN_VISIBLE_MAXIMUM_ENTRY_COUNT)",
      "offset += GMGN_VISIBLE_CHUNK_SIZE",
      "boundedEntries.slice(offset, offset + GMGN_VISIBLE_CHUNK_SIZE)",
      "gmgnVisibleMarketConcurrencyV1(chunk.length)",
      "gmgnEffectiveRequestsPerSecondV1()",
      "gmgnVisibleMarketEntryEligibleV1(",
      "canonicalIdentities?.length === 1",
      "gmgnCanonicalIdentitySetV1(identities)",
      "const GMGN_MAXIMUM_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000",
      'return String(chainId) === "1" ? "eth" : null;',
      "!productionPoolManagerBoundV1(entry)",
      '"/v1/token/info"',
      'candidate.protocol === "uniswap_v4"',
      'candidate.chainId === "1"',
      "identity.tokenAddress === tokenAddress",
      "identity.quoteAddress === quoteAddress",
      "const selection = tokenInfoPoolSelectionV1(",
      "const providerPoolAddress = canonicalAddress(poolLocator)",
      "identities.every((identity) =>",
      "providerPoolAddress !== identity.quoteAddress",
      "const providerPoolId = canonicalBytes32(poolLocator)",
      "candidate.poolId === providerPoolId",
      'entry.launchCategoryProvenance.source === "registry.custom-launched"',
      'String(data.pool.exchange).toLowerCase() !== "uniswap_v4"',
      "!poolBaseQuoteMatchesV1(data.pool, identity)",
      "!providerSupplyMatchesCanonical(",
      '"User-Agent": GMGN_API_USER_AGENT',
      'redirect: "error"',
      'credentials: "omit"',
      "const bytes = await readBoundedResponseBytes(",
      "const rateLimited = response.status === 429 || isRateLimitedEnvelope(value);",
      '(process.env.NODE_ENV === "production" || fetchImpl === fetch)',
      "const pending = accountGate.reserveSlot(input);",
      "const settled = await settleProviderOperation(pending, operation);",
      "void pending.then(async (decision) => {",
      "const pending = accountGate.blockUntil({",
      "blockedUntilMs: providerCooldownFromResponse(",
      "accountGate.complete(reservation),",
      "return settled !== PROVIDER_OPERATION_TIMED_OUT;",
      "if (!callerCanAwaitSharedRead(wait, nowMs)) return null;",
      "if (active) return awaitSharedReadForCaller(active, wait);",
      "if (snapshot !== null) {",
      "!hasExactOptionalEthereumChain(response)",
      "!hasExactOptionalEthereumChain(data)",
      "return value;",
      "canonicalSafeInteger(envelope.reset_at)",
      "process.env.GMGN_API_KEY?.trim()",
      'from "./gmgn-runtime-config.server"',
      "requestsPerSecond: gmgnEffectiveRequestsPerSecondV1()",
    ]) &&
    !gmgnMarket.includes("CachedValue<GmgnMarketSnapshotV1 | null>") &&
    includesEverySourceFragment(gmgnRuntimeConfig, [
      "export const GMGN_PRO_REQUESTS_PER_SECOND_V1 = 20 as const",
      "const GMGN_DEFAULT_REQUESTS_PER_SECOND_V1 = 1 as const",
      "const CANONICAL_GMGN_REQUESTS_PER_SECOND = /^(?:[1-9]|1[0-9]|20)$/u",
      "export function gmgnEffectiveRequestsPerSecondV1(): number",
      "process.env.GMGN_MAX_REQUESTS_PER_SECOND ??",
      "String(GMGN_DEFAULT_REQUESTS_PER_SECOND_V1)",
      "CANONICAL_GMGN_REQUESTS_PER_SECOND.test(configured)",
      "? Number(configured)",
      ": GMGN_DEFAULT_REQUESTS_PER_SECOND_V1",
    ]) &&
    includesEverySourceFragment(canonicalTokenSupply, [
      "const CANONICAL_TOKEN_SUPPLY_PHASE_BUDGET_MS = 1_800",
      "const CANONICAL_TOKEN_SUPPLY_MAXIMUM_ENTRY_COUNT = 20",
      "const CANONICAL_TOKEN_SUPPLY_MAXIMUM_PROVIDER_COUNT = 3",
      "const CANONICAL_TOKEN_SUPPLY_MAXIMUM_CONCURRENCY = 2",
      "const snapshotInFlight = new Map<",
      "const supplyInFlight = new Map<string, Promise<SupplyObservation | null>>()",
      'createHash("sha256").update(JSON.stringify([',
      "fetchOptions: { signal: context.signal }",
      "blockHash: snapshot.blockHash",
      "requireCanonical: true",
      "const active = snapshotInFlight.get(key)",
      "const active = supplyInFlight.get(key)",
      "if (observation !== null) {",
      "uncached.length < CANONICAL_TOKEN_SUPPLY_MAXIMUM_ENTRY_COUNT",
      "withSupplyLaneV1(context.signal",
      "totalSupply > UINT256_MAX",
      "export async function hydrateMissingCanonicalTokenSupplyBoundedV1<",
      "const pending = hydrateMissingCanonicalTokenSupplyV1(entries, {",
      "wait.signal?.addEventListener(\"abort\", onAbort, { once: true })",
      "void pending.then(finish, () => finish(entries))",
    ]) &&
    [gmgnMarket, gmgnChart, gmgnTokenAnalytics, gmgnDiscovery].every(
      (adapter) =>
        includesEverySourceFragment(adapter, [
          'from "./gmgn-runtime-config.server"',
          "requestsPerSecond: gmgnEffectiveRequestsPerSecondV1()",
        ]) && !adapter.includes("configuredRequestsPerSecond"),
    ) &&
    includesEverySourceFragment(gmgnAccountGate, [
      'const GATE_ID = "gmgn-openapi-v1" as const',
      "lease_holder = $3::uuid",
      "lease_until = authority.decided_at + INTERVAL '5 minutes'",
      "AND gate.generation = $4::bigint",
      "AND gate.lease_holder = $5::uuid",
      "AND gate.generation = $2::bigint",
      "AND gate.lease_holder = $3::uuid",
      '"GMGN account gate lease is stale or unavailable"',
      "assertReady: () => pool.assertGmgnAccountGateReadiness()",
      "input.requestsPerSecond > 20",
      "!isGmgnAccountGateCostV1(cost)",
      "const GMGN_ACCOUNT_GATE_COSTS = [1, 2, 3, 5] as const",
      "+ ($1::integer * $4::integer * INTERVAL '1 millisecond')",
    ]) &&
    includesEverySourceFragment(gmgnSnapshot, [
      '"programmable.gmgn-market-snapshot.v1" as const',
      'return value.chainId === "1"',
      'value.protocol === "uniswap_v4"',
      "positiveInteger(value.priceUsdWad)",
      "positiveInteger(value.fdvUsdWad)",
      "positiveInteger(value.liquidityUsdWad)",
      'value.marketScope === "token"',
      'value.poolAttribution === "exact" ||',
      'value.poolAttribution === "unavailable"',
    ]) &&
    includesEverySourceFragment(gmgnChart, [
      'const GMGN_API_ORIGIN = "https://openapi.gmgn.ai" as const',
      "const GMGN_REQUEST_TIMEOUT_MS = 2_500",
      '"/v1/token/info"',
      '"/v1/market/token_kline"',
      "from: String(window.from.getTime())",
      "to: String(window.to.getTime())",
      'cost: path === "/v1/market/token_kline" ? 2 : 1',
      "const canonicalIdentities = canonicalAdmissionIdentitySetV1(",
      'identity.chainId === "1"',
      'identity.protocol === "uniswap_v4"',
      "identity.tokenAddress === tokenAddress",
      "identity.quoteAddress === quoteAddress",
      "const admission = selectTokenInfoAdmissionIdentityV1(",
      "const providerPoolAddress = canonicalAddress(poolLocator)",
      "const providerPoolId = canonicalBytes32(poolLocator)",
      "candidate.poolId === providerPoolId",
      'String(pool.exchange).toLowerCase() !== "uniswap_v4"',
      "!poolBaseQuoteMatchesV1(pool, admission.identity)",
      "identity: admission.identity",
      "identityKey(first).localeCompare(identityKey(second))",
      "return identities.some((candidate) => sameIdentity(candidate, identity))",
      'provenance.source === "registry.custom-launched"',
      "const declaredBases = [pool.base_address, pool.token_address]",
      "addresses.includes(identity.tokenAddress)",
      "addresses.includes(identity.quoteAddress)",
      "!hasExactOptionalEthereumChain(response)",
      "!hasExactOptionalEthereumChain(data)",
      "return value;",
      "!providerSupplyMatchesCanonical(",
      'valueSemantics: "period-close" as const',
      "const proof = await readGmgnChartIdentityProofV1(",
      "if (proof === null) return null;",
      "if (proof !== null) {",
      "if (chart !== null) {",
      'seriesScope: "token"',
      "poolAttribution: input.identityProof.poolAttribution",
      "const pending = accountGate.reserveSlot(input);",
      "void pending.then(async (decision) => {",
      '(process.env.NODE_ENV === "production" || fetchImpl === fetch)',
      'from "./gmgn-runtime-config.server"',
      "requestsPerSecond: gmgnEffectiveRequestsPerSecondV1()",
      'redirect: "error"',
      'credentials: "omit"',
    ]) &&
    (gmgnChart.match(/!hasExactOptionalEthereumChain\(response\)/gu)?.length ??
      0) === 2 &&
    (gmgnChart.match(/!hasExactOptionalEthereumChain\(data\)/gu)?.length ??
      0) === 2 &&
    !gmgnChart.includes("CachedValue<GmgnMarketChartV1 | null>") &&
    !gmgnChart.includes("CachedValue<GmgnChartIdentityProofV1 | null>") &&
    includesEverySourceFragment(marketChartSnapshot, [
      '"programmable.market-chart-error.v1" as const',
      '"programmable.market-chart-error.v2" as const',
      "export type MarketChartErrorV1",
      "export type MarketChartErrorV2",
      'source: "programmable"',
      "export function isMarketChartError(",
      "value.schemaVersion === PROGRAMMABLE_MARKET_CHART_ERROR_SCHEMA_VERSION",
      'value.source === "programmable"',
      "value.schemaVersion === PROGRAMMABLE_MARKET_CHART_ERROR_SCHEMA_VERSION_V1",
      'value.source === "bitquery"',
    ]) &&
    includesEverySourceFragment(marketChartErrorOpenApi, [
      "Provider-neutral chart error emitted before a chart provider can be selected",
      'schemaVersion: { const: "programmable.market-chart-error.v2" }',
      'source: { const: "programmable" }',
    ]) &&
    includesEverySourceFragment(gmgnChartSnapshot, [
      '"programmable.gmgn-market-chart.v1" as const',
      '"programmable.gmgn-chart-identity-proof.v1" as const',
      'source: "gmgn-token-info"',
      'valueSemantics: "period-close"',
      'value.seriesScope !== "token"',
      'value.poolAttribution !== "exact" &&',
      'value.poolAttribution !== "unavailable"',
      "value.poolAttribution !== value.identityProof.poolAttribution",
      "!sameIdentity(value.identity, value.identityProof.identity)",
      "value.time !== value.bucketEnd",
      "totalVolume.toString() !== value.volumeUsdWad",
      "isGmgnTokenSeriesForAdmissionIdentityV1(",
      "return gmgnQuality > fallbackQuality ? input.candidate : input.fallback;",
    ]) &&
    includesEverySourceFragment(gmgnTokenAnalytics, [
      'const GMGN_API_ORIGIN = "https://openapi.gmgn.ai" as const',
      "const GMGN_REQUEST_TIMEOUT_MS = 2_500",
      '"/v1/token/security"',
      '"/v1/token/pool_info"',
      '"/v1/market/token_top_holders"',
      '"/v1/market/token_top_traders"',
      'return path.includes("token_top_") ? 5 : 1;',
      "!providerEthereumChainMatchesIfPresent(response, data)",
      "data.list.some((row) => !providerEthereumChainMatchesIfPresent(row))",
      "return envelope;",
      "const providerAddress = canonicalAddress(data.address)",
      "const baseAddress = canonicalAddress(data.base_address)",
      "const tokenAddress = baseAddress",
      "providerAddress !== identity.tokenAddress",
      "quoteAddress !== identity.quoteAddress",
      'data.exchange !== "uniswap_v4"',
      "const token0Address = baseAddress < quoteAddress ? baseAddress : quoteAddress",
      "const token1Address = baseAddress < quoteAddress ? quoteAddress : baseAddress",
      "providerPair[0] !== token0Address || providerPair[1] !== token1Address",
      "token0Address < token1Address",
      "const providerWait = sharedProviderWait(wait);",
      "if (value !== null) {",
      "const pending = accountGate.reserveSlot(input);",
      "void pending.then(async (decision) => {",
      '(process.env.NODE_ENV === "production" || fetchImpl === fetch)',
      'from "./gmgn-runtime-config.server"',
      "requestsPerSecond: gmgnEffectiveRequestsPerSecondV1()",
      'redirect: "error"',
      'credentials: "omit"',
    ]) &&
    !gmgnTokenAnalytics.includes("data.pool_address") &&
    !gmgnTokenAnalytics.includes("CachedValue<GmgnTokenSecurityV1 | null>") &&
    !gmgnTokenAnalytics.includes("CachedValue<GmgnTokenPoolInfoV1 | null>") &&
    !gmgnTokenAnalytics.includes(
      "CachedValue<GmgnTokenWalletRankingV1 | null>",
    ) &&
    includesEverySourceFragment(gmgnTokenAnalyticsSnapshot, [
      '"programmable.gmgn-token-security.v1" as const',
      '"programmable.gmgn-token-pool-info.v1" as const',
      '"programmable.gmgn-token-wallet-ranking.v1" as const',
      "export const GMGN_TOKEN_RANKING_MAXIMUM_LIMIT = 100 as const",
      "export const GMGN_TOKEN_RANKING_DEFAULT_LIMIT = 20 as const",
      'source: "gmgn"',
      'exchange: "uniswap_v4"',
      'marketScope: "token"',
      'poolAttribution: "unavailable"',
      "token0Address < token1Address",
      'export type GmgnTokenWalletRankingKindV1 = "holders" | "traders"',
    ]) &&
    includesEverySourceFragment(gmgnDiscovery, [
      'const GMGN_API_ORIGIN = "https://openapi.gmgn.ai" as const',
      "const GMGN_REQUEST_TIMEOUT_MS = 2_500",
      '"/v1/market/rank"',
      '"/v1/market/hot_searches"',
      '"/v1/market/search"',
      '"/v1/token/info"',
      'chain: "eth"',
      'q: normalizedQuery',
      'orderby: "weight"',
      'address: normalizedQuery',
      'import { unstable_cache } from "next/cache";',
      "const GMGN_DURABLE_CACHE_REVALIDATE_SECONDS = 60",
      "const GMGN_DURABLE_CACHE_MAXIMUM_AGE_MS = 235_000",
      "if (durableCacheEligible(wait))",
      "readDurablyCachedGmgnDiscoverySnapshotV1(",
      "if (durableSnapshotCurrent(durable.snapshot.fetchedAt))",
      'export async function readGmgnEthereumMarketCapAuthorityRankV1(',
      'type GmgnDiscoveryCacheModeV1 = "durable" | "shared-authority";',
      'if (cacheMode === "shared-authority") {',
      'normalized.interval !== "1h"',
      "normalized.limit !== GMGN_TRENDING_MAXIMUM_LIMIT",
      'normalized.orderBy !== "marketcap"',
      "return readThroughCache(\n      discoveryCache,\n      discoveryInFlight,\n      key,\n      wait,",
      '["programmable-gmgn-ethereum-discovery-v3"]',
      "{ revalidate: GMGN_DURABLE_CACHE_REVALIDATE_SECONDS }",
      "wait.fetchImpl === undefined",
      'return path === "/v1/market/hot_searches" ? 3 : 1;',
      "return envelope;",
      "if (value !== null) {",
      "const pending = accountGate.reserveSlot(input);",
      "void pending.then(async (decision) => {",
      '(process.env.NODE_ENV === "production" || fetchImpl === fetch)',
      'from "./gmgn-runtime-config.server"',
      "requestsPerSecond: gmgnEffectiveRequestsPerSecondV1()",
      '"User-Agent": GMGN_API_USER_AGENT',
      "const providerFailureLoggedAt = new Map<string, number>();",
      "if (nowMs - lastLoggedAt < 10_000) return;",
      'console.warn("GMGN provider read unavailable", {',
      'redirect: "error"',
      'credentials: "omit"',
    ]) &&
    !gmgnDiscovery.includes("envelopeCode") &&
    !gmgnDiscovery.includes("CachedValue<GmgnDiscoverySnapshotV1 | null>") &&
    includesEverySourceFragment(gmgnDiscoverySnapshot, [
      '"programmable.gmgn-discovery.v1" as const',
      '"programmable.gmgn-search.v1" as const',
      'providerChain: "eth"',
      "normalizeGmgnSearchQueryV1(value.query) !== value.query",
      '!Array.isArray(data.wallets)',
      'if (!isRecord(coin) || coin.chain !== "eth")',
      "duplicateProviderItemCount",
      "if (!hasExactOptionalEthereumChain(current)) return null;",
      "return hasExactOptionalEthereumChain(current) ? current : null;",
      '!Object.prototype.hasOwnProperty.call(value, "chain")',
      'value.chain === "eth"',
      'if (!isRecord(value) || value.chain !== "eth") return null;',
      'block.chain === "eth" && block.interval === interval',
      "let discarded = extracted.foreignItemCount;",
      "if (addresses.has(candidate.token.tokenAddress)) {",
      "providerItemCount: extracted.providerItemCount",
      "Number(value.providerItemCount) !== value.tokens.length +",
    ]) &&
    includesEverySourceFragment(gmgnCanonicalRanking, [
      '"programmable.gmgn-canonical-ranking.v1" as const',
      'source: "canonical-launch-catalog+gmgn"',
      'applied: "gmgn-ranked-with-launch-order-fallback"',
      'const tokenAddress = token.chain === "eth"',
      "for (const [canonicalIndex, entry] of canonicalEntries.entries())",
      'String(identity.chainId) === "1"',
      "const unobserved: GmgnCanonicalRankedEntryV1<Entry>[] = [];",
      "...ranked.map((item) => item.row)",
      "...unobserved",
      "entries: Object.freeze(rows.map((row) => row.entry))",
      "!canonicalEthereumAddresses.has(address)",
      "unobservedCanonicalEntryCount: canonicalEntries.length -",
      "gmgnMarketCapDiscoverySnapshotUsableV1(",
      'snapshot.orderBy === "marketcap"',
      "token.marketCapUsd > 0",
      "token.liquidityUsd >= GMGN_MARKET_CAP_MINIMUM_LIQUIDITY_USD",
      "rankCanonicalExploreMarketCapEntriesWithGmgnV1(",
      "rankCanonicalExploreEntriesWithGmgnSearchV1(",
      'source: "canonical-launch-catalog+gmgn-search"',
      "providerOnlyCanonicalTokenCount",
      "!universeAddresses.has(address)",
      "gmgnTokenInfoFallbackEntryV1(",
      'orderingSource: "gmgn-token-info-fdv" as const',
      'orderingSource: "dexscreener-fdv" as const',
      "exactCanonicalMarketIdentityV1(entry, row.entry)",
      "fallback.gmgnRequestedEntries",
      "fallback.dexscreenerRequestedEntries.filter(",
      "fallbackQualifiedEntryCount",
    ]) &&
    gmgnReadOnlyEndpointBoundary &&
    !/GMGN_API_KEY|X-APIKEY|keypair|private_key/iu.test(
      [publicExplore, publicToken, publicChart, publicTokenAnalytics].join(
        "\n",
      ),
    ) &&
    includesEverySourceFragment(publicExplore, [
      "EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_AGE_MS,",
      "EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_BYTES,",
      "EXPLORE_MARKET_CAP_AUTHORITY_POSITIVE_REFRESH_MS,",
      "exploreMarketCapAuthorityStorageCommitmentV1,",
      "getProductionExploreMarketCapAuthorityStoreV1,",
      "readEnvioClassicV3CatalogV1({",
      "readProductionCustomExploreDirectoryV1(",
      "readFinalizedRouterCustomIdentitySnapshotV1({",
      "const [catalog, registryCustom, routerCustom] = await Promise.all([",
      "mergeEnvioClassicV3CatalogEntriesV1(",
      "mergeRouterCustomExploreEntriesV1(",
      "const acceptedRouterSnapshot = routerAvailable",
      'routerCustomStatus === "last-known-good"',
      "envioClassicV3IdentityCommitmentV1(",
      'orderBy: "marketcap"',
      "direction,",
      "GMGN_MARKET_CAP_RETRY_MINIMUM_REMAINING_MS",
      "const MARKET_CAP_AUTHORITY_PUBLISH_RESERVE_MS = 3_000;",
      '"programmable.explore-market-cap-authority.v2"',
      '"programmable.explore-market-cap-authority-pin.v2"',
      '"programmable.explore-market-cap-authority-input.v4"',
      "EXPLORE_MARKET_CAP_AUTHORITY_COMPOSITION_POLICY_V4",
      '"gmgn-qualified-rank+shared-authority-fresh-read+oldest-first-sentinels+cyclic-supply+same-bucket-supply-priority+cyclic-token-info+dexscreener.v4"',
      "compositionPolicy: EXPLORE_MARKET_CAP_AUTHORITY_COMPOSITION_POLICY_V4",
      "orderedCanonicalIdentities: entries.map((entry, index) => ({",
      "const first = await readGmgnEthereumMarketCapAuthorityRankV1(",
      "first !== null ||",
      "authorityDeadlineMs - Date.now() <",
      "rankOptions,",
      "rankCanonicalExploreMarketCapEntriesWithGmgnV1(",
      "rankCanonicalExploreMarketCapPrimaryWithGmgnV1(",
      "const unobserved = primary.rows.flatMap((row) =>",
      "hydrateMissingCanonicalTokenSupplyBoundedV1(",
      "MARKET_CAP_SUPPLY_HYDRATION_LIMIT",
      "MARKET_CAP_SUPPLY_HYDRATION_BUDGET_MS",
      "const supplyRequired = unobserved.filter(\n    canonicalTokenSupplyHydrationRequiredV1,\n  );",
      "const supplyRequested = selectMarketCapCyclicHydrationEntriesV1(\n    supplyRequired,\n    MARKET_CAP_SUPPLY_HYDRATION_LIMIT,\n    authorityNow,\n  );",
      "exactExploreMarketIdentityV1(candidate, original)",
      "const gmgnRankObserved =\n    primary.coverage.gmgnObservedUniqueTokenCount > 0",
      "const gmgnHydrationEligible = gmgnRankObserved",
      "? hydrationUniverse.filter(gmgnVisibleMarketEntryEligibleV1)",
      ": [];",
      "export function selectMarketCapCyclicHydrationEntriesV1",
      "const seenIds = new Set<string>();",
      "const first = uniqueEligible[0]!;",
      "const last = uniqueEligible.at(-1)!;",
      "priorityReservation = priorityEntries.length,",
      "const priorityIds = new Set(priorityEntries.map((entry) => entry.id));",
      "if (priority.length > priorityReservation)",
      "const prefix = [last, first, ...priority];",
      "const rotating = uniqueEligible.slice(1, -1);",
      "limit - 2 - priorityReservation,",
      "Math.floor(nowMs / EXPLORE_MARKET_CAP_AUTHORITY_POSITIVE_REFRESH_MS)",
      "const cycleIndex = ((refreshBucket % cycleLength) + cycleLength) % cycleLength;",
      "offset < rotating.length && prefix.length + window.length < targetCount;",
      "if (prefixIds.has(entry.id)) continue;",
      "return Object.freeze([...prefix, ...window]);",
      "const gmgnRequested = selectMarketCapCyclicHydrationEntriesV1(\n    gmgnHydrationEligible,\n    GMGN_MARKET_CAP_HYDRATION_LIMIT,\n    authorityNow,\n    [...hydratedSupplyById.values()],\n    MARKET_CAP_SUPPLY_HYDRATION_LIMIT,\n  );",
      "readGmgnExploreSnapshotsV1(gmgnRequested, {",
      "gmgnTokenInfoFallbackEntryV1(",
      "const dexscreenerRequested = hydrationUniverse.filter(",
      "readDexscreenerExploreEntriesV1(\n    dexscreenerRequested,",
      "exploreMarketCapRankingV1(",
      "new Date(timestampMs).toISOString() === value",
      "nowMs - timestampMs <= EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_AGE_MS",
      "authority.orderedIdentities.length !== byId.size",
      "return seen.size === byId.size ? Object.freeze(ordered) : null;",
      "authority.inputCommitment !== input.inputCommitment",
      "!currentMarketCapAuthorityTimestampV1(authority.generatedAt, nowMs)",
      "currentMarketCapAuthorityTimestampV1(value, nowMs)",
      "authority.ranking.rankingCommitment !== authorityPin",
      "buildExploreMarketCapAuthorityV1(",
      "const canonicalAuthority = canonicalizeJson(authority);",
      "exploreMarketCapAuthorityStorageCommitmentV1(canonicalAuthority)",
      "const authorityRefreshGmgnStatus = ranked.ranking.observedTokenCount === 0",
      ': ranked.ranking.gmgnStatus === "complete"',
      "gmgnStatus: authorityRefreshGmgnStatus",
      "validUntil: new Date(validUntilMs).toISOString()",
      "parseStrictJson(canonicalAuthority, {",
      "maximumBytes: EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_BYTES,",
      "rankingCommitment: authority.ranking.rankingCommitment,",
      "const authorityStore = getProductionExploreMarketCapAuthorityStoreV1();",
      "? await authorityStore.resolve({",
      "acceptPinnedAuthority: (canonicalAuthority) => {",
      'resolution.kind === "ranking-conflict"',
      'code: "MARKET_CAP_RANKING_RESTART_REQUIRED"',
      "projectExploreMarketCapAuthorityV1(",
      "readExploreMarketEntriesV1(\n        identityPage.tokens,",
      'registryCustomStatus === "current" && routerCustomStatus === "current"',
      'requested: "market-cap"',
      "input.gmgnHydrationQualifiedCount + input.fallbackQualifiedCount <",
      "applied: marketCapAppliedV1({",
      '"gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order"',
      '"gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order"',
      '"qualified-fdv-then-launch-order"',
      '"launch-order"',
      '"gmgn-market-cap>gmgn-token-info-fdv>dexscreener-fdv>canonical-launch-order"',
      "canonicalTailCount: hybrid.canonicalTailEntryCount",
      "gmgnHydrationDeferredCount: hybrid.gmgnHydrationDeferredEntryCount",
      "asOfTime: coverage.gmgnObservedUniqueTokenCount > 0 && snapshot !== null",
      "? snapshot.fetchedAt",
      "readGmgnEthereumSearchV1(options.query, {",
      "rankExploreSearchEntriesV1(",
      '"programmable.explore-search-ranking-commitment.v1"',
      '"gmgn-canonical-search-with-local-match-fallback"',
      '"X-Programmable-Search-Provider": "gmgn"',
      '"X-Programmable-Search-Ranking-Commitment":',
      'searchRanking !== null && searchRanking.asOfTime !== null',
      '? "+gmgn-search"',
      'options.sort === "trending"\n              ? "no-store"',
      'options.sort === "trending"',
      "readGmgnEthereumTrendingV1(",
      '{ interval: "1h", limit: 100 }',
      "rankCanonicalExploreEntriesWithGmgnDiscoveryV1(",
      'canonicalSha256(\n    "programmable.explore-discovery-ranking-identity-commitment.v1",',
      "canonicalIndex: row.canonicalIndex",
      "snapshotDirection: row.gmgn.direction",
      "matchedUniqueTokenCount: coverage.gmgnMatchedUniqueTokenCount",
      "rankCoverage.gmgnMatchedUniqueTokenCount <",
      "rankCoverage.canonicalUniqueTokenCount",
      "hotSearchDeadlineMs - Date.now() >= 3_000",
      "readGmgnEthereumHotSearchesV1(",
      '{ interval: "24h", limit: 100 }',
      '? "gmgn-trending" as const',
      '"X-Programmable-Discovery-Provider": "gmgn"',
      '"X-Programmable-Discovery-Read-Status": discovery.status',
      '"X-Programmable-Discovery-Ranking-Commitment":',
      '"X-Programmable-Discovery-Matched-Unique-Count":',
      '"X-Programmable-Ranking-Primary-Provider": "gmgn"',
      '"X-Programmable-Ranking-Source": marketCapRanking.source',
      '"X-Programmable-Ranking-GMGN-Status":',
      '"X-Programmable-Ranking-Commitment":',
      "discovery.rankingCommitment",
      '"X-Programmable-Launch-Source": launchSource',
      'discovery !== null && discovery.status !== "unavailable"',
      '? "+gmgn-discovery"',
      '"X-Programmable-Market-Provider": marketProvider',
      '"X-Programmable-Router-Read-Status": routerCustomStatus',
      '"X-Programmable-Identity-Last-Indexed-At": identityGeneratedAt',
    ]) &&
    !publicExplore.includes("snapshotFetchedAt: row.gmgn.fetchedAt") &&
    includesEverySourceFragment(publicExploreView, [
      "export function parseExploreSearchRanking(",
      '"programmable.explore-search-ranking.v1"',
      "Object.keys(value).length !== EXPLORE_SEARCH_RANKING_FIELDS.length",
      "export function parseExploreDiscoveryRanking(",
      '"matchedUniqueTokenCount"',
      'value.rankingCommitment !== "string"',
      "Number(value.matchedUniqueTokenCount) + Number(value.foreignTokenCount)",
      "Number(value.matchedUniqueTokenCount) * 10_000",
      "Number(value.observedTokenCount) === 0 &&",
      "Number(value.qualifiedCount) === 0 && value.asOfTime !== null",
      "const providerOrdered = incoming.discovery !== undefined ||",
      "incoming.search !== undefined ||",
      'incoming.ranking?.requested === "market-cap"',
      "tokens: incoming.tokens.map((token) => {",
      "exploreProviderOrderCommitmentKey(firstPage)",
      "tokens.length !== firstPage.total",
      "providerOrderProofMatchesLocalSelection",
      "if (!requiresCompleteDataset) {",
      "incomingIsCompleteLocalSelection: requiresCompleteDataset",
    ]) &&
    (publicExploreView.match(
      /Number\(value\.matchedUniqueTokenCount\) \* 10_000/gu,
    )?.length ?? 0) === 3 &&
    !/readDurableExploreModel|readPrimaryRpcExploreEntriesV1|readBitqueryTokenMarketDataStrictV1/u.test(
      publicExplore,
    ) &&
    includesEverySourceFragment(publicToken, [
      "readEnvioClassicV3CatalogV1({",
      "readProductionCustomExploreDirectoryV1(",
      "readFinalizedRouterCustomIdentitySnapshotV1({",
      "const [catalog, registryReadResult, routerReadResult] = await Promise.all([",
      "mergeEnvioClassicV3CatalogEntriesV1(",
      "mergeRouterCustomExploreEntriesV1(",
      "const acceptedRouterSnapshot = routerAvailable",
      'routerCustomStatus === "last-known-good"',
      "publicExploreCatalogEntriesV1(identityEntries)",
      "envioClassicV3IdentityCommitmentV1(",
      "envioClassicV3IdentityCommitmentV1(catalog, publicIdentityEntries)",
      "identityCount: publicIdentityEntries.length",
      "const projectedRouterIdentityCount = publicIdentityEntries.filter(",
      "const entry: ExploreEntry | null = identityEntries.find(",
      "readExploreMarketEntriesV1([entry], {",
      '"X-Programmable-Launch-Source": input.launchSource',
      '"X-Programmable-Read-Source": `${input.launchSource}+${marketProvider}`',
      '"X-Programmable-Market-Provider": marketProvider',
      '"X-Programmable-Router-Read-Status": input.routerStatus',
      'valuation: { status: "unavailable", reason: "source-unavailable" }',
    ]) &&
    !/readDurableExploreModel|readPrimaryRpcExploreEntriesV1|readBitqueryTokenMarketDataStrictV1/u.test(
      publicToken,
    ) &&
    includesEverySourceFragment(publicTokenAnalytics, [
      "const FIXED_RANKING_LIMIT = 20",
      "const signal = AbortSignal.any([",
      "readEnvioClassicV3CatalogV1({ signal, deadlineMs })",
      "readProductionCustomExploreDirectoryV1(signal)",
      "readFinalizedRouterCustomIdentitySnapshotV1({",
      "mergeEnvioClassicV3CatalogEntriesV1(",
      "mergeRouterCustomExploreEntriesV1(",
      "hydrateMissingCanonicalTokenSupplyBoundedV1(",
      "{ signal, deadlineMs }",
      'if (canonical.kind === "unavailable")',
      'if (canonical.kind === "not-found")',
      "if (identities.length === 0)",
      "const candidate = await readGmgnMarketSnapshotV1(canonical.entry, wait);",
      "verification = exactMarketVerification(",
      "if (verification === null) {",
      "const identity = verification.identity;",
      "isGmgnMarketSnapshotForExploreEntryV1(value, entry);",
      "readGmgnTokenSecurityV1(identity, wait)",
      "readGmgnTokenPoolInfoV1(identity, wait)",
      "readGmgnTokenTopHoldersV1(",
      "readGmgnTokenTopTradersV1(",
      "{ limit: FIXED_RANKING_LIMIT }",
      "exactRankingForIdentity(",
      "value.query.limit === limit",
      "value.wallets.length <= limit",
      "if (rawLimit !== null && rawLimit !== String(FIXED_RANKING_LIMIT))",
      'if (parsedChain !== 1) return inputError("Unsupported chain")',
      "!hasExplicitForeignProviderChain(value)",
      "value.providerAddress === identity.tokenAddress",
      "value.baseAddress === identity.tokenAddress",
      "value.quoteAddress === identity.quoteAddress",
      'value.marketScope === "token"',
      'value.poolAttribution === "unavailable"',
      'value.exchange === "uniswap_v4"',
      '"X-Programmable-Analytics-Provider": "gmgn"',
      '"X-Programmable-Analytics-Scope": "token"',
      '"X-Programmable-Analytics-Pool-Attribution": "unavailable"',
      '"X-Programmable-Market-Provider": "gmgn"',
      'const PRIVATE_RANKING_CACHE_CONTROL = "private, max-age=0, no-store"',
    ]) &&
    !publicTokenAnalytics.includes('entry.exploreKind !== "token"') &&
    analyticsProofReadBoundary &&
    includesEverySourceFragment(publicWalletRankingBlock, [
      "address: wallet.address",
      "usdValue: wallet.usdValue",
      "amountRatio: wallet.amountRatio",
      "buyVolumeUsd: wallet.buyVolumeUsd",
      "sellVolumeUsd: wallet.sellVolumeUsd",
      "profitUsd: wallet.profitUsd",
      "profitRatio: wallet.profitRatio",
    ]) &&
    publicWalletProjectionBoundary &&
    includesEverySourceFragment(publicChart, [
      "readGmgnMarketChartV1({",
      "isFreshReadyGmgnTokenSeries(",
      "readBitqueryMarketChartV1({",
      "preferAdmittedGmgnTokenSeriesV1({",
      "readEnvioClassicV3CatalogV1({",
      "exploreEntryMarketIdentitiesV1(entry)",
      "mergeEnvioClassicV3CatalogEntriesV1(",
      "readProductionCustomExploreDirectoryV1(signal)",
      "readFinalizedRouterCustomIdentitySnapshotV1({",
      "const [catalog, registryResult, routerResult] = await Promise.all([",
      "routerCustomEntriesAtOrBeforeBlockV1(",
      "customEntries = [];",
      "routerResult.snapshot === null || routerStatus === \"unavailable\"",
      "envioAvailable: catalog !== null",
      "requestedRouterIdentityRead",
      "ROUTER_CUSTOM_LAUNCH_SOURCE",
      "hydrateMissingCanonicalTokenSupplyBoundedV1(",
      "if (identities.length === 0)",
      "gmgnTokenSeriesAdmissionIdentity(",
      "const fallbackIdentity = gmgnAdmissionIdentity ?? identity;",
      'schemaVersion: "programmable.market-chart-error.v2"',
      'source: "programmable"',
      'reason: "identity-unavailable"',
      "const GMGN_PRIMARY_CHART_MAXIMUM_AGE_MS = 60_000",
      "const GMGN_PRIMARY_CHART_MAXIMUM_CLOCK_SKEW_MS = 5_000",
      "!isGmgnTokenSeriesForAdmissionIdentityV1(chart, identity, range)",
      'chart.status !== "ready"',
      "generatedAtMs - proofAtMs <= GMGN_PRIMARY_CHART_MAXIMUM_AGE_MS",
      '"X-Programmable-Market-Provider": chart.source',
      '"X-Programmable-Market-Read-Status": chart.readStatus',
      '"X-Programmable-Chart-Scope": chartScope',
      '"X-Programmable-Chart-Pool-Attribution": chartPoolAttribution',
      '"X-Programmable-Read-Source": `${launchSource}+${chart.source}`',
      "TOKEN_CHART_CACHE_CONTROL",
    ]) &&
    !publicExplore.includes("unstable_cache") &&
    !publicChart.includes('"programmable.market-chart-error.v1"') &&
    gmgnChartReadStart >= 0 &&
    gmgnChartAcceptanceStart > gmgnChartReadStart &&
    bitqueryChartFallbackStart > gmgnChartAcceptanceStart &&
    publicChart.indexOf("readBitqueryMarketChartV1(") ===
      bitqueryChartFallbackStart + "const bitqueryChart = await ".length &&
    (publicChart.match(/readBitqueryMarketChartV1\(/gu)?.length ?? 0) === 1 &&
    chartPreferenceStart > bitqueryChartFallbackStart &&
    !/readPrimaryRpcExploreEntriesV1|productionMainnetRpcPrimary/iu.test(
      publicChart,
    ) &&
    includesEverySourceFragment(routerCustomPublic, [
      "canonicalTokenExploreEntryV1",
      'token.launchStampProvenance?.kind === "custom-graph"',
      "readAlchemyRouterCustomIdentitySourceV1",
      "resolveDurableExploreBlobToken",
      "readDurableRouterCustomIdentitySnapshotV1",
      "persistDurableRouterCustomIdentitySnapshotV1",
      "RouterCustomSnapshotConflictError",
      "lastKnownGoodRouterCustomSnapshotV1",
      "source.reorgDetected",
      "ROUTER_CUSTOM_SNAPSHOT_MAX_IDENTITIES = 10_000",
      "ROUTER_CUSTOM_SNAPSHOT_CURRENT_READ_TIMEOUT_MS = 3_000",
      "suppressRouterBoundCustomProjectDuplicates",
      "routerCustomEntriesAtOrBeforeBlockV1",
      "mergeRouterCustomCreatorProfileV1",
      "BigInt(stamp.blockNumber) > snapshotBlock",
      "entry.launchCategoryProvenance.source !== ROUTER_CUSTOM_LAUNCH_SOURCE",
    ]);
  check(
    "ops-public-provider-split-source-contract",
    fastLanePublicProviderContract,
    "Explore list, token detail and analytics keep the validated Envio and bounded Router catalog authoritative; Ethereum-only GMGN is the bounded primary provider for visible token-level market data, canonical-intersection discovery and search, and global market-cap ranking whose complete rank plus supply plus token_info plus Dexscreener composition is durably bound to one exact filtered input across pagination; token-level analytics and token-address charts are admitted by current token_info context whose coherent bytes32 locators must equal the canonical v4 PoolId while coherent 20-byte locators leave pool attribution unavailable; GMGN pool_info remains strictly token-level with unavailable pool attribution, Dexscreener retains visible fallback and FDV ordering only for the GMGN-unqualified canonical remainder, Bitquery retains exact-pool chart fallback, and action routes keep commitment-bound Website RPC semantics",
  );
  check(
    "ops-gmgn-account-gate-multiflight-migration",
    includesEverySourceFragment(gmgnMultiflightMigration, [
      "CREATE TABLE programmable_website_projection_v1.gmgn_account_gate_leases_v1",
      "PRIMARY KEY (gate_id, generation)",
      "UNIQUE (gate_id, lease_holder)",
      "FOREIGN KEY (gate_id)",
      "REFERENCES programmable_website_projection_v1.gmgn_account_gate_v1 (gate_id)",
      "ENABLE ROW LEVEL SECURITY",
      "FORCE ROW LEVEL SECURITY",
      "gmgn_account_gate_leases_v1_runtime_select",
      "gmgn_account_gate_leases_v1_runtime_insert",
      "gmgn_account_gate_leases_v1_runtime_delete",
      "GRANT SELECT, INSERT, DELETE",
      "TO programmable_website_projection_runtime",
      "REVOKE ALL",
      "FROM PUBLIC",
      "rolname = 'anon'",
      "rolname = 'authenticated'",
      "rolname = 'service_role'",
    ]) &&
      includesEverySourceFragment(websiteProjectionOperatorCore, [
        '"0007_gmgn_account_gate_multiflight_v1.sql"',
        "MIGRATION_FILE = /^(000[1-8])_([a-z][a-z0-9_]*)\\.sql$/u",
      ]) &&
      includesEverySourceFragment(websiteProjectionPostgres, [
        "const EVIDENCE_0007_DDL",
        "CHECK (ordinal BETWEEN 1 AND 7)",
        "CHECK (version ~ '^000[1-7]$')",
        "if (migration.ordinal === 7)",
        "await executeSimple(transaction, EVIDENCE_0007_DDL)",
        "const FINAL_GMGN_MULTIFLIGHT_PRIVILEGES",
        "GRANT SELECT, INSERT, DELETE",
        "gmgn_account_gate_leases_v1",
      ]) &&
      includesEverySourceFragment(websiteProjectionTarget, [
        "assertGmgnAccountGateMultiflightReadiness(): Promise<void>",
        "assertGmgnAccountGateMultiflightSecurityAttestationV1(",
        "gmgn_leases_select",
        "gmgn_leases_insert",
        "gmgn_leases_delete",
        "gmgn_leases_forbidden_access",
        "gmgn_leases_rls",
        "gmgn_leases_force_rls",
        "expected_policies",
        "provider_roles_excluded",
      ]) &&
      includesEverySourceFragment(websiteProjectionTargetRunbook, [
        "at most 20",
        "a 21st reservation waits",
        "migrations `0001` through `0008`",
        "safe legacy single-flight prefix",
        "cannot authorize this release's GMGN Pro throughput claim",
      ]) &&
      includesEverySourceFragment(websiteProjectionOperatorRunbook, [
        "`0001` through `0008`",
        "at most 20 active holder-bound leases",
        "a 21st reservation waits",
        "eight ordered file/execution hashes",
        "dry-run must report only `0008` pending",
        "The Stage workflow never applies database migrations",
      ]),
    "migration 0007, operator inventory, hosted readiness and runbooks bind the exact 20-flight GMGN account gate while 0006 remains a rolling-only prefix",
  );
  check(
    "ops-explore-market-cap-authority-migration",
    includesEverySourceFragment(exploreMarketCapAuthorityMigration, [
      "CREATE TABLE programmable_website_projection_v1.explore_market_cap_authority_heads_v1",
      "CREATE TABLE programmable_website_projection_v1.explore_market_cap_authority_generations_v1",
      "PRIMARY KEY (authority_key, generation)",
      "FOREIGN KEY (authority_key)",
      "ON DELETE CASCADE",
      "valid_until <= generated_at + INTERVAL '235 seconds'",
      "octet_length(canonical_authority) BETWEEN 2 AND 16777216",
      "explore_market_cap_authority_generations_v1_ranking_idx",
      "ENABLE ROW LEVEL SECURITY",
      "FORCE ROW LEVEL SECURITY",
      "explore_market_cap_authority_heads_v1_runtime_select",
      "explore_market_cap_authority_heads_v1_runtime_insert",
      "explore_market_cap_authority_heads_v1_runtime_update",
      "explore_market_cap_authority_heads_v1_runtime_delete",
      "explore_market_cap_authority_generations_v1_runtime_select",
      "explore_market_cap_authority_generations_v1_runtime_insert",
      "explore_market_cap_authority_generations_v1_runtime_delete",
      "GRANT UPDATE (",
      "current_generation, lease_generation, lease_holder, lease_until, updated_at",
      "rolname = 'anon'",
      "rolname = 'authenticated'",
      "rolname = 'service_role'",
    ]) &&
      includesEverySourceFragment(websiteProjectionOperatorCore, [
        '"0008_explore_market_cap_authority_v1.sql"',
        "WEBSITE_PROJECTION_PREDECESSOR_0007_PLAN_COMMIT",
        '"9d81af890e14e39aef415399b7df80745670483c"',
        "WEBSITE_PROJECTION_PREDECESSOR_0007_PLAN_SHA256",
        '"0xbb99064008299faf0173b4fd0199017358327a02f091436c4ef878f36df14ea8"',
        "WEBSITE_PROJECTION_PREDECESSOR_0007_ORDER_SHA256",
        '"0x3097a113366d96591241f9ed423b2fef1beb551959e04a6663847b3a1f55ee56"',
        "validateWebsiteProjectionPredecessor0007Plan",
        "websiteProjectionPredecessor0007Plan",
      ]) &&
      includesEverySourceFragment(websiteProjectionPostgres, [
        "const EVIDENCE_0008_DDL",
        "CHECK (ordinal BETWEEN 1 AND 8)",
        "CHECK (version ~ '^000[1-8]$')",
        "if (migration.ordinal === 8)",
        "await executeSimple(transaction, EVIDENCE_0008_DDL)",
        "const FINAL_EXPLORE_MARKET_CAP_AUTHORITY_PRIVILEGES",
        "explore_market_cap_authority_heads_v1",
        "explore_market_cap_authority_generations_v1",
      ]) &&
      includesEverySourceFragment(exploreMarketCapAuthorityStore, [
        "EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_AGE_MS = 235_000",
        "EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_RETAINED_GENERATIONS = 32;",
        "DELETE FROM programmable_website_projection_v1.explore_market_cap_authority_generations_v1",
        "DELETE FROM programmable_website_projection_v1.explore_market_cap_authority_heads_v1",
        "assertReady: () => pool.assertExploreMarketCapAuthorityReadiness()",
      ]) &&
      includesEverySourceFragment(websiteProjectionTarget, [
        "assertExploreMarketCapAuthorityReadiness(): Promise<void>",
        "assertExploreMarketCapAuthoritySecurityAttestationV1(",
        "heads_select",
        "heads_insert",
        "heads_delete",
        "heads_update",
        "heads_forbidden_access",
        "generations_select",
        "generations_insert",
        "generations_delete",
        "generations_forbidden_access",
        "expected_policies",
        "provider_roles_excluded",
      ]) &&
      includesEverySourceFragment(websiteProjectionTargetRunbook, [
        "0008_explore_market_cap_authority_v1.sql",
        "32 retained generations",
        "235 seconds",
        "assertExploreMarketCapAuthorityReadiness",
      ]) &&
      includesEverySourceFragment(websiteProjectionOperatorRunbook, [
        "0007 predecessor",
        "dry-run must report only `0008` pending",
        "current eight-row `verify` result",
      ]),
    "migration 0008, exact production predecessor evidence, operator closure, least-privilege runtime readiness and bounded durable generation retention bind Explore market-cap pagination to one cross-instance authority",
  );
  const publicProfileAndActionRoutes = [
    publicCreatorProfile,
    publicClassicProfileGet,
    publicStockProfileGet,
    ...publicActionRoutes,
  ];
  check(
    "ops-profile-claim-trade-provider-boundary",
    includesEverySourceFragment(publicCreatorProfile, [
      "readEnvioCreatorProfile",
      "readEnvioClassicV3CatalogV1",
      "readEnvioClassicV2CreatorClaimsV1",
      "readFinalizedRouterCustomIdentitySnapshotV1",
      "mergeRouterCustomCreatorProfileV1",
      "projectRouterCustomCreatorClaimProfileV1",
      "emptyRouterCustomCreatorProfile(",
      "result === null && routerResult.snapshot === null",
      "LEGACY_RPC_PROFILE_FALLBACK_ENABLED: boolean = false",
      "getWebsiteReadOnchainDeployment",
      "withOperationalRpcFailover",
      "profileRpcProviderHeader",
      "const [result, routerResult] = await Promise.all([",
      "let rpcProvider = result?.provider ?? ROUTER_CUSTOM_LAUNCH_SOURCE",
      "const launchSource = result === null",
      'routerStatus !== "unavailable"',
      ': "envio-classic-v3"',
      ": `${launchSource}+rpc`",
      '"X-Programmable-Router-Read-Status": routerStatus',
      '"X-Programmable-Router-Claim-Read-Status": routerClaimStatus',
      '"X-Programmable-Rpc-Provider": rpcProvider',
    ]) &&
      !publicCreatorProfile.includes("productionMainnetRpcPrimary") &&
      includesEverySourceFragment(publicClassicProfileGet, [
        "getWebsiteReadOnchainDeployment",
        "withOperationalRpcFailover",
        "classicRpcProviderHeader",
        '"X-Programmable-Read-Source": "rpc"',
        '"X-Programmable-Rpc-Provider": result.provider',
      ]) &&
      !publicClassicProfileGet.includes("classicV3ActionRpcProvider") &&
      publicStockProfileGet.includes("stockPairedActionRpcProvider") &&
      publicStockProfileGet.includes('"X-Programmable-Read-Source": "rpc"') &&
      publicStockProfileGet.includes(
        '"X-Programmable-Rpc-Provider": "drpc-primary"',
      ) &&
      includesEverySourceFragment(websiteRpcProviders, [
        "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER",
        "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL",
        "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT",
      ]) &&
      includesEverySourceFragment(primaryResolver, [
        "WEBSITE_MAINNET_RPC_ENV.primaryProvider",
        "WEBSITE_MAINNET_RPC_ENV.primaryUrl",
        "WEBSITE_MAINNET_RPC_ENV.primaryCommitment",
        'primary.provider !== "drpc"',
      ]) &&
      !/secondary|fallback|quorum/iu.test(primaryResolver) &&
      includesEverySourceFragment(actionRpcProviders, [
        "createCommittedActionRpcProvider",
        "tradeActionRpcProvider",
        "stockPairedActionRpcProvider",
        'Object.defineProperty(provider, "endpoint"',
        "enumerable: false",
      ]) &&
      includesEverySourceFragment(actionRpcIdentity, [
        "readTradeActionModelFromRpc",
        "readCreatorClaimIdentityFromRpc",
      ]) &&
      !/bitquery|alchemy|durable|blob|secondary|fallback|quorum|subgraph|stateview|chainlink|envio/iu.test(
        actionRpcIdentity,
      ) &&
      includesEverySourceFragment(tradePrepare, [
        "getWebsiteReadOnchainDeployment",
        "withOperationalRpcFailover",
      ]) &&
      !tradePrepare.includes("tradeActionRpcProvider") &&
      !tradePrepare.includes("tradeActionRpcProviders") &&
      tradePrepare.includes('"Cache-Control": "no-store"') &&
      includesEverySourceFragment(creatorClaimPrepare, [
        "getWebsiteReadOnchainDeployment",
        "withOperationalRpcFailover",
      ]) &&
      !creatorClaimPrepare.includes("creatorClaimRpcProvider") &&
      !creatorClaimPrepare.includes("creatorClaimRpcProviders") &&
      creatorClaimPrepare.includes('status: "not-submitted"') &&
      creatorClaimPrepare.includes("transactionHash: null") &&
      creatorClaimPrepare.includes("receipt: null") &&
      creatorClaimPrepare.includes('"Cache-Control": "no-store"') &&
      publicActionRoutes.every(
        (route) =>
          !/sendTransaction|writeContract|signTransaction|signTypedData|walletClient/u.test(
            route,
          ),
      ) &&
      publicProfileAndActionRoutes.every(
        (route) =>
          !/Promise\.allSettled|secondaryProvider|fallbackProvider/u.test(
            route,
          ),
      ),
    "Profile identity combines Envio with the bounded durable Router Custom snapshot and remains fail-closed without either identity source, while reviewed reward reads, Classic rewards, Claim, and Trade use the commitment-bound Website pair with at most one complete-operation QuickNode retry after an eligible dRPC transport or capacity failure; Stock retains its singular committed action provider and all action routes retain no write authority or hidden provider rotation",
  );
  check(
    "ops-staged-envio-catalog-gate",
    stagedCatalogProbe >
      deployWorkflow.indexOf("Resolve exact staged deployment") &&
      stagedCatalogProbe < stagedBitquerySmoke &&
      includesEverySourceFragment(stagedCatalogProbeBlock, [
        "VERCEL_AUTOMATION_BYPASS_SECRET: $\{{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
        '"/api/explore?limit=1&page=1&sort=newest"',
        "response.status === 200",
        'body?.catalog?.source === "envio-classic-v3"',
        "const classicCurrent =",
        'body?.catalog?.completeness?.classic === "current"',
        "const routerOnlyFallback =",
        'body?.catalog?.launchSource === "canonical-launch-stamp-router"',
        'body.catalog.completeness?.classic === "unavailable"',
        "routerStamp.projectedIdentityCount === body.catalog.identityCount",
        "const expectedEnvioLaunchSource =",
        "const expectedLaunchSource = routerOnlyFallback",
        '? "canonical-launch-stamp-router"',
        "classicCurrent || routerOnlyFallback",
        'body.catalog.completeness?.stock === "excluded"',
        'body.catalog.evidence?.kind === "envio-indexer-state"',
        "body.total >= 1",
        'routerCustomStatus === "last-known-good"',
        "let exactCatalog = false",
        "attempt < 5",
        "response = undefined",
        "if (attempt === 4) throw error",
        "continue;",
        "if (exactCatalog) {",
      ]) &&
      !stagedCatalogProbeBlock.includes("body.tokens[0]?.launchModel") &&
      !stagedCatalogProbeBlock.includes("CRON_SECRET") &&
      !stagedCatalogProbeBlock.includes("/api/ops/index-v2") &&
      !stagedCatalogProbeBlock.includes("        if:"),
    "every exact staged candidate proves either a non-empty current Envio Classic V3 catalog or an exact bounded Router-only fallback before public Fast-Lane smoke",
  );
  check(
    "ops-protected-public-provider-stage-smoke",
    stagedBitquerySmoke >
      deployWorkflow.indexOf("Resolve exact staged deployment") &&
      deployWorkflow.indexOf("Pull production configuration") >= 0 &&
      stagedGmgnRequirement >
        deployWorkflow.indexOf("Pull production configuration") &&
      stagedGmgnRequirement < stagedBitquerySmoke &&
      stagedReadModelPolicy > stagedGmgnRequirement &&
      stagedReadModelPolicy < stagedCandidateDeploy &&
      includesEverySourceFragment(stagedGmgnRequirementBlock, [
        "VERCEL_TOKEN: $\{{ secrets.VERCEL_TOKEN }}",
        "set -euo pipefail",
        'metadata_file="$RUNNER_TEMP/vercel-production-env-metadata.json"',
        'test ! -e "$metadata_file"',
        'vercel env ls production --format json --token="$VERCEL_TOKEN" |',
        "node scripts/bind-vercel-sensitive-production-metadata.mjs",
        '--metadata-file "$metadata_file"',
        '--vercel-project-id "$VERCEL_PROJECT_ID"',
        "node scripts/resolve-gmgn-production-requirement.mjs",
        "readonly require_gmgn_market",
        'echo "require_gmgn_market=$require_gmgn_market" >> "$GITHUB_OUTPUT"',
        '"requireGmgnMarket":%s',
      ]) &&
      includesExactLineSequence(stagedGmgnRequirementBlock, [
        'vercel env ls production --format json --token="$VERCEL_TOKEN" |',
        "node scripts/bind-vercel-sensitive-production-metadata.mjs \\",
        '--metadata-file "$metadata_file" \\',
        '--vercel-project-id "$VERCEL_PROJECT_ID"',
      ]) &&
      includesExactLineSequence(stagedGmgnRequirementBlock, [
        'require_gmgn_market="$(',
        "node scripts/resolve-gmgn-production-requirement.mjs \\",
        '--metadata-file "$metadata_file" \\',
        '--vercel-project-id "$VERCEL_PROJECT_ID"',
        ')"',
        "readonly require_gmgn_market",
      ]) &&
      (stagedGmgnRequirementBlock.match(/require_gmgn_market=/gu)?.length ??
        0) === 2 &&
      includesEverySourceFragment(stagedReadModelPolicyBlock, [
        "id: read-model-policy",
        "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT: $\{{ vars.PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT }}",
        "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT: $\{{ vars.PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT }}",
        "npm run perf:read-model:deploy-policy --",
        "--env-file .vercel/.env.production.local",
        '--sensitive-env-metadata "$RUNNER_TEMP/vercel-production-env-metadata.json"',
        '--github-output "$GITHUB_OUTPUT"',
      ]) &&
      !stagedReadModelPolicyBlock.includes("continue-on-error:") &&
      stagedDeployJobBlock.includes(
        "VERCEL_ORG_ID: $\{{ secrets.VERCEL_ORG_ID }}",
      ) &&
      stagedDeployJobBlock.includes(
        "VERCEL_PROJECT_ID: $\{{ secrets.VERCEL_PROJECT_ID }}",
      ) &&
      !/\bprj_[A-Za-z0-9]{8,128}\b/u.test(deployWorkflow) &&
      !stagedGmgnRequirementBlock.includes(
        'vercel env ls production --format json --token="$VERCEL_TOKEN" >',
      ) &&
      !/GMGN_API_KEY|\.vercel\/\.env\.production\.local|set -x|console\.log|continue-on-error:/u.test(
        stagedGmgnRequirementBlock,
      ) &&
      includesEverySourceFragment(vercelSensitiveMetadataBinder, [
        "MAXIMUM_METADATA_BYTES",
        "MAXIMUM_ENVIRONMENT_RECORDS",
        "omitEnvironmentValueFields(entry)",
        "FORBIDDEN_VALUE_FIELDS.has(key.toLowerCase())",
        "containsForbiddenValueField(entry)",
        "Vercel environment metadata must not contain values",
        'flag: "wx"',
        "mode: 0o600",
        'process.stderr.write("Vercel Production metadata binding failed\\n")',
      ]) &&
      includesEverySourceFragment(gmgnProductionRequirement, [
        'GMGN_PRODUCTION_ENVIRONMENT_KEY = "GMGN_API_KEY"',
        'GMGN_MAX_REQUESTS_PER_SECOND_ENVIRONMENT_KEY =\n    "GMGN_MAX_REQUESTS_PER_SECOND"',
        "VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA",
        'metadata.target !== "production"',
        "metadata.vercelProjectId !== vercelProjectId",
        "containsForbiddenValueField(entry)",
        "matches.length === 0 && rateMatches.length === 0",
        "matches.length === 0 || rateMatches.length === 0",
        'throw new Error("GMGN Production metadata is incomplete")',
        "matches.length !== 1",
        "rateMatches.length !== 1",
        'entry.type !== "sensitive"',
        "entry.target.length !== 1",
        'entry.target[0] !== "production"',
        "!branchless",
        "!nonCustom",
        "!notDecrypted",
        '!["sensitive", "encrypted"].includes(rateEntry.type)',
        "rateEntry.target.length !== 1",
        'rateEntry.target[0] !== "production"',
        "!rateBranchless",
        "!rateNonCustom",
        "!rateNotDecrypted",
        'process.stdout.write(requireGmgnMarket ? "true\\n" : "false\\n")',
      ]) &&
      !gmgnProductionRequirement.includes("process.env.GMGN_API_KEY") &&
      includesEverySourceFragment(stagedCandidateDeployBlock, [
        "set -euo pipefail",
        "vercel deploy --prod --skip-domain --archive=tgz",
        '--meta githubCommitSha="$GITHUB_SHA"',
        '--env VERCEL_GIT_COMMIT_SHA="$GITHUB_SHA"',
        '--env PROGRAMMABLE_RELEASE_COMMIT_SHA="$GITHUB_SHA"',
        "--env PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE=true",
        '--token="$VERCEL_TOKEN"',
      ]) &&
      !stagedCandidateDeployBlock.includes("--prebuilt") &&
      stagedWakeCanary >
        deployWorkflow.indexOf("Resolve exact staged deployment") &&
      stagedWakeCanary < stagedTokenImageProbe &&
      includesEverySourceFragment(stagedWakeCanaryBlock, [
        "id: wake-canary",
        "if: steps.read-model-policy.outputs.wake_canary_required == 'true'",
        "PROGRAMMABLE_QUICKNODE_STREAM_SECRET: $\{{ secrets.PROGRAMMABLE_QUICKNODE_STREAM_SECRET }}",
        "VERCEL_AUTOMATION_BYPASS_SECRET: $\{{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
        "STAGED_TARGET_URL: $\{{ steps.staged-deployment.outputs.target_url }}",
        "npm run perf:read-model:wake-canary --",
        '--target-url "$STAGED_TARGET_URL"',
        'echo "status=passed" >> "$GITHUB_OUTPUT"',
      ]) &&
      !stagedWakeCanaryBlock.includes("continue-on-error:") &&
      stagedBitquerySmokeBlock.includes(
        "VERCEL_AUTOMATION_BYPASS_SECRET: $\{{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "PROGRAMMABLE_REQUIRE_GMGN_MARKET: $\{{ steps.gmgn-market-requirement.outputs.require_gmgn_market }}",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "node scripts/smoke-static-dexscreener-public-apis.mjs",
      ) &&
      !stagedBitquerySmokeBlock.includes("continue-on-error:") &&
      (stagedBitquerySmokeBlock.match(
        /smoke-static-dexscreener-public-apis\.mjs/gu,
      )?.length ?? 0) === 1 &&
      !stagedBitquerySmokeBlock.includes("        if:") &&
      stagedProviderHandoff &&
      includesEverySourceFragment(operationsHealth, [
        "getProductionGmgnAccountGateStatusV1",
        "const gmgnAccountGate = await getProductionGmgnAccountGateStatusV1()",
        "accountGateMode: gmgnAccountGate.mode",
        'gmgnAccountGate.mode === "multiflight-v1"',
        'gmgnAccountGate.mode === "legacy-singleflight-v1"',
        "gmgnRequestsPerSecond < 20",
        "const providerStackReady = gmgnConfigured && bitqueryConfigured &&",
      ]) &&
      includesEverySourceFragment(stagedPublicSmokeScript, [
        '"/api/ops/health"',
        "function exactInformationalHealth(response)",
        'response.body?.status === (providerStackReady ? "ready" : "degraded")',
        'typeof primaryProvider.configured === "boolean"',
        'gmgn.role === "primary-token-market"',
        "Number.isSafeInteger(gmgnRequestsPerSecond)",
        "gmgnRequestsPerSecond >= 1",
        "gmgnRequestsPerSecond <= 20",
        'gmgnAccountGateMode === "multiflight-v1"',
        'gmgnAccountGateMode === "legacy-singleflight-v1"',
        '"unavailable"',
        'bitquery.role === "exact-pool-chart-fallback"',
        'dexscreener.role === "batch-fail-soft-fallback"',
        "!healthHasSensitiveData(response.body)",
        'healthAuthority: "informational-only"',
        "const VISIBLE_EXPLORE_PAGE_SIZE = 9",
        "sort=market-cap",
        "sort=newest",
        '"/api/explore/token?address="',
        '"/api/explore/token/chart?address="',
        '"/api/explore/profile?account="',
        "readBoundedResponseText(response",
        "maximumBytes: 4 * 1024 * 1024",
        "attempt < 2",
        "response.status === 503 && attempt === 0",
        "const STAGED_503_RETRY_AFTER_MAXIMUM_MS = 5_000",
        'response.headers.get("retry-after")',
        "await response.body?.cancel()",
        "waitForStagedRetryAfter(boundedStagedRetryAfterMs(response))",
        'targetKind === "staged" ? waitForStagedRetryAfter : null',
        "const EXPLORE_SNAPSHOT_ATTEMPTS = 3",
        "const EXPLORE_SNAPSHOT_RETRY_DELAY_MS = 16_000",
        "class ExploreCatalogBoundaryDriftError extends Error",
        "class ExploreMarketCapSnapshotDriftError extends Error",
        "snapshotAttempt < EXPLORE_SNAPSHOT_ATTEMPTS",
        "error instanceof ExploreCatalogBoundaryDriftError",
        "error instanceof ExploreMarketCapSnapshotDriftError",
        "await waitForCatalogConvergence(EXPLORE_SNAPSHOT_RETRY_DELAY_MS)",
        "Explore catalog changed during pagination",
        "Explore catalog changed before token detail read",
        "qualifiedDexscreenerFdv",
        'valuation.freshness === "provider-recent"',
        "exactUnavailableValuation",
        "exactCatalogSnapshot(highest, {",
        "catalog.launchSource === launchSource",
        "highestCatalog !== newestCatalog",
        "function exactMarketIdentityCount(tokens)",
        "function exactVisibleUnavailableValuation(token)",
        "const PROVIDER_RECENT_MAXIMUM_AGE_MS = 5 * 60_000",
        "function currentProviderTimestamp(value, nowMs)",
        "nowMs - observedAtMs <= PROVIDER_RECENT_MAXIMUM_AGE_MS",
        "function exactGmgnSnapshot(token, nowMs)",
        "token.fdvUsdWad === snapshot.fdvUsdWad",
        "valuation.asOfTime === token.gmgnMarketData.fetchedAt",
        "token.fdvUsdWad === valuation.valueWad",
        "function exactMarketReadCounters(read, expectedRequestedCount, nowMs)",
        "currentProviderTimestamp(read?.oldestFetchedAt, nowMs)",
        "currentProviderTimestamp(read?.newestFetchedAt, nowMs)",
        "function exactMarketAsOfBinding(response, tokens, read, nowMs)",
        'response.headers.get("x-programmable-market-as-of") !== expectedAsOf',
        "read.requestedCount === expectedRequestedCount",
        "function exactDexscreenerMarketRead(\n  response,\n  requestedTokens,\n  nowMs,\n  visibleTokens = requestedTokens,",
        "function exactVisibleMarketRead(response, tokens, nowMs)",
        "!Number.isSafeInteger(read.fallbackObservedCount)",
        "read.fallbackRequestedCount >\n      read.requestedCount - read.gmgnQualifiedCount",
        "read.fallbackRequestedCount <\n        read.requestedCount - read.gmgnQualifiedCount &&\n      read.status === \"complete\"",
        "read.fallbackObservedCount > read.fallbackRequestedCount",
        "read.fallbackQualifiedCount > read.fallbackObservedCount",
        "read.observedCount <\n      Math.max(read.gmgnObservedCount, read.fallbackObservedCount)",
        "read.observedCount > Math.min(\n      read.requestedCount,\n      read.gmgnObservedCount + read.fallbackObservedCount",
        '...(read.fallbackObservedCount > 0 ? ["dexscreener"] : [])',
        "function exactDetailMarketRead(response, token, launchSource, nowMs)",
        "function exactGmgnEligibleCanonicalToken(token)",
        'provenance?.source === "canonical-launch-read-model"',
        "const GMGN_CANONICAL_SCAN_MAXIMUM_PAGES = 8",
        "`&page=${page}&sort=newest&model=classic`",
        'token?.exploreKind !== "token" || token.launchModel !== "classic"',
        'throw new Error("Explore returned no GMGN-qualified canonical token")',
        "exactGmgnEligibleCanonicalToken(token) &&",
        "const exactGmgnDetailProof = (candidate) =>",
        'candidate.detail.headers.get("x-programmable-market-provider") ===\n          "gmgn"',
        'candidate.detail.headers.get("x-programmable-market-read-status") ===\n          "complete"',
        "qualifiedGmgnFdv(candidate.detailToken, now().getTime())",
        "const chartIdentities = entryMarketIdentities(detailToken)",
        "if (chartIdentities.length !== 1)",
        "const chartIdentity = chartIdentities[0]",
        "const chartCanonicalSupply =",
        "totalSupplyRaw: detailToken?.totalSupplyRaw",
        "tokenDecimals: detailToken?.tokenDecimals",
        "const completeCatalogTokens = [...newestTokens]",
        "const TRENDING_EXPLORE_PAGE_SIZE = 100",
        "const TRENDING_SNAPSHOT_ATTEMPTS = 2",
        'const TRENDING_DISCOVERY_VOLATILE_KEYS = new Set([\n  "asOfTime",\n])',
        "async function readBoundTrendingSnapshot({",
        "function stableTrendingDiscoveryMetadata(discovery)",
        "Trending discovery ranking identity changed during pagination",
        "Trending discovery invariants changed during pagination",
        "nextFreshnessMs === null || nextFreshnessMs < freshnessMs",
        "Trending discovery freshness regressed during pagination",
        'consistency: "ranking-identity+monotonic-current-freshness"',
        "Trending result is not the exact canonical set",
        "matchedUniqueCanonicalAddresses.size + discovery.foreignTokenCount",
        "Trending canonical prefix or stable tail is invalid",
        'throw new Error("GMGN Trending discovery is required")',
        'response.headers.get("x-programmable-discovery-ranking-commitment")',
        "async function readBoundSearchSnapshot({",
        "sort=newest&q=${",
        "Canonical search snapshot changed during pagination",
        "Canonical search ranking contract is invalid",
        "GMGN canonical search match is required",
        "function exactSearchRanking(response, canonicalMatches, query, nowMs)",
        'response.headers.get("x-programmable-search-ranking-commitment")',
        "matchedIdentities.some((identity) => !canonicalIdentitySet.has(identity))",
        "!matchedIdentities.includes(targetIdentity)",
        "async function readRequiredGmgnAnalytics({",
        'for (const section of ["summary", "holders", "traders"])',
        '"private, max-age=0, no-store"',
        "ANALYTICS_WALLET_KEYS",
        "canonicalMarketAddress(wallet.address) !== wallet.address",
        'pool.exchange !== "uniswap_v4"',
        "analyticsSummaryStatus = analytics.summary",
        "`discovery_ranking_commitment=${trendingDiscovery.rankingCommitment}`",
        "`discovery_consistency=${trendingDiscoveryConsistency}`",
        "`search_status=${searchRanking.status}`",
        "`search_matched_count=${searchRanking.matchedTokenCount}`",
        "`search_ranking_commitment=${searchRanking.rankingCommitment}`",
        "Explore catalog pagination contract is invalid",
        "Initial Newest page is outside the paged catalog",
        "new Set(highestIdentities).size !== highestIdentities.length",
        "Highest market-cap page is outside the paged catalog",
        "Market-cap ranking changed during pagination",
        "highestSecondPage.body.ranking.rankingCommitment !==",
        "stableMarketCapRankingMetadata(highestSecondPage.body.ranking) !==",
        "highestIdentities.includes(identity)",
        "function exactMarketCapRanking(response, canonicalTokens, direction, nowMs)",
        "function exactRequiredGmgnMarketCapRanking(response, nowMs)",
        "function exactRequiredGmgnMarketCapLiveness(response, direction, nowMs)",
        "const gmgnQualifiedCount = ranking?.matchedUniqueTokenCount +",
        "ranking?.gmgnHydrationQualifiedCount",
        "gmgnQualifiedCount > 0",
        "ranking?.observedTokenCount > 0",
        'ranking?.direction === direction &&\n    ranking?.gmgnStatus !== "unavailable" &&\n    Number.isSafeInteger(gmgnQualifiedCount) &&\n    gmgnQualifiedCount > 0',
        "Number.isSafeInteger(ranking?.observedTokenCount) &&\n    ranking.observedTokenCount > 0",
        "currentProviderTimestamp(ranking?.asOfTime, nowMs)",
        "ranking.observedTokenCount ===\n      ranking.matchedUniqueTokenCount + ranking.foreignTokenCount",
        "function expectedMarketCapApplied(ranking)",
        "function expectedMarketCapSource(ranking)",
        "ranking.qualifiedCount !==\n      ranking.matchedTokenCount + ranking.gmgnHydrationQualifiedCount +\n        ranking.fallbackQualifiedCount",
        'highest.body?.sortMetric !==\n          "gmgn-market-cap+gmgn-token-info-fdv+dexscreener-fdv-fallback"',
        "Explore catalog changed between ranking reads",
        "!exactSamePageOrder(highest, newest)",
        'token.exploreKind === "token"',
        'token.exploreKind !== "custom-project" ||\n    !/^sha256:[0-9a-f]{64}$/u.test(String(token.customProjectId ?? ""))',
        "token.customProjectId",
        "token.customLaunchId",
        "Array.isArray(token.markets)",
        "const deterministicMarkets = markets",
        "exactIdentity(detailToken) !== exactIdentity(selectedToken)",
        "detail.body?.token ?? detail.body?.customProject",
        "catalogBoundary.launchSource",
        "const profileFailClosed =",
        "profile.status === 503",
        'exactObjectKeys(profile.body, ["error", "status"])',
        'exactObjectKeys(profile.body?.error, ["code", "kind", "message"])',
        'profile.body?.error?.code === "creator_profile_temporarily_unavailable"',
        '"Onchain creator data is temporarily unavailable"',
        'profile.headers.get("cache-control") === "no-store"',
        'profile.headers.get("x-programmable-launch-source") === null',
        'profile.headers.get("x-programmable-read-source") === null',
        'profile.headers.get("x-programmable-rpc-provider") === null',
        "if (!profileReady && !profileFailClosed)",
        "const profileRpcProvider =",
        "const profileRouterReadStatus =",
        "const profileRpcProviderReady =",
        "const profileRouterReadReady =",
        'profileRpcProvider === "drpc-primary"',
        'profileRpcProvider === "quicknode-secondary"',
        "const profileSourceReady =",
        'profile.headers.get("x-programmable-launch-source") === "rpc"',
        'profile.headers.get("x-programmable-read-source") === "rpc"',
        'profile.headers.get("x-programmable-launch-source") ===\n        "envio-classic-v3"',
        'profile.headers.get("x-programmable-read-source") ===\n        "envio-classic-v3"',
        'profileRpcProvider === "envio-indexer-state"',
        'profile.headers.get("x-programmable-launch-source") ===\n        "envio-classic-v3+canonical-launch-stamp-router"',
        'profile.headers.get("x-programmable-read-source") ===\n        "envio-classic-v3+canonical-launch-stamp-router"',
        'profile.headers.get("x-programmable-read-source") ===\n        "envio-classic-v3+canonical-launch-stamp-router+rpc"',
        'profileRouterReadStatus === "current"',
        'profileRouterReadStatus === "last-known-good"',
        'profile.headers.get("x-programmable-read-source") ===\n        "envio-classic-v3+rpc"',
        "const chartProvider = chart.body?.source",
        "const chartIdentityMatches =",
        "canonicalMarketPool(chart.body?.identity?.poolId) ===",
        "chartIdentity.poolId",
        "canonicalMarketAddress(chart.body?.identity?.quoteAddress) ===",
        "chartIdentity.quoteAddress",
        "const gmgnProofIdentityMatches =",
        "gmgnProofIdentityMatches &&",
        "const gmgnChartReady =",
        'chartProvider === "gmgn"',
        'chart.body?.schemaVersion === "programmable.gmgn-market-chart.v1"',
        'chart.body?.seriesScope === "token"',
        '["exact", "unavailable"].includes(chart.body?.poolAttribution)',
        "chart.body?.identityProof?.poolAttribution ===",
        'chart.body?.identityProof?.source === "gmgn-token-info"',
        "exactObjectKeys(chart.body?.identityProof?.canonicalSupply",
        "chart.body?.identityProof?.canonicalSupply?.totalSupplyRaw ===",
        "chartCanonicalSupply.totalSupplyRaw",
        "chart.body?.identityProof?.canonicalSupply?.tokenDecimals ===",
        "chartCanonicalSupply.tokenDecimals",
        'point?.valueSemantics === "period-close"',
        "const bitqueryChartFallback =",
        'chartProvider === "bitquery"',
        'chart.body?.schemaVersion === "programmable.market-chart.v1"',
        "(!gmgnChartReady && !bitqueryChartFallback)",
        "(requireGmgnMarket && !gmgnChartReady)",
        "!chartIdentityMatches",
        'chart.headers.get("cache-control") !==\n      "public, max-age=0, s-maxage=2, stale-while-revalidate=2"',
        'chart.headers.get("x-programmable-read-source") !==\n      `${catalogBoundary.launchSource}+${chartProvider}`',
        'chart.headers.get("x-programmable-market-provider") !== chartProvider',
        "chartScope !== expectedChartScope",
        "chartPoolAttribution !== expectedChartPoolAttribution",
        'chart.headers.get("x-programmable-market-read-status") !==\n      chart.body?.readStatus',
        'chart.headers.get("x-programmable-valuation-block") !== null',
        "!exactVisibleMarketRead(newest, newestTokens, validationNowMs)",
        "catalogPage,",
        'highest,\n          completeCatalogTokens,\n          "desc"',
        'lowest,\n          completeCatalogTokens,\n          "asc"',
        "!exactDetailMarketRead(",
        "const detailMarketProvider = detail.headers.get(",
        "highest.body.ranking.matchedTokenCount +\n              highest.body.ranking.gmgnHydrationQualifiedCount",
        "environment.PROGRAMMABLE_REQUIRE_GMGN_MARKET",
        '!["true", "false"].includes(gmgnMarketRequirement)',
        'const requireGmgnMarket = gmgnMarketRequirement === "true"',
        'gmgnRequestsPerSecond !== 20 || gmgnAccountGateMode !== "multiflight-v1"',
        "Required GMGN Production throughput lacks exact RPS 20 multiflight-v1 proof",
        "GMGN descending market-cap canonical qualification is required",
        "GMGN ascending market-cap canonical qualification is required",
        "if (requireGmgnMarket) {",
        'throw new Error("Token detail GMGN market contract is required")',
        "const detailStatus = qualifiedGmgnFdv(detailToken, now().getTime())",
        'marketProvider: newest.headers.get("x-programmable-market-provider")',
        "marketReadStatus: newest.body.marketRead.status",
        "`market_provider=${marketProvider}`",
        "`gmgn_account_gate_mode=${gmgnAccountGateMode}`",
        "`gmgn_requests_per_second=${gmgnRequestsPerSecond}`",
        "`detail_market_provider=${detailMarketProvider}`",
        "`market_cap_desc_source=${marketCapDescRanking.source}`",
        "`market_cap_desc_gmgn_status=${marketCapDescRanking.gmgnStatus}`",
        "`market_cap_desc_gmgn_hydration_qualified_count=${marketCapDescRanking.gmgnHydrationQualifiedCount}`",
        "`market_cap_desc_ranking_commitment=${marketCapDescRanking.rankingCommitment}`",
        "`market_cap_asc_source=${marketCapAscRanking.source}`",
        "`market_cap_asc_gmgn_status=${marketCapAscRanking.gmgnStatus}`",
        "`market_cap_asc_gmgn_hydration_qualified_count=${marketCapAscRanking.gmgnHydrationQualifiedCount}`",
        "`market_cap_asc_ranking_commitment=${marketCapAscRanking.rankingCommitment}`",
        "`chart_provider=${chartProvider}`",
        "`chart_scope=${chartScope}`",
        "`chart_pool_attribution=${chartPoolAttribution}`",
        "marketProvider,",
        "detailMarketProvider,",
        "marketCapDescGmgnHydrationQualifiedCount:",
        "marketCapAscGmgnHydrationQualifiedCount:",
        "chartProvider,",
        "chartScope,",
        "chartPoolAttribution,",
        'creatorClaimPrepare: "separate-live-probe-required"',
        'tradePrepare: "separate-live-probe-required"',
        "runProductionStaticDexscreenerSmokeV1",
      ]) &&
      !stagedPublicSmokeScript.includes(
        "ranking.qualifiedCount !== response.body?.marketRead?.qualifiedCount",
      ) &&
      !stagedPublicSmokeScript.includes("/api/explore/profile/claim") &&
      !stagedPublicSmokeScript.includes("/api/trade/prepare") &&
      !/PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL|PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY|https?:\/\/[^"'\s]+rpc/iu.test(
        stagedPublicSmokeScript,
      ) &&
      !/PROGRAMMABLE_WEBSITE_MAINNET_RPC|readPrimaryRpc|readBitquery|readDurableExploreModel|https?:\/\/[^"'\s]+rpc/iu.test(
        stagedPublicSmokeScript,
      ) &&
      packageJson?.scripts?.test?.includes(
        "scripts/test/smoke-static-dexscreener-public-apis.test.mjs",
      ) === true &&
      packageJson?.scripts?.["test:interface:ci"]?.includes(
        "scripts/test/smoke-static-dexscreener-public-apis.test.mjs",
      ) === true &&
      packageJson?.scripts?.["verify:custom-v2:ci"]?.includes(
        "scripts/test/smoke-static-dexscreener-public-apis.test.mjs",
      ) === true &&
      packageJson?.scripts?.["verify:custom-v2:ci"]?.includes(
        "tests/bind-vercel-sensitive-production-metadata.test.ts",
      ) === true &&
      packageJson?.scripts?.["verify:custom-v2:ci"]?.includes(
        "tests/resolve-gmgn-production-requirement.test.ts",
      ) === true &&
      packageJson?.scripts?.["verify:custom-v2:ci"]?.includes(
        "npm run perf:read-model:ops-gate",
      ) === true,
    "the immutable staged candidate proves validated last-good identities, bounded GMGN-visible and detail enrichment with Dexscreener fallback, mandatory exact-identity GMGN detail when configured, an exact-input durable full GMGN plus token_info plus Dexscreener market-cap composition across pagination with bounded drift retry and committed coverage, token-address GMGN chart primary with explicit exact-or-unavailable current locator attribution, token-level GMGN pool_info with unavailable attribution, and exact-pool Bitquery fallback with scope and provider handed off explicitly",
  );
  check(
    "ops-obsolete-public-read-gates-absent",
    !deployWorkflow.includes("perf:read-model:staged-health") &&
      !deployWorkflow.includes("Capture staged read-model evidence") &&
      !deployWorkflow.includes("Gate indexed or shadow read path") &&
      !deployWorkflow.includes("StateView") &&
      !deployWorkflow.includes("official Uniswap v4 subgraph") &&
      !deployWorkflow.includes(
        "Refresh and prove exact staged durable read model",
      ),
    "obsolete indexed, Graph and staged-health gates remain absent from Website staging",
  );
  const exactVerifyProofGateStart = deployWorkflow.indexOf("  release-gate:");
  const exactVerifyProofGateEnd = deployWorkflow.indexOf("  deploy:");
  const exactVerifyProofGate =
    exactVerifyProofGateStart >= 0 &&
    exactVerifyProofGateEnd > exactVerifyProofGateStart
      ? deployWorkflow.slice(exactVerifyProofGateStart, exactVerifyProofGateEnd)
      : "";
  check(
    "ops-exact-release-dependency",
    deployWorkflow.includes("needs: release-gate") &&
      deployWorkflow.includes("needs.release-gate.outputs.verified_sha") &&
      exactVerifyProofGate.includes(
        "node scripts/production-verify-proof.mjs resolve",
      ) &&
      exactVerifyProofGate.includes(
        "artifact-ids: ${{ steps.resolve-proof.outputs.artifact_id }}",
      ) &&
      exactVerifyProofGate.includes(
        "run-id: ${{ steps.resolve-proof.outputs.verify_run_id }}",
      ) &&
      exactVerifyProofGate.includes("attestations: read") &&
      exactVerifyProofGate.includes("digest-mismatch: error") &&
      exactVerifyProofGate.includes("gh attestation verify") &&
      exactVerifyProofGate.includes(
        '--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/verify.yml"',
      ) &&
      exactVerifyProofGate.includes('--source-ref "$GITHUB_REF"') &&
      exactVerifyProofGate.includes('--source-digest "$GITHUB_SHA"') &&
      exactVerifyProofGate.includes('--signer-digest "$GITHUB_SHA"') &&
      exactVerifyProofGate.includes("--deny-self-hosted-runners") &&
      exactVerifyProofGate.includes(
        "node scripts/production-verify-proof.mjs verify",
      ) &&
      deployWorkflow.includes(
        "name: Revalidate exact Verify proof after production approval",
      ) &&
      deployWorkflow.includes(
        'test "$REVALIDATED_ARTIFACT_ID" = "$EXPECTED_ARTIFACT_ID"',
      ) &&
      deployWorkflow.includes(
        'test "$REVALIDATED_ARTIFACT_DIGEST" = "$EXPECTED_ARTIFACT_DIGEST"',
      ) &&
      !exactVerifyProofGate.includes("npm ci") &&
      !exactVerifyProofGate.includes("pnpm --dir indexer") &&
      !exactVerifyProofGate.includes("npm run verify") &&
      !exactVerifyProofGate.includes("npm run contracts:verify:ci") &&
      deployWorkflow.includes('--meta githubCommitSha="$GITHUB_SHA"') &&
      deployWorkflow.includes('--env VERCEL_GIT_COMMIT_SHA="$GITHUB_SHA"') &&
      deployWorkflow.indexOf(
        "Verify Sigstore provenance and exact proof contents",
      ) <
        deployWorkflow.indexOf(
          "Stage production source build without assigning domains",
        ) &&
      deployWorkflow.includes(
        "vercel deploy --prod --skip-domain --archive=tgz",
      ) &&
      stagedCandidateDeployBlock.includes(
        "--env PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE=true",
      ) &&
      !deployWorkflow.includes("vercel build --prod") &&
      !deployWorkflow.includes("--prebuilt") &&
      stagedTokenImageProbe >
        deployWorkflow.indexOf("Resolve exact staged deployment") &&
      includesEverySourceFragment(stagedTokenImageProbeBlock, [
        "STAGED_TARGET_URL: $\{{ steps.staged-deployment.outputs.target_url }}",
        '"/api/token-image"',
        'method: "POST"',
        'contentType !== "application/json"',
        "readBoundedResponseText(response",
        "response.status !== 401",
        'body.error !== "Connect your wallet and try again"',
      ]) &&
      !/(?:^|[{,\n])\s*["']?(?:authorization|cookie|x-privy-identity-token)["']?\s*:/iu.test(
        stagedTokenImageProbeBlock,
      ) &&
      !/\n\s+"?body"?\s*:|new\s+(?:FormData|File)\b/iu.test(
        stagedTokenImageProbeBlock,
      ) &&
      deployWorkflow.indexOf(
        "Confirm consumed Verify proof identity after production approval",
      ) < deployWorkflow.indexOf("Pull production configuration"),
    "production staging consumes a fresh exact-SHA full Verify attestation before build",
  );
  check(
    "ops-verify-workflow-binding",
    verifyWorkflow.includes("npm run perf:read-model:ops-gate") &&
      verifyWorkflow.includes("name: Bind production Verify proof") &&
      verifyWorkflow.includes("needs:\n      - scope\n      - secret-scan") &&
      verifyWorkflow.includes(
        "PRODUCTION_VERIFY_INDEXER_RESULT: ${{ needs.scope.outputs.indexer == 'true' && needs.indexer.result || 'skipped' }}",
      ) &&
      verifyWorkflow.includes(
        "PRODUCTION_VERIFY_DATABASE_PGLITE_RESULT: ${{ needs.scope.outputs.database == 'true' && needs.database-pglite.result || 'skipped' }}",
      ) &&
      verifyWorkflow.includes(
        "PRODUCTION_VERIFY_INTERFACE_RESULT: ${{ needs.scope.outputs.interface == 'true' && needs.interface.result || 'skipped' }}",
      ) &&
      verifyWorkflow.includes(
        "PRODUCTION_VERIFY_CONTRACTS_RESULT: ${{ needs.scope.outputs.contracts == 'true' && needs.contracts.result || 'skipped' }}",
      ) &&
      verifyWorkflow.includes(
        "PRODUCTION_VERIFY_SCOPE_READ_MODEL: ${{ needs.scope.outputs.read_model }}",
      ) &&
      verifyWorkflow.includes(
        "uses: actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26",
      ) &&
      verifyWorkflow.includes(
        "production-verify-proof-${{ github.run_id }}-${{ github.run_attempt }}",
      ),
    "production pushes attest the same complete operations contract consumed by staging",
  );
  check(
    "ops-post-promotion-binding",
    deployWorkflow.includes("id: production-before") &&
      deployWorkflow.includes('--reject-git-head "$GITHUB_SHA"') &&
      deployWorkflow.indexOf("id: production-before") <
        deployWorkflow.indexOf("id: deploy") &&
      deployWorkflow.includes(
        "DEPLOYMENT_ID: ${{ steps.staged-deployment.outputs.deployment_id }}",
      ) &&
      deployWorkflow.includes(
        "Stage-only: no production promotion was attempted.",
      ) &&
      !deployWorkflow.includes("vercel promote") &&
      !deployWorkflow.includes("vercel rollback") &&
      operationsRunbook.includes(
        "stage-only and must never call `vercel promote`",
      ) &&
      manualPromotionSequenceIsFailClosed(operationsRunbook) &&
      manualRollbackSequenceIsFailClosed(operationsRunbook) &&
      retiredCandidateCutoverIsFailClosed(retiredCandidateCutover) &&
      postPromotion.includes("verifyProductionDeploymentBinding") &&
      productionBinding.includes("resolveProductionBinding") &&
      stagedProviderHandoff &&
      includesEverySourceFragment(postPromotion, [
        "export function parsePostPromotionArguments(argv)",
        '"require-gmgn-market"',
        '!["true", "false"].includes(result["require-gmgn-market"])',
        'requireGmgnMarket: result["require-gmgn-market"] === "true"',
        "requireGmgnMarket: args.requireGmgnMarket",
      ]) &&
      includesEverySourceFragment(postPromotionVerifierBlock, [
        "target.toString() !== `${PRODUCTION_ORIGIN}/`",
        'typeof input.requireGmgnMarket !== "boolean"',
        'throw new Error("an explicit GMGN market requirement boolean is required")',
        'throw new Error("exact production deployment binding is required")',
        "verifyProductionDeploymentBinding({",
        "runProductionStaticDexscreenerSmokeV1({",
        "PROGRAMMABLE_REQUIRE_GMGN_MARKET: String(input.requireGmgnMarket)",
        'id: "production-static-identity-dexscreener-public-apis"',
      ]) &&
      !postPromotion.includes("GMGN_API_KEY") &&
      !postPromotion.includes("input.environment") &&
      includesEverySourceFragment(operationsRunbook, [
        ': "${VERCEL_ORG_ID:?The Vercel organization ID is required}"',
        ': "${VERCEL_PROJECT_ID:?The Vercel project ID is required}"',
        "export VERCEL_ORG_ID VERCEL_PROJECT_ID",
        'test ! -e "$PRE_PROMOTE_GMGN_METADATA_OUTPUT"',
        'vercel env ls production --format json --token="$VERCEL_TOKEN" |',
        "node scripts/bind-vercel-sensitive-production-metadata.mjs",
        '--metadata-file "$PRE_PROMOTE_GMGN_METADATA_OUTPUT"',
        '--vercel-project-id "$VERCEL_PROJECT_ID"',
        "node scripts/resolve-gmgn-production-requirement.mjs",
        'test "$REQUIRE_GMGN_MARKET" = "$STAGED_REQUIRE_GMGN_MARKET"',
        '--require-gmgn-market "$REQUIRE_GMGN_MARKET"',
        "Both entries absent resolves to `false`",
        "either\nentry present alone, duplicates, or malformed metadata fail closed",
      ]) &&
      !operationsRunbook.includes(
        'vercel env ls production --format json --token="$VERCEL_TOKEN" >',
      ) &&
      !/\bprj_[A-Za-z0-9]{8,128}\b/u.test(operationsRunbook) &&
      !/process\.env\.GMGN_API_KEY|\.vercel\/\.env\.production\.local|set -x|console\.log/u.test(
        operationsRunbook,
      ) &&
      !/runtimeProductionProviderEndpoints|verifyBitquery|stateview|chainlink|\/api\/ops\/health|\/api\/explore\/token\/chart/iu.test(
        postPromotionVerifierBlock,
      ) &&
      !/verifyLegacyReadModelPostPromotion|@deprecated Historical Bitquery|loadReadModelReleaseEvidence|verifyLiveCacheAndKeyContracts/iu.test(
        postPromotion,
      ) &&
      postPromotion.includes("verifyPostPromotion({") &&
      !postPromotion.includes("evidencePath: args.evidence") &&
      !operationsRunbook.includes(
        '--evidence "$READ_MODEL_RELEASE_EVIDENCE_PATH"',
      ),
    "the workflow is stage-only and the manual promotion sequence binds a secret-safe current Production GMGN requirement to the staged and post-promotion public checks",
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

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  main();
}
