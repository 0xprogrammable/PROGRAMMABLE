# Private read-model database

The Programmable read model is a server-only Postgres subsystem. It stores
candidate provenance, dual-RPC canonicality evidence, immutable event
occurrences, verified projections, profiles, reconciliation evidence and
generation-fenced checkpoints. It does not authorize transaction calldata,
hold signing credentials, or expose a browser database surface.

The application schema is `programmable_private`. The local Data API is
disabled, and its schema allowlist contains only `public` and
`graphql_public`; `programmable_private` is deliberately absent. No browser
role or `service_role` grant reaches the private schema.

## Current deployment state

The implementation brief contains owner-supplied, point-in-time setup evidence
for a hosted Supabase project named `programmable-read-model` with project ref
`mnnvlrqwhfoppogslsje`, a Central EU (Frankfurt) region, and the provider
settings listed there. This worktree did not independently verify that the
project, region, compute, backup, billing or spend-control settings are still
current. Treat every one of those details as unverified-current provider
evidence, not as a live-state assertion.

This implementation does **not** link the local directory, apply a remote
migration, change compute or billing, configure Vercel, or activate
application reads. The integration owner must review the exact migration
commit and run every local gate below before any hosted migration.

## Local setup

Requirements:

- Docker-compatible local container runtime
- Supabase CLI
- Node.js 24.14.0, matching `supabase/tests/codec/.node-version`, and the
  repository lockfile dependencies
- `psql` for the two-session concurrency harness
- `gitleaks` for the secret gate

From the repository root:

```sh
supabase start
supabase db reset
supabase test db supabase/tests/database
npm run db:test:pglite
(cd supabase/tests/codec && npm ci --ignore-scripts)
node supabase/tests/codec/verify-reference-canonical-fingerprint-v1.mjs
node supabase/tests/codec/verify-production-canonical-fingerprint-v1.ts
node supabase/tests/codec/verify-reference-provider-evidence-v2.mjs
node supabase/tests/codec/verify-production-provider-evidence-v2.ts
supabase db lint --local --level warning
```

`supabase db reset` must begin from an empty local database and apply every
versioned migration in order. The explicit test path keeps the real
two-session scripts out of the pgTAP runner; it runs only the suites in
`supabase/tests/database/`.

`npm run db:test:pglite` is a fast supplementary gate. It replays all
migrations and then runs each pgTAP file against a separate fresh in-memory
database. It catches SQL, function-shape and privilege regressions without a
local container, but it does not replace a native PostgreSQL 17 reset, lint or
the real two-session concurrency harness.

The local direct Postgres port is `54322` and the local transaction-pooler
port is `54329`, as declared in `supabase/config.toml`. Set
`PROGRAMMABLE_DATABASE_URL` to the local direct database URL reported by
`supabase status`, then run:

```sh
supabase/tests/concurrency/run.sh
```

Never place that URL in a tracked file or command transcript. The harness uses
two real `psql` sessions. When it exits successfully against a reset local
database, it exercises exact-scope pointer, lease and checkpoint CAS; a
higher-pointer, higher-lease, higher-checkpoint-generation reorg; independent
scopes; an injected failure after staged projection and checkpoint writes;
same-wallet and same-alias first binding; rekey/rekey,
rekey/tombstone, rekey/alias-claim, recovery/recovery,
recovery/profile-mutation and profile-revision races; and case-insensitive
username collision. The checked-in harness is test design, not evidence that
those real-session races passed until this command has actually completed.

`supabase/seed.sql` is intentionally comment-only. pgTAP tests create
deterministic fixtures inside transactions and roll them back.

## Connection modes

If a hosted operation is separately authorized, first verify the current
project ref and endpoint from the provider control plane. Migrations, schema
inspection, backup and restore then use the verified direct Postgres endpoint
on port `5432`; they must not run through a transaction pooler.

A later, separately reviewed Vercel integration may use Supavisor transaction
mode on port `6543`. Prepared statements must be disabled for that runtime
connection. The browser receives no Postgres, Supabase, migrator,
`service_role`, or capability-role credential.

