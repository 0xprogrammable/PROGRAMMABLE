# Production data cutover

This runbook moves the reviewed read-model candidate into production without
letting candidate data reach public reads before its exact Envio deployment,
database state and staged website have been attested.

The operator is fail-closed. It does not promote Envio, promote Vercel, create
the isolated restore database or change provider secrets. Those actions remain
explicit control-plane steps. It records and verifies the evidence around them.

## Fixed identities

| Role | Endpoint | Mirror commit |
| --- | --- | --- |
| Candidate | `https://indexer.hyperindex.xyz/d7a39a2/v1/graphql` | `7ffd15c2a28c481a2d3632e30b315262c2471b2e` |
| Rollback | `https://indexer.hyperindex.xyz/f6714ef/v1/graphql` | `2cb1c35c7738fea63e656ad11589664dc93d785d` |

The checked-in candidate evidence is the source of truth. Do not substitute a
deployment alias, mutable URL or different mirror commit.

## Safety rules

1. Run from a clean checkout of the exact reviewed `production` commit.
2. Enable the reviewed indexed route flags only on the unaliased staged
   deployment. The closed database publication fence keeps those routes on
   legacy data until database attestation succeeds.
3. Keep the production domain on the previous Vercel deployment until the
   final promotion step.
4. Use only the direct Supabase TLS endpoint on port 5432 for migrations,
   credential rotation, backup and promotion attestation.
5. Never put a password, database URL, CA, provider token or RPC URL in an
   argument, file committed to Git, terminal transcript or evidence output.
6. Stop on any identity, inventory, checkpoint, parity, restore or staged
   deployment mismatch. Do not repair evidence manually.

## Required environment

The approved secret manager must inject these values into the operator process:

```text
PROGRAMMABLE_MIGRATOR_DATABASE_URL
PROGRAMMABLE_POSTGRES_SSL_CA_PEM
PROGRAMMABLE_API_READER_DATABASE_PASSWORD
PROGRAMMABLE_PROJECTOR_DATABASE_PASSWORD
PROGRAMMABLE_PROJECTOR_RUNTIME_DATABASE_PASSWORD
PROGRAMMABLE_RECONCILER_DATABASE_PASSWORD
PROGRAMMABLE_RELEASE_PROBE_DATABASE_PASSWORD
PROGRAMMABLE_PROJECTOR_DATABASE_URL
PROGRAMMABLE_PROJECTOR_RUNTIME_DATABASE_URL
PROGRAMMABLE_API_READER_DATABASE_URL
PROGRAMMABLE_RECONCILER_DATABASE_URL
PROGRAMMABLE_RELEASE_PROBE_DATABASE_URL
PROGRAMMABLE_CUTOVER_RESTORE_DATABASE_URL
PROGRAMMABLE_CUTOVER_RESTORE_SSL_CA_PEM
PROGRAMMABLE_PG_DUMP_BINARY
PROGRAMMABLE_PG_RESTORE_BINARY
PROGRAMMABLE_PSQL_BINARY
PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER
PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL
PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT
PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_PROVIDER
PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL
PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT
PROGRAMMABLE_ENVIO_GRAPHQL_TOKEN
PROGRAMMABLE_SHADOW_PROBE_TOKEN
PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN
CRON_SECRET
VERCEL_AUTOMATION_BYPASS_SECRET
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

The five generated role passwords must be distinct printable values of at
least 32 characters. The pooler URLs must correspond to those same passwords.

Every evidence path below is an absolute path outside the repository. The
operator creates output files with mode `0600` and refuses to overwrite them.

## 1. Database and credentials

Run the reviewed migration plan and candidate bootstrap with
`hosted-db-operator.mjs` first. The candidate database must remain
`candidate-only`, unpromoted and have zero projection publications.

Provision and verify the five login roles:

```sh
node scripts/data-pipeline/cutover-operator.mjs roles-provision \
  --expected-project-ref <project-ref> \
  --output /secure/cutover/roles-provisioned.json

node scripts/data-pipeline/cutover-operator.mjs roles-verify \
  --expected-project-ref <project-ref> \
  --pooler-host <region>.pooler.supabase.com \
  --output /secure/cutover/roles-verified.json
```

Pooler verification uses port 6543, `prepare: false`, the exact login identity
and `SET LOCAL ROLE` for every capability role.

## 2. Backup with tested restore

Install PostgreSQL 17 client tools. Before starting, create an empty,
TLS-verified loopback database named
`programmable_restore_<restore-isolation-id>`. It must not be a production or
remote database.

```sh
node scripts/data-pipeline/cutover-operator.mjs backup-restore \
  --expected-project-ref <project-ref> \
  --operation-id cutover-20260801-a \
  --restore-isolation-id cutover_20260801 \
  --backup /secure/cutover/pre-attestation.dump \
  --evidence /secure/cutover/pre-attestation-restore.json
