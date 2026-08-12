# Open-world v2 output contract

Use this reference when emitting human or machine results for an open-world v2 project. Report the strongest state that
the exact evidence proves; never collapse generation, validation, review, authorization, deployment and availability
into one success flag.

## Contents

1. [Machine artifacts](#machine-artifacts)
2. [State axes](#state-axes)
3. [Finding semantics](#finding-semantics)
4. [Evidence vocabulary](#evidence-vocabulary)
5. [Human handoff](#human-handoff)

## Machine artifacts

Use the versioned contracts and exact filenames:

| Role | Artifact |
| --- | --- |
| Verbatim public-safe provenance | `idea-source.v1.json` |
| Semantic intent and ambiguities | `intent-contract.v1.json` |
| Append-only design choices | `architecture-decisions.v1.json` |
| Intent-to-code/evidence trace | `intent-fidelity.v1.json` |
| Open project graph | `submission.v2.json` |
| Trade capability, once per selected tradable market | `trade-capability.v1.json` |
| Fee contract | `fee-policy-v2.schema.json` |
| Fee applicability | Application V3 `policyBindings.feeApplicability` derived from Submission V2 |
| Scoped fee instance, only when applicable | `fee-policy.v2.json` |
| Security contract | `security-assessment-v1.schema.json` |
| Source proposal security state | null/pending or unassessed `security-assessment.v1.json` |
| Derived source-assessed evidence | `security-assessment.v1.json`, central application package |
| Derived closure verification | one versioned report per repository, central application package |
| GitHub application | `application.v3.json` |
| Canonical acceptance | nullable Registry-controlled record; null before acceptance |

Do not substitute schema bytes for a project instance or evidence artifact. Derive applicability from the exact source
graph: a proposal uses `unresolved` with null instance fields; a canonical-scope prototype uses `applicable` with a real
instance; an exact zero-scope prototype uses `not-applicable` with null instance fields and no fee conformance artifact.
Content-bind every referenced artifact by owning repository, path, SHA-256 and byte length; bind repository evidence to
exact GitHub numeric id, commit and tree.

Trade output follows the same fail-closed rule. A selected market has one manifest bound to its ProjectSpec entry,
product-graph market node, source revision, exact PoolKey and either the standard v4 route or canonical Programmable
adapter. Preserve supported directions/exactness, router, quoter, Permit2/native funding, hookData, slippage/deadline,
fees and quote/execution test receipts. A no-market project emits no manifest or trade commands. Always report
`NOT_APPROVED`; local route compatibility is not allowlisting, reachability, deployment, discovery or live trading.

Never make a committed blob predict the Git commit/tree that contains it. Keep source-owned proposal security null,
pending or unassessed. Freeze source first, then derive source-assessed security and source-verification records into
the central application package with `repositoryRef: null`. Keep commit/tree in the outer application repository
binding rather than inside the root manifest blob.

Encode every V2 EVM `chainId` as a canonical positive `uint256` decimal string (`"1"`, not a JSON number). Keep the
immutable fee owner and independent platform-admin wallet as separate authorities; neither role inherits the other's
claim or launch power. A proposal market may preserve `executionClass: unknown`, but that state grants no fee exemption
and must resolve from bound source coverage before prototype or launch review.

Encode `applicationRevision` across Application V3, Registry Acceptance V3 and Launch V2 as a canonical positive decimal
string with no historical V1 integer, `1,000,000` or JavaScript safe-integer ceiling. Historical V1 revisions retain
their frozen integer shape. V3 starts at `"1"`; each update binds the prior exact revision and increments it by one using
arbitrary-precision decimal semantics.

An Application V3 public financial-identifier attestation binds only the exact pointer and matched-substring digest,
matching application id, owner-stated purpose and one authorization review record. Report it as human review required,
never ownership or approval; wrong/unused/blanket attestations and every credential/key/token candidate remain privacy
holds. Language-scoped automated findings stay independent-review holds when partial, disputed or mismatched.

Emit canonical JSON with stable ordering and one final LF when the owning contract requires canonical bytes. Do not add
free fields to a closed schema. Put owner-defined non-executable data behind the declared custom-profile/schema path.

## Autopilot decision record

Autopilot adds no new central application file. Bind the decision through the existing proposal, architecture,
submission and evidence artifacts:

- exact user and creator job, observable success condition, economic mechanism and value at risk;
- compact working kernel with incentive and abuse model, complete state machine, assumptions and non-goals;
- two or three considered architectures, selected smallest complete design and rejected simpler alternative;
- onchain, offchain, platform and provider responsibility boundaries;
- security, capital, gas, latency, liquidity-fragmentation, operations and review-complexity tradeoffs;
- current vertical slice and at most one build plus one assurance specialist with bounded handbacks, or `none`;
- every safe reversible default and every material prompt- or evidence-sourced fact;
- one unresolved owner decision when no safe default preserves the outcome, or explicit `none`; and
- exact point reached: design, Preflight, Prototype, predicted Review, or integration-pending handoff.

One-prompt authorship does not change evidence or approval thresholds. An implemented explicit default needs no chat
transcript. An unresolved oracle, beneficiary, payout, custody, authority, provider, legal right, or terminal rule cannot
be promoted by generated prose, mocks, or generated tests.

## State axes

Report each axis independently:

| Axis | Example states | Never infer |
| --- | --- | --- |
| Intent | draft, builder-confirmed, delegated defaults, legacy-unconfirmed | feasibility or implementation |
| Product route | direct build, custom architecture, integration pending, safe redesign | acceptance |
| Design | unresolved, changes required, design ready | source exists |
| Implementation | not started, in progress, structurally complete | tests, audit or deployment |
| Package | invalid, valid, split review required | human approval |
| GitHub transport | not submitted, draft/open, checks running, changes requested, merged/closed | canonical acceptance |
| Launch-admission policy review | no determination, changes required, platform pending, ready for final verification | signed approval or typed checker enforcement |
| Registry acceptance | absent/null, accepted exact revision | launch authorization or deployment |
| Authenticated approval | absent, approved exact revision, stale, revoked | wallet signature, deployment or launch |
| Website launch handoff | pending activation, details required, permit ready, blocked, consumed | confirmed transaction |
| Launch preparation | matched, unresolved, conflict; Builder-local output is not authorized | signature or transaction |
| Runtime | not deployed, deployed/verified, monitored | provider availability or safety |
| Availability | not indexed, indexed, quoted, tradable | endorsement or low risk |

Keep idea eligibility separate from mechanism status. A design can remain `ELIGIBLE_FOR_REVIEW` while its exact
implementation is invalid, needs safe redesign, lacks an integration or exceeds one verifier run's resource budget.

## Finding semantics

Emit a stable machine finding with:

- severity or review outcome;
- stable code;
- exact artifact path/location;
- observed fact and evidence refs;
- concrete impact;
- remediation or next review path; and
- classification that distinguishes product behavior, evidence gap and tooling/split-review limits.

Never use novelty, a missing keyword, template absence, unsupported syntax, repository size or provider outage as a
security verdict. Preserve observed-positive source signals; keep absent or unsupported analysis `unknown`.

Let a builder attach counter-evidence, but never accept a builder-owned waiver. Keep disputed findings in independent
review/hold. Only a later Registry/maintainer record may disposition a finding, and it must bind the exact application
revision, finding identity, evidence and reviewer. Preserve the original finding and do not inherit the decision after
the commit changes.

## Evidence vocabulary

Use exact terms:

- `generated`: a tool produced bytes; it says nothing about correctness.
- `schema-valid`: the object matches the structural contract.
- `locally-verified`: the named deterministic local command passed for exact inputs.
- `test-declared`: a package references a test; execution is unproven.
- `test-executed`: preserve command, environment, result and exact revision.
- `simulated`: preserve simulator, inputs and result; do not call it deployed.
- `public-ci-green`: preserve workflow/run and exact commit.
- `independently-reviewed`: preserve reviewer, scope, revision and finding dispositions.
- `accepted`: preserve the trusted decision record; do not call it deployed.
- `deployed`: preserve transaction, chain, addresses, configuration and source/runtime match.
- `available`: preserve indexer/interface/provider and monitoring evidence.

Record `NOT_RUN`, `NOT_APPLICABLE`, `BLOCKED` or `UNRESOLVED` instead of manufacturing a pass. Model-backed evals need
their own authorized provider run, model id, prompt-suite digest, cost, timestamp and result artifact. A structurally
valid eval definition is not a model pass.

Never emit `safe`, `audited`, `rug-free`, `approved`, `launch-ready`, `deployed`, `live` or `Uniswap-endorsed` without
the external authority and evidence that exact claim requires.

A merged GitHub review thread is not enough for `accepted`. Require a canonical Registry record that binds the exact
Application V3, source, Submission V2, fee applicability and conditional Fee V2 instance, security assessment,
verification reports and maintainer decision. Registry acceptance may preserve exact zero-scope `not-applicable` with
null instance fields. That record omits its own containing commit/tree; the outer launch input binds its exact Registry
blob. A null acceptance binding reports pre-acceptance `UNRESOLVED` and `NOT_AUTHORIZED`. Launch Bundle V2 is a separate
canonical fee-bearing contract: N/A cannot be converted into a fake instance, and a zero-scope acceptance remains a
launch conflict rather than authorization.

After production activation, report Website launch eligibility only from the authenticated service response for the
same GitHub subject, exact approved application revision, and unchanged source SHA. Revalidate current source, rights,
policy, compiler, launch specification, release, chain, and incident state. Report a changed SHA as stale and start a
new review target. Never infer eligibility from GitHub labels, comments, reviews, merges, local receipts, or caller
claims.

Report a Git SHA-256 object-database repository or non-UTF-8 committed path as `INTEGRATION_PENDING` for current source
transport, while keeping the idea `ELIGIBLE_FOR_REVIEW`. Manifest V1 binds SHA-1 Git object ids plus separate SHA-256
content digests and requires UTF-8 paths. Report a UTF-8 path above the current 16 KiB byte budget as
`HOLD_SPLIT_REVIEW`, not a product finding. Other object formats or path encodings need a new versioned closure
contract; resource limits must remain explicit rather than silently narrowing eligibility.

## Human handoff

Lead with the actual outcome, then report:

1. application id and exact versioned contracts;
2. repository ids, commits, trees and source-closure mode;
3. preserved original intent and source language;
4. confirmed facts, delegated defaults and unresolved material choices;
5. selected architecture and every material difference from the request;
6. implementation changes and exact files;
7. fee applicability and, only when applicable, Fee V2 scopes, collection profile, immutable owner and project split;
8. security findings, counter-evidence and required independent reviews;
9. commands/tests actually run and their exact results;
10. separate GitHub transport/status, Registry acceptance, authenticated approval, Website launch entitlement, runtime
    and provider states; and
11. the next action, responsible owner and required authority.

If work stops on a tooling or integration boundary, state what remains possible. A tooling hold can block one package
or launch step without blocking design, implementation, source publication or submission for independent review.
