# Website projection database operator v1

This is the repository operator for the Generic V2 Website projection database
migrations `0001` through `0005`. It does not deploy the Website, change stage
workflows, or configure Custom bindings. Run it only from the exact reviewed
production commit, with a fresh secret-manager session and an independently
verified production target identity.

## Required target facts

- The 20-character Supabase production project ref.
- Direct DNS name `db.<project-ref>.supabase.co`, port `5432`, database
  `postgres`, and `sslmode=verify-full`.
- Session user `postgres`, or short-lived `cli_login_postgres` with membership
  in `postgres`; the effective role must be exactly `postgres`.
- The provider root CA PEM obtained through the approved provider channel.
- Provider roles `anon`, `authenticated`, and `service_role` exist and have no
  membership edge to the owner or runtime role.
- Runtime role `programmable_website_projection_runtime`.

The operator refuses pooled endpoints, a different target, server major version
below 15, session change, role/privilege/catalog drift, partial evidence, or any
migration history other than the exact reviewed prefix.

## One bounded existing-prefix adoption

`adopt-existing` is a one-source recovery path, not a generic migration-history
repair. It accepts only all of these exact facts:

- source commit `76ebd54e2f0e31d055cfe6c36b7474b0e850de90`, tree
  `8e4ddd9a73818ce70f1284f3b2731bc87b005f27`, and plan
  `0xf0fc7bca18c16da02be83f75d25e404bfe0b7ec7f10c29ecfbea93fcb0d7e973`;
- protected base snapshot
  `0xac4a1fe60ebf677865a0f8ca6160162d9c457dc2bd401aa60fd820c8f2fdcc58`
  and expanded snapshot
  `0x8cb9841f0131b48fb67eac0082d72f51158500a61482c0b21e0c7b7cc2f19284`;
- protected current-role snapshot
  `0x917afa0f6bcd19f00f5d2ce5cd0d8221ef00ad6716460af11bff0906e4b9a0f9`,
  captured by commit `482aba91cd246d605ec0f98d0718dd5fff781d1f`,
  with exactly 36 endpoint roles and all 50 membership rows;
- the exact normalized catalog, RLS, policies, grants, functions and triggers
  after `0001` through `0003`, including the captured schema `USAGE`, three
  table `SELECT`/`INSERT` grants and eleven registry column `UPDATE` grants,
  with no `0004` or `0005` object;
- exactly zero rows in `credential_uses`, `projection_records`, and
  `registry_custom_launch_records`;
- no operator or adoption evidence schema/table/history;
- the exact legacy `supabase_migrations` inventory: two allowlisted tables,
  42 schema rows, 42 evidence rows, public canonical hash
  `0x93e41eab957ab8add897a8b277bcaaa0a5f10eebeb27f47db5bc0e59640484a2`
  and protected full-inventory hash
  `0xd32953874c1466be82433d97e6532d0572ddcf80eed261efa119b25f17e0f5b3`;
- the exact full endpoint-role and membership inventory, including the
  constrained runtime role with the sole accepted drift `rolinherit = true`
  and the provider-owned
  `postgres -> programmable_website_projection_runtime WITH ADMIN OPTION`
  membership with `INHERIT FALSE`, `SET FALSE`, and grantor `supabase_admin`.

The protected operator checkout may be a clean reviewed successor commit only
when all five migration file/execution hashes still equal the source plan. The
command takes the migration advisory lock and one database transaction, locks
all three application tables, then re-reads every precondition. It changes only
the runtime role to `NOINHERIT`, creates private operator/adoption evidence, and
records a distinct `adopted-existing-prefix-v1` prefix for `0001` through
`0003`. Those records attest adoption; they do not claim that the DDL was
replayed. The transaction records the protected snapshot, live pre/post catalog
hashes, zero-row hash and counts, exact role delta, source and operator Git
identities, plan, target and adoption attestation hash.

