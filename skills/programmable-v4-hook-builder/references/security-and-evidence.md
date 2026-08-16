# Security and evidence workflow

This workflow scales evidence to the project's actual surfaces and capability risk. It is not an audit substitute and
does not require a hook, pool, token or Fee V2 instance where none exists.

For launch-admission evidence, also load [builder-reviewer-alignment.md](builder-reviewer-alignment.md),
[execution-gates-and-attestation.md](execution-gates-and-attestation.md), and
[submission-regressions.md](submission-regressions.md). They define property symmetry, truthful tool outcomes,
independence, attestation limits, and invalidation without pretending the current deterministic validator enforces
every prose gate.

## 1. Freeze the review target

Before security work, record the universal target:

- model/component id and semantic version;
- every source repository, exact commit/tree and clean-worktree status;
- every dependency repository/commit or package version/integrity, license, tree hash and independent-versus-declared
  verification state;
- every public entrypoint, actor, authority, asset/value flow, liability, beneficiary, failure mode and exit path; and
- deployment/configuration identities only when runtime or provider evidence is actually claimed.

Then record surface-specific data only when present:

- for Solidity/EVM code: compiler source and settings, build-info, bytecode metadata, executable/runtime hashes and FFI;
- for an onchain dependency: chain, address, interface, runtime, trusted deployment record and deployment-feed revision;
- for a v4 hook: PoolManager/PoolKey, permission mask, constructor, CREATE2 inputs, expected address/runtime and router/SDK
  generation;
- for an applicable Programmable fee scope: project applicability, canonical scope/quote asset, collection profile,
  inclusive split, immutable owner, claim/liability namespace, value flow, events, tests and rounding; and
- for an exact zero-scope `not-applicable` project: the complete graph proof and null fee instance/conformance/review
  bindings, never fabricated hook or pool data.

Any change to these values creates a new review target. Never carry a result across a changed target silently.

For a prototype, bind at least one successful source-owned GitHub Actions run to the exact public repository id,
commit, tree, and workflow blob through `implementation.githubActionsRunIds`. The pinned Foundry and npm workflows in
`assets/templates/` are versioned starting points, not universal proof or a safety claim. A green source workflow means
only that its declared commands completed. Registry package checks do not execute the project and do not evaluate
whether those commands test the required properties.

Compiler build-info and large tool artifacts remain builder-local evidence bound by the exact source commit and review
target unless an independent maintainer rebuild reproduces them. Never describe their presence in a submission as an
independent rebuild, runtime verification, or audit.

## 2. Static and structural checks

Run and preserve results for every project's source/dependency closure, public surface, state writers, authorization map,
value movements, failure/exit paths and license provenance. Apply language- and runtime-specific tools only to matching
evidence.

For Solidity/EVM surfaces, include compiler known-bug review, warnings, size, Slither or equivalent analysis,
inheritance/modifier surfaces and proxy/clone/admin/delegatecall/selfdestruct/pause/arbitrary-call/mint/sweep/rescue
detection. For a confirmed v4 hook, additionally compare permissions with address bits and verify callback selector/ABI
shape, immutable PoolManager authentication, parent permission and self-call behavior. For an onchain dependency,
reconcile declared id, address, chain, revision, runtime, interface and trusted deployment record. Do not run or report a
v4 or Solidity gate against Python, Go, TypeScript, a pure service or another nonmatching surface.

Do not delete a finding because it looks inconvenient. Record a technical disposition with file, line, impact, and test
evidence. A false-positive label without reasoning is not a disposition.

## 3. Security properties

Write properties before or alongside implementation. Start with universal properties, then add only the profiles
activated by the real architecture.

### Authorization

- Every public action declares caller semantics; state- or value-affecting authorization binds the actual actor,
  beneficiary, assets, amount, scope, validity and revocation where relevant.
- Each privileged action has one explicit authorized capability set.
- No role can gain an undisclosed capability through arbitrary calls, delegatecall, upgrades, rescue, or initializer reuse.
- A recipient can claim or redirect only its own entitlement unless a disclosed model explicitly says otherwise.
- Where a v4 hook exists, only the immutable PoolManager enters callbacks; every enabled callback returns its exact
  selector/ABI shape, disabled callbacks are unreachable, and callback `sender` is not treated as the end user without
  separate authentication.
