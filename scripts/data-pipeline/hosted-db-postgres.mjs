import { readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

import {
  compareMigrationHistory,
  sha256,
  validateDirectSupabaseTarget,
} from "./hosted-db-operator-core.mjs";
import { validateReviewedBootstrapPlan } from "./bootstrap-evidence.mjs";

const hostedDatabaseSessions = new WeakMap();

const HISTORY_DDL = `
set lock_timeout = '4s';
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key
);
alter table supabase_migrations.schema_migrations
  add column if not exists statements text[];
alter table supabase_migrations.schema_migrations
  add column if not exists name text;
create table if not exists supabase_migrations.programmable_migration_evidence (
  version text primary key
    references supabase_migrations.schema_migrations(version) on delete restrict,
  name text not null,
  file_name text not null unique,
  ordinal integer not null unique check (ordinal > 0),
  file_sha256 text not null
    check (file_sha256 ~ '^0x[0-9a-f]{64}$'),
  plan_sha256 text not null
    check (plan_sha256 ~ '^0x[0-9a-f]{64}$'),
  repository_commit text not null
    check (repository_commit ~ '^[0-9a-f]{40}$'),
  applied_at timestamptz not null default pg_catalog.clock_timestamp()
);
revoke all on schema supabase_migrations from public;
revoke all on table supabase_migrations.schema_migrations from public;
revoke all on table supabase_migrations.programmable_migration_evidence from public;
reset lock_timeout;
`;

function sslConfiguration(caPem) {
  if (
    typeof caPem !== "string" ||
    caPem.length < 64 ||
    caPem.length > 32_768 ||
    !caPem.includes("-----BEGIN CERTIFICATE-----") ||
    !caPem.includes("-----END CERTIFICATE-----")
  ) {
    throw new Error("a valid server-only Postgres CA certificate is required");
  }
  return { rejectUnauthorized: true, ca: caPem };
}

function capturedSession(row) {
  const backendPid = Number(row?.backend_pid);
  if (
    !Number.isSafeInteger(backendPid) ||
    backendPid <= 0 ||
    typeof row?.session_user !== "string" ||
    row.session_user.length === 0 ||
    typeof row?.current_role !== "string" ||
    row.current_role.length === 0
  ) {
    throw new Error("database session identity is invalid");
  }
  return Object.freeze({
    backendPid,
    sessionUser: row.session_user,
    currentRole: row.current_role,
  });
}

function assertExactSession(row, expected) {
  const actual = capturedSession(row);
  if (
    actual.backendPid !== expected.backendPid ||
    actual.sessionUser !== expected.sessionUser ||
    actual.currentRole !== expected.currentRole
  ) {
    throw new Error("hosted database session changed unexpectedly");
  }
  return actual;
}

async function assertHostedSession(sql, expected) {
  const [identity] = await sql.unsafe(`
    select pg_catalog.pg_backend_pid() as backend_pid,
           session_user::text as session_user,
           current_role::text as current_role
  `);
  return assertExactSession(identity, expected);
}

export async function openHostedDatabase(
  { databaseUrl, expectedProjectRef, sslCaPem },
  { postgresFactory = postgres } = {},
) {
  const target = validateDirectSupabaseTarget(databaseUrl, expectedProjectRef);
  const connectionUrl = new URL(databaseUrl);
  const sql = postgresFactory({
    host: connectionUrl.hostname,
    port: Number(connectionUrl.port),
    database: connectionUrl.pathname.slice(1),
    username: decodeURIComponent(connectionUrl.username),
    password: decodeURIComponent(connectionUrl.password),
    ssl: sslConfiguration(sslCaPem),
    max: 1,
    prepare: false,
    connect_timeout: 8,
    idle_timeout: 0,
    max_lifetime: null,
    onnotice: () => {},
    connection: {
      application_name: "programmable-hosted-db-operator",
    },
  });
  try {
    const [identity] = await sql.unsafe(`
      select
        pg_catalog.pg_backend_pid() as backend_pid,
        session_user::text as session_user,
        current_user::text as current_user,
        current_role::text as current_role,
        pg_catalog.current_database() as database_name,
        pg_catalog.inet_server_port() as server_port,
        pg_catalog.current_setting('server_version_num') as server_version_num,
        pg_catalog.pg_has_role(
          session_user, 'postgres', 'member'
        ) as is_postgres_member
    `);
    const username = decodeURIComponent(connectionUrl.username);
    if (
      identity?.session_user !== username ||
      identity?.current_user !== username ||
      identity?.current_role !== username ||
      identity?.database_name !== "postgres" ||
      Number(identity?.server_port) !== 5432 ||
      Number(identity?.server_version_num) < 150000 ||
      (username === "cli_login_postgres" &&
        identity?.is_postgres_member !== true)
    ) {
      throw new Error("connected database identity is not an approved target");
    }
    if (username === "cli_login_postgres") {
      await sql.unsafe("set role postgres").simple();
    }
    const [effectiveIdentity] = await sql.unsafe(`
      select pg_catalog.pg_backend_pid() as backend_pid,
             session_user::text as session_user,
             current_user::text as current_user,
             current_role::text as current_role
    `);
    if (
      Number(effectiveIdentity?.backend_pid) !== Number(identity?.backend_pid) ||
      effectiveIdentity?.session_user !== username ||
      effectiveIdentity?.current_user !== "postgres" ||
      effectiveIdentity?.current_role !== "postgres"
    ) {
      throw new Error("database effective role is not postgres");
    }
    const sessionIdentity = capturedSession(effectiveIdentity);
    hostedDatabaseSessions.set(sql, sessionIdentity);
    return Object.freeze({
      sql,
      target,
      sessionIdentity,
      operatorIdentity: Object.freeze({
        mode:
          username === "postgres"
            ? "database-owner"
            : "supabase-cli-jit-set-role",
        sessionUser: username,
        effectiveRole: "postgres",
      }),
    });
  } catch (error) {
    await sql.end({ timeout: 1 }).catch(() => {});
    throw error;
  }
}

export async function readRemoteMigrationState(sql) {
  const [tables] = await sql.unsafe(`
    select
      pg_catalog.to_regclass('supabase_migrations.schema_migrations')::text
        as history_table,
      pg_catalog.to_regclass(
        'supabase_migrations.programmable_migration_evidence'
      )::text as evidence_table
  `);
  const historyPresent =
    tables?.history_table === "supabase_migrations.schema_migrations";
  const evidenceTablePresent =
    tables?.evidence_table ===
    "supabase_migrations.programmable_migration_evidence";
  const historyRows = historyPresent
    ? await sql.unsafe(`
        select version, coalesce(name, '') as name, statements
        from supabase_migrations.schema_migrations
        order by version
      `)
    : [];
  const evidenceRows = evidenceTablePresent
    ? await sql.unsafe(`
        select version, name, file_name, ordinal, file_sha256,
               plan_sha256, repository_commit
        from supabase_migrations.programmable_migration_evidence
        order by ordinal
      `)
    : [];
  return { historyRows, evidenceRows, evidenceTablePresent };
}

export async function inspectMigrationState({ sql, plan }) {
  const remote = await readRemoteMigrationState(sql);
  return compareMigrationHistory({ plan, ...remote });
}

async function ensureMigrationHistory(sql, expectedSession) {
  await sql.begin(async (transaction) => {
    await assertHostedSession(transaction, expectedSession);
    await transaction.unsafe(HISTORY_DDL).simple();
    await assertHostedSession(transaction, expectedSession);
  });
  await assertHostedSession(sql, expectedSession);
}

async function applyMigration({
  sql,
  workspace,
  plan,
  migration,
  expectedSession,
}) {
  const absolutePath = path.resolve(workspace, migration.file);
  const contents = await readFile(absolutePath);
  if (
    contents.byteLength !== migration.bytes ||
    sha256(contents) !== migration.fileSha256
  ) {
    throw new Error(`migration file changed after planning: ${migration.version}`);
  }
  const migrationSql = contents.toString("utf8");
  await assertHostedSession(sql, expectedSession);
  await sql.unsafe("reset all; set role postgres").simple();
  await assertHostedSession(sql, expectedSession);
  await sql.begin(async (transaction) => {
    await assertHostedSession(transaction, expectedSession);
    await transaction
      .unsafe("set local lock_timeout = '4s'; set local statement_timeout = '15min'")
      .simple();
    await transaction.unsafe(migrationSql).simple();
    const [postMigrationIdentity] = await transaction.unsafe(`
      select pg_catalog.pg_backend_pid() as backend_pid,
             session_user::text as session_user,
             current_role::text as current_role
    `);
    const postMigrationSession = capturedSession(postMigrationIdentity);
    if (
      postMigrationSession.backendPid !== expectedSession.backendPid ||
      postMigrationSession.sessionUser !== expectedSession.sessionUser ||
      ![expectedSession.currentRole, expectedSession.sessionUser].includes(
        postMigrationSession.currentRole,
      )
    ) {
      throw new Error("hosted database session changed unexpectedly");
    }
    if (postMigrationSession.currentRole !== expectedSession.currentRole) {
      await transaction.unsafe("set role postgres").simple();
      await assertHostedSession(transaction, expectedSession);
    }
    await transaction`
      insert into supabase_migrations.schema_migrations (
        version, name, statements
      ) values (
        ${migration.version},
        ${migration.name},
        ${transaction.array([migrationSql])}
      )
    `;
    await transaction`
      insert into supabase_migrations.programmable_migration_evidence (
        version, name, file_name, ordinal, file_sha256,
        plan_sha256, repository_commit
      ) values (
        ${migration.version},
        ${migration.name},
        ${path.posix.basename(migration.file)},
        ${migration.ordinal},
        ${migration.fileSha256},
        ${plan.planSha256},
        ${plan.repositoryCommit}
      )
    `;
  });
  await assertHostedSession(sql, expectedSession);
}

export async function applyPendingMigrations({
  sql,
  workspace,
  plan,
  sessionIdentity,
}) {
  const expectedSession = hostedDatabaseSessions.get(sql) ??
    capturedSession({
      backend_pid: sessionIdentity?.backendPid,
      session_user: sessionIdentity?.sessionUser,
      current_role: sessionIdentity?.currentRole,
    });
  const [lock] = await sql.unsafe(`
    select
      pg_catalog.pg_try_advisory_lock(
        pg_catalog.hashtextextended(
          'programmable:hosted-db-migrations:v1', 0
        )
      ) as acquired,
      pg_catalog.pg_backend_pid() as backend_pid,
      session_user::text as session_user,
      current_role::text as current_role
  `);
  assertExactSession(lock, expectedSession);
  if (lock?.acquired !== true) {
    throw new Error("another migration operator holds the database lock");
  }
  try {
    const before = await readRemoteMigrationState(sql);
    const initial = compareMigrationHistory({ plan, ...before });
    if (initial.pending.length === 0) {
      await assertHostedSession(sql, expectedSession);
      return { ...initial, appliedThisRun: [] };
    }
    const appliedThisRun = initial.pending.map(({ version }) => version);
    await ensureMigrationHistory(sql, expectedSession);
    for (const pending of initial.pending) {
      const migration = plan.migrations.find(
        ({ version }) => version === pending.version,
      );
      if (!migration) {
        throw new Error("pending migration is absent from the plan");
      }
      await applyMigration({
        sql,
        workspace,
        plan,
        migration,
        expectedSession,
      });
    }
    await assertHostedSession(sql, expectedSession);
    return {
      ...(await inspectMigrationState({ sql, plan })),
      appliedThisRun,
    };
  } finally {
    const [unlock] = await sql.unsafe(
      `
        select pg_catalog.pg_backend_pid() as backend_pid,
               session_user::text as session_user,
               current_role::text as current_role,
               case
                 when pg_catalog.pg_backend_pid() = $1
                  and session_user::text = $2
                  and current_role::text = $3
                 then pg_catalog.pg_advisory_unlock(
                   pg_catalog.hashtextextended(
                     'programmable:hosted-db-migrations:v1', 0
                   )
                 )
                 else false
               end as released
      `,
      [
        expectedSession.backendPid,
        expectedSession.sessionUser,
        expectedSession.currentRole,
      ],
    );
    assertExactSession(unlock, expectedSession);
    if (unlock?.released !== true) {
      throw new Error("hosted database migration lock was not released");
    }
  }
}

export async function closeHostedDatabase(sql) {
  hostedDatabaseSessions.delete(sql);
  await sql.end({ timeout: 5 });
}

function databaseBytes(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/u.test(value)) {
    throw new Error("bootstrap hexadecimal input is invalid");
  }
  return Buffer.from(value.slice(2), "hex");
}

