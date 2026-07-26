# Monitoring and incident response specification

Status: specified, not implemented

This document defines the minimum production monitoring boundary. It is not evidence that an indexer, alert or response rotation is live.

## Canonical event set

The indexer must ingest:

- `PlatformFeeHookDeployed`
- `LockedPositionFeeForwarderDeployed`
- `DirectTokenLaunched`
- `DirectLiquidityConfigured`
- `ExistingUERC20Launched`
- `ExistingUERC20LiquidityConfigured`
- `PlatformFeesCollected`
- Uniswap `FeesForwarded`
- the official auction, graduation, pool-initialization and position-mint events used by the auction variant

New-token and existing-token direct launch records are accepted only when the matching event pair appears in the same successful receipt and its token, launch hash, budgets and actual liquidity agree. Existing-token records must also reproduce their committed UERC20 factory provenance.

## Required reconciliation

For every accepted token, the indexer must verify at the receipt block:

1. The transaction succeeded on chain 1 or the explicitly selected rehearsal chain.
2. The launcher, factories, PoolManager, PositionManager and UERC20Factory match the version registry.
3. Runtime bytecode and factory configuration commitments match the release.
4. The hook callback mask, PoolId, initializer, treasury, 0.10% fee, 0.30% LP fee and tick spacing match the selected standard; auction records also require the pinned zero protocol fee controller.
5. The LP NFT owner is the factory-recorded forwarder.
6. The forwarder has the zero operator, maximum timelock and launch creator as fee recipient.
7. Token supply, creator balance and position liquidity reconcile with the launch record.
8. No duplicate token or conflicting launch hash exists.

Events remain provisional until the indexer has handled reorgs and reached the configured confirmation policy. Explore must never show a provisional record as final.

## Alerts

| Severity | Trigger | Required response |
| --- | --- | --- |
| Critical | Unknown launcher/factory code, mismatched treasury, transferable LP position, conflicting launch record or balance reconciliation failure | Stop new transaction construction, hide affected verification status, preserve evidence and begin incident procedure |
| High | Dependency registry drift, source verification failure, event gap, RPC disagreement or fee payout mismatch | Disable the affected variant and investigate before the next launch |
| Medium | Collection backlog, stale metadata, delayed indexing or abnormal revert rate | Investigate during the operating window; do not alter onchain status |
| Informational | Normal deployment, launch, fee collection or finalized reorg-safe update | Record for audit history |

## Incident procedure

1. Freeze new launch transaction construction in the interface. The immutable contracts cannot be paused.
2. Record chain, block, transaction, receipt, logs, code hashes, balances and RPC responses before retrying anything.
3. Reconcile through a second independent Ethereum RPC.
4. Classify whether the issue is interface, indexer, RPC, deployment configuration, upstream protocol or immutable contract behavior.
5. Remove only unsupported verification labels. Never rewrite or conceal an onchain launch record.
6. If funds or an external account may be at risk, escalate to the designated treasury and deployment-signing owners. No key rotation or fund movement is automatic.
7. Publish a factual incident note and recovery criteria before re-enabling the affected variant.
8. Add a regression test and update the machine-readable compatibility version before any replacement deployment.

## Ownership still required

Before mainnet, the project owner must assign:

- primary and backup incident responders
- treasury and deployment-signing contacts
- RPC and indexer operators
- public communication authority
- alert delivery channels and acknowledgement deadlines

The response process must be rehearsed on Sepolia. Until the indexer, alerts, ownership and rehearsal evidence exist, production monitoring remains an open gate.
