# Meme Launch monitoring and incident response

Status: Mainnet monitor and durable read snapshot operating

The read-only watcher in `contracts/scripts/monitor-meme-v1.mjs` runs every five minutes in GitHub Actions, persists a
reorg-aware cursor, reconciles two independent authenticated RPCs and validates V2 fee disclosures. Every run preserves
its log and cursor as an artifact. A failure opens or updates the repository incident issue; a later healthy run records
recovery and closes it.

The Vercel index job independently performs a confirmation-delayed full replay, requires both RPCs to agree on the
snapshot block, runtime code, canonical events, fee accounting and hydrated token state, then writes an
integrity-checked private Vercel Blob snapshot. `/api/ops/health` returns unhealthy when that snapshot is missing or
older than fifteen minutes or when the RPCs disagree.

The first remote monitor run completed successfully on merge commit
`59cacae735ae4157fdfec4363392ffc5839c4917`. The production deployment then passed an authenticated index refresh,
an unauthenticated 401 check, the public health check and an automatic Vercel Cron refresh on 2026-07-27. These are
operating proofs for the configured services, not a guarantee of future availability.

## Canonical event set

The indexer must ingest:

- `EthCreatorFeeHookDeployed`
- `LockedPositionFeeForwarderDeployed`
- `PoolRegistered`
- `PoolFeeDisclosure`
- `MemeTokenLaunched`
- `MemeLiquidityConfigured`
- `HookFee`
- `HookSwap`
- `NativeSwapFeesAccrued`
- `CreatorFeesClaimed`
- `LauncherFeesClaimed`
- the corresponding PoolManager initialization and PositionManager NFT ownership events

A token is accepted only when `MemeTokenLaunched` and `MemeLiquidityConfigured` come from the verified launcher in the
same successful receipt and agree on token, pool, position, fee and launch hash. `PoolRegistered` alone is never an
official launch.

## Required reconciliation

At the receipt block, verify:

1. The chain and launcher version match the release registry
2. Launcher, hook, factories, PoolManager, PositionManager and UERC20Factory runtime hashes match
3. Launcher and hook immutable dependencies point to the registered addresses
4. The hook is factory-recorded and its address mask is exactly 8396
5. The PoolKey is native ETH and token, LP fee 0, tick spacing 200 and the registered shared hook
6. The initialized tick is 204200
7. Total swap fee is 100–1000 basis points in steps of 100 and Launcher’s share is 10 basis points within that total
8. Token supply is 1,000,000,000 at 18 decimals and the creator received no allocation
9. Position liquidity plus locked rounding dust reconciles to the complete supply
10. The position owner is the factory-recorded forwarder with zero operator, maximum timelock and creator fee recipient
11. Hook native claims cover creator plus Launcher internal accounting
12. No duplicate token, conflicting launch hash or conflicting canonical pool exists

Alternative pools may exist. They must never be merged into canonical Launcher volume or fee accounting.

Events stay provisional until the indexer handles reorgs and reaches the configured confirmation policy. Explore must not
show provisional records as final.

## Alerts

| Severity | Trigger | Required response |
| --- | --- | --- |
| Critical | Unknown launcher or factory bytecode, mismatched treasury, transferable initial position, conflicting launch record or accounting insolvency | Stop new transaction construction, remove unsupported verification labels, preserve evidence and begin incident response |
| High | Dependency drift, router incompatibility, source-verification failure, event gap, RPC disagreement, protocol-fee change or payout mismatch | Disable the affected release and investigate before another launch |
| Medium | Claim backlog, stale metadata, delayed indexing, abnormal revert rate or repeated partial-fill rejection | Investigate during the operating window without changing onchain history |
| Informational | Normal deployment, launch, swap accrual, claim or finalized reorg-safe update | Record for audit history |

## Incident procedure

1. Stop returning new launch transactions from the server. The immutable contracts cannot be paused.
2. Record chain, block, transaction, receipt, logs, runtime hashes, claims, balances and RPC responses before retrying.
3. Reconcile through a second independent Ethereum RPC.
4. Classify the issue as interface, indexer, wallet/router, RPC, deployment configuration, upstream protocol or immutable
   contract behavior.
5. Remove only unsupported verification labels. Never rewrite or conceal an onchain launch.
6. Escalate any fund or key risk to the named treasury and deployment-signing owners. No key rotation or fund movement is
   automatic.
7. Publish a factual incident note and recovery criteria before re-enabling the release.
8. Add a regression test and issue a new version if immutable behavior must change.

## Ownership still required

Before public launch preparation is enabled, assign primary and backup responders, treasury and signer contacts, RPC and
indexer operators, public communication authority, alert channels and acknowledgement targets. Rehearse the response
with those owners. Until then, monitoring is live but incident ownership remains an open release gate.
