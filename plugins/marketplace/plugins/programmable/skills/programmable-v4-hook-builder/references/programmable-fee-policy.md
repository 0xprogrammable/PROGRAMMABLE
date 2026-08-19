# Mandatory Programmable volume fee

Policy id: `programmable-volume-fee-v1`
Policy version: `1.1.0`
Builder candidate: `v0.5.1` (policy unchanged from released `v0.4.0`)

Apply this policy to every new Programmable launch application. Builder releases `v0.1.1` and `v0.2.0` remain
reproducible for earlier review records, but they are not the current release for a new launch application.

This policy does not narrow which ideas may be proposed. A missing or incomplete integration produces an architecture
or changes-required result. It never turns the project category itself into an automatic rejection. It also does not
prove that fees are collected in production: source, tests, review, deployment, runtime, lifecycle, and monitoring are
separate evidence gates.

## Economic rule

Measure rates in hundredths of a basis point:

```text
1,000 hundredths of a bip = 10 bps = 0.10%
```

For each independently selected buy or sell total swap charge `selected`:

```text
effective = max(selected, 1,000)
Programmable = 1,000
project = effective - 1,000
```

Treat each side's `selected` as the total hook-owned swap charge, not as an amount to which the Programmable charge is added.
Buy and sell may use different selected totals, but both sides apply the same minimum and immutable Programmable share.
The standard kernel accepts at most `100,000` hundredths of a bip (`10%`) on either side; larger declarations are invalid.
Examples:

| Selected total | Effective total | Programmable | Project |
| ---: | ---: | ---: | ---: |
| `0` | `10 bps` | `10 bps` | `0` |
| `5 bps` | `10 bps` | `10 bps` | `0` |
| `10 bps` | `10 bps` | `10 bps` | `0` |
| `3%` | `3%` | `0.1%` | `2.9%` |

Never implement `3%` as `3.1%`. The pool LP fee is independent, belongs to liquidity providers, and is excluded from
this split. A dynamic or static LP fee cannot satisfy the Programmable fee requirement. A token transfer tax, router
surcharge, app payment, donation, or fee on an alternative pool cannot satisfy it either.

## Scope and basis

Accrue the charge on every successful swap of the one canonical Programmable `PoolKey`. Use the executed gross
quote-side swap volume as the basis, denominated in the canonical pool's quote asset:

- charge every supported successful token-to-quote and quote-to-token swap;
- classify exact-input and exact-output in both directions as supported-and-charged or unsupported-and-rejected before
  value, state, liability, quote, router, or UI movement;
- use the actually executed amount after partial-fill behavior, never the requested amount;
- measure the gross quote-side amount before deducting the Programmable and project portions; and
- keep alternative pools outside this policy rather than claiming that they inherit it.

Bind the fee to the canonical pool inside hook execution. Router-only enforcement is bypassable and is not
launch-ready. Policy `1.1.0` requires independent cumulative platform and project remainders for the lifetime of the
canonical pool. Claims must not reset them. This closes the split-swap bypass in which per-swap flooring could suppress
the platform entitlement. A positive gross quote amount below 1,000 smallest quote-asset units must revert atomically
in the standard profile; materially coarse quote assets need a separately reviewed architecture. Declare supported swap
modes, collection event, claim event, and reconciliation behavior without changing the rate or basis.

Use quadrant-dependent swap return deltas. The quote asset may be the swap's specified currency, available before the
core swap, or its unspecified currency, known from executed results after the core swap. Declare
`hook.feeMechanism.collectionPath: quadrant-dependent-swap-return-delta` and bind each supported mode to
`before-swap-return-delta` or `after-swap-return-delta` in `programmableFee.collection.swapModePaths`:

| Quote asset | zeroForOne exact input | zeroForOne exact output | oneForZero exact input | oneForZero exact output |
| --- | --- | --- | --- | --- |
| `currency0` | before | after | after | before |
| `currency1` | after | before | before | after |

Do not force every architecture into a before-only or after-only path. Prove the actual executed gross quote-side basis
and the final user delta for every declared mode.

Uniswap v4 skips a hook's own callback when that hook calls PoolManager. A hook that can initiate a same-pool swap must
therefore set `selfCallPolicy` to either `same-pool-swap-forbidden` or
`same-pool-swap-fee-enforced-internally`. The second option requires exact source and tests proving that the internal
path accrues the same policy without relying on the skipped callback. This boundary does not prohibit other safe custom
hook behavior.

## Required hook architecture

Use exactly one fee-enforcing hook for the canonical pool:

- For a simple project, create a project-specific implementation of the standard Programmable fee-hook profile.
- For a project that already needs custom hook behavior, integrate this policy into that single custom hook.
- Do not compose a second hook, because one v4 `PoolKey` has one hook address.
- Do not present a no-hook, router-only, LP-fee-only, or transfer-tax-only design as launch-ready.

Every idea may still enter proposal review. When the mechanism cannot yet integrate the fee safely, keep
`collection.status` as `pending-hook-integration`, name the architecture work, and require changes before prototype or
launch readiness. A prototype must use `implemented` and bind the fee mechanism to `hook.feeMechanism`.

No bundled or existing general-purpose hook is represented here as already reviewed for this policy. Every standard-
profile or custom implementation needs exact source, executable tests, and maintainer review before release consideration.

## Immutable ownership and claims

Bind accrued Programmable liabilities to this exact owner and sole claim authority:

