# Proposal

Submission stage: proposal
Model id: `discovery-box`

Discovery Box is a market mechanism for openable assets. The canonical prototype lets a holder trade an unopened membership bundle or burn one whole `BOX` to activate 30 days of access. Each opening advances an irreversible maturity count that lowers the canonical pool's sell LP fee.

## Design card

| Item | Confirmed design |
| --- | --- |
| Outcome | Buy, hold, sell or open a fixed membership bundle. Opening is irreversible and every box has the same utility. |
| Supply | 100 whole `BOX`, 18 decimals, fixed at creation. |
| Pool | One canonical native ETH/`BOX` dynamic-fee PoolKey with tick spacing 60. Alternative pools do not inherit this model. |
| Maturity | 40 opened boxes. The target and fee curve are immutable. |
| LP fees | Buys use 0.30%. Sells fall linearly from 1.00% to 0.30% by 40 openings. LP fees belong to liquidity providers. |
| Programmable fee | Exactly 0.10% of executed gross ETH-side volume on every canonical-pool swap. The project takes no hook-owned fee. |
| Hook custody | PoolManager ERC-6909 native-currency claims held only to back the immutable Programmable owner's accrued liability. No LP position or user `BOX` custody. |
| Authorities | One-shot canonical pool registrar and immutable Programmable fee owner. No mutable admin, pause, upgrade, rescue or sweep. |
| Product surface | A local demo shows the canonical pool, buy, open, membership expiry, current fee and owner claim. |
| Not used | Oracle, keeper, proof, cross-chain message, permissioned asset, async swap, custom AMM curve or model-specific hookData. |

## Why Uniswap v4

`hook.used` is `true`. One custom hook integrates 2 atomic swap behaviours:

- a directional LP-fee override based on the immutable `openedBoxes` counter
- Programmable's required gross ETH-volume fee in all 4 swap modes

This is a genuine v4 dependency. A token transfer tax or app surcharge cannot apply an LP-fee override inside PoolManager and would be bypassable through another router.

Opening remains in the selected `IOpenableAsset`. It does not happen in a swap callback. The hook reads only the irreversible opening count and pins the maturity target during construction.

`DiscoveryBox` is the canonical membership asset. Ticket and deterministic collectible contracts are bounded reference applications. They prove that a different opening outcome does not require different swap accounting. They are not extra launch assets or pools.

The website is a demonstration and read layer. It is not an authority over membership or fee state.

## Lifecycle

1. The selected launch path creates 100 `BOX` with no later mint authority.
2. A one-shot registrar binds the exact native ETH/`BOX` dynamic-fee PoolKey.
3. The launcher initializes the pool. `afterInitialize` confirms the registered PoolId and initial price, then sets the stored starting LP fee to 0.30%.
4. The selected official components form and lock the initial one-sided position. The prototype does not require an Initial Buy.
5. Users trade through an explicitly versioned v4 Universal Router plan. The hook authenticates PoolManager and the exact PoolId.
6. A holder calls `open(n)` with whole boxes. The canonical membership asset burns `n * 1e18`, increases `openedCount` by `n` and sets expiry to `max(currentExpiry, block.timestamp) + n * 30 days`.
7. The immutable Programmable owner may claim no more than its accrued native ETH liability to itself or a destination selected for that claim.

Any failed onchain step reverts atomically. There is no retirement or migration authority. Direct `BOX` transfers and third-party liquidity exits do not depend on the website.

## Hook boundary

The permission mask is `0x10cc`.

| Permission | Used |
| --- | --- |
| `afterInitialize` | yes |
| `beforeSwap` | yes |
| `afterSwap` | yes |
| `beforeSwapReturnDelta` | yes |
| `afterSwapReturnDelta` | yes |
| All other permission bits | no |

Every callback requires the pinned PoolManager as `msg.sender` and the one registered PoolId. The hook does not use callback `sender` as user identity and does not use `hookData`.

`beforeSwap` reads `openedBoxes`, calculates the directional LP fee and returns the dynamic-fee override flag. A failed or malformed token read reverts. Swap callbacks may mint only the exact ERC-6909 claim needed to back the fee. Same-pool hook-initiated swaps are forbidden.

## Fee rules

The selected total hook-owned fee is 10 basis points. The general rule is:

```text
effective = max(selected total, 10 bps)
Programmable = 10 bps
project = effective - 10 bps
```

This project selects 10 basis points, so Programmable receives 10 basis points and the project receives zero. A future 3% selection would split into 0.1% for Programmable and 2.9% for the project, not 3.1% total.

Native ETH is `currency0` and the quote asset. The collection path is:

| Swap mode | ETH position | Callback |
| --- | --- | --- |
| zero for one, exact input | specified gross input | before swap |
| zero for one, exact output | executed unspecified input | after swap |
| one for zero, exact input | executed unspecified gross output | after swap |
| one for zero, exact output | specified gross output | before swap |

