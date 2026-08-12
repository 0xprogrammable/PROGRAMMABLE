# Evidence

> Authoring scaffold: replace every instruction and empty row below with attributable evidence, a truthful pending/
> blocked state, or an explicit not-applicable reason. Do not retain the instructional prose in the completed artifact.

Use this file to record structured evidence and review notes for one exact submission revision.

Every completed gate records its gate id, exact command, tool version, 40-character evidence-origin commit, artifact
path, content hash, result, scope, and exact review-target hash. The origin commit is provenance and may precede the
later packaging HEAD; exact intake identity comes from the committed review target and primary GitHub source binding.

## Authority and package provenance

| Authority | Exact immutable revision, id, digest, or allowed files | Revalidation result |
| --- | --- | --- |
| Trusted intake workflow or service |  |  |
| Pull-request target base |  |  |
| Validator and package contract |  |  |
| Builder skill and approval criteria |  |  |
| Programmable fee policy |  |  |
| Primary numeric repository id, commit, tree, retained bundle digest |  |  |
| Companion numeric repository ids, commits, trees |  |  |

Record `PACKAGE_CONTRACT_DRIFT` when these authorities disagree. Do not convert platform release drift into an
applicant security finding or hand-edit one package generation into another.

Dependency evidence uses stable ids. For an onchain dependency, record chain, address, interface, source revision,
runtime hash, block, RPC class, and trusted deployment record when available. For an offchain dependency, record source
revision, integrity where available, operator, authentication, freshness, funding, failure, and fallback.

Separate builder statements, agent derivations, local tool results, independent review, deployment receipts, source
verification, runtime matching, lifecycle proof, routing review, and product availability.

## Tool coverage and independence

| Property or scope | Tool or method | Exact command/version | Result taxonomy | Artifact/hash | Code author | Test/assertion author | Independent reproducer |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  | passed / failed / tooling-blocked / no-data / not-applicable-with-reason / inconclusive |  |  |  |  |

All tools unavailable, parser failure, or empty output is not clean. Trace scanner candidates to reachability, attacker
control, impact, and a focused reproduction. Same-run agent-generated code and tests are builder evidence, not
independent confirmation. For intermittent failures, cluster up to the last five comparable runs by normalized signature
and preserve the cause of every earlier attributable failure.

## Run-scoped manifest and attestation

Record the unique run id/attempt, immutable subject path and sha256, manifest digest, source/review-target digest,
workflow/service and revision, trigger and environment, skill/criteria/fee/package/validator/tool/ruleset/suppression
digests, commands and outcomes, signer identity and scheme, transparency/retention reference, verification result, and
superseded record. A valid attestation proves exact-byte provenance only; it does not prove correctness, audit,
approval, deployment, or launchability. Shared mutable `latest` output cannot be the attested authority.

## Launch-admission self-check

Apply `references/approval-criteria.md` to the exact immutable target. This table is applicant/agent evidence only and
cannot create maintainer approval.

| Gate | Result | Exact evidence or blocker | Resolution owner | Prevention cause and next action |
| --- | --- | --- | --- | --- |
| A1 Exact source and provenance |  |  |  |  |
| A2 Executable implementation |  |  |  |  |
| A3 Complete launch plan |  |  |  |  |
| A4 v4 authentication, permissions, pool identity |  |  |  |  |
| A5 Delta, settlement, liability conservation |  |  |  |  |
| A6 Programmable fee |  |  |  |  |
| A7 Custody, positions, locks, exits, administration |  |  |  |  |
| A8 Liveness and bounded history |  |  |  |  |
| A9 Capability-triggered security |  |  |  |  |
| A10 Tests, analysis, evidence |  |  |  |  |
| A11 Specification and public claims |  |  |  |  |

Record the predicted verdict separately from platform gates. `PLATFORM PENDING` is permitted only when A1-A11 all pass.
`READY FOR FINAL VERIFICATION` additionally requires the supported maintainer pre-final platform gates. The table is not
a signed final-verification result.

## Prototype evidence

List the exact compatibility report, review-target hash, compiler and dependency closure, test runs, static-analysis
dispositions, applicable fork block, gas and size results, permission mask, CREATE2 plan, and review layers. Mark missing,
skipped, flaky, reverted, or unavailable methods truthfully. A missing tool blocks only when no attributable alternative
method covers the same triggered property; never relabel its own run as passed.

Re-resolve the primary and companion repositories anonymously immediately before the result. Prove the same numeric
repository ids still expose the exact commits, trees, declared blobs, submodules, and LFS objects. A familiar slug with
a new numeric id is a new authority and invalidates the prior result.

## Change-impact and decision-rendering check

| Changed input | Invalidated results | Rerun evidence | Current disposition |
| --- | --- | --- | --- |
| Source, compiler, or dependency |  |  |  |
| Launch plan, configuration, or address derivation |  |  |  |
| Tests, analysis, or evidence |  |  |  |
| Proposal, threat model, specification, or public claim |  |  |  |
| Repository identity, visibility, or retained object |  |  |  |
| Package, validator, skill, criteria, or fee policy |  |  |  |
| Tool, ruleset, suppression, prompt/model, workflow, manifest, or attested artifact |  |  |  |

Before handoff, render the full decision and reject it if a required PR head, repository id, commit, tree, digest,
verdict, owner, timestamp, or reachability result is blank, placeholder, malformed, or mixed with another revision.

Record the complete root `programmableFee` policy, canonical PoolKey and quote asset, selected/effective/platform/project
rates, exact source and test paths, hook mechanism binding, the complete supported/rejected four-quadrant matrix, executed
gross quote-side cases for supported modes, deterministic pre-movement rejection for unsupported modes, rounding,
liability/value-flow ids, collection and claim events, and no-cross-pool-netting result. Record owner-only claim tests
for immutable `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`, including owner-selected per-claim destinations and failed builder,
project, administrator, recipient, rescue, sweep, redirect, and mutation attempts.
Show that `accounting.accrualMode` is `claimable-liability`, `claimAvailability` is `anytime`, and accrual plus partial or
full owner claims reconcile to the remaining liability and backing balance.
Record the quote-asset-derived before/after return-delta path for each swap mode and the tested self-call policy. If
same-pool hook-initiated swaps are fee-enforced internally, bind the exact implementation and regression test.

For delegated funding, record the payer/authenticated actor relationship, allowance/Permit2 mode, typed domain and every
bound field, plus victim-allowance, field-mutation, replay, ERC-1271, revocation, partial-spend, residual-allowance, refund,
and front-running results. For custom accounting, record final combined caller limits, backing/conservation, valid zero-
core-AMM completion, invalid unbacked/no-op deltas, operation-specific settlement, and forbidden `clear` of owed value.

For a `tokenMechanics` transfer tax or automatic liquidity lifecycle with either hook route, also record the exact token source and
constructor, direction rates and immutable maximum, recipient conservation, authority/delay result, requested-versus-
received and actual-user-receipt cases, automatic-liquidity threshold/cap/slippage/deadline, reentrancy and failure
atomicity, LP position identity/custody/exit, and every declared `testScenarios` result. Record provider tests and
provider-owned confirmations separately; a canary, HTTP response, local route, or documentation page is not approval.

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
local check proves audit, acceptance, product integration, deployment, live fee collection, verification, routing
approval, provider support, or production availability.
