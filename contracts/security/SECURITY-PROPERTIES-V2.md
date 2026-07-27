# Classic fee disclosure V2

This document covers the V2 fee-disclosure change in `EthCreatorFeeHookV2` and
`EthCreatorFeeHookFactoryV2`. All launch, custody, initial-buy and permanent-position properties remain defined by
`SECURITY-PROPERTIES.md`. This is internal engineering evidence, not an external audit or an approval by Uniswap.

## Immutable fee model

| ID | Property | Evidence |
| --- | --- | --- |
| DISC-01 | The launched ERC-20 has no transfer tax. The hook reports `TRANSFER_TAX_BPS = 0`. | UERC20 source; `feeDisclosure`; unit and invariant tests |
| DISC-02 | Buy and sell use the same immutable hook fee selected at launch. | `PoolFeeConfig`; `feeDisclosure`; all swap-quadrant tests |
| DISC-03 | The selected 1–10% is the complete hook fee. Programmable's 0.10 percentage-point share is deducted from it, never added. | fee quote tests; invariant disclosure fixture |
| DISC-04 | The canonical pool has zero LP fee in this launch model. | pool-shape validation; `LP_FEE_PIPS = 0`; fork tests |
| DISC-05 | There is no owner, proxy, pause, upgrade, wallet exception, router allowlist or mutable fee setter. | manual surface review; Slither state/authorization output |
| DISC-06 | Fees accrue only as native ETH claims for the canonical ETH/token pool. | four swap quadrants; claim solvency invariant |

## Machine-readable events

Every charged swap emits the three following events exactly once:

```solidity
HookFee(bytes32 indexed poolId, address indexed sender, uint128 amount0, uint128 amount1)
HookSwap(PoolId indexed id, address indexed sender, int128 amount0, int128 amount1, uint24 swapFee)
NativeSwapFeesAccrued(
    bytes32 indexed poolId,
    address indexed swapSender,
    uint256 grossNativeAmount,
    uint256 creatorFee,
    uint256 launcherFee
)
```

`HookFee` follows OpenZeppelin's `IHookEvents`. `HookSwap` follows the current URC-2 proposal for custom-accounting
hooks. For this native-ETH fee model, `HookSwap.amount0` is the negative fee delta, `amount1` is zero and `swapFee` is
the disclosed hook fee in pips. For example, 1% is 10,000 pips.

`sender` is the caller seen by PoolManager and will normally be a router, not necessarily the end user. `HookSwap` is
hook-attested data; it is not a PoolManager guarantee. If integer rounding produces a zero fee, no fee event is emitted.
A reverted or simulated swap leaves no event.

Pool registration emits `PoolFeeDisclosure` with the symmetric buy and sell fee, the fixed Launcher share, zero
transfer tax and zero LP fee. The `feeDisclosure(poolId)` getter returns the same data and separately returns the creator
share.

## Verification evidence

- V2 unit and fuzz suite: fee math, all swap directions, claims, partial fills and exact event count
- V2 stateful invariants: five properties, 256 sequences at depth 64 per property
- Official Sepolia fork: deployment and complete launch against pinned Uniswap contracts
- Official Ethereum fork: deployment and complete launch against pinned Uniswap contracts
- Slither: 100 contracts, 101 detectors, zero unsuppressed findings
- Slither inheritance graph: `diagrams/eth-creator-fee-hook-v2-inheritance.dot`
- Machine-readable static-analysis result: `slither-results-v2.json`

## Manual review boundary

The change adds disclosure only. It does not add an external swap, an oracle, an administrator, a router dependency or a
new hook permission. Fee accounting still uses the same custom-accounting path as V1. The event conversion is bounded by
the same checked `SafeCast` operations as the accounting delta, and events are emitted before PoolManager custody changes
inside one reverting transaction.

The existing TEST token and pool use V1 and cannot adopt a different hook after pool creation. A V2 canary must therefore
be a new token and pool.

## Claims that remain out of scope

These properties do not mean that Uniswap has approved the hook, that a router will route through it, or that GMGN,
Fomo, Axiom, DexScreener or another service will display the fee or lock correctly. Uniswap Hooklist registration,
Uniswap routing support, explorer source verification and third-party indexer integrations are separate states. High
fees may still trigger policy warnings even when they are fully disclosed.
