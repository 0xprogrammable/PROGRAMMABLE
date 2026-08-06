import "server-only";

import type {
  AuthenticatedCustomLaunchProjectV2,
  CustomLaunchFeeObligationV3,
  PostLaunchAuthorityInventoryV1,
} from "../../custom-launch/contract-v2";
import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "../projection-target/canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "../projection-target/hashing";
import {
  MAXIMUM_PUBLIC_CUSTOM_LAUNCHES,
  parseAuthenticatedCustomLaunchProjectV2,
  type ProjectionTargetPostgresPoolV1,
} from "../projection-target/postgres-store";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u;
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REPOSITORY_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,512}$/u;
const MAXIMUM_CUSTOM_LAUNCHES_PER_PROFILE = 100;
const AUTHENTICATED_REGISTRY_PROJECTION_MINT = Symbol(
  "authenticated-registry-custom-launch-projection-v1",
);
const REGISTRY_PROJECTION_AUTHENTICATOR_MINT = Symbol(
  "registry-custom-launch-projection-authenticator-v1",
);

export type RegistryCustomLaunchLifecycleStateV1 =
  | "pending"
  | "finalized"
  | "corrected"
  | "revoked"
  | "reorged";

export interface RegistryCustomLaunchPublicRecordV1 {
  readonly schemaVersion: "programmable.registry-custom-launch-public-record.v1";
  readonly projectId: Sha256Digest;
  readonly launchId: Sha256Digest;
  readonly registry: Readonly<{
    chainId: string;
    registryAddress: `0x${string}`;
    startBlock: string;
  }>;
  readonly event: Readonly<{
    transactionHash: `0x${string}`;
    blockHash: `0x${string}`;
    blockNumber: string;
    transactionIndex: number;
    logIndex: number;
  }>;
  readonly finality: Readonly<{
    observedHeadBlockNumber: string;
    observedHeadBlockHash: `0x${string}`;
    requiredConfirmations: number;
    policyBindingHash: Sha256Digest;
    evidenceBindingHash: Sha256Digest;
  }>;
  readonly configurationHash: `0x${string}`;
  readonly provider: Readonly<{
    providerId: string;
    modelId: string;
    modelVersion: string;
    marketPath: string | null;
  }>;
  readonly github: Readonly<{
    repositoryOwner: string;
    repositoryId: string;
    commitObjectId: string;
    treeObjectId: string;
  }>;
  readonly approval: Readonly<{
    approvalId: string;
    approvalBindingHash: Sha256Digest;
    launchPlanPath: string;
    launchPlanBindingHash: Sha256Digest;
  }>;
  readonly runtime: Readonly<{
    launchRouteId: string;
    executionMode: string;
    registryAdapterBindingHash: Sha256Digest;
    projectionRuntimeBindingHash: Sha256Digest;
    registryTargetBindingHash: Sha256Digest;
  }>;
  readonly fee: Readonly<{
    feeAssessmentHash: Sha256Digest;
    feeObligationHash: Sha256Digest;
    feeAssessmentObligationBindingHash: Sha256Digest;
    obligation: Readonly<CustomLaunchFeeObligationV3>;
  }>;
  readonly roles: Readonly<{
    launchingWallet: Readonly<{ namespace: string; value: string }>;
    postLaunchAuthorityInventoryHash: Sha256Digest;
    postLaunchAuthorityInventory: Readonly<PostLaunchAuthorityInventoryV1>;
  }>;
  readonly project: Readonly<AuthenticatedCustomLaunchProjectV2>;
}

export interface RegistryCustomLaunchMaterializationV1 {
  readonly schemaVersion: "programmable.registry-custom-launch-materialization.v1";
  readonly sourceLane: "registry.custom-launched";
  readonly generation: string;
  readonly observedAt: string;
  readonly projectId: Sha256Digest;
  readonly launchId: Sha256Digest;
  readonly state: RegistryCustomLaunchLifecycleStateV1;
  readonly lifecycleBindingHash: Sha256Digest;
  readonly launchSecurityBindingHash: Sha256Digest;
  readonly record: Readonly<RegistryCustomLaunchPublicRecordV1> | null;
}

export interface VerifiedRegistryCustomLaunchPublicV1 {
  readonly schemaVersion: "programmable.verified-registry-custom-launch-public.v1";
  readonly sourceLane: "registry.custom-launched";
  readonly lifecycle: Readonly<{
    generation: string;
    state: "finalized";
    bindingHash: Sha256Digest;
    observedAt: string;
  }>;
  readonly record: Readonly<RegistryCustomLaunchPublicRecordV1>;
}

