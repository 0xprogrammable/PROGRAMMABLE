# Receipts, indexing, reorgs and finality

## Current event surface

The foundations-only Core emits four event types:

- `EngineRevisionRegistered`;
- `MarketCreated`;
- `DomainRevisionCreated`; and
- `DomainVaultCreated`.

After block-header and log-inclusion authentication, they are evidence only
that the named transaction emitted the event in the selected canonical block
and, where needed, that corresponding state was read back. There is no
protected execution event or portable normalized Receipt in the current
contract.

The SDK's binding-local Receipt projection preserves each ordered Target's own
Domain Revision list. It is explicitly classified
`BINDING_LOCAL_UNNORMALIZED_RECEIPT_V1`; it is not a portable Receipt. The
portable schema flattens Domains into a global set and cannot preserve the
required Target-to-Domain relation or derived identities (`SPEC-GAP-007`).

## Indexer rules

Use the SDK `CanonicalEventBuffer` with an authenticated Core address, chain ID,
allowed topic set and authenticated block headers. Apply logs in
`(blockNumber, transactionIndex, logIndex)` order, deduplicate exact repeated
logs, reject conflicting log positions and incoherent transaction-index/hash
identities, and retain enough bounded blocks to unwind expected L2 reorgs.

A restart checkpoint must bind chain, Core, block number/hash, next block,
derived-state digest and the exact checkpoint policy. If the next block does not
extend that checkpoint, stop for reconciliation; never silently append another
branch. Backfill ranges and per-block/log memory are explicitly bounded.

## Confirmation depth is not finality

An L2 confirmation depth is a reorg-buffer heuristic only. It is not proof of
sequencer inclusion in an Ethereum batch, challenge-period completion, parent
chain finality or Ethereum finality. Call it `confirmation-depth-only`.

To label a checkpoint externally finalized, supply an independently defined
finality policy and authenticate the block under that policy. Persist its policy
ID with the checkpoint. Robinhood's public RPC `finalized` tag is useful dated
single-provider evidence, but the recorded observations lack a second-provider
quorum and separate proof of the containing L1 batch and finalized parent block.

## Robinhood Chain observations

The network records distinguish immutable block-zero identity from mutable
heads, endpoint behavior and client versions. At `2026-08-29T13:48:50Z`, the
official public RPC returned finalized-tag anchors recorded in
[`4663.json`](../../config/networks/robinhood-chain/4663.json) and
[`46630.json`](../../config/networks/robinhood-chain/46630.json). Refresh mutable
observations at release time; never bake them into Core semantics.

The public endpoints did not expose `eth_syncing` (`-32601`), so their sync state
was not verified. `ArbSys.arbOSVersion()` returned 116, which is consistent with
documented ArbOS 61 because the canonical ArbSys interface returns `55 +` the
Nitro ArbOS version. The actual dated version drift is the documentation's node
image example `v3.11.2-3599aca` versus live public clients
`v3.11.3-rc.9-beb2108`; neither value is stable chain identity.
