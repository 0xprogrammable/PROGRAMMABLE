# Guided intake playbook

Use this playbook before filling the full schema. It keeps intake focused while requiring an explicit record for every
product-changing decision.

## Scope

A Programmable launch submission creates one launched token and one canonical v4 launch pool. The surrounding project
may also include arbitrary applications, games, services, keepers, indexers, or reusable components. A general-purpose
hook for existing pools can be built and reviewed, but remains outside platform-launch compatibility until its token
creation, initialization, liquidity, trading, claim, failure, and retirement lifecycle is mapped.

Before asking about callbacks, decide whether a project-specific implementation of the standard Programmable fee-hook profile is sufficient or whether the
confirmed behavior must be integrated into one custom hook. Every launch-ready canonical pool needs the mandatory fee
hook. An unfamiliar mechanism is an
architecture question, not a rejection category.

The hook may be simple or highly specialized. Scope does not relax disclosure: behavior outside the canonical pool,
including ordinary ERC-20 transfers and alternative pools, must be stated separately.

## Question order

Ask only the first unresolved question. Never ask for protocol details the agent can derive.

| Pass | Plain-language question | Builder must decide | Agent may derive | Common trigger |
| --- | --- | --- | --- | --- |
| 1 | What should a person be able to launch or experience? | Outcome and creator choices | Candidate category and whether v4 is necessary | none |
| 2 | Does the project need any trade behavior beyond the fixed Programmable fee? | Behavior that requires a custom hook, or confirmation that the standard profile is sufficient | Project-specific standard-profile implementation or minimum integrated callback family | launch-path and callback policy |
| 3 | What are the two assets? | Asset origin, issuer controls and economic meaning | Canonical ordering and native ETH encoding | permissioned asset, non-standard token |
| 4 | What total swap charge should the project select, and does any other value move? | Selected total, project fee class, custody and ownership | Fixed 10 bps platform allocation, effective floor and four-quadrant mapping | hook fee, custom accounting, external liquidity |
| 5 | Who receives value and how can they leave? | Beneficiaries, split, claims, locks and exits | Exact share-sum and liability-key checks | custody, ERC-6909, position ownership |
| 6 | Who can change anything later? | Mutable powers and controllers | Authority inventory and disclosure gates | upgradeability, pause, redirect |
| 7 | What outside system can affect behavior? | Trusted dependency and failure preference | Exact source/deployment records from one coherent baseline | oracle, keeper, proof, bridge, router |
| 8 | What happens when it fails? | Revert, retry, fallback, unwind or retirement | Capability-specific failure tests | liveness and incident response |
| 9 | Which trades must work? | Directions, exactness and partial-fill intent | Specified/unspecified currencies and router actions | return delta, fee denomination |
| 10 | Where should people see or use the model? | Launch, discovery, quote, trade and claim surfaces | UI/API/indexer/monitoring contracts and integration tests | product integration |
| 11 | Is this design card accurate? | Product intent only | Permission mask, schema fields, tests and evidence gates | preflight |

Do not ask for builder identity, contact, beneficiary address or license during Explore. Ask only when the user requests a public proposal or prototype handoff.

## Design card

Show this short card before creating `submission.json`:

```text
Outcome
Pool
What happens during a trade
Where value goes
Creator choices
Fixed platform rules
Who can change what
External dependencies
Failure behavior
Intended product surfaces
Features not used
Assumptions awaiting confirmation
Next decision
```

Confirmation means only that this card reflects product intent. It does not validate technical derivations, prove safety or waive a gate.

## Conservative defaults

Propose these defaults together unless the idea requires something else:

