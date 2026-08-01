# Output specification

Produce only the artifacts required at the current stage. Use explicit unknowns instead of placeholder claims.

## Explore output

```text
Idea brief
├── user outcome
├── why Uniswap v4 is used and whether a custom hook is needed
├── design card
│   ├── pool and trade behavior
│   ├── creator choices and fixed platform rules
│   ├── value recipients and exits
│   ├── authorities and dependencies
│   ├── failure behavior
│   ├── intended product surfaces
│   ├── declared implementation surfaces and languages
│   └── features not used
├── lifecycle and value-flow sketch
├── likely capabilities and risk triggers
├── builder-stated facts and agent-derived facts
└── unresolved architecture decisions
```

No code or compatibility claim is required.

## Preflight output

```text
submissions/<model-id>/
├── submission.json
├── compatibility-report.json
├── PROPOSAL.md
├── THREAT_MODEL.md
├── TEST_PLAN.md
└── EVIDENCE.md
```

This is the local package in the builder-controlled public project repository. It is not the bounded central application
directory. Submit mode derives the separate six-file central package defined in
[submission-workflow.md](submission-workflow.md); project source and this local `submission.json` remain in the pinned
builder repository.

The deterministic report must contain:

- Standard version and submission content hash
- Validator source hash, schema hash, bundled deployment-snapshot hash, and semantic policy-bundle hash
- Decision: `PROTOTYPE_READY`, `REDESIGN_REQUIRED`, or `UNSUPPORTED`
- Inherent risk tier and underlying risk dimensions
- Derived hook permission mask when `hook.used` is true, otherwise an explicit not-applicable result
- Errors, blockers, warnings, and required actions with stable codes
- Required test, review, operational, integration, and disclosure gates
- Structured public project/token metadata, mutable owners, affiliation claims, and provider-facing presentation review

Required gates are surface-derived. A contract-only, external-client, or ordinary no-hook project does not receive
included-client or indexer gates unless it actually declares those surfaces. Hook and value-safety gates remain based
on behavior. A builder-pinned model-specific dependency baseline remains a candidate review item and never reports
itself as maintainer reviewed.

The report must say that it is not an audit, acceptance, deployment, routing approval, or availability proof.
Its `PROTOTYPE_READY` decision is local builder evidence, not the Public GitHub PR Beta's trusted status or a substitute
for maintainer review.

Before a human handoff says `PROTOTYPE_READY`, the proposal also contains:

- A semantic consistency statement separate from the deterministic report
- A worked numerical example for every fee or accounting rule the design introduces
- Value-conservation, rounding, and failure examples
- Four-quadrant coverage or explicit rejection for designs that change or mediate swap behavior; otherwise a statement
  that the ordinary pool path introduces no custom swap callback behavior
- A planned boundary for every intended UI, game, service, API, indexer, quote, trade, claim, keeper, oracle, and
  monitoring surface, with unused surfaces marked not applicable with a reason
- A machine-readable `projectSurfaces` and `projectCapabilities` graph. New surface or capability kinds remain open for
  architecture review, while every capability still derives authority, value-flow, source-of-truth, signature/replay,
  external-call, custody, PII/geolocation, secret, source/test/schema and failure/recovery profiles.
- No contradiction among the design card, structured submission, proposal, threat model, and test plan

## Prototype output

In addition to Preflight:

```text
<declared project source and configuration>
<declared project tests>
spec/<model-id>.json
submissions/<model-id>/evidence/
├── test-evidence.json
├── dependency-lock.json
├── gate-status.json
├── review-target.json
└── <capability-triggered analysis and runtime evidence>
```

Use the project's existing repository conventions. Do not add Solidity, Foundry, a custom hook, a browser app, or a
service merely to match an example layout. Do not duplicate shared protocol contracts.

`test-evidence.json` records exact commands, tool versions, commit, status, test counts, fuzz runs, invariant runs and
depth, useful calls, reverts, fork block, browser or API cases, gas, sizes, failures, skips, and timestamp where those
fields apply. Mark a capability-specific field or gate not applicable with a reason; do not write `passed` for an
unexecuted command.

