import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createServer } from "vite";

import { createBootstrapPlan } from "./hosted-db-bootstrap-runtime.mjs";
import { loadEnvioCutoverIdentity } from "./cutover-envio.mjs";
import { runFencedRawBackfill } from "./cutover-phases.mjs";

const run = promisify(execFile);
const workspace = fileURLToPath(new URL("../../", import.meta.url));
const CUTOVER_CANDIDATES_PER_COMMIT = 4_096;
const CANDIDATE_ENDPOINT =
  "https://indexer.hyperindex.xyz/d7a39a2/v1/graphql";

async function gitCommit() {
  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: workspace });
  const commit = stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error("repository commit is invalid");
  return commit;
}

export async function loadCandidateRuntimeIdentity() {
  const identity = await loadEnvioCutoverIdentity({ workspace });
  const candidate = identity.candidate;
  if (
    candidate.endpoint !== CANDIDATE_ENDPOINT ||
    candidate.endpointId !== "d7a39a2" ||
    candidate.deploymentLabel !== "production-7f24e63" ||
    candidate.mirrorCommit !== "7ffd15c2a28c481a2d3632e30b315262c2471b2e"
  ) {
    throw new Error("reviewed Envio candidate identity is invalid");
  }
  return Object.freeze({
    endpoint: candidate.endpoint,
    endpointId: candidate.endpointId,
    mirrorCommit: candidate.mirrorCommit,
    redactedIdentity: `envio:${candidate.deploymentLabel}`,
  });
}

async function withRuntimeModules(operation) {
  const vite = await createServer({
    root: workspace,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
    ssr: { noExternal: ["server-only"] },
    plugins: [
      {
        name: "candidate-raw-backfill-server-only-boundary",
        enforce: "pre",
        resolveId(id) {
          return id === "server-only" ? "\0cutover-server-only" : null;
        },
        load(id) {
          return id === "\0cutover-server-only" ? "export {};" : null;
        },
      },
    ],
  });
  try {
    const [
      postgresModule,
      projectorStoreModule,
      leaseModule,
      envioModule,
      projectorModule,
      dualRpcModule,
      rpcModule,
      connectionModule,
      codecsModule,
    ] = await Promise.all([
      vite.ssrLoadModule("/lib/data-pipeline/postgres.ts"),
      vite.ssrLoadModule("/lib/data-pipeline/postgres-projector.ts"),
      vite.ssrLoadModule("/lib/data-pipeline/projector-runtime-lease.server.ts"),
      vite.ssrLoadModule("/lib/data-pipeline/envio.ts"),
      vite.ssrLoadModule("/lib/data-pipeline/projector.ts"),
      vite.ssrLoadModule("/lib/data-pipeline/dual-rpc.ts"),
      vite.ssrLoadModule("/lib/data-pipeline/rpc-providers.server.ts"),
      vite.ssrLoadModule("/lib/data-pipeline/postgres-connection.server.ts"),
      vite.ssrLoadModule("/lib/data-pipeline/codecs.ts"),
    ]);
    return await operation({
      postgresModule,
      projectorStoreModule,
      leaseModule,
      envioModule,
      projectorModule,
      dualRpcModule,
      rpcModule,
      connectionModule,
      codecsModule,
    });
  } finally {
    await vite.close();
  }
}

export function candidateGenesisAnchorBlock(bootstrap) {
  const starts = bootstrap?.releases?.flatMap((release) =>
    release?.sourceBindings?.map(({ inclusiveStartBlock }) => {
      const value = String(inclusiveStartBlock ?? "");
      if (!/^[1-9][0-9]*$/u.test(value)) {
        throw new Error("candidate release start block is invalid");
      }
      return BigInt(value);
    }) ?? []
  );
  if (!Array.isArray(starts) || starts.length < 1) {
    throw new Error("candidate release start blocks are unavailable");
  }
  const first = starts.reduce(
    (minimum, current) => current < minimum ? current : minimum,
  );
  if (first < 1n) throw new Error("candidate genesis anchor is invalid");
  return (first - 1n).toString();
}

export async function withCandidateRuntimeLease(input) {
  const acquired = await input.lease.tryAcquire();
  if (acquired.status !== "acquired" || !acquired.fence) {
    throw new Error("candidate raw backfill lease is busy");
  }
  let operationFailed = true;
  try {
    const result = await input.operation(acquired.fence);
    operationFailed = false;
    return result;
  } finally {
    const released = await input.lease
      .release(acquired.fence)
      .catch(() => false);
    if (!released && !operationFailed) {
      throw new Error("candidate raw backfill lease release failed");
    }
  }
}

function historicalCandidateCutoverIsRetired() {
  return true;
}

