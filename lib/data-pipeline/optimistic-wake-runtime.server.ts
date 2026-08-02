import "server-only";

import { readIndexedFeedSnapshot } from "../../app/api/indexers/v1/read-indexed-feed.server";
import {
  assertCandidateDatabaseBootstrapState,
  assertCandidateDatabasePromotedState,
} from "./candidate-projector-runtime-binding.server";
import { hexToBytes } from "./codecs";
import { invalidInput } from "./errors";
import {
  createOptimisticFirstStage,
  createOptimisticLiveWriter,
  type OptimisticPersistenceBundle,
  type OptimisticProviderDeploymentBinding,
} from "./optimistic-live-runtime.server";
import { createPostgresExecutor, type PostgresExecutor } from "./postgres";
import { validatedPostgresConnectionTarget } from "./postgres-connection.server";
import { createProjectorDatabaseGateway } from "./postgres-projector";
import {
  assertProjectorRuntimeProviderCommitments,
  loadProjectorRuntimeConfig,
  projectorRuntimeActivationState,
} from "./projector-runtime-config.server";
import {
  assertProductionDualRpcProviders,
  createProductionDualRpcProviders,
  productionRpcEndpointEvidence,
} from "./rpc-providers.server";
import {
  captureRealBlockSlaPublicObservations,
  createConfiguredRealBlockSlaCaptureStore,
  type RealBlockSlaCaptureStageState,
  type RealBlockSlaCaptureStore,
  type RealBlockSlaCaptureTarget,
} from "./read-model-real-block-sla-capture.server";
import {
  parseQuickNodeBlockHint,
  type QuickNodeStreamBlockHint,
} from "./quicknode-stream-wake.server";
import type { QuickNodeWakeClaim } from "./quicknode-wake-queue.server";

type Environment = Readonly<Record<string, string | undefined>>;

function fail(): never {
  throw invalidInput("config", "optimistic-wake-runtime");
}

function exactUuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  ) return fail();
  return value;
}

function sameHint(left: QuickNodeStreamBlockHint, right: QuickNodeStreamBlockHint) {
  return left.chainId === right.chainId &&
    left.blockNumber === right.blockNumber &&
    left.streamId === right.streamId &&
    JSON.stringify(left.reorgedBlockNumbers) === JSON.stringify(right.reorgedBlockNumbers);
}

export function createRealBlockSlaFirstStageHooks<T>(input: Readonly<{
  deliveryReceiptId: string | null;
  stageState(deliveryReceiptId: string): Promise<RealBlockSlaCaptureStageState>;
  record(bundle: T): Promise<void>;
  capture(target: RealBlockSlaCaptureTarget): Promise<void>;
}>) {
  const enabled = input.deliveryReceiptId !== null;
  return Object.freeze({
    enabled,
    record: (bundle: T) => enabled ? input.record(bundle) : Promise.resolve(),
    async finishCaptureIfReady(): Promise<boolean> {
      if (!enabled) return false;
      const state = await input.stageState(input.deliveryReceiptId!);
      if (state.state === "needs-ingest") return false;
      if (state.state === "needs-capture") await input.capture(state.target);
      return true;
    },
  });
}

export async function runRealBlockSlaAwareFirstStage<T>(input: Readonly<{
  sla: ReturnType<typeof createRealBlockSlaFirstStageHooks<T>>;
  ingest(): Promise<Readonly<{ bundle: T }>>;
}>): Promise<"capture-resumed" | "ingested"> {
  if (input.sla.enabled && await input.sla.finishCaptureIfReady()) {
    return "capture-resumed";
  }
  const result = await input.ingest();
  await input.sla.record(result.bundle);
  if (input.sla.enabled && !(await input.sla.finishCaptureIfReady())) return fail();
  return "ingested";
}

