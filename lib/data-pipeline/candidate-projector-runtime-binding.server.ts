import "server-only";

import candidateJson from "../../config/data-pipeline-envio-candidate.v1.json";
import { hexToBytes, type HexBytes32 } from "./codecs";
import { invalidInput } from "./errors";
import type { PostgresExecutor } from "./postgres";
import {
  projectorEnvioDeploymentCommitment,
  projectorEnvioSchemaCommitment,
} from "./projector-provider-commitments";
import type { DataPipelineReleaseBinding } from "./release-binding.server";

type Environment = Readonly<Record<string, string | undefined>>;

export const CANDIDATE_PROJECTOR_RUNTIME_MODE = "candidate-backfill";

const PUBLIC_INDEXED_FLAGS = Object.freeze([
  "INDEXED_EXPLORE_LIST_READS_ENABLED",
  "INDEXED_EXPLORE_TOKEN_READS_ENABLED",
  "INDEXED_EXPLORE_CHART_READS_ENABLED",
  "INDEXED_CREATOR_PROFILE_READS_ENABLED",
  "INDEXED_CLASSIC_V3_PROFILE_READS_ENABLED",
  "INDEXED_LAUNCH_LOOKUP_ENABLED",
  "INDEXED_PUBLIC_INDEXER_FEED_READS_ENABLED",
  "INDEXED_READ_SHADOW_COMPARE_ENABLED",
] as const);

const EXACT = Object.freeze({
  activeProductionLabel: "production-1e7c381",
  activeProductionEndpoint:
    "https://indexer.hyperindex.xyz/f6714ef/v1/graphql",
  deploymentLabel: "production-7f24e63",
  endpoint: "https://indexer.hyperindex.xyz/d7a39a2/v1/graphql",
  redactedIdentity: "envio:production-7f24e63",
  sourceCommit: "7f24e6380d5cf17092f5ade7cbad678465e3ef95",
  mirrorCommit: "7ffd15c2a28c481a2d3632e30b315262c2471b2e",
  configSha256:
    "0x378e3a799c762cb31107792c7123f5f90b54b5826884c398995e7465176fe1c2",
  schemaSha256:
    "0xdf3d65e033e96d7ebbe62b6f114b6a30f10c8944e5c6fca6b020c3130bb738c0",
  handlerSha256:
    "0x9f68d05cc8907f1c422cb2584b338ed42375eb4b6033cbec1338d00577267491",
  sourceRegistrySha256:
    "0x55e7a7c7cd0e419a6be0f9c784990f5048b9845e46e329939025c3fab405565a",
  eventSetSha256:
    "0x7481d6fa986d706e46b9834e40574dd84f21be80b041d35e7d47dbfa59d69243",
  eventCount: 51,
  deploymentCommitment:
    "0xa4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259",
  schemaCommitment:
    "0x5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1",
  providerDeploymentId: "d08b62a6-74fb-5e0a-a698-dc6877150db4",
  initializationInputCommitment:
    "0x8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9",
  initializedAt: "2026-08-01T09:00:00.000Z",
} as const);

function invalidCandidateBinding(): never {
  throw invalidInput("config", "candidate-projector-runtime-binding");
}

function assertReviewedCandidateConfig(): void {
  if (
    candidateJson.schemaVersion !== 1 ||
    candidateJson.status !== "deployed-synced-audited-not-promoted" ||
    candidateJson.deploymentLabel !== EXACT.deploymentLabel ||
    candidateJson.graphqlEndpoint !== EXACT.endpoint ||
    candidateJson.sourceCommit !== EXACT.sourceCommit ||
    candidateJson.configSha256 !== EXACT.configSha256 ||
    candidateJson.schemaSha256 !== EXACT.schemaSha256 ||
    candidateJson.handlerSha256 !== EXACT.handlerSha256 ||
    candidateJson.sourceRegistrySha256 !== EXACT.sourceRegistrySha256 ||
    candidateJson.eventSetSha256 !== EXACT.eventSetSha256 ||
    candidateJson.eventCount !== EXACT.eventCount ||
    candidateJson.redactedIdentity !== EXACT.redactedIdentity ||
    candidateJson.deploymentCommitment !== EXACT.deploymentCommitment ||
    candidateJson.schemaCommitment !== EXACT.schemaCommitment ||
    candidateJson.policy.databaseMode !== "candidate-only" ||
    candidateJson.policy.legacyProductionDeploymentRegistered !== false ||
    candidateJson.policy.publicationAllowedBeforePromotion !== false ||
    candidateJson.policy.promotion !== "atomic-attestation-required"
  ) {
    return invalidCandidateBinding();
  }
}

export type CandidateProjectorRuntimeBinding = Readonly<{
  mode: typeof CANDIDATE_PROJECTOR_RUNTIME_MODE;
  releaseBinding: DataPipelineReleaseBinding;
  mirrorCommit: string;
  databaseBootstrap: Readonly<{
    mode: "candidate-only";
    providerDeploymentId: string;
    deploymentCommitment: HexBytes32;
    schemaCommitment: HexBytes32;
    initializationInputCommitment: HexBytes32;
    initializedAt: string;
  }>;
  promotionTransition: Readonly<{
    requiredRuntimeMode: "release";
    requiredCanonicalEndpoint: string;
    requiredCanonicalIdentity: string;
    requiresDatabasePromotionAttestation: true;
  }>;
}>;

