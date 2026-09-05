---
description: Verify claim inventory and eligibility separately from launch discovery
---

# Protocol fee claim discovery

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
