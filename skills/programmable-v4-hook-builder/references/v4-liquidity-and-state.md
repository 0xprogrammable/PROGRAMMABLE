# v4 liquidity, positions, subscribers, and state

Use this reference for any pool creation, liquidity action, position UI, LP custody rule, fee collection, indexer,
subscriber, or StateView read. Bind the exact periphery and core dependency revisions first; observed current sources
may not form one compatible install.

## Position action safety

Use the exact PositionManager action ABI from the installed periphery package. Current v4 periphery explicitly marks
these two actions deprecated and vulnerable to sandwich attacks:

```text
MINT_POSITION_FROM_DELTAS
INCREASE_LIQUIDITY_FROM_DELTAS
```

Do not emit them, expose them in an app, accept them from a planner, or copy examples that use them. Use explicit
liquidity actions with an exact intended liquidity amount, `amount0Max` and `amount1Max`, finite deadline, recipient,
hook data, settlement, and refund rules. The application profile sets
`integration.sdkSafetyProfile.deprecatedLiquidityActionsDisabled` to `true` when it includes a liquidity-position
client, and executable tests inspect the final action bytes or trace rather than only a source-level enum name.

For decreases, validate minimum output against principal after separating accrued fees. A decrease with zero liquidity
is the supported fee-collection shape, but core classifies every `liquidityDelta <= 0` as removal. Fee-only collection
therefore invokes `beforeRemoveLiquidity` and `afterRemoveLiquidity`; if the matching return-delta bit is enabled, the
hook's two-currency delta is accounted and subtracted from the caller exactly as on a non-zero removal. Bind the exact
hook data, return shape, recipient, caller-versus-hook delta, and final currency balances. Burning, collecting, or
transferring a position must not silently change project, creator, Programmable, or LP fee rights.

## Position identity and authority

PositionManager is not `ERC721Enumerable`. Never claim a wallet's complete position set from the contract alone.

Use an indexer, subgraph, or event reconstruction for discovery, then reconcile each token id onchain at a coherent
block. Verify:

- current owner, approvals, operators, nonce, and permit domain;
- PoolKey, tick range, salt or position configuration id, and liquidity;
- subscriber attachment;
- custody, lock, removal, migration, rescue, burn, and fee-beneficiary authority; and
- the exact PositionManager deployment and chain.

An omitted indexer record is not proof that a position does not exist. An indexed owner is not proof of current
ownership. Handle reorgs, duplicate events, stale caches, replaced RPC reads, and unsupported chains explicitly.

## Subscribers are an execution dependency

A position subscriber receives lifecycle notifications. Treat it as contract execution, not passive analytics.

- Subscription, modify-liquidity notification, and burn notification can revert their parent operation.
- Transfer, subscribe, and unsubscribe have PoolManager lock-state requirements. Test the actual call ordering.
- Unsubscribe must remain possible even for a malicious subscriber. Current periphery deletes the subscription and
  attempts a gas-capped notification whose failure is ignored, but the caller must supply sufficient remaining gas.
- A subscriber can consume gas, revert, return malformed behavior through its own dependencies, or become unavailable.
- `feesAccrued` delivered to subscriber callbacks can be artificially inflated through donation. Never mint rewards,
  credit reputation, trigger payouts, or authenticate revenue from that value alone.

Subscriber designs must bind upgradeability, ownership, allowlisting, callback gas, failure isolation, unsubscribe,
recovery, event reconstruction, and final user exit. If a subscriber controls money or eligibility, add an independent
source of truth and adversarial donation tests.

## Coherent StateView reads

Read every quote, route, position, and UI snapshot at one explicit block number. Do not combine latest-state calls that
can cross blocks.

Bind the exact StateView deployment and reconcile:

- slot0, sqrt price, tick, protocol fee, and LP fee;
- pool liquidity and tick liquidity/net changes;
- position liquidity and fee-growth values;
- tick bitmap and initialized ticks; and
- native and ERC-20 currency identity.

Cached fee-growth values can be stale relative to current tick state. Use the exact current computation exposed by the
pinned StateView for fee growth inside a range rather than treating a cached field as current. Bound pagination and
read budgets: large tick or reserve scans can exceed provider simulation limits.

## Required tests

- explicit mint and increase with adverse price movement, `amount0Max`, `amount1Max`, deadline, native value, Permit2,
  refunds, and hook data;
- final encoded actions and traces contain neither deprecated from-deltas action;
- decrease, fee collection with zero liquidity change, both remove-liquidity callbacks, enabled remove return delta,
  burn, transfer, permit, approval, and exact caller/hook/recipient balances;
- accrued-fee separation, donation inflation, donate-and-collect in one unlock, and no reward or revenue trust in
  `feesAccrued`;
- subscriber revert, gas exhaustion, code removal, upgrade, malicious unsubscribe callback, and user exit;
- indexer omission, stale owner, reorg, duplicate token id, pagination exhaustion, and onchain reconciliation; and
- coherent-block StateView reads, stale cached fee growth, unsupported deployment, RPC disagreement, and provider
  outage.

Local success does not prove the selected deployment, provider, indexer, or subscriber is live or trustworthy.