No runtime connection is enabled by this migration set.

## Ownership and capabilities

`programmable_migrator` is the sole owner of every private application schema
object. It is `NOLOGIN`, non-superuser, has no `BYPASSRLS`, and is absent from
runtime. Every base table enables and forces RLS; its only policy targets the
migrator owner.

| Role | Capability |
| --- | --- |
| `programmable_projector` | Exact audited epoch, provider, ingestion, evidence, staging, promotion and rewind functions |
| `programmable_reconciler` | Exact audited health, reconciliation, parity and market append functions; named reconciliation views |
| `programmable_api_reader` | Named public evidence views plus the frozen public route and indexer-feed read functions |
| `programmable_profile_binder` | Insert-if-absent first profile binding only |
| `programmable_profile_recovery` | Hash-version rotation, alias rekey, tombstone and recovery |
| `programmable_profile_writer` | Revision-fenced profile mutation only |
| `programmable_maintenance` | Bounded telemetry, market and parity retention functions only |

Runtime roles receive schema `USAGE` only where an exact function or view
requires it. They receive no base-table DML, sequence access, ownership,
membership in another capability role, `CREATE`, `BYPASSRLS`, or broad
function grant. `PUBLIC`, `anon`, `authenticated` and `service_role` have no
private-schema access. Default privileges repeat the deny posture for future
objects.

Every callable function is owned by the migrator, uses `SECURITY DEFINER`,
fixes `search_path` to the empty string, schema-qualifies its object access,
and checks the active capability role. Stable views are explicit
definer-mode, security-barrier views with declared columns.

## Canonicality and publication

Release scope is exactly:

```text
(chain_id, release_id, model_id, source_group)
```

Epoch and source-binding rows are immutable. `release_epoch_current` is the
only current pointer and moves by expected-generation compare-and-swap. Runs
capture both epoch ID and pointer generation. Before activation, each
contract source is bound to its exact address, inclusive start block,
semantic source role, recovery selector where applicable, ABI/event-set
commitment and release-wide artifact creation-code commitment. Global
occurrence rows own only physical chain identity and placement. The exact
release binding or dynamic attestation, event type, decoder, ABI, decoded
payload and provider evidence live in the immutable
`chain_event_occurrence_materializations` ledger keyed by occurrence, epoch
and pointer generation. The same raw event can therefore materialize in more
than one valid release without duplicating its chain identity or authorizing a
projection through another release's first-seen snapshot. Ingestion rejects
an address, block or ABI outside the exact manifest, and an active epoch
cannot acquire a late binding.

Factory-created sources are not admitted by address alone. Each release pins
an immutable dynamic-source template containing the parent factory role and
event, the exact decoded address field (`vault` or `wallet`), deployed role,
deployed artifact creation-code commitment, normalized runtime-code hash,
runtime length, immutable-reference commitment and ABI commitment. The
template never assumes every factory instance has one exact runtime hash.
Registration requires the parent factory occurrence's exact materialization
to be current canonical and the emitted address to match that exact field. A
separate immutable record proves equal exact instance runtime hashes from both
pinned RPC deployments at the deployment block, then checks the agreed
normalized hash, runtime length and immutable references against the template.
That record stores both providers' complete runtime bytes and the complete
locally reconstructed runtime, not hashes and lengths alone. A second
immutable binding ties each authorized dynamic address to current-canonical
factory, launch and pool occurrences plus the exact token, pool ID, hook and
quote asset. Unbound or orphaned attestations never enter projector log
filters.
The per-instance attestation also records constructor-argument and local
init-code commitments, and rejects an init-code hash that is merely the
release template's artifact creation-code commitment.
Two valid factory instances may consequently have different exact runtime
hashes while matching the same immutable-aware template. A release-neutral
Envio inbox preserves raw candidate evidence once; append-only resolutions
associate the same candidate with an exact static binding or dynamic
attestation in each epoch without rewriting the raw row.