`review-target.json` binds the package, declared source and test files, the supported closure for each declared language,
the dependency lock, and every gate-evidence artifact by content hash. Closure method v10 additionally binds every
declared project-surface source, test, schema and evidence path, and deliberately excludes both
`gate-status.json` and `review-target.json` from its own file subject, preventing either authority record from hashing
itself. `prepare-pr` binds those two records separately as exact primary HEAD/GitHub source blobs. Solidity uses compiler and import closure;
JavaScript and TypeScript use static or literal local module closure. Another language uses its declared supported
tooling or stays in an explicit architecture/tooling review state. The review target does not prove modules acquired
through arbitrary runtime reflection. The canonical review-target hash binds the closed `closure.status` and diagnostic
records as well as the captured files and resolved imports. Unsupported closure mechanics remain proposal-eligible as
`incomplete`; prototype readiness stays fail-closed. Missing literal relative source, unsafe paths, symlinks, Gitlinks,
unmaterialized LFS source, and exceeded bounds remain hard source-binding errors.
`gate-status.json` copies the exact `reviewTargetHash`; every completed gate-evidence metadata record copies that same
hash. Build the target once with the final evidence paths, write its hash into gate status, then rebuild and require an
identical target before committing both authority files. Each evidence record also records an exact command, tool
version, artifact path, artifact hash, and a 40-character origin commit. That commit is provenance only; exact current
intake identity comes from the pushed HEAD and review-target binding, not from requiring an evidence-producing commit
to equal a later packaging commit. Gate status also copies both preflight authority digests:
`deploymentSnapshotSha256` for the pinned
official-feed snapshot and `officialDeploymentReferenceSha256` for the separate runtime-unverified Launchpad reference.
Deployment evidence preserves the selected `deploymentTrustTier` and `authorityReferenceSha256`; neither field proves a
runtime, source, chain integration, or release claim.

Capability-triggered evidence is additive:

- Declared Solidity contracts require the pinned compiler/build evidence, contract analysis, and applicable gas, size,
  fork, fuzz, and invariant results.
- A custom hook additionally requires callback authentication, permission-mask, CREATE2, PoolKey, delta, settlement,
  and lifecycle evidence for the callbacks it actually enables.
- An ordinary no-hook project requires no custom Solidity, callback, permission-mask, or CREATE2 artifact unless another
  declared contract surface independently needs it.
- An app or game requires the relevant build, interaction, state, wallet/signing, accessibility, responsive, browser,
  and failure tests for its declared behavior; unused categories are not fabricated.
- A service, keeper, oracle, or indexer requires the relevant API/schema, authentication, authorization, retry,
  freshness, reorg, idempotency, failure, operating, and monitoring evidence for its declared responsibilities.
- A signed offchain data producer and an optional onchain oracle verifier remain separate surfaces with reciprocal
  references. A signed source without an onchain verifier is valid when the declared consumer boundary does not use one.

The prototype also records the product-facing specification. For each intended surface, name the source of truth, input,
output, error behavior, unsupported state, dependency ids, source paths, executable tests, and operating owner. These
records are plans and local evidence, not proof that the Programmable product or a third-party provider supports them.
Contributor-controlled `submission.json`, `gate-status.json`, and evidence files cannot complete candidate,
maintainer-review, deployment, verification, provider, or availability gates.

Public metadata is part of the exact reviewed revision. Bind project and token names, symbol, URIs, logo content hashes,
mutability and owners. Provider-facing tags and labels remain proposals until the named provider confirms them. Unknown
provider support produces an external review gate, not a rejection. Scan visible copy in declared app and UI source;
comments and declared test fixtures are not public claims.

The machine-readable plan lives at `submission.json.integration.platformHandoff`. When `intended` is true, fill
`handoffNotes`. Repository and test paths are optional contributor proposals until maintainers accept the exact
prototype and assign product work. Contributor packages keep `reviewStatus` at `not-requested` or
`pending-maintainer-review`, `maintainerReviewRequired: true`, `selfApproval: false`, and
`availabilityClaimed: false`.

Each deployment-evidence record also binds the exact deployment-feed digest and producer commit, raw feed source
reference and source URL, derived implementation repository, source-ref resolution state, observed block, runtime hash,
and separately asserted source match. Builder evidence remains untrusted until a maintainer reproduces it.

## Prepare-PR output

`prepare-pr` returns one machine-readable object with:

- `sourceHead`: the builder-controlled primary repository, branch, exact commit, and root tree;
- `centralPullRequestTarget`: fixed `0xprogrammable/programmable:main` identity, observed base commit and tree, central
  application path, prior revision, and next revision;
