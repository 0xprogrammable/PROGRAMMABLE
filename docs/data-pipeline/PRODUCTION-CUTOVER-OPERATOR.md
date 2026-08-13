# Historical candidate cutover retired

This document no longer authorizes a production cutover.

The former procedure bound the candidate deployment `production-7f24e63` at
`d7a39a2`. The canonical production release now binds `production-92f6373` at
`f6714ef`. Treating the older deployment as an unpromoted candidate for the
current release would make the evidence false, so every mutation command in
`scripts/data-pipeline/cutover-operator.mjs` and every historical candidate
bootstrap command fails closed.

The immutable audit and deployment records for the former candidate remain in
`docs/data-pipeline/` for provenance. They are historical evidence, not current
operator inputs.

The current staged read-model procedure is
`docs/operations/read-model-scheduler-cutover.md`, rendered here as
[`../operations/read-model-scheduler-cutover.md`](../operations/read-model-scheduler-cutover.md).
It stages an exact deployment without changing the production alias. A later
manual promotion of that exact deployment requires its own current,
independently reviewed release evidence. Nothing in this retired runbook grants
authority to change the production deployment at https://programmable.market.

To introduce another candidate database cutover, create a new candidate
deployment, inventory and policy evidence as a distinct input. Do not mutate or
relabel the current production release or the retained historical evidence.
