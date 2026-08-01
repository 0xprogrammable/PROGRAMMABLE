# Read-model scheduler cutover

The production scheduler keeps the durable legacy index active while the
Postgres read model is staged. This avoids a gap in Explore or token discovery
during backfill and parity checks.

## Schedule

| Worker | Route | UTC schedule | Activation |
| --- | --- | --- | --- |
| Legacy index | `/api/ops/index-v2` | Every five minutes | Retained until indexed reads are promoted |
| Source projector | `/api/ops/projector` | Every minute | `PROGRAMMABLE_PROJECTOR_ACTIVE=true` |
| Market projector | `/api/ops/market-projector` | Every minute | `PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE=true` |

Each projector has its own singleton execution guard. A second invocation
returns busy instead of overlapping an unfinished run. The market projector
only reads the last fully committed source checkpoint, never in-flight source
state. Both routes require Vercel's `CRON_SECRET` bearer token. Missing or exact
`false` activation values are harmless disabled runs. Exact `true` is the only
active value. Any other non-empty value is a configuration error and must fail
closed.

`/api/ops/index-v2` is the only legacy writer route. The former
`/api/ops/index` alias is permanently closed and is not scheduled.

The route, runtime and migration SHA-256 values in
`config/read-model-operations.v1.json` are release inputs, not documentation.
The operations gate rejects any byte drift until the changed source is reviewed
and the approved digest is updated in the same commit.

The pre-parity reconciler is deliberately absent from `vercel.json`. It remains
manual until its exact-block reader covers every active Classic and Stock-Paired
release family.

## Promotion order

Before this workflow is enabled, turn off **Auto-assign Custom Production
Domains** for the Vercel project. Git-connected production pushes must create
deployments without moving `programmable.family`; only the reviewed workflow
may promote it. The workflow records the current deployment before staging and
fails if Vercel has already moved production to the candidate commit.

1. Apply and test every migration named in
   `config/read-model-operations.v1.json`.
2. Backfill Envio and Postgres at an exact, recorded checkpoint.
3. Enable the source projector and prove it catches up without partial-block
   publication.
4. Enable the market projector and prove its market lineage at the same source
   checkpoint.
5. Capture signed staged-deployment evidence and run the release gate.
6. Promote the exact staged deployment ID, never a mutable alias.
7. Verify that `programmable.family` resolves to that deployment ID and commit,
   then verify health, populated Explore, the token list, and every indexed
   route using the same release corpus.
8. Enable indexed read flags only after every check is green.
9. Remove the legacy cron in a later reviewed cutover commit.

Source files, migrations, schedules, activation names, workflow ordering and
post-promotion probes are checked by `npm run perf:read-model:ops-gate`.

## Failure behavior

An unauthorized cron call returns `401`. Invalid configuration, unavailable
dependencies or incomplete evidence returns `503` with `Cache-Control:
no-store`. A disabled worker does not open database or RPC connections. Public
read flags stay on the legacy path until signed release evidence for the exact
Vercel deployment is accepted. If any post-promotion binding or route check
fails, the workflow rolls the production domains back to the exact deployment
captured before staging and verifies that rollback binding.