```

The command rejects source drift during the backup window and accepts the
archive only when the isolated restore has the exact same manifest.

### Candidate in-place reset to a pre-attestation snapshot

Use this sequence only for the reviewed Candidate project
`mnnvlrqwhfoppogslsje`. The operator rejects every other project ref, host,
port, database or TLS posture. It accepts only a direct `postgres` owner
session or Supabase CLI's exact `cli_login_postgres` JIT role. In JIT mode the
URL user must equal `session_user`, membership in `postgres` is mandatory, and
the operator executes and verifies `SET ROLE postgres` before any mutation.
The selected mode and original session identity are committed into every plan
and result. Stop the source and market schedulers and wait for both leases to
drain before the first command.

First take a fresh recovery backup of the currently bound Candidate product.
This command also restores that backup into the independently provisioned
empty loopback database and compares its complete manifest. It then fences all
five Candidate runtime login roles with `NOLOGIN`. The roles deliberately stay
fenced on success or failure:

```sh
node scripts/data-pipeline/cutover-operator.mjs candidate-safety-backup \
  --expected-project-ref mnnvlrqwhfoppogslsje \
  --current-product-commit <currently-bound-40-character-product-commit> \
  --operation-id candidate-safety-20260802-a \
  --restore-isolation-id candidate_safety_20260802 \
  --backup /secure/cutover/candidate-current-safety.dump \
  --backup-evidence /secure/cutover/candidate-current-safety-backup.json \
  --output /secure/cutover/candidate-current-safety.json
```

If an earlier reset already left the Candidate database strictly unpromoted,
unbound and unpublished, use `--current-product-commit unbound`. The operator
accepts that literal only when every promotion binding is null,
`promoted=false`, and the publication count is zero. Use the same literal for
the matching restore and recovery commands.

Create a deterministic restore plan from the reviewed pre-attestation archive
and its original backup evidence. The plan hashes the exact bytes and
`pg_restore --list` output of both the source snapshot and the fresh safety
backup. It pins the prescribed `88cd707` archive bytes, archive hash, TOC hash,
legacy manifest and schema-only SQL hash. It also binds all three absolute
PostgreSQL 17.10 EDB binaries plus the complete adjacent runtime-library
manifest; no `PATH` fallback receives credentials:

```sh
node scripts/data-pipeline/cutover-operator.mjs candidate-restore-plan \
  --expected-project-ref mnnvlrqwhfoppogslsje \
  --current-product-commit <currently-bound-40-character-product-commit> \
  --snapshot-repository-commit 88cd7078037910c22fc7e67e0031f7e4ef30e422 \
  --snapshot-backup /secure/cutover/pre-attestation-88cd707.dump \
  --snapshot-evidence /secure/cutover/pre-attestation-88cd707.json \
  --safety-backup /secure/cutover/candidate-current-safety.dump \
  --safety-backup-evidence /secure/cutover/candidate-current-safety-backup.json \
  --safety-evidence /secure/cutover/candidate-current-safety.json \
  --output /secure/cutover/candidate-restore-plan.json
```

Review the plan and pass its `confirmRestore` value literally. Apply rebuilds
the plan, rejects a safety backup older than 30 minutes, rechecks the currently
bound product, drained leases, closed runtime logins and byte-identical current
manifest, then uses exactly three `--schema` selectors and these immutable
flags: `--clean --if-exists --exit-on-error --single-transaction --no-owner
--no-privileges`.

```sh
node scripts/data-pipeline/cutover-operator.mjs candidate-restore-apply \
  --expected-project-ref mnnvlrqwhfoppogslsje \
  --current-product-commit <currently-bound-40-character-product-commit> \
  --snapshot-repository-commit 88cd7078037910c22fc7e67e0031f7e4ef30e422 \
  --snapshot-backup /secure/cutover/pre-attestation-88cd707.dump \
  --snapshot-evidence /secure/cutover/pre-attestation-88cd707.json \
  --safety-backup /secure/cutover/candidate-current-safety.dump \
  --safety-backup-evidence /secure/cutover/candidate-current-safety-backup.json \
  --safety-evidence /secure/cutover/candidate-current-safety.json \
  --plan /secure/cutover/candidate-restore-plan.json \
  --confirm-restore <confirmRestore> \
  --output /secure/cutover/candidate-restore-result.json
