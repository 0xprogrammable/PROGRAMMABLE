import "server-only";

import { randomUUID } from "node:crypto";

import { encodeAbiParameters, keccak256, toBytes } from "viem";

import {
  canonicalFingerprintPreimageV1,
  canonicalFingerprintV1,
  type CanonicalJsonValue,
} from "./canonical-fingerprint";
import {
  addressFromBytea,
  bytes32FromBytea,
  canonicalAddress,
  canonicalBytes32,
  dataFromBytea,
  hexToBytes,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
} from "./codecs";
import type {
  CandidateRpcProvider,
  DualRpcCandidateWindowEvidence,
  DualRpcRewardSnapshot,
} from "./dual-rpc";
import type { EnvioCandidate } from "./envio";
import { DataPipelineError } from "./errors";
import type {
  PostgresExecutor,
  PostgresTransaction,
} from "./postgres";
import type { ProjectorPlan, ProjectorStore } from "./projector";
import type {
  ReleaseProjectionPlan,
  ReleaseProjectionStore,
  StoredProjectionCandidate,
  VerifiedReleaseProjection,
} from "./projector-projection";
import type {
  ProjectorCompletedLaunch,
  ProjectorEventFact,
  ProjectorKnownPool,
  ProjectorOccurrenceFact,
} from "./projector-fold";
import {
  canonicalDynamicSourceLineage,
  type VerifiedDynamicSourceLineage,
} from "./projector-identities";
import { deterministicProjectorUuid as deterministicUuid } from "./projector-ids";
import {
  foldProjectorRewardState,
  type ProjectorRewardBaseline,
  type ProjectorRewardEvent,
  type ProjectorRewardModel,
  type ProjectorRewardSnapshot,
} from "./projector-reward-fold";
import {
  expectedRewardRpcCallCount,
  PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1,
} from "./projector-reward-rpc-contract";
import {
  PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP,
  PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE,
} from "./projector-runtime-limits";
import {
  projectionExecutionTraceCommitmentV1,
  providerEvidenceV2,
  providerEvidenceV3,
} from "./provider-evidence";

const PROJECTOR_LOGIN_ROLE = "programmable_projector_login";
const PROJECTOR_CAPABILITY_ROLE = "programmable_projector";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ENVIO_CONTROL_SCOPE = Object.freeze({
  chainId: "1",
  releaseId: "envio-control",
  modelId: "envio-control",
  sourceGroup: "canonical-events",
  projectorVersion: "envio-adapter-v1",
});

export type ProjectorProviderDatabaseBinding = Readonly<{
  type: "rpc_provider" | "envio_deployment" | "uniswap_subgraph";
  redactedIdentity: string;
  deploymentCommitment: HexBytes32;
  schemaCommitment: HexBytes32;
}>;

export type ProjectorReleaseDatabaseScope = Readonly<{
  releaseId:
    | "classic-v2"
    | "classic-v3"
    | "stock-paired-v1"
    | "stock-paired-v2"
    | "stock-paired-v3";
  modelId: string;
  sourceGroup: string;
}>;

export type ProjectorRuntimeFence = Readonly<{
  holderId: string;
  generation: string;
  tokenHash: HexBytes32;
}>;

const PROJECTOR_RELEASE_SCOPES = Object.freeze([
  Object.freeze({ releaseId: "classic-v2", modelId: "classic", sourceGroup: "core" }),
  Object.freeze({ releaseId: "classic-v3", modelId: "classic", sourceGroup: "core" }),
  Object.freeze({ releaseId: "stock-paired-v1", modelId: "stock-paired", sourceGroup: "core" }),
  Object.freeze({ releaseId: "stock-paired-v2", modelId: "stock-paired", sourceGroup: "core" }),
  Object.freeze({ releaseId: "stock-paired-v3", modelId: "stock-paired", sourceGroup: "core" }),
] satisfies readonly ProjectorReleaseDatabaseScope[]);

function canonicalReleaseScopes(
  scopes: readonly ProjectorReleaseDatabaseScope[],
): readonly ProjectorReleaseDatabaseScope[] {
  if (
    !Array.isArray(scopes) ||
    scopes.length !== PROJECTOR_RELEASE_SCOPES.length ||
    scopes.some((scope, index) => {
      const expected = PROJECTOR_RELEASE_SCOPES[index]!;
      return (
        scope?.releaseId !== expected.releaseId ||
        scope.modelId !== expected.modelId ||
        scope.sourceGroup !== expected.sourceGroup
      );
    })
  ) {
    return projectorValidationFailure();
  }
  return PROJECTOR_RELEASE_SCOPES;
}

function canonicalReleaseScope(
  scope: ProjectorReleaseDatabaseScope,
): ProjectorReleaseDatabaseScope {
  const expected = PROJECTOR_RELEASE_SCOPES.find(
    ({ releaseId }) => releaseId === scope?.releaseId,
  );
  if (
    !expected ||
    scope.modelId !== expected.modelId ||
    scope.sourceGroup !== expected.sourceGroup
  ) {
    return projectorValidationFailure();
  }
  return expected;
}

function canonicalRuntimeFence(
  fence: ProjectorRuntimeFence,
): ProjectorRuntimeFence {
  return Object.freeze({
    holderId: exactText(
      fence?.holderId,
      /^[a-z0-9][a-z0-9._-]{0,95}$/u,
      96,
    ),
    generation: integerText(fence?.generation),
    tokenHash: canonicalBytes32(fence?.tokenHash),
  });
}

async function assertRuntimeFence(
  transaction: PostgresTransaction,
  fence: ProjectorRuntimeFence,
): Promise<void> {
  const rows = await transaction.query<{ asserted: unknown }>(
    "select programmable_private.assert_projector_runtime_lease_v1($1, $2::bigint, $3::bytea) as asserted",
    [fence.holderId, fence.generation, hexToBytes(fence.tokenHash)],
  );
  if (rows.length !== 1 || rows[0]?.asserted !== true) {
    throw new ProjectorDatabaseError({
      sqlState: "40001",
      disposition: "retry-serialization",
      retryable: true,
    });
  }
}

export type ProjectorSqlStateScope =
  | "batch"
  | "candidate-local"
  | "dynamic-parent"
  | "gateway";

export type ProjectorSqlDisposition =
  | "retry-serialization"
  | "transient-no-candidate-penalty"
  | "fatal-gateway-membership"
  | "fatal-codec-or-caller"
  | "immutable-replay-conflict"
  | "quarantine-candidate"
  | "abort-batch-invariant"
  | "defer-dynamic-parent"
  | "fatal-integrity"
  | "idempotence-reread"
  | "fatal-unknown";

export type ProjectorSqlClassification = Readonly<{
  sqlState: string | null;
  disposition: ProjectorSqlDisposition;
  retryable: boolean;
}>;

function canonicalSqlState(value: unknown): string | null {
  return typeof value === "string" && /^[0-9A-Z]{5}$/u.test(value)
    ? value
    : null;
}

export function classifyProjectorSqlState(input: {
  sqlState: unknown;
  scope: ProjectorSqlStateScope;
}): ProjectorSqlClassification {
  const sqlState = canonicalSqlState(input.sqlState);
  if (sqlState === "40001" || sqlState === "40P01") {
    return Object.freeze({
      sqlState,
      disposition: "retry-serialization",
      retryable: true,
    });
  }
  if (
    sqlState === "55P03" ||
    sqlState === "57014" ||
    sqlState === "57P01" ||
    sqlState?.startsWith("08")
  ) {
    return Object.freeze({
      sqlState,
      disposition: "transient-no-candidate-penalty",
      retryable: true,
    });
  }
  if (sqlState === "42501" || input.scope === "gateway") {
    return Object.freeze({
      sqlState,
      disposition: "fatal-gateway-membership",
      retryable: false,
    });
  }
  if (sqlState === "22023" || sqlState === "22P02" || sqlState === "22003") {
    return Object.freeze({
      sqlState,
      disposition: "fatal-codec-or-caller",
      retryable: false,
    });
  }
  if (sqlState === "23505") {
    return Object.freeze({
      sqlState,
      disposition: "immutable-replay-conflict",
      retryable: false,
    });
  }
  if (sqlState === "23514") {
    return Object.freeze({
      sqlState,
      disposition:
        input.scope === "candidate-local"
          ? "quarantine-candidate"
          : "abort-batch-invariant",
      retryable: false,
    });
  }
  if (sqlState === "23503") {
    return Object.freeze({
      sqlState,
      disposition:
        input.scope === "dynamic-parent"
          ? "defer-dynamic-parent"
          : "fatal-integrity",
      retryable: input.scope === "dynamic-parent",
    });
  }
  if (sqlState === "55000") {
    return Object.freeze({
      sqlState,
      disposition: "idempotence-reread",
      retryable: true,
    });
  }
  return Object.freeze({
    sqlState,
    disposition: "fatal-unknown",
    retryable: false,
  });
}

function sqlStateFromUnknown(error: unknown): unknown {
  if (error === null || typeof error !== "object") return null;
  return Reflect.get(error, "code");
}

export class ProjectorDatabaseError extends Error {
  readonly sqlState: string | null;
  readonly disposition: ProjectorSqlDisposition;
  readonly retryable: boolean;

  constructor(classification: ProjectorSqlClassification) {
    super("Projector database operation failed");
    this.name = "ProjectorDatabaseError";
    this.sqlState = classification.sqlState;
    this.disposition = classification.disposition;
    this.retryable = classification.retryable;
  }

  static fromUnknown(
    error: unknown,
    scope: ProjectorSqlStateScope,
  ): ProjectorDatabaseError {
    if (error instanceof ProjectorDatabaseError) return error;
    return new ProjectorDatabaseError(
      classifyProjectorSqlState({
        sqlState: sqlStateFromUnknown(error),
        scope,
      }),
    );
  }

  toJSON() {
    return {
      name: this.name,
      sqlState: this.sqlState,
      disposition: this.disposition,
      retryable: this.retryable,
    };
  }
}

function gatewayIdentityFailure(): ProjectorDatabaseError {
  return new ProjectorDatabaseError(
    classifyProjectorSqlState({ sqlState: null, scope: "gateway" }),
  );
}

async function assertGatewayLogin(
  transaction: PostgresTransaction,
): Promise<void> {
  const rows = await transaction.query<{ session_user: unknown }>(
    "select session_user::text as session_user",
  );
  if (
    rows.length !== 1 ||
    rows[0]?.session_user !== PROJECTOR_LOGIN_ROLE
  ) {
    throw gatewayIdentityFailure();
  }
}

async function assumeAndVerifyCapabilityRole(
  transaction: PostgresTransaction,
): Promise<void> {
  await transaction.query("set local role programmable_projector");
  await transaction.query("set local statement_timeout = '1000ms'");
  await transaction.query("set local lock_timeout = '250ms'");
  await transaction.query(
    "set local idle_in_transaction_session_timeout = '2000ms'",
  );
  const rows = await transaction.query<{
    session_user: unknown;
    current_role: unknown;
  }>(
    "select session_user::text as session_user, current_role::text as current_role",
  );
  if (
    rows.length !== 1 ||
    rows[0]?.session_user !== PROJECTOR_LOGIN_ROLE ||
    rows[0]?.current_role !== PROJECTOR_CAPABILITY_ROLE
  ) {
    throw gatewayIdentityFailure();
  }
}

export function createProjectorDatabaseGateway(input: {
  executor: PostgresExecutor;
}) {
  return Object.freeze({
    async transaction<T>(
      work: (transaction: PostgresTransaction) => Promise<T>,
      scope: ProjectorSqlStateScope = "batch",
    ): Promise<T> {
      try {
        return await input.executor.transaction(async (transaction) => {
          await assertGatewayLogin(transaction);
          await assumeAndVerifyCapabilityRole(transaction);
          return work(transaction);
        });
      } catch (error) {
        if (error instanceof DataPipelineError) throw error;
        throw ProjectorDatabaseError.fromUnknown(error, scope);
      }
    },
  });
}

function projectorValidationFailure(): never {
  throw new ProjectorDatabaseError({
    sqlState: null,
    disposition: "fatal-codec-or-caller",
    retryable: false,
  });
}

function exactUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return projectorValidationFailure();
  }
  return value;
}

function integerText(value: unknown): string {
  try {
    if (typeof value === "bigint") return parseNonnegativeIntegerText(value.toString());
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) return projectorValidationFailure();
      return parseNonnegativeIntegerText(String(value));
    }
    return parseNonnegativeIntegerText(value);
  } catch {
    return projectorValidationFailure();
  }
}

function databaseBytes32(value: unknown): HexBytes32 {
  try {
    return bytes32FromBytea(value);
  } catch {
    return projectorValidationFailure();
  }
}

function databaseAddress(value: unknown): HexAddress {
  try {
    return addressFromBytea(value);
  } catch {
    return projectorValidationFailure();
  }
}

function exactText(value: unknown, pattern: RegExp, maximum = 128): string {
  if (typeof value !== "string" || value.length > maximum || !pattern.test(value)) {
    return projectorValidationFailure();
  }
  return value;
}

function exactRecord(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return projectorValidationFailure();
  }
  return value as Record<string, unknown>;
}

function exactArray(value: unknown, maximum = 10_000): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    return projectorValidationFailure();
  }
  return value;
}

function exactTimestamp(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : value;
  if (typeof text !== "string") return projectorValidationFailure();
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.valueOf())) return projectorValidationFailure();
  return parsed.toISOString();
}

function canonicalProviderBindings(
  values: readonly ProjectorProviderDatabaseBinding[],
): readonly ProjectorProviderDatabaseBinding[] {
  if (!Array.isArray(values) || values.length < 3 || values.length > 8) {
    return projectorValidationFailure();
  }
  const identities = new Set<string>();
  return Object.freeze(
    values.map((value) => {
      const type = exactText(
        value.type,
        /^(rpc_provider|envio_deployment|uniswap_subgraph)$/u,
      ) as ProjectorProviderDatabaseBinding["type"];
      const redactedIdentity = exactText(
        value.redactedIdentity,
        /^[a-z0-9][a-z0-9._:/-]{0,127}$/u,
      );
      if (identities.has(redactedIdentity)) return projectorValidationFailure();
      identities.add(redactedIdentity);
      let deploymentCommitment: HexBytes32;
      let schemaCommitment: HexBytes32;
      try {
        deploymentCommitment = canonicalBytes32(value.deploymentCommitment);
        schemaCommitment = canonicalBytes32(value.schemaCommitment);
      } catch {
        return projectorValidationFailure();
      }
      return Object.freeze({
        type,
        redactedIdentity,
        deploymentCommitment,
        schemaCommitment,
      });
    }),
  );
}

type RuntimeState = Readonly<{
  epochId: string;
  pointerGeneration: string;
  providerDeploymentIds: readonly string[];
}>;

function parseRuntimeState(
  rows: readonly Record<string, unknown>[],
  providers: readonly ProjectorProviderDatabaseBinding[],
): RuntimeState {
  if (rows.length !== 1) return projectorValidationFailure();
  const row = rows[0]!;
  const ids = exactArray(row.provider_deployment_ids, 8).map(exactUuid);
  const types = exactArray(row.provider_types, 8);
  const identities = exactArray(row.provider_redacted_identities, 8);
  if (
    ids.length !== providers.length ||
    types.length !== providers.length ||
    identities.length !== providers.length ||
    providers.some(
      (provider, index) =>
        types[index] !== provider.type ||
        identities[index] !== provider.redactedIdentity,
    )
  ) {
    return projectorValidationFailure();
  }
  return Object.freeze({
    epochId: exactUuid(row.epoch_id),
    pointerGeneration: integerText(row.pointer_generation),
    providerDeploymentIds: Object.freeze(ids),
  });
}

async function readRuntimeState(input: {
  transaction: PostgresTransaction;
  scope: {
    releaseId: string;
    modelId: string;
    sourceGroup: string;
    projectorVersion: string;
  };
  providers: readonly ProjectorProviderDatabaseBinding[];
}): Promise<RuntimeState> {
  const rows = await input.transaction.query(
    "select * from programmable_private.get_projector_runtime_state_v1($1, $2, $3, $4, $5, $6::text[], $7::text[], $8::bytea[], $9::bytea[])",
    [
      "1",
      input.scope.releaseId,
      input.scope.modelId,
      input.scope.sourceGroup,
      input.scope.projectorVersion,
      input.providers.map(({ type }) => type),
      input.providers.map(({ redactedIdentity }) => redactedIdentity),
      input.providers.map(({ deploymentCommitment }) =>
        hexToBytes(deploymentCommitment),
      ),
      input.providers.map(({ schemaCommitment }) => hexToBytes(schemaCommitment)),
    ],
  );
  return parseRuntimeState(rows, input.providers);
}

type ManifestSourceBinding = Readonly<{
  bindingId: string;
  sourceName: string;
  sourceRole: string;
  sourceAddress: HexAddress;
  inclusiveStartBlock: string;
  abiEventSetCommitment: HexBytes32;
  bindingCommitment: HexBytes32;
}>;

type ManifestProjectionEventRule = Readonly<{
  ruleId: string;
  projectionKind: string;
  sourceRole: string;
  eventType: string;
  ruleCommitment: HexBytes32;
}>;

type ManifestDynamicTemplate = Readonly<{
  templateId: string;
  parentBindingId: string;
  parentBindingCommitment: HexBytes32;
  deployedSourceRole: string;
  normalizedRuntimeCodeHash: HexBytes32;
  expectedInstanceRuntimeCodeHash: HexBytes32 | null;
  immutableReferencesCommitment: HexBytes32;
  immutableBindingSpec: Record<string, unknown>;
  immutableBindingCommitment: HexBytes32;
  runtimeCodeLength: string;
  abiEventSetCommitment: HexBytes32;
  templateCommitment: HexBytes32;
}>;

type ParsedManifest = Readonly<{
  sources: readonly ManifestSourceBinding[];
  templates: readonly ManifestDynamicTemplate[];
  eventRules: readonly ManifestProjectionEventRule[];
}>;

function manifestHex(value: unknown): HexBytes32 {
  try {
    return canonicalBytes32(value);
  } catch {
    return projectorValidationFailure();
  }
}

function parseManifest(
  rows: readonly Record<string, unknown>[],
  state: RuntimeState,
): ParsedManifest {
  if (rows.length !== 1) return projectorValidationFailure();
  const row = rows[0]!;
  if (
    exactUuid(row.epoch_id) !== state.epochId ||
    integerText(row.pointer_generation) !== state.pointerGeneration
  ) {
    return projectorValidationFailure();
  }
  databaseBytes32(row.epoch_commitment);
  databaseBytes32(row.artifact_creation_code_commitment);
  const sources = exactArray(row.source_bindings, 256).map((entry) => {
    const source = exactRecord(entry);
    if (source.source_type !== "ethereum_contract" || source.source_address === null) {
      return projectorValidationFailure();
    }
    let sourceAddress: HexAddress;
    try {
      sourceAddress = canonicalAddress(source.source_address);
    } catch {
      return projectorValidationFailure();
    }
    return Object.freeze({
      bindingId: exactUuid(source.binding_id),
      sourceName: exactText(source.source_name, /^[A-Za-z][A-Za-z0-9]{0,95}$/u),
      sourceRole: exactText(source.source_role, /^[a-z][a-z0-9_/-]{0,95}$/u),
      sourceAddress,
      inclusiveStartBlock: integerText(source.inclusive_start_block),
      abiEventSetCommitment: manifestHex(source.abi_event_set_commitment),
      bindingCommitment: manifestHex(source.binding_commitment),
    });
  });
  const templates = exactArray(row.dynamic_source_templates, 128).map((entry) => {
    const template = exactRecord(entry);
    return Object.freeze({
      templateId: exactUuid(template.dynamic_source_template_id),
      parentBindingId: exactUuid(template.parent_factory_release_binding_id),
      parentBindingCommitment: manifestHex(
        template.parent_factory_binding_commitment,
      ),
      deployedSourceRole: exactText(
        template.deployed_source_role,
        /^(reward_vault|vesting_wallet)$/u,
      ),
      normalizedRuntimeCodeHash: manifestHex(
        template.normalized_runtime_code_hash,
      ),
      expectedInstanceRuntimeCodeHash:
        template.expected_instance_runtime_code_hash === null
          ? null
          : manifestHex(template.expected_instance_runtime_code_hash),
      immutableReferencesCommitment: manifestHex(
        template.immutable_references_commitment,
      ),
      immutableBindingSpec: exactRecord(template.immutable_binding_spec),
      immutableBindingCommitment: manifestHex(
        template.immutable_binding_commitment,
      ),
      runtimeCodeLength: integerText(template.runtime_code_length),
      abiEventSetCommitment: manifestHex(template.abi_event_set_commitment),
      templateCommitment: manifestHex(template.template_commitment),
    });
  });
  const eventRules = exactArray(row.projection_event_rules, 512).map((entry) => {
    const rule = exactRecord(entry);
    return Object.freeze({
      ruleId: exactUuid(rule.projection_event_rule_id),
      projectionKind: exactText(
        rule.projection_kind,
        /^[a-z][a-z0-9_/-]{0,95}$/u,
      ),
      sourceRole: exactText(
        rule.source_role,
        /^[a-z][a-z0-9_/-]{0,95}$/u,
      ),
      eventType: exactText(
        rule.event_type,
        /^[A-Za-z][A-Za-z0-9]{0,95}$/u,
      ),
      ruleCommitment: manifestHex(rule.rule_commitment),
    });
  });
  exactArray(row.launch_completeness_requirements, 128);
  return Object.freeze({
    sources: Object.freeze(sources),
    templates: Object.freeze(templates),
    eventRules: Object.freeze(eventRules),
  });
}

