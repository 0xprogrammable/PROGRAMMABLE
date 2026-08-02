-- A receipt log ordinal is scoped to one transaction receipt, not to an
-- entire projected block page. Different launch transactions can therefore
-- legitimately have the same ordinal. The parent candidate identifier already
-- commits to the transaction hash and remains the immutable row identity.

set role programmable_migrator;

do $migration$
declare
  matching_constraints integer;
  receipt_ordinal_constraint text;
begin
  select pg_catalog.count(*)::integer,
         pg_catalog.min(constraint_record.conname::text)
    into matching_constraints, receipt_ordinal_constraint
  from pg_catalog.pg_constraint as constraint_record
  join pg_catalog.pg_class as table_record
    on table_record.oid = constraint_record.conrelid
  join pg_catalog.pg_namespace as namespace_record
    on namespace_record.oid = table_record.relnamespace
  where namespace_record.nspname = 'programmable_private'
    and table_record.relname =
      'provisional_dynamic_parent_receipt_ordinals'
    and constraint_record.contype = 'u'
    and pg_catalog.pg_get_constraintdef(constraint_record.oid) =
      'UNIQUE (provisional_page_id, receipt_log_ordinal)';

  if matching_constraints <> 1 or receipt_ordinal_constraint is null then
    raise exception using
      errcode = '55000',
      message = 'provisional receipt ordinal constraint shape changed';
  end if;

  execute pg_catalog.format(
    'alter table programmable_private.' ||
    'provisional_dynamic_parent_receipt_ordinals ' ||
    'drop constraint %I',
    receipt_ordinal_constraint
  );
end
$migration$;

comment on column
  programmable_private.provisional_dynamic_parent_receipt_ordinals.
    receipt_log_ordinal is
  'Zero-based log ordinal within the parent transaction receipt; values may repeat across different parent candidates.';

reset role;
