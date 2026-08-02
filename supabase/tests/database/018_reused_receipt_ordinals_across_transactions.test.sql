begin;
select plan(3);

select is(
  (
    select pg_catalog.count(*)::integer
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
        'UNIQUE (provisional_page_id, receipt_log_ordinal)'
  ),
  0,
  'receipt ordinals may repeat across different parent transactions'
);

select is(
  (
    select pg_catalog.pg_get_constraintdef(constraint_record.oid)
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as table_record
      on table_record.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace_record
      on namespace_record.oid = table_record.relnamespace
    where namespace_record.nspname = 'programmable_private'
      and table_record.relname =
        'provisional_dynamic_parent_receipt_ordinals'
      and constraint_record.contype = 'p'
  ),
  'PRIMARY KEY (provisional_page_id, parent_candidate_id)',
  'the immutable parent candidate remains the row identity'
);

select is(
  pg_catalog.col_description(
    'programmable_private.provisional_dynamic_parent_receipt_ordinals'::regclass,
    (
      select attribute.attnum
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid =
        'programmable_private.provisional_dynamic_parent_receipt_ordinals'::regclass
        and attribute.attname = 'receipt_log_ordinal'
        and not attribute.attisdropped
    )
  ),
  'Zero-based log ordinal within the parent transaction receipt; values may repeat across different parent candidates.',
  'the receipt ordinal scope is documented in the schema'
);

select * from finish();
rollback;
