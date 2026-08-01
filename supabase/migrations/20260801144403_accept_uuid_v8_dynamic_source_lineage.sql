-- Projector-owned deterministic identifiers use RFC 9562 UUID version 8.
-- The provisional-lineage writer previously admitted only versions 1-5 even
-- though every identifier is otherwise a valid PostgreSQL UUID. Keep the
-- existing audited function body and widen only its four version checks.
set role programmable_migrator;

do $migration$
declare
  function_signature constant text :=
    'programmable_private.stage_verified_dynamic_parents_v2(' ||
    'uuid,uuid,text,text,text,text,uuid,bigint,bigint,bigint,bytea,' ||
    'uuid,text,uuid,uuid,uuid,uuid,numeric,bytea,bytea,bytea[],bytea[],' ||
    'jsonb,bytea,jsonb,jsonb,timestamp with time zone)';
  function_oid regprocedure;
  original_definition text;
  updated_definition text;
begin
  function_oid := pg_catalog.to_regprocedure(function_signature);
  if function_oid is null then
    raise exception using
      errcode = '42704',
      message = 'dynamic parent staging function is missing';
  end if;

  original_definition := pg_catalog.pg_get_functiondef(function_oid);
  updated_definition := pg_catalog.replace(
    original_definition,
    '[1-5][0-9a-f]{3}',
    '[1-58][0-9a-f]{3}'
  );
  if updated_definition = original_definition then
    raise exception using
      errcode = '55000',
      message = 'dynamic parent UUID validation shape changed';
  end if;

  execute updated_definition;
end
$migration$;

