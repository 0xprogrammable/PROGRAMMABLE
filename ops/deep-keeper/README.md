# Deep keeper

Status: built with a policy-bound signer, disabled until the Mainnet lifecycle
gate is complete.

This service pays gas to call the permissionless `LiquidityGrowthAutomationV1`
coordinator. It cannot select recipients, withdraw liquidity, change a vault or
move assets to the signer. Deep itself remains unavailable until its separate
contract release gates are closed.

## Safety model

- Transaction submission requires both `DEEP_KEEPER_ENABLED=true` and
  `DEEP_KEEPER_SEND_TRANSACTIONS=true`. Every other configuration is read and
  simulation only.
- The process rejects private keys and mnemonics. Execution uses either a
  separate remote signer RPC or the dedicated Privy policy wallet. The
  production wallet can only call `performBatch` on the verified Mainnet
  coordinator and holds only bounded gas funds.
- Two independent read RPCs must agree on chain ID, confirmed block, coordinator
  bytecode, registry state, ready work and batch simulation.
- Only a non-empty coordinator batch that simulates every candidate successfully
  through both RPCs can be submitted.
- The coordinator's three executable actions are accepted: process collected
  fees, compound pending ETH and grow the staged TWAP oracle. Oracle growth is
  simulated and submitted through the same dual-RPC and bounded-signer path.
- The local gas limit, fee ceiling and signer-balance ceiling are checked before
  every submission.
- Each vault has a persisted gas-subsidy budget. The default hard cap is
  `0.03 ETH` (`30000000000000000` wei). It can only be changed by an explicit
  `DEEP_KEEPER_VAULT_SUBSIDY_CAP_WEI` operations configuration change.
- A final padded batch gas envelope is reserved against every participating
  vault before signing. Vaults that cannot cover that complete envelope are
  skipped; eligible vaults in the same scan continue. The batch is re-estimated
  after each removal until the eligible set is stable.
- The default production envelope is at most four vaults and `3,000,000` gas.
  Measured first-processing work for four vaults uses `2,344,075` gas and the
  keeper pads that to `2,812,890`. A batch above four is rejected at
  configuration time unless an operator explicitly raises the gas ceiling to
  at least `6,000,000`; eight remains the absolute operational maximum.
- One pending transaction blocks additional submissions. Canonically confirmed,
  reverted, dropped and reorged transactions are reconciled before new work.
- A confirmed-chain mismatch resets the circular registry cursor and rescans from
  zero.

The service wakes every five minutes by default. This is execution cadence, not
an oracle guarantee. The coordinator and vault still enforce their own readiness,
cooldown, reserve and TWAP checks at execution time.

## Configuration

Copy values from [.env.example](./.env.example) into the secret manager used by
the process supervisor. Do not commit a populated file.

The coordinator address and runtime hash must come from the final verified Deep
deployment manifest. The two read RPCs must be operated by independent
providers. The signer RPC must be separate from both and expose only the
dedicated keeper account.

`DEEP_KEEPER_RELEASE_MANIFEST` defaults to
`contracts/deployments/mainnet-deep-full-range-v1.json`. Even when both
activation switches are true, the service refuses to start unless that record
contains the exact release commit, source commitment, successful automation
receipt and runtime hash, verified source and lifecycle evidence, and a keeper
policy bound to the configured coordinator. The checked-in deployment and
launch canary are verified, but transaction submission remains disabled until
the complete fee-processing and compounding lifecycle is proven on Mainnet.

Changing the subsidy cap upward or downward is an operations decision. A lower
cap takes effect on the next cycle and immediately excludes vaults whose
persisted spend or conservative next-transaction envelope no longer fits. The
service never raises the cap automatically.

Validate configuration without connecting or sending:

```sh
node ops/deep-keeper/run.mjs --check-config
```

Run one read/simulation cycle:

```sh
node ops/deep-keeper/run.mjs --once
```

Run under a process supervisor:

```sh
node ops/deep-keeper/run.mjs
```

There is no activation command in this repository. Enabling transaction
submission is a separate production operation after the coordinator deployment,
manifest verification and signer funding have been approved.

## State and recovery

State schema v2 is written atomically with mode `0600`. It contains the registry
cursor, canonical checkpoint, recent public transaction hashes, one pending
transaction and per-vault subsidy accounting. It contains no signing material.
Schema v1 state is migrated in memory without discarding an existing pending
transaction, then persisted as v2 after the cycle. Unknown future schemas fail
closed.

Immediately after the remote signer returns a transaction hash, the service
atomically persists that hash, the padded batch gas envelope and every vault's
reservation before reporting the submission as complete.

On restart, the service reconciles the pending receipt through both RPCs before
scanning again. A missing receipt remains pending for 30 minutes by default, then
the work becomes eligible for a fresh simulation and retry. Coordinator actions
are re-evaluated onchain, so a repeated transaction cannot redirect funds and
already completed work becomes a no-op.

Canonical success and revert receipts both consume subsidy. Actual transaction
cost is calculated as `gasUsed × effectiveGasPrice`. Because an Ethereum receipt
contains one aggregate batch cost, the service attributes it proportionally
using each participating vault's dual-RPC standalone gas estimate. Deterministic
remainder allocation makes the per-vault amounts sum exactly to the receipt
cost. The pre-send reservation is deliberately stricter: each vault must be able
to cover the entire final batch envelope, so any valid receipt within that
envelope cannot push a vault above its cap.

Back up the state file with the service configuration. If it is lost, start from
cursor zero only after reconstructing the subsidy ledger from retained state and
transaction records. Resetting the cursor is safe; silently resetting subsidy
spend is not.

## Health and alerts

The HTTP listener binds to `127.0.0.1:9464` by default:

- `/healthz` reports loop freshness, the last outcome and pending transaction
- `/readyz` reports whether RPC checks are healthy and the configured execution
  mode has its signer
- `/metrics` exposes Prometheus counters and gauges

Alert on:

- any increase in `deep_keeper_rpc_disagreements_total`
- any increase in `deep_keeper_reorgs_total`
- repeated `deep_keeper_cycle_failures_total`
- a pending transaction lasting longer than two cycles
- a stale `deep_keeper_last_success_timestamp_seconds`
- any reverted or dropped transaction
- any increase in `deep_keeper_vault_subsidy_budget_overruns_total`
- any nonzero `deep_keeper_vault_subsidy_exhausted_vaults`
- sustained growth in `deep_keeper_vault_subsidy_skipped_total`
- a mismatch between durable subsidy totals and retained receipt records

Logs are JSON lines. They include public addresses and transaction hashes but
never RPC URLs or credentials.
