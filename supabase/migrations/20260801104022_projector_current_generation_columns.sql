-- release_epoch_current exposes its CAS counter as generation. The provisional
-- lineage reader was created against a nonexistent pointer_generation column,
-- so the first real projector plan failed before reading any candidates.
set role programmable_migrator;

do $migration$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'programmable_private.get_current_provisional_dynamic_sources_v1(text)'::regprocedure
  ) into strict function_definition;

  if pg_catalog.strpos(
       function_definition,
       'current_release.pointer_generation = page.release_pointer_generation'
     ) = 0
     or pg_catalog.strpos(
       function_definition,
       'current_ingestion.pointer_generation ='
     ) = 0
  then
    raise exception using
      errcode = '55000',
      message = 'unexpected provisional source generation predicates';
  end if;

  corrected_definition := pg_catalog.replace(
    pg_catalog.replace(
      function_definition,
      'current_release.pointer_generation = page.release_pointer_generation',
      'current_release.generation = page.release_pointer_generation'
    ),
    'current_ingestion.pointer_generation =',
    'current_ingestion.generation ='
  );

  if corrected_definition = function_definition
     or pg_catalog.strpos(
       corrected_definition,
       'current_release.pointer_generation'
     ) > 0
     or pg_catalog.strpos(
       corrected_definition,
       'current_ingestion.pointer_generation'
     ) > 0
  then
    raise exception using
      errcode = '55000',
      message = 'provisional source generation repair was incomplete';
  end if;

  execute corrected_definition;
end
$migration$;

revoke all on function programmable_private.get_current_provisional_dynamic_sources_v1(
  text
) from public;
grant execute on function programmable_private.get_current_provisional_dynamic_sources_v1(
  text
) to programmable_projector;

reset role;
