# Shards security

This is a design-stage record for a model with no production deployment and no independent audit.

## Trust assumptions

| Party or contract | Trusted for | Cannot |
| --- | --- | --- |
| Uniswap v4 `PoolManager` | Pool accounting, swap execution, ERC-6909 claim balances, unlock/settle semantics | Be replaced; the address is an immutable constructor argument |
| `ShardLaunchFactoryV1` as deployer | Atomic deployment, exact hook-code validation, bidirectional NFT binding and initialization | Change pinned inputs, retain SHARD after launch, or act through consumed one-shot powers |
| `builderFeeRecipient` | Nothing; it is a payee | Touch holder funds, launcher funds, the pool or the NFT contract |
| `launcherFeeRecipient` | Nothing; it is a payee | Be changed after deployment |
| `ShardNFTV1` | Calling `settleOnTransfer` truthfully; enforcing ownership on `release` | Be swapped out after `setNFT` |
| `ShardTokenV1` | Fixed supply, no mint, no burn, no owner | Change supply |
| Factory-shared renderer | Producing SVG and attribute strings for `tokenURI` | Affect accounting, custody or trading |

Production launches have no externally reachable unwired window: token, hook and NFT deployment, exact
`nft.hook()` validation, binding, checked full-supply transfer and initialization share one factory transaction.
Focused tests retain manual unbound hooks only to exercise authorization and failure states.

There is no oracle, no price feed, no keeper, no relayer, no offchain service, no owner, no pause, no timelock
and no upgrade path. The only mutable configuration in the whole model is `builderFeeRecipient`, and only the
current holder of that role can change it.

## Invariants

**Custody.** The ETH the hook controls — its real balance plus its ERC-6909 native claims against the pool
manager — is at least everything it owes:

```
address(hook).balance + poolManager.balanceOf(hook, ETH)
    >= escrowBalance + sum(claimable) + builderFeesAccrued + launcherFeesAccrued
```

`claimable` is materialised from `accFeePerNFT` by `_settle`, with the sub-wei remainder carried in `dustScaled`,
so unsettled holder entitlement is bounded by the accumulator and no wei is stranded. Each market path asserts a
weaker local form directly: after a buy, `address(this).balance >= holderEth + fee`, otherwise `FeeEthMissing`.

**Backing.** Every circulating piece is backed one-for-one by SHARD the hook holds:

```
shard.balanceOf(hook) == nft.circulatingSupply() * 1e18 + seedDust
```

`seedDust` is fixed at `initialise` and is the SHARD that liquidity rounding left behind. This is why `buyMax`
transfers its sub-whole leftover to the caller, why `acquire`/`release` never use the `_safe*` ERC-721 variants,
why `_update` rejects direct deposits to the NFT contract or the hook, and why every hook-initiated swap reverts
`PartialFillNotSupported` rather than mint a piece it cannot back.

**Fee conservation.** For every fee event, `builderCut + launcherCut + holderAmount == fee`. The combined
builder + launcher operator cut is taken with a carried remainder (`operatorFeeRemainder`), so it is cumulative
and split-invariant: a stream of tiny swaps accrues the same operator total as one aggregated swap rather than
flooring to zero per swap. That cut is split evenly between the two payees with the odd wei carried to the
launcher (`operatorSplitParity`), so over any stream both cuts stay within one wei of the ideal cumulative 10%
and the launcher is never shorted below the builder in absolute accrual. Donations bypass the split entirely and
reach holders in full.