The release-neutral Envio cursor has one explicit dual-RPC-attested genesis.
Each bounded page independently compares the ordered private dRPC and QuickNode log
commitments with the exact durable inbox interval. One atomic capability then
appends candidates, coverage evidence and the succeeded outcome before its
last-step cursor CAS. The projector cannot execute the standalone cursor
advance. Omission, extra-log, provider disagreement, stale generation or
partial failure therefore leaves no advanced cursor.

RPC deployments use a dedicated registration capability; the generic provider
writer rejects `rpc_provider`. The specialized path is fixed to Ethereum
mainnet (`chain_id = 1`) and derives the only accepted order: dRPC first,
QuickNode second. It retains constructor version, endpoint URL commitment,
endpoint origin commitment and a nonzero commitment linked to the allowlisted
`rpc-endpoint-commitments-v1` evidence domain. Raw endpoint URLs and origins
are never database fields. An accepted safe head requires those two different
immutable deployments in that fixed order, the expected chain ID from both,
heads of at least twelve, finality depth twelve, the exact safe block
`least(head_a, head_b) - 12`, and equal hashes at that block. Every promoted
source occurrence and checkpoint target also carries same-observation,
same-epoch agreeing block evidence.

Logical event identity is `(chain_id, transaction_hash,
receipt_log_ordinal)`. Fork placement adds `block_hash`. Block-global log
index remains provenance and never becomes identity. Transaction indexes,
block-global log indexes and receipt log ordinals preserve the full unsigned
32-bit domain in `bigint`-backed checked domains and read models; no `int4`
narrowing is permitted.

Projection rows are staged under a nonterminal run. One fenced promotion
validates the current epoch, lease generation, safe-head evidence, occurrence
evidence, verified seed evidence and checkpoint CAS, then atomically appends
the deterministic ordered fold manifest (including every typed projection row
reference, selected occurrence, allocation fact/evidence pair and route),
outcome, publication, route
eligibility and checkpoint. Every staged projection must bind the exact run,
epoch/generation, target block/hash and a source occurrence present in the
ordered promotion set. Every complete launch requires exactly one token-bound
PoolKey row and one fee-configuration row; selected reward facts require
complete vault and beneficiary-allocation rows. Dedicated,
audited typed writers cover PoolKey/fees, accruals/totals, vault/allocation,
beneficiary/creator/launcher claims, payout changes, account balances and
initial-buy custody/vesting. Rewind is a
separate entry point and requires strictly higher pointer, lease, checkpoint
and reorg generations; orphaning and rebuildable-row deletion are restricted
to the same `(chain_id, release_id, model_id, source_group)`. Append functions
cannot make data current.

`checkpoint_summary_v1` exposes the exact canonical `checkpoint_id` together
with `source_group` and `projector_version`; consumers bind readiness to that
identity, not merely an epoch/generation/block tuple. Projector-only readers
expose the exact current release manifest, only current asset-bound dynamic
attestations, and a lease-fenced terminal-disposition stream so a restart can
reconstruct the ordered decision IDs required by promotion.

Every typed writer is fenced by the release's immutable
`(projection_kind, source_role, event_type)` allowlist. Publication also
requires a non-empty ordered launch-completeness manifest and exact staged
occurrence roles. `always`, `reward_vault`, `locked_custody`, and `eth_funded`
conditions are evaluated per launch. Reward-vault launches require a complete
vault projection and selected verified seed; locked custody requires a
matching vesting projection and factory occurrence; ETH-funded launches
require the coordinator occurrence. Classic V3 fee disclosure stores
`buy_creator_fee_bps` and `sell_creator_fee_bps` separately. Hook creator and
launcher claims, `CreatorFeesCheckpointed`, and
`CtoRewardConfigurationActivated` are distinct immutable event facts rather
than being forced into the beneficiary-claim or initial-seed shape.

