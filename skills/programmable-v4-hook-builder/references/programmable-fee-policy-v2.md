# Programmable volume fee policy v2

Policy id: `programmable-volume-fee-v2`
Policy version: `2.0.0`
Policy hash preimage: `programmable-volume-fee-v2@2.0.0`
Policy hash: `0x03cd386824b1c0aa152200e0a470aa0c885f802e257f0f46066de508d241811e`

V2 is an additive policy and architecture layer. It does not modify, retag or reinterpret
`programmable-volume-fee-v1`. V1 remains the reproducible reference for its narrower standard-AMM profile.

V2 separates the invariant economic policy from the collection profile that implements it. A project is not rejected
because its collection architecture is new. It remains eligible for architecture review until source, accounting,
tests and any deployment evidence establish the exact scoped conformance claims they can support and accountable review
records the remaining assumptions, findings and residual risk. None of those artifacts proves general safety.

## Applicability preflight

Do not load or instantiate the full policy for every open-world idea. First derive the project state from its complete
execution graph:

- `unresolved` while any unknown surface could still be Programmable-canonical. This is a review state, not an exemption
  or launch path;
- `applicable` when at least one actual `programmable-canonical` or explicit Programmable fee-bearing execution scope
  exists. Every such scope must bind this policy, a real instance and surface-appropriate conformance evidence; or
- `not-applicable` only when no Programmable-canonical execution scope exists, for example a pure service/indexer or a
  project with exclusively external/non-launchable markets. It binds no `fee-policy.v2.json`, conformance receipt or fee
  review record.

Applicability is derived, not builder-selected. A canonical path cannot be relabeled external to evade the policy. A
trusted Registry may accept an exact `not-applicable` application, but Launch V2 remains `NOT_AUTHORIZED` because there
is no canonical Programmable execution scope; an unrelated fee artifact cannot manufacture one.

## Fixed invariant

Rates use hundredths of a basis point with denominator `1,000,000`:

```text
1,000 hundredths of a bip = 10 bps = 0.10%
```

For every executed gross quote amount `G` and the project-selected total rate at that execution:

```text
effective = max(selectedTotalAtExecution, 1,000)
Programmable rate = 1,000
project rate = effective - 1,000
```

The Programmable liability belongs immutably to:

```text
0x4957f49620AFf3Adbbe8195a4f633E49cc93376c
```

Only that owner may initiate a claim. A claim may pay the owner or a nonzero destination selected by the owner for
that claim. No project, builder, administrator, rescue function or mutable stored recipient may claim, sweep, net or
redirect the Programmable liability.

The independent platform administration wallet is:

```text
0x2Bb333d48DFAF1596D9036671d2E43168994249E
```

Administration and fee ownership are separate authorities. The admin may exercise only separately authorized
platform/launch controls; it cannot claim, replace, redirect, sweep or net the Programmable liability. The fee owner
does not inherit launch administration.

The project-selected total is inclusive. A selected total of `3%` means `0.1%` for Programmable and `2.9%` for the
project, not `3.1%` total. A selected total below `0.1%` becomes `0.1%` total, all for Programmable.

V2 removes the artificial 10% project ceiling. A normal user-funded swap must still use an effective total below
`100%`: at exactly 100%, exact output has no general finite gross-up and a normal exact-input AMM leg can leave no
quote amount for execution. A separately funded rebate, reward or subsidy is a distinct value flow and does not reduce
the Programmable liability.

The policy does not turn a transparently selected rate at or above `100%` into an idea ban. Such a rate is represented
as an exact unsigned `uint256` policy rate only through the explicit `custom-reviewed` external-funding path. That path
does **not** consume the executed gross quote amount as its fee budget: segregated sponsor and/or collateral value must
fund the entire calculated Programmable and project liability before either amount accrues. An underfunded attempt
changes no remainder, cumulative volume or claimable balance. The calculated component fees and their sum must also
fit `uint256`. This is not standard-AMM gross-up math, and the bundled Solidity kernel intentionally continues to
reject selected rates at or above `100%`.

## Volume basis

The basis is executed gross quote volume before the Programmable and project portions are removed.

Count exactly once:

- a successfully executed synchronous swap;
- each successfully executed partial fill; and
- each finalized asynchronous fill.

Never count:

- an order deposit;
- an unfilled amount;
- a canceled amount;
- a refunded amount;
- a failed or reverted execution;
- an LP fee, transfer tax, donation or unrelated application payment; or
- activity in an external pool that is not part of the declared fee scope.

Every scope binds one chain id, exactly one PoolId, one quote currency and one collection profile. A second pool is a
second scope. The `(chainId, poolId, quoteCurrency)` tuple is globally unique. Remainders, liabilities and custody are
isolated by that exact tuple. Cross-scope netting is forbidden. Permissionless
third parties can create external markets, so no implementation may claim to collect fees from undeclared external
pools unless the source proves a separate non-bypassable mechanism.

