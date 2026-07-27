# Meme Launch monitoring and incident response

Status: implementation available, not yet operated

This is the minimum production operating boundary. It is not evidence that an indexer, alert or response rotation is
live. The read-only watcher in `contracts/scripts/monitor-meme-v1.mjs` persists a reorg-aware cursor, reconciles two
independent RPCs and validates V2 fee disclosures. Mainnet readiness still requires named owners, a durable runtime,
alert delivery and a Sepolia rehearsal using the exact V2 deployment.

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

Before mainnet, assign primary and backup responders, treasury and signer contacts, RPC and indexer operators, public
communication authority, alert channels and acknowledgement targets. Rehearse the process on Sepolia. Until those pieces
exist, monitoring remains an open mainnet gate.
