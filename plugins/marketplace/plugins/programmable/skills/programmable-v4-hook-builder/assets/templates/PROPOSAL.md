# {{MODEL_NAME}}

**Submission stage:** Proposal
**Model id:** `{{MODEL_ID}}`

{{MODEL_SUMMARY}}

## Design card

| Item | Confirmed design |
| --- | --- |
| Outcome | What a creator launches and what traders and LPs experience |
| Pool | Two assets, canonical PoolKey, liquidity formation, and alternative-pool behavior |
| During a trade | Exact behavior by direction and exactness |
| Value | Every fee, reward, recipient, custody owner, claim, and exit |
| Creator choices | Launch-time parameters and immutable bounds |
| Fixed platform rules | Behavior a creator cannot change |
| Authorities | Every mutable capability and controller |
| Dependencies | Stable ids, exact provenance, trust, failure, and fallback |
| Failure | Revert, retry, fallback, unwind, migration, or retirement |
| Project surfaces | Declared contracts, app, game, service, keeper, oracle, indexer, and their languages |
| Product surfaces | Intended launch, discovery, quote, trade, claim, and monitoring paths |
| Not used | Lifecycle actions and capabilities explicitly excluded |

## Why Uniswap v4 and architecture choice

Explain why the project uses Uniswap v4. State `hook.used` explicitly.

- If false, select the applicable proposal route, set `programmableFee.collection.status` to
  `pending-hook-integration`, and state that the design is not prototype- or launch-ready.
- If true, state whether the project implements the standard Programmable fee-hook profile or integrates the fee policy
  into its one custom hook. Bind exact source and tests; neither path is pre-reviewed by this template.

Also state which behavior belongs in contracts, the app or game, and any service, keeper, oracle, or indexer. Do not move
an offchain concern into a hook merely to fill this template.

## Lifecycle

For creation, registration, initialization, liquidity formation, first interaction, swaps, liquidity changes, donations,
fees or rewards, game or app actions, service jobs, claims, payout changes, dependency failure, and retirement, state the
caller or actor, assets, state changes, recipient, event or observable result, and failure behavior. Mark unused actions
with a reason.

## Assets, pool behavior, optional callbacks, and integration

Record stable asset ids, origin, address where existing, token behavior, issuer controls, and failure effect. Define the
canonical PoolKey, launch and liquidity path, router generation, supported swap modes, partial fills, slippage, deadline,
Permit2, state reads, and events.

If `hook.used` is true, also record all 14 permission booleans, the derived mask, PoolManager authentication, callback
sender meaning, hookData policy, return shapes, and nested-action suppression. If false, state that no custom callback,
permission mask, or hook CREATE2 address applies and that mandatory fee integration remains changes-required.

## Product integration plan

State whether each surface is planned, not used with a reason, or blocked. A proposal defines the boundary; it does not
claim that the product or a third-party provider implements it.

For a prototype, mirror the plan in `submission.json.integration.platformHandoff`. Contributor review stays
`not-requested` or `pending-maintainer-review`; maintainer review remains required, self-approval remains false, and
availability remains unclaimed.

| Surface | Intended behavior | Source of truth | Inputs and outputs | Failure or unsupported state | Planned paths and tests |
| --- | --- | --- | --- | --- | --- |
| UI | Routes, actions, displayed data, disclosures, and feature gate |  |  |  |  |
| App or game | Rules, player/user state, wallet actions, persistence, and client trust boundary |  |  |  |  |
| API | Operations, schemas, freshness, authentication, rate limits, and errors |  |  |  |  |
| Service, keeper, or oracle | Jobs, triggers, authority, freshness, retries, funding, fallback, and monitoring |  |  |  |  |
| Indexer | Events, start block, finality, reorgs, backfill, reconciliation, and lag |  |  |  |  |
| Quote | PoolKey, direction, exactness, amounts, block, Quoter, hookData when used, fees, and parity |  |  |  |  |
| Trade | Router actions, Permit2, native value, refunds, slippage, deadlines, fills, and receipts |  |  |  |  |
| Claim | Entitlement, liability keys, preview, authorization, payout changes, states, and recovery |  |  |  |  |
| Monitoring | Checks, thresholds, owner, runbook, escalation, fallbacks, and drills |  |  |  |  |

