# Deep keeper

Status: built with a policy-bound signer, disabled until the Mainnet lifecycle
gate is complete.

This service pays gas to call the permissionless `DeepKeeperExecutorV1`. The
executor reassesses each candidate against the canonical
`LiquidityGrowthAutomationV1` in the same transaction before it performs work.
Neither contract can select recipients, withdraw liquidity, change a vault or
move assets to the signer. Deep itself remains unavailable until its separate
contract release gates are closed.

## Safety model

- Transaction submission requires both `DEEP_KEEPER_ENABLED=true` and
  `DEEP_KEEPER_SEND_TRANSACTIONS=true`. Every other configuration is read and
  simulation only.
- The process rejects private keys, mnemonics and generic signer RPCs.
  Production execution requires the dedicated Privy policy wallet. The wallet
  can only call `execute` on the verified Mainnet executor and holds only
  bounded gas funds.
- Two independent read RPCs must agree on chain ID, confirmed block, executor
  bytecode, the executor's immutable Automation binding, Automation bytecode,
  registry state, ready work and batch simulation.
- Only a non-empty executor batch with explicit expected actions that simulates
  through both RPCs can be submitted. The executor performs a fresh assessment
  in the mined transaction and isolates a failed or stale candidate from the
  rest of the batch.
- The Automation's three executable actions are accepted: process collected
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
- The default production envelope is at most four vaults and `4,500,000` gas.
  Measured first-processing work for four vaults uses `2,344,075` gas and the
  executor adds a reviewed per-candidate stipend and batch envelope. A batch
  above four is rejected at
  configuration time unless an operator explicitly raises the gas ceiling to
  at least `9,000,000`; eight remains the absolute operational maximum.
- One durable submission intent or pending transaction blocks additional
  submissions. A transaction is never released merely because both RPCs lack a
  receipt or because a previously observed receipt was reorged.
- A confirmed-chain mismatch resets the circular registry cursor and rescans from
  zero.

The service wakes every five minutes by default. This is execution cadence, not
an oracle guarantee. The coordinator and vault still enforce their own readiness,
cooldown, reserve and TWAP checks at execution time.

## Configuration

Copy values from [.env.example](./.env.example) into the secret manager used by
the process supervisor. Do not commit a populated file.

The Automation and executor addresses, runtime hashes and executor source
commitment must come from the final verified Deep deployment manifest. The two
read RPCs must be operated by independent providers. The Privy wallet must be a
dedicated keeper account with an `execute`-only policy for the exact executor.

`DEEP_KEEPER_RELEASE_MANIFEST` defaults to
`contracts/deployments/mainnet-deep-full-range-v1.json`. Even when both
activation switches are true, the service refuses to start unless that record
contains the exact release commit, source commitment, successful Automation and
executor deployment receipts, their runtime hashes and immutable binding,
verified source and lifecycle evidence, and a keeper policy bound to both
contracts. The checked-in deployment and launch canary are verified, but
transaction submission remains disabled until the complete fee-processing and
compounding lifecycle is proven on Mainnet.

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

Run continuous read/simulation checks under a process supervisor:

```sh
node ops/deep-keeper/run.mjs
```

The standalone process has no distributed lease and rejects enabled execution.
The leased `GET /api/ops/deep-keeper` route is the only live submission path.
There is no activation command in this repository. Enabling that route is a
separate production operation after the coordinator deployment, manifest
verification and signer funding have been approved.

## State and recovery

State schema v4 is written atomically with mode `0600`. The serverless route
uses the separate private Blob object `ops/deep-keeper/state-v4.json`. State
contains the registry cursor, canonical checkpoint, recent public transaction
hashes, one submission intent or pending transaction, exact executor candidate
actions and per-vault subsidy accounting. It contains no signing material.
Older supported state is migrated without discarding uncertain work. Unknown
future schemas fail closed.

Before calling Privy, the service durably writes a submission intent containing
the exact transaction request and its stable idempotency key. After Privy
returns a transaction hash, it atomically replaces the intent with the pending
transaction and persists that transition before reporting success. If the
process crashes between those writes, restart replays the exact request and
same key before any discovery.

Privy retains idempotency records for 24 hours. Automatic replay is therefore
limited to at most 23 hours from intent creation. An older or future-dated
intent stays persisted, blocks new work and requires manual reconciliation; it
is never resent automatically.

Replay also re-applies the current operational policy before contacting Privy.
Candidate count, gas, fee ceiling, signer balance and every vault's full
reservation must still fit. Each vault is checked against the lower of the
persisted cap and current cap. Signer solvency and the low-privilege balance
ceiling are checked at the latest block on which both read RPCs agree. A
policy-blocked intent remains durable and requires manual reconciliation.
Already-broadcast pending transactions retain their submission-time envelope so
receipts can still be reconciled after operators lower a limit.

On restart, the service reconciles the pending receipt through both RPCs before
scanning again. A receipt missing from both RPCs remains pending after the
configured timeout and raises a manual-recovery outcome. It is not treated as
proof that the transaction was dropped. A reorged receipt is handled the same
way unless canonical replacement or drop evidence is established. Executor
results are bound to the exact batch, candidate order, action and signer.

Every well-formed candidate consumes its deterministic share of the exact
receipt cost, regardless of outcome. Authentic skipped or failed results clear
the pending transaction and their share is also reported as sponsor-absorbed
gas. This prevents state drift from wedging later cycles or bypassing a vault's
subsidy cap. A top-level transaction revert is allocated across every submitted
candidate by the same persisted gas weights and charged against every subsidy
cap before retry is allowed. Malformed, missing, duplicated, foreign or
inconsistent result logs fail closed. Actual transaction cost is calculated as
`gasUsed × effectiveGasPrice`. Because an Ethereum receipt contains one
aggregate batch cost, it is attributed proportionally using each candidate's
dual-RPC standalone gas estimate. Deterministic remainder allocation makes the
per-vault amounts sum exactly to the receipt cost. The pre-send reservation is
deliberately stricter: each vault must be able to cover the entire final batch
envelope, and schema-v4 state requires that envelope to equal
`gasLimit × maxFeePerGas`. Any valid receipt within that envelope therefore
cannot push a vault above its cap.

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
- any nonzero `deep_keeper_pending_receipt_unknown`
- any nonzero `deep_keeper_submission_intent_stale`
- any nonzero `deep_keeper_submission_intent_policy_blocked`
- a pending transaction lasting longer than two cycles
- a stale `deep_keeper_last_success_timestamp_seconds`
- any reverted transaction
- any increase in `deep_keeper_vault_subsidy_budget_overruns_total`
- any nonzero `deep_keeper_vault_subsidy_exhausted_vaults`
- sustained growth in `deep_keeper_vault_subsidy_skipped_total`
- a mismatch between durable subsidy totals and retained receipt records

Logs are JSON lines. They include public addresses and transaction hashes but
never RPC URLs or credentials.
