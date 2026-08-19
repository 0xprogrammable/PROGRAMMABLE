# Standard Programmable fee kernel

## Status and purpose

`programmable-volume-fee-v1` is a versioned starter for projects that do not already need a custom fee-enforcing hook.
It is a **reference candidate, not independently audited or deployed**. It removes repeated fee-architecture invention;
it does not replace project-specific review, an isolated rebuild, audit, deployment evidence, runtime matching or
monitoring.

The source is in:

```text
assets/reference-kernels/programmable-volume-fee-v1/
```

## Contents

- [Fixed economic contract](#fixed-economic-contract)
- [Four swap paths](#four-swap-paths)
- [Cumulative rounding and dust](#cumulative-rounding-and-dust)
- [Pool scope, custody and settlement](#pool-scope-custody-and-settlement)
- [Address permissions](#address-permissions)
- [Conformance checker](#conformance-checker)
- [Required review after a green check](#required-review-after-a-green-check)

If a project already has custom swap behavior, integrate the same policy into that one hook and run equivalent
conformance and security tests. One v4 `PoolKey` has one hook address, so a second composable fee hook is not a valid
solution.

## Fixed economic contract

Rates use hundredths of a basis point:

```text
effective = max(selected, 1,000)
Programmable rate = 1,000
project rate = effective - 1,000
```

`selected` is the complete hook-owned total. The platform share is not added on top. Thus zero becomes 10/10/0 bps,
while 300 bps becomes 300/10/290 bps. The LP fee is independent and excluded.

The only platform claim authority is:

```text
0x4957f49620AFf3Adbbe8195a4f633E49cc93376c
```

The owner is a compile-time constant. It can claim at any time to itself or a nonzero destination selected for that
claim. The project owner, registrar and arbitrary callers cannot claim, rescue, sweep or redirect that liability.

## Four swap paths

The quote currency may be currency0 or currency1. The reference derives whether quote is the specified side instead of
assuming one token order.

| Quote position | zeroForOne exact input | zeroForOne exact output | oneForZero exact input | oneForZero exact output |
| --- | --- | --- | --- | --- |
| currency0 | before | after | after | before |
| currency1 | after | before | before | after |

`before` means `beforeSwapReturnDelta`; `after` means `afterSwapReturnDelta`.

- Quote specified: calculate before the core swap, then verify the actual pool quote delta after execution. Any partial
  fill or mismatch reverts the complete transaction, including the earlier accrual.
- Quote unspecified: calculate after execution from the actual quote-side `BalanceDelta`, never the requested amount.

The standard starter forbids hook-initiated same-pool swaps. A custom hook that needs them must enforce the fee inside
that internal path because v4 skips the hook's own callback.

## Cumulative rounding and dust

For accepted swaps `i`, gross quote amounts `G_i`, effective rates `E_i`, and denominator `D=1,000,000`:

```text
Programmable_n = floor(sum(i=1..n, G_i * 1,000) / D)
project_n      = floor(sum(i=1..n, G_i * (E_i - 1,000)) / D)
total_n        = Programmable_n + project_n
```

The hook persists one fractional numerator remainder for Programmable and one for the project. Claims do not reset
them. Splitting accepted volume into many small swaps therefore cannot suppress the eventual platform entitlement, and
the platform stream is never rounded upward. The two stream liabilities always conserve their collected total; their
combined cumulative floor may be at most one smallest unit below a hypothetical single combined-rate floor.

A nonzero gross amount below 1,000 smallest quote units reverts atomically. This ensures an accepted swap can fund each
new whole-unit liability realized from the carried remainders. A quote asset whose granularity makes that minimum
material requires a different reviewed architecture instead of silently waiving, overstating, or shifting fees.

Exact output calculates an estimate, searches one fixed 17-value window for the current two remainder streams, and
requires `gross-total=requested net`. Any unrepresentable result reverts instead of silently changing basis or rate.

## Pool scope, custody and settlement

One hook instance registers exactly one canonical `PoolKey`. Registration rejects unsorted/equal currencies, invalid
tick spacing and dynamic, invalid, or greater-than-999,998-pip LP fees before the one-time binding, then initializes the PoolManager
pool in the same atomic transaction. If the initial price or any PoolManager rule fails, registration rolls back and can be corrected. Currency,
fee tier, tick spacing or hook changes produce a different `PoolId` and fail. A different pool may exist, but it is
outside this launch's claimed policy coverage.

A project that needs a dynamic LP fee must implement its update logic in the custom hook and carry the same platform
fee properties and tests into that design; the small standard starter does not pretend to provide that behavior.

Collection mints quote-denominated PoolManager ERC-6909 claims to the hook. Project and platform liabilities remain
separate and are keyed by canonical `poolId`, quote currency and immutable owner; their sum must equal the total claim
balance. Redemption burns the exact claims and then takes underlying quote currency to the authorized destination.

Because claim burn is the settlement asset, the reference claim path does not transfer ERC-20 into PoolManager. Any
custom path that owes underlying ERC-20 must use `sync -> transfer -> settle`; `CurrencySettler.settle(..., false)`
implements the order. Do not hand-roll a transfer-before-sync variant.

## Address permissions

The factory uses CREATE2 and accepts only the exact low-bit mask for:

- `beforeInitialize`
- `beforeSwap`
- `afterSwap`
- `beforeSwapReturnDelta`
- `afterSwapReturnDelta`

Every other permission is false. The return-delta permissions remain high-risk and require full maintainer review even
when this starter is used.

## Conformance checker

Run `scripts/fee-conformance.mjs` after Forge produces an artifact and build information. The checker binds and checks:

- exact source and factory SHA-256 hashes;
- the fixed policy, owner, rates, pool scope, rounding, partial-fill and self-call declarations;
- ABI functions/events/errors and absence of known rescue or recipient-mutation surfaces;
- nontrivial deployed bytecode matching the build-info output;
- build-info input source, compiler AST, ABI and deployed bytecode agreement;
- exact CREATE2 hook permission-mask source; and
- named, passing Foundry scenario evidence whose exact `contract::test` functions exist in the same build-info AST.

This rejects an empty `Observer` contract with synthetic claims of fee compliance. It does **not** prove arbitrary
source semantics or make builder-supplied evidence trusted. Maintainers must rebuild in an isolated, credential-free
sandbox and run the submitted tests plus platform-owned differential/adversarial tests.

Success is intentionally named `STRUCTURALLY_CONFORMANT_REFERENCE_CANDIDATE`. It never means audited, approved,
deployed, source-verified, lifecycle-verified, monitored or live.

## Required review after a green check

1. Rebuild from the exact submitted commit with pinned dependencies and no secrets or network authority.
2. Match source, artifact, build info and dependency receipts.
3. Run unit, fuzz, invariant, partial-fill, dust, claim, pool-isolation and permission-bit tests.
4. Run static analysis and manual callback/delta/settlement review.
5. Differentially test all four quadrants against the policy math.
6. Review every project-specific change; a copied starter is not automatically safe.
7. Keep external audit, deployment, runtime bytecode, source verification, lifecycle and monitoring as later evidence
   gates.

The bundled security map explicitly marks Echidna, Manticore, external audit, mainnet-fork lifecycle and runtime
verification as incomplete.
