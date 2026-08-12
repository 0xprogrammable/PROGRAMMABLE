# {{MODEL_NAME}}

> Authoring scaffold: replace every instruction and choice marker below with project-specific facts or an explicit
> not-applicable reason. Do not retain the instructional prose in the completed artifact.

**Submission stage:** Proposal
**Model id:** `{{MODEL_ID}}`
**Review intent:** Architecture review | Launch admission
**Applicant state:** Concept only | Executable prototype
**Platform capabilities required:** List exact capability ids or `none identified`
**Package contract:** Exact package id/digest, trusted validator revision, target base, and allowed files
**Policy provenance:** Exact skill revision, approval-criteria revision/digest, and fee-policy version

{{MODEL_SUMMARY}}

## Product and architecture decision

| Decision | Exact result |
| --- | --- |
| User and creator job | Who does what and why |
| Observable success | Measurable product outcome; do not substitute token price or hype |
| Economic mechanism | Source, destination, custody and terminal state of every unit of value or right |
| Incentives and abuse | Expected behavior plus Sybil, MEV, collusion, griefing, manipulation and adverse selection |
| State machine | Creation, funding, activation, core action, update, result, claim or exit, failure or recovery and retirement |
| Considered architectures | Two or three viable shapes, including a simpler standard or no-custom-hook route when applicable |
| Selected design | Smallest complete shape and why a hook is or is not required |
| Responsibility split | Value-critical onchain enforcement, authenticated offchain computation or data, display-only logic, platform modules and providers |
| Efficiency | Capital use, gas, latency, liquidity fragmentation, operating dependencies and review complexity |
| Expert routing | Current slice, at most one build specialist, at most one assurance specialist and bounded handback, or `none` |
| First vertical slice | Mechanism, protocol, minimum experience, operations and admission pieces required for one closed loop |
| Non-goals | Speculative features deliberately excluded from this revision |
| Safe defaults | Every automatically selected reversible technical choice |
| Material facts | Prompt- or evidence-sourced money, custody, authority, trust, legal and terminal decisions |
| Remaining owner decision | One exact question or `none` |

Autopilot completes this record before implementation. Do not claim one-prompt completion while a material fact remains
an assumption. Guided projects use the same record after confirmation. Conversation is not security evidence; exact
behavior, source, plan and tests are.

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

For every documented numeric or temporal rule, list the unit, legal minimum and maximum, constructor/initializer/setter
enforcement sites, overflow behavior, and below/at/above boundary tests. A prose bound that code can bypass is not a
confirmed design.

## Why Uniswap v4 and architecture choice

Explain why the project uses Uniswap v4. State `hook.used` explicitly. Here `true` means any nonzero hook address on the
declared canonical fee pool, including a project-specific standard Programmable profile; it is mechanically the schema's
custom-hook route even without custom product behavior. Name the profile as `standard-programmable` or
`integrated-custom` in prose until the released schema adds a typed field.

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

## Executable launch plan

For launch admission, bind the exact data-only launch-plan path and hash from the public applicant repository. Include
that path in the exact Application V3 source closure and summarize its deployable targets, ABI-checked constructor and
initializer arguments, dependency order, address locators, CREATE2
permission mining, PoolKey and initial price, allocations, liquidity and canonical-position custody, platform capability
ids, atomicity boundaries, failure behavior, and postconditions. Text-only post-deployment instructions are not an
executable plan. Do not invent an unversioned central field when the released Application V3 schema can only bind the
plan through content-addressed public source and review evidence.

When the resolved target contract explicitly selects Launch Graph V1, compile the plan with
`cli.mjs launch-plan-graph compile <input.json>` and bind both schemas, exact input and deterministic output hashes. Its
six-file or authority-extended seven-file setting is only that central submission profile. Do not add `launch.json` to
the active Application V3 package by inference, and never describe `EXECUTABLE_CANDIDATE` as approval or launch authority.

For every mutually wired hook, token, NFT, vault, router, registrar, controller, factory, or escrow, state how both exact
identities are fixed before value can move and how a wrong interface-compatible counterpart is rejected. For CREATE2,
bind deployer runtime and authority, salt, initcode, constructor arguments, permission bits, predicted address,
pre-existing-code policy, retry behavior, and the assumption that prevents foreign or metamorphic code adoption.

State the operational boundary as `prepare -> analyze -> simulate -> authorize -> broadcast -> verify -> activate`.
This submission may specify and simulate the launch but cannot self-authorize execution. Identify the later platform
owner for exact-chain bundle authorization, gas-only signer isolation, limits/expiry, idempotency, secret handling,
receipt/runtime readback, source verification, lifecycle proof, monitoring, and activation. Simulation and provenance
attestation must not be presented as security, approval, deployment, or launchability.

