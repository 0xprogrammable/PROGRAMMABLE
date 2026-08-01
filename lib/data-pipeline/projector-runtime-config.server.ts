import "server-only";

import {
  assertCandidateDatabaseBootstrapState,
  assertCandidateDatabasePromotedState,
  selectProjectorRuntimeBinding,
  type ProjectorRuntimeBindingSelection,
} from "./candidate-projector-runtime-binding.server";
import { createEnvioClient } from "./envio";
import { invalidInput } from "./errors";
import { createPostgresExecutor } from "./postgres";
import {
  createPostgresReleaseProjectionStore,
  createPostgresProjectorStore,
  type ProjectorProviderDatabaseBinding,
  type ProjectorReleaseDatabaseScope,
} from "./postgres-projector";
import { runProjectorCycle } from "./projector";
import { runReleaseProjectionCycle } from "./projector-projection";
import { createProjectorRuntimeLeaseController } from "./projector-runtime-lease.server";
import {
  PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP,
  PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE,
  PROJECTOR_PREFERRED_CANDIDATES_PER_COMMIT,
  PROJECTOR_MAXIMUM_RUNTIME_ROUNDS,
} from "./projector-runtime-limits";
import {
  getDataPipelineReleaseBinding,
  type DataPipelineReleaseBinding,
} from "./release-binding.server";
import {
  canonicalProjectorEnvioEndpoint,
  projectorEnvioDeploymentCommitment,
  projectorEnvioSchemaCommitment,
  projectorRpcSchemaCommitment,
} from "./projector-provider-commitments";
import {
  assertProductionDualRpcProviders,
  createProductionDualRpcProviders,
  productionRpcProjectorCommitments,
} from "./rpc-providers.server";
import {
  validatedPostgresConnectionString,
  validatedPostgresSslCa,
} from "./postgres-connection.server";

type Environment = Readonly<Record<string, string | undefined>>;

const PROJECTOR_DEADLINE_MS = 75_000;
const INGESTION_DEADLINE_MS = 60_000;
const RELEASE_PROJECTION_DEADLINE_MS = 10_000;
const PROJECTOR_CLOSE_RESERVE_MS = 5_000;
const MINIMUM_OPERATION_DEADLINE_MS = 250;
const EXACT_RELEASE_SCOPES = Object.freeze([
  Object.freeze({ releaseId: "classic-v2", modelId: "classic", sourceGroup: "core" }),
  Object.freeze({ releaseId: "classic-v3", modelId: "classic", sourceGroup: "core" }),
  Object.freeze({ releaseId: "stock-paired-v1", modelId: "stock-paired", sourceGroup: "core" }),
  Object.freeze({ releaseId: "stock-paired-v2", modelId: "stock-paired", sourceGroup: "core" }),
  Object.freeze({ releaseId: "stock-paired-v3", modelId: "stock-paired", sourceGroup: "core" }),
] satisfies readonly ProjectorReleaseDatabaseScope[]);
const BROWSER_FORBIDDEN_NAMES = Object.freeze([
  "NEXT_PUBLIC_PROGRAMMABLE_PROJECTOR_ACTIVE",
  "NEXT_PUBLIC_PROGRAMMABLE_PROJECTOR_DATABASE_URL",
  "NEXT_PUBLIC_PROGRAMMABLE_PROJECTOR_RUNTIME_DATABASE_URL",
  "NEXT_PUBLIC_PROGRAMMABLE_POSTGRES_SSL_CA_PEM",
  "NEXT_PUBLIC_PROGRAMMABLE_ENVIO_GRAPHQL_TOKEN",
  "NEXT_PUBLIC_PROGRAMMABLE_PROJECTOR_BINDING_MODE",
  "NEXT_PUBLIC_PROGRAMMABLE_PROJECTOR_ENVIO_MIRROR_COMMIT",
] as const);

type StagedDynamicParentResult = Readonly<{
  status: "staged-dynamic-parent";
  candidateCount: number;
  snapshotBlock: string;
}>;

