# Hosted database operator

This operator prepares a fresh hosted Supabase database without linking the
repository or placing a database credential on a command line. It discovers
every canonical SQL file under `supabase/migrations`, including migrations
added after this document, and fails if the directory differs from the exact
Git commit.

It does not configure Vercel, set role passwords, backfill data, start a
projector, enable a public read flag or promote a release.

## Safety boundary

The database URL is read only from
`PROGRAMMABLE_MIGRATOR_DATABASE_URL`. The operator accepts exactly:

```text
postgresql://postgres:<password>@db.<expected-project-ref>.supabase.co:5432/postgres?sslmode=verify-full
```

It rejects pooler hosts, port `6543`, a different project ref, an implicit
port, a different database, extra URL parameters and any SSL mode other than
`verify-full`. The expected project ref is a required explicit argument. The
CA is read only from `PROGRAMMABLE_POSTGRES_SSL_CA_PEM`. Neither value is
printed, written to a plan or accepted as a CLI flag.

Load both secrets into the current operator session from the approved secret
manager. Do not paste either value into a tracked file, ticket, shell command
or transcript.

## 1. Produce the reviewed migration plan

Run this from the exact committed checkout that will be reviewed:

```sh
node scripts/data-pipeline/hosted-db-operator.mjs plan > /secure/operator/migrations.json
```

The plan contains the full commit hash, every ordered filename, version, byte
length and SHA-256 digest, plus commitments to the order and the complete
plan. A noncanonical, empty, duplicate, untracked, modified or symlinked SQL
file is rejected.

Review the plan and retain it with the release evidence. Do not regenerate it
after review. A changed or later migration produces a different plan and must
be reviewed as a new input.

## 2. Inspect the hosted target without writing

```sh
node scripts/data-pipeline/hosted-db-operator.mjs dry-run \
  --plan /secure/operator/migrations.json \
  --expected-project-ref <verified-project-ref>
```

`dry-run` opens the verified direct endpoint, checks the server database,
port and minimum PostgreSQL version, then compares the remote migration
history with the exact local order. It does not create a schema or table.

The remote history must be an exact prefix of the local plan. An out-of-order
version, remote-only version, renamed migration, missing statement record or
missing Programmable file evidence is a hard failure. The operator does not
offer a repair shortcut because that would assert file provenance it cannot
prove.

## 3. Apply after separate authorization

Only after the backup, local database gates, secret scan, plan review and
explicit production-change authorization, repeat the exact plan commitment as
the apply confirmation:

```sh
node scripts/data-pipeline/hosted-db-operator.mjs apply \
  --plan /secure/operator/migrations.json \
  --expected-project-ref <verified-project-ref> \
  --confirm-apply <reviewed-plan-sha256>
```

Each pending file runs in its own transaction. Its canonical Supabase history
row and the Programmable evidence row are committed in the same transaction.
The evidence row records the version, name, order, filename, file SHA-256,
reviewed plan commitment and repository commit. A failed file is not recorded
as applied. Successfully committed earlier files remain an exact prefix and
can be resumed with the same plan.

Apply also holds one database advisory lock for the full run. A concurrent
operator fails instead of racing the history table.

The operator uses Supabase's canonical
`supabase_migrations.schema_migrations(version, name, statements)` shape. Its
additional `supabase_migrations.programmable_migration_evidence` table is
private operator evidence and contains no credentials.

## 4. Verify the complete history

```sh
node scripts/data-pipeline/hosted-db-operator.mjs verify \
  --plan /secure/operator/migrations.json \
  --expected-project-ref <verified-project-ref>
```

`verify` exits with status `2` while any planned migration remains pending.
It is not proof of a successful backfill, release bootstrap, provider health,
projector run, parity result or public activation.

## Separate bootstrap plan

With the reviewed private dRPC-primary and QuickNode-secondary URLs plus their
exact role/provider/commitment fields loaded only in server-side environment
variables, generate the data-pipeline bootstrap plan separately:

```sh
node scripts/data-pipeline/hosted-db-operator.mjs bootstrap-plan \
  > /secure/operator/bootstrap.json
```

This plan reads `config/data-pipeline-release.v1.json` through the production
release parser and computes the exact Envio, dual-RPC and official Uniswap v4
subgraph commitments with the same production modules used by the workers.
Its output includes only redacted identities and commitments, never RPC URLs,
API keys or database credentials.

The current release binding does not contain semantic source roles, recovery
selectors, ABI/event-set commitments, artifact creation-code commitments,
dynamic-source template evidence, RPC endpoint-evidence attestations or the
current database generation required for activation. The bootstrap plan lists
those missing values per release and source and therefore reports
`execution.ready=false`. That is intentional. Do not convert runtime-code
hashes into creation-code commitments, infer roles from contract names or
invent activation receipts.

Bootstrap execution needs a separately reviewed manifest that supplies those
exact inputs, a database-state read at execution time and a dedicated
operator. Migration completion alone must never activate a release epoch or a
worker.

## Failure handling

- Operator failures are credential-safe and deliberately terse. Use the
  reviewed plan, database provider logs and SQLSTATE code for diagnosis.
- Never use `migration repair` or manually insert history rows to make the
  check green without independently proving the original file bytes.
- Never edit an applied migration. Add a later canonical migration and produce
  a new plan.
- If a direct endpoint is unavailable, stop. Do not fall back to Supavisor or
  weaken TLS validation.
- Keep both projector activation values and every indexed public-read flag
  `false` until their independent release gates pass.
