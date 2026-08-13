# Historical Envio candidate record

This document is retained only to identify the obsolete `production-7f24e63`
candidate at endpoint ID `d7a39a2`. It is not a current deployment, promotion,
rollback or operator runbook.

The canonical production release is `production-92f6373` at endpoint ID
`f6714ef`, as bound by `config/data-pipeline-release.v1.json`. The old candidate
must not be rebound to that release, selected through
`PROGRAMMABLE_PROJECTOR_BINDING_MODE`, deployed, promoted or used for database
activation.

The immutable JSON audit and deployment records under `docs/data-pipeline/`
remain historical evidence. Do not edit or reinterpret them as current state.

Any future Envio candidate requires a new source revision, separately deployed
endpoint, complete inventory and policy evidence, and an independently reviewed
release procedure. The current staged read-model procedure is
[`../operations/read-model-scheduler-cutover.md`](../operations/read-model-scheduler-cutover.md)
and stops when current database activation authority is absent.
