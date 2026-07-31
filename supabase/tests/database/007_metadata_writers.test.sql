begin;

set local role programmable_profile_recovery;

select programmable_private.define_profile_hash_version(
  71::smallint,
  'hmac-sha256-v1',
  decode(repeat('71', 32), 'hex'),
  decode(repeat('72', 32), 'hex'),
  '2026-07-31T08:00:00Z'
);
select programmable_private.set_profile_hash_version_state(
  '71000000-0000-0000-0000-000000000001',
  71::smallint,
  'current',
  decode(repeat('73', 32), 'hex'),
  '2026-07-31T08:00:01Z'
);

reset role;
set local role programmable_profile_binder;

select programmable_private.bind_profile_subject(
  decode(repeat('11', 20), 'hex'),
  71::smallint,
  decode(repeat('a1', 32), 'hex'),
  'wallet_signature',
  decode(repeat('74', 32), 'hex'),
  '2026-07-31T08:00:02Z'
);
select programmable_private.bind_profile_subject(
  decode(repeat('22', 20), 'hex'),
  71::smallint,
  decode(repeat('a2', 32), 'hex'),
  'wallet_signature',
  decode(repeat('75', 32), 'hex'),
  '2026-07-31T08:00:03Z'
);

reset role;

select plan(26);

select ok(
  (
    select pg_catalog.count(*) = 2
    from pg_catalog.pg_proc as function
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = function.pronamespace
    where namespace.nspname = 'programmable_private'
      and function.proname in (
        'append_token_project_metadata_revision',
        'append_project_metadata_link'
      )
      and function.prosecdef
      and 'search_path=""' = any(function.proconfig)
  ),
  'both metadata writers are SECURITY DEFINER with an empty search_path'
);

select ok(
  has_function_privilege(
    'programmable_profile_writer',
    'programmable_private.append_token_project_metadata_revision(uuid,bytea,smallint,bytea,bigint,bigint,bytea,bigint,text,text,text,bytea,timestamptz)',
    'EXECUTE'
  )
  and has_function_privilege(
    'programmable_profile_writer',
    'programmable_private.append_project_metadata_link(uuid,uuid,bytea,smallint,bytea,bigint,bigint,text,text,integer,bytea,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'programmable_projector',
    'programmable_private.append_token_project_metadata_revision(uuid,bytea,smallint,bytea,bigint,bigint,bytea,bigint,text,text,text,bytea,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'programmable_api_reader',
    'programmable_private.append_project_metadata_link(uuid,uuid,bytea,smallint,bytea,bigint,bigint,text,text,integer,bytea,timestamptz)',
    'EXECUTE'
  ),
  'only the ordinary profile writer receives both exact metadata signatures'
);

set local role programmable_profile_writer;

select lives_ok(
  $sql$
    select programmable_private.append_token_project_metadata_revision(
      '71000000-0000-0000-0000-000000000011',
      decode(repeat('11', 20), 'hex'),
      71::smallint,
      decode(repeat('a1', 32), 'hex'),
      1,
      1,
      decode(repeat('33', 20), 'hex'),
      0,
      'Project One',
      'First immutable metadata revision',
      'https://assets.example/project-one.png',
      decode(repeat('81', 32), 'hex'),
      '2026-07-31T08:01:00Z'
    )
  $sql$,
  'the bound owner appends the first metadata revision'
);

select lives_ok(
  $sql$
    select programmable_private.append_token_project_metadata_revision(
      '71000000-0000-0000-0000-000000000011',
      decode(repeat('11', 20), 'hex'),
      71::smallint,
      decode(repeat('a1', 32), 'hex'),
      1,
      1,
      decode(repeat('33', 20), 'hex'),
      0,
      'Project One',
      'First immutable metadata revision',
      'https://assets.example/project-one.png',
      decode(repeat('81', 32), 'hex'),
      '2026-07-31T08:01:00Z'
    )
  $sql$,
  'an exact metadata replay is idempotent'
);

select throws_ok(
  $sql$
    select programmable_private.append_token_project_metadata_revision(
      '71000000-0000-0000-0000-000000000011',
      decode(repeat('11', 20), 'hex'), 71::smallint,
      decode(repeat('a1', 32), 'hex'), 1, 1,
      decode(repeat('33', 20), 'hex'), 0,
      'Changed Project', 'First immutable metadata revision',
      'https://assets.example/project-one.png',
      decode(repeat('81', 32), 'hex'), '2026-07-31T08:01:00Z'
    )
  $sql$,
  '23505',
  'an immutable metadata replay cannot change content'
);

