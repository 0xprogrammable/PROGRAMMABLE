# Deep keeper ops v2

Deep vaults become eligible every five minutes. Ops v2 scans a durable,
rotating registry cursor in pages of 32 and reads at most two pages per slot.
It can place up to four eligible vaults in one executor call, but it may create
only one new submission in the slot.

Every decision is reproduced against the same 12-confirmation block on two
independent Ethereum RPC providers. Runtime, topology, scan, nonce, balance,
fee estimate, simulation, transaction and receipt disagreement stops the
cycle.

The only submitted call is `DeepKeeperExecutorV2.execute` with zero ETH. A
dedicated Privy policy wallet signs the exact persisted EIP-1559 envelope.
Private keys and mnemonic fallbacks are rejected.

The production build carries a commitment to an explicit source allowlist.
`npm run prebuild` recomputes it and stops if any keeper route, storage,
configuration, control, execution, Privy or release-gate source byte changed.
The same commitment includes canonical projections of the Deep build scripts,
five-minute cron and complete resolved runtime dependency closure. Unrelated
scripts and packages are excluded. At runtime that commitment must match the
manifest and reviewed binding, and `VERCEL_GIT_COMMIT_SHA` must match their
release commit.

## Safety boundaries

- The legacy Deep V3 writer must remain disabled.
- A signer lane can hold only one active batch.
- Every five-minute slot permits one new transaction and at most 18,000,000
  committed gas.
- Per-tick and per-day debit limits, a fee ceiling, a signer balance floor and
  a minimum growth-to-gas ratio are mandatory before activation.
- Compound value is capped by the vault's executable cycle limit, rolling
  capacity and the fixed 0.25 ETH contract ceiling.
- A confirmed transaction must match the persisted signer, nonce, target,
  calldata, fee and gas envelope and its canonical `CandidateResult` logs.
- Ambiguous evidence enters operator state. It is never silently retried as a
  different request.

State and lease ownership share a private compare-and-swap Blob record at
`ops/deep-keeper-v3/control-v2.json`. The expired v1 record is inspected once
during migration and its exact value and ETag are checked again after the v2
lease and before every state write or signer request. Any change, live lease,
pending request or unresolved incident stops the migration.

Privy retains idempotency records for 24 hours. An exact request may be
replayed only inside the reviewed safety window with the same transaction
body, idempotency key and reference. Each attempt uses a fresh signed request
expiry bounded by that invocation's internal deadline; the expiry header is
not persisted as part of the transaction body. After the replay window, or
when confirmed evidence is malformed, the lane enters operator state.

Oracle growth and compounding are separate keeper actions. The same accrued
growth can satisfy the reviewed per-action ratio once for oracle staging and
again for the later compound. Oracle gas is therefore a bounded external
operations subsidy, not a deduction from vault growth and not proof that the
full oracle-to-compound lifecycle is self-funding. Both actions still remain
inside the per-slot, per-day, fee, ratio and signer-balance limits.

Work remains permissionless. Another caller can complete a vault action after
simulation but before the reviewed transaction is included. That can make the
persisted transaction stale or produce a no-work result and consume bounded
gas and debit budget. It cannot change the target, redirect funds or remove
liquidity. Receipt history and `CandidateResult` logs must retain that outcome
instead of presenting it as productive work.

The production route is authenticated `GET
/api/ops/deep-v3-keeper-v2`. It rejects bodies, query parameters and other
methods. The health route uses the same bearer authentication and exposes only
bounded operational state, never credentials or transaction payloads.

Activation and recovery are documented in
[`OPERATIONS.md`](./OPERATIONS.md).