function dynamicContractName(scope: ProjectorReleaseDatabaseScope) {
  if (scope.releaseId === "classic-v3") return "ClassicV3RewardVault" as const;
  if (scope.releaseId === "stock-paired-v1") return "StockV1RewardVault" as const;
  if (
    scope.releaseId === "stock-paired-v2" ||
    scope.releaseId === "stock-paired-v3"
  ) {
    return "StockV2V3RewardVault" as const;
  }
  return null;
}

function dynamicModel(scope: ProjectorReleaseDatabaseScope) {
  return scope.releaseId === "classic-v3" ? "classic" as const : "stock-paired" as const;
}

function immutableReferencesFromSpec(value: Record<string, unknown>) {
  const bindings = exactArray(value.bindings, 64);
  return bindings.map((entry, index) => {
    const binding = exactRecord(entry);
    if (integerText(binding.ordinal) !== String(index)) {
      return projectorValidationFailure();
    }
    const start = Number(integerText(binding.offset));
    const length = Number(integerText(binding.length));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length)) {
      return projectorValidationFailure();
    }
    return Object.freeze({ start, length });
  });
}

function parseDynamicAttestations(input: {
  rows: readonly Record<string, unknown>[];
  manifest: ParsedManifest;
  scope: ProjectorReleaseDatabaseScope;
}): VerifiedDynamicSourceLineage[] {
  const contractName = dynamicContractName(input.scope);
  if (!contractName) {
    if (input.rows.length !== 0) return projectorValidationFailure();
    return [];
  }
  return input.rows.map((row) => {
    const templateId = exactUuid(row.dynamic_source_template_id);
    const template = input.manifest.templates.find(
      (candidate) => candidate.templateId === templateId,
    );
    if (!template) return projectorValidationFailure();
    const parentBindingId = exactUuid(row.parent_factory_release_binding_id);
    const parent = input.manifest.sources.find(
      (candidate) => candidate.bindingId === parentBindingId,
    );
    if (
      !parent ||
      template.parentBindingId !== parentBindingId ||
      databaseBytes32(row.parent_factory_binding_commitment) !==
        parent.bindingCommitment ||
      template.parentBindingCommitment !== parent.bindingCommitment ||
      row.deployed_source_role !== template.deployedSourceRole ||
      databaseBytes32(row.normalized_runtime_code_hash) !==
        template.normalizedRuntimeCodeHash ||
      databaseBytes32(row.immutable_references_commitment) !==
        template.immutableReferencesCommitment ||
      databaseBytes32(row.immutable_binding_commitment) !==
        template.immutableBindingCommitment ||
      databaseBytes32(row.abi_event_set_commitment) !==
        template.abiEventSetCommitment ||
      databaseBytes32(row.template_commitment) !== template.templateCommitment ||
      integerText(row.runtime_code_length) !== template.runtimeCodeLength
    ) {
      return projectorValidationFailure();
    }
    const exactRuntime =
      row.expected_instance_runtime_code_hash === null
        ? databaseBytes32(row.runtime_code_hash)
        : databaseBytes32(row.expected_instance_runtime_code_hash);
    if (
      template.expectedInstanceRuntimeCodeHash !== null &&
      exactRuntime !== template.expectedInstanceRuntimeCodeHash
    ) {
      return projectorValidationFailure();
    }
    return canonicalDynamicSourceLineage({
      attestationId: exactUuid(row.dynamic_source_attestation_id),
      sourceAddress: databaseAddress(row.deployed_source_address),
      contractName,
      model: dynamicModel(input.scope),
      releaseVersion: input.scope.releaseId as VerifiedDynamicSourceLineage["releaseVersion"],
      factoryAddress: parent.sourceAddress,
      factoryContractName: parent.sourceName as VerifiedDynamicSourceLineage["factoryContractName"],
      parentOccurrenceId: exactUuid(row.parent_factory_occurrence_id),
      factoryBlockNumber: integerText(row.deployment_block_number),
      expectedExactRuntimeCodeHash: exactRuntime,
      expectedNormalizedRuntimeCodeHash: template.normalizedRuntimeCodeHash,
      expectedImmutableReferencesCommitment:
        template.immutableReferencesCommitment,
      expectedRuntimeByteLength: template.runtimeCodeLength,
      immutableReferences: immutableReferencesFromSpec(template.immutableBindingSpec),
    });
  });
}

function parseCursor(rows: readonly Record<string, unknown>[]) {
  if (rows.length !== 1) return projectorValidationFailure();
  const row = rows[0]!;
  const generation = integerText(row.generation);
  if (row.block_number === null || row.block_hash === null) {
    return projectorValidationFailure();
  }
  const isBlockBoundary =
    row.block_global_log_index === null && row.candidate_id === null;
  if (
    !isBlockBoundary &&
    (row.block_global_log_index === null || row.candidate_id === null)
  ) {
    return projectorValidationFailure();
  }
  const blockGlobalLogIndex = isBlockBoundary
    ? 0xffff_ffff
    : Number(integerText(row.block_global_log_index));
  if (
    !Number.isSafeInteger(blockGlobalLogIndex) ||
    blockGlobalLogIndex < 0 ||
    blockGlobalLogIndex > 0xffff_ffff
  ) {
    return projectorValidationFailure();
  }
  return Object.freeze({
    generation,
    blockNumber: integerText(row.block_number),
    blockHash: databaseBytes32(row.block_hash),
    blockGlobalLogIndex,
    candidateId: isBlockBoundary
      ? ""
      : exactText(
          row.candidate_id,
          /^1:0x[0-9a-f]{64}:0x[0-9a-f]{64}:(?:0|[1-9]\d*)$/u,
          192,
        ),
    isBlockBoundary,
  });
}

function exactIdResult(
  rows: readonly Record<string, unknown>[],
  expected: string,
): void {
  if (rows.length !== 1 || exactUuid(rows[0]?.id) !== expected) {
    return projectorValidationFailure();
  }
}

function candidatePageJson(input: {
  candidates: readonly EnvioCandidate[];
  evidence: DualRpcCandidateWindowEvidence;
  firstSeenAt: string;
}) {
  if (
    input.candidates.length !== input.evidence.candidates.length ||
    input.evidence.coveredCandidateCount !== input.candidates.length
  ) {
    return projectorValidationFailure();
  }
  return input.candidates.map((candidate, index) => {
    const verified = input.evidence.candidates[index]!;
    if (
      verified.candidateId !== candidate.candidateId ||
      verified.candidateBlockHash !== candidate.blockHash ||
      verified.transactionHash !== candidate.transactionHash
    ) {
      return projectorValidationFailure();
    }
    return {
      candidateId: candidate.candidateId,
      blockNumber: candidate.blockNumber,
      blockHash: candidate.blockHash,
      transactionHash: candidate.transactionHash,
      transactionIndex: String(candidate.transactionIndex),
      blockGlobalLogIndex: String(candidate.blockGlobalLogIndex),
      sourceAddress: candidate.sourceAddress,
      eventSignature: candidate.orderedTopics[0],
      eventType: candidate.eventName,
      orderedTopics: candidate.orderedTopics,
      rawData: candidate.rawData,
      decodedPayload: candidate.decodedPayload,
      payloadHash: candidate.payloadHash,
      providerCursor: candidate.candidateId,
      contentCommitment: verified.rawLogCommitment,
      firstSeenAt: input.firstSeenAt,
      contractName: candidate.contractName,
    };
  });
}

const COMMIT_ENVIO_PAGE_SQL = `select programmable_private.commit_envio_ingestion_page_v1(
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
  $6::bigint, $7::bigint, $8::numeric,
  array(
    select row(
      page.item ->> 'candidateId',
      (page.item ->> 'blockNumber')::numeric,
      pg_catalog.decode(pg_catalog.substr(page.item ->> 'blockHash', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substr(page.item ->> 'transactionHash', 3), 'hex'),
      (page.item ->> 'transactionIndex')::numeric,
      (page.item ->> 'blockGlobalLogIndex')::numeric,
      pg_catalog.decode(pg_catalog.substr(page.item ->> 'sourceAddress', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substr(page.item ->> 'eventSignature', 3), 'hex'),
      page.item ->> 'eventType',
      array(
        select pg_catalog.decode(pg_catalog.substr(topic.value, 3), 'hex')
        from pg_catalog.jsonb_array_elements_text(page.item -> 'orderedTopics')
          with ordinality as topic(value, ordinal)
        order by topic.ordinal
      ),
      pg_catalog.decode(pg_catalog.substr(page.item ->> 'rawData', 3), 'hex'),
      page.item -> 'decodedPayload',
      pg_catalog.decode(pg_catalog.substr(page.item ->> 'payloadHash', 3), 'hex'),
      page.item ->> 'providerCursor',
      pg_catalog.decode(pg_catalog.substr(page.item ->> 'contentCommitment', 3), 'hex'),
      (page.item ->> 'firstSeenAt')::timestamptz,
      page.item ->> 'contractName'
    )::programmable_private.envio_candidate_page_item_v1
    from pg_catalog.jsonb_array_elements($9::jsonb)
      with ordinality as page(item, ordinal)
    order by page.ordinal
  ),
  $10::uuid, $11::uuid, $12::uuid, $13::uuid,
  $14::bytea, $15::bytea[], $16::bytea[], $17::bytea, $18::bytea,
  $19::smallint, $20::bytea, $21::bytea, $22::bytea, $23::timestamptz
)::text as generation`;

export function createPostgresProjectorStore(input: {
  executor: PostgresExecutor;
  providers: readonly ProjectorProviderDatabaseBinding[];
  releaseScopes: readonly ProjectorReleaseDatabaseScope[];
  runtimeFence: ProjectorRuntimeFence;
  streamId?: string;
  uuid?: () => string;
  now?: () => Date;
}): ProjectorStore {
  const gateway = createProjectorDatabaseGateway({ executor: input.executor });
  const providers = canonicalProviderBindings(input.providers);
  const envioIndexes = providers
    .map((provider, index) => ({ provider, index }))
    .filter(({ provider }) => provider.type === "envio_deployment");
  const rpcIndexes = providers
    .map((provider, index) => ({ provider, index }))
    .filter(({ provider }) => provider.type === "rpc_provider");
  if (envioIndexes.length !== 1 || rpcIndexes.length !== 2) {
    return projectorValidationFailure();
  }
  const streamId = exactText(
    input.streamId ?? "canonical-events",
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u,
  );
  const releaseScopes = canonicalReleaseScopes(input.releaseScopes);
  const runtimeFence = canonicalRuntimeFence(input.runtimeFence);
  const uuid = input.uuid ?? randomUUID;
  const now = input.now ?? (() => new Date());

  return Object.freeze({
    async readPlan(): Promise<ProjectorPlan> {
      return gateway.transaction(async (transaction) => {
        await assertRuntimeFence(transaction, runtimeFence);
        const neutral = await readRuntimeState({
          transaction,
          scope: ENVIO_CONTROL_SCOPE,
          providers,
        });
        const envioProviderDeploymentId =
          neutral.providerDeploymentIds[envioIndexes[0]!.index]!;
        const rpcProviderDeploymentIds = rpcIndexes.map(
          ({ index }) => neutral.providerDeploymentIds[index]!,
        ) as [string, string];
        const cursorRows = await transaction.query(
          "select * from programmable_private.get_envio_ingestion_cursor_v1($1, $2::uuid, $3)",
          ["1", envioProviderDeploymentId, streamId],
        );
        const cursor = parseCursor(cursorRows);
        const dynamicSources: VerifiedDynamicSourceLineage[] = [];
        for (const scope of releaseScopes) {
          const state = await readRuntimeState({
            transaction,
            scope: {
              ...scope,
              projectorVersion: "projector-v1",
            },
            providers,
          });
          const manifestRows = await transaction.query(
            "select * from programmable_private.get_projector_release_manifest_v1($1, $2, $3, $4, $5::uuid, $6)",
            [
              "1",
              scope.releaseId,
              scope.modelId,
              scope.sourceGroup,
              state.epochId,
              state.pointerGeneration,
            ],
          );
          const manifest = parseManifest(manifestRows, state);
          const attestationRows = await transaction.query(
            "select * from programmable_private.get_projector_dynamic_source_attestations_v1($1, $2, $3, $4, $5::uuid, $6)",
            [
              "1",
              scope.releaseId,
              scope.modelId,
              scope.sourceGroup,
              state.epochId,
              state.pointerGeneration,
            ],
          );
          dynamicSources.push(
            ...parseDynamicAttestations({
              rows: attestationRows,
              manifest,
              scope,
            }),
          );
        }
        if (
          new Set(dynamicSources.map(({ sourceAddress }) => sourceAddress)).size !==
          dynamicSources.length
        ) {
          return projectorValidationFailure();
        }
        return Object.freeze({
          cursor,
          dynamicSources: Object.freeze(dynamicSources),
          database: Object.freeze({
            epochId: neutral.epochId,
            pointerGeneration: neutral.pointerGeneration,
            envioProviderDeploymentId,
            rpcProviderDeploymentIds: Object.freeze(
              rpcProviderDeploymentIds,
            ) as readonly [string, string],
          }),
        });
      });
    },

    async commitVerifiedPage(commitInput): Promise<{ generation: string }> {
      const timestamp = now().toISOString();
      const ids = {
        run: exactUuid(uuid()),
        observation: exactUuid(uuid()),
        block: exactUuid(uuid()),
        outcome: exactUuid(uuid()),
        coverage: exactUuid(uuid()),
      };
      const plan = commitInput.plan;
      const evidence = commitInput.evidence;
      const lastCandidate = commitInput.candidates.at(-1);
      const orderedLogCommitments = evidence.candidates.map(
        ({ rawLogCommitment }) => canonicalBytes32(rawLogCommitment),
      );
      const pageCommitment = canonicalBytes32(
        evidence.coverage.providerLogCommitments[0],
      );
      if (
        pageCommitment !== evidence.coverage.providerLogCommitments[1] ||
        (evidence.candidates.length > 0 &&
          (evidence.safeBlockNumber !== evidence.candidates[0]?.safeBlockNumber ||
            evidence.safeBlockHash !== evidence.candidates[0]?.safeBlockHash))
      ) {
        return projectorValidationFailure();
      }
      const finalBlockNumber = lastCandidate?.blockNumber ?? commitInput.snapshotBlock;
      const finalBlockHash = lastCandidate?.blockHash ??
        canonicalBytes32(evidence.coverage.throughBlockHash);
      const finalBlockGlobalLogIndex = lastCandidate?.blockGlobalLogIndex ??
        0xffff_ffff;
      const finalCandidateId = lastCandidate?.candidateId ?? "empty-page";
      if (
        evidence.coverage.throughBlockNumber !== finalBlockNumber ||
        (lastCandidate === undefined &&
          evidence.coverage.throughBlockGlobalLogIndex !== "4294967295")
      ) {
        return projectorValidationFailure();
      }
      const safeEvidence = providerEvidenceV2("safe_head", {
        chain_id: "1",
        epoch_id: plan.database.epochId,
        pointer_generation: plan.database.pointerGeneration,
        provider_a_id: plan.database.rpcProviderDeploymentIds[0],
        provider_b_id: plan.database.rpcProviderDeploymentIds[1],
        reported_chain_id_a: "1",
        reported_chain_id_b: "1",
        head_a: evidence.providerHeads[0],
        head_b: evidence.providerHeads[1],
        finality_depth: "12",
        safe_block_number: evidence.safeBlockNumber,
        safe_block_hash_a: evidence.safeBlockHash,
        safe_block_hash_b: evidence.safeBlockHash,
      });
      const blockEvidence = providerEvidenceV2("block", {
        chain_id: "1",
        epoch_id: plan.database.epochId,
        pointer_generation: plan.database.pointerGeneration,
        observation_id: ids.observation,
        block_number: finalBlockNumber,
        provider_a_block_hash: finalBlockHash,
        provider_b_block_hash: finalBlockHash,
      });
      const coverageEvidence = providerEvidenceV2("log_coverage", {
        chain_id: "1",
        epoch_id: plan.database.epochId,
        pointer_generation: plan.database.pointerGeneration,
        provider_deployment_id: plan.database.envioProviderDeploymentId,
        stream_id: streamId,
        expected_cursor_generation: plan.cursor.generation,
        next_cursor_generation: (BigInt(plan.cursor.generation) + 1n).toString(),
        previous_block_number: plan.cursor.blockNumber,
        previous_block_global_log_index: plan.cursor.isBlockBoundary
          ? null
          : String(plan.cursor.blockGlobalLogIndex),
        previous_candidate_id: plan.cursor.isBlockBoundary
          ? null
          : plan.cursor.candidateId,
        from_block_number: evidence.coverage.fromBlockNumber,
        to_block_number: finalBlockNumber,
        final_block_hash: finalBlockHash,
        final_block_global_log_index: String(finalBlockGlobalLogIndex),
        final_candidate_id: finalCandidateId,
        safe_head_observation_id: ids.observation,
        final_block_evidence_id: ids.block,
        provider_a_id: plan.database.rpcProviderDeploymentIds[0],
        provider_b_id: plan.database.rpcProviderDeploymentIds[1],
        filter_commitment: evidence.coverage.filterCommitment,
        ordered_log_commitments: orderedLogCommitments,
        page_commitment: pageCommitment,
      });
      const requestCommitment = keccak256(
        toBytes(
          JSON.stringify([
            plan.cursor.generation,
            plan.cursor.candidateId,
            commitInput.snapshotBlock,
            pageCommitment,
          ]),
        ),
      );
      const resultCommitment = keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "bytes32" }],
          [pageCommitment, coverageEvidence.contentFingerprint],
        ),
      );
      const candidateJson = candidatePageJson({
        candidates: commitInput.candidates,
        evidence,
        firstSeenAt: timestamp,
      });

      return gateway.transaction(async (transaction) => {
        await assertRuntimeFence(transaction, runtimeFence);
        await transaction.query(
          "select programmable_private.open_run($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8, $9, $10::bytea, $11::timestamptz) as id",
          [
            ids.run,
            "ingestion",
            "1",
            ENVIO_CONTROL_SCOPE.releaseId,
            ENVIO_CONTROL_SCOPE.modelId,
            ENVIO_CONTROL_SCOPE.sourceGroup,
            plan.database.epochId,
            plan.database.pointerGeneration,
            ENVIO_CONTROL_SCOPE.projectorVersion,
            hexToBytes(requestCommitment),
            timestamp,
          ],
        );
        const observationRows = await transaction.query(
          "select programmable_private.append_safe_head_observation($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::numeric, $8::numeric, $9, $10::numeric, $11::bytea, $12::bytea, $13, $14::bytea, $15::bytea, $16::timestamptz) as id",
          [
            ids.observation,
            ids.run,
            plan.database.rpcProviderDeploymentIds[0],
            plan.database.rpcProviderDeploymentIds[1],
            "1",
            "1",
            evidence.providerHeads[0],
            evidence.providerHeads[1],
            12,
            evidence.safeBlockNumber,
            hexToBytes(evidence.safeBlockHash),
            hexToBytes(evidence.safeBlockHash),
            safeEvidence.encodingVersion,
            safeEvidence.canonicalPreimage,
            hexToBytes(safeEvidence.contentFingerprint),
            timestamp,
          ],
        );
        exactIdResult(observationRows, ids.observation);
        const blockRows = await transaction.query(
          "select programmable_private.append_dual_rpc_block_evidence($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::bytea, $6::bytea, $7, $8::bytea, $9::bytea, $10::timestamptz) as id",
          [
            ids.block,
            ids.observation,
            ids.run,
            finalBlockNumber,
            hexToBytes(finalBlockHash),
            hexToBytes(finalBlockHash),
            blockEvidence.encodingVersion,
            blockEvidence.canonicalPreimage,
            hexToBytes(blockEvidence.contentFingerprint),
            timestamp,
          ],
        );
        exactIdResult(blockRows, ids.block);
        const commitRows = await transaction.query<{ generation: unknown }>(
          COMMIT_ENVIO_PAGE_SQL,
          [
            ids.outcome,
            ids.coverage,
            ids.run,
            plan.database.envioProviderDeploymentId,
            streamId,
            plan.cursor.generation,
            (BigInt(plan.cursor.generation) + 1n).toString(),
            evidence.coverage.fromBlockNumber,
            JSON.stringify(candidateJson),
            ids.observation,
            ids.block,
            plan.database.rpcProviderDeploymentIds[0],
            plan.database.rpcProviderDeploymentIds[1],
            hexToBytes(evidence.coverage.filterCommitment),
            orderedLogCommitments.map(hexToBytes),
            orderedLogCommitments.map(hexToBytes),
            hexToBytes(pageCommitment),
            hexToBytes(resultCommitment),
            coverageEvidence.encodingVersion,
            coverageEvidence.canonicalPreimage,
            hexToBytes(coverageEvidence.contentFingerprint),
            hexToBytes(coverageEvidence.contentFingerprint),
            timestamp,
          ],
        );
        if (commitRows.length !== 1) return projectorValidationFailure();
        return Object.freeze({
          generation: integerText(commitRows[0]?.generation),
        });
      });
    },
  });
}