- `github.sourceRequest`: the immutable primary authority and zero to eight sorted companion authorities;
- `centralPackage`: exactly six canonical application files with byte lengths and SHA-256 digests;
- a copy-ready draft pull-request `title`, `body`, and confirmation `checklist`;
- `localWritesPerformed`: empty unless an explicit output directory was requested;
- `externalActionsPerformed`: always empty; and
- `requiresHumanConfirmation: true`.

The first application revision is `1`. If immutable central main contains revision n, the pending update is n+1 and
must differ from main in primary or companion source authority. Repeated commits in that same open pull request remain
on n+1; a new application's open pull request remains on revision 1. Display-only repository renames do not create a
revision. The observed central base is checked again immediately before every local materialization.

Without `--output-dir`, the command writes nothing. With a new exact `<application-id>` target, it materializes only the
six files. Every output target must be outside the builder source repository. `--replace-existing` is permitted only
with `--output-dir` and only when the existing local directory exactly matches immutable main; it creates the first
pending n+1 draft. `--replace-draft` is mutually exclusive and replaces only a pre-network-snapshotted, self-consistent
local six-file draft at revision 1 or n+1. It preserves builder and full numeric repository lineage, accepts the same
source authority only when canonical package bytes actually change, and rechecks directory and file identities before
the swap. Central main remains the authority in both modes. No prepare output is an opened pull request, acceptance,
audit, deployment, provider submission, or availability receipt.

## Repair output

```text
Repair report
├── submitter claim versus observed behavior
├── declared files, dependency closure, entry points, authorities, and capability-specific callbacks or permissions
├── asset and value-flow reconstruction
├── deterministic and semantic preflight result
├── smallest compatible correction
├── changed review-target inputs
└── checks rerun and remaining blockers
```

Do not describe a repair as complete when only compilation or one test suite passed.

## Maintainer candidate record

Candidate is not a contributor-controlled `submission.json` stage. After reviewing an exact prototype and its
`reviewTargetHash`, maintainers may create a separate candidate record with:

```text
maintainer-records/<model-id>/<version>/
├── candidate.json
├── compatibility.lock.json
├── SECURITY_PROPERTIES.md
├── INTEGRATION.md
├── OPERATIONS.md
└── evidence/
    ├── dependency-lock.json
    ├── deployment-plan.json
    ├── fork-evidence.json
    ├── source-closure.json
    └── review-status.json
```

The compatibility lock contains only the fields applicable to the accepted implementation, plus explicit
not-applicable reasons for omitted capability families:

- Skill and standard version
- Source commit and submission hash
- Exact languages, compilers or runtimes, build settings, and package-manager configuration
- EVM, optimizer, metadata, FFI, ABI, and compiler-resolved source settings when Solidity is declared
- Exact dependency sources and commits when available, exact package versions and integrity declarations, tree hashes,
  licenses, and the separate verification state for local package bytes
- `verify-package.mjs` keeps locally observed package artifacts explicitly builder-declared with
  `integrityVerified: false` and `centralSourceVerified: false` until an attributable verification gate supplies
  independent evidence.
- Deployment feed timestamp and source revision
- Chain-specific protocol records and runtime expectations
- Exact router generation and registry package versions when the project uses them
- Hook permission mask when a custom hook is used
- Constructor arguments and deployment/runtime bindings for each deployed contract; CREATE2 deployer, salt, initcode
  hash, and expected hook address only when the selected hook path requires them

`candidate.json` binds the exact prototype commit, submission hash, review-target hash, selected scope, maintainer
decision, and all still-open independent gates. Contributor tooling cannot create or complete this record.

`review-status.json` uses factual states such as `not-started`, `required`, `in-progress`, and `completed-with-report`.
It never stores `safe`, `approved`, or a self-assigned security score.

## Accepted-model platform handoff

Create this output only after a maintainer acceptance record binds the exact model id, version, prototype commit,
submission hash, review-target hash, accepted scope, and open conditions. The builder skill may read that record but may
not create, edit, or broaden it.

```text
Platform integration handoff
├── accepted target
│   ├── acceptance-record path and content hash
│   ├── model id and version
│   ├── prototype commit, submission hash, and review-target hash
│   └── accepted scope and open conditions
├── surface specifications
│   ├── UI
│   ├── API
│   ├── indexer
│   ├── quote
│   ├── trade
│   ├── claim
│   └── monitoring
├── routing and discovery plan
├── repository paths and owners
├── executable integration checks
├── deployment and verification inputs
├── human gate ledger
└── blockers and rollback limits
```

