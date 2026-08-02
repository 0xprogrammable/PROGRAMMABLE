# Test plan

## Implemented local tests

- Constructor configuration, independent buy/sell rates and exact hook permission mask
- CREATE2 factory address reproduction
- Inclusive 10 bps floor and 1% V4STR 10/90 project split
- Buy exact input, buy exact output, sell exact input and sell exact output
- Platform, creator and strategy liability partition and PoolManager-claim backing
- Creator-only and Programmable-owner-only claims
- PoolManager-only callback authentication
- Oracle-not-ready and maximum-gap reset
- Permissionless exact-input strategy execution and exact dead-address balance increase
- No stranded purchased target output
- 1,000-run fee-conservation fuzz test
- 256-run, depth-64 mixed buy/sell invariants for solvency and immutable configuration
- Runtime and initcode size reporting

## Required before candidate review

- Zero, one, 10 bps, maximum fee and maximum strategy share boundaries
- Tiny exact-output rounding and overflow-adjacent fee amounts
- Mismatched PoolKey, wrong initializer, initialization replay and target/canonical collision
- Specified-native partial-fill rejection in both affected quadrants
- Stale, reset, negative-tick and ring-wrap oracle cases
- Atomic spot manipulation, sustained manipulation, maximum deviation and price-impact boundaries
- Cooldown, threshold, repeat execution and zero-work behavior
- Target pool revert, target hook reentrancy, false/no/malformed-return token, fee-on-transfer and rebasing token
- Reverting Programmable destination and reentrant ETH recipient
- Forced ETH/token donation and aggregate claim solvency
- Event replay to reconstruct liabilities, observations, claims and burns
- Callback selector/return-length and post-revert state checks
- Gas ceilings for every callback, claims, oracle write and maximum strategy execution
- Slither, compiler-known-bug review and source/import/license closure

## Fork suites

Two suites remain required and are not claimed complete:

1. Ethereum mainnet pinned to an explicit block with PoolManager/runtime checks and a separate funded demo pool.
2. Current-head smoke test for dependency and target-pool compatibility.

Neither suite may touch the live V4STR pool or use the live deployer key. Fork results are simulations, not deployment
receipts.

## Commands

```bash
./scripts/bootstrap-deps.sh
forge fmt --check
forge build --sizes
forge test --offline -vv
cd keeper && npm run check
```
