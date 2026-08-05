# Threat model

Protected assets are hook-custodied base tokens and PoolManager WETH claims backing platform fees, rebates, and scaled
rewards. Valuable state includes immutable-owner positions, remaining cost basis, mature shares, intent nonces,
cumulative fee remainders, and reward distribution dust.

Adversaries include arbitrary routers, forged/replayed/expired intents, position impersonators, fee-fragmenting
traders, alternate PoolKeys or PoolManagers, donation griefers, claim redirectors, wallet sybils, reentrant recipients,
MEV actors, and unsupported base tokens. There is no offchain signer, oracle, keeper, secret, upgrade authority, project
treasury, or admin recovery power.

The immutable PoolManager is the only callback caller. The canonical PoolId and exact hook address are checked in each
enabled callback. Verified hook data additionally requires the callback `sender` to be the immutable trusted router;
the staged hash binds owner, kind, position, direction, exact-input amount, price limit, minimum output, deadline, and
nonce. Consumption is single-use. Empty data has no identity semantics and remains available to ordinary routers.

The enabled permission mask is exactly `beforeInitialize`, `beforeSwap`, `afterSwap`,
`beforeSwapReturnDelta`, and `afterSwapReturnDelta`. CREATE2 factory deployment rejects any other low-bit mask.
Specified-quote fees are bounded positive before-swap deltas; unspecified-quote fees and verified buy custody are
bounded positive after-swap deltas. Unsupported fills or sign/amount mismatches revert. The hook never calls a
same-pool swap. Claim unlocks permit only claim burn/settlement and WETH take.

Verified sells pre-settle the router's exact base debt with `sync -> ERC20 transfer -> settleFor(router)`. Verified buys
take only actual base output. Standard non-rebasing, non-fee-on-transfer base behavior is required and the exact paid
amount is checked. All claims follow checks-effects-interactions and are transient-reentrancy guarded. Position
withdrawal checkpoints rewards, removes shares, updates token/basis state, deletes a full close, transfers exact base,
then rechecks custody.

Independent cumulative platform/project remainders prevent fragmentation evasion. Platform entitlement is immutable,
claimable anytime only by `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`, and cannot be redirected by a stored mutable
recipient. Rebate triggers cannot redirect away from the owner; reward callers cannot claim another owner. Claims do
not reset remainders.

The primary invariants are:

```text
accountedQuoteClaims * 1e27
  == platformLiability * 1e27
   + totalRebateLiability * 1e27
   + totalRewardScaledLiability

PoolManager WETH claims >= accountedQuoteClaims
baseToken.balanceOf(hook) >= totalPositionTokens
initialTokens = sold + withdrawn + remaining
initialBasis = soldBasis + withdrawnBasis + remainingBasis
```

Residual risks requiring independent review include v4 delta signs and exact-output inversion, composite rounding and
scaled dust, WETH/base assumptions, custody loss from undiscovered logic errors, sybil splitting of holder identity,
router/provider compatibility, MEV, deployment configuration, and the deliberate inability to recover accidental
unsupported transfers. Local tests are not an audit or production evidence.