export type RegistryCustomLaunchMaterializationResultV1 = Readonly<{
  kind: "created" | "updated" | "existing" | "stale" | "conflict";
}>;

interface RegistryProjectionAuthenticatorEntryV1 {
  readonly verifierBindingHash: Sha256Digest;
  readonly verifyCanonicalMaterialization: (evidence: Readonly<{
    sourceLane: "registry.custom-launched";
    lifecycleBindingHash: Sha256Digest;
    canonicalMaterialization: string;
    verifierBindingHash: Sha256Digest;
    signal: AbortSignal;
  }>) => Promise<boolean>;
}

const REGISTRY_PROJECTION_AUTHENTICATORS = new WeakMap<
  RegistryCustomLaunchProjectionAuthenticatorV1,
  Readonly<RegistryProjectionAuthenticatorEntryV1>
>();
const AUTHENTICATED_REGISTRY_PROJECTIONS = new WeakMap<
  AuthenticatedRegistryCustomLaunchProjectionV1,
  Readonly<RegistryCustomLaunchMaterializationV1>
>();

/** Opaque capability owned by the authenticated Registry transport boundary. */
export class RegistryCustomLaunchProjectionAuthenticatorV1 {
  constructor(
    mint: typeof REGISTRY_PROJECTION_AUTHENTICATOR_MINT,
    entry: Readonly<RegistryProjectionAuthenticatorEntryV1>,
  ) {
    if (mint !== REGISTRY_PROJECTION_AUTHENTICATOR_MINT) {
      throw new TypeError("registry projection authenticator mint is invalid");
    }
    REGISTRY_PROJECTION_AUTHENTICATORS.set(this, entry);
    Object.freeze(this);
  }
}

export function createRegistryCustomLaunchProjectionAuthenticatorV1(
  input: Readonly<RegistryProjectionAuthenticatorEntryV1>,
): RegistryCustomLaunchProjectionAuthenticatorV1 {
  if (!DIGEST.test(input.verifierBindingHash)
    || typeof input.verifyCanonicalMaterialization !== "function") {
    throw new TypeError("registry projection authenticator is invalid");
  }
  return new RegistryCustomLaunchProjectionAuthenticatorV1(
    REGISTRY_PROJECTION_AUTHENTICATOR_MINT,
    Object.freeze({ ...input }),
  );
}

/**
 * Opaque boundary object minted only after the Registry projection transport
 * authenticates the exact canonical materialization. The public Website-v2
 * projection lane cannot construct one by merely supplying a compatible
 * project record.
 */
export class AuthenticatedRegistryCustomLaunchProjectionV1 {
  constructor(
    mint: typeof AUTHENTICATED_REGISTRY_PROJECTION_MINT,
    materialization: Readonly<RegistryCustomLaunchMaterializationV1>,
  ) {
    if (mint !== AUTHENTICATED_REGISTRY_PROJECTION_MINT) {
      throw new TypeError("registry projection authentication mint is invalid");
    }
    AUTHENTICATED_REGISTRY_PROJECTIONS.set(this, materialization);
    Object.freeze(this);
  }
}

export async function authenticateRegistryCustomLaunchProjectionV1(
  input: Readonly<{
    materialization: unknown;
    signal: AbortSignal;
    authenticator: RegistryCustomLaunchProjectionAuthenticatorV1;
  }>,
): Promise<AuthenticatedRegistryCustomLaunchProjectionV1> {
  input.signal.throwIfAborted();
  const authenticator = REGISTRY_PROJECTION_AUTHENTICATORS.get(
    input.authenticator,
  );
  if (authenticator === undefined) {
    throw new TypeError("registry projection authenticator is invalid");
  }
  const materialization = parseRegistryCustomLaunchMaterializationV1(
    input.materialization,
  );
  const canonicalMaterialization = canonicalizeJson(
    materialization as unknown as JsonValue,
  );
  const authenticated = await authenticator.verifyCanonicalMaterialization(
    Object.freeze({
    sourceLane: "registry.custom-launched" as const,
    lifecycleBindingHash: materialization.lifecycleBindingHash,
    canonicalMaterialization,
    verifierBindingHash: authenticator.verifierBindingHash,
    signal: input.signal,
  }));
  input.signal.throwIfAborted();
  if (authenticated !== true) {
    throw new TypeError("registry projection authentication failed");
  }
  return new AuthenticatedRegistryCustomLaunchProjectionV1(
    AUTHENTICATED_REGISTRY_PROJECTION_MINT,
    materialization,
  );
}