function rowHex(value) {
  if (!Buffer.isBuffer(value)) throw new Error("bootstrap database bytes are invalid");
  return `0x${value.toString("hex")}`;
}

async function bootstrapFootprint(transaction) {
  const [row] = await transaction.unsafe(`
    select
      (select pg_catalog.count(*)::text
       from programmable_private.provider_deployments) as provider_count,
      (select pg_catalog.count(*)::text
       from programmable_private.release_epochs
       where release_id <> 'envio-control') as epoch_count,
      (select pg_catalog.count(*)::text
       from programmable_private.release_epoch_current
       where release_id <> 'envio-control') as pointer_count,
      (select pg_catalog.count(*)::text
       from programmable_private.candidate_database_control) as control_count
  `);
  return Object.freeze({
    providers: Number(row?.provider_count),
    epochs: Number(row?.epoch_count),
    pointers: Number(row?.pointer_count),
    controls: Number(row?.control_count),
  });
}

async function assertBootstrapMatches(transaction, plan) {
  const providerRows = await transaction.unsafe(`
    select provider_deployment_id::text, provider_type::text,
           redacted_identity::text, deployment_commitment,
           schema_commitment, created_at::text
    from programmable_private.provider_deployments
    order by provider_deployment_id
  `);
  const expectedProviders = [...plan.providerBindings]
    .map((provider) => ({
      provider_deployment_id: provider.providerDeploymentId,
      provider_type: provider.providerType,
      redacted_identity: provider.redactedIdentity,
      deployment_commitment: provider.deploymentCommitment,
      schema_commitment: provider.schemaCommitment,
      created_at: provider.createdAt.replace("T", " ").replace("Z", "+00"),
    }))
    .sort((left, right) =>
      left.provider_deployment_id.localeCompare(right.provider_deployment_id),
    );
  if (
    providerRows.length !== expectedProviders.length ||
    providerRows.some((row, index) => {
      const expected = expectedProviders[index];
      return !expected ||
        row.provider_deployment_id !== expected.provider_deployment_id ||
        row.provider_type !== expected.provider_type ||
        row.redacted_identity !== expected.redacted_identity ||
        rowHex(row.deployment_commitment) !== expected.deployment_commitment ||
        rowHex(row.schema_commitment) !== expected.schema_commitment ||
        Date.parse(row.created_at) !== Date.parse(expected.created_at);
    })
  ) {
    throw new Error("bootstrap provider state does not match the reviewed plan");
  }
  const [control] = await transaction.unsafe(`
    select database_mode::text, envio_provider_deployment_id::text,
           envio_deployment_commitment, envio_schema_commitment,
           initialization_input_commitment, initialized_at::text,
           promoted_at
    from programmable_private.candidate_database_control
    where singleton
  `);
  const candidate = plan.providerBindings.find(
    ({ providerType }) => providerType === "envio_deployment",
  );
  if (
    !candidate || !control || control.database_mode !== "candidate-only" ||
    control.envio_provider_deployment_id !== candidate.providerDeploymentId ||
    rowHex(control.envio_deployment_commitment) !== candidate.deploymentCommitment ||
    rowHex(control.envio_schema_commitment) !== candidate.schemaCommitment ||
    rowHex(control.initialization_input_commitment) !==
      plan.candidateIsolation.candidateInitializationInputCommitment ||
    Date.parse(control.initialized_at) !== Date.parse(plan.createdAt) ||
    control.promoted_at !== null
  ) {
    throw new Error("candidate database control does not match the reviewed plan");
  }
  const epochRows = await transaction.unsafe(`
    select epoch.epoch_id::text, epoch.chain_id::text,
           epoch.release_id::text, epoch.model_id::text,
           epoch.source_group::text, epoch.epoch_number::text,
           epoch.epoch_commitment, epoch.artifact_creation_code_commitment,
           current_epoch.generation::text
    from programmable_private.release_epochs as epoch
    join programmable_private.release_epoch_current as current_epoch
      on current_epoch.epoch_id = epoch.epoch_id
    where epoch.release_id <> 'envio-control'
    order by epoch.release_id
  `);
  const expectedEpochs = [...plan.releases].sort((left, right) =>
    left.scope.releaseId.localeCompare(right.scope.releaseId),
  );
  if (
    epochRows.length !== expectedEpochs.length ||
    epochRows.some((row, index) => {
      const expected = expectedEpochs[index];
      return !expected || row.epoch_id !== expected.epochId ||
        row.chain_id !== String(expected.scope.chainId) ||
        row.release_id !== expected.scope.releaseId ||
        row.model_id !== expected.scope.modelId ||
        row.source_group !== expected.scope.sourceGroup ||
        row.epoch_number !== expected.epochNumber || row.generation !== "1" ||
        rowHex(row.epoch_commitment) !== expected.epochCommitment ||
        rowHex(row.artifact_creation_code_commitment) !==
          expected.artifactCreationCodeCommitment;
    })
  ) {
    throw new Error("bootstrap release epochs do not match the reviewed plan");
  }
  for (const release of plan.releases) {
    const [counts] = await transaction`
      select
        (select pg_catalog.count(*)::text
         from programmable_private.release_source_bindings
         where epoch_id = ${release.epochId}::uuid) as source_count,
        (select pg_catalog.count(*)::text
         from programmable_private.release_dynamic_source_templates
         where epoch_id = ${release.epochId}::uuid) as template_count,
        (select pg_catalog.count(*)::text
         from programmable_private.release_projection_event_rules
         where epoch_id = ${release.epochId}::uuid) as rule_count,
        (select pg_catalog.count(*)::text
         from programmable_private.release_launch_completeness_requirements
         where epoch_id = ${release.epochId}::uuid) as requirement_count
    `;
    if (
      Number(counts?.source_count) !== release.sourceBindings.length ||
      Number(counts?.template_count) !== release.dynamicSourceTemplates.length ||
      Number(counts?.rule_count) !== release.projectionEventRules.length ||
      Number(counts?.requirement_count) !==
        release.launchCompletenessRequirements.length
    ) {
      throw new Error("bootstrap release child counts do not match the reviewed plan");
    }
  }
}

