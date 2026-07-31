import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSource(rootDirectory, path) {
  return readFileSync(resolve(rootDirectory, path), "utf8");
}

export function evaluateReadModelSourceContracts(
  rootDirectory,
  profile,
) {
  const checks = [];
  const failures = [];
  const check = (id, condition, detail) => {
    const status = condition ? "pass" : "fail";
    checks.push({ id, status, detail });
    if (!condition) failures.push({ id, detail });
  };

  const dualRpc = readSource(rootDirectory, "lib/data-pipeline/dual-rpc.ts");
  check(
    "source-rpc-concurrency",
    dualRpc.includes(
      `export const DUAL_RPC_DEFAULT_CONCURRENCY = ${profile.projector.rpc.maxConcurrencyPerProvider};`,
    ),
    "dual-RPC concurrency matches the load profile",
  );
  check(
    "source-rpc-attempts",
    dualRpc.includes(
      `export const DUAL_RPC_DEFAULT_ATTEMPTS = ${profile.projector.rpc.maxAttemptsPerCall};`,
    ),
    "dual-RPC retry attempts match the load profile",
  );
  check(
    "source-rpc-candidate-cap",
    dualRpc.includes(
      `export const DUAL_RPC_MAX_CANDIDATES = ${profile.projector.maximumCandidateBatchSize};`,
    ),
    "candidate cap matches the load profile",
  );
  check(
    "source-rpc-hard-deadline",
    dualRpc.includes(
      `export const DUAL_RPC_HARD_DEADLINE_MS = ${profile.projector.hardDeadlineMs.toLocaleString("en-US").replace(",", "_")};`,
    ) && dualRpc.includes("AbortSignal.timeout(policy.hardDeadlineMs)"),
    "dual-RPC runtime enforces the hard deadline",
  );
  check(
    "source-rpc-global-call-budget",
    dualRpc.includes(
      `export const DUAL_RPC_MAX_CALLS_PER_PROVIDER = ${profile.projector.rpc.maxCallsPerProviderPerRun};`,
    ) && dualRpc.includes("context.callCount >= policy.maxCallsPerProvider"),
    "dual-RPC runtime enforces the global per-provider call budget",
  );
  check(
    "source-rpc-raw-trace",
    dualRpc.includes("executionTrace: {") &&
      dualRpc.includes("providerEndpointCommitment") &&
      dualRpc.includes("providerOriginCommitment"),
    "dual-RPC output includes raw commitment-bound call traces",
  );

  const rpcProviders = readSource(
    rootDirectory,
    "lib/data-pipeline/rpc-providers.server.ts",
  );
  check(
    "source-rpc-timeout",
    rpcProviders.includes(
      `timeout: ${profile.projector.rpc.perCallTimeoutMs.toLocaleString("en-US").replace(",", "_")}`,
    ),
    "RPC timeout matches the load profile",
  );

  const indexRoute = readSource(rootDirectory, "app/api/ops/index/route.ts");
  check(
    "source-hosting-deadline",
    indexRoute.includes(
      `export const maxDuration = ${profile.projector.hostingDeadlineMs / 1_000};`,
    ),
    "hosting deadline leaves the required projector reserve",
  );

  const dataPipelineConfig = readSource(
    rootDirectory,
    "lib/data-pipeline/config.ts",
  );
  check(
    "source-dependency-timeouts",
    dataPipelineConfig.includes("timeoutMs: 2_000;") &&
      dataPipelineConfig.includes("statementTimeoutMs: 1_000;"),
    "Envio and Postgres calls retain bounded timeouts",
  );

  const publicCacheSources = [
    ["exploreList", "app/api/explore/route.ts"],
    ["tokenDetail", "app/api/explore/token/route.ts"],
    ["tokenChart", "app/api/explore/token/chart/route.ts"],
    ["creatorProfile", "app/api/explore/profile/route.ts"],
    ["classicProfile", "app/api/profile/classic-v3/route.ts"],
    ["stockProfile", "app/api/profile/stock-paired/route.ts"],
    ["classicLaunchLookup", "app/api/profile/classic-v3/route.ts"],
    [
      "stockLaunchLookup",
      "app/api/explore/launch/stock-paired/route.ts",
    ],
    ["tokenList", "app/api/indexers/v1/token-list/route.ts"],
    ["health", "app/api/ops/health/route.ts"],
  ];
  for (const [contractName, path] of publicCacheSources) {
    const source = readSource(rootDirectory, path);
    check(
      `source-cache-${contractName}`,
      source.includes(profile.cacheContracts[contractName]),
      `${contractName} cache policy matches the load profile`,
    );
  }

  const publicIndexerRoute = readSource(
    rootDirectory,
    "app/api/indexers/v1/tokens/route.ts",
  );
  const publicIndexerResponse = readSource(
    rootDirectory,
    "app/api/indexers/v1/response.ts",
  );
  check(
    "source-cache-publicIndexer",
    publicIndexerRoute.includes("indexedFeedHeaders(snapshot)") &&
      publicIndexerResponse.includes(
        `export const INDEXER_READY_CACHE_CONTROL =\n  "${profile.cacheContracts.publicIndexer}";`,
      ) &&
      publicIndexerResponse.includes(
        "cacheControl = INDEXER_READY_CACHE_CONTROL",
      ),
    "publicIndexer cache policy matches the response helper used by the route",
  );

  const accountMutation = readSource(
    rootDirectory,
    "app/api/explore/profile/claim/route.ts",
  );
  check(
    "source-cache-account-mutation",
    accountMutation.includes('"Cache-Control": "no-store"'),
    "account mutations are not cached",
  );
  const transactionPreparation = readSource(
    rootDirectory,
    "app/api/trade/prepare/route.ts",
  );
  check(
    "source-cache-transaction-preparation",
    transactionPreparation.includes('"Cache-Control": "no-store"'),
    "transaction preparation is not cached",
  );

  const capture = readSource(
    rootDirectory,
    "scripts/perf/read-model-capture.mjs",
  );
  check(
    "source-release-probe-transport",
    capture.includes('headers["x-programmable-shadow-probe-signature"]') &&
      capture.includes('headers["x-programmable-shadow-probe"] = "1"') &&
      !capture.includes("x-programmable-shadow-probe-token"),
    "release probes send a signed capability and never transmit the secret",
  );
  check(
    "source-real-corpus-selection",
    capture.includes(
      "capturedRuntime.datasetManifest.keys.tokenAddresses",
    ) &&
      capture.includes(
        "capturedRuntime.datasetManifest.keys.accountAddresses",
      ) &&
      capture.includes("capturedRuntime.datasetManifest.keys.classicLaunches") &&
      capture.includes("capturedRuntime.datasetManifest.keys.stockLaunches") &&
      capture.includes('"accessEvidence"') &&
      !capture.includes("eligibleLaunches.map("),
    "the throughput run repeats attested deterministic samples instead of padding to cardinality",
  );
  const releaseProbe = readSource(
    rootDirectory,
    "scripts/perf/read-model-release-probe.mjs",
  );
  check(
    "source-release-probe-payload",
    releaseProbe.includes(
      'const RELEASE_PROBE_SIGNATURE_VERSION = "programmable-release-probe-v1";',
    ) &&
      releaseProbe.includes("`${RELEASE_PROBE_SIGNATURE_VERSION}\\n${route}\\n${input.nonce}`") &&
      releaseProbe.includes('tokenDetail: "explore-token"') &&
      releaseProbe.includes('classicLaunchLookup: "launch-lookup"'),
    "release-probe HMACs are versioned and bound to the exact indexed route and nonce",
  );

  return {
    ok: failures.length === 0,
    checks,
    failures,
  };
}
