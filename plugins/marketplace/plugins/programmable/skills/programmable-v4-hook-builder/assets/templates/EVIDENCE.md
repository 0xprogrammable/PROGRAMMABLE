# Evidence

Use this file to record structured evidence and review notes for one exact submission revision.

Every completed gate records its gate id, exact command, tool version, 40-character evidence-origin commit, artifact
path, content hash, result, scope, and exact review-target hash. The origin commit is provenance and may precede the
later packaging HEAD; exact intake identity comes from the committed review target and primary GitHub source binding.

Dependency evidence uses stable ids. For an onchain dependency, record chain, address, interface, source revision,
runtime hash, block, RPC class, and trusted deployment record when available. For an offchain dependency, record source
revision, integrity where available, operator, authentication, freshness, funding, failure, and fallback.

Separate builder statements, agent derivations, local tool results, independent review, deployment receipts, source
verification, runtime matching, lifecycle proof, routing review, and product availability.

## Prototype evidence

List the exact compatibility report, review-target hash, compiler and dependency closure, test runs, static-analysis
dispositions, fork block, gas and size results, permission mask, CREATE2 plan, and independent reviews. Mark missing,
skipped, flaky, reverted, or unavailable checks as blockers.

## Accepted-model integration evidence

Use this section only when a maintainer acceptance record exists. Bind its path and content hash, model id, version,
prototype commit, submission hash, review-target hash, accepted scope, and open conditions. Do not create or edit the
acceptance record here.

For UI, API, indexer, quote, trade, claim, and monitoring, record:

- Owner, exact source paths, source of truth, dependencies, and accepted model version
- Executable command or manual protocol, tool version, commit, result, artifact, and content hash
- Covered inputs, outputs, errors, unsupported states, stale or reorg behavior, and recovery
- Remaining blocker and next owner action

## Release gate ledger

Track maintainer acceptance, platform implementation review, deployment authorization, deployment execution, source
verification, runtime matching, lifecycle verification, Hooklist/routing/discovery decisions, and product availability
separately. Each row needs its human owner, exact evidence, current state, blocker, and next action.

Contributor-owned `gate-status.json` can record prototype checks only. It cannot complete any row in this release
ledger. A completed row points to a maintainer-owned record bound to the accepted release, relevant commits, chain and
deployment identity where applicable, evidence hashes, reviewer, and decision time.

Use `programmable-registry-integration-review`, `programmable-ui-integration-review`,
`programmable-api-integration-review`, `programmable-indexer-integration-review`, and
`programmable-integration-test-review` for maintainer-owned candidate review. Keep `uniswap-hook-routing-review` and,
when applicable, `permissioned-pool-routing-allowlist` external.

Do not add credentials, signing material, unpatched vulnerability details, generated build directories, or claims that a
local check proves audit, acceptance, product integration, deployment, verification, routing approval, provider support,
or production availability.