function parseStagedDynamicParentResult(
  value: unknown,
): StagedDynamicParentResult | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.status !== "staged-dynamic-parent") return null;
  if (
    typeof candidate.candidateCount !== "number" ||
    !Number.isSafeInteger(candidate.candidateCount) ||
    candidate.candidateCount < 1 ||
    candidate.candidateCount > PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP ||
    typeof candidate.snapshotBlock !== "string" ||
    !/^(?:0|[1-9]\d*)$/u.test(candidate.snapshotBlock) ||
    candidate.snapshotBlock.length > 78 ||
    Object.keys(candidate).length !== 3
  ) {
    return invalidRuntimeConfig();
  }
  return Object.freeze({
    status: "staged-dynamic-parent" as const,
    candidateCount: candidate.candidateCount,
    snapshotBlock: candidate.snapshotBlock,
  });
}

function invalidRuntimeConfig(): never {
  throw invalidInput("config", "projector-runtime-config");
}

export function projectorRuntimeActivationState(
  env: Environment = process.env,
): "active" | "disabled" {
  const value = env.PROGRAMMABLE_PROJECTOR_ACTIVE;
  if (value === undefined || value === "" || value === "false") {
    return "disabled";
  }
  if (value === "true") return "active";
  return invalidRuntimeConfig();
}

function requiredText(
  value: unknown,
  pattern: RegExp,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    !pattern.test(value)
  ) {
    return invalidRuntimeConfig();
  }
  return value;
}

function optionalSecret(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  return requiredText(value, /^[^\s]+$/u, 2_048);
}

function releaseScopes(
  binding: DataPipelineReleaseBinding,
): readonly ProjectorReleaseDatabaseScope[] {
  if (
    binding.releases.length !== EXACT_RELEASE_SCOPES.length ||
    binding.releases.some((release, index) => {
      const expected = EXACT_RELEASE_SCOPES[index]!;
      return (
        release.releaseVersion !== expected.releaseId ||
        release.model !== expected.modelId
      );
    })
  ) {
    return invalidRuntimeConfig();
  }
  return EXACT_RELEASE_SCOPES;
}

export type ProjectorRuntimeConfig = Readonly<{
  binding: ProjectorRuntimeBindingSelection;
  database: Readonly<{
    projectorConnectionString: string;
    runtimeConnectionString: string;
    sslCaPem: string;
  }>;
  envio: Readonly<{
    endpoint: string;
    token?: string;
    releaseBinding: DataPipelineReleaseBinding;
  }>;
  providers: readonly ProjectorProviderDatabaseBinding[];
  releaseScopes: readonly ProjectorReleaseDatabaseScope[];
}>;

export function assertProjectorRuntimeProviderCommitments(
  bindings: readonly ProjectorProviderDatabaseBinding[],
  providers: ReturnType<typeof createProductionDualRpcProviders>,
): void {
  if (
    bindings.length !== 3 ||
    providers.length !== 2 ||
    bindings[1]?.type !== "rpc_provider" ||
    bindings[2]?.type !== "rpc_provider" ||
    providers[0].vendorGroup !== "alchemy" ||
    providers[1].vendorGroup !== "quicknode" ||
    providers[0].endpointCommitment !== bindings[1].deploymentCommitment ||
    providers[1].endpointCommitment !== bindings[2].deploymentCommitment ||
    bindings[1].schemaCommitment !== projectorRpcSchemaCommitment() ||
    bindings[2].schemaCommitment !== projectorRpcSchemaCommitment()
  ) {
    return invalidRuntimeConfig();
  }
}