```

Success requires two identical post-restore manifests covering rows, function
and view definitions, constraints, indexes, triggers, RLS and policies, grants,
and sequence state. The database must be `candidate-only`, unpromoted and
unbound, with zero projection publications. Runtime logins remain `NOLOGIN`.
If a transient post-check fails after `pg_restore` committed, rerun the exact
same apply command: it recognizes the restored fenced state and resumes only
the post-checks.

If the restored state is indeterminate or must be rolled back, create and
review the separate recovery plan. This path is bound to the raw isolated
restore evidence and can only restore the exact safety archive; it never opens
runtime logins:

```sh
node scripts/data-pipeline/cutover-operator.mjs candidate-recovery-plan \
  --expected-project-ref mnnvlrqwhfoppogslsje \
  --current-product-commit <currently-bound-40-character-product-commit> \
  --safety-backup /secure/cutover/candidate-current-safety.dump \
  --safety-backup-evidence /secure/cutover/candidate-current-safety-backup.json \
  --safety-evidence /secure/cutover/candidate-current-safety.json \
  --output /secure/cutover/candidate-recovery-plan.json

node scripts/data-pipeline/cutover-operator.mjs candidate-recovery-apply \
  --expected-project-ref mnnvlrqwhfoppogslsje \
  --current-product-commit <currently-bound-40-character-product-commit> \
  --safety-backup /secure/cutover/candidate-current-safety.dump \
  --safety-backup-evidence /secure/cutover/candidate-current-safety-backup.json \
  --safety-evidence /secure/cutover/candidate-current-safety.json \
  --plan /secure/cutover/candidate-recovery-plan.json \
  --confirm-recovery <confirmRecovery> \
  --output /secure/cutover/candidate-recovery-result.json
```

After a successful pinned restore, apply the reviewed hosted migration plan
while logins remain fenced. Only when the migration state is exactly current
may an owner review and execute the explicit runtime-enable pair:

```sh
node scripts/data-pipeline/cutover-operator.mjs candidate-runtime-enable-plan \
  --expected-project-ref mnnvlrqwhfoppogslsje \
  --pooler-host <region>.pooler.supabase.com \
  --restore-result /secure/cutover/candidate-restore-result.json \
  --output /secure/cutover/candidate-runtime-enable-plan.json

node scripts/data-pipeline/cutover-operator.mjs candidate-runtime-enable-apply \
  --expected-project-ref mnnvlrqwhfoppogslsje \
  --pooler-host <region>.pooler.supabase.com \
  --restore-result /secure/cutover/candidate-restore-result.json \
  --plan /secure/cutover/candidate-runtime-enable-plan.json \
  --confirm-enable <confirmEnable> \
  --output /secure/cutover/candidate-runtime-enable-result.json
```

This step checks current migrations and the reviewed structural manifest under
the shared maintenance locks, rotates all five passwords while roles are still
`NOLOGIN`, opens the exact roles, and verifies every transaction-pooler login.
Any failure after opening immediately re-fences and terminates those sessions.
Never manually relax the login fence after a failed restore or failed enable.

## 3. Fenced candidate ingestion

Run raw candidate ingestion while the publication fence is still closed:

```sh
node scripts/data-pipeline/cutover-operator.mjs raw-backfill \
  --expected-project-ref <project-ref> \
  --backup-evidence /secure/cutover/pre-attestation-restore.json \
  --maximum-cycles 512 \
  --output /secure/cutover/raw-backfill.json
```

The run must reach an idle boundary. It fails if a projection publication
appears, the provider UUID changes or the database becomes promoted.

## 4. Exact staged website

Build one production-configured Vercel deployment with `--skip-domain` and
record its immutable `dpl_...` ID and `.vercel.app` URL. The reviewed indexed
route flags are enabled, shadow comparison remains disabled, and the database
publication fence remains closed. Auto-assignment of the production domain
must be disabled.

The staged deployment must bind the reviewed candidate endpoint and the exact
product commit. Do not use a branch alias for any following check.
It must not depend on promotion values created later in the cutover. Its
immutable `VERCEL_GIT_COMMIT_SHA` and `VERCEL_DEPLOYMENT_ID` are the runtime
identity inputs.

Capture creates a release-gate evidence file from the reviewed staged binding
and raw backfill checks. Its non-zero `evidenceSha256` is the SHA-256 commitment
to canonical JSON of every manifest field except `evidenceSha256` itself. The
gate and cutover independently recompute this commitment and reject missing,
stale or malformed values.

The exact staged deployment may have both projector workers enabled, but it
must remain unassigned to every production domain and scheduler. Prove its
control-plane identity, the unchanged live production binding and that every
source and market lease has drained before touching Envio:

```sh
node scripts/data-pipeline/cutover-operator.mjs projector-drain \
  --expected-project-ref <project-ref> \
  --target-url https://<exact-candidate>.vercel.app/ \
  --deployment-id <candidate-dpl-id> \
  --release-gate /secure/cutover/pre-promotion-release-gate.json \
  --output /secure/cutover/projector-drain.json