The launcher (Programmable, 0.10%) recipient is the immutable constant `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
in `ShardLaunchFactoryV1` — the same address Classic v3 uses — and is no longer a constructor argument, so the
factory cannot route the launcher share to any other address. The builder 0.10% recipient stays per-launch
(`LaunchParams.builderFeeRecipient`).

**Authorization.** `claimBuilderFees` reverts `NotBuilder` for anyone but the current `builderFeeRecipient`;
`claimLauncherFees` reverts `NotLauncher` for anyone but the immutable `launcherFeeRecipient`;
`setBuilderFeeRecipient` reverts `NotBuilder` for anyone else and `ZeroAddress` for the zero address; `claim`
credits `nft.ownerOf(id)` and pays only `msg.sender`; `setNFT` and `initialise` revert `NotDeployer`;
`unlockCallback` reverts `NotPoolManager`; `settleOnTransfer` reverts `NotNFT`; `acquire` and `release` revert
`NotHook`.

**Configuration.** `initialise` and `setNFT` are each one-shot (`AlreadyInitialised`) and are consumed by the
factory. The stored and emitted configuration hash binds every address, parameter, salt, and hook-code hash. The three ticks, the
start price, the fee constants and the split constants are Solidity `immutable`/`constant`; `poolKey` is a
storage struct assigned once in the constructor with no write path afterwards. Every swap callback re-checks
the pool id against `poolKey.toId()` (`WrongPool`), so a foreign pool can never route a fee in the wrong currency
into the accumulator.

**Liquidity.** `poolManager.modifyLiquidity` is called from exactly one place, `_mintPosition`, and always with a
positive `liquidityDelta`. There is no removal path anywhere in the model, behind any guard or role, and v4 keys
positions on `msg.sender`, so no external contract can address them.

**Failure recovery.** Fees accrued with nothing circulating escrow and release to the first holder rather than
being lost. `claim` reverts `NothingToClaim` rather than paying zero, and rolls back any settlement it performed
in the same call — settling on another holder's behalf only persists when the caller is also owed something.
Every ETH send checks its return value and reverts `EthTransferFailed`. All ETH-moving entry points carry a
reentrancy guard, and refunds are sent after `unlock` returns, never inside the callback, so a contract buyer's
re-entry cannot self-DoS on `AlreadyUnlocked`. Every ERC20 `transfer` and `transferFrom` result used by the
factory, hook, and router is checked and reverts `TokenTransferFailed` on a false return.

## Ordering and MEV

The model is a bonding curve on a public pool, so ordinary Uniswap ordering risk applies. Its defences are
explicit bounds rather than any price oracle:

- **Sandwich bounds.** `buyNFT` and `buyMany` take `maxEthIn`, the largest total (curve cost plus fee) the caller
  will accept, and revert `SlippageExceeded`. `buyMax` takes `minCount` and reverts `InsufficientOutput`.
  `sellNFT` and `sellMany` take `minEthOut`, the smallest payout after fee. Every market path also takes a
  `deadline` and reverts `Expired`.
- **Per-swap size cap.** `afterSwap` caps a single third-party swap at `MAX_BATCH * 1e18 = 50e18` SHARD of
  movement, measured on the SHARD leg so one check covers all four direction × exactness quadrants
  (`SwapTooLarge`). This makes the batch limit a property of the pool, not of the front end used; without it, a
  direct swap plus `redeemMany` bypasses it. It is symmetric on purpose, so a large position cannot be unwound
  in one transaction either. The accepted cost is that large entries and exits take several transactions.
- **Public launch ordering.** An observer can submit an exact factory configuration first and sponsor the same
  launch. The effective token salt commits to the hook salt and every launch parameter, so a changed builder,
  curve, price, or salt cannot consume the intended token address. CREATE2 NFT deployment keeps the complete
  address/configuration commitment stable across unrelated launches.
- **Front-run-tolerant initialisation.** `beforeInitialize` always fires for a third party, and validates both
  the pool key and the exact start price (`WrongPool`, `WrongStartPrice`). A front-runner can therefore only
  create the pool the hook was going to create, at the price the hook was going to use, and `initialise` catches
  `PoolAlreadyInitialized` and proceeds to seed it. Swapping before the seed is blocked by the `NotInitialised`
  guard in both swap callbacks.
- **Same-block accrual guard.** A piece joins the earning set only from the block after acquisition, so a trader
  cannot buy into the holder pool, collect from the fee their own trade generated, and leave.
- **Art entropy.** Seeds come from the previous Ethereum `blockhash`, `block.timestamp`, the recipient and an
  acquisition nonce. Grinding resistance is deliberately not a goal: inputs are public and miner-influenceable,
  traits are flat, and a reroll affects only the roller's draw. Do not treat the seed as secure randomness.

## Known limitations

- **No production deployment.** No contract in this model is deployed on Ethereum or any other production
  network. The only live evidence is for a prior version of this design on the Robinhood chain testnet, which is
  not evidence for the code in this repository.
- **No audit.** No independent smart-contract audit and no public security contest.
- **Public salts and exact-configuration sponsorship.** A public observer can launch the same reviewed
  configuration first. Duplicate addresses then revert; callers must inspect chain state before retrying.
- **One collection per hook.** One hook serves one pool and one 10,000-piece collection. A factory can launch
  multiple collections, all using its one shared renderer.
- **EIP-170 headroom.** The hook's runtime bytecode is 24,352 of the 24,576-byte limit at the pinned compiler
  settings — 224 bytes of headroom. Almost any addition to the hook will need code moved out of it first.
- **Per-swap cap.** Third-party swaps larger than 50 SHARD revert (`SwapTooLarge`). Aggregators that route large
  ETH amounts through this pool in a single hop will fail rather than partially fill.
- **Partial fills are rejected, not repriced.** When ETH is the specified currency the fee is fixed before
  execution, on the requested size. If the swap then stops at its price limit, that fee becomes a large share of
  what actually executed — measured at 7,655 bps on a 1 ETH request that filled 0.013 ETH — and `afterSwap`
  cannot correct it, because its return value adjusts only the unspecified currency. Such swaps revert
  `PartialFillNotSupported` rather than being overcharged. Ordinary slippage limits that never bind are
  unaffected. The hook's own swap paths assert exactness for the same reason.
- **Immutable payees.** `launcherFeeRecipient` cannot be changed. If it becomes uncontrollable, its accrued
  share is permanently unclaimable. The rest of the model keeps working.
- **Direct ETH transfers are unrecoverable.** `receive()` must stay silent, because v4 delivers native ETH that
  way during swaps. ETH sent straight to the hook outside `donate()` is never distributed and never claimable on
  a contract that cannot be upgraded. Use `donate()` or `ShardFeeForwarderV1`.
- **Claims require the holder to act.** Holding accrues value in the accumulator, but `claim` needs the token ids
  passed in — the hook does not track which ids an address holds. It is not a keeper interface.
- **The 1% fee is cumulative on both bases.** The pool-level fee (`_chargeFee` in `src/ShardHookV1.sol`) carries its
  per-swap remainder (`feeCarryIn` for exact-input, `feeCarryOut` for exact-output), so a stream of tiny swaps
  accrues the same total 1% as one aggregated swap instead of each flooring to zero. A single swap may still take
  zero for itself until its sub-wei share accumulates to one wei. The only residual is `buyMax`, which clamps the fee
  to its exact-input reserve at full consumption and sheds at most one wei at that rounding boundary — economically
  negligible. Once charged, the builder and launcher cuts are conserved to the wei and never floored away.

This file does not claim an audit.
