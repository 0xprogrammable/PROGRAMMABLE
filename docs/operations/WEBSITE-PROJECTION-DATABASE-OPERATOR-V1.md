# Website projection database operator v1

This is the repository operator for the Website projection database migrations
`0001` through `0006`. It does not deploy the Website, change stage
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

Migration `0006` installs the GMGN singleton and a forced-RLS decision history.
The final grant reset permits the runtime to select and update only the singleton,
insert decisions, and delete only history generations admitted by the bounded
retention policy. Each gate transition prunes to the latest 256 generations, so
the normal gate path contains at most 512 decision rows. The insert policy admits
only exact current/next-generation outcomes, keeping the hard runtime-ACL bound
at 514 without an owner cron or broad maintenance privilege.

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
when all five frozen source-plan migration file/execution hashes (`0001` through
`0005`) still equal the source plan. The command takes the migration advisory
lock and one database transaction, locks
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
normal `apply` command with the same exact successor plan to apply only `0004`
through `0006`, then run `verify`. Adoption, apply, and verify remain database
evidence only; they do not enable Custom or authorize a Website deployment.

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

Review the full Git commit/tree, six ordered file/execution hashes, and
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

Success requires `current`, six exact evidence rows, the constrained role graph,
and application/operator catalog fingerprints matching the last atomic evidence
row. Pending exits 2; drift is an error. Retain the verify JSON with the plan,
dry-run result, and apply result.

## Existing runtime credential rotation

The bootstrap password is intentionally ignored once
`programmable_website_projection_runtime` exists. Rotate that existing role only
with the separate source-owned operator:

```sh
npm run --silent db:website-projection:rotate-credential -- preflight \
  --expected-project-ref 'mnnvlrqwhfoppogslsje' \
  --plan '/secure/operator/reviewed-website-projection-plan.json'

npm run --silent db:website-projection:rotate-credential -- rotate \
  --expected-project-ref 'mnnvlrqwhfoppogslsje' \
  --plan '/secure/operator/reviewed-website-projection-plan.json' \
  --password-file '/secure/operator/new-website-projection-runtime-password' \
  --output-directory '/secure/operator/website-projection-runtime-v1' \
  --confirm-rotate \
    'programmable_website_projection_runtime@mnnvlrqwhfoppogslsje' \
  --confirm-no-overlap 'single-password-forward-cutover-v1'
```

Use `--password-stdin yes` instead of `--password-file` only with a non-TTY
secret-manager pipe. A password file must be an owner-only regular file with
mode `0600`; it is never accepted as a flag value, environment variable, or
printed output. The output directory must not exist and its parent must be an
owner-only real directory with mode `0700`.
Both protected paths must resolve outside the Git checkout.
The retained reviewed migration plan must also be an owner-only `0600` regular
file outside the checkout. Its exact evidence and adoption attestation must be
current in the database, while its migration order and byte commitments must
match the current rotation checkout.

The operator reuses the authenticated migration boundary above, requires the
exact current six-row migration evidence and catalog fingerprints, takes a
shared migration advisory lock, and changes only the password with `ALTER ROLE`
inside one database transaction. It then authenticates a fresh connection through the
exact Frankfurt Supavisor transaction endpoint as
`programmable_website_projection_runtime.mnnvlrqwhfoppogslsje`, with the
separate provider CA, hostname verification and the runtime least-privilege
attestation. Only after that probe succeeds does one atomic directory rename
publish these owner-only `0600` files:

- `PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL`;
- `PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE`;
- `PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM`;
- `programmable-website-projection-runtime-credential-rotation-v1.json`.

The JSON receipt contains no credential or credential-derived digest. The first
three files are protected inputs for the Vercel environment controller; their
creation is not a Vercel change or a Website cutover.

PostgreSQL supports one password for this role, not overlapping old and new
passwords. A failure before password mutation rolls back automatically. Existing
sessions may continue after commit, but they are not overlap or cutover evidence.
Every failure after password mutation begins, including a lost commit
acknowledgement or a failed fresh probe, is conservatively `WPR01`: the new
credential may be active and the staged output is removed. Rerun with the same
protected secret or perform a forward rotation. Automatic restoration of an
unavailable prior secret is impossible.
Keep the current Vercel value until the protected new URL and CA exist, then use
the normal dark-stage, readiness and promotion sequence.
The exact cross-repository materialization contract is machine-readable in
`WEBSITE-PROJECTION-DATABASE-BACKEND-HANDOFF-V1.json` beside this runbook.