interface RegistryCustomLaunchRowV1 extends Record<string, unknown> {
  project_id: string;
  launch_id: string;
  lifecycle_generation: string | number | bigint;
  lifecycle_state: string;
  lifecycle_binding_hash: string;
  observed_at: string | Date;
  canonical_materialization: string;
  canonical_public_record: string | null;
  record_binding_hash: string | null;
  launch_security_binding_hash: string;
  launching_wallet_namespace: string | null;
  launching_wallet_value: string | null;
}

export interface RegistryCustomLaunchPublicReadStoreV1 {
  readonly sourceLane: "registry.custom-launched";
  findFinalizedCustomLaunchByProjectId(input: Readonly<{
    projectId: Sha256Digest;
    signal: AbortSignal;
  }>): Promise<Readonly<AuthenticatedCustomLaunchProjectV2> | null>;
  findFinalizedCustomLaunchesPublic(input: Readonly<{
    signal: AbortSignal;
  }>): Promise<readonly Readonly<AuthenticatedCustomLaunchProjectV2>[]>;
  findFinalizedCustomLaunchesByWallet(input: Readonly<{
    namespace: string;
    value: string;
    signal: AbortSignal;
  }>): Promise<readonly Readonly<AuthenticatedCustomLaunchProjectV2>[]>;
  findVerifiedRegistryCustomLaunchByProjectId(input: Readonly<{
    projectId: Sha256Digest;
    signal: AbortSignal;
  }>): Promise<Readonly<VerifiedRegistryCustomLaunchPublicV1> | null>;
  findVerifiedRegistryCustomLaunchesPublic(input: Readonly<{
    signal: AbortSignal;
  }>): Promise<readonly Readonly<VerifiedRegistryCustomLaunchPublicV1>[]>;
}

/**
 * Mutable materialized state derived only from authenticated Registry feed
 * observations. A lifecycle generation is monotonic per launch. Public reads
 * select exactly finalized rows; every other lifecycle state is fail-closed.
 */