For a successful exact-input buy with gross ETH input `G`, the hook fee is `floor(G * 1000 / 1,000,000)`. The AMM receives `G - fee`; the returned hook delta makes the caller's final ETH input remain `G`.

For an exact-output buy where the AMM needs ETH input `X`, the hook uses `fee = floor(X * 1000 / 999,000)`. Gross caller input is `X + fee`, and the fee is exactly 10 basis points of that gross amount rounded down.

For an exact-input sale with gross AMM ETH output `G`, the fee is `floor(G * 1000 / 1,000,000)`. The caller receives `G - fee`.

For an exact-output sale requesting net ETH output `N`, the hook uses `fee = floor(N * 1000 / 999,000)`. The AMM outputs `N + fee`; the caller receives exactly `N`.

Specified-ETH paths reject a partial core fill because the pre-swap fee must not be based on an unexecuted request. Unspecified-ETH paths calculate the fee from the actual core result. All fees round down in wei; dust may produce zero.

The hook calls `PoolManager.mint` for the native-currency claim, increases the exact `(poolId, native ETH, owner)` liability and returns the equal positive hook delta. Minting the claim creates a hook debt without transferring ETH before the router settles. The returned delta cancels that debt by unlock completion.

For a claim, the hook starts a separate PoolManager unlock. Its authenticated callback burns the hook-owned ERC-6909 claim and takes the equal underlying ETH to the owner's chosen destination. Burn and take cancel each other before that unlock ends. The invariants are:

```text
final caller delta = core swap delta - hook delta
hook ERC-6909 native-claim balance >= aggregate recorded ETH liability
new liability = claim minted = positive hook delta
claim amount = claim burned = underlying ETH taken
```

There is no cross-pool netting, claim transfer, stored mutable recipient, builder withdrawal, project withdrawal or rescue path.

## Numerical examples

These examples isolate the hook-owned fee from AMM price movement and the LP fee.

| Mode | Core or requested ETH | Fee | Final result |
| --- | ---: | ---: | --- |
| Buy, exact input | gross caller input 1,000,000 wei | 1,000 wei | AMM receives 999,000; caller pays 1,000,000 |
| Buy, exact output | AMM input 999,000 wei | 1,000 wei | caller pays gross 1,000,000 |
| Sell, exact input | AMM gross output 1,000,000 wei | 1,000 wei | caller receives 999,000 |
| Sell, exact output | caller requests net 999,000 wei | 1,000 wei | AMM outputs 1,000,000; caller receives 999,000 |

At 0 openings, the sell LP fee is 1.00%. Each opening reduces it by 1.75 basis points. At 20 openings it is 0.65%. At 40 or more it is 0.30%. The buy LP fee remains 0.30%.

## Product integration plan

| Surface | Plan | Failure state |
| --- | --- | --- |
| UI | Local demo for identity, balances, fees, buy, open, expiry and claim status | Withhold actions on stale, wrong-chain or inconsistent reads |
| App | One real wallet-gated membership check and 3 membership cards sharing the same expiry | Deny premium access when the confirmed registry read fails |
| Quote | Stateful local quote that executes the same hook logic at one confirmed block | Withhold when state changes or parity is unavailable |
| Trade | Explicit Universal Router V2.0 `V4_SWAP` plan with final-delta slippage and a maximum 10-minute deadline | Revert and show the transaction error |
| Indexer | Confirmed logs plus direct reads, 12-block finality and deterministic reorg rollback | Mark data unavailable after 120 seconds or on reconciliation mismatch |
| Claim | Owner-only native ETH claim with preview from the exact liability view | Failed transfer leaves liability unchanged |
| Monitoring | Reconcile opening count, hook ERC-6909 claim balance and liability | Disable demo quote and trade controls and publish the affected PoolId and block |

No keeper, oracle or service job is required. No third-party router, Hooklist, indexer, scanner or interface support is claimed. Maintainer review remains required; this proposal cannot approve itself.

## Fact provenance

- Builder-stated: a $10 discovery product should unlock a higher-value fixed membership bundle.
- Agent-derived: 100 boxes, a 40-box maturity target, 0.30% buy LP fee and 1.00% to 0.30% sell LP fee.
- Local evidence: a fixed-seed 20,000-path reduced-form model reaches 40 openings in 72.9% of balanced paths.
- Local evidence: 30 Foundry tests pass across token behaviour, all 4 swap modes, fee claims, partial fills and the first buy from a BOX-only pool.
- Not yet evidenced: fork execution, deployed addresses, live fee collection, routing support and product availability.

## Open decisions

There are no architecture-changing decisions left for the isolated prototype. Exact deployment records, runtime hashes, initial price, tick range and production app commitments remain release inputs. Changing the 40-box target or a fee path requires a new preflight revision.