async function registerBootstrapProvider(transaction, provider) {
  if (provider.providerType === "rpc_provider") {
    await transaction`
      select programmable_private.register_rpc_provider_deployment(
        ${provider.providerDeploymentId}::uuid,
        ${provider.chainId}::bigint,
        ${provider.vendor}::text,
        ${provider.constructorVersion}::text,
        ${databaseBytes(provider.endpointUrlCommitment)}::bytea,
        ${databaseBytes(provider.endpointOriginCommitment)}::bytea,
        ${provider.endpointEvidenceDomain}::text,
        ${databaseBytes(provider.endpointEvidenceCommitment)}::bytea,
        ${databaseBytes(provider.deploymentCommitment)}::bytea,
        ${databaseBytes(provider.schemaCommitment)}::bytea,
        ${databaseBytes(provider.inputCommitment)}::bytea,
        ${provider.createdAt}::timestamptz
      )
    `;
    return;
  }
  await transaction`
    select programmable_private.register_provider_deployment(
      ${provider.providerDeploymentId}::uuid,
      ${provider.providerType}::text,
      ${provider.redactedIdentity}::text,
      ${databaseBytes(provider.deploymentCommitment)}::bytea,
      ${databaseBytes(provider.schemaCommitment)}::bytea,
      ${databaseBytes(provider.inputCommitment)}::bytea,
      ${provider.createdAt}::timestamptz
    )
  `;
}

