-- PGlite does not bundle the pgTAP extension.  These narrow compatibility
-- assertions execute the repository's SQL tests and raise immediately on a
-- failed assertion.  Hosted PostgreSQL/Supabase pgTAP remains the authoritative
-- extension-backed gate; this runner is a deterministic fresh-database gate.
create function public.plan(integer) returns text
language sql as $$ select 'plan'::text $$;

create function public.ok(boolean, text) returns text
language plpgsql as $$
begin
  if not coalesce($1, false) then
    raise exception 'assertion failed: %', $2;
  end if;
  return $2;
end
$$;

create function public.is(anycompatible, anycompatible, text) returns text
language plpgsql as $$
begin
  if $1 is distinct from $2 then
    raise exception 'assertion failed: % (got %, expected %)', $3, $1, $2;
  end if;
  return $3;
end
$$;

create function public.lives_ok(text, text) returns text
language plpgsql as $$
begin
  execute $1;
  return $2;
exception when others then
  raise exception 'lives_ok failed: % [%] %', $2, sqlstate, sqlerrm;
end
$$;

create function public.throws_ok(text, text, text) returns text
language plpgsql as $$
begin
  execute $1;
  raise exception 'throws_ok failed: % did not throw', $3;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'throws_ok failed:%' then raise; end if;
  if sqlstate <> $2 then
    raise exception 'throws_ok failed: % got SQLSTATE %, expected %; %',
      $3, sqlstate, $2, sqlerrm;
  end if;
  return $3;
end
$$;

create function public.throws_ok(text, text, text, text) returns text
language plpgsql as $$
begin
  execute $1;
  raise exception 'throws_ok failed: % did not throw', $4;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'throws_ok failed:%' then raise; end if;
  if sqlstate <> $2 or sqlerrm <> $3 then
    raise exception 'throws_ok failed: % got [%] %, expected [%] %',
      $4, sqlstate, sqlerrm, $2, $3;
  end if;
  return $4;
end
$$;

create function public.has_schema(text) returns boolean
language sql as $$
  select exists (select 1 from pg_catalog.pg_namespace where nspname = $1)
$$;

create function public.has_schema(text, text) returns text
language plpgsql as $$
begin
  if not public.has_schema($1) then
    raise exception 'assertion failed: %', $2;
  end if;
  return $2;
end
$$;

create function public.has_domain(text, text) returns boolean
language sql as $$
  select exists (
    select 1
    from pg_catalog.pg_type as type_row
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = type_row.typnamespace
    where namespace.nspname = $1
      and type_row.typname = $2
      and type_row.typtype = 'd'
  )
$$;

create function public.has_domain(text, text, text) returns text
language plpgsql as $$
begin
  if not public.has_domain($1, $2) then
    raise exception 'assertion failed: %', $3;
  end if;
  return $3;
end
$$;

create function public.finish() returns setof text
language sql as $$ select 'finish'::text $$;