Reward-allocation facts require the complete ordered launcher, factory and
hook occurrence set from the same current release epoch, and every role is
checked against the occurrence's immutable release-binding commitment.
Promotion accepts only evidence with explicit recomputation attestations whose
allocation, configuration and active-configuration commitments equal the
fact. Calldata evidence must bind the exact manifest destination and selector,
the factory transaction and release artifact. The release-wide artifact
creation-code commitment is distinct from, and is never compared for equality
with, the per-instance constructor-arguments commitment, local init-code hash,
CREATE2 salt or computed CREATE2 address. Getter and prediction provider pairs
must agree; matched predictions must both equal the emitted vault. Structurally
retained legacy evidence with
no recomputation attestation is never promotion-eligible. Every later evidence
append is re-evaluated against the exact fact epoch even when recomputation
fields are absent. Any contradiction in binding, CREATE2 address, selected RPC
results, receipt or enrichment evidence is retained in immutable mismatch
evidence, appends a quarantine decision, removes any verified pointer and
quarantines only the exact epoch-generation routes rather than disappearing in
a rolled-back exception. If two independently valid facts prove different
allocation or configuration content
for the same canonical factory occurrence and vault, the audited conflict
transition records both decisions, removes the verified pointer and
quarantines affected routes atomically.

The server-only launch list, token-detail and creator-profile views expose the
same current published launch together with its canonical PoolKey
(`currency0`, `currency1`, hook, fee and tick spacing), audited fee disclosure,
launch timestamp, and latest immutable project-metadata revision with ordered
HTTPS links. Project metadata remains descriptive and cannot make an otherwise
ineligible launch visible.

Recent-launch pagination uses the complete ordered cursor
`(promoted_block_number, launch_transaction_hash, token)`; all three values
must be absent for the first page or present for later pages. Account reward
function rows return their authoritative `chain_id` and `account` alongside
the reward data, so an adapter never relabels returned scope from request
parameters.

Dependency circuit state is stored with the exact database enum values
`closed`, `open`, `half_open`, and `frozen`. JSON adapters may present a
different display label, but must map explicitly; `half-open` is not a valid
database enum value and `frozen` must not be dropped.

Named market snapshot and candle views are available only to
`programmable_api_reader`. Every returned row belongs to a successful,
zero-mismatch reconciliation run in the same current release/source epoch,
uses an immutable `uniswap_subgraph` deployment record, and binds its source
block number/hash to exact dual-RPC block evidence. These views join through
the independently gated token-detail launch view; absent or stale market data
stays absent and never removes or fabricates the underlying launch.

## Fingerprint trust boundary

Postgres does not canonicalize JSON, serialize a fingerprint preimage, or
calculate Keccak/SHA3. The reviewed server-boundary TypeScript codec owns
normalization, JCS, v1 framing and Ethereum Keccak-256. The independent
JavaScript reference verifier and the checked-in static JSON vectors pin the
same complete bytes and digests. Its exact Node runtime is recorded in
`supabase/tests/codec/.node-version`; its independent `canonicalize` and
`@noble/hashes` implementations are exact-pinned with registry integrity
values in the codec-local lockfile.

Provider evidence uses a separate normative v2 frame. The domain prefix is
`programmable:provider-evidence:v2\0`, followed by the immutable one-byte
subtype tag: safe head `1`, block `2`, runtime code `3`, dynamic attestation
`4`, or bounded log coverage `5`. The checked-in v2 fixture fixes every field
order and width, UUID bytes, nullable markers, length framing, ordered arrays,
complete runtime bytes, complete preimages, Keccak digests and one-field
mutation checks. Its per-subtype and aggregate definition commitments exactly
match the SQL allowlist; changing a field requires a new encoding version,
not an in-place reinterpretation.

The database treats `encoding_version`, `canonical_preimage` and
`content_fingerprint` as opaque immutable provenance. Audited functions:

- admit only immutable, migration-allowlisted encoding versions and their
  exact domain prefixes;
- validate structured address, hash, integer, array and release relations;
- store the supplied bytes verbatim;
- return an existing row only when exact replay byte-compares every immutable
  member, including preimage and digest;
- reject a changed preimage, digest, ordering or provenance member.

The evidence v1 frame commits separately, in order, to constructor arguments,
per-instance init-code hash, CREATE2 salt and computed address. None is an
alias for the release artifact creation-code commitment.