type ProjectionRuntimeState = Readonly<{
  epochId: string;
  pointerGeneration: string;
  providerDeploymentIds: readonly string[];
  leaseGeneration: string;
  checkpoint: ReleaseProjectionPlan["checkpoint"];
}>;

type ProjectionResolution = Readonly<{
  releaseBindingId: string | null;
  dynamicSourceAttestationId: string | null;
  abiEventSetCommitment: HexBytes32;
  sourceRole: string;
  projectionKind: string;
}>;

type ProjectionPrivatePlan = Readonly<{
  runId: string;
  leaseTokenHash: HexBytes32;
  epochId: string;
  pointerGeneration: string;
  providerDeploymentIds: readonly string[];
  resolutions: ReadonlyMap<string, ProjectionResolution>;
  manifest: ParsedManifest;
}>;

function parseProjectionRuntimeState(
  rows: readonly Record<string, unknown>[],
  providers: readonly ProjectorProviderDatabaseBinding[],
): ProjectionRuntimeState {
  const base = parseRuntimeState(rows, providers);
  const row = rows[0]!;
  const leaseGeneration = integerText(row.lease_generation);
  const checkpointGeneration = integerText(row.checkpoint_generation);
  const reorgGeneration = integerText(row.reorg_generation);
  const checkpointFields = [
    row.checkpoint_id,
    row.checkpoint_block_number,
    row.checkpoint_block_hash,
    row.checkpoint_cursor_block_global_log_index,
    row.checkpoint_cursor_candidate_id,
  ];
  const checkpointAbsent = checkpointFields.every((value) => value === null);
  if (
    !checkpointAbsent &&
    checkpointFields.some((value) => value === null)
  ) {
    return projectorValidationFailure();
  }
  let checkpoint: ReleaseProjectionPlan["checkpoint"] = null;
  if (!checkpointAbsent) {
    exactUuid(row.checkpoint_id);
    const blockGlobalLogIndex = Number(
      integerText(row.checkpoint_cursor_block_global_log_index),
    );
    if (
      !Number.isSafeInteger(blockGlobalLogIndex) ||
      blockGlobalLogIndex < 0 ||
      blockGlobalLogIndex > 0xffff_ffff
    ) {
      return projectorValidationFailure();
    }
    checkpoint = Object.freeze({
      generation: checkpointGeneration,
      reorgGeneration,
      blockNumber: integerText(row.checkpoint_block_number),
      blockHash: databaseBytes32(row.checkpoint_block_hash),
      blockGlobalLogIndex,
      candidateId: exactText(
        row.checkpoint_cursor_candidate_id,
        /^1:0x[0-9a-f]{64}:0x[0-9a-f]{64}:(?:0|[1-9]\d*)$/u,
        192,
      ),
    });
  } else if (checkpointGeneration !== "0" || reorgGeneration !== "0") {
    return projectorValidationFailure();
  }
  return Object.freeze({
    epochId: base.epochId,
    pointerGeneration: base.pointerGeneration,
    providerDeploymentIds: base.providerDeploymentIds,
    leaseGeneration,
    checkpoint,
  });
}

function parseProjectionCandidateRow(
  row: Record<string, unknown>,
  expectedEnvioProviderId: string,
): Readonly<{
  candidate: StoredProjectionCandidate;
  attemptCount: string;
}> {
  if (exactUuid(row.provider_deployment_id) !== expectedEnvioProviderId) {
    return projectorValidationFailure();
  }
  const blockGlobalLogIndex = Number(integerText(row.block_global_log_index));
  const transactionIndex = Number(integerText(row.transaction_index));
  if (
    !Number.isSafeInteger(blockGlobalLogIndex) ||
    blockGlobalLogIndex < 0 ||
    blockGlobalLogIndex > 0xffff_ffff ||
    !Number.isSafeInteger(transactionIndex) ||
    transactionIndex < 0 ||
    transactionIndex > 0xffff_ffff
  ) {
    return projectorValidationFailure();
  }
  const topics = exactArray(row.ordered_topics, 4).map(databaseBytes32);
  const eventSignature = databaseBytes32(row.event_signature);
  if (topics.length < 1 || topics[0] !== eventSignature) {
    return projectorValidationFailure();
  }
  const candidateId = exactText(
    row.candidate_id,
    /^1:0x[0-9a-f]{64}:0x[0-9a-f]{64}:(?:0|[1-9]\d*)$/u,
    192,
  );
  const blockHash = databaseBytes32(row.block_hash);
  const transactionHash = databaseBytes32(row.transaction_hash);
  if (
    candidateId !==
    `1:${blockHash}:${transactionHash}:${blockGlobalLogIndex}`
  ) {
    return projectorValidationFailure();
  }
  databaseBytes32(row.content_commitment);
  if (row.status !== "pending" && row.status !== "deferred") {
    return projectorValidationFailure();
  }
  return Object.freeze({
    candidate: Object.freeze({
      candidateId,
      chainId: 1 as const,
      blockNumber: integerText(row.block_number),
      blockHash,
      transactionHash,
      transactionIndex,
      blockGlobalLogIndex,
      sourceAddress: databaseAddress(row.source_address),
      contractName: exactText(
        row.contract_name,
        /^[A-Za-z][A-Za-z0-9]{0,95}$/u,
      ),
      eventName: exactText(
        row.event_type,
        /^[A-Za-z][A-Za-z0-9]{0,95}$/u,
      ),
      orderedTopics: topics,
      rawData: dataFromBytea(row.raw_data),
      decodedPayload: exactRecord(row.decoded_payload),
      payloadHash: databaseBytes32(row.payload_hash),
    }),
    attemptCount: integerText(row.attempt_count),
  });
}

function transactionAlignedProjectionPage<T extends Readonly<{
  candidate: StoredProjectionCandidate;
}>>(rows: readonly T[], maximum: number): readonly T[] {
  if (rows.length <= maximum) return Object.freeze([...rows]);
  const boundaryTransaction = rows[maximum]!.candidate.transactionHash;
  const page = rows.slice(0, maximum);
  while (
    page.length > 0 &&
    page[page.length - 1]!.candidate.transactionHash === boundaryTransaction
  ) {
    page.pop();
  }
  if (page.length === 0) return projectorValidationFailure();
  return Object.freeze(page);
}

const REWARD_DELTA_PROJECTION_KINDS = Object.freeze(new Set([
  "creator-fee-checkpoint",
  "beneficiary-claim",
  "payout-change",
  "reward-configuration-activation",
]));

function isolateRewardTransaction<T extends Readonly<{
  candidate: StoredProjectionCandidate;
  action: "project" | "ignore";
}>>(
  entries: readonly T[],
  resolutions: ReadonlyMap<string, ProjectionResolution>,
): readonly T[] {
  let transactionStart = 0;
  while (transactionStart < entries.length) {
    const transactionHash = entries[transactionStart]!.candidate.transactionHash;
    let transactionEnd = transactionStart + 1;
    while (
      transactionEnd < entries.length &&
      entries[transactionEnd]!.candidate.transactionHash === transactionHash
    ) {
      transactionEnd += 1;
    }
    const transaction = entries.slice(transactionStart, transactionEnd);
    const rewardSources = new Set<HexAddress>();
    for (const entry of transaction) {
      const resolution = resolutions.get(entry.candidate.candidateId);
      if (
        entry.action === "project" &&
        resolution &&
        REWARD_DELTA_PROJECTION_KINDS.has(resolution.projectionKind)
      ) {
        rewardSources.add(entry.candidate.sourceAddress);
      }
    }
    if (rewardSources.size > 0) {
      if (transactionStart > 0) {
        return Object.freeze(entries.slice(0, transactionStart));
      }
      // The caller supplies the complete remainder of this exact block when a
      // reward transaction is first. Keeping every vault and every later
      // reward occurrence is required because eth_call observes block-end
      // state, not transaction-intermediate state.
      return Object.freeze([...entries]);
    }
    transactionStart = transactionEnd;
  }
  return Object.freeze([...entries]);
}

function rewardVaultsForProjection<T extends Readonly<{
  candidate: StoredProjectionCandidate;
  action: "project" | "ignore";
}>>(
  entries: readonly T[],
  resolutions: ReadonlyMap<string, ProjectionResolution>,
): readonly HexAddress[] {
  const vaults = new Set<HexAddress>();
  for (const entry of entries) {
    const resolution = resolutions.get(entry.candidate.candidateId);
    if (
      entry.action === "project" &&
      resolution?.sourceRole === "reward_vault" &&
      REWARD_DELTA_PROJECTION_KINDS.has(resolution.projectionKind)
    ) {
      vaults.add(entry.candidate.sourceAddress);
    }
  }
  return Object.freeze([...vaults].sort());
}

function containsRewardProjection<T extends Readonly<{
  candidate: StoredProjectionCandidate;
  action: "project" | "ignore";
}>>(
  entries: readonly T[],
  resolutions: ReadonlyMap<string, ProjectionResolution>,
): boolean {
  return rewardVaultsForProjection(entries, resolutions).length > 0;
}

function projectionResolution(input: {
  candidate: StoredProjectionCandidate;
  manifest: ParsedManifest;
  dynamicRows: readonly Record<string, unknown>[];
}): ProjectionResolution | null {
  const staticMatches = input.manifest.sources.filter(
    (source) =>
      source.sourceAddress === input.candidate.sourceAddress &&
      source.sourceName === input.candidate.contractName &&
      BigInt(source.inclusiveStartBlock) <=
        BigInt(input.candidate.blockNumber) &&
      input.manifest.eventRules.some(
        (rule) =>
          rule.sourceRole === source.sourceRole &&
          rule.eventType === input.candidate.eventName,
      ),
  );
  const dynamicMatches = input.dynamicRows.filter(
    (row) =>
      databaseAddress(row.deployed_source_address) ===
        input.candidate.sourceAddress &&
      BigInt(integerText(row.deployment_block_number)) <=
        BigInt(input.candidate.blockNumber) &&
      input.manifest.eventRules.some(
        (rule) =>
          rule.sourceRole === row.deployed_source_role &&
          rule.eventType === input.candidate.eventName,
      ),
  );
  if (staticMatches.length + dynamicMatches.length > 1) {
    return projectorValidationFailure();
  }
  const staticMatch = staticMatches[0];
  if (staticMatch) {
    const matchingRules = input.manifest.eventRules.filter(
      (rule) =>
        rule.sourceRole === staticMatch.sourceRole &&
        rule.eventType === input.candidate.eventName,
    );
    if (matchingRules.length !== 1) return projectorValidationFailure();
    const rule = matchingRules[0]!;
    return Object.freeze({
      releaseBindingId: staticMatch.bindingId,
      dynamicSourceAttestationId: null,
      abiEventSetCommitment: staticMatch.abiEventSetCommitment,
      sourceRole: staticMatch.sourceRole,
      projectionKind: rule.projectionKind,
    });
  }
  const dynamicMatch = dynamicMatches[0];
  if (!dynamicMatch) return null;
  const sourceRole = exactText(
    dynamicMatch.deployed_source_role,
    /^(reward_vault|vesting_wallet)$/u,
  );
  const matchingRules = input.manifest.eventRules.filter(
    (rule) =>
      rule.sourceRole === sourceRole &&
      rule.eventType === input.candidate.eventName,
  );
  if (matchingRules.length !== 1) return projectorValidationFailure();
  const rule = matchingRules[0]!;
  return Object.freeze({
    releaseBindingId: null,
    dynamicSourceAttestationId: exactUuid(
      dynamicMatch.dynamic_source_attestation_id,
    ),
    abiEventSetCommitment: databaseBytes32(
      dynamicMatch.abi_event_set_commitment,
    ),
    sourceRole,
    projectionKind: rule.projectionKind,
  });
}

function poolIdsForProjection(
  candidates: readonly StoredProjectionCandidate[],
): readonly HexBytes32[] {
  const values = new Set<HexBytes32>();
  for (const candidate of candidates) {
    const value = candidate.decodedPayload.poolId;
    if (typeof value !== "string") continue;
    try {
      values.add(canonicalBytes32(value));
    } catch {
      return projectorValidationFailure();
    }
  }
  return Object.freeze([...values].sort());
}

function parseKnownPool(
  rows: readonly Record<string, unknown>[],
  releaseId: ProjectorReleaseDatabaseScope["releaseId"],
  poolId: HexBytes32,
): ProjectorKnownPool | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) return projectorValidationFailure();
  const row = rows[0]!;
  const token = databaseAddress(row.token);
  const currency0 = databaseAddress(row.currency0);
  const currency1 = databaseAddress(row.currency1);
  if (token !== currency0 && token !== currency1) {
    return projectorValidationFailure();
  }
  const quote = token === currency0 ? currency1 : currency0;
  const isClassic = releaseId.startsWith("classic-");
  return Object.freeze({
    releaseVersion: releaseId,
    poolId,
    token,
    quoteAsset: isClassic ? null : quote,
    rewardVault:
      row.reward_vault === null ? null : databaseAddress(row.reward_vault),
  });
}

/**
 * Creates the release-scoped Postgres side of the projector. `readProjectionPlan`
 * acquires a fenced lease and closes its transaction before any provider call.
 * The final method re-enters Postgres only after the orchestrator has completed
 * fresh Envio, dual-RPC and metadata verification.
 */
