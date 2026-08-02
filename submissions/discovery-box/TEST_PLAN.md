# Test plan

This plan applies to the isolated prototype. A passed local test does not prove deployment, audit, routing approval or Programmable acceptance.

## Build and dependency evidence

- Pin Solidity 0.8.26, Cancun EVM settings, Foundry, v4 core, v4 periphery and OpenZeppelin hook dependencies.
- Record the compiler-resolved source closure, lock revisions, build information and review-target hash.
- Run formatting, build, full tests, Slither, runtime size and initcode size checks.
- Run a pinned-fork test against exact deployment records and a separate current-head smoke test.

## `DiscoveryBox`

- Constructor mints exactly `100e18` and exposes immutable 40-box target and 30-day duration.
- `open(1)` burns exactly `1e18`, increments `openedBoxes` once and starts expiry at `block.timestamp + 30 days`.
- Opening an active membership extends from the current expiry. Opening an expired membership extends from the current block time.
- Opening multiple boxes applies the same result as repeated single openings, subject to timestamp equality.
- The API accepts only whole-box counts. Zero and excessive counts, or opening from a fractional balance below one whole box, revert without changing supply, balance, expiry or count.
- No caller can mint, pause, freeze, confiscate, upgrade or use a separate generic burn path.
- Stateful invariant: `totalSupply + openedBoxes * 1e18 == 100e18`.
- Stateful invariant: `openedBoxes` never decreases and never exceeds 100.

## Generic openable assets

- Prove `IOpenableAsset` exposes only the opening count, maturity target and opening entry points needed by the market boundary.
- Prove every `OpenableERC20` outcome preserves `totalSupply + openedCount * 1e18 == initialSupply`.
- Prove malformed or unsupported application data reverts the burn, counter and outcome together.
- Prove the hook can bind a different conforming application without changing its permission or accounting code.
- Test ticket creation, gifting, gate authorization, consumption and failed application data.
- Test deterministic collectible styles, ERC-1155 balances, failed application data and receiver re-entry.
- Do not present deterministic styles as random or economically equal unless a separate product review supports that claim.

## Hook identity and initialization

- Derive all 14 permission flags and mask `0x10cc` from the deployed hook address.
- Reject every callback caller except the exact PoolManager.
- Reject every PoolKey except the one registered native ETH/`BOX` dynamic-fee key with tick spacing 60.
- Accept registration and initialization once. Reject repeats and configuration drift.
- `afterInitialize` sets the stored LP fee to 3,000 hundredths of a basis point.
- Check every enabled callback selector and return length.
- Prove disabled callbacks cannot be reached through the hook address.

## Directional LP fee

For buys, test a constant 3,000 hundredths of a basis point at opened counts 0, 1, 20, 39, 40 and 100.

For sells, test:

| Opened | Expected fee |
| ---: | ---: |
| 0 | 10,000 |
| 1 | 9,825 |
| 20 | 6,500 |
| 39 | 3,175 |
| 40 | 3,000 |
| 100 | 3,000 |

- Fuzz the count from 0 to 100 and prove the sell fee is monotonic, bounded and equal to `10000 - floor(min(opened,40) * 7000 / 40)`.
- Prove direction uses the `BOX` side of the registered PoolKey, not an assumed address ordering.
- Revert on a failed or malformed `openedBoxes` read and on any calculated out-of-range value.
- Prove donations, liquidity changes, swaps and alternative pools cannot change the counter or inherit the fee.

## Programmable fee: all 4 quadrants

Use native ETH as `currency0`. Test zero, 1, 999, 1,000, 999,000, 1,000,000, `type(int128).max` boundaries and randomized amounts.

1. Zero for one, exact input: `F=floor(G*1000/1_000_000)`, AMM input `G-F`, final caller input `G`.
2. Zero for one, exact output: for core ETH input `X`, `F=floor(X*1000/999_000)`, final gross input `X+F`, and `F=floor((X+F)*1000/1_000_000)`.
3. One for zero, exact input: for gross ETH output `G`, `F=floor(G*1000/1_000_000)`, final caller output `G-F`.
4. One for zero, exact output: for requested net ETH output `N`, `F=floor(N*1000/999_000)`, core output `N+F`, final caller output `N`, and `F=floor((N+F)*1000/1_000_000)`.