async function providerDeploymentBindings(input: Readonly<{
  executor: PostgresExecutor;
  config: ReturnType<typeof loadProjectorRuntimeConfig>;
  providers: ReturnType<typeof createProductionDualRpcProviders>;
}>): Promise<readonly [OptimisticProviderDeploymentBinding, OptimisticProviderDeploymentBinding]> {
  const gateway = createProjectorDatabaseGateway({ executor: input.executor });
  const scope = input.config.releaseScopes[0]!;
  const ids = await gateway.transaction(async (transaction) => {
    const rows = await transaction.query<{
      provider_deployment_ids: unknown;
      provider_types: unknown;
      provider_redacted_identities: unknown;
    }>(
      "select * from programmable_private.get_projector_runtime_state_v1($1, $2, $3, $4, $5, $6::text[], $7::text[], $8::bytea[], $9::bytea[])",
      [
        "1",
        scope.releaseId,
        scope.modelId,
        scope.sourceGroup,
        "projector-v1",
        input.config.providers.map(({ type }) => type),
        input.config.providers.map(({ redactedIdentity }) => redactedIdentity),
        input.config.providers.map(({ deploymentCommitment }) => hexToBytes(deploymentCommitment)),
        input.config.providers.map(({ schemaCommitment }) => hexToBytes(schemaCommitment)),
      ],
    );
    const row = rows[0];
    if (
      rows.length !== 1 || !Array.isArray(row?.provider_deployment_ids) ||
      !Array.isArray(row.provider_types) || !Array.isArray(row.provider_redacted_identities) ||
      row.provider_deployment_ids.length !== 3 ||
      JSON.stringify(row.provider_types) !== JSON.stringify(input.config.providers.map(({ type }) => type)) ||
      JSON.stringify(row.provider_redacted_identities) !== JSON.stringify(input.config.providers.map(({ redactedIdentity }) => redactedIdentity))
    ) return fail();
    return row.provider_deployment_ids.map(exactUuid);
  });
  if (new Set(ids).size !== 3) return fail();
  return Object.freeze([
    Object.freeze({
      providerDeploymentId: ids[1]!,
      providerIdentity: input.providers[0].identity,
      endpointCommitment: input.providers[0].endpointCommitment,
      originCommitment: input.providers[0].endpointOriginCommitment,
    }),
    Object.freeze({
      providerDeploymentId: ids[2]!,
      providerIdentity: input.providers[1].identity,
      endpointCommitment: input.providers[1].endpointCommitment,
      originCommitment: input.providers[1].endpointOriginCommitment,
    }),
  ]);
}

export async function recordSlaReceipts(input: Readonly<{
  executor: PostgresExecutor;
  wakeId: string;
  bundle: OptimisticPersistenceBundle;
  env: Environment;
}>): Promise<void> {
  const blockHeads = input.bundle.providerHeadObservations;
  const logsCommitment = input.bundle.logsCommitment;
  if (!blockHeads || !logsCommitment || input.bundle.marketStates.length < 1) return fail();
  const endpoints = productionRpcEndpointEvidence(input.env);
  const gateway = createProjectorDatabaseGateway({ executor: input.executor });
  await gateway.transaction(async (transaction) => {
    const rows = await transaction.query<{ bundle_receipt_id: unknown }>(
      `select programmable_wake_private.record_optimistic_sla_receipt_group_v1(
         $1::bigint, $2::uuid, $3::bytea, $4::text, $5::text,
         $6::bigint, $7::bytea, $8::timestamptz,
         $9::bigint, $10::bytea, $11::timestamptz, $12::smallint, $13::smallint,
         $14::smallint, $15::smallint, $16::jsonb
       ) as bundle_receipt_id`,
      [
        input.wakeId,
        input.bundle.optimisticBlockId,
        hexToBytes(logsCommitment),
        endpoints[0].endpointHost,
        endpoints[1].endpointHost,
        blockHeads[0].blockNumber,
        hexToBytes(blockHeads[0].blockHash),
        new Date(blockHeads[0].observedAt),
        blockHeads[1].blockNumber,
        hexToBytes(blockHeads[1].blockHash),
        new Date(blockHeads[1].observedAt),
        input.bundle.providerCallCounts[0],
        input.bundle.providerCallCounts[1],
        input.bundle.metadataProviderCallCounts[0],
        input.bundle.metadataProviderCallCounts[1],
        JSON.stringify(input.bundle.marketStates.map((state) => {
          const heads = state.providerHeadObservations;
          if (!heads) return fail();
          return {
            optimisticMarketStateId: state.optimisticMarketStateId,
            marketProviderAHead: heads[0].blockNumber,
            marketProviderAHeadHash: heads[0].blockHash,
            marketProviderAObservedAt: heads[0].observedAt,
            marketProviderBHead: heads[1].blockNumber,
            marketProviderBHeadHash: heads[1].blockHash,
            marketProviderBObservedAt: heads[1].observedAt,
            marketProviderCallCountA: state.marketProviderCallCounts[0],
            marketProviderCallCountB: state.marketProviderCallCounts[1],
            totalProviderCallCountA: state.totalProviderCallCounts[0],
            totalProviderCallCountB: state.totalProviderCallCounts[1],
          };
        })),
      ],
    );
    if (
      rows.length !== 1 ||
      (typeof rows[0]?.bundle_receipt_id !== "bigint" &&
        typeof rows[0]?.bundle_receipt_id !== "string")
    ) return fail();
  });
}

