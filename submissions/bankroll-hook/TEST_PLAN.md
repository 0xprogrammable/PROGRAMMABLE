# Test plan

## Completed local checks

The current Foundry suite covers:

- payout, exposure, utilisation and redemption arithmetic
- 10 bps rounding and exact-output gross-up arithmetic with 512-run fuzz tests
- versioned hook-data round trips and malformed input
- the exact six permissions and `0x30cc` mined address mask
- canonical PoolManager initialization and Funding to Active transition
- ordinary swaps in both directions and both exactness modes
- wagered exact-input swaps in both directions
- successful randomness request, fulfilment, pull, settlement and finalisation
- unrequested randomness timeout and WETH refund
- owner-only Programmable fee claim to an owner-selected destination
- deterministic fixed-token, hook and router launch through a real PoolManager and PositionManager
- permanent position ownership, fixed supply, empty launcher custody and initial-buy fee accrual
- EIP-170 runtime-size checks and lint

Run:

```sh
npm run build
forge test -vv
forge lint
```

## Required contract tests

Add focused tests for every lifecycle transition, including insufficient Funding cancellation, early and repeat calls, a zero-ticket close, maximum ticket capacity and bounded batch settlement.

Add adversarial router tests for malformed, missing, replayed and next-block pending ids; wrong router; exact-output wager attempts; stake below and above bounds; volume-cap failure; bankroll-cap failure; partial fills; price limits; minimum output; deadlines; refund recipients; and failed native or token transfers.

Add fee tests for exact amounts and events in all four quadrants. Cover dust, specified-quote partial fills, claim with no liability, zero recipient, repeated claim, failed recipient, unrelated owner, direct donation, alternative PoolKey and cross-pool isolation.

Add VRF adapter tests for exact payment, maximum fee, duplicate request key, unknown request id, wrapper-only fulfilment, duplicate fulfilment, consumer-only consumption, timeout boundaries and fulfilled-request non-expiry.

## Stateful invariants

Use handlers for deposits, withdrawals, activation, wagers, close, randomness, settlement, claims and redemption. Check after every action:

```text
WETH balance ≥ bankroll assets + open stake liability + player claim liability
reserved exposure ≤ bankroll assets
reserved exposure ≤ floor(80% × bankroll assets)
settled tickets + open tickets = ticket count before refund claims
Programmable liability ≤ native PoolManager claims held by the hook
```

Check that no state path revives Active after a terminal transition and that no ticket can pay or refund twice.

## Further launch tests

The current integration test proves fixed supply, predicted token, hook and router bindings, the canonical PoolId, launch hash, permanent position custody, token custody reconciliation and an optional initial buy with the 10 bps fee.

Add tests for:

- a hostile or non-conforming token factory
- an invalid mined hook, wrong init code and configuration mismatch
- zero initial buy, minimum initial buy and slippage failure
- fee collection from the locked position
- repeated launch salts and token-address collisions
- no partial token, pool or position state after a failed launch

## External evidence

Run Slither with dispositions, a clean mainnet fork at a recorded block, gas snapshots, bytecode and deployment verification, and an independent review. Treat each as separate evidence. A local passing test does not prove audit, deployment, routing approval or product availability.
