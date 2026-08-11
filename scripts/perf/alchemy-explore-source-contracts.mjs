#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTES = Object.freeze([
  Object.freeze({
    id: "explore",
    path: "app/api/explore/route.ts",
    readyCache:
      "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
  }),
  Object.freeze({
    id: "token-detail",
    path: "app/api/explore/token/route.ts",
    readyCache:
      "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
  }),
  Object.freeze({
    id: "token-chart",
    path: "app/api/explore/token/chart/route.ts",
    readyCache:
      "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
  }),
  Object.freeze({
    id: "token-list",
    path: "app/api/indexers/v1/token-list/route.ts",
    readyCache:
      "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
  }),
]);

const FORBIDDEN_ROUTE_BINDINGS = Object.freeze([
  "lib/data-pipeline",
  "readIndexedFeedSnapshot",
  "coordinatePublicRouteRead",
  "PROGRAMMABLE_PROJECTOR",
  "PROGRAMMABLE_QUICKNODE",
  "PROGRAMMABLE_ENVIO",
]);

function readSource(rootDirectory, path, sourceOverrides) {
  if (Object.hasOwn(sourceOverrides, path)) return sourceOverrides[path];
  return readFileSync(resolve(rootDirectory, path), "utf8");
}

export function evaluateAlchemyExploreSourceContracts(
  rootDirectory = process.cwd(),
  options = {},
) {
  const sourceOverrides = options.sourceOverrides ?? {};
  const checks = [];
  const failures = [];
  const check = (id, condition, detail) => {
    const status = condition ? "pass" : "fail";
    checks.push({ id, status, detail });
    if (!condition) failures.push({ id, detail });
  };

  const routeSources = ROUTES.map((route) => ({
    ...route,
    source: readSource(rootDirectory, route.path, sourceOverrides),
  }));
  const responsePath = "app/api/indexers/v1/response.ts";
  const responseSource = readSource(
    rootDirectory,
    responsePath,
    sourceOverrides,
  );
  const publicIndexerSource = readSource(
    rootDirectory,
    "app/api/indexers/v1/tokens/route.ts",
    sourceOverrides,
  );
  const publicIndexerAliasSource = readSource(
    rootDirectory,
    "app/api/indexers/v1/token/route.ts",
    sourceOverrides,
  );
  const indexerFeedSource = readSource(
    rootDirectory,
    "lib/onchain/indexer-feed.ts",
    sourceOverrides,
  );
  const exploreConsumerSource = readSource(
    rootDirectory,
    "lib/explore-consumer.server.ts",
    sourceOverrides,
  );
  const runtimePath = "lib/alchemy/explore.server.ts";
  const runtimeSource = readSource(
    rootDirectory,
    runtimePath,
    sourceOverrides,
  );
  const registrySource = readSource(
    rootDirectory,
    "lib/alchemy/launch-registry.server.ts",
    sourceOverrides,
  );
  const onchainSource = readSource(
    rootDirectory,
    "lib/onchain/read-model.ts",
    sourceOverrides,
  );
  const classicV3Source = readSource(
    rootDirectory,
    "lib/onchain/classic-v3-read-model.ts",
    sourceOverrides,
  );
  const stockPairedSource = readSource(
    rootDirectory,
    "lib/onchain/stock-paired-read-model.ts",
    sourceOverrides,
  );
  const webhookSource = readSource(
    rootDirectory,
    "app/api/alchemy/webhook/route.ts",
    sourceOverrides,
  );
  const deployWorkflowSource = readSource(
    rootDirectory,
    ".github/workflows/deploy-production.yml",
    sourceOverrides,
  );
  const bitqueryMarketSource = readSource(
    rootDirectory,
    "lib/market-data/bitquery.server.ts",
    sourceOverrides,
  );
  const marketSchemaSource = readSource(
    rootDirectory,
    "lib/market-data/market-data-v1.ts",
    sourceOverrides,
  );

  check(
    "alchemy-durable-registry",
    runtimeSource.includes("readDurableExploreModel(") &&
      runtimeSource.includes("Number.MAX_SAFE_INTEGER") &&
      runtimeSource.includes("readAlchemyLaunchRegistry(") &&
      runtimeSource.includes("advanceExploreLaunchDiscovery(") &&
      !runtimeSource.includes("readExploreModel(") &&
      !runtimeSource.includes("readLiveExploreModel"),
    "the request path starts from the verified durable registry and advances only its separate launch overlay",
  );
  check(
    "alchemy-launch-registry-cas",
    registrySource.includes(
      '"indexes/mainnet-classic-v2/alchemy-launch-registry-v1"',
    ) &&
      registrySource.includes("VERCEL_GIT_COMMIT_SHA") &&
      registrySource.includes("payload.repositoryCommit !== repositoryCommit") &&
      registrySource.includes("contentHash(registry)") &&
      registrySource.includes("ifMatch: expectedEtag") &&
      registrySource.includes("allowOverwrite: expectedEtag !== null") &&
      registrySource.includes("AlchemyLaunchRegistryCreateConflictError") &&
      registrySource.includes("useCache: false"),
    "the incremental launch cursor is content-addressed and compare-and-swap protected",
  );
  check(
    "alchemy-bounded-launch-advance",
    onchainSource.includes(
      "const fromBlock = BigInt(base.snapshot.blockNumber) + 1n;",
    ) &&
      onchainSource.includes("deploymentBlock: fromBlock") &&
      classicV3Source.includes("options.fromBlock ?? release.startBlock") &&
      stockPairedSource.includes(
        "options.fromBlock ?? BigInt(release.startBlock)",
      ),
    "every active launch family reads only blocks after the committed cursor",
  );
  check(
    "alchemy-request-self-refresh",
    runtimeSource.includes("includeLatest: true") &&
      runtimeSource.includes("requirePersistence: false") &&
      runtimeSource.includes("revalidate: 5") &&
      runtimeSource.includes("LAUNCH_CURSOR_PERSIST_INTERVAL_BLOCKS") &&
      runtimeSource.includes(
        "launchDiscoverySnapshot: servedCursorModel.snapshot",
      ) &&
      runtimeSource.includes(
        'advanceExploreLaunchDiscovery(deployment, confirmed, "latest")',
      ),
    "public requests self-refresh to the live Alchemy head without depending on cron or webhook delivery",
  );
  check(
    "alchemy-webhook-persist-before-invalidate",
    webhookSource.indexOf("await refreshAlchemyExploreRegistry({") >= 0 &&
      webhookSource.indexOf("await refreshAlchemyExploreRegistry({") <
        webhookSource.indexOf("revalidateTag(ALCHEMY_EXPLORE_CACHE_TAG") &&
      webhookSource.includes("requirePersistence: true") &&
      webhookSource.includes("{ expire: 0 }") &&
      webhookSource.includes("return errorResponse(503)"),
    "an authenticated webhook persists the confirmed cursor before invalidating public caches",
  );
  check(
    "bitquery-bounded-market-batching",
    bitqueryMarketSource.includes(
      "BITQUERY_OAUTH_TOKEN_ENVIRONMENT_VARIABLE =",
    ) &&
      bitqueryMarketSource.includes('"BITQUERY_OAUTH_TOKEN" as const') &&
      bitqueryMarketSource.includes("MARKET_BATCH_SIZE = 100") &&
      bitqueryMarketSource.includes("MARKET_BATCH_CONCURRENCY = 2") &&
      bitqueryMarketSource.includes("PoolId: { in: $pools }") &&
      bitqueryMarketSource.includes("limitBy: { by: Trade_PoolId, count: 1 }") &&
      bitqueryMarketSource.includes(
        "limitBy: { by: PoolEvent_Pool_PoolId, count: 1 }",
      ) &&
      bitqueryMarketSource.includes(
        "limitBy: { by: Token_Address, count: 1 }",
      ) &&
      bitqueryMarketSource.includes(
        'const dataset = range === "1h" ? "" : ", dataset: combined";',
      ) &&
      bitqueryMarketSource.includes("EVM(network: eth, dataset: combined)") &&
      !bitqueryMarketSource.includes("NEXT_PUBLIC_BITQUERY") &&
      marketSchemaSource.includes('source: "bitquery"') &&
      marketSchemaSource.includes('protocol: "uniswap_v4"'),
    "Bitquery market reads are server-only, PoolId-native, bounded and archive-aware",
  );

  for (const route of routeSources) {
    check(
      `alchemy-${route.id}-runtime`,
      route.source.includes("readAlchemyExploreModel") &&
        FORBIDDEN_ROUTE_BINDINGS.every(
          (binding) => !route.source.includes(binding),
        ),
      `${route.id} reads directly through the Alchemy runtime without indexed infrastructure`,
    );
    check(
      `alchemy-${route.id}-cache`,
      route.source.includes(route.readyCache),
      `${route.id} retains its reviewed ready cache policy`,
    );
  }

  check(
    "alchemy-public-indexer-runtime",
    publicIndexerSource.includes("readAlchemyExploreModel") &&
      publicIndexerSource.includes("alchemyFeedHeaders") &&
      publicIndexerAliasSource.includes(
        'import { GET as getToken } from "../tokens/route";',
      ) &&
      FORBIDDEN_ROUTE_BINDINGS.every(
        (binding) =>
          !publicIndexerSource.includes(binding) &&
          !publicIndexerAliasSource.includes(binding),
      ),
    "the public indexer feed uses the same direct Alchemy launch-discovery runtime",
  );
  check(
    "alchemy-discovery-snapshot-provenance",
    indexerFeedSource.includes("launchDiscoverySnapshot?: ExploreSnapshot") &&
      indexerFeedSource.includes("model.launchDiscoverySnapshot") &&
      deployWorkflowSource.includes(
        'incrementalLaunch.launchDiscoverySource !==',
      ) &&
      deployWorkflowSource.includes(
        "launchCursorBlock < incrementalLaunchBlock",
      ) &&
      responseSource.includes(
        '"public, max-age=0, s-maxage=2, stale-while-revalidate=2"',
      ),
    "Explore and public indexer payloads distinguish market-state from launch-discovery coverage",
  );

  check(
    "bitquery-market-provenance",
    routeSources
      .filter(({ id }) => id !== "token-list")
      .every(
        ({ source }) =>
          source.includes('"X-Programmable-Market-Source": "bitquery"') &&
          !source.includes('"X-Programmable-Rpc-Provider"'),
      ) &&
      routeSources
        .filter(({ id }) => ["explore", "token-detail"].includes(id))
        .every(
          ({ source }) =>
            source.includes("exploreLaunchSourceHeader({") &&
            source.includes("exploreReadSourceHeader({") &&
            source.includes("...sourceHeaders"),
        ) &&
      exploreConsumerSource.includes('return "operational+durable"') &&
      exploreConsumerSource.includes('return "last-known-good"') &&
      exploreConsumerSource.includes('"registry.custom-launched"') &&
      exploreConsumerSource.includes('?? "partial"') &&
      deployWorkflowSource.includes("Smoke staged Bitquery market APIs") &&
      deployWorkflowSource.includes(
        '"0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce"',
      ) &&
      deployWorkflowSource.includes(
        '"0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229"',
      ) &&
      deployWorkflowSource.includes(
        'goldenMarket?.schemaVersion !== "programmable.market-data.v1"',
      ) &&
      deployWorkflowSource.includes(
        'goldenChart.schemaVersion !== "programmable.market-chart.v1"',
      ) &&
      responseSource.includes('"X-Programmable-Read-Source": "blob"') &&
      responseSource.includes('"X-Programmable-Rpc-Provider": "alchemy"') &&
      responseSource.includes('"X-Programmable-Launch-Source": "alchemy"') &&
      responseSource.includes(
        '"X-Programmable-Launch-Source, X-Programmable-Read-Source, X-Programmable-Rpc-Provider"',
      ),
    "Registry-backed identities and Bitquery-only market responses expose separate source provenance",
  );

  return Object.freeze({
    ok: failures.length === 0,
    checks: Object.freeze(checks),
    failures: Object.freeze(failures),
  });
}

function main() {
  const result = evaluateAlchemyExploreSourceContracts(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
