# Uniswap v4 protocol mechanics

Use this reference when designing, implementing, repairing, or reviewing a hook, router, launcher, or other component
that calls the v4 singleton. It is a compact operating map, not a replacement for exact pinned source. Resolve the
compatible source set in `upstream-sources.json` before copying an interface or relying on an implementation detail.

## Source boundary

The observations below were rechecked against these upstream heads on 2026-08-03:

- Uniswap v4 Core `46c6834698c48bc4a463a86d8420f4eb1d7f3b75`;
- Uniswap v4 Periphery `3245c3cb99c48fa1dc2459c3b60abc37d4294aba`;
- Uniswap v4 Hooks Public `7da5210f2c81a700820a6b4f585264233d91f349`; and
- Uniswap docs `a0da460b1becfe920330adfab5d11f2f3f63863a`.

These are observed sources, not one compatible dependency lock. The current periphery and hooks repositories pin
different core or periphery revisions. Use the project's exact package lock, source trees, compiler input, deployment
records, and runtime hashes as the executable authority. Run the drift checker before a release or migration.

## Singleton and unlock accounting

- One `PoolManager` holds the accounting for many pools. Every state and liability key must include the full canonical
  `PoolKey` or `PoolId`; a currency pair alone is not a pool identity.
- `initialize` and `updateDynamicLPFee` are the exceptional manager entry points that do not require an unlock. Swap,
  liquidity, donate, take, settle, mint, burn, and clear actions occur in a valid unlock flow.
- During an unlock, every currency delta created by the caller's actions must return to zero before the unlock ends.
  Model the complete action plan, not each transfer in isolation.
- `CurrencyReserves` is one PoolManager-wide transient sync slot, not a caller-, pool-, or currency-namespaced ledger.
  `sync(erc20)` records that token and the manager's balance; the matching `settle` measures the balance increase and
  resets the currency. A later or nested `sync` can overwrite the slot before settlement.
- For ERC-20 settlement, call `sync(currency)`, transfer tokens to the manager, then call `settle` without allowing an
  untrusted action to replace the synced currency between those steps.
- Call `sync(native)` immediately before a payable native `settle`, even though native payment is measured from
  `msg.value`. `sync(address(0))` resets a stale ERC-20 currency in the global slot. Without that reset, a payable settle
  can be interpreted as ERC-20 settlement and revert; test overwrite and reordering attempts through nested actions.
- `take` moves a currency out and makes the caller's delta more negative. It is not free withdrawal authority.
- `settleFor` credits the named recipient, not automatically the transaction sender. Bind and test the beneficiary.
- `clear(currency, amount)` permanently discards an exact positive delta without transferring assets. Allow it only for
  an explicit, bounded dust policy; an amount mismatch reverts and a successful clear is value-destructive.
- ERC-6909 `mint` and `burn` use the currency address cast to a `uint160` id. Never derive an id from arbitrary upper
  bytes or treat claims as a second currency namespace.

Prove with invariants that every successful and reverting path ends with zero manager deltas, preserves solvency per
currency and per pool, and cannot settle or take for an unintended actor.

## ERC-6909 claims and delegated authority

PoolManager claims are transferable ERC-6909 balances, not beneficiary-locked receipts:

- `mint(to, id, amount)` makes the caller's currency delta more negative and mints the claim to `to`.
- A holder can `transfer`; `transferFrom` can be called by the holder, an all-id operator, or a spender with sufficient
  per-id allowance. `setOperator` grants authority across the holder's ids, while `approve` is scoped to one id.
- `burn(from, id, amount)` makes the external caller's currency delta more positive while burning `from`'s claim. It is
  authorized when the caller is `from`, an operator for `from`, or has enough per-id allowance. Maximum allowance is not
  decremented; finite allowance is.

Treat operator and allowance grants as claim-transfer and claim-burn authority, including the ability to use another
holder's claim to credit the caller inside an unlock. Bind the exact owner, operator, spender, id, amount, revocation,
recipient, and resulting caller delta. Prove claim liabilities against redeemable PoolManager backing after transfer,
delegated burn, revocation, partial allowance use, maximum allowance, and cross-pool use of the same currency id.

## Pool identity and initialization

A `PoolKey` binds sorted `currency0`, `currency1`, LP fee, tick spacing, and hook address. Any changed member identifies
a different pool. Record all five members and the derived `PoolId` in source, tests, application metadata, quote input,
router calldata, indexer keys, and runtime evidence.

- Sort currencies by canonical address ordering. Native currency is represented by the zero address.
- Validate fee and tick-spacing relationships with the exact installed core libraries.
- The hook address low bits declare callback permissions. Mine or deploy only after final creation code, constructor
  args, compiler settings, metadata, deployer, and permission mask are fixed.
