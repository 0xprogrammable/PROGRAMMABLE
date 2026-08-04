# Protocol revenue V1 security review

## Scope

- `ProtocolRevenueRouterV1`
- `ProtocolRevenueExecutionEnforcerV1`
- `ProtocolRevenueMetaMaskExecutorV1`
- `IProtocolRevenueMetaMaskV1`
- `DeployMainnetProtocolRevenueV1`
- `lib/protocol-revenue/keeper.server.ts`
- `app/api/ops/protocol-revenue/route.ts`

This is an internal review of a local release candidate. It is not an independent audit or live-deployment proof.

## Security properties

### Authority

- Only the fixed revenue wallet can configure the one-time delegation, call `process` or use the manual fallback.
- Only the immutable keeper can call the automated entry point.
- The MetaMask delegation accepts one canonical claim-and-process batch. Unsigned arguments are forbidden.
- Compromise of the Vercel keeper key cannot change the treasury, token recipient, token, pool, shares or call batch.
- The delegation can be revoked by the revenue wallet.

### Accounting

- 50% goes to Treasury, 49.5% buys `$V4`, and 0.5% replenishes the keeper. Integer dust goes to Treasury.
- Bought `$V4` goes to the fixed revenue wallet. No LP position is created or modified.
- Only the exact current hook snapshot is processed. Prior wallet and router balances are excluded.
- Claim, Deep transfer, allocations, swaps and token delivery are atomic.

### Scheduler and submission

- Two independent RPC vendors must agree on one finalized block and all security-critical reads.
- Executor, router and enforcer runtime hashes must match their immutable bindings.
- The keeper private key is server-only; the reward-wallet private key is never present in Vercel.
- Vercel Cron is bearer authenticated and the runtime remains disabled by default.
- A clear pending nonce is required before signing. The onchain cooldown and observation replay check make duplicate
  invocations fail closed.
- Raw transactions go to MEV Blocker's private no-revert boost endpoint, not intentionally to the public mempool.

### Price and gas bounds

- The finalized reference may differ from execution by at most 100 ticks.
- Each `0.1 ETH` maximum chunk has a fee-aware output floor and 100-tick movement bound.
- The complete buy has a 500-tick bound and 32-chunk cap.
- The configured gas-price cap, 125% gas-limit buffer, 250x revenue-to-max-gas threshold and 2x keeper-balance
  headroom are enforced before signing.

## Test coverage

Foundry tests cover exact accounting, odd wei, keeper funding, old-balance exclusion, token delivery, access control,
cooldown, stale/future/replayed observations, delegation revocation, canonical call construction, amount binding,
capacity and price-impact failures. Four stateful invariants repeatedly prove exact three-way conservation, immutable
policy bindings, zero retained `$V4` and consistent cycle accounting. Vitest covers route authentication, safe
failures, skip states, gas buffering, economic thresholds and keeper-balance checks.

## Manual review

| Area | Result |
| --- | --- |
| Upgradeability | No proxy, initializer or upgrade function |
| Administration | No owner, role, pause, recovery or arbitrary-call surface |
| Reentrancy | Mutating contract entry points use OpenZeppelin transient guards |
| Token integration | Exact `$V4`, PoolManager, main hook and Universal Router are runtime-code-hash bound |
| Secrets | Only a disposable keeper key is server-side; no reward-wallet key is required |
| RPC integrity | Two-vendor finalized-block agreement; fail closed on disagreement |
| MEV | Private relay plus onchain reference, output and cumulative impact bounds |
| Arithmetic | Checked arithmetic, FullMath splits and exact conservation tests |
| External-call loops | Swap loop capped at 32 iterations |

## Secure development workflow

1. Static analysis: Slither output is retained per contract and every reported high/medium item is triaged in
   `PROTOCOL-REVENUE-V1-SLITHER.md`; targeted `forge lint` and formatting checks pass.
2. Special features: the stack has no proxy or upgrade path, binds the exact ERC-20/runtime dependencies, and uses no
   arbitrary token integration.
3. Visualization: the inheritance graph, execution flow and authorization table are retained in
   `PROTOCOL-REVENUE-V1-DIAGRAMS.md`.
4. Security properties: the accounting and authority properties above are executable through unit, fork, fuzz and
   stateful invariant tests.
5. Manual review: external calls, reentrancy boundaries, delegation validation, private submission, price controls,
   key scope and residual liveness risks were reviewed explicitly. This remains internal evidence, not an audit.

## Residual risks

- This code has no independent audit.
- Private submission reduces public-mempool exposure but builders and the relay remain trust and availability
  dependencies. No system can guarantee zero MEV.
- A price move above the fixed bounds, a buy above capacity, code drift, revoked delegation, reverting Treasury or
  prolonged provider outage can delay processing.
- A private transaction can remain pending; monitoring must flag it for reviewed cancellation or replacement.
- The 0.5% gas reserve makes successful cycles self-replenishing only when the economic gate passes. Initial keeper gas
  and monitoring are still required.
- Bought `$V4` remains controlled by the revenue wallet after delivery.
- New hook versions and non-native fee assets require explicit reviewed support.

## Release boundary

Local tests do not activate the system. Mainnet deployment, source verification, signed delegation, Vercel sensitive
configuration, a small private-relay lifecycle and production monitoring remain required.