- Where ERC-6909 claims exist, holder, all-id operator, and per-id allowance are explicit claim-disposal capabilities.
  A delegated `burn(from, ...)` consumes `from`'s claim but credits the external caller's PoolManager delta; authority,
  revocation, liability ownership, and redemption must match that consequence.
- Where an applicable fee scope exists, only `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` can claim its Programmable
  liability to itself or a per-claim destination; builder, project, admin, rescue, sweep and stored-recipient paths fail.

### Accounting

- Every settlement step has one actor, asset/currency, owner, sign, amount rule, operation and completion deadline.
- Internal liabilities never exceed the backing promised for their exact claim class; immediately redeemable or
  guaranteed claims use immediately realizable assets, while contingent/defaultable claims disclose maturity, default,
  recovery and loss allocation instead of pretending future revenue is present backing.
- Fee, reward, share, liquidity, and dust accounting conserves value under explicit rounding rules.
- Recipient shares sum to the disclosed total; duplicate, zero, reverting, and reentrant recipients cannot redirect or
  block another beneficiary's entitlement.
- Where an unlock exists, every touched account-currency delta settles to zero before unlock end and PoolManager
  sync/take/settle/claim paths preserve actor, currency, sign and amount basis. The one global transient sync slot cannot
  be treated as caller-local; payable native settlement resets it with `sync(address(0))` immediately before `settle`.
- Where return deltas exist, every credit is balance-backed and conserved. Positive is the hook's credit, core subtracts
  the hook delta from the caller, before-swap specified delta changes the residual AMM amount without crossing exactness,
  before/after-swap unspecified deltas combine, and liquidity returns apply to both currencies. A no-op is a hard conflict
  only on the exact branch that claims custom accounting.
- PoolManager protocol fees remain a separate directional, input-side liability controlled and collected by the exact
  owner-selected controller; they compose with LP fees before any independent hook, project, token, or router charges.
- Where a canonical v4 swap scope exposes direction/exactness modes, test those modes. Require all four quadrants only
  when all four are exposed.
- Where Fee V2 is applicable, successful executions accrue exactly once from executed gross quote volume at the
  inclusive 10 bps floor, with per-scope liability/remainders and no cross-scope netting.

### Configuration

- Immutable values never change. Mutable values remain inside declared bounds and can only be changed by declared roles.
- Dependencies, runtime identities, beneficiaries, bounds and custody match the exact compatibility/configuration lock.
- For a v4 hook, registered PoolKey, fee mode, tick spacing, hook, asset ordering and permission bits match; CREATE2
  address and permissions are reproducible from exact creation code.
- Fee applicability is derived as `unresolved`, `applicable` or `not-applicable`. An applicable scope integrates one
  non-bypassable Fee V2 collection path into its actual settlement architecture; a not-applicable graph binds no fake
  instance. Router fees, LP fees, transfer taxes, donations, app payments or unrelated pools cannot substitute for an
  applicable scope.
- Quadrant-dependent before/after collection and same-pool callback-skip tests apply only to a v4 hook profile exposing
  those paths. Async or non-hook profiles prove their own anti-bypass settlement surface.

### Custody and exits

- Every deposited or owed asset has an owner, beneficiary-bound claim, withdrawal, refund/cancellation, disclosed lock,
  or an exactly authorized and pre-disclosed irreversible destination with no continuing entitlement.
- A failing recipient cannot steal or redirect another recipient's value.
- A dependency failure preserves the stated exit or fail-closed behavior.
- Position and share ownership match public custody claims.
- Managed redemption, selective restrictions and contingent claims disclose their authority, timing, denial/default,
  reserve, recourse and maximum-loss trust boundaries without making a false autonomous or guaranteed promise.

### Liveness

- User exits, claims, cancellation, and recovery remain bounded.
- Keeper or oracle failure cannot create a silent inconsistent state.
- Autonomous actions are idempotent, bounded, observable, and safe to retry.

### Exact hard predicates versus review tiers

