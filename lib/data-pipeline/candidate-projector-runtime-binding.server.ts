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

const CURRENT_PRODUCTION = Object.freeze({
  deploymentLabel: "production-92f6373",
  endpoint: "https://indexer.hyperindex.xyz/f6714ef/v1/graphql",
  redactedIdentity: "envio:production-92f6373",
  sourceCommit: "92f63731ff0a61601a649cf40ceba3e492f63c62",
  mirrorCommit: "0a064ec0a32a0e48bf6751fa18f025504267c6b7",
  configSha256:
    "0x133099a107e8d9c91aea1f0e811dbcc179fae8cf35919e612df7139deab3ee6a",
  schemaSha256:
    "0xdf3d65e033e96d7ebbe62b6f114b6a30f10c8944e5c6fca6b020c3130bb738c0",
  handlerSha256:
    "0xa14f0d3bd93d8be1b329467786b40dd465ce71751298fb04a6b97886a1a781fe",
  sourceRegistrySha256:
    "0x7bad14df06e48c8fb0a439bd17b26c2949c475a7c5b58507e5f8514bf92d605a",
  eventSetSha256:
    "0xe5a88608068d4c84582cc63de55cbf386fa7f36b201722a39164eb4af61de95f",
  eventCount: 66,
} as const);

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
    "0xe3218e30a2a95927427fe5e523a8f721fa0d7826dffaecb7140a126a56d17a44",
  initializedAt: "2026-08-01T09:00:00.000Z",
} as const);

const ZERO_BYTES32 = `0x${"00".repeat(32)}`;

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

export type CandidateDatabasePromotionBinding = Readonly<{
  providerDeploymentId: string;
  deploymentCommitment: HexBytes32;
  schemaCommitment: HexBytes32;
  initializationInputCommitment: HexBytes32;
  initializedAt: string;
  productCommit: string;
  stagedDeploymentId: string;
}>;

export type DatabasePhysicalIdentity = Readonly<{
  databaseName: string;
  systemIdentifier: string;
}>;

export type ProjectorRuntimeBindingSelection =
  | Readonly<{
      mode: typeof CANDIDATE_PROJECTOR_RUNTIME_MODE;
      releaseBinding: DataPipelineReleaseBinding;
      candidate: CandidateProjectorRuntimeBinding;
      promotedDatabase: null;
    }>
  | Readonly<{
      mode: "release";
      releaseBinding: DataPipelineReleaseBinding;
      candidate: null;
      promotedDatabase: CandidateDatabasePromotionBinding | null;
    }>;

function isExactCandidateReleaseBinding(
  binding: DataPipelineReleaseBinding,
): boolean {
  const envio = binding.envio;
  return (
    envio.deploymentLabel === EXACT.deploymentLabel &&
    envio.graphqlEndpoint === EXACT.endpoint &&
    envio.schemaVersion === "1" &&
    envio.sourceCommit === EXACT.sourceCommit &&
    envio.configSha256 === EXACT.configSha256 &&
    envio.schemaSha256 === EXACT.schemaSha256 &&
    envio.handlerSha256 === EXACT.handlerSha256 &&
    envio.sourceRegistrySha256 === EXACT.sourceRegistrySha256 &&
    envio.eventSetSha256 === EXACT.eventSetSha256 &&
    envio.eventCount === EXACT.eventCount
  );
}

function isExactCurrentProductionReleaseBinding(
  binding: DataPipelineReleaseBinding,
): boolean {
  const envio = binding.envio;
  return (
    envio.deploymentLabel === CURRENT_PRODUCTION.deploymentLabel &&
    envio.graphqlEndpoint === CURRENT_PRODUCTION.endpoint &&
    envio.schemaVersion === "1" &&
    envio.sourceCommit === CURRENT_PRODUCTION.sourceCommit &&
    envio.configSha256 === CURRENT_PRODUCTION.configSha256 &&
    envio.schemaSha256 === CURRENT_PRODUCTION.schemaSha256 &&
    envio.handlerSha256 === CURRENT_PRODUCTION.handlerSha256 &&
    envio.sourceRegistrySha256 ===
      CURRENT_PRODUCTION.sourceRegistrySha256 &&
    envio.eventSetSha256 === CURRENT_PRODUCTION.eventSetSha256 &&
    envio.eventCount === CURRENT_PRODUCTION.eventCount
  );
}

