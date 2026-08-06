import "server-only";

import { isIP } from "node:net";

import type {
  AuthenticatedCustomLaunchProjectV2,
  DiscoverableLaunchAssetV2,
  DiscoverableLaunchMarketV2,
  DiscoverableLaunchTokenMetadataV2,
  DiscoverableUniswapV4PoolV2,
  LaunchPresentationDraftV1,
} from "../../custom-launch/contract-v2";
export type {
  AuthenticatedCustomLaunchProjectV2,
  CustomLaunchFeeObligationV2,
} from "../../custom-launch/contract-v2";

import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "./canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "./hashing";
import {
  assertFinalizedUniswapV4PoolIdentityV1,
} from "./uniswap-v4-pool-identity";
import type {
  ProjectionTargetAtomicPutResultV1,
  ProjectionTargetAtomicStoreV1,
  ProjectionTargetCredentialUseResultV2,
  ProjectionTargetCredentialUseV2,
  ProjectionTargetLaneV1,
  ProjectionTargetStoredRecordV1,
} from "./protocol";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const GITHUB_USER_ID = /^[1-9][0-9]{0,63}$/u;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]{1,512}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SIGNED_DECIMAL = /^(?:0|-?[1-9][0-9]*)$/u;
const OPEN_IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const UNSAFE_PUBLIC_TEXT = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const PRESENTATION_VERSION = /^[1-9][0-9]{0,77}$/u;
const IPFS_CID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|[bB][a-zA-Z2-7]{31,127})$/u;
const ARWEAVE_TRANSACTION_ID = /^[A-Za-z0-9_-]{43}$/u;
const SENSITIVE_QUERY_KEY = /(?:^|[_-])(?:api[_-]?key|token|secret|password|passwd|signature|sig|credential|authorization|auth)(?:$|[_-])/iu;
const SECRET_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu,
  /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/u,
  /\b(?:sk|rk|pk)-(?:live|test)?[_-]?[A-Za-z0-9_-]{20,}\b/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\b(?:api[_-]?key|access[_-]?token|authorization|password|passwd|secret|private[_-]?key)\b\s*[:=]\s*["']?[^\s"']{8,}/iu,
] as const);
const MAXIMUM_ENTITLEMENTS_PER_USER = 100;
const MAXIMUM_CUSTOM_LAUNCHES_PER_PROFILE = 100;
const PLATFORM_FEE_RECIPIENT = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
const DISCOVERABLE_ASSET_ROLES = new Set([
  "root", "primary-token", "secondary-token", "pool", "hook", "controller",
] as const);

export interface ProjectionTargetPostgresQueryResultV1<Row> {
  readonly rows: Row[];
  readonly rowCount: number | null;
}

export interface ProjectionTargetPostgresClientV1 {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>>;
  release(): void;
}

export interface ProjectionTargetPostgresPoolV1 {
  connect(): Promise<ProjectionTargetPostgresClientV1>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>>;
}

interface StoredProjectionRowV1 extends Record<string, unknown> {
  lane: string;
  target_binding_hash: string;
  audience: string;
  projection_key: string;
  idempotency_key: string;
  request_digest: string;
  canonical_write: string;
  canonical_acknowledgement: string;
  canonical_readback: string;
  record_binding_hash: string;
}

interface CredentialUseRowV2 extends Record<string, unknown> {
  credential_id: string;
  request_binding_hash: string;
  canonical_use: string;
}

interface EntitlementProjectionRowV1 extends StoredProjectionRowV1 {
  github_user_id: string;
  github_principal_hash: string;
  application_id: string;
  application_revision: string;
  github_repository_id: string;
  launch_entitlement_binding_hash: string;
  valid_from: string | Date;
  valid_until: string | Date;
}

interface CustomLaunchProjectionRowV2 extends StoredProjectionRowV1 {
  custom_project_id: string;
  custom_launch_id: string;
  custom_github_principal_hash: string;
  custom_finalized_at: string | Date;
}

interface WebsiteEntitlementMetadataV1 {
  readonly githubUserId: string;
  readonly githubPrincipalHash: Sha256Digest;
  readonly applicationId: string;
  readonly applicationRevision: string;
  readonly githubRepositoryId: string;
  readonly launchEntitlementBindingHash: Sha256Digest;
  readonly validFrom: string;
  readonly validUntil: string;
}

interface ValidatedWebsiteEntitlementV1 {
  readonly metadata: Readonly<WebsiteEntitlementMetadataV1>;
  readonly summary: Readonly<AuthenticatedWebsiteEntitlementSummaryV1>;
}

export interface AuthenticatedWebsiteEntitlementSummaryV1 {
  readonly applicationId: string;
  readonly applicationRevision: string;
  readonly githubRepositoryId: string;
  readonly launchEntitlementBindingHash: Sha256Digest;
  readonly decisionReceiptHash: Sha256Digest;
  readonly chainProfileId: string;
  readonly launchCapabilityIds: readonly string[];
  readonly launcherWallet: Readonly<{
    namespace: string;
    value: string;
  }>;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly status: "launch_eligible";
  readonly action: "request_launch_permit";
}

/**
 * PostgreSQL-backed target store. The unique lane/key and idempotency indexes
 * are resolved in one transaction. No update or delete path exists here.
 */