- Official token factory, CCA price discovery, Liquidity Launcher, and a project-specific implementation of the standard Programmable fee-hook profile when no other callback behavior is needed
- One immutable fee-enforcing hook instance per canonical pool; integrate custom behavior into that single hook
- Standard fixed-supply token with no transfer tax, mint, freeze, blacklist, confiscation, proxy or rescue power
- Native ETH or one exact standard ERC-20 quote asset
- No hookData identity, external call, oracle, keeper, proof, bridge, nested action or return delta
- Minimum callback permissions only
- Static LP fee owned by pool liquidity providers, separate from the mandatory platform charge
- Effective total `max(selected,10 bps)`: immutable `10 bps` to Programmable and the remainder to the project
- Immutable Programmable owner and sole claim authority `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
- Pull-based beneficiary claims with PoolId and currency scoped liabilities
- No cross-pool netting
- Fail closed on an unavailable dependency
- Alternative pools may exist but do not inherit the model behavior
- Immutable behavior for an existing launch; new behavior ships as a new model version
- No implied Hooklist, routing, indexer, listing, API, or interface support

The builder may confirm these defaults as a group. Any departure that changes economics, custody, authority,
dependencies or exits requires separate confirmation.

If the builder requests a token transfer tax or automatic liquidity, keep the official route as the comparison and do
not reject the idea for leaving the default. A `model-specific-no-hook` proposal may be reviewed, but it remains
changes-required until the standard fee-hook profile is implemented or the policy is integrated into one custom hook. Confirm, in this
order: all buy/sell/peer rates and the immutable maximum; whether any ordinary transfer or sale can be blocked; every
recipient and value flow; mutability, authority and delay; tax exemptions and PoolManager transfer scope; every
automatic-liquidity funding source with custody, accounting, limit, withdrawal and failure rules; automatic swap
threshold, maximum, slippage, deadline and reentrancy; LP custody and exit; then routing, quote, indexer, scanner,
and listing limitations. Hidden sell blocks, address lists, transaction/wallet caps, cooldowns, and a 100 percent bound
do not continue on the permissionless path.

## Fact ownership

The agent derives without asking:

- Currency sorting and native ETH as the zero address
- Specified and unspecified currencies for all four swap quadrants
- Whether a custom hook is required and, only when it is, the minimum permission mask from confirmed behavior
- The fixed Programmable policy fields, 10 bps allocation, immutable owner, sole claim authority, and required tests
- Irrelevant capability profiles as `used: false`
- Official protocol addresses from one exact committed deployment record
- Dependency pins from one coherent selected baseline
- PoolManager callback authentication, selector, return-length and settlement obligations
- Events and tests required by enabled capabilities
- The minimum product surfaces needed to complete the confirmed lifecycle and the technical boundary of each surface

The agent never silently decides:

- Project-selected total fee economics or project recipient allocation; the Programmable allocation is fixed policy
- Custody, locks, beneficiaries or payout mutability
- Issuer, admin or upgrade powers
- External trust or fallback behavior
- Supported exactness, zero-AMM behavior or partial-fill economics
- Which third-party provider will list, index, quote, or route the pool
- Whether an accepted model is deployed, routed, discoverable, enabled, or available
- Legal claims, redemption rights or affiliation

## Required intake records

Do not create Solidity until each applicable record below is complete. Use `not used` only after the design makes that
fact explicit.

### Lifecycle

Cover creation, pool registration, initialization, liquidity formation, first transaction, swaps, liquidity changes,
donations, fee or reward accrual, claims, payout changes, dependency failure, and retirement or migration. For every
used action record:

- authenticated caller and intended actor
- assets entering and leaving
- state read and written
- recipient or custody owner
- event needed to reconstruct the action
- revert, retry, partial-fill, and recovery behavior

For an unused action, state why no enabled callback, public method, or dependency can make it relevant.

### Assets

Give each economically distinct token, native currency, share, position, claim, or entitlement a stable id. Record its
role, origin, exact chain address when it already exists, standard or non-standard transfer behavior, issuer controls,
upgrade path, and failure effect. Native ETH uses the zero address; WETH is a separate ERC-20 and must not be substituted
silently.

### Public project and token metadata

Record the exact public project name and description, token name and symbol, project and token metadata URIs, logo URIs
and byte hashes, mutability, and the owner of every mutable record. Do not silently normalize a builder's Unicode name.
Instead, show the intended spelling and normalized identity for review when compatibility or cross-script confusable
characters are present. Remove invisible and bidirectional control characters.

Ask whether any organization is being presented as official, partner, sponsor, auditor, ecosystem affiliation, or only
as technology used. Keep the exact relationship and public attributable evidence separate. For each intended external
provider, record its slug, proposed tags and labels, and whether support is not requested, unknown, or documented by a
provider-owned source. Unknown provider support remains an external review task; it never means the architecture is
unsafe or rejected.

### Hook choice and callbacks

Record `hook.used` explicitly. When it is false, keep hook-only fields neutral, select the applicable proposal route,
and keep `programmableFee.collection.status` at `pending-hook-integration`. The idea remains submit-able but cannot be
prototype- or launch-ready. Before readiness, implement the standard fee-hook profile or integrate the policy into the
project's one custom hook, with exact source, tests, and maintainer review. When `hook.used` is true, apply every callback rule below.

Set all 14 permission fields to explicit booleans. Enable only callbacks required by confirmed behavior. Record:

- immutable PoolManager authentication
- PoolId namespace and accepted PoolKey
- meaning of callback `sender`; never assume it is the end user
- hookData version, length, decoding, and identity authentication, or that hookData is unused
- exact callback selector and return shape
- callback suppression for nested or self-initiated actions
- which failures may revert the pool action

Every return-delta permission requires its parent callback. A zero-permission hook must explain why a hook address exists;
otherwise redesign it as an ordinary pool or launcher feature.

### Dynamic LP fee

Record the initial fee, how it is set during or after initialization, who or what updates it, immutable minimum and
maximum, application mode, override-flag rule, persistent update actor and call sites, rate limit, metric, unit, reference
asset, observation source and window, update cadence, behavior after liquidity falls, manipulation resistance, and stale
or failure rule. A dynamic LP fee belongs to LPs; it does not create creator revenue. If the maximum can reach 100%,
reject exact-output support unless the selected core behavior is proven compatible.

### Hook-owned fees and recipients

First complete the root `programmableFee` record using
[programmable-fee-policy.md](programmable-fee-policy.md). Apply `effective=max(selected,1000)`, allocate `1000`
hundredths of a bip to Programmable, and allocate only the remainder to the project. Accrue on executed gross quote-side
volume for every successful canonical-pool swap. Bind the immutable owner
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` as sole claim authority, permit its per-claim destination choice, and give
the builder, project, and administrators no mutation or claim path. LP fees, transfer taxes, router charges, app
payments, and alternative pools are not substitutes.