export class PostgresRegistryCustomLaunchPublicStoreV1
implements RegistryCustomLaunchPublicReadStoreV1 {
  readonly sourceLane = "registry.custom-launched" as const;
  readonly #pool: ProjectionTargetPostgresPoolV1;

  constructor(pool: ProjectionTargetPostgresPoolV1) {
    if (pool === null || typeof pool !== "object"
      || typeof pool.connect !== "function" || typeof pool.query !== "function") {
      throw new TypeError("registry custom launch PostgreSQL pool is invalid");
    }
    this.#pool = pool;
  }

  async materializeAuthenticated(input: Readonly<{
    projection: AuthenticatedRegistryCustomLaunchProjectionV1;
    signal: AbortSignal;
  }>): Promise<RegistryCustomLaunchMaterializationResultV1> {
    input.signal.throwIfAborted();
    const materialization = AUTHENTICATED_REGISTRY_PROJECTIONS.get(
      input.projection,
    );
    if (materialization === undefined) {
      throw new TypeError("authenticated registry projection is invalid");
    }
    const canonicalMaterialization = canonicalizeJson(
      materialization as unknown as JsonValue,
    );
    const canonicalPublicRecord = materialization.record === null
      ? null
      : canonicalizeJson(materialization.record as unknown as JsonValue);
    const recordBindingHash = materialization.record === null
      ? null
      : canonicalSha256(
          "programmable.registry-custom-launch-public-record.v1",
          materialization.record as unknown as JsonValue,
        );
    const client = await this.#pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      input.signal.throwIfAborted();
      await client.query(`
        SELECT pg_advisory_xact_lock(lock_key)
          FROM unnest(ARRAY[
            hashtextextended($1, 734746231),
            hashtextextended($2, 734746232)
          ]) AS locks(lock_key)
         ORDER BY lock_key
      `, [materialization.launchId, materialization.projectId]);
      const current = await client.query<RegistryCustomLaunchRowV1>(`
        SELECT project_id, launch_id, lifecycle_generation, lifecycle_state,
               lifecycle_binding_hash, observed_at, canonical_materialization,
               canonical_public_record, record_binding_hash,
               launch_security_binding_hash
          FROM programmable_website_projection_v1.registry_custom_launch_records
         WHERE launch_id = $1
         FOR UPDATE
      `, [materialization.launchId]);
      const existing = current.rows[0];
      if (existing === undefined) {
        await client.query(`
          INSERT INTO programmable_website_projection_v1.registry_custom_launch_records
            (project_id, launch_id, lifecycle_generation, lifecycle_state,
             lifecycle_binding_hash, observed_at, canonical_materialization,
             canonical_public_record, record_binding_hash,
             launch_security_binding_hash, launching_wallet_namespace,
             launching_wallet_value)
          VALUES ($1, $2, $3::bigint, $4, $5, $6::timestamptz, $7, $8, $9,
                  $10, $11, $12)
        `, [
          materialization.projectId,
          materialization.launchId,
          materialization.generation,
          materialization.state,
          materialization.lifecycleBindingHash,
          materialization.observedAt,
          canonicalMaterialization,
          canonicalPublicRecord,
          recordBindingHash,
          materialization.launchSecurityBindingHash,
          materialization.record?.project.launchingWallet.namespace ?? null,
          materialization.record?.project.launchingWallet.value ?? null,
        ]);
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({ kind: "created" as const });
      }

      const currentGeneration = BigInt(existing.lifecycle_generation);
      const nextGeneration = BigInt(materialization.generation);
      if (nextGeneration < currentGeneration) {
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({ kind: "stale" as const });
      }
      if (nextGeneration === currentGeneration) {
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({
          kind: existing.canonical_materialization === canonicalMaterialization
            ? "existing" as const
            : "conflict" as const,
        });
      }
      if (existing.project_id !== materialization.projectId
        || existing.launch_id !== materialization.launchId
        || existing.launch_security_binding_hash
          !== materialization.launchSecurityBindingHash
        || (existing.lifecycle_state === "revoked"
          && materialization.state !== "revoked")) {
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({ kind: "conflict" as const });
      }
      await client.query(`
        UPDATE programmable_website_projection_v1.registry_custom_launch_records
           SET lifecycle_generation = $2::bigint,
               lifecycle_state = $3,
               lifecycle_binding_hash = $4,
               observed_at = $5::timestamptz,
               canonical_materialization = $6,
               canonical_public_record = $7,
               record_binding_hash = $8,
               launch_security_binding_hash = $9,
               launching_wallet_namespace = $10,
               launching_wallet_value = $11,
               updated_at = clock_timestamp()
         WHERE launch_id = $1
      `, [
        materialization.launchId,
        materialization.generation,
        materialization.state,
        materialization.lifecycleBindingHash,
        materialization.observedAt,
        canonicalMaterialization,
        canonicalPublicRecord,
        recordBindingHash,
        materialization.launchSecurityBindingHash,
        materialization.record?.project.launchingWallet.namespace ?? null,
        materialization.record?.project.launchingWallet.value ?? null,
      ]);
      await client.query("COMMIT");
      transactionOpen = false;
      return Object.freeze({ kind: "updated" as const });
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The original persistence error remains authoritative.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findVerifiedRegistryCustomLaunchByProjectId(input: Readonly<{
    projectId: Sha256Digest;
    signal: AbortSignal;
  }>): Promise<Readonly<VerifiedRegistryCustomLaunchPublicV1> | null> {
    input.signal.throwIfAborted();
    if (!DIGEST.test(input.projectId)) throw new TypeError("custom project id is invalid");
    const result = await this.#pool.query<RegistryCustomLaunchRowV1>(`
      ${PUBLIC_SELECT}
       WHERE project_id = $1
         AND lifecycle_state = 'finalized'
         AND canonical_public_record IS NOT NULL
       LIMIT 1
    `, [input.projectId]);
    input.signal.throwIfAborted();
    return result.rows[0] === undefined ? null : verifiedPublicRow(result.rows[0]);
  }

  async findVerifiedRegistryCustomLaunchesPublic(input: Readonly<{
    signal: AbortSignal;
  }>): Promise<readonly Readonly<VerifiedRegistryCustomLaunchPublicV1>[]> {
    input.signal.throwIfAborted();
    const result = await this.#pool.query<RegistryCustomLaunchRowV1>(`
      ${PUBLIC_SELECT}
       WHERE lifecycle_state = 'finalized'
         AND canonical_public_record IS NOT NULL
       ORDER BY observed_at DESC, project_id ASC
       LIMIT ${MAXIMUM_PUBLIC_CUSTOM_LAUNCHES}
    `);
    input.signal.throwIfAborted();
    return Object.freeze(result.rows.map(verifiedPublicRow));
  }

  async findFinalizedCustomLaunchByProjectId(input: Readonly<{
    projectId: Sha256Digest;
    signal: AbortSignal;
  }>): Promise<Readonly<AuthenticatedCustomLaunchProjectV2> | null> {
    const verified = await this.findVerifiedRegistryCustomLaunchByProjectId(input);
    return verified?.record.project ?? null;
  }

  async findFinalizedCustomLaunchesPublic(input: Readonly<{
    signal: AbortSignal;
  }>): Promise<readonly Readonly<AuthenticatedCustomLaunchProjectV2>[]> {
    const verified = await this.findVerifiedRegistryCustomLaunchesPublic(input);
    return Object.freeze(verified.map(({ record }) => record.project));
  }

  async findFinalizedCustomLaunchesByWallet(input: Readonly<{
    namespace: string;
    value: string;
    signal: AbortSignal;
  }>): Promise<readonly Readonly<AuthenticatedCustomLaunchProjectV2>[]> {
    input.signal.throwIfAborted();
    if (!/^eip155:[1-9][0-9]*$/u.test(input.namespace)
      || !ADDRESS.test(input.value)) {
      throw new TypeError("custom profile wallet is invalid");
    }
    const result = await this.#pool.query<RegistryCustomLaunchRowV1>(`
      ${PUBLIC_SELECT}
       WHERE lifecycle_state = 'finalized'
         AND canonical_public_record IS NOT NULL
         AND launching_wallet_namespace = $1
         AND launching_wallet_value = $2
       ORDER BY observed_at DESC, project_id ASC
       LIMIT ${MAXIMUM_CUSTOM_LAUNCHES_PER_PROFILE}
    `, [input.namespace, input.value]);
    input.signal.throwIfAborted();
    return Object.freeze(result.rows.map((row) => {
      const project = verifiedPublicRow(row).record.project;
      if (project.launchingWallet.namespace !== input.namespace
        || project.launchingWallet.value !== input.value) {
        throw new TypeError("stored registry custom profile wallet is invalid");
      }
      return project;
    }));
  }
}

const PUBLIC_SELECT = `
  SELECT project_id, launch_id, lifecycle_generation, lifecycle_state,
         lifecycle_binding_hash, observed_at, canonical_materialization,
         canonical_public_record, record_binding_hash,
         launch_security_binding_hash, launching_wallet_namespace,
         launching_wallet_value
    FROM programmable_website_projection_v1.registry_custom_launch_records
`;

export function parseRegistryCustomLaunchMaterializationV1(
  value: unknown,
): Readonly<RegistryCustomLaunchMaterializationV1> {
  const source = record(value, "registry custom launch materialization");
  exactKeys(source, [
    "generation", "launchId", "lifecycleBindingHash", "observedAt", "projectId",
    "launchSecurityBindingHash", "record", "schemaVersion", "sourceLane", "state",
  ], "registry custom launch materialization");
  if (source.schemaVersion !== "programmable.registry-custom-launch-materialization.v1"
    || source.sourceLane !== "registry.custom-launched") {
    throw new TypeError("registry custom launch materialization contract is invalid");
  }
  const state = enumValue(source.state, [
    "pending", "finalized", "corrected", "revoked", "reorged",
  ] as const, "registry custom launch lifecycle state");
  const projectId = digest(source.projectId, "registry custom project id");
  const launchId = digest(source.launchId, "registry custom launch id");
  const publicRecord = source.record === null
    ? null
    : parseRegistryCustomLaunchPublicRecordV1(source.record);
  const launchSecurityBindingHash = digest(
    source.launchSecurityBindingHash,
    "registry launch security binding",
  );
  if ((state === "finalized") !== (publicRecord !== null)
    || (publicRecord !== null && (publicRecord.project.projectId !== projectId
      || publicRecord.project.launchId !== launchId
      || registryCustomLaunchSecurityBindingHashV1(publicRecord)
        !== launchSecurityBindingHash))) {
    throw new TypeError("registry custom launch public lifecycle is invalid");
  }
  return Object.freeze({
    schemaVersion: "programmable.registry-custom-launch-materialization.v1" as const,
    sourceLane: "registry.custom-launched" as const,
    generation: positiveDecimal(source.generation, "registry lifecycle generation"),
    observedAt: instant(source.observedAt, "registry lifecycle observation"),
    projectId,
    launchId,
    state,
    lifecycleBindingHash: digest(
      source.lifecycleBindingHash,
      "registry lifecycle binding",
    ),
    launchSecurityBindingHash,
    record: publicRecord,
  });
}

export function parseRegistryCustomLaunchPublicRecordV1(
  value: unknown,
): Readonly<RegistryCustomLaunchPublicRecordV1> {
  const source = record(value, "registry custom launch public record");
  exactKeys(source, [
    "approval", "configurationHash", "event", "fee", "finality", "github",
    "launchId", "project", "projectId", "provider", "registry", "roles",
    "runtime", "schemaVersion",
  ], "registry custom launch public record");
  if (source.schemaVersion !== "programmable.registry-custom-launch-public-record.v1") {
    throw new TypeError("registry custom launch public record schema is invalid");
  }
  const project = parseAuthenticatedCustomLaunchProjectV2(source.project);
  const projectId = digest(source.projectId, "registry public project id");
  const launchId = digest(source.launchId, "registry public launch id");

  const registryValue = record(source.registry, "registry custom launch registry");
  exactKeys(registryValue, ["chainId", "registryAddress", "startBlock"],
    "registry custom launch registry");
  const registry = Object.freeze({
    chainId: positiveDecimal(registryValue.chainId, "registry chain id"),
    registryAddress: address(registryValue.registryAddress, "registry address"),
    startBlock: positiveDecimal(registryValue.startBlock, "registry start block"),
  });

  const eventValue = record(source.event, "registry custom launch event");
  exactKeys(eventValue, [
    "blockHash", "blockNumber", "logIndex", "transactionHash", "transactionIndex",
  ], "registry custom launch event");
  const event = Object.freeze({
    transactionHash: hash32(eventValue.transactionHash, "registry transaction hash"),
    blockHash: hash32(eventValue.blockHash, "registry block hash"),
    blockNumber: positiveDecimal(eventValue.blockNumber, "registry block number"),
    transactionIndex: nonnegativeInteger(
      eventValue.transactionIndex,
      "registry transaction index",
    ),
    logIndex: nonnegativeInteger(eventValue.logIndex, "registry log index"),
  });

  const finalityValue = record(source.finality, "registry custom launch finality");
  exactKeys(finalityValue, [
    "evidenceBindingHash", "observedHeadBlockHash", "observedHeadBlockNumber",
    "policyBindingHash", "requiredConfirmations",
  ], "registry custom launch finality");
  const finality = Object.freeze({
    observedHeadBlockNumber: positiveDecimal(
      finalityValue.observedHeadBlockNumber,
      "registry finality head block",
    ),
    observedHeadBlockHash: hash32(
      finalityValue.observedHeadBlockHash,
      "registry finality head hash",
    ),
    requiredConfirmations: positiveInteger(
      finalityValue.requiredConfirmations,
      "registry required confirmations",
    ),
    policyBindingHash: digest(
      finalityValue.policyBindingHash,
      "registry finality policy",
    ),
    evidenceBindingHash: digest(
      finalityValue.evidenceBindingHash,
      "registry finality evidence",
    ),
  });

  const providerValue = record(source.provider, "registry launch provider");
  exactKeys(providerValue, ["marketPath", "modelId", "modelVersion", "providerId"],
    "registry launch provider");
  const marketPath = providerValue.marketPath === null
    ? null
    : repositoryPath(providerValue.marketPath, "registry market path");
  const provider = Object.freeze({
    providerId: safeId(providerValue.providerId, "registry provider id"),
    modelId: safeId(providerValue.modelId, "registry model id"),
    modelVersion: safeId(providerValue.modelVersion, "registry model version"),
    marketPath,
  });

  const githubValue = record(source.github, "registry GitHub source");
  exactKeys(githubValue, [
    "commitObjectId", "repositoryId", "repositoryOwner", "treeObjectId",
  ], "registry GitHub source");
  const repositoryOwner = string(githubValue.repositoryOwner, "GitHub repository owner");
  const commitObjectId = string(githubValue.commitObjectId, "GitHub commit object id");
  const treeObjectId = string(githubValue.treeObjectId, "GitHub tree object id");
  if (!GITHUB_OWNER.test(repositoryOwner) || !GIT_OBJECT_ID.test(commitObjectId)
    || !GIT_OBJECT_ID.test(treeObjectId)) {
    throw new TypeError("registry GitHub source is invalid");
  }
  const github = Object.freeze({
    repositoryOwner,
    repositoryId: positiveDecimal(githubValue.repositoryId, "GitHub repository id"),
    commitObjectId,
    treeObjectId,
  });

  const approvalValue = record(source.approval, "registry approval");
  exactKeys(approvalValue, [
    "approvalBindingHash", "approvalId", "launchPlanBindingHash", "launchPlanPath",
  ], "registry approval");
  const approval = Object.freeze({
    approvalId: safeId(approvalValue.approvalId, "registry approval id"),
    approvalBindingHash: digest(
      approvalValue.approvalBindingHash,
      "registry approval binding",
    ),
    launchPlanPath: repositoryPath(
      approvalValue.launchPlanPath,
      "registry launch plan path",
    ),
    launchPlanBindingHash: digest(
      approvalValue.launchPlanBindingHash,
      "registry launch plan binding",
    ),
  });

  const runtimeValue = record(source.runtime, "registry launch runtime");
  exactKeys(runtimeValue, [
    "executionMode", "launchRouteId", "projectionRuntimeBindingHash",
    "registryAdapterBindingHash", "registryTargetBindingHash",
  ], "registry launch runtime");
  const runtime = Object.freeze({
    launchRouteId: safeId(runtimeValue.launchRouteId, "registry launch route"),
    executionMode: safeId(runtimeValue.executionMode, "registry execution mode"),
    registryAdapterBindingHash: digest(
      runtimeValue.registryAdapterBindingHash,
      "registry adapter binding",
    ),
    projectionRuntimeBindingHash: digest(
      runtimeValue.projectionRuntimeBindingHash,
      "registry projection runtime binding",
    ),
    registryTargetBindingHash: digest(
      runtimeValue.registryTargetBindingHash,
      "registry target binding",
    ),
  });

  const feeValue = record(source.fee, "registry launch fee");
  exactKeys(feeValue, [
    "feeAssessmentHash", "feeAssessmentObligationBindingHash",
    "feeObligationHash", "obligation",
  ], "registry launch fee");
  const fee = Object.freeze({
    feeAssessmentHash: digest(feeValue.feeAssessmentHash, "registry fee assessment"),
    feeObligationHash: digest(feeValue.feeObligationHash, "registry fee obligation"),
    feeAssessmentObligationBindingHash: digest(
      feeValue.feeAssessmentObligationBindingHash,
      "registry fee binding",
    ),
    obligation: project.feeObligation,
  });
  if (canonicalizeJson(feeValue.obligation as JsonValue)
      !== canonicalizeJson(project.feeObligation as unknown as JsonValue)) {
    throw new TypeError("registry fee obligation is substituted");
  }

  const rolesValue = record(source.roles, "registry launch roles");
  exactKeys(rolesValue, [
    "launchingWallet", "postLaunchAuthorityInventory",
    "postLaunchAuthorityInventoryHash",
  ], "registry launch roles");
  if (canonicalizeJson(rolesValue.launchingWallet as JsonValue)
      !== canonicalizeJson(project.launchingWallet as unknown as JsonValue)
    || canonicalizeJson(rolesValue.postLaunchAuthorityInventory as JsonValue)
      !== canonicalizeJson(project.postLaunchAuthorityInventory as unknown as JsonValue)) {
    throw new TypeError("registry launch roles are substituted");
  }
  const roles = Object.freeze({
    launchingWallet: project.launchingWallet,
    postLaunchAuthorityInventoryHash: digest(
      rolesValue.postLaunchAuthorityInventoryHash,
      "registry authority inventory",
    ),
    postLaunchAuthorityInventory: project.postLaunchAuthorityInventory,
  });

  const configurationHash = hash32(
    source.configurationHash,
    "registry launch configuration hash",
  );
  if (projectId !== project.projectId || launchId !== project.launchId
    || registry.chainId !== project.chainId
    || BigInt(event.blockNumber) < BigInt(registry.startBlock)
    || BigInt(finality.observedHeadBlockNumber) < BigInt(event.blockNumber)
    || BigInt(finality.observedHeadBlockNumber) - BigInt(event.blockNumber) + 1n
      < BigInt(finality.requiredConfirmations)
    || event.transactionHash !== project.launchTransactionId
    || provider.modelId !== project.modelId
    || (project.discoverableMarkets.length === 0) !== (marketPath === null)
    || runtime.launchRouteId !== project.launchRouteId
    || runtime.executionMode !== project.executionMode
    || runtime.registryAdapterBindingHash !== project.registryAdapterBindingHash
    || runtime.projectionRuntimeBindingHash !== project.projectionRuntimeBindingHash
    || runtime.registryTargetBindingHash !== project.registryTargetBindingHash
    || fee.feeAssessmentHash !== project.feeAssessmentHash
    || fee.feeObligationHash !== project.feeObligationHash
    || fee.feeAssessmentObligationBindingHash
      !== project.feeAssessmentObligationBindingHash
    || roles.postLaunchAuthorityInventoryHash
      !== project.postLaunchAuthorityInventoryHash) {
    throw new TypeError("registry custom launch public bindings are inconsistent");
  }

  return Object.freeze({
    schemaVersion: "programmable.registry-custom-launch-public-record.v1" as const,
    projectId,
    launchId,
    registry,
    event,
    finality,
    configurationHash,
    provider,
    github,
    approval,
    runtime,
    fee,
    roles,
    project,
  });
}

function verifiedPublicRow(
  row: RegistryCustomLaunchRowV1,
): Readonly<VerifiedRegistryCustomLaunchPublicV1> {
  if (row.lifecycle_state !== "finalized" || row.canonical_public_record === null) {
    throw new TypeError("non-final registry custom launch escaped public query");
  }
  const publicRecord = parseRegistryCustomLaunchPublicRecordV1(
    parseStrictJson(row.canonical_public_record),
  );
  const generation = positiveDecimal(
    String(row.lifecycle_generation),
    "stored registry lifecycle generation",
  );
  const lifecycleBindingHash = digest(
    row.lifecycle_binding_hash,
    "stored registry lifecycle binding",
  );
  const observedAt = instant(row.observed_at, "stored registry lifecycle observation");
  const recordBindingHash = digest(
    row.record_binding_hash,
    "stored registry public record binding",
  );
  const launchSecurityBindingHash = digest(
    row.launch_security_binding_hash,
    "stored registry launch security binding",
  );
  if (row.project_id !== publicRecord.project.projectId
    || row.launch_id !== publicRecord.project.launchId
    || recordBindingHash !== canonicalSha256(
      "programmable.registry-custom-launch-public-record.v1",
      publicRecord as unknown as JsonValue,
    )
    || launchSecurityBindingHash
      !== registryCustomLaunchSecurityBindingHashV1(publicRecord)) {
    throw new TypeError("stored registry custom launch index is invalid");
  }
  return Object.freeze({
    schemaVersion: "programmable.verified-registry-custom-launch-public.v1" as const,
    sourceLane: "registry.custom-launched" as const,
    lifecycle: Object.freeze({
      generation,
      state: "finalized" as const,
      bindingHash: lifecycleBindingHash,
      observedAt,
    }),
    record: publicRecord,
  });
}

export function registryCustomLaunchSecurityBindingHashV1(
  value: Readonly<RegistryCustomLaunchPublicRecordV1>,
): Sha256Digest {
  return canonicalSha256(
    "programmable.registry-custom-launch-security-binding.v1",
    {
      schemaVersion: "programmable.registry-custom-launch-security-binding.v1",
      projectId: value.projectId,
      launchId: value.launchId,
      registry: value.registry,
      transactionHash: value.event.transactionHash,
      configurationHash: value.configurationHash,
      provider: value.provider,
      github: value.github,
      approval: value.approval,
      runtime: value.runtime,
      fee: value.fee,
      roles: value.roles,
    } as unknown as JsonValue,
  );
}

function record(value: unknown, label: string): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Record<string, JsonValue>;
}

function exactKeys(
  value: Readonly<Record<string, JsonValue>>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} fields are invalid`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  return value;
}

function safeId(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!SAFE_ID.test(parsed)) throw new TypeError(`${label} is invalid`);
  return parsed;
}

function digest(value: unknown, label: string): Sha256Digest {
  const parsed = string(value, label);
  if (!DIGEST.test(parsed)) throw new TypeError(`${label} is invalid`);
  return parsed as Sha256Digest;
}

function hash32(value: unknown, label: string): `0x${string}` {
  const parsed = string(value, label);
  if (!HASH32.test(parsed)) throw new TypeError(`${label} is invalid`);
  return parsed as `0x${string}`;
}

function address(value: unknown, label: string): `0x${string}` {
  const parsed = string(value, label);
  if (!ADDRESS.test(parsed)) throw new TypeError(`${label} is invalid`);
  return parsed as `0x${string}`;
}

function positiveDecimal(value: unknown, label: string): string {
  const parsed = typeof value === "bigint" || typeof value === "number"
    ? String(value)
    : string(value, label);
  if (!POSITIVE_DECIMAL.test(parsed)) throw new TypeError(`${label} is invalid`);
  return parsed;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}

function repositoryPath(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!REPOSITORY_PATH.test(parsed) || parsed.includes("//")
    || parsed.split("/").some((segment) => segment === "." || segment === "")) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed;
}

function instant(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value.toISOString() : string(value, label);
  const time = Date.parse(parsed);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== parsed) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as T[number];
}
