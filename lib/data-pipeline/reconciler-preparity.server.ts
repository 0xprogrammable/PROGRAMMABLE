import "server-only";

import { buildClassicV2ExactBlockContribution } from "./classic-v2-reconciler-route-builder.server";
import { dataPipelineError, invalidInput } from "./errors";
import { assembleReconcilerRoutesFromContributions } from "./classic-v3-reconciler-route-contract";
import { buildClassicV3ExactBlockRoutes } from "./classic-v3-reconciler-route-builder.server";
import { createPostgresExecutor } from "./postgres";
import { createPostgresReconcilerPreParityStore } from "./postgres-reconciler-store";
import { createPostgresReconcilerRouteCorpusStore } from "./postgres-reconciler-route-corpus-store";
import {
  createExactBlockReconcilerRouteDtoReader,
  type ExactBlockRouteBuilder,
} from "./reconciler-exact-block-reader.server";
import {
  canonicalReconcilerCheckpointRequest,
  runReconcilerPreParityCycle,
  type ReconcilerCheckpointRequest,
  type ReconcilerCommitResult,
  type ReconcilerRouteDtoReader,
} from "./reconciler-preparity";
import { createProductionDualRpcProviders } from "./rpc-providers.server";
import {
  buildStockPairedV1ExactBlockContribution,
  buildStockPairedV2ExactBlockContribution,
  buildStockPairedV3ExactBlockContribution,
  type StockPairedExactBlockContributionBuilder,
} from "./stock-paired-reconciler-route-builder.server";

type Environment = Readonly<Record<string, string | undefined>>;

function configuredRouteReader(
  routeDtoReader: ReconcilerRouteDtoReader | undefined,
): ReconcilerRouteDtoReader {
  if (!routeDtoReader) {
    // The exact-block route builders must be wired explicitly. Falling back to
    // an existing public view would manufacture parity from the indexed side.
    throw dataPipelineError({
      dependency: "uniswap",
      code: "dependency_unavailable",
      retryable: false,
      countsTowardCircuit: false,
      metadata: { operation: "reconciler-route-reader-unconfigured" },
    });
  }
  return routeDtoReader;
}

function requiredEnvironmentValue(
  value: string | undefined,
  operation: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidInput("config", operation);
  }
  return value;
}

function stockPairedExactBlockRoutes(
  builder: StockPairedExactBlockContributionBuilder,
): ExactBlockRouteBuilder {
  return async (input) =>
    assembleReconcilerRoutesFromContributions([await builder(input)]);
}

const buildStockPairedV1ExactBlockRoutes = stockPairedExactBlockRoutes(
  buildStockPairedV1ExactBlockContribution,
);
const buildStockPairedV2ExactBlockRoutes = stockPairedExactBlockRoutes(
  buildStockPairedV2ExactBlockContribution,
);
const buildStockPairedV3ExactBlockRoutes = stockPairedExactBlockRoutes(
  buildStockPairedV3ExactBlockContribution,
);
const buildClassicV2ExactBlockRoutes: ExactBlockRouteBuilder = async (input) =>
  assembleReconcilerRoutesFromContributions([
    await buildClassicV2ExactBlockContribution(input),
  ]);

function configuredExactBlockRouteBuilder(
  releaseId: string,
  modelId: string,
): ExactBlockRouteBuilder | undefined {
  if (modelId === "classic" && releaseId === "classic-v2") {
    return buildClassicV2ExactBlockRoutes;
  }
  if (modelId === "classic" && releaseId === "classic-v3") {
    return buildClassicV3ExactBlockRoutes;
  }
  if (modelId !== "stock-paired") return undefined;
  if (releaseId === "stock-paired-v1") {
    return buildStockPairedV1ExactBlockRoutes;
  }
  if (releaseId === "stock-paired-v2") {
    return buildStockPairedV2ExactBlockRoutes;
  }
  if (releaseId === "stock-paired-v3") {
    return buildStockPairedV3ExactBlockRoutes;
  }
  return undefined;
}

/**
 * Runs one exact-checkpoint cycle. Production callers must supply the reviewed
 * applicable-route live/indexed DTO implementation; there is deliberately no
 * legacy or indexed-view fallback.
 */
export async function runConfiguredReconcilerPreParity(input: {
  request: ReconcilerCheckpointRequest;
  routeDtoReader?: ReconcilerRouteDtoReader;
  exactBlockRouteBuilder?: ExactBlockRouteBuilder;
  env?: Environment;
}): Promise<ReconcilerCommitResult> {
  const request = canonicalReconcilerCheckpointRequest(input.request);
  const env = input.env ?? process.env;
  const exactBlockRouteBuilder = input.exactBlockRouteBuilder ??
    configuredExactBlockRouteBuilder(request.releaseId, request.modelId);
  if (!input.routeDtoReader && !exactBlockRouteBuilder) {
    configuredRouteReader(undefined);
  }
  const executor = createPostgresExecutor({
    connectionString: requiredEnvironmentValue(
      env.PROGRAMMABLE_RECONCILER_DATABASE_URL,
      "reconciler-database-url",
    ),
    sslCaPem: requiredEnvironmentValue(
      env.PROGRAMMABLE_RECONCILER_DATABASE_SSL_CA,
      "reconciler-database-ca",
    ),
    maxConnections: 1,
    connectTimeoutMs: 1_000,
    idleTimeoutMs: 5_000,
  });
  try {
    const routeDtoReader = input.routeDtoReader ??
      createExactBlockReconcilerRouteDtoReader({
        env,
        indexedStore: createPostgresReconcilerRouteCorpusStore({ executor }),
        buildLiveRoutes: exactBlockRouteBuilder!,
      });
    return await runReconcilerPreParityCycle({
      request,
      store: createPostgresReconcilerPreParityStore({ executor }),
      providers: createProductionDualRpcProviders(env),
      routeDtoReader,
      deadlineMs: 75_000,
    });
  } finally {
    await executor.close();
  }
}
