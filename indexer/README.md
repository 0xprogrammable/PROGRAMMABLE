# Programmable Ethereum event indexer

This isolated Envio HyperIndex project builds a reorg-aware read model for the
active Programmable releases on Ethereum Mainnet:

- Classic V2 and Classic V3
- Stock-Paired V1, V2 and V3

Classic V1, Adaptive and Deep are intentionally out of scope. Source addresses
and inclusive start blocks are pinned to the checked-in deployment manifests.
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

- Node.js 22 or newer
- pnpm 11.13.1
- Docker for a full local Envio stack

From this directory:

```bash
pnpm install --frozen-lockfile
pnpm codegen
pnpm typecheck
pnpm test
```

Those four validation commands require no production credentials. The test
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
- Canonical zero-byte event data (`0x`) is valid for indexed-only events.
- Duplicate candidate delivery does not increment aggregate fee totals twice.
- Factory events register reward vaults in the same block.
- Envio rollback removes orphaned current-state effects transactionally.

The singleton `IndexerState` reports schema, chain, deployment label, and the
latest processed candidate. Its checked-in deployment label is deliberately
`development-unverified`.

## Production status

Passing local checks or running an Envio development deployment does not make
this indexer a production authority. Production use still requires a reviewed
deployment, historical backfill, dual-RPC reconciliation, parity evidence,
monitoring, provider configuration, and an explicit release decision.

Transaction preparation, claims, and launch availability must continue to
revalidate current manifests, runtime code, ownership, balances, and simulation
results onchain. Indexed entities are read-model inputs, not signing or
authorization evidence.