export function createPostgresReleaseProjectionStore(input: {
  executor: PostgresExecutor;
  providers: readonly ProjectorProviderDatabaseBinding[];
  scope: ProjectorReleaseDatabaseScope;
  runtimeFence: ProjectorRuntimeFence;
  rpcEvidenceBindings?: readonly [
    Omit<CandidateRpcProvider, "client">,
    Omit<CandidateRpcProvider, "client">,
  ];
  projectorVersion?: string;
  holderId?: string;
  uuid?: () => string;
  now?: () => Date;
}): ReleaseProjectionStore {
  const gateway = createProjectorDatabaseGateway({ executor: input.executor });
  const providers = canonicalProviderBindings(input.providers);
  const rpcEvidenceBindings = input.rpcEvidenceBindings === undefined
    ? null
    : Object.freeze(input.rpcEvidenceBindings.map((binding) => Object.freeze({
        identity: exactText(
          binding.identity,
          /^[a-z0-9][a-z0-9-]{0,63}$/u,
        ),
        vendorGroup: exactText(
          binding.vendorGroup,
          /^[a-z0-9][a-z0-9-]{0,63}$/u,
        ),
        endpointCommitment: canonicalBytes32(binding.endpointCommitment),
        endpointOriginCommitment: canonicalBytes32(
          binding.endpointOriginCommitment,
        ),
      }))) as readonly [
        Omit<CandidateRpcProvider, "client">,
        Omit<CandidateRpcProvider, "client">,
      ];
  const scope = canonicalReleaseScope(input.scope);
  const runtimeFence = canonicalRuntimeFence(input.runtimeFence);
  const projectorVersion = exactText(
    input.projectorVersion ?? "projector-v1",
    /^[a-z0-9][a-z0-9._-]{0,95}$/u,
  );
  const holderId = exactText(
    input.holderId ?? "projector-runtime",
    /^[a-z0-9][a-z0-9._-]{0,95}$/u,
  );
  const uuid = input.uuid ?? randomUUID;
  const now = input.now ?? (() => new Date());
  const envioIndex = providers.findIndex(
    ({ type }) => type === "envio_deployment",
  );
  const rpcIndexes = providers
    .map((provider, index) => ({ provider, index }))
    .filter(({ provider }) => provider.type === "rpc_provider")
    .map(({ index }) => index);
  if (envioIndex < 0 || rpcIndexes.length !== 2) {
    return projectorValidationFailure();
  }
  const privatePlans = new WeakMap<ReleaseProjectionPlan, ProjectionPrivatePlan>();

  return Object.freeze({
    async readProjectionPlan(): Promise<ReleaseProjectionPlan | null> {
      return gateway.transaction(async (transaction) => {
        await assertRuntimeFence(transaction, runtimeFence);
        const runtimeRows = await transaction.query(
          "select * from programmable_private.get_projector_runtime_state_v1($1, $2, $3, $4, $5, $6::text[], $7::text[], $8::bytea[], $9::bytea[])",
          [
            "1",
            scope.releaseId,
            scope.modelId,
            scope.sourceGroup,
            projectorVersion,
            providers.map(({ type }) => type),
            providers.map(({ redactedIdentity }) => redactedIdentity),
            providers.map(({ deploymentCommitment }) =>
              hexToBytes(deploymentCommitment),
            ),
            providers.map(({ schemaCommitment }) =>
              hexToBytes(schemaCommitment),
            ),
          ],
        );
        const runtime = parseProjectionRuntimeState(runtimeRows, providers);
        const acquiredAt = now();
        if (!Number.isFinite(acquiredAt.valueOf())) {
          return projectorValidationFailure();
        }
        const expiresAt = new Date(acquiredAt.valueOf() + 90_000);
        const leaseTokenHash = keccak256(
          toBytes(`programmable:projector-lease:v1:${uuid()}`),
        );
        const nextLeaseGeneration = (
          BigInt(runtime.leaseGeneration) + 1n
        ).toString();
        const leaseInputCommitment = keccak256(
          toBytes(
            JSON.stringify([
              scope.releaseId,
              scope.modelId,
              scope.sourceGroup,
              runtime.epochId,
              runtime.pointerGeneration,
              runtime.leaseGeneration,
              nextLeaseGeneration,
              holderId,
              acquiredAt.toISOString(),
              expiresAt.toISOString(),
            ]),
          ),
        );
        const leaseRows = await transaction.query<{ acquired: unknown }>(
          "select programmable_private.acquire_projector_lease($1, $2, $3, $4, $5, $6::uuid, $7::bigint, $8::bigint, $9::bigint, $10::bytea, $11, $12::timestamptz, $13::timestamptz, $14::bytea) as acquired",
          [
            "1",
            scope.releaseId,
            scope.modelId,
            scope.sourceGroup,
            projectorVersion,
            runtime.epochId,
            runtime.pointerGeneration,
            runtime.leaseGeneration,
            nextLeaseGeneration,
            hexToBytes(leaseTokenHash),
            holderId,
            acquiredAt.toISOString(),
            expiresAt.toISOString(),
            hexToBytes(leaseInputCommitment),
          ],
        );
        if (leaseRows.length !== 1 || leaseRows[0]?.acquired !== true) {
          return projectorValidationFailure();
        }
        const [
          manifestRows,
          dynamicRows,
          candidateRows,
          ingestionCursorRows,
        ] = await Promise.all([
          transaction.query(
            "select * from programmable_private.get_projector_release_manifest_v1($1, $2, $3, $4, $5::uuid, $6)",
            [
              "1",
              scope.releaseId,
              scope.modelId,
              scope.sourceGroup,
              runtime.epochId,
              runtime.pointerGeneration,
            ],
          ),
          transaction.query(
            "select * from programmable_private.get_projector_dynamic_source_attestations_v1($1, $2, $3, $4, $5::uuid, $6)",
            [
              "1",
              scope.releaseId,
              scope.modelId,
              scope.sourceGroup,
              runtime.epochId,
              runtime.pointerGeneration,
            ],
          ),
          transaction.query(
            "select * from programmable_private.list_projector_candidate_page_v1($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9::bytea, $10::numeric, $11::numeric, $12, $13, $14::timestamptz)",
            [
              "1",
              scope.releaseId,
              scope.modelId,
              scope.sourceGroup,
              runtime.epochId,
              runtime.pointerGeneration,
              projectorVersion,
              nextLeaseGeneration,
              hexToBytes(leaseTokenHash),
              runtime.checkpoint?.blockNumber ?? null,
              runtime.checkpoint?.blockGlobalLogIndex ?? null,
              runtime.checkpoint?.candidateId ?? null,
              33,
              acquiredAt.toISOString(),
            ],
          ),
          transaction.query(
            "select * from programmable_private.get_envio_ingestion_cursor_v1($1, $2::uuid, $3)",
            [
              "1",
              runtime.providerDeploymentIds[envioIndex]!,
              "canonical-events",
            ],
          ),
        ]);
        const ingestionCursor = parseCursor(ingestionCursorRows);
        const manifest = parseManifest(manifestRows, {
          epochId: runtime.epochId,
          pointerGeneration: runtime.pointerGeneration,
          providerDeploymentIds: runtime.providerDeploymentIds,
        });
        const dynamicSources = parseDynamicAttestations({
          rows: dynamicRows,
          manifest,
          scope,
        });
        const parsedRows = candidateRows.map((row) =>
          parseProjectionCandidateRow(
            row,
            runtime.providerDeploymentIds[envioIndex]!,
          ),
        );
        if (parsedRows.length === 0) return null;
        const resolutions = new Map<string, ProjectionResolution>();
        const resolveRows = (
          rows: readonly (typeof parsedRows)[number][],
        ) => rows.map(({ candidate, attemptCount }) => {
          const resolution = projectionResolution({
            candidate,
            manifest,
            dynamicRows,
          });
          if (resolution) resolutions.set(candidate.candidateId, resolution);
          return Object.freeze({
            candidate,
            action: resolution ? "project" as const : "ignore" as const,
            attemptCount,
          });
        });
        let resolvedEntries = resolveRows(parsedRows);
        const fetchAfter = async (
          after: StoredProjectionCandidate,
          limit: number,
        ) => {
          const rows = await transaction.query(
            "select * from programmable_private.list_projector_candidate_page_v1($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9::bytea, $10::numeric, $11::numeric, $12, $13, $14::timestamptz)",
            [
              "1",
              scope.releaseId,
              scope.modelId,
              scope.sourceGroup,
              runtime.epochId,
              runtime.pointerGeneration,
              projectorVersion,
              nextLeaseGeneration,
              hexToBytes(leaseTokenHash),
              after.blockNumber,
              after.blockGlobalLogIndex,
              after.candidateId,
              limit,
              acquiredAt.toISOString(),
            ],
          );
          return resolveRows(rows.map((row) =>
            parseProjectionCandidateRow(
              row,
              runtime.providerDeploymentIds[envioIndex]!,
            )
          ));
        };
        const completePrefix = async (
          belongsToGroup: (entry: (typeof resolvedEntries)[number]) => boolean,
        ) => {
          while (true) {
            const boundary = resolvedEntries.findIndex(
              (entry) => !belongsToGroup(entry),
            );
            if (boundary >= 0) {
              return Object.freeze(resolvedEntries.slice(0, boundary));
            }
            if (
              resolvedEntries.length >
                PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP
            ) {
              return projectorValidationFailure();
            }
            const last = resolvedEntries.at(-1)?.candidate;
            if (!last) return projectorValidationFailure();
            const remaining =
              PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP + 1 -
              resolvedEntries.length;
            const next = await fetchAfter(last, Math.min(500, remaining));
            if (next.length === 0) {
              const boundaryBlock = BigInt(ingestionCursor.blockNumber);
              const groupBlock = BigInt(last.blockNumber);
              if (
                !ingestionCursor.isBlockBoundary ||
                boundaryBlock < groupBlock
              ) {
                return null;
              }
              if (
                boundaryBlock === groupBlock &&
                ingestionCursor.blockHash !== last.blockHash
              ) {
                return projectorValidationFailure();
              }
              return Object.freeze([...resolvedEntries]);
            }
            resolvedEntries = [...resolvedEntries, ...next];
          }
        };

        let batchKind: NonNullable<ReleaseProjectionPlan["batchKind"]> =
          "normal";
        let entries: readonly (typeof resolvedEntries)[number][];
        const first = resolvedEntries[0]!;
        const firstTransactionHash = first.candidate.transactionHash;
        const firstTransactionIsOversized =
          resolvedEntries.length > PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE &&
          resolvedEntries[PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE]!.candidate
              .transactionHash === firstTransactionHash;
        if (firstTransactionIsOversized) {
          const completedTransaction = await completePrefix(
            (entry) =>
              entry.candidate.transactionHash === firstTransactionHash,
          );
          if (completedTransaction === null) return null;
          entries = completedTransaction;
          batchKind = "oversized-transaction";
          if (containsRewardProjection(entries, resolutions)) {
            const rewardBlockHash = first.candidate.blockHash;
            const completedRewardBlock = await completePrefix(
              (entry) => entry.candidate.blockHash === rewardBlockHash,
            );
            if (completedRewardBlock === null) return null;
            entries = completedRewardBlock;
            batchKind = "reward-block";
          }
        } else {
          const page = transactionAlignedProjectionPage(
            resolvedEntries,
            PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE,
          );
          const isolated = isolateRewardTransaction(page, resolutions);
          if (
            isolated.length === page.length &&
            containsRewardProjection(page, resolutions)
          ) {
            const rewardBlockHash = first.candidate.blockHash;
            const completedRewardBlock = await completePrefix(
              (entry) => entry.candidate.blockHash === rewardBlockHash,
            );
            if (completedRewardBlock === null) return null;
            entries = completedRewardBlock;
            batchKind = "reward-block";
          } else {
            entries = isolated;
          }
        }
        if (
          entries.length < 1 ||
          entries.length > PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP
        ) {
          return projectorValidationFailure();
        }
        for (let index = 1; index < entries.length; index += 1) {
          if (
            entries[index - 1]!.candidate.transactionHash ===
              entries[index]!.candidate.transactionHash &&
            entries[index - 1]!.action !== entries[index]!.action
          ) {
            return projectorValidationFailure();
          }
        }
        const selectedCandidateIds = new Set(
          entries.map(({ candidate }) => candidate.candidateId),
        );
        for (const candidateId of resolutions.keys()) {
          if (!selectedCandidateIds.has(candidateId)) resolutions.delete(candidateId);
        }
        const runId = exactUuid(uuid());
        const requestCommitment = keccak256(
          toBytes(
            JSON.stringify([
              scope.releaseId,
              runtime.epochId,
              runtime.pointerGeneration,
              nextLeaseGeneration,
              batchKind,
              entries.map(({ candidate, action }) => [
                candidate.candidateId,
                action,
              ]),
            ]),
          ),
        );
        exactIdResult(
          await transaction.query(
            "select programmable_private.open_run($1::uuid, 'projection', 1, $2, $3, $4, $5::uuid, $6, $7, $8::bytea, $9::timestamptz) as id",
            [
              runId,
              scope.releaseId,
              scope.modelId,
              scope.sourceGroup,
              runtime.epochId,
              runtime.pointerGeneration,
              projectorVersion,
              hexToBytes(requestCommitment),
              acquiredAt.toISOString(),
            ],
          ),
          runId,
        );
        const knownPools: ProjectorKnownPool[] = [];
        for (const poolId of poolIdsForProjection(
          entries
            .filter(({ action }) => action === "project")
            .map(({ candidate }) => candidate),
        )) {
          const known = parseKnownPool(
            await transaction.query(
              "select * from programmable_private.get_projector_pool_baseline_by_id_v1($1::uuid, $2::bytea)",
              [runId, hexToBytes(poolId)],
            ),
            scope.releaseId,
            poolId,
          );
          if (known) knownPools.push(known);
        }
        const rewardVaults = rewardVaultsForProjection(entries, resolutions);
        const rewardVerifications: NonNullable<
          ReleaseProjectionPlan["rewardVerifications"]
        >[number][] = [];
        for (const rewardVault of rewardVaults) {
          const state = parseProjectorRewardStateRows({
            activeRows: await transaction.query(
              "select * from programmable_private.get_projector_reward_state_by_vault_v1($1::uuid, $2::bytea)",
              [runId, hexToBytes(rewardVault)],
            ),
            balanceRows: await transaction.query(
              "select * from programmable_private.get_projector_reward_balances_by_vault_v1($1::uuid, $2::bytea)",
              [runId, hexToBytes(rewardVault)],
            ),
            scope,
            vault: rewardVault,
          });
          rewardVerifications.push(Object.freeze({
            model: state.model,
            baseline: state.baseline,
          }));
        }
        const plan = Object.freeze({
          scope,
          entries: Object.freeze(entries),
          dynamicSources: Object.freeze(dynamicSources),
          knownPools: Object.freeze(knownPools),
          lease: Object.freeze({
            generation: nextLeaseGeneration,
            expiresAt: expiresAt.toISOString(),
          }),
          checkpoint: runtime.checkpoint,
          rewardVerification: null,
          rewardVerifications: Object.freeze(rewardVerifications),
          batchKind,
        });
        privatePlans.set(
          plan,
          Object.freeze({
            runId,
            leaseTokenHash,
            epochId: runtime.epochId,
            pointerGeneration: runtime.pointerGeneration,
            providerDeploymentIds: runtime.providerDeploymentIds,
            resolutions,
            manifest,
          }),
        );
        return plan;
      });
    },

    async commitVerifiedProjection(
      projection: VerifiedReleaseProjection,
    ): Promise<Readonly<{ checkpointGeneration: string }>> {
      const privatePlan = privatePlans.get(projection.plan);
      if (!privatePlan) return projectorValidationFailure();
      return commitPostgresVerifiedProjection({
        gateway,
        providers,
        rpcEvidenceBindings,
        scope,
        projectorVersion,
        uuid,
        now,
        privatePlan,
        projection,
        runtimeFence,
      });
    },
  });
}

const PROJECTION_ROUTE_KEYS = Object.freeze([
  "classic-v3-profile",
  "creator-profile",
  "explore-chart",
  "explore-list",
  "explore-token",
  "launch-lookup",
] as const);

const ZERO_ADDRESS: HexAddress =
  "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32: HexBytes32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const PROJECTOR_MAXIMUM_REWARD_VERIFICATION_ACCOUNTS = 4_096;
const PROJECTOR_MAXIMUM_REWARD_VERIFICATION_CHUNKS = 86;
const PROJECTOR_MAXIMUM_REWARD_CALLS_PER_CHUNK = 128;
const PROJECTOR_MAXIMUM_REWARD_AGGREGATE_CALLS =
  PROJECTOR_MAXIMUM_REWARD_VERIFICATION_CHUNKS *
  PROJECTOR_MAXIMUM_REWARD_CALLS_PER_CHUNK;

type OccurrenceWrite = Readonly<{
  occurrence: ProjectorOccurrenceFact;
  fact: ProjectorEventFact;
  occurrenceId: string;
  logicalEventId: string;
  resolutionId: string;
  blockEvidenceId: string;
}>;

type DetailedPoolBaseline = Readonly<{
  poolProjectionId: string;
  launchProjectionId: string;
  token: HexAddress;
  creator: HexAddress;
  rewardVault: HexAddress | null;
  currency0: HexAddress;
  currency1: HexAddress;
  poolKeyFee: string;
  tickSpacing: string;
  hook: HexAddress;
  poolFeeConfigurationId: string | null;
  buySwapFeeBps: string | null;
  sellSwapFeeBps: string | null;
  buyCreatorFeeBps: string | null;
  sellCreatorFeeBps: string | null;
  launcherFeeBps: string | null;
  transferTaxBps: string | null;
  lpFeePips: string | null;
  lastSourceOccurrenceId: string;
}>;

type VerifiedRewardSeed = Readonly<{
  allocationFactId: string;
  allocationEvidenceId: string;
  factoryOccurrenceId: string;
  vault: HexAddress;
  beneficiaries: readonly HexAddress[];
  sharesBps: readonly string[];
  configurationHash: HexBytes32;
  activeConfigurationHash: HexBytes32;
}>;

type ProjectorRewardState = Readonly<{
  model: ProjectorRewardModel;
  initialAllocationFactId: string;
  initialAllocationEvidenceId: string;
  baseline: ProjectorRewardBaseline;
}>;

function unixSecondsTimestamp(value: string): string {
  const seconds = BigInt(integerText(value));
  if (seconds > 8_640_000_000_000n) return projectorValidationFailure();
  return exactTimestamp(new Date(Number(seconds) * 1_000));
}

function canonicalOccurrenceJson(
  value: Readonly<Record<string, unknown>>,
): CanonicalJsonValue {
  const normalize = (entry: unknown): CanonicalJsonValue => {
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "boolean"
    ) {
      return entry;
    }
    if (typeof entry === "number") {
      if (!Number.isSafeInteger(entry)) return projectorValidationFailure();
      return entry;
    }
    if (Array.isArray(entry)) return entry.map(normalize);
    if (
      typeof entry !== "object" ||
      Object.getPrototypeOf(entry) !== Object.prototype
    ) {
      return projectorValidationFailure();
    }
    return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, member]) => [key, normalize(member)]),
    );
  };
  return normalize(value);
}

function occurrencePair(
  projection: VerifiedReleaseProjection,
): readonly Readonly<{
  occurrence: ProjectorOccurrenceFact;
  fact: ProjectorEventFact;
}>[] {
  if (
    projection.fold.occurrences.length !== projection.fold.facts.length ||
    projection.fold.occurrences.length !==
      projection.plan.entries.filter(({ action }) => action === "project").length
  ) {
    return projectorValidationFailure();
  }
  return Object.freeze(
    projection.fold.occurrences.map((occurrence, index) => {
      const fact = projection.fold.facts[index]!;
      if (fact.sourceCandidateId !== occurrence.candidateId) {
        return projectorValidationFailure();
      }
      return Object.freeze({ occurrence, fact });
    }),
  );
}

function parseDetailedPoolBaseline(
  rows: readonly Record<string, unknown>[],
): DetailedPoolBaseline | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) return projectorValidationFailure();
  const row = rows[0]!;
  const nullableInteger = (value: unknown) =>
    value === null ? null : integerText(value);
  return Object.freeze({
    poolProjectionId: exactUuid(row.pool_projection_id),
    launchProjectionId: exactUuid(row.launch_projection_id),
    token: databaseAddress(row.token),
    creator: databaseAddress(row.creator),
    rewardVault:
      row.reward_vault === null ? null : databaseAddress(row.reward_vault),
    currency0: databaseAddress(row.currency0),
    currency1: databaseAddress(row.currency1),
    poolKeyFee: integerText(row.pool_key_fee),
    tickSpacing: integerText(row.tick_spacing),
    hook: databaseAddress(row.hook),
    poolFeeConfigurationId:
      row.pool_fee_configuration_id === null
        ? null
        : exactUuid(row.pool_fee_configuration_id),
    buySwapFeeBps: nullableInteger(row.buy_swap_fee_bps),
    sellSwapFeeBps: nullableInteger(row.sell_swap_fee_bps),
    buyCreatorFeeBps: nullableInteger(row.buy_creator_fee_bps),
    sellCreatorFeeBps: nullableInteger(row.sell_creator_fee_bps),
    launcherFeeBps: nullableInteger(row.launcher_fee_bps),
    transferTaxBps: nullableInteger(row.transfer_tax_bps),
    lpFeePips: nullableInteger(row.lp_fee_pips),
    lastSourceOccurrenceId: exactUuid(row.last_source_occurrence_id),
  });
}

function parseVerifiedRewardSeed(
  rows: readonly Record<string, unknown>[],
  expectedVault: HexAddress,
): VerifiedRewardSeed | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) return projectorValidationFailure();
  const row = rows[0]!;
  const beneficiaries = exactArray(row.ordered_beneficiaries, 5).map(
    databaseAddress,
  );
  const sharesBps = exactArray(row.ordered_shares_bps, 5).map(integerText);
  if (
    beneficiaries.length < 1 ||
    beneficiaries.length !== sharesBps.length ||
    new Set(beneficiaries).size !== beneficiaries.length ||
    sharesBps.reduce((sum, share) => sum + BigInt(share), 0n) !== 10_000n ||
    databaseAddress(row.vault) !== expectedVault
  ) {
    return projectorValidationFailure();
  }
  databaseBytes32(row.allocation_hash);
  if (row.active_configuration_hash !== null) {
    databaseBytes32(row.active_configuration_hash);
  }
  databaseBytes32(row.fact_content_fingerprint);
  databaseBytes32(row.evidence_content_fingerprint);
  exactText(row.evidence_version, /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u);
  exactText(row.recovery_method, /^[a-z][a-z0-9_/-]{0,95}$/u);
  exactTimestamp(row.evidence_verified_at);
  return Object.freeze({
    allocationFactId: exactUuid(row.allocation_fact_id),
    allocationEvidenceId: exactUuid(row.allocation_evidence_id),
    factoryOccurrenceId: exactUuid(row.factory_occurrence_id),
    vault: expectedVault,
    beneficiaries: Object.freeze(beneficiaries),
    sharesBps: Object.freeze(sharesBps),
    configurationHash: databaseBytes32(row.configuration_hash),
    activeConfigurationHash:
      row.active_configuration_hash === null
        ? databaseBytes32(row.configuration_hash)
        : databaseBytes32(row.active_configuration_hash),
  });
}

function factScalar(
  fact: ProjectorEventFact,
  key: string,
): string {
  const value = fact.values[key];
  if (typeof value !== "string") return projectorValidationFailure();
  return value;
}

function factAddress(fact: ProjectorEventFact, key: string): HexAddress {
  try {
    return canonicalAddress(factScalar(fact, key));
  } catch {
    return projectorValidationFailure();
  }
}

function factBytes32(fact: ProjectorEventFact, key: string): HexBytes32 {
  try {
    return canonicalBytes32(factScalar(fact, key));
  } catch {
    return projectorValidationFailure();
  }
}

function rewardEventValues(
  fact: ProjectorEventFact,
): Readonly<Record<string, string | readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(fact.values).map(([key, value]) => {
        if (
          typeof value === "string" ||
          (Array.isArray(value) &&
            value.every((entry) => typeof entry === "string"))
        ) {
          return [key, value] as const;
        }
        return projectorValidationFailure();
      }),
    ),
  );
}

function rewardModelForScope(
  scope: ProjectorReleaseDatabaseScope,
): ProjectorRewardModel {
  if (scope.releaseId === "classic-v3") return "classic-v3";
  if (scope.releaseId.startsWith("stock-paired-")) return "stock-paired";
  return projectorValidationFailure();
}

type ParsedRewardHeader = Readonly<{
  identity: string;
  initialAllocationFactId: string;
  initialAllocationEvidenceId: string;
  poolId: HexBytes32;
  configurationEpoch: string;
  activeConfigurationHash: HexBytes32;
  totalCreatorFeesReceived: string;
}>;

function parseRewardHeader(
  row: Record<string, unknown>,
  scope: ProjectorReleaseDatabaseScope,
  expectedVault: HexAddress,
): ParsedRewardHeader {
  const checkpointBlockHash = databaseBytes32(row.checkpoint_block_hash);
  const baselineCommitment = databaseBytes32(
    row.baseline_publication_commitment,
  );
  const baselineBlockHash = databaseBytes32(row.baseline_promoted_block_hash);
  const poolId = databaseBytes32(row.pool_id);
  const activeConfigurationHash = databaseBytes32(
    row.active_configuration_hash,
  );
  const initialAllocationFactId = exactUuid(row.allocation_fact_id);
  const initialAllocationEvidenceId = exactUuid(row.allocation_evidence_id);
  const configurationEpoch = integerText(row.configuration_epoch);
  const totalCreatorFeesReceived = integerText(
    row.total_creator_fees_received,
  );
  const identityValues = [
    integerText(row.chain_id),
    exactText(row.release_id, /^[a-z0-9-]+$/u),
    exactText(row.model_id, /^[a-z0-9-]+$/u),
    exactText(row.source_group, /^[a-z0-9-]+$/u),
    exactUuid(row.epoch_id),
    integerText(row.pointer_generation),
    exactUuid(row.checkpoint_id),
    exactText(row.projector_version, /^[a-z0-9._-]+$/u),
    integerText(row.checkpoint_generation),
    integerText(row.reorg_generation),
    integerText(row.checkpoint_block_number),
    checkpointBlockHash,
    exactUuid(row.reward_vault_projection_id),
    initialAllocationFactId,
    initialAllocationEvidenceId,
    databaseAddress(row.vault),
    poolId,
    row.quote_asset === null ? null : databaseAddress(row.quote_asset),
    databaseBytes32(row.configuration_hash),
    activeConfigurationHash,
    totalCreatorFeesReceived,
    configurationEpoch,
    exactUuid(row.baseline_projection_run_id),
    baselineCommitment,
    integerText(row.baseline_promoted_block_number),
    baselineBlockHash,
    exactUuid(row.vault_source_occurrence_id),
    exactUuid(row.vault_source_logical_event_id),
    databaseBytes32(row.vault_source_block_hash),
  ];
  if (
    identityValues[0] !== "1" ||
    identityValues[1] !== scope.releaseId ||
    identityValues[2] !== scope.modelId ||
    identityValues[3] !== scope.sourceGroup ||
    identityValues[15] !== expectedVault
  ) {
    return projectorValidationFailure();
  }
  return Object.freeze({
    identity: JSON.stringify(identityValues),
    initialAllocationFactId,
    initialAllocationEvidenceId,
    poolId,
    configurationEpoch,
    activeConfigurationHash,
    totalCreatorFeesReceived,
  });
}