```

Leave that deployment unassigned through Envio and database attestation. The
gate never invokes either worker. It verifies through the Vercel control plane
that the production domain still resolves to a different deployment, then
waits for both singleton leases to be released or expired. Lease state is
observed using the database clock without exposing holder or token values.

## 5. Promote and attest Envio

Promote only the fixed candidate mirror commit through the Envio control
plane. Immediately capture a private observation file:

```json
{
  "observedAt": "2026-08-01T12:00:00.000Z",
  "controlPlane": {
    "owner": "0xprogrammable",
    "project": "programmable-indexer",
    "status": "prod",
    "mirrorCommit": "7ffd15c2a28c481a2d3632e30b315262c2471b2e",
    "deploymentLabel": "production-7f24e63"
  },
  "runtime": {
    "endpoint": "https://indexer.hyperindex.xyz/d7a39a2/v1/graphql",
    "endpointId": "d7a39a2",
    "deploymentLabel": "production-7f24e63",
    "identity": { "copy": "the exact live runtime identity object" }
  }
}
```

The runtime identity must be copied from the live endpoint response, not from
the expected file. The operator compares it to the checked-in identity and
inventory:

```sh
node scripts/data-pipeline/cutover-operator.mjs envio-attest \
  --observation /secure/cutover/envio-post-promotion-observation.json \
  --drain-evidence /secure/cutover/projector-drain.json \
  --output /secure/cutover/envio-promotion-attestation.json
```

If this command fails, immediately promote the fixed rollback mirror and leave
the Vercel production deployment unchanged.

## 6. Attest the candidate database

First create a deterministic database plan:

```sh
node scripts/data-pipeline/cutover-operator.mjs database-plan \
  --expected-project-ref <project-ref> \
  --envio-attestation /secure/cutover/envio-promotion-attestation.json \
  --drain-evidence /secure/cutover/projector-drain.json \
  --staged-deployment-id <candidate-dpl-id> \
  --output /secure/cutover/database-promotion-plan.json
```

Review every identity and commitment. Apply only by repeating the exact
`inputCommitment` from that plan:

```sh
node scripts/data-pipeline/cutover-operator.mjs database-apply \
  --expected-project-ref <project-ref> \
  --envio-attestation /secure/cutover/envio-promotion-attestation.json \
  --drain-evidence /secure/cutover/projector-drain.json \
  --plan /secure/cutover/database-promotion-plan.json \
  --confirm-apply <inputCommitment> \
  --output /secure/cutover/database-promotion-result.json
```

This is the step that opens the database publication fence. The operator holds
an advisory transaction lock, rechecks both lease rows using database time
inside the same transaction, and atomically stores the exact product commit and
staged `dpl_...` ID with the promotion attestation. It then reads those values
back before accepting the result. A stale drain receipt cannot authorize
promotion after a lease was reacquired.

## 7. Staged projectors, reconciliation and load gate

Use the exact same staged deployment and `dpl_...` ID from the drain evidence.
Its source and market workers may now be invoked directly while the production
domain still points to the previous deployment. No second deployment can replace it between
drain, database attestation, gates and final promotion.
Every worker request must prove that the deployment's immutable Vercel commit
and deployment ID equal the database-bound values. No dynamically generated
promotion environment variables are part of this gate.

```sh
node scripts/data-pipeline/cutover-operator.mjs staged-gates \
  --expected-project-ref <project-ref> \
  --target-url https://<exact-deployment>.vercel.app/ \
  --deployment-id <candidate-dpl-id> \
  --drain-evidence /secure/cutover/projector-drain.json \
  --output-directory /secure/cutover/read-model-capture \
  --maximum-cycles 512 \
  --output /secure/cutover/staged-gates.json
