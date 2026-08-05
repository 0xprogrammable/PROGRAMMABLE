# Test plan

## Executed suites

| Area | Executable evidence |
| --- | --- |
| LP curve | Exact 0/25/50/75/100% checkpoints, closed/no-capacity behavior, extreme-value bounds, fuzzed monotonicity. |
| Fee policy | Selected zero/below/at floor/3%, all four quadrants, exact-output gross-up, partial-fill rollback, dust, fragmentation, claims and zero execution. |
| Hook safety | PoolManager auth, exact PoolKey, exact five permission bits with no `afterInitialize`, one-shot stored 3,000-pip fee, registration/update atomicity, non-hook update rejection, second-registration rejection, override precedence, ignored hookData, no same-pool swap entrypoint, PoolManager claim backing, owner-only payout and isolation. |
| Pressure | New epoch and queue N+1 activation, same-block coalescing, no decrease, malformed epoch, closed/full lane and signer outage. |
| Vault | Binding, authority, duration/band/capacity, ceiling funding, receipts, finalize/expire, replay, claims/cancels, residual withdrawal and overlapping history. |
| Hostile tokens | Fee-on-transfer quote and RWA, false return, pause, blacklist and reentrant transfer. |
| Stateful invariants | Configuration immutability, bounded epoch state, bounded LP fee, hook solvency, vault quote/RWA solvency and useful handler calls. |
| React mechanism lab | Pure-model fee checkpoints, N+1 activation, same-block coalescing, full-capacity swap liveness, buy-fee stability, 10 bps separation, signed settlement and expiry recovery; TypeScript, lint and Vite production build. |

## Commands and settings

The recorded local commands are `npm ci --ignore-scripts --no-audit --no-fund`, `forge fmt --check`, `forge build --sizes`, `npm run create2:fixture`, `forge test -vvv`, `forge test --match-contract OpenHoursInvariantTest -vvv`, `forge snapshot`, `cd demo && bun install --frozen-lockfile --ignore-scripts`, `cd demo && bun run test`, `cd demo && bun run lint`, `cd demo && bun run build`, and the builder fee create/check commands.

Foundry uses Solidity 0.8.26, Cancun, optimizer 200, via IR, FFI disabled, `bytecode_hash = none`, and CBOR metadata disabled. Fuzzing uses 256 runs and seed `0x4f70656e486f757273`. Invariants use 64 runs and depth 32; eight invariant functions each execute 2,048 handler calls.

## Required later evidence

Independent static analysis was unavailable locally and remains a review item. A pinned fork/current-head smoke test, independent security and accounting reviews, deployment/source/runtime reconciliation, lifecycle receipts, monitoring drills, indexer recovery and provider routing tests remain outside this local prototype. A future production client must separately test Quoter/execution parity, router generation, Permit2, slippage, deadlines, partial fills, final deltas, receipts and stale/reorg states.
