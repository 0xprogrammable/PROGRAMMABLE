# Protocol revenue operations

## Production boundary

The automation is disabled by default. A build, preview, deployment simulation or source match does not authorize a
Mainnet transaction or enable the Vercel keeper.

Production activation requires the exact reviewed router, enforcer and executor deployment, verified runtime hashes,
one configured and revocable MetaMask delegation, a funded disposable keeper, two independent authenticated RPCs, a
strong `CRON_SECRET`, a successful private-relay lifecycle and an explicit enable decision.

Never store the revenue-wallet, Treasury or deployment-wallet private key in Vercel. The only server-side signer is
the disposable keeper bound immutably to the executor. It holds gas only.

## Runtime behavior

Vercel checks the route every minute. The keeper aligns the daily claim with the vault's immutable 24-hour processing
window: it claims in the final five minutes before the vault is due, transfers the exact unprocessed claim total, and
processes the complete pending amount as soon as the vault permits it. A transaction is submitted only when all of the
following hold:

- the signed delegation is active;
- two RPC vendors agree on a two-confirmation state block, one recent finalized price observation and every critical
  binding;
- no keeper transaction is pending;
- coordinator `totalClaimed` minus vault `totalRevenueDeposited` exactly matches the amount transferred;
- the complete transfer fits the wallet balance, signed daily permission and vault capacity;
- the claim or processing window is due and supported hook revenue meets the minimum;
- both public simulations pass;
- the gas price, gas estimate, keeper balance and revenue-to-gas ratio pass their bounds;
- the fixed 0.5% keeper allocation covers the buffered maximum gas cost.

The raw transaction is sent only through Flashbots' private fast endpoint. Onchain tick, output, chunk,
capacity and cooldown checks remain authoritative. A failed check leaves the claim, Treasury transfer and buyback
unchanged and the next Cron invocation tries again.

## Safe statuses

`disabled`, `delegation_missing`, `not_due`, `below_minimum`, `accounting_mismatch`, `gas_price_too_high`, `gas_estimate_too_high`,
`uneconomic` and `keeper_balance_low` are fail-closed no-op states. `submitted` includes the raw transaction hash.
`pending_transaction` prevents nonce reuse while a prior private transaction is unresolved. A `503` means the runtime
could not prove a safe execution and submitted nothing.

## Monitoring

Alert on repeated `503` responses, a pending transaction across more than two Cron windows, a missed eligible cycle,
keeper balance below two buffered executions, delegation revocation, runtime-code drift, a growing unprocessed
backlog, or repeated private-relay failure. A pending private transaction may still require a reviewed replacement or
cancellation; the system deliberately does not guess at an unknown transaction.

After each successful cycle, verify the receipt, `RevenueProcessed` event, exact 50% / 49.5% / 0.5% conservation,
Treasury balance delta, `$V4` delivery and unchanged main-pool binding.

## Extension rule

The current coordinator claims native ETH fees from the pinned Classic V1 and Classic V2 hooks. A future hook or a
non-native fee asset is not discovered automatically. Supporting it requires a reviewed source binding, tests,
source verification and, where the hook restricts claims to the revenue wallet, a narrowly scoped delegation update.