function candidateReleaseBinding(
  activeProductionBinding: DataPipelineReleaseBinding,
): DataPipelineReleaseBinding {
  if (isExactCandidateReleaseBinding(activeProductionBinding)) {
    return activeProductionBinding;
  }
  if (
    !isExactCurrentProductionReleaseBinding(activeProductionBinding) &&
    (activeProductionBinding.envio.deploymentLabel !==
      EXACT.activeProductionLabel ||
      activeProductionBinding.envio.graphqlEndpoint !==
        EXACT.activeProductionEndpoint)
  ) {
    return invalidCandidateBinding();
  }
  return Object.freeze({
    ...activeProductionBinding,
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
}

function nonzeroBytes32(value: unknown): HexBytes32 {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-f]{64}$/u.test(value) ||
    value === ZERO_BYTES32
  ) {
    return invalidCandidateBinding();
  }
  return value as HexBytes32;
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 32) {
    return invalidCandidateBinding();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    return invalidCandidateBinding();
  }
  return value;
}

function loadCandidateDatabasePromotionBinding(
  env: Environment,
): CandidateDatabasePromotionBinding {
  const productCommit = env.VERCEL_GIT_COMMIT_SHA;
  const stagedDeploymentId = env.VERCEL_DEPLOYMENT_ID;
  if (
    typeof productCommit !== "string" ||
    !/^[0-9a-f]{40}$/u.test(productCommit) ||
    productCommit === "0".repeat(40) ||
    typeof stagedDeploymentId !== "string" ||
    !/^dpl_[A-Za-z0-9]{20,128}$/u.test(stagedDeploymentId)
  ) {
    return invalidCandidateBinding();
  }
  return Object.freeze({
    providerDeploymentId: EXACT.providerDeploymentId,
    deploymentCommitment: nonzeroBytes32(EXACT.deploymentCommitment),
    schemaCommitment: nonzeroBytes32(EXACT.schemaCommitment),
    initializationInputCommitment: nonzeroBytes32(
      EXACT.initializationInputCommitment,
    ),
    initializedAt: canonicalTimestamp(EXACT.initializedAt),
    productCommit,
    stagedDeploymentId,
  });
}

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
    (!isExactCandidateReleaseBinding(input.activeProductionBinding) &&
      !isExactCurrentProductionReleaseBinding(
        input.activeProductionBinding,
      ) &&
      (input.activeProductionBinding.envio.deploymentLabel !==
        EXACT.activeProductionLabel ||
        input.activeProductionBinding.envio.graphqlEndpoint !==
          EXACT.activeProductionEndpoint))
  ) {
    return invalidCandidateBinding();
  }

  const releaseBinding = candidateReleaseBinding(input.activeProductionBinding);

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