export function parseProjectorRewardStateRows(input: Readonly<{
  activeRows: readonly Record<string, unknown>[];
  balanceRows: readonly Record<string, unknown>[];
  scope: ProjectorReleaseDatabaseScope;
  vault: HexAddress;
}>): ProjectorRewardState {
  if (
    input.activeRows.length < 1 ||
    input.activeRows.length > 8 ||
    input.balanceRows.length < 1 ||
    input.balanceRows.length > 10_000
  ) {
    return projectorValidationFailure();
  }
  const header = parseRewardHeader(
    input.activeRows[0]!,
    input.scope,
    input.vault,
  );
  const model = rewardModelForScope(input.scope);
  const activeBalances = new Map<HexAddress, Readonly<{
    payoutAddress: HexAddress;
    claimableAccrued: string;
    claimedTotal: string;
  }>>();
  const allocations = input.activeRows.map((row, allocationIndex) => {
    const candidateHeader = parseRewardHeader(row, input.scope, input.vault);
    const parsedIndex = Number(integerText(row.allocation_index));
    const beneficiary = databaseAddress(row.beneficiary);
    const payoutAddress = databaseAddress(row.payout_address);
    const shareBps = integerText(row.share_bps);
    const claimableAccrued = integerText(row.claimable_accrued);
    const claimedTotal = integerText(row.claimed_total);
    exactUuid(row.balance_projection_run_id);
    databaseBytes32(row.balance_publication_commitment);
    integerText(row.balance_promoted_block_number);
    databaseBytes32(row.balance_promoted_block_hash);
    exactUuid(row.allocation_source_occurrence_id);
    exactUuid(row.allocation_source_logical_event_id);
    databaseBytes32(row.allocation_source_block_hash);
    exactUuid(row.balance_source_occurrence_id);
    exactUuid(row.balance_source_logical_event_id);
    databaseBytes32(row.balance_source_block_hash);
    exactTimestamp(row.verified_at);
    const existingActiveBalance = activeBalances.get(beneficiary);
    if (
      candidateHeader.identity !== header.identity ||
      parsedIndex !== allocationIndex ||
      BigInt(shareBps) < 1n ||
      BigInt(shareBps) > 10_000n ||
      (model === "classic-v3" && beneficiary !== payoutAddress) ||
      (model === "stock-paired" && existingActiveBalance !== undefined) ||
      (existingActiveBalance !== undefined &&
        (existingActiveBalance.payoutAddress !== payoutAddress ||
          existingActiveBalance.claimableAccrued !== claimableAccrued ||
          existingActiveBalance.claimedTotal !== claimedTotal))
    ) {
      return projectorValidationFailure();
    }
    activeBalances.set(beneficiary, {
      payoutAddress,
      claimableAccrued,
      claimedTotal,
    });
    return Object.freeze({
      allocationIndex,
      beneficiary,
      payoutAddress,
      shareBps,
    });
  });
  const balances = input.balanceRows.map((row, balanceIndex) => {
    const candidateHeader = parseRewardHeader(row, input.scope, input.vault);
    const account = databaseAddress(row.account);
    const payoutAddress = databaseAddress(row.payout_address);
    exactUuid(row.account_reward_balance_id);
    exactText(row.payout_source_kind, /^[a-z][a-z0-9_-]{0,95}$/u);
    if (row.payout_configuration_epoch !== null) {
      integerText(row.payout_configuration_epoch);
    }
    const claimableAccrued = integerText(row.claimable_accrued);
    const claimedTotal = integerText(row.claimed_total);
    exactUuid(row.balance_projection_run_id);
    databaseBytes32(row.balance_publication_commitment);
    integerText(row.balance_promoted_block_number);
    databaseBytes32(row.balance_promoted_block_hash);
    exactUuid(row.payout_projection_run_id);
    databaseBytes32(row.payout_publication_commitment);
    integerText(row.payout_promoted_block_number);
    databaseBytes32(row.payout_promoted_block_hash);
    exactUuid(row.payout_source_occurrence_id);
    exactUuid(row.payout_source_logical_event_id);
    databaseBytes32(row.payout_source_block_hash);
    exactUuid(row.balance_source_occurrence_id);
    exactUuid(row.balance_source_logical_event_id);
    databaseBytes32(row.balance_source_block_hash);
    exactTimestamp(row.verified_at);
    const prior = balanceIndex === 0
      ? null
      : databaseAddress(input.balanceRows[balanceIndex - 1]!.account);
    if (
      candidateHeader.identity !== header.identity ||
      (prior !== null && prior.localeCompare(account) >= 0) ||
      (model === "classic-v3" && payoutAddress !== account)
    ) {
      return projectorValidationFailure();
    }
    const active = activeBalances.get(account);
    if (
      active &&
      (active.payoutAddress !== payoutAddress ||
        active.claimableAccrued !== claimableAccrued ||
        active.claimedTotal !== claimedTotal)
    ) {
      return projectorValidationFailure();
    }
    return Object.freeze({
      account,
      payoutAddress,
      claimableAccrued,
      claimedTotal,
    });
  });
  if (
    [...activeBalances.keys()].some(
      (account) => !balances.some((balance) => balance.account === account),
    )
  ) {
    return projectorValidationFailure();
  }
  return Object.freeze({
    model,
    initialAllocationFactId: header.initialAllocationFactId,
    initialAllocationEvidenceId: header.initialAllocationEvidenceId,
    baseline: Object.freeze({
      vault: input.vault,
      poolId: header.poolId,
      configurationEpoch: header.configurationEpoch,
      activeConfigurationHash: header.activeConfigurationHash,
      allocations: Object.freeze(allocations),
      balances: Object.freeze(balances),
    }),
  });
}

async function stageCompletedLaunch(input: {
  transaction: PostgresTransaction;
  runId: string;
  launch: ProjectorCompletedLaunch;
  occurrenceWrites: ReadonlyMap<string, OccurrenceWrite>;
  targetBlockNumber: string;
  targetBlockHash: HexBytes32;
  verifiedAt: string;
  scope: ProjectorReleaseDatabaseScope;
  stagedPools: Map<
    HexBytes32,
    Readonly<{
      poolProjectionId: string;
      launchProjectionId: string;
      token: HexAddress;
      creator: HexAddress;
      rewardVault: HexAddress | null;
      quoteAsset: HexAddress | null;
    }>
  >;
  allocationPairs: Array<{ factId: string; evidenceId: string }>;
  stagedRewardStates: Map<HexAddress, ProjectorRewardState>;
}): Promise<void> {
  const occurrenceId = (candidateId: string) => {
    const value = input.occurrenceWrites.get(candidateId)?.occurrenceId;
    if (!value) return projectorValidationFailure();
    return value;
  };
  const launchRole = input.launch.occurrenceRoles.find(
    ({ sourceRole }) => sourceRole === "launcher",
  );
  if (!launchRole || input.stagedPools.has(input.launch.poolId)) {
    return projectorValidationFailure();
  }
  const launchOccurrenceId = occurrenceId(launchRole.candidateId);
  const launchProjectionId = deterministicUuid(
    "launch-projection",
    input.runId,
    input.launch.token,
  );
  exactIdResult(
    await input.transaction.query(
      "select programmable_private.stage_launch_projection($1::uuid, $2::uuid, $3::bytea, $4::bytea, $5::bytea, $6::bytea, $7::bytea, $8::bytea, $9, $10, $11::numeric, $12::uuid, $13::numeric, $14::bytea, $15::timestamptz) as id",
      [
        launchProjectionId,
        input.runId,
        hexToBytes(input.launch.token),
        hexToBytes(input.launch.creator),
        hexToBytes(input.launch.launchTransactionHash),
        hexToBytes(input.launch.poolId),
        input.launch.rewardVault === null
          ? null
          : hexToBytes(input.launch.rewardVault),
        hexToBytes(input.launch.launchHash),
        input.launch.tokenName,
        input.launch.tokenSymbol,
        input.launch.totalSupply,
        launchOccurrenceId,
        input.targetBlockNumber,
        hexToBytes(input.targetBlockHash),
        input.verifiedAt,
      ],
    ),
    launchProjectionId,
  );
  const poolProjectionId = deterministicUuid(
    "pool-projection",
    input.runId,
    input.launch.poolId,
  );
  const poolOccurrenceId = occurrenceId(
    input.launch.pool.sourceCandidateId,
  );
  exactIdResult(
    await input.transaction.query(
      "select programmable_private.stage_pool_projection($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea, $6::numeric, $7::integer, $8::bytea, $9::uuid, $10::numeric, $11::bytea, $12::timestamptz) as id",
      [
        poolProjectionId,
        launchProjectionId,
        input.runId,
        hexToBytes(input.launch.pool.currency0),
        hexToBytes(input.launch.pool.currency1),
        input.launch.pool.poolKeyFee,
        input.launch.pool.tickSpacing,
        hexToBytes(input.launch.pool.hook),
        poolOccurrenceId,
        input.targetBlockNumber,
        hexToBytes(input.targetBlockHash),
        input.verifiedAt,
      ],
    ),
    poolProjectionId,
  );
  const feeConfigurationId = deterministicUuid(
    "pool-fee-configuration",
    input.runId,
    input.launch.poolId,
  );
  const feeOccurrenceId = occurrenceId(
    input.launch.feeConfiguration.sourceCandidateId,
  );
  if (input.scope.releaseId === "classic-v3") {
    exactIdResult(
      await input.transaction.query(
        "select programmable_private.stage_pool_fee_configuration_v2($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12::uuid, $13::numeric, $14::bytea, $15::timestamptz) as id",
        [
          feeConfigurationId,
          poolProjectionId,
          input.runId,
          input.launch.feeConfiguration.buySwapFeeBps,
          input.launch.feeConfiguration.sellSwapFeeBps,
          input.launch.feeConfiguration.buyCreatorFeeBps,
          input.launch.feeConfiguration.sellCreatorFeeBps,
          input.launch.feeConfiguration.launcherFeeBps,
          input.launch.feeConfiguration.transferTaxBps,
          input.launch.feeConfiguration.lpFeePips,
          feeOccurrenceId,
          input.targetBlockNumber,
          hexToBytes(input.targetBlockHash),
          input.verifiedAt,
        ],
      ),
      feeConfigurationId,
    );
  } else {
    if (
      input.launch.feeConfiguration.buyCreatorFeeBps !==
      input.launch.feeConfiguration.sellCreatorFeeBps
    ) {
      return projectorValidationFailure();
    }
    exactIdResult(
      await input.transaction.query(
        "select programmable_private.stage_pool_fee_configuration($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::uuid, $11::numeric, $12::bytea, $13::timestamptz) as id",
        [
          feeConfigurationId,
          poolProjectionId,
          input.runId,
          input.launch.feeConfiguration.buySwapFeeBps,
          input.launch.feeConfiguration.sellSwapFeeBps,
          input.launch.feeConfiguration.buyCreatorFeeBps,
          input.launch.feeConfiguration.launcherFeeBps,
          input.launch.feeConfiguration.transferTaxBps,
          input.launch.feeConfiguration.lpFeePips,
          feeOccurrenceId,
          input.targetBlockNumber,
          hexToBytes(input.targetBlockHash),
          input.verifiedAt,
        ],
      ),
      feeConfigurationId,
    );
  }
  const liquidityOccurrenceId = occurrenceId(
    input.launch.liquidity.sourceCandidateId,
  );
  const liquidityFactId = deterministicUuid(
    "launch-liquidity",
    input.runId,
    input.launch.token,
  );
  const liquidityCommitment = keccak256(
    toBytes(
      JSON.stringify([
        input.launch.positionRecipient,
        input.launch.positionTokenId,
        input.launch.liquidity,
      ]),
    ),
  );
  exactIdResult(
    await input.transaction.query(
      "select programmable_private.stage_launch_position_liquidity_v1($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::integer, $10::integer, $11::integer, $12::uuid, $13::bytea, $14::timestamptz) as id",
      [
        liquidityFactId,
        launchProjectionId,
        input.runId,
        hexToBytes(input.launch.positionRecipient),
        input.launch.positionTokenId,
        input.launch.liquidity.tokenLiquidityAmount,
        input.launch.liquidity.lockedTokenDust,
        input.launch.liquidity.initialSqrtPriceX96,
        input.launch.liquidity.initialTick,
        input.launch.liquidity.tickLower,
        input.launch.liquidity.tickUpper,
        liquidityOccurrenceId,
        hexToBytes(liquidityCommitment),
        input.verifiedAt,
      ],
    ),
    liquidityFactId,
  );
  exactIdResult(
    await input.transaction.query(
      "select programmable_private.stage_launch_projection_conditions($1::uuid, $2::boolean, $3::timestamptz) as id",
      [launchProjectionId, input.launch.ethFunded, input.verifiedAt],
    ),
    launchProjectionId,
  );
  for (const role of [...input.launch.occurrenceRoles].sort((left, right) =>
    left.sourceRole.localeCompare(right.sourceRole),
  )) {
    exactIdResult(
      await input.transaction.query(
        "select programmable_private.stage_launch_occurrence_role($1::uuid, $2, $3::uuid, $4::timestamptz) as id",
        [
          launchProjectionId,
          role.sourceRole,
          occurrenceId(role.candidateId),
          input.verifiedAt,
        ],
      ),
      launchProjectionId,
    );
  }

  if (input.launch.custody) {
    const custodyId = deterministicUuid(
      "initial-buy-custody",
      input.runId,
      input.launch.token,
    );
    exactIdResult(
      await input.transaction.query(
        "select programmable_private.stage_initial_buy_custody_projection($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::smallint, $6::integer, $7::integer, $8::bytea, $9::uuid, $10::numeric, $11::bytea, $12::timestamptz) as id",
        [
          custodyId,
          launchProjectionId,
          input.runId,
          hexToBytes(input.launch.custody.address),
          input.launch.custody.mode,
          input.launch.custody.durationDays,
          input.launch.custody.cliffDays,
          hexToBytes(input.launch.custody.configurationHash),
          occurrenceId(input.launch.custody.sourceCandidateId),
          input.targetBlockNumber,
          hexToBytes(input.targetBlockHash),
          input.verifiedAt,
        ],
      ),
      custodyId,
    );
    if (input.launch.custody.vestingSourceCandidateId !== null) {
      if (
        input.launch.custody.vestingStartTimestamp === null ||
        input.launch.custody.vestingEndTimestamp === null
      ) {
        return projectorValidationFailure();
      }
      const vestingId = deterministicUuid(
        "initial-buy-vesting",
        input.runId,
        input.launch.token,
      );
      exactIdResult(
        await input.transaction.query(
          "select programmable_private.stage_initial_buy_vesting_projection($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea, $6::numeric, $7::timestamptz, $8::timestamptz, $9::uuid, $10::numeric, $11::bytea, $12::timestamptz) as id",
          [
            vestingId,
            custodyId,
            input.runId,
            hexToBytes(input.launch.creator),
            hexToBytes(input.launch.token),
            input.launch.initialBuy.tokenAmount,
            unixSecondsTimestamp(input.launch.custody.vestingStartTimestamp),
            unixSecondsTimestamp(input.launch.custody.vestingEndTimestamp),
            occurrenceId(input.launch.custody.vestingSourceCandidateId),
            input.targetBlockNumber,
            hexToBytes(input.targetBlockHash),
            input.verifiedAt,
          ],
        ),
        vestingId,
      );
    }
  }

  const quoteAsset =
    input.launch.model === "classic"
      ? null
      : input.launch.initialBuy.fundingAsset;
  if (input.launch.rewardVault !== null) {
    const seed = parseVerifiedRewardSeed(
      await input.transaction.query(
        "select * from programmable_private.get_projector_verified_reward_seed_v1($1::uuid, $2::bytea)",
        [input.runId, hexToBytes(input.launch.rewardVault)],
      ),
      input.launch.rewardVault,
    );
    if (!seed) {
      throw new ProjectorDatabaseError({
        sqlState: "23514",
        disposition: "abort-batch-invariant",
        retryable: false,
      });
    }
    const factoryRole = input.launch.occurrenceRoles.find(
      ({ sourceRole }) => sourceRole === "vault_factory",
    );
    if (
      !factoryRole ||
      occurrenceId(factoryRole.candidateId) !== seed.factoryOccurrenceId
    ) {
      return projectorValidationFailure();
    }
    const rewardVaultProjectionId = deterministicUuid(
      "reward-vault-projection",
      input.runId,
      input.launch.rewardVault,
    );
    exactIdResult(
      await input.transaction.query(
        "select programmable_private.stage_reward_vault_projection($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea, $6::bytea, $7::bytea, $8::uuid, $9::uuid, $10::numeric, $11::bytea, $12::timestamptz) as id",
        [
          rewardVaultProjectionId,
          launchProjectionId,
          input.runId,
          hexToBytes(input.launch.rewardVault),
          hexToBytes(input.launch.poolId),
          quoteAsset === null ? null : hexToBytes(quoteAsset),
          hexToBytes(seed.configurationHash),
          seed.allocationFactId,
          seed.factoryOccurrenceId,
          input.targetBlockNumber,
          hexToBytes(input.targetBlockHash),
          input.verifiedAt,
        ],
      ),
      rewardVaultProjectionId,
    );
    seed.beneficiaries.forEach((_beneficiary, index) => {
      if (BigInt(seed.sharesBps[index]!) <= 0n) {
        return projectorValidationFailure();
      }
    });
    for (let index = 0; index < seed.beneficiaries.length; index += 1) {
      const beneficiary = seed.beneficiaries[index]!;
      const allocationId = deterministicUuid(
        "reward-allocation-projection",
        input.runId,
        seed.allocationFactId,
        String(index),
      );
      exactIdResult(
        await input.transaction.query(
          "select programmable_private.stage_reward_allocation_projection($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, $6::integer, $7::bytea, $8::bytea, $9::numeric, $10::numeric, $11::numeric, $12::uuid, $13::numeric, $14::bytea, $15::timestamptz) as id",
          [
            allocationId,
            rewardVaultProjectionId,
            input.runId,
            seed.allocationFactId,
            1,
            index,
            hexToBytes(beneficiary),
            hexToBytes(beneficiary),
            seed.sharesBps[index]!,
            input.targetBlockNumber,
            null,
            seed.factoryOccurrenceId,
            input.targetBlockNumber,
            hexToBytes(input.targetBlockHash),
            input.verifiedAt,
          ],
        ),
        allocationId,
      );
      const balanceId = deterministicUuid(
        "account-reward-balance",
        input.runId,
        input.launch.rewardVault,
        beneficiary,
      );
      exactIdResult(
        await input.transaction.query(
          "select programmable_private.stage_account_reward_balance($1::uuid, $2::uuid, $3::bytea, $4::bytea, $5::numeric, $6::numeric, $7::uuid, $8::numeric, $9::bytea, $10::timestamptz) as id",
          [
            balanceId,
            input.runId,
            hexToBytes(beneficiary),
            hexToBytes(input.launch.rewardVault),
            "0",
            "0",
            seed.factoryOccurrenceId,
            input.targetBlockNumber,
            hexToBytes(input.targetBlockHash),
            input.verifiedAt,
          ],
        ),
        balanceId,
      );
    }
    input.allocationPairs.push({
      factId: seed.allocationFactId,
      evidenceId: seed.allocationEvidenceId,
    });
    if (input.stagedRewardStates.has(input.launch.rewardVault)) {
      return projectorValidationFailure();
    }
    input.stagedRewardStates.set(
      input.launch.rewardVault,
      Object.freeze({
        model: rewardModelForScope(input.scope),
        initialAllocationFactId: seed.allocationFactId,
        initialAllocationEvidenceId: seed.allocationEvidenceId,
        baseline: Object.freeze({
          vault: input.launch.rewardVault,
          poolId: input.launch.poolId,
          configurationEpoch: "1",
          activeConfigurationHash: seed.activeConfigurationHash,
          allocations: Object.freeze(
            seed.beneficiaries.map((beneficiary, allocationIndex) =>
              Object.freeze({
                allocationIndex,
                beneficiary,
                payoutAddress: beneficiary,
                shareBps: seed.sharesBps[allocationIndex]!,
              }),
            ),
          ),
          balances: Object.freeze(
            seed.beneficiaries.map((beneficiary) =>
              Object.freeze({
                account: beneficiary,
                payoutAddress: beneficiary,
                claimableAccrued: "0",
                claimedTotal: "0",
              }),
            ),
          ),
        }),
      }),
    );
  }
  input.stagedPools.set(
    input.launch.poolId,
    Object.freeze({
      poolProjectionId,
      launchProjectionId,
      token: input.launch.token,
      creator: input.launch.creator,
      rewardVault: input.launch.rewardVault,
      quoteAsset,
    }),
  );
}