```text
0x4957f49620AFf3Adbbe8195a4f633E49cc93376c
```

Require all of the following:

- the owner is immutable for the lifetime of the launch;
- only that owner can initiate a claim;
- the owner can claim at any time;
- each claim may pay the owner itself or a destination selected by the owner for that claim;
- no stored mutable recipient can redirect future claims;
- the builder, project roles, hook administrator, launcher administrator, and any other administrator cannot claim,
  mutate, sweep, rescue, net, or redirect the Programmable liability; and
- project claims and Programmable claims remain separately authorized and accounted.

Accrue the 10 bps as a `claimable-liability`; do not merely auto-transfer it. Key the liability at least by `poolId`,
`currency`, and `owner`. Do not net liabilities across pools. Bind collection and claim events, source paths, tests, and
the fee value flow to the exact policy record.

## `submission.json` record

Use the root `programmableFee` object with this exact policy shape. Proposal fields that depend on an unfinished design
may remain `null` or pending where the schema permits. A prototype must be fully bound and implemented.

```json
{
  "policyId": "programmable-volume-fee-v1",
  "policyVersion": "1.1.0",
  "poolScope": "canonical-launch-pool-key",
  "rates": {
    "unit": "hundredths-of-bip",
    "selectedBuyHundredthsOfBip": null,
    "selectedSellHundredthsOfBip": null,
    "minimumEffectiveHundredthsOfBip": 1000,
    "effectiveBuyHundredthsOfBip": null,
    "effectiveSellHundredthsOfBip": null,
    "platformHundredthsOfBip": 1000,
    "projectBuyHundredthsOfBip": null,
    "projectSellHundredthsOfBip": null,
    "formula": "per-side:effective=max(selected,1000);platform=1000;project=effective-1000",
    "lpFeeExcluded": true
  },
  "basis": {
    "volume": "gross-quote-side-swap-volume",
    "quoteAsset": "canonical-pool-quote-asset"
  },
  "ownership": {
    "owner": "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    "immutable": true,
    "claimAuthority": "owner-only",
    "claimAvailability": "anytime",
    "claimDestinationPolicy": "owner-or-owner-selected-per-claim",
    "storedMutableRecipient": false,
    "builderCanMutate": false,
    "projectCanMutate": false,
    "administratorCanMutate": false
  },
  "collection": {
    "status": "pending-hook-integration",
    "integration": "canonical-pool-hook",
    "enforcement": "non-bypassable",
    "hookFeeMechanismBinding": "hook.feeMechanism",
    "supportedSwapModes": [],
    "swapModePaths": {
      "zeroForOneExactInput": null,
      "zeroForOneExactOutput": null,
      "oneForZeroExactInput": null,
      "oneForZeroExactOutput": null
    },
    "selfCallPolicy": "same-pool-swap-forbidden"
  },
  "accounting": {
    "accrualMode": "claimable-liability",
    "liabilityKeyDimensions": ["poolId", "currency", "owner"],
    "crossPoolNetting": false,
    "roundingPolicy": "cumulative-independent-platform-project-remainders",
    "remainderScope": "canonical-pool-lifetime",
    "claimResetsRemainders": false,
    "minimumGrossQuoteUnits": 1000,
    "fragmentationResistant": true,
    "valueFlowId": null,
    "collectionEvent": null,
    "claimEvent": null
  },
  "evidence": {
    "sourcePaths": [],
    "testPaths": []
  }
}
```

Use `collection.status: implemented` only when the exact source and tests prove the canonical-pool hook integration.
Classify all four swap quadrants, populate every supported swap mode, and bind each unsupported mode to an executable
pre-movement rejection test. Also populate the value-flow id, events, and evidence paths for a prototype.

## Minimum evidence

Require executable tests that prove:

1. independent buy and sell selected totals of zero, below 10 bps, exactly 10 bps, above 10 bps, and the exact 10% maximum;
2. the `3% -> 0.1% + 2.9%` non-additive example;
3. all four direction and exactness quadrants on the canonical PoolKey as supported-and-charged or
   unsupported-and-pre-movement-rejected;
4. actual executed gross quote volume after partial fills is the basis;
5. LP fees, token taxes, router paths, donations, and alternative pools cannot satisfy or bypass the policy; the
   standard profile also rejects static LP fees above 999,998 pips so the maximum v4 protocol fee cannot disable exact
   output;
6. quadrant-dependent before/after paths match the declared quote asset and same-pool self-calls are forbidden or
   charged through a source- and test-proven internal path;
7. only the immutable owner can claim, including an owner-selected destination on each claim;
8. builder, project, administrator, recipient, and arbitrary callers cannot claim or mutate the owner;
9. no stored mutable recipient or rescue path redirects the platform liability;
10. liabilities remain solvent, pool-scoped, currency-scoped, owner-scoped, and never cross-pool netted; and
11. cumulative platform and project remainders make split and unsplit accepted volume produce the same lifetime
    entitlement for each stream, while claims leave both remainders unchanged;
12. a positive gross quote amount below 1,000 smallest units reverts atomically in the standard profile; and
13. collection and claim events reconcile exactly with balances and liabilities under the declared rounding rule.

Local checks show only that the declared package and tested implementation satisfy known rules. Do not claim live fee
collection until maintainers review the exact source, authorize and record deployment, match runtime bytecode, exercise
the lifecycle, and activate monitoring for that release.
