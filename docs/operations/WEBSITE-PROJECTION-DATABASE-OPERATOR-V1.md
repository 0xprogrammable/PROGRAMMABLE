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
and applies only the pending exact prefix. Each migration and evidence row are
atomic; source bytes are re-hashed immediately before execution. The runtime is
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