export async function runConfiguredCandidateRawBackfill(input) {
  if (historicalCandidateCutoverIsRetired()) {
    throw new Error(
      "historical candidate cutover is retired; use the canonical read-model release procedure",
    );
  }

  const environment = input.environment ?? process.env;
  const identity = await loadCandidateRuntimeIdentity();
  const commit = await gitCommit();
  const bootstrap = await createBootstrapPlan({
    repositoryCommit: commit,
    environment,
  });
  if (
    bootstrap.execution?.ready !== true ||
    bootstrap.execution?.targetDatabaseMode !== "candidate-only" ||
    bootstrap.candidateIsolation?.candidateEnvioIdentity !== identity.redactedIdentity
  ) {
    throw new Error("candidate bootstrap is not executable");
  }
  return withRuntimeModules(async (modules) => {
    const sslCaPem = modules.connectionModule.validatedPostgresSslCa(
      environment.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
    );
    const writerConnection =
      modules.connectionModule.validatedPostgresConnectionString(
        environment.PROGRAMMABLE_PROJECTOR_DATABASE_URL,
      );
    const runtimeConnection =
      modules.connectionModule.validatedPostgresConnectionString(
        environment.PROGRAMMABLE_PROJECTOR_RUNTIME_DATABASE_URL,
      );
    const providers = modules.rpcModule.createProductionDualRpcProviders(environment);
    modules.rpcModule.assertProductionDualRpcProviders(providers);
    const reviewedRpcBindings = bootstrap.providerBindings.filter(
      ({ providerType }) => providerType === "rpc_provider",
    );
    const providerBindings = Object.freeze(
      bootstrap.providerBindings
        .filter(({ providerType }) => providerType !== "uniswap_subgraph")
        .map((provider) => Object.freeze({
        type: provider.providerType,
        redactedIdentity: provider.redactedIdentity,
        deploymentCommitment: provider.deploymentCommitment,
        schemaCommitment: provider.schemaCommitment,
        })),
    );
    if (
      providerBindings.length !== 3 ||
      providerBindings[0]?.redactedIdentity !== identity.redactedIdentity ||
      reviewedRpcBindings[0]?.endpointUrlCommitment !== providers[0].endpointCommitment ||
      reviewedRpcBindings[1]?.endpointUrlCommitment !== providers[1].endpointCommitment
    ) {
      throw new Error("candidate provider bindings do not match runtime providers");
    }
    const releaseScopes = Object.freeze(
      bootstrap.releases.map(({ scope }) => Object.freeze({
        releaseId: scope.releaseId,
        modelId: scope.modelId,
        sourceGroup: scope.sourceGroup,
      })),
    );
    const anchorBlockNumber = candidateGenesisAnchorBlock(bootstrap);
    const runtimeExecutor = modules.postgresModule.createPostgresExecutor({
      connectionString: runtimeConnection,
      sslCaPem,
      maxConnections: 1,
      connectTimeoutMs: 2_000,
      idleTimeoutMs: 60_000,
    });
    const writerExecutor = modules.postgresModule.createPostgresExecutor({
      connectionString: writerConnection,
      sslCaPem,
      maxConnections: 1,
      connectTimeoutMs: 2_000,
      idleTimeoutMs: 60_000,
    });
    const lease = modules.leaseModule.createProjectorRuntimeLeaseController({
      executor: runtimeExecutor,
    });
    try {
      await withCandidateRuntimeLease({
        lease,
        operation: async (runtimeFence) => {
          const anchorBlock = await providers[0].client.getBlock({
            blockNumber: BigInt(anchorBlockNumber),
          });
          const anchorBlockHash = modules.codecsModule.canonicalBytes32(
            anchorBlock?.hash,
          );
          const safeHead = await modules.dualRpcModule.readDualRpcSafeHead({
            providers,
            cursor: { blockNumber: anchorBlockNumber, blockHash: anchorBlockHash },
          });
          await modules.projectorStoreModule.initializePostgresProjectorGenesis({
            executor: writerExecutor,
            providers: providerBindings,
            releaseScopes,
            runtimeFence,
            evidence: { anchorBlockNumber, anchorBlockHash, safeHead },
          });
        },
      });
      const envio = modules.envioModule.createEnvioClient({
        endpoint: identity.endpoint,
        token: environment.PROGRAMMABLE_ENVIO_GRAPHQL_TOKEN || undefined,
      });
      return await runFencedRawBackfill({
        candidateEndpointIdentity: "envio:d7a39a2",
        inspectFence: input.inspectFence,
        runRawCycle: () => withCandidateRuntimeLease({
          lease,
          operation: (runtimeFence) => {
            const store = modules.projectorStoreModule.createPostgresProjectorStore({
              executor: writerExecutor,
              providers: providerBindings,
              releaseScopes,
              runtimeFence,
            });
            return modules.projectorModule.runProjectorCycle({
              store,
              envio,
              providers,
              deadlineMs: 75_000,
              preferredCandidatesPerCommit:
                CUTOVER_CANDIDATES_PER_COMMIT,
            });
          },
        }),
        maximumCycles: input.maximumCycles,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
      });
    } finally {
      await Promise.allSettled([writerExecutor.close(), runtimeExecutor.close()]);
    }
  });
}

export const CANDIDATE_RUNTIME_ENDPOINT = CANDIDATE_ENDPOINT;