Require safe redesign only for exact evidence of unauthorized/undisclosed irreversible disposition,
undisclosed/unbound managed redemption, seizure or
redirection of owed value, privileged movement below enforceable backing/reserved-liability floors, payout outside prior
consent or an immutable rule, Fee V2 floor/destination bypass, a false exit or guaranteed-solvency promise,
participant-funded or enforceable-entitlement exposure to biasable or unbounded-withholding randomness, or a no-op on a
return-delta branch claiming custom accounting.

Do not turn the capability into the predicate. Disclosed bounded controls, an invariant-preserving rebalancer,
sponsor-funded disclosed-bias randomness with no participant-funded or enforceable value at risk, an authorized
disclosed burn/donation, beneficiary-bound managed redemption and a contingent/defaultable claim remain eligible for
the appropriate trust tier and independent economic/security/legal review.

## 4. Test layers

### Unit tests

Cover every applicable parameter boundary, error, role, event, permission, value/fee step, rounding example and failure
path. Include zero, one, minimum, maximum and overflow-adjacent values for the types actually used.

### Integration lifecycle

Run the complete product lifecycle through its actual semantics. A generic lifecycle includes creation/configuration,
each exposed action, value accrual/settlement, claim/exit, dependency failure and recovery/retirement. Cyclic games,
auctions, sessions or epochs test repeated transitions rather than being forced into a one-shot launch sequence.

For a v4 swap product, additionally run the exposed path through real PoolManager semantics:

```text
create/register
→ initialize
→ add or lock liquidity
→ initial transaction
→ buy exact input
→ buy exact output
→ sell exact input
→ sell exact output
→ accrue and claim
→ dependency failure
→ recovery or expected fail-closed state
```

Do not invent unexposed buy/sell/exactness/liquidity phases. Mark an action `not applicable` only with a reason and a
test or structural argument showing that no callback, public entrypoint or dependency can trigger it.

### Fuzz tests

Fuzz the actual inputs: amounts, actors, bounds, assets, malformed messages/calldata, timestamps, signatures, dependency
responses and recipient behavior. Add `hookData`, token returns or oracle values only when those surfaces exist. Assert
useful-call and revert counts.

### Stateful invariants

Exercise mixed sequences of every exposed action, value movement, claim/exit, configuration change, dependency response
and failure. Check conservation, solvency, authorization, immutable configuration, custody and exits after every
sequence; add swaps, liquidity, donations, fee bounds, keepers or oracles only when present.

For share, hook-owned reserve, active/idle or JIT models, add exploit-derived sequence regressions:

- drive price or one asset balance to an extreme, fragment a withdrawal into repeated tiny burns, then reverse the swap;
  absent external inflow or yield, attacker round-trip profit after fees is non-positive;
- compare `N` tiny withdrawals with one aggregate withdrawal; assets, shares, allocation and executable output may differ
  only by declared, bounded dust that does not grow materially with call count;
- cross every token-side, range, active/idle, asset/share and vault-conversion branch in both rounding directions;
- interleave swaps, claims, vault actions and same-currency cross-pool operations at zero, one, boundary and
  asymmetric-decimal values;
- preserve first/last-depositor, donation/inflation, solvency and non-zero-total-supply safety.

Keep a fixed incident-shaped regression and a generalized stateful invariant suite. Assert value conservation, bounded
dust and no unexplained profit; raw liquidity need not be monotonic when price legitimately changes.

### Adversarial mocks

Add only those triggered by the design, including:

- false/no/malformed-return ERC-20
- fee-on-transfer and rebasing token
- reentrant ERC-777/ERC-1363-like token
- reverting and reentrant ETH recipient
- malicious router, hookData, callback, flash lender, smart account, signer, oracle, keeper, proxy, vault, or bridge
- alternate PoolKey and shared-hook fake launch

### Callback and settlement evidence

This section activates only when the project exposes a v4 callback/unlock path. Use `v4-protocol-mechanics.md` as the
canonical source-level semantics; this section defines evidence coverage. For every enabled callback, test:

- correct and wrong PoolManager
- exact selector; ordinary callback responses accept at least 32 bytes, enabled after-action return deltas require
  exactly 64 bytes, and `beforeSwap` requires exactly 96 bytes; test short and trailing forms against the applicable rule
