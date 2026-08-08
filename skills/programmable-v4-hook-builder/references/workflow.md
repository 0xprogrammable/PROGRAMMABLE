# Builder workflow

This workflow moves one open-ended v4 launch project from private exploration to a local review package and then a
bounded public GitHub application. After maintainers accept an exact prototype, it can also produce a scoped
platform-integration handoff. It does not accept, deploy, publish, list, or activate the project.

## 1. Select the narrowest mode

| Mode | Entry condition | Exit condition |
| --- | --- | --- |
| Explore | Only an outcome or rough mechanism exists | Design card and one next architecture decision |
| Preflight | Product-changing decisions are concrete | Structural report plus independent semantic review |
| Prototype | Structural and semantic preflight are complete | Isolated implementation and evidence package |
| Repair | Existing code or package is incomplete or inconsistent | Observed behavior, root cause, smallest correction, rerun checks |
| Review | The user requests readiness assessment | Evidence-based gaps without unrequested edits |
| Submit | The local package is complete | PR-ready handoff without opening or publishing it |
| Handoff | A maintainer acceptance record binds an exact prototype | Product surface specification and independent gate ledger |

Do not skip Explore or Preflight because the user asks for code immediately. During Explore, choose the smallest route:
official Liquidity Launchpad components plus a project-specific implementation of the standard Programmable fee-hook
profile when no other callback behavior is needed, or one custom hook that integrates both the fee policy and the confirmed mechanism. Exact source, tests, and maintainer review are required. A no-hook,
router-only, LP-fee-only, or transfer-tax-only proposal remains open for architecture work but is not launch-ready.
Do not enter Handoff because a PR was merged, tests passed, or a maintainer expressed interest. Require the exact
acceptance record.

## 2. Establish the boundary

1. Read repository instructions.
2. Resolve the target repository independently from the skill installation.
3. Inspect branch, remotes, dirty files, existing model conventions, pins, and test commands.
4. Use an isolated branch or worktree and preserve unrelated changes.
5. Inspect untrusted submitted code before running it. Use no credentials, wallets, signing access, or repository write
   token in its execution environment.
6. Keep the complete contributor project in its own repository. For the Public GitHub PR Builder Beta, prepare only the
   bounded central application package after the exact source revision is clean, pushed, public, and independently
   resolved. For accepted-model product work, record the product branch and integration owner in the handoff; do not
   switch branches or edit product files implicitly.

Run the read-only environment check:

```bash
SKILL_ROOT="<directory-containing-SKILL.md>"
REPOSITORY_ROOT="$(git -C "$PWD" rev-parse --show-toplevel)"
node "$SKILL_ROOT/scripts/doctor.mjs" \
  --repository-root "$REPOSITORY_ROOT"
```

Explore remains available when contract tooling is missing. Without supported Node, report
`validationState: TOOLING_BLOCKED` and do not invent a deterministic result.

## 3. Complete guided intake

Use [intake-playbook.md](intake-playbook.md). Ask only the first unresolved architecture-changing question. Show the
design card before writing `submission.json`.

Stop asking when:

- economics, custody, authorities, dependencies, failure behavior, exits, and supported trades are confirmed
- all unused lifecycle and capability paths are explicit
- every remaining field is a deterministic technical derivation

Design-card confirmation confirms product intent only.

## 4. Scaffold and preflight

```bash
MODEL_ID="example-hook"
node "$SKILL_ROOT/scripts/scaffold-submission.mjs" \
  "$MODEL_ID" \
  --repository-root "$REPOSITORY_ROOT" \
  --name "<Model name>"

node "$SKILL_ROOT/scripts/cli.mjs" check \
  "$REPOSITORY_ROOT/submissions/$MODEL_ID/submission.json" \
  --write-report "$REPOSITORY_ROOT/submissions/$MODEL_ID/compatibility-report.json" \
  --repository-root "$REPOSITORY_ROOT"
```

Use this repository-aware command for the complete preflight. Running `validate-submission.mjs` without a repository
root checks only the structured document and cannot prove source, import, package, companion, or build closure.

Use stable lower-case kebab-case for `model-id`. Fill unknown facts with `null` or an explicit unresolved decision.
Never invent an address, fee, authority, dependency, deployment, issuer, oracle, or asset behavior.

Interpret the result:

- `PROTOTYPE_READY`: structurally ready for semantic review
- `REDESIGN_REQUIRED`: resolve the highest-priority material finding
- `UNSUPPORTED`: change the design materially; do not code around the boundary

Then complete the semantic review in [intake-playbook.md](intake-playbook.md). A structurally valid submission remains
blocked when its material claims are circular, contradictory or unsupported.

## 5. Freeze the architecture

Freeze:

- lifecycle, assets, PoolKey, canonical-pool policy, and alternative-pool disclosure
- all 14 permissions, callback authentication, return shapes, hookData, and nested-action policy
- LP fee and hook-owned fee classification
- root `programmableFee` policy: non-additive 10 bps platform allocation, executed gross quote-side basis, canonical
  PoolKey, all four quadrant-dependent before/after paths, same-pool self-call policy, immutable owner-only claims,
  per-claim destination, liability keys, events, and evidence
- dynamic-fee initialization, application mode, override rule, persistent actor and call sites, rate limit, bounds,
  metric, update path, manipulation resistance, and failure behavior
- hook-fee collection path, value-flow id, liability keys, event, and recipient share, address source, launch binding,
  claim, redirect, mutation, historic entitlement, and failed-recipient behavior
- settlement order, deltas, ERC-6909 claims, liabilities, rounding, custody, and exits
- authorities, dependencies, stable dependency ids, exact deployment records, and fallback rules
- routing mode and whether the swap client is included, external, or not planned; for an included client only: router,
  Permit2, StateView, and Quoter dependency ids; the three official SDK pins; explicit router action and settlement plan;
  quote-to-execution parity; final-delta validation; app and integration-test paths
- router generation, swap modes, partial fills, slippage, deadline, Permit2, events, and state reads
- intended UI, API, indexer, quote, trade, claim, and monitoring surfaces, each with a source of truth, input, output,
  error behavior, unsupported state, and owner; contributor-proposed repository paths and tests when known
- open `projectSurfaces` and `projectCapabilities` declarations with bidirectional ids, explicit exposure booleans,
  derived security profiles and exact source, test, schema and evidence paths; use
  [project-surfaces-and-capabilities.md](project-surfaces-and-capabilities.md)
- separate signed offchain source production from an optional onchain oracle verifier; never combine them into one
  surface or require a verifier when the actual architecture does not use one
- active indexer reconstruction and recovery evidence, or a fully inactive `dataReconstruction: not-applicable` profile
  when no accounting, claim, external-liquidity or indexer requirement exists
- `submission.json.integration.platformHandoff`: `intended`, `websiteRegistryPath`, `uiSourcePaths`, `apiSourcePaths`,
  `indexerSourcePaths`, `testPaths`, `handoffNotes`, contributor-limited `reviewStatus`, and fixed review flags
- risk dimensions, required tests, independent reviews, operations, and disclosures

Any change requires regenerated preflight and a new review target.

## 6. Prototype

Keep model-owned source, tests, specifications, documents, and evidence isolated. Implement in this order:

1. Interfaces and immutable configuration
2. Permission declaration, callback authentication, and exact canonical PoolKey binding
3. Mandatory Programmable fee accounting, immutable ownership, claims, and settlement
4. External integrations and failure isolation
5. Events and indexer reconstruction
6. Launcher, custody, claims, and exits
7. Unsigned deployment plan
8. UI, API, indexer, quote, trade, claim, and monitoring specifications

Compile after each architectural slice. Do not change product behavior to silence a compiler or test failure.
Record product integration plans in the prototype package. Do not edit the website, API, indexer, or operations code
unless the user has separately requested that implementation and an integration owner has assigned the paths.

Follow [security-and-evidence.md](security-and-evidence.md), then build and verify the local review target:

```bash
node "$SKILL_ROOT/scripts/build-review-target.mjs" \
  --repository-root "$REPOSITORY_ROOT" \
  "$REPOSITORY_ROOT/submissions/$MODEL_ID" \
  --write "$REPOSITORY_ROOT/submissions/$MODEL_ID/evidence/review-target.json"

node "$SKILL_ROOT/scripts/verify-package.mjs" \
  --repository-root "$REPOSITORY_ROOT" \
  "$REPOSITORY_ROOT/submissions/$MODEL_ID"
```

