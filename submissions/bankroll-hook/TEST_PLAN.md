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
- callback rejection for a wrong PoolManager, wrong router, alternate pool and malformed hook data
- wager rejection for replay, stale blocks, exact output, stake bounds, volume limits and bankroll capacity
- atomic deadline, native-value, minimum-output and volume-cap failures
- both randomness timeout paths, fulfilled-request non-expiry and terminal-state finality
- repeated ticket settlement, ticket claim and Programmable fee claim rejection
- 5 stateful invariants at 128 runs and depth 48
- deterministic fixed-token, hook and router launch through a real PoolManager and PositionManager
- permanent position ownership, fixed supply, empty launcher custody and initial-buy fee accrual
- EIP-170 runtime-size checks and lint
- exact hook and router creation/runtime hash binding, modified-init-code rejection and launch provenance
- launch artifact binding to the 5,000-run via-IR compiler profile, compiled constructor ABIs, source hashes, five dependency addresses, four release targets, four internal child deployments and 24 graph edges

Run:

```sh
npm run build
forge test -vv
forge lint
npm run launch:check
```

## Required contract tests

Add focused tests for insufficient Funding cancellation, a zero-ticket close, maximum ticket capacity and bounded batch settlement.

Add the remaining router tests for specified-quote partial fills, price-limit boundaries, refund recipients and failed native or token transfers.

Add fee tests for exact amounts and events in all four quadrants. Cover dust, specified-quote partial fills, a failed recipient, direct donation and cross-pool isolation.

Add VRF adapter tests for exact payment, maximum fee, duplicate request key, unknown request id, wrapper-only fulfilment, duplicate fulfilment, consumer-only consumption, timeout boundaries and fulfilled-request non-expiry.

## Stateful invariants

The current handler covers Funding deposits and withdrawals, activation or cancellation, wagered buys and sells, close, randomness, settlement, claims, Programmable fee claims, finalisation and redemption. It checks after every action:

```text
WETH balance ≥ bankroll assets + open stake liability + player claim liability
reserved exposure ≤ bankroll assets
reserved exposure ≤ floor(80% × bankroll assets)
```

The suite also checks bankroll-share conservation, terminal-state finality and one payment per ticket. Each property runs 128 sequences at depth 48.
The fee-liability property also checks that the hook's native PoolManager balance equals its recorded Programmable fee liability.

## Further launch tests

The current integration test proves fixed supply, predicted token, hook and router bindings, the canonical PoolId, launch hash, permanent position custody, token custody reconciliation and an optional initial buy with the 10 bps fee. The data-only launch checker separately proves that `submissions/bankroll-hook/launch.json` matches the compiled top-level and child constructors, address placeholders, source hashes, compiler settings and deployment DAG.

Add tests for:

- a hostile or non-conforming token factory
- an invalid mined hook, wrong init code and configuration mismatch
- zero initial buy, minimum initial buy and slippage failure
- fee collection from the locked position
- repeated launch salts and token-address collisions
- no partial token, pool or position state after a failed launch

## External evidence

`test/fork/BankrollEthereum.fork.t.sol` runs at Ethereum block 25,690,000. It checks the exact PoolManager, PositionManager, UERC20Factory, WETH and Chainlink wrapper runtimes and interfaces, then completes the full token, pool, reviewed hook/router and permanently locked position lifecycle against those contracts. Run it with `MAINNET_RPC_URL=ARCHIVE_RPC_URL npm run test:fork`; the normal `npm test` command excludes fork tests explicitly so CI cannot silently depend on an RPC.

The fork and `submissions/bankroll-hook/dependency-evidence.json` are builder-declared compatibility evidence. Complete independent review, source/deployment verification and production monitoring separately. A passing historical fork does not prove audit, deployment, routing approval or product availability.