- declared parent and return-delta permission pairing
- malformed hookData and false end-user assumptions
- direct and router-mediated nested actions, including maximum depth
- revert before and after state writes
- final PoolManager deltas and hook liabilities after the unlock

For v4 custom accounting, test ordered settlement actions under positive hook credit, negative hook debt, zero, rounding
dust, partial fill, recipient failure, and repeated execution. Assert `callerDelta = coreDelta - hookDelta`; the signed
before-swap specified residual cannot cross exactness, the before-swap unspecified component is combined with the
after-swap unspecified return, and after-swap cannot silently alter the specified currency. For liquidity returns, assert
the two-currency hook delta separately from the caller. Include `liquidityDelta == 0`: it must run before/after-remove and
the enabled remove return-delta path.

Settlement suites must cover the PoolManager-wide transient sync slot: ERC-20 `sync -> transfer -> settle`, overwrite by
a nested or reordered sync, and native `sync(address(0)) -> settle{value: ...}` after a stale ERC-20 sync. For ERC-6909
claims, cover holder transfer, operator, finite and maximum per-id allowance, `transferFrom`, delegated burn, allowance
decrement/revocation, caller-delta credit, and claim/liability conservation.

For JIT or vault-backed accounting, separately prove per-`(PoolId, Currency)` ownership of raw ERC-20, ERC-6909 claims
and vault shares. Test economic assets versus immediately realizable assets, claim backing within the same unlock,
no persistent JIT position after the swap, preview/execution divergence, vault loss/pause/cap/revert, standing allowance
risk, and cross-pool same-currency isolation.

### Reserve and routing evidence

For reserve reads, label fee-excluded core principal separately from hook-reported reserves and effective liquidity.
`ReservesLens.hasCustomAccounting` is a permission-bit warning; optional `IHookStats` values remain self-reported.
Evaluate every page at the same explicit block, preserve the returned cursor, use only a completed scan, and do not add
core and hook values without same-block, same-unit, non-overlap proof. For indexed state, bind deployment, schema
revision, start block and confirmation policy; test rollback and deterministic replay after a reorg or interrupted sync.

For multihop execution, bind every `PathKey` field and test every hook sequentially within one unlock. Include the same
hook on repeated hops, shared hook state, dynamic changes between hops, exact input/output, partial fills, Permit2,
native wrapping, refunds, intermediate zero deltas and final quote/execution parity. Universal Router, Hooklist,
UniswapX and permissioned-pool onboarding are separate evidence states.

### Dynamic-fee and recipient evidence

When a dynamic LP fee exists, test initialization, initial value, application mode, override flag, persistent update actor and
call sites, min and max, every update path, stale input, manipulation, liquidity decrease, rate or cadence boundary, and
failure behavior. Test both swap directions and exactness modes. A 100% maximum requires explicit proof of supported core
semantics; do not assume exact-output compatibility.

The stored fee of a dynamic pool starts at zero. Prove any non-zero persistent initial fee is installed by the hook-only
`updateDynamicLPFee` path, commonly in `afterInitialize`, and prove a per-swap override neither changes that stored value
nor works on a static-fee pool.

Where a PoolManager protocol fee can be non-zero, test both packed 12-bit directions through zero and the 1,000-pip
maximum, input-first protocol-fee then LP-fee-on-remainder composition and rounding, owner/controller replacement,
per-currency accrual, partial/full collection and recipient. Collection of the currently synced ERC-20 must revert and
must not disturb the later settlement measurement.

First derive fee applicability from the complete graph. `unresolved` grants no exemption. `not-applicable` requires zero
canonical scopes and null instance/conformance/review bindings. For each `applicable` Programmable scope, test selected
totals of zero, below 10 bps, exactly 10 bps and above 10 bps, including
`3% -> 0.1% Programmable + 2.9% project`, never `3.1%`. Test every actually exposed execution mode against executed
gross quote volume, quote denomination, rounding/dust, canonical-scope admission, external-market isolation, no
cross-scope netting and event-to-liability reconciliation. Prove the immutable owner can claim to itself or a per-claim
destination while every builder, project, administrator, stored recipient, arbitrary caller, rescue and sweep path
fails.