For every case, prove:

- the fee is 10 basis points of executed gross ETH volume rounded down
- the project share is zero and the Programmable share is the complete hook fee
- the hook mints exactly `F` ERC-6909 native-currency claims to itself
- hook PoolManager delta is zero before unlock ends
- new hook claim backing, liability and emitted fee are equal
- the final caller delta is the core delta minus the hook delta
- no fee is charged on reverted or zero-execution swaps

Specified-ETH paths must revert partial fills. Unspecified-ETH paths must charge the actual core result and exclude unfilled amounts. Test price-limit boundaries that force both behaviours.

Fuzz both gross-up identities across the complete safe int128 domain using a 512-bit multiplication reference. Differential-test Solidity results against a simple big-integer model.

## Fee policy and bypasses

- Prove selected totals of 0, below 10 basis points and exactly 10 basis points resolve to 10 basis points for Programmable and zero for the project.
- Prove 3% resolves to 0.1% for Programmable and 2.9% for the project, never 3.1% total.
- Reject wrong PoolId, wrong quote asset, wrong direction, sign crossing and return-delta overflow.
- Prove routers, LP fees, token transfers, donations and alternative pools neither satisfy nor bypass the canonical fee.
- Prove the hook cannot initiate a same-pool swap. Exercise direct PoolManager and router re-entry attempts.
- Test nested claim-mint ordering and atomic rollback after mint, ledger update and event emission failures.

## Claims and solvency

- Only `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` can claim.
- The owner can claim to itself or a destination selected for that call.
- Test partial claim, full claim, repeated claim, zero claim, excessive claim and a destination that rejects ETH.
- Failed claims do not reduce liability.
- Builder, project, registrar and arbitrary callers cannot claim, redirect, rescue, sweep or mutate the owner.
- No liability from another PoolId, currency or beneficiary can be netted or claimed.
- Stateful invariant: hook ERC-6909 native-claim balance is at least aggregate liability.
- Stateful invariant: accruals minus successful claims equals current liability.
- An excess ERC-6909 claim balance can create surplus but not liability or a builder withdrawal right.
- Claim redemption enters one authenticated PoolManager unlock, burns exactly the hook-owned claim, takes equal ETH to the destination and ends with zero hook delta.
- Prove the first buy succeeds when PoolManager starts with zero native ETH because accrual mints a claim instead of transferring pre-settlement ETH.

## Router, quote and app

- Encode all 4 modes through explicit Universal Router V2.0 `V4_SWAP` actions.
- Validate the final caller delta after every hook and route leg.
- Test BOX Permit2 allowance, native `msg.value`, unused ETH refund, deadline expiry and minimum output or maximum input failure.
- Quote and execute from the same PoolKey, block state, exactness, direction and empty `hookData`; compare final amounts and both fee classes.
- Reject stale opened-box state, changed pool state and unsupported multihop routes until separate parity tests exist.
- Test wrong chain, disconnected wallet, rejected signature, reverted transaction, pending replacement and confirmed receipt UI states.
- Prove a real wallet-gated endpoint denies access on an expired membership or failed chain read.

## Events and reconstruction

- Replay from the launch block using `(block number, transaction index, log index)` order.
- Simulate a reorg and roll back to the last common finalized block before replay.
- Backfill in bounded ranges and resume from a finalized checkpoint.
- Reconcile event-derived `openedBoxes` and owner liability with direct reads at the same block.
- Reconcile the hook ERC-6909 native-claim balance against liability and exclude pool liquidity from hook reserves.
- Mark data stale after 120 seconds and withhold transactional controls on mismatch.

## Evidence states

Each command and case must be recorded as `planned`, `passed`, `failed`, `blocked` or `not-applicable-with-reason`. Record exact versions, revision, command, test count, fork block, gas, size, invariant calls and artifact hashes.

Current state:

- deterministic Builder preflight: passed
- 20,000-path reduced-form economic model: passed
- Solidity build, unit, fuzz, invariant, fork and static analysis: planned
- app and quote parity tests: planned
- independent accounting and security review: required before candidate status