async function stageIncrementalFacts(input: {
  transaction: PostgresTransaction;
  runId: string;
  scope: ProjectorReleaseDatabaseScope;
  occurrenceWrites: ReadonlyMap<string, OccurrenceWrite>;
  stagedPools: Map<
    HexBytes32,
    Readonly<{
      poolProjectionId: string;
      launchProjectionId: string;
      token: HexAddress;
      creator: HexAddress;
      rewardVault: HexAddress | null;
      quoteAsset: HexAddress | null;
    }>
  >;
  stagedRewardStates: ReadonlyMap<HexAddress, ProjectorRewardState>;
  allocationPairs: Array<{ factId: string; evidenceId: string }>;
  targetBlockNumber: string;
  targetBlockHash: HexBytes32;
  verifiedAt: string;
  verifiedRewardSnapshots: readonly ProjectorRewardSnapshot[];
}): Promise<Readonly<{
  rewardDeltas: readonly Readonly<{
    vault: HexAddress;
    allocationFactId: string;
    allocationEvidenceId: string;
  }>[];
}>> {
  const handledByLaunch = new Set([
    "launch",
    "liquidity",
    "initial-buy",
    "initial-buy-custody",
    "pool-registration",
    "fee-disclosure",
    "reward-vault-deployment",
    "vesting-wallet-deployment",
    "eth-launch-coordinator",
  ]);
  const detailedPools = new Map<HexBytes32, DetailedPoolBaseline>();
  const poolState = async (poolId: HexBytes32) => {
    const staged = input.stagedPools.get(poolId);
    if (staged) return staged;
    const cached = detailedPools.get(poolId);
    if (cached) {
      return Object.freeze({
        poolProjectionId: cached.poolProjectionId,
        launchProjectionId: cached.launchProjectionId,
        token: cached.token,
        creator: cached.creator,
        rewardVault: cached.rewardVault,
        quoteAsset:
          cached.token === cached.currency0
            ? cached.currency1 === ZERO_ADDRESS
              ? null
              : cached.currency1
            : cached.currency0 === ZERO_ADDRESS
              ? null
              : cached.currency0,
      });
    }
    const baseline = parseDetailedPoolBaseline(
      await input.transaction.query(
        "select * from programmable_private.get_projector_pool_baseline_by_id_v1($1::uuid, $2::bytea)",
        [input.runId, hexToBytes(poolId)],
      ),
    );
    if (!baseline) return projectorValidationFailure();
    detailedPools.set(poolId, baseline);
    return Object.freeze({
      poolProjectionId: baseline.poolProjectionId,
      launchProjectionId: baseline.launchProjectionId,
      token: baseline.token,
      creator: baseline.creator,
      rewardVault: baseline.rewardVault,
      quoteAsset:
        baseline.token === baseline.currency0
          ? baseline.currency1 === ZERO_ADDRESS
            ? null
            : baseline.currency1
          : baseline.currency0 === ZERO_ADDRESS
            ? null
            : baseline.currency0,
    });
  };
  const feeDeltas = new Map<
    string,
    {
      poolId: HexBytes32;
      quoteAsset: HexAddress | null;
      gross: bigint;
      creator: bigint;
      launcher: bigint;
      lastOccurrenceId: string;
    }
  >();
  const rewardEvents = new Map<HexAddress, ProjectorRewardEvent[]>();

  for (const write of input.occurrenceWrites.values()) {
    const { fact, occurrenceId } = write;
    if (handledByLaunch.has(fact.kind)) continue;
    if (
      fact.kind === "creator-fee-checkpoint" ||
      fact.kind === "beneficiary-claim" ||
      fact.kind === "payout-change" ||
      fact.kind === "reward-configuration-activation"
    ) {
      if (input.scope.releaseId === "classic-v2") {
        return projectorValidationFailure();
      }
      const vault = write.occurrence.sourceAddress;
      const events = rewardEvents.get(vault) ?? [];
      events.push(
        Object.freeze({
          occurrenceId,
          vault,
          blockNumber: write.occurrence.blockNumber,
          transactionIndex: String(write.occurrence.transactionIndex),
          blockGlobalLogIndex: String(
            write.occurrence.blockGlobalLogIndex,
          ),
          kind: fact.kind,
          values: rewardEventValues(fact),
        }),
      );
      rewardEvents.set(vault, events);
    }
    if (fact.kind === "fee-accrual") {
      const poolId = factBytes32(fact, "poolId");
      const pool = await poolState(poolId);
      const quoteAsset =
        typeof fact.values.quoteAsset === "string"
          ? factAddress(fact, "quoteAsset")
          : pool.quoteAsset;
      if (quoteAsset !== pool.quoteAsset) return projectorValidationFailure();
      const gross = BigInt(factScalar(fact, "grossAmount"));
      const creator = BigInt(factScalar(fact, "creatorFee"));
      const launcher = BigInt(factScalar(fact, "launcherFee"));
      const factId = deterministicUuid(
        "fee-accrual-fact",
        input.runId,
        occurrenceId,
      );
      exactIdResult(
        await input.transaction.query(
          "select programmable_private.stage_fee_accrual_fact($1::uuid, $2::uuid, $3::bytea, $4::bytea, $5::numeric, $6::numeric, $7::numeric, $8::uuid, $9::numeric, $10::bytea, $11::timestamptz) as id",
          [
            factId,
            input.runId,
            hexToBytes(poolId),
            quoteAsset === null ? null : hexToBytes(quoteAsset),
            gross.toString(),
            creator.toString(),
            launcher.toString(),
            occurrenceId,
            input.targetBlockNumber,
            hexToBytes(input.targetBlockHash),
            input.verifiedAt,
          ],
        ),
        factId,
      );
      const key = `${poolId}:${quoteAsset ?? "native"}`;
      const current = feeDeltas.get(key);
      feeDeltas.set(key, {
        poolId,
        quoteAsset,
        gross: (current?.gross ?? 0n) + gross,
        creator: (current?.creator ?? 0n) + creator,
        launcher: (current?.launcher ?? 0n) + launcher,
        lastOccurrenceId: occurrenceId,
      });
      continue;
    }
    if (fact.kind === "creator-hook-claim") {
      const poolId = factBytes32(fact, "poolId");
      const pool = await poolState(poolId);
      const claimId = deterministicUuid(
        "creator-hook-claim",
        input.runId,
        occurrenceId,
      );
      exactIdResult(
        await input.transaction.query(
          "select programmable_private.append_creator_hook_claim_fact($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea, $6::bytea, $7::bytea, $8::bytea, $9::bytea, $10::numeric, $11::timestamptz) as id",
          [
            claimId,
            input.runId,
            occurrenceId,
            hexToBytes(poolId),
            typeof fact.values.rewardVault === "string"
              ? hexToBytes(factAddress(fact, "rewardVault"))
              : pool.rewardVault === null
                ? null
                : hexToBytes(pool.rewardVault),
            typeof fact.values.creator === "string"
              ? hexToBytes(factAddress(fact, "creator"))
              : null,
            typeof fact.values.recipient === "string"
              ? hexToBytes(factAddress(fact, "recipient"))
              : null,
            pool.quoteAsset === null ? null : hexToBytes(pool.quoteAsset),
            hexToBytes(factAddress(fact, "caller")),
            factScalar(fact, "amount"),
            input.verifiedAt,
          ],
        ),
        claimId,
      );
      continue;
    }
    if (fact.kind === "launcher-hook-claim") {
      const claimId = deterministicUuid(
        "launcher-hook-claim",
        input.runId,
        occurrenceId,
      );
      exactIdResult(
        await input.transaction.query(
          "select programmable_private.append_launcher_hook_claim_fact($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea, $6::bytea, $7::bytea, $8::numeric, $9::timestamptz) as id",
          [
            claimId,
            input.runId,
            occurrenceId,
            hexToBytes(factAddress(fact, "treasury")),
            hexToBytes(factAddress(fact, "recipient")),
            typeof fact.values.quoteAsset === "string"
              ? hexToBytes(factAddress(fact, "quoteAsset"))
              : null,
            hexToBytes(factAddress(fact, "caller")),
            factScalar(fact, "amount"),
            input.verifiedAt,
          ],
        ),
        claimId,
      );
      continue;
    }
    if (fact.kind === "creator-fee-checkpoint") {
      const checkpointId = deterministicUuid(
        "creator-fee-checkpoint",
        input.runId,
        occurrenceId,
      );
      exactIdResult(
        await input.transaction.query(
          "select programmable_private.append_creator_fee_checkpoint_fact($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::numeric, $6::numeric, $7::numeric, $8::timestamptz) as id",
          [
            checkpointId,
            input.runId,
            occurrenceId,
            hexToBytes(factBytes32(fact, "poolId")),
            factScalar(fact, "configurationEpoch"),
            factScalar(fact, "amount"),
            factScalar(fact, "totalCreatorFeesReceived"),
            input.verifiedAt,
          ],
        ),
        checkpointId,
      );
      continue;
    }
    if (fact.kind === "beneficiary-claim") {
      const vault = write.occurrence.sourceAddress;
      const beneficiary = factAddress(fact, "beneficiary");
      const recipient =
        typeof fact.values.payoutAddress === "string"
          ? factAddress(fact, "payoutAddress")
          : beneficiary;
      const claimId = deterministicUuid(
        "beneficiary-claim",
        input.runId,
        occurrenceId,
      );
      exactIdResult(
        await input.transaction.query(
          "select programmable_private.stage_claim_projection($1::uuid, $2::uuid, $3::bytea, $4, $5::bytea, $6::bytea, $7::numeric, $8::numeric, $9::numeric, $10::uuid, $11::numeric, $12::bytea, $13::timestamptz) as id",
          [
            claimId,
            input.runId,
            hexToBytes(vault),
            "beneficiary",
            hexToBytes(beneficiary),
            hexToBytes(recipient),
            factScalar(fact, "amount"),
            factScalar(fact, "beneficiaryTotalClaimed"),
            factScalar(fact, "vaultTotalReceived"),
            occurrenceId,
            input.targetBlockNumber,
            hexToBytes(input.targetBlockHash),
            input.verifiedAt,
          ],
        ),
        claimId,
      );
      continue;
    }
    if (fact.kind === "payout-change") {
      const vault = write.occurrence.sourceAddress;
      const isClassic = input.scope.releaseId === "classic-v3";
      const previousPayoutAddress = factAddress(
        fact,
        isClassic ? "previousPayoutWallet" : "previousPayoutAddress",
      );
      const newPayoutAddress = factAddress(
        fact,
        isClassic ? "newPayoutWallet" : "newPayoutAddress",
      );
      const beneficiary = isClassic
        ? previousPayoutAddress
        : factAddress(fact, "beneficiary");
      const payoutChangeId = deterministicUuid(
        "payout-change",
        input.runId,
        occurrenceId,
      );
      exactIdResult(
        await input.transaction.query(
          "select programmable_private.stage_payout_change_projection($1::uuid, $2::uuid, $3::bytea, $4::bytea, $5::bytea, $6::bytea, $7::bigint, $8::uuid, $9::numeric, $10::bytea, $11::timestamptz) as id",
          [
            payoutChangeId,
            input.runId,
            hexToBytes(vault),
            hexToBytes(beneficiary),
            hexToBytes(previousPayoutAddress),
            hexToBytes(newPayoutAddress),
            isClassic ? factScalar(fact, "configurationEpoch") : null,
            occurrenceId,
            input.targetBlockNumber,
            hexToBytes(input.targetBlockHash),
            input.verifiedAt,
          ],
        ),
        payoutChangeId,
      );
      continue;
    }
    if (fact.kind === "reward-configuration-activation") {
      const activationId = deterministicUuid(
        "reward-configuration-activation",
        input.runId,
        occurrenceId,
      );
      const beneficiaries = fact.values.beneficiaries;
      const shares = fact.values.sharesBps;
      if (!Array.isArray(beneficiaries) || !Array.isArray(shares)) {
        return projectorValidationFailure();
      }
      exactIdResult(
        await input.transaction.query(
          "select programmable_private.append_reward_configuration_activation_fact($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea, $6::numeric, $7::bytea, $8::bytea, $9::bytea[], $10::numeric[], $11::numeric, $12::timestamptz) as id",
          [
            activationId,
            input.runId,
            occurrenceId,
            hexToBytes(factBytes32(fact, "poolId")),
            hexToBytes(factBytes32(fact, "approvalReference")),
            factScalar(fact, "configurationEpoch"),
            hexToBytes(factBytes32(fact, "previousConfigurationHash")),
            hexToBytes(factBytes32(fact, "newConfigurationHash")),
            beneficiaries.map((value) => {
              if (typeof value !== "string") return projectorValidationFailure();
              return hexToBytes(canonicalAddress(value));
            }),
            shares.map((value) => {
              if (typeof value !== "string") return projectorValidationFailure();
              return integerText(value);
            }),
            factScalar(fact, "effectiveTotalCreatorFeesReceived"),
            input.verifiedAt,
          ],
        ),
        activationId,
      );
      continue;
    }
    return projectorValidationFailure();
  }

  const verifiedSnapshots = new Map(
    input.verifiedRewardSnapshots.map((snapshot) => [snapshot.vault, snapshot]),
  );
  if (verifiedSnapshots.size !== input.verifiedRewardSnapshots.length) {
    return projectorValidationFailure();
  }
  const rewardDeltas: Array<Readonly<{
    vault: HexAddress;
    allocationFactId: string;
    allocationEvidenceId: string;
  }>> = [];
  for (const [vault, events] of rewardEvents) {
    const occurrenceIds = orderedRewardOccurrenceIds(events, vault);
    const eventByOccurrenceId = new Map(
      events.map((event) => [event.occurrenceId, event]),
    );
    const orderedEvents = occurrenceIds.map((occurrenceId) => {
      const event = eventByOccurrenceId.get(occurrenceId);
      if (!event) return projectorValidationFailure();
      return event;
    });
    const staged = input.stagedRewardStates.get(vault);
    const state = staged ?? parseProjectorRewardStateRows({
      activeRows: await input.transaction.query(
        "select * from programmable_private.get_projector_reward_state_by_vault_v1($1::uuid, $2::bytea)",
        [input.runId, hexToBytes(vault)],
      ),
      balanceRows: await input.transaction.query(
        "select * from programmable_private.get_projector_reward_balances_by_vault_v1($1::uuid, $2::bytea)",
        [input.runId, hexToBytes(vault)],
      ),
      scope: input.scope,
      vault,
    });
    if (
      state.model !== rewardModelForScope(input.scope) ||
      state.baseline.vault !== vault
    ) {
      return projectorValidationFailure();
    }
    const snapshot = foldProjectorRewardState({
      model: state.model,
      baseline: state.baseline,
      events: orderedEvents,
    });
    if (
      snapshot.activeConfigurationHash === null ||
      !verifiedSnapshots.has(vault) ||
      JSON.stringify(snapshot) !== JSON.stringify(verifiedSnapshots.get(vault))
    ) {
      return projectorValidationFailure();
    }
    const snapshotRows = await input.transaction.query<{ id: unknown }>(
      "select programmable_private.stage_current_reward_snapshot_v2($1::uuid, $2::bytea, $3::bytea, $4::uuid, $5::bigint, $6::bytea, $7::numeric, $8::integer[], $9::bytea[], $10::bytea[], $11::numeric[], $12::bytea[], $13::bytea[], $14::numeric[], $15::numeric[], $16::uuid, $17::uuid[], $18::numeric, $19::bytea, $20::timestamptz) as id",
      [
        input.runId,
        hexToBytes(snapshot.vault),
        hexToBytes(snapshot.poolId),
        state.initialAllocationFactId,
        snapshot.configurationEpoch,
        hexToBytes(snapshot.activeConfigurationHash),
        snapshot.totalCreatorFeesReceived,
        snapshot.allocations.map(({ allocationIndex }) => allocationIndex),
        snapshot.allocations.map(({ beneficiary }) => hexToBytes(beneficiary)),
        snapshot.allocations.map(({ payoutAddress }) => hexToBytes(payoutAddress)),
        snapshot.allocations.map(({ shareBps }) => shareBps),
        snapshot.balances.map(({ account }) => hexToBytes(account)),
        snapshot.balances.map(({ payoutAddress }) => hexToBytes(payoutAddress)),
        snapshot.balances.map(({ claimableAccrued }) => claimableAccrued),
        snapshot.balances.map(({ claimedTotal }) => claimedTotal),
        snapshot.snapshotSourceOccurrenceId,
        occurrenceIds,
        input.targetBlockNumber,
        hexToBytes(input.targetBlockHash),
        input.verifiedAt,
      ],
    );
    if (snapshotRows.length !== 1) return projectorValidationFailure();
    exactUuid(snapshotRows[0]!.id);
    input.allocationPairs.push({
      factId: state.initialAllocationFactId,
      evidenceId: state.initialAllocationEvidenceId,
    });
    rewardDeltas.push(Object.freeze({
      vault,
      allocationFactId: state.initialAllocationFactId,
      allocationEvidenceId: state.initialAllocationEvidenceId,
    }));
  }

  if (rewardEvents.size !== verifiedSnapshots.size) {
    return projectorValidationFailure();
  }

  for (const delta of feeDeltas.values()) {
    const baselineRows = await input.transaction.query(
      "select * from programmable_private.get_projector_pool_fee_total_v1($1::uuid, $2::bytea, $3::bytea)",
      [
        input.runId,
        hexToBytes(delta.poolId),
        delta.quoteAsset === null ? null : hexToBytes(delta.quoteAsset),
      ],
    );
    if (baselineRows.length > 1) return projectorValidationFailure();
    const baseline = baselineRows[0];
    const totalId = deterministicUuid(
      "pool-fee-total",
      input.runId,
      delta.poolId,
      delta.quoteAsset ?? "native",
    );
    exactIdResult(
      await input.transaction.query(
        "select programmable_private.stage_pool_fee_total($1::uuid, $2::uuid, $3::bytea, $4::bytea, $5::numeric, $6::numeric, $7::numeric, $8::uuid, $9::numeric, $10::bytea, $11::timestamptz) as id",
        [
          totalId,
          input.runId,
          hexToBytes(delta.poolId),
          delta.quoteAsset === null ? null : hexToBytes(delta.quoteAsset),
          ((baseline ? BigInt(integerText(baseline.gross_total)) : 0n) +
            delta.gross).toString(),
          ((baseline ? BigInt(integerText(baseline.creator_fee_total)) : 0n) +
            delta.creator).toString(),
          ((baseline ? BigInt(integerText(baseline.launcher_fee_total)) : 0n) +
            delta.launcher).toString(),
          delta.lastOccurrenceId,
          input.targetBlockNumber,
          hexToBytes(input.targetBlockHash),
          input.verifiedAt,
        ],
      ),
      totalId,
    );
  }
  return Object.freeze({
    rewardDeltas: Object.freeze(
      rewardDeltas.sort((left, right) => left.vault.localeCompare(right.vault)),
    ),
  });
}

type RewardVerificationChunkManifest = Readonly<{
  chunkEndOffsets: readonly number[];
  providerAChunkCommitments: readonly HexBytes32[];
  providerBChunkCommitments: readonly HexBytes32[];
  providerAChunkCallCounts: readonly number[];
  providerBChunkCallCounts: readonly number[];
}>;

function orderedRewardOccurrenceIds(
  events: readonly ProjectorRewardEvent[],
  vault: HexAddress,
): readonly string[] {
  const ordered = [...events].sort((left, right) => {
    const blockOrder = BigInt(left.blockNumber) - BigInt(right.blockNumber);
    if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
    const transactionOrder =
      BigInt(left.transactionIndex) - BigInt(right.transactionIndex);
    if (transactionOrder !== 0n) return transactionOrder < 0n ? -1 : 1;
    const logOrder =
      BigInt(left.blockGlobalLogIndex) - BigInt(right.blockGlobalLogIndex);
    if (logOrder !== 0n) return logOrder < 0n ? -1 : 1;
    return left.occurrenceId.localeCompare(right.occurrenceId);
  });
  const occurrenceIds = ordered.map((event) => {
    if (event.vault !== vault) return projectorValidationFailure();
    return exactUuid(event.occurrenceId);
  });
  if (
    occurrenceIds.length < 1 ||
    occurrenceIds.length > PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP ||
    new Set(occurrenceIds).size !== occurrenceIds.length
  ) {
    return projectorValidationFailure();
  }
  return Object.freeze(occurrenceIds);
}

