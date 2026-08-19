# Security properties and review obligations

This is a security specification for the reference kernel, not proof that the implementation is safe.

## Required invariants

1. `platformFee + projectFee == totalFee` for every accepted execution.
2. The platform rate is exactly 1,000 / 1,000,000 of executed gross quote volume; the effective total rate is
   `max(selectedAtExecution, 1,000)` and remains strictly below 1,000,000.
3. Platform and project floors carry independent numerator remainders. Splitting volume cannot reduce either lifetime
   entitlement. Claiming cannot reset either remainder.
4. A claimable liability is created only in the transaction that moves the full same-currency amount into segregated
   hook custody. No unfunded debt, cross-currency credit or cross-pool netting is allowed.
5. The immutable platform owner is exactly `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`; it cannot claim project funds.
   The immutable project owner cannot claim platform funds.
6. The one registered `(chainId, PoolId, quoteCurrency)` scope is isolated. No alternate PoolKey can reuse its
   remainders, liabilities or custody.
7. Exact-output settlement accepts only a 32-byte gross witness that satisfies
   `gross - platformFee(gross) - projectFee(gross) == net` under current remainders.
8. Deposits, unfilled orders, cancellations and refunds never enter executed-volume accounting. A partial fill counts
   only its executed gross quote value and counts once.
9. If a nonzero standard-AMM execution cannot leave a positive pool quote leg after both fee components, it reverts
   atomically. The kernel never records a liability and hopes a later trade funds it.
10. Callback callers are authenticated by BaseHook, callback address flags exactly match declared permissions, and the
    canonical predictor and deployment path derive CREATE2's effective salt from the caller's user salt plus a
    domain-, chain- and factory-bound commitment to every registration input. A copied user salt with any changed
    PoolManager, currency, LP setting, quote asset, owner, rate or initial price cannot select the intended address.
11. The factory cannot leave a deployment-only hook or partial receipt. Deployment, one-shot registration,
    initialization, registration-hash/effective-salt storage, runtime-hash observation and factory-hash storage are
    atomic. Existing code is reconciled only when the complete registration and effective-salt receipts match, the
    runtime receipt is observable and equals storage, and the factory-domain receipt recomputes exactly. An exact copied
    configuration is idempotent; foreign code or any partial/mismatched receipt fails closed.
12. Owner claims clear only that owner's liability before entering PoolManager, burn exact quote-currency claim tokens,
    and transfer to a nonzero destination chosen for that call. Native-recipient or token callback reentrancy cannot
    enter another claim or swap callback and a failed transfer rolls the liability change back.

## Review checklist

- Re-derive all four swap quadrants: exact input/output, quote specified/unspecified.
- Verify hook-delta signs against the pinned v4-core version and every supported router.
- For the checked-in standard-router profile, run the exact pinned `V4Quoter` against the same PoolKey, direction,
  amount and hookData immediately before every supported single-hop execution, then execute ERC-20 and native-ETH swaps
  through the exact pinned Universal Router bytecode. Cover both directions and exactness modes plus single/multihop,
  prove quote simulation is state-neutral, reconcile quoted and actual user deltas plus exact fee liabilities, prove
  ERC-20 debt is paid through Permit2 while native input bypasses it, prove exact-output `TAKE` floors delivery,
  preserve per-hop `hookData`, and assert zero router dust. For native-input exact-output, send an
  `amountInMaximum` strictly greater than actual input, execute an outer `SWEEP(ETH, MSG_SENDER, 0)`, and prove the
  exact positive refund plus zero residual Router ETH. Tightened minimum/maximum amounts, changed hookData and an
  expired deadline must revert without moving funds or changing liabilities or remainders. Re-run this matrix whenever
  the Router artifact, V4Quoter, V4Planner ABI profile, Permit2 source, v4-core or v4-periphery changes.
- Prove PoolManager claim-token custody equals aggregate claimable liabilities after every accepted callback and claim.
- Fuzz rates through 999,999, carried remainders through 999,999 and gross values around component-rounding boundaries.
- Test stale witnesses, changed remainders, partial fills, tight price limits, zero deltas, int128 limits and callback
  reentrancy.
- Treat exact-output witness invalidation by prior same-scope volume as a retryable revert/griefing risk. Verify that a
  stale transaction changes no user balance, liability, claim token or remainder; use current-state simulation, short
  deadlines and protected routing where appropriate.
- Recompute the registration hash, keccak-derived effective salt, predicted hook address, hook runtime hash and
  factory-domain hash from exact source/runtime values. Mutate every registration field and the chain id independently;
  each must change the commitment and prediction. Verify exact callback flags, emitted bindings, exact-copy idempotency,
  occupied-address rejection, stored runtime equality and that a failed registration leaves no code or receipt.
- Treat nonstandard quote tokens, dynamic LP fees, async settlement, custom accounting and multi-pool designs as new
  threat models requiring separate review.
- Record source commit, compiler/settings, dependency lock hash, test logs, static-analysis output, reviewer identity,
  deployed bytecode and explorer verification. Never substitute a local green test for these receipts.
- Validate the canonical typed conformance receipt and vector set against their exact bytes. Verify that the receipt
  maps this implementation digest and all four modes to the exact scope and that every vector/log digest resolves;
  arbitrary evidence strings or self-asserted coverage cannot mean complete.

## Known deliberate limitation

Two independently rounded fee components can occasionally total more than a one-unit gross micro execution. That is an
integer indivisibility fact, not a reason to ban the project. This `standard-amm` kernel reverts that execution. A batch,
sponsor or segregated collateral mechanism may make it fully funded, but only a separately reviewed profile may accrue
the liability.

The policy layer can also represent selected totals at or above 100% through a separately reviewed, fully external
sponsor/collateral path. This kernel cannot: its selected buy/sell totals are capped at 999,999 hundredths of a bip and
its exact-output witness is valid only under that user-funded bound.