For each exposed v4 swap mode, prove the declared before-swap path when quote is specified and after-swap path when quote
is unspecified. Exercise hook-initiated PoolManager calls only when the hook can make them: prove same-pool swaps revert,
or prove the exact internal accrual path applies the same fee despite callback skipping. Async and non-hook profiles use
surface-specific fill/settlement vectors instead.

For hook-owned fees, test the collection path, matching value-flow id, liability namespace, and collection event. For
recipients test the parts-per-million total, address source and launch binding, exact or derived address, rounding
remainder, duplicate and zero addresses, failed and reentrant recipients, beneficiary-only claim and redirect rules,
address validation and mutation event, historic entitlement after an address change, and the charged currency in every
supported swap quadrant.

### Dependency evidence

For every dependency id, prove that it resolves once to the declared source and configuration. Onchain evidence binds
chain, address, interface, runtime hash, block, and trusted deployment record when available. Test missing code,
unexpected runtime, upgrade or admin change, pause, revert, stale state, insolvency, and the declared fallback. Offchain
evidence binds source revision, operator, integrity where available, authentication, freshness, funding, and failure
behavior.

### Fork evidence

Use two distinct suites:

1. A reproducible fork pinned to an exact block for review and regression.
2. A current-head smoke test for current deployment compatibility.

Record chain, RPC class, block, expected contracts, runtime checks, transactions simulated, and result. A fork test is not
a deployment receipt.

### Gas and size

Set hard maximums for every exposed callback, launch, claim, user exit and keeper action. Test the applicable maximum
array, split, pool, recipient or position counts. A gas snapshot without a maximum-bound scenario is incomplete.

## 5. Security review planning

### Official Foundation framework input