- Initialization can call the before/after-initialize hooks. Treat supplied hook data as untrusted and prove replay,
  sender, pool, version, and length behavior.
- Never infer that an initialized pool is the canonical Programmable pool. Canonical admission is a separate factory or
  registry rule bound to one PoolKey.

## Hook permission and callback rules

The address uses 14 low permission bits. A return-delta permission is valid only with its parent callback. Start with
all permissions false and enable the minimum proven mask.

For every enabled callback:

1. authenticate `msg.sender` as the immutable canonical PoolManager;
2. bind the exact PoolKey or an explicit pool-admission rule;
3. remember that the callback's `sender` argument is commonly a router or PositionManager, not the end user;
4. decode versioned, bounded hook data and authenticate any claimed identity;
5. return the exact selector and the callback-specific ABI shape described below;
6. document which revert rolls back the parent action; and
7. test direct, routed, nested, self-initiated, malformed, and replayed calls.

The core hook library suppresses callbacks when the hook itself initiates the manager action. Do not assume a hook's
own nested swap, donate, or liquidity action recursively enforces the same policy. Test the explicit self-call policy.

Return-data validation is not one blanket exact-length rule:

- ordinary selector-only callback validation requires at least 32 bytes and a matching selector; extra return bytes are
  not rejected by that ordinary path;
- an enabled `afterAddLiquidity`, `afterRemoveLiquidity`, or `afterSwap` return delta requires exactly 64 bytes; and
- `beforeSwap` always requires exactly 96 bytes for selector, `BeforeSwapDelta`, and LP-fee word, whether or not its
  return-delta bit is enabled.

Do not mistake Solidity's declared return type for the core's runtime length check. Test the accepted minimum, one byte
short, trailing data, a wrong selector, and the exact 64- or 96-byte rule applicable to each enabled callback.

### Return-delta accounting

All hook-returned deltas use the hook's perspective: positive means the hook is owed or takes currency; negative means
the hook owes or sends it. Core accounts that hook delta to the hook and subtracts it from the caller's delta.

- `BeforeSwapDelta` packs a specified-currency component and an unspecified-currency component. Core adds the specified
  component to the user's signed `amountSpecified` to obtain the residual AMM amount. It may reduce the AMM leg to zero,
  but may not cross zero and change exact-input into exact-output or the reverse.
- The before-swap unspecified component does not change the AMM input immediately. Core carries it to after-swap
  accounting and combines it with any enabled `afterSwap` return; `afterSwap` can return only an `int128` delta in the
  unspecified currency.
- `afterAddLiquidity` and `afterRemoveLiquidity` can return a two-currency `BalanceDelta` only with the matching parent
  and return-delta permissions. The caller receives `principal + feesAccrued - hookDelta`; core accounts `hookDelta`
  separately to the hook.
- A `ModifyLiquidityParams.liquidityDelta` of zero takes the remove-liquidity branch. Fee-only collection therefore runs
  `beforeRemoveLiquidity` and `afterRemoveLiquidity`, including an enabled remove-liquidity return delta. It is not a
  callback-free read or collect path.

The swap currency mapping is exactness-dependent:

| Swap mode | Specified currency | Unspecified currency |
| --- | --- | --- |
| `zeroForOne`, exact input | `currency0` input | `currency1` output |
| `zeroForOne`, exact output | `currency1` output | `currency0` input |
| `oneForZero`, exact input | `currency1` input | `currency0` output |
| `oneForZero`, exact output | `currency0` output | `currency1` input |

In compact form:

```text
residualAmmAmount = params.amountSpecified + beforeSpecifiedDelta
combinedUnspecifiedDelta = beforeUnspecifiedDelta + afterUnspecifiedDelta
finalCallerSwapDelta = ammSwapDelta - map(beforeSpecifiedDelta, combinedUnspecifiedDelta)
```

`map` places the two components into currency0/currency1 according to the table, and the mapped delta is separately
accounted to the hook.

Prove sign, currency mapping, bound, conservation, backing, final caller delta, and settlement for every exposed
direction/exactness and add/remove branch. Leave `beforeSwapReturnDelta` disabled unless the product needs custom
accounting and the highest review path accepts the exact math.

## Swap execution

- A low-liquidity swap can partially fill. Enforce user bounds against the returned final delta and actual executed
  amounts, not the requested amount or an intermediate quote.
- For exact output, require the full requested output at every relevant hop or revert. Compare requested versus actual
  hop output even when endpoint totals look correct. A repeated-currency multihop can net an intermediate underfill away
  in PoolManager's final per-currency deltas, so it needs an explicit regression.
