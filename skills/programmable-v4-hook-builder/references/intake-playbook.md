# Guided intake playbook

Use this playbook after the public-safe intent contract and before implementation. Ask only the next answer that changes
the product. Derive technical detail from confirmed intent and pinned evidence rather than making the builder speak
protocol jargon.

For a build or create request, run [business-system-compiler.md](business-system-compiler.md) first and use Autopilot.
The table below becomes an internal completeness check, not a questionnaire. Apply safe reversible technical defaults,
record assumptions, and ask only when one material owner fact has no safe default that preserves the requested outcome.
Guided Explore uses the same order interactively.

## Open scope

A Programmable project may contain zero, one, or many assets, markets, pools, hooks, contracts, apps, games, services,
keepers, indexers, repositories, or standalone settlement systems. Do not infer a token, trade, AMM, PoolKey, hook, fixed
supply, or frontend merely because a starter commonly contains one. One Uniswap v4 PoolKey has one hook-address field;
that protocol fact does not limit the wider project to one PoolKey, one hook deployment, or one component.

Templates accelerate planning. Except for a fee reference kernel used within its exact documented profile, they are not
implemented code, inherited evidence, approval, or a list of permitted product types. Preserve an unfamiliar mechanism
as an owner-defined capability and route its actual risks to architecture review.

## Question order

Ask only the first unresolved material question. Skip a pass whose subject is absent.

| Pass | Plain-language question | Builder decides | Agent derives |
| --- | --- | --- | --- |
| 1 | What should a person be able to do or experience? | Outcome and material promises | Candidate entities and surfaces |
| 2 | What things or rights exist, and can their amount change? | Economic meaning, mint/burn/redeem rights | Asset and component graph |
| 3 | Does value move, trade, settle, or remain purely informational? | Economic action and loss exposure | Markets, flows, fee applicability |
| 4 | If a market exists, how is price and settlement determined? | AMM, contract price, auction, order, oracle, service, or another rule | Exact architecture and required evidence |
| 5 | Who pays, receives, holds, or may lose value? | Beneficiaries, custody, claims and exits | Conservation and liability checks |
| 6 | Who can change or stop behavior? | Authorities, bounds, delay and recourse | Role/capability matrix |
| 7 | Which outside systems can affect outcomes? | Accepted trust and failure preference | Dependency and integrity records |
| 8 | What happens on failure, cancellation, expiry, dispute, or retirement? | User-visible outcome | Failure and recovery tests |
| 9 | Where will people use or observe it? | Product surfaces and public promises | UI/API/indexer/service contracts |
| 10 | Is the design card faithful? | Product intent only | Schema fields, implementation order and evidence plan |

Ask for builder identity, contact, beneficiary addresses and repository publication details only when the requested stage
needs them. Never ask for a private key, seed phrase, wallet file, credential, API token, private RPC URL, or unrelated
personal data.

## Design card

Record a short card before materializing `submission.v2.json`. Guided mode shows it for confirmation; Autopilot retains
it as the assumption ledger and continues when no material owner fact remains unresolved:

```text
Outcome and users
Entities, assets, and rights
Actions and lifecycle
Markets or settlement, if any
Value and custody
Authorities and trust
External dependencies
Failure, exit, and retirement
Product surfaces
Fee applicability: unresolved / applicable / not-applicable
Assumptions and next material decision
```

Confirmation, when requested, says only that the card reflects intended behavior. It does not validate a derivation,
waive a gate, prove implementation, or authorize an external action.

## Defaults without architecture invention

Offer defaults only after the relevant surface is confirmed:

- Prefer immutable or narrowly bounded behavior, pull-based claims, explicit exits and failure isolation.
- Prefer pinned official components when their behavior fits; do not force a project into a launcher, token factory,
  AMM, hook, fixed supply, quote asset, signer, oracle, keeper, server, or provider it does not need.
