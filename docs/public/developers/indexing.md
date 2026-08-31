---
description: Index Programmable launches with finality, cursor completeness and explicit data quality
---

# Index Programmable launches

An Ethereum indexer can use the normalized v2 feed or reproduce Router records directly. Robinhood Chain V4 uses the separate planned feed described below. In every case, finality, cursor traversal and unknown data need explicit handling.

The normalized launch feed returns versioned records for Classic and Registry-verified Custom launches. Consumers should follow every cursor until completion, remove duplicate launch ids and retain records when optional price, chart or liquidity data is unavailable. A missing chart or quote is not permission to discard a valid launch record.

Direct Router indexing starts at the manifest's current start block. Process the published events in canonical order, retain block and log identity, and roll back records affected by a reorganization before finality. Cross check token or pool lookups at one canonical block before exposing the public label.

Price and liquidity data should carry its own source, timestamp, status and quality. When a current value cannot be established, expose that state directly rather than converting the last launch transaction into a current valuation.

The Ethereum public status endpoint reports feed freshness, chain head, scan coverage and current counts. Production consumers should alert on lag and incomplete traversal instead of treating service availability as freshness.

## Prepare Robinhood V4 indexing before activation

Robinhood Chain Mainnet (`chainId: 4663`, `eip155:4663`) has a stable planned
[V4 OpenAPI contract](https://programmable.market/openapi/custom-launch-v4.json). You can generate types, validate
feed fixtures, map ABI topics and build cursor, quality and reorg handling now. This is integration preparation only.
While discovery says `planned` and `planned-not-deployed`, live V4 ingestion is unavailable. A downloadable schema,
an onchain foundation deployment or an HTTP `200` for the schema does not activate the API. Start network polling only
after [Programmable discovery](https://programmable.market/.well-known/programmable.json),
`GET /v4/chains/4663/capabilities` and `/readyz` bind the live chain deployment and finalized feed. The planned V4
capabilities and finalized-feed routes currently return `404`, and the public Developer API v2 does not support chain
`4663`; it remains an Ethereum integration surface. The deployed foundation has no Router-stamped launch event yet.

After activation, read the public, keyless
`GET /v4/chains/4663/finalized-custom-launches` feed. Validate every response and item against both chain identifiers,
then apply these rules:

- Publish only items with `onchain.terminal: true` and `onchain.checkpointType: ethereum_finalized`. Store the chain
  deployment ID and descriptor digest, Router, Router runtime hash, Router launch ID, transaction hash, block number and
  hash, log index, finality-policy binding, evidence digest and observation time. A sequencer soft confirmation or
  Ethereum posting is not finality.
- Store `projectMetadata.token` with `projectMetadata.tokenMetadataBinding.tokenTargetId`. Resolve the token address by
  matching that target ID to `sourceVerification.components[*].targetId` and its address; never identify a token by
  name or symbol alone.
- Keep each source-verification component keyed by both `targetId` and address and preserve its server-authored status.
  Finalized means the launch reached Robinhood-to-Ethereum finality; it does not mean every component is an
  `exact_match`.
- Read top-level `quality.status` as `ready`, `partial`, `stale` or `unavailable`, together with the source, published
  and quarantined row counts. A successful response is not a complete inventory when quality is not `ready`.

The request accepts an optional `limit` from 1 to 25 and defaults to 10. The response returns an opaque `nextCursor`;
pass each non-null value back unchanged as `cursor` and never decode or construct one. Declare traversal complete only
after `nextCursor` is null and quality remains `ready`.

Direct Robinhood Router indexing starts only after activated discovery or its canonical manifest publishes the exact
live Router address, runtime hash, ABI and event bindings, start block and finality policy, and provider readback agrees
with that binding. Do not backfill from a source candidate, an address embedded in a schema or one deployment
transaction. Advance the public checkpoint only through the published Robinhood-to-Ethereum finality proof.
Enable a terminal's Robinhood launch label only after those manifest roots are active, a finalized canary is present in
the feed and the complete traversal reports `quality.status: ready`.

Indexability proves neither trading compatibility nor current price, liquidity, fee behavior, source verification or
safety. The optional post-finality Universal Router trading-descriptor path is deliberately disabled, and V4 finalized
items publish no such descriptor. A V4 Quoter call does not prove that an arbitrary hook can execute through Universal
Router. Unless a later public schema and capabilities contract enables a server-authored descriptor backed by an exact
Universal Router execution proof, terminals should display launch identity only and must not infer a route from a
Router address, PoolKey or project metadata.

## Index protocol fee claims separately

The public launch feed is not itself the protocol fee claim queue. The claim
inventory follows the exact execution contracts:

- Classic V2 and V3 coin rows come from complete canonical Launcher event
  scans. Fee execution remains one aggregate claim per verified version hook;
  the legacy V1 aggregate hook remains a separate row.
- A Router-stamped Classic launch is covered automatically only when its exact
  hook matches a known verified aggregate hook. An unknown Classic hook remains
  visible and blocks the combined claim.
- The complete Registry history remains available for audit, but Custom
  Registry V1 is retired as a live discovery or claim source.
- Router-stamped Custom launches come from a consensus-finalized Router event
  replay. The claim console requires the Wallet RPC and two independent public
  RPCs to report `finalized` views no more than 32 blocks apart. It uses the
  oldest view as the safe boundary, requires all three RPCs to return its exact
  block hash, then requires the exact same complete raw log tuples through that
  checkpoint. It then verifies every launch record, token or pool lookup,
  component proof, runtime and displayed claim balance at that same checkpoint.
- A Custom claim is executable only through an exact reviewed profile bound to
  its launch ID, token, fee source and runtime. The current profiles cover
  FADE's native accumulator, SHARD's direct launcher-fee claim, PCAN's
  dual-currency PoolManager redemption and PCR2's two-currency fee Vault.
  PCR2's native and token balances are independent claim calls, and only
  positive balances enter the batch. Future Router-stamped Custom launches are
  discovered and remain visible, but a new or unknown claim ABI blocks the
  combined claim until an exact profile is reviewed. The console does not
  provide universal arbitrary Custom support and never guesses calldata from
  selectors or bytecode shape.
- Stock claims use the published fixed release asset set. New Stock assets are
  not inferred or silently added.
- Custom V2 remains unavailable until an exact deployed and finalized release
  binding exists. Unknown, mismatched or unverified bindings block the combined
  claim. Quarantined sources remain visible and non-executable.

The live console publishes this boundary at
[`claimhazard.vercel.app/claim-discovery.json`](https://claimhazard.vercel.app/claim-discovery.json).
It rescans before every claim and includes only positive verified entries in one
wallet-declared atomic batch from the fixed reward wallet. Its immediate latest
simulation can include fees accrued after the displayed finalized balance. The
current safe limit is 64 calls; overflow blocks execution instead of silently
omitting a claim. Before opening the wallet, the console persists an app-defined
batch ID under an origin-wide tab lock. A confirmed batch remains locked across
reloads until its exact transaction and block receipts agree across all three
RPCs and the Router checkpoint has finalized them. Off-chain failures and full
reverts may unlock automatically; partial or ambiguous outcomes remain locked
for manual reconciliation. If the page closes during wallet submission, the
saved call set can only be resumed with the same app-defined ID; it is never
rebuilt as a second batch.