Every surface specification contains:

- Current state: `not-started`, `scoped`, `implementation-reported`, `locally-tested`, `maintainer-reviewed`, `blocked`,
  or `not-used-with-reason`
- Owner and exact repository paths
- Source of truth and trust level
- Request, event, or transaction inputs
- Response, displayed state, emitted event, or transaction outputs
- Chain, model version, contract, SDK, router, and provider dependencies
- Error, stale, partial-fill, reorg, retry, recovery, and unsupported behavior where applicable
- Executable tests and the exact evidence needed to change state
- Rollout control and rollback limitation

The handoff must state the exact boundary for:

- UI routes, actions, displayed fields, canonical-pool proof, disclosures, and feature gates
- API operations, schemas, cache and freshness policy, authentication, rate limits, and errors
- Indexer start block, events, entity keys, finality, reorg handling, backfill, reconciliation, and lag
- Quote PoolKey, direction, exactness, amounts, block tag, hookData when used, Quoter generation, fee fields, and parity
- Trade router generation, V4 actions, Permit2, native value and refund, slippage, deadline, partial fills, simulation,
  final deltas, receipts, and failure states
- Claim entitlement source, liability keys, preview, caller and recipient authorization, payout changes, transaction
  states, failed-recipient recovery, and historic rights
- Monitoring checks, thresholds, alerts, owner, runbook, escalation, fallback, dependency health, and drill evidence

Blank required surfaces are blockers. A surface marked unused needs a reason tied to the accepted lifecycle.
Only a maintainer-owned record bound to the accepted release may use `maintainer-reviewed` or satisfy a later gate.
Contributor declarations and local tests remain `scoped`, `implementation-reported`, or `locally-tested`.

The gate ledger keeps maintainer acceptance, platform review, deployment authorization, deployment execution, source
verification, runtime matching, lifecycle verification, monitoring readiness, routing and discovery decisions, and
availability separate. Each entry names its human owner, evidence, current state, blocker, and next action. No entry
inherits another entry's authority.
Every completed entry points to a maintainer-owned record with the accepted model version, source and product commits,
chain and deployment identity where applicable, evidence hashes, reviewer, and decision time.

Use the machine-readable candidate gates for registry, UI, API, indexer, and executable-test review:

- `programmable-registry-integration-review`
- `programmable-ui-integration-review`
- `programmable-api-integration-review`
- `programmable-indexer-integration-review`
- `programmable-integration-test-review`

Keep provider decisions external. General Uniswap routing uses `uniswap-hook-routing-review`; a permissioned pool also
uses `permissioned-pool-routing-allowlist`. These gates do not prove deployment, source, runtime, lifecycle, product
activation, or availability, and contributor `gate-status.json` cannot satisfy them.

Quote, trade, claim, and monitoring remain separate evidence rows within `programmable-integration-test-review`. The
candidate gate remains incomplete until every intended row has maintainer-owned evidence.
An API `200`, successful quote, returned swap payload, or successful receipt cannot set product activation or
availability. Each is evidence only for its exact request, response, or transaction scope.

The handoff can recommend changes on the product release branch. It does not edit product files, create a product PR,
merge, deploy, submit provider forms, change a registry, or activate the model.

## Handoff response

The agent's final response leads with:

1. Current compatibility decision
2. What was actually created or changed
3. Tests and checks actually run
4. Remaining blockers by review, platform, deployment, verification, routing, and availability layer
5. The exact next owner action

Label important facts as `builder-stated`, `agent-derived`, or `evidence-backed`. Do not present a derived default as a
builder decision or a builder statement as verified evidence.

Link local files with absolute paths when the client supports them.

## Forbidden output behavior

The skill must never:

- Invent an address, receipt, audit, approval, test run, source match, or provider status
- Write a private key, seed phrase, credential, browser data, or signing payload into the package
- Create or edit a maintainer acceptance record
- Treat acceptance as authority to edit product code or deploy
- Promote the release registry
- Sign or broadcast a transaction
- Open, merge, or publish a PR without exact authorization
- Submit Hooklist, routing, explorer, indexer, legal, or marketplace forms automatically
- Promise acceptance, review time, deployment, launch count, volume, or income
