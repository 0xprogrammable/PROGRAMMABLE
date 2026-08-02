-- Classic launch projections use the shared `classic` model id. Keep the
-- release-specific ids accepted for compatibility, but authorize the boundary
-- tick policy for the model id written by the production projector.

set role programmable_migrator;

alter table programmable_private.launch_position_liquidity_facts
  drop constraint launch_position_liquidity_exact_tick_policy_check,
  add constraint launch_position_liquidity_exact_tick_policy_check check (
    (
      tick_lower < initial_tick and initial_tick < tick_upper
    )
    or
    (
      release_id in ('classic-v2', 'classic-v3')
      and model_id in ('classic', release_id)
      and tick_lower < initial_tick
      and initial_tick = tick_upper
    )
  );

reset role;
