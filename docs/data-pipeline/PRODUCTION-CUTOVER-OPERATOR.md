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
PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL
PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL
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

If failure occurs after Vercel promotion, first disable the public-read flags,
then restore the previous Vercel deployment in addition to the Envio and
database rollback. Reopen traffic only after all three exact identities pass.
