# Programmable Ethereum event indexer

This isolated Envio HyperIndex project builds a reorg-aware read model for the
active Programmable releases on Ethereum Mainnet:

- Classic V2 and Classic V3
- Classic V4 source candidate
- Stock-Paired V1, V2 and V3

Classic V4 ABI, handlers, and finalized Mainnet source addresses are present in
the source-only candidate. They do not activate the product release binding or
public website before the provider-backed Envio deployment, backfill, parity
audit, and manifest gates pass. All other releases are intentionally out of
scope. Source addresses and inclusive start blocks are pinned to finalized
deployment evidence.
Shared Stock V2/V3 hook and vault-factory events are attributed only after an
indexed `poolId` relation identifies the release.

The live Custom Registry V1 event sources remain as a compatibility-only
read-model prefix so an Envio replacement cannot silently lose the provider's
current event history. This does not restore V1 as launch, discovery, claim, or
website authority. Custom Registry V2 remains a separate inactive prelaunch
source until its own deployment and release gates pass. The immutable
`live-production-92f6373.config.yaml` snapshot makes every replacement prove a
semantic source-and-event superset of the currently deployed Envio surface.

## Safety boundary

Envio stores fork-specific candidate occurrences. A candidate ID is:

```text
1:<block-hash>:<transaction-hash>:<block-global-log-index>
```

The block-global log index is not treated as a durable application identity.
`receiptLogOrdinal` and `downstreamLogicalId` remain unset here. A separate
application worker must compare receipts from two independent RPC providers,
match the exact candidate log, derive the receipt-local ordinal, and only then
write the logical identity.

Handlers write only to Envio's transactional entity store. They do not call
Supabase, Blob storage, RPC endpoints, webhooks, files, or other external
systems. Beneficiary seed hydration is a separate block-pinned dual-RPC worker.

## Local setup

Requirements:

- Node.js 24.14 or newer, below Node 25
- pnpm 10.32.0
- Docker for a full local Envio stack

From this directory:

```bash
pnpm install --frozen-lockfile
pnpm codegen
pnpm typecheck
pnpm test
```

Those three validation commands require no production credentials. The test
suite uses Envio's typed `createTestIndexer()` simulations. Dynamic-registration
fixtures extend the simulated head by the configured 12-block lag so that the
factory block is finalized.

For a local historical sync, copy `.env.example` to `.env`, provide a local
Envio API token if HyperSync requests one, then run:

```bash
pnpm dev
```

Generated `.envio/` output, local environment files, databases, and coverage
artifacts are ignored. `envio-env.d.ts` and `pnpm-lock.yaml` are committed for
reproducible code generation and installs.

## Data guarantees

- Ethereum Mainnet only, with a 12-block lag and 200-block reorg depth.
- Lowercase addresses and hashes.
- Exact bigint accounting; no floating-point arithmetic.
- Deterministic payload hashes over reconstructed event topics and data.
- Full uint32 transaction, block-global log, and receipt-local ordinal domains;
  Envio stores them as exact `BigInt` values rather than GraphQL `Int`.
- Canonical zero-byte event data (`0x`) is valid for indexed-only events.
- Duplicate candidate delivery does not increment aggregate fee totals twice.
- Factory events register reward vaults in the same block.
- Envio rollback removes orphaned current-state effects transactionally.

The singleton `IndexerState` reports schema, chain, the latest processed
candidate, and the complete deployment identity. A reviewed deployment must
set `ENVIO_DEPLOYMENT_LABEL`, `ENVIO_SOURCE_COMMIT`, `ENVIO_CONFIG_SHA256`,
`ENVIO_SCHEMA_SHA256`, `ENVIO_HANDLER_SHA256`,
`ENVIO_SOURCE_REGISTRY_SHA256`, `ENVIO_EVENT_SET_SHA256`, and
`ENVIO_EVENT_COUNT`. Any missing, malformed, uppercase, zero-sentinel, or
incomplete value fails the whole identity closed to `development-unverified`.
Accepted labels use lowercase ASCII letters, digits, `.`, `_`, and `-`,
beginning with a letter or digit.

Keep the default for local and unreviewed deployments. A production promotion
can set an explicit immutable reviewed label such as
`production-reviewed-2026-07-31` together with commitments computed from the
exact deployed commit. These fields record identity only; they are not proof
that the deployment passed the production gates below.

## Deployment identity