- For a confirmed v4 hook, start with all 14 permissions disabled and enable only proven callbacks.
- For a confirmed canonical v4 swap, use the minimum complete PoolKey, callback, router and settlement surface.
- For a confirmed `programmable-canonical` execution scope, apply Fee V2 exactly once through its actual settlement path.
- Keep external provider support `unknown` until current attributable evidence proves its exact surface.

The builder may delegate reversible choices. Record each proposed default and its effect; do not silently decide
economics, custody, loss exposure, mutable authority, external trust, exit rights, legal claims, or publication.

## Derive fee applicability first

Classify from the structured market graph, never from a template name or fee keyword:

- A proposal uses `feeApplicability: unresolved` and null fee-instance fields while execution classes remain unresolved.
- A prototype with one or more `programmable-canonical` execution scopes uses `applicable`. Each canonical market binds
  exactly one Fee V2 scope and a real `fee-policy.v2.json` instance.
- A prototype with no canonical scope and only `external`, `non-launchable`, or non-market surfaces uses
  `not-applicable`. Keep the instance path, repository and digest null; do not invent a market, PoolKey, hook, receipt, or
  volume solely to satisfy the schema.

An `unknown` execution class grants no exemption and must resolve from source before prototype or launch review. A
zero-scope project may still be implemented, submitted and accepted for review. Registry Acceptance V3 preserves its
`not-applicable` classification; Launch Bundle V2 is the separate canonical fee-bearing path and must not turn N/A into
authorization.