For a v4 hook, complete the self-directed plan from the pinned
[Uniswap Foundation Hooks Security Framework](https://github.com/uniswapfoundation/security-framework/tree/e7e8da52fd5717b6eb4517ea779b766f63148c41).
Record the evidence and rationale for all nine dimensions rather than only the total:

| Dimension | Score range |
| --- | --- |
| Complexity | 0–5 |
| Custom math | 0–5 |
| External dependencies | 0–3 |
| External liquidity exposure | 0–3 |
| TVL potential | 0–5 |
| Team maturity | 0–3 |
| Upgradeability | 0–3 |
| Autonomous parameter updates | 0–3 |
| Price-impacting behavior | 0–3 |

The framework's aggregate tiers are low `0–6`, medium `7–17`, and high `18–33`. Apply the union of the tier plan and
every applicable feature-specific action. Its seven feature triggers—custom curve/non-standard math, hook-held or
external liquidity, external protocol/oracle dependencies, autonomous parameter updates, price-impacting behavior,
upgradeability, and TVL score 5—apply regardless of a low aggregate score. A low total never cancels a triggered action,
and the Builder's capability escalation below may require more.

This is a dated planning input, not an audit result. The Foundation does not review, audit, endorse, or certify a team's
worksheet, score, implementation, or safeguards; a tier is not a safety guarantee. Preserve the completed worksheet or
equivalent evidence, selected actions, named audit scope, monitoring/bug-bounty plan, unresolved gaps, and review date.

### Builder capability-triggered escalation

| Capability | Minimum escalation before release consideration |
| --- | --- |
| Custom math or curve | Specialist math review, differential tests, formal properties where practical |
| Return deltas | High-risk accounting review, stateful invariants, fork lifecycle, independent audit |
| Hook-held or external liquidity | Custody and loss review, invariant audit, monitoring, incident plan |
| JIT liquidity or ERC-4626 inventory | Per-pool reserve/claim/share invariants, exact-vault review, sequence economics, correlated allowance and incident plan |
| Oracle or external pricing | Manipulation and stale-data review, dependency monitoring, math review |
| Keeper or autonomous action | Liveness, idempotency, gas-runway, fallback, monitoring, incident plan |
| Upgradeability or material admin control | Storage and initializer validation, governance/timelock review, public trust disclosure |
| Permissioned or regulated asset | Issuer, redemption, legal, compliance, custody, freeze/pause, jurisdiction, and routing review |
| ZK proof | Verifier and circuit review, domain/nullifier/replay tests, setup provenance, privacy analysis |
| Cross-chain message | Bridge-specific security review, finality/reorg/replay/liveness plan |
| High value at risk | Independent audit, monitoring, incident process, bug-bounty decision |

Repository tests alone cannot satisfy these review gates.

## 6. Deployment and release evidence

Do not combine deployment planning with broadcast.

### Deployment plan

Record chain, deployer, nonce strategy, expected addresses, constructor or initializer arguments, exact value, required
post-deploy reads, source verification inputs, lifecycle transactions, rollback limitations, and monitoring setup. Store no
secret material.

### Post-deploy evidence

After separately authorized execution, capture:

- Transaction hashes, receipts, blocks, chain ID, deployer, and constructor inputs
- Runtime hashes at `latest` and a confirmed or safe block
- Proxy, implementation, admin, beacon, clone, and delegatecall evidence
- roles, recipients, custody and initialization state, plus PoolManager/permissions only for a v4 hook and fee bounds
  only for an applicable fee scope
- A bounded reviewer-owned configuration read plan covering every required launch target and any hook that actually
  exists, with exact ABI calldata and expected return bytes and/or exact storage slots and values
- Exact source and compiler metadata verification
- Buy, sell, liquidity, claim, recovery, and model-specific lifecycle receipts
- Independent RPC reconciliation
- Monitoring state and remaining blockers

The production authorization boundary must replay the complete reviewed configuration plan through two independent RPC
providers at one exact finalized canonical block. Both providers must agree byte-for-byte with the expected values.
Offline evidence, constructor arguments, one provider, or a builder-declared JSON result cannot prove current deployed
configuration. The generic read mechanism does not know which arbitrary fields are security-relevant, so the reviewed
project profile must deliberately include every authority, recipient, fee, pool, dependency, mutability, initialization,
custody, and model-specific state field that can change the launch's security or economics.

The skill, schema, checker, and local test suite do not prove that production fees are collected. Claim live collection
only after the exact reviewed hook is deployed with an authorized receipt, runtime and configuration match, canonical
pool lifecycle receipts exercise accrual and claim, liabilities reconcile, and monitoring is active.

### Availability gate

Only maintainers may move the exact release to `available`. Source verification, Hooklist inclusion, routing review,
indexer visibility, and product activation are separate provider or maintainer states.

## 7. Security wording

Allowed:

- “Repository tests passed at commit …”
- “The runtime hash matched the recorded release at block …”
- “No independent audit has been completed.”
- “This design requires review of return-delta accounting.”
- “The pinned upstream report reviewed the named files and revision; this derived model is outside that scope.”

Not allowed:

- “Safe”
- “Unruggable”
- “Uniswap approved”
- “Verified” without naming exactly what was verified
- “Live” based only on code, simulation, source match, or one canary
- “Audited” because a dependency, ancestor, factory or similar upstream model was reviewed

## Primary references

- [Uniswap Foundation Hooks Security Framework](https://github.com/uniswapfoundation/security-framework/tree/e7e8da52fd5717b6eb4517ea779b766f63148c41)
- [Uniswap known effects of hook permissions](https://github.com/Uniswap/v4-core/blob/46c6834698c48bc4a463a86d8420f4eb1d7f3b75/docs/security/Known_Effects_of_Hook_Permissions.pdf)
- [Uniswap permissioned-pool architecture](https://developers.uniswap.org/docs/protocols/v4/permissioned-pools/architecture)
- [Uniswap DualPool inventory and yield](https://developers.uniswap.org/docs/protocols/v4-hooks/dualpool/concepts/inventory-and-yield)
- [Uniswap v4 reserve-reading guide](https://developers.uniswap.org/docs/protocols/v4/guides/reading-pool-reserves)
- [Bunni exploit postmortem](https://blog.bunni.xyz/posts/exploit-post-mortem/)
- [Foundry invariant testing](https://getfoundry.sh/forge/invariant-testing)
- [Solidity compiler bug list](https://docs.soliditylang.org/en/latest/bugs.html)
- [Ethereum source verification](https://ethereum.org/developers/docs/smart-contracts/verifying)
