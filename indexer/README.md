# Programmable Ethereum event indexer

This isolated Envio HyperIndex project builds a reorg-aware read model for the
active Programmable releases on Ethereum Mainnet:

- Classic V2 and Classic V3
- Stock-Paired V1, V2 and V3

All other releases are intentionally out of scope. Source addresses and
inclusive start blocks are pinned to the checked-in deployment manifests.
Shared Stock V2/V3 hook and vault-factory events are attributed only after an
indexed `poolId` relation identifies the release.

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

## Production status

Passing local checks or running an Envio development deployment does not make
this indexer a production authority. Production use still requires a reviewed
deployment, historical backfill, dual-RPC reconciliation, parity evidence,
monitoring, provider configuration, and an explicit release decision.

Transaction preparation, claims, and launch availability must continue to
revalidate current manifests, runtime code, ownership, balances, and simulation
results onchain. Indexed entities are read-model inputs, not signing or
authorization evidence.