If applicability is `applicable`, read [programmable-fee-policy-v2.md](programmable-fee-policy-v2.md). The immutable
Programmable entitlement is inclusive 10 bps of executed gross quote-side volume for each canonical scope, owned and
claimable only by `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. The platform admin wallet is independent and cannot
claim, redirect, sweep, replace, or net that liability.

## Build the complete V2 graph

Before implementation, record every applicable element in `submission.v2.json`:

- targets and product surfaces;
- assets, rights, supply behavior and issuer controls;
- markets, price formation, settlement, execution class and native-AMM mode;
- hooks and non-hook components;
- lifecycle phases and transitions, including recurring cycles when intended;
- value flows, liabilities, recipients, custody and exits;
- authorities, bounds, mutation paths and recourse;
- dependencies, failure modes and recovery;
- capability profiles, source bindings, tests and evidence; and
- owner-defined kinds through exact non-executable schema bindings.

The lifecycle is a product graph and may contain recurring operational cycles. Provenance and revision lineage remain
acyclic and append-only. Require creation, pool initialization or liquidity phases only when the architecture uses them.

Model token transfer taxes, dynamic supply, automatic liquidity, burns, rebases, vesting and other token behavior through
V2 assets, components, value flows, authorities and capability profiles. Do not use historical V1 top-level
`tokenMechanics`, `noHookArchitecture`, or `hook.used` fields in new work. A transparent bounded permissioned transfer or
exit control is a trust/review surface, not automatically a hard conflict; apply the exact security predicates.

## Conditional protocol intake

### Confirmed v4 hook

Only when a hook exists, derive and record:

- canonical PoolManager authentication and the meaning of callback `sender`;
- all 14 permission booleans, address-bit agreement and exact callback return shapes;
- PoolKey/PoolId admission and state isolation;
- hookData version, decoding and authentication when used;
- nested/self-call behavior and every backed, bounded, conserved return delta; and
- settlement completion, reentrancy and failure behavior.

A project may use several PoolKeys or hook deployments. State explicitly which component owns each callback and fee path.

### Confirmed canonical v4 swap or fee scope

Only then derive specified/unspecified currency, exact-input/exact-output behavior in each exposed direction, partial
fills, rounding, slippage, deadline, price limits, router parity, delta conservation and fee vectors. Test all four
direction/exactness quadrants only when all four are exposed; explicitly reject unsupported modes and prove they are
unreachable.

### Non-v4 or zero-scope system

Do not ask for or fabricate PoolManager, PoolKey, permission bits, callback selectors, hookData, four swap quadrants or
Fee V2 receipts. Test the actual API, contract, service, game, data, authorization, economic and failure surfaces instead.

## Surface-specific records

### Assets and rights

Give each token, native currency, position, share, claim, item or entitlement a stable id. Record origin, chain/address
when existing, supply changes, transfer behavior, issuer powers, backing or redemption, failure effect and user rights.
Native ETH and WETH are distinct. A dynamic or contract-controlled supply is valid when its authority, conservation and
public claims match the implementation.

### Value, custody and exits

For each flow name actors, assets, amount rule, custody owner, liability, state transition, event, failure outcome and
exit/refund/cancellation path. Separate completed owner-authorized donations, burns or purchases with no remaining
entitlement from value still owed or held for a user.

### Authorities

List every mint, burn, pause, restriction, upgrade, arbitrary call, sweep, rescue, payout, settlement and configuration
capability. Record exact scope, controller, bounds, delay, disclosure, beneficiary constraints and recovery. Disclosed
bounded control receives trust review; it is a hard conflict only when an exact security predicate matches.

### Dependencies and connected surfaces

For each onchain or offchain dependency bind identity, source/version, integrity, operator or upgrade authority,
authentication, freshness, funding, failure behavior, fallback and monitoring. For each app, game, API, service, keeper,
oracle, indexer, quote, trade, claim or monitoring surface record owner, source of truth, inputs, outputs, errors,
unsupported states, source paths, tests and current evidence. A third-party indexer is not authoritative proof of
receipts, balances, custody, claims or execution.

Separate a product dependency from an agent-capability dependency. Missing Three.js, maps, backend, database, domain-
language or provider tooling does not make the mechanism unsafe and must not trigger category rejection. Preserve the
idea, finish independently valid work, and return `INTEGRATION_PENDING` with the missing surface's interface/schema,
trust boundary, failure behavior, required tests, responsible owner or specialist and resume condition. Never report the
project complete until that handoff is implemented and its evidence joins the review target.

### Public metadata and providers

Preserve the builder's intended public spelling and record mutable owners, URIs, hashes, affiliations and disclosures.
Reject hidden/control/bidirectional identity characters rather than silently renaming a project. Track every external
provider independently as `not-requested`, `unknown`, evidence-backed `unsupported`, `stale`, or `provider-confirmed`.
Provider uncertainty is not a security verdict.

## Exact security boundary

Unknown architecture or missing evidence routes to repair, trust review, or independent review. Stop only when structured
evidence matches an exact hard predicate, including unauthorized privileged value movement, bypass of an enforceable
backing/fee/destination rule, seizure or redirection of owed value, an unauthorized irreversible disposition, a false
autonomous-exit or guaranteed-solvency promise, no exit for an outstanding entitlement, no-op accounting on a path that
claims custom accounting, unauthorized zero output, or participant-value randomness exposed to bias, false fairness,
manipulable entitlement or unbounded withholding.

Do not blanket-reject disclosed bounded controls, sponsor-funded disclosed-bias randomness, authorized burns/donations,
managed redemption, contingent/defaultable claims, or invariant-preserving rebalancing. Record their trust tier,
limitations, tests and accountable review unless an exact hard predicate applies.

## Semantic readiness

Before `DESIGN_READY`, verify that:

1. every material promise has a causal implementation and failure path or remains visibly unresolved;
2. every value rule has conservation, boundary, rounding and failure examples appropriate to its surface;
3. every referenced id and dependency resolves exactly once;
4. every enabled authority and external trust boundary is disclosed;
5. every applicable protocol obligation is present and every inapplicable one is absent rather than fabricated;
6. the intent card, V2 graph, architecture ledger, threat model and test plan agree; and
7. no template, tool, provider or local check is represented as implementation, approval, audit, deployment or launch.

Stop asking questions when all product-changing facts are confirmed and every remaining field follows deterministically.
Then materialize the V2 package, run preflight and show only the highest-priority unresolved decision or exact result.