select throws_ok(
  $sql$
    select programmable_private.append_token_project_metadata_revision(
      '71000000-0000-0000-0000-000000000012',
      decode(repeat('11', 20), 'hex'), 71::smallint,
      decode(repeat('a1', 32), 'hex'), 1, 1,
      decode(repeat('33', 20), 'hex'), 0,
      'Project One stale', null, null,
      decode(repeat('82', 32), 'hex'), '2026-07-31T08:01:01Z'
    )
  $sql$,
  '40001',
  'metadata revision compare-and-swap rejects a stale writer'
);

select throws_ok(
  $sql$
    select programmable_private.append_project_metadata_link(
      '71000000-0000-0000-0000-000000000021',
      '71000000-0000-0000-0000-000000000011',
      decode(repeat('11', 20), 'hex'), 71::smallint,
      decode(repeat('a1', 32), 'hex'), 1, 1,
      'website', 'http://project.example/', 0,
      decode(repeat('83', 32), 'hex'), '2026-07-31T08:01:02Z'
    )
  $sql$,
  '22023',
  'project links reject non-HTTPS URLs before audit mutation'
);

select lives_ok(
  $sql$
    select programmable_private.append_project_metadata_link(
      '71000000-0000-0000-0000-000000000021',
      '71000000-0000-0000-0000-000000000011',
      decode(repeat('11', 20), 'hex'), 71::smallint,
      decode(repeat('a1', 32), 'hex'), 1, 1,
      'website', 'https://project.example/', 0,
      decode(repeat('83', 32), 'hex'), '2026-07-31T08:01:02Z'
    )
  $sql$,
  'the owner appends a typed link to the current metadata revision'
);

select lives_ok(
  $sql$
    select programmable_private.append_project_metadata_link(
      '71000000-0000-0000-0000-000000000021',
      '71000000-0000-0000-0000-000000000011',
      decode(repeat('11', 20), 'hex'), 71::smallint,
      decode(repeat('a1', 32), 'hex'), 1, 1,
      'website', 'https://project.example/', 0,
      decode(repeat('83', 32), 'hex'), '2026-07-31T08:01:02Z'
    )
  $sql$,
  'an exact project-link replay is idempotent'
);

select throws_ok(
  $sql$
    select programmable_private.append_project_metadata_link(
      '71000000-0000-0000-0000-000000000021',
      '71000000-0000-0000-0000-000000000011',
      decode(repeat('11', 20), 'hex'), 71::smallint,
      decode(repeat('a1', 32), 'hex'), 1, 1,
      'website', 'https://changed.example/', 0,
      decode(repeat('83', 32), 'hex'), '2026-07-31T08:01:02Z'
    )
  $sql$,
  '23505',
  'an immutable project-link replay cannot change content'
);

select throws_ok(
  $sql$
    select programmable_private.append_project_metadata_link(
      '71000000-0000-0000-0000-000000000022',
      '71000000-0000-0000-0000-000000000011',
      decode(repeat('11', 20), 'hex'), 71::smallint,
      decode(repeat('a1', 32), 'hex'), 1, 1,
      'website', 'https://duplicate.example/', 1,
      decode(repeat('84', 32), 'hex'), '2026-07-31T08:01:03Z'
    )
  $sql$,
  '23505',
  'a metadata revision cannot append a duplicate link kind'
);

select lives_ok(
  $sql$
    select programmable_private.append_token_project_metadata_revision(
      '71000000-0000-0000-0000-000000000013',
      decode(repeat('11', 20), 'hex'), 71::smallint,
      decode(repeat('a1', 32), 'hex'), 1, 1,
      decode(repeat('33', 20), 'hex'), 1,
      'Project One', 'Second immutable metadata revision',
      'https://assets.example/project-one-v2.png',
      decode(repeat('85', 32), 'hex'), '2026-07-31T08:01:04Z'
    )
  $sql$,
  'the current owner advances metadata with revision CAS'
);

select throws_ok(
  $sql$
    select programmable_private.append_project_metadata_link(
      '71000000-0000-0000-0000-000000000023',
      '71000000-0000-0000-0000-000000000011',
      decode(repeat('11', 20), 'hex'), 71::smallint,
      decode(repeat('a1', 32), 'hex'), 1, 1,
      'docs', 'https://docs.example/', 1,
      decode(repeat('86', 32), 'hex'), '2026-07-31T08:01:05Z'
    )
  $sql$,
  '40001',
  'new links cannot be appended to a superseded metadata revision'
);

select lives_ok(
  $sql$
    select programmable_private.append_project_metadata_link(
      '71000000-0000-0000-0000-000000000021',
      '71000000-0000-0000-0000-000000000011',
      decode(repeat('11', 20), 'hex'), 71::smallint,
      decode(repeat('a1', 32), 'hex'), 1, 1,
      'website', 'https://project.example/', 0,
      decode(repeat('83', 32), 'hex'), '2026-07-31T08:01:02Z'
    )
  $sql$,
  'an exact old-revision link replay remains idempotent after metadata advances'
);