Name intended Hooklist, routing, discovery, or listing providers separately. Their support is not implied by protocol
compatibility, local tests, or Programmable acceptance.

## Fees, recipients, and settlement

Start with the root `programmableFee` record. State:

- `effective=max(selected total,10 bps)`, exactly `10 bps` to Programmable, and only the remainder to the project;
- the worked examples `0 -> 10 bps + 0` and `3% -> 0.1% + 2.9%`, never `3.1%`;
- every successful canonical-PoolKey swap, executed gross quote-side basis after partial fills, and all four swap modes;
- quadrant-dependent before/after return-delta paths, plus a same-pool self-call policy that forbids hook-initiated
  same-pool swaps or proves equivalent internal fee enforcement;
- project-specific standard-profile hook or single integrated custom hook, with no router, LP-fee, transfer-tax, or alternative-pool substitute;
- immutable owner and sole claim authority `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`, able to claim anytime to itself or an owner-selected destination for that claim;
- 10 bps accrued as a claimable liability, not merely auto-transferred, with `claimAvailability: anytime`;
- no builder, project, administrator, stored mutable recipient, rescue, sweep, or redirect path; and
- `(poolId,currency,owner)` liabilities, no cross-pool netting, value-flow id, collection event, claim event, rounding,
  source paths, and test paths.

Distinguish LP fees, hook-owned charges, token transfer taxes, app or game payments, and service-controlled value. Include
only mechanisms the design uses. For dynamic LP fees, state initial value, initialization, application and update paths,
override rule, persistent actor and call sites, rate limit, bounds, metric, unit, observation, cadence, manipulation
resistance, and failure rule. For hook-owned value, state charged currency by supported swap quadrant, collection path,
value-flow id, liability keys, event, recipient shares and address bindings, rounding, claims, payout changes, historic
entitlements, and failed-recipient behavior. List custom-accounting settlement actions in order and state the conservation
equation. For app, game, or service value, state custody, authorization, replay protection, failure, refund, and exit.

For a model-specific no-hook transfer tax, state buy, sell and peer-transfer rates in hundredths of a basis point, the
immutable maximum, exemptions, PoolManager transfer scope, recipient destinations and shares, value-flow ids, mutability,
authority, delay, shared-PoolManager classification, liquidity-operation and alternative-pool treatment, event, and failure rule. State explicitly that ordinary peer transfers, pool buys, and pool sells stay
permitted and that no transaction cap, wallet cap, cooldown, allowlist, or denylist exists. For automatic liquidity,
state the funding recipient id, safe trigger mode, pool-transfer suppression, threshold, maximum swap, slippage, deadline, execution and reentrancy rule, actual-received
accounting, LP position custodian and transferability, exit, emergency recovery, events, and atomic failure behavior.

List routing, quote, indexer, scanner, aggregator, and listing limitations separately. Local compatibility is not provider
approval; name the tested fallback when an external provider does not support the exact token runtime.

## Semantic examples

Provide one numerical example for each fee or accounting rule the project introduces, including rounding, value
conservation, and one failure case. If the project changes or mediates swap behavior, cover all four swap quadrants or
state which modes are rejected and why. The mandatory Programmable fee always covers all four modes for launch readiness.

## Fact provenance

Separate `builder-stated`, `agent-derived`, and `evidence-backed` facts. Do not label a design-card confirmation as
technical evidence.

## Open decisions

List architecture-changing questions that remain unresolved. Do not hide them in implementation notes.

This is a public, non-confidential proposal. The skill and local checker do not prove that fees are collected live.
Acceptance, independent review, product integration, deployment, runtime matching, lifecycle evidence, monitoring, routing,
listing, scheduling and availability require separate evidence records.
