---
description: Discover Programmable launches, verify their provenance and keep a complete index
---

# Index launches

Choose direct Router indexing or a hosted feed. Keep launch identity separate from metadata, market data and trading
support. A recognized launch stays visible when a chart, price or quote is unavailable.

| Task | Integration |
| --- | --- |
| Index stamped launches from chain data | [Direct Router indexing](#direct-router-indexing) |
| Index Robinhood Custom launches | [Robinhood terminal integration](robinhood-terminal-indexer.md) |
| Read normalized Ethereum launches | [Developer feed](#read-the-developer-feed) |
| Import Robinhood finalized metadata | [V4 finalized feed reference](reference/robinhood-finalized-feed.md) |

## Direct Router indexing

1. Select the chain through [Developer discovery](https://developers.programmable.family/.well-known/programmable.json).
   Validate its Router address, start block, runtime hash, ABI and deployment evidence.
2. Backfill the advertised Router events in bounded block ranges through the published finalized boundary.
3. Verify each candidate's token or pool lookup, `launchStamp`, address-based `stampProof` and runtime bindings at the
   same canonical finalized block. A log alone is insufficient.
4. Deduplicate logs by chain, transaction hash and log index. Scope launch identity by chain, Router and launch ID.
5. Commit verified records before advancing the checkpoint. Replay an overlap window and rewind to the last common
   checkpoint on a block-hash disagreement.

Use the [Router reference](https://github.com/programmablehq/Developers/blob/main/docs/reference/launch-stamp.md#onchain-backfill-and-live-follow)
for the complete algorithm. The same process discovers future qualifying Custom launches by any developer without a
per-token or per-hook allowlist.

## Read the Developer feed

The Developer v2 feed is read only. Ethereum combines manifest-enabled Classic releases and accepted Custom records.
Select `chainId=1`, keep the same filters through every traversal, and follow every `page.nextCursor` until
`page.hasMore` is false. Commit records before persisting `page.resumeCursor` for the next `after` poll.

Check coverage, freshness and quality as well as HTTP status. A degraded or unavailable feed does not establish
absence. Preserve nulls and unknown fields. Price and liquidity need their own source and observation time.

The [hosted feed reference](https://github.com/programmablehq/Developers/blob/main/docs/reference/hosted-feed.md)
contains the bounded JavaScript implementation and failure handling.

## Integrate Robinhood V4

Direct Router verification uses the [chain-4663 Developer manifest](https://developers.programmable.family/api/v2/manifests/4663)
and its finality policy. It is independent of launch-API write activation and hosted-feed availability.

The separate [V4 finalized metadata feed](reference/robinhood-finalized-feed.md) has stricter publication requirements:
complete V3 finality coordinates, canonical Router provenance and authoritative aggregate and component
`sourceVerification.status: exact_match`. Validate its exact OpenAPI binding and traverse every page through a null
cursor with `quality.status: ready` before treating the feed traversal as complete. Those requirements apply to that
feed; its failure does not erase independently verified Router provenance.

Resolve public write activation through live API discovery, capabilities and readiness as described in the
[Custom Launch API guide](custom-launch.md#robinhood-chain-v4). A reachable endpoint does not authorize a launch.

## Display a Programmable label

The public categories are `classic` and `custom`. Assign the corresponding label only after its accepted launcher,
Registry or canonical Router evidence verifies. A token name, factory address or API response cannot assign it.

A direct, finalized `CustomGraph = 1` stamp can establish `Programmable Custom` without a hosted metadata record.
Source verification, third-party indexing and market support remain separate. Each terminal must implement the
integration; publication of these docs does not establish that a named terminal has done so.

The optional Universal Router trading descriptor is a separate contract. Do not infer an executable route from a
PoolKey, a Router address, a Quoter response or project metadata. A stamp alone does not establish trading compatibility,
current price, liquidity, fee behavior or safety.

## Index protocol fee claims separately

Launch visibility does not establish claim eligibility. Use the [protocol fee claim reference](reference/protocol-fee-claims.md)
for the exact inventory, completeness, supported profiles and wallet boundary.