function canonicalRewardVerificationChunkManifest(input: {
  reward: DualRpcRewardSnapshot;
  bindings: readonly [
    Omit<CandidateRpcProvider, "client">,
    Omit<CandidateRpcProvider, "client">,
  ];
}): RewardVerificationChunkManifest {
  const { reward, bindings } = input;
  const matches = (actual: readonly unknown[], expected: readonly unknown[]) =>
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
  const expectedIdentities = bindings.map(({ identity }) => identity);
  const expectedVendors = bindings.map(({ vendorGroup }) => vendorGroup);
  const expectedEndpoints = bindings.map(
    ({ endpointCommitment }) => endpointCommitment,
  );
  const expectedOrigins = bindings.map(
    ({ endpointOriginCommitment }) => endpointOriginCommitment,
  );
  const verificationAccounts = reward.verificationAccounts;
  const chunks = reward.chunks;
  const maximumAccountsPerChunk =
    PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1.models[reward.model]
      .maximumBalanceAccounts;
  if (
    !Array.isArray(verificationAccounts) ||
    verificationAccounts.length < 1 ||
    verificationAccounts.length >
      PROJECTOR_MAXIMUM_REWARD_VERIFICATION_ACCOUNTS ||
    verificationAccounts.some((account, index) => {
      try {
        return canonicalAddress(account) !== account ||
          (index > 0 && account <= verificationAccounts[index - 1]!);
      } catch {
        return true;
      }
    }) ||
    !Array.isArray(chunks) ||
    chunks.length < 1 ||
    chunks.length > PROJECTOR_MAXIMUM_REWARD_VERIFICATION_CHUNKS ||
    chunks.length !==
      Math.ceil(verificationAccounts.length / maximumAccountsPerChunk) ||
    !matches(reward.providerIdentities, expectedIdentities) ||
    !matches(reward.providerVendorGroups, expectedVendors) ||
    !matches(reward.providerEndpointCommitments, expectedEndpoints) ||
    !matches(reward.providerOriginCommitments, expectedOrigins) ||
    !Array.isArray(reward.providerCallCounts) ||
    reward.providerCallCounts.length !== 2 ||
    !Array.isArray(reward.providerSnapshotCommitments) ||
    reward.providerSnapshotCommitments.length !== 2 ||
    reward.providerSnapshotCommitments[0] !==
      reward.providerSnapshotCommitments[1] ||
    reward.providerSnapshotCommitments[0] === ZERO_BYTES32
  ) {
    return projectorValidationFailure();
  }
  try {
    canonicalBytes32(reward.providerSnapshotCommitments[0]);
    canonicalBytes32(reward.providerSnapshotCommitments[1]);
  } catch {
    return projectorValidationFailure();
  }

  const chunkEndOffsets: number[] = [];
  const providerAChunkCommitments: HexBytes32[] = [];
  const providerBChunkCommitments: HexBytes32[] = [];
  const providerAChunkCallCounts: number[] = [];
  const providerBChunkCallCounts: number[] = [];
  let accountOffset = 0;
  let aggregateCallCount = 0;
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const remainingAccounts = verificationAccounts.length - accountOffset;
    const expectedChunkSize = Math.min(
      maximumAccountsPerChunk,
      remainingAccounts,
    );
    const expectedAccounts = verificationAccounts.slice(
      accountOffset,
      accountOffset + expectedChunkSize,
    );
    const expectedCallCount = expectedRewardRpcCallCount(
      reward.model,
      reward.allocations.length,
      expectedChunkSize,
    );
    if (
      chunk.chunkIndex !== chunkIndex ||
      !Array.isArray(chunk.verificationAccounts) ||
      !matches(chunk.verificationAccounts, expectedAccounts) ||
      !Array.isArray(chunk.providerCallCounts) ||
      chunk.providerCallCounts.length !== 2 ||
      chunk.providerCallCounts[0] !== expectedCallCount ||
      chunk.providerCallCounts[1] !== expectedCallCount ||
      expectedCallCount < 1 ||
      expectedCallCount > PROJECTOR_MAXIMUM_REWARD_CALLS_PER_CHUNK ||
      !Array.isArray(chunk.providerSnapshotCommitments) ||
      chunk.providerSnapshotCommitments.length !== 2 ||
      chunk.providerSnapshotCommitments[0] !==
        chunk.providerSnapshotCommitments[1] ||
      chunk.providerSnapshotCommitments[0] === ZERO_BYTES32
    ) {
      return projectorValidationFailure();
    }
    try {
      canonicalBytes32(chunk.providerSnapshotCommitments[0]);
      canonicalBytes32(chunk.providerSnapshotCommitments[1]);
    } catch {
      return projectorValidationFailure();
    }
    accountOffset += expectedChunkSize;
    aggregateCallCount += expectedCallCount;
    chunkEndOffsets.push(accountOffset);
    providerAChunkCommitments.push(chunk.providerSnapshotCommitments[0]);
    providerBChunkCommitments.push(chunk.providerSnapshotCommitments[1]);
    providerAChunkCallCounts.push(expectedCallCount);
    providerBChunkCallCounts.push(expectedCallCount);
  }
  if (
    accountOffset !== verificationAccounts.length ||
    aggregateCallCount < 1 ||
    aggregateCallCount > PROJECTOR_MAXIMUM_REWARD_AGGREGATE_CALLS ||
    reward.providerCallCounts[0] !== aggregateCallCount ||
    reward.providerCallCounts[1] !== aggregateCallCount ||
    reward.rpcCallCount !== aggregateCallCount * 2
  ) {
    return projectorValidationFailure();
  }

  const trace = reward.executionTrace;
  if (
    !Number.isSafeInteger(trace.startedAtMs) ||
    trace.startedAtMs < 0 ||
    !Number.isSafeInteger(trace.completedAtMs) ||
    trace.completedAtMs < 0 ||
    !Number.isSafeInteger(trace.elapsedMs) ||
    trace.elapsedMs < 0 ||
    !Number.isSafeInteger(trace.hardDeadlineMs) ||
    trace.hardDeadlineMs < 1 ||
    trace.candidateBatchSize !== 0 ||
    trace.completedAtMs < trace.startedAtMs ||
    trace.elapsedMs !== trace.completedAtMs - trace.startedAtMs ||
    trace.elapsedMs > trace.hardDeadlineMs ||
    !Number.isSafeInteger(trace.maxCallsPerProvider) ||
    trace.maxCallsPerProvider < 1 ||
    trace.maxCallsPerProvider > PROJECTOR_MAXIMUM_REWARD_CALLS_PER_CHUNK ||
    providerAChunkCallCounts.some(
      (count) => count > trace.maxCallsPerProvider,
    ) ||
    !matches(trace.providerCallCounts, reward.providerCallCounts) ||
    !Array.isArray(trace.calls) ||
    trace.calls.length !== chunks.length * 2 ||
    trace.calls.some((call, callIndex) => {
      const providerIndex = callIndex < chunks.length ? 0 : 1;
      const binding = bindings[providerIndex];
      return !binding ||
        !Number.isSafeInteger(call.startedOffsetMs) ||
        call.startedOffsetMs < 0 ||
        call.startedOffsetMs > trace.elapsedMs ||
        !Number.isSafeInteger(call.durationMs) ||
        call.durationMs < 0 ||
        call.durationMs > trace.hardDeadlineMs ||
        call.operation !== "readRewardSnapshot" ||
        call.attempt !== 1 ||
        call.outcome !== "success" ||
        call.providerIdentity !== binding.identity ||
        call.providerVendorGroup !== binding.vendorGroup ||
        call.providerEndpointCommitment !== binding.endpointCommitment ||
        call.providerOriginCommitment !== binding.endpointOriginCommitment;
    })
  ) {
    return projectorValidationFailure();
  }

  return Object.freeze({
    chunkEndOffsets: Object.freeze(chunkEndOffsets),
    providerAChunkCommitments: Object.freeze(providerAChunkCommitments),
    providerBChunkCommitments: Object.freeze(providerBChunkCommitments),
    providerAChunkCallCounts: Object.freeze(providerAChunkCallCounts),
    providerBChunkCallCounts: Object.freeze(providerBChunkCallCounts),
  });
}

function assertProjectionProviderEvidenceBindings(input: {
  projection: VerifiedReleaseProjection;
  bindings: readonly [
    Omit<CandidateRpcProvider, "client">,
    Omit<CandidateRpcProvider, "client">,
  ] | null;
}): void {
  const bindings = input.bindings;
  if (bindings === null) return projectorValidationFailure();
  const expectedIdentities = bindings.map(({ identity }) => identity);
  const expectedVendors = bindings.map(({ vendorGroup }) => vendorGroup);
  const expectedEndpoints = bindings.map(
    ({ endpointCommitment }) => endpointCommitment,
  );
  const expectedOrigins = bindings.map(
    ({ endpointOriginCommitment }) => endpointOriginCommitment,
  );
  const matches = (actual: readonly unknown[], expected: readonly unknown[]) =>
    actual.length === 2 &&
    actual.every((value, index) => value === expected[index]);
  const evidence = input.projection.evidence;
  const executionTrace = evidence.executionTrace;
  if (
    !matches(evidence.providerIdentities, expectedIdentities) ||
    !matches(evidence.providerVendorGroups, expectedVendors) ||
    !matches(evidence.providerEndpointCommitments, expectedEndpoints) ||
    !matches(evidence.providerOriginCommitments, expectedOrigins) ||
    executionTrace.candidateBatchSize !== input.projection.plan.entries.length ||
    executionTrace.completedAtMs < executionTrace.startedAtMs ||
    executionTrace.elapsedMs !==
      executionTrace.completedAtMs - executionTrace.startedAtMs ||
    executionTrace.elapsedMs > executionTrace.hardDeadlineMs ||
    executionTrace.providerCallCounts.some(
      (count) => !Number.isSafeInteger(count) || count < 1 || count > 128,
    )
  ) {
    return projectorValidationFailure();
  }
  const tracedCounts = bindings.map((binding) =>
    executionTrace.calls.filter((call) => {
      if (
        call.providerIdentity !== binding.identity ||
        call.providerVendorGroup !== binding.vendorGroup ||
        call.providerEndpointCommitment !== binding.endpointCommitment ||
        call.providerOriginCommitment !== binding.endpointOriginCommitment
      ) {
        return false;
      }
      return true;
    }).length
  );
  if (
    !matches(tracedCounts, executionTrace.providerCallCounts) ||
    executionTrace.calls.some((call, callIndex) => {
      const providerIndex = callIndex < executionTrace.providerCallCounts[0]
        ? 0
        : 1;
      const binding = bindings[providerIndex];
      return !binding ||
        call.providerIdentity !== binding.identity ||
        call.providerVendorGroup !== binding.vendorGroup ||
        call.providerEndpointCommitment !== binding.endpointCommitment ||
        call.providerOriginCommitment !== binding.endpointOriginCommitment;
    }) ||
    evidence.candidates.some((candidate) =>
      !matches(candidate.providerIdentities, expectedIdentities) ||
      !matches(candidate.providerVendorGroups, expectedVendors) ||
      !matches(candidate.providerEndpointCommitments, expectedEndpoints) ||
      !matches(candidate.providerOriginCommitments, expectedOrigins)
    )
  ) {
    return projectorValidationFailure();
  }
  const sortedRewardEvidence = [...(input.projection.rewardEvidence ?? [])].sort(
    (left, right) => left.vault.localeCompare(right.vault),
  );
  const sortedRewardSnapshots = [...(input.projection.rewardSnapshots ?? [])].sort(
    (left, right) => left.vault.localeCompare(right.vault),
  );
  if (sortedRewardEvidence.length !== sortedRewardSnapshots.length) {
    return projectorValidationFailure();
  }
  for (const [index, reward] of sortedRewardEvidence.entries()) {
    const snapshot = sortedRewardSnapshots[index];
    if (
      !snapshot ||
      reward.vault !== snapshot.vault ||
      reward.poolId !== snapshot.poolId ||
      reward.configurationEpoch !== snapshot.configurationEpoch ||
      reward.configurationHash !== snapshot.activeConfigurationHash ||
      reward.totalCreatorFeesReceived !==
        snapshot.totalCreatorFeesReceived ||
      JSON.stringify(reward.allocations) !==
        JSON.stringify(snapshot.allocations) ||
      JSON.stringify(reward.balances) !== JSON.stringify(snapshot.balances)
    ) {
      return projectorValidationFailure();
    }
    canonicalRewardVerificationChunkManifest({ reward, bindings });
  }
}

