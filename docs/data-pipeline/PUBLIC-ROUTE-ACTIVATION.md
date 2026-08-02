# Public route activation

The indexed public route adapters are wired to checkpoint-bound Postgres reader
functions. Their production flags remain off. Legacy reads stay authoritative
until the database migration, projector population, same-checkpoint parity,
load and runtime gates all pass.

## Reader contract

Each reader returns one raw `IndexedRouteEnvelopeV2` plus independently checked
boundary evidence:

- the exact route scope and publication records
- the route checkpoint block number and hash
- record count and record-scope evidence derived from the returned records
- parity, reconciliation and binding commitments for every requested release
- the expected HTTP status for ready, missing and pending outcomes

The API adapter rejects missing, duplicate, incomplete, stale or differently
scoped rows. It never fills absent fields, converts an incomplete row into an
empty result, or combines data from different checkpoints.

The current reviewed scope is Classic V2, Classic V3 and Stock-Paired V1 to V3.
Deep, Adaptive and unknown releases remain outside this boundary.

## Activation gate

Activate one public route at a time only after all of the following are true:

1. The schema migration is applied and the API-reader role can execute only the
   intended reader functions and readiness view.
2. The projector has populated every requested release at one immutable safe
   checkpoint.
3. Authorized release probes show same-checkpoint parity for ready, empty,
   missing, pending, pagination and error outcomes.
4. Stale parity, mismatch, reorg, database failure and cache-isolation tests pass.
5. The production load gate passes without an unacceptable latency or provider
   regression.
6. The integration owner records the reviewed production commit, migration,
   runtime evidence and rollback flag before enabling the route.

An enabled indexed route that cannot prove a current exact snapshot must use the
configured private no-store Legacy fallback or return a private no-store `503`.
The route must never serve an unverified indexed payload.