```

The command requires source and market projector catch-up, one exact
checkpoint for each supported release, zero reconciliation mismatches and an
accepted load/release gate. `CRON_SECRET` and the Vercel automation bypass are
sent only in request headers and are never written to release evidence.

Only after this file exists and has been independently reviewed may the exact
staged Vercel deployment be promoted to the production domain. Run the existing
post-promotion deployment and runtime binding checks immediately afterward.

## 8. Rollback evidence

Before Envio promotion, record the currently live Vercel deployment ID and Git
commit. They are deliberately allowed to differ from the candidate product
commit because production remains untouched during the staged cutover.

```sh
node scripts/data-pipeline/cutover-operator.mjs rollback-plan \
  --envio-attestation /secure/cutover/envio-promotion-attestation.json \
  --backup-evidence /secure/cutover/pre-attestation-restore.json \
  --vercel-deployment-id <previous-live-dpl-id> \
  --vercel-product-commit <previous-live-git-commit> \
  --output /secure/cutover/rollback-plan.json
```

On any failure after Envio promotion and before final Vercel promotion:

1. Keep all public-read flags false and stop source, market and reconciliation
   workers.
2. Promote the fixed rollback Envio mirror.
3. Restore the pre-attestation database snapshot, or discard all
   post-attestation candidate state under an independently reviewed recovery.
4. Verify the rollback runtime identity and inventory.
5. Verify that the previous Vercel deployment and commit never changed.

Record one committed receipt for each ordered step in a private observation
file, then validate it:

```sh
node scripts/data-pipeline/cutover-operator.mjs rollback-verify \
  --plan /secure/cutover/rollback-plan.json \
  --observation /secure/cutover/rollback-observation.json \
  --output /secure/cutover/rollback-evidence.json
```

## 9. SLA-gated exact Vercel promotion

This is the only authorized Vercel production-promotion path. The real-block
SLA evidence must be captured from the exact staged deployment after the
Candidate database is product-bound to that same commit and `dpl_...` ID and
the staged projectors have published a complete Classic launch. The production
domain must still resolve to the previous deployment. Run the fail-closed SLA
verifier only after the staged gates above are complete. Then immediately
reverify the same immutable deployment, promote that exact `dpl_...` ID, and
run the post-promotion binding checks. Do not replace any command with a
mutable alias or a second deployment. Set
`PROGRAMMABLE_QUICKNODE_STREAM_ID` to the exact reviewed provider stream ID.

```sh
test ! -e /secure/cutover/real-block-sla-db-attestation.json
npm run perf:read-model:real-block-sla-operator -- \
  --target-url "$STAGED_TARGET_URL" \
  --deployment-id "$STAGED_DEPLOYMENT_ID" \
  --expected-commit "$GITHUB_SHA" \
  --project-id "$VERCEL_PROJECT_ID" \
  --stream-id "$PROGRAMMABLE_QUICKNODE_STREAM_ID" \
  --output /secure/cutover/real-block-sla-db-attestation.json

npm run perf:read-model:real-block-sla -- \
  --evidence /secure/cutover/real-block-sla-db-attestation.json \
  --expected-commit "$GITHUB_SHA" \
  --deployment-id "$STAGED_DEPLOYMENT_ID" \
  --target-url "$STAGED_TARGET_URL"

test ! -e "$PRE_PROMOTE_BINDING_OUTPUT"
npm run perf:read-model:staged-deployment -- \
  --target-url "$STAGED_TARGET_URL" \
  --github-output "$PRE_PROMOTE_BINDING_OUTPUT"
grep -Fx "deployment_id=$STAGED_DEPLOYMENT_ID" "$PRE_PROMOTE_BINDING_OUTPUT"
grep -Fx "target_url=$STAGED_TARGET_URL" "$PRE_PROMOTE_BINDING_OUTPUT"

vercel promote "$STAGED_DEPLOYMENT_ID" --yes --token="$VERCEL_TOKEN"

npm run perf:read-model:post-promotion -- \
  --target-url "https://programmable.market" \
  --deployment-id "$STAGED_DEPLOYMENT_ID" \
  --git-head "$GITHUB_SHA" \
  --evidence "$READ_MODEL_RELEASE_EVIDENCE_PATH"
```

The operator command obtains its probe token and Vercel automation-bypass
secret only from the environment. It validates the returned arm UUID, waits no
longer than five minutes for the first matching organic QuickNode delivery and
challenge-bound export, and writes the exact path above once with mode `0600`.
Any existing file, mutable target, response-cache drift, timeout, or mismatch
in commit, deployment, project or stream blocks the verifier and promotion.

If failure occurs after Vercel promotion, first disable the public-read flags,
then restore the previous Vercel deployment in addition to the Envio and
database rollback. Reopen traffic only after all three exact identities pass.