async function commitPostgresVerifiedProjection(input: {
  gateway: ReturnType<typeof createProjectorDatabaseGateway>;
  providers: readonly ProjectorProviderDatabaseBinding[];
  rpcEvidenceBindings: readonly [
    Omit<CandidateRpcProvider, "client">,
    Omit<CandidateRpcProvider, "client">,
  ] | null;
  scope: ProjectorReleaseDatabaseScope;
  projectorVersion: string;
  uuid: () => string;
  now: () => Date;
  privatePlan: ProjectionPrivatePlan;
  projection: VerifiedReleaseProjection;
  runtimeFence: ProjectorRuntimeFence;
}): Promise<Readonly<{ checkpointGeneration: string }>> {
  const { projection, privatePlan } = input;
  const timestamp = input.now();
  if (
    !Number.isFinite(timestamp.valueOf()) ||
    timestamp.toISOString() > projection.plan.lease.expiresAt ||
    projection.plan.scope.releaseId !== input.scope.releaseId ||
    projection.plan.scope.modelId !== input.scope.modelId ||
    projection.plan.scope.sourceGroup !== input.scope.sourceGroup
  ) {
    return projectorValidationFailure();
  }
  const verifiedAt = timestamp.toISOString();
  assertProjectionProviderEvidenceBindings({
    projection,
    bindings: input.rpcEvidenceBindings,
  });
  const pairs = occurrencePair(projection);
  const evidenceByCandidate = new Map(
    projection.evidence.candidates.map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  if (
    evidenceByCandidate.size !== projection.plan.entries.length ||
    projection.freshCandidates.length !== projection.plan.entries.length
  ) {
    return projectorValidationFailure();
  }
  const lastEntry = projection.plan.entries.at(-1);
  if (!lastEntry) return projectorValidationFailure();
  const targetBlockNumber = lastEntry.candidate.blockNumber;
  const targetBlockHash = lastEntry.candidate.blockHash;
  const targetCandidateId = lastEntry.candidate.candidateId;
  const targetBlockGlobalLogIndex =
    lastEntry.candidate.blockGlobalLogIndex;
  const rpcProviderIds = input.providers
    .map((provider, index) => ({ provider, index }))
    .filter(({ provider }) => provider.type === "rpc_provider")
    .map(({ index }) => privatePlan.providerDeploymentIds[index]!);
  const envioProviderIds = input.providers
    .map((provider, index) => ({ provider, index }))
    .filter(({ provider }) => provider.type === "envio_deployment")
    .map(({ index }) => privatePlan.providerDeploymentIds[index]!);
  if (rpcProviderIds.length !== 2 || envioProviderIds.length !== 1) {
    return projectorValidationFailure();
  }
  const configuredProviderDeploymentIds = Object.freeze([
    envioProviderIds[0]!,
    rpcProviderIds[0]!,
    rpcProviderIds[1]!,
  ]);
  const rpcEvidenceBindings = input.rpcEvidenceBindings;
  if (rpcEvidenceBindings === null) return projectorValidationFailure();

  return input.gateway.transaction(async (transaction) => {
    await assertRuntimeFence(transaction, input.runtimeFence);
    const runtime = parseProjectionRuntimeState(
      await transaction.query(
        "select * from programmable_private.get_projector_runtime_state_v1($1, $2, $3, $4, $5, $6::text[], $7::text[], $8::bytea[], $9::bytea[])",
        [
          "1",
          input.scope.releaseId,
          input.scope.modelId,
          input.scope.sourceGroup,
          input.projectorVersion,
          input.providers.map(({ type }) => type),
          input.providers.map(({ redactedIdentity }) => redactedIdentity),
          input.providers.map(({ deploymentCommitment }) =>
            hexToBytes(deploymentCommitment),
          ),
          input.providers.map(({ schemaCommitment }) =>
            hexToBytes(schemaCommitment),
          ),
        ],
      ),
      input.providers,
    );
    const expectedCheckpoint = projection.plan.checkpoint;
    if (
      runtime.epochId !== privatePlan.epochId ||
      runtime.pointerGeneration !== privatePlan.pointerGeneration ||
      runtime.leaseGeneration !== projection.plan.lease.generation ||
      runtime.providerDeploymentIds.length !==
        privatePlan.providerDeploymentIds.length ||
      runtime.providerDeploymentIds.some(
        (id, index) => id !== privatePlan.providerDeploymentIds[index],
      ) ||
      JSON.stringify(runtime.checkpoint) !== JSON.stringify(expectedCheckpoint)
    ) {
      throw new ProjectorDatabaseError({
        sqlState: "40001",
        disposition: "retry-serialization",
        retryable: true,
      });
    }

    const safeObservationId = deterministicUuid(
      "safe-head-observation",
      privatePlan.runId,
      projection.evidence.safeBlockNumber,
      projection.evidence.safeBlockHash,
    );
    const safeEvidence = providerEvidenceV2("safe_head", {
      chain_id: "1",
      epoch_id: privatePlan.epochId,
      pointer_generation: privatePlan.pointerGeneration,
      provider_a_id: rpcProviderIds[0]!,
      provider_b_id: rpcProviderIds[1]!,
      reported_chain_id_a: "1",
      reported_chain_id_b: "1",
      head_a: projection.evidence.providerHeads[0],
      head_b: projection.evidence.providerHeads[1],
      finality_depth: "12",
      safe_block_number: projection.evidence.safeBlockNumber,
      safe_block_hash_a: projection.evidence.safeBlockHash,
      safe_block_hash_b: projection.evidence.safeBlockHash,
    });
    exactIdResult(
      await transaction.query(
        "select programmable_private.append_safe_head_observation($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::numeric, $8::numeric, $9, $10::numeric, $11::bytea, $12::bytea, $13, $14::bytea, $15::bytea, $16::timestamptz) as id",
        [
          safeObservationId,
          privatePlan.runId,
          rpcProviderIds[0]!,
          rpcProviderIds[1]!,
          "1",
          "1",
          projection.evidence.providerHeads[0],
          projection.evidence.providerHeads[1],
          12,
          projection.evidence.safeBlockNumber,
          hexToBytes(projection.evidence.safeBlockHash),
          hexToBytes(projection.evidence.safeBlockHash),
          safeEvidence.encodingVersion,
          safeEvidence.canonicalPreimage,
          hexToBytes(safeEvidence.contentFingerprint),
          verifiedAt,
        ],
      ),
      safeObservationId,
    );

    const blockEvidenceIds = new Map<string, string>();
    for (const evidence of projection.evidence.candidates) {
      const key = `${evidence.candidateBlockNumber}:${evidence.candidateBlockHash}`;
      if (blockEvidenceIds.has(key)) continue;
      const blockEvidenceId = deterministicUuid(
        "block-evidence",
        privatePlan.runId,
        evidence.candidateBlockNumber,
        evidence.candidateBlockHash,
      );
      const blockEvidence = providerEvidenceV2("block", {
        chain_id: "1",
        epoch_id: privatePlan.epochId,
        pointer_generation: privatePlan.pointerGeneration,
        observation_id: safeObservationId,
        block_number: evidence.candidateBlockNumber,
        provider_a_block_hash: evidence.candidateBlockHash,
        provider_b_block_hash: evidence.candidateBlockHash,
      });
      exactIdResult(
        await transaction.query(
          "select programmable_private.append_dual_rpc_block_evidence($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::bytea, $6::bytea, $7, $8::bytea, $9::bytea, $10::timestamptz) as id",
          [
            blockEvidenceId,
            safeObservationId,
            privatePlan.runId,
            evidence.candidateBlockNumber,
            hexToBytes(evidence.candidateBlockHash),
            hexToBytes(evidence.candidateBlockHash),
            blockEvidence.encodingVersion,
            blockEvidence.canonicalPreimage,
            hexToBytes(blockEvidence.contentFingerprint),
            verifiedAt,
          ],
        ),
        blockEvidenceId,
      );
      blockEvidenceIds.set(key, blockEvidenceId);
    }
    const targetBlockEvidenceId = blockEvidenceIds.get(
      `${targetBlockNumber}:${targetBlockHash}`,
    );
    if (!targetBlockEvidenceId) return projectorValidationFailure();

    const executionEvidenceId = deterministicUuid(
      "projection-provider-execution-evidence",
      privatePlan.runId,
    );
    const executionTraceCommitment = projectionExecutionTraceCommitmentV1(
      projection.evidence.executionTrace,
    );
    const executionEvidence = providerEvidenceV3("projection_execution", {
      chain_id: "1",
      release_id: input.scope.releaseId,
      model_id: input.scope.modelId,
      source_group: input.scope.sourceGroup,
      epoch_id: privatePlan.epochId,
      pointer_generation: privatePlan.pointerGeneration,
      run_id: privatePlan.runId,
      provider_a_id: rpcProviderIds[0]!,
      provider_b_id: rpcProviderIds[1]!,
      provider_a_identity: rpcEvidenceBindings[0].identity,
      provider_b_identity: rpcEvidenceBindings[1].identity,
      provider_a_vendor_group: rpcEvidenceBindings[0].vendorGroup,
      provider_b_vendor_group: rpcEvidenceBindings[1].vendorGroup,
      provider_a_endpoint_commitment:
        rpcEvidenceBindings[0].endpointCommitment,
      provider_b_endpoint_commitment:
        rpcEvidenceBindings[1].endpointCommitment,
      provider_a_origin_commitment:
        rpcEvidenceBindings[0].endpointOriginCommitment,
      provider_b_origin_commitment:
        rpcEvidenceBindings[1].endpointOriginCommitment,
      provider_a_call_count:
        projection.evidence.executionTrace.providerCallCounts[0],
      provider_b_call_count:
        projection.evidence.executionTrace.providerCallCounts[1],
      candidate_batch_size:
        projection.evidence.executionTrace.candidateBatchSize,
      hard_deadline_ms: projection.evidence.executionTrace.hardDeadlineMs,
      maximum_calls_per_provider:
        projection.evidence.executionTrace.maxCallsPerProvider,
      elapsed_ms: projection.evidence.executionTrace.elapsedMs,
      execution_trace_commitment: executionTraceCommitment,
    });
    exactIdResult(
      await transaction.query(
        "select programmable_private.append_projection_provider_execution_evidence_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid[], $5::jsonb, $6::bytea, $7::smallint, $8::bytea, $9::bytea, $10::timestamptz) as id",
        [
          executionEvidenceId,
          privatePlan.runId,
          safeObservationId,
          configuredProviderDeploymentIds,
          JSON.stringify(projection.evidence.executionTrace),
          hexToBytes(executionTraceCommitment),
          executionEvidence.encodingVersion,
          executionEvidence.canonicalPreimage,
          hexToBytes(executionEvidence.contentFingerprint),
          verifiedAt,
        ],
      ),
      executionEvidenceId,
    );

    const occurrenceWrites = new Map<string, OccurrenceWrite>();
    const pairByCandidate = new Map(
      pairs.map((pair) => [pair.occurrence.candidateId, pair]),
    );
    for (const entry of projection.plan.entries) {
      if (entry.action === "ignore") {
        const decisionId = deterministicUuid(
          "candidate-ignore",
          privatePlan.runId,
          entry.candidate.candidateId,
        );
        const reasonCommitment = keccak256(
          toBytes(
            `programmable:ignore:v1\0${input.scope.releaseId}\0${entry.candidate.candidateId}\0outside-release-manifest`,
          ),
        );
        exactIdResult(
          await transaction.query(
            "select programmable_private.ignore_envio_candidate_v1($1::uuid, $2::uuid, $3, $4::bigint, $5, $6::bytea, $7::timestamptz) as id",
            [
              decisionId,
              privatePlan.runId,
              entry.candidate.candidateId,
              entry.attemptCount,
              "outside-release-manifest",
              hexToBytes(reasonCommitment),
              verifiedAt,
            ],
          ),
          decisionId,
        );
        continue;
      }
      const pair = pairByCandidate.get(entry.candidate.candidateId);
      const evidence = evidenceByCandidate.get(entry.candidate.candidateId);
      const resolution = privatePlan.resolutions.get(
        entry.candidate.candidateId,
      );
      if (!pair || !evidence || !resolution) {
        return projectorValidationFailure();
      }
      const resolutionId = deterministicUuid(
        "candidate-resolution",
        privatePlan.runId,
        entry.candidate.candidateId,
      );
      const resolutionCommitment = keccak256(
        toBytes(
          JSON.stringify([
            input.scope.releaseId,
            entry.candidate.candidateId,
            resolution.releaseBindingId,
            resolution.dynamicSourceAttestationId,
            resolution.abiEventSetCommitment,
          ]),
        ),
      );
      exactIdResult(
        await transaction.query(
          "select programmable_private.resolve_envio_candidate($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::bytea, $7::bytea, $8::timestamptz) as id",
          [
            resolutionId,
            privatePlan.runId,
            entry.candidate.candidateId,
            resolution.releaseBindingId,
            resolution.dynamicSourceAttestationId,
            hexToBytes(resolution.abiEventSetCommitment),
            hexToBytes(resolutionCommitment),
            verifiedAt,
          ],
        ),
        resolutionId,
      );
      const logicalEventId = deterministicUuid(
        "logical-event",
        "1",
        pair.occurrence.transactionHash,
        pair.occurrence.receiptLogOrdinal,
      );
      const occurrenceId = deterministicUuid(
        "occurrence",
        logicalEventId,
        pair.occurrence.blockHash,
      );
      const fingerprintInput = {
        chain_id: "1",
        transaction_hash: pair.occurrence.transactionHash,
        receipt_log_ordinal: pair.occurrence.receiptLogOrdinal,
        block_number: pair.occurrence.blockNumber,
        block_hash: pair.occurrence.blockHash,
        transaction_index: pair.occurrence.transactionIndex,
        block_global_log_index: pair.occurrence.blockGlobalLogIndex,
        source_address: pair.occurrence.sourceAddress,
        event_signature: pair.occurrence.eventSignature,
        ordered_topics: Array.from(pair.occurrence.orderedTopics),
        raw_data: pair.occurrence.rawData,
        decoded_payload: canonicalOccurrenceJson(
          pair.occurrence.decodedPayload,
        ),
        payload_hash: pair.occurrence.payloadHash,
        decoder_version: input.projectorVersion,
        abi_event_set_commitment: resolution.abiEventSetCommitment,
        release_id: input.scope.releaseId,
        model_id: input.scope.modelId,
        envio_candidate_id: pair.occurrence.candidateId,
        provider_cursor: pair.occurrence.candidateId,
        block_timestamp_unix: pair.occurrence.blockTimestamp,
      };
      const canonicalPreimage = canonicalFingerprintPreimageV1(
        "occurrence",
        fingerprintInput,
      );
      const fingerprint = canonicalFingerprintV1(
        "occurrence",
        fingerprintInput,
      );
      const blockEvidenceId = blockEvidenceIds.get(
        `${pair.occurrence.blockNumber}:${pair.occurrence.blockHash}`,
      );
      if (!blockEvidenceId) return projectorValidationFailure();
      exactIdResult(
        await transaction.query(
          "select programmable_private.append_chain_event_occurrence($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6::numeric, $7::timestamptz, $8, $9::bytea, $10::uuid, $11::smallint, $12::bytea, $13::bytea, $14::timestamptz) as id",
          [
            logicalEventId,
            occurrenceId,
            privatePlan.runId,
            pair.occurrence.candidateId,
            resolutionId,
            pair.occurrence.receiptLogOrdinal,
            unixSecondsTimestamp(pair.occurrence.blockTimestamp),
            input.projectorVersion,
            hexToBytes(resolution.abiEventSetCommitment),
            blockEvidenceId,
            1,
            canonicalPreimage,
            hexToBytes(fingerprint),
            verifiedAt,
          ],
        ),
        occurrenceId,
      );
      occurrenceWrites.set(
        pair.occurrence.candidateId,
        Object.freeze({
          occurrence: pair.occurrence,
          fact: pair.fact,
          occurrenceId,
          logicalEventId,
          resolutionId,
          blockEvidenceId,
        }),
      );
    }

    const stagedPools = new Map<
      HexBytes32,
      Readonly<{
        poolProjectionId: string;
        launchProjectionId: string;
        token: HexAddress;
        creator: HexAddress;
        rewardVault: HexAddress | null;
        quoteAsset: HexAddress | null;
      }>
    >();
    const allocationPairs: Array<{
      factId: string;
      evidenceId: string;
    }> = [];
    const stagedRewardStates = new Map<HexAddress, ProjectorRewardState>();
    for (const launch of projection.fold.launches) {
      await stageCompletedLaunch({
        transaction,
        runId: privatePlan.runId,
        launch,
        occurrenceWrites,
        targetBlockNumber,
        targetBlockHash,
        verifiedAt,
        scope: input.scope,
        stagedPools,
        allocationPairs,
        stagedRewardStates,
      });
    }

    const chainOrderedOccurrenceIds = [...occurrenceWrites.values()]
      .sort((left, right) => {
        const blockOrder = BigInt(left.occurrence.blockNumber) -
          BigInt(right.occurrence.blockNumber);
        if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
        const logOrder = BigInt(left.occurrence.blockGlobalLogIndex) -
          BigInt(right.occurrence.blockGlobalLogIndex);
        if (logOrder !== 0n) return logOrder < 0n ? -1 : 1;
        return left.occurrenceId.localeCompare(right.occurrenceId);
      })
      .map(({ occurrenceId }) => occurrenceId);

    const incrementalStage = await stageIncrementalFacts({
      transaction,
      runId: privatePlan.runId,
      scope: input.scope,
      occurrenceWrites,
      stagedPools,
      stagedRewardStates,
      allocationPairs,
      targetBlockNumber,
      targetBlockHash,
      verifiedAt,
      verifiedRewardSnapshots: projection.rewardSnapshots ?? [],
    });

    const rewardEvidenceByVault = new Map(
      (projection.rewardEvidence ?? []).map((evidence) => [
        evidence.vault,
        evidence,
      ]),
    );
    if (
      rewardEvidenceByVault.size !== (projection.rewardEvidence ?? []).length ||
      rewardEvidenceByVault.size !== incrementalStage.rewardDeltas.length
    ) {
      return projectorValidationFailure();
    }
    const rewardProviderEvidence: Array<Readonly<{
      evidenceId: string;
      fingerprint: HexBytes32;
      vault: HexAddress;
    }>> = [];
    for (const rewardDelta of incrementalStage.rewardDeltas) {
      const rewardEvidence = rewardEvidenceByVault.get(rewardDelta.vault);
      if (
        !rewardEvidence ||
        rewardEvidence.blockNumber !== targetBlockNumber ||
        rewardEvidence.blockHash !== targetBlockHash ||
        rewardEvidence.model !== rewardModelForScope(input.scope)
      ) {
        return projectorValidationFailure();
      }
      const foldedRows = await transaction.query<{ commitment: unknown }>(
        "select programmable_private.get_staged_reward_folded_commitment_v1($1::uuid, $2::bytea) as commitment",
        [privatePlan.runId, hexToBytes(rewardDelta.vault)],
      );
      if (foldedRows.length !== 1) return projectorValidationFailure();
      const foldedSnapshotCommitment = databaseBytes32(
        foldedRows[0]!.commitment,
      );
      const rewardExecutionTraceCommitment =
        projectionExecutionTraceCommitmentV1(rewardEvidence.executionTrace);
      const rewardEvidenceId = deterministicUuid(
        "reward-snapshot-provider-evidence",
        privatePlan.runId,
        rewardDelta.vault,
      );
      const chunkManifest = canonicalRewardVerificationChunkManifest({
        reward: rewardEvidence,
        bindings: input.rpcEvidenceBindings!,
      });
      const encodedRewardEvidence = providerEvidenceV3("reward_snapshot", {
        chain_id: "1",
        release_id: input.scope.releaseId,
        model_id: input.scope.modelId,
        source_group: input.scope.sourceGroup,
        epoch_id: privatePlan.epochId,
        pointer_generation: privatePlan.pointerGeneration,
        run_id: privatePlan.runId,
        projection_execution_evidence_id: executionEvidenceId,
        block_evidence_id: targetBlockEvidenceId,
        vault: rewardEvidence.vault,
        reward_model: rewardEvidence.model,
        block_number: rewardEvidence.blockNumber,
        block_hash: rewardEvidence.blockHash,
        provider_a_id: rpcProviderIds[0]!,
        provider_b_id: rpcProviderIds[1]!,
        provider_a_snapshot_commitment:
          rewardEvidence.providerSnapshotCommitments[0],
        provider_b_snapshot_commitment:
          rewardEvidence.providerSnapshotCommitments[1],
        provider_a_call_count: rewardEvidence.providerCallCounts[0],
        provider_b_call_count: rewardEvidence.providerCallCounts[1],
        verification_accounts: rewardEvidence.verificationAccounts,
        verification_account_chunk_end_offsets:
          chunkManifest.chunkEndOffsets,
        provider_a_verification_chunk_commitments:
          chunkManifest.providerAChunkCommitments,
        provider_b_verification_chunk_commitments:
          chunkManifest.providerBChunkCommitments,
        provider_a_verification_chunk_call_counts:
          chunkManifest.providerAChunkCallCounts,
        provider_b_verification_chunk_call_counts:
          chunkManifest.providerBChunkCallCounts,
        folded_snapshot_commitment: foldedSnapshotCommitment,
        execution_trace_commitment: rewardExecutionTraceCommitment,
      });
      exactIdResult(
        await transaction.query(
          "select programmable_private.append_reward_snapshot_provider_evidence_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bytea, $6, $7, $8::numeric, $9::bytea, $10::bytea, $11::bytea, $12::integer, $13::integer, $14::bytea[], $15::integer[], $16::bytea[], $17::bytea[], $18::integer[], $19::integer[], $20::bytea, $21::jsonb, $22::bytea, $23::smallint, $24::bytea, $25::bytea, $26::timestamptz) as id",
          [
            rewardEvidenceId,
            privatePlan.runId,
            executionEvidenceId,
            targetBlockEvidenceId,
            hexToBytes(rewardEvidence.vault),
            input.scope.modelId,
            rewardEvidence.model,
            rewardEvidence.blockNumber,
            hexToBytes(rewardEvidence.blockHash),
            hexToBytes(rewardEvidence.providerSnapshotCommitments[0]),
            hexToBytes(rewardEvidence.providerSnapshotCommitments[1]),
            rewardEvidence.providerCallCounts[0],
            rewardEvidence.providerCallCounts[1],
            rewardEvidence.verificationAccounts.map(hexToBytes),
            chunkManifest.chunkEndOffsets,
            chunkManifest.providerAChunkCommitments.map(hexToBytes),
            chunkManifest.providerBChunkCommitments.map(hexToBytes),
            chunkManifest.providerAChunkCallCounts,
            chunkManifest.providerBChunkCallCounts,
            hexToBytes(foldedSnapshotCommitment),
            JSON.stringify(rewardEvidence.executionTrace),
            hexToBytes(rewardExecutionTraceCommitment),
            encodedRewardEvidence.encodingVersion,
            encodedRewardEvidence.canonicalPreimage,
            hexToBytes(encodedRewardEvidence.contentFingerprint),
            verifiedAt,
          ],
        ),
        rewardEvidenceId,
      );
      rewardProviderEvidence.push(Object.freeze({
        evidenceId: rewardEvidenceId,
        fingerprint: encodedRewardEvidence.contentFingerprint,
        vault: rewardEvidence.vault,
      }));
    }

    const targetKey = [
      BigInt(targetBlockNumber),
      BigInt(targetBlockGlobalLogIndex),
      targetCandidateId,
    ] as const;
    const keyForDisposition = (row: Record<string, unknown>) => [
      BigInt(integerText(row.block_number)),
      BigInt(integerText(row.block_global_log_index)),
      exactText(
        row.candidate_id,
        /^1:0x[0-9a-f]{64}:0x[0-9a-f]{64}:(?:0|[1-9]\d*)$/u,
        192,
      ),
    ] as const;
    const compareDispositionKey = (
      left: readonly [bigint, bigint, string],
      right: readonly [bigint, bigint, string],
    ) => left[0] < right[0]
      ? -1
      : left[0] > right[0]
        ? 1
        : left[1] < right[1]
          ? -1
          : left[1] > right[1]
            ? 1
            : left[2].localeCompare(right[2]);
    const dispositionRows: Record<string, unknown>[] = [];
    let dispositionAfterBlock = expectedCheckpoint?.blockNumber ?? null;
    let dispositionAfterLog = expectedCheckpoint?.blockGlobalLogIndex ?? null;
    let dispositionAfterCandidate = expectedCheckpoint?.candidateId ?? null;
    for (
      let pageIndex = 0;
      pageIndex <= Math.ceil(
        PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP / 500,
      );
      pageIndex += 1
    ) {
      const page = await transaction.query(
        "select * from programmable_private.list_projector_candidate_dispositions_v1($1, $2, $3, $4, $5::uuid, $6, $7, $8::bigint, $9::bytea, $10::numeric, $11::numeric, $12, $13, $14::timestamptz)",
        [
          "1",
          input.scope.releaseId,
          input.scope.modelId,
          input.scope.sourceGroup,
          privatePlan.epochId,
          privatePlan.pointerGeneration,
          input.projectorVersion,
          projection.plan.lease.generation,
          hexToBytes(privatePlan.leaseTokenHash),
          dispositionAfterBlock,
          dispositionAfterLog,
          dispositionAfterCandidate,
          500,
          verifiedAt,
        ],
      );
      if (page.length === 0) break;
      const previousKey = dispositionRows.length === 0
        ? null
        : keyForDisposition(dispositionRows.at(-1)!);
      const pageKeys = page.map(keyForDisposition);
      if (
        pageKeys.some((key, index) =>
          (index > 0 && compareDispositionKey(pageKeys[index - 1]!, key) >= 0) ||
          (index === 0 && previousKey !== null &&
            compareDispositionKey(previousKey, key) >= 0)
        )
      ) {
        return projectorValidationFailure();
      }
      dispositionRows.push(...page);
      const pageLast = pageKeys.at(-1)!;
      if (compareDispositionKey(pageLast, targetKey) >= 0) break;
      if (page.length < 500) break;
      dispositionAfterBlock = pageLast[0].toString();
      dispositionAfterLog = Number(pageLast[1]);
      dispositionAfterCandidate = pageLast[2];
    }
    if (
      dispositionRows.length >
        PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP + 500
    ) {
      return projectorValidationFailure();
    }
    const boundedDispositionRows = dispositionRows.filter((row) =>
      compareDispositionKey(keyForDisposition(row), targetKey) <= 0
    );
    const dispositionIds = boundedDispositionRows
      .map((row) => exactUuid(row.decision_id))
      .sort();
    const dispositionCandidates = new Set(
      boundedDispositionRows.map((row) => row.candidate_id),
    );
    if (
      boundedDispositionRows.length !== projection.plan.entries.length ||
      dispositionCandidates.size !== projection.plan.entries.length ||
      projection.plan.entries.some(
        ({ candidate }) => !dispositionCandidates.has(candidate.candidateId),
      ) ||
      new Set(dispositionIds).size !== dispositionIds.length
    ) {
      return projectorValidationFailure();
    }

    const rewardDeltas = incrementalStage.rewardDeltas;
    const promotionMode = "exact_incremental" as const;
    if (rewardDeltas.length > 0) {
      if (
        (projection.rewardSnapshots ?? []).length !== rewardDeltas.length ||
        (projection.rewardEvidence ?? []).length !== rewardDeltas.length ||
        rewardDeltas.some((rewardDelta) =>
          !allocationPairs.some((pair) =>
            pair.factId === rewardDelta.allocationFactId &&
            pair.evidenceId === rewardDelta.allocationEvidenceId
          )
        )
      ) {
        return projectorValidationFailure();
      }
    }
    const occurrenceIds = chainOrderedOccurrenceIds;
    allocationPairs.sort((left, right) =>
      left.factId.localeCompare(right.factId),
    );
    const checkpointGeneration = (
      BigInt(expectedCheckpoint?.generation ?? "0") + 1n
    ).toString();
    const publicationId = deterministicUuid(
      "projection-publication",
      privatePlan.runId,
    );
    const providerBindingId = deterministicUuid(
      "projection-provider-binding",
      privatePlan.runId,
    );
    const rewardSnapshotEvidenceIds = [...rewardProviderEvidence]
      .sort((left, right) => left.vault.localeCompare(right.vault))
      .map(({ evidenceId }) => evidenceId);
    const providerBindingRows = await transaction.query<{
      commitment: unknown;
    }>(
      "select programmable_private.projection_provider_binding_commitment_v1($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid[], $6::timestamptz) as commitment",
      [
        publicationId,
        privatePlan.runId,
        promotionMode,
        executionEvidenceId,
        rewardSnapshotEvidenceIds,
        verifiedAt,
      ],
    );
    if (providerBindingRows.length !== 1) {
      return projectorValidationFailure();
    }
    const providerBindingCommitment = databaseBytes32(
      providerBindingRows[0]!.commitment,
    );
    const resultCommitment = keccak256(
      toBytes(
        JSON.stringify([
          promotionMode,
          input.scope.releaseId,
          privatePlan.epochId,
          privatePlan.pointerGeneration,
          checkpointGeneration,
          targetBlockNumber,
          targetBlockHash,
          targetCandidateId,
          occurrenceIds,
          dispositionIds,
          allocationPairs,
          {
            evidenceId: executionEvidenceId,
            fingerprint: executionEvidence.contentFingerprint,
          },
          projection.rewardSnapshots ?? [],
          projection.rewardEvidence ?? [],
          rewardProviderEvidence,
          {
            providerBindingId,
            providerBindingCommitment,
          },
          PROJECTION_ROUTE_KEYS,
        ]),
      ),
    );
    exactIdResult(
      await transaction.query(
        "select programmable_private.promote_projection_run_v3($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::bigint, $8::bytea, $9::bigint, $10::bigint, $11::bigint, $12::uuid, $13::uuid, $14::numeric, $15::bytea, $16::numeric, $17, $18::uuid[], $19::uuid[], $20::uuid[], $21::uuid[], $22::text[], $23::bytea, $24::uuid, $25::uuid[], $26::uuid, $27::bytea, $28::timestamptz) as id",
        [
          promotionMode,
          publicationId,
          deterministicUuid("projection-checkpoint", privatePlan.runId),
          deterministicUuid("projection-outcome", privatePlan.runId),
          privatePlan.runId,
          input.projectorVersion,
          projection.plan.lease.generation,
          hexToBytes(privatePlan.leaseTokenHash),
          expectedCheckpoint?.generation ?? "0",
          checkpointGeneration,
          expectedCheckpoint?.reorgGeneration ?? "0",
          safeObservationId,
          targetBlockEvidenceId,
          targetBlockNumber,
          hexToBytes(targetBlockHash),
          targetBlockGlobalLogIndex,
          targetCandidateId,
          occurrenceIds,
          allocationPairs.map(({ factId }) => factId),
          allocationPairs.map(({ evidenceId }) => evidenceId),
          dispositionIds,
          [...PROJECTION_ROUTE_KEYS],
          hexToBytes(resultCommitment),
          executionEvidenceId,
          rewardSnapshotEvidenceIds,
          providerBindingId,
          hexToBytes(providerBindingCommitment),
          verifiedAt,
        ],
      ),
      publicationId,
    );
    return Object.freeze({ checkpointGeneration });
  });
}