Derive quadrant-dependent before/after return-delta paths from the canonical quote asset. Ask only whether the hook can
initiate a same-pool swap: forbid that path, or require source and tests showing equivalent internal fee enforcement
because v4 skips the hook's own callback.

Record the charged currency in every supported swap quadrant, total fee bound, collection path, matching value-flow id,
liability-key dimensions, collection event, rounding, recipient ids, and split sum in parts per million. For every
recipient record role, address source, exact address or derivation, launch binding, mutability, mutation controller,
new-address validation, and mutation event. Define duplicate, zero and failed-recipient behavior, claim authorization,
payout-address changes, and treatment of historical entitlements. A recipient may not claim or redirect another
recipient's entitlement unless that power is explicit and accepted as part of the trust model.

### Settlement and claims

For every custom-accounting or return-delta path, list actions in execution order. Each action names the actor, currency,
delta owner, sign before the action, exact amount rule, operation, and completion deadline. Debts and credits must end at
zero before the PoolManager unlock ends.

When ERC-6909 claims are used, record currency-id derivation, owner, operator policy, mint, burn and redemption flows,
PoolId and beneficiary liability keys, transfer policy, dust rule, and the aggregate solvency equation. A
`sync → transfer-to-PoolManager → settle` sequence must preserve one actor, currency, and amount basis.

### Dependencies

Give every dependency a stable unique id. For each onchain dependency record chain, address, interface, exact source
revision or package version, license, runtime expectation, upgrade authority, trust assumption, failure rule, fallback,
and monitoring requirement. Resolve `deploymentRecordId` through the two committed tiers: the pinned official-feed
snapshot and the separate official Launchpad reference. Preserve the returned authority digest and trust tier. Base or
Unichain reference selection remains runtime-unverified and must not be described as Programmable-tested; an address
copied from prose is not equivalent.

For offchain dependencies record owner, source, version or revision, integrity where available, authentication, data
freshness, funding, failure behavior, fallback, and who operates it. A dependency is not optional merely because the
contract can continue in a degraded state.

The integration record references the exact router, Permit2, StateView, and Quoter dependency ids; exact registry
package versions and integrity hashes; optional paired source repositories and revisions; mandatory official source
bindings for documented Uniswap SDK packages; the explicit Universal Router command and v4 action plan; settlement and
Permit2 modes; final swap-delta validation; quote-to-execution parity; and the application source and integration tests
that implement those claims.

### Product integration plan

Record every intended product surface before implementation. A proposal may leave exact repository paths unresolved.
Treat them as future maintainer-owned handoff work, and do not imply that product support exists.

