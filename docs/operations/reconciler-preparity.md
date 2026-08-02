# Exact-checkpoint reconciler bootstrap

The pre-parity reconciler is intentionally fail closed. It cannot read general
private tables and it cannot use a public indexed route as its own comparison
source.

## Boundary

One request identifies a complete checkpoint:

- chain, release, model and source group
- epoch and pointer generation
- checkpoint ID, block number and block hash

The database reader accepts the request only when every field still identifies
the current checkpoint. It returns the immutable projection fold manifest, the
exact applicable-route eligibility contract and a bounded list of current entity
identities.

The runtime then:

1. Reads that narrow contract and closes the read transaction.
2. Confirms the same block number and hash independently through Alchemy and
   QuickNode. It does not read or compare latest heads.
3. Builds every applicable live DTO once per provider at that exact block.
4. Builds the same indexed DTO set for the same checkpoint.
5. Requires complete route coverage, non-empty comparisons and agreement
   between both live providers.
6. Appends the reconciliation, one parity row and checkpoint binding per
   applicable route, and the terminal outcome through one database function
   call.

An indexed mismatch is stored as a failed reconciliation. It never becomes
current route parity.

## Activation boundary

`POST /api/ops/reconcile-preparity` is protected by `CRON_SECRET`, accepts only
an explicit checkpoint request and returns `Cache-Control: no-store`.

The server now provides the narrow indexed-corpus store and the strict RPC
transport used by an exact-block route reader. The transport binds each source
to its reviewed endpoint commitment, uses EIP-1898 `blockHash` plus
`requireCanonical` for `eth_call`, bounds physical requests and log results,
and verifies the checkpoint before and after each complete source read.

Route coverage is release-specific. Classic V2 covers the four discovery and
creator routes. Stock releases add `launch-lookup`. Classic V3 additionally
covers `classic-v3-profile`, for six routes in total. A release can never gain
parity by submitting an empty DTO for a route it does not serve.

Classic V2, Classic V3 and Stock V1 through V3 each have a release-specific
live builder. Every builder verifies its pinned release runtimes, reconstructs
launch provenance from canonical logs, binds each launch to its successful
transaction and receipt, and reads contract state with EIP-1898 at the agreed
block hash. The shared assembler then materializes only that release's
applicable corpora without depending on current parity:

- `explore-list`
- `explore-token`
- `explore-chart`
- `creator-profile`
- `classic-v3-profile`
- `launch-lookup`

The Stock builders preserve reads for existing launches only. Wiring their
historical reconciliation does not enable a Stock launch path.

Every release is allowlisted independently and remains unavailable until its
own reviewed DTO family is wired. Do not replace a missing builder with public
read views, latest-block calls, event-corpus hashes or a projection identity
comparison. Those substitutions would compare the index with itself or record
parity for a different chain state.

This route is not scheduled. Activation still requires successful fixtures and
provider-backed live dry runs for Classic V2, Classic V3 and all three Stock
releases, production reconciler credentials and complete checkpoint identities
from the projector handoff. The scheduler must never infer a checkpoint from a
latest-block RPC response.
