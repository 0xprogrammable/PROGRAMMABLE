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

- If false, identify the ordinary no-hook launch profile and explain why no custom pool callback is needed.
- If true, explain which atomic pool-side behavior requires a custom hook and why an ordinary token, router, app, or
  offchain service is insufficient.

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
permission mask, or hook CREATE2 address applies; do not add placeholder callback details.

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

Distinguish LP fees, hook-owned charges, token transfer taxes, app or game payments, and service-controlled value. Include
only mechanisms the design uses. For dynamic LP fees, state initial value, initialization, application and update paths,
override rule, persistent actor and call sites, rate limit, bounds, metric, unit, observation, cadence, manipulation
resistance, and failure rule. For hook-owned value, state charged currency by supported swap quadrant, collection path,
value-flow id, liability keys, event, recipient shares and address bindings, rounding, claims, payout changes, historic
entitlements, and failed-recipient behavior. List custom-accounting settlement actions in order and state the conservation
equation. For app, game, or service value, state custody, authorization, replay protection, failure, refund, and exit.

## Semantic examples

Provide one numerical example for each fee or accounting rule the project introduces, including rounding, value
conservation, and one failure case. If the project changes or mediates swap behavior, cover all four swap quadrants or
state which modes are rejected and why. Otherwise state that the ordinary pool path introduces no custom swap
accounting.

## Fact provenance

Separate `builder-stated`, `agent-derived`, and `evidence-backed` facts. Do not label a design-card confirmation as
technical evidence.

## Open decisions

List architecture-changing questions that remain unresolved. Do not hide them in implementation notes.

This is a public, non-confidential proposal. Acceptance, independent review, product integration, deployment, routing,
listing, scheduling and availability require separate evidence records.