- Exact-output swaps are impossible at a 100% LP fee. Either cap the fee below 100% or reject exact-output routes.
- A dynamic-fee pool initializes its stored LP fee to zero. If a non-zero persistent starting fee is required, the hook
  must call `updateDynamicLPFee`, commonly from `afterInitialize`. Only that pool's hook can update a dynamic pool's
  stored fee. A valid override-fee flag changes only the current swap; it does not mutate the stored LP fee.
- Hook fees, Programmable's mandatory 10 bps, project fees, LP fees, protocol fees, token transfer taxes, and router
  charges are different mechanisms. Account and disclose them separately.
- Quote and execution must bind the same block context, PoolKey, sender assumptions, hook data, router generation,
  action plan, native value, deadline, Permit2 intent, and final slippage bounds.

Use `v4-sdk-integration.md` for client construction. Local no-hook pool math is not a quote for a hooked pool.

## Protocol fees and core fee composition

Protocol fees are a PoolManager governance surface independent of the hook and project fee design:

- each pool stores a packed `uint24` with two directional 12-bit protocol fees; each direction is capped at 1,000 pips
  (0.1%);
- the protocol fee is taken from the input first, then the LP fee applies to the remainder, with the combined core swap
  fee capped at 100%; do not add the displayed percentages as independent deductions;
- the PoolManager owner selects the protocol-fee controller; that controller sets a pool's packed directional fee and
  collects accrued amounts per currency; and
- collecting a currently synced ERC-20 currency reverts so collection cannot change the balance between that currency's
  `sync` and `settle`. Native collection does not use the ERC-20 balance-difference path.

Bind owner and controller changes, both packed directions, maximum and rounding behavior, input-currency attribution,
LP-fee composition, accrual, partial/full collection, recipient, and the synced-currency guard. A project cannot claim
that its hook disabled, owns, redirects, or collected protocol fees without exact PoolManager configuration and receipt
evidence.

## Liquidity, fees, and donations

`modifyLiquidity` returns principal change and fees accrued. The core interface warns that `feesAccrued` can be
artificially inflated: a single-position pool can donate to itself, and atomic donate-then-collect behavior can amplify
the observation. Therefore:

- never use `feesAccrued` as authenticated revenue, reward, eligibility, score, or oracle input;
- compute slippage on principal change after separating accrued fees exactly as the pinned periphery does;
- reconcile final balances and liabilities rather than trusting a callback parameter; and
- adversarially test donation before and within the same unlock.

`donate` can be front-run by just-in-time liquidity. Its beneficiary tick also has a boundary nuance when price sits on
a tick boundary. Do not use donation as a fair distribution, timing oracle, or proof of organic fees without a separate
mechanism and MEV analysis.

Use `v4-liquidity-and-state.md` for PositionManager actions, subscribers, position discovery, and coherent state reads.

## Native currency and token behavior

- Native ETH support removes the need to wrap every manager action, but application routers still need exact `msg.value`,
  refund, failure, and recipient rules.
- Fee-on-transfer, rebasing, permissioned, callback-capable, pausable, blocklisted, or otherwise non-standard tokens can
  break ordinary settlement assumptions. Keep them eligible, but route the exact behavior through the token mechanics,
  value-flow, provider, and custom review profiles.
- Never assume symbol, decimals, name, logo, or address labels establish asset identity or legal rights.

## Minimum executable evidence

At minimum, bind and test:

- exact source and dependency closure, compiler input, creation code, deployed runtime, constructor args, and hook mask;
- PoolManager authentication and unauthorized direct callbacks;
- all four swap quadrants, zero and boundary amounts, rounding, partial fills, exact-output full fill at every hop,
  repeated-currency multihop underfill, full-fee limits, and price limits;
- nested and self-initiated actions, reentrancy, hook-data mutation, callback-specific return shapes, and revert
  atomicity;
- `sync -> transfer -> settle` for ERC-20, native `sync(address(0)) -> settle{value: ...}`, global sync-slot overwrite,
  `take`, ERC-6909 transfer/operator/allowance/burn authority, and bounded dust clearing;
- dynamic-fee zero initialization, persistent hook-only updates, per-swap overrides, and stored-fee non-mutation;
- directional protocol-fee packing, input-first LP-fee composition, controller collection, and synced-ERC-20 rejection;
- principal versus accrued fees, donation inflation, JIT donation capture, and cross-pool isolation;
- final zero deltas and solvency after success, revert, claim, rescue, retirement, and dependency failure; and
- route, indexer, provider, deployment, and monitoring evidence as separate gates.

Passing these checks is implementation evidence, not an audit, approval, deployment, or availability claim.