-- A verified activation can be staged one ingestion generation before its
-- release projection materializes the permanent attestation. Expose only the
-- activation boundary attached to a still-current provisional lineage so the
-- next ingestion page can authenticate reward-vault events after the launch
-- log without trusting an address alone.
create function programmable_private.get_current_provisional_activation_boundaries_v1(
  p_projector_version text
)
returns table (
  provisional_lineage_id uuid,
  dynamic_source_attestation_id uuid,
  deployed_source_address bytea,
  activation_candidate_id text,
  activation_occurrence_id uuid,
  activation_block_number bigint,
  activation_block_hash bytea,
  activation_block_global_log_index bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_projector_version is null then
    raise exception using
      errcode = '22023', message = 'invalid projector version';
  end if;

  return query
  select current_source.provisional_lineage_id,
    activation.dynamic_source_attestation_id,
    activation.source_address::bytea,
    activation.launch_candidate_id::text,
    activation.launch_occurrence_id,
    activation.launch_block_number::bigint,
    activation.launch_block_hash::bytea,
    activation.launch_block_global_log_index::bigint
  from programmable_private.get_current_provisional_dynamic_sources_v1(
    p_projector_version
  ) as current_source
  join programmable_private.dynamic_source_activation_staging as activation
    on activation.provisional_lineage_id =
      current_source.provisional_lineage_id
   and activation.provisional_page_id = current_source.provisional_page_id
   and activation.dynamic_source_attestation_id =
      current_source.dynamic_source_attestation_id
   and activation.dynamic_source_template_id =
      current_source.dynamic_source_template_id
   and activation.runtime_code_evidence_id =
      current_source.runtime_code_evidence_id
   and activation.source_address =
      current_source.deployed_source_address
   and activation.projector_version = p_projector_version
   and activation.reorg_generation = current_source.reorg_generation
  where not exists (
    select 1
    from programmable_private.dynamic_source_activation_consumptions
      as consumed
    where consumed.activation_id = activation.activation_id
  )
  order by current_source.provisional_lineage_id;
end
$function$;

revoke all on function
  programmable_private.get_current_provisional_activation_boundaries_v1(text)
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler,
  programmable_api_reader, programmable_profile_binder,
  programmable_profile_recovery, programmable_profile_writer,
  programmable_maintenance, programmable_operator;

grant execute on function
  programmable_private.get_current_provisional_activation_boundaries_v1(text)
to programmable_projector;

-- Supabase restores private tables under the database owner. Keep this
-- SECURITY DEFINER reader owned by the same role so it can read the two
-- private staging tables without granting table access to the projector.
reset role;

do $migration$
declare
  table_owner name;
begin
  select pg_catalog.pg_get_userbyid(table_class.relowner)
  into table_owner
  from pg_catalog.pg_class as table_class
  join pg_catalog.pg_namespace as table_namespace
    on table_namespace.oid = table_class.relnamespace
  where table_namespace.nspname = 'programmable_private'
    and table_class.relname = 'dynamic_source_activation_staging'
    and table_class.relkind in ('r', 'p');

  if table_owner is null then
    raise exception using
      errcode = '42704',
      message = 'dynamic source activation staging table is missing';
  end if;

  execute pg_catalog.format(
    'alter function programmable_private.' ||
    'get_current_provisional_activation_boundaries_v1(text) owner to %I',
    table_owner
  );
end
$migration$;

set role programmable_migrator;

comment on function programmable_private.stage_verified_dynamic_parents_v2(
  uuid, uuid, text, text, text, text, uuid, bigint, bigint, bigint, bytea,
  uuid, text, uuid, uuid, uuid, uuid, numeric, bytea, bytea, bytea[], bytea[],
  jsonb, bytea, jsonb, jsonb, timestamptz
) is
  'Stages dual-RPC verified dynamic parents; accepts deterministic RFC 9562 UUIDv8 lineage identifiers.';

-- Multi-array unnest is FROM-clause syntax, not a two-argument function in
-- pg_catalog. Removing the schema qualification keeps the arrays zipped by
-- ordinal while remaining inside the function's empty search_path.
do $migration$
declare
  function_signature constant text :=
    'programmable_private.stage_provisional_parent_receipt_ordinals_v1(' ||
    'uuid,uuid,text[],numeric[],timestamp with time zone)';
  function_oid regprocedure;
  original_definition text;
  updated_definition text;
begin
  function_oid := pg_catalog.to_regprocedure(function_signature);
  if function_oid is null then
    raise exception using
      errcode = '42704',
      message = 'provisional receipt ordinal function is missing';
  end if;

  original_definition := pg_catalog.pg_get_functiondef(function_oid);
  updated_definition := pg_catalog.replace(
    original_definition,
    'pg_catalog.unnest(p_candidate_ids, p_receipt_log_ordinals)',
    'unnest(p_candidate_ids, p_receipt_log_ordinals)'
  );
  if updated_definition = original_definition then
    raise exception using
      errcode = '55000',
      message = 'provisional receipt ordinal function shape changed';
  end if;

  execute updated_definition;
end
$migration$;

-- Keep a staged lineage readable after the raw-ingestion cursor advances past
-- its factory page. The activation itself is already dual-RPC verified and is
-- invalidated by any projector reorg generation change; requiring the old
-- cursor generation made the lineage disappear immediately after commit.
do $migration$
declare
  function_signature constant text :=
    'programmable_private.get_current_provisional_dynamic_sources_v1(text)';
  function_oid regprocedure;
  original_definition text;
  updated_definition text;
  needle constant text :=
    '   and cursor.generation = page.expected_cursor_generation' ||
    pg_catalog.chr(10) ||
    '   and cursor.block_hash = page.expected_cursor_block_hash';
  replacement constant text :=
    '   and (' || pg_catalog.chr(10) ||
    '     (cursor.generation = page.expected_cursor_generation' ||
    pg_catalog.chr(10) ||
    '      and cursor.block_hash = page.expected_cursor_block_hash)' ||
    pg_catalog.chr(10) ||
    '     or (' || pg_catalog.chr(10) ||
    '       cursor.generation > page.expected_cursor_generation' ||
    pg_catalog.chr(10) ||
    '       and (' || pg_catalog.chr(10) ||
    '         cursor.block_number < page.snapshot_block_number' ||
    pg_catalog.chr(10) ||
    '         or exists (' || pg_catalog.chr(10) ||
    '         select 1' || pg_catalog.chr(10) ||
    '         from programmable_private.dynamic_source_activation_staging' ||
    pg_catalog.chr(10) ||
    '           as activation' || pg_catalog.chr(10) ||
    '         where activation.provisional_page_id =' ||
    pg_catalog.chr(10) ||
    '           page.provisional_page_id' || pg_catalog.chr(10) ||
    '           and activation.provisional_lineage_id =' ||
    pg_catalog.chr(10) ||
    '             lineage.provisional_lineage_id' || pg_catalog.chr(10) ||
    '           and activation.reorg_generation = page.reorg_generation' ||
    pg_catalog.chr(10) ||
    '           and (' || pg_catalog.chr(10) ||
    '             cursor.block_number > activation.launch_block_number' ||
    pg_catalog.chr(10) ||
    '             or (' || pg_catalog.chr(10) ||
    '               cursor.block_number = activation.launch_block_number' ||
    pg_catalog.chr(10) ||
    '               and cursor.block_hash = activation.launch_block_hash' ||
    pg_catalog.chr(10) ||
    '               and cursor.block_global_log_index >=' ||
    pg_catalog.chr(10) ||
    '                 activation.launch_block_global_log_index' ||
    pg_catalog.chr(10) ||
    '             )' || pg_catalog.chr(10) ||
    '           )' || pg_catalog.chr(10) ||
    '           and not exists (' || pg_catalog.chr(10) ||
    '             select 1' || pg_catalog.chr(10) ||
    '             from programmable_private.' ||
    'dynamic_source_activation_consumptions as consumed_activation' ||
    pg_catalog.chr(10) ||
    '             where consumed_activation.activation_id =' ||
    pg_catalog.chr(10) ||
    '               activation.activation_id' || pg_catalog.chr(10) ||
    '           )' || pg_catalog.chr(10) ||
    '         )' || pg_catalog.chr(10) ||
    '       )' || pg_catalog.chr(10) ||
    '     )' || pg_catalog.chr(10) ||
    '   )';
begin
  function_oid := pg_catalog.to_regprocedure(function_signature);
  if function_oid is null then
    raise exception using
      errcode = '42704',
      message = 'current provisional source reader is missing';
  end if;

  original_definition := pg_catalog.pg_get_functiondef(function_oid);
  updated_definition := pg_catalog.replace(
    original_definition, needle, replacement
  );
  if updated_definition = original_definition then
    raise exception using
      errcode = '55000',
      message = 'current provisional source cursor shape changed';
  end if;

  execute updated_definition;
end
$migration$;

-- Resolution is fenced by the current ingestion cursor, while an individual
-- provisional page may have been verified under an earlier cursor generation
-- for a still-future block.
do $migration$
declare
  function_signature constant text :=
    'programmable_private.resolve_pending_dynamic_source_activations_v1(' ||
    'text,bigint,bytea,bigint)';
  function_oid regprocedure;
  original_definition text;
  updated_definition text;
  needle constant text :=
    '  join programmable_private.provisional_dynamic_parent_pages as page' ||
    pg_catalog.chr(10) ||
    '    on page.provisional_page_id = source.provisional_page_id' ||
    pg_catalog.chr(10) ||
    '   and page.expected_cursor_generation = p_expected_cursor_generation' ||
    pg_catalog.chr(10) ||
    '   and page.expected_cursor_block_hash = p_expected_cursor_block_hash' ||
    pg_catalog.chr(10) ||
    '   and page.reorg_generation = p_expected_reorg_generation';
  replacement constant text :=
    '  join programmable_private.provisional_dynamic_parent_pages as page' ||
    pg_catalog.chr(10) ||
    '    on page.provisional_page_id = source.provisional_page_id' ||
    pg_catalog.chr(10) ||
    '   and page.reorg_generation = p_expected_reorg_generation' ||
    pg_catalog.chr(10) ||
    '  join programmable_private.envio_ingestion_cursor_current as cursor' ||
    pg_catalog.chr(10) ||
    '    on cursor.chain_id = page.chain_id' || pg_catalog.chr(10) ||
    '   and cursor.provider_deployment_id =' || pg_catalog.chr(10) ||
    '     page.envio_provider_deployment_id' || pg_catalog.chr(10) ||
    '   and cursor.stream_id = page.stream_id' || pg_catalog.chr(10) ||
    '   and cursor.generation = p_expected_cursor_generation' ||
    pg_catalog.chr(10) ||
    '   and cursor.block_hash = p_expected_cursor_block_hash';
begin
  function_oid := pg_catalog.to_regprocedure(function_signature);
  if function_oid is null then
    raise exception using
      errcode = '42704',
      message = 'pending dynamic activation resolver is missing';
  end if;
  original_definition := pg_catalog.pg_get_functiondef(function_oid);
  updated_definition := pg_catalog.replace(
    original_definition, needle, replacement
  );
  if updated_definition = original_definition then
    raise exception using
      errcode = '55000',
      message = 'pending dynamic activation resolver shape changed';
  end if;
  execute updated_definition;
end
$migration$;

-- The activation writer independently rechecks the current cursor and only
-- admits an older page fence while its verified parent block is still ahead.
do $migration$
declare
  function_signature constant text :=
    'programmable_private.stage_verified_dynamic_source_activations_v1(' ||
    'uuid,text,uuid,bigint,bigint,bigint,bytea,uuid,uuid,uuid,uuid,uuid,' ||
    'jsonb,jsonb,timestamp with time zone)';
  function_oid regprocedure;
  original_definition text;
  updated_definition text;
  needle constant text :=
    '        and page.reorg_generation = p_reorg_generation' ||
    pg_catalog.chr(10) ||
    '        and page.expected_cursor_generation = p_expected_cursor_generation' ||
    pg_catalog.chr(10) ||
    '        and page.expected_cursor_block_hash = p_expected_cursor_block_hash';
  replacement constant text :=
    '        and page.reorg_generation = p_reorg_generation' ||
    pg_catalog.chr(10) ||
    '        and (' || pg_catalog.chr(10) ||
    '          (' || pg_catalog.chr(10) ||
    '            page.expected_cursor_generation =' || pg_catalog.chr(10) ||
    '              p_expected_cursor_generation' || pg_catalog.chr(10) ||
    '            and page.expected_cursor_block_hash =' ||
    pg_catalog.chr(10) ||
    '              p_expected_cursor_block_hash' || pg_catalog.chr(10) ||
    '          )' || pg_catalog.chr(10) ||
    '          or (' || pg_catalog.chr(10) ||
    '            page.expected_cursor_generation <' || pg_catalog.chr(10) ||
    '              p_expected_cursor_generation' || pg_catalog.chr(10) ||
    '            and cursor.block_number < page.snapshot_block_number' ||
    pg_catalog.chr(10) ||
    '          )' || pg_catalog.chr(10) ||
    '        )';
begin
  function_oid := pg_catalog.to_regprocedure(function_signature);
  if function_oid is null then
    raise exception using
      errcode = '42704',
      message = 'dynamic activation staging function is missing';
  end if;
  original_definition := pg_catalog.pg_get_functiondef(function_oid);
  updated_definition := pg_catalog.replace(
    original_definition, needle, replacement
  );
  if updated_definition = original_definition then
    raise exception using
      errcode = '55000',
      message = 'dynamic activation page fence shape changed';
  end if;
  execute updated_definition;
end
$migration$;

-- Activation evidence uses the same endpoint-bound provider identity as every
-- projection trace. Static database labels remain control-plane identifiers,
-- not persisted proof identities.
do $migration$
declare
  function_signature constant text :=
    'programmable_private.stage_verified_dynamic_source_activations_v1(' ||
    'uuid,text,uuid,bigint,bigint,bigint,bytea,uuid,uuid,uuid,uuid,uuid,' ||
    'jsonb,jsonb,timestamp with time zone)';
  function_oid regprocedure;
  original_definition text;
  updated_definition text;
  needle constant text :=
    'select deployment.redacted_identity::text as identity,';
  replacement constant text :=
    'select metadata.vendor || ''-mainnet-'' ||' ||
    pg_catalog.chr(10) ||
    '    pg_catalog.substring(' || pg_catalog.chr(10) ||
    '      pg_catalog.encode(deployment.deployment_commitment, ''hex''),' ||
    pg_catalog.chr(10) ||
    '      1, 32' || pg_catalog.chr(10) ||
    '    ) as identity,';
begin
  function_oid := pg_catalog.to_regprocedure(function_signature);
  if function_oid is null then
    raise exception using
      errcode = '42704',
      message = 'dynamic activation staging function is missing';
  end if;
  original_definition := pg_catalog.pg_get_functiondef(function_oid);
  updated_definition := pg_catalog.replace(
    original_definition, needle, replacement
  );
  if updated_definition = original_definition
     or pg_catalog.strpos(updated_definition, needle) > 0
  then
    raise exception using
      errcode = '55000',
      message = 'dynamic activation provider identity shape changed';
  end if;
  execute updated_definition;
end
$migration$;

reset role;
