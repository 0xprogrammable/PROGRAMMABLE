set role programmable_migrator;

create function programmable_private.public_explore_token_has_social_links_v1(
  p_token jsonb
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select exists(
    select 1
    from pg_catalog.jsonb_array_elements(
      coalesce(p_token #> '{metadata,links}', '[]'::jsonb)
    ) as link(value)
    where link.value ->> 'kind' in ('x', 'telegram')
  )
$function$;

create function programmable_private.get_public_explore_page_v2(
  p_chain_id bigint,
  p_query text,
  p_sort text,
  p_requested_page integer,
  p_page_size integer,
  p_socials text
)
returns table (
  http_status integer,
  payload jsonb,
  payload_complete boolean,
  record_count bigint,
  record_scopes jsonb,
  comparison_checkpoint_block_number bigint,
  comparison_checkpoint_block_hash bytea,
  route_evidence jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  route_snapshot programmable_private.public_route_snapshots_v2%rowtype;
  normalized_query text;
  valuation_unit text;
  filtered_count bigint;
  current_count bigint;
  total_pages bigint;
  resolved_page bigint;
  selected_count bigint;
  selected_tokens jsonb;
  selected_scopes jsonb;
  launcher_fees numeric;
  start_cursor jsonb;
  end_cursor jsonb;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id not in (1, 11155111)
     or p_sort not in (
       'newest', 'oldest', 'market-cap', 'market-cap-asc'
     )
     or p_requested_page < 1
     or p_page_size not between 1 and 100
     or p_query is null
     or (p_socials is not null and p_socials not in ('yes', 'no'))
     or pg_catalog.octet_length(p_query) > 256
  then
    raise exception using
      errcode = '22023', message = 'invalid Explore page request';
  end if;
  normalized_query := pg_catalog.lower(
    pg_catalog.regexp_replace(pg_catalog.btrim(p_query), '^\$', '')
  );

  select * into route_snapshot
  from programmable_private.public_route_snapshots_v2
  where route_key = 'explore-list'
    and snapshot_scope = 'all-supported'
    and chain_id = p_chain_id;
  if not found then return; end if;

  select pg_catalog.count(*) into current_count
  from programmable_private.current_launch_projections_v1 as launch
  join programmable_private.run_headers as run
    on run.run_id = launch.projection_run_id
   and run.run_kind = 'projection'
  join lateral pg_catalog.jsonb_array_elements(
    route_snapshot.release_pointers
  ) as pointer(value)
    on pointer.value ->> 'releaseVersion' = launch.release_id
   and pointer.value ->> 'modelVersion' = launch.model_id
   and pointer.value ->> 'sourceGroup' = run.source_group
   and (pointer.value ->> 'epochId')::uuid = launch.epoch_id
   and (pointer.value ->> 'pointerGeneration')::bigint =
      launch.pointer_generation
  where launch.chain_id = p_chain_id;
  if current_count <> (
    select pg_catalog.count(*)
    from programmable_private.public_explore_list_v1
    where chain_id = p_chain_id
      and checkpoint_block_number =
        route_snapshot.checkpoint_block_number
      and checkpoint_block_hash = route_snapshot.checkpoint_block_hash
  ) then
    return;
  end if;

  select pg_catalog.count(*) into filtered_count
  from programmable_private.public_explore_list_v1 as item
  where item.chain_id = p_chain_id
    and item.checkpoint_block_number =
      route_snapshot.checkpoint_block_number
    and item.checkpoint_block_hash = route_snapshot.checkpoint_block_hash
    and (
      normalized_query = ''
      or pg_catalog.lower(item.token_name)
        like '%' || normalized_query || '%'
      or pg_catalog.lower(item.token_symbol)
        like '%' || normalized_query || '%'
      or pg_catalog.lower(item.token_address)
        like '%' || normalized_query || '%'
    )
    and (
      p_socials is null
      or programmable_private.public_explore_token_has_social_links_v1(
        item.token_projection
      ) = (p_socials = 'yes')
    );

  if p_sort in ('market-cap', 'market-cap-asc') then
    if filtered_count = 0 then
      valuation_unit := 'native-wei';
    else
      select case
        when pg_catalog.bool_and(market_cap_usd_wad is not null)
          then 'usd-wad'
        when pg_catalog.bool_and(market_cap_native_wei is not null)
          then 'native-wei'
      end into valuation_unit
      from programmable_private.public_explore_list_v1 as item
      where item.chain_id = p_chain_id
        and item.checkpoint_block_number =
          route_snapshot.checkpoint_block_number
        and item.checkpoint_block_hash = route_snapshot.checkpoint_block_hash
        and (
          normalized_query = ''
          or pg_catalog.lower(item.token_name)
            like '%' || normalized_query || '%'
          or pg_catalog.lower(item.token_symbol)
            like '%' || normalized_query || '%'
          or pg_catalog.lower(item.token_address)
            like '%' || normalized_query || '%'
        )
        and (
          p_socials is null
          or programmable_private.public_explore_token_has_social_links_v1(
            item.token_projection
          ) = (p_socials = 'yes')
        );
      if valuation_unit is null then return; end if;
    end if;
  end if;

  total_pages := pg_catalog.ceil(
    filtered_count::numeric / p_page_size
  )::bigint;
  resolved_page := case
    when total_pages = 0 then 1
    else least(p_requested_page::bigint, total_pages)
  end;

  with candidates as (
    select item.*,
      case
        when valuation_unit = 'usd-wad'
          then item.market_cap_usd_wad::numeric
        when valuation_unit = 'native-wei'
          then item.market_cap_native_wei::numeric
      end as market_cap_atomic
    from programmable_private.public_explore_list_v1 as item
    where item.chain_id = p_chain_id
      and item.checkpoint_block_number =
        route_snapshot.checkpoint_block_number
      and item.checkpoint_block_hash = route_snapshot.checkpoint_block_hash
      and (
        normalized_query = ''
        or pg_catalog.lower(item.token_name)
          like '%' || normalized_query || '%'
        or pg_catalog.lower(item.token_symbol)
          like '%' || normalized_query || '%'
        or pg_catalog.lower(item.token_address)
          like '%' || normalized_query || '%'
      )
      and (
        p_socials is null
        or programmable_private.public_explore_token_has_social_links_v1(
          item.token_projection
        ) = (p_socials = 'yes')
      )
  ), ordered as (
    select candidates.*,
      pg_catalog.row_number() over (order by
        case when p_sort = 'market-cap'
          then market_cap_atomic end desc,
        case when p_sort = 'market-cap-asc'
          then market_cap_atomic end asc,
        case when p_sort = 'oldest'
          then launch_block_number end asc,
        case when p_sort <> 'oldest'
          then launch_block_number end desc,
        case when p_sort = 'oldest'
          then launch_transaction_index end asc,
        case when p_sort <> 'oldest'
          then launch_transaction_index end desc,
        case when p_sort = 'oldest'
          then launch_log_index end asc,
        case when p_sort <> 'oldest'
          then launch_log_index end desc,
        case when p_sort = 'oldest'
          then launch_transaction_hash end asc,
        case when p_sort <> 'oldest'
          then launch_transaction_hash end desc,
        case when p_sort = 'oldest'
          then token_address end asc,
        case when p_sort <> 'oldest'
          then token_address end desc
      ) as row_ordinal
    from candidates
  ), selected as (
    select * from ordered
    where row_ordinal > (resolved_page - 1) * p_page_size
      and row_ordinal <= resolved_page * p_page_size
  ), selected_aggregate as (
    select
      pg_catalog.count(*) as selected_count,
      coalesce(
        pg_catalog.jsonb_agg(token_projection order by row_ordinal),
        '[]'::jsonb
      ) as selected_tokens
    from selected
  ), selected_scope as (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'model', scope.model_id,
          'releaseVersion', scope.release_id
        ) order by scope.release_id, scope.model_id
      ), '[]'::jsonb
    ) as scopes
    from (
      select distinct release_id, model_id from selected
    ) as scope
  ), cursor_rows as (
    select
      programmable_private.build_public_explore_cursor_v1(
        route_snapshot.snapshot_commitment_hex,
        normalized_query, p_sort, p_page_size, valuation_unit,
        start_row.market_cap_atomic,
        start_row.launch_block_number,
        start_row.launch_transaction_index,
        start_row.launch_log_index,
        start_row.launch_transaction_hash,
        start_row.token_address
      ) as start_cursor,
      programmable_private.build_public_explore_cursor_v1(
        route_snapshot.snapshot_commitment_hex,
        normalized_query, p_sort, p_page_size, valuation_unit,
        end_row.market_cap_atomic,
        end_row.launch_block_number,
        end_row.launch_transaction_index,
        end_row.launch_log_index,
        end_row.launch_transaction_hash,
        end_row.token_address
      ) as end_cursor
    from (values (true)) as singleton(value)
    left join ordered as start_row
      on start_row.row_ordinal = (resolved_page - 1) * p_page_size
     and resolved_page > 1
    left join ordered as end_row
      on end_row.row_ordinal = least(
        resolved_page * p_page_size, filtered_count
      )
  )
  select aggregate.selected_count, aggregate.selected_tokens,
    scope.scopes, cursors.start_cursor, cursors.end_cursor
  into selected_count, selected_tokens, selected_scopes,
    start_cursor, end_cursor
  from selected_aggregate as aggregate
  cross join selected_scope as scope
  cross join cursor_rows as cursors;

  if selected_count <> least(
    p_page_size::bigint,
    pg_catalog.greatest(
      0::bigint,
      filtered_count - ((resolved_page - 1) * p_page_size)
    )
  ) then return; end if;
  if (resolved_page = 1) <> (start_cursor is null)
     or (selected_count = 0) <> (end_cursor is null)
  then return; end if;

  select coalesce(pg_catalog.sum(
    coalesce(item.launcher_fees_accrued_wei, '0')::numeric
  ), 0) into launcher_fees
  from programmable_private.public_explore_list_v1 as item
  where item.chain_id = p_chain_id
    and item.checkpoint_block_number =
      route_snapshot.checkpoint_block_number
    and item.checkpoint_block_hash = route_snapshot.checkpoint_block_hash;

  http_status := 200;
  payload := pg_catalog.jsonb_build_object(
    'status', 'ready',
    'snapshot', programmable_private.build_public_snapshot_identity_v2(
      route_snapshot.snapshot_commitment_hex,
      route_snapshot.chain_id,
      route_snapshot.checkpoint_block_number,
      route_snapshot.checkpoint_block_hash,
      route_snapshot.checkpoint_confirmations,
      route_snapshot.snapshot_captured_at,
      route_snapshot.release_pointers
    ),
    'data', pg_catalog.jsonb_build_object(
      'request', pg_catalog.jsonb_build_object(
        'query', pg_catalog.btrim(p_query),
        'socials', p_socials,
        'sort', p_sort,
        'requestedPage', p_requested_page,
        'pageSize', p_page_size
      ),
      'page', pg_catalog.jsonb_build_object(
        'resolvedPage', resolved_page,
        'totalCount', filtered_count::text,
        'valuationUnit', valuation_unit,
        'startAfter', start_cursor,
        'endAt', end_cursor
      ),
      'launcherFeesAccruedWei', launcher_fees::text,
      'tokens', selected_tokens
    )
  );
  payload_complete := true;
  record_count := selected_count;
  record_scopes := selected_scopes;
  comparison_checkpoint_block_number :=
    route_snapshot.checkpoint_block_number;
  comparison_checkpoint_block_hash := route_snapshot.checkpoint_block_hash;
  route_evidence := route_snapshot.route_evidence;
  return next;
end
$function$;

revoke all on function
  programmable_private.public_explore_token_has_social_links_v1(jsonb),
  programmable_private.get_public_explore_page_v2(
    bigint,text,text,integer,integer,text
  )
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

grant execute on function
  programmable_private.get_public_explore_page_v2(
    bigint,text,text,integer,integer,text
  )
to programmable_api_reader;

reset role;
