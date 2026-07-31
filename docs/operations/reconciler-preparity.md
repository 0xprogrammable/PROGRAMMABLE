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
exact six-route eligibility contract and a bounded list of current entity
identities.

The runtime then:

1. Reads that narrow contract and closes the read transaction.
2. Confirms the same block number and hash independently through Alchemy and
   QuickNode. It does not read or compare latest heads.
3. Builds all six live DTOs once per provider at that exact block.
4. Builds all six indexed DTOs for the same checkpoint.
5. Requires complete route coverage, non-empty comparisons and agreement
   between both live providers.
6. Appends the reconciliation, six parity rows, six checkpoint bindings and the
   terminal outcome through one database function call.

An indexed mismatch is stored as a failed reconciliation. It never becomes
current route parity.

## Production wiring still required

`POST /api/ops/reconcile-preparity` is protected by `CRON_SECRET`, accepts only
an explicit checkpoint request and returns `Cache-Control: no-store`.

The endpoint currently returns `503` until a reviewed exact-block route DTO
reader is supplied to `runConfiguredReconcilerPreParity`. The reader must build
the following route DTOs without depending on current parity:

- `explore-list`
- `explore-token`
- `explore-chart`
- `creator-profile`
- `classic-v3-profile`
- `launch-lookup`

Do not replace the missing reader with public read views, latest-block calls or
event-corpus hashes. Those substitutions would compare the index with itself or
record parity for a different chain state.

Only after the reader has its own exact-checkpoint tests and the production
reconciler credentials are provisioned should the endpoint be added to
`vercel.json`. The scheduler must first obtain the complete checkpoint identity
from the projector handoff; it must not infer a checkpoint from a latest-block
RPC response.