The result is local intake validation, not security review, acceptance, deployment, routing approval, or availability.
It also does not prove live fee collection. That claim requires reviewed source, an authorized deployment receipt,
matched runtime, lifecycle evidence, and monitoring for the exact release.
The contributor's `integration`, `operations`, and `gate-status.json` records remain declarations and local evidence.
They cannot complete a maintainer or release gate.

## 7. Repair

For existing code:

1. Compare submitter claims with observed source and runtime assumptions.
2. Inventory imports, callbacks, permissions, external entry points, roles, assets, dependencies, and value flows.
3. Reconstruct and confirm the design card.
4. Run preflight on observed behavior.
5. Make only the smallest correction requested by the user.
6. Regenerate the report and review target.
7. Rerun every check affected by the changed source, configuration, dependency, or evidence.

Never execute a contributor's build or test script with secrets merely because the package requests it.

## 8. Prepare the public GitHub application

A proposal contains:

```text
submissions/<model-id>/
├── submission.json
├── compatibility-report.json
├── PROPOSAL.md
├── THREAT_MODEL.md
├── TEST_PLAN.md
└── EVIDENCE.md
```

A prototype adds model-owned source, tests, specification, and machine-readable evidence. Follow
[output-contract.md](output-contract.md) for the exact handoff.

Run the host-neutral `package` and `prepare-pr` commands from the canonical skill. `package` validates the local review
target and reports deterministic hashes. `prepare-pr` binds the canonical public repository URI, immutable numeric
repository id, exact commit, root tree, declared source paths, zero to eight committed public companion bindings, and
evidence. It also anonymously resolves the builder login to the immutable decimal GitHub user id. It observes the exact
central base, preserves that user id while allowing display-login renames, derives the next application revision, then
prepares the closed six-file application package under `submissions/<application-id>/` plus a copy-ready draft PR body.
The source project is not copied into Programmable. `--replace-existing` creates the first pending update draft only
from exact bytes observed on immutable central main. Every further change to that same open pull request uses
`--replace-draft`, which freezes and rechecks the self-consistent local six-file draft while central main remains the
revision authority. Both require an explicit output directory outside the builder source repository and perform no
external action.
For this beta, `application-id` equals the stable lower-case project/model slug; the pull-request number is the review
thread, not a connected-service identity.

The agent may prepare these local artifacts when requested. Opening a pull request, publishing, signing, deploying,
submitting to a provider, modifying the model registry, or creating a maintainer candidate record requires separate
exact authority. A green intake result is not approval, an audit, deployment evidence, routing support, or availability.

## 9. Prepare the accepted-model platform handoff

Start only from a maintainer acceptance record that binds the exact model id, version, prototype commit, submission
hash, review-target hash, accepted scope, and remaining review conditions. If any binding is missing or disagrees with
the package, stop and return to Review.

Load `official-model-patterns.md` when the accepted model derives from an official pattern. Load
`routing-and-discovery.md` for every handoff because product discovery, indexed state, Hooklist status, routing support,
and canonical chain evidence have different owners and trust levels.

The handoff is a platform integration specification, not a product patch. Give every surface one row:

| Surface | Exact boundary |
| --- | --- |
| UI | Routes or screens, actions, displayed fields, canonical-pool proof, disclosures, loading and unsupported states, feature gate, source paths, browser tests |
| API | Operations, request and response schemas, chain and model version, authentication and rate limits where used, error model, cache policy, source paths, contract tests |
| Indexer | Contract addresses, start block, event signatures, entity keys, finality and reorg policy, backfill, reconciliation, freshness target, source paths, replay tests |
| Quote | PoolKey, direction, exactness, amount and currency semantics, block tag, Quoter generation, hookData, fee and price-impact fields, timeout and stale behavior, parity tests |
| Trade | Universal Router generation, V4 actions, Permit2 mode, native value and refund, slippage, deadline, partial fills, final-delta checks, simulation and receipt states, end-to-end tests |
| Claim | Entitlement source, liability keys, preview, caller and recipient authorization, payout mutation, transaction states, failed-recipient recovery, source paths, lifecycle tests |
| Monitoring | Chain and provider checks, invariants and thresholds, alert owner, runbook, escalation, RPC fallback, keeper or oracle health, indexer lag, routing drift, source paths, drill evidence |

