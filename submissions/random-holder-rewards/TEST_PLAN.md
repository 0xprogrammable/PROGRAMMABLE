# Test plan

Random Holder Rewards

## Build and structure

- Pin Solidity 0.8.26, Cancun, optimizer settings, v4-core, v4-periphery, OpenZeppelin Contracts, and forge-std.
- Compile complete import closure with no unexplained warning; record runtime and initcode sizes.
- Reproduce hook permission mask `0x00cc`, CREATE2 salt, initcode hash, expected hook address, immutable buy/sell/winner configuration, and runtime hash.
- Test only-PoolManager callbacks, wrong PoolManager, wrong PoolKey, selector and return lengths, empty hookData policy, and self-swap absence.

## Fee unit and lifecycle cases

- Prove mandatory selected totals 0, below 10 bps, at 10 bps, and above 10 bps, including `3% = 0.1% + 2.9%` in the shared fee math helper.
- Test buy and sell, exact input and exact output, with zero, one, rounding boundaries, maximum int128-safe amounts, and overflow-adjacent values.
- Prove buy-rate boundaries 0.1% and 3%, sell-rate boundaries buy-rate and 5%, sell-below-buy rejection, defaults 1%/2%, upward rounding, gross-up, nonzero residual AMM leg, and the numerical examples in `PROPOSAL.md`.
- Use executed quote on after-swap paths; prove before-swap paths either fill the fee-adjusted amount exactly or revert, then reconcile `HookFeeAccrued` with PoolManager final deltas, raw ETH, and liabilities.
- Prove alternative PoolKeys, LP fees, token transfers, donations, and router choice cannot satisfy or bypass canonical fee accounting.
- Exercise create token, initialize pool, add liquidity, four swaps, platform claim, threshold accrual, round request, fulfillment, configurable winner claims, liquidity removal, VRF failure, and retry.

## Holder and randomness cases

- Test first-time holder indexing, no duplicate index, same-block checkpoint replacement, historical lookup, transfers before and after snapshot, and excluded addresses.
- Test winner-count boundaries 3 and 15, fewer eligible holders than configured winners, derived attempt budgets, one pending request, two-hour permissionless expiry, stale callbacks, duplicate/unknown callbacks, wrong coordinator, zero random word, duplicate candidates, attempt exhaustion, and successful unique allocation.
- Prove holder-count prefix and snapshot block cannot change after request.
- Test sparse eligibility and Sybil-style address splitting as disclosed behavior, not person-level resistance.
- Test VRF request revert, delayed callback, failed round, and retry without pot loss.

## Claims and custody

- Test platform owner claim to self and per-claim destination; reject builder, arbitrary caller, winner, rescue, sweep, recipient mutation, and owner mutation attempts.
- Test each winner claiming only its own entitlement, partial claim, full claim, repeated claim, zero destination, rejecting recipient, and reentrant recipient.
- Force ETH into the hook and prove it creates no liability.
- Assert after every operation: `balance >= platformLiability + rewardPot + totalWinnerLiability`.
- Assert allocation conserves `potBefore = allocated + remainder` and claims conserve `balanceBefore = paid + balanceAfter`.

## Fuzz and invariants

- Fuzz fee amounts, swap modes, timestamps, holders, transfers, random words, claim destinations, and callback actors.
- Stateful handlers mix accrual, round requests, fulfillment, failed fulfillment, transfers, platform claims, winner claims, and forced ETH.
- Track useful calls and expected reverts so reject-heavy runs cannot appear as coverage.
- Invariants cover solvency, conservation, immutable configuration, one-pool isolation, claim authorization, maximum rates, unique winners, one allocation per request, and available LP exits.

## Dependencies and operations

- Pinned mainnet fork: verify PoolManager address, runtime, interface, callback behavior, and one complete four-quadrant lifecycle at an exact block.
- Current-head smoke: repeat runtime/interface checks and simulate one lifecycle without claiming deployment evidence.
- Verify VRF coordinator runtime and request ABI; mock unavailable, reverting, duplicate, stale, and unauthorized responses.
- Gas bounds: beforeSwap, afterSwap, requestRound, the maximum 92-attempt fulfillment, platform claim, and winner claim.
- Run Slither and record every finding disposition. If unavailable, report the gate blocked rather than passed.

## Product and release boundaries

A static launch-configuration UI is included without wallet or deployment capability. Test field boundaries, decimal-to-hundredths-of-bip conversion, sell-at-least-buy validation, winner bounds, defaults, payoff/variance copy, Sybil disclosure, exported schema, keyboard behavior, responsive layout, and the absence of wallet or transaction calls. Later product tests must prove quote/execution parity, final-delta validation, stale/reorg recovery, claim preview parity, monitoring alerts, and unsupported routing. Maintainer acceptance, deployment, verification, routing, and availability remain separate uncompleted gates.