## Assets, pool behavior, optional callbacks, and integration

Record stable asset ids, origin, address where existing, token behavior, issuer controls, and failure effect. A project
may have multiple assets, pools, markets, chains, apps, or services; declare each launch unit and identify which primary
asset/canonical fee pool fits the current runtime. Define each relevant PoolKey, launch and liquidity path, router
generation, complete supported/rejected four-quadrant matrix, partial fills, slippage, deadline, Permit2, state reads,
and events. Missing support for the wider shape is a platform capability gate after technical integrity passes.

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
- every successful supported canonical-PoolKey swap, executed gross quote-side basis after partial fills, and a complete
  four-quadrant matrix in which unsupported modes reject before value, state, liability, quote, router, or UI movement;
- quadrant-dependent before/after return-delta paths, plus a same-pool self-call policy that forbids hook-initiated
  same-pool swaps or proves equivalent internal fee enforcement;
- project-specific standard-profile hook or single integrated custom hook, with no router, LP-fee, transfer-tax, or alternative-pool substitute;
- immutable owner and sole claim authority `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`, able to claim anytime to itself or an owner-selected destination for that claim;
- 10 bps accrued as a claimable liability, not merely auto-transferred, with `claimAvailability: anytime`;
- no builder, project, administrator, stored mutable recipient, rescue, sweep, or redirect path; and
- `(poolId,currency,owner)` liabilities, no cross-pool netting, value-flow id, collection event, claim event, rounding,
  source paths, and test paths.

For any caller-selected `payer`, sponsor, `from`, Permit2 owner, or allowance source, state why that actor intended this
exact action. Default payer to the authenticated caller, or bind payer-originated typed authorization to chain,
verifying contract, action, token, amount/max, beneficiary/recipient, complete launch/configuration hash, target PoolKey/
hook/router, nonce, and deadline. Allowance alone is not launch intent.

Distinguish LP fees, hook-owned charges, token transfer taxes, app or game payments, and service-controlled value. Include
only mechanisms the design uses. For dynamic LP fees, state initial value, initialization, application and update paths,
override rule, persistent actor and call sites, rate limit, bounds, metric, unit, observation, cadence, manipulation
resistance, and failure rule. For hook-owned value, state charged currency by supported swap quadrant, collection path,
value-flow id, liability keys, event, recipient shares and address bindings, rounding, claims, payout changes, historic
entitlements, and failed-recipient behavior. List custom-accounting settlement actions in order and state the conservation
equation. For app, game, or service value, state custody, authorization, replay protection, failure, refund, and exit.

For a `tokenMechanics` transfer tax with either hook route, state buy, sell and peer-transfer rates in hundredths of a basis point, the
immutable maximum, exemptions, PoolManager transfer scope, recipient destinations and shares, value-flow ids, mutability,
authority, delay, shared-PoolManager classification, liquidity-operation and alternative-pool treatment, event, and failure rule. State explicitly that ordinary peer transfers, pool buys, and pool sells stay
permitted and that no transaction cap, wallet cap, cooldown, allowlist, or denylist exists. For automatic liquidity,
state the funding recipient id, safe trigger mode, pool-transfer suppression, threshold, maximum swap, slippage, deadline, execution and reentrancy rule, actual-received
accounting, LP position custodian and transferability, exit, emergency recovery, events, and atomic failure behavior.

List routing, quote, indexer, scanner, aggregator, and listing limitations separately. Local compatibility is not provider
approval; name the tested fallback when an external provider does not support the exact token runtime.

## Semantic examples

Provide one numerical example for each fee or accounting rule the project introduces, including rounding, value
conservation, and one failure case. Cover all four swap quadrants as supported-and-charged or unsupported-and-rejected
before movement. The mandatory fee applies to every successful supported mode; it does not force a design to expose a
mode that its complete hook/router/quoter/UI boundary safely rejects. For zero-core-AMM custom accounting, prove final
positive user output, backing, conservation, exactness/slippage, deadline, and refunds.

## Fact provenance

Separate `builder-stated`, `agent-derived`, and `evidence-backed` facts. Do not label a design-card confirmation as
technical evidence.

## Open decisions

List architecture-changing questions that remain unresolved. Do not hide them in implementation notes.

This is a public, non-confidential proposal. The skill and local checker do not prove that fees are collected live.
Acceptance, independent review, product integration, deployment, runtime matching, lifecycle evidence, monitoring, routing,
listing, scheduling and availability require separate evidence records.