For each row, name the source of truth, owner, dependencies, input, output, error behavior, unsupported behavior, exact
repository paths, executable checks, rollout or rollback limit, evidence needed, and current state. Use `not used` only
with a reason. Use `blocked` when the accepted scope requires a surface but its contract is unresolved.

Start from the contributor-declared `submission.json.integration` and `submission.json.operations` fields, but do not
promote their claims. A surface can move beyond `scoped` or `locally-tested` only with maintainer-owned evidence bound to
the accepted release. Contributor-controlled `gate-status.json` cannot complete a surface or release gate.

For a prototype with `integration.platformHandoff.intended: true`, require a concrete handoff plan and handoff notes.
Registry, UI, API, indexer, and executable-test paths remain optional contributor proposals until a maintainer accepts
the exact prototype and assigns product paths. `reviewStatus` remains `not-requested` or
`pending-maintainer-review`, `maintainerReviewRequired` remains true, `selfApproval` remains false, and
`availabilityClaimed` remains false.

Routing and discovery details belong in the dedicated reference. The handoff must still say which product surfaces use
first-party chain reads, the Programmable indexer, or a third-party provider. Third-party metadata or route discovery
never proves a receipt, runtime, balance, claim, or lifecycle transition.

Apply the same boundary to official Uniswap services: Hooklist and indexers provide discovery or metadata; an allowlist
records routing-eligibility policy; a quote is request- and block-specific simulation; a swap response is unsigned
calldata; only a confirmed receipt proves execution. `verifiedSource` is not an audit or routing approval.
An API `200`, successful quote, returned swap calldata, or successful receipt is not product activation or public
availability. A receipt proves only the transaction and effects it actually contains.

### Human gate ledger

Keep these gates independent and name the human owner of the next decision:

| Gate | Minimum evidence | What it does not prove or authorize |
| --- | --- | --- |
| Maintainer acceptance | Acceptance record bound to the exact prototype | Product implementation, deployment, routing, availability |
| Platform implementation review | Reviewed UI/API/indexer/quote/trade/claim/monitoring changes and executable integration results | Deployment or production activation |
| Deployment authorization | Reviewed plan, expected addresses, constructor inputs, rollback limits, named executor | Successful broadcast or verification |
| Deployment execution | Receipts, confirmations, runtime and configuration reads | Source match, lifecycle completion, routing |
| Source verification | Exact source, compiler settings, constructor inputs, metadata and explorer evidence | Runtime match or lifecycle completion |
| Runtime matching | Confirmed-block bytecode and configuration reads reconciled through an independent RPC | Source verification or lifecycle completion |
| Lifecycle verification | Receipt-backed launch, buy, sell, liquidity, claim, recovery and model-specific paths | Routing or product availability |
| Monitoring readiness | Deployed checks, thresholds, alerts, named owner, runbook and drill evidence | Provider support, uptime or product availability |
| Routing and discovery | Exact Hooklist, router, indexer, or listing provider records | Programmable activation or continued support |
| Availability | Maintainer-approved registry/config change and production evidence | Future uptime, volume, revenue, or safety |

Each completed row points to a maintainer-owned record that binds the accepted model version, source commit, chain,
deployment or product commit where applicable, evidence hashes, reviewer, and decision time. Missing evidence leaves
the row incomplete.

The machine-readable candidate gates are
`programmable-registry-integration-review`, `programmable-ui-integration-review`,
`programmable-api-integration-review`, `programmable-indexer-integration-review`, and
`programmable-integration-test-review`. Routing remains external through `uniswap-hook-routing-review`; permissioned
pools also require `permissioned-pool-routing-allowlist`. None can be satisfied by contributor `gate-status.json`.
Quote, trade, claim, and monitoring remain independent rows inside integration-test review; that gate stays incomplete
until each intended row has its own evidence.

The `main` submission branch is not the website release branch. A handoff may target `production`, but only the
integration owner may implement and combine that work. Opening a PR, merging, deploying, submitting provider forms, and
activating the product remain separate external actions.

## 10. Report factual states

Keep these states separate:

```text
source exists
compiled
repository tests passed
fork tests passed
independently reviewed
accepted for a bound scope
platform integration scoped
platform implementation reported
platform integration locally tested
platform integration maintainer-reviewed
deployed
source verified
runtime matched
lifecycle verified
indexer reconciled
routing reviewed
available
```

Lead with the compatibility result, actual changes, exact checks, remaining release-layer blockers, and next owner action.