async function applyReleaseBootstrap(transaction, release, createdAt) {
  await transaction`
    select programmable_private.create_release_epoch(
      ${release.epochId}::uuid,
      ${release.scope.chainId}::bigint,
      ${release.scope.releaseId}::text,
      ${release.scope.modelId}::text,
      ${release.scope.sourceGroup}::text,
      ${release.epochNumber}::bigint,
      ${databaseBytes(release.epochCommitment)}::bytea,
      ${databaseBytes(release.artifactCreationCodeCommitment)}::bytea,
      ${databaseBytes(release.createInputCommitment)}::bytea,
      ${createdAt}::timestamptz
    )
  `;
  for (const source of release.sourceBindings) {
    await transaction`
      select programmable_private.append_release_source_binding(
        ${source.bindingId}::uuid,
        ${release.epochId}::uuid,
        ${source.sourceName}::text,
        ${source.sourceRole}::text,
        ${source.sourceType}::text,
        ${databaseBytes(source.sourceAddress)}::bytea,
        ${source.recoverySelector === null
          ? null
          : databaseBytes(source.recoverySelector)}::bytea,
        ${source.inclusiveStartBlock}::numeric,
        ${databaseBytes(source.abiEventSetCommitment)}::bytea,
        ${databaseBytes(source.artifactCreationCodeCommitment)}::bytea,
        ${databaseBytes(source.bindingCommitment)}::bytea,
        ${databaseBytes(source.inputCommitment)}::bytea,
        ${createdAt}::timestamptz
      )
    `;
  }
  for (const template of release.dynamicSourceTemplates) {
    await transaction`
      select programmable_private.append_release_dynamic_source_template(
        ${template.dynamicSourceTemplateId}::uuid,
        ${release.epochId}::uuid,
        ${template.parentFactoryReleaseBindingId}::uuid,
        ${template.parentSourceRole}::text,
        ${template.factoryEventType}::text,
        ${template.deployedAddressField}::text,
        ${template.deployedSourceRole}::text,
        ${databaseBytes(template.deployedArtifactCreationCodeCommitment)}::bytea,
        ${databaseBytes(template.normalizedRuntimeCodeHash)}::bytea,
        ${databaseBytes(template.immutableReferencesCommitment)}::bytea,
        ${transaction.json(template.immutableBindingSpec)}::jsonb,
        ${databaseBytes(template.immutableBindingCommitment)}::bytea,
        ${template.runtimeCodeLength}::numeric,
        ${databaseBytes(template.abiEventSetCommitment)}::bytea,
        ${databaseBytes(template.templateCommitment)}::bytea,
        ${createdAt}::timestamptz
      )
    `;
  }
  for (const rule of release.projectionEventRules) {
    await transaction`
      select programmable_private.append_release_projection_event_rule(
        ${rule.projectionEventRuleId}::uuid,
        ${release.epochId}::uuid,
        ${rule.projectionKind}::text,
        ${rule.sourceRole}::text,
        ${rule.eventType}::text,
        ${databaseBytes(rule.ruleCommitment)}::bytea,
        ${createdAt}::timestamptz
      )
    `;
  }
  for (const requirement of release.launchCompletenessRequirements) {
    await transaction`
      select programmable_private.append_release_launch_requirement(
        ${requirement.launchRequirementId}::uuid,
        ${release.epochId}::uuid,
        ${requirement.requirementOrdinal}::integer,
        ${requirement.occurrenceRole}::text,
        ${requirement.eventType}::text,
        ${requirement.requiredWhen}::text,
        ${databaseBytes(requirement.requirementCommitment)}::bytea,
        ${createdAt}::timestamptz
      )
    `;
  }
  await transaction`
    select programmable_private.activate_release_epoch(
      ${release.scope.chainId}::bigint,
      ${release.scope.releaseId}::text,
      ${release.scope.modelId}::text,
      ${release.scope.sourceGroup}::text,
      ${release.epochId}::uuid,
      ${release.activation.expectedGeneration}::bigint,
      ${release.activation.nextGeneration}::bigint,
      ${databaseBytes(release.activation.inputCommitment)}::bytea,
      ${release.activation.changedAt}::timestamptz
    )
  `;
}

