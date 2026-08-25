---
description: Index Programmable launches with finality, cursor completeness and explicit data quality
---

# Index Programmable launches

An indexer can use the normalized v2 feed or reproduce Router records directly. In both cases, finality, cursor traversal and unknown data need explicit handling.

The normalized launch feed returns versioned records for Classic and Registry-verified Custom launches. Consumers should follow every cursor until completion, remove duplicate launch ids and retain records when optional price, chart or liquidity data is unavailable. A missing chart or quote is not permission to discard a valid launch record.

Direct Router indexing starts at the manifest's current start block. Process the published events in canonical order, retain block and log identity, and roll back records affected by a reorganization before finality. Cross check token or pool lookups at one canonical block before exposing the public label.

Price and liquidity data should carry its own source, timestamp, status and quality. When a current value cannot be established, expose that state directly rather than converting the last launch transaction into a current valuation.

The public status endpoint reports feed freshness, chain head, scan coverage and current counts. Production consumers should alert on lag and incomplete traversal instead of treating service availability as freshness.

## Index protocol fee claims separately

The public launch feed is not itself the protocol fee claim queue. The claim
inventory follows the exact execution contracts:

- Classic V2 and V3 coin rows come from complete canonical Launcher event
  scans. Fee execution remains one aggregate claim per verified version hook;
  the legacy V1 aggregate hook remains a separate row.
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
  its launch ID, fee source and runtime. The current profiles cover FADE's
  native accumulator and PCAN's dual-currency PoolManager redemption. A new or
  unknown profile remains visible and blocks the combined claim until reviewed;
  the console never guesses calldata from a selector match.
- Stock claims use the published fixed release asset set. New Stock assets are
  not inferred or silently added.
- Custom V2 remains unavailable until an exact deployed and finalized release
  binding exists. Unknown, revoked, mismatched or unverified sources block the
  combined claim instead of disappearing from the result.

The live console publishes this boundary at
[`claimhazard.vercel.app/claim-discovery.json`](https://claimhazard.vercel.app/claim-discovery.json).
It rescans before every claim and includes only positive verified entries in one
wallet-declared atomic batch from the fixed reward wallet. Its immediate latest
simulation can include fees accrued after the displayed finalized balance. The
current safe limit is 64 calls; overflow blocks execution instead of silently
omitting a claim.