Capability fencing plus the reviewed codec establish correctness for a new
digest. SQL does not pretend to authenticate an unseen preimage/hash pair.
Release-binding, current-canonical role, recomputed configuration, dual-provider
agreement and projection-fold checks are relational promotion gates in
addition to that opaque fingerprint provenance; they are not inferred merely
from the existence of a fingerprint row.

## Backup, restore and migration gate

Migrations are additive and append-only. Never edit a migration already
applied to any environment. Before a reviewed hosted migration:

1. Reset an empty local database and run all pgTAP suites.
2. Run all four codec conformance verifiers: independent reference and
   production implementations for v1 and provider-evidence v2.
3. Run the real two-session concurrency harness.
4. Run local lint and migration dry-run inspection without linking production.
5. Run the secret scan over the exact diff.
6. Take a direct-port backup and record the reviewed migration commit.

The deterministic hosted operator and its exact plan, dry-run, apply and
verification sequence are documented in
[`HOSTED-DATABASE-OPERATOR.md`](./HOSTED-DATABASE-OPERATOR.md). Its plan scans
the complete ordered `supabase/migrations/*.sql` set; no hand-maintained
worker manifest is an authority for migration completeness. Migration and
release bootstrap remain separate operations.

Backup and restore must copy the stored fingerprint triple byte-for-byte.
Compare ordered exports of:

```text
(primary key, encoding_version, encode(canonical_preimage, 'hex'),
 encode(content_fingerprint, 'hex'))
```

for safe-head evidence, block evidence, event occurrences, allocation facts
and allocation evidence before and after restore. Do not recanonicalize,
rehash, backfill, silently upgrade an encoding version, or rewrite an old
pair. A new codec version is a new immutable row in
`fingerprint_encoding_versions`; it never updates an old definition or fact.
The replay gate verifies that a stored v1 key remains byte-identical and
idempotent after v2 is allowlisted. Rerun relationship/replay pgTAP tests
after restore and rerun all four codec verifiers from the checked-in constants.

After independently verifying and authorizing the hosted target, use its
direct endpoint on port `5432` for `pg_dump`, `pg_restore`, migrations and
restore validation. A Supavisor connection is not a restore path.

## Retention

No scheduler or `pg_cron` job is installed. Maintenance is an explicit
server-side operation, and each call deletes at most 10,000 eligible rows.

| Data class | Default |
| --- | --- |
| Canonical launches, assets, claims and reward accounting | Indefinite |
| Profiles | Until verified deletion |
| Canonical block evidence | At least 4,096 blocks |
| Orphan/reorg evidence | 400 days |
| Raw market snapshots | 7 days |
| Hourly candles | 90 days |
| Daily candles | Indefinite |
| Five-minute portfolio points | 400 days, then daily aggregates |
| Successful-run telemetry | 30 days |
| Failed/reorg-run telemetry | 180 days |
| Matching parity records | 30 days |
| Resolved mismatches | 180 days after resolution |

Run headers, terminal outcomes, epochs, occurrence/fingerprint evidence,
selected seed history, checkpoints, publications, audits and reconciliation
records are not retention targets. Foreign keys use `RESTRICT`/`NO ACTION`;
retention cannot cascade or null provenance.

## Explicit compatibility boundary

This P0 schema supports the reviewed Classic V3 and Stock-Paired V3 release
families only. Deep-only releases, events, projection rules, routes and reward
semantics are deliberately unsupported and excluded. A Deep integration needs
its own reviewed manifests, event rules, lifecycle tests and release evidence;
it must not reuse these capabilities by relabeling a supported model.

## Troubleshooting

- If `supabase start` reports that Docker is unavailable, start a compatible
  local container runtime. Do not work around this by linking or migrating the
  hosted project.
- If the concurrency harness reports that `psql` is missing, install the
  PostgreSQL client and rerun against the local direct database.
- A passing codec test does not prove migrations, RLS or concurrency.
- A passing local reset does not prove hosted migration, runtime
  connectivity, production activation, provider health or application
  availability.