export class PostgresProjectionTargetAtomicStoreV1
implements ProjectionTargetAtomicStoreV1 {
  readonly #pool: ProjectionTargetPostgresPoolV1;

  constructor(pool: ProjectionTargetPostgresPoolV1) {
    if (
      pool === null
      || typeof pool !== "object"
      || typeof pool.connect !== "function"
      || typeof pool.query !== "function"
    ) {
      throw new TypeError("projection target PostgreSQL pool is invalid");
    }
    this.#pool = pool;
  }

  async claimCredentialUseIfAbsentOrExact(input: Readonly<{
    use: ProjectionTargetCredentialUseV2;
    signal: AbortSignal;
  }>): Promise<ProjectionTargetCredentialUseResultV2> {
    input.signal.throwIfAborted();
    if (
      input.use.schemaVersion !== "programmable.projection-target-credential-use.v2"
      || !SAFE_TEXT.test(input.use.credentialId)
      || !DIGEST.test(input.use.requestBindingHash)
    ) throw new TypeError("projection target credential use is invalid");
    const canonicalUse = canonicalBody(
      input.use.canonicalUse,
      "projection target credential use",
    );
    const client = await this.#pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const inserted = await client.query<CredentialUseRowV2>(`
        INSERT INTO programmable_website_projection_v1.credential_uses
          (credential_id, request_binding_hash, canonical_use)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
        RETURNING credential_id, request_binding_hash, canonical_use
      `, [
        input.use.credentialId,
        input.use.requestBindingHash,
        canonicalUse,
      ]);
      if (inserted.rowCount === 1) {
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({ kind: "created" as const });
      }
      const existing = await client.query<CredentialUseRowV2>(`
        SELECT credential_id, request_binding_hash, canonical_use
          FROM programmable_website_projection_v1.credential_uses
         WHERE credential_id = $1
         LIMIT 1
      `, [input.use.credentialId]);
      await client.query("COMMIT");
      transactionOpen = false;
      const row = existing.rows[0];
      if (
        existing.rows.length !== 1
        || row === undefined
        || row.request_binding_hash !== input.use.requestBindingHash
        || row.canonical_use !== canonicalUse
      ) return Object.freeze({ kind: "conflict" as const });
      return Object.freeze({ kind: "existing" as const });
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

  async putIfAbsentOrExact(input: Readonly<{
    record: ProjectionTargetStoredRecordV1;
    signal: AbortSignal;
  }>): Promise<ProjectionTargetAtomicPutResultV1> {
    input.signal.throwIfAborted();
    const record = Object.freeze({ ...input.record });
    const entitlement = record.lane === "website.entitlement"
      ? parseWebsiteEntitlement(record)
      : null;
    const metadata = entitlement?.metadata ?? null;
    const customLaunch = record.lane === "website.custom-launched"
      ? parseCustomLaunchProject(record)
      : null;
    const client = await this.#pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;
      input.signal.throwIfAborted();

      const inserted = await client.query<StoredProjectionRowV1>(`
        INSERT INTO programmable_website_projection_v1.projection_records
          (lane, target_binding_hash, audience, projection_key,
           idempotency_key, request_digest, canonical_write,
           canonical_acknowledgement, canonical_readback,
           record_binding_hash, github_user_id, github_principal_hash,
           application_id, application_revision, github_repository_id,
           launch_entitlement_binding_hash, valid_from, valid_until,
           custom_project_id, custom_launch_id,
           custom_github_principal_hash, custom_finalized_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17::timestamptz,
           $18::timestamptz, $19, $20, $21, $22::timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING lane, target_binding_hash, audience, projection_key,
                  idempotency_key, request_digest, canonical_write,
                  canonical_acknowledgement, canonical_readback,
                  record_binding_hash
      `, [
        record.lane,
        record.targetBindingHash,
        record.audience,
        record.projectionKey,
        record.idempotencyKey,
        record.requestDigest,
        record.canonicalWrite,
        record.canonicalAcknowledgement,
        record.canonicalReadback,
        record.recordBindingHash,
        metadata?.githubUserId ?? null,
        metadata?.githubPrincipalHash ?? null,
        metadata?.applicationId ?? null,
        metadata?.applicationRevision ?? null,
        metadata?.githubRepositoryId ?? null,
        metadata?.launchEntitlementBindingHash ?? null,
        metadata?.validFrom ?? null,
        metadata?.validUntil ?? null,
        customLaunch?.projectId ?? null,
        customLaunch?.launchId ?? null,
        customLaunch?.githubPrincipalHash ?? null,
        customLaunch?.finalizedAt ?? null,
      ]);

      if (inserted.rowCount === 1 && inserted.rows[0] !== undefined) {
        const created = storedRecordFromRow(inserted.rows[0]);
        input.signal.throwIfAborted();
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({ kind: "created" as const, record: created });
      }

      const existing = await client.query<StoredProjectionRowV1>(`
        SELECT lane, target_binding_hash, audience, projection_key,
               idempotency_key, request_digest, canonical_write,
               canonical_acknowledgement, canonical_readback,
               record_binding_hash
          FROM programmable_website_projection_v1.projection_records
         WHERE (lane = $1 AND projection_key = $2)
            OR idempotency_key = $3
         ORDER BY lane, projection_key
      `, [record.lane, record.projectionKey, record.idempotencyKey]);

      input.signal.throwIfAborted();
      if (existing.rows.length !== 1) {
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({ kind: "conflict" as const });
      }

      const stored = storedRecordFromRow(existing.rows[0]!);
      await client.query("COMMIT");
      transactionOpen = false;
      if (stored.recordBindingHash !== record.recordBindingHash) {
        return Object.freeze({ kind: "conflict" as const });
      }
      return Object.freeze({ kind: "existing" as const, record: stored });
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

  async get(input: Readonly<{
    lane: ProjectionTargetLaneV1;
    projectionKey: string;
    signal: AbortSignal;
  }>): Promise<ProjectionTargetStoredRecordV1 | null> {
    input.signal.throwIfAborted();
    const result = await this.#pool.query<StoredProjectionRowV1>(`
      SELECT lane, target_binding_hash, audience, projection_key,
             idempotency_key, request_digest, canonical_write,
             canonical_acknowledgement, canonical_readback,
             record_binding_hash
        FROM programmable_website_projection_v1.projection_records
       WHERE lane = $1 AND projection_key = $2
       LIMIT 1
    `, [input.lane, input.projectionKey]);
    input.signal.throwIfAborted();
    return result.rows[0] === undefined
      ? null
      : storedRecordFromRow(result.rows[0]);
  }

  async findActiveWebsiteEntitlementsByPrincipal(input: Readonly<{
    githubUserId: string;
    githubPrincipalHash: Sha256Digest;
    now: Date;
    signal: AbortSignal;
  }>): Promise<readonly AuthenticatedWebsiteEntitlementSummaryV1[]> {
    input.signal.throwIfAborted();
    if (!GITHUB_USER_ID.test(input.githubUserId)) {
      throw new TypeError("authenticated GitHub user id is invalid");
    }
    if (!DIGEST.test(input.githubPrincipalHash)) {
      throw new TypeError("authenticated GitHub principal hash is invalid");
    }
    const now = canonicalInstant(input.now, "entitlement query time");
    const result = await this.#pool.query<EntitlementProjectionRowV1>(`
      SELECT lane, target_binding_hash, audience, projection_key,
             idempotency_key, request_digest, canonical_write,
             canonical_acknowledgement, canonical_readback,
             record_binding_hash, github_user_id,
             github_principal_hash, application_id,
             application_revision, github_repository_id,
             launch_entitlement_binding_hash, valid_from, valid_until
        FROM programmable_website_projection_v1.projection_records
       WHERE lane = 'website.entitlement'
         AND github_user_id = $1
         AND github_principal_hash = $2
         AND valid_from <= $3::timestamptz
         AND valid_until > $3::timestamptz
       ORDER BY valid_until ASC, projection_key ASC
       LIMIT ${MAXIMUM_ENTITLEMENTS_PER_USER}
    `, [input.githubUserId, input.githubPrincipalHash, now]);
    input.signal.throwIfAborted();

    return Object.freeze(result.rows.map((row) => {
      const stored = storedRecordFromRow(row);
      const entitlement = parseWebsiteEntitlement(stored);
      const metadata = entitlement.metadata;
      if (
        metadata === null
        || metadata.githubUserId !== input.githubUserId
        || metadata.githubPrincipalHash !== input.githubPrincipalHash
        || metadata.applicationId !== row.application_id
        || metadata.applicationRevision !== row.application_revision
        || metadata.githubRepositoryId !== row.github_repository_id
        || metadata.launchEntitlementBindingHash
          !== row.launch_entitlement_binding_hash
        || metadata.validFrom !== databaseInstant(row.valid_from)
        || metadata.validUntil !== databaseInstant(row.valid_until)
      ) {
        throw new TypeError("stored website entitlement index is invalid");
      }
      return entitlement.summary;
    }));
  }

  async findFinalizedCustomLaunchByProjectId(input: Readonly<{
    projectId: Sha256Digest;
    signal: AbortSignal;
  }>): Promise<Readonly<AuthenticatedCustomLaunchProjectV2> | null> {
    input.signal.throwIfAborted();
    if (!DIGEST.test(input.projectId)) throw new TypeError("custom project id is invalid");
    const result = await this.#pool.query<CustomLaunchProjectionRowV2>(`
      SELECT lane, target_binding_hash, audience, projection_key,
             idempotency_key, request_digest, canonical_write,
             canonical_acknowledgement, canonical_readback,
             record_binding_hash, custom_project_id, custom_launch_id,
             custom_github_principal_hash, custom_finalized_at
        FROM programmable_website_projection_v1.projection_records
       WHERE lane = 'website.custom-launched'
         AND custom_project_id = $1
       LIMIT 1
    `, [input.projectId]);
    input.signal.throwIfAborted();
    const row = result.rows[0];
    if (row === undefined) return null;
    const project = parseCustomLaunchProject(storedRecordFromRow(row));
    assertCustomLaunchIndex(project, row);
    return project;
  }

  async findFinalizedCustomLaunchesByPrincipal(input: Readonly<{
    githubPrincipalHash: Sha256Digest;
    signal: AbortSignal;
  }>): Promise<readonly Readonly<AuthenticatedCustomLaunchProjectV2>[]> {
    input.signal.throwIfAborted();
    if (!DIGEST.test(input.githubPrincipalHash)) {
      throw new TypeError("custom profile principal hash is invalid");
    }
    const result = await this.#pool.query<CustomLaunchProjectionRowV2>(`
      SELECT lane, target_binding_hash, audience, projection_key,
             idempotency_key, request_digest, canonical_write,
             canonical_acknowledgement, canonical_readback,
             record_binding_hash, custom_project_id, custom_launch_id,
             custom_github_principal_hash, custom_finalized_at
        FROM programmable_website_projection_v1.projection_records
       WHERE lane = 'website.custom-launched'
         AND custom_github_principal_hash = $1
       ORDER BY custom_finalized_at DESC, custom_project_id ASC
       LIMIT ${MAXIMUM_CUSTOM_LAUNCHES_PER_PROFILE}
    `, [input.githubPrincipalHash]);
    input.signal.throwIfAborted();
    return Object.freeze(result.rows.map((row) => {
      const project = parseCustomLaunchProject(storedRecordFromRow(row));
      assertCustomLaunchIndex(project, row);
      if (project.githubPrincipalHash !== input.githubPrincipalHash) {
        throw new TypeError("stored custom profile principal is invalid");
      }
      return project;
    }));
  }
}

export function validateWebsiteProjectionRecordV1(
  record: ProjectionTargetStoredRecordV1,
): void {
  if (record.lane === "website.entitlement") {
    parseWebsiteEntitlement(record);
  } else if (record.lane === "website.custom-launched") {
    parseCustomLaunchProject(record);
  }
}

function storedRecordFromRow(
  row: StoredProjectionRowV1,
): ProjectionTargetStoredRecordV1 {
  const lane = row.lane;
  if (lane !== "website.entitlement" && lane !== "website.custom-launched") {
    throw new TypeError("stored projection lane is invalid");
  }
  return Object.freeze({
    schemaVersion: "programmable.projection-target-stored-record.v1" as const,
    lane,
    targetBindingHash: digest(row.target_binding_hash, "stored target binding"),
    audience: safeText(row.audience, "stored audience"),
    projectionKey: safeText(row.projection_key, "stored projection key"),
    idempotencyKey: digest(row.idempotency_key, "stored idempotency key"),
    requestDigest: digest(row.request_digest, "stored request digest"),
    canonicalWrite: canonicalBody(row.canonical_write, "stored write"),
    canonicalAcknowledgement: canonicalBody(
      row.canonical_acknowledgement,
      "stored acknowledgement",
    ),
    canonicalReadback: canonicalBody(
      row.canonical_readback,
      "stored readback",
    ),
    recordBindingHash: digest(
      row.record_binding_hash,
      "stored record binding",
    ),
  });
}

function parseCustomLaunchProject(
  stored: ProjectionTargetStoredRecordV1,
): Readonly<AuthenticatedCustomLaunchProjectV2> {
  if (stored.lane !== "website.custom-launched") {
    throw new TypeError("custom launch lane is invalid");
  }
  const readback = jsonRecord(
    parseStrictJson(stored.canonicalReadback),
    "custom launch readback",
  );
  const record = jsonRecord(readback.record, "custom launch website record");
  exactKeys(record, [
    "action", "advertisesToken", "assetIdentitySetHash", "category", "chainId",
    "chainProfileHash", "chainProfileId", "discoverableAssets", "discoverableMarkets",
    "executionMode",
    "feeAssessmentHash", "feeAssessmentObligationBindingHash", "feeObligation",
    "feeObligationHash", "finalizedAt", "finalizedLaunchBindingHash",
    "githubPrincipalHash", "launchFamily", "launchId", "launchIdentity",
    "launchRouteId", "launchTransactionId", "launchedAt", "marketSetHash", "modelId",
    "origin", "platformId", "presentation", "presentationBindingHash",
    "presentationVersion", "projectId",
    "projectionRuntimeBindingHash", "registryAdapterBindingHash",
    "registryObservationDigest", "registryPublicationBindingHash",
    "registryTargetBindingHash", "schemaVersion", "sourceKind",
    "sourceRecordBindingHash", "status",
    "websiteProjectionGeneration",
  ], "custom launch website record");
  const identity = jsonRecord(record.launchIdentity, "custom launch identity");
  exactKeys(identity, ["namespace", "value"], "custom launch identity");
  if (typeof record.advertisesToken !== "boolean"
    || !Array.isArray(record.discoverableAssets)
    || record.discoverableAssets.length > 1_024) {
    throw new TypeError("custom launch discoverable assets are invalid");
  }
  const discoverableAssets = Object.freeze(record.discoverableAssets.map(
    (value, index) => {
      const asset = jsonRecord(value, `custom launch discoverable asset ${index}`);
      exactKeys(asset, [
        "assetId", "identity", "identityEvidenceHash", "onchainMetadata",
        "onchainMetadataHash", "provenance", "role",
      ], "custom launch discoverable asset");
      const assetIdentity = jsonRecord(
        asset.identity,
        "custom launch discoverable asset identity",
      );
      exactKeys(assetIdentity, ["namespace", "value"],
        "custom launch discoverable asset identity");
      const role = stringField(asset.role, "custom launch discoverable asset role");
      const discoverableRole = role as
        AuthenticatedCustomLaunchProjectV2["discoverableAssets"][number]["role"];
      if (!DISCOVERABLE_ASSET_ROLES.has(discoverableRole)) {
        throw new TypeError("custom launch discoverable asset role is invalid");
      }
      const onchainMetadataHash = asset.onchainMetadataHash === null
        ? null
        : digest(
            asset.onchainMetadataHash,
            "custom launch discoverable asset onchain metadata",
          );
      const onchainMetadata = asset.onchainMetadata === null
        ? null
        : validatedDiscoverableTokenMetadataV2(asset.onchainMetadata);
      if (
        (onchainMetadata === null) !== (onchainMetadataHash === null)
        || (discoverableRole === "primary-token" && onchainMetadata === null)
        || (!discoverableRole.endsWith("token") && onchainMetadata !== null)
        || (onchainMetadata !== null && canonicalSha256(
          "programmable.discoverable-launch-token-metadata-hash.v2",
          onchainMetadata,
        ) !== onchainMetadataHash)
      ) throw new TypeError("custom launch asset metadata binding is invalid");
      return Object.freeze({
        assetId: safeIdentifier(asset.assetId, "custom launch discoverable asset id"),
        role: discoverableRole,
        identity: Object.freeze({
          namespace: exactPublicText(
            assetIdentity.namespace,
            256,
            "custom launch discoverable asset identity namespace",
          ),
          value: exactPublicText(
            assetIdentity.value,
            1_024,
            "custom launch discoverable asset identity value",
          ),
        }),
        provenance: validatedAssetProvenanceV2(asset.provenance, assetIdentity),
        identityEvidenceHash: digest(
          asset.identityEvidenceHash,
          "custom launch discoverable asset identity evidence",
        ),
        onchainMetadata,
        onchainMetadataHash,
      });
    },
  ));
  const assetIds = discoverableAssets.map(({ assetId }) => assetId);
  const assetIdentities = discoverableAssets.map(({ identity: assetIdentity }) =>
    `${assetIdentity.namespace.length}:${assetIdentity.namespace}${assetIdentity.value}`);
  const primaryTokenCount = discoverableAssets.filter(({ role, provenance }) =>
    role === "primary-token" && provenance.kind === "launch-produced").length;
  if (
    new Set(assetIds).size !== assetIds.length
    || new Set(assetIdentities).size !== assetIdentities.length
    || discoverableAssets.some((asset, index) => index > 0
      && compareUtf8(assetIds[index - 1]!, asset.assetId) >= 0)
    || discoverableAssets.some(({ role, provenance }) =>
      role === "primary-token" && provenance.kind !== "launch-produced")
    || (record.advertisesToken ? primaryTokenCount !== 1 : primaryTokenCount !== 0)
  ) throw new TypeError("custom launch discoverable asset set is invalid");
  const assetIdentitySetHash = digest(
    record.assetIdentitySetHash,
    "custom launch asset identity set",
  );
  const expectedAssetIdentitySetHash = canonicalSha256(
    "programmable.discoverable-launch-asset-set-hash.v2",
    {
      schemaVersion: "programmable.discoverable-launch-asset-set.v2",
      advertisesToken: record.advertisesToken,
      assets: discoverableAssets,
    },
  );
  const chainId = safeText(record.chainId, "custom launch chain id");
  const { discoverableMarkets, marketSetHash } = validatedDiscoverableMarketsV2({
    value: record.discoverableMarkets,
    marketSetHash: record.marketSetHash,
    assetIdentitySetHash,
    advertisesToken: record.advertisesToken,
    assets: discoverableAssets,
    chainId,
  });
  const fee = jsonRecord(record.feeObligation, "custom launch fee obligation");
  exactKeys(fee, [
    "applicabilityPredicate", "chainId", "chainProfileHash", "chainProfileId",
    "claimSemantics", "enforcementModuleBindingHash", "enforcementModuleId",
    "enforcementRouteBindingHash", "enforcementRouteId", "feeAssessmentHash",
    "feeAssessmentObligationBindingHash", "feeBasis", "feeObligationHash",
    "qualifyingFlowBasis", "qualifyingFlowBasisBindingHash", "ratePpm",
    "recipient", "schemaVersion",
  ], "custom launch fee obligation");
  const recipient = jsonRecord(fee.recipient, "custom launch fee recipient");
  exactKeys(recipient, ["namespace", "value"], "custom launch fee recipient");
  const projectId = digest(record.projectId, "custom project id");
  const launchId = digest(record.launchId, "custom launch id");
  const githubPrincipalHash = digest(
    record.githubPrincipalHash,
    "custom launch GitHub principal",
  );
  const chainProfileId = safeText(
    record.chainProfileId,
    "custom launch chain profile id",
  );
  const chainProfileHash = digest(
    record.chainProfileHash,
    "custom launch chain profile hash",
  );
  const launchRouteId = safeText(record.launchRouteId, "custom launch route id");
  const sourceRecordBindingHash = digest(
    record.sourceRecordBindingHash,
    "custom launch source record binding",
  );
  const finalizedLaunchBindingHash = digest(
    record.finalizedLaunchBindingHash,
    "custom finalized launch binding",
  );
  const feeAssessmentHash = digest(record.feeAssessmentHash, "fee assessment hash");
  const feeObligationHash = digest(record.feeObligationHash, "fee obligation hash");
  const feeAssessmentObligationBindingHash = digest(
    record.feeAssessmentObligationBindingHash,
    "fee assessment obligation binding",
  );
  const feeDigestFields = [
    "chainProfileHash", "feeAssessmentHash", "qualifyingFlowBasisBindingHash",
    "enforcementRouteBindingHash", "enforcementModuleBindingHash",
    "feeObligationHash", "feeAssessmentObligationBindingHash",
  ] as const;
  for (const field of feeDigestFields) digest(fee[field], `fee ${field}`);
  const recordDigestFields = [
    "registryPublicationBindingHash", "registryAdapterBindingHash",
    "projectionRuntimeBindingHash", "registryObservationDigest",
    "registryTargetBindingHash",
  ] as const;
  for (const field of recordDigestFields) digest(record[field], field);
  const feePreimage = Object.freeze({
    schemaVersion: fee.schemaVersion,
    feeAssessmentHash: fee.feeAssessmentHash,
    chainId: fee.chainId,
    chainProfileId: fee.chainProfileId,
    chainProfileHash: fee.chainProfileHash,
    ratePpm: fee.ratePpm,
    recipient: fee.recipient,
    applicabilityPredicate: fee.applicabilityPredicate,
    qualifyingFlowBasis: fee.qualifyingFlowBasis,
    qualifyingFlowBasisBindingHash: fee.qualifyingFlowBasisBindingHash,
    feeBasis: fee.feeBasis,
    enforcementRouteId: fee.enforcementRouteId,
    enforcementRouteBindingHash: fee.enforcementRouteBindingHash,
    enforcementModuleId: fee.enforcementModuleId,
    enforcementModuleBindingHash: fee.enforcementModuleBindingHash,
    claimSemantics: fee.claimSemantics,
  });
  const canonicalFeeObligationHash = canonicalSha256(
    "programmable.launch-fee-obligation.v2",
    feePreimage,
  );
  const canonicalFeeBindingHash = canonicalSha256(
    "programmable.launch-fee-assessment-obligation-binding.v2",
    {
      schemaVersion: "programmable.launch-fee-assessment-obligation-binding.v2",
      feeAssessmentHash,
      feeObligationHash,
    },
  );
  const launchedAt = canonicalInstant(record.launchedAt, "custom launch time");
  const finalizedAt = canonicalInstant(record.finalizedAt, "custom finality time");
  const presentation = validatedLaunchPresentationV1(record);
  if (
    readback.schemaVersion !== "programmable.custom-launch-projection-readback.v2"
    || readback.projectionKind !== "website.custom-launched"
    || readback.projectionKey !== stored.projectionKey
    || readback.projectId !== projectId
    || readback.launchId !== launchId
    || record.schemaVersion !== "programmable.custom-launch-website-record.v2"
    || record.platformId !== "programmable"
    || record.origin !== "programmable"
    || record.category !== "custom"
    || record.launchFamily !== "custom"
    || !safeIdentifier(record.modelId, "custom launch model id")
    || (record.sourceKind !== "browser-wallet-report"
      && record.sourceKind !== "legacy-executor")
    || readback.sourceAuthorityHash !== record.registryPublicationBindingHash
    || record.status !== "launched"
    || record.action !== "view_live_launch"
    || expectedAssetIdentitySetHash !== assetIdentitySetHash
    || stored.projectionKey !== `custom:${launchId}`
    || !/^[1-9][0-9]*$/u.test(chainId)
    || fee.schemaVersion !== "programmable.launch-fee-obligation.v2"
    || fee.chainId !== chainId
    || fee.chainProfileId !== chainProfileId
    || fee.chainProfileHash !== chainProfileHash
    || fee.ratePpm !== 1000
    || fee.recipient === null
    || recipient.namespace !== `eip155:${chainId}`
    || recipient.value !== PLATFORM_FEE_RECIPIENT
    || fee.applicabilityPredicate !== "all-qualifying-launch-flows"
    || fee.feeBasis !== "gross-qualifying-flow-volume"
    || fee.claimSemantics !== "recipient-claimable-accrual"
    || fee.enforcementRouteId !== launchRouteId
    || fee.feeAssessmentHash !== feeAssessmentHash
    || fee.feeObligationHash !== feeObligationHash
    || fee.feeAssessmentObligationBindingHash !== feeAssessmentObligationBindingHash
    || canonicalFeeObligationHash !== feeObligationHash
    || canonicalFeeBindingHash !== feeAssessmentObligationBindingHash
    || !/^[1-9][0-9]*$/u.test(stringField(
      record.websiteProjectionGeneration,
      "website projection generation",
    ))
    || Date.parse(launchedAt) > Date.parse(finalizedAt)
  ) throw new TypeError("custom launch website record is invalid");

  return Object.freeze({
    schemaVersion: "programmable.custom-launch-website-record.v2" as const,
    platformId: "programmable" as const,
    origin: "programmable" as const,
    category: "custom" as const,
    launchFamily: "custom" as const,
    modelId: safeIdentifier(record.modelId, "custom launch model id"),
    sourceKind: record.sourceKind as "browser-wallet-report" | "legacy-executor",
    sourceRecordBindingHash,
    finalizedLaunchBindingHash,
    status: "launched" as const,
    action: "view_live_launch" as const,
    projectId,
    launchId,
    githubPrincipalHash,
    chainId,
    chainProfileId,
    chainProfileHash,
    launchIdentity: Object.freeze({
      namespace: safeText(identity.namespace, "custom launch identity namespace"),
      value: safeText(identity.value, "custom launch identity value"),
    }),
    launchTransactionId: safeText(
      record.launchTransactionId,
      "custom launch transaction id",
    ),
    launchRouteId,
    executionMode: safeText(record.executionMode, "custom execution mode"),
    advertisesToken: record.advertisesToken,
    discoverableAssets,
    assetIdentitySetHash,
    discoverableMarkets,
    marketSetHash,
    feeAssessmentHash,
    feeObligationHash,
    feeAssessmentObligationBindingHash,
    feeObligation: Object.freeze({
      schemaVersion: "programmable.launch-fee-obligation.v2" as const,
      feeAssessmentHash,
      chainId,
      chainProfileId,
      chainProfileHash,
      ratePpm: 1000 as const,
      recipient: Object.freeze({
        namespace: stringField(recipient.namespace, "fee recipient namespace"),
        value: stringField(recipient.value, "fee recipient value"),
      }),
      applicabilityPredicate: "all-qualifying-launch-flows" as const,
      qualifyingFlowBasis: safeText(fee.qualifyingFlowBasis, "qualifying flow basis"),
      qualifyingFlowBasisBindingHash: digest(
        fee.qualifyingFlowBasisBindingHash,
        "qualifying flow basis binding",
      ),
      feeBasis: "gross-qualifying-flow-volume" as const,
      enforcementRouteId: launchRouteId,
      enforcementRouteBindingHash: digest(
        fee.enforcementRouteBindingHash,
        "fee route binding",
      ),
      enforcementModuleId: safeText(fee.enforcementModuleId, "fee module id"),
      enforcementModuleBindingHash: digest(
        fee.enforcementModuleBindingHash,
        "fee module binding",
      ),
      claimSemantics: "recipient-claimable-accrual" as const,
      feeObligationHash,
      feeAssessmentObligationBindingHash,
    }),
    registryPublicationBindingHash: digest(
      record.registryPublicationBindingHash,
      "registry publication binding",
    ),
    registryAdapterBindingHash: digest(
      record.registryAdapterBindingHash,
      "registry adapter binding",
    ),
    projectionRuntimeBindingHash: digest(
      record.projectionRuntimeBindingHash,
      "projection runtime binding",
    ),
    registryObservationDigest: digest(
      record.registryObservationDigest,
      "registry observation digest",
    ),
    registryTargetBindingHash: digest(
      record.registryTargetBindingHash,
      "registry target binding",
    ),
    presentationVersion: presentation.version,
    presentationBindingHash: presentation.bindingHash,
    presentation: presentation.draft,
    websiteProjectionGeneration: stringField(
      record.websiteProjectionGeneration,
      "website projection generation",
    ),
    launchedAt,
    finalizedAt,
  });
}

function validatedAssetProvenanceV2(
  value: JsonValue | undefined,
  assetIdentityValue: Readonly<Record<string, JsonValue>>,
): DiscoverableLaunchAssetV2["provenance"] {
  const provenance = jsonRecord(value, "custom launch asset provenance");
  const kind = stringField(provenance.kind, "custom launch asset provenance kind");
  if (kind === "launch-produced") {
    exactKeys(provenance, ["kind"], "launch-produced asset provenance");
    return Object.freeze({ kind: "launch-produced" as const });
  }
  if (kind === "protocol-external") {
    exactKeys(provenance, ["kind", "relationship"],
      "protocol-external asset provenance");
    return Object.freeze({
      kind: "protocol-external" as const,
      relationship: exactPublicText(
        provenance.relationship,
        256,
        "protocol-external relationship",
      ),
    });
  }
  exactKeys(provenance, [
    "capabilityId", "chainProfileId", "dependencyId",
    "expectedRuntimeCodeKeccak256", "expectedRuntimeCodeSha256", "identity",
    "interfaceEvidenceBindingHash", "kind", "relationship", "reviewedRole",
    "reviewEvidenceBindingHash", "stateObservationIds",
  ], "adopted-external asset provenance");
  if (kind !== "adopted-external") {
    throw new TypeError("custom launch asset provenance is invalid");
  }
  const identity = jsonRecord(
    provenance.identity,
    "adopted-external asset identity",
  );
  exactKeys(identity, ["namespace", "value"], "adopted-external asset identity");
  const namespace = exactPublicText(
    identity.namespace,
    256,
    "adopted-external asset identity namespace",
  );
  const identityValue = exactPublicText(
    identity.value,
    1_024,
    "adopted-external asset identity value",
  );
  if (
    namespace !== assetIdentityValue.namespace
    || identityValue !== assetIdentityValue.value
  ) throw new TypeError("adopted-external asset identity is substituted");
  const stateObservationIds = validatedOptionalStringArray(
    provenance.stateObservationIds,
    "adopted-external state observation id",
    256,
  );
  const runtimeCodeKeccak256 = stringField(
    provenance.expectedRuntimeCodeKeccak256,
    "adopted-external runtime code Keccak-256",
  );
  if (!HASH32.test(runtimeCodeKeccak256)) {
    throw new TypeError("adopted-external runtime code Keccak-256 is invalid");
  }
  return Object.freeze({
    kind: "adopted-external" as const,
    relationship: exactPublicText(
      provenance.relationship,
      256,
      "adopted-external relationship",
    ),
    dependencyId: exactPublicText(
      provenance.dependencyId,
      256,
      "adopted-external dependency id",
    ),
    capabilityId: exactPublicText(
      provenance.capabilityId,
      256,
      "adopted-external capability id",
    ),
    reviewedRole: exactPublicText(
      provenance.reviewedRole,
      256,
      "adopted-external reviewed role",
    ),
    chainProfileId: exactPublicText(
      provenance.chainProfileId,
      256,
      "adopted-external chain profile id",
    ),
    identity: Object.freeze({ namespace, value: identityValue }),
    expectedRuntimeCodeKeccak256: runtimeCodeKeccak256,
    expectedRuntimeCodeSha256: digest(
      provenance.expectedRuntimeCodeSha256,
      "adopted-external runtime code SHA-256",
    ),
    reviewEvidenceBindingHash: digest(
      provenance.reviewEvidenceBindingHash,
      "adopted-external review evidence binding",
    ),
    interfaceEvidenceBindingHash: digest(
      provenance.interfaceEvidenceBindingHash,
      "adopted-external interface evidence binding",
    ),
    stateObservationIds,
  });
}

function validatedLaunchPresentationV1(
  record: Readonly<Record<string, JsonValue>>,
): Readonly<{
  version: string | null;
  bindingHash: Sha256Digest | null;
  draft: Readonly<LaunchPresentationDraftV1> | null;
}> {
  const allNull = record.presentationVersion === null
    && record.presentationBindingHash === null
    && record.presentation === null;
  if (allNull) {
    return Object.freeze({ version: null, bindingHash: null, draft: null });
  }
  if (
    typeof record.presentationVersion !== "string"
    || !PRESENTATION_VERSION.test(record.presentationVersion)
    || record.presentationBindingHash === null
    || record.presentation === null
  ) throw new TypeError("custom launch presentation triple is invalid");
  const draft = jsonRecord(record.presentation, "custom launch presentation");
  exactKeys(draft, ["description", "image", "links", "schemaVersion"],
    "custom launch presentation");
  if (draft.schemaVersion !== "programmable.launch-presentation-draft.v1") {
    throw new TypeError("custom launch presentation schema is invalid");
  }
  const description = normalizedPresentationDescription(draft.description);
  const image = draft.image === null
    ? null
    : validatedPresentationImageV1(draft.image);
  if (!Array.isArray(draft.links) || draft.links.length > 32) {
    throw new TypeError("custom launch presentation links are invalid");
  }
  const links = Object.freeze(draft.links.map((value) => {
    const link = jsonRecord(value, "custom launch presentation link");
    exactKeys(link, ["kind", "uri"], "custom launch presentation link");
    const kind = stringField(link.kind, "custom launch presentation link kind");
    if (!([
      "website", "documentation", "x", "telegram", "discord", "github", "other",
    ] as const).includes(kind as LaunchPresentationDraftV1["links"][number]["kind"])) {
      throw new TypeError("custom launch presentation link kind is invalid");
    }
    return Object.freeze({
      kind: kind as LaunchPresentationDraftV1["links"][number]["kind"],
      uri: canonicalPublicHttpsUri(link.uri, false),
    });
  }));
  const linkKeys = links.map(({ kind, uri }) => `${kind}\u0000${uri}`);
  if (new Set(linkKeys).size !== linkKeys.length
    || linkKeys.some((value, index) => index > 0
      && compareUtf8(linkKeys[index - 1]!, value) >= 0)) {
    throw new TypeError("custom launch presentation links are noncanonical");
  }
  return Object.freeze({
    version: record.presentationVersion,
    bindingHash: digest(
      record.presentationBindingHash,
      "custom launch presentation binding",
    ),
    draft: Object.freeze({
      schemaVersion: "programmable.launch-presentation-draft.v1" as const,
      description,
      image,
      links,
    }),
  });
}

function normalizedPresentationDescription(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("custom launch presentation description is invalid");
  }
  const normalized = value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
  if (
    normalized !== value
    || Buffer.byteLength(value, "utf8") > 4_096
    || UNSAFE_PUBLIC_TEXT.test(value)
    || containsRecognizableSecret(value)
  ) throw new TypeError("custom launch presentation description is unsafe");
  return value;
}

function validatedPresentationImageV1(
  value: JsonValue | undefined,
): Readonly<NonNullable<LaunchPresentationDraftV1["image"]>> {
  const image = jsonRecord(value, "custom launch presentation image");
  exactKeys(image, [
    "byteLength", "contentSha256", "height", "mediaType", "uri", "width",
  ], "custom launch presentation image");
  const mediaType = stringField(
    image.mediaType,
    "custom launch presentation image media type",
  );
  if (!(["image/png", "image/jpeg", "image/webp", "image/gif"] as const)
    .includes(mediaType as NonNullable<LaunchPresentationDraftV1["image"]>["mediaType"])
    || !boundedInteger(image.byteLength, 1, 20 * 1_024 * 1_024)
    || !boundedInteger(image.width, 1, 8_192)
    || !boundedInteger(image.height, 1, 8_192)) {
    throw new TypeError("custom launch presentation image is invalid");
  }
  return Object.freeze({
    uri: canonicalPresentationImageUri(image.uri),
    contentSha256: digest(
      image.contentSha256,
      "custom launch presentation image content digest",
    ),
    mediaType: mediaType as NonNullable<LaunchPresentationDraftV1["image"]>["mediaType"],
    byteLength: image.byteLength,
    width: image.width,
    height: image.height,
  });
}

function canonicalPresentationImageUri(value: unknown): string {
  const url = parsedPresentationUrl(value, "custom launch presentation image URI");
  if (url.protocol === "https:") {
    if (url.search !== "") {
      throw new TypeError("custom launch presentation image URI has a query");
    }
    return canonicalPublicHttpsUri(value, false);
  }
  if (url.username !== "" || url.password !== "" || url.port !== ""
    || url.search !== "" || url.hash !== "") {
    throw new TypeError("custom launch presentation image URI is unsafe");
  }
  if ((url.protocol === "ipfs:" && IPFS_CID.test(url.hostname))
    || (url.protocol === "ar:" && ARWEAVE_TRANSACTION_ID.test(url.hostname))) {
    return exactCanonicalPresentationUri(value, url);
  }
  throw new TypeError("custom launch presentation image URI is invalid");
}

function canonicalPublicHttpsUri(value: unknown, allowImageQuery: boolean): string {
  const url = parsedPresentationUrl(value, "custom launch presentation HTTPS URI");
  if (url.protocol !== "https:" || url.username !== "" || url.password !== ""
    || url.hostname === "" || url.hostname === "localhost"
    || url.hostname.endsWith(".localhost") || url.hostname.includes(":")
    || isIP(url.hostname) !== 0 || !/^[a-z0-9.-]+$/u.test(url.hostname)) {
    throw new TypeError("custom launch presentation HTTPS URI is not public");
  }
  if (!allowImageQuery) {
    for (const [key, entry] of url.searchParams) {
      if (SENSITIVE_QUERY_KEY.test(key)
        || containsRecognizableSecret(fullyDecode(entry))) {
        throw new TypeError("custom launch presentation HTTPS URI contains credentials");
      }
    }
  }
  return exactCanonicalPresentationUri(value, url);
}

function parsedPresentationUrl(value: unknown, label: string): URL {
  if (typeof value !== "string" || value === "" || value.trim() !== value
    || /[\u0000-\u0020\u007f]/u.test(value)
    || /[\u0000-\u0020\u007f]/u.test(fullyDecode(value))
    || containsRecognizableSecret(fullyDecode(value))) {
    throw new TypeError(`${label} is invalid`);
  }
  try {
    return new URL(value);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
}

function exactCanonicalPresentationUri(value: unknown, url: URL): string {
  if (typeof value !== "string" || url.href !== value
    || Buffer.byteLength(value, "utf8") > 2_048
    || containsRecognizableSecret(fullyDecode(value))) {
    throw new TypeError("custom launch presentation URI is noncanonical");
  }
  return value;
}

function fullyDecode(value: string): string {
  let current = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) return current;
      current = next;
    } catch {
      return current;
    }
  }
  return current;
}

function containsRecognizableSecret(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum;
}

function validatedDiscoverableTokenMetadataV2(
  value: JsonValue | undefined,
): Readonly<DiscoverableLaunchTokenMetadataV2> {
  const metadata = jsonRecord(value, "custom launch token metadata");
  const status = stringField(metadata.status, "custom launch token metadata status");
  if (
    metadata.schemaVersion !== "programmable.discoverable-launch-token-metadata.v2"
    || metadata.source !== "finality-resolved-onchain"
  ) throw new TypeError("custom launch token metadata is invalid");
  const evidenceHash = digest(
    metadata.evidenceHash,
    "custom launch token metadata evidence",
  );
  if (status === "available") {
    exactKeys(metadata, [
      "decimals", "evidenceHash", "name", "schemaVersion", "source", "status",
      "symbol",
    ], "custom launch available token metadata");
    if (!Number.isInteger(metadata.decimals)
      || Number(metadata.decimals) < 0 || Number(metadata.decimals) > 255) {
      throw new TypeError("custom launch token metadata decimals are invalid");
    }
    return Object.freeze({
      schemaVersion: "programmable.discoverable-launch-token-metadata.v2" as const,
      status: "available" as const,
      source: "finality-resolved-onchain" as const,
      name: displayPublicText(metadata.name, 256, "custom launch token name"),
      symbol: displayPublicText(metadata.symbol, 64, "custom launch token symbol"),
      decimals: Number(metadata.decimals),
      evidenceHash,
    });
  }
  exactKeys(metadata, [
    "evidenceHash", "reason", "schemaVersion", "source", "status",
  ], "custom launch unavailable token metadata");
  const reason = stringField(metadata.reason, "custom launch token metadata reason");
  if (status !== "unavailable" || !([
    "onchain-read-unavailable", "non-standard-metadata", "invalid-metadata",
  ] as const).includes(
    reason as Extract<DiscoverableLaunchTokenMetadataV2, {
      status: "unavailable";
    }>["reason"],
  )) throw new TypeError("custom launch token metadata is invalid");
  return Object.freeze({
    schemaVersion: "programmable.discoverable-launch-token-metadata.v2" as const,
    status: "unavailable" as const,
    source: "finality-resolved-onchain" as const,
    reason: reason as Extract<DiscoverableLaunchTokenMetadataV2, {
      status: "unavailable";
    }>["reason"],
    evidenceHash,
  });
}

function validatedDiscoverableMarketsV2(input: Readonly<{
  value: JsonValue | undefined;
  marketSetHash: JsonValue | undefined;
  assetIdentitySetHash: Sha256Digest;
  advertisesToken: boolean;
  assets: readonly DiscoverableLaunchAssetV2[];
  chainId: string;
}>): Readonly<{
  discoverableMarkets: readonly DiscoverableLaunchMarketV2[];
  marketSetHash: Sha256Digest;
}> {
  if (!Array.isArray(input.value) || input.value.length > 256
    || (!input.advertisesToken && input.value.length !== 0)) {
    throw new TypeError("custom launch discoverable market set is invalid");
  }
  const assetsById = new Map(input.assets.map((asset) => [asset.assetId, asset]));
  const discoverableMarkets = Object.freeze(input.value.map((value, index) => {
    const market = jsonRecord(value, `custom launch discoverable market ${index}`);
    exactKeys(market, [
      "baseAssetId", "kind", "marketAssetId", "marketEvidenceHash", "marketId",
      "quoteAssetId", "status", "uniswapV4", "verification",
    ], "custom launch discoverable market");
    const marketId = safeIdentifier(market.marketId, "custom launch market id");
    const kind = stringField(market.kind, "custom launch market kind");
    const marketAssetId = safeIdentifier(
      market.marketAssetId,
      "custom launch market asset id",
    );
    const baseAssetId = safeIdentifier(
      market.baseAssetId,
      "custom launch market base asset id",
    );
    const quoteAssetId = safeIdentifier(
      market.quoteAssetId,
      "custom launch market quote asset id",
    );
    const status = stringField(market.status, "custom launch market status");
    if (!OPEN_IDENTIFIER.test(kind) || !([
      "active", "paused", "closed", "verification_pending",
    ] as const).includes(
      status as DiscoverableLaunchMarketV2["status"],
    ) || baseAssetId === quoteAssetId) {
      throw new TypeError("custom launch discoverable market is invalid");
    }
    const marketAsset = assetsById.get(marketAssetId);
    const baseAsset = assetsById.get(baseAssetId);
    const quoteAsset = assetsById.get(quoteAssetId);
    if (
      marketAsset === undefined
      || baseAsset?.role !== "primary-token"
      || quoteAsset?.role !== "secondary-token"
      || !(["pool", "controller", "hook"] as const).includes(
        marketAsset.role as "pool" | "controller" | "hook",
      )
    ) throw new TypeError("custom launch discoverable market asset roles are invalid");
    const uniswapV4 = kind === "uniswap-v4-pool"
      ? validatedDiscoverableUniswapV4V2({
          value: market.uniswapV4,
          assetsById,
          marketAsset,
          baseAsset,
          quoteAsset,
          chainId: input.chainId,
        })
      : market.uniswapV4 === null
        ? null
        : invalidDiscoverableMarket("non-v4 market has a v4 descriptor");
    const verification = validatedMarketVerificationV2(market.verification);
    if ((uniswapV4 !== null && verification.status !== "verified")
      || (uniswapV4 === null && (verification.status !== "pending"
        || status !== "verification_pending"))) {
      throw new TypeError("custom launch market verification state is invalid");
    }
    return Object.freeze({
      marketId,
      kind,
      status: status as DiscoverableLaunchMarketV2["status"],
      marketAssetId,
      baseAssetId,
      quoteAssetId,
      marketEvidenceHash: digest(
        market.marketEvidenceHash,
        "custom launch market evidence",
      ),
      verification,
      uniswapV4,
    });
  }));
  const marketIds = discoverableMarkets.map(({ marketId }) => marketId);
  const marketAssetIds = discoverableMarkets.map(({ marketAssetId }) => marketAssetId);
  if (
    new Set(marketIds).size !== marketIds.length
    || new Set(marketAssetIds).size !== marketAssetIds.length
    || discoverableMarkets.some((market, index) => index > 0
      && compareUtf8(marketIds[index - 1]!, market.marketId) >= 0)
  ) throw new TypeError("custom launch discoverable markets are duplicated or unsorted");
  const marketSetHash = digest(input.marketSetHash, "custom launch market set");
  const expectedMarketSetHash = canonicalSha256(
    "programmable.discoverable-launch-market-set-hash.v2",
    {
      schemaVersion: "programmable.discoverable-launch-market-set.v2",
      assetIdentitySetHash: input.assetIdentitySetHash,
      markets: discoverableMarkets,
    },
  );
  if (marketSetHash !== expectedMarketSetHash) {
    throw new TypeError("custom launch discoverable market set hash is invalid");
  }
  return Object.freeze({ discoverableMarkets, marketSetHash });
}

function validatedMarketVerificationV2(
  value: JsonValue | undefined,
): DiscoverableLaunchMarketV2["verification"] {
  const verification = jsonRecord(value, "custom launch market verification");
  exactKeys(verification, [
    "status", "verifierAdapterId", "verifierBindingHash",
  ], "custom launch market verification");
  if (verification.status === "pending"
    && verification.verifierAdapterId === null
    && verification.verifierBindingHash === null) {
    return Object.freeze({
      status: "pending" as const,
      verifierAdapterId: null,
      verifierBindingHash: null,
    });
  }
  const adapterId = stringField(
    verification.verifierAdapterId,
    "custom launch market verifier adapter id",
  );
  if (verification.status !== "verified" || !OPEN_IDENTIFIER.test(adapterId)) {
    throw new TypeError("custom launch market verification is invalid");
  }
  return Object.freeze({
    status: "verified" as const,
    verifierAdapterId: adapterId,
    verifierBindingHash: digest(
      verification.verifierBindingHash,
      "custom launch market verifier binding",
    ),
  });
}

function validatedDiscoverableUniswapV4V2(input: Readonly<{
  value: JsonValue | undefined;
  assetsById: ReadonlyMap<string, DiscoverableLaunchAssetV2>;
  marketAsset: DiscoverableLaunchAssetV2;
  baseAsset: DiscoverableLaunchAssetV2;
  quoteAsset: DiscoverableLaunchAssetV2;
  chainId: string;
}>): Readonly<DiscoverableUniswapV4PoolV2> {
  const value = jsonRecord(input.value, "custom launch Uniswap v4 market");
  exactKeys(value, [
    "currency0AssetId", "currency1AssetId", "dynamicFee", "feeRaw",
    "hooksAssetId", "poolId", "poolKeyEvidenceHash", "poolManager",
    "poolManagerInterfaceEvidenceBindingHash", "poolManagerReviewEvidenceBindingHash",
    "poolManagerRuntimeCodeKeccak256", "poolManagerRuntimeCodeSha256", "tickSpacing",
  ], "custom launch Uniswap v4 market");
  const poolId = stringField(value.poolId, "custom launch v4 pool id");
  const currency0AssetId = safeIdentifier(
    value.currency0AssetId,
    "custom launch v4 currency0 asset id",
  );
  const currency1AssetId = safeIdentifier(
    value.currency1AssetId,
    "custom launch v4 currency1 asset id",
  );
  const feeRaw = stringField(value.feeRaw, "custom launch v4 fee");
  const tickSpacing = stringField(value.tickSpacing, "custom launch v4 tick spacing");
  const hooksAssetId = value.hooksAssetId === null
    ? null
    : safeIdentifier(value.hooksAssetId, "custom launch v4 hook asset id");
  if (
    !HASH32.test(poolId)
    || currency0AssetId === currency1AssetId
    || !UNSIGNED_DECIMAL.test(feeRaw)
    || typeof value.dynamicFee !== "boolean"
    || !SIGNED_DECIMAL.test(tickSpacing)
    || input.marketAsset.role !== "pool"
    || input.marketAsset.identity.value.toLowerCase() !== poolId
  ) throw new TypeError("custom launch Uniswap v4 market is invalid");
  const currency0 = input.assetsById.get(currency0AssetId);
  const currency1 = input.assetsById.get(currency1AssetId);
  const currencyIds = new Set([currency0?.assetId, currency1?.assetId]);
  if (
    currency0 === undefined
    || currency1 === undefined
    || !currencyIds.has(input.baseAsset.assetId)
    || !currencyIds.has(input.quoteAsset.assetId)
    || !ADDRESS.test(currency0.identity.value.toLowerCase())
    || !ADDRESS.test(currency1.identity.value.toLowerCase())
    || BigInt(currency0.identity.value) >= BigInt(currency1.identity.value)
  ) throw new TypeError("custom launch Uniswap v4 currencies are invalid");
  const fee = BigInt(feeRaw);
  if (
    (value.dynamicFee && fee !== 8_388_608n)
    || (!value.dynamicFee && fee > 1_000_000n)
  ) throw new TypeError("custom launch Uniswap v4 fee is invalid");
  const spacing = BigInt(tickSpacing);
  if (spacing < 1n || spacing > 32_767n) {
    throw new TypeError("custom launch Uniswap v4 tick spacing is invalid");
  }
  const poolManager = jsonRecord(value.poolManager, "custom launch v4 PoolManager");
  exactKeys(poolManager, ["namespace", "value"], "custom launch v4 PoolManager");
  const poolManagerNamespace = stringField(
    poolManager.namespace,
    "custom launch v4 PoolManager namespace",
  );
  const poolManagerValue = stringField(
    poolManager.value,
    "custom launch v4 PoolManager value",
  );
  if (!/^eip155:[1-9][0-9]*$/u.test(poolManagerNamespace)
    || !ADDRESS.test(poolManagerValue)
    || poolManagerValue !== poolManagerValue.toLowerCase()) {
    throw new TypeError("custom launch v4 PoolManager identity is invalid");
  }
  const hook = hooksAssetId === null
    ? null
    : input.assetsById.get(hooksAssetId) ?? null;
  if (hooksAssetId !== null) {
    if (hook?.role !== "hook" || !ADDRESS.test(hook.identity.value.toLowerCase())) {
      throw new TypeError("custom launch Uniswap v4 hook is invalid");
    }
  }
  assertFinalizedUniswapV4PoolIdentityV1({
    chainId: input.chainId,
    poolId,
    pool: input.marketAsset.identity,
    poolManager: {
      namespace: poolManagerNamespace,
      value: poolManagerValue,
    },
    currency0: currency0.identity,
    currency1: currency1.identity,
    feeRaw,
    dynamicFee: value.dynamicFee,
    tickSpacing,
    hooks: hook?.identity ?? null,
  });
  const poolManagerRuntimeCodeKeccak256 = stringField(
    value.poolManagerRuntimeCodeKeccak256,
    "custom launch v4 PoolManager runtime code Keccak-256",
  );
  if (!HASH32.test(poolManagerRuntimeCodeKeccak256)) {
    throw new TypeError("custom launch v4 PoolManager runtime code is invalid");
  }
  return Object.freeze({
    poolId,
    poolManager: Object.freeze({
      namespace: poolManagerNamespace,
      value: poolManagerValue,
    }),
    poolManagerReviewEvidenceBindingHash: digest(
      value.poolManagerReviewEvidenceBindingHash,
      "custom launch v4 PoolManager review evidence binding",
    ),
    poolManagerInterfaceEvidenceBindingHash: digest(
      value.poolManagerInterfaceEvidenceBindingHash,
      "custom launch v4 PoolManager interface evidence binding",
    ),
    poolManagerRuntimeCodeKeccak256,
    poolManagerRuntimeCodeSha256: digest(
      value.poolManagerRuntimeCodeSha256,
      "custom launch v4 PoolManager runtime code SHA-256",
    ),
    currency0AssetId,
    currency1AssetId,
    feeRaw,
    dynamicFee: value.dynamicFee,
    tickSpacing,
    hooksAssetId,
    poolKeyEvidenceHash: digest(
      value.poolKeyEvidenceHash,
      "custom launch v4 pool key evidence",
    ),
  });
}

function invalidDiscoverableMarket(message: string): never {
  throw new TypeError(message);
}

function assertCustomLaunchIndex(
  project: Readonly<AuthenticatedCustomLaunchProjectV2>,
  row: Readonly<CustomLaunchProjectionRowV2>,
): void {
  if (
    project.projectId !== row.custom_project_id
    || project.launchId !== row.custom_launch_id
    || project.githubPrincipalHash !== row.custom_github_principal_hash
    || project.finalizedAt !== databaseInstant(row.custom_finalized_at)
  ) throw new TypeError("stored custom launch index is invalid");
}

function parseWebsiteEntitlement(
  record: ProjectionTargetStoredRecordV1,
): Readonly<ValidatedWebsiteEntitlementV1> {
  if (record.lane !== "website.entitlement") {
    throw new TypeError("website entitlement lane is invalid");
  }
  const readback = jsonRecord(
    parseStrictJson(record.canonicalReadback),
    "website entitlement readback",
  );
  const projection = jsonRecord(
    readback.projection,
    "website entitlement projection",
  );
  exactKeys(projection, [
    "action", "approvedChainProfileSetHash", "approvedChainProfiles",
    "approvedLaunchCapabilityIds", "chainProfileHash",
    "chainProfileId", "chainProfileRegistrySnapshotHash", "decisionReceiptHash",
    "deduplicationKey", "entitlement", "eventType", "exactSourceRevisionBindingHash",
    "executionAuthorizationPolicyHash", "executionBindingHash",
    "feeEnforcementCoverageHash", "launchArtifactCommitmentHash",
    "launchArtifactManifestHash", "launchCapabilityBindingHash",
    "launchCapabilityIds", "launchEntitlementBindingHash",
    "launcherAuthorizationCommitmentHash", "launcherAuthorizationRouteHash",
    "launcherExecutionMode", "launcherWallet", "outboxId",
    "permitIssuanceGeneration", "precondition", "publicSourceAuthorityHash",
    "revision", "runnerAuthenticationEvidenceDigest", "runnerEvidenceDigest",
    "schemaVersion", "selectedChainProfileBindingHash",
    "signedReceiptArtifactHash", "subject", "validFrom", "validUntil",
    "websiteProjectionGeneration",
  ], "website entitlement projection");
  const subject = jsonRecord(projection.subject, "website entitlement subject");
  exactKeys(subject, [
    "applicationId", "applicationRevision", "githubRepositoryId", "githubUserId",
  ], "website entitlement subject");
  const revision = jsonRecord(
    projection.revision,
    "website entitlement revision",
  );
  exactKeys(revision, [
    "commitOid", "dependencyClosureHash", "objectFormat", "provider",
    "repositoryFullName", "repositoryId", "repositoryOwnerId",
    "sourceClosureHash", "sourceSnapshotHash", "sourceVisibility",
    "submissionManifestHash", "treeOid",
  ], "website entitlement revision");
  const launcherWallet = jsonRecord(
    projection.launcherWallet,
    "website entitlement launcher wallet",
  );
  exactKeys(launcherWallet, ["namespace", "value"],
    "website entitlement launcher wallet");
  const githubUserId = stringField(subject.githubUserId, "GitHub user id");
  const githubRepositoryId = stringField(
    subject.githubRepositoryId,
    "GitHub repository id",
  );
  const launchEntitlementBindingHash = digest(
    projection.launchEntitlementBindingHash,
    "launch entitlement binding",
  );
  const decisionReceiptHash = digest(
    projection.decisionReceiptHash,
    "decision receipt hash",
  );
  const validFrom = canonicalInstant(
    projection.validFrom,
    "website entitlement validFrom",
  );
  const validUntil = canonicalInstant(
    projection.validUntil,
    "website entitlement validUntil",
  );
  const launchCapabilityIds = projection.launchCapabilityIds;
  const approvedLaunchCapabilityIds = projection.approvedLaunchCapabilityIds;
  const approvedChainProfiles = projection.approvedChainProfiles;
  const digestFields = [
    "signedReceiptArtifactHash", "approvedChainProfileSetHash",
    "chainProfileRegistrySnapshotHash", "selectedChainProfileBindingHash",
    "chainProfileHash", "launchCapabilityBindingHash",
    "launchArtifactCommitmentHash", "launchArtifactManifestHash",
    "publicSourceAuthorityHash", "exactSourceRevisionBindingHash",
    "runnerEvidenceDigest", "runnerAuthenticationEvidenceDigest",
    "launcherAuthorizationCommitmentHash", "launcherAuthorizationRouteHash",
    "executionBindingHash", "executionAuthorizationPolicyHash",
    "feeEnforcementCoverageHash", "deduplicationKey", "outboxId",
  ] as const;
  for (const field of digestFields) digest(projection[field], field);
  for (const field of [
    "sourceSnapshotHash", "submissionManifestHash", "sourceClosureHash",
    "dependencyClosureHash",
  ] as const) digest(revision[field], `revision ${field}`);
  const approvedCapabilities = validatedStringArray(
    approvedLaunchCapabilityIds,
    "approved launch capabilities",
  );
  const launchCapabilities = validatedStringArray(
    launchCapabilityIds,
    "launch capabilities",
  );
  if (!Array.isArray(approvedChainProfiles)
    || approvedChainProfiles.length < 1
    || approvedChainProfiles.length > 256) {
    throw new TypeError("approved chain profiles are invalid");
  }
  const normalizedProfiles = approvedChainProfiles.map((value, index) => {
    const profile = jsonRecord(value, `approved chain profile ${index}`);
    exactKeys(profile, ["profileHash", "profileId"], "approved chain profile");
    return Object.freeze({
      profileId: safeText(profile.profileId, "approved chain profile id"),
      profileHash: digest(profile.profileHash, "approved chain profile hash"),
    });
  });
  if (new Set(normalizedProfiles.map(({ profileId }) => profileId)).size
    !== normalizedProfiles.length) {
    throw new TypeError("approved chain profiles are duplicated");
  }
  const chainProfileId = safeText(projection.chainProfileId, "chain profile id");
  const chainProfileHash = digest(projection.chainProfileHash, "chain profile hash");
  const selectedProfile = normalizedProfiles.find(({ profileId }) =>
    profileId === chainProfileId);
  const objectFormat = revision.objectFormat;
  const expectedOid = objectFormat === "sha1"
    ? /^[0-9a-f]{40}$/u
    : objectFormat === "sha256"
      ? /^[0-9a-f]{64}$/u
      : null;
  const authority = Object.freeze({
    decisionReceiptHash,
    signedReceiptArtifactHash: projection.signedReceiptArtifactHash,
    approvedLaunchCapabilityIds,
    approvedChainProfiles,
    approvedChainProfileSetHash: projection.approvedChainProfileSetHash,
    chainProfileRegistrySnapshotHash: projection.chainProfileRegistrySnapshotHash,
    selectedChainProfileBindingHash: projection.selectedChainProfileBindingHash,
    chainProfileId: projection.chainProfileId,
    chainProfileHash: projection.chainProfileHash,
    launchCapabilityIds,
    launchCapabilityBindingHash: projection.launchCapabilityBindingHash,
    launchArtifactCommitmentHash: projection.launchArtifactCommitmentHash,
    launchArtifactManifestHash: projection.launchArtifactManifestHash,
    publicSourceAuthorityHash: projection.publicSourceAuthorityHash,
    exactSourceRevisionBindingHash: projection.exactSourceRevisionBindingHash,
    runnerEvidenceDigest: projection.runnerEvidenceDigest,
    runnerAuthenticationEvidenceDigest: projection.runnerAuthenticationEvidenceDigest,
    launcherWallet: projection.launcherWallet,
    launcherExecutionMode: projection.launcherExecutionMode,
    launcherAuthorizationCommitmentHash: projection.launcherAuthorizationCommitmentHash,
    launcherAuthorizationRouteHash: projection.launcherAuthorizationRouteHash,
    executionBindingHash: projection.executionBindingHash,
    executionAuthorizationPolicyHash: projection.executionAuthorizationPolicyHash,
    feeEnforcementCoverageHash: projection.feeEnforcementCoverageHash,
    permitIssuanceGeneration: projection.permitIssuanceGeneration,
    websiteProjectionGeneration: projection.websiteProjectionGeneration,
    validFrom: projection.validFrom,
    validUntil: projection.validUntil,
  });
  const expectedEntitlementBinding = canonicalSha256(
    "programmable.website-launch-entitlement-authority.v1",
    authority,
  );
  const expectedDeduplication = canonicalSha256(
    "programmable.website-launch-entitlement-deduplication.v1",
    {
      decisionReceiptHash,
      launchArtifactCommitmentHash: projection.launchArtifactCommitmentHash,
      launchEntitlementBindingHash,
      permitIssuanceGeneration: projection.permitIssuanceGeneration,
      websiteProjectionGeneration: projection.websiteProjectionGeneration,
    },
  );
  const withoutOutboxId = Object.fromEntries(
    Object.entries(projection).filter(([key]) => key !== "outboxId"),
  ) as JsonValue;
  const expectedOutboxId = canonicalSha256(
    "programmable.website-launch-entitlement-outbox.v1",
    withoutOutboxId,
  );
  if (
    !GITHUB_USER_ID.test(githubUserId)
    || !GITHUB_USER_ID.test(githubRepositoryId)
    || readback.schemaVersion
      !== "programmable.registry-website-projection-readback.v1"
    || readback.topic !== "website.entitlement"
    || readback.projectionKind !== "launch_eligible"
    || readback.projectionKey !== record.projectionKey
    || projection.schemaVersion !== "1.0.0"
    || projection.eventType
      !== "programmable.website-launch-entitlement.requested.v1"
    || projection.entitlement !== "custom-launch"
    || projection.action !== "grant"
    || revision.provider !== "github"
    || (revision.sourceVisibility !== "public"
      && revision.sourceVisibility !== "private")
    || revision.repositoryId !== githubRepositoryId
    || !GITHUB_USER_ID.test(stringField(
      revision.repositoryOwnerId,
      "repository owner id",
    ))
    || typeof revision.repositoryFullName !== "string"
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u
      .test(revision.repositoryFullName)
    || expectedOid === null
    || typeof revision.commitOid !== "string"
    || !expectedOid.test(revision.commitOid)
    || typeof revision.treeOid !== "string"
    || !expectedOid.test(revision.treeOid)
    || projection.precondition
      !== "current-signed-approval-authenticated-artifact-and-active-axes"
    || launchEntitlementBindingHash !== record.projectionKey
    || launchEntitlementBindingHash !== expectedEntitlementBinding
    || projection.deduplicationKey !== expectedDeduplication
    || projection.outboxId !== expectedOutboxId
    || !/^[1-9][0-9]*$/u.test(stringField(
      projection.permitIssuanceGeneration,
      "permit issuance generation",
    ))
    || !/^[1-9][0-9]*$/u.test(stringField(
      projection.websiteProjectionGeneration,
      "website projection generation",
    ))
    || !SAFE_TEXT.test(stringField(
      projection.launcherExecutionMode,
      "launcher execution mode",
    ))
    || selectedProfile?.profileHash !== chainProfileHash
    || launchCapabilities.some((value) => !approvedCapabilities.includes(value))
    || Date.parse(validFrom) >= Date.parse(validUntil)
  ) throw new TypeError("website entitlement projection is invalid");

  const metadata = Object.freeze({
      githubUserId,
      githubPrincipalHash: canonicalSha256(
        "programmable.github-submitter-principal.v1",
        { githubUserId },
      ),
      applicationId: safeText(subject.applicationId, "application id"),
      applicationRevision: safeText(
        subject.applicationRevision,
        "application revision",
      ),
      githubRepositoryId,
      launchEntitlementBindingHash,
      validFrom,
      validUntil,
  });
  const summary = Object.freeze({
    applicationId: safeText(subject.applicationId, "application id"),
    applicationRevision: safeText(
      subject.applicationRevision,
      "application revision",
    ),
    githubRepositoryId,
    launchEntitlementBindingHash,
    decisionReceiptHash,
    chainProfileId,
    launchCapabilityIds: Object.freeze(
      launchCapabilities,
    ),
    launcherWallet: Object.freeze({
      namespace: safeText(
        launcherWallet.namespace,
        "launcher wallet namespace",
      ),
      value: safeText(launcherWallet.value, "launcher wallet value"),
    }),
    validFrom: canonicalInstant(
      projection.validFrom,
      "website entitlement validFrom",
    ),
    validUntil: canonicalInstant(
      projection.validUntil,
      "website entitlement validUntil",
    ),
    status: "launch_eligible" as const,
    action: "request_launch_permit" as const,
  });
  return Object.freeze({ metadata, summary });
}

function jsonRecord(
  value: JsonValue | undefined,
  label: string,
): Readonly<Record<string, JsonValue>> {
  if (value === null || value === undefined || Array.isArray(value)
    || typeof value !== "object") {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function exactKeys(
  value: Readonly<Record<string, JsonValue>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (
    actual.length !== sorted.length
    || actual.some((key, index) => key !== sorted[index])
  ) throw new TypeError(`${label} fields are invalid`);
}

function canonicalBody(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 2 || value.length > 8_388_608) {
    throw new TypeError(`${label} is invalid`);
  }
  const parsed = parseStrictJson(value, {
    maximumBytes: 8_388_608,
    maximumDepth: 128,
  });
  if (canonicalizeJson(parsed) !== value) {
    throw new TypeError(`${label} is not canonical JSON`);
  }
  return value;
}

function digest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Sha256Digest;
}

function safeText(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_TEXT.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function safeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function exactPublicText(
  value: unknown,
  maximumBytes: number,
  label: string,
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || UNSAFE_PUBLIC_TEXT.test(value)
  ) throw new TypeError(`${label} is invalid`);
  return value;
}

function displayPublicText(
  value: unknown,
  maximumBytes: number,
  label: string,
): string {
  if (
    typeof value !== "string"
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || UNSAFE_PUBLIC_TEXT.test(value)
  ) throw new TypeError(`${label} is invalid`);
  return value;
}

function validatedStringArray(value: JsonValue | undefined, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    throw new TypeError(`${label} are invalid`);
  }
  const normalized = value.map((entry) => safeText(entry, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${label} are duplicated`);
  }
  return Object.freeze(normalized);
}

function validatedOptionalStringArray(
  value: JsonValue | undefined,
  label: string,
  maximumLength: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw new TypeError(`${label} values are invalid`);
  }
  const normalized = value.map((entry) => exactPublicText(entry, 256, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${label} values are duplicated`);
  }
  return Object.freeze(normalized);
}

function stringField(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  return value;
}

function canonicalInstant(value: unknown, label: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  const milliseconds = date.getTime();
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${label} is invalid`);
  const canonical = new Date(milliseconds).toISOString();
  if (typeof value === "string" && value !== canonical) {
    throw new TypeError(`${label} is invalid`);
  }
  return canonical;
}

function databaseInstant(value: string | Date): string {
  return canonicalInstant(value, "database instant");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