export function selectProjectorRuntimeBinding(input: Readonly<{
  env: Environment;
  canonicalBinding: DataPipelineReleaseBinding;
}>): ProjectorRuntimeBindingSelection {
  const mode = input.env.PROGRAMMABLE_PROJECTOR_BINDING_MODE;
  if (mode === CANDIDATE_PROJECTOR_RUNTIME_MODE) {
    const candidate = loadCandidateProjectorRuntimeBinding({
      env: input.env,
      activeProductionBinding: input.canonicalBinding,
    });
    return Object.freeze({
      mode: CANDIDATE_PROJECTOR_RUNTIME_MODE,
      releaseBinding: candidate.releaseBinding,
      candidate,
      promotedDatabase: null,
    });
  }
  if (mode !== undefined && mode !== "" && mode !== "release") {
    return invalidCandidateBinding();
  }
  if (isExactCurrentProductionReleaseBinding(input.canonicalBinding)) {
    if (
      input.env.PROGRAMMABLE_PROJECTOR_ENVIO_MIRROR_COMMIT !==
        CURRENT_PRODUCTION.mirrorCommit ||
      input.env.PROGRAMMABLE_ENVIO_GRAPHQL_URL !==
        CURRENT_PRODUCTION.endpoint ||
      input.env.PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY !==
        CURRENT_PRODUCTION.redactedIdentity
    ) {
      return invalidCandidateBinding();
    }
    return Object.freeze({
      mode: "release" as const,
      releaseBinding: input.canonicalBinding,
      candidate: null,
      promotedDatabase: null,
    });
  }
  if (!isExactCandidateReleaseBinding(input.canonicalBinding)) {
    if (
      input.canonicalBinding.envio.deploymentLabel !==
        EXACT.activeProductionLabel ||
      input.canonicalBinding.envio.graphqlEndpoint !==
        EXACT.activeProductionEndpoint
    ) {
      return invalidCandidateBinding();
    }
    return Object.freeze({
      mode: "release" as const,
      releaseBinding: input.canonicalBinding,
      candidate: null,
      promotedDatabase: null,
    });
  }
  if (
    input.env.PROGRAMMABLE_PROJECTOR_ENVIO_MIRROR_COMMIT !==
      EXACT.mirrorCommit ||
    input.env.PROGRAMMABLE_ENVIO_GRAPHQL_URL !== EXACT.endpoint ||
    input.env.PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY !==
      EXACT.redactedIdentity
  ) {
    return invalidCandidateBinding();
  }
  return Object.freeze({
    mode: "release" as const,
    releaseBinding: input.canonicalBinding,
    candidate: null,
    promotedDatabase: loadCandidateDatabasePromotionBinding(input.env),
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

export async function assertCandidateDatabasePromotedState(input: Readonly<{
  executor: PostgresExecutor;
  binding: CandidateDatabasePromotionBinding;
}>): Promise<DatabasePhysicalIdentity> {
  return input.executor.transaction(async (transaction) => {
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
      "select programmable_private.verify_candidate_database_promoted_v2($1::uuid, $2::bytea, $3::bytea, $4::bytea, $5::timestamptz, $6::text, $7::text) as verified",
      [
        input.binding.providerDeploymentId,
        hexToBytes(input.binding.deploymentCommitment),
        hexToBytes(input.binding.schemaCommitment),
        hexToBytes(input.binding.initializationInputCommitment),
        input.binding.initializedAt,
        input.binding.productCommit,
        input.binding.stagedDeploymentId,
      ],
    );
    if (rows.length !== 1 || rows[0]?.verified !== true) {
      return invalidCandidateBinding();
    }
    const identityRows = await transaction.query<{
      database_name: unknown;
      system_identifier: unknown;
    }>(
      `select
         pg_catalog.current_database()::text as database_name,
         ((pg_catalog.pg_control_system()).system_identifier)::text
           as system_identifier`,
    );
    const databaseName = identityRows[0]?.database_name;
    const systemIdentifier = identityRows[0]?.system_identifier;
    if (
      identityRows.length !== 1 ||
      typeof databaseName !== "string" ||
      !/^[a-z][a-z0-9_]{0,62}$/u.test(databaseName) ||
      typeof systemIdentifier !== "string" ||
      !/^[1-9]\d{0,19}$/u.test(systemIdentifier) ||
      BigInt(systemIdentifier) > 18_446_744_073_709_551_615n
    ) {
      return invalidCandidateBinding();
    }
    return Object.freeze({ databaseName, systemIdentifier });
  });
}