V2 serializes `chainId` as a canonical positive `uint256` decimal string: `"1"`, not the JSON number `1`. Zero,
signs, whitespace, fractional notation, leading zeros and values above `2^256 - 1` are invalid. This preserves the exact
EVM value in every JSON and JavaScript consumer without imposing the unrelated JavaScript safe-integer ceiling.

The policy sets no fixed maximum number of scopes. Tooling may report byte-size or review-cost fragmentation and split
evidence into deterministic batches, but a project is not ineligible merely because it uses many pools.

Async or custom execution records must carry that exact scope tuple. Executed ids are unique within a batch and against
the durable set of ids accepted in earlier batches. A deposit or cancellation record is not an execution id. Relabeling
an already accepted fill, replaying it in a later batch or mixing another scope into the aggregate must fail closed.

## Rounding

For accepted settlement units `i`, gross amounts `G_i`, effective rates `E_i` and denominator `D=1,000,000`:

```text
Programmable_n = floor(sum(G_i * 1,000) / D)
project_n      = floor(sum(G_i * (E_i - 1,000)) / D)
```

The two numerator remainders persist independently for the lifetime of the exact chain, pool and quote-currency scope. Claims never
reset them. Splitting accepted volume cannot suppress the cumulative Programmable entitlement.

Rounding does not make an indivisible token fractional. A small atomic execution can reach a state where the next
whole-unit platform and project liabilities exceed the quote available to that one execution. That is a settlement
profile issue, not a project eligibility failure.

An incompletely funded calculation creates no claimable liability. A sponsor or collateral profile must move the exact
shortfall into segregated fee custody before either recipient can claim. An uncollateralized receivable must not be
reported as accrued or claimable fees.

For any positive user-funded atomic execution, the full fee must be funded **and** a positive quote leg must remain.
`totalFee == gross` is fee-only, not a valid `standard-amm` execution, and routes to an alternative profile just like
`totalFee > gross`.

## Collection profiles

### `standard-amm`

For a normal synchronous concentrated-liquidity pool:

- collect in `beforeSwap` when quote is the specified currency;
- collect in `afterSwap` from the executed `BalanceDelta` when quote is the unspecified currency;
- use a verified gross witness for exact output;
- reject a specified-quote partial fill atomically unless a separately reviewed authenticated refund path exists; and
- route a whole-unit funding or zero-residual boundary to batch, sponsor or custom review.

The bundled V2 Solidity kernel implements only this profile. It is a reference candidate, not audited, deployed or
approved, and it deliberately reverts when another profile is required.

### `sync-custom-zero-amm`

For a synchronous custom curve or a return-delta path that consumes the complete native AMM leg:

- integrate the fee into the same custom-accounting settlement; never attach a second hook;
- derive gross quote from the final caller debit or funded gross output before fees;
- deliver the promised output from proven reserve, inventory, mint or other declared backing;
- prove both PoolManager delta conservation and the application's reserve conservation; and
- keep fee liabilities segregated from backing owed to traders.

No positive native AMM liquidity is required by this policy. The specific launch executor must support the declared
zero-AMM architecture.

### `async-fill-batch`

For AsyncSwap, queued orders or batched fills:

- order intake and escrow are not volume;
- accrue only when a fill becomes final;
- count each partial fill once using a unique execution id;
- leave unfilled and canceled escrow fully refundable;
- aggregate micro-fill gross amounts before whole-unit fee settlement when necessary; and
- use a deterministic public allocation rule so an operator cannot choose who bears rounding.

The solvency invariant includes platform liability, project liability, user refunds and all unfilled escrow.

### `custom-reviewed`

Use this open profile when none of the three accelerators accurately describes the mechanism. It may include a funded
sponsor, segregated collateral, an authenticated partial-fill refund, a custom settlement asset adapter or another new
design. Novelty is not a rejection reason. The implementation must still prove the same fee basis, coverage,
anti-double-counting, owner-only claim and solvency properties.

For a selected total at or above `100%`, this is the only eligible profile. The complete fee comes from segregated
external sponsor/collateral funding; executed gross remains the volume basis and is not silently confiscated as the
funding source. An implementation that merely records an external receivable has not funded the liability.

## Exact-output gross witness

Independent component floors make the net function locally non-monotone at high rates, so the 17-candidate search used
by the V1 standard kernel cannot safely be extended above its original range.

V2 uses an offchain-computed, onchain-verified witness. For current remainders `R_p` and `R_j`, proposed gross `G` and
requested net `N`:

```text
P = floor((G * 1,000 + R_p) / 1,000,000)
J = floor((G * (effective - 1,000) + R_j) / 1,000,000)
G - P - J = N
```

The hook recomputes the equation from current state. A stale or forged witness reverts. Remainders update exactly once
after successful execution. The user or router must also enforce an explicit maximum gross input; the fee policy does
not authorize a router to select an unlimited gross amount.

Exact-output witnesses apply only to the below-`100%` user-funded path. An externally funded high-rate custom profile
must specify and test its separate sponsor/collateral settlement rather than reuse the standard witness equation.

For every effective rate below 100%, an integer witness exists for each nonnegative integer net amount. The reference
JavaScript solver searches the two mathematically derived candidate intervals. It does not use the unsafe assumption
that the net function is monotone.

## Solvency and conservation

Before any fee becomes claimable, prove at least:

```text
segregated fee custody >= Programmable claimable + project claimable
```

For custody, async or custom-reserve designs also prove:

```text
all available quote custody
>= fee claimables + user refunds + unfilled escrow + other senior quote obligations
```

Additional mandatory controls follow the real surface:

- where a v4 hook exists, only PoolManager invokes its callbacks;
- where return deltas or `take`/`settle`/`mint`/`burn` paths exist, they conserve deltas and fit relevant v4 signed bounds;
- where the hook can initiate a same-pool call, that path is forbidden or calls the fee accumulator internally because
  v4 skips the hook's callback;
- all execution entrypoints share the same anti-bypass accumulator;
- a fee execution id cannot be replayed or counted twice;
- fee-on-transfer and rebasing quote assets use actual received value through a separately reviewed adapter; and
- withdrawals cannot consume fee custody or higher-priority user obligations.

## Evidence contract

A green JavaScript policy check proves arithmetic and declaration shape only. A standard reference-kernel receipt proves
only that exact candidate against its named profile. A custom implementation needs profile-specific evidence.

For an applicable scope, `conformance.status = "complete"` is valid only with the closed
`urn:programmable:fee-conformance-receipt-v1:1.0.0` receipt and its closed
`urn:programmable:fee-conformance-vector-set-v1:1.0.0` vector set. Nonempty strings, screenshots or an untyped test log
cannot complete conformance. The completion record requires `evidenceRefs`, exact `evidenceDigests[]`, and one typed
receipt/vector pair in `scopeArtifacts[]` for every fee scope. The receipt binds one exact
`(feeScopeId, collectionProfile)`, the canonical
`(chainId, poolId, quoteCurrency)` tuple, the implementation artifact digest, the execution-surface coverage digest,
every surface-to-scope-to-implementation mapping, every exposed mode and the canonical vector-set digest. Duplicate,
missing, stale, cross-scope or placeholder bindings fail closed.

The vector-set bytes are canonical JSON and are hashed exactly. The validator recomputes inclusive fee math for every
exposed mode at below-floor, floor, ordinary and above-10% user-funded rates, requires a carried-remainder vector,
requires explicit user-funded rejection at or above 100%, and binds per-mode no-double-count evidence. Owner-only
claim, nonzero per-call destination, claim remainder persistence, custody/liability conservation, reentrancy and
alternate-entrypoint evidence use non-placeholder content digests. Callback authentication and return-delta evidence
are additionally required only for scopes exposing those v4 surfaces. The receipt, vector
set and every referenced evidence digest must resolve through the same completion record.

If `custom-reviewed` declares `sponsor-segregated` or `collateral-segregated`, each exposed mode also needs recomputed
math at or above 100%. The external funding amount must equal the complete calculated fee while executed gross remains
the user's nonnegative quote residual. Each funding model separately requires exact prefunding/solvency,
underfunded-no-state-change and refund/cancellation-obligation evidence. The `standard-amm` kernel declares only
`user-funded` and remains strictly below 100%.

Minimum evidence includes:

1. zero, below-floor, floor, ordinary and above-10% rates;
2. exact Programmable/project split and split-vs-unsplit platform entitlement;
3. all actually exposed directions, exactness modes or non-v4 execution modes;
4. exact-output witnesses with zero and carried remainders when exact output is exposed;
5. executed partial fills and exclusion of deposits, cancellations, refunds and unfilled amounts;
6. microtrade batch, sponsor or collateral boundaries without unfunded claimables;
7. pool, currency and scope isolation;
8. replay and alternate-entrypoint bypass attempts, plus callback/self-call attempts when those surfaces exist;
9. claim authorization, redirection and rescue attempts;
10. custody, liability and user-refund solvency invariants; and
11. exact source, build info, artifact, runtime hash, configuration hash and deployed getter matching.

Local tests, source hashes and these typed structural receipts are not an audit, deployment receipt, runtime match,
monitoring proof or approval.