export function loadCandidateProjectorRuntimeBinding(input: Readonly<{
  env: Environment;
  activeProductionBinding: DataPipelineReleaseBinding;
}>): CandidateProjectorRuntimeBinding {
  assertReviewedCandidateConfig();
  if (
    input.env.PROGRAMMABLE_PROJECTOR_BINDING_MODE !==
      CANDIDATE_PROJECTOR_RUNTIME_MODE ||
    input.env.PROGRAMMABLE_PROJECTOR_ENVIO_MIRROR_COMMIT !==
      EXACT.mirrorCommit ||
    input.env.PROGRAMMABLE_ENVIO_GRAPHQL_URL !== EXACT.endpoint ||
    input.env.PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY !==
      EXACT.redactedIdentity ||
    PUBLIC_INDEXED_FLAGS.some((name) => input.env[name] !== "false") ||
    input.activeProductionBinding.envio.deploymentLabel !==
      EXACT.activeProductionLabel ||
    input.activeProductionBinding.envio.graphqlEndpoint !==
      EXACT.activeProductionEndpoint
  ) {
    return invalidCandidateBinding();
  }

  const releaseBinding = Object.freeze({
    ...input.activeProductionBinding,
    envio: Object.freeze({
      deploymentLabel: EXACT.deploymentLabel,
      graphqlEndpoint: EXACT.endpoint,
      schemaVersion: "1" as const,
      sourceCommit: EXACT.sourceCommit,
      configSha256: EXACT.configSha256,
      schemaSha256: EXACT.schemaSha256,
      handlerSha256: EXACT.handlerSha256,
      sourceRegistrySha256: EXACT.sourceRegistrySha256,
      eventSetSha256: EXACT.eventSetSha256,
      eventCount: EXACT.eventCount,
    }),
  }) satisfies DataPipelineReleaseBinding;

  if (
    projectorEnvioDeploymentCommitment({
      endpoint: EXACT.endpoint,
      redactedIdentity: EXACT.redactedIdentity,
      binding: releaseBinding,
    }) !== EXACT.deploymentCommitment ||
    projectorEnvioSchemaCommitment(releaseBinding) !== EXACT.schemaCommitment
  ) {
    return invalidCandidateBinding();
  }

  return Object.freeze({
    mode: CANDIDATE_PROJECTOR_RUNTIME_MODE,
    releaseBinding,
    mirrorCommit: EXACT.mirrorCommit,
    databaseBootstrap: Object.freeze({
      mode: "candidate-only" as const,
      providerDeploymentId: EXACT.providerDeploymentId,
      deploymentCommitment: EXACT.deploymentCommitment,
      schemaCommitment: EXACT.schemaCommitment,
      initializationInputCommitment: EXACT.initializationInputCommitment,
      initializedAt: EXACT.initializedAt,
    }),
    promotionTransition: Object.freeze({
      requiredRuntimeMode: "release" as const,
      requiredCanonicalEndpoint: EXACT.endpoint,
      requiredCanonicalIdentity: EXACT.redactedIdentity,
      requiresDatabasePromotionAttestation: true as const,
    }),
  });
}

export async function assertCandidateDatabaseBootstrapState(input: Readonly<{
  executor: PostgresExecutor;
  binding: CandidateProjectorRuntimeBinding;
}>): Promise<void> {
  if (
    input.binding.mode !== CANDIDATE_PROJECTOR_RUNTIME_MODE ||
    input.binding.releaseBinding.envio.graphqlEndpoint !== EXACT.endpoint ||
    input.binding.releaseBinding.envio.deploymentLabel !== EXACT.deploymentLabel ||
    input.binding.databaseBootstrap.mode !== "candidate-only" ||
    input.binding.databaseBootstrap.providerDeploymentId !==
      EXACT.providerDeploymentId ||
    input.binding.databaseBootstrap.deploymentCommitment !==
      EXACT.deploymentCommitment ||
    input.binding.databaseBootstrap.schemaCommitment !==
      EXACT.schemaCommitment ||
    input.binding.databaseBootstrap.initializationInputCommitment !==
      EXACT.initializationInputCommitment ||
    input.binding.databaseBootstrap.initializedAt !== EXACT.initializedAt
  ) {
    return invalidCandidateBinding();
  }
  await input.executor.transaction(async (transaction) => {
    const login = await transaction.query<{ session_user: unknown }>(
      "select session_user::text as session_user",
    );
    if (
      login.length !== 1 ||
      login[0]?.session_user !== "programmable_projector_login"
    ) {
      return invalidCandidateBinding();
    }
    await transaction.query("set local role programmable_projector");
    await transaction.query("set local statement_timeout = '1000ms'");
    await transaction.query("set local lock_timeout = '250ms'");
    const role = await transaction.query<{
      session_user: unknown;
      current_role: unknown;
    }>(
      "select session_user::text as session_user, current_role::text as current_role",
    );
    if (
      role.length !== 1 ||
      role[0]?.session_user !== "programmable_projector_login" ||
      role[0]?.current_role !== "programmable_projector"
    ) {
      return invalidCandidateBinding();
    }
    const rows = await transaction.query<{ verified: unknown }>(
      "select programmable_private.verify_candidate_database_unpromoted_v1($1::uuid, $2::bytea, $3::bytea, $4::bytea, $5::timestamptz) as verified",
      [
        input.binding.databaseBootstrap.providerDeploymentId,
        hexToBytes(input.binding.databaseBootstrap.deploymentCommitment),
        hexToBytes(input.binding.databaseBootstrap.schemaCommitment),
        hexToBytes(input.binding.databaseBootstrap.initializationInputCommitment),
        input.binding.databaseBootstrap.initializedAt,
      ],
    );
    if (rows.length !== 1 || rows[0]?.verified !== true) {
      return invalidCandidateBinding();
    }
  });
}