select throws_ok(
  $sql$
    select programmable_private.append_project_metadata_link(
      '71000000-0000-0000-0000-000000000025',
      '71000000-0000-0000-0000-000000000013',
      decode(repeat('22', 20), 'hex'), 71::smallint,
      decode(repeat('a2', 32), 'hex'), 1, 2,
      'discord', 'https://discord.example/', 1,
      decode(repeat('8a', 32), 'hex'), '2026-07-31T08:01:05Z'
    )
  $sql$,
  '42501',
  'another bound subject cannot append links to owned metadata'
);

select throws_ok(
  $sql$
    select programmable_private.append_token_project_metadata_revision(
      '71000000-0000-0000-0000-000000000014',
      decode(repeat('22', 20), 'hex'), 71::smallint,
      decode(repeat('a2', 32), 'hex'), 1, 1,
      decode(repeat('33', 20), 'hex'), 2,
      'Takeover', null, null,
      decode(repeat('87', 32), 'hex'), '2026-07-31T08:01:06Z'
    )
  $sql$,
  '42501',
  'another bound subject cannot take over token metadata'
);

select throws_ok(
  $sql$
    select programmable_private.append_token_project_metadata_revision(
      '71000000-0000-0000-0000-000000000015',
      decode(repeat('11', 20), 'hex'), 71::smallint,
      decode(repeat('a1', 32), 'hex'), 2, 1,
      decode(repeat('33', 20), 'hex'), 2,
      'Stale binding', null, null,
      decode(repeat('88', 32), 'hex'), '2026-07-31T08:01:07Z'
    )
  $sql$,
  '40001',
  'metadata writes reject a stale owner-binding generation'
);

select lives_ok(
  $sql$
    select programmable_private.append_project_metadata_link(
      '71000000-0000-0000-0000-000000000024',
      '71000000-0000-0000-0000-000000000013',
      decode(repeat('11', 20), 'hex'), 71::smallint,
      decode(repeat('a1', 32), 'hex'), 1, 2,
      'docs', 'https://docs.example/', 0,
      decode(repeat('89', 32), 'hex'), '2026-07-31T08:01:08Z'
    )
  $sql$,
  'links can be appended to the current revision only'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.token_project_metadata
    where chain_id = 1 and token = decode(repeat('33', 20), 'hex')
  ),
  2::bigint,
  'only the two successful metadata revisions persist'
);

select is(
  (
    select pg_catalog.array_agg(metadata_revision order by metadata_revision)
    from programmable_private.token_project_metadata
    where chain_id = 1 and token = decode(repeat('33', 20), 'hex')
  ),
  array[1::bigint, 2::bigint],
  'metadata revisions form a gap-free compare-and-swap chain'
);

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.project_links
    where metadata_id in (
      '71000000-0000-0000-0000-000000000011',
      '71000000-0000-0000-0000-000000000013'
    )
  ),
  2::bigint,
  'only the two successful immutable links persist'
);

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.mutation_audits
    where action in ('project_metadata.append', 'project_metadata_link.append')
  ),
  4::bigint,
  'successful writes append one audit each while replays and failures append none'
);

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.profile_audit_records
    where action in ('project_metadata.append', 'project_metadata_link.append')
      and caller_role = 'programmable_profile_writer'
  ),
  4::bigint,
  'metadata writes also persist the bound subject, wallet and binding generation'
);

select ok(
  (
    select pg_catalog.count(distinct subject_id) = 1
    from programmable_private.token_project_metadata
    where chain_id = 1 and token = decode(repeat('33', 20), 'hex')
  ),
  'all revisions preserve the first bound stable subject'
);

select ok(
  not exists (
    select 1
    from programmable_private.project_links as link
    left join programmable_private.mutation_audits as audit
      on audit.audit_id = link.audit_id
    where audit.audit_id is null
       or audit.action <> 'project_metadata_link.append'
       or audit.caller_role <> 'programmable_profile_writer'
  ),
  'every project link carries its profile-writer mutation audit'
);

set local role programmable_profile_writer;

select throws_ok(
  $sql$
    insert into programmable_private.token_project_metadata (
      metadata_id, chain_id, token, project_name, description,
      logo_reference, metadata_revision, subject_id, created_at, audit_id
    )
    values (
      '71000000-0000-0000-0000-000000000099',
      1, decode(repeat('99', 20), 'hex'), null, null, null, 1,
      '71000000-0000-0000-0000-000000000099',
      '2026-07-31T08:02:00Z',
      '71000000-0000-0000-0000-000000000099'
    )
  $sql$,
  '42501',
  'the metadata capability cannot bypass the function-only table surface'
);

reset role;

select * from finish();

rollback;