Run only after independently reviewing the protected snapshot and exact target:
all three snapshot inputs must be owner-only regular files with mode `0600`.

```sh
npm run --silent db:website-projection:operator -- adopt-existing \
  --plan /secure/operator/website-projection-successor-plan.json \
  --expected-project-ref 'mnnvlrqwhfoppogslsje' \
  --source-base-snapshot \
    /secure/operator/programmable-website-projection-hosted-catalog-snapshot-76ebd54.json \
  --source-expanded-snapshot \
    /secure/operator/programmable-website-projection-hosted-catalog-snapshot-v2-76ebd54.json \
  --source-current-snapshot \
    /secure/operator/programmable-website-projection-hosted-catalog-snapshot-v3-482aba91.json \
  --confirm-adopt-existing \
    '<exact-successor-planSha256>' \
  --confirm-target 'mnnvlrqwhfoppogslsje' \
  --confirm-source-snapshot \
    '0x917afa0f6bcd19f00f5d2ce5cd0d8221ef00ad6716460af11bff0906e4b9a0f9' \
  --confirm-adopt-through '0003'
```

Any row, extra object, missing object, alternate membership, other role-bit
drift, partial evidence, lock race, or re-read drift rolls the complete
transaction back. After a successful adoption, retain its JSON result, run the
normal `apply` command with the same exact successor plan to apply only `0004` and
`0005`, then run `verify`. Adoption, apply, and verify remain database evidence
only; they do not enable Custom or authorize a Website deployment.

## Secret-manager session

Export without printing or placing values in shell history:

- `PROGRAMMABLE_MIGRATOR_DATABASE_URL` — exact direct URL above;
- `PROGRAMMABLE_POSTGRES_SSL_CA_PEM` — server-only CA PEM;
- `PROGRAMMABLE_WEBSITE_PROJECTION_RUNTIME_PASSWORD` — a new 24–512-byte
  bootstrap secret, needed only while the runtime role is absent.

Credentials are never accepted as CLI flags, written into the plan, or emitted.

## Plan and dry-run

```sh
npm run --silent db:website-projection:operator -- plan \
  --output /secure/operator/website-projection-plan.json

npm run --silent db:website-projection:operator -- dry-run \
  --plan /secure/operator/website-projection-plan.json \
  --expected-project-ref '<verified-project-ref>'
```

Review the full Git commit/tree, five ordered file/execution hashes, and
`planSha256`. Plan generation requires an exact clean, tracked migration
directory. Dry-run connects without mutations and fails closed on unproven
objects, non-prefix evidence, target mismatch, role drift, or catalog drift.

## Irreversible apply

DDL and role creation are irreversible external mutations. Retain the reviewed
plan and dry-run result, then bind both explicit confirmations:

```sh
npm run --silent db:website-projection:operator -- apply \
  --plan /secure/operator/website-projection-plan.json \
  --expected-project-ref '<verified-project-ref>' \
  --confirm-apply '<exact-planSha256>' \
  --confirm-target '<verified-project-ref>'
```

The operator takes a dedicated advisory lock, creates the role only when absent,
and applies only the pending exact prefix. Runtime bootstrap, migration `0001`,
and its evidence row share one transaction; every later migration and evidence
row are also atomic. Source bytes are re-hashed immediately before execution. The runtime is
`LOGIN NOINHERIT`, non-elevated, owns no application objects, and has no provider
membership. The owner owns all objects. `PUBLIC` and provider roles receive no
application or evidence privileges. Retain the JSON result as apply evidence.

## Verify

```sh
npm run --silent db:website-projection:operator -- verify \
  --plan /secure/operator/website-projection-plan.json \
  --expected-project-ref '<verified-project-ref>'
```

Success requires `current`, five exact evidence rows, the constrained role graph,
and application/operator catalog fingerprints matching the last atomic evidence
row. Pending exits 2; drift is an error. Retain the verify JSON with the plan,
dry-run result, and apply result.
