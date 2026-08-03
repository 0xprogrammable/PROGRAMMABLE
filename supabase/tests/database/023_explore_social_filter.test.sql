begin;

select plan(7);

select ok(
  to_regprocedure(
    'programmable_private.get_public_explore_page_v2(bigint,text,text,integer,integer,text)'
  ) is not null,
  'the filtered Explore reader has one explicit socials argument'
);

select ok(
  programmable_private.public_explore_token_has_social_links_v1(
    '{"metadata":{"links":[{"kind":"x"}]}}'::jsonb
  ),
  'X metadata counts as socials'
);

select ok(
  programmable_private.public_explore_token_has_social_links_v1(
    '{"metadata":{"links":[{"kind":"telegram"}]}}'::jsonb
  ),
  'Telegram metadata counts as socials'
);

select ok(
  not programmable_private.public_explore_token_has_social_links_v1(
    '{"metadata":{"links":[{"kind":"website"}]}}'::jsonb
  ),
  'a website alone does not count as socials'
);

select ok(
  not programmable_private.public_explore_token_has_social_links_v1(
    '{"metadata":{"links":[]}}'::jsonb
  ),
  'missing social links are classified as no'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.get_public_explore_page_v2(bigint,text,text,integer,integer,text)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'programmable_private.get_public_explore_page_v2(bigint,text,text,integer,integer,text)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'programmable_private.get_public_explore_page_v2(bigint,text,text,integer,integer,text)'::regprocedure,
    'EXECUTE'
  ),
  'only the server-side API reader can execute the filtered reader'
);

set local role programmable_api_reader;

select throws_ok(
  $$select * from programmable_private.get_public_explore_page_v2(
    1, '', 'newest', 1, 9, 'any'
  )$$,
  '22023',
  'invalid Explore page request',
  'the database rejects non-canonical socials values'
);

reset role;

select * from finish();

rollback;
