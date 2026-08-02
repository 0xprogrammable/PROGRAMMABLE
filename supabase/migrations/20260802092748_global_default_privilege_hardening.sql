-- PostgreSQL schema-scoped default privileges can add to, but cannot revoke
-- privileges granted by the global default ACL. Close the built-in PUBLIC
-- EXECUTE/USAGE defaults at the owning role before later migrations create
-- private functions or types.

reset role;
set role programmable_migrator;

alter default privileges for role programmable_migrator
  revoke execute on functions from public;
alter default privileges for role programmable_migrator
  revoke usage on types from public;

reset role;
