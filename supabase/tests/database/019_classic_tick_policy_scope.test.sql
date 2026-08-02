begin;
select plan(4);

create temporary table classic_tick_policy_probe
  (like programmable_private.launch_position_liquidity_facts
    including constraints);

do $block$
declare
  column_record record;
begin
  for column_record in
    select attribute.attname
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'pg_temp.classic_tick_policy_probe'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attname not in (
        'release_id', 'model_id', 'tick_lower', 'initial_tick', 'tick_upper'
      )
  loop
    execute pg_catalog.format(
      'alter table pg_temp.classic_tick_policy_probe drop column %I cascade',
      column_record.attname
    );
  end loop;
end
$block$;

select lives_ok(
  $$
    insert into pg_temp.classic_tick_policy_probe (
      release_id, model_id, tick_lower, initial_tick, tick_upper
    ) values ('classic-v2', 'classic', -887200, 204200, 204200)
  $$,
  'Classic V2 accepts its canonical upper-boundary launch position'
);

select lives_ok(
  $$
    insert into pg_temp.classic_tick_policy_probe (
      release_id, model_id, tick_lower, initial_tick, tick_upper
    ) values ('classic-v3', 'classic', -887220, 0, 0)
  $$,
  'Classic V3 accepts the shared classic model at the upper boundary'
);

select throws_ok(
  $$
    insert into pg_temp.classic_tick_policy_probe (
      release_id, model_id, tick_lower, initial_tick, tick_upper
    ) values ('classic-v2', 'classic', 204200, 204200, 887200)
  $$,
  '23514',
  null,
  'Classic never accepts initial_tick at the lower boundary'
);

select throws_ok(
  $$
    insert into pg_temp.classic_tick_policy_probe (
      release_id, model_id, tick_lower, initial_tick, tick_upper
    ) values ('stock-paired-v3', 'stock-paired-v3', -887200, 204200, 204200)
  $$,
  '23514',
  null,
  'Non-Classic models retain the strict-interior policy'
);

select * from finish();
rollback;