The runtime validates the complete identity supplied through the eight
`ENVIO_*` environment variables above and fails closed when any commitment is
missing or malformed. Artifact generation, historical baseline reproduction,
and Envio deployment evidence are owned by the canonical
[`programmable-indexer`](https://github.com/0xprogrammable/programmable-indexer)
repository so a clean product checkout never depends on Git objects from a
different repository.

The four artifact commitments are SHA-256 hashes of the exact bytes in
`config.yaml`, `schema.graphql`, `src/EventHandlers.ts`, and
`src/lib/release-map.ts`. The event-set commitment is generated separately:

1. Read every `contracts[].events[].event` signature from `config.yaml`.
2. Keep repeated signatures when different contracts emit the same event.
3. Sort the UTF-8 signatures bytewise.
4. Join them with `\n`, append one final `\n`, and hash those bytes with
   SHA-256.

The product release binding remains pinned to the last activated Envio
identity until a new indexer deployment has been reviewed, backfilled,
reconciled, and explicitly promoted. A candidate source checkout or passing
local test must not update that binding.

## Classic V4 source activation

The source-only candidate binds the finalized V4 hook and launcher in
`chains[].contracts`; this alone does not change the canonical product release
binding. Once the complete `contracts/deployments/mainnet-classic-v4.json` and
an independently promoted Envio candidate identity exist, generate the exact
append-only release binding without mutating the frozen base binding:

```bash
pnpm release:classic-v4-binding -- \
  --manifest </absolute/mainnet-classic-v4.json> \
  --identity </absolute/envio-candidate-identity.json> \
  --endpoint https://indexer.hyperindex.xyz/<endpoint-id>/v1/graphql \
  --output </absolute/classic-v4-release-binding.json>
```

The generator requires the complete finalized source and lifecycle manifest,
verifies that the checked-out V4 source markers match it exactly, preserves the
entire existing source and release prefixes, and appends only the V4 hook,
launcher, and `classic-v4` release fragment. The output is then an input to the
immutable Envio candidate audit. After that audit exists, inspect the
deterministic activation plan:

```bash
pnpm classic-v4:activate -- \
  --release-audit </absolute/immutable-envio-release-audit.json>
```

The command rejects missing or mismatched provenance, a wrong hook flag mask,
source collisions, any reward/vesting factory that differs from the exact
already-bound shared factory, and an audit whose control-plane identity, live
`IndexerState`, frozen inventory, release-binding digest, or Classic V4 canary
does not match. The audit must be emitted by `release-candidate.mjs audit`; a
bare hand-authored binding is not an activation input. The command commits the
typed, domain-separated digest of that exact expanded binding into the final
manifest and does not write by default. To apply the exact manifest after
review, provide the same immutable audit and its printed final manifest digest:

```bash
pnpm classic-v4:activate -- \
  --release-audit </absolute/immutable-envio-release-audit.json> \
  --write \
  --acknowledge-manifest-digest 0x<exact-manifest-digest>
```

This binds the exact V4 hook/launcher addresses and deployment blocks in the
indexer sources, writes the separate V4 catalog artifact and browser binding,
then replaces the canonical manifest last under an exclusive, fsynced durable
transaction journal. A restart rolls back any prefix before that commit point
and cleans up a fully committed transaction. It does not deploy Envio or mutate
the frozen five-release `config/data-pipeline-release.v1.json`; the reviewed
expanded Envio deployment must already exist before this command can activate
the website catalog.

Public wallet actions remain disabled after indexer activation. After the
indexed canary parity and separate public-availability decision are complete,
inspect the deterministic source transition:

```bash
pnpm classic-v4:public:promote
```

The check accepts only the exact `indexer-activated` manifest, its committed
browser binding and the matching Envio catalog artifact. It prints the newly
digested `publicly-available` manifest without writing. Apply that exact result
only after review:

```bash
pnpm classic-v4:public:promote -- \
  --write \
  --acknowledge-manifest-digest 0x<exact-public-manifest-digest>
```

The command changes only the canonical manifest, browser binding and catalog
digest under the same durable activation lock, with the manifest written last
as the commit point. It does not deploy, promote a Vercel alias, configure the
backend, request a wallet signature or broadcast a transaction.

## Production status

Passing local checks or running an Envio development deployment does not make
this indexer a production authority. Production use still requires a reviewed
deployment, historical backfill, dual-RPC reconciliation, parity evidence,
monitoring, provider configuration, and an explicit release decision.

Transaction preparation, claims, and launch availability must continue to
revalidate current manifests, runtime code, ownership, balances, and simulation
results onchain. Indexed entities are read-model inputs, not signing or
authorization evidence.
