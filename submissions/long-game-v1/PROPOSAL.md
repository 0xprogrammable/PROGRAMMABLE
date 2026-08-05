# Proposal

An interactive React mechanism lab is included at `demo/`. It demonstrates the verified-position lifecycle, 30-day
maturity, explicit reward activation, loss rebates, seller exclusion, free withdrawal, and reward claims without
presenting local simulation as live execution. Optional Wagmi/viem reads can be enabled after a hook deployment is
bound.

**Stage:** local prototype  
**Model id:** `long-game-v1`

Long Game is one immutable canonical Uniswap v4 hook for custodied, non-transferable cost-basis positions. Verified
exact-input buyers receive an internal position backed by the actual base-token output held by the hook. Position
owners can withdraw any amount at any time without a fee. Verified sellers recover the sell project component except
for a maturity-decaying share of actual profit; that penalty rewards mature shares owned by other holders.

## Frozen design

The target is one WETH/base-token PoolKey with a static 30-bps LP fee and 60 tick spacing. The base asset must be a
standard non-rebasing, non-fee-on-transfer ERC20. The prospective mainnet package targets base as currency0 and WETH as
currency1; the hook and tests support either sorted quote position.

The custom hook integrates the mandatory Programmable fee policy. It enables exactly `beforeInitialize`, `beforeSwap`,
`afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta`. Empty hook data preserves permissionless ordinary
routers and all four swap quadrants. Verified routes require the immutable `LongGameRouter`, exact-input execution, and
a staged nonce-bound intent whose calldata is only a magic prefix plus intent id.

No project treasury, ERC721, upgrade, pause, blacklist, mutable rate, sweep, arbitrary call, `tx.origin`, or
hook-initiated same-pool swap exists. The immutable registrar can only register and initialize the first canonical
PoolKey. The immutable Programmable owner can claim only its liability and choose only that claim's recipient.

## Fees and accounting

Rates are hundredths of a basis point. Buys select 1,000 total: exactly 10 bps to Programmable and zero project fee.
Sells select 30,000 total: exactly 10 bps to Programmable and at most 290 bps project component. Thus the fixed examples
are `0 selected -> 10 bps Programmable + 0 project` and `3% selected -> 0.1% Programmable + 2.9% project`, never 3.1%.
Both components use independent cumulative lifetime remainders, claims never reset them, and every positive gross
quote amount below 1,000 smallest WETH units reverts.

Quote-specified quadrants charge with a before-swap return delta and verify the executed residual. Quote-unspecified
quadrants charge from the actual after-swap delta. Actual project fee on each verified sell equals rebate plus reward
contribution. Quote conservation is exact at 1e27 scale, and base custody must cover all remaining position tokens.

For a position with 100 tokens and 10 WETH basis, selling 25 tokens destroys 2.5 WETH basis; a full close consumes all
remaining basis. With 1 WETH eligible profit at opening, the raw penalty is 0.3 WETH, capped by the actual project fee.
At 15 days it is 0.15 WETH; at 30 days, on a loss, or with no other eligible owner, it is zero and the project component
is fully rebated. Three-factor penalty math uses `FullMath.mulDiv` and `mulmod` so direct multiplication cannot overflow.

## Lifecycle and exits

The prototype accepts an existing standard token; token creation and liquidity formation are outside the hook. The
registrar atomically initializes one canonical pool. Ordinary swaps collect directional fees. Verified buys open
positions; verified sells allocate basis, rebate, and rewards. Any caller may activate a mature position after 30 days.
Owners may withdraw base anytime. Platform, rebate, and reward claims burn hook-owned PoolManager WETH claims and take
underlying after credits are reduced. Any mismatch reverts atomically.

An unavailable router blocks only verified trading. An unavailable PoolManager blocks swaps and WETH claims but not
standard base-token position withdrawals. There is no retirement or admin recovery path.

## Product boundary

The repository includes contracts, a custom router, deployment planning, and a deterministic local demo. It includes
no production UI, API, indexer, or monitoring service. A future product must use confirmed chain state keyed by the
exact chain, model revision, and PoolId; replay events from the deployment block; reconcile position/liability state;
simulate hooked quotes; and separately review quote, trade, claim, monitoring, routing, and provider support.

## Open decisions

- Builder identity/contact and exact base-token address, metadata, supply authority, and sorted PoolKey.
- Exact mainnet PoolManager deployment record, initial price, CREATE2 salts, and deployed addresses.
- Pinned mainnet-fork block/RPC evidence, independent static analysis, and human architecture/security review.
- Maintainer-assigned registry, UI, indexer, routing, monitoring, and incident-response owners after acceptance.

Builder-stated facts are the v1.1.0 Programmable fee rules and v1.5.0 package semantics. Agent-derived facts are the
prospective PoolKey and product boundaries above. Evidence-backed facts are limited to the local commands recorded in
`evidence/test-evidence.json`. This prototype is not an audit, acceptance, deployment, runtime match, routing approval,
or availability proof.
