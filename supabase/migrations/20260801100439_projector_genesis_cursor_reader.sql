-- The source projector registers a dual-RPC-attested predecessor block before
-- its first page. Until generation one exists, expose that immutable genesis
-- point as the generation-zero cursor. A completely uninitialized scope keeps
-- the all-NULL sentinel so the runtime cannot start without that evidence.
create or replace function programmable_private.get_envio_ingestion_cursor_v1(
  p_chain_id bigint,
  p_provider_deployment_id uuid,
  p_stream_id text
)
returns table (
  generation bigint,
  block_number bigint,
  block_hash bytea,
  block_global_log_index bigint,
  candidate_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_chain_id <> 1
     or p_stream_id is null
     or pg_catalog.octet_length(p_stream_id) not between 1 and 128
     or p_stream_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     or not exists (
       select 1
       from programmable_private.provider_deployments
       where provider_deployment_id = p_provider_deployment_id
         and provider_type = 'envio_deployment'
     )
  then
    raise exception using errcode = '22023', message = 'invalid Envio cursor scope';
  end if;

  return query
  select current_cursor.generation,
         current_cursor.block_number::bigint,
         current_cursor.block_hash::bytea,
         current_cursor.block_global_log_index::bigint,
         current_cursor.candidate_id::text
  from programmable_private.envio_ingestion_cursor_current as current_cursor
  where current_cursor.chain_id = p_chain_id
    and current_cursor.provider_deployment_id = p_provider_deployment_id
    and current_cursor.stream_id = p_stream_id;
  if found then
    return;
  end if;

  return query
  select 0::bigint,
         genesis.anchor_block_number::bigint,
         genesis.anchor_block_hash::bytea,
         null::bigint,
         null::text
  from programmable_private.envio_ingestion_cursor_genesis_points as genesis
  where genesis.chain_id = p_chain_id
    and genesis.provider_deployment_id = p_provider_deployment_id
    and genesis.stream_id = p_stream_id;
  if found then
    return;
  end if;

  return query
  select 0::bigint, null::bigint, null::bytea, null::bigint, null::text;
end
$function$;

revoke all on function programmable_private.get_envio_ingestion_cursor_v1(
  bigint, uuid, text
) from public;
grant execute on function programmable_private.get_envio_ingestion_cursor_v1(
  bigint, uuid, text
) to programmable_projector;
