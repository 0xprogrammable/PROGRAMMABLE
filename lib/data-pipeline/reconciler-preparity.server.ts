import "server-only";

import { dataPipelineError, invalidInput } from "./errors";
import { createPostgresExecutor } from "./postgres";
import { createPostgresReconcilerPreParityStore } from "./postgres-reconciler-store";
import {
  canonicalReconcilerCheckpointRequest,
  runReconcilerPreParityCycle,
  type ReconcilerCheckpointRequest,
  type ReconcilerCommitResult,
  type ReconcilerRouteDtoReader,
} from "./reconciler-preparity";
import { createProductionDualRpcProviders } from "./rpc-providers.server";

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

/**
 * Runs one exact-checkpoint cycle. Production callers must supply the reviewed
 * six-route live/indexed DTO implementation; there is deliberately no legacy
 * or indexed-view fallback.
 */
export async function runConfiguredReconcilerPreParity(input: {
  request: ReconcilerCheckpointRequest;
  routeDtoReader?: ReconcilerRouteDtoReader;
  env?: Environment;
}): Promise<ReconcilerCommitResult> {
  const request = canonicalReconcilerCheckpointRequest(input.request);
  const routeDtoReader = configuredRouteReader(input.routeDtoReader);
  const env = input.env ?? process.env;
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