export function loadProjectorRuntimeConfigForBinding(
  env: Environment,
  canonicalBinding: DataPipelineReleaseBinding,
): ProjectorRuntimeConfig {
  if (BROWSER_FORBIDDEN_NAMES.some((name) => env[name])) {
    return invalidRuntimeConfig();
  }
  const selection = selectProjectorRuntimeBinding({
    env,
    canonicalBinding,
  });
  const binding = selection.releaseBinding;
  const envioEndpoint = canonicalProjectorEnvioEndpoint(
    env.PROGRAMMABLE_ENVIO_GRAPHQL_URL,
    binding.envio.graphqlEndpoint,
  );
  const envioIdentity = requiredText(
    env.PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY,
    /^[a-z0-9][a-z0-9._:/-]{0,127}$/u,
    128,
  );
  if (envioIdentity !== `envio:${binding.envio.deploymentLabel}`) {
    return invalidRuntimeConfig();
  }
  const rpcCommitments = productionRpcProjectorCommitments(env);
  const derivedCommitments = Object.freeze({
    envioDeployment: projectorEnvioDeploymentCommitment({
      endpoint: envioEndpoint,
      redactedIdentity: envioIdentity,
      binding,
    }),
    envioSchema: projectorEnvioSchemaCommitment(binding),
    alchemyDeployment: rpcCommitments.alchemy.deploymentCommitment,
    alchemySchema: rpcCommitments.alchemy.schemaCommitment,
    quicknodeDeployment: rpcCommitments.quicknode.deploymentCommitment,
    quicknodeSchema: rpcCommitments.quicknode.schemaCommitment,
  });
  const providers = Object.freeze([
    Object.freeze({
      type: "envio_deployment" as const,
      redactedIdentity: envioIdentity,
      deploymentCommitment: derivedCommitments.envioDeployment,
      schemaCommitment: derivedCommitments.envioSchema,
    }),
    Object.freeze({
      type: "rpc_provider" as const,
      redactedIdentity: "rpc:1:alchemy",
      deploymentCommitment: derivedCommitments.alchemyDeployment,
      schemaCommitment: derivedCommitments.alchemySchema,
    }),
    Object.freeze({
      type: "rpc_provider" as const,
      redactedIdentity: "rpc:1:quicknode",
      deploymentCommitment: derivedCommitments.quicknodeDeployment,
      schemaCommitment: derivedCommitments.quicknodeSchema,
    }),
  ] satisfies readonly ProjectorProviderDatabaseBinding[]);

  return Object.freeze({
    binding: selection,
    database: Object.freeze({
      projectorConnectionString: validatedPostgresConnectionString(
        env.PROGRAMMABLE_PROJECTOR_DATABASE_URL,
      ),
      runtimeConnectionString: validatedPostgresConnectionString(
        env.PROGRAMMABLE_PROJECTOR_RUNTIME_DATABASE_URL,
      ),
      sslCaPem: validatedPostgresSslCa(
        env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
      ),
    }),
    envio: Object.freeze({
      endpoint: envioEndpoint,
      token: optionalSecret(env.PROGRAMMABLE_ENVIO_GRAPHQL_TOKEN),
      releaseBinding: binding,
    }),
    providers,
    releaseScopes: releaseScopes(binding),
  });
}

export function loadProjectorRuntimeConfig(
  env: Environment = process.env,
): ProjectorRuntimeConfig {
  return loadProjectorRuntimeConfigForBinding(
    env,
    getDataPipelineReleaseBinding(),
  );
}

export type ProjectorRuntimeDependencies = Readonly<{
  createExecutor: typeof createPostgresExecutor;
  createLeaseController: typeof createProjectorRuntimeLeaseController;
  createProviders: typeof createProductionDualRpcProviders;
  assertProviders: typeof assertProductionDualRpcProviders;
  createEnvio: typeof createEnvioClient;
  createStore: typeof createPostgresProjectorStore;
  createReleaseStore: typeof createPostgresReleaseProjectionStore;
  runCycle: typeof runProjectorCycle;
  runReleaseCycle: typeof runReleaseProjectionCycle;
  assertCandidateDatabase: typeof assertCandidateDatabaseBootstrapState;
  assertPromotedDatabase: typeof assertCandidateDatabasePromotedState;
  loadConfig?: typeof loadProjectorRuntimeConfig;
}>;