export async function inspectBootstrapState({ sql, plan }) {
  validateReviewedBootstrapPlan(plan);
  const footprint = await bootstrapFootprint(sql);
  if (
    footprint.providers === 0 && footprint.epochs === 0 &&
    footprint.pointers === 0 && footprint.controls === 0
  ) {
    return Object.freeze({ status: "empty", footprint });
  }
  await assertBootstrapMatches(sql, plan);
  return Object.freeze({ status: "current", footprint });
}

export async function applyReviewedBootstrap({ sql, plan }) {
  validateReviewedBootstrapPlan(plan);
  return sql.begin(async (transaction) => {
    await transaction.unsafe(
      "set local lock_timeout = '4s'; set local statement_timeout = '15min'",
    ).simple();
    const [lock] = await transaction.unsafe(`
      select pg_catalog.pg_try_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'programmable:candidate-db-bootstrap:v1', 0
        )
      ) as acquired
    `);
    if (lock?.acquired !== true) {
      throw new Error("another bootstrap operator holds the database lock");
    }
    const footprint = await bootstrapFootprint(transaction);
    const empty = footprint.providers === 0 && footprint.epochs === 0 &&
      footprint.pointers === 0 && footprint.controls === 0;
    if (!empty) {
      await assertBootstrapMatches(transaction, plan);
      return Object.freeze({ status: "current", changed: false, footprint });
    }
    await transaction.unsafe("set local role programmable_projector").simple();
    for (const provider of plan.providerBindings) {
      await registerBootstrapProvider(transaction, provider);
    }
    const candidate = plan.providerBindings.find(
      ({ providerType }) => providerType === "envio_deployment",
    );
    if (!candidate) throw new Error("candidate Envio provider is absent");
    await transaction`
      select programmable_private.initialize_candidate_database(
        ${candidate.providerDeploymentId}::uuid,
        ${databaseBytes(candidate.deploymentCommitment)}::bytea,
        ${databaseBytes(candidate.schemaCommitment)}::bytea,
        ${databaseBytes(
          plan.candidateIsolation.candidateInitializationInputCommitment,
        )}::bytea,
        ${plan.createdAt}::timestamptz
      )
    `;
    for (const release of plan.releases) {
      await applyReleaseBootstrap(transaction, release, plan.createdAt);
    }
    await transaction.unsafe("reset role").simple();
    await assertBootstrapMatches(transaction, plan);
    return Object.freeze({
      status: "current",
      changed: true,
      footprint: await bootstrapFootprint(transaction),
    });
  });
}