For a prototype, translate the confirmed plan into `submission.json.integration.platformHandoff`: set `intended`, fill
`handoffNotes`, add contributor path proposals only when known, keep `maintainerReviewRequired` true, `selfApproval`
and `availabilityClaimed` false, and use only `not-requested` or `pending-maintainer-review` for `reviewStatus`.

For every surface, record its owner, source of truth, input, output, dependencies, error behavior, unsupported behavior,
source paths, executable tests, operating requirement, and current evidence:

- **UI:** routes or screens, user actions, displayed fields, canonical-pool proof, disclosures, loading and unsupported
  states, and feature gate
- **API:** operations, request and response schemas, chain and model version, cache and freshness policy,
  authentication and rate limits where used, and error model
- **Indexer:** addresses, start block, event signatures, entity keys, finality, reorg handling, backfill,
  reconciliation, lag target, and chain fallback
- **Quote:** exact PoolKey, direction, exactness, amount and currency semantics, block tag, Quoter generation, hookData,
  fee and price-impact fields, timeout and stale behavior, and execution parity
- **Trade:** Universal Router generation, V4 actions, Permit2 mode, native value and refund, slippage, deadline,
  partial fills, final-delta validation, simulation, receipt states, and recovery
- **Claim:** entitlement source, liability keys, preview, caller and recipient authorization, payout changes,
  transaction states, failed-recipient behavior, recovery, and historical rights
- **Monitoring:** contract and provider checks, invariants and thresholds, alert owner, runbook, escalation, RPC
  fallback, keeper or oracle health, indexer lag, routing drift, and drill evidence

Mark a surface `not used` only when the lifecycle makes it unnecessary. A third-party indexer may aid discovery or
display, but it is never the source of truth for receipts, runtime, balances, claims, or lifecycle completion.

Do not ask the builder to choose implementation details that follow from the pinned stack. Do ask when a product
surface changes who can act, which trades work, where value appears, what can fail, or what users are promised.

## Plain-language fee translation

- **LP fee:** paid to liquidity providers in that pool. It is not creator revenue.
- **Programmable volume fee:** always 10 bps of executed gross quote-side volume on the canonical pool. It is included
  inside the effective total, not added on top, and is owned and claimable only by the immutable Programmable owner.
- **Hook-owned charge:** accounted by hook logic and owed to explicit recipients. Its currency can change by direction and exactness.
- **Token transfer tax:** runs on ERC-20 transfers outside the pool too. It is not part of the conservative default, but
  a transparent bounded version may enter model-specific no-hook review with exact recipients, authority, custody,
  provider limitations, received-amount semantics, and liveness tests.

Units in the schema are hundredths of a basis point:

```text
1 = 0.0001%
100 = 0.01%
10,000 = 1%
1,000,000 = 100%
```

“Creator fee in ETH” is not automatic. For every supported swap quadrant, prove which currency is charged and how any non-ETH asset becomes ETH without hiding a swap, custody or price-impact path.

## Mandatory semantic review

The deterministic validator checks structure and known cross-field rules. It cannot prove that free text is true.

Before presenting `PROTOTYPE_READY`, independently verify that:

1. Every rule is causal, non-circular and consistent with structured fields.
2. Every fee or accounting rule has a worked numerical example.
3. The examples include value conservation, rounding and one failure case.
4. Direction-sensitive behavior covers all four swap quadrants or explicitly rejects unsupported modes.
5. The design card, `submission.json`, proposal, threat model and test plan do not contradict one another.
6. Every enabled callback is necessary and its allowed-revert behavior is disclosed.
7. Every external fact is labelled as builder-stated, agent-derived, or evidence-backed.
8. Every dependency id resolves to exactly one declared record and every referenced id exists.
9. The mandatory fee is integrated into the canonical-pool hook, non-additive, bound to all four swap modes, and cannot
   be claimed or redirected by the builder, project, or an administrator.

If a material free-text claim lacks a causal explanation or supporting evidence, semantic review is incomplete. Report
`REDESIGN_REQUIRED` in the human handoff even when the structural validator returns `PROTOTYPE_READY`.

## Stop condition

Stop asking questions when all product-changing facts are confirmed and every remaining field is a deterministic technical derivation. Then render the structured submission, run preflight and show only the highest-priority unresolved decision or exact result.