const DEFAULT_DEPENDENCIES: ProjectorRuntimeDependencies = Object.freeze({
  createExecutor: createPostgresExecutor,
  createLeaseController: createProjectorRuntimeLeaseController,
  createProviders: createProductionDualRpcProviders,
  assertProviders: assertProductionDualRpcProviders,
  createEnvio: createEnvioClient,
  createStore: createPostgresProjectorStore,
  createReleaseStore: createPostgresReleaseProjectionStore,
  runCycle: runProjectorCycle,
  runReleaseCycle: runReleaseProjectionCycle,
  assertCandidateDatabase: assertCandidateDatabaseBootstrapState,
  assertPromotedDatabase: assertCandidateDatabasePromotedState,
});

export async function runConfiguredProjectorCycle(
  input: Readonly<{
    env?: Environment;
    dependencies?: ProjectorRuntimeDependencies;
    ingestionOnly?: boolean;
    preferredCandidatesPerCommit?: number;
  }> = {},
) {
  const env = input.env ?? process.env;
  const dependencies = input.dependencies ?? DEFAULT_DEPENDENCIES;
  const ingestionOnly = input.ingestionOnly === true;
  const preferredCandidatesPerCommit =
    input.preferredCandidatesPerCommit ??
    PROJECTOR_PREFERRED_CANDIDATES_PER_COMMIT;
  if (
    input.ingestionOnly !== undefined &&
      typeof input.ingestionOnly !== "boolean" ||
    !Number.isSafeInteger(preferredCandidatesPerCommit) ||
    preferredCandidatesPerCommit <
      PROJECTOR_PREFERRED_CANDIDATES_PER_COMMIT ||
    preferredCandidatesPerCommit >
      PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP ||
    preferredCandidatesPerCommit %
      PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE !== 0 ||
    (!ingestionOnly &&
      input.preferredCandidatesPerCommit !== undefined)
  ) {
    return invalidRuntimeConfig();
  }
  if (projectorRuntimeActivationState(env) === "disabled") {
    return Object.freeze({
      ok: true as const,
      status: "disabled" as const,
      readiness: Object.freeze({
        status: "disabled" as const,
        activationReady: false as const,
        lagging: true as const,
      }),
    });
  }
  const config = dependencies.loadConfig
    ? dependencies.loadConfig(env)
    : loadProjectorRuntimeConfig(env);
  const runtimeExecutor = dependencies.createExecutor({
    connectionString: config.database.runtimeConnectionString,
    sslCaPem: config.database.sslCaPem,
    maxConnections: 1,
    connectTimeoutMs: 2_000,
    idleTimeoutMs: 60_000,
  });
  const leaseController = dependencies.createLeaseController({
    executor: runtimeExecutor,
  });
  let executor: ReturnType<typeof createPostgresExecutor> | null = null;
  let acquiredFence: Awaited<
    ReturnType<typeof leaseController.tryAcquire>
  >["fence"];
  try {
    const acquisition = await leaseController.tryAcquire();
    if (acquisition.status === "busy") {
      return Object.freeze({
        ok: true as const,
        status: "busy" as const,
        readiness: Object.freeze({
          status: "busy" as const,
          activationReady: false as const,
          lagging: true as const,
        }),
      });
    }
    if (!acquisition.fence) return invalidRuntimeConfig();
    const runtimeFence = acquisition.fence;
    acquiredFence = runtimeFence;
    const writerExecutor = dependencies.createExecutor({
      connectionString: config.database.projectorConnectionString,
      sslCaPem: config.database.sslCaPem,
      maxConnections: 1,
      connectTimeoutMs: 2_000,
      idleTimeoutMs: 60_000,
    });
    executor = writerExecutor;
    if (config.binding.candidate) {
      await dependencies.assertCandidateDatabase({
        executor: writerExecutor,
        binding: config.binding.candidate,
      });
    } else if (config.binding.promotedDatabase) {
      await dependencies.assertPromotedDatabase({
        executor: writerExecutor,
        binding: config.binding.promotedDatabase,
      });
    }
    const providers = dependencies.createProviders(env);
    dependencies.assertProviders(providers);
    assertProjectorRuntimeProviderCommitments(config.providers, providers);
    const envio = dependencies.createEnvio(config.envio);
    const startedAt = Date.now();
    const remainingRuntimeMs = () =>
      PROJECTOR_DEADLINE_MS - (Date.now() - startedAt);
    const operationDeadline = (operationsRemainingInRound: number) => {
      if (
        !Number.isSafeInteger(operationsRemainingInRound) ||
        operationsRemainingInRound < 1
      ) {
        return invalidRuntimeConfig();
      }
      const available = remainingRuntimeMs() - PROJECTOR_CLOSE_RESERVE_MS;
      const fairShare = Math.floor(available / operationsRemainingInRound);
      if (fairShare < MINIMUM_OPERATION_DEADLINE_MS) return null;
      return Math.min(
        RELEASE_PROJECTION_DEADLINE_MS,
        fairShare,
      );
    };
    const ingestionOperationDeadline = () => {
      const available = remainingRuntimeMs() - PROJECTOR_CLOSE_RESERVE_MS;
      if (available < MINIMUM_OPERATION_DEADLINE_MS) return null;
      return Math.min(INGESTION_DEADLINE_MS, available);
    };
    const ingestionStore = dependencies.createStore({
      executor: writerExecutor,
      providers: config.providers,
      releaseScopes: config.releaseScopes,
      runtimeFence,
    });
    const releaseStores = config.releaseScopes.map((scope) =>
      Object.freeze({
        scope,
        store: dependencies.createReleaseStore({
          executor: writerExecutor,
          providers: config.providers,
          rpcEvidenceBindings: [
            {
              identity: providers[0].identity,
              vendorGroup: providers[0].vendorGroup,
              endpointCommitment: providers[0].endpointCommitment,
              endpointOriginCommitment:
                providers[0].endpointOriginCommitment,
            },
            {
              identity: providers[1].identity,
              vendorGroup: providers[1].vendorGroup,
              endpointCommitment: providers[1].endpointCommitment,
              endpointOriginCommitment:
                providers[1].endpointOriginCommitment,
            },
          ] as const,
          scope,
          runtimeFence,
        }),
      }),
    );
    const ingestionState: {
      failed: boolean;
      committed: boolean;
      committedEmpty: boolean;
      stagedDynamicParent: boolean;
      candidateCount: number;
      pageCount: number;
      snapshotBlock: string | null;
      generation: string | null;
      processedAtomicGroup: boolean;
    } = {
      failed: false,
      committed: false,
      committedEmpty: false,
      stagedDynamicParent: false,
      candidateCount: 0,
      pageCount: 0,
      snapshotBlock: null,
      generation: null,
      processedAtomicGroup: false,
    };
    const projectionStates = config.releaseScopes.map((scope) => ({
      releaseId: scope.releaseId,
      failed: false,
      committed: false,
      projectedCandidateCount: 0,
      ignoredCandidateCount: 0,
      pageCount: 0,
      checkpointGeneration: null as string | null,
      processedAtomicGroup: false,
    }));
    let madeAnyProgress = false;
    let terminalSweepComplete = false;
    let completedRounds = 0;
    let stoppedForDeadline = false;

    for (
      let round = 0;
      round < PROJECTOR_MAXIMUM_RUNTIME_ROUNDS;
      round += 1
    ) {
      const operationCount = ingestionOnly ? 1 : 1 + releaseStores.length;
      if (operationDeadline(operationCount) === null) {
        stoppedForDeadline = true;
        break;
      }
      let madeProgress = false;
      let operationsRemaining = operationCount;
      let ingestionIdle = false;
      let stagedDynamicParent = false;
      let stopAfterIngestionFailure = false;
      let idleProjectionCount = 0;

      const ingestionDeadline = ingestionOperationDeadline();
      if (ingestionDeadline === null) {
        stoppedForDeadline = true;
        break;
      }
      let observedIngestionStatus: unknown = null;
      try {
        const result = await dependencies.runCycle({
          store: ingestionStore,
          envio,
          providers,
          deadlineMs: ingestionDeadline,
          preferredCandidatesPerCommit,
        });
        observedIngestionStatus = result.status;
        const stagedResult = parseStagedDynamicParentResult(result);
        if (stagedResult) {
          ingestionState.pageCount += 1;
          ingestionState.snapshotBlock = stagedResult.snapshotBlock;
          ingestionState.candidateCount += stagedResult.candidateCount;
          ingestionState.stagedDynamicParent = true;
          stagedDynamicParent = true;
          madeProgress = true;
        } else {
          if (
            !Number.isSafeInteger(result.candidateCount) ||
            result.candidateCount < 0 ||
            result.candidateCount >
              PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP
          ) {
            return invalidRuntimeConfig();
          }
          ingestionState.pageCount += 1;
          ingestionState.snapshotBlock = result.snapshotBlock;
          ingestionState.candidateCount += result.candidateCount;
          ingestionState.processedAtomicGroup ||=
            result.candidateCount > PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE;
          if (result.status === "committed") {
            ingestionState.committed = true;
            ingestionState.generation = result.generation;
            madeProgress = true;
          } else if (result.status === "committed-empty") {
            ingestionState.committedEmpty = true;
            ingestionState.generation = result.generation;
            madeProgress = true;
          } else {
            ingestionIdle = true;
          }
        }
      } catch {
        ingestionState.failed = true;
        stopAfterIngestionFailure =
          observedIngestionStatus === "staged-dynamic-parent";
      }
      operationsRemaining -= 1;

      if (stagedDynamicParent || stopAfterIngestionFailure) {
        // The parent and its child must be replayed from the unchanged source
        // cursor on the next invocation. Running release projections here
        // would materialize against a cursor/checkpoint that did not advance.
        completedRounds += 1;
        if (stagedDynamicParent) madeAnyProgress = true;
        terminalSweepComplete = false;
        break;
      }

      if (ingestionOnly) {
        completedRounds += 1;
        if (madeProgress) madeAnyProgress = true;
        terminalSweepComplete = false;
        break;
      }

      for (let index = 0; index < releaseStores.length; index += 1) {
        const binding = releaseStores[index]!;
        const state = projectionStates[index]!;
        if (state.processedAtomicGroup) {
          // An atomic group is intentionally the last unit processed for this
          // release in one invocation. It is deferred, not proven idle, so it
          // must keep the terminal sweep and activation readiness false.
          operationsRemaining -= 1;
          continue;
        }
        const deadline = operationDeadline(operationsRemaining);
        if (deadline === null) {
          stoppedForDeadline = true;
          break;
        }
        try {
          const result = await dependencies.runReleaseCycle({
            store: binding.store,
            envio,
            providers,
            deadlineMs: deadline,
          });
          const projectedCandidateCount =
            result.status === "committed"
              ? result.projectedCandidateCount
              : 0;
          const ignoredCandidateCount =
            result.status === "committed"
              ? result.ignoredCandidateCount
              : 0;
          const maximumResultCount =
            result.status === "committed" &&
              (result.batchKind ?? "normal") !== "normal"
              ? PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP
              : PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE;
          if (
            !Number.isSafeInteger(projectedCandidateCount) ||
            projectedCandidateCount < 0 ||
            !Number.isSafeInteger(ignoredCandidateCount) ||
            ignoredCandidateCount < 0 ||
            projectedCandidateCount + ignoredCandidateCount >
              maximumResultCount
          ) {
            return invalidRuntimeConfig();
          }
          state.pageCount += 1;
          if (result.status === "committed") {
            state.committed = true;
            state.projectedCandidateCount += result.projectedCandidateCount;
            state.ignoredCandidateCount += result.ignoredCandidateCount;
            state.checkpointGeneration = result.checkpointGeneration;
            state.processedAtomicGroup =
              (result.batchKind ?? "normal") !== "normal";
            madeProgress = true;
          } else {
            idleProjectionCount += 1;
          }
        } catch {
          state.failed = true;
        }
        operationsRemaining -= 1;
      }

      if (stoppedForDeadline) break;
      completedRounds += 1;
      terminalSweepComplete =
        ingestionIdle && idleProjectionCount === releaseStores.length;
      if (madeProgress) madeAnyProgress = true;

      if (terminalSweepComplete || !madeProgress) break;
      if (
        ingestionState.failed ||
        projectionStates.some(({ failed }) => failed)
      ) {
        break;
      }
      if (ingestionState.processedAtomicGroup) {
        // One oversized exact block is the final ingestion unit for this
        // invocation. Remaining normal pages are deferred to the next lease.
        terminalSweepComplete = false;
        break;
      }
    }

    if (
      !ingestionState.failed &&
      (ingestionState.pageCount < 1 ||
        ingestionState.snapshotBlock === null ||
        ((ingestionState.committed || ingestionState.committedEmpty) &&
          ingestionState.generation === null))
    ) {
      ingestionState.failed = true;
    }
    for (const state of projectionStates) {
      if (state.committed && state.checkpointGeneration === null) {
        state.failed = true;
      }
    }

    const ingestion = ingestionState.failed
      ? Object.freeze({ status: "failed" as const })
      : ingestionState.stagedDynamicParent
        ? Object.freeze({
            status: "staged-dynamic-parent" as const,
            candidateCount: ingestionState.candidateCount,
            pageCount: ingestionState.pageCount,
            snapshotBlock: ingestionState.snapshotBlock,
            atomicGroupCount: 1 as const,
          })
        : ingestionState.committed
        ? Object.freeze({
            status: "committed" as const,
            candidateCount: ingestionState.candidateCount,
            pageCount: ingestionState.pageCount,
            snapshotBlock: ingestionState.snapshotBlock,
            generation: ingestionState.generation,
            ...(ingestionState.processedAtomicGroup
              ? { atomicGroupCount: 1 as const }
              : {}),
          })
        : ingestionState.committedEmpty
          ? Object.freeze({
              status: "committed-empty" as const,
              candidateCount: 0,
              pageCount: ingestionState.pageCount,
              snapshotBlock: ingestionState.snapshotBlock,
              generation: ingestionState.generation,
            })
          : Object.freeze({
              status: "idle" as const,
              candidateCount: 0,
              pageCount: ingestionState.pageCount,
              snapshotBlock: ingestionState.snapshotBlock,
            });
    const projections = projectionStates.map((state) => {
      if (state.failed) {
        return Object.freeze({
          releaseId: state.releaseId,
          status: "failed" as const,
        });
      }
      if (!state.committed) {
        if (
          (ingestionOnly || ingestionState.stagedDynamicParent) &&
          state.pageCount === 0
        ) {
          return Object.freeze({
            releaseId: state.releaseId,
            status: "deferred" as const,
            pageCount: 0,
          });
        }
        return Object.freeze({
          releaseId: state.releaseId,
          status: "idle" as const,
          pageCount: state.pageCount,
        });
      }
      return Object.freeze({
        releaseId: state.releaseId,
        status: "committed" as const,
        projectedCandidateCount: state.projectedCandidateCount,
        ignoredCandidateCount: state.ignoredCandidateCount,
        pageCount: state.pageCount,
        checkpointGeneration: state.checkpointGeneration,
        ...(state.processedAtomicGroup ? { atomicGroupCount: 1 } : {}),
      });
    });
    const failed =
      ingestion.status === "failed" ||
      projections.some(({ status }) => status === "failed");
    const readinessStatus = failed
      ? "incomplete" as const
      : terminalSweepComplete
        ? "caught-up" as const
        : madeAnyProgress
          ? "progressed" as const
          : "incomplete" as const;
    const readiness = Object.freeze({
      status: readinessStatus,
      activationReady: readinessStatus === "caught-up",
      lagging: readinessStatus !== "caught-up",
      terminalSweepComplete,
      stoppedForDeadline,
      completedRounds,
      snapshotBlock: ingestionState.snapshotBlock,
    });
    return Object.freeze({
      ok: !failed,
      ingestion,
      projections: Object.freeze(projections),
      readiness,
      deadlineMs: PROJECTOR_DEADLINE_MS,
    });
  } finally {
    if (acquiredFence) {
      try {
        await leaseController.release(acquiredFence);
      } catch {
        // The database lease expires independently. Every writer transaction is
        // fenced, so release remains a best-effort latency optimization.
      }
    }
    if (executor) await executor.close();
    await runtimeExecutor.close();
  }
}