/** Creates a lazy, one-job configured stage. Every executor is closed per job. */
export function createConfiguredOptimisticWakeFirstStage(
  env: Environment = process.env,
) {
  return async function configuredOptimisticWakeFirstStage(job: QuickNodeWakeClaim) {
    if (projectorRuntimeActivationState(env) !== "active") return fail();
    let parsed: QuickNodeStreamBlockHint;
    try {
      parsed = parseQuickNodeBlockHint(JSON.parse(job.payload));
    } catch {
      return fail();
    }
    if (!sameHint(parsed, job.hint) || parsed.blockNumber !== job.blockNumberHint) return fail();
    const config = loadProjectorRuntimeConfig(env);
    const target = validatedPostgresConnectionTarget(config.database.projectorConnectionString);
    const executor = createPostgresExecutor({
      connectionString: config.database.projectorConnectionString,
      sslCaPem: config.database.sslCaPem,
      allowInsecureLoopback: target.isLoopback,
      maxConnections: 1,
      connectTimeoutMs: 2_000,
      idleTimeoutMs: 60_000,
    });
    let captureStore: RealBlockSlaCaptureStore | null = null;
    try {
      if (config.binding.candidate) {
        await assertCandidateDatabaseBootstrapState({
          executor,
          binding: config.binding.candidate,
        });
      } else if (config.binding.promotedDatabase) {
        await assertCandidateDatabasePromotedState({
          executor,
          binding: config.binding.promotedDatabase,
        });
      } else {
        return fail();
      }
      if (job.deliveryReceiptId !== null) {
        captureStore = createConfiguredRealBlockSlaCaptureStore(env);
      }
      const sla = createRealBlockSlaFirstStageHooks({
        deliveryReceiptId: job.deliveryReceiptId,
        stageState: (deliveryReceiptId) => {
          if (!captureStore) return fail();
          return captureStore.stageState(deliveryReceiptId);
        },
        record: (bundle: OptimisticPersistenceBundle) => recordSlaReceipts({
          executor,
          wakeId: job.wakeId,
          bundle,
          env,
        }),
        capture: (captureTarget) => {
          if (!captureStore) return fail();
          return captureRealBlockSlaPublicObservations({
            deliveryReceiptId: captureTarget.deliveryReceiptId,
            target: captureTarget,
            store: captureStore,
            env,
          });
        },
      });
      await runRealBlockSlaAwareFirstStage({
        sla,
        ingest: async () => {
          const providers = createProductionDualRpcProviders(env);
          assertProductionDualRpcProviders(providers);
          assertProjectorRuntimeProviderCommitments(config.providers, providers);
          const deployments = await providerDeploymentBindings({
            executor,
            config,
            providers,
          });
          const stage = createOptimisticFirstStage({
            providers,
            providerDeployments: deployments,
            writer: createOptimisticLiveWriter({ executor }),
            loadCanonicalTokens: async () =>
              (await readIndexedFeedSnapshot()).model.tokens,
            hardDeadlineMs: 7_000,
            ensureTrackedMarket: sla.enabled,
          });
          return stage.ingest({ hint: parsed });
        },
      });
    } finally {
      if (captureStore) await captureStore.close();
      await executor.close();
    }
  };
}
